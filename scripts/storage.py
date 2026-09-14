import json, copy
from pathlib import Path
from .utils import read_json, write_json, coord_to_id

class Storage:
    def __init__(self, base_dir="."):
        self.base=Path(base_dir)

    def config(self):
        return read_json(self.base/"config/world_config.json")

    def world(self):
        return read_json(self.base/"world_state.json")

    def save_world(self, obj):
        write_json(self.base/"world_state.json", obj)

    def pixel_ids(self, active_only=False):
        root=self.base/"pixels"
        out=[]
        if not root.exists():
            return out
        for d in root.iterdir():
            if d.is_dir() and (d/"state.json").exists():
                if active_only:
                    st=read_json(d/"state.json")
                    if not st.get("active"): continue
                out.append(d.name)
        return out

    def pixel_state(self, pid): return read_json(self.base/f"pixels/{pid}/state.json")
    def pixel_genome(self, pid): return read_json(self.base/f"pixels/{pid}/genome.json")
    def pixel_memory(self, pid): return read_json(self.base/f"pixels/{pid}/memory.json")

    def save_pixel_state(self,pid,obj): write_json(self.base/f"pixels/{pid}/state.json",obj)
    def save_pixel_genome(self,pid,obj): write_json(self.base/f"pixels/{pid}/genome.json",obj)
    def save_pixel_memory(self,pid,obj): write_json(self.base/f"pixels/{pid}/memory.json",obj)

    def append_text(self, rel, text):
        p=self.base/rel; p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a",encoding="utf-8") as f: f.write(text)

    def problem_ids(self):
        return sorted(p.stem for p in (self.base/"problems").glob("P*.json"))

    def problem(self,pid): return read_json(self.base/f"problems/{pid}.json")
    def save_problem(self,p): write_json(self.base/f"problems/{p['id']}.json",p)

    def next_problem_id(self):
        nums=[]
        for pid in self.problem_ids():
            try: nums.append(int(pid[1:]))
            except: pass
        return f"P{(max(nums, default=0)+1):04d}"

    def create_pixel(self, pid, state, genome, memory):
        d=self.base/f"pixels/{pid}"
        if d.exists():
            raise ValueError(f"coordinate occupied: {pid}")
        d.mkdir(parents=True)
        write_json(d/"state.json",state)
        write_json(d/"genome.json",genome)
        write_json(d/"memory.json",memory)
        (d/"state.md").write_text(f"# Pixel State — {pid}\nCanonical: state.json\n",encoding="utf-8")
        (d/"genome.md").write_text(f"# Genome — {pid}\nCanonical: genome.json\n",encoding="utf-8")
        (d/"memory.md").write_text(f"# Memory — {pid}\nCanonical: memory.json\n",encoding="utf-8")
        (d/"history.md").write_text(f"# History — {pid}\n",encoding="utf-8")
        (d/"inbox.md").write_text(f"# Inbox — {pid}\n",encoding="utf-8")
        (d/"llm_log.md").write_text(f"# LLM Log — {pid}\n",encoding="utf-8")
