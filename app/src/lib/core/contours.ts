/**
 * Contour lines of the exported heightmap (marching squares on the cell centres). Pure: world
 * coordinates out, same grid convention as Heightmap / heightAt (x = minX + (i + 0.5)·cellX).
 */
import type { Heightmap } from "./lua";
import type { Pt } from "./routes";
import { chaikin, simplifyLine, simplifyRing } from "./towns";

/** Every MAJOR-th contour is an index contour (thicker, labelled). */
export const MAJOR = 5;

export interface ContourLevel {
  z: number;
  major: boolean;
  lines: Pt[][];
}

/** Round interval (1, 2, 5 × 10ⁿ m) giving about `target` contours over [min, max]. */
export function contourStep(min: number, max: number, target = 25): number {
  const raw = Math.max(1e-6, (max - min) / target);
  const p = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 5, 10].find((m) => m * p >= raw * (1 - 1e-9)) ?? 10) * p;
}

/** Lowest and highest ground of the heightmap. */
export function heightRange(hm: Heightmap): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const v of hm.data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** Chaikin corner cutting on an open polyline, ends kept. */
function chaikinOpen(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]!];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/**
 * Contours every `step` m (levels at or under the water level are skipped: water is flat).
 * Segments are joined through the grid edge they cross, so neighbouring cells share exact points;
 * closed contours come back closed (first point repeated).
 */
export function contourLines(hm: Heightmap, step: number, smooth: { tol: number; passes: number } = { tol: 0.15, passes: 1 }): ContourLevel[] {
  const { n, data } = hm;
  if (n < 2 || !(step > 0)) return [];
  const { min, max } = heightRange(hm);
  const floor = hm.waterLevel ?? -Infinity;
  const first = Math.ceil(min / step);
  const levels: number[] = [];
  for (let k = first; k * step <= max; k++) if (k * step > floor) levels.push(k);
  if (!levels.length) return [];

  // Grid edge ids: horizontal (i,j)–(i+1,j) = 2·(j·n+i), vertical (i,j)–(i,j+1) = 2·(j·n+i)+1.
  const H = (i: number, j: number) => 2 * (j * n + i), V = (i: number, j: number) => 2 * (j * n + i) + 1;
  const links = new Map<number, Map<number, number[]>>(levels.map((k) => [k, new Map()]));
  const link = (m: Map<number, number[]>, a: number, b: number) => {
    (m.get(a) ?? m.set(a, []).get(a)!).push(b);
    (m.get(b) ?? m.set(b, []).get(b)!).push(a);
  };
  const lo = levels[0]!, hi = levels[levels.length - 1]!;
  for (let j = 0; j + 1 < n; j++) {
    for (let i = 0; i + 1 < n; i++) {
      const a = data[j * n + i]!, b = data[j * n + i + 1]!, c = data[(j + 1) * n + i + 1]!, d = data[(j + 1) * n + i]!;
      const kMin = Math.max(lo, Math.ceil(Math.min(a, b, c, d) / step));
      const kMax = Math.min(hi, Math.floor(Math.max(a, b, c, d) / step));
      for (let k = kMin; k <= kMax; k++) {
        const z = k * step;
        const ua = a >= z, ub = b >= z, uc = c >= z, ud = d >= z;
        const bottom = ua !== ub, right = ub !== uc, top = ud !== uc, left = ua !== ud;
        const m = links.get(k);
        if (!m || !(bottom || right || top || left)) continue;
        const eB = H(i, j), eR = V(i + 1, j), eT = H(i, j + 1), eL = V(i, j);
        if (bottom && right && top && left) {
          // Saddle: the centre decides which pair of opposite corners stays connected.
          const centreUp = (a + b + c + d) / 4 >= z;
          if (ua === centreUp) { link(m, eB, eR); link(m, eT, eL); } else { link(m, eL, eB); link(m, eR, eT); }
        } else {
          const ends = [bottom && eB, right && eR, top && eT, left && eL].filter((e): e is number => e !== false);
          if (ends.length === 2) link(m, ends[0]!, ends[1]!);
        }
      }
    }
  }

  const x = (i: number) => hm.minX + (i + 0.5) * hm.cellX, y = (j: number) => hm.minY + (j + 0.5) * hm.cellY;
  /** Crossing point of level z on a grid edge (linear interpolation). */
  const point = (e: number, z: number): Pt => {
    const cell = e >> 1, i = cell % n, j = (cell - i) / n;
    const v0 = data[cell]!, v1 = e & 1 ? data[cell + n]! : data[cell + 1]!;
    const t = v1 === v0 ? 0.5 : (z - v0) / (v1 - v0);
    return e & 1 ? [x(i), y(j + t)] : [x(i + t), y(j)];
  };
  const tol = smooth.tol * Math.min(hm.cellX, hm.cellY);

  return levels.map((k) => {
    const z = k * step, m = links.get(k)!;
    const used = new Set<number>(), lines: Pt[][] = [];
    const walk = (start: number) => {
      const ids = [start];
      used.add(start);
      for (let cur = start; ;) {
        const next = m.get(cur)!.find((e) => !used.has(e));
        if (next === undefined) {
          if (ids.length > 2 && m.get(cur)!.includes(start)) ids.push(start);
          break;
        }
        used.add(next);
        ids.push(next);
        cur = next;
      }
      const pts = ids.map((e) => point(e, z));
      const closed = ids.length > 3 && ids[0] === ids[ids.length - 1];
      if (closed) {
        const ring = chaikin(simplifyRing(pts.slice(0, -1), tol), smooth.passes);
        if (ring.length >= 3) lines.push([...ring, ring[0]!]);
      } else if (pts.length >= 2) {
        let line = simplifyLine(pts, tol);
        for (let p = 0; p < smooth.passes; p++) line = chaikinOpen(line);
        lines.push(line);
      }
    };
    // Open contours start at a map border (one neighbour), then the closed loops.
    for (const [e, nb] of m) if (nb.length === 1 && !used.has(e)) walk(e);
    for (const e of m.keys()) if (!used.has(e)) walk(e);
    return { z, major: k % MAJOR === 0, lines };
  }).filter((l) => l.lines.length);
}

