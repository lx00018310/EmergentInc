import { language, t } from '../../i18n';
import type { OwnerActionProposal, OwnerInboxItem, OwnerOverview } from '../../api/owner';

export type OwnerTone = 'neutral' | 'ok' | 'warning' | 'danger';

const textFields = (row: unknown, fields: string[]) => !!row && typeof row === 'object' &&
  fields.every(key => typeof (row as Record<string, unknown>)[key] === 'string');
const optionalText = (value: unknown) => value == null || typeof value === 'string';

export function validOwnerOverview(value: OwnerOverview): boolean {
  if (!value || !value.summary || !Number.isFinite(value.asOf) ||
    !Array.isArray(value.inbox) || !Array.isArray(value.people) || !Array.isArray(value.activity)) return false;
  for (const key of ['goals', 'proposals', 'taskPlans', 'costs', 'revenue', 'legacyBusiness', 'alerts'] as const)
    if (value[key] !== undefined && !Array.isArray(value[key])) return false;
  if (value.people.some(person => !textFields(person, ['id', 'name', 'worldId', 'status']) ||
    typeof person.running !== 'boolean' || !optionalText(person.role))) return false;
  if (value.inbox.some(item => !textFields(item, ['id', 'title', 'summary', 'href', 'source']) ||
    !optionalText(item.approveEffect) || !optionalText(item.rejectEffect) ||
    item.actions !== undefined && (!Array.isArray(item.actions) ||
      item.actions.some(action => !action || !textFields(action.action, ['type']))))) return false;
  if (value.alerts?.some(alert => !textFields(alert, ['id', 'title', 'summary', 'href', 'source']) ||
    !optionalText(alert.reasonKey))) return false;
  if (value.activity.some(item => !textFields(item, ['id', 'type', 'summary', 'href', 'source']) ||
    !optionalText(item.summaryKey))) return false;
  if (value.goals?.some(goal => !textFields(goal, ['id', 'title', 'objective', 'status']) ||
    !optionalText(goal.reason))) return false;
  if (value.taskPlans?.some(plan => !plan || !Array.isArray(plan.nodes) ||
    plan.nodes.some(node => !textFields(node, ['key', 'title', 'instruction']) ||
      !textFields(node.trigger, ['kind'])))) return false;
  if (value.proposals?.some(proposal => !textFields(proposal, ['id', 'hash', 'kind', 'state']))) return false;
  if (value.legacyBusiness?.some(task => !textFields(task, ['id', 'title', 'state']))) return false;
  if (value.revenue?.some(row => !textFields(row, ['asset', 'amount'])) ||
    value.costs?.some(row => !textFields(row, ['day']))) return false;
  if (value.work) {
    const work = value.work;
    if (!Array.isArray(work.tasks) || !Array.isArray(work.requests) || !Array.isArray(work.codeReports) ||
      !optionalText(work.schedulerError) || !optionalText(work.upgradeOrigin)) return false;
    if (work.tasks.some(task => !textFields(task, ['id', 'instruction', 'state', 'personId', 'personName']) ||
      !optionalText(task.reply) || !optionalText(task.reason))) return false;
    if (work.requests.some(request => !textFields(request, ['id', 'role', 'state']))) return false;
    if (work.codeReports.some(report => !textFields(report, ['id', 'hash', 'personName', 'title', 'summary']) ||
      !Array.isArray(report.paths) || report.paths.some(path => typeof path !== 'string'))) return false;
  }
  if (value.storefront && (!Array.isArray(value.storefront.products) || !Array.isArray(value.storefront.orders) ||
    value.storefront.products.some(product => !textFields(product, ['id', 'nameEn', 'nameZh', 'currency'])) ||
    value.storefront.orders.some(order => !textFields(order, ['id', 'product', 'amount', 'currency', 'status'])))) return false;
  return true;
}

