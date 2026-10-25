/**
 * Line tracks from the network edges exported by the mod (live_routes): each edge is a cubic
 * Hermite curve (end positions + tangents, as the game stores them), sampled into a polyline.
 * Pure: world coordinates in, world coordinates out.
 */
import type { Line, LiveRoutes, RouteEdge } from "./live";

export type Pt = [number, number];

const MAX_POINTS = 12;

/** Polyline of one edge: 2 points when straight, up to MAX_POINTS on tight curves. */
export function sampleEdge(e: RouteEdge): Pt[] {
  const dx = e.x1 - e.x0, dy = e.y1 - e.y0;
  const len = Math.hypot(dx, dy);
  const dev = (tx: number, ty: number) => {
    const tl = Math.hypot(tx, ty);
    return tl && len ? Math.abs((tx * dy - ty * dx) / (tl * len)) : 0;
  };
  // Sine of the largest angle between the chord and an end tangent.
  const d = Math.max(dev(e.tx0, e.ty0), dev(e.tx1, e.ty1));
  if (d < 0.01) return [[e.x0, e.y0], [e.x1, e.y1]];
  const n = Math.min(MAX_POINTS, 3 + Math.round(d * 12));
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    out.push([
      h00 * e.x0 + h10 * e.tx0 + h01 * e.x1 + h11 * e.tx1,
      h00 * e.y0 + h10 * e.ty0 + h01 * e.y1 + h11 * e.ty1,
    ]);
  }
  return out;
}

const key = (p: Pt) => `${Math.round(p[0])},${Math.round(p[1])}`;

/** Join edge polylines that share an end point (fewer, longer pieces to draw). */
export function chain(pieces: Pt[][]): Pt[][] {
  const out: Pt[][] = [];
  const byStart = new Map<string, number[]>();
  pieces.forEach((p, i) => {
    const k = key(p[0]!);
    (byStart.get(k) ?? byStart.set(k, []).get(k)!).push(i);
  });
  const used = new Set<number>();
  for (let i = 0; i < pieces.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const line = [...pieces[i]!];
    for (;;) {
      const next = byStart.get(key(line[line.length - 1]!))?.find((j) => !used.has(j));
      if (next === undefined) break;
      used.add(next);
      line.push(...pieces[next]!.slice(1));
    }
    out.push(line);
  }
  return out;
}

/** line id → track polylines (world). Lines without known edges are absent. */
export function buildRoutes(routes: LiveRoutes): Map<number, Pt[][]> {
  const sampled = new Map<number, Pt[]>();
  const out = new Map<number, Pt[][]>();
  for (const [line, { edges: ids, polys }] of routes.lines) {
    const pieces: Pt[][] = [...polys];
    for (const id of ids) {
      let s = sampled.get(id);
      if (!s) {
        const e = routes.edges.get(id);
        if (!e) continue;
        s = sampleEdge(e);
        sampled.set(id, s);
      }
      pieces.push(s);
    }
    if (pieces.length) out.set(line, chain(pieces));
  }
  return out;
}

/** Spatial index of a line's track: points every ~STEP m, binned on a CELL m grid. */
export class TrackIndex {
  private cells = new Map<string, Pt[]>();
  constructor(polys: Pt[][], private cell = 20, step = 10) {
    for (const poly of polys) {
      for (let i = 0; i + 1 < poly.length; i++) {
        const [x0, y0] = poly[i]!, [x1, y1] = poly[i + 1]!;
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
        for (let k = 0; k <= n; k++) this.add([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
      }
      if (poly.length === 1) this.add(poly[0]!);
    }
  }
  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }
  private add(p: Pt): void {
    const k = this.key(p[0], p[1]);
    (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(p);
  }
  /** Is (x, y) within `tol` (≤ cell) of the track? */
  near(x: number, y: number, tol: number): boolean {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const p of this.cells.get(`${cx + i},${cy + j}`) ?? []) if (Math.hypot(p[0] - x, p[1] - y) <= tol) return true;
      }
    }
    return false;
  }
}

/**
 * Pieces of a vehicle trail away from the known track (gaps the mod's paths did not cover): runs of
 * points farther than `tol` from it, extended by one neighbour on each side so they join the
 * track; a jump longer than `maxStep` m (depot, teleport) splits a run.
 */
export function uncovered(trail: Pt[], track: TrackIndex, tol = 20, maxStep = 300): Pt[][] {
  const out: Pt[][] = [];
  let run: Pt[] = [];
  const flush = (next?: Pt) => {
    if (run.length) {
      if (next) run.push(next);
      if (run.length >= 2) out.push(run);
    }
    run = [];
  };
  for (let i = 0; i < trail.length; i++) {
    const p = trail[i]!, prev = trail[i - 1];
    if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) > maxStep) flush();
    if (track.near(p[0], p[1], tol)) {
      flush(p);
    } else {
      if (!run.length && prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) <= maxStep) run.push(prev);
      run.push(p);
    }
  }
  flush();
  return out;
}

/** Fallback when no track is known (air, water, or not yet seen): straight legs between stops. */
export function stopLegs(line: Pick<Line, "stops">): Pt[][] {
  if (line.stops.length < 2) return [];
  const pts: Pt[] = line.stops.map((s) => [s.x, s.y]);
  pts.push(pts[0]!);
  return [pts];
}
