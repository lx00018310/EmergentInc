import {afterEach,expect,it} from 'vitest';
import fastify from 'fastify';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {LocalWorldRuntime} from '../../../supervisor/local_world_runtime.js';
import {goalFixture} from './fixtures/owner_goals.js';
import {reserveTestHttpPort} from '../../../tests/http_port.js';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});

it.each(['unfunded','manual-pause','unknown-call'])('ends maintenance independently of persisted company state: %s',async state=>{
  const f=goalFixture();cleanups.push(f.close);
  if(state==='manual-pause'){f.on();f.off();}
  if(state==='unknown-call'){
    f.control.db.prepare("INSERT INTO owner_model_permits(id,batch_id,state,reserved_tokens,created_at) VALUES('unknown','initial','UNKNOWN',100,?)").run(Date.now());
    f.gate.halt('OWNER_OUTCOME_REVIEW_REQUIRED');
  }
  f.maintenance(true);
  const before={control:f.control.db.prepare('SELECT * FROM owner_automation_control').get(),budget:f.gate.budget.view(),calls:f.gate.modelCalls()};
  const app=fastify(),requests:string[]=[];cleanups.push(()=>app.close());
  app.post('/api/login',(_req,reply)=>{requests.push('login');return reply.header('Set-Cookie','owner=fixture').send({});});
  app.get('/api/owner/automation',()=>{requests.push('automation');return f.gate.view();});
  app.post('/api/maintenance/quiesce',()=>{requests.push('quiesce');f.maintenance(true);return {quiesced:true};});
  app.post('/api/maintenance/resume',()=>{requests.push('resume');f.maintenance(false);return {quiesced:false};});
  const appUrl=await app.listen({host:'127.0.0.1',port:await reserveTestHttpPort()}),owner=join(f.root,'owner');fs.mkdirSync(owner);
  fs.writeFileSync(join(owner,'resume-intent.json'),JSON.stringify({paused:true}));
  const runtime=new LocalWorldRuntime({workspace:join(f.root,'workspace'),releases:join(f.root,'releases'),stateDirectory:owner,activeReleaseFile:join(owner,'active.json'),appUrl,ownerEnvironment:{EMERGENTINC_OWNER_SECRET:'isolated-owner-secret-'.repeat(3),EMERGENTINC_START_PAUSED:'1'}});
  await runtime.quiesce();await runtime.resume();await runtime.resume();
  expect(requests).toEqual(['login','quiesce','resume','resume']);
  expect(f.gate.view()).toMatchObject({desiredMode:'OFF',reason:state==='unknown-call'?'OWNER_OUTCOME_REVIEW_REQUIRED':null});
  expect({control:f.control.db.prepare('SELECT * FROM owner_automation_control').get(),budget:f.gate.budget.view(),calls:f.gate.modelCalls()}).toEqual(before);
  expect(f.calls).toHaveLength(0);expect(f.gate.isOn()).toBe(false);
});

it('reports a failed maintenance exit rather than treating it as completed',async()=>{
  const f=goalFixture();cleanups.push(f.close);const app=fastify();cleanups.push(()=>app.close());
  app.post('/api/login',(_req,reply)=>reply.header('Set-Cookie','owner=fixture').send({}));
  app.post('/api/maintenance/resume',(_req,reply)=>reply.status(503).send({}));
  const appUrl=await app.listen({host:'127.0.0.1',port:await reserveTestHttpPort()});
  const runtime=new LocalWorldRuntime({workspace:join(f.root,'workspace'),releases:join(f.root,'releases'),stateDirectory:join(f.root,'owner'),activeReleaseFile:join(f.root,'active.json'),appUrl,ownerEnvironment:{EMERGENTINC_OWNER_SECRET:'isolated-owner-secret-'.repeat(3),EMERGENTINC_START_PAUSED:'1'}});
  await expect(runtime.resume()).rejects.toThrow('EVOLUTION_OWNER_ACTION_FAILED: resume');
  expect(f.calls).toHaveLength(0);
});
