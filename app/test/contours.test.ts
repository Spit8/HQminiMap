import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { contourLines, contourStep, heightRange, shorelines, waterCells, waterMask } from "../src/lib/core/contours";
import { parseHeightmap, type Heightmap } from "../src/lib/core/lua";

/** Cone of height 100 m at the centre of a 1000 m square map, n × n cells. */
function cone(n = 50, waterLevel: number | null = null): Heightmap {
  const size = 1000, cell = size / n, data = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * cell - 500, y = (j + 0.5) * cell - 500;
      data[j * n + i] = Math.max(0, 100 - Math.hypot(x, y) / 4);
    }
  }
  return { n, minX: -500, minY: -500, width: size, height: size, cellX: cell, cellY: cell, data, source: "heightmap", waterLevel };
}

describe("contour lines", () => {
  it("picks a round interval", () => {
    expect(contourStep(0, 500)).toBe(20);
    expect(contourStep(0, 100)).toBe(5);
    expect(contourStep(12, 1012)).toBe(50);
    expect(contourStep(0, 3)).toBeCloseTo(0.2);
  });

  it("draws one closed ring per level around a cone, at the right radius", () => {
    const levels = contourLines(cone(), 20);
    expect(levels.map((l) => l.z)).toEqual([20, 40, 60, 80]);
    for (const l of levels) {
      expect(l.lines).toHaveLength(1);
      const ring = l.lines[0]!;
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      const r = (100 - l.z) * 4;
      for (const [x, y] of ring) expect(Math.abs(Math.hypot(x, y) - r)).toBeLessThan(20);
    }
    expect(levels.find((l) => l.z === 100)).toBeUndefined();
  });

  it("marks index contours and skips levels under water", () => {
    const levels = contourLines(cone(50, 30), 10);
    expect(levels[0]!.z).toBe(40);
    expect(levels.filter((l) => l.major).map((l) => l.z)).toEqual([50]);
  });

  it("handles the exported heightmap quickly", () => {
    const hm = parseHeightmap(readFileSync("test/fixtures/synthetic/heightmap.lua", "utf8"))!;
    const { min, max } = heightRange(hm);
    const t0 = performance.now();
    const levels = contourLines(hm, contourStep(min, max));
    expect(performance.now() - t0).toBeLessThan(500);
    expect(levels.length).toBeGreaterThan(5);
    for (const l of levels) for (const line of l.lines) expect(line.length).toBeGreaterThanOrEqual(2);
  });
});

describe("shorelines", () => {
  it("traces a closed shore around a lake", () => {
    // Bowl: water (z = 0 = water level) inside a 300 m radius, land rising outside.
    const n = 50, cell = 20, data = new Float64Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const r = Math.hypot((i + 0.5) * cell - 500, (j + 0.5) * cell - 500);
      data[j * n + i] = Math.max(0, (r - 300) / 10);
    }
    const hm: Heightmap = { n, minX: -500, minY: -500, width: 1000, height: 1000, cellX: cell, cellY: cell, data, source: "heightmap", waterLevel: 0 };
    const shores = shorelines(hm);
    expect(shores).toHaveLength(1);
    const ring = shores[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [x, y] of ring) expect(Math.abs(Math.hypot(x, y) - 305)).toBeLessThan(25);
    const mask = waterMask(hm);
    expect(mask[25 * n + 25]).toBe(1);
    expect(mask[0]).toBe(0);
    expect(shorelines({ ...hm, waterLevel: null })).toEqual([]);
  });

  it("ignores dry ground below the water level and tiny patches", () => {
    // Water only where the game lifts the ground exactly to the water level (10 m); a dry pit at 4 m
    // (below the water level, not water) and a 2-cell patch at 10 m are not water.
    const n = 30, data = new Float64Array(n * n).fill(25);
    for (let j = 5; j < 15; j++) for (let i = 5; i < 15; i++) data[j * n + i] = 10; // lake 10×10
    for (let j = 20; j < 25; j++) for (let i = 20; i < 25; i++) data[j * n + i] = 4; // dry pit
    data[2 * n + 25] = data[2 * n + 26] = 10; // noise
    const hm: Heightmap = { n, minX: 0, minY: 0, width: 300, height: 300, cellX: 10, cellY: 10, data, source: "heightmap", waterLevel: 10 };
    expect(shorelines(hm)).toHaveLength(1);
    const mask = waterMask(hm);
    expect(mask.reduce((a, v) => a + v, 0)).toBe(100);
  });
});

describe("water: the game's flags and pits", () => {
  const n = 30;
  const base = () => {
    const data = new Float64Array(n * n).fill(25);
    for (let j = 5; j < 15; j++) for (let i = 5; i < 15; i++) data[j * n + i] = 10; // lake 100 cells
    for (let j = 20; j < 25; j++) for (let i = 20; i < 25; i++) data[j * n + i] = 10; // pit 25 cells
    return { n, minX: 0, minY: 0, width: 300, height: 300, cellX: 10, cellY: 10, data, source: "heightmap" as const, waterLevel: 10 };
  };

  it("drops a small patch next to an industry (a pit), keeps a lake", () => {
    const hm = base();
    expect(waterCells(hm).reduce((a, v) => a + v, 0)).toBe(125);
    const near = waterCells(hm, { industries: [{ x: 230, y: 230 }] });
    expect(near.reduce((a, v) => a + v, 0)).toBe(100);
  });

  it("keeps a patch only where the coarse map grid says water", () => {
    const hm = { ...base(), waterGrid: { n: 3, minX: 0, minY: 0, cellX: 100, cellY: 100, water: Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0]) } };
    expect(waterCells(hm).reduce((a, v) => a + v, 0)).toBe(100);
  });

  it("uses the game's own per-cell flags when the export has them", () => {
    const water = new Uint8Array(n * n);
    for (let k = 0; k < 40; k++) water[k] = 1;
    const hm = { ...base(), water };
    expect(waterCells(hm).reduce((a, v) => a + v, 0)).toBe(40);
    const text = `function data()
return { n = 2, minX = 0, minY = 0, width = 2, height = 2, rows = { { 1, 2 }, { 3, 4 } }, waterRows = { "10", "01" } }
end`;
    expect(Array.from(parseHeightmap(text)!.water!)).toEqual([1, 0, 0, 1]);
  });
});

