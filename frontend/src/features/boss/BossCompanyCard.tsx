import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n';

/** Stable visual identity, independent of status, language and display order. */
export function companyCardTheme(id: string): CSSProperties {
  let hash = 0;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const themes: Record<string, number> = { budget: 38, team: 270, tasks: 185, orders: 330 };
  const hue = themes[id] ?? (hash >>> 0) % 360;
  return { '--card-accent': `hsl(${hue} 45% 32%)`, '--card-tint': `hsl(${hue} 55% 95%)`, '--card-line': `hsl(${hue} 35% 78%)` } as CSSProperties;
}

export function BossCompanyCard({ id, title, topic, status, onOpen, children, menu }: {
  id: string; title: string; topic: string; status?: string; onOpen: () => void; children: ReactNode; menu?: ReactNode;
}) {
  return <article className="boss-company-card" style={companyCardTheme(id)}>
    <div className="boss-company-card-content">
      <p className="boss-company-card-topic">{topic}</p><h3>{title}</h3>
      {status && <p className="boss-company-card-status">{status}</p>}{children}
    </div>
    <footer><button className="boss-company-card-open" aria-label={t('Open {0}', [title])} onClick={onOpen}>{t('Open details')} <span aria-hidden="true">↗</span></button>{menu}</footer>
  </article>;
}

/** The card wall stays mounted, preserving its scroll position behind the detail. */
export function BossCompanyDialog({ id, title, onClose, children }: {
  id: string; title: string; onClose: () => void; children: ReactNode;
}) {
  const headingId = useId(), dialog = useRef<HTMLElement>(null), close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const company = document.querySelector<HTMLElement>('.boss-dialog--company');
    const oldHidden = company?.getAttribute('aria-hidden'), oldInert = company?.inert, oldOverflow = company?.style.overflow;
    if (company) { company.inert = true; company.setAttribute('aria-hidden', 'true'); company.style.overflow = 'hidden'; }
    dialog.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      event.stopPropagation();
      const controls = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,iframe')].filter(node => node.getClientRects().length && node.tabIndex !== -1);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); dialog.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('keydown', keyboard, true);
      if (company) {
        company.inert = oldInert ?? false;
        if (oldHidden === null) company.removeAttribute('aria-hidden'); else if (oldHidden !== undefined) company.setAttribute('aria-hidden', oldHidden);
        company.style.overflow = oldOverflow ?? '';
      }
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<div className="boss-shell boss-company-detail-layer" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} className="boss-dialog boss-company-detail" style={companyCardTheme(id)}>
      <header className="boss-company-detail-header"><h2 id={headingId}>{title}</h2><button onClick={onClose}>{t('Back to cards')} <span aria-hidden="true">×</span></button></header>
      <div className="boss-company-detail-body">{children}</div>
    </section>
  </div>, document.body);
}
