import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiRequest } from '../../api/client';
import { ownerError, ownerGoalRequest } from '../../api/owner';
import { language, t, useLanguage } from '../../i18n';
import { BossCompanyCard, BossCompanyDialog } from './BossCompanyCard';
import { BossDetailSection } from './BossDetailLayout';

interface CompanyCard {
  id: string; pluginId: string; viewKey: string; title: string; titleZh: string;
  visible: boolean; enabled: boolean; activeHash: string | null; previousHash: string | null;
  revision: number; incompatible: boolean; assetsUrl: string | null; detailUrl: string | null; updatedAt: number;
}
interface CardAction { action: 'show' | 'hide' | 'rollback'; expectedRevision: number; idempotencyKey: string }

/** Sandboxed plugin frame: opaque origin, postMessage bridge with a per-load nonce, no direct owner API access. */
function CardFrame({ card, variant, nonce }: { card: CompanyCard; variant: 'card' | 'detail'; nonce: string }) {
  const currentLanguage = useLanguage();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  useEffect(() => {
    const pluginId = card.pluginId, handle = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || typeof event.data !== 'object' || event.data === null) return;
      const message = event.data as Record<string, unknown>;
      if (message.bridge !== nonce) return;
      if (message.kind === 'RESIZE') {
        if (variant === 'card' && typeof message.height === 'number' && Number.isFinite(message.height)) setHeight(Math.max(80, Math.min(1200, message.height)));
        return;
      }
      if (typeof message.requestId !== 'string') return;
      if (message.kind === 'GET_DATA') {
        void apiRequest<unknown>(`owner/plugins/${encodeURIComponent(pluginId)}/data`, {
          worldScoped: false, method: 'POST', body: JSON.stringify({ resource: String(message.resource ?? ''), cardId: card.id, version: card.activeHash, nonce }),
        }).then(data => frame.current?.contentWindow?.postMessage({ bridge: nonce, requestId: message.requestId, kind: 'DATA', data }, '*'))
          .catch(error => frame.current?.contentWindow?.postMessage({ bridge: nonce, requestId: message.requestId, kind: 'ERROR', error: ownerError(error) }, '*'));
      } else frame.current?.contentWindow?.postMessage({ bridge: nonce, requestId: message.requestId, kind: 'ERROR', error: t('UNSUPPORTED_BRIDGE_REQUEST') }, '*');
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [card.id, card.activeHash, card.pluginId, nonce, variant]);
  const src = variant === 'card' ? card.assetsUrl : card.detailUrl;
  if (!src) return <p className="boss-quiet">{t('PLUGIN_CARD_UNAVAILABLE')}</p>;
  const context = new URLSearchParams({ bridge: nonce, language: currentLanguage });
  return <iframe key={currentLanguage} ref={frame} sandbox="allow-scripts" title={`${t('Company card {0}', [card.id])} ${variant}`} src={`${src}#${context}`} className={`boss-plugin-frame boss-plugin-frame--${variant}`}
    style={variant === 'card' ? { height } : undefined} tabIndex={variant === 'card' ? -1 : 0} aria-hidden={variant === 'card' ? true : undefined}
    onLoad={() => frame.current?.contentWindow?.postMessage({ kind: 'HOST_CONTEXT', bridge: nonce, language: currentLanguage, detailSections: ['overview', 'progress', 'stages', 'items'] }, '*')} />;
}

export function BossPluginCards({ children }: { children?: ReactNode }) {
  useLanguage();
  const [cards, setCards] = useState<CompanyCard[]>(), [error, setError] = useState(''), [detail, setDetail] = useState<CompanyCard>();
  const nonce = useRef(crypto.randomUUID());
  const refresh = useCallback(async () => {
    try { setCards((await apiRequest<{ items: CompanyCard[] }>('owner/plugins/cards', { worldScoped: false })).items); setError(''); }
    catch (e) { setError(ownerError(e)); }
  }, []);
  useEffect(() => { nonce.current = crypto.randomUUID(); void refresh(); }, [refresh]);
  async function act(card: CompanyCard, action: CardAction['action']) {
    try {
      await ownerGoalRequest(`plugins/cards/${encodeURIComponent(card.id)}/actions`, 'POST',
        { action, expectedRevision: card.revision, idempotencyKey: crypto.randomUUID() });
      nonce.current = crypto.randomUUID(); setDetail(undefined); await refresh();
    } catch (e) { setError(ownerError(e)); }
  }
  const label = (card: CompanyCard) => language() === 'en' ? card.title : card.titleZh;
  return <section aria-label={t('Company cards')}>
    {!!error && <p role="alert">{error} <button onClick={() => void refresh()}>{t('Retry')}</button></p>}
    {cards && !cards.length && !children && <p className="boss-quiet">{t('Waiting for the boss to develop cards.')}</p>}
    <div className="boss-company-grid">
      {children}
      {cards?.filter(c => c.visible).map(card => <BossCompanyCard key={card.id} id={`plugin:${card.id}`} topic={t('Company card {0}', [card.id])} title={label(card)} onOpen={() => setDetail(card)} menu={
        <details className="boss-company-card-menu"><summary aria-label={t('Card options')}>···</summary><div><button onClick={() => void act(card, 'hide')}>{t('Hide card')}</button></div></details>
      }>
        {card.enabled && card.assetsUrl ? <CardFrame card={card} variant="card" nonce={nonce.current} /> :
          <p className="boss-quiet">{card.incompatible ? t('PLUGIN_CARD_INCOMPATIBLE') : t('PLUGIN_CARD_UNAVAILABLE')}</p>}
      </BossCompanyCard>)}
    </div>
    {!!cards?.some(c => !c.visible) && <details className="boss-company-library"><summary>{t('Hidden card library')}</summary>
      {cards.filter(c => !c.visible).map(card => <p key={card.id}>
        #{card.id} {label(card)} · <button onClick={() => void act(card, 'show')}>{t('Show card')}</button>
        {card.previousHash && <button onClick={() => void act(card, 'rollback')}>{t('Rollback card')}</button>}
      </p>)}
    </details>}
    {detail && <BossCompanyDialog id={`plugin:${detail.id}`} title={label(detail)} sections={[t('Overview'),t('Detailed view')]} onClose={() => setDetail(undefined)}>
      <BossDetailSection number={1} title={t('Overview')}><p>{label(detail)}</p></BossDetailSection>
      <BossDetailSection number={2} title={t('Detailed view')}>
        {detail.enabled ? <CardFrame card={detail} variant="detail" nonce={nonce.current} /> : <p className="boss-quiet">{t('PLUGIN_CARD_UNAVAILABLE')}</p>}
      </BossDetailSection>
    </BossCompanyDialog>}
  </section>;
}
