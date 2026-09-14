import json
from pathlib import Path
from .utils import read_json, write_json

class Storage:
    def __init__(self, base_dir="."):
        self.base=Path(base_dir)

    def config(self): return read_json(self.base/"config/world_config.json")
    def world(self): return read_json(self.base/"world_state.json")
    def save_world(self,obj): write_json(self.base/"world_state.json",obj)

    def ensure_v4_defaults(self):
        for d in ["external_requests","capabilities","external_events","external_transactions",
                  "owner_private/capabilities","runtime/agent_requests","runtime/agent_responses"]:
            (self.base/d).mkdir(parents=True,exist_ok=True)
        w=self.world()
        w.setdefault("external_accounting",{"CNY_in":0.0,"CNY_out":0.0,"USD_in":0.0,"USD_out":0.0})
        w.setdefault("counters",{})
        w["counters"].setdefault("external_requests",0)
        w["counters"].setdefault("capabilities_granted",0)
        w["counters"].setdefault("external_events",0)
        self.save_world(w)
        for pid in self.pixel_ids():
            st=self.pixel_state(pid); changed=False
            for k,v in {"waiting_external_request":None,"waiting_for":[],"capability_ids":[]}.items():
                if k not in st:
                    st[k]=v; changed=True
            if changed: self.save_pixel_state(pid,st)

    def pixel_ids(self,active_only=False):
        root=self.base/"pixels"; out=[]
        if not root.exists(): return out
        for d in root.iterdir():
            if d.is_dir() and (d/"state.json").exists():
                if active_only and not read_json(d/"state.json").get("active"): continue
                out.append(d.name)
        return out

    def pixel_state(self,pid): return read_json(self.base/f"pixels/{pid}/state.json")
    def pixel_genome(self,pid): return read_json(self.base/f"pixels/{pid}/genome.json")
    def pixel_memory(self,pid): return read_json(self.base/f"pixels/{pid}/memory.json")
    def save_pixel_state(self,pid,obj): write_json(self.base/f"pixels/{pid}/state.json",obj)
    def save_pixel_genome(self,pid,obj): write_json(self.base/f"pixels/{pid}/genome.json",obj)
    def save_pixel_memory(self,pid,obj): write_json(self.base/f"pixels/{pid}/memory.json",obj)

    def append_text(self,rel,text):
        p=self.base/rel; p.parent.mkdir(parents=True,exist_ok=True)
        with p.open("a",encoding="utf-8") as f: f.write(text)

    def problem_ids(self): return sorted(p.stem for p in (self.base/"problems").glob("P*.json"))
    def problem(self,pid): return read_json(self.base/f"problems/{pid}.json")
    def save_problem(self,p): write_json(self.base/f"problems/{p['id']}.json",p)
    def next_problem_id(self):
        nums=[]
        for pid in self.problem_ids():
            try: nums.append(int(pid[1:]))
            except: pass
        return f"P{max(nums,default=0)+1:04d}"

    def _ids(self,folder,prefix):
        return sorted(p.stem for p in (self.base/folder).glob(f"{prefix}*.json"))
    def _next_id(self,folder,prefix):
        nums=[]
        for x in self._ids(folder,prefix):
            try: nums.append(int(x[len(prefix):]))
            except: pass
        return f"{prefix}{max(nums,default=0)+1:04d}"

    def external_request_ids(self): return self._ids("external_requests","ER")
    def next_external_request_id(self): return self._next_id("external_requests","ER")
    def external_request(self,rid): return read_json(self.base/f"external_requests/{rid}.json")
    def save_external_request(self,obj): write_json(self.base/f"external_requests/{obj['id']}.json",obj)

    def capability_ids(self): return self._ids("capabilities","CAP")
    def capability(self,cid): return read_json(self.base/f"capabilities/{cid}.json")
    def save_capability(self,obj): write_json(self.base/f"capabilities/{obj['id']}.json",obj)

    def event_ids(self): return self._ids("external_events","EV")
    def next_event_id(self): return self._next_id("external_events","EV")
    def event(self,eid): return read_json(self.base/f"external_events/{eid}.json")
    def save_event(self,obj): write_json(self.base/f"external_events/{obj['id']}.json",obj)

    def transaction_ids(self): return self._ids("external_transactions","TX")
    def next_transaction_id(self): return self._next_id("external_transactions","TX")
    def transaction(self,tid): return read_json(self.base/f"external_transactions/{tid}.json")
    def save_transaction(self,obj): write_json(self.base/f"external_transactions/{obj['id']}.json",obj)

    def create_pixel(self,pid,state,genome,memory):
        d=self.base/f"pixels/{pid}"
        if d.exists(): raise ValueError(f"coordinate occupied: {pid}")
        d.mkdir(parents=True)
        write_json(d/"state.json",state); write_json(d/"genome.json",genome); write_json(d/"memory.json",memory)
        for name,title in [("state.md","Pixel State"),("genome.md","Genome"),("memory.md","Memory"),
                           ("history.md","History"),("inbox.md","Inbox"),("llm_log.md","LLM Log")]:
            (d/name).write_text(f"# {title} — {pid}\n",encoding="utf-8")
