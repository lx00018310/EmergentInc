import { useState } from 'react';
import { recruitQianji } from '../../api/qianji';

export function GachaView({ onBack, onOpenPerson }: { onBack: () => void; onOpenPerson?: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recruit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const profile = await recruitQianji(globalThis.crypto.randomUUID());
      if (onOpenPerson) onOpenPerson(profile.qianjiId); else onBack();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return <div className="gacha-view">
    <header className="org-header"><div><p className="qj-eyebrow">千机阁</p><h1>招募人物</h1>
      <span>出生只留下一个起点，之后由对话和经历决定。</span></div>
      <button className="btn btn-sm" onClick={onBack}>返回千机阁</button></header>
    <main className="gacha-layout">
      <section className="org-panel gacha-controls">
        <div className="org-panel-title"><h2>新人物</h2></div>
        <p>招募时人物会读自己的命核，给自己取名、写简介、给出画像提示词，随后直接进入对话。</p>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void recruit()}>
          {busy ? '正在招募…新人物正在取名' : '招募一位人物'}</button>
        {error && <p role="alert" className="org-error-text">{error}</p>}
      </section>
      <section className="gacha-results" aria-label="招募结果">
        <div className="qj-panel-placeholder">
          {busy ? '新人物正在取名，请稍候…' : '点击招募，认识一位新人物。'}
        </div>
      </section>
    </main>
  </div>;
}
