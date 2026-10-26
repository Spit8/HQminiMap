/// <reference lib="webworker" />
/**
 * Ortho export worker: renders the orthomosaic band by band (OrthoRenderer), streams it into the
 * tile pyramid (PNG tiles for the Visualiser) and an overview ortho.png. Tiles are decoded here
 * (fast-png, portable); file I/O stays on the main thread (Tauri APIs are not available in workers).
 *
 * main → worker: { type: "start", plan, hm, gsd, interp, overviewMaxSide }
 *                { type: "tiles", tiles: [{ seq, bytes }] }   (answer to "need")
 * worker → main: { type: "need", seqs }
 *                { type: "tile", z, x, y, png }               (pyramid tile, PNG bytes)
 *                { type: "progress", done, total }
 *                { type: "done", stats, info, overview: { png, width, height, z } }
 *                { type: "error", message }
 */
import { decode, encode } from "fast-png";
import type { Heightmap, PlanInfo } from "$lib/core/lua";
import { OrthoRenderer, type Interp, type RgbaImage } from "$lib/core/ortho";
import { pyramidInfo, pyramidWriter } from "$lib/core/pyramid";

const BAND_ROWS = 64;

interface StartMsg {
  type: "start";
  plan: PlanInfo;
  hm: Heightmap;
  gsd: number;
  interp: Interp;
  overviewMaxSide: number;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let pendingTiles: ((tiles: { seq: number; bytes: Uint8Array }[]) => void) | null = null;

function toRgba(png: ReturnType<typeof decode>): RgbaImage {
  const { width, height, channels } = png;
  const src = png.data;
  if (channels === 4 && src instanceof Uint8Array) return { width, height, data: src };
  const out = new Uint8ClampedArray(width * height * 4);
  const shift = png.depth === 16 ? 8 : 0;
  for (let i = 0, n = width * height; i < n; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Number(src[i * channels + (channels >= 3 ? c : 0)]) >> shift;
    out[i * 4 + 3] = 255;
  }
  return { width, height, data: out };
}

function requestTiles(seqs: number[]): Promise<{ seq: number; bytes: Uint8Array }[]> {
  return new Promise((resolve) => {
    pendingTiles = resolve;
    ctx.postMessage({ type: "need", seqs });
  });
}

async function run(msg: StartMsg): Promise<void> {
  const hm = { ...msg.hm, data: Float64Array.from(msg.hm.data) };
  const r = new OrthoRenderer(msg.plan, hm, msg.gsd, msg.interp);
  const info = pyramidInfo(r.outW, r.outH);
  // Overview = finest pyramid level whose longest side fits overviewMaxSide.
  let zOv = info.zMax, ow = r.outW, oh = r.outH;
  while (Math.max(ow, oh) > msg.overviewMaxSide && zOv > 0) {
    ow = Math.ceil(ow / 2);
    oh = Math.ceil(oh / 2);
    zOv--;
  }
  const overview = new Uint8ClampedArray(ow * oh * 4);
  const writer = pyramidWriter(info, (z, x, y, rgba, w, h) => {
    if (z === zOv) {
      // Tiles are full squares (transparent padding at the edges): copy only the image part.
      const vw = Math.min(w, ow - x * info.tileSize), vh = Math.min(h, oh - y * info.tileSize);
      for (let row = 0; row < vh; row++) {
        overview.set(rgba.subarray(row * w * 4, (row * w + vw) * 4), ((y * info.tileSize + row) * ow + x * info.tileSize) * 4);
      }
    }
    const png = encode({ width: w, height: h, data: rgba, channels: 4, depth: 8 });
    ctx.postMessage({ type: "tile", z, x, y, png }, [png.buffer]);
  });

  const cache = new Map<number, RgbaImage | null>();
  for (let q0 = 0; q0 < r.outH; q0 += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, r.outH - q0);
    const need = r.seqsForRows(q0, rows);
    const keep = new Set(need);
    for (const s of [...cache.keys()]) if (!keep.has(s)) cache.delete(s);
    const missing = need.filter((s) => !cache.has(s));
    if (missing.length) {
      for (const t of await requestTiles(missing)) {
        const img = t.bytes.length ? toRgba(decode(t.bytes)) : null;
        // Every capture must have the size of the others (a resolution change mid-capture would
        // be misprojected): the plan carries the real size, read from the first capture.
        if (img && (img.width !== msg.plan.screenW || img.height !== msg.plan.screenH)) throw new Error("resolutionMismatch");
        cache.set(t.seq, img);
      }
      for (const s of missing) if (!cache.has(s)) cache.set(s, null);
    }
    const band = new Uint8ClampedArray(rows * r.outW * 4);
    r.renderBand(q0, rows, (s) => cache.get(s) ?? null, band);
    writer.push(band, rows);
    ctx.postMessage({ type: "progress", done: q0 + rows, total: r.outH });
  }
  const png = encode({ width: ow, height: oh, data: overview, channels: 4, depth: 8 });
  ctx.postMessage(
    { type: "done", stats: { ...r.stats, outW: r.outW, outH: r.outH }, info, overview: { png, width: ow, height: oh, z: zOv } },
    [png.buffer],
  );
}

ctx.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === "tiles" && pendingTiles) {
    const resolve = pendingTiles;
    pendingTiles = null;
    resolve(msg.tiles);
  } else if (msg.type === "start") {
    run(msg as StartMsg).catch((err) => ctx.postMessage({ type: "error", message: String(err?.stack ?? err) }));
  }
};
