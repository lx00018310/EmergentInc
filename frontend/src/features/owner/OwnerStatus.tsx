import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { ownerReasonLabel } from './ownerPresentation';

export function OwnerTechnical({ children }: { children: ReactNode }) {
  return <details className="owner-technical"><summary>{t('Technical details')}</summary>{children}</details>;
}

export function OwnerReason({ reason }: { reason: string | null | undefined }) {
  if (!reason) return null;
  return <div className="owner-reason"><p>{ownerReasonLabel(reason)}</p>
    {ownerReasonLabel(reason) === t('Unrecognized status') &&
      <OwnerTechnical><code>{reason}</code></OwnerTechnical>}
  </div>;
}
