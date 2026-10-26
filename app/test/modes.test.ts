import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeMosaic, DEFAULT_CONFIG, FOV_V_DEG_MAX, FOV_V_DEG_MIN, sunZenithDeg } from "../src/lib/core/geometry";
import { parseHeightmap } from "../src/lib/core/lua";
import { glintFreeHour, MODE_LIST, modeConfig, modeConfigs, modeGrid, modeKey, Z_MAX_MODE } from "../src/lib/core/modes";
import { RESOLUTIONS } from "../src/lib/core/png";
import type { Heightmap } from "../src/lib/core/lua";

const hm = parseHeightmap(readFileSync("test/fixtures/synthetic/heightmap.lua", "utf8"))!;

describe("capture modes", () => {
  it("shapes the grid after the map and the image proportions", () => {
    // Square map, 21:9 images (one image spans 2.37× more along Y than along X).
    expect([1, 4, 16, 64].map((n) => modeGrid(n, 14336, 14336, 2560, 1080))).toEqual([
      { nX: 1, nY: 1 }, { nX: 3, nY: 1 }, { nX: 6, nY: 3 }, { nX: 12, nY: 5 },
    ]);
    // 16:9 images and a map three times as long along Y: more columns than rows.
    const g = modeGrid(16, 6000, 18000, 1920, 1080);
    expect(g.nY).toBeGreaterThan(g.nX);
    expect(g.nX * g.nY).toBeGreaterThanOrEqual(12);
  });

  it.each([[2560, 1080], [1920, 1080], [3840, 1080], [1600, 1200]])("covers the map in every mode at %i×%i", (w, h) => {
    const cfg = { ...DEFAULT_CONFIG, screenW: w, screenH: h };
    let lastGsd = Infinity;
    for (const mode of MODE_LIST) {
      const patch = modeConfig(mode, cfg, hm);
      const mo = computeMosaic({ ...cfg, ...patch }, hm);
      expect(mo.covered).toBe(true);
      expect(patch.Z_EYE!).toBeLessThanOrEqual(Z_MAX_MODE);
      expect(patch.FOV_V_DEG!).toBeGreaterThanOrEqual(FOV_V_DEG_MIN);
      expect(patch.FOV_V_DEG!).toBeLessThanOrEqual(FOV_V_DEG_MAX);
      // More images: finer (or equal) resolution.
      expect(mo.geo.gsdX).toBeLessThanOrEqual(lastGsd + 1e-9);
      lastGsd = mo.geo.gsdX;
    }
  });

  it("picks the hour closest to noon without glint", () => {
    const h = glintFreeHour(20);
    expect(sunZenithDeg(h * 3600, 171, 0)).toBeGreaterThanOrEqual(30);
    expect(sunZenithDeg((h - 0.25 * Math.sign(12 - h || 1)) * 3600, 171, 0)).toBeLessThan(30 + 5);
    expect(Math.abs(h - 12)).toBeLessThan(2);
    // Impossible within 7–17 h: the least bad (lowest sun) hour.
    expect([7, 17]).toContain(glintFreeHour(89));
  });
});

/** Synthetic hilly map (X × Y m), relief rising along X. */
function terrain(wx: number, wy: number, relief: number, n = 96): Heightmap {
  const data = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = 5 + relief * (0.5 + 0.5 * Math.sin(i / 9) * Math.cos(j / 13)) * (i / n);
  return { n, minX: -wx / 2, minY: -wy / 2, width: wx, height: wy, cellX: wx / n, cellY: wy / n, data, source: "heightmap", waterLevel: 2 };
}

describe("every mode at every resolution", () => {
  const resolutions: [number, number][] = [...RESOLUTIONS, [1024, 768], [1600, 1200], [1080, 1920], [2000, 1000]];
  const maps: [string, Heightmap][] = [
    ["4 km", terrain(4096, 4096, 300)], ["14 km", terrain(14336, 14336, 800)], ["32 km", terrain(32768, 32768, 1500)],
    ["16 × 8 km", terrain(16384, 8192, 600)],
  ];
  it.each(maps)("%s map: covered, altitude ≤ 12 000 m, FOV in range, detail never decreasing", (_name, map) => {
    for (const [w, h] of resolutions) {
      const cfg = { ...DEFAULT_CONFIG, screenW: w, screenH: h };
      let lastGsd = Infinity, lastImages = 0;
      for (const mode of MODE_LIST) {
        const patch = modeConfig(mode, cfg, map);
        const mo = computeMosaic({ ...cfg, ...patch }, map);
        expect(mo.covered, `${mode} ${w}×${h}`).toBe(true);
        expect(patch.Z_EYE!).toBeLessThanOrEqual(Z_MAX_MODE);
        expect(patch.FOV_V_DEG!).toBeGreaterThanOrEqual(FOV_V_DEG_MIN);
        expect(patch.FOV_V_DEG!).toBeLessThanOrEqual(FOV_V_DEG_MAX);
        expect(mo.geo.gsdX).toBeLessThanOrEqual(lastGsd + 1e-9);
        // Always distinct: about twice the images of the mode before (at least more).
        expect(mo.centers.length).toBeGreaterThan(lastImages);
        if (lastImages) expect(mo.centers.length).toBeGreaterThanOrEqual(Math.floor(1.5 * lastImages));
        lastGsd = mo.geo.gsdX;
        lastImages = mo.centers.length;
      }
    }
  }, 30_000);
});

describe("modes solved at once", () => {
  it("gives every mode in one pass, the same as one by one", () => {
    const cfg = { ...DEFAULT_CONFIG, screenW: 2560, screenH: 1080 };
    const all = modeConfigs(cfg, hm);
    for (const m of MODE_LIST) expect(all[m]).toEqual(modeConfig(m, cfg, hm));
  });

  it("is keyed by what changes the solution, not by its outputs", () => {
    const cfg = { ...DEFAULT_CONFIG };
    expect(modeKey({ ...cfg, GRID_NX: 3, FOV_V_DEG: 40, Z_EYE: 900, CAPTURE_TIME_SEC: 1 })).toBe(modeKey(cfg));
    expect(modeKey({ ...cfg, screenW: 1920 })).not.toBe(modeKey(cfg));
  });
});

