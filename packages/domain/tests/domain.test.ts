import { describe, it, expect } from "vitest";
import {
  coordToId,
  idToCoord,
  getNeighbors6,
  isDirectNeighbor,
  resolveTargetPosition,
  validateEnergyTransfer,
  validateReproduction,
  validateMessageRouting,
  isHopLimitReached,
  shouldNaturalWake,
} from "../src/index.js";

describe("Domain: 3D Grid Topology", () => {
  it("should convert between 3D coords and IDs correctly", () => {
    expect(coordToId([1, -2, 3])).toBe("1_-2_3");
    expect(idToCoord("1_-2_3")).toEqual([1, -2, 3]);
  });

  it("should calculate exact 6-neighbors in 3D grid", () => {
    const neighbors = getNeighbors6("0_0_0");
    expect(neighbors).toHaveLength(6);
    expect(neighbors).toEqual(
      expect.arrayContaining([
        "1_0_0",
        "-1_0_0",
        "0_1_0",
        "0_-1_0",
        "0_0_1",
        "0_0_-1",
      ])
    );
  });

  it("should identify direct 6-neighbors", () => {
    expect(isDirectNeighbor("0_0_0", "1_0_0")).toBe(true);
    expect(isDirectNeighbor("0_0_0", "1_1_0")).toBe(false); // 对角线不是 6 邻域
    expect(isDirectNeighbor("0_0_0", "0_0_0")).toBe(false);
  });

  it("should resolve direction to target 3D coordinate", () => {
    expect(resolveTargetPosition("0_0_0", "UP")).toEqual([0, 1, 0]);
    expect(resolveTargetPosition("0_0_0", "+Z")).toEqual([0, 0, 1]);
    expect(resolveTargetPosition("0_0_0", "1_0_0")).toEqual([1, 0, 0]);
    expect(resolveTargetPosition("0_0_0", "2_0_0")).toBeNull();
  });
});

describe("Domain: Energy Conservation & Transfer", () => {
  it("should validate legal energy transfer", () => {
    const result = validateEnergyTransfer({
      fromPixelId: "0_0_0",
      fromEnergy: 1000,
      fromActive: true,
      toPixelId: "1_0_0",
      toExists: true,
      amount: 200,
    });
    expect(result.valid).toBe(true);
  });

  it("should reject illegal energy transfer", () => {
    // 1. 转给自己
    expect(
      validateEnergyTransfer({
        fromPixelId: "0_0_0",
        fromEnergy: 1000,
        fromActive: true,
        toPixelId: "0_0_0",
        toExists: true,
        amount: 100,
      }).errorCode
    ).toBe("SELF_TRANSFER_DISALLOWED");

    // 2. 非直接邻居
    expect(
      validateEnergyTransfer({
        fromPixelId: "0_0_0",
        fromEnergy: 1000,
        fromActive: true,
        toPixelId: "2_0_0",
        toExists: true,
        amount: 100,
      }).errorCode
    ).toBe("NON_NEIGHBOR_TRANSFER");

    // 3. 失活但存在的邻居可获赠 Token 复活
    expect(
      validateEnergyTransfer({
        fromPixelId: "0_0_0",
        fromEnergy: 1000,
        fromActive: true,
        toPixelId: "1_0_0",
        toExists: true,
        amount: 100,
      }).valid
    ).toBe(true);

    expect(
      validateEnergyTransfer({
        fromPixelId: "0_0_0",
        fromEnergy: 1000,
        fromActive: true,
        toPixelId: "1_0_0",
        toExists: false,
        amount: 100,
      }).errorCode
    ).toBe("TARGET_NOT_FOUND");

    // 4. 余额不足
    expect(
      validateEnergyTransfer({
        fromPixelId: "0_0_0",
        fromEnergy: 50,
        fromActive: true,
        toPixelId: "1_0_0",
        toExists: true,
        amount: 100,
      }).errorCode
    ).toBe("INSUFFICIENT_ENERGY");
  });
});

describe("Domain: Reproduction Rules", () => {
  it("should validate successful reproduction to an unoccupied neighbor", () => {
    const result = validateReproduction({
      parentPixelId: "0_0_0",
      parentEnergy: 2000,
      parentActive: true,
      direction: "UP",
      initialEnergy: 500,
      childPixelMd: "I am a child",
      occupiedPositions: new Set(["0_0_0"]),
    });

    expect(result.valid).toBe(true);
    expect(result.childPixelId).toBe("0_1_0");
    expect(result.childCoord).toEqual([0, 1, 0]);
  });

  it("should reject reproduction if target position is already occupied", () => {
    const result = validateReproduction({
      parentPixelId: "0_0_0",
      parentEnergy: 2000,
      parentActive: true,
      direction: "UP",
      initialEnergy: 500,
      occupiedPositions: new Set(["0_0_0", "0_1_0"]),
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("TARGET_POSITION_OCCUPIED");
  });
});

describe("Domain: Routing & Hops", () => {
  it("should route to SELF and STOP without neighbor checks", () => {
    expect(
      validateMessageRouting({
        sender: "0_0_0",
        recipient: "SELF",
        content: "hello self",
        hop: 1,
        activeNeighbors: new Set(),
      }).valid
    ).toBe(true);

    expect(
      validateMessageRouting({
        sender: "0_0_0",
        recipient: "STOP",
        content: "stopping",
        hop: 1,
        activeNeighbors: new Set(),
      }).valid
    ).toBe(true);
  });

  it("should enforce max 20 hops per round", () => {
    expect(isHopLimitReached(19)).toBe(false);
    expect(isHopLimitReached(20)).toBe(true);
    expect(isHopLimitReached(21)).toBe(true);
  });
});

describe("Domain: Natural Wake Rule", () => {
  it("should determine natural wake correctly", () => {
    // 闲置超过阈值且无待决消息 -> 唤醒
    expect(
      shouldNaturalWake({
        pixelId: "0_0_0",
        active: true,
        lastActiveRound: 1,
        currentRound: 6,
        naturalWakeThreshold: 5,
        hasPendingMessages: false,
      })
    ).toBe(true);

    // 有待决消息时不重复自然唤醒
    expect(
      shouldNaturalWake({
        pixelId: "0_0_0",
        active: true,
        lastActiveRound: 1,
        currentRound: 6,
        naturalWakeThreshold: 5,
        hasPendingMessages: true,
      })
    ).toBe(false);

    // 未达阈值时不唤醒
    expect(
      shouldNaturalWake({
        pixelId: "0_0_0",
        active: true,
        lastActiveRound: 2,
        currentRound: 6,
        naturalWakeThreshold: 5,
        hasPendingMessages: false,
      })
    ).toBe(false);
  });
});
