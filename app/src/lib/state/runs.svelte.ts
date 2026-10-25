/**
 * Capture runs: while the mod captures, its screenshots are moved from <UD>/screenshots into
 * <UD>/hqminimap/runs/<startedAt>/tile_pPP_SSS.png, together with the plan and heightmap the
 * capture used. Each tile is paired with its file by the shot wall time the mod records
 * (capture_index.shotTimes) and the time in the file name, so the player's own screenshots are
 * never taken nor touched. Also lists past runs (label, ortho).
 */
import { parseCaptureIndex, type CaptureIndex } from "$lib/core/lua";
import { fmtDate } from "$lib/i18n/index.svelte";
import { matchShots, runShots, tileNameFor } from "$lib/core/tiles";
import {
  baseName, copy, ensureDir, fileExists, fileStat, joinPath, listFiles, readText, removeDir, removeFile, writeText,
  type DirFile,
} from "$lib/platform/fsx";
import { capturePlanPath, exportFile, type GamePaths } from "$lib/platform/paths";
import { readDir } from "@tauri-apps/plugin-fs";

const POLL_MS = 1000;
/** Runs the user deleted: the collector must not recreate them from capture_index.lua. */
const LS_DELETED = "hq.deletedRuns";

function loadDeleted(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_DELETED) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export interface RunMeta {
  id: string;
  startedAt: number;
  /** User label (defaults to date · grid · Z). */
  label?: string;
  nX: number;
  nY: number;
  pitchCount: number;
  zEye?: number;
  expected: number;
  collected: number;
  /** Screenshots taken during the run that belong to no tile (left in place). */
  extras?: number;
  finished: boolean;
  error: string | null;
  /** Pyramid present (ortho exported). */
  hasOrtho: boolean;
  /** pyramid.json version (1 = edge tiles stretched in the viewer, recompute). */
  orthoVersion?: number;
  dir: string;
}

export function runLabel(r: RunMeta): string {
  if (r.label) return r.label;
  const d = fmtDate(r.startedAt * 1000);
  return `${d} · ${r.nY}×${r.nX}${r.zEye ? ` · Z ${r.zEye} m` : ""}`;
}

class RunsState {
  runs = $state<RunMeta[]>([]);
  /** Run currently being collected (live capture). */
  live = $state<RunMeta | null>(null);
  private paths: GamePaths | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private liveId: string | null = null;
  /** Tile names already in the run folder (live run). */
  private collected = new Set<string>();
  private extras = new Set<string>();
  private zEye: number | undefined;
  /** Plan + heightmap of the live run are in its folder. */
  private inputsReady = false;
  private deleted = loadDeleted();

  get runsDir(): string | null {
    return this.paths?.runsDir ?? null;
  }

  start(paths: GamePaths | null): void {
    this.paths = paths;
    this.collected.clear();
    this.extras.clear();
    this.liveId = null;
    if (!this.timer) this.timer = setInterval(() => void this.tick(), POLL_MS);
    void this.refreshList();
  }

  private async tick(): Promise<void> {
    if (!this.paths || this.busy) return;
    this.busy = true;
    try {
      await this.collect(this.paths);
    } catch (err) {
      console.warn("run collector", err);
    } finally {
      this.busy = false;
    }
  }

