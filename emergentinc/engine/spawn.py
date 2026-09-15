import copy
from .utils import id_to_coord

class SpawnService:
    def __init__(self, storage):
        self.s=storage
        self.cfg=self.s.config()["resource"]

    def spawn(self,parent_id,proposal,round_num):
        child_id=proposal["target_pixel"]
        parent_state=self.s.pixel_state(parent_id)
        parent_genome=self.s.pixel_genome(parent_id)
        child_genome=copy.deepcopy(parent_genome)
        mut=proposal["mutation"]

        # exactly one top-level mutation instruction
        key,val=next(iter(mut.items()))
        if key.startswith("tendencies."):
            t=key.split(".",1)[1]
            if t not in child_genome["tendencies"]:
                raise ValueError("unknown tendency")
            old=float(child_genome["tendencies"][t])
            new=float(val)
            if abs(new-old)>0.20:
                raise ValueError("mutation delta too large")
            child_genome["tendencies"][t]=new
            child_genome["mutation_record"].append({"round":round_num,"parent":parent_id,"field":key,"from":old,"to":new})
        elif key=="add_principle":
            child_genome["learned_principles"].append(str(val))
            child_genome["mutation_record"].append({"round":round_num,"parent":parent_id,"add_principle":str(val)})
        else:
            raise ValueError("unsupported mutation")

        birth=float(self.cfg["default_birth_grant"])
        child_state={
          "active":1,"position":list(id_to_coord(child_id)),"resource":birth,
          "current_problem":None,"grace_remaining":int(self.cfg["grace_rounds"]),
          "last_effective_exchange_round":round_num,"parent":parent_id,
          "born_round":round_num,"pending_self_trigger":False
        }
        child_memory={"inherited_note":f"Born from {parent_id} at round {round_num}.","working_memory":[],"consolidated_lessons":[]}
        self.s.create_pixel(child_id,child_state,child_genome,child_memory)
        ps=self.s.pixel_state(parent_id)
        ps["resource"]=round(float(ps["resource"])-birth,4)
        self.s.save_pixel_state(parent_id,ps)
        w=self.s.world(); w["counters"]["births"]+=1; self.s.save_world(w)
        return child_id
