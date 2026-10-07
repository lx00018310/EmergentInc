import { t as tr, useLanguage, language, type Language } from '../../i18n';
import React, { useEffect, useRef, useState } from 'react';
import { askOwner, type OwnerChatTurn } from '../../api/ownerChat';
import { ApiError } from '../../api/client';
import { askMissionOwner, ownerError, type OwnerActionProposal, type OwnerWork as Work } from '../../api/owner';
import { OwnerActionCard } from './OwnerActionCard';
import { OwnerMarkdown } from './OwnerMarkdown';
import { OwnerWork } from './OwnerWork';

const STORAGE_KEY = 'emergentinc.ownerChat.history';
const PENDING_KEY = 'emergentinc.ownerChat.pending';
type Pending={question:string;history:OwnerChatTurn[];key:string;language:Language};
function loadPending():Pending|null {try{const p=JSON.parse(localStorage.getItem(PENDING_KEY)||'null');return p&&typeof p.question==='string'&&p.question.length<=2000&&typeof p.key==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(p.key)&&['en','zh-CN'].includes(p.language)&&Array.isArray(p.history)&&p.history.length<=12&&p.history.every((t:any)=>t&&['user','assistant'].includes(t.role)&&typeof t.content==='string'&&t.content.length<=4000)?p:null;}catch{return null;}}
type Message = OwnerChatTurn & { proposals?: OwnerActionProposal[]; sources?: string[]; as_of?: string; usage?: { tokens: number | null; cost_cny: number | null } };

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

export const OwnerChat: React.FC<{missionControl?:boolean;onDone?:()=>void;work?:Work}> = ({missionControl=false,onDone,work}) => {
  useLanguage();
  const [messages, setMessages] = useState<Message[]>(loadHistory);
  const [draft, setDraft] = useState(()=>missionControl?loadPending()?.question??'':'');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const pending = useRef<Pending|null>(missionControl?loadPending():null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40))); } catch { /* 浏览器存储不可用时仅保留当前页面 */ }
    if (messages.at(-1)?.role === 'assistant') answerRef.current?.scrollIntoView?.({ block: 'start' });
    else endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  const send = async () => {
    const question = draft.trim();
    if (!question || busy) return;
    const retry=missionControl&&pending.current?.question===question;
    const history = retry?pending.current!.history:messages.slice(-12).map(({ role, content }) => ({ role, content: content.slice(0, 4000) }));
    if(missionControl&&!retry){pending.current={question,history,key:crypto.randomUUID(),language:language()};try{localStorage.setItem(PENDING_KEY,JSON.stringify(pending.current));}catch{/* The server still deduplicates the current request. */}}
    if(!retry)setMessages(previous => [...previous, { role: 'user' as const, content: question }].slice(-40));
    setDraft('');
    setError(null);
    setBusy(true);
    try {
      const response = missionControl ? await askMissionOwner(question, history,pending.current!.key,pending.current!.language) : await askOwner(question, history);
      setMessages(previous => [...previous, {
        role: 'assistant' as const, content: response.answer, sources: response.sources,
        as_of: response.as_of, usage: response.usage, proposals: 'proposals' in response ? response.proposals as OwnerActionProposal[] : undefined,
      }].slice(-40));
      pending.current=null;if(missionControl)try{localStorage.removeItem(PENDING_KEY);}catch{/* The response is already recorded by the server. */}onDone?.();
    } catch (err) {
      if(missionControl)setDraft(question);
      setError(missionControl ? ownerError(err) : err instanceof ApiError
        ? (err.status === 404 ? (tr("当前服务尚未加载老板窗口接口；请在运行结束后重启服务。")) : err.detail)
        : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="owner-chat">
      <div className="owner-chat-history" aria-label={tr("老板窗口对话记录")}>
        {messages.length === 0 && <p className="form-hint">{tr(missionControl ? 'Describe a goal to assign work by role, or request energy changes directly. Recruitment, external publication and software upgrades require Owner approval.' : "可询问项目进度、运行状态和 Pixel 工作。回答会读取提问时的最新数据，并列出依据。")}</p>}
        {messages.map((message, index) => (
          <div className={`owner-chat-message ${message.role}`} key={index} ref={message.role === 'assistant' && index === messages.length - 1 ? answerRef : undefined}>
            <strong>{message.role === 'user' ? (tr("老板")) : (tr("助手"))}</strong>
            {message.role === 'assistant' ? <OwnerMarkdown content={message.content} /> : <div className="owner-chat-content">{message.content}</div>}
            {message.role === 'assistant' && (
              <div className="owner-chat-evidence">
                {message.as_of && <div>{tr("读取时间：")}{new Date(message.as_of).toLocaleString()}</div>}
                {message.sources && message.sources.length > 0 && <div>{tr("依据：")}{message.sources.join('、')}</div>}
                {message.usage?.tokens != null && <div>{tr("本次消耗：")}{message.usage.tokens} Tokens</div>}
              </div>
            )}
            {missionControl && message.proposals?.map(p=><OwnerActionCard key={p.id} proposal={p} onDone={onDone}/>)}
          </div>
        ))}
        {busy && <p role="status">{tr("正在读取并回答...")}</p>}
        <div ref={endRef} />
      </div>
      {missionControl&&<OwnerWork work={work}/>}
      {error && <p className="operation-error" role="alert">{error}</p>}
      <div className="owner-chat-compose">
        <textarea
          className="modal-textarea"
          aria-label={tr("向老板窗口提问")}
          placeholder={tr("例如：目前项目进展到什么程度了？")}
          value={draft}
          maxLength={2000}
          rows={3}
          disabled={busy}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }}
        />
        <div className="owner-chat-actions">
          <span className="form-hint">{tr("Ctrl + Enter 发送 · 记录保存在本机浏览器")}</span>
          <button className="btn btn-sm btn-secondary" disabled={busy || messages.length === 0} onClick={() => { setMessages([]); setError(null); }}>{tr("清空对话")}</button>
          <button className="btn btn-sm btn-primary" disabled={busy || !draft.trim()} onClick={() => void send()}>{tr("发送")}</button>
        </div>
      </div>
    </div>
  );
};
