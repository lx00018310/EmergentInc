import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { drawGacha, generateGachaImage, getGacha, listGachaHistory, retryGacha, type GachaHistoryPage, type GachaResult } from '../../api/gacha';
import { importQianjiPortraitUrl, qianjiPortraitUrl, uploadQianjiPortrait, type QianjiProfileDto } from '../../api/qianji';

const keys = ['谋', '察', '决', '行', '言', '创', '韧', '学'];
const labels: Record<string, string> = { appointed: '阁主钦点', github: 'GitHub 访贤', random: '天机随机' };
const rarityTitle: Record<string, string> = { N: '璞玉待琢', R: '中流砥柱', SR: '出类拔萃', SSR: '天纵奇才' };
const makeKey = () => globalThis.crypto?.randomUUID?.() ?? `draw-${Date.now()}`;

function Radar({ values }: { values: Record<string, number> }) {
  const point = (index: number, value: number) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 4;
    const radius = 12 + (Math.max(0.5, Math.min(2, value)) - 0.5) * 37;
    return `${(60 + Math.cos(angle) * radius).toFixed(1)},${(60 + Math.sin(angle) * radius).toFixed(1)}`;
  };
  return <svg className="gacha-radar" viewBox="0 0 120 120" role="img" aria-label={keys.map(key => `${key} ${values[key]}`).join('、')}>
    {[0.5, 1, 1.5, 2].map(level => <polygon key={level} points={keys.map((_, index) => point(index, level)).join(' ')} fill="none" stroke="rgba(140,170,204,.24)" />)}
    <polygon points={keys.map((key, index) => point(index, values[key] ?? 0.5)).join(' ')} fill="rgba(98,190,220,.22)" stroke="#88d9ed" strokeWidth="1.5" />
    {keys.map((key, index) => { const [x, y] = point(index, 2); return <text key={key} x={Number(x)} y={Number(y)} textAnchor="middle" fill="#f4ddb2" fontSize="9">{key}</text>; })}
  </svg>;
}

function PortraitImport({ profile, onUpdated }: { profile: QianjiProfileDto; onUpdated: (result: GachaResult) => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => onUpdated(await getGacha(profile.qianjiId));
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError('只支持不超过 2 MiB 的 PNG、JPEG 或 WebP 图片。'); event.target.value = ''; return;
    }
    setBusy(true); setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败'));
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
      });
      await uploadQianjiPortrait(profile.qianjiId, profile.narrativeRevision, file.type, dataUrl.split(',')[1] || '');
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); event.target.value = ''; }
  };
  const importUrl = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { await importQianjiPortraitUrl(profile.qianjiId, profile.narrativeRevision, url.trim()); await refresh(); setUrl(''); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <div className="gacha-import">
    <label className="btn btn-xs qj-upload-button">导入本地图片<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={upload} /></label>
    <form onSubmit={event => void importUrl(event)}><input type="url" aria-label="网络图片地址" placeholder="https://…/portrait.png" value={url} onChange={event => setUrl(event.target.value)} required maxLength={2048} /><button className="btn btn-xs" disabled={busy || !url.trim()}>导入网络图片</button></form>
    {error && <p role="alert" className="org-error-text">{error}</p>}
  </div>;
}

