/**
 * App-wide state (Svelte 5 runes): game paths, the map exported by the mod (auto-reloaded when
 * map.lua changes) and the capture config. Persisted settings live in localStorage.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_CONFIG, type MosaicConfig } from "$lib/core/geometry";
import {
  luaNum, luaStr, parseBounds, parseCaptureIndex, parseHeightmap, parseMapCells, parsePlan, parseWaterGrid, type Bounds, type Heightmap,
} from "$lib/core/lua";
import { fileStat, readText } from "$lib/platform/fsx";
import { capturePlanPath, detectUserdata, exportFile, gamePaths, type GamePaths } from "$lib/platform/paths";

const LS_SETTINGS = "hq.settings";
const LS_CONFIG = "hq.config";
const POLL_MS = 1500;

export interface MapData {
  bounds: Bounds;
  hm: Heightmap;
  exportedAt: number | null;
  climateId: string | null;
  mapPath: string;
  mapMtimeMs: number;
}

export interface CapturePlanInfo {
  text: string;
  mtimeMs: number;
  nX: number;
  nY: number;
  stamp: number;
}

export interface LastCapture {
  startedAt: number | null;
  planStamp: number | null;
  finished: boolean;
  shots: number;
  expected: number;
  error: string | null;
}

/** A config saved before the capture modes was set by hand: it stays as it is (custom mode). */
function withMode(cfg: MosaicConfig, saved: boolean): MosaicConfig {
  return cfg.MODE || !saved ? cfg : { ...cfg, MODE: "custom" };
}

