import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeMosaic, DEFAULT_CONFIG, type MosaicConfig } from "../src/lib/core/geometry";
import { parseHeightmap, parsePlan, terrainSourceLabel } from "../src/lib/core/lua";
import { modFiles, planSignature } from "../src/lib/core/modwriter";
import {
  CAPTURE_PRESETS, captureDurationSec, captureTiming, renderCutscene, renderPlan, timingIssue,
} from "../src/lib/core/plan";
import { fmtF, fmtG } from "../src/lib/core/pyfmt";

const FIX = join(__dirname, "fixtures");

interface Golden {
  name: string;
  config: Record<string, number | string | boolean>;
  zRef: number;
  terrainSource: string;
  seamZX: number[];
  seamZY: number[];
  cx: number[];
  cy: number[];
  deficitX: number;
  deficitY: number;
  minGrid: [number, number] | null;
  plan: string;
  cutscene: string;
}

/** Comment lines carry the generator name: compare everything else. */
const code = (s: string) => s.split("\n").filter((l) => !l.startsWith("--")).join("\n");
/** Timing the reference generator used (1 s per tile; the app now defaults to 1.25 s, HQ-044). */
const REF_TIMING = { SEG_DUR: 1, SHOT_OFFSET: 0.25 };

function suite(label: string, goldenFile: string, terrainDir: string) {
  const gPath = join(FIX, goldenFile);
  const hmPath = join(FIX, terrainDir, "heightmap.lua");
  const run = existsSync(gPath) && existsSync(hmPath) ? describe : describe.skip;
  run(`reference generator concordance (${label})`, () => {
    const goldens: Golden[] = existsSync(gPath) ? JSON.parse(readFileSync(gPath, "utf8")) : [];
    const hm = existsSync(hmPath) ? parseHeightmap(readFileSync(hmPath, "utf8")) : null;
    for (const g of goldens) {
      it(g.name, () => {
        expect(hm).not.toBeNull();
        const cfg: MosaicConfig = { ...DEFAULT_CONFIG, ...REF_TIMING, ...(g.config as Partial<MosaicConfig>) };
        const mo = computeMosaic(cfg, hm);
        expect(mo.zRef).toBe(g.zRef);
        expect(terrainSourceLabel(hm!)).toBe(g.terrainSource);
        const close = (a: number[], b: number[]) => {
          expect(a.length).toBe(b.length);
          a.forEach((v, k) => expect(Math.abs(v - b[k])).toBeLessThanOrEqual(1e-6));
        };
        close(mo.seamZX, g.seamZX);
        close(mo.seamZY, g.seamZY);
        close(mo.cx, g.cx);
        close(mo.cy, g.cy);
        expect(Math.abs(mo.deficitX - g.deficitX)).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(mo.deficitY - g.deficitY)).toBeLessThanOrEqual(1e-6);
        expect(mo.minGrid ? [mo.minGrid.nX, mo.minGrid.nY] : null).toEqual(g.minGrid);
        // The smallest covering grid covers; one less on either axis does not.
        const b = mo.bestGrid;
        expect(computeMosaic({ ...cfg, GRID_NX: b.nX, GRID_NY: b.nY }, hm).covered).toBe(true);
        if (b.nX > 1) expect(computeMosaic({ ...cfg, GRID_NX: b.nX - 1, GRID_NY: b.nY }, hm).deficitX).toBeGreaterThan(0);
        if (b.nY > 1) expect(computeMosaic({ ...cfg, GRID_NX: b.nX, GRID_NY: b.nY - 1 }, hm).deficitY).toBeGreaterThan(0);
        if (mo.minGrid) expect(b).toEqual(mo.minGrid);
        const meta = { terrainSource: terrainSourceLabel(hm!) };
        expect(code(renderPlan(mo, meta))).toBe(code(g.plan));
        expect(code(renderCutscene(mo))).toBe(code(g.cutscene));
      });
    }
  });
}

suite("synthetic 64²", "golden_synthetic.json", "synthetic");
suite("real map, local only", "golden_real.json", "real");

describe("capture plan as userdata", () => {
  const goldens: Golden[] = JSON.parse(readFileSync(join(FIX, "golden_synthetic.json"), "utf8"));
  const hm = parseHeightmap(readFileSync(join(FIX, "synthetic", "heightmap.lua"), "utf8"))!;
  const mo = computeMosaic({ ...DEFAULT_CONFIG, ...REF_TIMING, ...(goldens[0].config as Partial<MosaicConfig>) }, hm);

  it("wraps the reference plan in data() with its stamp, readable by parsePlan", () => {
    const text = modFiles(mo, hm, 1_800_000_123).plan;
    expect(text.startsWith("function data()\n")).toBe(true);
    expect(text.endsWith("\nM.planStamp = 1800000123\nreturn M\nend\n")).toBe(true);
    const plan = parsePlan(text)!;
    expect(plan.nX * plan.nY).toBe(mo.centers.length);
    expect(code(text.replace(/^function data\(\)\n|M\.planStamp = \d+\n|end\n$/g, ""))).toBe(code(goldens[0].plan));
  });

  it("signature ignores stamp and wrapper, not the grid", () => {
    const a = modFiles(mo, hm, 1).plan, b = modFiles(mo, hm, 2).plan;
    expect(planSignature(a)).toBe(planSignature(b));
    const other = computeMosaic({ ...mo.config, GRID_NX: mo.config.GRID_NX + 1 }, hm);
    expect(planSignature(modFiles(other, hm, 1).plan)).not.toBe(planSignature(a));
  });
});

