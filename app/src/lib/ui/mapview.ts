/**
 * Shared 2D map view for GridLab: world Y → canvas x, world X → canvas y (+X down) — the same
 * orientation as the captured tiles / ortho. Pan (drag) and zoom (wheel) around the cursor.
 */
import type { Heightmap } from "$lib/core/lua";

export interface ViewState {
  scale: number;
  ox: number;
  oy: number;
}

export function worldToScreen(v: ViewState, w: number, h: number, wx: number, wy: number) {
  return { sx: w / 2 + v.ox + wy * v.scale, sy: h / 2 + v.oy + wx * v.scale };
}

export function screenToWorld(v: ViewState, w: number, h: number, sx: number, sy: number) {
  return { wy: (sx - w / 2 - v.ox) / v.scale, wx: (sy - h / 2 - v.oy) / v.scale };
}

/** Grey relief + blue water, one pixel per heightmap cell (x = Y index, y = X index). */
export function reliefCanvas(hm: Heightmap): HTMLCanvasElement {
  const n = hm.n;
  const waterLevel = hm.waterLevel;
  let lo = Infinity, hi = -Infinity;
  for (const z of hm.data) {
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  const span = Math.max(1e-6, hi - lo);
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const z = hm.data[j * n + i];
      const k = (i * n + j) * 4; // row = X index (i), column = Y index (j)
      const water = waterLevel != null && z <= waterLevel + 0.05;
      const g = Math.round(40 + 190 * ((z - lo) / span));
      img.data[k] = water ? 40 : g;
      img.data[k + 1] = water ? 80 : g;
      img.data[k + 2] = water ? 140 : g;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function heightRange(hm: Heightmap): { lo: number; hi: number } {
  let lo = Infinity, hi = -Infinity;
  for (const z of hm.data) {
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  return { lo, hi };
}
