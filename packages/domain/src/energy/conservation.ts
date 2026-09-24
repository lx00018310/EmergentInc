import { isDirectNeighbor } from "../topology/grid.js";

export interface EnergyTransferValidationParams {
  fromPixelId: string;
  fromEnergy: number;
  fromActive: boolean;
  toPixelId: string;
  toExists: boolean;
  amount: number;
}

export interface DomainValidationResult {
  valid: boolean;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * 校验能量划转是否符合规则与守恒定律
 */
export function validateEnergyTransfer(
  params: EnergyTransferValidationParams
): DomainValidationResult {
  const { fromPixelId, fromEnergy, fromActive, toPixelId, toExists, amount } = params;

  if (!fromActive) {
    return {
      valid: false,
      errorCode: "SENDER_INACTIVE",
      errorMessage: `Sender pixel '${fromPixelId}' is inactive`,
    };
  }

  if (amount <= 0 || !Number.isInteger(amount)) {
    return {
      valid: false,
      errorCode: "INVALID_AMOUNT",
      errorMessage: `Transfer amount must be a positive integer, got ${amount}`,
    };
  }

  if (fromPixelId === toPixelId) {
    return {
      valid: false,
      errorCode: "SELF_TRANSFER_DISALLOWED",
      errorMessage: "Self transfer is disallowed",
    };
  }

  if (!isDirectNeighbor(fromPixelId, toPixelId)) {
    return {
      valid: false,
      errorCode: "NON_NEIGHBOR_TRANSFER",
      errorMessage: `Target '${toPixelId}' is not a direct 6-neighbor of '${fromPixelId}'`,
    };
  }

  if (!toExists) {
    return {
      valid: false,
      errorCode: "TARGET_NOT_FOUND",
      errorMessage: `Target pixel '${toPixelId}' does not exist`,
    };
  }

  if (fromEnergy < amount) {
    return {
      valid: false,
      errorCode: "INSUFFICIENT_ENERGY",
      errorMessage: `Sender energy ${fromEnergy} is less than requested transfer ${amount}`,
    };
  }

  return { valid: true };
}
