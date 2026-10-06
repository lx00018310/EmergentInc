import { t as tr, useLanguage } from '../../i18n';
import {worldsEnabled} from '../../api/worldScope';
import {V23Panel} from './V23Panel';
import {PublicSiteSettings} from './PublicSiteSettings';
import { useCallback, useEffect, useState } from 'react';
import './business.css';
import { readTable } from './read_table';
import { BusinessOutcomes } from './BusinessOutcomes';
import { StrategyHistory } from './StrategyHistory';
import { EvolutionPanel } from './EvolutionPanel';
import type { BusinessTab } from './evolution/life_types';

import { businessApi, businessDecision, explanations } from './business_api';
const money = (micros: number) => `¥${(micros / 1000000).toFixed(4)}`;
const states: Record<string, string> = { get AWAITING_APPROVAL() { return tr("等待批准"); }, get ACTIVE() { return tr("正在推进"); }, get WAITING_RESOURCE() { return tr("等待资料或能力"); },
  get PAUSED() { return tr("已暂停"); }, get STOPPED() { return tr("已终止"); }, get COMPLETED() { return tr("约定任务已完成"); }, get READY() { return tr("等待执行"); }, get RUNNING() { return tr("正在处理"); },
  get SUCCEEDED() { return tr("已完成"); }, get FAILED() { return tr("需要处理"); }, get CANCELLED() { return tr("已取消"); }, get OUTCOME_UNKNOWN() { return tr("结果待核实"); } };
type Plan = { id: string; revision: number; hash: string; direction: string; state: string; spentMicros: number; reservedMicros: number;
  previousPlan?: Plan['plan'];
  plan: { title: string; objective: string; audience: string; hypothesis: string; metric: { name: string; baseline: string; target: string; evidence: string };
    stopCondition: string; budgetMicros: number; expiresAt: number; resources: string[];
    actions: { capability?: string; datasetId?: string; purpose: string; repository?: string; accountLogin?: string; title?: string; body?: string }[];
    schedule?: { kind: string; everyMinutes?: number; time?: string; timezone?: string; maxOccurrences: number } } };

