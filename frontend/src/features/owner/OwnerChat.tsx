import React, { useEffect, useRef, useState } from 'react';
import { askOwner, type OwnerChatTurn } from '../../api/ownerChat';
import { ApiError } from '../../api/client';

const STORAGE_KEY = 'emergentinc.ownerChat.history';
type Message = OwnerChatTurn & { sources?: string[]; as_of?: string; usage?: { tokens: number | null; cost_cny: number | null } };

function loadHistory(): Message[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Message =>
      item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string'
    ).slice(-40);
  } catch {
    return [];
  }
}

export const OwnerChat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>(loadHistory);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40))); } catch { /* 浏览器存储不可用时仅保留当前页面 */ }
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  const send = async () => {
    const question = draft.trim();
    if (!question || busy) return;
    const history = messages.slice(-12).map(({ role, content }) => ({ role, content: content.slice(0, 4000) }));
    setMessages(previous => [...previous, { role: 'user' as const, content: question }].slice(-40));
    setDraft('');
    setError(null);
    setBusy(true);
    try {
      const response = await askOwner(question, history);
      setMessages(previous => [...previous, {
        role: 'assistant' as const, content: response.answer, sources: response.sources,
        as_of: response.as_of, usage: response.usage,
      }].slice(-40));
    } catch (err) {
      setError(err instanceof ApiError
        ? (err.status === 404 ? '当前服务尚未加载老板窗口接口；请在运行结束后重启服务。' : err.detail)
        : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="owner-chat">
      <div className="owner-chat-history" aria-label="老板窗口对话记录">
        {messages.length === 0 && <p className="form-hint">可询问项目进度、运行状态和 Pixel 工作。回答会读取提问时的最新数据，并列出依据。</p>}
        {messages.map((message, index) => (
          <div className={`owner-chat-message ${message.role}`} key={index}>
            <strong>{message.role === 'user' ? '老板' : '助手'}</strong>
            <div className="owner-chat-content">{message.content}</div>
            {message.role === 'assistant' && (
              <div className="owner-chat-evidence">
                {message.as_of && <div>读取时间：{new Date(message.as_of).toLocaleString()}</div>}
                {message.sources && message.sources.length > 0 && <div>依据：{message.sources.join('、')}</div>}
                {message.usage?.tokens != null && <div>本次消耗：{message.usage.tokens} Tokens</div>}
              </div>
            )}
          </div>
        ))}
        {busy && <p role="status">正在读取并回答...</p>}
        <div ref={endRef} />
      </div>
      {error && <p className="operation-error" role="alert">{error}</p>}
      <div className="owner-chat-compose">
        <textarea
          className="modal-textarea"
          aria-label="向老板窗口提问"
          placeholder="例如：目前项目进展到什么程度了？"
          value={draft}
          maxLength={2000}
          rows={3}
          disabled={busy}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }}
        />
        <div className="owner-chat-actions">
          <span className="form-hint">Ctrl + Enter 发送 · 记录保存在本机浏览器</span>
          <button className="btn btn-sm btn-secondary" disabled={busy || messages.length === 0} onClick={() => { setMessages([]); setError(null); }}>清空对话</button>
          <button className="btn btn-sm btn-primary" disabled={busy || !draft.trim()} onClick={() => void send()}>发送</button>
        </div>
      </div>
    </div>
  );
};
