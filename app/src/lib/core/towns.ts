/**
 * Town outlines from the occupied cells of a grid (live_townAreas: building positions binned by the
 * mod): boundary of the cell union traced into rings, holes dropped, corners smoothed (Chaikin).
 * Pure: world coordinates in, world coordinates out.
 */
import type { Pt } from "./routes";

type Cell = [number, number];

/** Signed area (shoelace); the sign tells outer rings from holes. */
export function ringArea(r: Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i]!, [x1, y1] = r[(i + 1) % r.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Outer rings (closed, last point ≠ first) of the union of cells of size `size`. */
export function cellRings(cells: Cell[], size: number): Pt[][] {
  const occ = new Set(cells.map(([x, y]) => `${x},${y}`));
  const has = (x: number, y: number) => occ.has(`${x},${y}`);
  // Directed boundary edges, counter-clockwise around each cell (interior on the left).
  const next = new Map<string, string[]>();
  const add = (a: Cell, b: Cell) => {
    const k = `${a[0]},${a[1]}`;
    (next.get(k) ?? next.set(k, []).get(k)!).push(`${b[0]},${b[1]}`);
  };
  for (const [x, y] of cells) {
    if (!has(x, y - 1)) add([x, y], [x + 1, y]);
    if (!has(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
    if (!has(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
    if (!has(x - 1, y)) add([x, y + 1], [x, y]);
  }
  const rings: Pt[][] = [];
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const ring: Pt[] = [];
      let cur = start;
      for (;;) {
        const outs = next.get(cur);
        if (!outs?.length) break;
        const to = outs.pop()!;
        const [cx, cy] = cur.split(",").map(Number) as Cell;
        ring.push([cx * size, cy * size]);
        cur = to;
        if (cur === start) break;
      }
      if (ring.length >= 4) rings.push(simplify(ring));
    }
  }
  // Counter-clockwise outer boundaries have a positive area; holes are negative.
  return rings.filter((r) => ringArea(r) > 0);
}

/** Drop collinear points (straight runs of cell edges). */
function simplify(r: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[(i - 1 + r.length) % r.length]!, b = r[i]!, c = r[(i + 1) % r.length]!;
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out;
}

/** Chaikin corner cutting on a closed ring. */
export function chaikin(r: Pt[], passes = 2): Pt[] {
  let cur = r;
  for (let p = 0; p < passes; p++) {
    const out: Pt[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i]!, b = cur[(i + 1) % cur.length]!;
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    cur = out;
  }
  return cur;
}

/** Disk of cell offsets of radius r cells. */
function disk(r: number): Cell[] {
  const out: Cell[] = [];
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (dx * dx + dy * dy <= r * r + r) out.push([dx, dy]);
  return out;
}

/**
 * Morphological closing of the occupied cells (dilate by `grow` cells, erode by `shrink`): joins
 * neighbouring blocks and smooths the edge without inventing far-away land.
 */
export function closeCells(cells: Cell[], grow: number, shrink: number): Cell[] {
  const key = (x: number, y: number) => `${x},${y}`;
  const dilated = new Set<string>();
  const dg = disk(grow), ds = disk(shrink);
  for (const [x, y] of cells) for (const [dx, dy] of dg) dilated.add(key(x + dx, y + dy));
  const out: Cell[] = [];
  for (const k of dilated) {
    const [x, y] = k.split(",").map(Number) as Cell;
    if (ds.every(([dx, dy]) => dilated.has(key(x + dx, y + dy)))) out.push([x, y]);
  }
  return out;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker on an open polyline. */
function dp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i]!, pts[0]!, pts[pts.length - 1]!);
    if (d > max) [max, idx] = [d, i];
  }
  if (max <= tol) return [pts[0]!, pts[pts.length - 1]!];
  return [...dp(pts.slice(0, idx + 1), tol).slice(0, -1), ...dp(pts.slice(idx), tol)];
}

/** Douglas-Peucker on a closed ring (split at its farthest point from the first). */
export function simplifyRing(r: Pt[], tol: number): Pt[] {
  if (r.length < 4) return r;
  let far = 0, max = 0;
  for (let i = 1; i < r.length; i++) {
    const d = Math.hypot(r[i]![0] - r[0]![0], r[i]![1] - r[0]![1]);
    if (d > max) [max, far] = [d, i];
  }
  const a = dp(r.slice(0, far + 1), tol), b = dp([...r.slice(far), r[0]!], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Rings smaller than this (m², about a block) are dropped: isolated buildings, scraps. */
const MIN_RING_AREA = 20_000;

/**
 * Outline rings of a town from its building cells (size m): strong closing (≈ +90 m / −70 m) so
 * streets and yards do not notch the edge, boundary tracing, Douglas-Peucker (25 m) and two Chaikin
 * passes — a regular shape with no staircase or waves; tiny rings are dropped.
 */
export function townOutline(cells: Cell[], size: number): Pt[][] {
  const grow = Math.max(1, Math.round(90 / size)), shrink = Math.max(0, Math.round(70 / size));
  return cellRings(closeCells(cells, grow, shrink), size)
    .filter((r) => ringArea(r) >= MIN_RING_AREA)
    .map((r) => simplifyRing(r, 25))
    .filter((r) => r.length >= 3)
    .map((r) => chaikin(r, 2));
}

/** Point in any of the rings (even-odd). */
export function insideRings(rings: Pt[][], x: number, y: number): boolean {
  for (const r of rings) {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i]!, [xj, yj] = r[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}
