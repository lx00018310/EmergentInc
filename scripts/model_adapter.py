import os,json,re
from pathlib import Path
from openai import OpenAI
import jsonschema
from .utils import sha256_text, read_json, write_json

class AgentResponseRequired(RuntimeError):
    def __init__(self,request_path):
        self.request_path=str(request_path)
        super().__init__(f"AGENT_RESPONSE_REQUIRED: {self.request_path}")

class LLMClient:
    def __init__(self,base_dir="."):
        self.base=Path(base_dir)
        cfg=read_json(self.base/"config/world_config.json")
        self.cfg=cfg
        self.mode=os.environ.get("MCL_RUNTIME_MODE",cfg.get("runtime",{}).get("mode","agent_queue"))
        mc=cfg["model"]
        self.model=os.environ.get("MCL_MODEL",mc.get("model","CONFIGURE_ME"))
        self.base_url=os.environ.get("MCL_BASE_URL",mc.get("base_url","CONFIGURE_ME"))
        self.temperature=float(mc.get("temperature",0.65))
        self.max_tokens=int(mc.get("max_output_tokens",1400))
        self.action_schema=read_json(self.base/"schemas/pixel_action.schema.json")
        self.evidence_schema=read_json(self.base/"schemas/evidence_verdict.schema.json")
        self.memory_schema=read_json(self.base/"schemas/memory_update.schema.json")
        if self.mode=="api":
            key=os.environ.get(mc.get("api_key_env","MCL_API_KEY")) or os.environ.get("MCL_API_KEY")
            if not key: raise RuntimeError("CALL_FAILED: missing MCL_API_KEY")
            if not self.base_url or self.base_url=="CONFIGURE_ME": raise RuntimeError("CALL_FAILED: missing MCL_BASE_URL")
            if not self.model or self.model=="CONFIGURE_ME": raise RuntimeError("CALL_FAILED: missing MCL_MODEL")
            self.client=OpenAI(api_key=key,base_url=self.base_url)
        elif self.mode=="agent_queue":
            self.client=None
        else:
            raise ValueError("runtime mode must be api or agent_queue")

    def _request_id(self,kind,meta,prompt):
        rn=meta.get("round","x")
        subject=meta.get("pixel") or meta.get("problem_id") or "world"
        h=sha256_text(prompt)[:12]
        safe=re.sub(r"[^A-Za-z0-9_.-]","_",str(subject))
        return f"R{int(rn):04d}_{kind}_{safe}_{h}" if str(rn).isdigit() else f"{kind}_{safe}_{h}"

    def _agent_queue(self,kind,system,user,schema,meta):
        prompt=system+"\n\n"+user
        rid=self._request_id(kind,meta,prompt)
        req_dir=self.base/self.cfg["runtime"]["agent_queue"]["requests_dir"]
        resp_dir=self.base/self.cfg["runtime"]["agent_queue"]["responses_dir"]
        req_dir.mkdir(parents=True,exist_ok=True); resp_dir.mkdir(parents=True,exist_ok=True)
        req=req_dir/f"{rid}.json"; resp=resp_dir/f"{rid}.json"
        if not req.exists():
            write_json(req,{
              "request_id":rid,"role":kind,"model_label":self.model,"metadata":meta,
              "system_prompt":system,"context":user,"schema":schema,
              "isolation_rule":"Only use this request file for this inference."
            })
        if not resp.exists(): raise AgentResponseRequired(req)
        data=read_json(resp); jsonschema.validate(data,schema)
        usage={
          "prompt_tokens":max(1,len(prompt)//4),
          "completion_tokens":max(1,len(json.dumps(data,ensure_ascii=False))//4),
          "total_tokens":"agent-queue"
        }
        return data,{
          "kind":kind,"model":self.model,"prompt_hash":sha256_text(prompt),
          "token_usage":usage,"request_id":rid
        }

    def _api(self,kind,system,user,schema,meta):
        prompt=system+"\n\n"+user
        try:
            r=self.client.chat.completions.create(
              model=self.model,
              messages=[{"role":"system","content":system},{"role":"user","content":user}],
              temperature=self.temperature,max_tokens=self.max_tokens,
              response_format={"type":"json_object"})
        except Exception as e:
            raise RuntimeError(f"CALL_FAILED: {e}") from e
        raw=(r.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw=re.sub(r"^```(?:json)?\s*","",raw)
            raw=re.sub(r"\s*```$","",raw).strip()
        data=json.loads(raw); jsonschema.validate(data,schema)
        u=r.usage
        usage={
          "prompt_tokens":getattr(u,"prompt_tokens",0) if u else 0,
          "completion_tokens":getattr(u,"completion_tokens",0) if u else 0,
          "total_tokens":getattr(u,"total_tokens",0) if u else 0
        }
        return data,{"kind":kind,"model":self.model,"prompt_hash":sha256_text(prompt),"token_usage":usage}

    def _call(self,kind,system,user,schema,meta):
        if self.mode=="api":
            return self._api(kind,system,user,schema,meta)
        return self._agent_queue(kind,system,user,schema,meta)

    def decide(self,pixel_id,round_num,local_view):
        system=(self.base/"prompts/pixel_decision_prompt.md").read_text(encoding="utf-8")
        user=json.dumps({"round":round_num,"pixel":pixel_id,"local_view":local_view},ensure_ascii=False,indent=2)
        data,audit=self._call("PIXEL_DECISION",system,user,self.action_schema,{"round":round_num,"pixel":pixel_id})
        if data["pixel"]!=pixel_id or data["round"]!=round_num:
            raise RuntimeError("CALL_FAILED: pixel/round mismatch")
        audit["local_view_hash"]=sha256_text(json.dumps(local_view,ensure_ascii=False,sort_keys=True))
        return data,audit

    def validate_evidence_semantics(self,problem,evidence,round_num):
        system=(self.base/"prompts/evidence_validator_prompt.md").read_text(encoding="utf-8")
        user=json.dumps({"problem":problem,"evidence":evidence},ensure_ascii=False,indent=2)
        return self._call("EVIDENCE_VALIDATION",system,user,self.evidence_schema,
                          {"round":round_num,"problem_id":problem["id"]})

    def update_memory(self,pixel_id,round_num,old_memory,event):
        system=(self.base/"prompts/memory_update_prompt.md").read_text(encoding="utf-8")
        user=json.dumps({"old_memory":old_memory,"event":event},ensure_ascii=False,indent=2)
        return self._call("MEMORY_UPDATE",system,user,self.memory_schema,
                          {"round":round_num,"pixel":pixel_id})
