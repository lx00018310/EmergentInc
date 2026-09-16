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

import json
import inspect
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
from .llm import V9LLMClient, LLMInfrastructureError, LLMResponseError
from .genesis import GenesisPromptManager
from .temporary_prompt import TemporaryPromptManager
from .runner import OwnerActionRequired
from .utils import read_json, write_json, id_to_coord, coord_to_id, neighbors6, sha256_text

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
        self.db_path = self.workspace_dir / "ledger" / "v9_core.sqlite3"
        from .core_store import CoreStore
        self.core_store = CoreStore(self.db_path)
        self.world_state_file = self.live_dir / "world_state.json"
        self.env_file = self.live_dir / "environment.md"
        self.runtime_dir = self.workspace_dir / "runtime"
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self.queue_file = self.runtime_dir / "v9_message_queue.json"
        self.owner_requests_dir = self.live_dir / "external_requests"
        self.owner_requests_dir.mkdir(parents=True, exist_ok=True)

        self.world = World(self.pixels_dir)
        self.router = MessageRouter(self.world, state_file=self.queue_file)
        self.energy_mgr = EnergyManager(self.ledger_file, db_path=self.db_path)
        self.env = Environment(self.env_file)
        self.ops = OperationExecutor(
            self.artifacts_dir,
            private_root=self.workspace_dir / "private",
            workspace_root=self.workspace_dir,
        )
        self.genesis_mgr = GenesisPromptManager(self.runtime_dir)
        self.temp_prompt_mgr = TemporaryPromptManager(self.runtime_dir)

        if llm_client:
            self.llm = llm_client
        else:
            self.llm = V9LLMClient(base_dir=self.workspace_dir.parent, mock_handler=mock_handler)

        # 锁定当前 Run 的创世提示词版本与临时提示词版本
        gen_data = self.genesis_mgr.get_prompt()
        if hasattr(self.llm, "lock_genesis_prompt"):
            self.llm.lock_genesis_prompt(
                prompt_text=gen_data.get("content", ""),
                revision=int(gen_data.get("revision", 0)),
            )

        temp_data = self.temp_prompt_mgr.get_prompt()
        if hasattr(self.llm, "lock_temporary_prompt"):
            self.llm.lock_temporary_prompt(
                prompt_text=temp_data.get("content", ""),
                revision=int(temp_data.get("revision", 0)),
            )

        # 注入统一工具目录
        if hasattr(self.llm, "set_tools_catalog") and hasattr(self.ops, "registry"):
            self.llm.set_tools_catalog(self.ops.registry.render_catalog_for_prompt())

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
        run_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        self._round_state = None
        self._round_has_commits = False
        try:
            return self._run_round(stop_requested, run_budget_tokens, global_budget_tokens, run_id)
        except Exception:
            # Earlier messages may already be committed; a later failure must
            # not leave their last_active_round ahead of world.round.
            self.router.revert_in_progress()
            if self._round_state is not None and self._round_has_commits:
                self.router.roll_to_next_round()
                self._round_state["active_pixels"] = len(self.world.list_pixel_ids(active_only=True))
                self.save_world_state(self._round_state)
            raise

    def _run_round(
        self,
        stop_requested: Optional[Callable[[], bool]] = None,
        run_budget_tokens: Optional[int] = None,
        global_budget_tokens: Optional[int] = None,
        run_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        w_state = self.load_world_state()
        current_round = int(w_state.get("round", 0)) + 1
        w_state["round"] = current_round

        # 确保当前 Run 登记在 CoreStore
        if not run_id:
            run_id = f"run_r{current_round}_{uuid.uuid4().hex[:6]}"
            self.core_store.create_run(
                run_id=run_id,
                run_limit=run_budget_tokens or 1_000_000,
                global_limit=global_budget_tokens or 10_000_000,
                start_round=current_round,
            )
        else:
            if not self.core_store.get_run(run_id):
                self.core_store.create_run(
                    run_id=run_id,
                    run_limit=run_budget_tokens or 1_000_000,
                    global_limit=global_budget_tokens or 10_000_000,
                    loop_id=run_id,
                    start_round=current_round,
                )

        # 确保当前 Run 锁定最新的创世与临时提示词及工具目录
        gen_data = self.genesis_mgr.get_prompt()
        if hasattr(self.llm, "lock_genesis_prompt"):
            self.llm.lock_genesis_prompt(
                prompt_text=gen_data.get("content", ""),
                revision=int(gen_data.get("revision", 0)),
            )

        temp_data = self.temp_prompt_mgr.get_prompt()
        if hasattr(self.llm, "lock_temporary_prompt"):
            self.llm.lock_temporary_prompt(
                prompt_text=temp_data.get("content", ""),
                revision=int(temp_data.get("revision", 0)),
            )

        if hasattr(self.llm, "set_tools_catalog") and hasattr(self.ops, "registry"):
            self.llm.set_tools_catalog(self.ops.registry.render_catalog_for_prompt())

        # 确保现有 Pixel 在数据库中建账并以权威数据库为准双向同步到文件投影
        for pid in self.world.list_pixel_ids():
            st_p = self.world.get_pixel_storage(pid)
            if st_p.state_file.exists():
                st = st_p.load_state()
                self.core_store.ensure_pixel_account(pid, st.energy, st.active)
                self.core_store.sync_account_to_storage(pid, st_p)

        # 1. 刷新物理六邻域拓扑
        self._round_state = w_state
        self.world.refresh_all_neighbors()

        # 2. 自然唤醒检查 (Natural Wake)
        self._check_natural_wake(current_round)

        # 3. 消息流处理循环
        round_hops = 0
        executed_steps = []
        round_pixel_spent: Dict[str, int] = {}
        total_round_spent = 0
        stop_reason = None
        stop_detail = None
        owner_request_ids: List[str] = []

        while True:
            # 停止信号拦截 (调模型前细粒度退出)
            if stop_requested and stop_requested():
                stop_reason = "USER_STOPPED"
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

            # 将消息登记至 CoreStore 消息状态机
            self.core_store.enqueue_message(
                message_id=msg.id,
                sender=msg.sender,
                recipient=msg.recipient,
                content=msg.content,
                round_num=current_round,
                hop=msg.hop,
                source_type=msg.source_type,
                is_feedback=msg.is_feedback,
                run_id=run_id,
            )

            # 检查 CoreStore 消息状态机，实现崩溃恢复保障
            existing_msg = self.core_store.get_message(msg.id)
            if existing_msg:
                if existing_msg.get("status") == "COMMITTED":
                    self.router.commit_in_progress(msg)
                    continue

            reused_response = False
            response_data = None
            if existing_msg and existing_msg.get("status") in ("RESPONSE_STORED", "RESPONSE_SAVED"):
                mc = self.core_store.get_model_call_by_message(msg.id)
                if mc and (mc.get("normalized_response") or mc.get("raw_response")):
                    try:
                        resp_str = mc.get("normalized_response") or mc.get("raw_response")
                        response_data = json.loads(resp_str)
                        reused_response = True
                    except Exception:
                        pass

            if not reused_response:
                # 3.2 提取无副作用 PreparedPrompt 并估算预留
                try:
                    if hasattr(self.llm, "prepare_prompt"):
                        prep = self.llm.prepare_prompt(
                            state_dict=r_state.to_dict(),
                            pixel_md=pixel_md_content,
                            message_md=msg.content,
                        )
                    else:
                        from .llm import PreparedPrompt
                        model_name = getattr(self.llm, "model_name", "mock")
                        prep = PreparedPrompt(
                            system_prompt="",
                            user_content=msg.content,
                            prompt_full=msg.content,
                            prompt_hash=sha256_text(msg.content),
                            estimated_prompt_tokens=len(msg.content) // 4 + 100,
                            max_output_tokens=2000,
                            model_name=model_name,
                            pricing_revision="mock",
                            payload={"state": r_state.to_dict(), "pixel_md": pixel_md_content, "message_md": msg.content},
                        )
                except Exception:
                    self.router.revert_in_progress()
                    raise

                estimated_reserve = self.energy_mgr.estimate_call_reserve(
                    model=prep.model_name,
                    estimated_prompt_tokens=prep.estimated_prompt_tokens,
                    max_output_tokens=prep.max_output_tokens,
                )

                # 层级 1: Pixel 单轮调用预算上限
                pixel_spent = round_pixel_spent.get(msg.recipient, 0)
                if pixel_spent + estimated_reserve > r_state.inbox_call_budget_per_round:
                    self.router.defer_in_progress()
                    continue

                # 层级 2 & 3: 数据库三层硬预算预留 (原子校验 Pixel 余额、Deficit、Run 预算、全局预算)
                ok, call_id, fail_reason = self.core_store.reserve_call_budget(
                    run_id=run_id,
                    pixel_id=msg.recipient,
                    estimated_tokens=estimated_reserve,
                    message_id=msg.id,
                )

                if not ok:
                    if fail_reason == "INSUFFICIENT_PIXEL_ENERGY":
                        acc = self.core_store.get_pixel_account(msg.recipient)
                        cur_energy = acc["energy"] if acc else r_state.energy
                        if cur_energy > 0:
                            # R-07 (T1): 正余额元胞预留不足时不失活！Pixel 保持活跃，消息不消费，挂起等待后续充值/转账
                            r_state.active = True
                            recipient_storage.save_state(r_state)
                            self.core_store.transition_message(msg.id, "WAITING_PIXEL_BUDGET")
                            self.router.defer_in_progress()
                            continue
                        else:
                            # 零余额失活
                            r_state.active = False
                            recipient_storage.save_state(r_state)
                            self.core_store.transition_message(msg.id, "COMMITTED")
                            self.router.commit_in_progress(msg)
                            continue
                    elif fail_reason in ("RUN_BUDGET_EXCEEDED", "GLOBAL_BUDGET_EXCEEDED"):
                        # 预算耗尽，放回队首，熔断本轮
                        self.core_store.transition_message(msg.id, "WAITING_RUN_BUDGET")
                        self.router.revert_in_progress()
                        stop_reason = "BUDGET_EXHAUSTED"
                        break
                    else:
                        # 其他原因（如退款赤字阻断 SPEND_BLOCKED）
                        self.router.defer_in_progress()
                        continue

                # 预留成功
                self.core_store.transition_message(msg.id, "RESERVED")
                self.core_store.sync_account_to_storage(msg.recipient, recipient_storage)
                r_state = recipient_storage.load_state()

                # 3.3 模型决策调用
                try:
                    if stop_requested and stop_requested():
                        self.core_store.settle_call_budget(call_id, 0, details={"reason": "STOP_BEFORE_CALL"})
                        self.core_store.transition_message(msg.id, "QUEUED")
                        self.core_store.sync_account_to_storage(msg.recipient, recipient_storage)
                        self.router.revert_in_progress()
                        stop_reason = "USER_STOPPED"
                        break

                    self.core_store.transition_message(msg.id, "CALLING")

                    # Never retry a possibly billed call on an internal TypeError.
                    kwargs = dict(state_dict=r_state.to_dict(), pixel_md=pixel_md_content, message_md=msg.content)
                    params = inspect.signature(self.llm.step).parameters
                    if "prepared_prompt" in params or any(p.kind == p.VAR_KEYWORD for p in params.values()):
                        kwargs["prepared_prompt"] = prep
                    response_data, audit = self.llm.step(**kwargs)

                    usage = audit.get("token_usage", {})
                    actual_tokens, pricing_details = self.energy_mgr.calculate_call_energy(
                        model=audit.get("model", prep.model_name),
                        prompt_tokens=usage.get("prompt_tokens", 0),
                        completion_tokens=usage.get("completion_tokens", 0),
                        cached_tokens=usage.get("cached_tokens", 0),
                    )
                except LLMResponseError as e:
                    usage = e.token_usage
                    actual_tokens, pricing_details = self.energy_mgr.calculate_call_energy(
                        model=e.model,
                        prompt_tokens=usage.get("prompt_tokens", 0),
                        completion_tokens=usage.get("completion_tokens", 0),
                        cached_tokens=usage.get("cached_tokens", 0),
                    )
                    call_record = dict(
                        call_id=call_id,
                        run_id=run_id,
                        pixel_id=msg.recipient,
                        message_id=msg.id,
                        model=e.model,
                        pricing_revision=e.pricing_revision,
                        prompt_hash=prep.prompt_hash,
                        raw_response=e.raw_response,
                        normalized_response="",
                        prompt_tokens=usage.get("prompt_tokens", 0),
                        completion_tokens=usage.get("completion_tokens", 0),
                        cached_tokens=usage.get("cached_tokens", 0),
                        actual_tokens=actual_tokens,
                        cost_cny=float(pricing_details.get("cost_cny", 0.0)),
                        outcome="FAILED_RESPONSE",
                    )
                    self.core_store.settle_call_budget(
                        call_id,
                        actual_tokens,
                        cost_cny=float(pricing_details.get("cost_cny", 0.0)),
                        outcome="FAILED_RESPONSE",
                        details={**pricing_details, "failure": str(e)},
                        model_call=call_record,
                    )
                    self.core_store.sync_account_to_storage(msg.recipient, recipient_storage)
                    self.core_store.transition_message(msg.id, "QUEUED")
                    self.router.revert_in_progress()
                    stop_reason = "MODEL_RESPONSE_INVALID"
                    stop_detail = str(e)
                    break
                except LLMInfrastructureError as e:
                    # 基础设施级网络/认证/代理故障: 全额退还预留，消息放回队首，立即熔断向上抛出
                    self.core_store.settle_call_budget(call_id, 0, details={"error": f"INFRASTRUCTURE_FAILURE: {str(e)}"})
                    self.core_store.transition_message(msg.id, "QUEUED")
                    self.core_store.sync_account_to_storage(msg.recipient, recipient_storage)
                    self.router.revert_in_progress()
                    raise
                except Exception as e:
                    # R-04 (T1): 未知用量/超时异常，禁止自动退款，挂起为 CALL_OUTCOME_UNKNOWN 并暂停 Run
                    self.core_store.mark_call_unknown(
                        call_id=call_id,
                        run_id=run_id,
                        pixel_id=msg.recipient,
                        message_id=msg.id,
                        error_msg=str(e),
                        model=prep.model_name,
                        pricing_revision=prep.pricing_revision,
                    )
                    self.router.revert_in_progress()
                    stop_reason = "PAUSED_RECOVERY_REQUIRED"
                    stop_detail = f"CALL_OUTCOME_UNKNOWN: {e}"
                    break

                # 3.4 响应持久化与实际结算
                self.core_store.settle_call_budget(
                    call_id,
                    actual_tokens,
                    cost_cny=float(pricing_details.get("cost_cny", 0.0)),
                    details={**pricing_details, "model": audit.get("model")},
                    model_call=dict(
                        call_id=call_id, run_id=run_id, pixel_id=msg.recipient,
                        message_id=msg.id, model=audit.get("model", prep.model_name),
                        pricing_revision=prep.pricing_revision, prompt_hash=prep.prompt_hash,
                        raw_response=audit.get("raw_response", json.dumps(response_data, ensure_ascii=False)),
                        normalized_response=json.dumps(response_data, ensure_ascii=False),
                        prompt_tokens=usage.get("prompt_tokens", 0),
                        completion_tokens=usage.get("completion_tokens", 0),
                        cached_tokens=usage.get("cached_tokens", 0),
                        actual_tokens=actual_tokens,
                        cost_cny=float(pricing_details.get("cost_cny", 0.0)),
                    ),
                )
                self._round_has_commits = True
                self.core_store.sync_account_to_storage(msg.recipient, recipient_storage)

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

            # 兼容 actions 数组格式
            self._round_has_commits = True
            if isinstance(response_data, dict) and "actions" in response_data and isinstance(response_data["actions"], list):
                for act in response_data["actions"]:
                    atype = act.get("type")
                    if atype == "TRANSFER_ENERGY":
                        response_data.setdefault("energy_transfer", []).append({
                            "to": act.get("target") or act.get("to"),
                            "amount": act.get("amount")
                        })
                    elif atype == "ROUTE_MESSAGE":
                        to_target = act.get("to") or act.get("target")
                        if to_target:
                            response_data.setdefault("send_to", []).append(to_target)
                        if "content" in act:
                            response_data["message_md"] = act.get("content")

            # 3.5 心智历史 pixel.md 更新
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

            # 3.6 owner_request 处理 (首期断开审批支线：记录不可用反馈，不写待审批文件，不触发停机，不打断后续工具与路由执行)
            owner_req = response_data.get("owner_request") or response_data.get("unsupported_owner_request")
            if owner_req and isinstance(owner_req, dict) and owner_req.get("type"):
                req_type = str(owner_req.get("type"))
                fb = f"[ENGINE_FEEDBACK]\n\nCAPABILITY_UNAVAILABLE: External owner_request '{req_type}' is disabled in this phase."
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

            # 3.7 环境主动读取
            if response_data.get("environment_read", False):
                env_eff_id = sha256_text(f"{msg.id}_env_read_0")
                if self.core_store.record_effect_once(env_eff_id, msg.id, "environment_read", 0, env_eff_id):
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

            # 3.8 工具操作执行 (统一受控状态机与反馈保障)
            ops_list = response_data.get("operations", [])
            if ops_list and not (stop_requested and stop_requested()):
                receipts, op_feedback = self.ops.execute_all(
                    pixel_id=msg.recipient,
                    operations=ops_list,
                    run_id=run_id,
                    message_id=msg.id,
                    stop_requested=stop_requested,
                    core_store=self.core_store,
                )
                if receipts:
                    feed_eff_id = sha256_text(f"{msg.id}_op_feedback")
                    if self.core_store.record_effect_once(feed_eff_id, msg.id, "op_feedback", 0, feed_eff_id):
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

            # 3.9 邻居转账 (Exactly-Once)
            for idx, transfer in enumerate(response_data.get("energy_transfer", [])):
                tr_eff_id = sha256_text(f"{msg.id}_transfer_{idx}_{json.dumps(transfer)}")
                if self.core_store.record_effect_once(tr_eff_id, msg.id, "transfer", idx, tr_eff_id, transfer):
                    to_id = str(transfer.get("to", "")).strip()
                    amt = int(transfer.get("amount", 0))
                    ref_id = transfer.get("ref_message_id")
                    if not is_valid_coord_id(to_id) or not self.world.is_neighbor(msg.recipient, to_id):
                        fb = f"[ENGINE_FEEDBACK]\n\nTransfer failed: Target '{to_id}' is not a valid direct neighbor."
                        fb_msg = self.router.create_message(sender="ENGINE", recipient=msg.recipient, content=fb, hop=msg.hop + 1, round_num=current_round, source_type="engine_feedback", is_feedback=True)
                        self.router.enqueue([fb_msg])
                        continue
                    to_storage = self.world.get_pixel_storage(to_id)
                    if not to_storage.state_file.exists() or not to_storage.load_state().active:
                        fb = f"[ENGINE_FEEDBACK]\n\nTransfer failed: Target '{to_id}' does not exist or is inactive."
                        fb_msg = self.router.create_message(sender="ENGINE", recipient=msg.recipient, content=fb, hop=msg.hop + 1, round_num=current_round, source_type="engine_feedback", is_feedback=True)
                        self.router.enqueue([fb_msg])
                        continue
                    t_ok, t_err = self.energy_mgr.transfer_energy(recipient_storage, to_storage, amt, ref_message_id=ref_id)
                    if not t_ok:
                        fb = f"[ENGINE_FEEDBACK]\n\nTransfer failed: {t_err}"
                        fb_msg = self.router.create_message(sender="ENGINE", recipient=msg.recipient, content=fb, hop=msg.hop + 1, round_num=current_round, source_type="engine_feedback", is_feedback=True)
                        self.router.enqueue([fb_msg])

            # 3.10 元胞复制 (Exactly-Once)
            reprod = response_data.get("reproduce")
            if reprod:
                rep_eff_id = sha256_text(f"{msg.id}_reproduce_0_{json.dumps(reprod)}")
                if self.core_store.record_effect_once(rep_eff_id, msg.id, "reproduce", 0, rep_eff_id, reprod):
                    target_pos = reprod.get("target")
                    child_energy = int(reprod.get("child_energy", 0))
                    child_pixel_md = reprod.get("child_pixel_md", "")
                    try:
                        target_id = coord_to_id(target_pos)
                    except Exception:
                        target_id = ""
                    if not target_id or target_id not in neighbors6(r_state.id):
                        fb = f"[ENGINE_FEEDBACK]\n\nReproduction failed: Target position {target_pos} is not a direct neighbor."
                        fb_msg = self.router.create_message(sender="ENGINE", recipient=msg.recipient, content=fb, hop=msg.hop + 1, round_num=current_round, source_type="engine_feedback", is_feedback=True)
                        self.router.enqueue([fb_msg])
                    elif self.world.is_occupied(tuple(target_pos)):
                        fb = f"[ENGINE_FEEDBACK]\n\nReproduction failed: Target position {target_pos} is already occupied."
                        fb_msg = self.router.create_message(sender="ENGINE", recipient=msg.recipient, content=fb, hop=msg.hop + 1, round_num=current_round, source_type="engine_feedback", is_feedback=True)
                        self.router.enqueue([fb_msg])
                    else:
                        child_storage = self.world.get_pixel_storage(target_id)
                        rep_ok, rep_err = self.energy_mgr.allocate_reproduction(
                            recipient_storage, child_storage, child_energy, target_pos, child_pixel_md, current_round
                        )
                        if not rep_ok:
                            fb = f"[ENGINE_FEEDBACK]\n\nReproduction failed: {rep_err}"
                            fb_msg = self.router.create_message(sender="ENGINE", recipient=msg.recipient, content=fb, hop=msg.hop + 1, round_num=current_round, source_type="engine_feedback", is_feedback=True)
                            self.router.enqueue([fb_msg])
                        else:
                            self.world.refresh_all_neighbors()

            # 3.11 局部消息路由与转发 (Exactly-Once)
            send_to = response_data.get("send_to", [])
            msg_content = response_data.get("message_md", "")
            route_eff_id = sha256_text(f"{msg.id}_route_0_{json.dumps(send_to)}_{msg_content}")
            if self.core_store.record_effect_once(route_eff_id, msg.id, "route", 0, route_eff_id, {"send_to": send_to}):
                routed_msgs, route_err = self.router.route_response(
                    sender_id=msg.recipient,
                    send_to=send_to,
                    message_content=msg_content,
                    current_hop=msg.hop,
                    round_num=current_round,
                )
                self.router.enqueue(routed_msgs)

            # 3.12 成功提交当前消息消费
            self.core_store.transition_message(msg.id, "COMMITTED")
            self.router.commit_in_progress(msg)

        # 4. 回合收尾与状态持久化
        self.router.roll_to_next_round()
        active_ids = self.world.list_pixel_ids(active_only=True)
        w_state["active_pixels"] = len(active_ids)
        self.save_world_state(w_state)

        return {
            "round": current_round,
            "hops_executed": round_hops,
            "messages_processed": round_hops,
            "model_calls_completed": len(executed_steps),
            "activity_status": "ACTIVE" if executed_steps else "NO_MODEL_CALLS",
            "steps": executed_steps,
            "active_pixels": len(active_ids),
            "stop_reason": stop_reason,
            "stop_detail": stop_detail,
            "owner_requests": owner_request_ids,
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
