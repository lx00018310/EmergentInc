import { t as tr } from '../../i18n';
export const explanations: Record<string, string> = {
  get OWNER_LOGIN_REQUIRED() { return tr("登录已失效，请刷新页面重新登录。"); },
  get MODEL_AND_CNY_PRICE_REQUIRED() { return tr("模型及人民币报价尚未配置。请由实例管理员完成连接后再拟定方案。"); },
  get DRAFT_ALLOWANCE_REQUIRED() { return tr("请先确认有效的方案拟定额度。"); }, get BUDGET_EXHAUSTED() { return tr("已确认费用和待核实预留已达到授权额度，请调整额度或核实账单。"); },
  get PLAN_BUDGET_EXHAUSTED() { return tr("此方案累计费用已超过拟定的额度，需要提高方案预算后重新批准。"); },
  get MODEL_OUTCOME_UNKNOWN_REVIEW_REQUIRED() { return tr("模型请求的结果尚不确定。系统保留费用预留，请核实账单后处理，避免重复调用。"); },
  get MODEL_COST_UNKNOWN_REVIEW_REQUIRED() { return tr("模型已返回内容，但费用无法确认。请核实账单后继续。"); },
  get MODEL_PLAN_INVALID_COST_RECORDED() { return tr("模型未返回有效方案，已发生费用已记账。请修改方向后重新拟定。"); },
  get INVALID_BUSINESS_PLAN() { return tr("模型方案未通过范围与格式校验，费用已记录。请修改方向后重新拟定。"); },
  get APPROVAL_VERSION_CONFLICT() { return tr("方案已更新，请刷新后批准当前版本。"); },
  get INVALID_OWNER_SECRET() { return tr("登录口令不正确。"); }, get LOGIN_RATE_LIMITED() { return tr("尝试次数过多，请一分钟后再试。"); },
  get DATASET_REQUIRED() { return tr("请先上传该请求指定的资料。"); }, get INVALID_BUDGET() { return tr("请检查金额、次数与有效期。"); },
  get DECISION_ALREADY_RUNNING() { return tr("Pixel 正在拟定另一份方案，请稍后重试。"); },
  get PREVIOUS_CALL_REQUIRES_REVIEW() { return tr("此前请求尚未确认结果，请先核实费用。"); },
  get DATASET_IMMUTABLE_USE_NEW_ID() { return tr("这份资料已固定，修改资料请作为新资料上传并修订方案。"); },
  get CONNECTION_SCOPE_DENIED() { return tr("账号或仓库授权已失效，方案已暂停。请核对连接并修订方案。"); },
  get REQUEST_NOT_SENT_REVISE_PLAN() { return tr("重启时确认请求尚未发出。请修订并重新批准，系统不会自动重发。"); },
  get REVIEW_RESPONSE_INVALID_COST_RECORDED() { return tr("复盘响应未通过验证，费用已记录，方案已暂停。请检查反馈后修订方案。"); },
  get REVISION_CONFLICT() { return tr("方案版本已变化，请刷新后再操作。"); },
  get RESTORE_VERSION_CONFLICT() { return tr("历史版本或当前版本已变化，请重新选择。"); },
};
export async function businessApi(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(explanations[result.detail] ?? result.detail ?? (tr("请求失败，请稍后重试。")));
  return result;
}

// Keep the key over network errors and page reloads. Retrying the same paid decision must not create another charge.
export async function businessDecision(path: string, body: Record<string, unknown>) {
  const storageKey = `emergentinc:decision:${path}`;
  const content = JSON.stringify(body);
  const raw = sessionStorage.getItem(storageKey);
  const previous = raw ? JSON.parse(raw) : undefined;
  const pending = previous?.content === content ? previous : { content, key: crypto.randomUUID() };
  sessionStorage.setItem(storageKey, JSON.stringify(pending));
  const result = await businessApi(path, { ...body, key: pending.key });
  sessionStorage.removeItem(storageKey);
  return result;
}
