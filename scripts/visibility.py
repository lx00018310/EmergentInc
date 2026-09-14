from .utils import neighbors6

class VisibilityService:
    def __init__(self, storage):
        self.s=storage

    def visible_problems(self, pixel_id):
        visible=[]
        nset=set(neighbors6(pixel_id))
        for pid in self.s.problem_ids():
            p=self.s.problem(pid)
            if p["status"] in ("CLOSED","ABANDONED"): continue
            if p.get("current_holder")==pixel_id:
                visible.append({"reason":"held","problem":p}); continue

            # explicit environment or direct transfer offer
            for offer in p.get("offers",[]):
                if offer.get("to")==pixel_id and offer.get("status")=="OPEN":
                    visible.append({"reason":"offer","problem":p}); break
            else:
                # public local tender: holder is a direct neighbor and offer to="NEIGHBORS"
                holder=p.get("current_holder")
                if holder in nset:
                    for offer in p.get("offers",[]):
                        if offer.get("from")==holder and offer.get("to")=="NEIGHBORS" and offer.get("status")=="OPEN":
                            visible.append({"reason":"neighbor_offer","problem":p}); break
        return visible

    def visible_bids(self, pixel_id):
        out=[]
        for pid in self.s.problem_ids():
            p=self.s.problem(pid)
            if p.get("current_holder")!=pixel_id: continue
            for bid in p.get("bids",[]):
                if bid.get("status")=="OPEN":
                    out.append({"problem_id":pid,**bid})
        return out
