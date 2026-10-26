import { describe, expect, it } from "vitest";
import { clampInterval, parseRoutes, parseStats, parseStocks, parseVehicles } from "../src/lib/core/live";
import { buildRoutes, chain, chainUndirected, sampleEdge, stopLegs } from "../src/lib/core/routes";

describe("routes", () => {
  it("straight edge → 2 points, curve → Hermite samples through both ends", () => {
    expect(sampleEdge({ x0: 0, y0: 0, tx0: 100, ty0: 0, x1: 100, y1: 0, tx1: 100, ty1: 0 })).toEqual([[0, 0], [100, 0]]);
    // Quarter circle of radius 100: tangents (157, 0) and (0, 157).
    const c = sampleEdge({ x0: 0, y0: 0, tx0: 157, ty0: 0, x1: 100, y1: 100, tx1: 0, ty1: 157 });
    expect(c.length).toBeGreaterThan(3);
    expect(c[0]).toEqual([0, 0]);
    expect(c[c.length - 1]).toEqual([100, 100]);
    const mid = c[Math.floor(c.length / 2)]!;
    expect(Math.hypot(mid[0] - 0, mid[1] - 100)).toBeGreaterThan(90); // on the arc around (0, 100)
    expect(Math.hypot(mid[0] - 0, mid[1] - 100)).toBeLessThan(110);
  });

  it("parses live_routes and chains consecutive edges", () => {
    const r = parseRoutes(`function data() return { edges = "1,0,0,10,0,10,0,10,0;2,10,0,10,0,20,0,10,0;3,50,50,0,10,50,60,0,10",
      lines = { { e = "1,2,3", id = 9, p = "" } }, n = 3, t = 4 } end`)!;
    expect(r.edges.size).toBe(3);
    const m = buildRoutes(r).get(9)!;
    expect(m).toHaveLength(2);
    expect(m[0]).toEqual([[0, 0], [10, 0], [20, 0]]);
    expect(chain([])).toEqual([]);
    expect(stopLegs({ stops: [{ g: 1, x: 0, y: 0 }, { g: 2, x: 5, y: 5 }] })).toEqual([[[0, 0], [5, 5], [0, 0]]]);
  });

  it("v2: lane, bridge and free-leg polylines are added to the line", () => {
    const r = parseRoutes(`function data() return { edges = "", lines = { { e = "", id = 4, p = "0,0,0,50,0,100|5,5,9,9" } }, t = 1, version = 2 } end`)!;
    expect(r.lines.get(4)!.polys).toEqual([[[0, 0], [0, 50], [0, 100]], [[5, 5], [9, 9]]]);
    expect(buildRoutes(r).get(4)).toHaveLength(2);
  });

  it("vehicles with their load, stocks, cadence minimums", () => {
    expect(parseVehicles("1,2,3,4,12,40,3,10,Bus 1;5,6,7,8,-1,-1,-1,-1,Navire, 2;9,9,9,9")).toEqual([
      { id: 1, line: 2, x: 3, y: 4, pax: { n: 12, cap: 40 }, freight: { n: 3, cap: 10 }, name: "Bus 1" },
      { id: 5, line: 6, x: 7, y: 8, pax: null, freight: null, name: "Navire, 2" },
      { id: 9, line: 9, x: 9, y: 9, pax: null, freight: null, name: "" },
    ]);
    const s = parseStocks(`function data() return { cargo = { { id = 1, name = "Charbon" } },
      industries = { { id = 201, s = { { cap = 100, cargo = 1, kind = "in", n = 30 } } } },
      warehouses = { { id = 901, name = "Entrepot A", s = { { cap = 400, cargo = 1, kind = "store", n = 250 } }, x = 10, y = 20 } }, t = 2 } end`)!;
    expect(s.industries.get(201)).toEqual([{ cargo: 1, kind: "in", n: 30, cap: 100 }]);
    expect(s.warehouses[0]).toMatchObject({ id: 901, name: "Entrepot A", x: 10, y: 20 });
    expect(s.cargo.get(1)).toBe("Charbon");
    expect([clampInterval("vehicles", 0.3), clampInterval("routes", 3), clampInterval("lines", 0)]).toEqual([1, 10, 0]);
  });

  it("parses live_stats", () => {
    const s = parseStats(`function data() return { lines = { { id = 5, transported = 1234, waitC = 8, waitP = 6 } },
      stations = { { id = 7, loaded = 50, unloaded = 70, waitC = 1, waitP = 2 } }, t = 3 } end`)!;
    expect(s.lines.get(5)).toEqual({ transported: 1234, waitP: 6, waitC: 8 });
    expect(s.stations.get(7)).toEqual({ loaded: 50, unloaded: 70, waitP: 2, waitC: 1 });
  });
});

