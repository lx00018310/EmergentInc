import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/client';
import { ownerError, ownerGoalRequest } from '../../api/owner';
import { language, t } from '../../i18n';

interface CompanyCard {
  id: string; pluginId: string; viewKey: string; title: string; titleZh: string;
  visible: boolean; enabled: boolean; activeHash: string | null; previousHash: string | null;
  revision: number; incompatible: boolean; assetsUrl: string | null; detailUrl: string | null; updatedAt: number;
}
interface CardAction { action: 'show' | 'hide' | 'rollback'; expectedRevision: number; idempotencyKey: string }

/** Sandboxed plugin frame: opaque origin, postMessage bridge with a per-load nonce, no direct owner API access. */
function CardFrame({ card, variant, nonce }: { card: CompanyCard; variant: 'card' | 'detail'; nonce: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const pluginId = card.pluginId, handle = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || typeof event.data !== 'object' || event.data === null) return;
      const message = event.data as Record<string, unknown>;
      if (message.bridge !== nonce || typeof message.requestId !== 'string') return;
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
  return <iframe ref={frame} sandbox="allow-scripts" title={`${t('Company card ' + card.id)} ${variant}`} src={src} className="boss-plugin-frame" />;
}

export function BossPluginCards() {
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
  if (detail) return <section aria-label={t('Company card ' + detail.id)}>
    <p><button onClick={() => { nonce.current = crypto.randomUUID(); setDetail(undefined); }}>{t('Back to cards')}</button></p>
    <h3>#{detail.id} {label(detail)}</h3>
    {detail.enabled ? <CardFrame card={detail} variant="detail" nonce={nonce.current} /> : <p className="boss-quiet">{t('PLUGIN_CARD_UNAVAILABLE')}</p>}
  </section>;
  return <section aria-label={t('Company cards')}>
    <h3>{t('Company cards')}</h3>
    {!!error && <p role="alert">{error} <button onClick={() => void refresh()}>{t('Retry')}</button></p>}
    {cards && !cards.length && <p className="boss-quiet">{t('Waiting for the boss to develop cards.')}</p>}
    {cards && !!cards.filter(c => c.visible).length && <div className="boss-plugin-grid">
      {cards.filter(c => c.visible).map(card => <article key={card.id} className="boss-plugin-card">
        <header><strong>#{card.id}</strong> {label(card)}</header>
        {card.enabled && card.assetsUrl ? <CardFrame card={card} variant="card" nonce={nonce.current} /> :
          <p className="boss-quiet">{card.incompatible ? t('PLUGIN_CARD_INCOMPATIBLE') : t('PLUGIN_CARD_UNAVAILABLE')}</p>}
        <footer>
          <button onClick={() => { setDetail(card); }}>{t('Open details')}</button>
          <button onClick={() => void act(card, 'hide')}>{t('Hide card')}</button>
        </footer>
      </article>)}
    </div>}
    {!!cards?.some(c => !c.visible) && <details><summary>{t('Hidden card library')}</summary>
      {cards.filter(c => !c.visible).map(card => <p key={card.id}>
        #{card.id} {label(card)} · <button onClick={() => void act(card, 'show')}>{t('Show card')}</button>
        {card.previousHash && <button onClick={() => void act(card, 'rollback')}>{t('Rollback card')}</button>}
      </p>)}
    </details>}
  </section>;
}
