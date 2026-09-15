"""回合调度器 (V9 Round Scheduler).

核心执行流:
1. Round Start -> 自然唤醒 (N=5)
2. 消费消息队列 -> 预留预算 -> LLM Step
3. 实际计费结算 -> 心智更新 (<=2000字拦截)
4. 操作执行 (operations) -> 邻居转账 -> 能量守恒复制
5. 环境读取注入 -> 局部消息路由 (Hop计数与限额)
6. 零能量死亡判定 -> 状态持久化
"""

from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple, Callable
from .pixel import PixelStorage, PixelState, validate_pixel_md
from .world import World
from .router import MessageRouter, MessageEnvelope, MAX_HOPS_PER_ROUND
from .energy import EnergyManager
from .environment import Environment
from .operations import OperationExecutor
from .llm import V9LLMClient, LLMInfrastructureError
from .utils import read_json, write_json, id_to_coord, coord_to_id, neighbors6

NATURAL_WAKE_ROUNDS = 5
ESTIMATED_CALL_RESERVE_TOKENS = 3000


class V9RoundScheduler:
    """V9 单轮调度核心控制器."""

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

        self.world = World(self.pixels_dir)
        self.router = MessageRouter(self.world)
        self.energy_mgr = EnergyManager(self.ledger_file)
        self.env = Environment(self.env_file)
        self.ops = OperationExecutor(self.artifacts_dir)

        if llm_client:
            self.llm = llm_client
        else:
            self.llm = V9LLMClient(base_dir=self.workspace_dir.parent, mock_handler=mock_handler)

    def load_world_state(self) -> Dict[str, Any]:
        if not self.world_state_file.exists():
            return {"round": 0, "active_pixels": 0, "total_messages": 0}
        return read_json(self.world_state_file)

    def save_world_state(self, state: Dict[str, Any]):
        self.world_state_file.parent.mkdir(parents=True, exist_ok=True)
        write_json(self.world_state_file, state)

    def run_round(self) -> Dict[str, Any]:
        w_state = self.load_world_state()
        current_round = int(w_state.get("round", 0)) + 1
        w_state["round"] = current_round

        # 1. 刷新邻域物理拓扑
        self.world.refresh_all_neighbors()

        # 2. 自然唤醒检查 (Natural Wake)
        self._check_natural_wake(current_round)

        # 3. 消息流循环处理
        round_hops = 0
        executed_steps = []

        while True:
            msg = self.router.pop_next()
            if not msg:
                break

            round_hops += 1

            # 3.1 跳数限制拦截 (强制结束 Round 并生成反馈)
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
                break

            recipient_storage = self.world.get_pixel_storage(msg.recipient)
            if not recipient_storage.exists():
                continue

            r_state = recipient_storage.load_state()
            if not r_state.active:
                continue

            # 刷新 neighbors 确保只有纯物理状态
            r_state.neighbors = self.world.get_neighbors_status(msg.recipient)
            recipient_storage.save_state(r_state)

            # 3.2 预留预算
            ok, call_id_or_err = self.energy_mgr.reserve_budget(
                recipient_storage, ESTIMATED_CALL_RESERVE_TOKENS
            )
            if not ok:
                # 能量不足以预留，直接失活
                r_state.active = False
                recipient_storage.save_state(r_state)
                continue

            call_id = call_id_or_err
            # 重新加载预留扣减后的准确状态供模型输入
            r_state = recipient_storage.load_state()
            pixel_md_content = recipient_storage.load_pixel_md()

            # 3.3 模型决策 (严格三输入)
            try:
                response_data, audit = self.llm.step(
                    state_dict=r_state.to_dict(),
                    pixel_md=pixel_md_content,
                    message_md=msg.content,
                )
                actual_tokens = audit.get("token_usage", {}).get("total_tokens", 1000)
            except LLMInfrastructureError as e:
                # 基础设施级故障（API挂掉/未配置/代理禁用/断网）：全额退还预留，不向队列塞反馈，立即向上熔断退出
                self.energy_mgr.settle_budget(
                    recipient_storage, call_id, 0, {"error": f"INFRASTRUCTURE_FAILURE: {str(e)}"}
                )
                # 把未完成处理的消息放回原队列头部，以便修复网络后继续消费，绝不丢失
                self.router.queue.insert(0, msg)
                raise
            except Exception as e:
                # 调用失败，按最小惩罚结算并生成反馈
                self.energy_mgr.settle_budget(
                    recipient_storage, call_id, 200, {"error": str(e)}
                )
                fb = f"[ENGINE_FEEDBACK]\n\nLLM_STEP_FAILED: {str(e)}"
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
                step_summary = {
                    "pixel_id": msg.recipient,
                    "hop": msg.hop,
                    "tokens": 200,
                    "error": str(e),
                    "send_to": [],
                }
                executed_steps.append(step_summary)
                continue

            # 3.4 实际计费结算
            self.energy_mgr.settle_budget(
                recipient_storage, call_id, actual_tokens, {"model": audit.get("model")}
            )

            # 更新活跃回合
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
                # 拒绝更新，保留旧内容，回传超长反馈
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

            # 3.6 环境主动读取 (environment_read)
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

            # 3.7 工具操作执行 (operations)
            ops_list = response_data.get("operations", [])
            if ops_list:
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

            # 3.8 邻居转账 (energy_transfer)
            for transfer in response_data.get("energy_transfer", []):
                to_id = transfer.get("to")
                amt = int(transfer.get("amount", 0))
                ref_id = transfer.get("ref_message_id")
                if not self.world.is_neighbor(msg.recipient, to_id):
                    fb = f"[ENGINE_FEEDBACK]\n\nTransfer failed: Target '{to_id}' is not a direct neighbor."
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

            # 3.9 元胞复制 (reproduce)
            reprod = response_data.get("reproduce")
            if reprod:
                target_pos = reprod.get("target")
                child_energy = int(reprod.get("child_energy", 0))
                child_pixel_md = reprod.get("child_pixel_md", "")

                # 检查目标坐标合法性
                cur_pos = r_state.position
                target_id = coord_to_id(target_pos)
                if target_id not in neighbors6(r_state.id):
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

            # 3.10 消息路由与转发
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
        """检查是否有存活元胞长时间未被唤醒."""
        for pid in self.world.list_pixel_ids(active_only=True):
            storage = self.world.get_pixel_storage(pid)
            st = storage.load_state()
            if current_round - st.last_active_round >= NATURAL_WAKE_ROUNDS:
                # 检查当前队列是否有发给该 pixel 的消息
                has_pending = any(m.recipient == pid for m in self.router.queue)
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
