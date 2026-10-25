import { describe, expect, it } from "vitest";
import { clampInterval, parseRoutes, parseStats, parseStocks, parseVehicles } from "../src/lib/core/live";
import { buildRoutes, chain, sampleEdge, stopLegs } from "../src/lib/core/routes";

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
