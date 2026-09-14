from .utils import neighbors6

class RuleValidator:
    def __init__(self, storage):
        self.s=storage
        self.cfg=self.s.config()["resource"]

    def action_cost(self, action):
        key={
          "WORK":"work_cost","CREATE_PROBLEM":"create_problem_cost","OFFER":"offer_cost",
          "BID":"bid_cost","ACCEPT_BID":"accept_bid_cost","ACCEPT":"accept_cost",
          "REJECT":"reject_cost","TRANSFER":"transfer_cost","SPAWN":"spawn_cost",
          "REQUEST_CLOSE":"request_close_cost","ABANDON":"abandon_cost","IDLE":None
        }.get(action)
        return 0.0 if key is None else float(self.cfg.get(key,0))

    def validate(self, pixel_id, action, local_view):
        st=self.s.pixel_state(pixel_id)
        if not st.get("active"): return False,"inactive"
        act=action.get("action")
        if act not in local_view["allowed_actions"]: return False,"action not allowed"
        if float(st["resource"]) < self.action_cost(act): return False,"insufficient resource"
        target=action.get("target_pixel")
        if target and target not in neighbors6(pixel_id): return False,"target not neighbor"

        cur=st.get("current_problem")
        if act=="WORK":
            pid=action.get("problem_id") or cur
            if not pid or pid!=cur: return False,"WORK must target held problem"
            if not isinstance(action.get("work_output"),dict) or not action["work_output"]:
                return False,"WORK requires non-empty work_output"
        if act in ("OFFER","TRANSFER","REQUEST_CLOSE","ABANDON"):
            pid=action.get("problem_id") or cur
            if not pid or pid!=cur: return False,f"{act} requires held problem"
        if act=="ACCEPT" and cur:
            return False,"already holds problem"
        if act=="BID" and cur:
            return False,"busy pixel cannot bid"
        if act=="SPAWN":
            sp=action.get("spawn_proposal")
            if not sp: return False,"missing spawn_proposal"
            tgt=sp.get("target_pixel")
            if tgt not in neighbors6(pixel_id): return False,"spawn target not neighbor"
            if tgt in self.s.pixel_ids(): return False,"spawn target occupied"
            needed=self.action_cost("SPAWN")+float(self.cfg["default_birth_grant"])
            if float(st["resource"])<needed: return False,"insufficient spawn resource"
            if not isinstance(sp.get("mutation"),dict) or len(sp["mutation"])!=1:
                return False,"mutation must change exactly one field"
        if act=="CREATE_PROBLEM":
            np=action.get("new_problem")
            if not isinstance(np,dict): return False,"missing new_problem"
            for k in ("current_state","desired_state","acceptance","reward_offer"):
                if k not in np: return False,f"new_problem missing {k}"
            if float(np["reward_offer"])<=0: return False,"child reward must be >0"
            if float(st["resource"]) < self.action_cost(act)+float(np["reward_offer"]):
                return False,"insufficient resource for child escrow"
        return True,"VALID"
