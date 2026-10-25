// Writes a capture_plan.lua (userdata format) from the synthetic fixture, for tools/sim_mod.py.
import { readFileSync, writeFileSync } from "node:fs";
import { computeMosaic, DEFAULT_CONFIG } from "../../src/lib/core/geometry";
import { parseHeightmap } from "../../src/lib/core/lua";
import { modFiles } from "../../src/lib/core/modwriter";
import { CAPTURE_PRESETS } from "../../src/lib/core/plan";
const hm = parseHeightmap(readFileSync("test/fixtures/synthetic/heightmap.lua", "utf8"))!;
const preset = (process.argv[3] ?? "normal") as keyof typeof CAPTURE_PRESETS;
const tm = CAPTURE_PRESETS[preset];
const mo = computeMosaic({
  ...DEFAULT_CONFIG, Z_EYE: 3000, FOV_V_DEG: 10, GRID_NX: 3, GRID_NY: 2,
  SEG_DUR: tm.segDur, SHOT_OFFSET: tm.shotOffset, ENV_SETTLE_SEC: tm.envSettleSec, SPEED_PRESET: preset,
}, hm);
writeFileSync(process.argv[2], modFiles(mo, hm, 1_800_000_000).plan);
console.log("OK", process.argv[2], `${mo.config.GRID_NX}x${mo.config.GRID_NY}`, preset);
