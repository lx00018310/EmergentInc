import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { BusinessStore } from "@emergentinc/persistence";
import { GithubIssuesConnector } from "@emergentinc/tools";
import { GithubIssueAction } from "@emergentinc/protocol";

export class BusinessConnections {
  constructor(private store: BusinessStore, private secretDirectory: string, readonly github = new GithubIssuesConnector()) {}
  private secretPath(id: string) {
    if (!/^[\w-]{1,100}$/.test(id)) throw new Error("INVALID_CONNECTION_ID");
    return path.join(this.secretDirectory, `${id}.json`);
  }
  async authorizeGithub(input: { token: string; repository: string; id?: string }) {
    if (!input || typeof input.token !== "string" || typeof input.repository !== "string" ||
      (input.id !== undefined && typeof input.id !== "string")) throw new Error("INVALID_CONNECTION");
    const id = input.id || randomUUID(), file = this.secretPath(id);
    if (this.store.connection(id) || fs.existsSync(file)) throw new Error("CONNECTION_IMMUTABLE_USE_NEW_ID");
    const verified = await this.github.verify(input.token, input.repository);
    fs.mkdirSync(this.secretDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify({ token: input.token }), { flag: "wx", mode: 0o600 });
    try { this.store.saveConnection(id, verified.repository, verified.accountLogin); }
    catch (e) { fs.unlinkSync(file); throw e; }
    return this.store.connection(id);
  }
  private token(action: GithubIssueAction, allowDisabled = false): string {
    const connection = this.store.connection(action.connectionId);
    if (!connection || (!connection.enabled && !allowDisabled) || connection.repository !== action.repository ||
      connection.account_login !== action.accountLogin) throw new Error("CONNECTION_SCOPE_DENIED");
    try { return JSON.parse(fs.readFileSync(this.secretPath(action.connectionId), "utf8")).token; }
    catch { throw new Error("CONNECTION_SECRET_UNAVAILABLE"); }
  }
  prepare(action: GithubIssueAction) {
    const token = this.token(action);
    // Capture only after scope validation; caller persists dispatch immediately before invoking this closure.
    return (operationId: string) => this.github.create(token, action, operationId);
  }
  reconcile(action: GithubIssueAction, operationId: string) {
    // An authenticated Owner may explicitly check a prior receipt after disabling new writes.
    return this.github.reconcile(this.token(action, true), action, operationId);
  }
}
