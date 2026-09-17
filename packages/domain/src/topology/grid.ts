/**
 * 3D 空间网格与拓扑计算规则 (Domain Logic)
 */

export type Coord3D = [number, number, number];

export const DIRECTION_OFFSETS: Record<string, Coord3D> = {
  UP: [0, 1, 0],
  DOWN: [0, -1, 0],
  LEFT: [-1, 0, 0],
  RIGHT: [1, 0, 0],
  FRONT: [0, 0, 1],
  BACK: [0, 0, -1],
  "+X": [1, 0, 0],
  "-X": [-1, 0, 0],
  "+Y": [0, 1, 0],
  "-Y": [0, -1, 0],
  "+Z": [0, 0, 1],
  "-Z": [0, 0, -1],
};

export function coordToId(pos: Coord3D): string {
  return `${pos[0]}_${pos[1]}_${pos[2]}`;
}

export function idToCoord(id: string): Coord3D {
  const parts = id.split("_").map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid pixel id format for coord: '${id}'`);
  }
  return [parts[0], parts[1], parts[2]];
}

export function getNeighbors6(pixelId: string): string[] {
  const [x, y, z] = idToCoord(pixelId);
  return [
    coordToId([x + 1, y, z]),
    coordToId([x - 1, y, z]),
    coordToId([x, y + 1, z]),
    coordToId([x, y - 1, z]),
    coordToId([x, y, z + 1]),
    coordToId([x, y, z - 1]),
  ];
}

export function isDirectNeighbor(id1: string, id2: string): boolean {
  if (id1 === id2) return false;
  return getNeighbors6(id1).includes(id2);
}

export function resolveTargetPosition(
  originId: string,
  directionOrTarget: string
): Coord3D | null {
  const upper = directionOrTarget.trim().toUpperCase();
  if (DIRECTION_OFFSETS[upper]) {
    const [x, y, z] = idToCoord(originId);
    const [dx, dy, dz] = DIRECTION_OFFSETS[upper];
    return [x + dx, y + dy, z + dz];
  }

  // 尝试按 pixel_id 解析
  try {
    const targetCoord = idToCoord(directionOrTarget);
    if (isDirectNeighbor(originId, directionOrTarget)) {
      return targetCoord;
    }
  } catch {
    // 忽略解析错误
  }
  return null;
}
