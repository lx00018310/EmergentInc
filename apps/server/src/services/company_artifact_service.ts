import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorldRegistryStore } from '@emergentinc/persistence';
import type { OwnerGoalEvidence, ToolResult } from '@emergentinc/protocol';
import { ownerConflict } from './owner_goal_service.js';
import { containedPath } from './safe_path.js';

/** Immutable company evidence indexed by Attempt, independent of a legacy Core database. */
export class CompanyArtifactService {
  constructor(readonly store:WorldRegistryStore,readonly workspace:string) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS company_artifacts(operation_id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL REFERENCES company_execution_attempts(id),goal_id TEXT,goal_revision INTEGER,dispatch_id TEXT,reference TEXT NOT NULL,filename TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,created_at INTEGER NOT NULL);`);
    store.db.exec(`CREATE TABLE IF NOT EXISTS company_agent_artifacts(agent_id TEXT NOT NULL,filename TEXT NOT NULL,operation_id TEXT NOT NULL REFERENCES company_artifacts(operation_id),updated_at INTEGER NOT NULL,PRIMARY KEY(agent_id,filename));`);
    store.db.exec(`CREATE TABLE IF NOT EXISTS company_legacy_artifacts(agent_id TEXT NOT NULL,filename TEXT NOT NULL,reference TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(agent_id,filename));`);
  }
  private bytes(attemptId:string,reference:string,sha256:string,size:number) {
    const parts=reference.split('/');
    if(!/^attempt_[\w-]+$/.test(attemptId)||parts[0]!=='evidence'||parts[1]!==attemptId||parts.some(p=>!p||p==='.'||p==='..'||/[\\:]/.test(p)))ownerConflict('OWNER_EVIDENCE_CHANGED');
    let root:string;try{root=containedPath(this.workspace,'system','executions',attemptId);}catch{ownerConflict('OWNER_EVIDENCE_CHANGED');}
    if(!fs.existsSync(root)||fs.lstatSync(root).isSymbolicLink())ownerConflict('OWNER_EVIDENCE_CHANGED');
    let file=root;for(const p of parts){file=path.join(file,p);if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink())ownerConflict('OWNER_EVIDENCE_CHANGED');}
    if(!fs.statSync(file).isFile()||fs.statSync(file).size!==size||!Number.isSafeInteger(size)||size<0||size>2_000_000)ownerConflict('OWNER_EVIDENCE_CHANGED');
    const bytes=fs.readFileSync(file);if(createHash('sha256').update(bytes).digest('hex')!==sha256)ownerConflict('OWNER_EVIDENCE_CHANGED');return bytes;
  }
  record(attemptId:string,operationId:string,result:ToolResult,directory:string) {
    const a=this.store.db.prepare('SELECT * FROM company_execution_attempts WHERE id=?').get(attemptId),o=result.output;
    if(!a||result.tool!=='save_artifact'||result.status!=='SUCCESS'||typeof o?.filename!=='string'||!o.filename||o.filename.length>100||/[\\/:]/.test(o.filename)||typeof o.snapshot_relative_path!=='string'||typeof o.sha256!=='string'||!/^[a-f0-9]{64}$/.test(o.sha256)||result.operation_id!==operationId.replaceAll(':','_'))ownerConflict('OWNER_EVIDENCE_CHANGED');
    const expected=`evidence/${attemptId}/snapshots/${operationId.replaceAll(':','_')}/0_0_0/${o.filename}`;
    if(o.snapshot_relative_path!==expected||path.resolve(directory)!==path.resolve(this.workspace,'system/executions',attemptId))ownerConflict('OWNER_EVIDENCE_CHANGED');
    this.bytes(attemptId,expected,o.sha256,o.size_bytes);
    this.store.transaction(()=>{
      const old=this.store.db.prepare('SELECT * FROM company_artifacts WHERE operation_id=?').get(operationId);
      if(old&&(old.attempt_id!==attemptId||old.reference!==expected||old.sha256!==o.sha256||old.bytes!==o.size_bytes))ownerConflict('OWNER_RECEIPT_CONFLICT');
      this.store.db.prepare('INSERT OR IGNORE INTO company_artifacts VALUES(?,?,?,?,?,?,?,?,?,?)').run(operationId,attemptId,a.goal_id,a.goal_revision,a.dispatch_id,expected,o.filename,o.sha256,o.size_bytes,Date.now());
      const actor=this.store.db.prepare('SELECT person_id FROM owner_work_tasks WHERE id=?').get(a.task_id)!;
      this.store.db.prepare('INSERT INTO company_agent_artifacts VALUES(?,?,?,?) ON CONFLICT(agent_id,filename) DO UPDATE SET operation_id=excluded.operation_id,updated_at=excluded.updated_at').run(actor.person_id,o.filename,operationId,Date.now());
      if(a.goal_id)this.store.db.prepare("INSERT INTO owner_goal_evidence VALUES(?,?,?,?,'','artifact',?,?,?,?) ON CONFLICT(id) DO NOTHING").run(`artifact:${operationId}`,a.goal_id,a.goal_revision,a.run_id,expected,o.sha256,o.size_bytes,Date.now());
    });
  }
  read(e:OwnerGoalEvidence) {
    if(e.worldId){
      const world=this.store.world(e.worldId),parts=e.reference.split('/');
      if(parts[0]!=='evidence'||parts.some(p=>!p||p==='.'||p==='..'||/[\\:]/.test(p)))ownerConflict('OWNER_EVIDENCE_CHANGED');
      let file:string;try{file=containedPath(this.workspace,...world.workspace_relpath.split('/'),...parts);}catch{ownerConflict('OWNER_EVIDENCE_CHANGED');}
      if(!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.statSync(file).size!==e.bytes||e.bytes>2_000_000)ownerConflict('OWNER_EVIDENCE_CHANGED');
      const bytes=fs.readFileSync(file);if(createHash('sha256').update(bytes).digest('hex')!==e.sha256)ownerConflict('OWNER_EVIDENCE_CHANGED');return bytes;
    }
    const id=e.id.startsWith('artifact:')?e.id.slice(9):'',row=this.store.db.prepare('SELECT * FROM company_artifacts WHERE operation_id=?').get(id);
    if(!row||row.goal_id!==e.goalId||row.goal_revision!==e.specificationRevision||row.reference!==e.reference||row.sha256!==e.sha256||row.bytes!==e.bytes)ownerConflict('OWNER_EVIDENCE_CHANGED');
    return this.bytes(String(row.attempt_id),e.reference,e.sha256,e.bytes);
  }
  boundTo(e:OwnerGoalEvidence,dispatchId:string) {return Boolean(this.store.db.prepare('SELECT 1 FROM company_artifacts WHERE operation_id=? AND dispatch_id=? AND goal_id=? AND goal_revision=?').get(e.id.slice(9),dispatchId,e.goalId,e.specificationRevision));}
  importLegacy(agentId:string,directoryRel:string){
    const parts=[...directoryRel.split('/'),'live','artifacts','0_0_0'],directory=containedPath(this.workspace,...parts);let imported=0,skipped=0;
    if(!fs.existsSync(directory))return {imported,skipped};
    return this.store.transaction(()=>{for(const filename of fs.readdirSync(directory).sort()){
      let file:string;try{file=containedPath(this.workspace,...parts,filename);}catch{skipped++;continue;}
      const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>2_000_000){skipped++;continue;}
      const bytes=fs.readFileSync(file),sha=createHash('sha256').update(bytes).digest('hex');
      imported+=Number(this.store.db.prepare('INSERT INTO company_legacy_artifacts VALUES(?,?,?,?,?,?) ON CONFLICT(agent_id,filename) DO NOTHING').run(agentId,filename,[...parts,filename].join('/'),sha,bytes.length,Date.now()).changes);
    }return {imported,skipped};});
  }
  listForAgent(agentId:string){return this.store.db.prepare(`SELECT x.filename,x.operation_id,a.sha256,a.bytes,x.updated_at FROM company_agent_artifacts x JOIN company_artifacts a USING(operation_id) WHERE x.agent_id=? UNION ALL SELECT l.filename,'legacy:'||l.sha256 operation_id,l.sha256,l.bytes,l.created_at updated_at FROM company_legacy_artifacts l WHERE l.agent_id=? AND NOT EXISTS(SELECT 1 FROM company_agent_artifacts x WHERE x.agent_id=l.agent_id AND x.filename=l.filename) ORDER BY filename`).all(agentId,agentId);}
  forAgent(agentId:string,filename:string){
    const r=this.store.db.prepare('SELECT a.* FROM company_agent_artifacts x JOIN company_artifacts a USING(operation_id) WHERE x.agent_id=? AND x.filename=?').get(agentId,filename);
    if(r)return {operation_id:String(r.operation_id),filename:String(r.filename),sha256:String(r.sha256),bytes:Number(r.bytes),attempt_id:String(r.attempt_id),content:this.bytes(String(r.attempt_id),String(r.reference),String(r.sha256),Number(r.bytes)).toString('utf8')};
    const legacy=this.store.db.prepare('SELECT * FROM company_legacy_artifacts WHERE agent_id=? AND filename=?').get(agentId,filename);if(!legacy)ownerConflict('ARTIFACT_NOT_FOUND');
    let file:string;try{file=containedPath(this.workspace,...String(legacy.reference).split('/'));}catch{ownerConflict('OWNER_EVIDENCE_CHANGED');}
    if(!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.statSync(file).size!==legacy.bytes||Number(legacy.bytes)>2_000_000)ownerConflict('OWNER_EVIDENCE_CHANGED');
    const bytes=fs.readFileSync(file);if(createHash('sha256').update(bytes).digest('hex')!==legacy.sha256)ownerConflict('OWNER_EVIDENCE_CHANGED');
    return {operation_id:'legacy:'+legacy.sha256,filename:String(legacy.filename),sha256:String(legacy.sha256),bytes:Number(legacy.bytes),attempt_id:null,content:bytes.toString('utf8')};
  }
  transfer(from:string,to:string,filename:string){return this.store.transaction(()=>{
    const a=this.forAgent(from,filename);
    if(a.attempt_id)this.store.db.prepare('INSERT INTO company_agent_artifacts VALUES(?,?,?,?) ON CONFLICT(agent_id,filename) DO UPDATE SET operation_id=excluded.operation_id,updated_at=excluded.updated_at').run(to,filename,a.operation_id,Date.now());
    else {const row=this.store.db.prepare('SELECT * FROM company_legacy_artifacts WHERE agent_id=? AND filename=?').get(from,filename)!;this.store.db.prepare('DELETE FROM company_agent_artifacts WHERE agent_id=? AND filename=?').run(to,filename);this.store.db.prepare('INSERT INTO company_legacy_artifacts VALUES(?,?,?,?,?,?) ON CONFLICT(agent_id,filename) DO UPDATE SET reference=excluded.reference,sha256=excluded.sha256,bytes=excluded.bytes,created_at=excluded.created_at').run(to,filename,row.reference,row.sha256,row.bytes,Date.now());}
    return {filename,sha256:a.sha256,size_bytes:a.bytes,targetAgentId:to};
  });}
}
