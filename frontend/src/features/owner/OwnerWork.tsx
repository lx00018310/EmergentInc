import { useState } from 'react';
import { t, useLanguage } from '../../i18n';
import type { OwnerWork as Work } from '../../api/owner';
import type { AppCodeReport } from '../../../../packages/protocol/src/types/owner';
import { apiRequest } from '../../api/client';
import { ownerError } from '../../api/owner';
import { OwnerMarkdown } from './OwnerMarkdown';

const states:Record<string,string>={QUEUED:'Queued for execution',RUNNING:'Running',REPLIED:'Person replied',BLOCKED:'Blocked',NO_REPLY:'Run ended without a reply',FAILED:'Failed'};
export function OwnerWork({work}:{work?:Work}) {
  useLanguage();const [reports,setReports]=useState<Record<string,AppCodeReport>>({}),[error,setError]=useState('');if(!work)return null;
  return <div className="owner-work">
    {work.schedulerError&&<p role="alert">{t('Task dispatch stopped because of a service error.')} {work.schedulerError}</p>}
    {work.tasks.length>0&&<section><h3>{t('Assigned work and replies')}</h3><p>{t('A reply is a reported result. Source changes take effect only after software upgrade approval.')}</p>
      {work.tasks.map(task=><article key={task.id}><strong>{task.personName} · {t(states[task.state]??task.state)}</strong><p>{task.instruction}</p><small>{new Date(task.updatedAt).toLocaleString()} · {task.runId??task.id}</small>
        {task.reason&&<p role="status">{task.reason==='WAITING_PIXEL_BUDGET'?t('元胞能量不足，等待补充后重试。'):t(task.reason)}</p>}
        {task.reply&&<OwnerMarkdown content={task.reply}/>}<a href={`/QIAN?qianji=${encodeURIComponent(task.personId)}`}>{t('View details')}</a>
      </article>)}
    </section>}
    {work.codeReports.length>0&&<section><h3>{t('Source change reports')}</h3>{work.codeReports.map(report=><article id={report.id} key={report.id}><strong>{report.personName} · {report.title}</strong><OwnerMarkdown content={report.summary}/><p>{t('Candidate source only. Validation and publication are pending Owner approval.')} · {report.baseGeneration}</p>
      <p>{report.paths.join(', ')}</p><details><summary>{t('Review candidate source files')}</summary>{!reports[report.id]&&<button onClick={async()=>{try{const full=await apiRequest<AppCodeReport>(`owner/code-reports/${report.id}`,{worldScoped:false});if(full.hash!==report.hash)throw new Error('APP_CODE_REPORT_CHANGED');setReports(old=>({...old,[report.id]:full}));setError('');}catch(e){setError(ownerError(e));}}}>{t('Load complete source report')}</button>}{reports[report.id]?.files.map(file=><div key={file.path}><strong>{file.path}</strong><pre>{file.content??t('Delete file')}</pre></div>)}</details><small>{t('Report hash')}: {report.hash}</small>
      {work.upgradeOrigin&&<p><a href={`${work.upgradeOrigin}/?report=${encodeURIComponent(report.id)}&reportHash=${report.hash}`}>{t('Open independent upgrade review')}</a></p>}
    </article>)}</section>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}
