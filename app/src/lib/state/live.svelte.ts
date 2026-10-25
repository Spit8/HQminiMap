/**
 * Live game data (mod export) for the Visualiser + the request the app writes back:
 * cadences (Settings) and commands (teleport). Files: <UD>/hqminimap/live_*.lua.
 */
import {
  clampInterval, DEFAULT_INTERVALS, LIVE_FORMAT, LIVE_KINDS, parseHistory, parseLive, parseRoutes, parseStats, parseStatus, parseStocks,
  parseTownAreas, renderRequest,
  type Industry, type Line, type LiveHistory, type LiveKind, type LiveRequest, type LiveStats, type LiveStatus, type LiveStocks,
  type Station, type Town, type Vehicle,
} from "$lib/core/live";
import { buildRoutes, type Pt } from "$lib/core/routes";
import { townOutline } from "$lib/core/towns";
import { ensureDir, fileStat, joinPath, readText, writeText } from "$lib/platform/fsx";
import type { GamePaths } from "$lib/platform/paths";

const LS_SETTINGS = "hq.live";
const POLL_MS = 700;
/** A command not acknowledged within this delay is reported as failed (mod not running?). */
const CMD_TIMEOUT_MS = 6000;
/**
 * Vehicle trails: fallback tracks of ships / aircraft and gap filling of the other lines. One point
 * per step (m), at most max points per vehicle; only ships' / aircraft's trails are kept on disk.
 */
const TRAIL = { free: { step: 40, max: 2000 }, network: { step: 25, max: 800 } };
const freeMode = (m: string | undefined) => m === "water" || m === "air";

const LS_TRAILS = "hq.trails";
type Trails = Map<number, Map<number, Pt[]>>;

/** Boat / aircraft trails survive app restarts (they take a while to build). */
function loadTrails(): Trails {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_TRAILS) ?? "null") as [number, [number, Pt[]][]][] | null;
    return new Map((raw ?? []).map(([line, vs]) => [line, new Map(vs)]));
  } catch {
    return new Map();
  }
}

let trailsTimer: ReturnType<typeof setTimeout> | null = null;
function saveTrailsSoon(trails: Trails, keep: Set<number>): void {
  if (trailsTimer) return;
  trailsTimer = setTimeout(() => {
    trailsTimer = null;
    try {
      localStorage.setItem(LS_TRAILS, JSON.stringify([...trails].filter(([l]) => keep.has(l)).map(([l, vs]) => [l, [...vs]])));
    } catch {
      /* storage unavailable or full */
    }
  }, 10_000);
}

export interface LiveSettings {
  enabled: boolean;
  intervals: Record<LiveKind, number>;
}

function loadSettings(): LiveSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SETTINGS) ?? "null") as Partial<LiveSettings> | null;
    const intervals = { ...DEFAULT_INTERVALS, ...(raw?.intervals ?? {}) };
    for (const k of LIVE_KINDS) intervals[k] = clampInterval(k, intervals[k]);
    return { enabled: raw?.enabled ?? true, intervals };
  } catch {
    return { enabled: true, intervals: { ...DEFAULT_INTERVALS } };
  }
}

export type CommandState = { seq: number; state: "pending" | "ok" | "error"; error?: string } | null;

