import json, hashlib, random
from pathlib import Path

def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

def write_json(path, obj):
    p=Path(path); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")

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
