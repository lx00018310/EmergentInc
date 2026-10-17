import {afterEach,expect,it} from 'vitest';
import {goalFixture} from './fixtures/owner_goals.js';
import {OwnerOverviewService} from '../src/services/owner_overview_service.js';
import {createServer} from '../src/app.js';
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});

it('surfaces a failed standalone assignment and removes its historical alert after newer work completes',async()=>{
  const f=goalFixture();cleanups.push(f.close);const service=new OwnerOverviewService(f.worlds,f.work,undefined,'new-instance');
  f.control.db.prepare("INSERT INTO owner_work_tasks VALUES('failed','old',?,'Research','Check source','FAILED',NULL,NULL,NULL,'TOOL_FAILED',100,100)").run(f.a.qianji_id);
  expect((await service.bossOverview()).alerts).toEqual(expect.arrayContaining([expect.objectContaining({id:`world:${f.a.world_id}`,reasonKey:'TOOL_FAILED'})]));
  f.control.db.prepare("INSERT INTO owner_work_tasks VALUES('finished','new',?,'Research','Check source','REPLIED',NULL,NULL,'Verified result',NULL,200,200)").run(f.a.qianji_id);
  expect((await service.bossOverview()).alerts.some(a=>a.id===`world:${f.a.world_id}`)).toBe(false);
});

it('projects persisted facts without model calls, fake progress, or old business interfaces',async()=>{
  const f=goalFixture();cleanups.push(f.close);const goal=f.goal(),service=new OwnerOverviewService(f.worlds,f.work,undefined,'new-instance');
  const before=f.control.db.prepare('SELECT COUNT(*) n FROM control_events').get();
  const overview=await service.bossOverview();expect(overview).toMatchObject({instanceId:'new-instance',goals:[{id:goal.id}],paidOrderCount:0,revenue:[],events:[],paymentConfigured:false});
  expect(overview).not.toHaveProperty('people');expect(overview).not.toHaveProperty('pixels');expect(overview).not.toHaveProperty('taskPlans');
  expect(f.control.db.prepare('SELECT COUNT(*) n FROM control_events').get()).toEqual(before);expect(f.calls).toHaveLength(0);
  const app=await createServer({workspaceRoot:f.root,worlds:f.worlds});cleanups.push(()=>app.close());
  expect((await app.inject('/api/boss/overview')).statusCode).toBe(200);
  for(const url of ['/api/owner/overview','/api/owner/work','/api/gacha','/api/meetings','/api/qianji','/api/evolution/overview','/api/worlds'])expect((await app.inject(url)).statusCode,url).toBe(404);
});

it('does not label an active paid call as recovery failure; reports actual unknown outcomes',async()=>{
  const f=goalFixture();cleanups.push(f.close);let release!:(value:any)=>void;
  f.respond(()=>new Promise(resolve=>{release=resolve;}));f.on();await f.work.dispatch([{personId:f.a.qianji_id,instruction:'Report bounded evidence'}],'projection-call');
  const service=new OwnerOverviewService(f.worlds,f.work,undefined,'new-instance');
  expect((await service.bossOverview()).alerts.some(a=>a.id===`world:${f.a.world_id}`)).toBe(false);
  release({rawText:JSON.stringify({owner_reply:'A report is not independent success evidence.',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10}});await f.finish();
  f.control.db.prepare("INSERT INTO owner_model_permits VALUES('unknown-fixture','initial',?,NULL,NULL,'UNKNOWN',1000,NULL,NULL,?)").run(f.a.world_id,Date.now());
  const result=await service.bossOverview();expect(result.alerts).toEqual(expect.arrayContaining([expect.objectContaining({reasonKey:'OWNER_OUTCOME_REVIEW_REQUIRED'})]));expect(result.events).toEqual([]);
});
