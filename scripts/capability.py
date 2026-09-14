import os,json,subprocess
from datetime import datetime, timezone

class CapabilityGateway:
    def __init__(self,storage,evidence):
        self.s=storage; self.evidence=evidence
        self.cfg=self.s.config().get("external",{})

    def request(self,pixel_id,problem_id,round_num,req):
        rid=self.s.next_external_request_id()
        obj={
          "id":rid,"status":"PENDING_OWNER","requester":pixel_id,"problem_id":problem_id,
          "capability_type":req["capability_type"],"purpose":req["purpose"],
          "minimum_requirements":req["minimum_requirements"],
          "requested_operations":req["requested_operations"],
          "estimated_external_cost":req.get("estimated_external_cost"),
          "created_round":round_num,"resolved_round":None,
          "owner_reason":None,"capability_id":None
        }
        self.s.save_external_request(obj)
        st=self.s.pixel_state(pixel_id)
        st["waiting_external_request"]=rid
        st["waiting_for"]=["CAPABILITY_GRANTED","CAPABILITY_REJECTED"]
        self.s.save_pixel_state(pixel_id,st)
        if problem_id:
            p=self.s.problem(problem_id)
            p["status"]="WAITING_EXTERNAL"
            p.setdefault("external_requests",[])
            if rid not in p["external_requests"]: p["external_requests"].append(rid)
            self.s.save_problem(p)
        w=self.s.world(); w["counters"]["external_requests"]+=1; self.s.save_world(w)
        return obj

    def public_caps_for(self,pixel_id):
        out=[]
        for cid in self.s.capability_ids():
            c=self.s.capability(cid)
            if c.get("status")=="ACTIVE" and c.get("granted_to")==pixel_id:
                out.append(c)
        return out

    def pending_requests_for(self,pixel_id):
        out=[]
        for rid in self.s.external_request_ids():
            r=self.s.external_request(rid)
            if r.get("requester")==pixel_id and r.get("status")=="PENDING_OWNER":
                out.append(r)
        return out

    def events_for(self,pixel_id):
        out=[]
        for eid in self.s.event_ids():
            e=self.s.event(eid)
            if e.get("target_pixel")==pixel_id and not e.get("consumed"):
                out.append(e)
        return out

    def consume_events(self,pixel_id,event_ids):
        for eid in event_ids:
            e=self.s.event(eid)
            if e.get("target_pixel")==pixel_id:
                e["consumed"]=True; self.s.save_event(e)

    def use(self,pixel_id,problem_id,round_num,use):
        cid=use["capability_id"]; op=use["operation"]; args=use.get("arguments",{})
        cap=self.s.capability(cid)
        if cap["status"]!="ACTIVE": raise RuntimeError("capability inactive")
        if cap["granted_to"]!=pixel_id: raise RuntimeError("capability not granted to pixel")
        if op not in cap["allowed_operations"]: raise RuntimeError("operation not allowed")
        if cap.get("problem_scope") and problem_id and cap["problem_scope"]!=problem_id:
            raise RuntimeError("capability outside problem scope")

        profile_path=self.s.base/f"owner_private/capabilities/{cid}.json"
        if not profile_path.exists():
            raise RuntimeError(f"owner private profile missing for {cid}")
        profile=json.loads(profile_path.read_text(encoding="utf-8"))
        driver=profile.get("driver")

        if driver=="ssh" and op=="ssh_exec":
            result=self._ssh_exec(profile,args)
        else:
            raise RuntimeError(f"unsupported driver/operation: {driver}/{op}")

        if problem_id:
            self.evidence.add_tool_verified(problem_id,pixel_id,round_num,{
              "capability_id":cid,"operation":op,"result":result
            })
        return {"capability_id":cid,"operation":op,"tool_result":result}

    def _ssh_exec(self,profile,args):
        command=args.get("command")
        if not command: raise RuntimeError("ssh_exec requires arguments.command")
        host=profile["host"]; port=int(profile.get("port",22)); user=profile["username"]
        key_env=profile.get("key_path_env")
        key_path=os.environ.get(key_env,"") if key_env else profile.get("key_path","")
        if not key_path: raise RuntimeError("SSH key path not configured")
        timeout=int(self.cfg.get("ssh_timeout_seconds",60))
        cmd=[
          "ssh","-i",key_path,"-p",str(port),
          "-o","BatchMode=yes","-o","StrictHostKeyChecking=accept-new",
          f"{user}@{host}",command
        ]
        cp=subprocess.run(cmd,capture_output=True,text=True,timeout=timeout)
        mx=int(self.cfg.get("tool_output_max_chars",8000))
        return {
          "exit_code":cp.returncode,
          "stdout":cp.stdout[-mx:],
          "stderr":cp.stderr[-mx:],
          "verified_at":datetime.now(timezone.utc).isoformat()
        }
