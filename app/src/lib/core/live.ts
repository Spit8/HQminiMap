/**
 * Live game data written by the mod (mod/content/hqminimap/live_export.lua) and the request the
 * app writes back (cadences + commands). Pure: parsing and serialisation only.
 */
import { parseUserdata, toUserdata, type LuaValue } from "./luadata";

export const LIVE_KINDS = [
  "towns", "industries", "stations", "lines", "vehicles", "stats", "routes", "stocks", "townAreas", "history",
] as const;
/** Format of the files written by the mod (live_status.format); older = the game runs an old mod. */
export const LIVE_FORMAT = 7;
export type LiveKind = (typeof LIVE_KINDS)[number];

export interface Town { id: number; name: string; x: number; y: number; size: number }
/** One stock of an industry / warehouse (live_stocks). */
export interface Stock { cargo: number; kind: "in" | "out" | "store"; n: number; cap: number }
export interface Industry {
  id: number; type: string; file: string; level: number | null; x: number; y: number;
  /** Joined from live_stocks. */
  stocks?: Stock[];
}
export interface Warehouse { id: number; name: string; x: number; y: number; stocks: Stock[] }
export type StationMode = "rail" | "road" | "tram" | "water" | "air" | "other";
/** Traffic of a station group: loaded / unloaded per year, waiting passengers / cargo. */
export interface StationTraffic { loaded: number; unloaded: number; waitP: number; waitC: number }
export interface Station {
  id: number; name: string; x: number; y: number; mode: StationMode; cargo: boolean; passengers: boolean;
  /** Joined from live_stats. */
  traffic?: StationTraffic;
}
/** Traffic of a line: transported per year, waiting at its stops. */
export interface LineTraffic { transported: number; waitP: number; waitC: number }
export interface LineStop { g: number; x: number; y: number }
export interface Line {
  id: number;
  name: string;
  /** RGB 0..1 from the game, null when the line has no colour. */
  color: [number, number, number] | null;
  stops: LineStop[];
  vehicles: number;
  carrier: number | null;
  mode: StationMode;
  /** Joined from live_stats. */
  traffic?: LineTraffic;
}
export interface Load { n: number; cap: number }
export interface Vehicle {
  id: number; line: number; x: number; y: number;
  /** Passengers on board / capacity (null = unknown or no passenger capacity). */
  pax: Load | null;
  /** Cargo items on board / capacity (null = unknown or no cargo capacity). */
  freight: Load | null;
  /** In-game vehicle name ("" when unknown). */
  name: string;
}

export interface LiveStatus {
  t: number;
  enabled: boolean;
  lastCmdSeq: number;
  cmd: { seq: number; ok: boolean; error: string | null } | null;
  jobs: Partial<Record<LiveKind, { ms: number; t: number; ok: boolean; error?: string; warn?: string }>>;
  camera: { x: number; y: number } | null;
  /** Format of the running mod (null = before format 3). */
  format: number | null;
}

type Obj = Record<string, LuaValue>;
const obj = (v: LuaValue | undefined): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: LuaValue | undefined): LuaValue[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);
const num = (v: LuaValue | undefined, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: LuaValue | undefined, d = ""): string => (typeof v === "string" ? v : d);

/** Data file → { t, items } (null if unreadable, e.g. being written). */
export function parseLive(kind: "towns" | "industries" | "stations" | "lines" | "vehicles", text: string): { t: number; items: unknown[] } | null {
  const root = obj(parseUserdata(text) ?? undefined);
  if (!Object.keys(root).length) return null;
  const t = num(root.t);
  switch (kind) {
    case "towns":
      return { t, items: arr(root.towns).map((v): Town => {
        const o = obj(v);
        return { id: num(o.id), name: str(o.name), x: num(o.x), y: num(o.y), size: num(o.size) };
      }) };
    case "industries":
      return { t, items: arr(root.industries).map((v): Industry => {
        const o = obj(v);
        return { id: num(o.id), type: str(o.type), file: str(o.file), level: typeof o.level === "number" ? o.level : null, x: num(o.x), y: num(o.y) };
      }) };
    case "stations":
      return { t, items: arr(root.stations).map((v): Station => {
        const o = obj(v);
        return { id: num(o.id), name: str(o.name), x: num(o.x), y: num(o.y), mode: str(o.mode, "other") as StationMode, cargo: o.cargo === true, passengers: o.passengers === true };
      }) };
    case "lines":
      return { t, items: arr(root.lines).map((v): Line => {
        const o = obj(v);
        const has = typeof o.r === "number";
        return {
          id: num(o.id), name: str(o.name),
          color: has ? [num(o.r), num(o.g), num(o.b)] : null,
          stops: arr(o.stops).map((s) => ({ g: num(obj(s).g), x: num(obj(s).x), y: num(obj(s).y) })),
          vehicles: num(o.vehicles), carrier: typeof o.carrier === "number" ? o.carrier : null,
          mode: str(o.mode, "other") as StationMode,
        };
      }) };
    case "vehicles":
      return { t, items: parseVehicles(str(root.v)) };
  }
}