describe("capture timing", () => {
  const hm = parseHeightmap(readFileSync(join(FIX, "synthetic", "heightmap.lua"), "utf8"))!;
  const base = { ...DEFAULT_CONFIG, Z_EYE: 3000, FOV_V_DEG: 10, GRID_NX: 3, GRID_NY: 2 };

  it("uses the preset timings in the cutscene keys and the plan", () => {
    const t = CAPTURE_PRESETS.fastest;
    const mo = computeMosaic({ ...base, SEG_DUR: t.segDur, SHOT_OFFSET: t.shotOffset, ENV_SETTLE_SEC: t.envSettleSec, SPEED_PRESET: "fastest" }, hm);
    const times = [...renderCutscene(mo).matchAll(/time=([\d.]+)/g)].map((m) => +m[1]);
    // 4 keys per tile + final key; tile k holds on [k·0.25+0.02, k·0.25+0.18].
    expect(times.length).toBe(6 * 4 + 1);
    expect(times.slice(4, 8)).toEqual([0.25, 0.27, 0.43, 0.45]);
    expect(times[times.length - 1]).toBe(1.5);
    const plan = renderPlan(mo, { terrainSource: "heightmap_64" });
    expect(plan).toContain("M.segDur = 0.25\n");
    expect(plan).toContain("M.shotOffset = 0.12\n");
    expect(plan).toContain("M.envSettleSec = 0.5\n");
    expect(plan).toContain('M.speedPreset = "fastest"\n');
    expect(captureDurationSec(captureTiming(mo.config), mo.centers.length)).toBe(0.5 + 6 * 0.25);
  });

  it("validates the shot inside the still hold", () => {
    for (const t of Object.values(CAPTURE_PRESETS)) expect(timingIssue(t)).toBeNull();
    expect(timingIssue({ segDur: 0.04, shotOffset: 0.02, envSettleSec: 0 })?.kind).toBe("segTooShort");
    // Short segments keep a still hold (margins scaled down): 0.1 s per tile, shot at 0.04 s.
    expect(timingIssue({ segDur: 0.1, shotOffset: 0.04, envSettleSec: 2 })).toBeNull();
    expect(timingIssue({ segDur: 0.5, shotOffset: 0.45, envSettleSec: 1 })?.kind).toBe("shotOutsideHold");
    expect(timingIssue({ segDur: 0.5, shotOffset: 0.01, envSettleSec: 1 })?.kind).toBe("shotOutsideHold");
  });
});

describe("python number formatting", () => {
  it("g", () => {
    expect(fmtG(5000, 6)).toBe("5000");
    expect(fmtG(-0.2617993878, 10)).toBe("-0.2617993878");
    expect(fmtG(1234567, 6)).toBe("1.23457e+06");
    expect(fmtG(0.00001234, 6)).toBe("1.234e-05");
    expect(fmtG(0.0001234, 6)).toBe("0.0001234");
    expect(fmtG(-14.1372, 10)).toBe("-14.1372");
    expect(fmtG(171, 6)).toBe("171");
    expect(fmtG(0, 6)).toBe("0");
  });
  it("f", () => {
    expect(fmtF(-0, 3)).toBe("-0.000");
    expect(fmtF(2.5, 0)).toBe("2");
    expect(fmtF(-1.23456, 4)).toBe("-1.2346");
  });
});

describe("any game resolution", () => {
  const hmPath = join(FIX, "synthetic", "heightmap.lua");
  const hm = existsSync(hmPath) ? parseHeightmap(readFileSync(hmPath, "utf8")) : null;
  for (const [w, h] of [[1920, 1080], [1366, 768], [3440, 1440], [3840, 2160], [5120, 1440]] as const) {
    it(`${w} × ${h}: footprint of the screen's shape, grid and plan valid`, () => {
      expect(hm).not.toBeNull();
      const cfg: MosaicConfig = { ...DEFAULT_CONFIG, screenW: w, screenH: h };
      const mo = computeMosaic(cfg, hm!);
      // Footprint: rows ↔ screen height (X), columns ↔ screen width (Y), square ground pixels.
      expect(mo.geo.viewY / mo.geo.viewX).toBeCloseTo(w / h, 3);
      expect(mo.geo.gsdX).toBeCloseTo(mo.geo.gsdY, 6);
      expect(mo.centers.length).toBeGreaterThan(0);
      const plan = parsePlan(modFiles(mo, hm!, 0).plan)!;
      expect(plan).not.toBeNull();
      expect([plan.screenW, plan.screenH]).toEqual([w, h]);
    });
  }
});
