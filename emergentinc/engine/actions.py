class ActionExecutor:
    def __init__(self,storage,validator,ledger,evidence,spawn,capability):
        self.s=storage; self.v=validator; self.ledger=ledger
        self.evidence=evidence; self.spawn=spawn; self.capability=capability

    def _claim_problem(self,p,pixel_id,round_num,contract=None):
        old=p.get("current_holder")
        p["current_holder"]=pixel_id
        p["status"]="WORKING"
        if pixel_id not in p["route"]: p["route"].append(pixel_id)
        if contract: p["contracts"].append(contract)
        for o in p.get("offers",[]):
            if o.get("to")==pixel_id or o.get("to")=="NEIGHBORS":
                o["status"]="CLOSED"
        st=self.s.pixel_state(pixel_id)
        st["current_problem"]=p["id"]
        st["last_effective_exchange_round"]=round_num
        self.s.save_pixel_state(pixel_id,st)
        if old and old in self.s.pixel_ids():
            ost=self.s.pixel_state(old)
            if ost.get("current_problem")==p["id"]:
                ost["current_problem"]=None
                self.s.save_pixel_state(old,ost)
        self.s.save_problem(p)

    def execute(self,pixel_id,a,round_num,local_view):
        act=a["action"]
        self.ledger.charge_action(pixel_id,self.v.action_cost(act))
        result={"status":"APPLIED","action":act}
        cur=self.s.pixel_state(pixel_id).get("current_problem")

        if act=="IDLE":
            return result

        if act=="WORK":
            pid=a.get("problem_id") or cur
            self.evidence.add_model_artifact(pid,pixel_id,round_num,a["work_output"])
            result["problem_id"]=pid

        elif act=="ACCEPT":
            pid=a["problem_id"]; p=self.s.problem(pid)
            offer=next((o for o in p["offers"] if o["status"]=="OPEN" and o["to"]==pixel_id),None)
            if not offer: raise RuntimeError("no explicit offer")
            contract=None
            if offer["from"]!="ENVIRONMENT":
                contract={"from":offer["from"],"to":pixel_id,
                          "amount":float(offer["offered_resource"]),"round":round_num}
            self._claim_problem(p,pixel_id,round_num,contract)
            result["problem_id"]=pid

        elif act=="OFFER":
            pid=a.get("problem_id") or cur; p=self.s.problem(pid)
            amount=float(a.get("offered_resource") or max(1.0,p["reward_offer"]*0.5))
            p["offers"].append({"from":pixel_id,"to":"NEIGHBORS",
                                "offered_resource":amount,"status":"OPEN","round":round_num})
            p["status"]="OFFERED"; self.s.save_problem(p)
            result["problem_id"]=pid

        elif act=="BID":
            pid=a["problem_id"]; p=self.s.problem(pid)
            p["bids"].append({"from":pixel_id,"requested_resource":float(a["requested_resource"]),
                              "status":"OPEN","round":round_num})
            p["status"]="BIDDING"; self.s.save_problem(p)
            result["problem_id"]=pid

        elif act=="ACCEPT_BID":
            pid=a.get("problem_id") or cur
            target=a["target_pixel"]; p=self.s.problem(pid)
            bid=next((b for b in p["bids"] if b["from"]==target and b["status"]=="OPEN"),None)
            if not bid: raise RuntimeError("bid not found")
            bid["status"]="ACCEPTED"
            self._claim_problem(p,target,round_num,{
              "from":pixel_id,"to":target,
              "amount":float(bid["requested_resource"]),"round":round_num
            })
            result.update({"problem_id":pid,"to":target})

        elif act=="TRANSFER":
            pid=a.get("problem_id") or cur; p=self.s.problem(pid)
            p["offers"].append({"from":pixel_id,"to":a["target_pixel"],
                                "offered_resource":float(a["offered_resource"]),
                                "status":"OPEN","round":round_num})
            self.s.save_problem(p)
            result.update({"problem_id":pid,"to":a["target_pixel"]})

        elif act=="CREATE_PROBLEM":
            np=a["new_problem"]; child_id=self.s.next_problem_id()
            reward=float(np["reward_offer"])
            st=self.s.pixel_state(pixel_id)
            st["resource"]=round(float(st["resource"])-reward,4)
            self.s.save_pixel_state(pixel_id,st)
            p={
              "id":child_id,"status":"OPEN","creator":pixel_id,"current_holder":None,
              "parent_problem":cur,"current_state":np["current_state"],
              "desired_state":np["desired_state"],"acceptance":np["acceptance"],
              "reward_offer":reward,"reward_source":{"type":"PIXEL_ESCROW","pixel":pixel_id},
              "route":[pixel_id],"contracts":[],
              "offers":[{"from":pixel_id,"to":"NEIGHBORS","offered_resource":reward,
                         "status":"OPEN","round":round_num}],
              "bids":[],"evidence":[],
              "evidence_policy":np.get("evidence_policy",{
                "allowed_sources":["MODEL_ARTIFACT"],"min_items":1
              }),
              "real_world_policy":np.get("real_world_policy"),
              "external_requests":[],"created_round":round_num,"deadline_round":None
            }
            self.s.save_problem(p)
            w=self.s.world(); w["counters"]["problems_created"]+=1; self.s.save_world(w)
            result["problem_id"]=child_id

        elif act=="SPAWN":
            result["child"]=self.spawn.spawn(pixel_id,a["spawn_proposal"],round_num)

        elif act=="REQUEST_CAPABILITY":
            pid=a.get("problem_id") or cur
            req=self.capability.request(pixel_id,pid,round_num,a["capability_request"])
            result.update({
              "problem_id":pid,
              "external_request_id":req["id"],
              "owner_action_required":True
            })

        elif act=="USE_CAPABILITY":
            pid=a.get("problem_id") or cur
            tool=self.capability.use(pixel_id,pid,round_num,a["capability_use"])
            result.update({"problem_id":pid,**tool,"significant_event":"TOOL_RESULT"})

        elif act=="WAIT_EXTERNAL":
            pid=a.get("problem_id") or cur
            p=self.s.problem(pid); p["status"]="WAITING_EXTERNAL"; self.s.save_problem(p)
            st=self.s.pixel_state(pixel_id)
            st["waiting_for"]=a["wait_external"]["wake_conditions"]
            st["sleep_until_round"]=round_num+int(a["wait_external"]["max_sleep_rounds"])
            self.s.save_pixel_state(pixel_id,st)
            result.update({"problem_id":pid,"waiting_external":True,"sleep_until_round":st.get("sleep_until_round")})

        elif act=="ABANDON":
            pid=a.get("problem_id") or cur; p=self.s.problem(pid)
            p["current_holder"]=None; p["status"]="OPEN"
            p["offers"].append({"from":pixel_id,"to":"NEIGHBORS",
                                "offered_resource":max(1.0,p["reward_offer"]*0.5),
                                "status":"OPEN","round":round_num})
            self.s.save_problem(p)
            st=self.s.pixel_state(pixel_id); st["current_problem"]=None
            self.s.save_pixel_state(pixel_id,st)
            result["problem_id"]=pid

        elif act=="REJECT":
            result["problem_id"]=a.get("problem_id")

        elif act=="REQUEST_CLOSE":
            result["problem_id"]=a.get("problem_id") or cur
            result["request_close"]=True

        return result
