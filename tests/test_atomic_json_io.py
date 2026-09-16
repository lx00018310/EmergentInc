import threading

from emergentinc.engine import utils
from emergentinc.ui.snapshot import create_snapshot


def test_atomic_write_retries_transient_windows_access_denied(tmp_path, monkeypatch):
    target = tmp_path / "state.json"
    real_replace = utils.os.replace
    attempts = []

    def flaky_replace(source, destination):
        attempts.append(1)
        if len(attempts) < 4:
            raise PermissionError(13, "simulated sharing violation")
        return real_replace(source, destination)

    monkeypatch.setattr(utils.os, "replace", flaky_replace)
    monkeypatch.setattr(utils.time, "sleep", lambda _: None)
    utils.write_json(target, {"energy": 723})

    assert len(attempts) == 4
    assert utils.read_json(target) == {"energy": 723}
    assert list(tmp_path.glob("*.tmp")) == []


def test_concurrent_json_readers_never_observe_partial_state(tmp_path):
    target = tmp_path / "state.json"
    utils.write_json(target, {"sequence": 0})
    errors = []
    finished = threading.Event()

    def reader():
        while not finished.is_set():
            try:
                value = utils.read_json(target)
                assert isinstance(value["sequence"], int)
            except Exception as exc:
                errors.append(exc)
                finished.set()

    readers = [threading.Thread(target=reader) for _ in range(6)]
    for thread in readers:
        thread.start()
    try:
        for sequence in range(300):
            utils.write_json(target, {"sequence": sequence})
    finally:
        finished.set()
        for thread in readers:
            thread.join(timeout=2)

    assert errors == []
    assert utils.read_json(target) == {"sequence": 299}
    assert list(tmp_path.glob("*.tmp")) == []


def test_loop_snapshot_excludes_orphan_atomic_temp_files(tmp_path):
    live = tmp_path / "live"
    pixel = live / "pixels" / "0_0_0"
    pixel.mkdir(parents=True)
    utils.write_json(pixel / "state.json", {"energy": 10})
    (pixel / "state.json.orphan.tmp").write_text("stale", encoding="utf-8")

    target = tmp_path / "snapshot"
    create_snapshot(live, target)

    assert (target / "pixels/0_0_0/state.json").exists()
    assert list(target.rglob("*.tmp")) == []