export function GachaView({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<'random' | 'appointed' | 'github'>('random');
  const [name, setName] = useState('');
  const [role, setRole] = useState('军师');
  const [concept, setConcept] = useState('');
  const [cards, setCards] = useState<GachaResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [tab, setTab] = useState<'draw' | 'atlas'>('draw');
  const [history, setHistory] = useState<GachaResult[]>([]);
  const [historyPage, setHistoryPage] = useState<GachaHistoryPage | null>(null);

  useEffect(() => {
    if (tab !== 'atlas' || historyPage) return;
    void listGachaHistory().then(page => { setHistory(page.items); setHistoryPage(page); })
      .catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [tab, historyPage]);

  useEffect(() => {
    const pending = cards.filter(item => item.profile.draw?.generationStatus === 'pending' || item.profile.draw?.imageStatus === 'generating');
    if (!pending.length) return;
    const timer = window.setInterval(() => {
      void Promise.all(pending.map(item => getGacha(item.profile.qianjiId))).then(results => {
        setCards(current => current.map(item => results.find(next => next.profile.qianjiId === item.profile.qianjiId) ?? item));
      }).catch(err => setError(err instanceof Error ? err.message : String(err)));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [cards]);

  const submit = async (count: 1 | 10) => {
    if (busy) return;
    setBusy(true); setError(null); setRevealed(false);
    try {
      const input = mode === 'random' ? { mode, count, idempotencyKey: makeKey() } as const
        : mode === 'appointed' ? { mode, count: 1 as const, name, role, concept, idempotencyKey: makeKey() }
          : { mode, count: 1 as const, role, idempotencyKey: makeKey() };
      const result = await drawGacha(input);
      setCards(result);
      setHistoryPage(null);
      setHistory([]);
      window.setTimeout(() => setRevealed(true), 450);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  return <div className="gacha-view">
    <header className="org-header"><div><p className="qj-eyebrow">天机阁 · 观星台</p><h1>点将</h1><span>数值由抽卡产生；小传是叙事生成。</span></div><button className="btn btn-sm" onClick={onBack}>返回天机阁</button></header>
    <nav className="org-tabs" aria-label="观星台页面"><button type="button" className={tab === 'draw' ? 'is-selected' : ''} onClick={() => setTab('draw')}>抽卡</button><button type="button" className={tab === 'atlas' ? 'is-selected' : ''} onClick={() => setTab('atlas')}>抽卡历史与图鉴</button></nav>
    {tab === 'atlas' ? <main className="gacha-atlas">
      <h2>图鉴 · {historyPage?.total ?? 0} 位</h2>
      {historyPage && <div className="gacha-counts">{(['N', 'R', 'SR', 'SSR'] as const).map(rarity => <span key={rarity}>{rarity} {historyPage.counts[rarity]}</span>)}</div>}
      <div className="gacha-atlas-grid">{history.map(item => <article className="org-card" key={item.profile.qianjiId}>
        {item.profile.narrative.portraitAsset && <img className="org-archive-portrait" src={qianjiPortraitUrl(item.profile.qianjiId)} alt={`${item.profile.narrative.displayName}画像`} />}
        <strong>{item.profile.narrative.displayName}</strong><span>{item.profile.draw?.rarity} · {item.profile.draw && labels[item.profile.draw.origin]}</span>
        {item.profile.draw && <><span>{keys.map(key => `${key}${item.profile.draw!.attributes[key]?.toFixed(1)}`).join(' / ')}</span>
          <span>{item.profile.draw.traitTags.join(' · ') || '暂无极值词条'}</span>
          {item.profile.draw.lineage.length > 0 && <span>师承：{item.profile.draw.lineage.join('、')}</span>}
          {item.profile.draw.cardPrompt && <details><summary>卡面 prompt</summary><pre className="gacha-prompt">{item.profile.draw.cardPrompt}</pre></details>}</>}
        <small>{item.profile.draw ? new Date(item.profile.draw.createdAt * 1000).toLocaleString() : ''}</small>
      </article>)}</div>
      {historyPage?.nextCursor && <button className="btn" onClick={() => void listGachaHistory(historyPage.nextCursor).then(page => { setHistory(current => [...current, ...page.items]); setHistoryPage(page); }).catch(err => setError(String(err)))}>加载更多</button>}
      {error && <p role="alert" className="org-error-text">{error}</p>}
    </main> :
    <main className="gacha-layout">
      <section className="org-panel gacha-controls"><div className="org-panel-title"><h2>人物来源</h2></div>
        <label>模式<select value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="random">天机随机</option><option value="appointed">阁主钦点</option><option value="github">GitHub 访贤</option></select></label>
        {mode !== 'random' && <label>职位<input value={role} onChange={event => setRole(event.target.value)} maxLength={80} /></label>}
        {mode === 'appointed' && <><label>姓名（可空）<input value={name} onChange={event => setName(event.target.value)} maxLength={80} /></label><label>一句话人设<textarea value={concept} onChange={event => setConcept(event.target.value)} maxLength={500} /></label></>}
        <div className="org-actions"><button className="btn btn-primary" disabled={busy || (mode !== 'random' && !role.trim()) || (mode === 'appointed' && !concept.trim())} onClick={() => void submit(1)}>{busy ? '抽取中…' : '单抽'}</button>{mode === 'random' && <button className="btn" disabled={busy} onClick={() => void submit(10)}>十连抽</button>}</div>
        {error && <p role="alert" className="org-error-text">{error}</p>}
      </section>
      <section className="gacha-results" aria-label="抽卡结果">
        {!cards.length && <div className="qj-panel-placeholder">选择模式，开始点将。</div>}
        {cards.map(item => { const { profile } = item; const draw = profile.draw; if (!draw) return null;
          return <article key={profile.qianjiId} className={`gacha-card rarity-${draw.rarity.toLowerCase()}${revealed ? ' revealed' : ''}`}>
            <div className="gacha-portrait">{profile.narrative.portraitAsset ? <img src={qianjiPortraitUrl(profile.qianjiId)} alt={`${profile.narrative.displayName}画像`} /> : <span>{draw.imageStatus === 'generating' ? '绘制中…' : draw.imageStatus === 'ready' ? '画像缺失' : '待绘'}</span>}</div>
            <div className="gacha-card-body"><div className="gacha-card-heading"><strong>{profile.narrative.displayName}</strong><b>{draw.rarity} · {rarityTitle[draw.rarity]}</b></div>
              <p>{profile.narrative.roleLabel} · {labels[draw.origin]}</p><Radar values={draw.attributes} />
              <div className="gacha-attributes">{keys.map(key => <span key={key}>{key} {draw.attributes[key]?.toFixed(1)}</span>)}</div>
              <p>{draw.traitTags.join(' · ') || '暂无极值词条'}</p><p>{profile.narrative.shortBio}</p>
              {draw.lineage.length > 0 && <p>师承：{draw.lineage.map(url => <a key={url} href={url} target="_blank" rel="noreferrer">{url.split('/').slice(-2).join('/')}</a>)}</p>}
              {draw.skillTags?.length > 0 && <p>技能：{draw.skillTags.join(' · ')}</p>}
              {draw.cardPrompt && <details><summary>卡面 prompt</summary><pre className="gacha-prompt">{draw.cardPrompt}</pre></details>}
              {draw.generationStatus === 'pending' && <p>人设生成中…</p>}
              {draw.generationStatus === 'failed' && <><p role="alert">生成人设失败：{item.error}</p><button className="btn btn-xs" onClick={() => void retryGacha(profile.qianjiId).then(result => setCards(current => current.map(card => card.profile.qianjiId === profile.qianjiId ? result : card))).catch(err => setError(String(err)))}>重试人设</button></>}
              {draw.generationStatus === 'ready' && !profile.narrative.portraitAsset && draw.imageStatus !== 'generating' && draw.imageStatus !== 'ready' && <button className="btn btn-xs" onClick={() => void generateGachaImage(profile.qianjiId).then(result => setCards(current => current.map(card => card.profile.qianjiId === profile.qianjiId ? result : card))).catch(err => setError(String(err)))}>{draw.imageStatus === 'failed' ? '重试画像' : '生成画像'}</button>}
              {draw.imageStatus === 'failed' && <p role="alert">画像生成失败：{draw.imageError}</p>}
              {profile.careerStatus !== 'retired' && <PortraitImport profile={profile} onUpdated={result => setCards(current => current.map(card => card.profile.qianjiId === profile.qianjiId ? result : card))} />}
            </div>
          </article>;
        })}
      </section>
    </main>
    }
  </div>;
}
