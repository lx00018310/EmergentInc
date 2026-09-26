import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchQianjiChat, postQianjiChat } from '../../api/qianji';
import type { QianjiChatTurnDto, QianjiListItemDto } from '../../api/qianji';

function requestKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `qchat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const QianjiChatPanel: React.FC<{ item: QianjiListItemDto; onQueued: () => void }> = ({ item, onQueued }) => {
  const [turns, setTurns] = useState<QianjiChatTurnDto[]>([]);
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const pendingRequest = useRef<{ question: string; key: string } | null>(null);
  const currentBinding = item.currentBinding;
  const canChat = Boolean(currentBinding && item.physical?.active && (item.physical.refundDeficitTokens ?? 0) === 0 && item.profile.careerStatus !== 'retired');

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      setTurns(await fetchQianjiChat(item.profile.qianjiId, signal));
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(err));
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
    if (!canChat || !question || [...question].length > 2000 || submitting) return;
    setSubmitting(true);
    try {
      if (!pendingRequest.current || pendingRequest.current.question !== question) {
        pendingRequest.current = { question, key: requestKey() };
      }
      await postQianjiChat(item.profile.qianjiId, question, pendingRequest.current.key);
      pendingRequest.current = null;
      setContent('');
      setError(null);
      await refresh();
      onQueued();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="qj-chat-panel" aria-label="人物对话">
      <div className="qj-panel-heading"><h3>对话</h3><span>发送后进入队列，需手动启动 Run</span></div>
      {error && <p className="qj-inline-error" role="alert">{error}</p>}
      <div className="qj-chat-history" aria-live="polite">
        {turns.length === 0 && <p className="qj-empty">还没有对话记录。</p>}
        {turns.slice().reverse().map(turn => (
          <article className="qj-chat-turn" key={turn.turnId}>
            <p className="qj-chat-question"><b>阁主</b>{turn.question}</p>
            {turn.status === 'replied' && turn.reply !== null
              ? <p className="qj-chat-reply"><b>{item.profile.narrative.displayName}</b>{turn.reply}</p>
              : <p className={`qj-chat-state state-${turn.status}`}>{turn.status === 'queued' ? '待运行' : turn.status === 'processing' ? '运行中' : turn.status === 'no_reply' ? '本次没有直接回复' : turn.status === 'blocked' ? '运行暂停，待处理' : '本次失败，可查看 Engine 状态'}</p>}
          </article>
        ))}
      </div>
      <form onSubmit={submit} className="qj-chat-form">
        <label htmlFor={`qj-chat-${item.profile.qianjiId}`}>发送给 {item.profile.narrative.displayName}</label>
        <textarea id={`qj-chat-${item.profile.qianjiId}`} value={content} onChange={event => setContent(event.target.value)} rows={3} maxLength={4000} placeholder={canChat ? '输入问题或指令…' : '当前人物未绑定可运行的 Pixel'} disabled={!canChat || submitting} />
        <div className="qj-form-footer"><small>{[...content].length}/2000 字</small><button className="btn btn-primary" type="submit" disabled={!canChat || submitting || !content.trim() || [...content].length > 2000}>{submitting ? '正在排队…' : '排队发送'}</button></div>
      </form>
    </section>
  );
};
