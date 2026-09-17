import React, { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { fetchMandate, updateMandate, deleteMandate, postExternalReward, fetchExternalRewards, fetchStepCosts } from '../../api/pixels';
import type { MandateDto, ExternalRewardDto, StepCostDto } from '../../api/types';

export type PixelOperationTab = 'mandate' | 'reward' | 'cost';
const titles: Record<PixelOperationTab, string> = {
  mandate: 'Human Mandate', reward: 'External Reward', cost: 'Step Cost',
};

export function knownNumber(value: number | null | undefined, money = false): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? money ? `¥${value.toFixed(6)}` : value.toLocaleString()
    : '未知';
}

export interface PixelOperationsProps {
  pixelId: string;
  initialTab: PixelOperationTab;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export const PixelOperations: React.FC<PixelOperationsProps> = ({ pixelId, initialTab, onClose, onRefresh }) => {
  const [tab, setTab] = useState(initialTab);
  const [revision, setRevision] = useState(0);
  const [mandate, setMandate] = useState<MandateDto | null>(null);
  const [draft, setDraft] = useState('');
  const [rewards, setRewards] = useState<ExternalRewardDto[] | null>(null);
  const [costs, setCosts] = useState<StepCostDto[] | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [source, setSource] = useState('human');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError(null);
    setMandate(null);
    setRewards(null);
    setCosts(null);
    const load = async () => {
      try {
        if (tab === 'mandate') {
          const data = await fetchMandate(pixelId, controller.signal);
          if (current) { setMandate(data); setDraft(data.mandate ?? ''); }
        } else if (tab === 'reward') {
          const data = await fetchExternalRewards(pixelId, controller.signal);
          if (current) setRewards(data.rewards);
        } else {
          const data = await fetchStepCosts(pixelId, controller.signal);
          if (current) setCosts(data.costs);
        }
      } catch (err) {
        if (current) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (current) setLoading(false);
      }
    };
    void load();
    return () => { current = false; controller.abort(); };
  }, [pixelId, tab, revision]);

  const mutate = async (action: 'save' | 'delete' | 'reward') => {
    if (busy) return;
    if (action === 'reward' && (!Number.isSafeInteger(Number(amount)) || Number(amount) <= 0)) {
      setError('奖励金额必须为正安全整数 Energy。');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      if (action === 'save') {
        const result = await updateMandate(pixelId, draft);
        setMandate(result);
        setDraft(result.mandate ?? '');
        setNotice('Human Mandate 已保存；仅更新独立 mandate.md，不改写 pixel.md。');
      } else if (action === 'delete') {
        await deleteMandate(pixelId);
        setMandate({ pixel_id: pixelId, mandate: null });
        setDraft('');
        setNotice('Human Mandate 已删除；Pixel Self 与既有历史保持不变。');
      } else {
        const result = await postExternalReward(pixelId, { amount: Number(amount), reason: reason.trim() || 'External Reward', source: source.trim() || 'human' });
        setAmount('');
        setNotice(`奖励已入账。新余额：${knownNumber(result.newBalance)} Energy。`);
        setRevision((n) => n + 1);
      }
      await onRefresh();
    } catch (err) {
      setError(`${err instanceof Error ? err.message : String(err)}${action === 'reward' ? '。若连接中断，结果可能已入账；请先刷新奖励记录核对，不要直接重复提交。' : ''}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen title={`元胞 ${pixelId} · V11 操作与观察`} onClose={() => { if (!busy) onClose(); }} contentClassName="pixel-operations">
      <div className="operation-tabs" role="tablist" aria-label="元胞操作与观察">
        {(Object.keys(titles) as PixelOperationTab[]).map((item) => (
          <button key={item} role="tab" aria-selected={tab === item} className={`btn btn-sm ${tab === item ? 'btn-primary' : ''}`} disabled={busy} onClick={() => { setTab(item); setNotice(''); }}>{titles[item]}</button>
        ))}
        <button className="btn btn-sm" disabled={busy || loading} onClick={() => setRevision((n) => n + 1)}>刷新{tab === 'mandate' ? '（重新读取，覆盖草稿）' : '记录'}</button>
      </div>
      {loading && <p role="status">加载中…</p>}
      {error && <p className="operation-error" role="alert">{error}</p>}
      {notice && <p className="operation-notice" role="status">{notice}</p>}
      {tab === 'mandate' && <section className="operation-section">
        <p>独立 EXTERNAL 输入。保存供后续步骤读取，不会追溯改变已准备的调用；删除不清除 Pixel Self 或历史，也不创建固定职业。</p>
        <p>当前状态：{loading ? '加载中' : mandate ? mandate.mandate === null ? '未设置' : mandate.mandate.trim() ? '已设置' : '空内容（不注入）' : '未知'}</p>
        <label htmlFor="human-mandate">Human Mandate 内容</label>
        <textarea id="human-mandate" className="modal-textarea" rows={8} value={draft} disabled={busy || loading || !mandate} onChange={(e) => setDraft(e.target.value)} />
        <div className="operation-tabs">
          <button className="btn btn-primary" disabled={busy || loading || !mandate || draft === (mandate.mandate ?? '')} onClick={() => void mutate('save')}>保存 Human Mandate</button>
          <button className="btn btn-danger" disabled={busy || loading || !mandate || mandate.mandate === null} onClick={() => void mutate('delete')}>删除 Human Mandate</button>
        </div>
      </section>}
      {tab === 'reward' && <section className="operation-section">
        <p>External → Pixel 的 Energy 注入，不是工资或元胞间转账。每次提交都会新增一笔奖励，不能撤销。</p>
        <form onSubmit={(e) => { e.preventDefault(); void mutate('reward'); }}>
          <label htmlFor="reward-amount">奖励金额（Energy，正整数）</label>
          <input id="reward-amount" type="number" min="1" step="1" required value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
          <label htmlFor="reward-source">来源</label>
          <input id="reward-source" value={source} disabled={busy} onChange={(e) => setSource(e.target.value)} />
          <label htmlFor="reward-reason">原因</label>
          <input id="reward-reason" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !Number.isSafeInteger(Number(amount)) || Number(amount) <= 0} type="submit">发放 External Reward</button>
        </form>
        <h4>奖励记录</h4>
        {rewards?.length === 0 && <p>暂无奖励记录。</p>}
        {rewards && rewards.length > 0 && <div className="operation-table"><table><thead><tr><th>Round</th><th>Energy</th><th>来源</th><th>原因</th><th>事件 ID</th></tr></thead><tbody>
          {rewards.map((reward) => <tr key={reward.event_id}><td>{reward.round}</td><td>+{knownNumber(reward.amount)}</td><td>{reward.source}</td><td>{reward.reason}</td><td>{reward.event_id}</td></tr>)}
        </tbody></table></div>}
      </section>}
      {tab === 'cost' && <section className="operation-section">
        <p>单步模型调用成本（人民币）。未知或未计量值显示“未知”，不当作 0；缓存输入为输入中的缓存部分，不重复相加。真实 0 保留为 0。</p>
        {costs?.length === 0 && <p>暂无 Step Cost 记录；不代表成本为 0。</p>}
        {costs && costs.length > 0 && <div className="operation-table"><table><thead><tr><th>Round</th><th>输入 Tokens</th><th>缓存输入 Tokens</th><th>输出 Tokens</th><th>实际 Tokens</th><th>模型成本</th><th>工具成本</th><th>调用 / 状态</th></tr></thead><tbody>
          {costs.map((cost, i) => <tr key={cost.callId ?? `${cost.round}-${i}`}><td>{cost.round}</td><td>{knownNumber(cost.inputTokens)}</td><td>{knownNumber(cost.cachedInputTokens)}</td><td>{knownNumber(cost.outputTokens)}</td><td>{knownNumber(cost.actualTokens)}</td><td>{knownNumber(cost.modelCost, true)}</td><td>{knownNumber(cost.toolCost, true)}</td><td>{cost.callId ?? '未知'}<br />{cost.outcome ?? '未知'}{cost.runId && <><br />run: {cost.runId}</>}</td></tr>)}
        </tbody></table></div>}
      </section>}
    </Modal>
  );
};
