// Diagnose a run folder's plan: npx tsx test/tools/check-run-plan.mts <run dir>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { luaNum, parsePlan } from "../../src/lib/core/lua";

const dir = process.argv[2];
const t = readFileSync(join(dir, "mosaic_plan.lua"), "utf8");
const plan = parsePlan(t);
console.log("parsePlan:", plan ? `OK ${plan.nX}x${plan.nY} centers=${plan.centers.length}` : "null");
for (const k of ["nX", "nY", "zEye", "fovV", "pixelAspect", "screenW", "screenH", "gsdX"]) console.log(k, luaNum(t, `M\\.${k}`));
const block = t.match(/M\.centers\s*=\s*\{([\s\S]*?)\n\}/);
console.log("centers block:", block ? block[1].split("\n").length : "none");
console.log(t.slice(0, 160));
