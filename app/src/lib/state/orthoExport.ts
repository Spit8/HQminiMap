/**
 * Ortho export of one run: drives ortho.worker (rendering) and writes its outputs into the run
 * folder: pyramid/<z>/<x>_<y>.png + pyramid/pyramid.json (Visualiser) and ortho.png (overview).
 * Outputs go to pyramid.tmp/ first and replace pyramid/ only once complete, so a cancelled or
 * failed export never damages the previous ortho.
 */
import { pngSize, sameAspect } from "$lib/core/png";
import { parseHeightmap, parsePlan, type PlanInfo } from "$lib/core/lua";
import type { Interp } from "$lib/core/ortho";
import { ensureDir, joinPath, readBytes, readText, removeDir, renamePath, writeBytes, writeText } from "$lib/platform/fsx";
import type { RunMeta } from "./runs.svelte";

/** Longest side of the overview ortho.png (the full resolution lives in the pyramid). */
export const OVERVIEW_MAX_SIDE = 6144;
/** pyramid.json format: 2 = full 256² edge tiles (1 had partial tiles, stretched by the viewer). */
export const PYRAMID_VERSION = 2;
/** Concurrent tile file writes. */
const MAX_WRITES = 8;

export interface PyramidJson {
  version: number;
  width: number;
  height: number;
  tileSize: number;
  zMax: number;
  /** Metres per pixel at zMax. */
  gsd: number;
  /** World extent: columns ↔ Y (minY → maxY), rows ↔ X (minX → maxX). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  interp: Interp;
  holes: number;
  /** Pyramid tiles written and their total size (bytes). */
  tiles?: number;
  bytes?: number;
  createdAt: string;
}

export async function loadRunInputs(run: RunMeta): Promise<{ plan: PlanInfo; text: string; hmText: string } | string> {
  const text = await readText(joinPath(run.dir, "mosaic_plan.lua"));
  const hmText = await readText(joinPath(run.dir, "heightmap.lua"));
  if (!text) return "planMissing";
  if (!hmText) return "heightmapMissing";
  const plan = parsePlan(text);
  if (!plan) return "planInvalid";
  return { plan, text, hmText };
}

/** Size of the first readable capture of a run (PNG header), or null. */
export async function captureSize(run: RunMeta): Promise<{ width: number; height: number } | null> {
  for (let seq = 1; seq <= Math.min(run.nX * run.nY, 5); seq++) {
    try {
      const size = pngSize(await readBytes(joinPath(run.dir, tileFileName(seq))));
      if (size) return size;
    } catch {
      /* not collected: next */
    }
  }
  return null;
}

export function tileFileName(seq: number, pitchIdx = 1): string {
  return `tile_p${String(pitchIdx).padStart(2, "0")}_${String(seq).padStart(3, "0")}.png`;
}

/** Bounded write queue: at most MAX_WRITES writes in flight, back-pressure on add(). */
class WriteQueue {
  private inFlight = new Set<Promise<void>>();
  private failure: unknown = null;

  async add(job: () => Promise<void>): Promise<void> {
    if (this.failure) throw this.failure;
    while (this.inFlight.size >= MAX_WRITES) await Promise.race(this.inFlight);
    const p = job()
      .catch((err) => {
        this.failure ??= err;
      })
      .finally(() => this.inFlight.delete(p));
    this.inFlight.add(p);
  }

  async drain(): Promise<void> {
    await Promise.all(this.inFlight);
    if (this.failure) throw this.failure;
  }
}

export interface OrthoExportHandle {
  done: Promise<PyramidJson>;
  cancel: () => void;
}

