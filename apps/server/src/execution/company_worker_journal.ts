import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { SqliteDatabase } from '@emergentinc/persistence';
import type { PreparedModelRequest, RawModelResponse, ToolResult } from '@emergentinc/protocol';
import type { CompanyWorkerEvent, CompanyWorkerSpec, StoredWorkerModel } from './company_worker_protocol.js';

const digest=(v: unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** Private execution evidence; company goals, money and approvals are never written here. */
export class CompanyWorkerJournal {
  readonly db: SqliteDatabase;
  constructor(readonly directory: string, readonly spec: CompanyWorkerSpec) {
    this.db=new SqliteDatabase(join(directory,'journal.sqlite3'));
    this.db.exec(`PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS worker_identity(id INTEGER PRIMARY KEY CHECK(id=1),schema INTEGER NOT NULL,spec_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS worker_models(operation_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,request_json TEXT NOT NULL,state TEXT NOT NULL,permit_id TEXT,response_json TEXT,attempts INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS worker_tools(operation_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,tool TEXT NOT NULL,args_json TEXT NOT NULL,state TEXT NOT NULL,result_json TEXT);
      CREATE TABLE IF NOT EXISTS worker_events(sequence INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,payload_json TEXT NOT NULL,acknowledged INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS worker_checkpoint(id INTEGER PRIMARY KEY CHECK(id=1),next_step INTEGER NOT NULL,history_json TEXT NOT NULL,terminal_json TEXT);
      INSERT OR IGNORE INTO worker_checkpoint VALUES(1,0,'[]',NULL);`);
    const identity=this.db.prepare('SELECT * FROM worker_identity WHERE id=1').get(),specHash=digest(spec);
    if(identity&&(identity.schema!==1||identity.spec_hash!==specHash)){this.db.close();throw new Error('OWNER_WORKER_IDENTITY_CONFLICT');}
    this.db.prepare('INSERT OR IGNORE INTO worker_identity VALUES(1,1,?)').run(specHash);
  }
  checkpoint(): {nextStep: number; history: PreparedModelRequest['messages']; terminal: {kind: string; reason?: string; reply?: string} | null} {
    const r=this.db.prepare('SELECT * FROM worker_checkpoint WHERE id=1').get()!;
    return {nextStep:Number(r.next_step),history:JSON.parse(String(r.history_json)),terminal:r.terminal_json?JSON.parse(String(r.terminal_json)):null};
  }
  model(operationId: string, request: PreparedModelRequest): StoredWorkerModel {
    const old=this.db.prepare('SELECT * FROM worker_models WHERE operation_id=?').get(operationId),requestHash=digest(request);
    if(old&&old.request_hash!==requestHash)throw new Error('OWNER_WORKER_OPERATION_CONFLICT');
    if(!old)this.db.prepare("INSERT INTO worker_models VALUES(?,?,?,'PREPARED',NULL,NULL,0)").run(operationId,requestHash,JSON.stringify(request));
    const r=this.db.prepare('SELECT * FROM worker_models WHERE operation_id=?').get(operationId)!;
    return {state:String(r.state),attempts:Number(r.attempts),request:JSON.parse(String(r.request_json)),permitId:r.permit_id?String(r.permit_id):null,response:r.response_json?JSON.parse(String(r.response_json)):null};
  }
  modelSent(operationId: string, permitId: string) {
    if(!this.db.prepare("UPDATE worker_models SET state='SENT',permit_id=?,attempts=attempts+1 WHERE operation_id=? AND state='PREPARED'").run(permitId,operationId).changes)throw new Error('OWNER_WORKER_OPERATION_CONFLICT');
  }
  retryNotSent(operationId: string) { if(!this.db.prepare("UPDATE worker_models SET state='PREPARED' WHERE operation_id=? AND state='NOT_SENT' AND attempts<=1").run(operationId).changes)throw new Error('OWNER_WORKER_OPERATION_CONFLICT'); }
  modelResponse(operationId: string, response: RawModelResponse) {
    this.db.transaction(()=>{
      const r=this.db.prepare("SELECT permit_id FROM worker_models WHERE operation_id=? AND state='SENT'").get(operationId);if(!r)throw new Error('OWNER_WORKER_OPERATION_CONFLICT');
      this.db.prepare("UPDATE worker_models SET state='RESPONSE',response_json=? WHERE operation_id=?").run(JSON.stringify(response),operationId);
      this.append('model',{operationId,permitId:r.permit_id,response});
    });
  }
  modelFailure(operationId: string, notSent: boolean, reason: string) {
    this.db.transaction(()=>{
      const r=this.db.prepare("SELECT permit_id FROM worker_models WHERE operation_id=? AND state='SENT'").get(operationId);if(!r)return;
      this.db.prepare('UPDATE worker_models SET state=? WHERE operation_id=?').run(notSent?'NOT_SENT':'UNKNOWN',operationId);
      this.append('model',{operationId,permitId:r.permit_id,notSent,reason});
    });
  }
  tool(operationId: string, tool: string, args: Record<string, any>): {state: string; result: ToolResult | null} {
    const requestHash=digest({tool,args}),r=this.db.prepare('SELECT * FROM worker_tools WHERE operation_id=?').get(operationId);
    if(r&&r.request_hash!==requestHash)throw new Error('OWNER_WORKER_OPERATION_CONFLICT');
    if(!r)this.db.prepare("INSERT INTO worker_tools VALUES(?,?,?,?,'PREPARED',NULL)").run(operationId,requestHash,tool,JSON.stringify(args));
    return r?{state:String(r.state),result:r.result_json?JSON.parse(String(r.result_json)):null}:{state:'PREPARED',result:null};
  }
  toolStarted(operationId: string) { if(!this.db.prepare("UPDATE worker_tools SET state='STARTED' WHERE operation_id=? AND state='PREPARED'").run(operationId).changes)throw new Error('OWNER_WORKER_OPERATION_CONFLICT'); }
  toolResult(operationId: string, result: ToolResult) {
    this.db.transaction(()=>{
      if(!this.db.prepare("UPDATE worker_tools SET state='DONE',result_json=? WHERE operation_id=? AND state IN ('STARTED','PREPARED')").run(JSON.stringify(result),operationId).changes)throw new Error('OWNER_WORKER_OPERATION_CONFLICT');
      this.append('tool',{operationId,result});
    });
  }
  append(kind: CompanyWorkerEvent['kind'], payload: Record<string, any>): CompanyWorkerEvent {
    return this.db.transaction(()=>{
      const sequence=Number(this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 n FROM worker_events').get()!.n),id=`${this.spec.attemptId}:${sequence}`;
      this.db.prepare('INSERT INTO worker_events(sequence,id,kind,payload_json) VALUES(?,?,?,?)').run(sequence,id,kind,JSON.stringify(payload));
      return {id,sequence,attemptId:this.spec.attemptId,fence:this.spec.fence,kind,payload};
    });
  }
  pending(): CompanyWorkerEvent[] { return this.db.prepare('SELECT * FROM worker_events WHERE acknowledged=0 ORDER BY sequence').all().map(r=>({id:String(r.id),sequence:Number(r.sequence),attemptId:this.spec.attemptId,fence:this.spec.fence,kind:r.kind as CompanyWorkerEvent['kind'],payload:JSON.parse(String(r.payload_json))})); }
  acknowledge(id: string) { this.db.prepare('UPDATE worker_events SET acknowledged=1 WHERE id=?').run(id); }
  advance(nextStep: number, history: PreparedModelRequest['messages']) {
    this.db.transaction(()=>{this.db.prepare('UPDATE worker_checkpoint SET next_step=?,history_json=? WHERE id=1').run(nextStep,JSON.stringify(history));this.append('checkpoint',{nextStep});});
  }
  finish(kind: 'completed'|'blocked'|'failed'|'interrupted', payload: {reason?: string; reply?: string}) {
    this.db.transaction(()=>{if(this.checkpoint().terminal)return;this.db.prepare('UPDATE worker_checkpoint SET terminal_json=? WHERE id=1').run(JSON.stringify({kind,...payload}));this.append(kind,payload);});
  }
  close() { this.db.close(); }
}
