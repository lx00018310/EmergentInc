import * as path from 'node:path';
import type { WorldRegistryStore } from '@emergentinc/persistence';
import { containedPath } from './safe_path.js';
import { companyFactHash } from './company_fact_hash.js';
import { ownerConflict, ownerInput } from './owner_goal_service.js';

export interface CompanyAgent {
  id:string;name:string;role:string;behaviorProfile:string[];status:'ACTIVE'|'RETIRED';
  legacyWorldId:string|null;directoryRel:string;createdAt:number;
}
/** Company identities are business records, not execution kernels or generations. */
export class CompanyAgentService {
  constructor(readonly store:WorldRegistryStore,readonly workspace:string) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS company_agents(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,behavior_json TEXT NOT NULL,status TEXT NOT NULL,legacy_world_id TEXT UNIQUE,directory_rel TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  }
  private parse(r:Record<string,any>):CompanyAgent {return {id:String(r.id),name:String(r.name),role:String(r.role),behaviorProfile:JSON.parse(String(r.behavior_json)),status:r.status,legacyWorldId:r.legacy_world_id?String(r.legacy_world_id):null,directoryRel:String(r.directory_rel),createdAt:Number(r.created_at)};}
  list(){return this.store.db.prepare('SELECT * FROM company_agents ORDER BY created_at,id').all().map(r=>this.parse(r));}
  get(id:string){const r=this.store.db.prepare('SELECT * FROM company_agents WHERE id=?').get(id);if(!r)ownerConflict('OWNER_PERSON_UNAVAILABLE');return this.parse(r);}
  importLegacy() {
    return this.store.transaction(()=>{
      let imported=0;
      for(const world of this.store.worlds()){
        const p=this.store.qianji.getProfile(world.qianji_id);if(!p)ownerConflict('OWNER_AGENT_IDENTITY_CONFLICT');
        imported+=Number(this.store.db.prepare('INSERT OR IGNORE INTO company_agents VALUES(?,?,?,?,?,?,?,?)').run(p.qianjiId,p.narrative.displayName,p.narrative.roleLabel??'',JSON.stringify(p.narrative.behaviorProfile),p.careerStatus==='active'&&world.status==='ACTIVE'?'ACTIVE':'RETIRED',world.world_id,world.workspace_relpath,world.created_at).changes);
      }
      return imported;
    });
  }
  create(input:{id:string;name:string;role:string;instruction:string}) {
    ownerInput(/^[\w-]{1,128}$/.test(input.id)&&!/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(input.id)&&typeof input.name==='string'&&input.name.trim().length>0&&input.name.length<=80&&typeof input.role==='string'&&input.role.trim().length>0&&input.role.length<=80&&typeof input.instruction==='string'&&input.instruction.trim().length>0&&input.instruction.length<=2000,'OWNER_RECRUIT_INVALID');
    return this.store.transaction(()=>{
      const old=this.store.db.prepare('SELECT * FROM company_agents WHERE id=?').get(input.id);
      if(old){const a=this.parse(old);if(companyFactHash({name:a.name,role:a.role,instruction:a.behaviorProfile[0]})!==companyFactHash({name:input.name,role:input.role,instruction:input.instruction}))ownerConflict('OWNER_REQUEST_CHANGED');return a;}
      this.store.db.prepare("INSERT INTO company_agents VALUES(?,?,?,?,'ACTIVE',NULL,?,?)").run(input.id,input.name,input.role,JSON.stringify([input.instruction]),`agents/${input.id}`,Date.now());
      return this.get(input.id);
    });
  }
  directory(id:string){const a=this.get(id);return containedPath(this.workspace,...a.directoryRel.split('/'));}
  scopeId(id:string){const a=this.get(id);return a.legacyWorldId??a.id;}
  forScope(scopeId:string){const r=this.store.db.prepare('SELECT * FROM company_agents WHERE id=? OR legacy_world_id=?').get(scopeId,scopeId);if(!r)ownerConflict('OWNER_PERSON_UNAVAILABLE');return this.parse(r);}
}
