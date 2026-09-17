import { isValidMessageMdLength } from "@emergentinc/protocol";
import { isDirectNeighbor } from "../topology/grid.js";
import { DomainValidationResult } from "../energy/conservation.js";

export const MAX_HOPS_PER_ROUND = 20;

export interface MessageRoutingValidationParams {
  sender: string;
  recipient: string;
  content: string;
  hop: number;
  activeNeighbors: Set<string>;
}

export function validateMessageRouting(
  params: MessageRoutingValidationParams
): DomainValidationResult {
  const { sender, recipient, content, activeNeighbors } = params;

  if (!isValidMessageMdLength(content)) {
    return {
      valid: false,
      errorCode: "MESSAGE_TOO_LONG",
      errorMessage: "Message content exceeds 2000 code points limit",
    };
  }

  const targetUpper = recipient.trim().toUpperCase();
  if (targetUpper === "SELF" || targetUpper === "STOP") {
    return { valid: true };
  }

  if (recipient === sender) {
    return { valid: true };
  }

  if (!isDirectNeighbor(sender, recipient)) {
    return {
      valid: false,
      errorCode: "NON_NEIGHBOR_ROUTING",
      errorMessage: `Recipient '${recipient}' is not a direct 6-neighbor of '${sender}'`,
    };
  }

  if (!activeNeighbors.has(recipient)) {
    return {
      valid: false,
      errorCode: "TARGET_INACTIVE",
      errorMessage: `Recipient '${recipient}' is not currently active`,
    };
  }

  return { valid: true };
}

export function isHopLimitReached(hop: number): boolean {
  return hop >= MAX_HOPS_PER_ROUND;
}
