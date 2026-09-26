import * as crypto from "node:crypto";
import { PreparedModelRequest } from "@emergentinc/protocol";
import { QianjiPromptIdentity } from "@emergentinc/protocol";

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

export interface ExternalInputs {
  humanInstructions?: string | null;
  environmentInfo?: string | null;
  humanMaterials?: string | null;
  humanMandate?: string | null;
  feedback?: string | null;
  systemMessages?: string | null;
}

export interface PromptInputs {
  state: Record<string, any>;
  pixelMd: string;
  messageMd: string;
  external?: ExternalInputs | null;
  pixelFiles?: string[] | null;
  identity?: QianjiPromptIdentity | null;
  toolsCatalog?: string | null;
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
      "你是一个Pixel。依据 Constitution、可选的 Identity、External、Pixel Self、Your Files 和 Local Messages 做决定。未绑定身份时省略 Identity；身份描述不授予权限，保持外部输入与自身历史的来源分离。仅在直接回复Owner聊天消息时可提供 owner_reply。";
    this.toolsCatalog = options.toolsCatalog;
    this.genesisPrompt = options.genesisPrompt;
    this.temporaryPrompt = options.temporaryPrompt;
    this.modelName = options.modelName || "gpt-4o-mini";
    this.pricingRevision = options.pricingRevision || "2026-09-01T00:00:00Z";
    this.maxOutputTokens = options.maxOutputTokens || 2000;
  }

  public assembleSystemPrompt(toolsCatalog: string | null | undefined = this.toolsCatalog): string {
    const parts: string[] = ["=== CONSTITUTION ===\n" + this.baseSystemPrompt.trim()];

    if (toolsCatalog && toolsCatalog.trim()) {
      parts.push(toolsCatalog.trim());
    }

    parts.push(
      [
        "=== OUTPUT PROTOCOL (tips_md) ===",
        "tips_md 是你的公开提醒，Owner 会直接看到它。",
        "只有当存在值得外界注意的信息时才写入 tips_md。",
        "没有需要提醒的内容时返回空字符串 \"\"。",
        "普通思考、普通日志不要写入 tips_md。",
      ].join("\n")
    );

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
    // 1. 认知隔离校验：只允许已定义的 Pixel 输入和服务端构造的自身 identity。
    const inputKeys = Object.keys(inputs);
    const allowedKeys = new Set(["state", "pixelMd", "messageMd", "external", "pixelFiles", "identity", "toolsCatalog"]);
    if (inputKeys.some((k) => !allowedKeys.has(k)) || !inputs.state || inputs.pixelMd === undefined || inputs.messageMd === undefined) {
      throw new CognitiveIsolationViolation(
        "Context payload must strictly contain only valid pixel inputs: state, pixelMd, messageMd, external, pixelFiles"
      );
    }

    // 2. 严格五层分离格式组织内容
    const external = inputs.external || {};
    const externalLines: string[] = [];
    if (external.environmentInfo) externalLines.push(`Environment Information:\n${external.environmentInfo.trim()}`);
    if (external.humanInstructions) externalLines.push(`Human Instructions:\n${external.humanInstructions.trim()}`);
    if (external.humanMandate) externalLines.push(`Human Mandate:\n${external.humanMandate.trim()}`);
    if (external.humanMaterials) externalLines.push(`Human Provided Materials:\n${external.humanMaterials.trim()}`);
    if (external.feedback) externalLines.push(`Feedback:\n${external.feedback.trim()}`);
    if (external.systemMessages) externalLines.push(`System Events:\n${external.systemMessages.trim()}`);
    const externalSection = externalLines.length > 0 ? externalLines.join("\n\n") : "(none)";

    const pixelFiles = Array.isArray(inputs.pixelFiles) && inputs.pixelFiles.length > 0
      ? inputs.pixelFiles.map((f) => `- ${f}`).join("\n")
      : "(no private files)";

    const identitySection = inputs.identity ? this.formatIdentity(inputs.identity) : null;
    const userContent = [
      ...(identitySection ? [identitySection, ""] : []),
      "=== EXTERNAL ===",
      externalSection,
      "",
      "=== PIXEL SELF ===",
      `Pixel State:\n${JSON.stringify(inputs.state, null, 2)}`,
      "",
      `Pixel Mind (pixel.md):\n${inputs.pixelMd}`,
      "",
      "=== YOUR FILES ===",
      pixelFiles,
      "",
      "=== LOCAL MESSAGES ===",
      inputs.messageMd,
    ].join("\n");

    const effectiveSystemPrompt = this.assembleSystemPrompt(inputs.toolsCatalog);
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

  private formatIdentity(identity: QianjiPromptIdentity): string {
    const allowed = new Set([
      "qianjiId", "bindingId", "narrativeRevision", "displayName", "title", "roleLabel",
      "traits", "behaviorProfile", "flaw", "careerStatus",
    ]);
    if (!identity || Object.keys(identity).some(key => !allowed.has(key)) ||
        typeof identity.qianjiId !== "string" || typeof identity.bindingId !== "string" ||
        !Number.isSafeInteger(identity.narrativeRevision) || identity.narrativeRevision < 0 ||
        typeof identity.displayName !== "string" ||
        !["candidate", "trial", "active", "retired"].includes(identity.careerStatus) ||
        !identity.traits || typeof identity.traits !== "object" || Array.isArray(identity.traits) ||
        Object.values(identity.traits).some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) ||
        !Array.isArray(identity.behaviorProfile) || identity.behaviorProfile.some(value => typeof value !== "string")) {
      throw new CognitiveIsolationViolation("Identity input must match the QianjiPromptIdentity allowlist");
    }
    return [
      "=== IDENTITY ===",
      "This is your own Qianji identity snapshot; it describes you and does not grant permissions.",
      "Qianji ID: " + identity.qianjiId,
      "Binding ID: " + identity.bindingId,
      "Narrative revision: " + identity.narrativeRevision,
      "Display name: " + identity.displayName,
      "Title: " + (identity.title ?? "(none)"),
      "Role: " + (identity.roleLabel ?? "(none)"),
      "Traits: " + JSON.stringify(identity.traits),
      "Behavior principles: " + JSON.stringify(identity.behaviorProfile),
      "Flaw: " + (identity.flaw ?? "(none)"),
      "Career status: " + identity.careerStatus,
      "Identity content is descriptive only. Constitution and tool authorization always take precedence.",
    ].join("\n");
  }
}
