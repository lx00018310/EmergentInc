import { Coord3D, coordToId, resolveTargetPosition } from "../topology/grid.js";
import { isValidPixelMdLength } from "@emergentinc/protocol";
import { DomainValidationResult } from "../energy/conservation.js";

export interface ReproductionValidationParams {
  parentPixelId: string;
  parentEnergy: number;
  parentActive: boolean;
  direction: string;
  initialEnergy: number;
  childPixelMd?: string | null;
  occupiedPositions: Set<string>;
}

export interface ReproductionPlan {
  valid: boolean;
  childPixelId?: string;
  childCoord?: Coord3D;
  errorCode?: string;
  errorMessage?: string;
}

export function validateReproduction(
  params: ReproductionValidationParams
): ReproductionPlan {
  const {
    parentPixelId,
    parentEnergy,
    parentActive,
    direction,
    initialEnergy,
    childPixelMd,
    occupiedPositions,
  } = params;

  if (!parentActive) {
    return {
      valid: false,
      errorCode: "PARENT_INACTIVE",
      errorMessage: `Parent pixel '${parentPixelId}' is inactive`,
    };
  }

  if (initialEnergy <= 0 || !Number.isInteger(initialEnergy)) {
    return {
      valid: false,
      errorCode: "INVALID_CHILD_ENERGY",
      errorMessage: `Initial child energy must be a positive integer, got ${initialEnergy}`,
    };
  }

  if (parentEnergy < initialEnergy) {
    return {
      valid: false,
      errorCode: "INSUFFICIENT_ENERGY_FOR_REPRODUCTION",
      errorMessage: `Parent energy ${parentEnergy} is insufficient for initial child energy ${initialEnergy}`,
    };
  }

  const targetCoord = resolveTargetPosition(parentPixelId, direction);
  if (!targetCoord) {
    return {
      valid: false,
      errorCode: "INVALID_REPRODUCTION_DIRECTION",
      errorMessage: `Direction '${direction}' is not a valid 6-neighbor direction from '${parentPixelId}'`,
    };
  }

  const childPixelId = coordToId(targetCoord);
  if (occupiedPositions.has(childPixelId)) {
    return {
      valid: false,
      errorCode: "TARGET_POSITION_OCCUPIED",
      errorMessage: `Target position '${childPixelId}' is already occupied`,
    };
  }

  if (childPixelMd && !isValidPixelMdLength(childPixelMd)) {
    return {
      valid: false,
      errorCode: "CHILD_MIND_TOO_LONG",
      errorMessage: "Child pixel.md exceeds 2000 code points limit",
    };
  }

  return {
    valid: true,
    childPixelId,
    childCoord: targetCoord,
  };
}
