import json, hashlib, random, os, time, uuid, threading
from pathlib import Path

_json_locks_guard = threading.Lock()
_json_locks = {}


def _json_path_lock(path):
    key = os.path.normcase(os.path.abspath(os.fspath(path)))
    with _json_locks_guard:
        return _json_locks.setdefault(key, threading.RLock())

def read_json(path):
    p = Path(path)
    with _json_path_lock(p):
        for attempt in range(5):
            try:
                content = p.read_text(encoding="utf-8")
                if content.strip():
                    return json.loads(content)
            except (json.JSONDecodeError, PermissionError, FileNotFoundError):
                if attempt == 4:
                    raise
                time.sleep(0.01 * (attempt + 1))
        return json.loads(p.read_text(encoding="utf-8"))

def write_json(path, obj):
    p = Path(path)
    with _json_path_lock(p):
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(f"{p.name}.{uuid.uuid4().hex[:8]}.tmp")
        try:
            tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            for attempt in range(8):
                try:
                    os.replace(tmp, p)
                    return
                except PermissionError:
                    if attempt == 7:
                        raise
                    # Windows readers may briefly hold a handle without
                    # FILE_SHARE_DELETE. Retry only that transient condition.
                    time.sleep(min(0.01 * (attempt + 1), 0.05))
        finally:
            if tmp.exists():
                try:
                    tmp.unlink()
                except OSError:
                    pass

def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def coord_to_id(pos):
    return f"{int(pos[0])}_{int(pos[1])}_{int(pos[2])}"

def id_to_coord(pixel_id):
    return tuple(int(x) for x in pixel_id.split("_"))

def neighbors6(pixel_id):
    x,y,z=id_to_coord(pixel_id)
    return [
        coord_to_id((x+1,y,z)), coord_to_id((x-1,y,z)),
        coord_to_id((x,y+1,z)), coord_to_id((x,y-1,z)),
        coord_to_id((x,y,z+1)), coord_to_id((x,y,z-1)),
    ]

def seeded_order(items, seed):
    arr=list(items)
    random.Random(seed).shuffle(arr)
    return arr
