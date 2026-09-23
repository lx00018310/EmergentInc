import { ToolDefinition, ToolResult } from "@emergentinc/protocol";
import { ToolContext } from "../context.js";
import { PublicHttpError, requestPublicText } from "./public_http.js";

export const webfetchDefinition: ToolDefinition = {
  name: "webfetch",
  description: "只读抓取公开 HTTP(S) 网页并返回标题与正文文本；不执行网页 JavaScript",
  input_schema: {
    type: "object",
    properties: { url: { type: "string", description: "要阅读的公开网页绝对 URL" } },
    required: ["url"],
  },
  effect: "read",
  enabled: true,
  timeout_seconds: 20,
};

function decodeEntities(text: string): string {
  return text.replace(/&(#(?:x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi, (_match, entity: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return named[entity.toLowerCase()] || "";
  });
}

function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/<[^>]*>/g, "").trim());
  const text = decodeEntities(html
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[^]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim());
  return { title, text };
}

export async function handleWebfetch(args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
  const url = typeof args.url === "string" ? args.url.trim() : "";
  try {
    const response = await requestPublicText(url, { signal: ctx.signal });
    const page = response.contentType === "text/html" ? htmlToText(response.body) : { title: "", text: response.body };
    const content = page.text.slice(0, 24000);
    return {
      operation_id: ctx.operationId, tool: "webfetch", status: "SUCCESS",
      output: { url: response.url, status: response.status, title: page.title, content },
      duration_ms: 0, truncated: response.truncated || page.text.length > content.length,
    };
  } catch (err: any) {
    return {
      operation_id: ctx.operationId, tool: "webfetch", status: "FAILED",
      error_code: err instanceof PublicHttpError ? err.code : "FETCH_ERROR",
      error_message: err?.message || String(err), duration_ms: 0, truncated: false,
    };
  }
}
