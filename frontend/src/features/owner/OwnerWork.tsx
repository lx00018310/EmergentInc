import { useState } from 'react';
import { t, useLanguage } from '../../i18n';
import type { OwnerWork as Work } from '../../api/owner';
import type { AppCodeReport } from '../../../../packages/protocol/src/types/owner';
import { apiRequest } from '../../api/client';
import { ownerError } from '../../api/owner';
import { OwnerMarkdown } from './OwnerMarkdown';
import { OwnerReason, OwnerTechnical } from './OwnerStatus';
import { ownerStatusLabel, ownerTime, taskExcerpt } from './ownerPresentation';

export function OwnerWork({ work, showTasks = true }: { work?: Work; showTasks?: boolean }) {
  useLanguage();
  if (!work) return null;
  return <div className="owner-work">
    {work.requests.filter(request => request.state === 'APPROVED_QUEUED').map(request =>
      <p className="owner-notice" key={request.id}>{request.role} · {t('Proposal state: APPROVED')}</p>)}
    {showTasks && work.schedulerError && <div role="alert">
      {t('Task dispatch stopped because of a service error.')}<OwnerReason reason={work.schedulerError}/></div>}
    {showTasks && work.tasks.length > 0 && <section><h3>{t('Assigned work and replies')}</h3>
      <p>{t('A reply is a reported result. Source changes take effect only after software upgrade approval.')}</p>
      {work.tasks.map(task => <article key={task.id}><strong>{task.personName} · {ownerStatusLabel(task.state)}</strong>
        <p>{taskExcerpt(task.instruction)}</p><OwnerReason reason={task.reason}/>
        <small>{ownerTime(task.updatedAt)}</small>
        <details><summary>{t('Task details and results')}</summary><p>{task.instruction}</p>
          {task.reply && <OwnerMarkdown content={task.reply}/>}
          <a href={'/QIAN?qianji=' + encodeURIComponent(task.personId)}>{t('View details')}</a>
          <OwnerTechnical><code>{task.runId ?? task.id}</code></OwnerTechnical>
        </details>
      </article>)}
    </section>}
    {work.codeReports.length > 0 && <section className="owner-card"><h2>{t('Source change reports')}</h2>
      <p className="owner-muted">{t('A reply is a reported result. Source changes take effect only after software upgrade approval.')}</p>
      {work.codeReports.map(report => <SourceReport key={report.id} report={report} upgradeOrigin={work.upgradeOrigin}/>)}
    </section>}
  </div>;
}

function SourceReport({report, upgradeOrigin}:
  {report: Work['codeReports'][number]; upgradeOrigin?: string}) {
  const [full, setFull] = useState<AppCodeReport>(), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const current = full?.hash === report.hash ? full : undefined;
  return <details className="owner-source-report" id={report.id}>
    <summary><strong>{report.personName} · {report.title}</strong><time>{ownerTime(report.createdAt)}</time></summary>
    <p className="owner-notice">{t('Source candidate report. Check independent upgrade review for its current validation and publication status.')}</p>
    <OwnerMarkdown content={report.summary}/>
    <p>{report.paths.join(', ')}</p>
    <details><summary>{t('Review candidate source files')}</summary>
      {!current && <button className="owner-btn owner-btn--ghost owner-btn--sm" disabled={loading} onClick={async () => {
        if (loading) return;
        setLoading(true); setError('');
        try {
          const next = await apiRequest<AppCodeReport>('owner/code-reports/' + encodeURIComponent(report.id), {worldScoped: false});
          if (!next || next.hash !== report.hash || !Array.isArray(next.files)) throw new Error('APP_CODE_REPORT_CHANGED');
          setFull(next);
        } catch (e) { setError(ownerError(e)); } finally { setLoading(false); }
      }}>{t(loading ? 'Loading…' : 'Load complete source report')}</button>}
      {error && <p role="alert">{error}</p>}
      {current?.files.map(file => <div key={file.path}><strong>{file.path}</strong><pre>{file.content ?? t('Delete file')}</pre></div>)}
    </details>
    <OwnerTechnical><p>{t('Report hash')}: <code>{report.hash}</code> · {report.baseGeneration}</p></OwnerTechnical>
    {upgradeOrigin && <p><a className="owner-btn owner-btn--ghost owner-btn--sm"
      href={upgradeOrigin + '/?report=' + encodeURIComponent(report.id) + '&reportHash=' + encodeURIComponent(report.hash)}>
      {t('Open independent upgrade review')}</a></p>}
  </details>;
}
