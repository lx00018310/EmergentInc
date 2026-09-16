"""回合调度器 (V9 Round Scheduler).

核心执行流:
1. Round Start -> 拓扑刷新 -> 自然唤醒检查 (N=5)
2. 消费消息队列 (崩溃恢复保障) -> 检查停止信号与多层硬预算
3. 动态费用预留 -> 严格三输入 LLM Step (搭载锁定的创世提示词)
4. 真实模型计费折算结算 -> 心智更新 (<=2000字拦截)
5. owner_request 接通 -> 环境主动读取 -> 交付物工具执行
6. 严格邻居转账 -> 原子能量守恒复制 -> 局部消息路由与延期
7. 零能量失活判定 -> 消息事务提交 -> 状态持久化
"""

import time
import uuid
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple, Callable

from .pixel import PixelStorage, PixelState, validate_pixel_md
from .world import World
from .router import MessageRouter, MessageEnvelope, MAX_HOPS_PER_ROUND
from .energy import EnergyManager
from .environment import Environment
from .operations import OperationExecutor, is_valid_coord_id
from .llm import V9LLMClient, LLMInfrastructureError
from .genesis import GenesisPromptManager
from .runner import OwnerActionRequired
from .utils import read_json, write_json, id_to_coord, coord_to_id, neighbors6

NATURAL_WAKE_ROUNDS = 5


