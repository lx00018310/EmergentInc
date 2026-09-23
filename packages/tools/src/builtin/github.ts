import { ToolDefinition, ToolResult } from "@emergentinc/protocol";
import { ToolContext } from "../context.js";
import { PublicHttpError, requestPublicText } from "./public_http.js";

export const githubRepoDefinition: ToolDefinition = {
  name: "github_repo",
  description: "只读查看公开 GitHub 仓库的目录或文本文件，可指定路径与分支/提交",
  input_schema: {
    type: "object",
    properties: {
      repository: { type: "string", description: "owner/repo 或 https://github.com/owner/repo" },
      path: { type: "string", description: "仓库内文件或目录路径，缺省为根目录" },
      ref: { type: "string", description: "可选分支、标签或提交 SHA" },
    },
    required: ["repository"],
  },
  effect: "read",
  enabled: true,
  timeout_seconds: 20,
};

function parseRepository(raw: string): string | null {
  const input = raw.trim().replace(/\/$/, "");
  const match = input.match(/^(?:https:\/\/github\.com\/)?([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d_.-]+)$/i);
  return match && match[2] !== "." && match[2] !== ".." ? `${match[1]}/${match[2]}` : null;
}

function validPath(raw: string): boolean {
  return raw.length <= 1000 && !raw.startsWith("/") && !raw.includes("\\") &&
    raw.split("/").every((part) => part && part !== "." && part !== "..");
}

export async function handleGithubRepo(args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
  const repository = parseRepository(typeof args.repository === "string" ? args.repository : "");
  const repoPath = typeof args.path === "string" ? args.path.trim() : "";
  const ref = typeof args.ref === "string" ? args.ref.trim() : "";
  if (!repository || (repoPath && !validPath(repoPath)) || ref.length > 200 || /[\x00-\x1f]/.test(ref)) {
    return {
      operation_id: ctx.operationId, tool: "github_repo", status: "FAILED",
      error_code: "INVALID_ARGS", error_message: "Invalid repository, path, or ref",
      duration_ms: 0, truncated: false,
    };
  }
  const url = new URL(`https://api.github.com/repos/${repository}/contents/${repoPath.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`);
  if (ref) url.searchParams.set("ref", ref);
  try {
    const response = await requestPublicText(url.href, {
      signal: ctx.signal,
      maxBytes: 2097152,
      headers: { Accept: "application/vnd.github+json", "User-Agent": "EmergentInc-Pixel", "X-GitHub-Api-Version": "2022-11-28" },
    });
    const item = JSON.parse(response.body);
    if (Array.isArray(item)) {
      const entries = item.map((entry: any) => ({ name: entry.name, path: entry.path, type: entry.type, size: entry.size, url: entry.html_url }));
      return {
        operation_id: ctx.operationId, tool: "github_repo", status: "SUCCESS",
        output: { repository, path: repoPath || "/", ref: ref || null, entries },
        duration_ms: 0, truncated: response.truncated,
      };
    }
    if (item.type !== "file") throw new PublicHttpError("UNSUPPORTED_ITEM", `GitHub item type '${item.type}' is not a text file`);
    if (item.encoding !== "base64" || typeof item.content !== "string" || response.truncated) {
      throw new PublicHttpError("FILE_TOO_LARGE", "GitHub did not return the complete file content");
    }
    const bytes = Buffer.from(item.content.replace(/\s/g, ""), "base64");
    const binary = bytes.includes(0);
    const text = binary ? "" : bytes.toString("utf-8");
    const content = text.slice(0, 24000);
    return {
      operation_id: ctx.operationId, tool: "github_repo", status: "SUCCESS",
      output: { repository, path: item.path, ref: ref || null, size: item.size, sha: item.sha, url: item.html_url, binary, content },
      duration_ms: 0, truncated: text.length > content.length,
    };
  } catch (err: any) {
    return {
      operation_id: ctx.operationId, tool: "github_repo", status: "FAILED",
      error_code: err instanceof PublicHttpError ? err.code : "GITHUB_ERROR",
      error_message: err?.message || String(err), duration_ms: 0, truncated: false,
    };
  }
}
