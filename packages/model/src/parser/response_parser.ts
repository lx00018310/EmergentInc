import { AgentDecision, ToolCall } from "@emergentinc/protocol";
import { parseJsonWithRepair } from "./json_repair.js";

export class InvalidModelResponseError extends Error {
  constructor(message: string, public readonly rawText: string) {
    super(message);
    this.name = "InvalidModelResponseError";
  }
}

export function extractJsonString(raw: string): string {
  const trimmed = raw.trim();

  // 1. 优先匹配 ```json ... ``` 块
  const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const match = trimmed.match(jsonBlockRegex);
  if (match && match[1]) {
    return match[1].trim();
  }

  // 2. 匹配最外层 { ... }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.substring(firstBrace, lastBrace + 1).trim();
  }

  return trimmed;
}

export function parseAndNormalizeResponse(
  rawText: string,
  fallbackPixelMd: string,
  fallbackTipsMd: string = ""
): AgentDecision {
  if (!rawText || !rawText.trim()) {
    throw new InvalidModelResponseError("Empty model response text", rawText);
  }

  const jsonStr = extractJsonString(rawText);
  let rawData: any;
  try {
    const { data } = parseJsonWithRepair(jsonStr);
    rawData = data;
  } catch (err: any) {
    throw new InvalidModelResponseError(
      `Failed to parse model response as valid JSON: ${err.message}`,
      rawText
    );
  }

  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    throw new InvalidModelResponseError("Model response is not a JSON object", rawText);
  }

  // 1. pixel_md 归一化
  let pixelMd: string;
  const rawPixelMd = rawData.pixel_md;
  if (typeof rawPixelMd === "string" && rawPixelMd.trim()) {
    pixelMd = rawPixelMd;
  } else {
    pixelMd = fallbackPixelMd;
  }

  // 1.1 tips_md 归一化：显式返回字符串才采用（"" 表示清空）；缺失则保留原 tips
  const tipsMd =
    typeof rawData.tips_md === "string" ? rawData.tips_md : fallbackTipsMd;

  // 2. environment_read 归一化
  let environmentRead = false;
  if ("environment_read" in rawData) {
    environmentRead = Boolean(rawData.environment_read);
  } else if ("read_environment" in rawData) {
    environmentRead = Boolean(rawData.read_environment);
  }

  // 3. message_md & send_to
  let messageMd = "";
  if (typeof rawData.message_md === "string") {
    messageMd = rawData.message_md;
  } else if (Array.isArray(rawData.messages) && rawData.messages.length > 0) {
    const first = rawData.messages[0];
    if (typeof first === "object" && first !== null) {
      messageMd = String(first.content || "");
    } else {
      messageMd = String(first);
    }
  } else if (rawData.message !== undefined && rawData.message !== null) {
    messageMd = String(rawData.message);
  }

  let sendToTarget: string | null = null;
  if (rawData.send_to !== undefined && rawData.send_to !== null) {
    if (Array.isArray(rawData.send_to)) {
      const nonEmpties = rawData.send_to.map(String).filter(Boolean);
      sendToTarget = nonEmpties.length > 0 ? nonEmpties[0] : null;
    } else if (typeof rawData.send_to === "string" && rawData.send_to.trim()) {
      sendToTarget = rawData.send_to.trim();
    }
  }

  if (!sendToTarget) {
    sendToTarget = messageMd.trim() ? "SELF" : "STOP";
  }

  // 4. reproduce 归一化
  let reproduce: any = null;
  const rawRep = rawData.reproduce || (Array.isArray(rawData.reproductions) ? rawData.reproductions[0] : null);
  if (rawRep && typeof rawRep === "object") {
    try {
      const dir = rawRep.direction || (Array.isArray(rawRep.target) ? rawRep.target.join("_") : null);
      const childEnergy = parseInt(rawRep.child_energy || rawRep.initial_energy, 10);
      if (dir && childEnergy >= 1) {
        reproduce = {
          direction: String(dir),
          initial_energy: childEnergy,
        };
      }
    } catch {
      reproduce = null;
    }
  }

  // 5. energy_transfer 归一化
  const rawTransfers = rawData.energy_transfer || rawData.energy_transfers;
  const cleanTransfers: Array<{ target: string; amount: number }> = [];
  if (Array.isArray(rawTransfers)) {
    for (const item of rawTransfers) {
      if (item && typeof item === "object") {
        const to = item.to || item.target;
        const amount = parseInt(item.amount, 10);
        if (to && amount >= 1) {
          cleanTransfers.push({
            target: String(to),
            amount,
          });
        }
      }
    }
  }

  // 6. operations (最多截取前 3 个 Tool)
  const rawOps = rawData.operations;
  const cleanOps: ToolCall[] = [];
  if (Array.isArray(rawOps)) {
    for (const op of rawOps.slice(0, 3)) {
      if (op && typeof op === "object" && op.tool) {
        const rawArgs = op.args !== undefined ? op.args : op.arguments;
        cleanOps.push({
          tool: String(op.tool),
          args: typeof rawArgs === "object" && rawArgs !== null ? rawArgs : {},
        });
      }
    }
  }

  // 7. owner_request
  const ownerReq = rawData.owner_request;
  const cleanOwnerReq =
    ownerReq && typeof ownerReq === "object" && (ownerReq.type || ownerReq.description)
      ? ownerReq
      : null;

  return {
    pixel_md: pixelMd,
    tips_md: tipsMd,
    environment_read: environmentRead,
    operations: cleanOps,
    energy_transfer: cleanTransfers,
    reproduce,
    send_to: sendToTarget,
    message_md: messageMd,
    owner_request: cleanOwnerReq,
    raw_thought: typeof rawData.thought === "string" ? rawData.thought : null,
  };
}