/** Water ponds smaller than this (cells) are dropped: rounding noise, not water in the game. */
const MIN_WATER_CELLS = 6;
/**
 * Mines and pits dig the ground below the water level, and the game then reports water there
 * (isOnWater, seen on the real map: −10 m pits of ≈ 35 cells next to coal mines) although none is
 * drawn. A patch smaller than this (cells) with an industry within PIT_RADIUS_M is not water.
 */
const PIT_MAX_CELLS = 60;
const PIT_RADIUS_M = 300;

export interface WaterOptions {
  /** Industry positions (world): small water patches next to them are pits, not water. */
  industries?: readonly { x: number; y: number }[];
}

/**
 * Water cells (n × n, 1 = water; index j·n + i like the heightmap).
 * - Newer exports carry the game's own water flag per cell (`hm.water`, isOnWater): used as is.
 * - Otherwise: cells exactly at the water level (the mod lifts only the game's water to it; dry
 *   ground below keeps its height), grouped in patches; ground dug down to the water level (mines,
 *   pits, quarries) is also exactly at it, so a patch is kept only if the coarse map.lua grid says
 *   water inside it (`hm.waterGrid`), or, without that grid, if it is not tiny.
 * Patches smaller than MIN_WATER_CELLS are dropped either way (noise), and so are small patches
 * next to an industry (pits, see PIT_MAX_CELLS).
 */
