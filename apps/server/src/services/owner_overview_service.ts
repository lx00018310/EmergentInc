import type { OwnerOverview, OwnerInboxItem, OwnerActivityItem, OwnerActionProposal } from '@emergentinc/protocol';
import type { WorldRouteServices } from '../routes/world_routes.js';
import type { BusinessService } from './business_service.js';
import type { OwnerWorkService } from './owner_work_service.js';

/** Owner projections use existing records; they never start, settle or recover a Run. Times are milliseconds. */
export class OwnerOverviewService {
  constructor(private worlds: WorldRouteServices, private business?: BusinessService, private upgradeOrigin?: string, private work?:OwnerWorkService) {}
  async overview(): Promise<OwnerOverview> {
    const { manager, payments } = this.worlds, { control, lineage } = manager.registry;
    const records = manager.list(), inbox: OwnerInboxItem[] = [], activity: OwnerActivityItem[] = [];
    const add = (id: string, type: string, summary: string, createdAt: number, source: string, href: string) =>
      activity.push({ id, type, summary: summary.slice(0, 400), createdAt, source, href });
    const people = records.map(row => {
      const runtime = manager.peek(row.world_id), profile = control.qianji.getProfile(row.qianji_id);
      const href = `/YUAN?world=${encodeURIComponent(row.world_id)}`, name = profile?.narrative.displayName ?? row.qianji_id;
      const run = runtime?.run.getStatus(), world = runtime?.world.getWorldDto();
      // A Run can stop with NO_ACTIVE_MESSAGES while its messages still wait for energy.
      const waiting=runtime?.store.db.prepare(`SELECT status,COUNT(*) count FROM messages
        WHERE status IN ('WAITING_PIXEL_BUDGET','WAITING_RUN_BUDGET','WAITING_EXECUTION_BUDGET','CALL_OUTCOME_UNKNOWN','AWAITING_SETTLEMENT') GROUP BY status
        UNION ALL SELECT 'ABANDONED',COUNT(*) FROM messages m JOIN world_chat_inbox i ON i.message_id=m.message_id
        WHERE m.status='ABANDONED' AND NOT EXISTS(SELECT 1 FROM world_outbox o WHERE o.turn_id=i.turn_id)
          AND NOT EXISTS(SELECT 1 FROM recovery_decisions d WHERE
            (d.kind='message' AND d.id=m.message_id) OR
            (d.kind='model' AND d.id IN(SELECT call_id FROM model_calls WHERE message_id=m.message_id)) OR
            (d.kind='tool' AND d.id IN(SELECT operation_id FROM tool_executions WHERE message_id=m.message_id))) HAVING COUNT(*)>0`).all() ?? [];
      if (row.blockedReason || row.runtimeFailure) inbox.push({ id: `world:${row.world_id}`, type: 'run', title: 'World needs attention',
        summary: `${name}: ${row.blockedReason ?? row.runtimeFailure}`, priority: 'critical', createdAt: row.created_at, source: 'control / runtime', href });
      if (run && !run.running && (run.unfinalized_operations?.hasUnfinalized || waiting.length))
        inbox.push({ id: `run:${row.world_id}:${run.run_id}`, type: 'run', title: 'Run needs attention', summary: `${name}: ${waiting.map(r=>`${r.status} (${r.count})`).join(', ') || run.result_status}`,
          priority: run.unfinalized_operations?.hasUnfinalized ? 'critical' : 'normal', createdAt: runtime!.store.runs.getLatestRun()?.created_at ? Number(runtime!.store.runs.getLatestRun()!.created_at) * 1000 : null, source: 'runs / operations', href });
      if (runtime) {
        for (const r of runtime.store.db.prepare('SELECT run_id,status,stop_reason,created_at,finished_at FROM runs ORDER BY created_at DESC LIMIT 10').all())
          add(`run:${row.world_id}:${r.run_id}`, 'Run', `${name}: ${r.stop_reason ?? r.status}`, Number(r.finished_at ?? r.created_at) * 1000, 'runs', href);
        for (const r of runtime.store.db.prepare('SELECT turn_id,reply,created_at FROM world_outbox ORDER BY created_at DESC LIMIT 10').all())
          add(`reply:${r.turn_id}`, 'Qianji reply', `${name}: ${r.reply}`, Number(r.created_at), 'world_outbox', `/QIAN?qianji=${encodeURIComponent(row.qianji_id)}`);
        for (const p of world!.pixels as any[]) if (p.tips_md?.trim())
          add(`tips:${row.world_id}:${p.id}:${p.tips_version}`, 'Tips', `${name} / ${p.id}: ${p.tips_md}`, Number(p.tips_version), 'tips.md', href);
        for (const r of runtime.life.current.db.prepare('SELECT sequence,kind,created_at FROM current_events ORDER BY created_at DESC LIMIT 10').all())
          add(`current:${row.world_id}:${r.sequence}`, String(r.kind), name, Number(r.created_at), 'current_events', href);
      }
      return { id: row.qianji_id, name, worldId: row.world_id, status: row.status, running: row.running,
        role:profile?.narrative.roleLabel,behaviorProfile:profile?.narrative.behaviorProfile,infiniteEnergy:control.gatewayInfiniteEnergy(row.world_id),gatewayPixelId:row.gateway_pixel_id,
        runStatus: row.blockedReason ?? row.runtimeFailure ?? run?.result_status ?? 'NOT_OPEN', round: world?.round,
        energy: world?.metrics.total_energy, pixels: world?.pixels.slice(0, 30).map((p:any)=>({id:p.id,active:p.active,energy:p.energy,mind:String(p.pixel_md??'').slice(0,1000),tips:String(p.tips_md??'').slice(0,400)})) };
    });
    for (const r of control.db.prepare('SELECT id,kind,world_id,created_at FROM control_events ORDER BY created_at DESC LIMIT 50').all())
      add(`control:${r.id}`, String(r.kind), String(r.world_id ?? ''), Number(r.created_at), 'control_events', `/YUAN?world=${encodeURIComponent(String(r.world_id ?? ''))}`);
    for (const r of control.db.prepare('SELECT event_id,event_type,subject_id,created_at FROM world_events ORDER BY created_at DESC LIMIT 20').all())
      add(`event:${r.event_id}`, String(r.event_type), String(r.subject_id), Number(r.created_at)*1000, 'world_events', '/QIAN');
    for (const r of lineage.db.prepare('SELECT sequence,kind,generation_id,created_at FROM life_events ORDER BY created_at DESC LIMIT 30').all())
      add(`life:${r.sequence}`, String(r.kind), String(r.generation_id), Number(r.created_at), 'life_events', '/GENE');
    for (const r of payments.db.prepare('SELECT receipt_id,world_id,asset,amount_atomic,decimals,created_at FROM world_revenue_events ORDER BY created_at DESC LIMIT 20').all())
      add(`payment:${r.receipt_id}`, 'Payment received', `${r.asset}: ${Number(r.amount_atomic)/10**Number(r.decimals)}`, Number(r.created_at), 'world_revenue_events', r.world_id===null?'/GENE?view=public-site':`/YUAN?world=${encodeURIComponent(String(r.world_id))}`);
    const generation = manager.registry.effectiveGeneration().id;
    const work=this.work?.view();
    if(work){
      for(const r of work.requests.filter(r=>r.state==='PENDING'))inbox.push({id:`recruit:${r.id}`,type:'recruit',title:'Recruitment approval',summary:`${r.requester}: ${r.role} — ${r.reason}`,priority:'normal',createdAt:r.createdAt,source:'owner_recruit_requests',href:'/OWNER',actions:['recruit_approve','recruit_reject'].map(type=>({id:`${type}:${r.id}`,requiresApproval:true,action:{type:type as 'recruit_approve'|'recruit_reject',requestId:r.id,hash:r.hash,role:r.role,reason:r.reason,instruction:r.instruction}}))});
      for(const r of work.codeReports.filter(r=>r.baseGeneration===generation))inbox.push({id:`code:${r.id}`,type:'code',title:'Source change report',summary:`${r.personName}: ${r.title} — ${r.summary}`,priority:'normal',createdAt:r.createdAt,source:'owner_code_reports',href:`/OWNER?report=${r.id}`});
      for(const task of work.tasks){add(`task:${task.id}`,'Assigned task',`${task.personName}: ${task.state} — ${task.instruction}`,task.updatedAt,'owner_work_tasks','/OWNER');if(task.state==='BLOCKED'||task.state==='NO_REPLY')inbox.push({id:`task:${task.id}`,type:'run',title:'Assigned task needs attention',summary:`${task.personName}: ${task.reason}`,priority:'normal',createdAt:task.updatedAt,source:'owner_work_tasks',href:`/QIAN?qianji=${encodeURIComponent(task.personId)}`});}
    }
    for (const p of lineage.proposals().filter(p=>p.state==='PROPOSED' && p.generation_id===generation)) inbox.push({ id:`gene:${p.id}`,type:'gene',title:'Gene proposal',summary:String(p.point),priority:'normal',createdAt:Number(p.created_at),source:'gene_proposals',href:'/GENE' });
    if (this.business) {
      const data=this.business.store.overview();
      for (const p of data.plans.filter(p=>p.state==='AWAITING_APPROVAL')) {
        const actions:OwnerActionProposal[]=['business_plan_approve','business_plan_reject'].map(type=>({id:`${type}:${p.id}:${p.revision}:${p.hash}`,requiresApproval:true,action:{type:type as 'business_plan_approve'|'business_plan_reject',plan:p}}));
        inbox.push({id:`plan:${p.id}`,type:'plan',title:'Business plan approval',summary:p.plan.title,priority:'normal',createdAt:Number(this.business.store.db.prepare('SELECT created_at FROM business_plans WHERE id=?').get(p.id)!.created_at),source:'business_plans',href:`/GENE?view=plans&id=${encodeURIComponent(p.id)}`,actions});
      }
      for (const r of data.requests) {
        const plan=data.plans.find(p=>p.id===r.plan_id);
        const actions:OwnerActionProposal[] = String(r.resource).startsWith('task:') ? [] : ['resource_provided','resource_reject'].map(type=>({id:`${type}:${r.id}`,requiresApproval:true,action:{type:type as 'resource_provided'|'resource_reject',requestId:String(r.id),planId:String(r.plan_id),revision:Number(r.revision),resource:String(r.resource),note:'Owner Mission Control'}}));
        inbox.push({id:`resource:${r.id}`,type:'resource',title:'Resource needed',summary:`${plan?.plan.title ?? r.plan_id}: ${r.resource}`,priority:'normal',createdAt:Number(this.business.store.db.prepare('SELECT created_at FROM business_plan_revisions WHERE plan_id=? AND revision=?').get(r.plan_id,r.revision)?.created_at ?? 0),source:'business_requests',href:`/GENE?view=resources&id=${encodeURIComponent(String(r.id))}`,actions});
      }
      for (const r of [...data.unknownOperations,...data.tasks.filter(r=>r.state==='OUTCOME_UNKNOWN')])
        inbox.push({id:`external:${r.id}`,type:'external',title:'External outcome unknown',summary:`${r.plan_id}: ${r.id}`,priority:'critical',createdAt:r.created_at==null?null:Number(r.created_at),source:'business_operations / business_tasks',href:'/GENE?view=business'});
      for (const r of data.events) add(`business:${r.id}`,String(r.kind),String(r.plan_id??''),Number(r.created_at),'business_events',`/GENE?view=plans&id=${encodeURIComponent(String(r.plan_id??''))}`);
    }
    const availability:OwnerOverview['availability']={business:Boolean(this.business),upgrade:this.upgradeOrigin?'unavailable':'not_configured'};
    let upgrade:OwnerOverview['upgrade'];
    if (this.upgradeOrigin) try {
      const response=await fetch(this.upgradeOrigin+'/status',{redirect:'error',signal:AbortSignal.timeout(1500)});
      if (!response.ok) throw new Error('UPGRADE_UNAVAILABLE');
      const data=await response.json() as {service:string;active:string|null;busy:boolean;startedAt:number;candidates:{id:string;state:string;createdAt:number;sourceCommit:string|null;hash:string|null;baseGeneration:string|null}[]};
      if(data.service!=='owner-upgrade'||typeof data.busy!=='boolean'||!Array.isArray(data.candidates))throw new Error('UPGRADE_STATUS_INVALID');
      availability.upgrade='available';upgrade={active:data.active,busy:data.busy};
      for(const c of data.candidates.filter(c=>['VALIDATED','APPROVED'].includes(c.state)&&c.baseGeneration===data.active)) inbox.push({id:`upgrade:${c.id}`,type:'upgrade',title:'Upgrade candidate ready',summary:`${c.id} · ${c.sourceCommit ?? ''} · ${c.hash ?? ''}`,priority:'normal',createdAt:c.createdAt,source:'Upgrade Service',href:this.upgradeOrigin});
      if(data.busy)add('upgrade:busy','Upgrade in progress','',data.startedAt,'Upgrade Service',this.upgradeOrigin);
    } catch { /* A disconnected independent service is explicitly reported, never projected as idle. */ }
    inbox.sort((a,b)=>Number(b.priority==='critical')-Number(a.priority==='critical')||(b.createdAt??0)-(a.createdAt??0)||a.id.localeCompare(b.id));
    activity.sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id));
    return {asOf:Date.now(),summary:{qianjiCount:people.length,activeWorlds:records.filter(r=>r.status==='ACTIVE').length,runningWorlds:records.filter(r=>r.running).length,inboxCount:inbox.length,currentGeneration:generation},inbox,activity:activity.slice(0,50),people,availability,...(upgrade?{upgrade}:{}),...(work?{work}:{})};
  }
}