const statusKeys: Record<string, string> = {
  QUEUED: 'Queued for execution', RUNNING: 'Running', REPLIED: 'Person replied',
  BLOCKED: 'Blocked', NO_REPLY: 'Run ended without a reply', FAILED: 'Failed',
  READY: 'Ready', PAUSED: 'Paused', STOPPED: 'Stopped', COMPLETED: 'Completed',
  ACTIVE: 'Business task active', AWAITING_APPROVAL: 'Awaiting approval',
  WAITING_RESOURCE: 'Waiting for resources',
  PENDING: 'Order status: PENDING', AWAITING_PAYMENT: 'Order status: AWAITING_PAYMENT',
  PAID: 'Order status: PAID', CANCELLED: 'Order status: CANCELLED',
  WAITING_PIXEL_BUDGET: 'Old individual allowance wait. Company scheduling resumes when enabled and funded.',
  WAITING_RUN_BUDGET: 'Old individual allowance wait. Company scheduling resumes when enabled and funded.',
  WAITING_EXECUTION_BUDGET: 'Old individual allowance wait. Company scheduling resumes when enabled and funded.',
  RUN_BUDGET_EXHAUSTED: 'Old individual allowance wait. Company scheduling resumes when enabled and funded.',
  EXECUTION_BUDGET_EXHAUSTED: 'Old individual allowance wait. Company scheduling resumes when enabled and funded.',
  CALL_OUTCOME_UNKNOWN: 'External outcome unknown',
  AWAITING_SETTLEMENT: 'Settlement needs verification.',
  PAUSED_RECOVERY_REQUIRED: 'Execution paused; recovery needs review.',
  ABANDONED: 'The conversation has no reply and needs review.',
  SERVICE_SHUTDOWN: 'Execution paused when the service stopped.',
  USER_STOPPED: 'Execution stopped by the Owner.',
  NO_ACTIVE_MESSAGES: 'No messages ready for execution.',
  INFRASTRUCTURE_FAILURE: 'Execution interrupted by a service failure.',
  READ_LOOP_THRESHOLD_REACHED: 'Repeated reads stopped execution.',
  EVOLUTION_QUIESCED: 'Version maintenance; execution is suspended.',
};

export function ownerStatusLabel(code: string, prefix = ''): string {
  const key = prefix + code, translated = t(key);
  if (translated !== key) return translated;
  if (statusKeys[code]) return t(statusKeys[code]);
  const direct = t(code);
  return direct !== code ? direct : t('Unrecognized status');
}

export function ownerReasonLabel(reason: string): string {
  const translated = t(reason);
  if (translated !== reason) return translated;
  if (statusKeys[reason]) return t(statusKeys[reason]);
  return /^[A-Z][A-Z0-9_]+(?::|$)/.test(reason) ? t('Unrecognized status') : reason;
}

/** Only metadata is translated here; instructions and reported deliverables remain verbatim. */
export function ownerMetadataText(text: string, unknownCodes = false): string {
  return text.replace(/\b[A-Z][A-Z0-9_]+\b/g, code =>
    statusKeys[code] || t(code) !== code ? ownerReasonLabel(code) :
      unknownCodes && code.includes('_') ? t('Unrecognized status') : code);
}

export function ownerTime(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return t('Time not recorded.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t('Time not recorded.');
  return new Intl.DateTimeFormat(language(), {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

export function companyStatus(data?: OwnerOverview): { label: string; tone: OwnerTone } {
  if (!data) return { label: t('Loading…'), tone: 'neutral' };
  const automation = data.automation;
  if (automation?.reason === 'EVOLUTION_QUIESCED' || data.summary.serviceStatus === 'paused')
    return { label: t('Version maintenance; execution is suspended.'), tone: 'warning' };
  if (!automation) return {
    label: t(data.summary.serviceStatus === 'attention' ? 'Needs attention' : 'Status unavailable'),
    tone: data.summary.serviceStatus === 'attention' ? 'danger' : 'neutral',
  };
  const tones: Record<string, OwnerTone> = {
    RUNNING: 'ok', STARTING: 'neutral', IDLE: 'neutral', STOPPED: 'neutral',
    STOPPING: 'warning', LIMIT_REACHED: 'warning', BLOCKED: 'warning', ERROR: 'danger',
  };
  return {
    label: automation.reason ? ownerReasonLabel(automation.reason) :
      ownerStatusLabel(automation.observedState, 'Company observed: '),
    tone: automation.reason === 'OWNER_OUTCOME_REVIEW_REQUIRED' ? 'danger' :
      tones[automation.observedState] ?? 'warning',
  };
}

export function ownerApprovalPair(item: OwnerInboxItem):
  { approve: OwnerActionProposal; reject: OwnerActionProposal } | null {
  const approve = item.actions?.find(p => p.requiresApproval &&
    ['business_plan_approve', 'resource_provided', 'recruit_approve', 'gene_proposal_approve'].includes(p.action.type));
  const reject = item.actions?.find(p =>
    ['business_plan_reject', 'resource_reject', 'recruit_reject', 'gene_proposal_reject'].includes(p.action.type));
  return approve && reject ? { approve, reject } : null;
}

export function ownerActivityHref(href: string): string {
  if (!href || !/^(\/(?!\/)|https?:\/\/)/i.test(href)) return '/OWNER#owner-activity';
  const url = new URL(href, 'http://owner.local');
  if (url.pathname.toUpperCase() === '/YUAN' && !url.searchParams.get('world'))
    return '/OWNER#owner-activity';
  return href;
}

export function taskExcerpt(instruction: string, max = 88): string {
  const compact = instruction.trim().replace(/(?:[。；\n]|[.!?](?=\s|$))[\s\S]*$/, '').replace(/\s+/g, ' ');
  return compact.length > max ? compact.slice(0, max) + '…' : compact || t('Untitled task');
}
