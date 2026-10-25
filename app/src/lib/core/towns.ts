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

/** Smoothed outline rings of a town. */
export function townOutline(cells: Cell[], size: number): Pt[][] {
  return cellRings(cells, size).map((r) => chaikin(r));
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
