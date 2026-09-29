export interface DataReportAction { capability: "data_report"; version: "1"; datasetId: string; purpose: string }
export interface GithubIssueAction { capability: "github_issue_create"; version: "1"; connectionId: string;
  repository: string; accountLogin: string; title: string; body: string; purpose: string }
export interface FeedbackReviewAction { capability: "review_feedback"; version: "1"; purpose: string }
export type BusinessAction = DataReportAction | GithubIssueAction | FeedbackReviewAction;
/** Business money uses integer millionths of CNY, never legacy Energy. */
export interface BusinessPlan {
  title: string;
  objective: string;
  audience: string;
  hypothesis: string;
  metric: { name: string; baseline: string; target: string; evidence: string };
  stopCondition: string;
  expiresAt: number;
  budgetMicros: number;
  currency: "CNY";
  actions: BusinessAction[];
  resources: string[];
  schedule?: { kind: "interval"; everyMinutes: number; maxOccurrences: number } |
    { kind: "daily"; time: string; timezone: string; maxOccurrences: number };
}

export type BusinessPlanState = "AWAITING_APPROVAL" | "ACTIVE" | "WAITING_RESOURCE" | "PAUSED" | "STOPPED" | "COMPLETED";
export interface BusinessPlanView {
  id: string;
  direction: string;
  revision: number;
  hash: string;
  state: BusinessPlanState;
  plan: BusinessPlan;
  spentMicros: number;
  reservedMicros: number;
  previousPlan?: BusinessPlan;
}

export function validateBusinessPlan(value: unknown, now = Date.now()): BusinessPlan {
  const p = value as BusinessPlan;
  const text = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= 4000;
  if (!p || ![p.title, p.objective, p.audience, p.hypothesis, p.stopCondition].every(text) ||
      !p.metric || ![p.metric.name, p.metric.baseline, p.metric.target, p.metric.evidence].every(text) ||
      p.currency !== "CNY" || !Number.isSafeInteger(p.budgetMicros) || p.budgetMicros < 0 ||
      p.budgetMicros > 1_000_000_000_000 || !Number.isSafeInteger(p.expiresAt) || p.expiresAt <= now ||
      p.expiresAt > now + 366 * 86400000 || !Array.isArray(p.actions) || p.actions.length < 1 || p.actions.length > 10 ||
      p.actions.some(a => !a || a.version !== "1" || !text(a.purpose) ||
        (a.capability === "data_report" ? typeof a.datasetId !== "string" || !/^[\w-]{1,100}$/.test(a.datasetId) :
          a.capability === "github_issue_create" ? !text(a.connectionId) || !/^[\w-]{1,100}$/.test(a.connectionId) ||
            !text(a.repository) || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(a.repository) ||
            !text(a.accountLogin) || !text(a.title) || a.title.length > 200 || !text(a.body) : a.capability !== "review_feedback")) || !Array.isArray(p.resources) || p.resources.length > 20 ||
      !p.resources.every(text) || p.resources.some(r => r.startsWith("dataset:") && !/^[\w-]{1,100}$/.test(r.slice(8)))) throw new Error("INVALID_BUSINESS_PLAN");
  let schedule: BusinessPlan["schedule"];
  if (p.schedule) {
    if (p.actions.some(a => a.capability === "github_issue_create")) throw new Error("EXTERNAL_WRITES_REQUIRE_ONE_TIME_PLAN");
    const s = p.schedule;
    if (!Number.isSafeInteger(s.maxOccurrences) || s.maxOccurrences < 1 || s.maxOccurrences > 366) throw new Error("INVALID_SCHEDULE");
    if (s.kind === "interval" && Number.isSafeInteger(s.everyMinutes) && s.everyMinutes >= 5 && s.everyMinutes <= 525600) {
      schedule = { kind: "interval", everyMinutes: s.everyMinutes, maxOccurrences: s.maxOccurrences };
    } else if (s.kind === "daily" && typeof s.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) && typeof s.timezone === "string") {
      try { new Intl.DateTimeFormat("en", { timeZone: s.timezone }).format(now); } catch { throw new Error("INVALID_TIMEZONE"); }
      schedule = { kind: "daily", time: s.time, timezone: s.timezone, maxOccurrences: s.maxOccurrences };
    } else throw new Error("INVALID_SCHEDULE");
  }
  // Reconstruct the accepted contract: model-produced identity/permission fields are discarded.
  return { title: p.title, objective: p.objective, audience: p.audience, hypothesis: p.hypothesis,
    metric: { name: p.metric.name, baseline: p.metric.baseline, target: p.metric.target, evidence: p.metric.evidence },
    stopCondition: p.stopCondition, expiresAt: p.expiresAt, budgetMicros: p.budgetMicros, currency: "CNY",
    actions: p.actions.map(a => a.capability === "data_report" ? { capability: a.capability, version: a.version, datasetId: a.datasetId, purpose: a.purpose } : a.capability === "review_feedback" ?
      { capability: a.capability, version: a.version, purpose: a.purpose } :
      { capability: a.capability, version: a.version, connectionId: a.connectionId, repository: a.repository,
        accountLogin: a.accountLogin, title: a.title, body: a.body, purpose: a.purpose }),
    resources: [...p.resources], ...(schedule ? { schedule } : {}) };
}
