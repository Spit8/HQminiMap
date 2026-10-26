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

/** line id → track polylines (world). Lines without known edges are absent. Edge ids are signed
 * (−id: travelled against the edge geometry); here only the place matters. */
/** `sampled`: edges already sampled (routeParts' `edges`), else sampled here. */
export function buildRoutes(routes: LiveRoutes, sampled = new Map<number, Pt[]>()): Map<number, Pt[][]> {
  const out = new Map<number, Pt[][]>();
  for (const [line, { edges: ids, polys }] of routes.lines) {
    const pieces: Pt[][] = [...polys];
    for (const id of new Set(ids.map(Math.abs))) {
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

/** Per-edge view of the tracks (drawn edge by edge: shared stretches, two-way streets). */
export interface RouteParts {
  /** edge id → polyline (world), along the edge geometry. */
  edges: Map<number, Pt[]>;
  /** line → its network edges with the direction(s) travelled (1 along the geometry, −1 against). */
  lineEdges: Map<number, { id: number; dir: 1 | -1 }[]>;
  /** line → its own extra polylines (lanes, bridges, free legs): never shared. */
  linePolys: Map<number, Pt[][]>;
  /** street edge → driving lanes along / against its geometry (unknown: absent). */
  lanes: Map<number, { f: number; b: number }>;
}

export function routeParts(routes: LiveRoutes): RouteParts {
  const edges = new Map<number, Pt[]>();
  const lineEdges: RouteParts["lineEdges"] = new Map(), linePolys = new Map<number, Pt[][]>();
  const lanes: RouteParts["lanes"] = new Map();
  for (const [line, { edges: ids, polys }] of routes.lines) {
    const own: { id: number; dir: 1 | -1 }[] = [];
    for (const signed of ids) {
      const id = Math.abs(signed);
      const e = routes.edges.get(id);
      if (!e) continue;
      if (!edges.has(id)) edges.set(id, sampleEdge(e));
      if (e.lanes) lanes.set(id, e.lanes);
      own.push({ id, dir: signed < 0 ? -1 : 1 });
    }
    lineEdges.set(line, own);
    linePolys.set(line, polys);
  }
  return { edges, lineEdges, linePolys, lanes };
}

/** Join polylines end to end whatever their direction (a piece may be reversed to fit). */
export function chainUndirected(pieces: Pt[][]): Pt[][] {
  const ends = new Map<string, number[]>();
  pieces.forEach((p, i) => {
    for (const q of [p[0]!, p[p.length - 1]!]) (ends.get(key(q)) ?? ends.set(key(q), []).get(key(q))!).push(i);
  });
  const used = new Set<number>();
  /** An unused piece touching p, oriented to start at p. */
  const take = (p: Pt): Pt[] | null => {
    const k = key(p);
    const j = ends.get(k)?.find((i) => !used.has(i));
    if (j === undefined) return null;
    used.add(j);
    const q = pieces[j]!;
    return key(q[0]!) === k ? q : [...q].reverse();
  };
  const out: Pt[][] = [];
  for (let i = 0; i < pieces.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    let line = [...pieces[i]!];
    for (let next = take(line[line.length - 1]!); next; next = take(line[line.length - 1]!)) line.push(...next.slice(1));
    for (let prev = take(line[0]!); prev; prev = take(line[0]!)) line = [...[...prev].reverse(), ...line.slice(1)];
    out.push(line);
  }
  return out;
}

/** Polyline offset sideways by d, or by d[i] at point i (positive: to the right of its direction of travel). */
export function offsetLine(pts: Pt[], d: number | number[]): Pt[] {
  if (pts.length < 2 || (typeof d === "number" && !d)) return pts;
  return pts.map((p, i) => {
    const di = typeof d === "number" ? d : (d[i] ?? 0);
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    // Right-hand normal of (dx, dy) in a y-up frame.
    return [p[0] + (dy / len) * di, p[1] - (dx / len) * di];
  });
}

/** A line's drawn track piece: one lane (or a share of it, in stripes) along consecutive edges. */
export interface LanePiece {
  line: number;
  /** World points, in the line's direction of travel on streets. */
  pts: Pt[];
  /** Offset of each point, in lane widths, to the right of the points' direction. */
  lane: number[];
  /**
   * Lines sharing this lane here, drawn as stripes: k of them, this line the i-th (k = 1: solid).
   * A shared piece covers one edge exactly, from its start: the stripes of its lines line up.
   */
  k: number;
  i: number;
  /**
   * Shared pieces (k > 1): distance (m) of each point along the edge from its start, the same for
   * every line on it; the stripes are measured on it.
   */
  arc?: number[];
  /** Right-hand normal at each point (world, mitred in bends), computed on the whole track. */
  nrm: Pt[];
}

/** Where a line's track ends and another of its tracks begins (branch, detour, a gap in the data). */
export interface LaneEnd {
  /** Centre-line point, right-hand normal, lane offset and direction of travel there. */
  p: Pt;
  n: Pt;
  lane: number;
  dir: Pt;
}

/** A short curve joining two tracks of a line, from the end of one to the start of the other. */
export interface LaneJoint {
  line: number;
  a: LaneEnd;
  b: LaneEnd;
}

/** Length (m) over which a line moves to another lane at a node (instead of a step). */
const RAMP_M = 15;

/**
 * A segment of a line's track: an edge in the direction of travel (`key` = edge|direction), or the
 * line's own piece (station lane, bridge: `own`, takes its neighbours' lane).
 */
interface Seg { pts: Pt[]; off: number; k: number; i: number; key?: string; own?: boolean; flip?: boolean }

/**
 * Lanes of the shown lines, as in the game.
 * - Streets (road, tram): one lane per edge and direction, shared by the lines going that way, in
 *   stripes (one dash each, in turn). Right-hand traffic (the game has no left-hand option): on
 *   two-way streets the lane lies ½ to the right of the direction of travel; on one-way streets it
 *   is centred. The direction comes from the line's track, not only from the recorded one: an edge
 *   that only chains turned round is taken the other way (and so on the other side of the street).
 *   Rail: one centred lane per edge (double tracks are separate edges).
 * - The stripes of a lane are measured along its edge (`arc`), the same for all its lines, so they
 *   line up whatever way each line comes from.
 * - Each line is drawn as continuous tracks (its edges chained in the direction of travel), moving
 *   between lanes over RAMP_M at the nodes; where its data leaves separate tracks (branches,
 *   detours), joints link them.
 */
export function laneLayout(parts: RouteParts, lines: { id: number; rank: number; twoWay: boolean }[]):
  { pieces: LanePiece[]; joints: LaneJoint[] } {
  const order = [...lines].sort((a, b) => b.rank - a.rank || a.id - b.id);
  /** key → lanes available, lanes' occupants (in the order they were given). */
  const lanesOf = new Map<string, { S: number; oneWay: boolean; slots: number[][] }>();
  const laneInfo = (id: number, d: -1 | 0 | 1, key: string) => {
    let v = lanesOf.get(key);
    if (!v) {
      const ln = parts.lanes.get(id);
      const S = 1;
      v = { S, oneWay: !!ln && (ln.f === 0 || ln.b === 0), slots: Array.from({ length: S }, () => []) };
      lanesOf.set(key, v);
    }
    return v;
  };
  /** line → its runs (chained segments), and each segment's lane. */
  const runsOf = new Map<number, Seg[][]>();
  const slotOf = new Map<Seg, number>();
  for (const l of order) {
    const segs: Seg[] = [];
    const seen = new Set<string>();
    for (const { id, dir } of parts.lineEdges.get(l.id) ?? []) {
      const pts = parts.edges.get(id);
      if (!pts) continue;
      const d = l.twoWay ? dir : 0, key = `${id}|${d}`;
      if (seen.has(key)) continue;
      seen.add(key);
      laneInfo(id, d, key);
      segs.push({ pts: d < 0 ? [...pts].reverse() : pts, off: 0, k: 1, i: 0, key });
    }
    for (const pts of parts.linePolys.get(l.id) ?? []) if (pts.length >= 2) segs.push({ pts, off: 0, k: 1, i: 0, own: true });
    const runs = chainSegs(segs, l.twoWay);
    // Edges turned round by the chaining: travelled the other way, so in that direction's lanes.
    for (const run of l.twoWay ? runs : []) {
      for (const sg of run) {
        if (!sg.flip || !sg.key || sg.own) continue;
        const [id, d] = sg.key.split("|").map(Number) as [number, -1 | 1];
        sg.key = `${id}|${-d}`;
        laneInfo(id, -d as -1 | 1, sg.key);
      }
    }
    runsOf.set(l.id, runs);
    // Sticky lanes along each run.
    for (const run of runs) {
      let prev: number | null = null;
      for (const sg of run) {
        if (!sg.key) continue;
        const info = lanesOf.get(sg.key)!;
        let j = info.slots.findIndex((occ) => occ.includes(l.id)); // a loop through the same edge
        if (j < 0) {
          const free = (q: number) => info.slots[q]!.length === 0;
          j = prev !== null && prev < info.S && free(prev) ? prev
            : info.slots.findIndex((occ) => occ.length === 0);
          if (j < 0) {
            // Every lane taken: share one (the previous one if possible, else the least used).
            j = prev !== null && prev < info.S ? prev
              : info.slots.reduce((best, occ, q) => (occ.length < info.slots[best]!.length ? q : best), 0);
          }
          info.slots[j]!.push(l.id);
        }
        slotOf.set(sg, j);
        prev = j;
      }
    }
  }
  // Offsets and shares, now that every line has its lanes.
  for (const [lineId, runs] of runsOf) {
    for (const run of runs) {
      for (const sg of run) {
        if (!sg.key) continue;
        const info = lanesOf.get(sg.key)!, j = slotOf.get(sg)!, occ = info.slots[j]!;
        const d = sg.key.endsWith("|0") ? 0 : 1;
        sg.off = d === 0 ? 0 : info.oneWay ? j - (info.S - 1) / 2 : j + 0.5;
        sg.k = occ.length;
        sg.i = occ.indexOf(lineId);
      }
    }
  }
  const pieces: LanePiece[] = [];
  const tracks: { line: number; first: LaneEnd; last: LaneEnd }[] = [];
  const trackOf = new Map<LanePiece, number>();
  for (const l of order) {
    for (const run of runsOf.get(l.id)!) {
      const ps = piecesOf(l.id, run);
      if (!ps.length) continue;
      pieces.push(...ps);
      for (const pc of ps) trackOf.set(pc, tracks.length);
      const f = ps[0]!, z = ps[ps.length - 1]!;
      tracks.push({
        line: l.id,
        first: { p: f.pts[0]!, n: f.nrm[0]!, lane: f.lane[0]!, dir: unitDir(f.pts[0]!, f.pts[1]!) },
        last: { p: z.pts.at(-1)!, n: z.nrm.at(-1)!, lane: z.lane.at(-1)!, dir: unitDir(z.pts.at(-2)!, z.pts.at(-1)!) },
      });
    }
  }
  return { pieces, joints: jointsOf(tracks, pieces, trackOf) };
}

const unitDir = (a: Pt, b: Pt): Pt => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};

/** Smallest cosine between the directions of travel a joint links (about 100°: no U-turns drawn). */
const JOINT_COS = -0.17;

/**
 * Joints between the separate tracks of each line: where a track ends, the line goes on along
 * another of its tracks within JOINT_M — preferably from that track's start, else from a point in
 * its middle (a branch) — and likewise where a track starts. Only ends whose directions of travel
 * agree are linked (no U-turn across the street), at most one joint per end, none where the two
 * ends already meet in the same lane.
 */
function jointsOf(tracks: { line: number; first: LaneEnd; last: LaneEnd }[], pieces: LanePiece[], trackOf: Map<LanePiece, number>): LaneJoint[] {
  const out: LaneJoint[] = [];
  // Per line: its pieces (with their bounding box) and its tracks — a line only joins its own.
  const byLine = new Map<number, { pc: LanePiece; box: [number, number, number, number] }[]>();
  for (const pc of pieces) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pc.pts) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    (byLine.get(pc.line) ?? byLine.set(pc.line, []).get(pc.line)!).push({ pc, box: [x0, y0, x1, y1] });
  }
  const tracksOf = new Map<number, number[]>();
  tracks.forEach((t, n) => (tracksOf.get(t.line) ?? tracksOf.set(t.line, []).get(t.line)!).push(n));
  const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const agree = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1] >= JOINT_COS;
  /**
   * Where the line goes on from `e` (outgoing: e is a track's end; else e is a track's start and
   * this is where the line comes from): another track's start (end), else its nearest point.
   */
  const target = (line: number, e: LaneEnd, track: number, outgoing: boolean): LaneEnd | null => {
    let best: { d: number; e: LaneEnd } | null = null;
    for (const n of tracksOf.get(line) ?? []) {
      if (n === track) continue;
      const t = tracks[n]!, o = outgoing ? t.first : t.last, d = dist(o.p, e.p);
      if (d <= JOINT_M && agree(e.dir, o.dir) && (!best || d < best.d)) best = { d, e: o };
    }
    if (best) return best.e;
    const [qx, qy] = e.p;
    for (const { pc, box } of byLine.get(line) ?? []) {
      if (trackOf.get(pc) === track) continue;
      // Farther than JOINT_M from the whole piece: none of its points can do.
      if (qx < box[0] - JOINT_M || qx > box[2] + JOINT_M || qy < box[1] - JOINT_M || qy > box[3] + JOINT_M) continue;
      for (let v = 0; v < pc.pts.length; v++) {
        const p = pc.pts[v]!, d = dist(p, e.p);
        if (d > JOINT_M || (best && d >= best.d)) continue;
        const dir = unitDir(pc.pts[Math.max(0, v - 1)]!, pc.pts[Math.min(pc.pts.length - 1, v + 1)]!);
        if (agree(e.dir, dir)) best = { d, e: { p, n: pc.nrm[v]!, lane: pc.lane[v]!, dir } };
      }
    }
    return best?.e ?? null;
  };
  const seen = new Set<string>();
  const add = (line: number, a: LaneEnd, b: LaneEnd) => {
    // Already meeting: same point, same offset (normal × lane) whatever the scale.
    const sa: Pt = [a.n[0] * a.lane, a.n[1] * a.lane], sb: Pt = [b.n[0] * b.lane, b.n[1] * b.lane];
    if (dist(a.p, b.p) < 0.5 && dist(sa, sb) < 0.05) return;
    const k = `${line}|${a.p.join(",")}|${b.p.join(",")}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ line, a, b });
  };
  tracks.forEach((t, n) => {
    const from = target(t.line, t.first, n, false);
    if (from) add(t.line, from, t.first);
    const to = target(t.line, t.last, n, true);
    if (to) add(t.line, t.last, to);
  });
  return out;
}

/** Ends closer than this (m) are joined: the game's own pieces (lanes) lie off the street's centre line. */
const JOIN_M = 12;
const CELL_M = 10;
/** Joints bridge a line's tracks up to this far apart (gaps in the vehicles' recorded paths). */
const JOINT_M = 40;

/**
 * Segments joined into runs: end to start (directed), or end to end (undirected, reversing as
 * needed), within JOIN_M. Where several segments could follow (branches, a loop through the same
 * node), the one going on the straightest wins. Directed: a line's own pieces may be turned round
 * freely; a network edge only when nothing follows as recorded (its recorded direction is wrong:
 * it is marked `flip`), and a run mostly made of turned edges is turned round as a whole (it was
 * started from a wrong one).
 */
function chainSegs(segs: Seg[], directed: boolean): Seg[][] {
  const cell = (p: Pt) => `${Math.floor(p[0] / CELL_M)},${Math.floor(p[1] / CELL_M)}`;
  const grid = new Map<string, number[]>();
  const add = (p: Pt, i: number) => {
    const k = cell(p);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  };
  segs.forEach((sg, i) => {
    add(sg.pts[0]!, i);
    add(sg.pts[sg.pts.length - 1]!, i);
  });
  const near = (p: Pt): number[] => {
    const cx = Math.floor(p[0] / CELL_M), cy = Math.floor(p[1] / CELL_M), out = new Set<number>();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of grid.get(`${cx + dx},${cy + dy}`) ?? []) out.add(i);
    return [...out];
  };
  const used = new Set<number>();
  const rev = (sg: Seg): Seg => ({ ...sg, pts: [...sg.pts].reverse(), flip: !sg.own && !sg.flip });

  const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const unit = (a: Pt, b: Pt): Pt => {
    const l = dist(a, b) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  /**
   * The unused segment best continuing the run at p (forward: leaving p in direction `dir`;
   * backward: arriving at p), oriented for the run; null if none within JOIN_M.
   */
  const pick = (p: Pt, dir: Pt, forward: boolean): Seg | null => pickAmong(p, dir, forward, false)
    ?? (directed ? pickAmong(p, dir, forward, true) : null);
  const pickAmong = (p: Pt, dir: Pt, forward: boolean, turnEdges: boolean): Seg | null => {
    let best: { j: number; sg: Seg; score: number } | null = null;
    for (const j of near(p)) {
      if (used.has(j)) continue;
      const sg = segs[j]!, turnable = !directed || !!sg.own || turnEdges;
      for (const cand of turnable ? [sg, rev(sg)] : [sg]) {
        const end = forward ? cand.pts[0]! : cand.pts[cand.pts.length - 1]!;
        const gap = dist(end, p);
        if (gap > JOIN_M) continue;
        const inner = forward ? cand.pts[1]! : cand.pts[cand.pts.length - 2]!;
        const d = forward ? unit(end, inner) : unit(inner, end);
        const turn = 1 - (d[0] * dir[0] + d[1] * dir[1]); // 0 straight on … 2 U-turn
        const score = gap + turn * 20;
        if (!best || score < best.score) best = { j, sg: cand, score };
      }
    }
    if (!best) return null;
    used.add(best.j);
    return best.sg;
  };
  const out: Seg[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const run = [segs[i]!];
    for (;;) {
      const last = run[run.length - 1]!.pts, e = last[last.length - 1]!;
      const sg = pick(e, unit(last[last.length - 2]!, e), true);
      if (!sg) break;
      run.push(sg);
    }
    for (;;) {
      const first = run[0]!.pts, b0 = first[0]!;
      const sg = pick(b0, unit(b0, first[1]!), false);
      if (!sg) break;
      run.unshift(sg);
    }
    if (directed) {
      const len = (f: boolean) => run.reduce((a, x) => (!x.own && !!x.flip === f ? a + segLen(x.pts) : a), 0);
      if (len(true) > len(false)) {
        out.push(run.reverse().map(rev));
        continue;
      }
    }
    out.push(run);
  }
  return out;
}

const segLen = (pts: Pt[]) => pts.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - pts[i - 1]![0], q[1] - pts[i - 1]![1]) : 0), 0);

/** Point at distance t (m) along a polyline from its start (inserted between its vertices). */
function pointAlong(pts: Pt[], t: number): { at: number; p: Pt } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + l >= t && l > 0) {
      const u = (t - acc) / l;
      return { at: i, p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u] };
    }
    acc += l;
  }
  return { at: pts.length - 1, p: pts[pts.length - 1]! };
}

/** Right-hand normals (y up) of a polyline, mitred at the vertices (bounded in sharp bends). */
export function mitredNormals(pts: Pt[]): Pt[] {
  const n = pts.length, dirs: (Pt | null)[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const dx = pts[i + 1]![0] - pts[i]![0], dy = pts[i + 1]![1] - pts[i]![1], l = Math.hypot(dx, dy);
    dirs.push(l > 1e-9 ? [dx / l, dy / l] : null);
  }
  // Zero-length steps take the nearest real direction.
  {
    let prev: Pt | null = null;
    const next: (Pt | null)[] = new Array(dirs.length).fill(null);
    for (let i = dirs.length - 1, nx: Pt | null = null; i >= 0; i--) {
      next[i] = nx;
      if (dirs[i]) nx = dirs[i]!;
    }
    for (let i = 0; i < dirs.length; i++) {
      if (dirs[i]) prev = dirs[i]!;
      else dirs[i] = prev ?? next[i] ?? [1, 0];
    }
  }
  const right = (d: Pt): Pt => [d[1], -d[0]];
  return pts.map((_, i) => {
    const a = i > 0 ? right(dirs[i - 1]!) : null, b = i < n - 1 ? right(dirs[i]!) : null;
    if (!a || !b) return (a ?? b ?? [0, 0]) as Pt;
    const sx = a[0] + b[0], sy = a[1] + b[1], l = Math.hypot(sx, sy);
    if (l < 1e-6) return a; // U-turn on the spot
    const u: Pt = [sx / l, sy / l], m = 1 / Math.max(0.4, u[0] * a[0] + u[1] * a[1]);
    return [u[0] * m, u[1] * m];
  });
}

/**
 * A chained run → its whole track (points, lane offset per point, normals over the whole track),
 * then cut into pieces: wherever the lane share changes, and, on shared lanes, at every edge (the
 * stripes of the lines sharing a lane all start on the same node, so they line up). The pieces share
 * their end points and normals: the line is drawn without a break.
 */
function piecesOf(line: number, run: Seg[]): LanePiece[] {
  // Own pieces take the lane of their nearest network neighbour (before, else after), drawn solid.
  // Nearest network segment before and after each position (one pass each way).
  const before: (Seg | undefined)[] = [], after: (Seg | undefined)[] = [];
  for (let n = 0, last: Seg | undefined; n < run.length; n++) {
    before[n] = last;
    if (!run[n]!.own) last = run[n];
  }
  for (let n = run.length - 1, last: Seg | undefined; n >= 0; n--) {
    after[n] = last;
    if (!run[n]!.own) last = run[n];
  }
  run.forEach((sg, n) => {
    if (!sg.own) return;
    const near = before[n] ?? after[n];
    Object.assign(sg, { off: near?.off ?? 0, k: 1, i: 0 });
  });
  const P: Pt[] = [], O: number[] = [], A: number[] = [], share: { k: number; i: number; seg: number }[] = [];
  run.forEach((sg, n) => {
    const prev = run[n - 1], nxt = run[n + 1];
    let pts = [...sg.pts];
    let lane = pts.map(() => sg.off);
    const r = Math.min(RAMP_M, segLen(sg.pts) / 3);
    // Moving to another lane at a node: half way at the node, own lane RAMP_M further.
    if (prev && prev.off !== sg.off && r > 0) {
      const { at, p } = pointAlong(pts, r);
      pts = [pts[0]!, p, ...pts.slice(at)];
      lane = [(prev.off + sg.off) / 2, sg.off, ...lane.slice(at)];
    }
    if (nxt && nxt.off !== sg.off && r > 0) {
      const back = [...pts].reverse(), { at, p } = pointAlong(back, r);
      const keep = pts.length - at;
      pts = [...pts.slice(0, keep), p, pts[pts.length - 1]!];
      lane = [...lane.slice(0, keep), sg.off, (nxt.off + sg.off) / 2];
    }
    const from = n === 0 ? 0 : 1; // the node is already the previous segment's last point
    let arc = 0;
    for (let q = 0; q < pts.length; q++) {
      if (q) arc += Math.hypot(pts[q]![0] - pts[q - 1]![0], pts[q]![1] - pts[q - 1]![1]);
      if (q < from) continue;
      P.push(pts[q]!);
      O.push(lane[q]!);
      A.push(arc);
      share.push({ k: sg.k, i: sg.i, seg: n });
    }
  });
  const N = mitredNormals(P);
  const out: LanePiece[] = [];
  let start = 0;
  for (let q = 1; q <= P.length; q++) {
    const a = share[q - 1]!, b = share[q];
    const cut = q === P.length || b!.k !== a.k || b!.i !== a.i || (a.k > 1 && b!.seg !== a.seg);
    if (!cut) continue;
    // A piece ends on the node where it is cut, the last point before the change (that point
    // belongs to both pieces).
    const end = q - 1;
    const pc: LanePiece = { line, pts: P.slice(start, end + 1), lane: O.slice(start, end + 1), nrm: N.slice(start, end + 1), k: a.k, i: a.i };
    if (a.k > 1) {
      // A shared piece is one edge; its first point may be the previous edge's last one: arc 0.
      pc.arc = A.slice(start, end + 1);
      if (start > 0 && share[start]!.seg !== a.seg) pc.arc[0] = 0;
    }
    out.push(pc);
    start = end;
  }
  return out.filter((p) => p.pts.length >= 2);
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
