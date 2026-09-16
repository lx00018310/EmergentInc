import json
import time
import uuid
import threading
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Union
from emergentinc.paths import ProjectPaths, get_paths
from emergentinc.engine.storage import Storage
from emergentinc.engine.runner import OwnerActionRequired
from .loop_store import LoopStore

class RunController:
    def __init__(self, base_dir: Optional[Union[str, Path, ProjectPaths]] = None):
        if isinstance(base_dir, ProjectPaths):
            self.paths = base_dir
        else:
            self.paths = get_paths(base_dir)
        self.base = self.paths.workspace_root
        self.storage = Storage(self.paths)
        self.loop_store = LoopStore(self.paths)
        self.lock = threading.RLock()

        self._worker_thread: Optional[threading.Thread] = None
        self._running: bool = False
        self._requested_rounds: int = 0
        self._completed_rounds: int = 0
        self._messages_processed: int = 0
        self._model_calls_completed: int = 0
        self._idle_rounds: int = 0
        self._current_round: int = 0
        self._stop_requested: bool = False
        self._stop_reason: Optional[str] = None
        self._current_run_id: Optional[str] = None
        self._current_loop: Optional[str] = None
        self._pending_owner_requests: List[str] = []
        self._last_error: Optional[str] = None
        self._result_status: Optional[str] = None

        # Ensure ui_state dir exists
        self.ui_state_dir = self.paths.ui_state_root
        self.ui_state_dir.mkdir(parents=True, exist_ok=True)
        self.history_file = self.ui_state_dir / 'command_history.jsonl'

        # 启动恢复：修正假死 Run 为 INTERRUPTED
        self._recover_stale_runs()

        # Initialize current round from world
        try:
            self._current_round = int(self.storage.world().get('round', 0))
        except Exception:
            self._current_round = 0

    def _recover_stale_runs(self):
        """应用启动时，将处于 RUNNING 状态但本进程无 worker 的 Run 标为 INTERRUPTED (不修改旧 Loop 历史)."""
        db_path = self.paths.workspace_root / "ledger" / "v9_core.sqlite3"
        if db_path.exists():
            try:
                from emergentinc.engine.core_store import CoreStore
                store = CoreStore(db_path)
                store.recover_stale_runs()
            except Exception:
                pass


    def _log_command(self, command_text: str, rounds: int, extra: Optional[Dict[str, Any]] = None) -> None:
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "command": command_text,
            "rounds": rounds,
            "current_round": self._current_round,
            "extra": extra or {}
        }
        with open(self.history_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')

    def status(self) -> Dict[str, Any]:
        with self.lock:
            # Sync current round from world if not running
            if not self._running:
                try:
                    self._current_round = int(self.storage.world().get('round', 0))
                except Exception:
                    pass

            run_id = self._current_run_id or self._current_loop

            persisted_pending = []
            try:
                persisted_ids = set()
                for request_id in self.storage.external_request_ids():
                    persisted_ids.add(request_id)
                    request = self.storage.external_request(request_id)
                    if request.get("status") == "PENDING_OWNER":
                        persisted_pending.append(request_id)
                persisted_pending.extend(
                    request_id for request_id in self._pending_owner_requests
                    if request_id not in persisted_ids
                )
            except Exception:
                persisted_pending = list(self._pending_owner_requests)
            self._pending_owner_requests = sorted(set(persisted_pending))

            return {
                "running": self._running,
                "requested_rounds": self._requested_rounds,
                "completed_rounds": self._completed_rounds,
                "messages_processed": self._messages_processed,
                "model_calls_completed": self._model_calls_completed,
                "idle_rounds": self._idle_rounds,
                "current_round": self._current_round,
                "stop_requested": self._stop_requested,
                "stop_reason": self._stop_reason,
                "run_id": run_id,
                "current_run": run_id,
                "current_loop": run_id,
                "current_branch": "main",
                "pending_owner_requests": list(self._pending_owner_requests),
                "last_error": self._last_error,
                "result_status": self._result_status,
            }

    def _run_startup_audit(self) -> None:
        """启动审计门: 检查损坏队列、未决 reservation 与 unknown call."""
        queue_file = self.paths.runtime_root / "v9_message_queue.json"
        if queue_file.exists():
            try:
                content = queue_file.read_text(encoding="utf-8")
                if content.strip():
                    data = json.loads(content)
                    if not isinstance(data, dict):
                        raise ValueError("Queue root is not a dict")
            except Exception as e:
                raise RuntimeError(f"RECOVERY_REQUIRED: Queue file corrupted: {queue_file}: {e}")

        db_path = self.paths.workspace_root / "ledger" / "v9_core.sqlite3"
        if db_path.exists():
            from emergentinc.engine.core_store import CoreStore
            store = CoreStore(db_path)
            unresolved = store.get_unresolved_reservations()
            if unresolved:
                res_ids = [str(r.get("reservation_id", "unknown")) for r in unresolved[:5]]
                raise RuntimeError(f"RECOVERY_REQUIRED: Found {len(unresolved)} open reservations ({', '.join(res_ids)})")
            unknown_calls = store.get_unknown_calls()
            if unknown_calls:
                call_ids = [str(c.get("call_id", "unknown")) for c in unknown_calls[:5]]
                raise RuntimeError(f"RECOVERY_REQUIRED: Found {len(unknown_calls)} unknown model calls ({', '.join(call_ids)}) requiring recovery")

        # 中断的 Round 可能已经写入 Pixel 副作用，却尚未提交 world.round。
        # 这种状态不能靠下一次空 Round 悄悄“追平”，否则会掩盖半完成事务。
        try:
            world_round = int(self.storage.world().get("round", 0))
        except Exception as e:
            raise RuntimeError(f"RECOVERY_REQUIRED: Cannot read world round: {e}") from e

        round_inconsistencies = []
        pixels_dir = self.paths.live_root / "pixels"
        if pixels_dir.exists():
            for pixel_dir in sorted(pixels_dir.iterdir()):
                state_file = pixel_dir / "state.json"
                if not pixel_dir.is_dir() or not state_file.exists():
                    continue
                try:
                    state = json.loads(state_file.read_text(encoding="utf-8"))
                    born_round = int(state.get("born_round", 0))
                    last_active_round = int(state.get("last_active_round", 0))
                except Exception as e:
                    raise RuntimeError(
                        f"RECOVERY_REQUIRED: Corrupt Pixel state '{state_file}': {e}"
                    ) from e

                if born_round > world_round or last_active_round > world_round:
                    round_inconsistencies.append(
                        f"{pixel_dir.name}(born={born_round}, last_active={last_active_round}, world={world_round})"
                    )

        if round_inconsistencies:
            preview = ", ".join(round_inconsistencies[:5])
            raise RuntimeError(
                "RECOVERY_REQUIRED: Pixel round state is ahead of world round: " + preview
            )

    def start(
        self,
        rounds: int,
        command_text: str = "",
        run_budget_tokens: Optional[int] = None,
        global_budget_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        if rounds <= 0:
            raise ValueError("rounds must be greater than 0")

        if run_budget_tokens is None:
            run_budget_tokens = 100_000
        if global_budget_tokens is None:
            global_budget_tokens = 1_000_000

        if run_budget_tokens <= 0 or global_budget_tokens <= 0:
            raise ValueError("run_budget_tokens and global_budget_tokens must be positive integers")

        with self.lock:
            if self._running:
                raise RuntimeError("Execution is already in progress.")

            # 启动审计门拦截
            self._run_startup_audit()

            start_round = int(self.storage.world().get('round', 0))
            run_id = f"run_{int(time.time())}_{uuid.uuid4().hex[:6]}"
            self._current_run_id = run_id
            self._current_loop = run_id

            # 严格持久化当前 Run 记录到 CoreStore；创建失败不得启动线程
            db_path = self.paths.workspace_root / "ledger" / "v9_core.sqlite3"
            db_path.parent.mkdir(parents=True, exist_ok=True)
            from emergentinc.engine.core_store import CoreStore
            store = CoreStore(db_path)
            store.create_run(
                run_id=run_id,
                run_limit=run_budget_tokens,
                global_limit=global_budget_tokens,
                loop_id=run_id,
                start_round=start_round + 1,
            )

            try:
                self._log_command(command_text, rounds, {
                    "run_id": run_id,
                    "run_budget_tokens": run_budget_tokens,
                    "global_budget_tokens": global_budget_tokens,
                })

                self._current_round = start_round
                self._requested_rounds = rounds
                self._completed_rounds = 0
                self._messages_processed = 0
                self._model_calls_completed = 0
                self._idle_rounds = 0
                self._stop_requested = False
                self._stop_reason = None
                self._last_error = None
                self._result_status = None

                self._worker_thread = threading.Thread(
                    target=self._run_loop,
                    args=(rounds, run_id, start_round, run_budget_tokens, global_budget_tokens),
                    daemon=True
                )
                self._running = True
                self._worker_thread.start()
            except Exception as e:
                self._running = False
                self._worker_thread = None
                self._stop_reason = f"START_FAILED: {e}"
                self._last_error = f"START_FAILED: {e}"
                self._result_status = "ERROR"
                try:
                    store.update_run_status(
                        run_id=run_id,
                        status="ERROR",
                        stop_reason=f"START_FAILED: {e}",
                        end_round=start_round,
                    )
                except Exception:
                    pass
                raise

            return self.status()

    def request_stop(self) -> Dict[str, Any]:
        with self.lock:
            if self._running:
                self._stop_requested = True
                self._log_command("STOP", 0)
            return self.status()

    def _get_scheduler(self):
        """获取调度器实例 (单一 V9 调度主路径)."""
        from emergentinc.engine.scheduler import V9RoundScheduler
        return V9RoundScheduler(self.paths.workspace_root)

    def _run_loop(
        self,
        rounds: int,
        run_id: str,
        start_round: int,
        run_budget_tokens: Optional[int] = None,
        global_budget_tokens: Optional[int] = None,
    ) -> None:
        loop_status = "COMPLETED"
        loop_stop_reason = None

        try:
            scheduler = self._get_scheduler()

            for _ in range(rounds):
                if self._stop_requested:
                    loop_status = "STOPPED"
                    loop_stop_reason = "USER_STOPPED"
                    break

                try:
                    res = scheduler.run_round(
                        stop_requested=lambda: self._stop_requested,
                        run_budget_tokens=run_budget_tokens,
                        global_budget_tokens=global_budget_tokens,
                        run_id=run_id,
                    )
                    with self.lock:
                        self._completed_rounds += 1
                        self._current_round = res["round"]
                        messages_processed = int(
                            res.get("messages_processed", res.get("hops_executed", 0))
                        )
                        model_calls_completed = int(
                            res.get("model_calls_completed", len(res.get("steps", [])))
                        )
                        self._messages_processed += messages_processed
                        self._model_calls_completed += model_calls_completed
                        if messages_processed == 0 and model_calls_completed == 0:
                            self._idle_rounds += 1

                    if res.get("stop_reason") == "BUDGET_EXHAUSTED":
                        loop_status = "STOPPED"
                        loop_stop_reason = "BUDGET_EXHAUSTED"
                        break
                    if res.get("stop_reason") == "USER_STOPPED":
                        loop_status = "STOPPED"
                        loop_stop_reason = "USER_STOPPED"
                        break
                    if res.get("stop_reason") == "PAUSED_RECOVERY_REQUIRED":
                        loop_status = "PAUSED_RECOVERY_REQUIRED"
                        loop_stop_reason = res.get("stop_detail") or "CALL_OUTCOME_UNKNOWN"
                        with self.lock:
                            self._last_error = loop_stop_reason
                        break
                    if res.get("stop_reason") == "MODEL_RESPONSE_INVALID":
                        loop_status = "ERROR"
                        loop_stop_reason = res.get("stop_detail") or "MODEL_RESPONSE_INVALID"
                        with self.lock:
                            self._last_error = loop_stop_reason
                        break
                    if res.get("stop_reason") == "OWNER_ACTION_REQUIRED":
                        loop_status = "STOPPED"
                        loop_stop_reason = "OWNER_ACTION_REQUIRED"
                        with self.lock:
                            self._pending_owner_requests = list(res.get("owner_requests", []))
                        break

                    # 记录该轮的消息流动轨迹供 UI 画图
                    flow_records = []
                    for step in res.get("steps", []):
                        pid = step.get("pixel_id")
                        hop = step.get("hop")
                        for target in step.get("send_to", []):
                            flow_records.append({
                                "round": res["round"],
                                "hop": hop,
                                "sender": pid,
                                "recipient": target,
                            })
                    flow_file = self.paths.ui_state_root / "latest_flow.json"
                    flow_file.write_text(json.dumps(flow_records, ensure_ascii=False, indent=2), encoding="utf-8")

                except OwnerActionRequired as e:
                    with self.lock:
                        self._pending_owner_requests = e.request_ids
                        loop_status = "STOPPED"
                        loop_stop_reason = "OWNER_ACTION_REQUIRED"
                        break
                except Exception as e:
                    with self.lock:
                        self._last_error = str(e)
                        loop_status = "ERROR"
                        loop_stop_reason = f"EXCEPTION: {e}"
                    break

            with self.lock:
                if not self._stop_reason:
                    self._stop_reason = loop_stop_reason

        except Exception as e:
            with self.lock:
                self._last_error = str(e)
                loop_status = "ERROR"
                loop_stop_reason = f"INIT_EXCEPTION: {e}"
                self._stop_reason = loop_stop_reason

        finally:
            if loop_status == "COMPLETED" and self._model_calls_completed == 0:
                # Round 可以按世界规则合法空转，但不能再被呈现成“模型/API 正常运行”。
                loop_status = "COMPLETED_NO_ACTIVITY"

            try:
                end_round = int(self.storage.world().get('round', start_round))
            except Exception:
                end_round = self._current_round

            db_path = self.paths.workspace_root / "ledger" / "v9_core.sqlite3"
            if db_path.exists():
                try:
                    from emergentinc.engine.core_store import CoreStore
                    store = CoreStore(db_path)
                    store.update_run_status(
                        run_id=run_id,
                        status=loop_status,
                        stop_reason=loop_stop_reason,
                        end_round=end_round,
                    )
                except Exception as e:
                    loop_status = "ERROR"
                    loop_stop_reason = f"RUN_STATUS_WRITE_FAILED: {e}"
                    self._last_error = loop_stop_reason

            with self.lock:
                self._running = False
                self._stop_reason = loop_stop_reason
                self._result_status = loop_status
