/**
 * Full-scale ortho benchmark (synthetic tiles, real lattice): mirrors ortho.worker without the
 * Worker/Tauri plumbing — OrthoRenderer band by band + streaming pyramid + PNG tile encoding.
 *   npx tsx test/tools/bench-ortho.mts <plan.lua> <heightmap.lua> [--half] [--interp lanczos3]
 */
import { readFileSync } from "node:fs";
import { encode } from "fast-png";
import { seqOf } from "../../src/lib/core/geometry";
import { parseHeightmap, parsePlan } from "../../src/lib/core/lua";
import { OrthoRenderer, type Interp, type RgbaImage } from "../../src/lib/core/ortho";
import { pyramidInfo, pyramidWriter } from "../../src/lib/core/pyramid";

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--") && !["lanczos3", "bicubic", "bilinear", "nearest"].includes(a));
const half = args.includes("--half");
const ii = args.indexOf("--interp");
const interp = (ii >= 0 ? args[ii + 1] : "lanczos3") as Interp;
if (files.length < 2) {
  console.error("usage: npx tsx test/tools/bench-ortho.mts <plan.lua> <heightmap.lua> [--half] [--interp lanczos3]");
  process.exit(1);
}
const plan = parsePlan(readFileSync(files[0]!, "utf8"))!;
const hm = parseHeightmap(readFileSync(files[1]!, "utf8"))!;

// Synthetic tile: same noise texture for every tile (content does not change the cost).
const W = plan.screenW, H = plan.screenH;
const tex = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) {
  tex[i * 4] = (i * 2654435761) >>> 24;
  tex[i * 4 + 1] = (i * 40503) & 255;
  tex[i * 4 + 2] = (i >> 7) & 255;
  tex[i * 4 + 3] = 255;
}
const tile: RgbaImage = { width: W, height: H, data: tex };

const gsd = plan.gsdX * (half ? 2 : 1);
const t0 = performance.now();
const r = new OrthoRenderer(plan, hm, gsd, interp);
const info = pyramidInfo(r.outW, r.outH);
let tiles = 0, pngBytes = 0, encodeMs = 0;
const writer = pyramidWriter(info, (_z, _x, _y, rgba, w, h) => {
  const e0 = performance.now();
  const png = encode({ width: w, height: h, data: rgba, channels: 4, depth: 8 });
  encodeMs += performance.now() - e0;
  tiles++;
  pngBytes += png.length;
});
let renderMs = 0, seqsMax = 0;
for (let q0 = 0; q0 < r.outH; q0 += 64) {
  const rows = Math.min(64, r.outH - q0);
  seqsMax = Math.max(seqsMax, r.seqsForRows(q0, rows).length);
  const band = new Uint8ClampedArray(rows * r.outW * 4);
  const b0 = performance.now();
  r.renderBand(q0, rows, () => tile, band);
  renderMs += performance.now() - b0;
  writer.push(band, rows);
}
const total = (performance.now() - t0) / 1000;
console.log(`plan ${plan.nX}x${plan.nY} (${seqOf(plan.nX, plan.nY, 0, 0)} tiles) gsd=${gsd.toFixed(3)} interp=${interp}`);
console.log(`ortho ${r.outW}x${r.outH} = ${((r.outW * r.outH) / 1e6).toFixed(0)} MP, holes=${r.stats.holes} fallback=${r.stats.fallback}`);
console.log(`pyramid zMax=${info.zMax} tiles=${tiles} png=${(pngBytes / 1e6).toFixed(0)} MB, tiles in memory per band <= ${seqsMax}`);
console.log(`time total ${total.toFixed(1)} s (render ${(renderMs / 1000).toFixed(1)} s, png ${(encodeMs / 1000).toFixed(1)} s)`);