class LiveState {
  settings = $state<LiveSettings>(loadSettings());
  towns = $state<Town[]>([]);
  industries = $state<Industry[]>([]);
  stations = $state<Station[]>([]);
  lines = $state<Line[]>([]);
  vehicles = $state<Vehicle[]>([]);
  stats = $state<LiveStats | null>(null);
  /** line → track polylines (world), accumulated by the mod from its vehicles' paths. */
  routes = $state<Map<number, Pt[][]>>(new Map());
  stocks = $state<LiveStocks | null>(null);
  /**
   * Fallback for ships / aircraft without a known track: positions of their vehicles, accumulated
   * here (line → vehicle → points). `trailsVersion` changes when a trail grows.
   */
  trails = loadTrails();
  trailsVersion = $state(0);
  /** town → outline rings (world), from the mod's building grid. */
  townAreas = $state<Map<number, { rings: Pt[][]; pop: number | null }>>(new Map());
  history = $state<LiveHistory | null>(null);
  /** Previous vehicle positions + times (ms) of the last two updates, for smooth animation. */
  /** Mean time between two vehicle updates as received (ms): the glide duration of the map. */
  vehicleIntervalMs = $state(2000);
  private lastVehiclesMs = 0;
  status = $state<LiveStatus | null>(null);
  /** Game time (unix s) of each data file. */
  updatedAt = $state<Partial<Record<LiveKind, number>>>({});
  command = $state<CommandState>(null);

  /** The game runs an older mod than this app (the save must be reloaded to load the new one). */
  get staleMod(): boolean {
    return !!this.status && this.status.format !== LIVE_FORMAT;
  }

  private paths: GamePaths | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private mtimes = new Map<string, number>();
  private busy = false;
  private cmdSeq = 0;
  private cmdSentMs = 0;

  start(paths: GamePaths | null): void {
    this.paths = paths;
    this.mtimes.clear();
    if (!this.timer) this.timer = setInterval(() => void this.poll(), POLL_MS);
    void this.writeRequest();
  }

  setSettings(patch: Partial<LiveSettings>): void {
    const intervals = { ...this.settings.intervals, ...(patch.intervals ?? {}) };
    for (const k of LIVE_KINDS) intervals[k] = clampInterval(k, intervals[k]);
    this.settings = { ...this.settings, ...patch, intervals };
    try {
      localStorage.setItem(LS_SETTINGS, JSON.stringify(this.settings));
    } catch {
      /* storage unavailable */
    }
    void this.writeRequest();
  }

  /** Move the in-game camera to world (x, y). Acknowledged through live_status. */
  async teleport(x: number, y: number, dist = 800): Promise<void> {
    this.cmdSeq = Math.max(this.cmdSeq, this.status?.lastCmdSeq ?? 0) + 1;
    this.command = { seq: this.cmdSeq, state: "pending" };
    this.cmdSentMs = Date.now();
    await this.writeRequest({ seq: this.cmdSeq, action: "teleport", x: Math.round(x), y: Math.round(y), dist });
  }

  private async writeRequest(cmd: LiveRequest["cmd"] = null): Promise<void> {
    const p = this.paths;
    if (!p) return;
    // Keep the last command in the file so a re-write (settings change) does not lose it;
    // the mod only runs a command whose seq is newer than the last one it ran.
    const req: LiveRequest = { enabled: this.settings.enabled, intervals: this.settings.intervals, cmd: cmd ?? this.lastCmd };
    if (cmd) this.lastCmd = cmd;
    try {
      await ensureDir(p.exportDir);
      await writeText(joinPath(p.exportDir, "live_request.lua"), renderRequest(req));
    } catch (err) {
      console.warn("live_request", err);
    }
  }
  private lastCmd: LiveRequest["cmd"] = null;

  private async changed(path: string): Promise<boolean> {
    const st = await fileStat(path);
    if (!st) return false;
    if (this.mtimes.get(path) === st.mtimeMs) return false;
    this.mtimes.set(path, st.mtimeMs);
    return true;
  }

