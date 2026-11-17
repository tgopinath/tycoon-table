// Board geometry shared by the texture painter, 3D scene and hit-testing.
export const S = 12;            // board edge length (world units)
export const C = 1.6;           // corner size / tile depth
export const W = (S - 2 * C) / 9; // regular tile width
export const BAND = 0.34;       // colour band depth
export const TOP_Y = 0.2;       // board surface height

export interface TileGeom {
  cx: number; cz: number; w: number; d: number; rot: number;
  inward: [number, number]; along: [number, number]; corner: boolean;
}

export function tileGeom(i: number): TileGeom {
  const h = S / 2 - C / 2;
  const corner = i % 10 === 0;
  const side = Math.floor(i / 10);
  const k = i % 10;
  const off = S / 2 - C - W / 2 - (k - 1) * W;
  const base = { w: corner ? C : W, d: C, corner };
  switch (side) {
    case 0: return { ...base, cx: corner ? h : off, cz: h, rot: 0, inward: [0, -1], along: [-1, 0] };
    case 1: return { ...base, cx: -h, cz: corner ? h : off, rot: Math.PI / 2, inward: [1, 0], along: [0, -1] };
    case 2: return { ...base, cx: corner ? -h : -off, cz: -h, rot: Math.PI, inward: [0, 1], along: [1, 0] };
    default: return { ...base, cx: h, cz: corner ? -h : -off, rot: -Math.PI / 2, inward: [-1, 0], along: [0, 1] };
  }
}

export function tileAt(x: number, z: number): number | null {
  for (let i = 0; i < 40; i++) {
    const g = tileGeom(i);
    const dx = x - g.cx, dz = z - g.cz;
    if (g.corner) { if (Math.abs(dx) <= C / 2 && Math.abs(dz) <= C / 2) return i; continue; }
    const a = dx * g.along[0] + dz * g.along[1];
    const n = dx * g.inward[0] + dz * g.inward[1];
    if (Math.abs(a) <= g.w / 2 && Math.abs(n) <= g.d / 2) return i;
  }
  return null;
}

/** World position for a token slot on a tile. */
export function tokenSpot(i: number, slot: number, inJail = false): [number, number] {
  const g = tileGeom(i);
  if (g.corner) {
    if (i === 10 && inJail) {
      const o = [[0.15, -0.15], [0.45, -0.15], [0.15, -0.45], [0.45, -0.45], [0.3, -0.3], [0.45, -0.3]][slot % 6];
      return [g.cx + o[0], g.cz + o[1]];
    }
    if (i === 10) {
      const o = [[-0.55, 0.55], [-0.55, 0.15], [-0.15, 0.55], [-0.55, -0.25], [0.25, 0.55], [-0.55, -0.6]][slot % 6];
      return [g.cx + o[0], g.cz + o[1]];
    }
    const o = [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3], [0, 0], [0, -0.5]][slot % 6];
    return [g.cx + o[0], g.cz + o[1]];
  }
  const grid = [[-0.22, 0.05], [0.22, 0.05], [-0.22, 0.45], [0.22, 0.45], [0, 0.25], [0, -0.2]][slot % 6];
  const a = grid[0] * g.w * 1.6, n = -grid[1]; // n<0 → towards outer edge
  return [g.cx + g.along[0] * a + g.inward[0] * n, g.cz + g.along[1] * a + g.inward[1] * n];
}

/** Building slot positions on the colour band. */
export function buildingSpot(i: number, slot: number): { x: number; z: number; rotY: number } {
  const g = tileGeom(i);
  const n = g.d / 2 - BAND / 2;
  const a = [-0.33, -0.11, 0.11, 0.33][slot] ?? 0;
  const x = g.cx + g.inward[0] * n + g.along[0] * a * g.w;
  const z = g.cz + g.inward[1] * n + g.along[1] * a * g.w;
  return { x, z, rotY: Math.atan2(-g.inward[0], -g.inward[1]) };
}
