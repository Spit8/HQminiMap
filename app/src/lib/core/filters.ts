/**
 * Visualiser filters over the live game data: layer switches, name search, per-type criteria and
 * individually hidden objects. Pure and serialisable (filter configurations are saved as JSON).
 */
import type { Industry, Line, Station, StationMode, Stock, Town, Vehicle, Warehouse } from "./live";

export const LAYERS = ["towns", "industries", "warehouses", "stations", "lines", "vehicles"] as const;
export type LayerId = (typeof LAYERS)[number];
export const STATION_MODES: StationMode[] = ["rail", "road", "tram", "water", "air", "other"];

export interface FilterState {
  version: 1;
  layers: Record<LayerId, boolean>;
  /** Case/accent-insensitive name filter (towns, industries, stations, lines). */
  search: string;
  townMinSize: number;
  /** Industry types shown; null = all. */
  industryTypes: string[] | null;
  stationModes: StationMode[];
  stationKind: "all" | "cargo" | "passengers";
  /** Minimum traffic of a station (loaded + unloaded per year). */
  stationMinTraffic: number;
  /** Lines shown; null = all. */
  lineIds: number[] | null;
  lineModes: StationMode[];
  /** Minimum transported per year on a line. */
  lineMinTransported: number;
  /** Lines without vehicles or with fewer than 2 stops (hidden by default). */
  showInactiveLines: boolean;
  /** Vehicles only on the shown lines (else all vehicles). */
  vehiclesFollowLines: boolean;
  /** Labels per layer (names, stocks, loads, waiting / traffic); only on the objects shown. */
  labels: Record<LayerId, boolean>;
  /** Minimum total stock of an industry / warehouse. */
  stockMin: number;
  /** Individually hidden objects: "<layer>:<id>". */
  hidden: string[];
  /** Relief of the heightmap, as colours by altitude and / or contour lines. */
  relief: Relief;
  /** Ortho image shown; off: black background, water and map outline only. */
  basemap: boolean;
}

export type ReliefMode = "colors" | "lines" | "both";
export const RELIEF_MODES: ReliefMode[] = ["colors", "lines", "both"];
/** Altitude → colour scale: equalised histogram (each colour covers as much ground), linear, √, log. */
export type ReliefScale = "equalize" | "linear" | "sqrt" | "log";
export const RELIEF_SCALES: ReliefScale[] = ["equalize", "linear", "sqrt", "log"];

export interface Relief {
  show: boolean;
  mode: ReliefMode;
  /** Contour interval in m, 0 = automatic. */
  step: number;
  /** Contour line width factor (0.5–3). */
  width: number;
  /** Altitudes along the index contours. */
  labels: boolean;
  /** Colour stops from the lowest to the highest ground (2–6), each with its own opacity. */
  stops: ReliefStop[];
  /** Overall opacity of the colour layer (0.1–1), multiplying the stops' own. */
  opacity: number;
  scale: ReliefScale;
  /** Shifts the colours towards the low (< 0) or the high (> 0) colour, −1…1. */
  balance: number;
}

export interface ReliefStop {
  /** #rrggbb */
  color: string;
  /** 0–1: dark colours need more (black barely shows when half transparent). */
  alpha: number;
}

/** Default relief colours: green, (yellow), red, violet, black; more opaque towards the dark end. */
export const RELIEF_STOPS: ReliefStop[] = [
  { color: "#3cb44b", alpha: 0.45 }, { color: "#e04040", alpha: 0.55 }, { color: "#8e44c8", alpha: 0.7 }, { color: "#000000", alpha: 0.85 },
];
export const RELIEF_STOPS_MAX = 6;

/** Contour intervals offered (m); 0 = automatic. */
export const CONTOUR_STEPS = [0, 5, 10, 25, 50, 100];

export const DEFAULT_FILTERS: FilterState = {
  version: 1,
  layers: { towns: true, industries: true, warehouses: true, stations: true, lines: true, vehicles: true },
  search: "",
  townMinSize: 0,
  industryTypes: null,
  stationModes: [...STATION_MODES],
  stationKind: "all",
  stationMinTraffic: 0,
  lineIds: null,
  lineModes: [...STATION_MODES],
  lineMinTransported: 0,
  showInactiveLines: false,
  vehiclesFollowLines: true,
  labels: { towns: true, industries: false, warehouses: false, stations: true, lines: false, vehicles: false },
  stockMin: 0,
  hidden: [],
  basemap: true,
  relief: { show: true, mode: "lines", step: 0, width: 1, labels: false, stops: RELIEF_STOPS.map((s) => ({ ...s })), opacity: 1, scale: "equalize", balance: 0 },
};

export interface LiveData {
  towns: Town[];
  industries: Industry[];
  warehouses: Warehouse[];
  stations: Station[];
  lines: Line[];
  vehicles: Vehicle[];
}

/** Lower-case, accents removed (search). */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export const hiddenKey = (layer: LayerId, id: number) => `${layer}:${id}`;

/** Readable industry name from its type tag: "coal_mine" → "Coal mine". */
export function industryLabel(type: string): string {
  const s = type.replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "?";
}

