import { useEffect, useState } from 'react';
import { t, useLanguage } from '../../i18n';
import { apiRequest } from '../../api/client';
import { ownerError, type OwnerGoal, type OwnerGoalDetail, type OwnerOverview } from '../../api/owner';
import type { OwnerWorkTask } from '../../../../packages/protocol/src/types/owner';
import { OwnerMarkdown } from './OwnerMarkdown';
import { OwnerReason, OwnerTechnical } from './OwnerStatus';
import { ownerStatusLabel, ownerTime, taskExcerpt } from './ownerPresentation';

type Column = 'ready' | 'running' | 'attention' | 'review' | 'done';
const columns: { key: Column; label: string }[] = [
  { key: 'ready', label: 'Board: To start' },
  { key: 'running', label: 'Board: In progress' },
  { key: 'attention', label: 'Board: Needs attention' },
  { key: 'review', label: 'Board: Awaiting acceptance' },
  { key: 'done', label: 'Board: Completed' },
];
export interface OwnerBoardItem {
  id: string; source: 'goal' | 'assignment' | 'business'; title: string;
  description: string; status: string; reason: string | null; updatedAt?: number;
  personIds: string[]; people: string[]; goal?: OwnerGoal; task?: OwnerWorkTask;
}

export function assignmentExecution(task: OwnerWorkTask, data: OwnerOverview) {
  const person = data.people.find(p => p.id === task.personId);
  if (!person) return 'unknown';
  if (!person.running) return 'idle';
  if (!person.runId || !task.runId) return 'unknown';
  return person.runId === task.runId ? 'running' : 'other';
}

/** Join existing projections by their persisted relation, never by similar task text. */
export function ownerBoardItems(data: OwnerOverview): OwnerBoardItem[] {
  const goals = data.goals ?? [], tasks = data.work?.tasks ?? [];
  const goalIds = new Set(goals.map(g => g.id));
  const items: OwnerBoardItem[] = goals.map(goal => {
    const linked = tasks.filter(task => task.goalId === goal.id);
    const plan = data.taskPlans?.find(p => p.goalId === goal.id && p.goalRevision === goal.specificationRevision);
    const personIds = [...new Set([...linked.map(task => task.personId),
      ...(plan?.nodes.flatMap(node => node.personId ? [node.personId] : []) ?? [])])];
    return {
      id: goal.id, source: 'goal', title: goal.title, description: goal.objective,
      status: goal.status, reason: goal.reason, updatedAt: goal.updatedAt, goal, personIds,
      people: personIds.map(id => data.people.find(p => p.id === id)?.name ??
        linked.find(task => task.personId === id)?.personName ?? t('Assigned person unavailable')),
    };
  });
  for (const task of tasks) {
    if (task.goalId && goalIds.has(task.goalId)) continue;
    items.push({
      id: task.id, source: 'assignment', title: taskExcerpt(task.instruction, 64),
      description: task.instruction, status: task.state, reason: task.reason,
      updatedAt: task.updatedAt, personIds: [task.personId], people: [task.personName], task,
    });
  }
  for (const task of data.legacyBusiness ?? []) items.push({
    id: task.id, source: 'business', title: task.title, description: '',
    status: task.state, reason: null, personIds: [], people: [],
  });
  return items;
}

export function ownerBoardColumn(item: OwnerBoardItem, data: OwnerOverview): Column {
  if (['COMPLETED', 'ARCHIVED'].includes(item.status)) return 'done';
  if (['REPLIED', 'WAITING_APPROVAL'].includes(item.status)) return 'review';
  if (['DRAFT', 'READY', 'QUEUED', 'AWAITING_APPROVAL', 'APPROVED'].includes(item.status)) return 'ready';
  if (item.status === 'ACTIVE') return 'running';
  if (item.status === 'RUNNING') {
    if (item.task && assignmentExecution(item.task, data) !== 'running') return 'attention';
    if (item.goal && data.automation && !['RUNNING', 'STARTING'].includes(data.automation.observedState))
      return 'attention';
    return 'running';
  }
  return 'attention';
}

function executionLabel(task: OwnerWorkTask, data: OwnerOverview) {
  const execution = assignmentExecution(task, data);
  return t(execution === 'running' ? 'This assignment is executing now.' :
    execution === 'idle' ? 'No active execution. The recorded task is still open.' :
      execution === 'other' ? 'This person is executing another assignment.' : 'Live execution status unavailable.');
}

