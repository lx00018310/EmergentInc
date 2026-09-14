import os, json, re
from pathlib import Path
from openai import OpenAI
import jsonschema
from .utils import sha256_text, read_json

class LLMClient:
    def __init__(self, base_dir="."):
        self.base=Path(base_dir)
        cfg=read_json(self.base/"config/world_config.json")["model"]
        self.model=os.environ.get("MCL_MODEL", cfg["model"])
        self.base_url=os.environ.get("MCL_BASE_URL", cfg["base_url"])
        self.api_key=os.environ.get(cfg.get("api_key_env","MCL_API_KEY")) or os.environ.get("MCL_API_KEY")
        if not self.api_key:
            raise RuntimeError("CALL_FAILED: missing MCL_API_KEY")
        self.temperature=float(cfg.get("temperature",0.65))
        self.max_tokens=int(cfg.get("max_output_tokens",1400))
        self.client=OpenAI(api_key=self.api_key, base_url=self.base_url)
        self.action_schema=read_json(self.base/"schemas/pixel_action.schema.json")
        self.evidence_schema=read_json(self.base/"schemas/evidence_verdict.schema.json")
        self.memory_schema=read_json(self.base/"schemas/memory_update.schema.json")

    def _call_json(self, system, user, schema, audit_kind):
        prompt=system+"\n\n"+user
        try:
            r=self.client.chat.completions.create(
                model=self.model,
                messages=[{"role":"system","content":system},{"role":"user","content":user}],
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                response_format={"type":"json_object"},
            )
        except Exception as e:
            raise RuntimeError(f"CALL_FAILED: {e}") from e
        raw=(r.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw=re.sub(r"^```(?:json)?\s*","",raw)
            raw=re.sub(r"\s*```$","",raw).strip()
        try: data=json.loads(raw)
        except Exception as e: raise RuntimeError(f"CALL_FAILED: invalid JSON: {raw}") from e
        jsonschema.validate(data, schema)
        u=r.usage
        usage={
            "prompt_tokens":getattr(u,"prompt_tokens",0) if u else 0,
            "completion_tokens":getattr(u,"completion_tokens",0) if u else 0,
            "total_tokens":getattr(u,"total_tokens",0) if u else 0,
        }
        audit={"kind":audit_kind,"model":self.model,"prompt_hash":sha256_text(prompt),"token_usage":usage}
        return data,audit

    def decide(self, pixel_id, round_num, local_view):
        base_prompt=(self.base/"prompts/pixel_decision_prompt.md").read_text(encoding="utf-8")
        schema_note="\n\n严格输出符合以下 JSON Schema 的对象：\n"+json.dumps(self.action_schema,ensure_ascii=False)
        user=f"ROUND={round_num}\nPIXEL={pixel_id}\n\nLOCAL VIEW:\n{json.dumps(local_view,ensure_ascii=False,indent=2)}"
        data,audit=self._call_json(base_prompt+schema_note,user,self.action_schema,"decision")
        if data["pixel"]!=pixel_id or data["round"]!=round_num:
            raise RuntimeError("CALL_FAILED: pixel/round mismatch")
        audit["local_view_hash"]=sha256_text(json.dumps(local_view,ensure_ascii=False,sort_keys=True))
        return data,audit

    def validate_evidence_semantics(self, problem, evidence):
        p=(self.base/"prompts/evidence_validator_prompt.md").read_text(encoding="utf-8")
        user=json.dumps({"problem":problem,"evidence":evidence},ensure_ascii=False,indent=2)
        return self._call_json(p,user,self.evidence_schema,"evidence_validator")

    def update_memory(self, old_memory, event):
        p=(self.base/"prompts/memory_update_prompt.md").read_text(encoding="utf-8")
        user=json.dumps({"old_memory":old_memory,"event":event},ensure_ascii=False,indent=2)
        return self._call_json(p,user,self.memory_schema,"memory_update")
