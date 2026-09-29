import React, { useEffect, useState } from 'react';
import { fetchQianjiList, type QianjiListItemDto } from '../../api/qianji';
import { createMeeting, listMeetings, postMeetingMessage, type MeetingDto } from '../../api/meetings';

export function MeetingView({ onBack }: { onBack: () => void }) {
  const [people, setPeople] = useState<QianjiListItemDto[]>([]);
  const [meetings, setMeetings] = useState<MeetingDto[]>([]);
  const [current, setCurrent] = useState<MeetingDto | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [topic, setTopic] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void Promise.all([fetchQianjiList(), listMeetings()]).then(([items, recent]) => {
      setPeople(items); setMeetings(recent);
    }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const meeting = await createMeeting(topic.trim(), selected);
      setCurrent(meeting); setMeetings(items => [meeting, ...items]); setTopic(''); setSelected([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!current) return;
    setBusy(true); setError(null);
    try {
      const meeting = await postMeetingMessage(current.meetingId, draft.trim());
      setCurrent(meeting); setMeetings(items => items.map(item => item.meetingId === meeting.meetingId ? meeting : item));
      setDraft('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <div className="gacha-view">
    <header className="org-header"><div><p className="qj-eyebrow">千机阁</p><h1>多人会议</h1>
      <span>每位人物依次发言，单次不超过 150 字。</span></div>
      <button className="btn btn-sm" onClick={onBack}>返回千机阁</button></header>
    <main className="gacha-layout">
      <section className="org-panel gacha-controls">
        <h2>发起会议</h2>
        <form onSubmit={create}>
          <label>议题<textarea value={topic} onChange={event => setTopic(event.target.value)}
            maxLength={500} required /></label>
          <p>选择 2～3 位人物</p>
          {people.filter(item => item.profile.careerStatus !== 'retired' && item.physical?.active)
            .map(item => <label key={item.profile.qianjiId}>
              <input type="checkbox" checked={selected.includes(item.profile.qianjiId)}
                disabled={!selected.includes(item.profile.qianjiId) && selected.length >= 3}
                onChange={event => setSelected(ids => event.target.checked ? [...ids, item.profile.qianjiId] :
                  ids.filter(id => id !== item.profile.qianjiId))} /> {item.profile.narrative.displayName}
            </label>)}
          <button className="btn btn-primary" disabled={busy || selected.length < 2 || !topic.trim()}>
            创建会议</button>
        </form>
        <h3>最近会议</h3>
        {meetings.map(meeting => <button className="btn btn-sm" type="button" key={meeting.meetingId}
          onClick={() => setCurrent(meeting)}>{meeting.topic}</button>)}
      </section>
      <section className="org-panel">
        {current ? <>
          <h2>{current.topic}</h2>
          <div aria-label="会议发言">{current.messages.map(message => <article className="qj-history-row"
            key={message.messageId}><strong>{message.speaker}</strong><p>{message.content}</p></article>)}</div>
          <form onSubmit={send}><label>继续讨论<textarea value={draft}
            onChange={event => setDraft(event.target.value)} maxLength={1000} required /></label>
            <button className="btn btn-primary" disabled={busy || !draft.trim()}>
              {busy ? '发言中…' : '发送并依次发言'}</button></form>
          <small>会议将消耗参与人物的 Token；仅传递议题及最近 6 条发言。</small>
        </> : <p className="qj-panel-placeholder">选择或创建会议。</p>}
        {error && <p role="alert" className="org-error-text">{error}</p>}
      </section>
    </main>
  </div>;
}