  private async poll(): Promise<void> {
    const p = this.paths;
    if (!p || this.busy) return;
    this.busy = true;
    try {
      for (const kind of LIVE_KINDS) {
        const path = joinPath(p.exportDir, `live_${kind}.lua`);
        if (!(await this.changed(path))) continue;
        const text = await readText(path);
        if (kind === "townAreas") {
          const parsed = text ? parseTownAreas(text) : null;
          if (!parsed) {
            this.mtimes.delete(path);
            continue;
          }
          this.updatedAt = { ...this.updatedAt, [kind]: parsed.t };
          this.townAreas = new Map([...parsed.towns].map(([id, a]) => [id, { rings: townOutline(a.cells, parsed.cell), pop: a.pop }]));
          continue;
        }
        if (kind === "stats" || kind === "routes" || kind === "stocks" || kind === "history") {
          const parsed = !text ? null : kind === "stats" ? parseStats(text) : kind === "routes" ? parseRoutes(text)
            : kind === "stocks" ? parseStocks(text) : parseHistory(text);
          if (!parsed) {
            this.mtimes.delete(path);
            continue;
          }
          this.updatedAt = { ...this.updatedAt, [kind]: parsed.t };
          if (kind === "routes") this.routes = buildRoutes(parsed as Parameters<typeof buildRoutes>[0]);
          else if (kind === "stocks") this.stocks = parsed as LiveStocks;
          else if (kind === "history") this.history = parsed as LiveHistory;
          else this.stats = parsed as LiveStats;
          continue;
        }
        const parsed = text ? parseLive(kind, text) : null;
        if (!parsed) {
          this.mtimes.delete(path); // being written: retry next poll
          continue;
        }
        this.updatedAt = { ...this.updatedAt, [kind]: parsed.t };
        if (kind === "vehicles") {
          const nowMs = Date.now(), set = this.settings.intervals.vehicles * 1000;
          if (this.lastVehiclesMs) {
            const gap = Math.min(2 * set, Math.max(0.5 * set, nowMs - this.lastVehiclesMs));
            this.vehicleIntervalMs = 0.7 * this.vehicleIntervalMs + 0.3 * gap;
          } else this.vehicleIntervalMs = set;
          this.lastVehiclesMs = nowMs;
          this.vehicles = parsed.items as Vehicle[];
          this.recordTrails();
        } else if (kind === "towns") this.towns = parsed.items as Town[];
        else if (kind === "industries") this.industries = parsed.items as Industry[];
        else if (kind === "stations") this.stations = parsed.items as Station[];
        else this.lines = parsed.items as Line[];
      }
      const statusPath = joinPath(p.exportDir, "live_status.lua");
      if (await this.changed(statusPath)) {
        const s = parseStatus((await readText(statusPath)) ?? "");
        if (s) this.status = s;
      }
      this.updateCommand();
    } finally {
      this.busy = false;
    }
  }

  /** Grow the trails of every vehicle (a point each time it moved `step` m). */
  private recordTrails(): void {
    const modes = new Map(this.lines.map((l) => [l.id, l.mode]));
    let grew = false;
    for (const v of this.vehicles) {
      const mode = modes.get(v.line);
      const { step: TRAIL_STEP, max: TRAIL_MAX } = freeMode(mode) ? TRAIL.free : TRAIL.network;
      let byVehicle = this.trails.get(v.line);
      if (!byVehicle) this.trails.set(v.line, (byVehicle = new Map()));
      let pts = byVehicle.get(v.id);
      if (!pts) byVehicle.set(v.id, (pts = []));
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(v.x - last[0], v.y - last[1]) >= TRAIL_STEP) {
        pts.push([v.x, v.y]);
        if (pts.length > TRAIL_MAX) pts.shift();
        grew = true;
      }
    }
    if (grew) {
      this.trailsVersion++;
      saveTrailsSoon(this.trails, new Set(this.lines.filter((l) => freeMode(l.mode)).map((l) => l.id)));
    }
  }

  private updateCommand(): void {
    const c = this.command;
    if (!c || c.state !== "pending") return;
    const s = this.status;
    if (s?.cmd && s.cmd.seq >= c.seq) {
      this.command = s.cmd.ok ? { seq: c.seq, state: "ok" } : { seq: c.seq, state: "error", error: s.cmd.error ?? "" };
    } else if (Date.now() - this.cmdSentMs > CMD_TIMEOUT_MS) {
      this.command = { seq: c.seq, state: "error", error: "timeout" };
    }
  }
}

export const live = new LiveState();