class V9RoundScheduler:
    """V9 单轮调度核心控制器 (具有崩溃恢复、硬预算、回款审计与创世提示词)."""

    def __init__(
        self,
        workspace_dir: Path,
        llm_client: Optional[V9LLMClient] = None,
        mock_handler: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
    ):
        self.workspace_dir = Path(workspace_dir)
        self.live_dir = self.workspace_dir / "live"
        self.pixels_dir = self.live_dir / "pixels"
        self.artifacts_dir = self.live_dir / "artifacts"
        self.ledger_file = self.workspace_dir / "ledger" / "energy_ledger.jsonl"
        self.world_state_file = self.live_dir / "world_state.json"
        self.env_file = self.live_dir / "environment.md"
        self.runtime_dir = self.workspace_dir / "runtime"
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self.queue_file = self.runtime_dir / "v9_message_queue.json"
        self.owner_requests_dir = self.live_dir / "external_requests"
        self.owner_requests_dir.mkdir(parents=True, exist_ok=True)

        self.world = World(self.pixels_dir)
        self.router = MessageRouter(self.world, state_file=self.queue_file)
        self.energy_mgr = EnergyManager(self.ledger_file)
        self.env = Environment(self.env_file)
        self.ops = OperationExecutor(self.artifacts_dir)
        self.genesis_mgr = GenesisPromptManager(self.runtime_dir)

        if llm_client:
            self.llm = llm_client
        else:
            self.llm = V9LLMClient(base_dir=self.workspace_dir.parent, mock_handler=mock_handler)

        # 锁定当前 Run 的创世提示词版本
        gen_data = self.genesis_mgr.get_prompt()
        if hasattr(self.llm, "lock_genesis_prompt"):
            self.llm.lock_genesis_prompt(
                prompt_text=gen_data.get("content", ""),
                revision=int(gen_data.get("revision", 0)),
            )

    def load_world_state(self) -> Dict[str, Any]:
        if not self.world_state_file.exists():
            return {"round": 0, "active_pixels": 0, "total_messages": 0}
        return read_json(self.world_state_file)

    def save_world_state(self, state: Dict[str, Any]):
        self.world_state_file.parent.mkdir(parents=True, exist_ok=True)
        write_json(self.world_state_file, state)

    def run_round(
        self,
        stop_requested: Optional[Callable[[], bool]] = None,
        run_budget_tokens: Optional[int] = None,
        global_budget_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        w_state = self.load_world_state()
        current_round = int(w_state.get("round", 0)) + 1
        w_state["round"] = current_round

        # 1. 刷新物理六邻域拓扑
        self.world.refresh_all_neighbors()

        # 2. 自然唤醒检查 (Natural Wake)
        self._check_natural_wake(current_round)

        # 3. 消息流处理循环
        round_hops = 0
        executed_steps = []
        round_pixel_spent: Dict[str, int] = {}
        total_round_spent = 0

        while True:
            # 停止信号拦截 (调模型前细粒度退出)
            if stop_requested and stop_requested():
                break

            msg = self.router.pop_next()
            if not msg:
                break

            round_hops += 1

            # 3.1 跳数限制拦截 (强制延期至下轮，不丢失消息)
            if round_hops > MAX_HOPS_PER_ROUND or msg.hop > MAX_HOPS_PER_ROUND:
                fb = f"[ENGINE_FEEDBACK]\n\nMAX_HOPS_REACHED: Round hop limit {MAX_HOPS_PER_ROUND} reached."
                fb_msg = self.router.create_message(
                    sender="ENGINE",
                    recipient=msg.recipient,
                    content=fb,
                    hop=1,
                    round_num=current_round + 1,
                    source_type="engine_feedback",
                    is_feedback=True,
                )
                self.router.enqueue([fb_msg])
                self.router.commit_in_progress(msg)
                break

            recipient_storage = self.world.get_pixel_storage(msg.recipient)
            if not recipient_storage.exists():
                self.router.commit_in_progress(msg)
                continue

            r_state = recipient_storage.load_state()
            if not r_state.active:
                self.router.commit_in_progress(msg)
                continue

            # 刷新 neighbors
            r_state.neighbors = self.world.get_neighbors_status(msg.recipient)
            recipient_storage.save_state(r_state)
            pixel_md_content = recipient_storage.load_pixel_md()

            # 3.2 动态预算预留与三层硬预算校验
            model_name = getattr(self.llm, "model_name", "default")
            estimated_in = len(pixel_md_content) // 4 + len(msg.content) // 4 + 200
            estimated_reserve = self.energy_mgr.estimate_call_reserve(
                model=model_name,
                estimated_prompt_tokens=estimated_in,
                max_output_tokens=2000,
            )

            # 层级 1: Pixel 单轮调用预算上限
            pixel_spent = round_pixel_spent.get(msg.recipient, 0)
            if pixel_spent + estimated_reserve > r_state.inbox_call_budget_per_round:
                # 超出单轮上限，移入延期队列下轮处理，不扣费
                self.router.delayed_queue.append(msg)
                self.router.save_state()
                continue

            # 层级 2: 单次 Run 的 Owner 硬预算上限
            if run_budget_tokens is not None and (total_round_spent + estimated_reserve > run_budget_tokens):
                self.router.revert_in_progress()
                break

            # 层级 3: 全局累计预算上限
            if global_budget_tokens is not None:
                current_total_energy = sum(
                    self.world.get_pixel_storage(pid).load_state().energy
                    for pid in self.world.list_pixel_ids()
                )
                if current_total_energy < estimated_reserve:
                    self.router.revert_in_progress()
                    break

            # 预留预算
            ok, call_id_or_err = self.energy_mgr.reserve_budget(recipient_storage, estimated_reserve)
            if not ok:
                r_state.active = False
                recipient_storage.save_state(r_state)
                self.router.commit_in_progress(msg)
                continue

            call_id = call_id_or_err
            r_state = recipient_storage.load_state()

            # 3.3 模型决策 (严格三输入)
            try:
                if stop_requested and stop_requested():
                    self.energy_mgr.settle_budget(recipient_storage, call_id, 0, {"reason": "STOP_BEFORE_CALL"})
                    self.router.revert_in_progress()
                    break

                response_data, audit = self.llm.step(
                    state_dict=r_state.to_dict(),
                    pixel_md=pixel_md_content,
                    message_md=msg.content,
                )

                # 依据实际 usage 精准计价折算等效 Token
                usage = audit.get("token_usage", {})
                actual_tokens, pricing_details = self.energy_mgr.calculate_call_energy(
                    model=audit.get("model", model_name),
                    prompt_tokens=usage.get("prompt_tokens", 0),
                    completion_tokens=usage.get("completion_tokens", 0),
                    cached_tokens=usage.get("cached_tokens", 0),
                )
            except LLMInfrastructureError as e:
                # 基础设施级网络/认证/代理故障: 全额退还预留，消息放回队首，立即熔断向上抛出
                self.energy_mgr.settle_budget(
                    recipient_storage, call_id, 0, {"error": f"INFRASTRUCTURE_FAILURE: {str(e)}"}
                )
                self.router.revert_in_progress()
                raise
            except Exception as e:
                # 调用发出但未知用量异常: 严禁盲目按 200 或 0 猜测，记录 USAGE_UNKNOWN 并保留预留
                self.energy_mgr.settle_budget(
                    recipient_storage,
                    call_id,
                    estimated_reserve,
                    {"error": str(e), "status": "USAGE_UNKNOWN", "recovery_required": True},
                )
                fb = f"[ENGINE_FEEDBACK]\n\nLLM_STEP_FAILED: USAGE_UNKNOWN: {str(e)}"
                fb_msg = self.router.create_message(
                    sender="ENGINE",
                    recipient=msg.recipient,
                    content=fb,
                    hop=1,
                    round_num=current_round + 1,
                    source_type="engine_feedback",
                    is_feedback=True,
                )
                self.router.enqueue([fb_msg])
                self.router.commit_in_progress(msg)
                step_summary = {
                    "pixel_id": msg.recipient,
                    "hop": msg.hop,
                    "tokens": estimated_reserve,
                    "error": str(e),
                    "send_to": [],
                }
                executed_steps.append(step_summary)
                continue

            # 3.4 实际计费结算
            self.energy_mgr.settle_budget(
                recipient_storage,
                call_id,
                actual_tokens,
                {**pricing_details, "model": audit.get("model")},
            )

            round_pixel_spent[msg.recipient] = round_pixel_spent.get(msg.recipient, 0) + actual_tokens
            total_round_spent += actual_tokens

            # 更新元胞活跃轮次
            r_state = recipient_storage.load_state()
            r_state.last_active_round = current_round
            recipient_storage.save_state(r_state)

            step_summary = {
                "pixel_id": msg.recipient,
                "hop": msg.hop,
                "tokens": actual_tokens,
                "send_to": response_data.get("send_to", []),
            }
            executed_steps.append(step_summary)

            # 3.5 心智历史 pixel.md 更新与 2000 字符限制校验
            new_pixel_md = response_data.get("pixel_md", pixel_md_content)
            valid_md, md_err = validate_pixel_md(new_pixel_md)
            if valid_md:
                recipient_storage.save_pixel_md(new_pixel_md)
            else:
                fb = f"[ENGINE_FEEDBACK]\n\n{md_err}\npixel.md update rejected. Please compress your mind history."
                fb_msg = self.router.create_message(
                    sender="ENGINE",
                    recipient=msg.recipient,
                    content=fb,
                    hop=msg.hop + 1,
                    round_num=current_round,
                    source_type="engine_feedback",
                    is_feedback=True,
                )
                self.router.enqueue([fb_msg])

            # 3.6 接通 owner_request
            owner_req = response_data.get("owner_request")
            if owner_req and isinstance(owner_req, dict) and owner_req.get("type"):
                req_id = f"req_{current_round}_{uuid.uuid4().hex[:6]}"
                req_data = {
                    "id": req_id,
                    "request_id": req_id,
                    "pixel_id": msg.recipient,
                    "requester": msg.recipient,
                    "round": current_round,
                    "message_id": msg.id,
                    "type": str(owner_req.get("type")),
                    "capability_type": str(owner_req.get("type")),
                    "description": str(owner_req.get("description", "")),
                    "purpose": str(owner_req.get("description", "")),
                    "status": "PENDING_OWNER",
                    "created_at": time.time(),
                }
                req_file = self.owner_requests_dir / f"{req_id}.json"
                write_json(req_file, req_data)

                # 提交当前消息消费，抛出 OwnerActionRequired 挂起演化
                self.router.commit_in_progress(msg)
                raise OwnerActionRequired(request_ids=[req_id])

            # 3.7 环境主动读取 (environment_read)
            if response_data.get("environment_read", False):
                env_text = self.env.read_content()
                env_msg = self.router.create_message(
                    sender="ENVIRONMENT",
                    recipient=msg.recipient,
                    content=env_text,
                    hop=msg.hop + 1,
                    round_num=current_round,
                    source_type="environment",
                )
                self.router.enqueue([env_msg])

            # 3.8 工具操作执行 (operations) - 支持停止拦截
            ops_list = response_data.get("operations", [])
            if ops_list:
                if not (stop_requested and stop_requested()):
                    receipts, op_feedback = self.ops.execute_all(msg.recipient, ops_list)
                    op_msg = self.router.create_message(
                        sender="ENGINE",
                        recipient=msg.recipient,
                        content=op_feedback,
                        hop=msg.hop + 1,
                        round_num=current_round,
                        source_type="engine_feedback",
                        is_feedback=True,
                    )
                    self.router.enqueue([op_msg])

            # 3.9 邻居转账 (energy_transfer)
            for transfer in response_data.get("energy_transfer", []):
                to_id = str(transfer.get("to", "")).strip()
                amt = int(transfer.get("amount", 0))
                ref_id = transfer.get("ref_message_id")

                if not is_valid_coord_id(to_id) or not self.world.is_neighbor(msg.recipient, to_id):
                    fb = f"[ENGINE_FEEDBACK]\n\nTransfer failed: Target '{to_id}' is not a valid direct neighbor."
                    fb_msg = self.router.create_message(
                        sender="ENGINE",
                        recipient=msg.recipient,
                        content=fb,
                        hop=msg.hop + 1,
                        round_num=current_round,
                        source_type="engine_feedback",
                        is_feedback=True,
                    )
                    self.router.enqueue([fb_msg])
                    continue

                to_storage = self.world.get_pixel_storage(to_id)
                if not to_storage.state_file.exists() or not to_storage.load_state().active:
                    fb = f"[ENGINE_FEEDBACK]\n\nTransfer failed: Target '{to_id}' does not exist or is inactive."
                    fb_msg = self.router.create_message(
                        sender="ENGINE",
                        recipient=msg.recipient,
                        content=fb,
                        hop=msg.hop + 1,
                        round_num=current_round,
                        source_type="engine_feedback",
                        is_feedback=True,
                    )
                    self.router.enqueue([fb_msg])
                    continue

                t_ok, t_err = self.energy_mgr.transfer_energy(
                    recipient_storage, to_storage, amt, ref_message_id=ref_id
                )
                if not t_ok:
                    fb = f"[ENGINE_FEEDBACK]\n\nTransfer failed: {t_err}"
                    fb_msg = self.router.create_message(
                        sender="ENGINE",
                        recipient=msg.recipient,
                        content=fb,
                        hop=msg.hop + 1,
                        round_num=current_round,
                        source_type="engine_feedback",
                        is_feedback=True,
                    )
                    self.router.enqueue([fb_msg])

            # 3.10 元胞复制 (reproduce)
            reprod = response_data.get("reproduce")
            if reprod:
                target_pos = reprod.get("target")
                child_energy = int(reprod.get("child_energy", 0))
                child_pixel_md = reprod.get("child_pixel_md", "")

                try:
                    target_id = coord_to_id(target_pos)
                except Exception:
                    target_id = ""

                if not target_id or target_id not in neighbors6(r_state.id):
                    fb = f"[ENGINE_FEEDBACK]\n\nReproduction failed: Target position {target_pos} is not a direct neighbor."
                    fb_msg = self.router.create_message(
                        sender="ENGINE",
                        recipient=msg.recipient,
                        content=fb,
                        hop=msg.hop + 1,
                        round_num=current_round,
                        source_type="engine_feedback",
                        is_feedback=True,
                    )
                    self.router.enqueue([fb_msg])
                elif self.world.is_occupied(tuple(target_pos)):
                    fb = f"[ENGINE_FEEDBACK]\n\nReproduction failed: Target position {target_pos} is already occupied."
                    fb_msg = self.router.create_message(
                        sender="ENGINE",
                        recipient=msg.recipient,
                        content=fb,
                        hop=msg.hop + 1,
                        round_num=current_round,
                        source_type="engine_feedback",
                        is_feedback=True,
                    )
                    self.router.enqueue([fb_msg])
                else:
                    child_storage = self.world.get_pixel_storage(target_id)
                    rep_ok, rep_err = self.energy_mgr.allocate_reproduction(
                        recipient_storage,
                        child_storage,
                        child_energy,
                        target_pos,
                        child_pixel_md,
                        current_round,
                    )
                    if not rep_ok:
                        fb = f"[ENGINE_FEEDBACK]\n\nReproduction failed: {rep_err}"
                        fb_msg = self.router.create_message(
                            sender="ENGINE",
                            recipient=msg.recipient,
                            content=fb,
                            hop=msg.hop + 1,
                            round_num=current_round,
                            source_type="engine_feedback",
                            is_feedback=True,
                        )
                        self.router.enqueue([fb_msg])
                    else:
                        self.world.refresh_all_neighbors()

            # 3.11 局部消息路由与转发
            send_to = response_data.get("send_to", [])
            msg_content = response_data.get("message_md", "")
            routed_msgs, route_err = self.router.route_response(
                sender_id=msg.recipient,
                send_to=send_to,
                message_content=msg_content,
                current_hop=msg.hop,
                round_num=current_round,
            )
            self.router.enqueue(routed_msgs)

            # 3.12 成功提交当前消息消费
            self.router.commit_in_progress(msg)

        # 4. 回合收尾与状态持久化
        self.router.roll_to_next_round()
        active_ids = self.world.list_pixel_ids(active_only=True)
        w_state["active_pixels"] = len(active_ids)
        self.save_world_state(w_state)

        return {
            "round": current_round,
            "hops_executed": round_hops,
            "steps": executed_steps,
            "active_pixels": len(active_ids),
        }

    def _check_natural_wake(self, current_round: int):
        """检查存活元胞自然唤醒 (防范重复创建唤醒消息)."""
        for pid in self.world.list_pixel_ids(active_only=True):
            storage = self.world.get_pixel_storage(pid)
            st = storage.load_state()
            if current_round - st.last_active_round >= NATURAL_WAKE_ROUNDS:
                has_pending = any(m.recipient == pid for m in self.router.queue) or any(
                    m.recipient == pid for m in self.router.delayed_queue
                )
                if not has_pending:
                    wake_msg = self.router.create_message(
                        sender="SYSTEM",
                        recipient=pid,
                        content="[NATURAL_WAKE]\n\nNo new incoming message.",
                        hop=1,
                        round_num=current_round,
                        source_type="natural_wake",
                    )
                    self.router.enqueue([wake_msg])