export function BusinessHome() {
  useLanguage();
  const [data, setData] = useState<any>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState(''), [tab, setTab] = useState<BusinessTab | 'life' | 'public-site'>('life');
  const [total, setTotal] = useState('10'), [draft, setDraft] = useState('2'), [calls, setCalls] = useState('10');
  const [days, setDays] = useState('7'), [uploadId, setUploadId] = useState('');
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => { setData(await businessApi('business/overview')); }, []);
  useEffect(() => {
    void refresh().catch(e => setError(e.message));
    const timer = setInterval(() => { void refresh().catch(e => setError(e.message)); }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await fn(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function propose() {
    await businessDecision('business/intents', { direction });
    setDirection(''); setTab('plans');
  }
  async function upload(file: File) {
    if (file.size > 500000) throw new Error((tr("资料文件不能超过 500 KB。")));
    const rows = readTable(await file.text(), file.name);
    await businessApi('business/datasets', { id: uploadId || undefined, name: file.name, rows });
    setUploadId('');
  }
  const plans = (data?.plans ?? []) as Plan[];
  return <main className={`business-shell${tab === 'life' ? ' life-shell' : ''}`}>
    <header><div><small>EMERGENTINC · GENE</small><h1>{tr('Internal Business Operating System')}</h1><p>{tr('Manage your business, public site, payments and AI evolution.')}</p><a href="/QIAN">{tr("返回千机阁")}</a></div>
      <button onClick={() => void act(async () => { await businessApi('logout', {}); window.location.reload(); })}>{tr("退出登录")}</button></header>
    <nav aria-label={tr("主要导航")}>{([['life', (tr("生命总览"))], ['business', (tr("经营"))], ['plans', (tr("方案"))], ['resources', (tr("连接与资料"))], ['public-site', tr('Public Site')]] as const).map(([id, label]) =>
      <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {error && <p className="business-error" role="alert">{error}</p>}
    {tab === 'life' && <><EvolutionPanel onNavigate={setTab} />{worldsEnabled()&&<V23Panel/>}</>}
    {tab === 'public-site' && <PublicSiteSettings />}
    {tab !== 'life' && tab !== 'public-site' && (!data ? <p>{tr("正在读取经营记录…")}</p> : <>
      <section className="business-metrics"><div><small>{tr("已确认费用")}</small><strong>{money(data.spentMicros)}</strong></div>
        <div><small>{tr("待确认预留")}</small><strong>{money(data.reservedMicros)}</strong></div>
        <div><small>{tr("待你决定")}</small><strong>{data.requests.length + data.unknownOperations.length + data.tasks.filter((t: any) => t.state === 'OUTCOME_UNKNOWN' && t.capability === 'github_issue_create').length + plans.filter(p => p.state === 'AWAITING_APPROVAL').length}</strong></div></section>
      {tab === 'business' && <>
        {data.schedulerFailure && <p role="alert" className="business-error">{tr("后台调度已停止：数据库或任务状态需要管理员检查。记录已保留；此时请勿重复启动任务。")}</p>}
        {!!data.proposalProblems?.length && <p role="alert" className="business-error">{tr("有") + " "}{data.proposalProblems.length} {" " + tr("次请求未形成有效方案，相关费用仍计入累计账。请修改方向后重新拟定；系统不会自动重复付费调用。")}</p>}
        <section><h2>{tr("你想改善什么业务？")}</h2><p>{tr("当前可处理资料、在已连接的 GitHub 仓库提交经批准的议题，并记录经营凭据。发布动作不等于获客成功；链上收款可在生命总览配置和核验，既有 CNY 手工凭据保留独立来源。")}</p>
          <form onSubmit={e => { e.preventDefault(); void act(propose); }}><label>{tr("业务方向")}<textarea value={direction} required maxLength={8000}
            placeholder={tr("例如：我想减少每周整理询盘表的时间，先检查现有资料里缺了什么。")} onChange={e => setDirection(e.target.value)} /></label>
            <button className="primary" disabled={busy || !data.settings || !data.modelConfigured}>{tr("让 Pixel 提方案")}</button>
            {!data.modelConfigured && <p>{tr("请由实例管理员配置模型与明确报价；系统当前不会调用付费模型。")}</p>}</form></section>
        <details open={!data.settings}><summary>{tr("费用授权")}{data.settings ? tr(" · 累计上限 {0}", [money(data.settings.limit_micros)]) : (" " + tr("· 首次使用请先确认"))}</summary>
          <p>{tr("拟定方案也可能收费。这里授权的是累计上限，修改额度不会清除已发生费用。实际账单异常超过预估时保留真实费用并停止后续支出。")}</p>
          <form onSubmit={e => { e.preventDefault(); void act(() => businessApi('business/budget', {
            limitMicros: Math.round(Number(total) * 1000000), draftLimitMicros: Math.round(Number(draft) * 1000000),
            draftCallLimit: Number(calls), draftExpiresAt: Date.now() + Number(days) * 86400000,
          })); }}><div className="business-grid">
            <label>{tr("总费用上限（元）")}<input type="number" min="0" step="0.01" required value={total} onChange={e => setTotal(e.target.value)} /></label>
            <label>{tr("其中用于拟定方案（元）")}<input type="number" min="0" step="0.01" required value={draft} onChange={e => setDraft(e.target.value)} /></label>
            <label>{tr("累计拟定次数上限")}<input type="number" min="0" max="10000" required value={calls} onChange={e => setCalls(e.target.value)} /></label>
            <label>{tr("有效天数")}<input type="number" min="1" max="366" required value={days} onChange={e => setDays(e.target.value)} /></label>
          </div><button disabled={busy}>{tr("确认费用授权")}</button></form></details>
        {data.unknownOperations.map((op: any) => <section key={op.id}><h2>{tr("有一笔模型费用需要核实")}</h2><p>{tr("预留") + " "}{money(op.reserved_micros)}{tr("。查看供应商账单后填写实付费用和核验依据。")}</p>
          <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void act(() => businessApi(`business/operations/${encodeURIComponent(op.id)}/reconcile`,
            { amountMicros: Math.round(Number(f.get('amount')) * 1000000), evidence: f.get('evidence') })); }}>
            <label>{tr("实付（元）")}<input name="amount" type="number" min="0" step="0.000001" required /></label>
            <label>{tr("账单或核验依据")}<input name="evidence" required /></label><button disabled={busy}>{tr("确认已核实")}</button></form></section>)}
        <section><h2>{tr("最近的处理结果")}</h2>{data.tasks.length ? data.tasks.slice(0, 6).map((t: any) => <div key={t.id} className="business-task"><strong>{states[t.state] ?? t.state}</strong>
          {t.output && <Report output={JSON.parse(t.output)} />}{t.error && <p>{explanations[t.error] ?? t.error}</p>}
          {t.state === 'OUTCOME_UNKNOWN' && t.capability === 'github_issue_create' && <><p>{tr("外部请求可能已发生。系统不会重发；可只读核实最近的渠道回执。")}</p><button disabled={busy}
            onClick={() => void act(async () => { const result = await businessApi(`business/tasks/${encodeURIComponent(t.id)}/reconcile`, {});
              if (!result.found) throw new Error(result.detail); })}>{tr("核实渠道回执")}</button></>}
        </div>) : <p>{tr("还没有已授权任务。批准方案后，这里会显示结果。")}</p>}</section>
        <BusinessOutcomes data={data} busy={busy} act={act} />
      </>}
      {tab === 'plans' && <>{!plans.length && <section><p>{tr("先在经营页输入方向，Pixel 会提出可批准的方案。")}</p></section>}{plans.map(view => <section key={view.id}>
        <div className="business-title"><h2>{view.plan.title}</h2><span>{states[view.state]} {" " + tr("· 第") + " "}{view.revision} {" " + tr("版")}</span></div>
        <p>{view.plan.objective}</p><dl><dt>{tr("服务对象")}</dt><dd>{view.plan.audience}</dd><dt>{tr("待验证假设")}</dt><dd>{view.plan.hypothesis}</dd>
          <dt>{tr("衡量结果")}</dt><dd>{view.plan.metric.name}：{view.plan.metric.baseline} → {view.plan.metric.target}{tr("；证据：")}{view.plan.metric.evidence}</dd>
          <dt>{tr("费用与期限")}</dt><dd>{tr("累计上限") + " "}{money(view.plan.budgetMicros)}{tr("；已确认") + " "}{money(view.spentMicros)}{tr("，预留") + " "}{money(view.reservedMicros)}{tr("；截至") + " "}{new Date(view.plan.expiresAt).toLocaleString()}</dd>
          <dt>{tr("允许的动作")}</dt><dd>{view.plan.actions.map((a, i) => a.capability === 'review_feedback' ? <p key={i}>{tr("复盘本方案的新反馈，按次数和费用上限调用模型；修订仍需你批准。用途：")}{a.purpose}</p> : a.capability === 'github_issue_create' ? <div key={i}>
            <p>{tr("以") + " "}{a.accountLogin} {" " + tr("的账号，在") + " "}{a.repository} {" " + tr("创建一条议题：")}{a.title}</p><p style={{whiteSpace:'pre-wrap'}}>{a.body}</p><p>{tr("用途：")}{a.purpose}{tr("（GitHub 议题第 1 版）")}</p></div> :
            <p key={i}>{tr("处理资料") + " "}{a.datasetId}：{a.purpose}{tr("（资料报告第 1 版）")}</p>)}</dd>
          <dt>{tr("执行时间")}</dt><dd>{view.plan.schedule ? <>{view.plan.schedule.kind === 'daily' ? tr("每天 {0}（{1}）", [view.plan.schedule.time, view.plan.schedule.timezone]) : tr("每 {0} 分钟", [view.plan.schedule.everyMinutes])}{tr("，最多") + " "}{view.plan.schedule.maxOccurrences} {" " + tr("次；离线合并一次，避免集中补跑。")}</> : (tr("批准且资料齐备后执行一次。"))}
            {data.schedules?.filter((s: any) => s.plan_id === view.id && s.state === 'ACTIVE').map((s: any) => <p key={s.revision}>{tr("下次行动：")}{new Date(s.next_run_at).toLocaleString()}</p>)}</dd>
          <dt>{tr("停止条件")}</dt><dd>{view.plan.stopCondition}</dd></dl>
        {view.previousPlan && <details open={view.state === 'AWAITING_APPROVAL'}><summary>{tr("与上一版本的差异")}</summary>
          {(['objective', 'budgetMicros', 'expiresAt', 'actions', 'metric', 'resources', 'schedule'] as const).filter(key =>
            JSON.stringify(view.previousPlan![key]) !== JSON.stringify(view.plan[key])).map(key => <p key={key}>
              <strong>{{ objective: (tr("目标")), budgetMicros: (tr("累计预算")), expiresAt: (tr("有效期")), actions: (tr("行动范围")), metric: (tr("验收指标")), resources: (tr("资源依赖")), schedule: (tr("执行时间")) }[key]}</strong>
              <br />{tr("此前：")}{planValue(key, view.previousPlan![key])}<br />{tr("现在：")}{planValue(key, view.plan[key])}</p>)}
        </details>}
        <div className="business-actions">{view.state === 'AWAITING_APPROVAL' && <button className="primary" disabled={busy}
          onClick={() => void act(() => businessApi(`business/plans/${view.id}/approve`, { revision: view.revision, hash: view.hash }))}>{tr("批准执行此版本")}</button>}
          {['ACTIVE', 'WAITING_RESOURCE'].includes(view.state) && <button disabled={busy} onClick={() => void act(() => businessApi(`business/plans/${view.id}/pause`, {}))}>{tr("暂停")}</button>}
          {view.state === 'PAUSED' && <button disabled={busy} onClick={() => void act(() => businessApi(`business/plans/${view.id}/resume`, {}))}>{tr("继续")}</button>}
          {!['STOPPED', 'COMPLETED'].includes(view.state) && <button disabled={busy} onClick={() => void act(() => businessApi(`business/plans/${view.id}/revoke`, {}))}>{tr("终止 / 暂不执行")}</button>}</div>
        <details><summary>{tr("提出修改")}</summary><label>{tr("反馈")}<textarea value={feedback[view.id] ?? ''} onChange={e => setFeedback({ ...feedback, [view.id]: e.target.value })} /></label>
          <button disabled={busy || !feedback[view.id]} onClick={() => void act(() => businessDecision(`business/plans/${view.id}/revisions`,
            { feedback: feedback[view.id], revision: view.revision }))}>{tr("请 Pixel 修订方案（计入费用）")}</button>
          <p>{tr("新方案提交后，旧版未执行任务会停止，新版须重新批准。")}</p></details>
        <details><summary>{tr("记录真实结果与反馈")}</summary><p>{tr("记录反馈不会产生收入或升级权限；下一次修订会带上这些证据。")}</p>
          <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void act(() => businessApi(`business/plans/${view.id}/feedback`,
            { key: crypto.randomUUID(), note: f.get('note'), evidence: f.get('evidence') })); }}>
            <label>{tr("实际观察")}<input name="note" required maxLength={4000} /></label><label>{tr("证据或测量方式")}<input name="evidence" maxLength={4000} /></label>
            <button disabled={busy}>{tr("保存反馈")}</button></form>
          {data.events?.filter((e: any) => e.plan_id === view.id && e.kind === 'owner_feedback').map((e: any) => <p key={e.id}>{JSON.parse(e.payload).note} · {JSON.parse(e.payload).evidence}</p>)}
        </details>
        {view.revision > 1 && <StrategyHistory id={view.id} revision={view.revision} busy={busy} act={act} />}
      </section>)}</>}
      {tab === 'resources' && <><section><h2>{tr("业务资料")}</h2><p>{tr("上传 Excel 导出的 UTF-8 CSV 表格或 JSON 行数组，最多 500 KB。资料固定保存，修改内容须上传新资料并修订方案。")}</p>
        <label>{tr("请求中的资料标识（没有指定可留空）")}<input value={uploadId} onChange={e => setUploadId(e.target.value)} /></label>
        <label>{tr("选择资料")}<input type="file" accept=".csv,.json,text/csv,application/json" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void act(() => upload(file)); e.target.value = ''; }} /></label>
        {data.datasets.map((d: any) => <p key={d.id}>{d.name} · <code>{d.id}</code></p>)}</section>
        <section><h2>{tr("需要你提供的资源")}</h2>{!data.requests.length && <p>{tr("当前没有待处理资源请求。")}</p>}{data.requests.map((r: any) => <div key={r.id} className="business-task">
          <strong>{r.resource.startsWith('task:') ? (tr("任务需要处理")) : r.resource}</strong><p>{tr("只确认已实际提供的资料或判断。涉及新账号或新能力时，需要后续实现并重新批准范围。")}</p>
          {r.resource.startsWith('task:') ? <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget);
            void act(() => businessApi(`business/tasks/${encodeURIComponent(r.resource.slice(5))}/retry`, { note: f.get('note') })); }}>
            <p>{tr("已审核的资料处理可以在原因解决后重试。对外任务请修订方案或终止，不能在这里重发。")}</p><label>{tr("处理说明")}<input name="note" required /></label>
            <button disabled={busy || !data.tasks.some((t: any) => t.id === r.resource.slice(5) && t.capability === 'data_report')}>{tr("重试资料处理")}</button>
            <button type="button" onClick={() => setTab('plans')}>{tr("查看方案")}</button></form> :
          <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void act(() => businessApi(`business/requests/${r.id}/decision`, { decision: 'provided', note: f.get('note') })); }}>
            <label>{tr("提供的思路 / 证据")}<input name="note" required /></label><button disabled={busy}>{tr("确认已提供，继续任务")}</button>
            <button type="button" disabled={busy} onClick={() => void act(() => businessApi(`business/requests/${r.id}/decision`, { decision: 'reject', note: (tr("Owner 拒绝本次资源申请")) }))}>{tr("拒绝并停止方案")}</button></form>}</div>)}</section>
        <section><h2>{tr("连接 GitHub 仓库")}</h2><p>{tr("适合在你管理的项目中记录反馈或交付事项，不向任意仓库批量发帖。使用限定目标仓库、具备 Issues 写权限的个人访问令牌；令牌由服务端保管，不交给 Pixel。")}</p>
          <form onSubmit={e => { e.preventDefault(); const form = e.currentTarget, f = new FormData(form);
            void act(async () => { await businessApi('business/connections/github/authorize', { id: f.get('id') || undefined, repository: f.get('repository'), token: f.get('token') }); form.reset(); }); }}>
            <label>{tr("仓库（owner/repo）")}<input name="repository" required autoComplete="off" /></label><label>{tr("个人访问令牌")}<input name="token" type="password" required autoComplete="off" /></label>
            <label>{tr("请求中的连接标识（没有可留空）")}<input name="id" /></label><button disabled={busy}>{tr("验证并连接此仓库")}</button></form>
          {(data.connections ?? []).map((c: any) => <p key={c.id}>{c.account_login} · {c.repository} · {c.enabled ? (tr("允许在方案批准后执行")) : (tr("已禁止新动作"))}
            {Boolean(c.enabled) && <button disabled={busy} onClick={() => void act(() => businessApi(`business/connections/${c.id}/disable`, {}))}>{tr("禁止新动作")}</button>}</p>)}</section>
        <section><h2>{tr("已接通能力")}</h2><p>{tr("资料报告、反馈复盘、GitHub 议题，均为第 1 版。对外动作仅限连接账号和批准的具体标题、正文及仓库。没有新反馈时，复盘不调用模型。")}</p></section></>}
    </>)}
    {busy && <p role="status">{tr("正在处理，请勿重复提交…")}</p>}
  </main>;
}
function planValue(key: string, value: unknown): string {
  if (value === undefined) return (tr("未设置"));
  if (key === 'budgetMicros') return money(Number(value));
  if (key === 'expiresAt') return new Date(Number(value)).toLocaleString();
  if (key === 'actions') return (value as Plan['plan']['actions']).map(a => a.capability === 'review_feedback' ? tr("反馈复盘：{0}", [a.purpose]) : a.capability === 'github_issue_create' ?
    tr("账号 {0}，仓库 {1}，标题 {2}，正文 {3}", [a.accountLogin, a.repository, a.title, a.body]) : tr("资料 {0}：{1}", [a.datasetId, a.purpose])).join('；');
  if (typeof value === 'string') return value;
  if (key === 'resources') return (value as string[]).join('；') || (tr("无"));
  if (key === 'metric') return Object.values(value as object).join('；');
  return JSON.stringify(value);
}
function Report({ output }: { output: any }) {
  useLanguage();
  if (!output) return null;
  if (output.kind === 'review') return <p>{output.reason}</p>;
  if (output.kind === 'github_issue') return <p>{tr("平台已返回议题回执：")}<a href={output.url} target="_blank" rel="noreferrer">{output.repository} #{output.number}</a>{tr("。这证明动作发生，不代表已经获得客户或收入。")}</p>;
  return <div><p>{tr("已处理") + " "}{output.rows} {" " + tr("行，发现") + " "}{output.duplicateRows} {" " + tr("行重复内容。")}</p>
    <table><thead><tr><th>{tr("字段")}</th><th>{tr("缺失行数")}</th><th>{tr("数值合计")}</th></tr></thead><tbody>{output.fields?.map((f: any) => <tr key={f.name}><td>{f.name}</td><td>{f.missing}</td><td>{f.numericSum ?? '—'}</td></tr>)}</tbody></table><small>{output.note}</small></div>;
}
