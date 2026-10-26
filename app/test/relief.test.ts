import { describe, expect, it } from "vitest";
import { applyBalance, mixColor, rampColor, reliefPixels, reliefRange, reliefScale, reliefTicks } from "../src/lib/core/relief";
import type { Heightmap } from "../src/lib/core/lua";

const hm = (n: number, values: number[], waterLevel: number | null = null): Heightmap => ({
  n, minX: 0, minY: 0, width: n * 10, height: n * 10, cellX: 10, cellY: 10, data: Float64Array.from(values),
  source: "heightmap", waterLevel,
});

describe("relief colours", () => {
  it("keeps the end colours and goes green → yellow → red", () => {
    expect(mixColor("#3cb44b", "#e04040", 0)).toEqual([60, 180, 75]);
    expect(mixColor("#3cb44b", "#e04040", 1)).toEqual([224, 64, 64]);
    const [r, g, b] = mixColor("#00ff00", "#ff0000", 0.5);
    expect([r, g, b]).toEqual([255, 255, 0]);
  });

  it("takes the short way round the colour wheel", () => {
    // Red (0°) → magenta (300°): through 330° (pink), not through green.
    const [r, g, b] = mixColor("#ff0000", "#ff00ff", 0.5);
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBeGreaterThan(100);
  });

  it("lays the image out like the map (columns = world Y) and leaves water clear", () => {
    // data[j·n + i]: i along world X, j along world Y.
    const h = hm(2, [0, 10, 20, 30], 0);
    expect(reliefRange(h)).toEqual({ min: 0, max: 30 });
    const px = reliefPixels(h, [{ color: "#000000", alpha: 1 }, { color: "#ffffff", alpha: 1 }]);
    const at = (col: number, row: number) => Array.from(px.slice((row * 2 + col) * 4, (row * 2 + col) * 4 + 4));
    // A single cell at the water level is noise, not water: coloured (lowest colour).
    expect(at(0, 0)).toEqual([0, 0, 0, 255]);
    expect(at(0, 1)).toEqual([85, 85, 85, 255]); // i = 1, j = 0: z 10
    expect(at(1, 0)).toEqual([170, 170, 170, 255]); // i = 0, j = 1: z 20
    expect(at(1, 1)).toEqual([255, 255, 255, 255]);
  });

  it("leaves the game's water clear, not dry ground below the water level", () => {
    // 4 × 4: columns j = 0, 1 at the water level (8 cells: water), one dry cell below it (2 m).
    const values: number[] = Array.from({ length: 16 }, (_, k) => (k < 8 ? 5 : 20));
    values[12] = 2;
    const px = reliefPixels(hm(4, values, 5), [{ color: "#000000", alpha: 1 }, { color: "#ffffff", alpha: 1 }]);
    const alpha = (i: number, j: number) => px[(i * 4 + j) * 4 + 3];
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(3, 1)).toBe(0);
    expect(alpha(0, 3)).toBe(255); // cell data[12]: i = 0, j = 3, dry at 2 m
    expect(alpha(2, 2)).toBe(255);
  });
});

describe("relief scale and balance", () => {
  // Mostly low ground: 75 cells at 10 m, 25 cells spread from 10 to 1000 m.
  const values = [...Array(75).fill(10), ...Array.from({ length: 25 }, (_, k) => 10 + (k + 1) * 39.6)];
  const h = hm(10, values, 0);

  it("equalises: each colour covers as much ground", () => {
    const f = reliefScale(h, "equalize");
    expect(f(0)).toBe(0);
    expect(f(1000)).toBeCloseTo(1);
    // 75 % of the ground is at 10 m: it already takes 3/4 of the ramp (linear: ~0).
    expect(f(12)).toBeGreaterThan(0.7);
    expect(reliefScale(h, "linear")(12)).toBeLessThan(0.01);
  });

  it("keeps every scale monotone between 0 and 1", () => {
    for (const s of ["equalize", "linear", "sqrt", "log"] as const) {
      const f = reliefScale(h, s);
      let prev = -1;
      for (let z = 10; z <= 1000; z += 7) {
        const t = f(z);
        expect(t).toBeGreaterThanOrEqual(prev - 1e-12);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1 + 1e-12);
        prev = t;
      }
    }
    expect(reliefScale(h, "sqrt")(250)).toBeGreaterThan(reliefScale(h, "linear")(250));
  });

  it("balances towards the low or the high colour", () => {
    expect(applyBalance(0.5, 0)).toBe(0.5);
    expect(applyBalance(0.5, -1)).toBeLessThan(0.5);
    expect(applyBalance(0.5, 1)).toBeGreaterThan(0.5);
    expect(applyBalance(0, 1)).toBe(0);
    expect(applyBalance(1, -1)).toBe(1);
  });

  it("puts the legend altitudes where the colours are", () => {
    const ticks = reliefTicks(h, "linear", 0);
    expect(ticks[0]).toBeCloseTo(10);
    expect(ticks[2]).toBeCloseTo(505, 0);
    expect(ticks[4]).toBeCloseTo(1000);
    const eq = reliefTicks(h, "equalize", 0);
    expect(eq[2]).toBeLessThan(20); // half the ground is at 10 m
  });
});

describe("relief colour stops", () => {
  const stops = [
    { color: "#3cb44b", alpha: 0.4 }, { color: "#e04040", alpha: 0.6 }, { color: "#8e44c8", alpha: 0.8 }, { color: "#000000", alpha: 1 },
  ];

  it("runs through every stop: green → red → violet → black", () => {
    expect(rampColor(stops, 0)).toEqual([60, 180, 75, 0.4]);
    expect(rampColor(stops, 1 / 3)).toEqual([224, 64, 64, 0.6]);
    expect(rampColor(stops, 2 / 3)).toEqual([142, 68, 200, 0.8]);
    expect(rampColor(stops, 1)).toEqual([0, 0, 0, 1]);
    // Red → violet goes through magenta (short way), not back through green.
    const [r, g, b] = rampColor(stops, 0.5);
    expect(g).toBeLessThan(Math.min(r, b));
  });

  it("gives each pixel its stop's opacity", () => {
    const px = reliefPixels(hm(2, [10, 10, 10, 30], 0), [{ color: "#ffffff", alpha: 0.2 }, { color: "#000000", alpha: 1 }]);
    expect(px[3]).toBe(51); // lowest: 20 %
    expect(px[15]).toBe(255); // highest: opaque black
  });
});
