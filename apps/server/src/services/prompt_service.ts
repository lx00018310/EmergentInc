import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { getUnicodeLength, MAX_GENESIS_PROMPT_CODE_POINTS } from "@emergentinc/protocol";

export interface PromptFilePayload {
  schema_version: number;
  revision: number;
  active: boolean;
  content: string;
  hash: string;
  sha256: string;
  updated_at: string;
}

export class PromptService {
  constructor(private runtimeDir: string) {
    if (!fs.existsSync(runtimeDir)) {
      fs.mkdirSync(runtimeDir, { recursive: true });
    }
  }

  public getPrompt(filename: string): PromptFilePayload {
    const filePath = path.resolve(this.runtimeDir, filename);
    if (!fs.existsSync(filePath)) {
      const emptyHash = crypto.createHash("sha256").update("", "utf8").digest("hex");
      return {
        schema_version: 1,
        revision: 0,
        active: false,
        content: "",
        hash: emptyHash,
        sha256: emptyHash,
        updated_at: new Date().toISOString(),
      };
    }
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const content = String(raw.content || "");
      const sha256 = raw.sha256 || crypto.createHash("sha256").update(content, "utf8").digest("hex");
      return {
        schema_version: raw.schema_version || 1,
        revision: Number(raw.revision || 0),
        active: Boolean(content.trim().length > 0),
        content,
        hash: sha256,
        sha256,
        updated_at: raw.updated_at || new Date().toISOString(),
      };
    } catch {
      return {
        schema_version: 1,
        revision: 0,
        active: false,
        content: "",
        hash: "",
        sha256: "",
        updated_at: new Date().toISOString(),
      };
    }
  }

  public updatePrompt(filename: string, rawContent: string): PromptFilePayload {
    if (typeof rawContent !== "string") {
      throw new Error("Prompt content must be a string.");
    }
    const cleanContent = rawContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (getUnicodeLength(cleanContent) > MAX_GENESIS_PROMPT_CODE_POINTS) {
      throw new Error(`Prompt content exceeds ${MAX_GENESIS_PROMPT_CODE_POINTS} characters limit.`);
    }

    const current = this.getPrompt(filename);
    const newHash = crypto.createHash("sha256").update(cleanContent, "utf8").digest("hex");

    if (current.content === cleanContent && current.revision > 0) {
      return current;
    }

    const newRevision = (current.revision || 0) + 1;
    const isActive = Boolean(cleanContent.trim().length > 0);
    const payload: PromptFilePayload = {
      schema_version: 1,
      revision: newRevision,
      active: isActive,
      content: cleanContent,
      hash: newHash,
      sha256: newHash,
      updated_at: new Date().toISOString(),
    };

    const filePath = path.resolve(this.runtimeDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
    return payload;
  }
}
