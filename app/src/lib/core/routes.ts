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

/** Fallback when no track is known (air, water, or not yet seen): straight legs between stops. */
export function stopLegs(line: Pick<Line, "stops">): Pt[][] {
  if (line.stops.length < 2) return [];
  const pts: Pt[] = line.stops.map((s) => [s.x, s.y]);
  pts.push(pts[0]!);
  return [pts];
}
