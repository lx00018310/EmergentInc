import * as crypto from "node:crypto";
import { PreparedModelRequest } from "@emergentinc/protocol";

export class CognitiveIsolationViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CognitiveIsolationViolation";
  }
}

export interface PromptBuilderOptions {
  baseSystemPrompt?: string;
  toolsCatalog?: string | null;
  genesisPrompt?: string | null;
  temporaryPrompt?: string | null;
  modelName?: string;
  pricingRevision?: string;
  maxOutputTokens?: number;
}

export interface PromptInputs {
  state: Record<string, any>;
  pixelMd: string;
  messageMd: string;
}

export class PromptBuilder {
  private baseSystemPrompt: string;
  private toolsCatalog?: string | null;
  private genesisPrompt?: string | null;
  private temporaryPrompt?: string | null;
  private modelName: string;
  private pricingRevision: string;
  private maxOutputTokens: number;

  constructor(options: PromptBuilderOptions = {}) {
    this.baseSystemPrompt =
      options.baseSystemPrompt ||
      "你是一个Pixel。你只能依据当前 state.json、pixel.md 和 message.md 做决定。";
    this.toolsCatalog = options.toolsCatalog;
    this.genesisPrompt = options.genesisPrompt;
    this.temporaryPrompt = options.temporaryPrompt;
    this.modelName = options.modelName || "gpt-4o-mini";
    this.pricingRevision = options.pricingRevision || "2026-09-01T00:00:00Z";
    this.maxOutputTokens = options.maxOutputTokens || 2000;
  }

  public assembleSystemPrompt(): string {
    const parts: string[] = [this.baseSystemPrompt.trim()];

    if (this.toolsCatalog && this.toolsCatalog.trim()) {
      parts.push(this.toolsCatalog.trim());
    }

    if (this.genesisPrompt && this.genesisPrompt.trim()) {
      parts.push(`[GENESIS_CONTEXT]\n${this.genesisPrompt.trim()}`);
    }

    if (this.temporaryPrompt && this.temporaryPrompt.trim()) {
      parts.push(`[TEMPORARY_CONTEXT]\n${this.temporaryPrompt.trim()}`);
    }

    return parts.join("\n\n");
  }

  public prepare(inputs: PromptInputs): {
    request: PreparedModelRequest;
    fullPrompt: string;
    promptHash: string;
    estimatedTokens: number;
  } {
    // 1. 三输入隔离校验：严格只能包含 state, pixelMd, messageMd
    const inputKeys = Object.keys(inputs);
    const allowedKeys = new Set(["state", "pixelMd", "messageMd"]);
    if (inputKeys.length !== 3 || inputKeys.some((k) => !allowedKeys.has(k))) {
      throw new CognitiveIsolationViolation(
        "Context payload must strictly contain exactly 3 keys: state, pixel_md, message_md"
      );
    }

    const payload = {
      state: inputs.state,
      pixel_md: inputs.pixelMd,
      message_md: inputs.messageMd,
    };

    // 2. 组装提示词
    const effectiveSystemPrompt = this.assembleSystemPrompt();
    const userContent = JSON.stringify(payload, null, 2);
    const fullPrompt = `${effectiveSystemPrompt}\n\n${userContent}`;

    // 3. 计算 SHA-256 哈希
    const promptHash = crypto.createHash("sha256").update(fullPrompt, "utf8").digest("hex");

    // 4. 计算 Token 估值: max(charCount // 2, int(charCount * 0.7)) + 64
    const charCount = fullPrompt.length;
    const estimatedTokens = Math.max(Math.floor(charCount / 2), Math.floor(charCount * 0.7)) + 64;

    let maxTokens = this.maxOutputTokens;
    const envMaxTokens = process.env.MCL_MAX_TOKENS ? Number(process.env.MCL_MAX_TOKENS) : undefined;
    if (envMaxTokens && !isNaN(envMaxTokens)) {
      maxTokens = envMaxTokens;
    } else if (this.modelName.toLowerCase().includes("glm")) {
      maxTokens = Math.max(maxTokens, 16384);
    }

    const request: PreparedModelRequest = {
      model: this.modelName,
      messages: [
        { role: "system", content: effectiveSystemPrompt },
        { role: "user", content: userContent },
      ],
      promptHash,
      estimatedTokens,
      maxTokens,
      pricingRevision: this.pricingRevision,
    };

    return {
      request,
      fullPrompt,
      promptHash,
      estimatedTokens,
    };
  }
}
