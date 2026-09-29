import { GithubIssueAction } from "@emergentinc/protocol";

export interface GithubConnection { id: string; repository: string; accountLogin: string; enabled: boolean }
export interface GithubIssueReceipt { kind: "github_issue"; id: number; number: number; url: string;
  repository: string; accountLogin: string; verification: "provider_verified" }
export type GithubHttp = (url: string, init: RequestInit) => Promise<Response>;
/** Only github.com is supported. A model cannot choose an API host, method, header or credential. */
export class GithubIssuesConnector {
  constructor(private http: GithubHttp = fetch) {}
  private async request(token: string, route: string, body?: unknown): Promise<any> {
    if (!/^[A-Za-z0-9_]{20,255}$/.test(token)) throw new Error("INVALID_GITHUB_TOKEN");
    const response = await this.http(`https://api.github.com${route}`, { method: body === undefined ? "GET" : "POST",
      redirect: "error", signal: AbortSignal.timeout(15000), headers: {
        Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json",
        "User-Agent": "EmergentInc-Business", "X-GitHub-Api-Version": "2026-03-10",
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
    if (!response.body) throw new Error("GITHUB_RESPONSE_MISSING");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength; if (length > 2000000) throw new Error("GITHUB_RESPONSE_TOO_LARGE"); chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  async verify(token: string, repository: string): Promise<Omit<GithubConnection, "id" | "enabled">> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(repository) || [".", ".."].includes(repository.split("/")[1]!)) throw new Error("INVALID_GITHUB_REPOSITORY");
    const user = await this.request(token, "/user");
    const repo = await this.request(token, `/repos/${repository}`);
    if (typeof user.login !== "string" || repo.full_name?.toLowerCase() !== repository.toLowerCase() ||
      repo.archived || !repo.has_issues || !(repo.permissions?.push || repo.permissions?.admin || repo.permissions?.maintain)) throw new Error("GITHUB_MANAGED_REPOSITORY_REQUIRED");
    return { repository: repo.full_name, accountLogin: user.login };
  }
  private receipt(value: any, action: GithubIssueAction): GithubIssueReceipt {
    if (!Number.isSafeInteger(value?.id) || !Number.isSafeInteger(value?.number) || value.number <= 0 || value.pull_request ||
      value.user?.login !== action.accountLogin || value.html_url !== `https://github.com/${action.repository}/issues/${value.number}`) throw new Error("GITHUB_RECEIPT_INVALID");
    return { kind: "github_issue", id: value.id, number: value.number, url: value.html_url,
      repository: action.repository, accountLogin: action.accountLogin, verification: "provider_verified" };
  }
  async create(token: string, action: GithubIssueAction, operationId: string): Promise<GithubIssueReceipt> {
    const result = await this.request(token, `/repos/${action.repository}/issues`, {
      title: action.title, body: `${action.body}\n\n<!-- emergentinc-operation:${operationId} -->`,
    });
    return this.receipt(result, action);
  }
  async reconcile(token: string, action: GithubIssueAction, operationId: string): Promise<GithubIssueReceipt | null> {
    // A bounded read can prove presence, never prove absence. Missing receipts remain unknown.
    const issues = await this.request(token, `/repos/${action.repository}/issues?state=all&creator=${encodeURIComponent(action.accountLogin)}&per_page=100&sort=created&direction=desc`);
    if (!Array.isArray(issues)) throw new Error("GITHUB_RECEIPT_INVALID");
    const matches = issues.filter(i => i.body?.includes(`<!-- emergentinc-operation:${operationId} -->`) && i.title === action.title && i.user?.login === action.accountLogin);
    return matches.length === 1 ? this.receipt(matches[0], action) : null;
  }
}