const load = (n: number | undefined, cap: number | undefined): Load | null =>
  n !== undefined && cap !== undefined && Number.isFinite(n) && Number.isFinite(cap) && n >= 0 && cap > 0 ? { n, cap } : null;

/**
 * live_vehicles "v": format 4 "id,line,x,y,pass,passCap,cargo,cargoCap,name;…" (-1 = unknown);
 * format 3 "id,line,x,y,load,name" (load without capacity) is still read.
 */
export function parseVehicles(s: string): Vehicle[] {
  if (!s) return [];
  const out: Vehicle[] = [];
  for (const part of s.split(";")) {
    const fields = part.split(",");
    const n = fields.map(Number);
    const [id, line, x, y] = n as (number | undefined)[];
    if (![id, line, x, y].every((v) => Number.isFinite(v))) continue;
    const v4 = fields.length >= 9 && n.slice(4, 8).every(Number.isFinite);
    out.push(v4
      ? { id: id!, line: line!, x: x!, y: y!, pax: load(n[4], n[5]), freight: load(n[6], n[7]), name: fields.slice(8).join(",").trim() }
      : { id: id!, line: line!, x: x!, y: y!, pax: null, freight: null, name: (fields[5] ?? "").trim() });
  }
  return out;
}

export interface LiveStats {
  t: number;
  lines: Map<number, LineTraffic>;
  stations: Map<number, StationTraffic>;
}

export function parseStats(text: string): LiveStats | null {
  const root = obj(parseUserdata(text) ?? undefined);
  if (!Object.keys(root).length) return null;
  const lines = new Map<number, LineTraffic>();
  for (const v of arr(root.lines)) {
    const o = obj(v);
    lines.set(num(o.id), { transported: num(o.transported), waitP: num(o.waitP), waitC: num(o.waitC) });
  }
  const stations = new Map<number, StationTraffic>();
  for (const v of arr(root.stations)) {
    const o = obj(v);
    stations.set(num(o.id), { loaded: num(o.loaded), unloaded: num(o.unloaded), waitP: num(o.waitP), waitC: num(o.waitC) });
  }
  return { t: num(root.t), lines, stations };
}

/** Network edge: Hermite curve from its two end positions and tangents (world metres). */
export interface RouteEdge { x0: number; y0: number; tx0: number; ty0: number; x1: number; y1: number; tx1: number; ty1: number }
export interface LiveRoutes {
  t: number;
  edges: Map<number, RouteEdge>;
  /** line → ids of the edges seen on its vehicles' paths + other polylines (lanes, bridges, free legs). */
  lines: Map<number, { edges: number[]; polys: [number, number][][] }>;
}

/** live_routes: edges = "id,x0,y0,tx0,ty0,x1,y1,tx1,ty1;…", lines = {{id, e = "id,id,…"}}. */
export function parseRoutes(text: string): LiveRoutes | null {
  const root = obj(parseUserdata(text) ?? undefined);
  if (!Object.keys(root).length) return null;
  const edges = new Map<number, RouteEdge>();
  for (const part of str(root.edges).split(";")) {
    const n = part.split(",").map(Number);
    if (n.length === 9 && n.every(Number.isFinite)) {
      const [id, x0, y0, tx0, ty0, x1, y1, tx1, ty1] = n as [number, number, number, number, number, number, number, number, number];
      edges.set(id, { x0, y0, tx0, ty0, x1, y1, tx1, ty1 });
    }
  }
  const lines: LiveRoutes["lines"] = new Map();
  for (const v of arr(root.lines)) {
    const o = obj(v);
    const ids = str(o.e).split(",").filter(Boolean).map(Number).filter(Number.isFinite);
    const polys: [number, number][][] = [];
    for (const poly of str(o.p).split("|")) {
      const n = poly.split(",").map(Number);
      const pts: [number, number][] = [];
      for (let i = 0; i + 1 < n.length; i += 2) if (Number.isFinite(n[i]) && Number.isFinite(n[i + 1])) pts.push([n[i]!, n[i + 1]!]);
      if (pts.length >= 2) polys.push(pts);
    }
    lines.set(num(o.id), { edges: ids, polys });
  }
  return { t: num(root.t), edges, lines };
}

export interface LiveStocks {
  t: number;
  industries: Map<number, Stock[]>;
  warehouses: Warehouse[];
  /** cargo type id → display name. */
  cargo: Map<number, string>;
}

const parseStockList = (v: LuaValue | undefined): Stock[] => arr(v).map((x) => {
  const o = obj(x);
  const kind = str(o.kind);
  return { cargo: num(o.cargo), kind: kind === "in" || kind === "out" ? kind : "store", n: num(o.n), cap: num(o.cap) };
});

