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
import { buildRoutes, routeParts, type Pt, type RouteParts } from "$lib/core/routes";
import { townOutline } from "$lib/core/towns";
import { ensureDir, fileStat, joinPath, readText, writeText } from "$lib/platform/fsx";
import type { GamePaths } from "$lib/platform/paths";

import { perf } from "./perf.svelte";
const LS_SETTINGS = "hq.live";
const POLL_MS = 700;
/** A command not acknowledged within this delay is reported as failed (mod not running?). */
const CMD_TIMEOUT_MS = 6000;
/** The scan: the game may be slow to read the request (heavy map, low frame rate). */
const SCAN_TIMEOUT_MS = 12000;
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
function saveTrailsSoon(trails: Trails): void {
  if (trailsTimer) clearTimeout(trailsTimer);
  trailsTimer = setTimeout(() => {
    trailsTimer = null;
    try {
      // The line list at write time: empty means the fleet is not loaded yet, so keep every trail.
      const lines = live.lines;
      const keep = lines.length ? new Set(lines.filter((l) => freeMode(l.mode)).map((l) => l.id)) : null;
      const rows = [...trails].filter(([l]) => keep === null || keep.has(l)).map(([l, vs]) => [l, [...vs]]);
      localStorage.setItem(LS_TRAILS, JSON.stringify(rows));
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
  // Replaced whole on each read of their file, never mutated: raw (no deep proxies on every read,
  // and the map sees the same objects until a file changes).
  towns = $state.raw<Town[]>([]);
  industries = $state.raw<Industry[]>([]);
  stations = $state.raw<Station[]>([]);
  lines = $state.raw<Line[]>([]);
  vehicles = $state.raw<Vehicle[]>([]);
  stats = $state.raw<LiveStats | null>(null);
  /** line → track polylines (world), accumulated by the mod from its vehicles' paths. */
  routes = $state<Map<number, Pt[][]>>(new Map());
  /** Same tracks per edge (shared edges are drawn as bands). */
  routeParts = $state<RouteParts | null>(null);
  stocks = $state.raw<LiveStocks | null>(null);
  /**
   * Fallback for ships / aircraft without a known track: positions of their vehicles, accumulated
   * here (line → vehicle → points). `trailsVersion` changes when a trail grows.
   */
  trails = loadTrails();
  trailsVersion = $state(0);
  /** town → outline rings (world), from the mod's building grid. */
  townAreas = $state<Map<number, { rings: Pt[][]; pop: number | null }>>(new Map());
  history = $state.raw<LiveHistory | null>(null);
  /** Previous vehicle positions + times (ms) of the last two updates, for smooth animation. */
  /** Mean time between two vehicle updates as received (ms): the glide duration of the map. */
  vehicleIntervalMs = $state(2000);
  private lastVehiclesMs = 0;
  status = $state<LiveStatus | null>(null);
  /** When the status file last changed (its modification time): the game runs if it is recent. */
  statusAt = $state(0);
  /** Wall clock, refreshed about every 5 s, so a 30 s status expiry updates without a new file. */
  now = $state(Date.now());
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
  private writeChain: Promise<void> = Promise.resolve();
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  start(paths: GamePaths | null): void {
    this.paths = paths;
    this.mtimes.clear();
    if (!this.timer) this.timer = setInterval(() => void this.poll(), POLL_MS);
    if (!this.clockTimer) this.clockTimer = setInterval(() => (this.now = Date.now()), 5000);
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

  /** A scan still waiting must not be replaced by a camera command. */
  private scanPending(): boolean {
    return this.command?.state === "pending" && this.lastCmd?.action === "scan";
  }

  /** Move the in-game camera to world (x, y). Acknowledged through live_status. */
  async teleport(x: number, y: number, dist = 800): Promise<void> {
    if (this.scanPending() || !this.status) return;
    this.cmdSeq = Math.max(this.cmdSeq, this.status.lastCmdSeq) + 1;
    this.command = { seq: this.cmdSeq, state: "pending" };
    this.cmdSentMs = Date.now();
    this.cmdTimeoutMs = CMD_TIMEOUT_MS;
    await this.writeRequest({ seq: this.cmdSeq, action: "teleport", x: Math.round(x), y: Math.round(y), dist });
  }

  /** Camera onto an object of the app (kind = layer, id = entity) and, if `open`, its in-game window. */
  async focus(kind: string, id: number, x: number, y: number, open: boolean, dist = 500): Promise<void> {
    if (this.scanPending() || !this.status) return;
    this.cmdSeq = Math.max(this.cmdSeq, this.status.lastCmdSeq) + 1;
    this.command = { seq: this.cmdSeq, state: "pending" };
    this.cmdSentMs = Date.now();
    this.cmdTimeoutMs = CMD_TIMEOUT_MS;
    await this.writeRequest({ seq: this.cmdSeq, action: "focus", x: Math.round(x), y: Math.round(y), dist, kind, id, open });
  }

  /**
   * Start the scheduled scan in the game. Resolves with the mod's answer, or error "timeout" when the
   * game does not answer (not running, no game loaded, mod not active).
   */
  async scan(): Promise<{ ok: boolean; error?: string }> {
    if (!this.status) return { ok: false, error: "timeout" };
    this.cmdSeq = Math.max(this.cmdSeq, this.status.lastCmdSeq) + 1;
    const seq = this.cmdSeq;
    this.command = { seq, state: "pending" };
    this.cmdSentMs = Date.now();
    this.cmdTimeoutMs = SCAN_TIMEOUT_MS;
    const answer = new Promise<{ ok: boolean; error?: string }>((resolve) => this.waiters.set(seq, resolve));
    await this.writeRequest({ seq, action: "scan" });
    return answer;
  }
  private waiters = new Map<number, (r: { ok: boolean; error?: string }) => void>();
  private cmdTimeoutMs = CMD_TIMEOUT_MS;

  private async writeRequest(cmd: LiveRequest["cmd"] = null): Promise<void> {
    const job = this.writeChain.then(() => this.writeRequestNow(cmd));
    this.writeChain = job.then(() => undefined, () => undefined);
    return job;
  }

  private async writeRequestNow(cmd: LiveRequest["cmd"] = null): Promise<void> {
    const p = this.paths;
    if (!p) return;
    // The pending command stays in the file until the mod answers (a settings re-write must not
    // lose it), then it is removed: a mod that restarts (save or mod reloaded) never replays it.
    // It also carries its sending time: the mod ignores a command older than a minute.
    if (cmd) this.lastCmd = { ...cmd, at: Math.floor(Date.now() / 1000) };
    const req: LiveRequest = { enabled: this.settings.enabled, intervals: this.settings.intervals, cmd: this.lastCmd };
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
    // Changes found in this poll are applied together at the end (one map update, not one per file).
    const apply: (() => void)[] = [];
    try {
      for (const kind of LIVE_KINDS) {
        const path = joinPath(p.exportDir, `live_${kind}.lua`);
        try {
          if (!(await this.changed(path))) continue;
          const text = await readText(path);
          if (kind === "townAreas") {
            const parsed = text ? parseTownAreas(text) : null;
            if (!parsed) {
              this.mtimes.delete(path);
              continue;
            }
            const areas = new Map([...parsed.towns].map(([id, a]) => [id, { rings: townOutline(a.cells, parsed.cell), pop: a.pop }]));
            apply.push(() => {
              this.updatedAt = { ...this.updatedAt, [kind]: parsed.t };
              this.townAreas = areas;
            });
            continue;
          }
          if (kind === "stats" || kind === "routes" || kind === "stocks" || kind === "history") {
            const parsed = !text ? null : kind === "stats" ? parseStats(text) : kind === "routes" ? parseRoutes(text)
              : kind === "stocks" ? parseStocks(text) : parseHistory(text);
            if (!parsed) {
              this.mtimes.delete(path);
              continue;
            }
            if (kind === "routes") {
              // Edges sampled once, for both the tracks and the lanes.
              const parts = routeParts(parsed as Parameters<typeof routeParts>[0]);
              const built = buildRoutes(parsed as Parameters<typeof buildRoutes>[0], new Map(parts.edges));
              apply.push(() => {
                this.routes = built;
                this.routeParts = parts;
              });
            } else if (kind === "stocks") apply.push(() => (this.stocks = parsed as LiveStocks));
            else if (kind === "history") apply.push(() => (this.history = parsed as LiveHistory));
            else apply.push(() => (this.stats = parsed as LiveStats));
            apply.push(() => (this.updatedAt = { ...this.updatedAt, [kind]: parsed.t }));
            continue;
          }
          const parsed = text ? parseLive(kind, text) : null;
          if (!parsed) {
            this.mtimes.delete(path); // being written: retry next poll
            continue;
          }
          apply.push(() => {
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
          });
        } catch {
          this.mtimes.delete(path);
        }
      }
      const statusPath = joinPath(p.exportDir, "live_status.lua");
      const statusStat = await fileStat(statusPath);
      if (statusStat && this.mtimes.get(statusPath) !== statusStat.mtimeMs) {
        try {
          const s = parseStatus((await readText(statusPath)) ?? "");
          if (s) {
            this.mtimes.set(statusPath, statusStat.mtimeMs);
            apply.push(() => {
              this.status = s;
              this.statusAt = statusStat.mtimeMs;
            });
          } else this.mtimes.delete(statusPath);
        } catch {
          this.mtimes.delete(statusPath);
        }
      }
    } finally {
      // Lines first (vehicles' trails look up their line's mode), then the rest, synchronously.
      for (const f of apply) {
        try {
          f();
        } catch (err) {
          console.warn("live apply", err);
        }
      }
      // After the status is applied: an acknowledgement in this poll's status counts now.
      this.updateCommand();
      this.busy = false;
    }
  }

  /** vehicle → line its trail is filed under. */
  private trailLine = new Map<number, number>();

  /** Grow the trails of every vehicle (a point each time it moved `step` m). */
  private recordTrails(): void {
    const modes = new Map(this.lines.map((l) => [l.id, l.mode]));
    let grew = false;
    for (const v of this.vehicles) {
      const mode = modes.get(v.line);
      const { step: TRAIL_STEP, max } = freeMode(mode) ? TRAIL.free : TRAIL.network;
      // Shorter trails when the performance controller asks for it.
      const TRAIL_MAX = Math.round(max * perf.caps.trailShare);
      // A vehicle moved to another line: its trail leaves the old one.
      const was = this.trailLine.get(v.id);
      if (was === undefined) {
        // First sight since launch: restored trails may still file it under a line it left.
        for (const [l, byV] of this.trails) if (l !== v.line && byV.delete(v.id)) grew = true;
      } else if (was !== v.line) {
        this.trails.get(was)?.delete(v.id);
        grew = true;
      }
      this.trailLine.set(v.id, v.line);
      let byVehicle = this.trails.get(v.line);
      if (!byVehicle) this.trails.set(v.line, (byVehicle = new Map()));
      let pts = byVehicle.get(v.id);
      if (!pts) byVehicle.set(v.id, (pts = []));
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(v.x - last[0], v.y - last[1]) >= TRAIL_STEP) {
        pts.push([v.x, v.y]);
        grew = true;
      }
      if (this.lines.length && pts.length > TRAIL_MAX) pts.splice(0, pts.length - TRAIL_MAX);
    }
    // Vehicles gone (sold) and lines deleted: their trails go too (the list is the whole fleet).
    if (this.vehicles.length) {
      const alive = new Set(this.vehicles.map((v) => v.id));
      for (const [line, byVehicle] of this.trails) {
        for (const id of byVehicle.keys()) if (!alive.has(id)) {
          byVehicle.delete(id);
          grew = true;
        }
        if (!byVehicle.size) this.trails.delete(line);
      }
      for (const id of this.trailLine.keys()) if (!alive.has(id)) this.trailLine.delete(id);
    }
    if (grew) {
      this.trailsVersion++;
      saveTrailsSoon(this.trails);
    }
  }

  private updateCommand(): void {
    const c = this.command;
    if (!c || c.state !== "pending") return;
    const s = this.status;
    if (s?.cmd && s.cmd.seq >= c.seq) {
      this.command = s.cmd.ok ? { seq: c.seq, state: "ok" } : { seq: c.seq, state: "error", error: s.cmd.error ?? "" };
    } else if (Date.now() - this.cmdSentMs > this.cmdTimeoutMs) {
      this.command = { seq: c.seq, state: "error", error: "timeout" };
    } else {
      return;
    }
    // Answered (or given up): out of the request file.
    if (this.lastCmd?.seq === c.seq) {
      this.lastCmd = null;
      void this.writeRequest();
    }
    // Answer whoever waits for this command (and drop older ones: superseded).
    const done = this.command;
    for (const [seq, resolve] of this.waiters) {
      if (seq > c.seq) continue;
      this.waiters.delete(seq);
      resolve(seq === c.seq && done?.state === "ok" ? { ok: true } : { ok: false, error: seq === c.seq ? (done?.error ?? "") : "superseded" });
    }
  }
}

export const live = new LiveState();
