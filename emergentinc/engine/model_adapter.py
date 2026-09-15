import os,json,re
from pathlib import Path
import httpx
from openai import OpenAI
import jsonschema
from .utils import sha256_text, read_json
from .context_sandbox import ContextSandbox

from typing import Optional, Union
from emergentinc.paths import ProjectPaths, get_paths

def _load_env_file(env_path):
    p = Path(env_path)
    if not p.is_file():
        return
    try:
        from dotenv import load_dotenv
        load_dotenv(p, override=False)
    except Exception:
        for line in p.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            k = k.strip()
            v = v.strip().strip("'\"")
            if k and k not in os.environ:
                os.environ[k] = v

class LLMClient:
    def __init__(self, base_dir: Optional[Union[str, Path, ProjectPaths]] = None):
        if isinstance(base_dir, ProjectPaths):
            self.paths = base_dir
        else:
            self.paths = get_paths(base_dir)
        self.base = self.paths.workspace_root
        self.cfg = read_json(self.paths.config_dir / 'world_config.json')
        if self.cfg.get('runtime',{}).get('mode')!='api_sandbox':
            raise RuntimeError('V5 EXPERIMENT_INVALID: runtime must be api_sandbox')
        mc=self.cfg.get('model',{})
        env_file=mc.get('env_file','.env')
        if env_file:
            _load_env_file(self.paths.project_root / env_file)
        self.base_url=os.environ.get(mc.get('base_url_env','MCL_BASE_URL')) or os.environ.get('MCL_BASE_URL') or mc.get('base_url','CONFIGURE_ME')
        self.api_key=os.environ.get(mc.get('api_key_env','MCL_API_KEY')) or os.environ.get('MCL_API_KEY')
        fallback=os.environ.get(mc.get('fallback_model_env','MCL_MODEL')) or os.environ.get('MCL_MODEL') or mc.get('default_model','CONFIGURE_ME')
        self.models={'decision':os.environ.get(mc.get('decision_model_env','MCL_DECISION_MODEL')) or fallback,
                     'validator':os.environ.get(mc.get('validator_model_env','MCL_VALIDATOR_MODEL')) or fallback,
                     'memory':os.environ.get(mc.get('memory_model_env','MCL_MEMORY_MODEL')) or fallback}
        if not self.api_key: raise RuntimeError('CALL_FAILED: missing MCL_API_KEY')
        if not self.base_url or self.base_url=='CONFIGURE_ME': raise RuntimeError('CALL_FAILED: missing MCL_BASE_URL')
        if any((not m or m=='CONFIGURE_ME') for m in self.models.values()): raise RuntimeError('CALL_FAILED: missing model configuration')
        self.client=OpenAI(api_key=self.api_key,base_url=self.base_url,
                           http_client=httpx.Client(trust_env=False)); self.sandbox=ContextSandbox(self.cfg)
        self.action_schema=read_json(self.paths.schemas_dir / 'pixel_action.schema.json')
        self.evidence_schema=read_json(self.paths.schemas_dir / 'evidence_verdict.schema.json')
        self.memory_schema=read_json(self.paths.schemas_dir / 'memory_update.schema.json')

    def _call_json(self,kind,system,payload,schema,model_kind):
        user=json.dumps(payload,ensure_ascii=False,indent=2); prompt=system+'\n\n'+user
        mc=self.cfg['model']; model=self.models[model_kind]
        try:
            r=self.client.chat.completions.create(model=model,
              messages=[{'role':'system','content':system},{'role':'user','content':user}],
              temperature=float(mc['temperature'][model_kind]),max_tokens=int(mc['max_output_tokens'][model_kind]),
              response_format={'type':'json_schema','json_schema':{
                  'name':kind.lower(),'strict':True,'schema':schema}})
        except Exception as e: raise RuntimeError(f'CALL_FAILED: {kind}: {e}') from e
        raw=(r.choices[0].message.content or '').strip()
        if raw.startswith('```'):
            raw=re.sub(r'^```(?:json)?\s*','',raw); raw=re.sub(r'\s*```$','',raw).strip()
        try: data=json.loads(raw)
        except Exception as e: raise RuntimeError(f'CALL_FAILED: {kind}: invalid JSON') from e
        jsonschema.validate(data,schema); u=r.usage
        usage={'prompt_tokens':getattr(u,'prompt_tokens',0) if u else 0,
               'completion_tokens':getattr(u,'completion_tokens',0) if u else 0,
               'total_tokens':getattr(u,'total_tokens',0) if u else 0}
        return data,{'kind':kind,'model':model,'prompt_hash':sha256_text(prompt),'token_usage':usage,**ContextSandbox.audit(payload)}

    def decide(self,pixel_id,round_num,local_view):
        system=(self.paths.prompts_dir / 'pixel_decision_prompt.md').read_text(encoding='utf-8')
        payload=self.sandbox.pixel_payload(local_view)
        data,audit=self._call_json('PIXEL_DECISION',system,payload,self.action_schema,'decision')
        if data['pixel']!=pixel_id or data['round']!=round_num: raise RuntimeError('CALL_FAILED: pixel/round mismatch')
        return data,audit

    def validate_evidence_semantics(self,problem,evidence,round_num):
        system=(self.paths.prompts_dir / 'evidence_validator_prompt.md').read_text(encoding='utf-8')
        return self._call_json('EVIDENCE_VALIDATION',system,self.sandbox.evidence_payload(problem,evidence),self.evidence_schema,'validator')

    def update_memory(self,pixel_id,round_num,old_memory,event):
        system=(self.paths.prompts_dir / 'memory_update_prompt.md').read_text(encoding='utf-8')
        return self._call_json('MEMORY_UPDATE',system,self.sandbox.memory_payload(old_memory,event),self.memory_schema,'memory')
