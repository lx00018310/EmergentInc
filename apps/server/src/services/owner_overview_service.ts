import type { OwnerOverview, OwnerInboxItem, OwnerActivityItem, OwnerActionProposal, OwnerAlert } from '@emergentinc/protocol';
import type { WorldRouteServices } from '../routes/world_routes.js';
import type { BusinessService } from './business_service.js';
import type { OwnerWorkService } from './owner_work_service.js';

/** Owner projections use existing records; they never start, settle or recover a Run. Times are milliseconds. */
export class OwnerOverviewService {
  constructor(private worlds: WorldRouteServices, private business?: BusinessService, private upgradeOrigin?: string, private work?:OwnerWorkService,
    private serviceStatus?: () => NonNullable<OwnerOverview['summary']['serviceStatus']>) {}
  async overview(): Promise<OwnerOverview> {
    const { manager, payments } = this.worlds, { control, lineage } = manager.registry;
    const records = manager.list(), inbox: OwnerInboxItem[] = [], alerts: OwnerAlert[] = [], activity: OwnerActivityItem[] = [];
    let pixelCount = 0, availableEnergy = 0, metricsComplete = true;
    const add = (id: string, type: string, summary: string, createdAt: number, source: string, href: string) =>
      activity.push({ id, type, summary: summary.slice(0, 400), createdAt, source, href });
    const alert = (id: string, kind: string, severity: OwnerAlert['severity'], title: string, summary: string, createdAt: number | null, source: string, href: string) =>
      alerts.push({ id, kind, severity, title, summary: summary.slice(0, 400), createdAt, source, href });
    const people = records.map(row => {
      const runtime = manager.peek(row.world_id), profile = control.qianji.getProfile(row.qianji_id);
      const href = `/YUAN?world=${encodeURIComponent(row.world_id)}`, name = profile?.narrative.displayName ?? row.qianji_id;
      const run = runtime?.run.getStatus(), world = runtime?.world.getWorldDto();
      if (row.status === 'ACTIVE') {
        if (!runtime || !world) metricsComplete = false;
        else {
          pixelCount += world.metrics.total_pixels;
          // Reservations remain in the balance until settlement; only unblocked active accounts are spendable.
          const energy = runtime.store.db.prepare(`SELECT COALESCE(SUM(MAX(0,p.energy-COALESCE(r.reserved,0))),0) AS available
            FROM pixel_accounts p LEFT JOIN (SELECT pixel_id,SUM(amount) AS reserved FROM reservations WHERE status='OPEN' GROUP BY pixel_id) r ON r.pixel_id=p.pixel_id
            WHERE p.active=1 AND p.refund_deficit_tokens=0 AND p.spend_blocked_reason IS NULL`).get()!;
          availableEnergy += Number(energy.available);
        }
      }
      // A Run can stop with NO_ACTIVE_MESSAGES while its messages still wait for energy.
      const waiting=runtime?.store.db.prepare(`SELECT status,COUNT(*) count FROM messages
        WHERE status IN ('WAITING_PIXEL_BUDGET','WAITING_RUN_BUDGET','WAITING_EXECUTION_BUDGET','CALL_OUTCOME_UNKNOWN','AWAITING_SETTLEMENT') GROUP BY status
        UNION ALL SELECT 'ABANDONED',COUNT(*) FROM messages m JOIN world_chat_inbox i ON i.message_id=m.message_id
        WHERE m.status='ABANDONED' AND NOT EXISTS(SELECT 1 FROM world_outbox o WHERE o.turn_id=i.turn_id)
          AND NOT EXISTS(SELECT 1 FROM recovery_decisions d WHERE
            (d.kind='message' AND d.id=m.message_id) OR
            (d.kind='model' AND d.id IN(SELECT call_id FROM model_calls WHERE message_id=m.message_id)) OR
            (d.kind='tool' AND d.id IN(SELECT operation_id FROM tool_executions WHERE message_id=m.message_id))) HAVING COUNT(*)>0`).all() ?? [];
      // Runs and blocked Worlds need human recovery decisions, never a one-click approve/reject pair.
      if (row.blockedReason || row.runtimeFailure) alert(`world:${row.world_id}`,'run','critical','World needs attention',`${name}: ${row.blockedReason ?? row.runtimeFailure}`,row.created_at,'control / runtime',href);
      if (run && !run.running && (run.unfinalized_operations?.hasUnfinalized || waiting.length))
        alert(`run:${row.world_id}:${run.run_id}`,'run',run.unfinalized_operations?.hasUnfinalized?'critical':'normal','Run needs attention',`${name}: ${waiting.map(r=>`${r.status} (${r.count})`).join(', ') || run.result_status}`,runtime!.store.runs.getLatestRun()?.created_at ? Number(runtime!.store.runs.getLatestRun()!.created_at) * 1000 : null,'runs / operations',href);
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
      for(const r of work.requests.filter(r=>r.state==='PENDING'))inbox.push({id:`recruit:${r.id}`,type:'recruit',title:'Recruitment approval',summary:`${r.requester}: ${r.role} — ${r.reason}`,priority:'normal',createdAt:r.createdAt,source:'owner_recruit_requests',href:'/OWNER',
        approveEffect:'Creates one person with this role and dispatches the initial task; model calls consume tokens; publication needs separate approval.',rejectEffect:'Stops this recruitment request; no person is created.',
        actions:['recruit_approve','recruit_reject'].map(type=>({id:`${type}:${r.id}`,requiresApproval:true,action:{type:type as 'recruit_approve'|'recruit_reject',requestId:r.id,hash:r.hash,role:r.role,reason:r.reason,instruction:r.instruction}}))});
      for(const r of work.codeReports.filter(r=>r.baseGeneration===generation))inbox.push({id:`code:${r.id}`,type:'code',title:'Source change report',summary:`${r.personName}: ${r.title} — ${r.summary}`,priority:'normal',createdAt:r.createdAt,source:'owner_code_reports',href:`/OWNER?report=${r.id}`});
      for(const task of work.tasks){add(`task:${task.id}`,'Assigned task',`${task.personName}: ${task.state} — ${task.instruction}`,task.updatedAt,'owner_work_tasks','/OWNER');if(task.state==='BLOCKED'||task.state==='NO_REPLY')alert(`task:${task.id}`,'task','normal','Assigned task needs attention',`${task.personName}: ${task.reason}`,task.updatedAt,'owner_work_tasks',`/QIAN?qianji=${encodeURIComponent(task.personId)}`);}
    }
    // Current-generation Gene proposals carry a symmetric direction decision: approving only sets
    // the direction; candidate freezing and the exact-hash publication remain separate approvals.
    for (const p of lineage.proposals().filter(p=>p.state==='PROPOSED' && p.generation_id===generation)) {
      const proposalId=String(p.id);
      inbox.push({ id:`gene:${proposalId}`,type:'gene',title:'Gene proposal',summary:String(p.point),priority:'normal',createdAt:Number(p.created_at),source:'gene_proposals',href:`/GENE?view=life&id=${encodeURIComponent(proposalId)}`,
        approveEffect:'Approves this direction only. Candidate freezing, privacy review and the exact-hash publication still require separate approvals before any new generation is born.',rejectEffect:'Rejects this direction; it stops advancing in the current generation.',
        actions:['gene_proposal_approve','gene_proposal_reject'].map(type=>({id:`${type}:${proposalId}:${generation}`,requiresApproval:true,action:{type:type as 'gene_proposal_approve'|'gene_proposal_reject',proposalId,expectedGeneration:generation,expectedState:'PROPOSED' as const}})) });
    }
    if (this.business) {
      const data=this.business.store.overview();
      for (const p of data.plans.filter(p=>p.state==='AWAITING_APPROVAL')) {
        const actions:OwnerActionProposal[]=['business_plan_approve','business_plan_reject'].map(type=>({id:`${type}:${p.id}:${p.revision}:${p.hash}`,requiresApproval:true,action:{type:type as 'business_plan_approve'|'business_plan_reject',plan:p}}));
        inbox.push({id:`plan:${p.id}`,type:'plan',title:'Business plan approval',summary:p.plan.title,priority:'normal',createdAt:Number(this.business.store.db.prepare('SELECT created_at FROM business_plans WHERE id=?').get(p.id)!.created_at),source:'business_plans',href:`/GENE?view=plans&id=${encodeURIComponent(p.id)}`,actions,
          approveEffect:`Authorizes revision R${p.revision} exactly as displayed: budget ¥${(p.plan.budgetMicros/1e6).toFixed(4)}, its tasks and permitted external writes. Execution follows afterwards; approving is not completing the plan.`,rejectEffect:`Stops this pending revision R${p.revision}; its tasks will not be authorized.`});
      }
      for (const r of data.requests) {
        const plan=data.plans.find(p=>p.id===r.plan_id);
        const effects = {approveEffect:`Confirms that ${r.resource} already exists and is usable, so the waiting tasks may continue.`,rejectEffect:`Rejects this resource request and stops the whole associated plan ${plan?.plan.title ?? r.plan_id}, not just this item.`};
        // task: recovery and unverifiable resources keep human verification; they never become one-click decisions.
        if(String(r.resource).startsWith('task:'))alert(`resource:${r.id}`,'task','normal','Task recovery needs verification',`${plan?.plan.title ?? r.plan_id}: ${r.resource}`,Number(this.business.store.db.prepare('SELECT created_at FROM business_plan_revisions WHERE plan_id=? AND revision=?').get(r.plan_id,r.revision)?.created_at ?? 0),'business_requests',`/GENE?view=resources&id=${encodeURIComponent(String(r.id))}`);
        else inbox.push({id:`resource:${r.id}`,type:'resource',title:'Resource needed',summary:`${plan?.plan.title ?? r.plan_id}: ${r.resource}`,priority:'normal',createdAt:Number(this.business.store.db.prepare('SELECT created_at FROM business_plan_revisions WHERE plan_id=? AND revision=?').get(r.plan_id,r.revision)?.created_at ?? 0),source:'business_requests',href:`/GENE?view=resources&id=${encodeURIComponent(String(r.id))}`,
          actions:['resource_provided','resource_reject'].map(type=>({id:`${type}:${r.id}`,requiresApproval:true,action:{type:type as 'resource_provided'|'resource_reject',requestId:String(r.id),planId:String(r.plan_id),revision:Number(r.revision),resource:String(r.resource),note:'Owner Mission Control'}})),
          ...effects});
      }
      for (const r of [...data.unknownOperations,...data.tasks.filter(r=>r.state==='OUTCOME_UNKNOWN')])
        alert(`external:${r.id}`,'external','critical','External outcome unknown',`${r.plan_id}: ${r.id}`,r.created_at==null?null:Number(r.created_at),'business_operations / business_tasks','/GENE?view=business');
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
      // Software publication stays inside the independent 8766 service with its exact-hash approval chain.
      for(const c of data.candidates.filter(c=>['VALIDATED','APPROVED'].includes(c.state)&&c.baseGeneration===data.active)) alert(`upgrade:${c.id}`,'upgrade','normal','Upgrade candidate ready',`${c.id} · ${c.sourceCommit ?? ''} · ${c.hash ?? ''}`,c.createdAt,'Upgrade Service',this.upgradeOrigin);
      if(data.busy)add('upgrade:busy','Upgrade in progress','',data.startedAt,'Upgrade Service',this.upgradeOrigin);
    } catch { /* A disconnected independent service is explicitly reported, never projected as idle. */ }
    inbox.sort((a,b)=>Number(b.priority==='critical')-Number(a.priority==='critical')||(b.createdAt??0)-(a.createdAt??0)||a.id.localeCompare(b.id));
    activity.sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id));
    return {asOf:Date.now(),summary:{qianjiCount:people.length,activeWorlds:records.filter(r=>r.status==='ACTIVE').length,runningWorlds:records.filter(r=>r.running).length,inboxCount:inbox.length,currentGeneration:generation,
      pixelCount:metricsComplete?pixelCount:null,availableEnergy:metricsComplete?availableEnergy:null,
      pendingApprovals:inbox.filter(item=>item.actions?.some(action=>action.requiresApproval)).length,...(this.serviceStatus?{serviceStatus:this.serviceStatus()}:{} )},inbox,activity:activity.slice(0,50),people,alerts:alerts.slice(0,20),availability,...(upgrade?{upgrade}:{}),...(work?{work}:{})};
  }
}
