import {afterEach,describe,expect,it,vi} from 'vitest';
import {goalFixture} from './fixtures/owner_goals.js';
import {CompanyProgressService} from '../src/services/company_progress_service.js';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{vi.useRealTimers();vi.restoreAllMocks();for(const close of cleanup.splice(0).reverse())await close();});
function fixture(){
  const f=goalFixture();cleanup.push(f.close);const goal=f.goal('Bounded internal work','manual'),plans=f.gate.proposals.plans;
  const plan=plans.install(goal.id,{summary:'One internal result',nodes:[{key:'draft',title:'Draft',instruction:'Keep real sources',filename:'result.md',trigger:{kind:'once'},dependsOn:[]}]},true);
  function attach(dispatchId:string,node=plan.nodes[0]!){
    f.control.db.prepare("INSERT INTO owner_goal_steps VALUES(?,?,?,?,'RUNNING',0,?)").run(dispatchId,goal.id,1,dispatchId,Date.now());
    f.control.db.prepare("INSERT INTO owner_goal_dispatches VALUES(?,?,1,NULL,NULL,?,'RUNNING',NULL)").run(dispatchId,goal.id,f.a.world_id);
    f.control.db.prepare("INSERT INTO owner_task_occurrences VALUES(?,?,1,?,?,?,'RUNNING',1)").run('occ-'+dispatchId,goal.id,node.key,Date.now()+Number(f.control.db.prepare('SELECT COUNT(*) n FROM owner_task_occurrences').get()!.n),dispatchId);
    plans.progress.attach(goal.id,node,dispatchId,Date.now(),plan);
    f.control.db.prepare("UPDATE owner_goal_dispatches SET state='FINISHED' WHERE id=?").run(dispatchId);
  }
  attach('dispatch-one');return {...f,goal,plans,progress:plans.progress,attach};
}
describe('durable bounded progress',()=>{
  it('counts transport attempts once, shares limits across dispatches and restores them on restart',()=>{
    const f=fixture();f.progress.startWindow('dispatch-one');
    f.progress.beforeModel('dispatch-one','attempt-one','request-one',1);
    f.progress.beforeModel('dispatch-one','attempt-one','request-one',1);
    f.progress.beforeModel('dispatch-one','attempt-one','request-one',2);
    f.attach('dispatch-two');f.progress.beforeModel('dispatch-two','attempt-two','request-two',1);
    f.attach('dispatch-three');f.progress.beforeModel('dispatch-three','attempt-three','request-three',1);
    const restored=new CompanyProgressService(f.gate.goals);
    expect(restored.view(f.goal.id).scopes).toHaveLength(1);
    expect(restored.view(f.goal.id).scopes[0]!.modelCalls).toBe(4);
    expect(()=>restored.beforeModel('dispatch-three','attempt-four','request-four',1)).toThrow('OWNER_PROGRESS_GAP_LIMIT');
    expect(restored.view(f.goal.id).scopes[0]!.modelCalls).toBe(4);
    expect(restored.view(f.goal.id).gaps[0]!.attempts).toHaveLength(3);
  });
  it('retains the same missing fact across stages and atomically rejects an exhausted query',()=>{
    const f=fixture(),gap=f.progress.gap(f.goal.id,'same-device-log','The original device log','draft');
    f.progress.startWindow('dispatch-one');
    for(let n=0;n<3;n++)f.progress.beforeTool('dispatch-one','query-'+n,{gapId:gap.id,method:'Read a distinct permitted source '+n});
    f.progress.beforeTool('dispatch-one','query-0',{gapId:gap.id,method:'Read a distinct permitted source 0'});
    const inherited=f.progress.gap(f.goal.id,'same-device-log','The original device log','next-stage');
    expect(inherited.id).toBe(gap.id);expect(inherited.attempts).toHaveLength(3);
    expect(()=>f.progress.beforeTool('dispatch-one','query-4',{gapId:gap.id,method:'Another query after the limit'})).toThrow('OWNER_PROGRESS_GAP_LIMIT');
    expect(f.progress.view(f.goal.id).scopes[0]!.toolCalls).toBe(3);
    expect(f.progress.view(f.goal.id).gaps[0]!.nodeKeys).toContain('next-stage');
  });
  it('persists a deadline and lets only an explicit finite extension reopen the window',()=>{
    const f=fixture(),now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);
    const window=f.progress.startWindow('dispatch-one')!;
    vi.spyOn(Date,'now').mockReturnValue(window.deadlineAt+1);
    expect(()=>new CompanyProgressService(f.gate.goals).beforeModel('dispatch-one','attempt','expired-request',1)).toThrow('OWNER_PROGRESS_TIME_LIMIT');
    expect(f.progress.view(f.goal.id).scopes[0]!.modelCalls).toBe(0);
    f.progress.extend('dispatch-one',{minutes:1});
    f.progress.beforeModel('dispatch-one','attempt','new-request',1);
    expect(f.progress.view(f.goal.id).scopes[0]!.modelCalls).toBe(1);
  });
  it('verifies checklist contents from real artifacts and keeps missing items visible',()=>{
    const f=fixture(),node={...f.plans.get(f.goal.id)!.nodes[0]!,progressPolicy:{passPercent:80 as const,allowIncompleteFrom:[],requirements:['a','b','c','d','e'].map(id=>({id,description:'Retain '+id,contains:'fact-'+id}))}};
    f.progress.beforeModel('dispatch-one','attempt','first-request',1);
    const partial=f.progress.evaluate('dispatch-one',node,[{id:'actual-artifact',sha256:'a'.repeat(64),text:'fact-a fact-b fact-c fact-d'}],null);
    expect(partial.state).toBe('PARTIAL');expect(partial.checked).toHaveLength(4);expect(partial.missing).toHaveLength(1);
    expect(f.progress.view(f.goal.id).gaps.find(g=>g.id===partial.missing[0])!.status).toBe('OPEN');
  });
  it('stops a repeated method after two identical results but permits a different remaining method',()=>{
    const f=fixture(),gap=f.progress.gap(f.goal.id,'same-original-fact','Original fact','draft');
    for(let n=0;n<2;n++){f.progress.beforeTool('dispatch-one','same-'+n,{gapId:gap.id,method:'Read the same original source'},'same-query');f.progress.recordTool('dispatch-one','same-'+n,{status:'FAILED',error_code:'NO_MATCH'});}
    expect(()=>f.progress.beforeTool('dispatch-one','same-again',{gapId:gap.id,method:'Rewording the exact same query'},'same-query')).toThrow('OWNER_PROGRESS_METHOD_EXHAUSTED');
    f.progress.beforeTool('dispatch-one','different',{gapId:gap.id,method:'Read a distinct permitted source'},'different-query');
    expect(f.progress.view(f.goal.id).scopes[0]!.toolCalls).toBe(3);expect(f.progress.gaps(f.goal.id)[0]!.attempts).toHaveLength(3);
  });
});