describe("gap filling from vehicle trails", () => {
  it("keeps only the trail pieces away from the track, joined to it", async () => {
    const { TrackIndex, uncovered } = await import("../src/lib/core/routes");
    // Track: x 0 → 100 and x 300 → 400 along y = 0; the trail runs the whole way (gap 100 → 300).
    const track = new TrackIndex([[[0, 0], [100, 0]], [[300, 0], [400, 0]]]);
    const trail: [number, number][] = [];
    for (let x = 0; x <= 400; x += 25) trail.push([x, 0]);
    const pieces = uncovered(trail, track);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]![0]).toEqual([100, 0]);
    expect(pieces[0]![pieces[0]!.length - 1]).toEqual([300, 0]);
    // On the track everywhere → nothing; a jump splits the run.
    expect(uncovered([[0, 0], [50, 0], [100, 0]], track)).toEqual([]);
    expect(uncovered([[150, 0], [175, 0], [900, 0], [925, 0]], track)).toHaveLength(2);
  });
});

describe("lanes (as in the game)", () => {
  type P = [number, number];
  /** Edges as straight 2-point polylines; lineEdges: line → signed edge ids. */
  const parts = (edges: Record<number, P[]>, lineEdges: Record<number, number[]>, lanes: Record<number, { f: number; b: number }> = {}) => ({
    edges: new Map(Object.entries(edges).map(([k, v]) => [+k, v])),
    lineEdges: new Map(Object.entries(lineEdges).map(([k, ids]) => [+k, ids.map((id) => ({ id: Math.abs(id), dir: (id < 0 ? -1 : 1) as 1 | -1 }))])),
    linePolys: new Map(),
    lanes: new Map(Object.entries(lanes).map(([k, v]) => [+k, v])),
  });
  const street = (ids: number[], rank: number) => ({ id: ids[0]!, rank, twoWay: true });

  it("draws one lane per direction, shared by its lines in stripes", async () => {
    const { laneLayout } = await import("../src/lib/core/routes");
    const e = { 1: [[0, 0], [100, 0]] as P[] };
    const ranked = (n: number) => Array.from({ length: n }, (_, k) => street([k + 1], 100 - k));
    const ids = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, k) => [k + 1, [1]]));
    expect(laneLayout(parts(e, ids(1)), ranked(1)).pieces.map((p) => [p.k, p.lane[0]])).toEqual([[1, 0.5]]);
    // 3 lines the same way, even on a wide street: one lane, 3 stripes.
    const three = laneLayout(parts(e, ids(3), { 1: { f: 3, b: 3 } }), ranked(3)).pieces;
    expect(three.map((p) => [p.line, p.k, p.i, p.lane[0]])).toEqual([[1, 3, 0, 0.5], [2, 3, 1, 0.5], [3, 3, 2, 0.5]]);
    // The other way: the other side.
    const both = laneLayout(parts(e, { 1: [1], 2: [-1] }), ranked(2)).pieces;
    expect(both.map((p) => [p.k, p.lane[0], String(p.pts[0])])).toEqual([[1, 0.5, "0,0"], [1, 0.5, "100,0"]]);
  });

  it("keeps a line on its side, in one track, when another one leaves the stretch", async () => {
    const { laneLayout } = await import("../src/lib/core/routes");
    const e = { 1: [[0, 0], [100, 0]] as P[], 2: [[100, 0], [200, 0]] as P[] };
    const { pieces } = laneLayout(parts(e, { 7: [1, 2], 8: [1, 2], 9: [1] }, { 1: { f: 3, b: 3 }, 2: { f: 3, b: 3 } }),
      [street([7], 5), street([8], 50), street([9], 90)]);
    const seven = pieces.filter((p) => p.line === 7);
    expect(seven.map((p) => p.k)).toEqual([3, 2]); // fewer stripes once 9 has left
    expect(seven[0]!.pts[0]).toEqual([0, 0]);
    expect(seven[0]!.pts.at(-1)).toEqual(seven[1]!.pts[0]);
    expect(seven[1]!.pts.at(-1)).toEqual([200, 0]);
    expect(new Set(seven.flatMap((p) => p.lane))).toEqual(new Set([0.5])); // no lane change
  });

  it("cuts a shared lane at each edge (stripes line up), pieces meeting exactly", async () => {
    const { laneLayout } = await import("../src/lib/core/routes");
    const e = { 1: [[0, 0], [100, 0]] as P[], 2: [[100, 0], [200, 50]] as P[] };
    const { pieces } = laneLayout(parts(e, { 1: [1, 2], 2: [1], 3: [1, 2] }), [street([1], 9), street([2], 8), street([3], 7)]);
    const three = pieces.filter((p) => p.line === 3);
    expect(three.map((p) => p.k)).toEqual([3, 2]);
    const [a, b] = three as [(typeof three)[0], (typeof three)[0]];
    expect(a.pts[0]).toEqual([0, 0]); // the shared piece starts on the edge's first node
    expect(a.pts.at(-1)).toEqual([100, 0]); // … and ends on its last one, not beyond
    expect(a.arc).toEqual([0, 100]); // stripes measured along the edge
    expect(a.pts.at(-1)).toEqual(b.pts[0]);
    expect(a.nrm.at(-1)).toEqual(b.nrm[0]);
    expect(a.lane.at(-1)).toEqual(b.lane[0]);
  });

  it("joins a branch to the track it leaves", async () => {
    const { laneLayout } = await import("../src/lib/core/routes");
    const e = { 1: [[0, 0], [100, 0]] as P[], 2: [[100, 0], [200, 0]] as P[], 3: [[100, 0], [100, 100]] as P[] };
    const { pieces, joints } = laneLayout(parts(e, { 7: [1, 2, 3] }), [street([7], 5)]);
    expect(pieces.length).toBe(2); // 1 → 2 straight on, 3 apart
    expect(joints).toHaveLength(1);
    expect(joints[0]!.b.p).toEqual([100, 0]);
    expect(joints[0]!.a.p).toEqual([100, 0]);
  });

  it("drives on the right: an edge recorded the wrong way round follows the line's direction", async () => {
    const { laneLayout } = await import("../src/lib/core/routes");
    const e = { 1: [[0, 0], [100, 0]] as P[], 2: [[100, 0], [200, 0]] as P[], 3: [[200, 0], [300, 0]] as P[] };
    // A → B → C with B recorded against its geometry (−2) although the line goes along it.
    const out = laneLayout(parts(e, { 7: [1, -2, 3] }), [street([7], 5)]).pieces;
    expect(out).toHaveLength(1);
    expect(out[0]!.pts.map(String)).toEqual(["0,0", "100,0", "200,0", "300,0"]);
    expect(new Set(out[0]!.lane)).toEqual(new Set([0.5])); // the same side all along
    // Started from the wrong edge (B first): the whole track still goes A → C.
    const first = laneLayout(parts(e, { 7: [-2, 1, 3] }), [street([7], 5)]).pieces;
    expect(first).toHaveLength(1);
    expect(first[0]!.pts.map(String)).toEqual(["0,0", "100,0", "200,0", "300,0"]);
  });

  it("keeps both sides of a street travelled there and back", async () => {
    const { laneLayout } = await import("../src/lib/core/routes");
    const e = { 1: [[0, 0], [100, 0]] as P[], 2: [[100, 0], [200, 0]] as P[] };
    const out = laneLayout(parts(e, { 7: [1, 2, -2, -1] }), [street([7], 5)]).pieces;
    expect(out).toHaveLength(1);
    expect(out[0]!.pts.map(String)).toEqual(["0,0", "100,0", "200,0", "100,0", "0,0"]);
  });

  it("draws no joint making a U-turn across the street", async () => {
    const { laneLayout } = await import("../src/lib/core/routes");
    // Two tracks of the line side by side, opposite ways, 20 m apart: not linked.
    const e = { 1: [[0, 0], [100, 0]] as P[], 2: [[100, 20], [0, 20]] as P[] };
    const { pieces, joints } = laneLayout(parts(e, { 7: [1, 2] }), [street([7], 5)]);
    expect(pieces).toHaveLength(2);
    expect(joints).toHaveLength(0);
  });

  it("draws a U-turn as one track, out on one side and back on the other", async () => {
    const { laneLayout } = await import("../src/lib/core/routes");
    const out = laneLayout(parts({ 1: [[0, 0], [100, 0]] }, { 7: [1, -1] }, { 1: { f: 1, b: 1 } }), [street([7], 5)]).pieces;
    expect(out).toHaveLength(1);
    expect(out[0]!.pts.map(String)).toEqual(["0,0", "100,0", "0,0"]);
  });

  it("centres the lane of a one-way street; rail stays centred with stripes", async () => {
    const { laneLayout } = await import("../src/lib/core/routes");
    const e = { 1: [[0, 0], [100, 0]] as P[] };
    const oneWay = laneLayout(parts(e, { 7: [1], 8: [1] }, { 1: { f: 2, b: 0 } }), [street([7], 5), street([8], 50)]).pieces;
    expect(oneWay.map((p) => [p.line, p.k, p.lane[0]])).toEqual([[8, 2, 0], [7, 2, 0]]);
    const rail = laneLayout(parts(e, { 7: [1], 8: [-1] }), [{ id: 7, rank: 5, twoWay: false }, { id: 8, rank: 50, twoWay: false }]).pieces;
    expect(rail.map((p) => [p.line, p.k, p.i, p.lane[0]])).toEqual([[8, 2, 0, 0], [7, 2, 1, 0]]);
  });

  it("offsets a polyline to the right of its direction, by point if asked", async () => {
    const { offsetLine } = await import("../src/lib/core/routes");
    expect(offsetLine([[0, 0], [10, 0]], 2)).toEqual([[0, -2], [10, -2]]); // heading +x, y up: right is −y
    expect(offsetLine([[0, 0], [10, 0]], [0, 2])).toEqual([[0, 0], [10, -2]]);
  });
});

