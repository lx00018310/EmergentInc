from pathlib import Path
from .utils import read_json

class EnvironmentScheduler:
    def __init__(self, storage):
        self.s=storage
        exp_file = self.s.paths.experiments_dir / "experiment_001.json"
        self.exp = read_json(exp_file) if exp_file.exists() else {}

    def inject(self, round_num):
        events={}
        created=[]
        for item in self.exp.get("environment_schedule",[]):
            if int(item["round"])!=round_num: continue
            pdef=item["problem"]
            pid=pdef["id"]
            if pid in self.s.problem_ids():
                continue
            entry=item["entry_pixel"]
            p={
                "id":pid,"status":"OPEN","creator":"ENVIRONMENT","current_holder":None,
                "parent_problem":None,
                "current_state":pdef["current_state"],"desired_state":pdef["desired_state"],
                "acceptance":pdef["acceptance"],"reward_offer":float(pdef["reward_offer"]),
                "reward_source":{"type":"ENVIRONMENT"},
                "route":["ENVIRONMENT"],"contracts":[],
                "offers":[{"from":"ENVIRONMENT","to":entry,"offered_resource":float(pdef["reward_offer"]),"status":"OPEN","round":round_num}],
                "bids":[],"evidence":[],"evidence_policy":pdef["evidence_policy"],
                "created_round":round_num,"deadline_round":None
            }
            self.s.save_problem(p)
            events.setdefault(entry,[]).append(f"Environment offered {pid}")
            created.append(pid)
        return events,created