  private async collect(p: GamePaths): Promise<void> {
    const idxText = await readText(await exportFile(p, "capture_index"));
    if (!idxText) return;
    const idx: CaptureIndex = parseCaptureIndex(idxText);
    if (!idx.startedAt || idx.nX < 1 || idx.nY < 1) return;
    const id = String(idx.startedAt);
    if (this.deleted.has(id)) {
      if (this.live?.id === id) this.live = null;
      return;
    }
    const dir = joinPath(p.runsDir, id);
    const expected = idx.nX * idx.nY * idx.pitchCount;
    if (this.liveId !== id) {
      // New run (or first sight of it): reload what is already there.
      this.liveId = id;
      this.inputsReady = false;
      this.collected.clear();
      this.extras.clear();
      await ensureDir(dir);
      for (const f of await listFiles(dir, /^tile_p\d+_\d+\.\w+$/)) this.collected.add(f.name);
    }
    if (!this.inputsReady) this.inputsReady = await this.snapshotInputs(p, dir, idx);
    const done = idx.finishedAt != null;
    const complete = this.collected.size >= Math.min(expected, idx.shotsTaken || expected);
    if (!(done && complete && this.live?.id === id && this.live.finished)) {
      await this.collectShots(p, idx, dir);
    }
    const meta: RunMeta = {
      id, startedAt: idx.startedAt, nX: idx.nX, nY: idx.nY, pitchCount: idx.pitchCount, zEye: this.zEye,
      expected, collected: this.collected.size, extras: this.extras.size, finished: done, error: idx.error,
      hasOrtho: false, dir,
    };
    const prev = this.live;
    this.live = meta;
    if (!prev || prev.id !== id || prev.collected !== meta.collected || prev.finished !== done
      || prev.extras !== meta.extras) {
      await this.saveRunJson(meta);
      await this.refreshList();
    }
  }

  /**
   * Copy the plan and heightmap the capture used into the run folder (retried every tick until
   * both are there). The plan must be the one the capture played: same planStamp.
   */
  private async snapshotInputs(p: GamePaths, dir: string, idx: CaptureIndex): Promise<boolean> {
    const planDest = joinPath(dir, "mosaic_plan.lua");
    if (!(await fileExists(planDest))) {
      const plan = await readText(capturePlanPath(p));
      const stamp = plan?.match(/M\.planStamp\s*=\s*(\d+)/);
      if (plan && (idx.planStamp == null || (stamp && +stamp[1] === idx.planStamp))) {
        await writeText(planDest, plan);
      }
    }
    const hmDest = joinPath(dir, "heightmap.lua");
    if (!(await fileExists(hmDest))) {
      const hm = await exportFile(p, "heightmap");
      if (await fileExists(hm)) await copy(hm, hmDest);
    }
    const planText = await readText(planDest);
    const z = planText?.match(/M\.zEye\s*=\s*([-+0-9.eE]+)/);
    this.zEye = z ? +z[1] : undefined;
    return !!planText && (await fileExists(hmDest));
  }

  /** Copy (then remove from screenshots) the files of the tiles not collected yet. */
  private async collectShots(p: GamePaths, idx: CaptureIndex, dir: string): Promise<void> {
    const files = await listFiles(p.screenshots);
    const now = Date.now();
    const nameOf = (k: number, f: DirFile) =>
      tileNameFor(k + 1, idx.nX, idx.nY, f.name.slice(f.name.lastIndexOf("."))).name;
    if (idx.shotTimes.length) {
      // Pair only the tiles still missing (collected files are already gone from screenshots).
      const pending = idx.shotTimes.map((_, k) => k).filter((k) => !this.collected.has(tileNameFor(k + 1, idx.nX, idx.nY).name));
      if (!pending.length) return;
      const m = matchShots(files, pending.map((k) => idx.shotTimes[k]), now);
      for (const f of m.extras) this.extras.add(f.name);
      for (let i = 0; i < pending.length; i++) {
        const f = m.matches[i];
        if (!f) continue;
        this.extras.delete(f.name);
        await this.take(f, joinPath(dir, nameOf(pending[i], f)), true);
      }
      return;
    }
    // Index without shot times (older mod): rank in the time window, copy only.
    const shots = runShots(files, idx.startedAt!, now).slice(0, idx.nX * idx.nY * idx.pitchCount);
    for (let k = 0; k < shots.length; k++) {
      const name = nameOf(k, shots[k]);
      if (!this.collected.has(name)) await this.take(shots[k], joinPath(dir, name), false);
    }
  }