describe("focus command", () => {
  it("is written for the mod with its kind, entity and open flag", async () => {
    const { renderRequest, DEFAULT_INTERVALS } = await import("../src/lib/core/live");
    const { parseUserdata } = await import("../src/lib/core/luadata");
    const text = renderRequest({ enabled: true, intervals: DEFAULT_INTERVALS,
      cmd: { seq: 3, action: "focus", x: 10, y: 20, dist: 500, kind: "industries", id: 201, open: true } });
    const back = parseUserdata(text) as { cmd: Record<string, unknown> };
    expect(back.cmd).toMatchObject({ seq: 3, action: "focus", kind: "industries", id: 201, open: true });
  });
});

describe("chaining", () => {
  it("joins pieces in any order", () => {
    const out = chainUndirected([[[10, 0], [20, 0]], [[0, 0], [10, 0]], [[30, 0], [20, 0]]]);
    expect(out).toHaveLength(1);
    const xs = out[0]!.map((p) => p[0]);
    expect(xs[0]! < xs[3]! ? xs : xs.reverse()).toEqual([0, 10, 20, 30]);
  });
});

describe("stripes", () => {
  it("places each line's dashes by the distance along the edge, whatever the drawn line", async () => {
    const { stripes } = await import("../src/lib/ui/viewer/layers");
    // Drawn (offset) line starting 3 m early, but measured along the edge: dashes of 10 m, 2 lines.
    const pts: [number, number][] = [[-3, 5], [100, 5]];
    const a = stripes(pts, [0, 100], 10, 2, 0), b = stripes(pts, [0, 100], 10, 2, 1);
    expect(a).toHaveLength(5);
    expect(b).toHaveLength(5);
    expect(a[0]![0]![0]).toBeCloseTo(-3);
    expect(a[0]!.at(-1)![0]).toBeCloseTo(7.3); // 10 m along the edge
    expect(b[0]![0]![0]).toBeCloseTo(7.3); // the next line takes over exactly there
  });
});
