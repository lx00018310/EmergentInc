import json
from .utils import neighbors6

class LocalViewBuilder:
    def __init__(self,storage,visibility,capability_gateway):
        self.s=storage; self.v=visibility; self.cg=capability_gateway

    def build(self,pixel_id,round_num,environment_events=None):
        st=self.s.pixel_state(pixel_id)
        genome=self.s.pixel_genome(pixel_id)
        memory=self.s.pixel_memory(pixel_id)
        all_ids=set(self.s.pixel_ids())
        neigh=[]
        for nid in neighbors6(pixel_id):
            if nid in all_ids:
                ns=self.s.pixel_state(nid)
                neigh.append({
                  "pixel_id":nid,"occupied":True,"active":bool(ns.get("active")),
                  "busy":bool(ns.get("current_problem")),"resource":ns.get("resource")
                })
            else:
                neigh.append({"pixel_id":nid,"occupied":False})

        view={
          "round":round_num,
          "self":{"pixel_id":pixel_id,"state":st,"genome":genome,"memory":memory},
          "neighbors":neigh,
          "visible_problems":self.v.visible_problems(pixel_id),
          "visible_bids":self.v.visible_bids(pixel_id),
          "environment_events":environment_events or [],
          "external":{
            "capabilities":self.cg.public_caps_for(pixel_id),
            "pending_requests":self.cg.pending_requests_for(pixel_id),
            "events":self.cg.events_for(pixel_id)
          },
          "allowed_actions":[
            "WORK","CREATE_PROBLEM","OFFER","BID","ACCEPT_BID","ACCEPT","REJECT",
            "TRANSFER","SPAWN","REQUEST_CLOSE","ABANDON","IDLE",
            "REQUEST_CAPABILITY","USE_CAPABILITY","WAIT_EXTERNAL"
          ]
        }
        if self.s.config()["logging"].get("write_local_view_to_inbox",True):
            (self.s.base/f"pixels/{pixel_id}/inbox.md").write_text(
              "# Local View\n\n```json\n"+json.dumps(view,ensure_ascii=False,indent=2)+"\n```\n",
              encoding="utf-8")
        return view

    def should_wake(self,view):
        st=view["self"]["state"]
        ext=view.get("external",{})
        if ext.get("events"): return True
        if view["visible_bids"] or view["environment_events"]: return True
        for vp in view["visible_problems"]:
            if vp.get("reason")!="held": return True
        cp=st.get("current_problem")
        if cp:
            try:
                if self.s.problem(cp).get("status")=="WAITING_EXTERNAL":
                    return False
            except Exception:
                return True
            return True
        return bool(st.get("pending_self_trigger"))