export function exportOrtho(
  run: RunMeta,
  gsd: number,
  interp: Interp,
  onProgress: (done: number, total: number) => void,
): OrthoExportHandle {
  let worker: Worker | null = null;
  let cancelled = false;
  let abort: ((err: Error) => void) | null = null;
  const tmpDir = joinPath(run.dir, "pyramid.tmp");
  const finalDir = joinPath(run.dir, "pyramid");

  const done = (async () => {
    const inputs = await loadRunInputs(run);
    if (typeof inputs === "string") throw new Error(inputs);
    // The captures' real size: another shape than the plan → wrong footprints (stop); same shape,
    // other size (scaling, other screen of the same format) → reproject at the real size.
    const real = await captureSize(run);
    if (real && !sameAspect(real.width, real.height, inputs.plan.screenW, inputs.plan.screenH)) {
      throw new Error("resolutionMismatch");
    }
    if (real && (real.width !== inputs.plan.screenW || real.height !== inputs.plan.screenH)) {
      inputs.plan = { ...inputs.plan, screenW: real.width, screenH: real.height };
    }
    const hm = parseHeightmap(inputs.hmText);
    if (!hm) throw new Error("heightmapInvalid");
    await removeDir(tmpDir);
    await ensureDir(tmpDir);
    const madeDirs = new Set<string>();
    const writes = new WriteQueue();
    let tileCount = 0, tileBytes = 0;

    const result = await new Promise<{ m: any }>((resolve, reject) => {
      if (cancelled) return reject(new Error("cancelled"));
      abort = reject;
      worker = new Worker(new URL("../workers/ortho.worker.ts", import.meta.url), { type: "module" });
      let chain = Promise.resolve();
      // Messages are handled strictly in order (writes are queued, the worker waits for tiles).
      worker.onmessage = (e: MessageEvent) => {
        chain = chain.then(async () => {
          const m = e.data;
          if (cancelled) return;
          if (m.type === "need") {
            const tiles: { seq: number; bytes: Uint8Array }[] = [];
            for (const seq of m.seqs as number[]) {
              try {
                tiles.push({ seq, bytes: await readBytes(joinPath(run.dir, tileFileName(seq))) });
              } catch {
                tiles.push({ seq, bytes: new Uint8Array(0) }); // missing tile → hole / neighbour fallback
              }
            }
            worker?.postMessage({ type: "tiles", tiles }, tiles.map((t) => t.bytes.buffer));
          } else if (m.type === "tile") {
            const zDir = joinPath(tmpDir, String(m.z));
            if (!madeDirs.has(zDir)) {
              madeDirs.add(zDir);
              await ensureDir(zDir);
            }
            tileCount++;
            tileBytes += m.png.length;
            await writes.add(() => writeBytes(joinPath(zDir, `${m.x}_${m.y}.png`), m.png));
          } else if (m.type === "progress") {
            onProgress(m.done, m.total);
          } else if (m.type === "done") {
            resolve({ m });
          } else if (m.type === "error") {
            // Known failures come back as their key (translated), the others with their stack.
            const known = /\b(resolutionMismatch)\b/.exec(String(m.message));
            reject(new Error(known ? known[1] : m.message));
          }
        }).catch(reject);
      };
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage({
        type: "start", plan: inputs.plan, hm: { ...hm, data: Array.from(hm.data) }, gsd, interp,
        overviewMaxSide: OVERVIEW_MAX_SIDE,
      });
    }).finally(() => {
      worker?.terminate();
      worker = null;
    });

    await writes.drain();
    if (cancelled) throw new Error("cancelled");
    const { m } = result;
    const out: PyramidJson = {
      version: PYRAMID_VERSION, width: m.info.width, height: m.info.height, tileSize: m.info.tileSize,
      zMax: m.info.zMax, gsd, minX: hm.minX, minY: hm.minY, maxX: hm.minX + hm.width, maxY: hm.minY + hm.height,
      interp, holes: m.stats.holes, tiles: tileCount, bytes: tileBytes, createdAt: new Date().toISOString(),
    };
    await writeText(joinPath(tmpDir, "pyramid.json"), JSON.stringify(out, null, 1));
    await writeBytes(joinPath(run.dir, "ortho.png"), m.overview.png);
    // Swap in the new pyramid only now that it is complete.
    await removeDir(finalDir);
    await renamePath(tmpDir, finalDir);
    return out;
  })().catch(async (err) => {
    await removeDir(tmpDir);
    throw err;
  });

  return {
    done,
    cancel: () => {
      cancelled = true;
      worker?.terminate();
      worker = null;
      abort?.(new Error("cancelled"));
    },
  };
}
