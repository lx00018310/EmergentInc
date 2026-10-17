import type { BossOverview, OwnerOverview, OwnerInboxItem, OwnerAlert, OwnerActivityItem } from '@emergentinc/protocol';
import type { WorldRouteServices } from '../routes/world_routes.js';
import type { OwnerWorkService } from './owner_work_service.js';
import type { PublicStore } from './public_store.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const decimal = (atomic: unknown, places: unknown) => { const n = Number(places), digits = String(atomic).padStart(n + 1, '0'); return n ? digits.slice(0, -n) + '.' + digits.slice(-n) : digits; };
/** Read-only projections from the single Goal/Task ledger and verified payment facts. */
export class OwnerOverviewService {
  constructor(private worlds: WorldRouteServices, private work?: OwnerWorkService, private publicStore?: PublicStore, private instanceId?: string) {}
  async overview(): Promise<OwnerOverview> {
    const { manager, payments } = this.worlds, control = manager.registry.control, gate = manager.automation;
    const inbox: OwnerInboxItem[] = [], alerts: OwnerAlert[] = [], activity: OwnerActivityItem[] = [];
    const work = this.work?.view(), goals = gate?.goals.list(), automation = gate?.view();
    const people = this.work?.agents ? this.work.agents.list().map(person=>{
      const scope=this.work!.agents!.scopeId(person.id),task=work?.tasks.find(t=>t.personId===person.id),attempt=task?.attempt;
      const running=Boolean(attempt&&this.work!.worker!.isRunning(attempt.id));
      const reviewed=attempt&&control.db.prepare("SELECT 1 FROM company_execution_reviews WHERE attempt_id=? AND decision='ABANDONED'").get(attempt.id);
      const terminalGoal=task?.goalId&&(!goals?.some(g=>g.id===task.goalId)||goals.some(g=>g.id===task.goalId&&['STOPPED','ARCHIVED','COMPLETED'].includes(g.status)));
      const pendingOutcome=task?.reason==='CALL_OUTCOME_UNKNOWN'?Boolean(task.goalId&&gate?.goals.hasPendingOutcome(task.goalId)):task?.reason==='TOOL_OUTCOME_UNKNOWN'&&!reviewed;
      const dismissed=terminalGoal&&!pendingOutcome||reviewed&&!task?.goalId;
      if(task&&!dismissed&&['FAILED','BLOCKED','NO_REPLY'].includes(task.state)&&attempt?.state!=='SUSPENDED')alerts.push({id:task.goalId?`goal:${task.goalId}`:`assignment:${task.id}`,kind:'task',severity:'critical',title:'Task needs attention',summary:task.goalId?goals?.find(g=>g.id===task.goalId)?.title??'':task.instruction,reasonKey:task.reason??'OWNER_WORKER_FAILED',goalId:task.goalId??undefined,taskId:task.id,runId:task.runId??undefined,attemptId:attempt?.id,worldId:scope,createdAt:task.updatedAt,source:'company execution',href:'/BOSS'});
      return {id:person.id,name:person.name,role:person.role,behaviorProfile:person.behaviorProfile,worldId:scope,status:person.status,running,runStatus:attempt?.state??'IDLE'};
    }) : manager.list().map(row => {
      const profile = control.qianji.getProfile(row.qianji_id), run = manager.peek(row.world_id)?.run.getStatus();
      const task=control.db.prepare(`SELECT t.id,t.run_id,t.reason,t.updated_at,d.goal_id FROM owner_work_tasks t LEFT JOIN owner_goal_dispatches d ON d.task_id=t.id WHERE t.person_id=? AND (? IS NULL OR t.run_id=?) ORDER BY t.created_at DESC LIMIT 1`).get(row.qianji_id,run?.run_id??null,run?.run_id??null);
      if (row.blockedReason || row.runtimeFailure || run && !run.running && run.unfinalized_operations?.hasUnfinalized) alerts.push({ id: task?.goal_id?`goal:${task.goal_id}`:`world:${row.world_id}`, kind: 'run', severity: 'critical', title: 'Worker recovery needs verification', summary: task?.goal_id?goals?.find(g=>g.id===task.goal_id)?.title??'':String(row.blockedReason ?? row.runtimeFailure ?? ''), reasonKey:task?.reason?String(task.reason):String(row.blockedReason??run?.stop_reason??'OWNER_OUTCOME_REVIEW_REQUIRED'), goalId:task?.goal_id?String(task.goal_id):undefined,taskId:task?String(task.id):undefined,runId:task?.run_id?String(task.run_id):undefined,attemptId:task?.run_id?this.work?.execution.forRun(String(task.run_id))?.id:undefined,worldId:row.world_id,createdAt: task?Number(task.updated_at):row.created_at, source: 'company execution / adapter recovery', href: '/BOSS' });
      return { id: row.qianji_id, name: profile?.narrative.displayName ?? row.qianji_id, role: profile?.narrative.roleLabel, worldId: row.world_id, status: row.status, running: Boolean(run?.running), runStatus: String(run?.result_status ?? 'IDLE') };
    });
    for (const r of work?.requests.filter(r => r.state === 'PENDING') ?? []) inbox.push({ id: `recruit:${r.id}`, type: 'recruit', title: 'Worker approval', summary: `${r.role}: ${r.reason}`, priority: 'normal', createdAt: r.createdAt, source: 'owner_recruit_requests', href: '/BOSS', approveEffect: 'Creates one worker for the approved role. Execution uses the company budget and existing goal authorization.', rejectEffect: 'Creates no worker. The resource request remains blocked.',
      actions: (['recruit_approve', 'recruit_reject'] as const).map(type => ({ id: `${type}:${r.id}`, requiresApproval: true, action: { type, requestId: r.id, hash: r.hash, role: r.role, reason: r.reason, instruction: r.instruction } })) });
    for(const task of work?.tasks.filter((t,index,tasks)=>!t.goalId&&['FAILED','NO_REPLY','BLOCKED'].includes(t.state)&&!tasks.slice(0,index).some(newer=>newer.personId===t.personId))??[]){
      if(this.work?.agents)continue;
      const world=control.worldForQianji(task.personId);
      alerts.push({id:world?`world:${world.world_id}`:`assignment:${task.id}`,kind:'task',severity:'critical',title:'Task needs attention',summary:task.instruction,reasonKey:task.reason??'OWNER_OUTCOME_REVIEW_REQUIRED',createdAt:task.createdAt,source:'owner_work_tasks',href:'/BOSS'});
    }
    if (automation && (['BLOCKED', 'ERROR'].includes(automation.observedState)||gate?.admission.reason()) && automation.reason !== 'EVOLUTION_QUIESCED') alerts.push({ id: 'automation:review', kind: 'automation', severity: 'critical', title: 'Company automation needs review', summary: '', reasonKey: automation.reason ?? 'OWNER_OUTCOME_REVIEW_REQUIRED', createdAt: automation.updatedAt, source: 'company_admission_blocks', href: '/BOSS' });
    for (const goal of goals ?? []) {
      const blockedNode=gate?.proposals.plans.get(goal.id)?.nodes.some(n=>n.state==='BLOCKED')&&!['PAUSED','STOPPED','ARCHIVED','COMPLETED'].includes(goal.status);
      if ((['BLOCKED', 'FAILED'].includes(goal.status)||blockedNode) && goal.reason !== 'OWNER_WAITING_PAYMENT'&&!alerts.some(a=>a.goalId===goal.id)) alerts.push({ id: `goal:${goal.id}`, goalId:goal.id,kind: 'goal', severity: 'critical', title: 'Goal needs attention', summary: goal.title, reasonKey: goal.reason ?? work?.tasks.find(t=>t.goalId===goal.id&&t.reason)?.reason??'OWNER_NO_PROGRESS', createdAt: goal.updatedAt, source: 'owner_goals', href: '/BOSS' });
      if (goal.status === 'COMPLETED' && goal.evidenceCount > 0) activity.push({ id: `goal:${goal.id}:${goal.specificationRevision}`, type: 'goal', summary: goal.title, createdAt: goal.updatedAt, source: 'owner_goals', href: `goal:${goal.id}` });
    }
    if (this.work?.products) for (const row of control.db.prepare("SELECT * FROM owner_product_intents WHERE state IN ('BLOCKED','OUTCOME_UNKNOWN')").all()) {
      const goal=gate!.goals.get(String(row.goal_id));if(row.state==='BLOCKED'&&['STOPPED','ARCHIVED','COMPLETED'].includes(goal.status))continue;
      alerts.push({ id: `product-intent:${row.goal_id}`,goalId:goal.id, kind: 'product', severity: row.state === 'OUTCOME_UNKNOWN' ? 'critical' : 'normal', title: 'Product publication needs attention', summary: goal.title, reasonKey: String(row.reason ?? 'OWNER_OUTCOME_REVIEW_REQUIRED'), createdAt: Number(row.updated_at), source: 'owner_product_intents', href: '/BOSS' });
    }
    const storefront = this.publicStore ? { products: this.publicStore.products().items.map(p => ({ id: String(p.product_id), nameEn: String(p.product_name_en), nameZh: String(p.product_name_zh), enabled: Boolean(p.product_enabled), price: p.product_price as string | null, currency: String(p.product_currency) })), orders: control.db.prepare('SELECT order_id,product_name_snapshot,amount,currency,status,created_at FROM orders ORDER BY created_at DESC LIMIT 200').all().map(o => ({ id: String(o.order_id), product: String(o.product_name_snapshot), amount: String(o.amount), currency: String(o.currency), status: String(o.status), at: Number(o.created_at) })) } : undefined;
    for (const row of control.db.prepare("SELECT id,payload,created_at FROM control_events WHERE kind='owner_product_configured' ORDER BY id").all()) {
      const event = JSON.parse(String(row.payload)); if (event.enabled && storefront?.products.some(p => p.id === event.productId && p.enabled)) activity.push({ id: `product:${row.id}`, type: 'product', summary: event.nameEn, createdAt: Number(row.created_at), source: 'control_events', href: `product:${event.productId}` });
    }
    const receipts = payments.db.prepare('SELECT receipt_id,asset,amount_atomic,decimals,created_at FROM world_revenue_events ORDER BY created_at').all();
    for (const receipt of receipts) activity.push({ id: `payment:${receipt.receipt_id}`, type: 'payment', summary: `${decimal(receipt.amount_atomic, receipt.decimals)} ${receipt.asset}`, createdAt: Number(receipt.created_at), source: 'world_revenue_events', href: `receipt:${receipt.receipt_id}` });
    return { asOf: Date.now(), goals, automation, budget: gate?.budget.view(), proposals: gate?.proposals.list(), taskPlans: goals?.map(g => gate!.proposals.plans.get(g.id)).filter((p): p is NonNullable<typeof p> => p !== null), revenue: receipts.map(r => ({ asset: String(r.asset), amount: decimal(r.amount_atomic, r.decimals), at: Number(r.created_at) })),
      costs: gate ? control.db.prepare("SELECT date(p.created_at/1000,'unixepoch','+8 hours') day,SUM(r.settled_micros) micros FROM owner_money_reservations r JOIN owner_model_permits p ON p.id=r.permit_id WHERE p.state='SETTLED' GROUP BY day ORDER BY day").all().map(r => ({ day: String(r.day), micros: Number(r.micros) })) : [], storefront, people, inbox, alerts, activity, work,
      summary: { qianjiCount: people.length, activeWorlds: people.filter(p => p.status === 'ACTIVE').length, runningWorlds: people.filter(p => p.running).length, inboxCount: inbox.length, currentGeneration: String(manager.registry.effectiveGeneration().id) }, availability: { business: false, upgrade: 'not_configured' } };
  }
  async bossOverview(): Promise<BossOverview> {
    const data = await this.overview();
    const instanceId = this.instanceId ?? JSON.parse(fs.readFileSync(path.join(this.worlds.manager.registry.workspace, 'workspace-format.json'), 'utf8')).instanceId;
    return { instanceId, asOf: data.asOf, automation: data.automation, budget: data.budget, proposals: data.proposals, inbox: data.inbox, alerts: data.alerts, costs: data.costs, goals: data.goals?.map(({id,title,status,updatedAt})=>({id,title,status,updatedAt})), storefront: data.storefront,
      modelConfigured: Boolean(this.worlds.manager.options.isModelConfigured), paymentConfigured: this.worlds.payments.rails().some(r => r.status === 'ENABLED'),
      paidOrderCount: Number(this.worlds.manager.registry.control.db.prepare("SELECT COUNT(*) n FROM orders WHERE status='PAID'").get()!.n),
      revenue: this.worlds.payments.db.prepare('SELECT receipt_id,asset,amount_atomic,decimals,created_at FROM world_revenue_events ORDER BY created_at').all().map(r => ({ id: String(r.receipt_id), asset: String(r.asset), amount: decimal(r.amount_atomic, r.decimals), at: Number(r.created_at) })),
      events: data.activity.map(event => ({ id: event.id, kind: event.type as 'product' | 'payment' | 'goal', title: event.summary, at: event.createdAt, reference: event.href })) };
  }
}