function hasSaved(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/** Capture timing is not user-tunable any more: drop overrides saved by earlier versions. */
function withoutTimingOverrides(cfg: MosaicConfig): MosaicConfig {
  const { SEG_DUR: _s, SHOT_OFFSET: _o, ENV_SETTLE_SEC: _e, SPEED_PRESET: _p, ...rest } = cfg;
  return rest;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = { ...(fallback as object) } as Record<string, unknown>;
    for (const [k, v] of Object.entries(parsed)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "number" && !Number.isFinite(v)) continue;
      out[k] = v;
    }
    return out as T;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

class AppState {
  settings = $state(loadJson(LS_SETTINGS, { userdata: "", modDir: "" }));
  candidates = $state<string[]>([]);
  config = $state<MosaicConfig>(withMode(withoutTimingOverrides(loadJson(LS_CONFIG, DEFAULT_CONFIG)), hasSaved(LS_CONFIG)));
  map = $state<MapData | null>(null);
  /** Translation key of the map loading problem, if any. */
  mapError = $state<"map.unreadable" | "map.noRelief" | null>(null);
  /** Viewer fullscreen (hides the app chrome). */
  fullscreen = $state(false);
  paths = $derived<GamePaths | null>(
    this.settings.userdata ? gamePaths(this.settings.userdata, this.settings.modDir || undefined) : null,
  );
  /** capture_plan.lua the mod plays at the next scan (null: none written yet). */
  capturePlan = $state<CapturePlanInfo | null | undefined>(undefined);
  /** Last capture seen in capture_index.lua. */
  lastCapture = $state<LastCapture | null>(null);
  private timer: ReturnType<typeof setInterval> | null = null;
  private loading = false;

  /** Viewer fullscreen: the OS window goes fullscreen and the app chrome is hidden. */
  async setFullscreen(on: boolean): Promise<void> {
    this.fullscreen = on;
    try {
      await getCurrentWindow().setFullscreen(on);
    } catch (err) {
      // Outside Tauri or window API refused: fall back to the web fullscreen API.
      console.warn("setFullscreen", err);
      try {
        if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
        else if (!on && document.fullscreenElement) await document.exitFullscreen();
      } catch {
        /* chrome is hidden anyway */
      }
    }
  }

  private idxMtime = 0;
  /** Re-read capture_plan.lua (on change) and capture_index.lua: drives the workflow steps. */
  async refreshCapture(): Promise<void> {
    const p = this.paths;
    if (!p) return;
    // Read again only when it changed (this runs every 1.5 s).
    const idxPath = await exportFile(p, "capture_index");
    const idxStat = await fileStat(idxPath);
    const changedIdx = !!idxStat && idxStat.mtimeMs !== this.idxMtime;
    const idxText = changedIdx ? await readText(idxPath) : null;
    // Being written (empty): read again next time.
    if (idxText) this.idxMtime = idxStat!.mtimeMs;
    if (idxStat && !idxText) {
      /* unchanged */
    } else if (idxText) {
      const idx = parseCaptureIndex(idxText);
      const next: LastCapture = {
        startedAt: idx.startedAt, planStamp: idx.planStamp, finished: idx.finishedAt != null,
        shots: idx.shotsTaken, expected: idx.nX * idx.nY * idx.pitchCount, error: idx.error,
      };
      if (JSON.stringify(next) !== JSON.stringify(this.lastCapture)) this.lastCapture = next;
    } else if (this.lastCapture) {
      this.lastCapture = null;
    }
    const path = capturePlanPath(p);
    const st = await fileStat(path);
    if (!st) {
      this.capturePlan = null;
      return;
    }
    if (this.capturePlan && this.capturePlan.mtimeMs === st.mtimeMs) return;
    const text = (await readText(path)) ?? "";
    const pl = parsePlan(text);
    const stamp = luaNum(text, "M\\.planStamp");
    this.capturePlan = {
      text, mtimeMs: st.mtimeMs, nX: pl?.nX ?? 0, nY: pl?.nY ?? 0, stamp: Number.isFinite(stamp) ? stamp : 0,
    };
  }

  async init(): Promise<void> {
    if (!this.settings.userdata) {
      const d = await detectUserdata();
      this.candidates = d.candidates;
      if (d.userdata) this.setUserdata(d.userdata, d.modDir ?? "");
    }
    this.startPolling();
    void this.allowSavedDirs();
  }

  /** Re-grant the saved folders: the dialog scope is not kept across launches (no persisted-scope plugin). */
  private async allowSavedDirs(): Promise<void> {
    const dirs = [this.settings.userdata, this.settings.modDir, ...this.candidates].filter((d): d is string => !!d);
    if (!dirs.length) return;
    try {
      await invoke("allow_dirs", { dirs });
    } catch {
      /* browser preview, or the command is unavailable */
    }
  }

  setUserdata(path: string, modDir = this.settings.modDir): void {
    this.settings = { userdata: path, modDir };
    saveJson(LS_SETTINGS, this.settings);
    this.map = null;
    void this.allowSavedDirs();
    void this.reloadMap();
  }

  setConfig(patch: Partial<MosaicConfig>): void {
    const next: MosaicConfig = { ...this.config };
    const limits: Partial<Record<keyof MosaicConfig, [number, number]>> = {
      Z_EYE: [50, 200_000], FOV_V_DEG: [1, 120], FOV_SCALE: [0.2, 5], PIXEL_ASPECT: [0.5, 3],
      GRID_NX: [1, 64], GRID_NY: [1, 64], STEP_SCALE_X: [0.25, 4], STEP_SCALE_Y: [0.25, 4],
      COVER_MARGIN_M: [0, 1000], CAPTURE_TIME_SEC: [0, 86_400], CAPTURE_DAY_OF_YEAR: [1, 366],
      CAPTURE_LATITUDE: [-90, 90], screenW: [320, 16_384], screenH: [240, 16_384],
    };
    const bag = next as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch) as [keyof MosaicConfig, MosaicConfig[keyof MosaicConfig]][]) {
      if (v === null || v === undefined) continue;
      if (typeof v === "number") {
        if (!Number.isFinite(v)) continue;
        const lim = limits[k];
        bag[k] = lim ? Math.min(lim[1], Math.max(lim[0], v)) : v;
      } else bag[k] = v;
    }
    this.config = next;
    saveJson(LS_CONFIG, this.config);
  }

  startPolling(): void {
    if (this.timer) return;
    void this.reloadMap();
    void this.refreshCapture();
    this.timer = setInterval(() => {
      void this.reloadMap();
      void this.refreshCapture();
    }, POLL_MS);
  }

  /** Reload map.lua + heightmap.lua when map.lua changed (the mod writes it last). */
  async reloadMap(force = false): Promise<void> {
    const p = this.paths;
    if (!p || this.loading) return;
    this.loading = true;
    try {
      const mapPath = await exportFile(p, "map");
      const st = await fileStat(mapPath);
      if (!st) {
        this.map = null;
        this.mapError = null;
        return;
      }
      if (!force && this.map && this.map.mapPath === mapPath && this.map.mapMtimeMs === st.mtimeMs) return;
      const mapText = await readText(mapPath);
      const bounds = mapText ? parseBounds(mapText) : null;
      if (!mapText || !bounds) {
        this.mapError = "map.unreadable";
        return;
      }
      const hmText = await readText(await exportFile(p, "heightmap"));
      const hm = (hmText && parseHeightmap(hmText)) || parseMapCells(mapText);
      if (hm) hm.waterGrid = parseWaterGrid(mapText);
      if (!hm) {
        this.mapError = "map.noRelief";
        return;
      }
      const exported = luaNum(mapText, "exportedAt");
      this.map = {
        bounds, hm, mapPath, mapMtimeMs: st.mtimeMs,
        exportedAt: Number.isFinite(exported) ? exported : null,
        climateId: luaStr(mapText, "climateId"),
      };
      this.mapError = null;
    } finally {
      this.loading = false;
    }
  }
}

export const app = new AppState();
