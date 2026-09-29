// Warehouse layout + A* pathfinding. Pure TypeScript, no React/Three deps so
// this module can be reused by a future backend integration.

export const GRID_W = 29;
export const GRID_H = 21;
export const CELL = 2;

export type Vec2 = { x: number; y: number };

/** Left x of each 2-cell-wide rack column. */
export const RACK_XS = [4, 8, 12, 16, 20, 24];
/** Rack runs are split by a cross aisle at y = 10. */
export const RACK_SEGMENTS: Array<{ z0: number; z1: number }> = [
  { z0: 3, z1: 9 },
  { z0: 11, z1: 17 },
];

export const RACK_RUNS = RACK_XS.flatMap((x) =>
  RACK_SEGMENTS.map((s) => ({ x, z0: s.z0, z1: s.z1 })),
);

export const PICKUPS: Vec2[] = [
  { x: 1, y: 4 },
  { x: 1, y: 8 },
  { x: 1, y: 12 },
  { x: 1, y: 16 },
];

export const DROPOFFS: Vec2[] = [
  { x: 27, y: 4 },
  { x: 27, y: 8 },
  { x: 27, y: 12 },
  { x: 27, y: 16 },
];

export const CHARGERS: Vec2[] = [
  { x: 2, y: 1 },
  { x: 6, y: 1 },
  { x: 10, y: 1 },
];

/** Vertical aisle x positions (free lanes between rack columns). */
export const AISLE_XS = [1, 2, 3, 6, 7, 10, 11, 14, 15, 18, 19, 22, 23, 26, 27];

export function isRack(x: number, y: number): boolean {
  if (!RACK_XS.some((rx) => x === rx || x === rx + 1)) return false;
  return RACK_SEGMENTS.some((s) => y >= s.z0 && y <= s.z1);
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
}

export const key = (x: number, y: number) => `${x},${y}`;

/** Grid cell -> world coordinates (x, z). Warehouse is centered on origin. */
export function gridToWorld(x: number, y: number): [number, number] {
  return [(x - (GRID_W - 1) / 2) * CELL, (y - (GRID_H - 1) / 2) * CELL];
}

export const WAREHOUSE_WIDTH = GRID_W * CELL;
export const WAREHOUSE_DEPTH = GRID_H * CELL;

export function manhattan(a: Vec2, b: Vec2) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * 4-connected A*. `blocked` holds extra dynamic obstructions (obstacles,
 * blocked aisles, other robots treated as soft blocks by the caller).
 */
export function aStar(start: Vec2, goal: Vec2, blocked: Set<string>): Vec2[] {
  if (!inBounds(start.x, start.y) || !inBounds(goal.x, goal.y)) return [];
  const startK = key(start.x, start.y);
  const goalK = key(goal.x, goal.y);
  if (startK === goalK) return [];

  const open = new Map<string, { cell: Vec2; f: number; g: number }>();
  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const cells = new Map<string, Vec2>();

  cells.set(startK, start);
  gScore.set(startK, 0);
  open.set(startK, { cell: start, g: 0, f: manhattan(start, goal) });

  const closed = new Set<string>();

  while (open.size > 0) {
    let bestK = "";
    let best = Infinity;
    for (const [k, node] of open) {
      if (node.f < best) {
        best = node.f;
        bestK = k;
      }
    }
    const current = open.get(bestK)!;
    open.delete(bestK);
    closed.add(bestK);

    if (bestK === goalK) break;

    const { x, y } = current.cell;
    const neighbours: Vec2[] = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    ];

    for (const n of neighbours) {
      if (!inBounds(n.x, n.y)) continue;
      const nk = key(n.x, n.y);
      if (closed.has(nk)) continue;
      if (isRack(n.x, n.y)) continue;
      if (blocked.has(nk) && nk !== goalK) continue;

      const tentative = current.g + 1;
      if (tentative >= (gScore.get(nk) ?? Infinity)) continue;

      cells.set(nk, n);
      cameFrom.set(nk, bestK);
      gScore.set(nk, tentative);
      open.set(nk, { cell: n, g: tentative, f: tentative + manhattan(n, goal) });
    }
  }

  if (!cameFrom.has(goalK)) return [];

  const path: Vec2[] = [];
  let cursor = goalK;
  while (cursor !== startK) {
    path.push(cells.get(cursor)!);
    cursor = cameFrom.get(cursor)!;
  }
  return path.reverse();
}