export function parseStocks(text: string): LiveStocks | null {
  const root = obj(parseUserdata(text) ?? undefined);
  if (!Object.keys(root).length) return null;
  const industries = new Map<number, Stock[]>();
  for (const v of arr(root.industries)) industries.set(num(obj(v).id), parseStockList(obj(v).s));
  const warehouses = arr(root.warehouses).map((v): Warehouse => {
    const o = obj(v);
    return { id: num(o.id), name: str(o.name), x: num(o.x), y: num(o.y), stocks: parseStockList(o.s) };
  });
  const cargo = new Map<number, string>();
  for (const v of arr(root.cargo)) cargo.set(num(obj(v).id), str(obj(v).name));
  return { t: num(root.t), industries, warehouses, cargo };
}

export interface LiveTownAreas {
  t: number;
  /** Grid cell size (m). */
  cell: number;
  towns: Map<number, { cells: [number, number][]; pop: number | null }>;
}

export function parseTownAreas(text: string): LiveTownAreas | null {
  const root = obj(parseUserdata(text) ?? undefined);
  if (!Object.keys(root).length) return null;
  const towns: LiveTownAreas["towns"] = new Map();
  for (const v of arr(root.towns)) {
    const o = obj(v);
    const cells = str(o.cells).split(";").filter(Boolean).map((c) => c.split(",").map(Number) as [number, number])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    towns.set(num(o.id), { cells, pop: typeof o.pop === "number" ? o.pop : null });
  }
  return { t: num(root.t), cell: num(root.cell, 60), towns };
}

/** Logbook series: [game time ms, value]. */
export type Series = [number, number][];
export interface LiveHistory {
  t: number;
  lines: Map<number, Series>;
  stations: Map<number, { loaded: Series; unloaded: Series }>;
}

const parseSeries = (v: LuaValue | undefined): Series =>
  str(v).split(";").filter(Boolean).map((p) => p.split(",").map(Number) as [number, number])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));

export function parseHistory(text: string): LiveHistory | null {
  const root = obj(parseUserdata(text) ?? undefined);
  if (!Object.keys(root).length) return null;
  const lines = new Map<number, Series>();
  for (const v of arr(root.lines)) lines.set(num(obj(v).id), parseSeries(obj(v).tr));
  const stations: LiveHistory["stations"] = new Map();
  for (const v of arr(root.stations)) {
    const o = obj(v);
    stations.set(num(o.id), { loaded: parseSeries(o.ld), unloaded: parseSeries(o.ul) });
  }
  return { t: num(root.t), lines, stations };
}

export function parseStatus(text: string): LiveStatus | null {
  const root = obj(parseUserdata(text) ?? undefined);
  if (!Object.keys(root).length) return null;
  const cmd = obj(root.cmd);
  const cam = obj(root.camera);
  const jobs: LiveStatus["jobs"] = {};
  for (const [k, v] of Object.entries(obj(root.jobs))) {
    const o = obj(v);
    jobs[k as LiveKind] = {
      ms: num(o.ms), t: num(o.t), ok: o.ok === true,
      error: typeof o.error === "string" ? o.error : undefined, warn: typeof o.warn === "string" ? o.warn : undefined,
    };
  }
  return {
    t: num(root.t), enabled: root.enabled === true, lastCmdSeq: num(root.lastCmdSeq),
    cmd: Object.keys(cmd).length ? { seq: num(cmd.seq), ok: cmd.ok === true, error: typeof cmd.error === "string" ? cmd.error : null } : null,
    jobs, camera: Object.keys(cam).length ? { x: num(cam.x), y: num(cam.y) } : null,
    format: typeof root.format === "number" ? root.format : null,
  };
}

/**
 * Commands for the mod: "teleport" moves the camera; "focus" moves it onto an object of the app
 * and, with open, also opens that object's in-game window (kind = Visualiser layer, id = entity).
 */
export type LiveCommand =
  | { seq: number; action: "teleport"; x: number; y: number; dist: number }
  | { seq: number; action: "focus"; x: number; y: number; dist: number; kind: string; id: number; open: boolean };

export interface LiveRequest {
  enabled: boolean;
  /** Seconds between exports per kind (0 = off). */
  intervals: Record<LiveKind, number>;
  cmd: LiveCommand | null;
}

export const DEFAULT_INTERVALS: Record<LiveKind, number> = {
  towns: 30, industries: 30, stations: 15, lines: 10, vehicles: 2, stats: 30, routes: 20, stocks: 30, townAreas: 120, history: 120,
};

/**
 * Smallest useful cadence per kind (s; 0 still disables). The mod clock ticks in whole seconds, so
 * nothing goes faster than 1 s; big files (lines, routes) are not worth rewriting more often.
 */
export const MIN_INTERVALS: Record<LiveKind, number> = {
  vehicles: 1, lines: 5, stations: 5, stats: 5, routes: 10, stocks: 10, towns: 10, industries: 10, townAreas: 60, history: 60,
};

export const clampInterval = (kind: LiveKind, v: number) => (v <= 0 ? 0 : Math.max(MIN_INTERVALS[kind], Math.round(v)));

/** live_request.lua (read by the mod with app.loadUserdata). */
export function renderRequest(r: LiveRequest): string {
  return toUserdata({
    enabled: r.enabled,
    intervals: { ...r.intervals },
    ...(r.cmd ? { cmd: { ...r.cmd } } : {}),
  });
}