  /** Copy a screenshot into the run, verify it, then (move=true) remove the original. */
  private async take(f: DirFile, dest: string, move: boolean): Promise<void> {
    await copy(f.path, dest);
    const st = await fileStat(dest);
    if (!st || st.size !== f.size) return; // retried next tick
    this.collected.add(baseName(dest));
    if (move) await removeFile(f.path);
  }

  private async saveRunJson(meta: RunMeta): Promise<void> {
    const path = joinPath(meta.dir, "run.json");
    const old = await readText(path);
    let label: string | undefined;
    try {
      label = old ? (JSON.parse(old) as RunMeta).label : undefined;
    } catch {
      label = undefined;
    }
    const { dir: _dir, hasOrtho: _h, ...stored } = meta;
    await writeText(path, JSON.stringify({ ...stored, label }, null, 1));
  }

  async setLabel(run: RunMeta, label: string): Promise<void> {
    const path = joinPath(run.dir, "run.json");
    const raw = await readText(path);
    if (!raw) return;
    const data = JSON.parse(raw);
    data.label = label.trim() || undefined;
    await writeText(path, JSON.stringify(data, null, 1));
    await this.refreshList();
  }

  /** Total size (bytes) of a run folder, tiles + pyramid + ortho. */
  async dirSize(run: RunMeta): Promise<number> {
    const walk = async (dir: string): Promise<number> => {
      let total = 0;
      let entries: { name: string; isDirectory: boolean; isFile: boolean }[] = [];
      try {
        entries = await readDir(dir);
      } catch {
        return 0;
      }
      for (const e of entries) {
        const path = joinPath(dir, e.name);
        if (e.isDirectory) total += await walk(path);
        else if (e.isFile) total += (await fileStat(path))?.size ?? 0;
      }
      return total;
    };
    return walk(run.dir);
  }

  /** Delete run folders (callers must not pass the live capture or a run being exported). */
  /**
   * Delete run folders (callers must not pass the live capture or a run being exported).
   * The ids are remembered first, so the collector never recreates them from capture_index.lua.
   * @return ids whose folder could not be fully removed (files locked by another program).
   */
  async deleteRuns(ids: string[]): Promise<string[]> {
    for (const id of ids) this.deleted.add(id);
    try {
      localStorage.setItem(LS_DELETED, JSON.stringify([...this.deleted]));
    } catch {
      /* storage unavailable: still skipped for this session */
    }
    // Let a collector tick in progress finish before removing what it may be writing.
    while (this.busy) await new Promise((r) => setTimeout(r, 50));
    const failed: string[] = [];
    for (const id of ids) {
      const run = this.runs.find((r) => r.id === id);
      if (run && !(await removeDir(run.dir))) failed.push(id);
      if (this.liveId === id) {
        this.liveId = null;
        this.collected.clear();
        this.live = null;
      }
    }
    await this.refreshList();
    return failed;
  }

  async refreshList(): Promise<void> {
    const p = this.paths;
    if (!p) {
      this.runs = [];
      return;
    }
    let entries: { name: string; isDirectory: boolean }[] = [];
    try {
      entries = await readDir(p.runsDir);
    } catch {
      this.runs = [];
      return;
    }
    const out: RunMeta[] = [];
    for (const e of entries) {
      if (!e.isDirectory) continue;
      const dir = joinPath(p.runsDir, e.name);
      const raw = await readText(joinPath(dir, "run.json"));
      if (!raw) continue;
      try {
        const meta = JSON.parse(raw) as RunMeta;
        meta.dir = dir;
        meta.id = baseName(dir);
        const pyr = await readText(joinPath(dir, "pyramid", "pyramid.json"));
        meta.hasOrtho = !!pyr;
        meta.orthoVersion = pyr ? (JSON.parse(pyr).version as number) : undefined;
        out.push(meta);
      } catch {
        /* not a run */
      }
    }
    this.runs = out.sort((a, b) => b.startedAt - a.startedAt);
  }
}

export const runs = new RunsState();
