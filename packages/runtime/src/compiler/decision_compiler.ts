import * as crypto from "node:crypto";
import {
  AgentDecision,
  Effect,
  UpdateMindEffect,
  CapabilityUnavailableEffect,
  ReadEnvironmentEffect,
  ToolCallEffect,
  TransferEnergyEffect,
  ReproduceEffect,
  RouteMessageEffect,
} from "@emergentinc/protocol";

function sha256(data: any): string {
  const str = typeof data === "string" ? data : JSON.stringify(data);
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

export interface CompileDecisionParams {
  decision: AgentDecision;
  pixelId: string;
  messageId: string;
  currentHop: number;
}

export class DecisionCompiler {
  public static compile(params: CompileDecisionParams): Effect[] {
    const { decision, pixelId, messageId, currentHop } = params;
    const effects: Effect[] = [];
    let effectIndex = 0;

    // 1. UpdateMindEffect
    if (decision.pixel_md !== undefined && decision.pixel_md !== null) {
      const payloadHash = sha256(decision.pixel_md);
      const effect: UpdateMindEffect = {
        effectId: `eff_${messageId}_${effectIndex}_${payloadHash.substring(0, 8)}`,
        messageId,
        effectType: "UPDATE_MIND",
        effectIndex: effectIndex++,
        payloadHash,
        status: "PENDING",
        pixelId,
        content: decision.pixel_md,
      };
      effects.push(effect);
    }

    // 2. CapabilityUnavailableEffect (若模型生成了 owner_request)
    if (decision.owner_request) {
      const payloadHash = sha256(decision.owner_request);
      const effect: CapabilityUnavailableEffect = {
        effectId: `eff_${messageId}_${effectIndex}_${payloadHash.substring(0, 8)}`,
        messageId,
        effectType: "CAPABILITY_UNAVAILABLE",
        effectIndex: effectIndex++,
        payloadHash,
        status: "PENDING",
        pixelId,
        capability: "owner_request",
        rawRequest: decision.owner_request,
      };
      effects.push(effect);
    }

    // 3. ReadEnvironmentEffect
    if (decision.environment_read) {
      const payloadHash = sha256({ environment_read: true });
      const effect: ReadEnvironmentEffect = {
        effectId: `eff_${messageId}_${effectIndex}_${payloadHash.substring(0, 8)}`,
        messageId,
        effectType: "READ_ENVIRONMENT",
        effectIndex: effectIndex++,
        payloadHash,
        status: "PENDING",
        pixelId,
      };
      effects.push(effect);
    }

    // 4. ToolCallEffect (最多截取前 3 个)
    if (Array.isArray(decision.operations)) {
      for (const op of decision.operations.slice(0, 3)) {
        const payloadHash = sha256(op);
        const operationId = `op_${messageId}_${effectIndex}_${payloadHash.substring(0, 8)}`;
        const effect: ToolCallEffect = {
          effectId: `eff_${messageId}_${effectIndex}_${payloadHash.substring(0, 8)}`,
          messageId,
          effectType: "TOOL_CALL",
          effectIndex: effectIndex++,
          payloadHash,
          status: "PENDING",
          pixelId,
          operationId,
          toolCall: op,
        };
        effects.push(effect);
      }
    }

    // 5. TransferEnergyEffect (原始数组顺序)
    if (Array.isArray(decision.energy_transfer)) {
      for (const transfer of decision.energy_transfer) {
        const payloadHash = sha256(transfer);
        const effect: TransferEnergyEffect = {
          effectId: `eff_${messageId}_${effectIndex}_${payloadHash.substring(0, 8)}`,
          messageId,
          effectType: "TRANSFER_ENERGY",
          effectIndex: effectIndex++,
          payloadHash,
          status: "PENDING",
          fromPixelId: pixelId,
          transfer,
        };
        effects.push(effect);
      }
    }

    // 6. ReproduceEffect
    if (decision.reproduce) {
      const payloadHash = sha256(decision.reproduce);
      const effect: ReproduceEffect = {
        effectId: `eff_${messageId}_${effectIndex}_${payloadHash.substring(0, 8)}`,
        messageId,
        effectType: "REPRODUCE",
        effectIndex: effectIndex++,
        payloadHash,
        status: "PENDING",
        parentPixelId: pixelId,
        request: decision.reproduce,
      };
      effects.push(effect);
    }

    // 7. RouteMessageEffect (send_to 且非 STOP)
    if (decision.send_to && decision.send_to.toUpperCase() !== "STOP") {
      const payload = {
        recipient: decision.send_to,
        content: decision.message_md || "",
      };
      const payloadHash = sha256(payload);
      const effect: RouteMessageEffect = {
        effectId: `eff_${messageId}_${effectIndex}_${payloadHash.substring(0, 8)}`,
        messageId,
        effectType: "ROUTE_MESSAGE",
        effectIndex: effectIndex++,
        payloadHash,
        status: "PENDING",
        sender: pixelId,
        recipient: decision.send_to,
        content: decision.message_md || "",
        hop: currentHop + 1,
      };
      effects.push(effect);
    }

    return effects;
  }
}