/** A line that carries nothing: no vehicle, or fewer than 2 stops. */
export const isInactive = (l: Line) => l.vehicles === 0 || l.stops.length < 2;

/** Total items in stock (0 until live_stocks is read). */
export const stockTotal = (stocks: Stock[] | undefined) => (stocks ?? []).reduce((a, s) => a + s.n, 0);

/** Loaded + unloaded per year (0 until live_stats is read). */
export const stationTraffic = (s: Station) => (s.traffic ? s.traffic.loaded + s.traffic.unloaded : 0);

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Valid colour stops. Earlier settings: a list of colours with one overall opacity (each stop takes
 * that opacity, the overall one goes to 1), or two colours low / high (kept as the stops if changed).
 */
function normalizeRelief(saved: Partial<Relief> & { low?: string; high?: string; colors?: string[] }): Relief {
  const { low, high, colors, ...rest } = saved;
  const r = { ...DEFAULT_FILTERS.relief, ...rest, stops: saved.stops };
  const clamp01 = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
  let stops = Array.isArray(r.stops)
    ? r.stops.filter((s) => s && HEX.test(s.color)).map((s) => ({ color: s.color, alpha: clamp01(s.alpha, 0.6) }))
    : [];
  let opacity = clamp01(r.opacity, 1);
  if (!stops.length) {
    const old = Array.isArray(colors) ? colors.filter((c) => HEX.test(c))
      : low && high && HEX.test(low) && HEX.test(high) && !(low === "#3cb44b" && high === "#e04040") ? [low, high] : [];
    if (old.length >= 2) {
      stops = old.map((color) => ({ color, alpha: opacity }));
      opacity = 1;
    }
  }
  stops = stops.slice(0, RELIEF_STOPS_MAX);
  return { ...r, stops: stops.length >= 2 ? stops : RELIEF_STOPS.map((s) => ({ ...s })), opacity: Math.max(0.1, opacity) };
}

/** Fill missing fields (configurations saved by older versions). */
export function normalizeFilters(f: Partial<FilterState> | null | undefined): FilterState {
  const base = structuredClone(DEFAULT_FILTERS);
  if (!f) return base;
  // Older configurations had a single "traffic labels" switch for stations.
  const legacyTraffic = (f as { showTraffic?: boolean }).showTraffic;
  const labels = { ...base.labels, ...(legacyTraffic ? { stations: true } : {}), ...(f.labels ?? {}) };
  // The relief was "contours" (lines only) before the colours.
  const { showTraffic: _drop, contours: oldRelief, ...rest } = f as Partial<FilterState> & { showTraffic?: boolean; contours?: Partial<Relief> };
  return { ...base, ...rest, version: 1, layers: { ...base.layers, ...(f.layers ?? {}) }, labels,
    relief: normalizeRelief({ ...(oldRelief ?? {}), ...(f.relief ?? {}) }) };
}

/** Objects to draw for this filter state. */
export function applyFilters(d: LiveData, f: FilterState): LiveData {
  const hidden = new Set(f.hidden);
  const q = fold(f.search.trim());
  const match = (name: string) => !q || fold(name).includes(q);
  const shown = (layer: LayerId, id: number) => f.layers[layer] && !hidden.has(hiddenKey(layer, id));

  const towns = d.towns.filter((t) => shown("towns", t.id) && t.size >= f.townMinSize && match(t.name));
  const types = f.industryTypes ? new Set(f.industryTypes) : null;
  const industries = d.industries.filter((i) =>
    shown("industries", i.id) && (!types || types.has(i.type)) && match(industryLabel(i.type)) &&
    stockTotal(i.stocks) >= f.stockMin);
  const warehouses = d.warehouses.filter((w) => shown("warehouses", w.id) && match(w.name) && stockTotal(w.stocks) >= f.stockMin);
  const modes = new Set(f.stationModes);
  const stations = d.stations.filter((s) =>
    shown("stations", s.id) && modes.has(s.mode) && match(s.name) &&
    (f.stationKind === "all" || (f.stationKind === "cargo" ? s.cargo : s.passengers)) &&
    stationTraffic(s) >= f.stationMinTraffic);
  const lineSet = f.lineIds ? new Set(f.lineIds) : null;
  const lineModes = new Set(f.lineModes);
  const lineKept = (l: Line) => (!lineSet || lineSet.has(l.id)) && lineModes.has(l.mode) && (f.showInactiveLines || !isInactive(l)) &&
    (l.traffic?.transported ?? 0) >= f.lineMinTransported;
  const lines = d.lines.filter((l) => shown("lines", l.id) && lineKept(l) && match(l.name));
  // Vehicles follow the line selection (not the search) so a searched line keeps its vehicles.
  const lineVisible = new Set(d.lines.filter((l) => lineKept(l) && !hidden.has(hiddenKey("lines", l.id))).map((l) => l.id));
  const vehicles = d.vehicles.filter((v) => shown("vehicles", v.id) && (!f.vehiclesFollowLines || lineVisible.has(v.line)));
  return { towns, industries, warehouses, stations, lines, vehicles };
}
