import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchQianjiHistory, fetchQianjiList, qianjiArtifactUrl, type QianjiHistoryDto, type QianjiListItemDto } from '../../api/qianji';
import type { ChronicleDto, ChronicleEventDto, MissionDto, ProductDto, RevenueDto, TrialDto } from '../../api/organization';
import * as api from '../../api/organization';

type DeskTab = 'missions' | 'trials' | 'products' | 'archive' | 'chronicle';
const EMPTY_NARRATIVE = (displayName: string) => ({ displayName, title: null, roleLabel: null, traits: {}, behaviorProfile: [], flaw: null, shortBio: null, appearanceSpec: null, portraitAsset: null, contentRevision: null });
const key = () => globalThis.crypto?.randomUUID?.() ?? `action-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const textOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export const OrganizationDesk: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [tab, setTab] = useState<DeskTab>('missions');
  const [missions, setMissions] = useState<MissionDto[]>([]);
  const [trials, setTrials] = useState<TrialDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [revenues, setRevenues] = useState<RevenueDto[]>([]);
  const [members, setMembers] = useState<QianjiListItemDto[]>([]);
  const [retired, setRetired] = useState<QianjiListItemDto[]>([]);
  const [recruitments, setRecruitments] = useState<any[]>([]);
  const [narratives, setNarratives] = useState<ChronicleDto['narratives']>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedMissionId, setSelectedMissionId] = useState('');
  const [selectedTrialId, setSelectedTrialId] = useState('');
  const [feedback, setFeedback] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [evidenceByMission, setEvidenceByMission] = useState<Record<string, any[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);

  const activeMembers = useMemo(() => members.filter(item => item.profile.careerStatus === 'active' && item.currentBinding), [members]);
  const selectedProduct = products.find(item => item.productId === selectedProductId) ?? products[0] ?? null;
  const refresh = useCallback(async () => {
    try {
      const [missionRows, trialRows, productRows, revenueRows, qianjiRows, retiredRows, recruitmentRows, narrativeRows] = await Promise.all([
        api.listMissions(), api.listTrials(), api.listProducts(), api.listRevenues(), fetchQianjiList(), fetchQianjiList(undefined, 'retired'),
        api.listRecruitments(), api.listNarrativeArtifacts(),
      ]);
      setMissions(missionRows); setTrials(trialRows); setProducts(productRows); setRevenues(revenueRows);
      setMembers(qianjiRows); setRetired(retiredRows); setRecruitments(recruitmentRows); setNarratives(narrativeRows);
      if (!selectedProductId && productRows[0]) setSelectedProductId(productRows[0].productId);
      if (!selectedMissionId && missionRows.find(row => row.status === 'draft')) setSelectedMissionId(missionRows.find(row => row.status === 'draft')!.missionId);
      if (!selectedTrialId && trialRows.find(row => row.status === 'draft')) setSelectedTrialId(trialRows.find(row => row.status === 'draft')!.trialId);
      setError(null);
    } catch (err) { setError(textOf(err)); }
  }, [selectedMissionId, selectedProductId, selectedTrialId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await operation(); await refresh(); setRefreshRevision(value => value + 1); }
    catch (err) { setError(textOf(err)); }
    finally { setBusy(false); }
  };

  return <div className="org-desk">
    <header className="org-header">
      <div><p className="qj-eyebrow">天机阁 · 组织控制台</p><h1>任务、试炼与产品</h1><span>确认收款是 Owner 录入事实；这里不连接支付或发布渠道。</span></div>
      <button className="btn btn-sm" type="button" onClick={onBack}>返回天机阁</button>
    </header>
    <nav className="org-tabs" aria-label="组织页面">
      {([['missions', 'Mission'], ['trials', '招贤与试炼'], ['products', '产品与商业'], ['archive', '人物档案'], ['chronicle', '纪事与 Muse']] as Array<[DeskTab, string]>).map(([id, label]) =>
        <button key={id} className={tab === id ? 'is-selected' : ''} type="button" onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    {error && <p className="org-error" role="alert">{error}</p>}
    <main className="org-content">
      {tab === 'missions' && <MissionBoard missions={missions} members={activeMembers} evidenceByMission={evidenceByMission} setEvidenceByMission={setEvidenceByMission} run={run} />}
      {tab === 'trials' && <TrialArena trials={trials} recruitments={recruitments} members={members} selectedTrialId={selectedTrialId} setSelectedTrialId={setSelectedTrialId} run={run} />}
      {tab === 'products' && <ProductBoard products={products} missions={missions} members={activeMembers} revenues={revenues} selectedProduct={selectedProduct} setSelectedProductId={setSelectedProductId} feedback={feedback} setFeedback={setFeedback} deliveries={deliveries} setDeliveries={setDeliveries} refreshRevision={refreshRevision} run={run} />}
      {tab === 'archive' && <ArchiveHall items={retired} />}
      {tab === 'chronicle' && <ChroniclePanel items={narratives} missions={missions} products={products} members={members} run={run} />}
    </main>
  </div>;
};

function MissionBoard(props: { missions: MissionDto[]; members: QianjiListItemDto[]; evidenceByMission: Record<string, any[]>;
  setEvidenceByMission: React.Dispatch<React.SetStateAction<Record<string, any[]>>>; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [ownerId, setOwnerId] = useState(''); const [participantIds, setParticipantIds] = useState<string[]>([]); const [title, setTitle] = useState(''); const [missionType, setMissionType] = useState('research');
  const [objective, setObjective] = useState(''); const [criteria, setCriteria] = useState(''); const [budget, setBudget] = useState(10000);
  const [rounds, setRounds] = useState(3); const [notes, setNotes] = useState<Record<string, string>>({}); const [evidenceInput, setEvidenceInput] = useState<Record<string, string>>({});
  useEffect(() => { if (!ownerId && props.members[0]) { const firstId = props.members[0].profile.qianjiId; setOwnerId(firstId); setParticipantIds([firstId]); } }, [ownerId, props.members]);
  const owner = props.members.find(item => item.profile.qianjiId === ownerId);
  return <section className="org-panel">
    <div className="org-panel-title"><div><p className="qj-eyebrow">阁主令</p><h2>Mission 看板</h2></div><span>{props.missions.length} 项</span></div>
    <form className="org-form" onSubmit={event => { event.preventDefault(); if (!owner?.currentBinding) return;
      const participants = props.members.filter(item => participantIds.includes(item.profile.qianjiId) && item.currentBinding)
        .map(item => ({ qianjiId: item.profile.qianjiId, bindingId: item.currentBinding!.bindingId, duty: '' }));
      void props.run(() => api.createMission({ title, missionType, objective, acceptanceCriteria: criteria, budgetTokens: budget,
        roundsLimit: rounds, ownerQianjiId: ownerId, participants })); }}>
      <h3>新建任务草案</h3>
      <div className="org-fields"><label>标题<input value={title} onChange={e => setTitle(e.target.value)} required /></label><label>类型标签<input value={missionType} onChange={e => setMissionType(e.target.value)} required /></label>
        <label>负责人<select value={ownerId} onChange={e => { const id = e.target.value; setOwnerId(id); setParticipantIds(current => current.includes(id) ? current : [...current, id]); }}>{props.members.map(item => <option key={item.profile.qianjiId} value={item.profile.qianjiId}>{item.profile.narrative.displayName}</option>)}</select></label>
        <label>Token 预算<input type="number" min={1} value={budget} onChange={e => setBudget(Number(e.target.value))} /></label><label>轮次上限<input type="number" min={1} value={rounds} onChange={e => setRounds(Number(e.target.value))} /></label></div>
      <fieldset className="org-participant-picker"><legend>参与人物（执行前需位于同组六邻居）</legend>{props.members.map(item => <label key={item.profile.qianjiId}><input type="checkbox" checked={participantIds.includes(item.profile.qianjiId)} disabled={item.profile.qianjiId === ownerId} onChange={event => setParticipantIds(current => event.target.checked ? [...current, item.profile.qianjiId] : current.filter(id => id !== item.profile.qianjiId))} />{item.profile.narrative.displayName}</label>)}</fieldset>
      <label>目标<textarea value={objective} onChange={e => setObjective(e.target.value)} required /></label><label>验收标准<textarea value={criteria} onChange={e => setCriteria(e.target.value)} required /></label>
      <button className="btn btn-primary" disabled={!owner?.currentBinding || !participantIds.includes(ownerId)}>创建 draft</button>
    </form>
    <div className="org-card-list">{props.missions.map(mission => <article className="org-card" key={mission.missionId}>
      <div className="org-card-head"><div><span className={`org-status status-${mission.status}`}>{mission.status}</span><h3>{mission.title}</h3><small>{mission.missionType} · {mission.missionId}</small></div><b>{mission.budgetTokens.toLocaleString()} Token</b></div>
      <p>{mission.objective}</p><p className="org-muted">验收：{mission.acceptanceCriteria}</p>
      <div className="org-actions">
        {mission.status === 'draft' && <button className="btn btn-xs" onClick={() => void props.run(() => api.issueMission(mission.missionId))}>发布阁主令</button>}
        {mission.status === 'issued' && <button className="btn btn-xs btn-primary" onClick={() => void props.run(() => api.startMission(mission.missionId))}>开始 1 轮</button>}
        {(['running', 'awaiting_acceptance'].includes(mission.status) && mission.execution &&
          mission.execution.status !== 'running' && ['ready', 'blocked', 'awaiting_review'].includes(mission.execution.status) &&
          mission.execution.roundsUsed < mission.execution.roundsLimit &&
          mission.execution.spentTokens + mission.execution.reservedTokens < mission.execution.budgetTokens) &&
          <button className="btn btn-xs btn-primary" onClick={() => void props.run(() => api.resumeMission(mission.missionId))}>继续 1 轮</button>}
        {mission.execution?.status === 'running' && <small>执行中；Run 结束后可继续任务或验收。</small>}
        {mission.status === 'awaiting_acceptance' && <>
          <button className="btn btn-xs" onClick={() => void props.run(async () => { const evidence = await api.missionEvidence(mission.missionId); props.setEvidenceByMission(current => ({ ...current, [mission.missionId]: evidence })); })}>读取证据</button>
          <input aria-label={`${mission.title} 证据 ID`} placeholder="证据 ID，逗号分隔；无文件型交付可留空" value={evidenceInput[mission.missionId] ?? ''} onChange={e => setEvidenceInput(current => ({ ...current, [mission.missionId]: e.target.value }))} />
          <select aria-label={`${mission.title} 验收结果`} value={notes[`outcome:${mission.missionId}`] ?? 'completed'} onChange={e => setNotes(current => ({ ...current, [`outcome:${mission.missionId}`]: e.target.value }))}><option value="completed">通过</option><option value="failed">失败</option></select>
          <input aria-label={`${mission.title} 验收说明`} placeholder="Owner 验收说明" value={notes[mission.missionId] ?? ''} onChange={e => setNotes(current => ({ ...current, [mission.missionId]: e.target.value }))} />
          <button className="btn btn-xs btn-primary" onClick={() => void props.run(() => api.acceptMission(mission.missionId, { outcome: notes[`outcome:${mission.missionId}`] ?? 'completed', note: notes[mission.missionId] ?? '', evidenceIds: (evidenceInput[mission.missionId] ?? '').split(',').map(s => s.trim()).filter(Boolean), idempotencyKey: key() }))}>Owner 验收并关闭</button>
        </>}
        {!['completed', 'failed', 'cancelled'].includes(mission.status) && <button className="btn btn-xs" onClick={() => void props.run(() => api.cancelMission(mission.missionId, 'Owner 取消任务'))}>取消</button>}
      </div>
      {props.evidenceByMission[mission.missionId]?.map((item: any) => <small key={item.evidenceId} className="org-evidence">{item.evidenceId} · SHA-256 {item.sha256 ?? '未知'} · {item.sizeBytes ?? '未知'} bytes</small>)}
      {mission.acceptanceNote && <p className="org-muted">验收记录：{mission.acceptanceNote}</p>}
    </article>)}</div>
  </section>;
}

function TrialArena(props: { trials: TrialDto[]; recruitments: any[]; members: QianjiListItemDto[]; selectedTrialId: string; setSelectedTrialId: (id: string) => void; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [roleLabel, setRoleLabel] = useState('研究助理'); const [jd, setJd] = useState(''); const [recruitmentId, setRecruitmentId] = useState('');
  const [challenge, setChallenge] = useState(''); const [criteria, setCriteria] = useState(''); const [candidateBudget, setCandidateBudget] = useState(5000); const [totalBudget, setTotalBudget] = useState(10000); const [trialRounds, setTrialRounds] = useState(3);
  const [pixelId, setPixelId] = useState(''); const [displayName, setDisplayName] = useState(''); const [initialEnergy, setInitialEnergy] = useState(5000);
  const [winner, setWinner] = useState(''); const [decisionReason, setDecisionReason] = useState(''); const selected = props.trials.find(item => item.trialId === props.selectedTrialId) ?? props.trials[0];
  return <section className="org-panel">
    <div className="org-panel-title"><div><p className="qj-eyebrow">招贤榜</p><h2>同规则串行试炼</h2></div><span>最多 3 位候选</span></div>
    <form className="org-form" onSubmit={event => { event.preventDefault(); void props.run(() => api.createRecruitment({ roleLabel, jd })); }}>
      <h3>发布招贤榜</h3><div className="org-fields"><label>职位<input value={roleLabel} onChange={e => setRoleLabel(e.target.value)} required /></label><label>职位描述<textarea value={jd} onChange={e => setJd(e.target.value)} required /></label></div><button className="btn btn-xs">发布</button>
    </form>
    <form className="org-form" onSubmit={event => { event.preventDefault(); void props.run(async () => { const trial = await api.createTrial({ recruitmentId: recruitmentId || null, challengeText: challenge, acceptanceCriteria: criteria, totalBudgetTokens: totalBudget, candidateBudgetTokens: candidateBudget, roundsPerCandidate: trialRounds, modelName: 'gpt-4o-mini', allowedTools: ['save_artifact', 'read_artifact', 'list_artifacts'] }); props.setSelectedTrialId(trial.trialId); }); }}>
      <h3>建立统一试炼规则</h3><div className="org-fields"><label>招贤榜<select value={recruitmentId} onChange={e => setRecruitmentId(e.target.value)}><option value="">不关联</option>{props.recruitments.map(item => <option key={item.recruitmentId} value={item.recruitmentId}>{item.roleLabel}</option>)}</select></label><label>每位候选预算<input type="number" min={1} value={candidateBudget} onChange={e => setCandidateBudget(Number(e.target.value))} /></label><label>试炼总预算<input type="number" min={1} value={totalBudget} onChange={e => setTotalBudget(Number(e.target.value))} /></label><label>每人轮次<input type="number" min={1} value={trialRounds} onChange={e => setTrialRounds(Number(e.target.value))} /></label></div><label>统一考题<textarea value={challenge} onChange={e => setChallenge(e.target.value)} required /></label><label>统一验收标准<textarea value={criteria} onChange={e => setCriteria(e.target.value)} required /></label><button className="btn btn-xs">创建试炼</button>
    </form>
    {selected && <section className="org-card">
      <div className="org-card-head"><div><span className={`org-status status-${selected.status}`}>{selected.status}{selected.pauseReason ? ` · ${selected.pauseReason}` : ''}</span><h3>统一规则</h3><small>{selected.modelName} · {selected.roundsPerCandidate} 轮/人 · {selected.candidateBudgetTokens} Token/人 · 总预算 {selected.totalBudgetTokens} Token</small></div>
        <select aria-label="选择试炼" value={selected.trialId} onChange={e => props.setSelectedTrialId(e.target.value)}>{props.trials.map(trial => <option key={trial.trialId} value={trial.trialId}>{trial.trialId}</option>)}</select></div>
      <p>{selected.challengeText}</p><p className="org-muted">验收：{selected.acceptanceCriteria} · 工具：{selected.allowedTools.join(', ')}</p>
      {selected.status === 'draft' && <form className="org-inline-form" onSubmit={event => { event.preventDefault(); void props.run(() => api.addTrialCandidate(selected.trialId, { pixelId, initialEnergyTokens: initialEnergy, idempotencyKey: key(), formalNarrative: EMPTY_NARRATIVE(displayName || `候选 ${pixelId}`), testNarrative: EMPTY_NARRATIVE(`${displayName || `候选 ${pixelId}`}（试炼人设）`) })); }}>
        <label>未使用坐标<input placeholder="x_y_z" value={pixelId} onChange={e => setPixelId(e.target.value)} required /></label><label>候选称呼<input value={displayName} onChange={e => setDisplayName(e.target.value)} required /></label><label>初始 Token<input type="number" min={selected.candidateBudgetTokens} value={initialEnergy} onChange={e => setInitialEnergy(Number(e.target.value))} /></label><button className="btn btn-xs">创建空白候选</button>
      </form>}
      <div className="org-candidate-grid">{selected.candidates.map(candidate => <article className="org-candidate" key={candidate.candidateId}><b>候选 {candidate.ordinal} · {candidate.qianjiId}</b><span>{candidate.execution?.status ?? '就绪'} · 实耗 {candidate.execution?.spentTokens ?? 0} Token / {selected.candidateBudgetTokens}</span><span>已知成本 {candidate.execution?.knownCostCny.toFixed(4) ?? '未知'} CNY{candidate.execution?.totalCostCny === null ? ' · 总成本未知' : ''}</span><span>轮次 {candidate.execution?.roundsUsed ?? 0}/{candidate.execution?.roundsLimit ?? selected.roundsPerCandidate}</span>{candidate.execution?.errorSummary && <span className="org-error-text">{candidate.execution.errorSummary}</span>}{candidate.execution?.evidence.map(item => <small key={item.evidenceId}>{item.evidenceId} · {item.sha256 ?? 'hash 未知'}</small>)}</article>)}</div>
      <div className="org-actions">{selected.status === 'draft' && <button className="btn btn-xs btn-primary" disabled={selected.candidates.length < 2} onClick={() => void props.run(() => api.startTrial(selected.trialId))}>按序开始</button>}{selected.status === 'running' && selected.pauseReason && <button className="btn btn-xs btn-primary" onClick={() => void props.run(() => api.resumeTrial(selected.trialId))}>恢复当前候选</button>}{selected.status === 'running' && <button className="btn btn-xs" onClick={() => void props.run(() => api.cancelTrial(selected.trialId, 'Owner 取消试炼'))}>取消</button>}</div>
      {selected.status === 'awaiting_selection' && <div className="org-inline-form"><label>录用人<select value={winner} onChange={e => setWinner(e.target.value)}><option value="">不录用</option>{selected.candidates.map(candidate => <option key={candidate.qianjiId} value={candidate.qianjiId}>{candidate.qianjiId}</option>)}</select></label><label>裁决原因<input value={decisionReason} onChange={e => setDecisionReason(e.target.value)} required /></label><button className="btn btn-xs btn-primary" onClick={() => void props.run(() => api.decideTrial(selected.trialId, { winnerQianjiId: winner || null, reason: decisionReason, evidenceIds: [], idempotencyKey: key() }))}>Owner 裁决</button><button className="btn btn-xs" onClick={() => void props.run(() => api.cancelTrial(selected.trialId, 'Owner 取消，不代表落选'))}>取消试炼</button></div>}
    </section>}
  </section>;
}

function ProductBoard(props: { products: ProductDto[]; missions: MissionDto[]; members: QianjiListItemDto[]; revenues: RevenueDto[]; selectedProduct: ProductDto | null; setSelectedProductId: (id: string) => void; feedback: any[]; setFeedback: React.Dispatch<React.SetStateAction<any[]>>; deliveries: any[]; setDeliveries: React.Dispatch<React.SetStateAction<any[]>>; refreshRevision: number; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [targetUser, setTargetUser] = useState(''); const [problem, setProblem] = useState(''); const [owner, setOwner] = useState('');
  const [missionId, setMissionId] = useState(''); const [feedbackText, setFeedbackText] = useState(''); const [publicSummary, setPublicSummary] = useState(''); const [contactAlias, setContactAlias] = useState('');
  const [deliveryMission, setDeliveryMission] = useState(''); const [deliveryEvidence, setDeliveryEvidence] = useState(''); const [revenueMission, setRevenueMission] = useState(''); const [revenueAmount, setRevenueAmount] = useState(0); const [revenueRef, setRevenueRef] = useState(''); const [externalTxId, setExternalTxId] = useState('');
  const [refundAmounts, setRefundAmounts] = useState<Record<string, number>>({}); const [refundReasons, setRefundReasons] = useState<Record<string, string>>({}); const [refundRefs, setRefundRefs] = useState<Record<string, string>>({});
  const [retirementReason, setRetirementReason] = useState(''); const [productMetrics, setProductMetrics] = useState<any>(null); const [metricsError, setMetricsError] = useState<string | null>(null);
  const product = props.selectedProduct;
  useEffect(() => { if (!owner && props.members[0]) setOwner(props.members[0].profile.qianjiId); }, [owner, props.members]);
  useEffect(() => {
    if (!product) return;
    let current = true;
    void Promise.all([api.listFeedback(product.productId), api.listDeliveries(product.productId), api.businessMetrics('product', product.productId)])
      .then(([feedbackRows, deliveryRows, metrics]) => { if (current) { props.setFeedback(feedbackRows); props.setDeliveries(deliveryRows); setProductMetrics(metrics); setMetricsError(null); } })
      .catch(error => { if (current) setMetricsError(textOf(error)); });
    return () => { current = false; };
  }, [product?.productId, props.refreshRevision]);
  const linkedMissions = props.missions.filter(mission => product?.missions.includes(mission.missionId));
  return <section className="org-panel">
    <div className="org-panel-title"><div><p className="qj-eyebrow">Product</p><h2>产品与真实商业记账</h2></div><span>{props.products.length} 个产品</span></div>
    <form className="org-form" onSubmit={event => { event.preventDefault(); void props.run(() => api.createProduct({ name, description, targetUser, problemStatement: problem, ownerQianjiId: owner })); }}>
      <h3>新建产品</h3><div className="org-fields"><label>名称<input value={name} onChange={e => setName(e.target.value)} required /></label><label>目标用户<input value={targetUser} onChange={e => setTargetUser(e.target.value)} required /></label><label>负责人<select value={owner} onChange={e => setOwner(e.target.value)}>{props.members.map(member => <option key={member.profile.qianjiId} value={member.profile.qianjiId}>{member.profile.narrative.displayName}</option>)}</select></label></div><label>问题<textarea value={problem} onChange={e => setProblem(e.target.value)} required /></label><label>描述<textarea value={description} onChange={e => setDescription(e.target.value)} required /></label><button className="btn btn-xs">创建</button>
    </form>
    <div className="org-product-layout"><aside className="org-product-list">{props.products.map(item => <button key={item.productId} className={item.productId === product?.productId ? 'is-selected' : ''} onClick={() => props.setSelectedProductId(item.productId)}><b>{item.name}</b><small>{item.status}</small></button>)}</aside>
      {product && <div className="org-product-detail"><div className="org-card-head"><div><span className={`org-status status-${product.status}`}>{product.status}</span><h3>{product.name}</h3></div><b>关联 Mission 成本 {productMetrics?.knownCostCny?.toFixed?.(4) ?? '未知'} CNY{productMetrics?.totalCostCny === null ? ' · 完整成本未知' : ''}</b></div>
        {metricsError && <p className="org-error-text" role="alert">产品统计读取失败：{metricsError}</p>}
        <p>{product.problemStatement}</p><p className="org-muted">{product.description} · 用户：{product.targetUser}</p>
        <p>确认收款 {(productMetrics?.confirmedRevenueFen ?? 0).toLocaleString()} 分 · 退款 {(productMetrics?.refundFen ?? 0).toLocaleString()} 分 · 净收入 {(productMetrics?.netRevenueFen ?? 0).toLocaleString()} 分 · ROI {productMetrics?.roi === null || productMetrics?.roi === undefined ? '未知' : `${(productMetrics.roi * 100).toFixed(1)}%`}</p>
        <div className="org-actions">{product.status === 'idea' && <button className="btn btn-xs" onClick={() => void props.run(() => api.transitionProduct(product.productId, 'validation'))}>进入 validation</button>}{product.status === 'validation' && <button className="btn btn-xs" onClick={() => void props.run(() => api.transitionProduct(product.productId, 'building'))}>进入 building</button>}{product.status === 'building' && <button className="btn btn-xs" onClick={() => void props.run(() => api.transitionProduct(product.productId, 'live'))}>Owner 确认 live</button>}{product.status !== 'paused' && product.status !== 'retired' && <button className="btn btn-xs" onClick={() => void props.run(() => api.transitionProduct(product.productId, 'paused'))}>暂停</button>}{product.status === 'paused' && <button className="btn btn-xs" onClick={() => void props.run(() => api.transitionProduct(product.productId, product.previousStatus ?? 'idea'))}>恢复</button>}{product.status !== 'retired' && <><input aria-label="产品退役原因" placeholder="退役原因" value={retirementReason} onChange={e => setRetirementReason(e.target.value)} /><button className="btn btn-xs" disabled={!retirementReason.trim()} onClick={() => void props.run(() => api.transitionProduct(product.productId, 'retired', retirementReason))}>退役产品</button></>}</div>
        <form className="org-inline-form" onSubmit={event => { event.preventDefault(); void props.run(() => api.linkProductMission(product.productId, missionId)); }}><label>关联未开始 Mission<select value={missionId} onChange={e => setMissionId(e.target.value)}><option value="">选择 Mission</option>{props.missions.filter(m => ['draft', 'issued'].includes(m.status) && !props.products.some(p => p.missions.includes(m.missionId))).map(m => <option key={m.missionId} value={m.missionId}>{m.title}</option>)}</select></label><button className="btn btn-xs" disabled={!missionId}>关联</button></form>
        <h4>关联 Mission</h4>{linkedMissions.map(m => <div className="org-row" key={m.missionId}><span>{m.title} · {m.status}</span><span>{m.missionType}</span></div>)}
        <form className="org-inline-form" onSubmit={event => { event.preventDefault(); void props.run(() => api.createFeedback({ productId: product.productId, missionId: linkedMissions.find(m => m.status === 'completed')?.missionId ?? null, contactAlias: contactAlias || null, source: 'Owner entered', privateFeedbackText: feedbackText, publicSummary: publicSummary || null })); }}><label>客户别名<input value={contactAlias} onChange={e => setContactAlias(e.target.value)} placeholder="可留空" /></label><label>反馈原文（本地）<textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)} required /></label><label>公开摘要（可留空）<input value={publicSummary} onChange={e => setPublicSummary(e.target.value)} /></label><button className="btn btn-xs" disabled={!feedbackText.trim()}>记录反馈</button></form>
        <h4>客户反馈</h4>{props.feedback.map(item => <div className="org-row" key={item.feedbackId}><span>{item.contactAlias || '无别名'} · {item.privateFeedbackText}</span><small>导出摘要：{item.publicSummary || '未提供'}</small></div>)}
        <form className="org-inline-form" onSubmit={event => { event.preventDefault(); void props.run(() => api.createDelivery({ productId: product.productId, missionId: deliveryMission, contactAlias: contactAlias || null, evidenceIds: deliveryEvidence.split(',').map(s => s.trim()).filter(Boolean) })); }}><label>交付 Mission<select value={deliveryMission} onChange={e => setDeliveryMission(e.target.value)}><option value="">选择已完成 Mission</option>{linkedMissions.filter(m => m.status === 'completed').map(m => <option key={m.missionId} value={m.missionId}>{m.title}</option>)}</select></label><label>已验收证据 ID<input value={deliveryEvidence} onChange={e => setDeliveryEvidence(e.target.value)} placeholder="逗号分隔" required /></label><button className="btn btn-xs">登记交付草稿</button></form>
        <h4>交付记录</h4>{props.deliveries.map(item => <div className="org-row" key={item.deliveryId}><span>{item.deliveryId} · {item.status} · {item.evidenceIds.join(', ')}</span>{item.status === 'draft' && <button className="btn btn-xs" onClick={() => void props.run(() => api.transitionDelivery(item.deliveryId, 'delivered'))}>标记已交付</button>}{item.status === 'delivered' && <><button className="btn btn-xs" onClick={() => void props.run(() => api.transitionDelivery(item.deliveryId, 'accepted', 'Owner 确认客户接受'))}>接受</button><button className="btn btn-xs" onClick={() => void props.run(() => api.transitionDelivery(item.deliveryId, 'rejected', 'Owner 确认交付未通过'))}>未通过</button></>}</div>)}
        <form className="org-inline-form" onSubmit={event => { event.preventDefault(); const selected = linkedMissions.find(m => m.missionId === revenueMission); const primaryQianjiId = selected?.participants[0]?.qianjiId; if (!primaryQianjiId) return; void props.run(() => api.createRevenue({ externalTxId, amountFen: revenueAmount, productId: product.productId, missionId: revenueMission, primaryQianjiId, evidenceRef: revenueRef, idempotencyKey: key() })); }}><label>完成 Mission<select value={revenueMission} onChange={e => setRevenueMission(e.target.value)}><option value="">选择完成任务</option>{linkedMissions.filter(m => m.status === 'completed').map(m => <option key={m.missionId} value={m.missionId}>{m.title}</option>)}</select></label><label>外部交易编号<input value={externalTxId} onChange={e => setExternalTxId(e.target.value)} placeholder="支付平台/银行记录中的编号" required /></label><label>确认收款（分）<input type="number" min={1} value={revenueAmount} onChange={e => setRevenueAmount(Number(e.target.value))} /></label><label>本地凭据索引<input value={revenueRef} onChange={e => setRevenueRef(e.target.value)} required /></label><button className="btn btn-xs" disabled={!revenueMission || !externalTxId.trim() || !revenueRef.trim() || revenueAmount < 1}>Owner 确认已收款</button></form>
        <h4>收款与退款</h4>{props.revenues.filter(row => row.productId === product.productId).map(revenue => { const refundable = (revenue.amountFen ?? 0) - revenue.refundFen; return <div className="org-revenue-row" key={revenue.externalTxId}><span>{revenue.externalTxId} · {revenue.verified ? `${revenue.amountFen} 分；退款 ${revenue.refundFen} 分；Owner确认；来源 ${revenue.recordSource}；凭据 ${revenue.evidenceRef ?? '未知'}（外部流水未自动核验）` : '旧记录待核对，不计入已验证收入'}</span>{revenue.verified && refundable > 0 && <><label>退款分<input aria-label={`${revenue.externalTxId} 退款分`} type="number" min={1} max={refundable} value={refundAmounts[revenue.externalTxId] ?? 1} onChange={e => setRefundAmounts(current => ({ ...current, [revenue.externalTxId]: Number(e.target.value) }))} /></label><label>退款原因<input aria-label={`${revenue.externalTxId} 退款原因`} value={refundReasons[revenue.externalTxId] ?? ''} onChange={e => setRefundReasons(current => ({ ...current, [revenue.externalTxId]: e.target.value }))} required /></label><label>退款凭据索引<input aria-label={`${revenue.externalTxId} 退款凭据索引`} value={refundRefs[revenue.externalTxId] ?? ''} onChange={e => setRefundRefs(current => ({ ...current, [revenue.externalTxId]: e.target.value }))} required /></label><button className="btn btn-xs" disabled={(refundAmounts[revenue.externalTxId] ?? 1) < 1 || !refundReasons[revenue.externalTxId]?.trim() || !refundRefs[revenue.externalTxId]?.trim()} onClick={() => void props.run(() => api.createRefund(revenue.externalTxId, { refundId: `refund-${key()}`, amountFen: refundAmounts[revenue.externalTxId] ?? 1, reason: refundReasons[revenue.externalTxId], evidenceRef: refundRefs[revenue.externalTxId], idempotencyKey: key() }))}>Owner 记录退款</button></>}</div>; })}
      </div>}
    </div>
  </section>;
}

function ArchiveHall({ items }: { items: QianjiListItemDto[] }) {
  const [selectedId, setSelectedId] = useState(''); const [history, setHistory] = useState<QianjiHistoryDto | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId) { setHistory(null); return; }
    const controller = new AbortController();
    void fetchQianjiHistory(selectedId, controller.signal).then(value => { setHistory(value); setError(null); })
      .catch(err => { if (!controller.signal.aborted) setError(textOf(err)); });
    return () => controller.abort();
  }, [selectedId]);
  return <section className="org-panel"><div className="org-panel-title"><div><p className="qj-eyebrow">档案殿</p><h2>退役人物</h2></div><span>{items.length} 位</span></div>
    {items.map(item => <article className="org-card" key={item.profile.qianjiId}><div className="org-card-head"><div><h3>{item.profile.narrative.displayName}</h3><small>{item.profile.qianjiId} · 人设 revision {item.profile.narrativeRevision}</small></div><b>{item.profile.retiredAt ? new Date(item.profile.retiredAt * 1000).toLocaleString() : '时间未知'}</b></div><p>退役原因：{item.profile.retiredReason || '未记录'}</p><p className="org-muted">绑定历史 {item.bindingHistory.length} 条</p><button className="btn btn-xs" type="button" onClick={() => setSelectedId(item.profile.qianjiId)}>{selectedId === item.profile.qianjiId ? '刷新履历' : '查看履历和归档'}</button></article>)}
    {error && <p className="org-error-text" role="alert">{error}</p>}{history && <div className="org-archive-history"><h3>{items.find(item => item.profile.qianjiId === selectedId)?.profile.narrative.displayName ?? selectedId} · 履历与归档</h3><p>人物成本 {history.attributed.costSummary.totalCostCny === null ? `未知（已知 ${history.attributed.costSummary.knownCostCny.toFixed(4)} CNY）` : `${history.attributed.costSummary.totalCostCny.toFixed(4)} CNY`}</p>{history.artifacts.archives.map(archive => <section key={archive.bindingId}><h4>{archive.pixelId} · {archive.files.length} 个归档文件</h4>{archive.files.map(file => <p className="org-row" key={`${archive.bindingId}-${file.name}`}><a href={qianjiArtifactUrl(selectedId, archive.bindingId, file.name)} download>{file.name}</a><small>{file.size} bytes</small></p>)}</section>)}</div>}
    {items.length === 0 && <p className="org-muted">目前没有退役人物。</p>}</section>;
}

function ChroniclePanel({ items, missions, products, members, run }: { items: ChronicleDto['narratives']; missions: MissionDto[]; products: ProductDto[]; members: QianjiListItemDto[]; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const date = new Date(); const toDefault = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); const fromDate = new Date(date.getTime() - 24 * 60 * 60 * 1000); const fromDefault = new Date(fromDate.getTime() - fromDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [from, setFrom] = useState(fromDefault); const [to, setTo] = useState(toDefault); const [qianjiId, setQianjiId] = useState(''); const [missionId, setMissionId] = useState(''); const [productId, setProductId] = useState('');
  const [facts, setFacts] = useState<ChronicleEventDto[]>([]); const [factsError, setFactsError] = useState<string | null>(null); const [loadingFacts, setLoadingFacts] = useState(false);
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [eventIds, setEventIds] = useState(''); const [missionIds, setMissionIds] = useState(''); const [narrativeKey, setNarrativeKey] = useState(key()); const [exportPreview, setExportPreview] = useState<any>(null);
  const queryFacts = async (event: React.FormEvent) => {
    event.preventDefault(); setLoadingFacts(true); setFactsError(null);
    try { const result = await api.listChronicle({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), qianjiId: qianjiId || undefined, missionId: missionId || undefined, productId: productId || undefined }); setFacts(result.events); }
    catch (err) { setFactsError(textOf(err)); } finally { setLoadingFacts(false); }
  };
  const download = async () => { try { const data = await api.exportFacts(new Date(from).toISOString(), new Date(to).toISOString()); setExportPreview(data); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'emergentinc-facts.json'; anchor.click(); URL.revokeObjectURL(url); } catch (err) { setExportPreview({ error: textOf(err) }); } };
  const addSourceEvent = (eventId: string) => setEventIds(current => [...new Set([...current.split(',').map(value => value.trim()).filter(Boolean), eventId])].join(', '));
  return <section className="org-panel"><div className="org-panel-title"><div><p className="qj-eyebrow">事实与叙事</p><h2>纪事、导出和 Muse 回导</h2></div><span>回导只写叙事表</span></div>
    <form className="org-filter-form" onSubmit={event => void queryFacts(event)}><label>从<input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} required /></label><label>到<input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} required /></label>
      <label>人物<select value={qianjiId} onChange={e => setQianjiId(e.target.value)}><option value="">全部人物</option>{members.map(item => <option key={item.profile.qianjiId} value={item.profile.qianjiId}>{item.profile.narrative.displayName}</option>)}</select></label>
      <label>任务<select value={missionId} onChange={e => setMissionId(e.target.value)}><option value="">全部 Mission</option>{missions.map(item => <option key={item.missionId} value={item.missionId}>{item.title}</option>)}</select></label>
      <label>产品<select value={productId} onChange={e => setProductId(e.target.value)}><option value="">全部产品</option>{products.map(item => <option key={item.productId} value={item.productId}>{item.name}</option>)}</select></label>
      <button className="btn btn-xs" disabled={loadingFacts}>{loadingFacts ? '查询中…' : '查询事实'}</button><button className="btn btn-xs btn-primary" type="button" onClick={() => void download()}>导出事实 JSON</button></form>
    {factsError && <p className="org-error-text" role="alert">{factsError}</p>}{exportPreview && <p className="org-muted">{exportPreview.error || `事件 ${exportPreview.events?.length ?? 0} 条 · 省略原文 ${exportPreview.omittedCounts?.privateFeedbackText ?? 0} 条 · 收款 ${(exportPreview.businessMetrics?.confirmedRevenueFen ?? 0).toLocaleString()} 分`}</p>}
    <div className="org-fact-list"><h3>Facts · {facts.length} 条</h3>{facts.map(item => <article className="org-fact" key={item.eventId}><div><b>{item.eventType}</b><time>{new Date(item.createdAt * 1000).toLocaleString()}</time></div><p>{item.subjectType} · <button type="button" className="org-source-link" onClick={() => { addSourceEvent(item.eventId); if (item.subjectType === 'mission') setMissionIds(current => [...new Set([...current.split(',').map(value => value.trim()).filter(Boolean), item.subjectId])].join(', ')); }}>{item.subjectId}</button>{item.qianjiId && ` · 人物 ${item.qianjiId}`}</p><code>{JSON.stringify(item.payload)}</code></article>)}{facts.length === 0 && <p className="org-muted">没有匹配的事实；请查询时间范围或筛选项。</p>}</div>
    <form className="org-form" onSubmit={event => { event.preventDefault(); void run(async () => { await api.createNarrativeArtifact({ title, body, sourceEventIds: eventIds.split(',').map(s => s.trim()).filter(Boolean), sourceMissionIds: missionIds.split(',').map(s => s.trim()).filter(Boolean), idempotencyKey: narrativeKey }); setNarrativeKey(key()); }); }}><h3>保存 Muse 内容草稿</h3><label>标题<input value={title} onChange={e => setTitle(e.target.value)} required /></label><label>正文<textarea value={body} onChange={e => setBody(e.target.value)} required /></label><label>来源 Event ID<input value={eventIds} onChange={e => setEventIds(e.target.value)} placeholder="逗号分隔，可留空" /></label><label>来源 Mission ID<input value={missionIds} onChange={e => setMissionIds(e.target.value)} placeholder={`可用任务：${missions.map(m => m.missionId).slice(0, 3).join(', ')}`} /></label><button className="btn btn-xs">保存叙事草稿</button></form>
    <div className="org-narratives"><h3>Narrative · 已保存草稿</h3>{items.map(item => <article className="org-card" key={item.artifactId}><h4>{item.title} · revision {item.contentRevision}</h4><p className="org-story-body">{item.body}</p><small>来源 Event {item.sourceEventIds.join(', ') || '无'} · Mission {item.sourceMissionIds.join(', ') || '无'}</small></article>)}</div>
  </section>;
}
