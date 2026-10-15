import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { OwnerDashboard } from '../src/features/owner/OwnerDashboard';
import { OwnerConsole } from '../src/features/owner/OwnerConsole';
import { OwnerTaskBoard } from '../src/features/owner/OwnerTaskBoard';
import { OwnerActivity } from '../src/features/owner/OwnerActivity';
import { CompanyProposalCard } from '../src/features/owner/CompanyProposalCard';
import { companyStatus, ownerTime } from '../src/features/owner/ownerPresentation';
import { setLanguage, t } from '../src/i18n';
import type { OwnerOverview, OwnerWorkTask } from '../../packages/protocol/src/types/owner';

const assignment = (id: string, state: OwnerWorkTask['state'], extra: Partial<OwnerWorkTask> = {}): OwnerWorkTask =>
  ({ id, personId: 'person-a', personName: 'Alice', instruction: 'Inspect ' + id + '. Report the findings.',
    state, runId: 'run-' + id, turnId: null, reply: state === 'REPLIED' ? 'Reported findings' : null,
    reason: null, createdAt: 1, updatedAt: 2, ...extra });
function overview(extra: Partial<OwnerOverview> = {}): OwnerOverview {
  return {
    asOf: Date.now(), summary: { qianjiCount: 1, activeWorlds: 1, runningWorlds: 0, inboxCount: 0, currentGeneration: null },
    people: [{ id: 'person-a', name: 'Alice', worldId: 'world-a', status: 'ACTIVE', running: false, runStatus: 'STOPPED', runId: null }],
    inbox: [], activity: [], alerts: [], goals: [], proposals: [], taskPlans: [],
    work: { tasks: [], requests: [], codeReports: [] }, availability: { business: true, upgrade: 'not_configured' },
    budget: { currency: 'CNY', totalMicros: 0, spentMicros: 0, reservedMicros: 0, availableMicros: 0, activatedAt: null, unknownCalls: 0, revision: 1 },
    ...extra,
  };
}
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
beforeEach(() => { localStorage.clear(); setLanguage('en'); window.history.replaceState(null, '', '/OWNER#owner-dashboard'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('OWNER task overview and truthful status boundaries', () => {
  it.each(['en', 'zh-CN'] as const)('shows existing assignments before decisions and keeps approval and follow-up counts separate (%s)', lang => {
    setLanguage(lang);
    const data = overview({ work: { tasks: [assignment('blocked', 'BLOCKED')], requests: [], codeReports: [] },
      alerts: [{ id: 'alert', kind: 'task', title: 'Assigned task needs attention', summary: 'Alice',
        reasonKey: 'WAITING_PIXEL_BUDGET', severity: 'normal', createdAt: null, source: 'owner_work_tasks', href: '/QIAN?qianji=person-a' }] });
    render(<OwnerDashboard data={data} onDone={() => {}} />);
    const sections = screen.getAllByRole('region');
    expect(sections[0].getAttribute('aria-label')).toBe(t('Tasks and progress'));
    expect(within(screen.getByRole('region', { name: t('Needs your approval'), exact: true })).getByRole('heading').textContent).toContain('0');
    expect(within(screen.getByRole('region', { name: t('Needs follow-up'), exact: true })).getAllByRole('heading')[0].textContent).toContain('1');
    expect(screen.getByRole('heading', { name: 'Inspect blocked' })).toBeTruthy();
    expect(screen.queryByText(t('Describe a task in Boss chat. AI will propose the steps.'))).toBeNull();
  });
  it('does not count a read-only report as an approval', () => {
    const data = overview({ inbox: [{ id: 'report', type: 'code', title: 'Source change report',
      summary: 'Review a report', source: 'owner_code_reports', createdAt: 1, href: '/OWNER?report=report', priority: 'normal' }] });
    render(<OwnerDashboard data={data} onDone={() => {}} />);
    expect(screen.getByRole('region', { name: 'Needs your approval' }).textContent).toContain('No approvals pending.');
    expect(screen.getByRole('region', { name: 'Needs follow-up' }).textContent).toContain('Review a report');
  });
  it('counts a linked goal once and retains an assignment whose parent is unavailable', () => {
    const goal = { id: 'goal-a', title: 'Research', objective: 'Research objective', status: 'FAILED',
      specificationRevision: 1, updatedAt: 2, reason: null } as any;
    const data = overview({ goals: [goal], work: { tasks: [
      assignment('linked', 'FAILED', { goalId: goal.id }), assignment('orphan', 'QUEUED', { goalId: 'missing-goal' }),
    ], requests: [], codeReports: [] } });
    render(<OwnerTaskBoard data={data}/>);
    expect(screen.getByText('Tasks on this board: 2')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Research' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Inspect linked' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Inspect orphan' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Needs attention' }).textContent).toContain('Failed');
  });
  it('separates a stale RUNNING record, an active matching run, and a reply awaiting acceptance', () => {
    const data = overview({ people: [{ ...overview().people[0], running: true, runId: 'run-active' }],
      work: { tasks: [assignment('stale', 'RUNNING'), assignment('active', 'RUNNING'), assignment('reply', 'REPLIED')], requests: [], codeReports: [] } });
    render(<OwnerTaskBoard data={data}/>);
    expect(screen.getByRole('region', { name: 'In progress' }).textContent).toContain('Inspect active');
    expect(screen.getByRole('region', { name: 'Needs attention' }).textContent).toContain('executing another assignment');
    expect(screen.getByRole('region', { name: 'Awaiting acceptance' }).textContent).toContain('Completion has not been verified.');
    expect(screen.getByRole('region', { name: 'Completed' }).querySelectorAll('article')).toHaveLength(0);
  });
  it('preserves unknown statuses for diagnosis and keeps failed tasks in the board', () => {
    const data = overview({ work: { tasks: [assignment('failed', 'FAILED'),
      assignment('new', 'FUTURE_STATE' as any, { reason: 'FUTURE_BLOCKER' })], requests: [], codeReports: [] } });
    render(<OwnerTaskBoard data={data}/>);
    expect(screen.getByRole('region', { name: 'Needs attention' }).querySelectorAll('article')).toHaveLength(2);
    expect(screen.getAllByText('Unrecognized status').length).toBeGreaterThan(0);
    expect(screen.getByText('FUTURE_STATE')).toBeTruthy();
  });
  it('supports search, assignee filtering and a genuine no-match state', () => {
    render(<OwnerTaskBoard data={overview({ work: { tasks: [
      assignment('alpha', 'QUEUED'), assignment('beta', 'QUEUED', { personId: 'person-b', personName: 'Bob' }),
    ], requests: [], codeReports: [] } })}/>);
    fireEvent.change(screen.getByLabelText('Assignee'), { target: { value: 'person-b' } });
    expect(screen.queryByRole('heading', { name: 'Inspect alpha' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Inspect beta' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Find a task'), { target: { value: 'no matching task' } });
    expect(screen.getByText('No tasks match these filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('heading', { name: 'Inspect alpha' })).toBeTruthy();
  });
  it('does not expand a task when opening the dashboard tab', () => {
    render(<OwnerDashboard data={overview({ work: { tasks: [assignment('a', 'QUEUED')], requests: [], codeReports: [] } })} onDone={() => {}}/>);
    expect(document.querySelector('.owner-task-card details')?.hasAttribute('open')).toBe(false);
  });
  it('loads goal evidence only when opened and offers retry after a failed read', async () => {
    const goal = { id: 'goal-a', title: 'Research', objective: 'Objective', status: 'READY', specificationRevision: 1, updatedAt: 2, reason: null } as any;
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({ goal, evidence: [], events: [], dispatches: [] }));
    render(<OwnerTaskBoard data={overview({ goals: [goal] })}/>);
    expect(fetch).not.toHaveBeenCalled();
    const detail = document.querySelector('.owner-task-card > details') as HTMLDetailsElement;
    detail.open = true; fireEvent(detail, new Event('toggle'));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('The deliverables response is invalid. Try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('No verified deliverables recorded.');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.every(call => !call[1]?.method || call[1]?.method === 'GET')).toBe(true);
  });
  it('does not colour an unauthorised zero balance green and rejects non-finite budgets', () => {
    const first = render(<OwnerDashboard data={overview()} onDone={() => {}}/>);
    expect(screen.getByText('Available budget').parentElement?.className).not.toContain('owner-metric--ok');
    expect(screen.getByText('Reserved cost').parentElement?.className).not.toContain('owner-metric--warning');
    first.unmount();
    render(<OwnerDashboard data={overview({ budget: { ...overview().budget!, totalMicros: NaN } })} onDone={() => {}}/>);
    expect(screen.getByRole('alert').textContent).toContain('Budget data is invalid.');
    expect(document.body.textContent).not.toContain('¥NaN');
  });
  it('localizes maintenance and treats an ordinary stop separately from an error', () => {
    const data = overview({ automation: { observedState: 'STOPPED', reason: null } as any });
    expect(companyStatus(data).tone).toBe('neutral');
    data.automation!.reason = 'EVOLUTION_QUIESCED';
    expect(companyStatus(data).tone).toBe('warning');
    setLanguage('zh-CN'); expect(companyStatus(data).label).toBe('版本维护中，执行已暂挂。');
    data.automation!.reason = null; data.automation!.observedState = 'ERROR';
    expect(companyStatus(data).tone).toBe('danger');
  });
  it('uses the selected locale and Shanghai time, and labels invalid dates explicitly', () => {
    const instant = '2026-10-15T00:00:00Z';
    expect(ownerTime(instant)).toContain('08:00:00');
    setLanguage('zh-CN'); expect(ownerTime(instant)).toContain('2026/10/15');
    expect(ownerTime('invalid')).toBe(t('Time not recorded.'));
  });
  it('localizes system history and repairs empty-world links without hiding diagnostics', () => {
    setLanguage('zh-CN');
    render(<OwnerActivity items={[{ id: 'event', type: 'owner_automation_changed', summary: '', source: 'control_events',
      createdAt: 1, href: '/YUAN?world=' }, {id:'task',type:'Assigned task',summary:'Alice: RUNNING — READ_APP_SOURCE',
      source:'owner_work_tasks',createdAt:1,href:'/OWNER'}]}/>);
    expect(screen.getByRole('link', { name: '公司执行设置已更新' }).getAttribute('href')).toBe('/OWNER#owner-activity');
    expect(screen.getByText('owner_automation_changed · control_events')).toBeTruthy();
    expect(screen.getByText('Alice: 运行中 — READ_APP_SOURCE')).toBeTruthy();
  });
  it('keeps received data visible after refresh fails and recovers with a read-only retry', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(overview()))
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(response(overview()));
    render(<OwnerConsole/>);
    await screen.findByText('No approvals pending.');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh' })));
    await screen.findByRole('alert');
    expect(screen.getByText('No approvals pending.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Previously displayed data may be stale.');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(fetch.mock.calls.every(call => !call[1]?.method || call[1]?.method === 'GET')).toBe(true);
  });
  it.each([{asOf:1}, overview({inbox:[null] as any}), overview({work:{tasks:[null],requests:[],codeReports:[]} as any})])
    ('does not render a malformed successful response as an empty dashboard', async data => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(data));
    render(<OwnerConsole/>);
    await screen.findByRole('alert');
    expect(screen.getByText('No dashboard data has been received.')).toBeTruthy();
  });
  it('counts a recorded running assignment with no live run as needing follow-up in the workload', () => {
    render(<OwnerDashboard data={overview({work:{tasks:[assignment('stale','RUNNING')],requests:[],codeReports:[]}})} onDone={()=>{}}/>);
    const person=document.querySelector('.owner-person-card')!;
    expect(within(person as HTMLElement).getByText('Tasks needing follow-up').nextElementSibling?.textContent).toBe('1');
  });
  it('allows a valid close proposal with an optional reason and links to the actual deliverables', () => {
    render(<CompanyProposalCard proposal={{id:'close',kind:'close_task',goalId:'goal-a',goalRevision:1,hash:'a'.repeat(64),
      payload:{title:'Research',evidence:[{id:'evidence-a',sha256:'b'.repeat(64)}]},state:'PENDING',createdAt:1,result:null}}/>);
    expect(screen.getByRole('link',{name:'View task deliverables'}).getAttribute('href')).toBe('/OWNER?goal=goal-a');
    expect(screen.getByRole('button',{name:'Approve'})).toBeTruthy();
  });
  it('does not offer decisions for a malformed proposal', () => {
    const fetch=vi.spyOn(globalThis,'fetch');
    render(<CompanyProposalCard proposal={{id:'broken',kind:'task_plan',goalId:'goal-a',goalRevision:1,hash:'a'.repeat(64),
      payload:{title:'Broken',plan:{summary:'Review',nodes:[{title:'Step',instruction:'Inspect',trigger:{kind:'weekly',weekdays:'bad'}}]}},
      state:'PENDING',createdAt:1,result:null}}/>);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
