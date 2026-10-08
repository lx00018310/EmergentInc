import { t as tr, useLanguage } from '../../i18n';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchQianjiChat, postQianjiChat } from '../../api/qianji';
import type { QianjiChatTurnDto, QianjiListItemDto } from '../../api/qianji';
import { ApiError } from '../../api/client';

function requestKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `qchat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function blockedMessage(reason:string|null|undefined):string {
  if(reason==='WAITING_PIXEL_BUDGET')return tr("元胞能量不足，等待补充后重试。");
  if(['PAUSED_RECOVERY_REQUIRED','CALL_OUTCOME_UNKNOWN','TOOL_OUTCOME_UNKNOWN','AWAITING_SETTLEMENT'].includes(reason??''))return tr("存在未决调用，请进入 World 恢复处理后再运行。");
  if(reason==='ROUND_LIMIT_REACHED')return tr("本次轮数已用完，任务尚未回复。可在 World 中继续运行。");
  if(reason==='WAITING_RUN_BUDGET'||reason==='RUN_BUDGET_EXHAUSTED')return tr("本次 Run 额度已用完，任务尚未回复。");
  return tr("运行暂停，待处理");
}

export const QianjiChatPanel: React.FC<{
  item: QianjiListItemDto;
  onSent: () => Promise<void>;
  sendBlocked?: string | null;
}> = ({ item, onSent, sendBlocked }) => {
  useLanguage();
  const [turns, setTurns] = useState<QianjiChatTurnDto[]>([]);
  const [content, setContent] = useState('');
  const [rounds, setRounds] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const pendingRequest = useRef<{ question: string; key: string; rounds:number } | null>(null);
  const currentBinding = item.currentBinding;
  const canChat = Boolean((item.world?.status==='ACTIVE'||currentBinding) && item.physical?.active && (item.physical.refundDeficitTokens ?? 0) === 0 && item.profile.careerStatus !== 'retired') && !sendBlocked;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      setTurns(await fetchQianjiChat(item.profile.qianjiId, signal));
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof ApiError ? tr(err.detail) : err instanceof Error ? err.message : String(err));
    }
  }, [item.profile.qianjiId]);

  useEffect(() => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    void refresh(next.signal);
    const timer = setInterval(() => { void refresh(next.signal); }, 2500);
    return () => { clearInterval(timer); next.abort(); };
  }, [refresh]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const question = content.trim();
    if (!canChat || !question || [...question].length > 2000 || submitting || item.world&&(!Number.isSafeInteger(rounds)||rounds<1||rounds>20)) return;
    setSubmitting(true);
    try {
      if (!pendingRequest.current || pendingRequest.current.question !== question || pendingRequest.current.rounds !== rounds) {
        pendingRequest.current = { question, key: requestKey(), rounds };
      }
      await postQianjiChat(item.profile.qianjiId, question, pendingRequest.current.key, pendingRequest.current.rounds);
      pendingRequest.current = null;
      setContent('');
      setError(null);
      await refresh();
      await onSent();
    } catch (err) {
      setError(err instanceof ApiError ? tr(err.detail) : err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="qj-chat-panel" aria-label={tr("人物对话")}>
      <div className="qj-panel-heading"><h3>{tr("对话")}</h3><span>{tr("发送即启动 Run")}</span></div>
      {error && <p className="qj-inline-error" role="alert">{error}</p>}
      {item.world&&<p>{tr("发送后按指定轮数运行本 World，额度上限 100,000 Tokens；任务完成或阻塞时可提前停止。")}</p>}
      <div className="qj-chat-history" aria-live="polite">
        {turns.length === 0 && <p className="qj-empty">{tr("还没有对话记录。")}</p>}
        {turns.slice().reverse().map(turn => (
          <article className="qj-chat-turn" key={turn.turnId}>
            <p className="qj-chat-question"><b>{tr("阁主")}</b>{turn.question}</p>
            {turn.status === 'replied' && turn.reply !== null
              ? <p className="qj-chat-reply"><b>{item.profile.narrative.displayName}</b>{turn.reply}</p>
              : <p className={`qj-chat-state state-${turn.status}`}>{turn.status === 'queued' ? (tr("等待本轮处理")) : turn.status === 'processing' ? (tr("运行中")) : turn.status === 'no_reply' ? (tr("本次没有直接回复")) : turn.status === 'blocked' ? blockedMessage(turn.blockReason) : (tr("本次失败，可查看 Engine 状态"))}</p>}
            {turn.status==='blocked'&&item.world&&<a href={`/YUAN?world=${encodeURIComponent(item.world.world_id)}`}>{tr("查看 World 运行与恢复")}</a>}
          </article>
        ))}
      </div>
      <form onSubmit={submit} className="qj-chat-form">
        {item.world&&<label>{tr("运行轮数（1–20）")} <input type="number" min={1} max={20} value={rounds} onChange={event=>setRounds(Number(event.target.value))} disabled={!canChat||submitting}/></label>}
        <label htmlFor={`qj-chat-${item.profile.qianjiId}`}>{tr("发送给") + " "}{item.profile.narrative.displayName}</label>
        <textarea id={`qj-chat-${item.profile.qianjiId}`} value={content} onChange={event => setContent(event.target.value)} rows={3} maxLength={4000}
          placeholder={sendBlocked ?? (canChat ? (tr("输入问题或指令…")) : item.world?(tr("当前 World 没有活跃入口，请更换入口")):(tr("当前人物未绑定可运行的 Pixel")))} disabled={!canChat || submitting} />
        <div className="qj-form-footer"><small>{[...content].length}{tr("/2000 字")}</small><button className="btn btn-primary" type="submit" disabled={!canChat || submitting || !content.trim() || [...content].length > 2000 || Boolean(item.world&&(!Number.isSafeInteger(rounds)||rounds<1||rounds>20))}>{submitting ? (tr("正在发送…")) : (tr("发送"))}</button></div>
      </form>
    </section>
  );
};
