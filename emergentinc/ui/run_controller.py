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

        # Initialize current round from world
        try:
            self.storage.ensure_v5_defaults()
            self._current_round = int(self.storage.world().get('round', 0))
        except Exception:
            self._current_round = 0

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

    def start(self, rounds: int, command_text: str = "") -> Dict[str, Any]:
        if rounds <= 0:
            raise ValueError("rounds must be greater than 0")

        with self.lock:
            if self._running:
                raise RuntimeError("Execution is already in progress.")

            self._log_command(command_text, rounds)

            self.storage.ensure_v5_defaults()
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

            self._worker_thread = threading.Thread(
                target=self._run_loop,
                args=(rounds, self._current_loop, start_round),
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

    def _run_loop(self, rounds: int, loop_id: str, start_round: int) -> None:
        loop_status = "COMPLETED"
        loop_stop_reason = None

        try:
            runner = None
            try:
                runner = RoundRunner(self.paths)
            except Exception:
                pass

            use_v8 = runner is not None and hasattr(runner, 'run_one') and callable(getattr(runner, 'run_one', None))

            from emergentinc.engine.scheduler import V9RoundScheduler
            scheduler = None if use_v8 else V9RoundScheduler(self.paths.workspace_root)

            for _ in range(rounds):
                if self._stop_requested:
                    loop_status = "STOPPED"
                    loop_stop_reason = "USER_STOPPED"
                    break

                try:
                    if use_v8:
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
                        res = scheduler.run_round()
                        with self.lock:
                            self._completed_rounds += 1
                            self._current_round = res["round"]

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

            with self.lock:
                self._running = False
                self._stop_reason = loop_stop_reason
