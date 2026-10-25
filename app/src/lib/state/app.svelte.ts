/**
 * App-wide state (Svelte 5 runes): game paths, the map exported by the mod (auto-reloaded when
 * map.lua changes) and the capture config. Persisted settings live in localStorage.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DEFAULT_CONFIG, type MosaicConfig } from "$lib/core/geometry";
import {
  luaNum, luaStr, parseBounds, parseCaptureIndex, parseHeightmap, parseMapCells, parsePlan, type Bounds, type Heightmap,
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

/** Capture timing is not user-tunable any more: drop overrides saved by earlier versions. */
function withoutTimingOverrides(cfg: MosaicConfig): MosaicConfig {
  const { SEG_DUR: _s, SHOT_OFFSET: _o, ENV_SETTLE_SEC: _e, SPEED_PRESET: _p, ...rest } = cfg;
  return rest;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
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
  config = $state<MosaicConfig>(withoutTimingOverrides(loadJson(LS_CONFIG, DEFAULT_CONFIG)));
  map = $state<MapData | null>(null);
  /** Translation key of the map loading problem, if any. */
  mapError = $state<"map.unreadable" | "map.noRelief" | null>(null);
  /** Viewer fullscreen (hides the app chrome). */
  fullscreen = $state(false);
  paths = $derived<GamePaths | null>(
    this.settings.userdata ? gamePaths(this.settings.userdata, this.settings.modDir || undefined) : null,
  );
  /** capture_plan.lua the mod plays at the next « Capturer » (null: none written yet). */
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

  /** Re-read capture_plan.lua (on change) and capture_index.lua: drives the workflow steps. */
  async refreshCapture(): Promise<void> {
    const p = this.paths;
    if (!p) return;
    const idxText = await readText(await exportFile(p, "capture_index"));
    if (idxText) {
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
      if (d.userdata) this.setUserdata(d.userdata);
    }
    this.startPolling();
  }

  setUserdata(path: string, modDir = this.settings.modDir): void {
    this.settings = { userdata: path, modDir };
    saveJson(LS_SETTINGS, this.settings);
    this.map = null;
    void this.reloadMap();
  }

  setConfig(patch: Partial<MosaicConfig>): void {
    this.config = { ...this.config, ...patch };
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
