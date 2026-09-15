class ResourceLedger:
    def __init__(self, storage):
        self.s=storage
        self.cfg=self.s.config()["resource"]

    def charge_action(self,pixel_id,cost):
        st=self.s.pixel_state(pixel_id)
        st["resource"]=round(float(st["resource"])-float(cost),4)
        self.s.save_pixel_state(pixel_id,st)
        w=self.s.world(); w["accounting"]["action_cost_burned"]+=float(cost); self.s.save_world(w)

    def maintenance_all(self):
        cost=float(self.cfg["maintenance_cost_per_round"])
        deaths=[]
        for pid in self.s.pixel_ids(active_only=True):
            st=self.s.pixel_state(pid)
            st["resource"]=round(float(st["resource"])-cost,4)
            if st["resource"]<=0:
                st["grace_remaining"]=int(st.get("grace_remaining",self.cfg["grace_rounds"]))-1
                if st["grace_remaining"]<0:
                    st["active"]=0; deaths.append(pid)
            else:
                st["grace_remaining"]=int(self.cfg["grace_rounds"])
            self.s.save_pixel_state(pid,st)
        w=self.s.world()
        w["accounting"]["maintenance_burned"]+=cost*len(self.s.pixel_ids(active_only=True))
        w["counters"]["deaths"]+=len(deaths)
        self.s.save_world(w)
        return deaths

    def close_distribution(self,p):
        reward=float(p["reward_offer"])
        route=[x for x in p["route"] if x!="ENVIRONMENT"]
        if not route: return {}
        promises={}
        for c in p.get("contracts",[]):
            promises[(c["from"],c["to"])]=float(c["amount"])
        dist={x:0.0 for x in route}
        current_amount=reward
        for i,node in enumerate(route):
            if i+1 < len(route):
                nxt=route[i+1]
                promised=promises.get((node,nxt),0.0)
                dist[node]+=max(0.0,current_amount-promised)
                current_amount=promised
            else:
                dist[node]+=current_amount
        return dist

    def settle_closed(self,p):
        dist=self.close_distribution(p)
        for pid,amt in dist.items():
            if pid in self.s.pixel_ids():
                st=self.s.pixel_state(pid)
                st["resource"]=round(float(st["resource"])+amt,4)
                st["last_effective_exchange_round"]=self.s.world()["round"]
                self.s.save_pixel_state(pid,st)
        w=self.s.world()
        if p["reward_source"]["type"]=="ENVIRONMENT":
            w["accounting"]["environment_reward_injected"]+=float(p["reward_offer"])
        w["accounting"]["resource_transferred"]+=sum(dist.values())
        self.s.save_world(w)
        return dist