export function OwnerTaskBoard({ data }: { data: OwnerOverview }) {
  useLanguage();
  const [query, setQuery] = useState(''), [personId, setPersonId] = useState('');
  const items = ownerBoardItems(data);
  const people = [...new Map(items.flatMap(item => item.personIds.map((id, i) =>
    [id, item.people[i]] as const))).entries()];
  const selectedPerson = people.some(([id]) => id === personId) ? personId : '';
  const search = query.trim().toLocaleLowerCase();
  const shown = items.filter(item => (!selectedPerson || item.personIds.includes(selectedPerson)) &&
    (!search || [item.title, item.description, ...item.people].join(' ').toLocaleLowerCase().includes(search)));
  return <section className="owner-card owner-projects" id="owner-goals" aria-label={t('Tasks and progress')}>
    <div className="owner-section-heading"><div><h2>{t('Tasks and progress')}</h2>
      <p className="owner-muted">{t('Goals and assigned work, grouped by their current stage.')}</p></div>
      <span className="owner-badge">{t('Tasks on this board: {0}', [items.length])}</span></div>
    <div className="owner-board-filters">
      <label>{t('Find a task')}<input type="search" value={query} onChange={event => setQuery(event.target.value)}
        placeholder={t('Search tasks or people')} /></label>
      <label>{t('Assignee')}<select value={selectedPerson} onChange={event => setPersonId(event.target.value)}>
        <option value="">{t('All people')}</option>{people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      {(query || selectedPerson) && <button className="owner-btn owner-btn--ghost" onClick={() => {
        setQuery(''); setPersonId('');
      }}>{t('Clear filters')}</button>}
    </div>
    {!data.work && <p className="owner-notice">{t('Assignment data is unavailable. Only the received task sources are shown.')}</p>}
    {data.work?.schedulerError && <div className="owner-alert--danger" role="alert">
      {t('Task dispatch stopped because of a service error.')} <OwnerReason reason={data.work.schedulerError} /></div>}
    {!items.length ? <p className="owner-empty">{t('Describe a task in Boss chat. AI will propose the steps.')}</p> :
      !shown.length ? <p className="owner-empty">{t('No tasks match these filters.')}</p> :
        <div className="owner-kanban" aria-label={t('Task status distribution')}>
          {columns.map(column => {
            const list = shown.filter(item => ownerBoardColumn(item, data) === column.key);
            return <section className={'owner-kanban-column owner-kanban-column--' + column.key +
              (list.length ? '' : ' owner-kanban-column--empty')} key={column.key}
              aria-label={t(column.label)}>
              <h3>{t(column.label)} <span className="owner-count">{list.length}</span></h3>
              {!list.length && <p className="owner-column-empty">{t('No tasks in this stage.')}</p>}
              {list.map(item => <TaskCard key={item.source + ':' + item.id} item={item} data={data} />)}
            </section>;
          })}
        </div>}
    {(data.work?.tasks.length ?? 0) >= 50 && <p className="owner-muted">{t('The board includes the 50 most recent assignments.')}</p>}
  </section>;
}

function TaskCard({ item, data }: { item: OwnerBoardItem; data: OwnerOverview }) {
  const [open, setOpen] = useState(false);
  const plan = item.goal && data.taskPlans?.find(p => p.goalId === item.id &&
    p.goalRevision === item.goal!.specificationRevision);
  const completed = plan?.nodes.filter(n => n.state === 'COMPLETED').length ?? 0;
  const linked = data.work?.tasks.filter(task => task.goalId === item.id) ?? [];
  return <article className="owner-task-card" id={item.id}>
    <span className="owner-task-source">{t(item.source === 'goal' ? 'Company task' :
      item.source === 'assignment' ? 'Assigned task' : 'Retained business tasks')}</span>
    <h4>{item.title || t('Untitled task')}</h4>
    <span className={'owner-task-state owner-task-state--' + ownerBoardColumn(item, data)}>
      {item.task?.state === 'RUNNING' && assignmentExecution(item.task, data) !== 'running' ?
        t('Recorded as running') : ownerStatusLabel(item.status, item.goal ? 'Goal status: ' : '')}</span>
    <p className="owner-task-assignee">{item.people.join(' · ') || t('Unassigned')}</p>
    {item.task?.state === 'RUNNING' && <p className="owner-execution-note">{executionLabel(item.task, data)}</p>}
    {item.goal?.status === 'RUNNING' && data.automation && !['RUNNING', 'STARTING'].includes(data.automation.observedState) &&
      <p className="owner-execution-note">{t('The company is not executing this recorded task now.')}</p>}
    <OwnerReason reason={item.reason} />
    {plan?.nodes.length ? <div className="owner-task-progress">
      <progress max={plan.nodes.length} value={completed} aria-label={t('Delivered steps')} />
      <span>{t('Delivered steps: {0} / {1}', [completed, plan.nodes.length])}</span>
    </div> : <p className="owner-muted">{t(item.status === 'REPLIED' ?
      'Reply received. Completion has not been verified.' : 'No quantified step progress is available.')}</p>}
    <time className="owner-task-time">{ownerTime(item.updatedAt)}</time>
    <details onToggle={event => setOpen(event.currentTarget.open)}><summary>{t('Task details and results')}</summary>
      {item.description && <p className="owner-task-description">{item.description}</p>}
      {plan && <ol className="company-task-timeline">{plan.nodes.map(node => <li key={node.key}>
        <strong>{node.title}</strong><p>{ownerStatusLabel(node.state, 'Task node: ')} ·
          {' '}{ownerStatusLabel(node.trigger.kind, 'Task trigger: ')}</p>
        {node.nextAt != null && item.goal && ['READY', 'RUNNING'].includes(item.goal.status) &&
          <small>{t('Next scheduled run')}: {ownerTime(node.nextAt)}</small>}
      </li>)}</ol>}
      {item.task?.reply && <OwnerMarkdown content={item.task.reply} />}
      {linked.map(task => <section className="owner-linked-assignment" key={task.id}>
        <strong>{task.personName} · {ownerStatusLabel(task.state)}</strong>
        <OwnerReason reason={task.reason} />{task.reply && <OwnerMarkdown content={task.reply} />}
      </section>)}
      {item.goal && open && <TaskEvidence goal={item.goal} />}
      {item.task && <a className="owner-btn owner-btn--ghost owner-btn--sm"
        href={'/QIAN?qianji=' + encodeURIComponent(item.task.personId)}>{t('View details')}</a>}
      <OwnerTechnical><code>{item.source} · {item.id}</code>
        {item.task?.runId && <p><code>{item.task.runId}</code></p>}
        <p>{t('Recorded status')}: <code>{item.status}</code></p></OwnerTechnical>
    </details>
  </article>;
}

function TaskEvidence({ goal }: { goal: OwnerGoal }) {
  const [detail, setDetail] = useState<OwnerGoalDetail>(), [error, setError] = useState(''),
    [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setDetail(undefined);
    void apiRequest<OwnerGoalDetail>('owner/goals/' + encodeURIComponent(goal.id), {
      worldScoped: false, signal: controller.signal,
    }).then(next => {
      if (!next || next.goal?.id !== goal.id || !Array.isArray(next.evidence) || !Array.isArray(next.events))
        throw new Error('The deliverables response is invalid. Try again.');
      if (!controller.signal.aborted) setDetail(next);
    })
      .catch(e => { if (!controller.signal.aborted) setError(ownerError(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [goal.id, goal.updatedAt, retry]);
  return <section className="owner-evidence"><h5>{t('Deliverables and execution history')}</h5>
    {loading && <p>{t('Loading…')}</p>}
    {error && <div role="alert"><p>{error}</p><button className="owner-btn owner-btn--ghost owner-btn--sm"
      onClick={() => setRetry(n => n + 1)}>{t('Retry')}</button></div>}
    {detail && !detail.evidence.length && <p>{t('No verified deliverables recorded.')}</p>}
    {detail?.evidence.map(e => <p key={e.id}>{e.kind === 'artifact' ?
      <a href={'/api/owner/goals/' + encodeURIComponent(goal.id) + '/evidence/' + encodeURIComponent(e.id)}
        target="_blank" rel="noreferrer">{e.reference.split('/').at(-1)}</a> : <span>{e.reference}</span>}
      {' · '}{e.bytes} {t('bytes')}</p>)}
    {detail?.events.slice(0, 20).map(e => <p key={e.id}>{ownerTime(e.createdAt)} ·
      {' '}{ownerStatusLabel(e.kind, 'Goal event: ')}</p>)}
  </section>;
}
