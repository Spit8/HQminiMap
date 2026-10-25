import { describe, expect, it } from "vitest";
import { cellRings, insideRings, ringArea, townOutline } from "../src/lib/core/towns";

describe("town outlines", () => {
  it("one cell → its square", () => {
    const r = cellRings([[0, 0]], 60);
    expect(r).toHaveLength(1);
    expect(r[0]!).toHaveLength(4);
    expect(ringArea(r[0]!)).toBe(3600);
  });

  it("L shape → one ring of 6 corners", () => {
    const r = cellRings([[0, 0], [1, 0], [0, 1]], 10);
    expect(r).toHaveLength(1);
    expect(r[0]!).toHaveLength(6);
    expect(ringArea(r[0]!)).toBe(300);
  });

  it("two islands → two rings; a ring around a hole keeps only the outside", () => {
    expect(cellRings([[0, 0], [5, 5]], 10)).toHaveLength(2);
    const donut: [number, number][] = [];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) if (x !== 1 || y !== 1) donut.push([x, y]);
    const r = cellRings(donut, 10);
    expect(r).toHaveLength(1);
    expect(ringArea(r[0]!)).toBe(900);
  });

  it("smoothed outline still contains the cells' centres", () => {
    const o = townOutline([[0, 0], [1, 0], [2, 0], [1, 1]], 60);
    expect(insideRings(o, 90, 30)).toBe(true);
    expect(insideRings(o, 90, 90)).toBe(true);
    expect(insideRings(o, 500, 500)).toBe(false);
  });
});

describe("live_townAreas / live_history / vehicle names", () => {
  it("parses the new files", async () => {
    const { parseHistory, parseTownAreas, parseVehicles } = await import("../src/lib/core/live");
    const a = parseTownAreas(`function data() return { cell = 60, t = 1, towns = { { cells = "0,0;1,0", id = 101, pop = 160 } } } end`)!;
    expect(a.towns.get(101)).toEqual({ cells: [[0, 0], [1, 0]], pop: 160 });
    const h = parseHistory(`function data() return { lines = { { id = 5, tr = "1000,10;2000,25" } },
      stations = { { id = 7, ld = "1000,7", ul = "" } }, t = 2 } end`)!;
    expect(h.lines.get(5)).toEqual([[1000, 10], [2000, 25]]);
    expect(h.stations.get(7)).toEqual({ loaded: [[1000, 7]], unloaded: [] });
    expect(parseVehicles("601,501,1,2,7,Bus  1")[0]!.name).toBe("Bus  1"); // format 3 still read
  });
});

describe("pictogram contrast", () => {
  it("black glyph on light backgrounds, white on dark ones", async () => {
    const { inkOn } = await import("../src/lib/ui/viewer/icons");
    expect(inkOn("#ffffff")).toBe("#111418");
    expect(inkOn("rgba(240,220,90,1)")).toBe("#111418");
    expect(inkOn("hsl(60, 90%, 70%)")).toBe("#111418");
    expect(inkOn("#1f3a8a")).toBe("#ffffff");
    expect(inkOn("rgba(0,90,30,0.95)")).toBe("#ffffff");
  });
});

describe("clean town outlines", () => {
  it("a block of buildings → a simple shape; near blocks join, far ones stay apart", async () => {
    const { townOutline, insideRings } = await import("../src/lib/core/towns");
    const block = (x0: number, y0: number, w: number, h: number) => {
      const c: [number, number][] = [];
      for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) if ((x + y) % 3) c.push([x, y]); // gaps between buildings
      return c;
    };
    const one = townOutline(block(0, 0, 20, 10), 20);
    expect(one).toHaveLength(1);
    expect(one[0]!.length).toBeLessThanOrEqual(24 * 4); // < 24 corners before the two Chaikin passes (×4)
    expect(insideRings(one, 200, 100)).toBe(true);
    // Two blocks 40 m apart are joined; an isolated building gives no ring at all.
    const two = townOutline([...block(0, 0, 10, 10), ...block(12, 0, 10, 10), [40, 40]], 20);
    expect(two).toHaveLength(1);
    expect(insideRings(two, 300, 100)).toBe(true);
    expect(insideRings(two, 810, 810)).toBe(false);
  });
});
