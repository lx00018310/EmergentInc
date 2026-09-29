import { useState } from 'react';
import { recruitQianji, type QianjiProfileDto } from '../../api/qianji';

export function GachaView({ onBack, onOpenPerson }: { onBack: () => void; onOpenPerson?: (id: string) => void }) {
  const [profile, setProfile] = useState<QianjiProfileDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recruit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setProfile(await recruitQianji(globalThis.crypto.randomUUID()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return <div className="gacha-view">
    <header className="org-header"><div><p className="qj-eyebrow">天机阁</p><h1>招募人物</h1>
      <span>出生只留下一个起点，之后由对话和经历决定。</span></div>
      <button className="btn btn-sm" onClick={onBack}>返回天机阁</button></header>
    <main className="gacha-layout">
      <section className="org-panel gacha-controls">
        <div className="org-panel-title"><h2>新人物</h2></div>
        <p>招募后自动创建并绑定运行载体，可立即开始对话。</p>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void recruit()}>
          {busy ? '招募中…' : '招募一位人物'}</button>
        {error && <p role="alert" className="org-error-text">{error}</p>}
      </section>
      <section className="gacha-results" aria-label="招募结果">
        {!profile && <div className="qj-panel-placeholder">点击招募，认识一位新人物。</div>}
        {profile?.birthIdentity && <article className="org-card">
          <h2>{profile.narrative.displayName}</h2>
          <p>{profile.birthIdentity.primaryHexagram} → {profile.birthIdentity.changedHexagram}</p>
          <p>动爻：第 {profile.birthIdentity.movingLine} 爻</p>
          <p>{profile.birthIdentity.birthText}</p>
          {onOpenPerson && <button className="btn btn-primary" type="button"
            onClick={() => onOpenPerson(profile.qianjiId)}>开始对话</button>}
        </article>}
      </section>
    </main>
  </div>;
}
