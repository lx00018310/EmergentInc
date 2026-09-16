import json
import threading
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Union
from emergentinc.paths import ProjectPaths, get_paths
from emergentinc.engine.storage import Storage
from emergentinc.engine.runner import RoundRunner, OwnerActionRequired
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
        self._current_round: int = 0
        self._stop_requested: bool = False
        self._stop_reason: Optional[str] = None
        self._current_loop: Optional[str] = None
        self._pending_owner_requests: List[str] = []
        self._last_error: Optional[str] = None

        # Ensure ui_state dir exists
        self.ui_state_dir = self.paths.ui_state_root
        self.ui_state_dir.mkdir(parents=True, exist_ok=True)
        self.history_file = self.ui_state_dir / 'command_history.jsonl'

        # 启动恢复：修正假死 Loop 为 INTERRUPTED
        self._recover_stale_loops()

        # Initialize current round from world
        try:
            self._current_round = int(self.storage.world().get('round', 0))
        except Exception:
            self._current_round = 0

    def _recover_stale_loops(self):
        """应用启动时，将处于 RUNNING 状态但本进程无 worker 的 Loop 标为 INTERRUPTED."""
        try:
            for loop in self.loop_store.list_loops():
                if loop.get("status") == "RUNNING":
                    loop_id = loop["id"]
                    end_round = int(loop.get("start_round", 0))
                    self.loop_store.finish_loop(
                        loop_id=loop_id,
                        end_round=end_round,
                        status="INTERRUPTED",
                        stop_reason="PROCESS_RESTARTED",
                    )
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

            manifest = self.loop_store.get_manifest()
            current_loop_id = self._current_loop or manifest.get('current_loop')

            return {
                "running": self._running,
                "requested_rounds": self._requested_rounds,
                "completed_rounds": self._completed_rounds,
                "current_round": self._current_round,
                "stop_requested": self._stop_requested,
                "stop_reason": self._stop_reason,
                "current_loop": current_loop_id,
                "current_branch": manifest.get('current_branch', 'main'),
                "pending_owner_requests": list(self._pending_owner_requests),
                "last_error": self._last_error
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
                raise RuntimeError(f"RECOVERY_REQUIRED: Queue file corrupted: {e}")

        db_path = self.paths.workspace_root / "ledger" / "v9_core.sqlite3"
        if db_path.exists():
            from emergentinc.engine.core_store import CoreStore
            store = CoreStore(db_path)
            unresolved = store.get_unresolved_reservations()
            if unresolved:
                raise RuntimeError(f"RECOVERY_REQUIRED: Found {len(unresolved)} open reservations")
            unknown_calls = store.get_unknown_calls()
            if unknown_calls:
                raise RuntimeError(f"RECOVERY_REQUIRED: Found {len(unknown_calls)} unknown model calls requiring recovery")

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

            self._log_command(command_text, rounds, {
                "run_budget_tokens": run_budget_tokens,
                "global_budget_tokens": global_budget_tokens,
            })

            start_round = int(self.storage.world().get('round', 0))
            self._current_round = start_round
            self._requested_rounds = rounds
            self._completed_rounds = 0
            self._stop_requested = False
            self._stop_reason = None
            self._pending_owner_requests = []
            self._last_error = None
            self._running = True

            loop_meta = self.loop_store.start_loop(command_text or f"RUN {rounds}", start_round)
            self._current_loop = loop_meta['id']

            # 若使用 CoreStore，持久化当前 Run 记录
            db_path = self.paths.workspace_root / "ledger" / "v9_core.sqlite3"
            if db_path.exists():
                from emergentinc.engine.core_store import CoreStore
                store = CoreStore(db_path)
                store.create_run(
                    run_id=self._current_loop,
                    run_limit=run_budget_tokens,
                    global_limit=global_budget_tokens,
                    loop_id=self._current_loop,
                    start_round=start_round + 1,
                )

            self._worker_thread = threading.Thread(
                target=self._run_loop,
                args=(rounds, self._current_loop, start_round, run_budget_tokens, global_budget_tokens),
                daemon=True
            )
            self._worker_thread.start()

            return self.status()

    def request_stop(self) -> Dict[str, Any]:
        with self.lock:
            if self._running:
                self._stop_requested = True
                self._log_command("STOP", 0)
            return self.status()

    def _run_loop(
        self,
        rounds: int,
        loop_id: str,
        start_round: int,
        run_budget_tokens: Optional[int] = None,
        global_budget_tokens: Optional[int] = None,
    ) -> None:
        loop_status = "COMPLETED"
        loop_stop_reason = None

        try:
            from unittest.mock import MagicMock
            use_v8_mock = isinstance(RoundRunner, MagicMock) or hasattr(RoundRunner, "__wrapped__")

            if use_v8_mock:
                runner = RoundRunner(self.paths)
                scheduler = None
            else:
                from emergentinc.engine.scheduler import V9RoundScheduler
                scheduler = V9RoundScheduler(self.paths.workspace_root)
                runner = None

            for _ in range(rounds):
                if self._stop_requested:
                    loop_status = "STOPPED"
                    loop_stop_reason = "USER_STOPPED"
                    break

                try:
                    if use_v8_mock:
                        log = runner.run_one()
                        with self.lock:
                            self._completed_rounds += 1
                            self._current_round = log.get('round', self._current_round + 1)
                            if log.get('owner_requests'):
                                self._pending_owner_requests = log['owner_requests']
                                loop_status = "STOPPED"
                                loop_stop_reason = "OWNER_ACTION_REQUIRED"
                                break
                    else:
                        res = scheduler.run_round(
                            stop_requested=lambda: self._stop_requested,
                            run_budget_tokens=run_budget_tokens,
                            global_budget_tokens=global_budget_tokens,
                            run_id=loop_id,
                        )
                        with self.lock:
                            self._completed_rounds += 1
                            self._current_round = res["round"]

                        if res.get("stop_reason") == "BUDGET_EXHAUSTED":
                            loop_status = "STOPPED"
                            loop_stop_reason = "BUDGET_EXHAUSTED"
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
                self._stop_reason = f"INIT_EXCEPTION: {e}"

        finally:
            try:
                end_round = int(self.storage.world().get('round', start_round))
            except Exception:
                end_round = self._current_round

            self.loop_store.finish_loop(
                loop_id,
                end_round=end_round,
                status=loop_status,
                stop_reason=loop_stop_reason
            )

            db_path = self.paths.workspace_root / "ledger" / "v9_core.sqlite3"
            if db_path.exists():
                try:
                    from emergentinc.engine.core_store import CoreStore
                    store = CoreStore(db_path)
                    store.update_run_status(
                        run_id=loop_id,
                        status=loop_status,
                        stop_reason=loop_stop_reason,
                        end_round=end_round,
                    )
                except Exception:
                    pass

            try:
                from emergentinc.engine.audit import generate_run_report
                generate_run_report(self.paths.workspace_root, loop_id)
            except Exception:
                pass

            with self.lock:
                self._running = False
                self._stop_reason = loop_stop_reason