export function waterCells(hm: Heightmap, opts: WaterOptions = {}): Uint8Array {
  const { n, data } = hm;
  if (hm.waterLevel === null && !hm.water) return new Uint8Array(n * n);
  const out = hm.water ? hm.water.slice() : new Uint8Array(n * n);
  if (!hm.water) {
    const wl = hm.waterLevel!;
    for (let k = 0; k < n * n; k++) if (Math.abs(data[k]! - wl) < 0.006) out[k] = 1;
  }
  const g = hm.water ? undefined : hm.waterGrid;
  const coarseWet = (k: number) => {
    const i = k % n, j = (k - i) / n;
    const x = hm.minX + (i + 0.5) * hm.cellX, y = hm.minY + (j + 0.5) * hm.cellY;
    const gi = Math.floor((x - g!.minX) / g!.cellX), gj = Math.floor((y - g!.minY) / g!.cellY);
    return gi >= 0 && gj >= 0 && gi < g!.n && gj < g!.n && g!.water[gj * g!.n + gi] === 1;
  };
  // Connected patches (4-neighbours).
  const seen = new Uint8Array(n * n), stack: number[] = [], patch: number[] = [];
  for (let k0 = 0; k0 < n * n; k0++) {
    if (!out[k0] || seen[k0]) continue;
    stack.push(k0);
    seen[k0] = 1;
    patch.length = 0;
    while (stack.length) {
      const k = stack.pop()!, i = k % n, j = (k - i) / n;
      patch.push(k);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const q = b * n + a;
        if (out[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    let keep = patch.length >= MIN_WATER_CELLS && (!g || patch.some(coarseWet));
    if (keep && patch.length < PIT_MAX_CELLS && opts.industries?.length) {
      let cx = 0, cy = 0;
      for (const k of patch) {
        const i = k % n;
        cx += hm.minX + (i + 0.5) * hm.cellX;
        cy += hm.minY + ((k - i) / n + 0.5) * hm.cellY;
      }
      cx /= patch.length;
      cy /= patch.length;
      if (opts.industries.some((p) => Math.hypot(p.x - cx, p.y - cy) <= PIT_RADIUS_M)) keep = false;
    }
    if (!keep) for (const k of patch) out[k] = 0;
  }
  return out;
}

/** Shorelines (world coordinates): the outline of the water cells, traced half way to the land. */
export function shorelines(hm: Heightmap, opts: WaterOptions = {}): Pt[][] {
  if (hm.waterLevel === null && !hm.water) return [];
  const cells = waterCells(hm, opts);
  // Water = −1, land = +1, blurred so the 0 contour between them follows the shore in curves
  // instead of steps; then simplified and smoothed more than the relief contours.
  const field: Heightmap = { ...hm, waterLevel: null, data: blur(Float64Array.from(cells, (w) => (w ? -1 : 1)), hm.n, SHORE_BLUR) };
  return contourLines(field, 1e9, { tol: 0.35, passes: 3 }).flatMap((l) => l.lines);
}

/** Box blur passes (radius 1 cell) over the shore field: one keeps the smallest lakes (6 cells). */
const SHORE_BLUR = 1;

/** `passes` 3 × 3 box blurs of an n × n grid (separable, edges clamped). */
function blur(data: Float64Array, n: number, passes: number): Float64Array {
  let cur = data, tmp = new Float64Array(data.length);
  for (let p = 0; p < passes; p++) {
    const next = new Float64Array(data.length);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const r = j * n;
        tmp[r + i] = (cur[r + Math.max(0, i - 1)]! + cur[r + i]! + cur[r + Math.min(n - 1, i + 1)]!) / 3;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        next[j * n + i] = (tmp[Math.max(0, j - 1) * n + i]! + tmp[j * n + i]! + tmp[Math.min(n - 1, j + 1) * n + i]!) / 3;
      }
    }
    cur = next;
  }
  return cur;
}

/** Water mask (n × n, 1 = water) in the map frame like reliefPixels: pixel (col j, row i) = cell (i, j). */
export function waterMask(hm: Heightmap, opts: WaterOptions = {}): Uint8Array {
  const { n } = hm, cells = waterCells(hm, opts), out = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (cells[j * n + i]) out[i * n + j] = 1;
  return out;
}
