from .utils import neighbors6
import json

class LocalViewBuilder:
    def __init__(self, storage, visibility):
        self.s=storage; self.v=visibility

    def build(self, pixel_id, round_num, environment_events=None):
        st=self.s.pixel_state(pixel_id)
        genome=self.s.pixel_genome(pixel_id)
        memory=self.s.pixel_memory(pixel_id)
        neigh=[]
        all_ids=set(self.s.pixel_ids())
        for nid in neighbors6(pixel_id):
            if nid in all_ids:
                ns=self.s.pixel_state(nid)
                neigh.append({
                    "pixel_id":nid,
                    "occupied":True,
                    "active":bool(ns.get("active")),
                    "busy":bool(ns.get("current_problem")),
                    "resource":ns.get("resource")
                })
            else:
                neigh.append({"pixel_id":nid,"occupied":False})
        vp=self.v.visible_problems(pixel_id)
        bids=self.v.visible_bids(pixel_id)
        view={
            "round":round_num,
            "self":{"pixel_id":pixel_id,"state":st,"genome":genome,"memory":memory},
            "neighbors":neigh,
            "visible_problems":vp,
            "visible_bids":bids,
            "environment_events":environment_events or [],
            "allowed_actions":["WORK","CREATE_PROBLEM","OFFER","BID","ACCEPT_BID","ACCEPT","REJECT","TRANSFER","SPAWN","REQUEST_CLOSE","ABANDON","IDLE"]
        }
        if self.s.config()["logging"].get("write_local_view_to_inbox",True):
            p=self.s.base/f"pixels/{pixel_id}/inbox.md"
            p.write_text("# Local View\n\n```json\n"+json.dumps(view,ensure_ascii=False,indent=2)+"\n```\n",encoding="utf-8")
        return view

    @staticmethod
    def should_wake(view):
        st=view["self"]["state"]
        if st.get("current_problem"): return True
        if view["visible_problems"] or view["visible_bids"] or view["environment_events"]: return True
        if st.get("pending_self_trigger"): return True
        return False
