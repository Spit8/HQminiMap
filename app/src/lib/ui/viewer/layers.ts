/**
 * OpenLayers vector layers for the live game data. Map coordinates are the ortho image frame in
 * metres: x = world Y − minY (columns), y = −(world X − minX) (rows, downwards).
 */
import Feature from "ol/Feature";
import MultiLineString from "ol/geom/MultiLineString";
import MultiPoint from "ol/geom/MultiPoint";
import MultiPolygon from "ol/geom/MultiPolygon";
import Point from "ol/geom/Point";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Circle, Fill, Icon, RegularShape, Stroke, Style, Text } from "ol/style";
import type { Extent } from "ol/extent";
import type { FeatureLike } from "ol/Feature";
import { industryLabel, LAYERS, stationTraffic, stockTotal, type LayerId, type LiveData } from "$lib/core/filters";
import type { Line, StationMode, Stock, Vehicle } from "$lib/core/live";
import { laneLayout, stopLegs, type Pt, type RouteParts } from "$lib/core/routes";
import { inkOn, iconUri, loadBadge, LOAD_ICON, stopGlyph, type BadgePart, type IconOpts } from "./icons";
import LineString from "ol/geom/LineString";

/**
 * The i-th of k stripes of a polyline: its dashes, `dash` long every k·dash, positioned by the
 * distance along the edge at each point (`arc`), not along the drawn (offset) line, so the stripes of
 * all the lines sharing an edge line up.
 */
export function stripes(pts: Pt[], arc: number[], dash: number, k: number, i: number): Pt[][] {
  const out: Pt[][] = [];
  if (pts.length < 2 || arc.length !== pts.length || !(dash > 0)) return out;
  const period = k * dash, start = arc[0]!, end = arc[arc.length - 1]!;
  /** Point at distance t along the edge. */
  const at = (t: number): Pt => {
    let q = 1;
    while (q < arc.length - 1 && arc[q]! < t) q++;
    const a = arc[q - 1]!, b = arc[q]!, u = b > a ? Math.min(1, Math.max(0, (t - a) / (b - a))) : 0;
    const p = pts[q - 1]!, r = pts[q]!;
    return [p[0] + (r[0] - p[0]) * u, p[1] + (r[1] - p[1]) * u];
  };
  for (let a = Math.floor(start / period) * period + i * dash; a < end; a += period) {
    const lo = Math.max(a, start), hi = Math.min(a + dash, end);
    if (hi <= lo) continue;
    const d: Pt[] = [at(lo)];
    for (let q = 0; q < arc.length; q++) if (arc[q]! > lo && arc[q]! < hi) d.push(pts[q]!);
    d.push(at(hi));
    out.push(d);
  }
  return out;
}

export interface Frame {
  minX: number;
  minY: number;
}

export const toMap = (f: Frame, x: number, y: number): [number, number] => [y - f.minY, -(x - f.minX)];
export const toWorld = (f: Frame, cx: number, cy: number) => ({ x: f.minX - cy, y: f.minY + cx });

/** Properties stored on every feature (selection card). */
export interface FeatureInfo {
  layer: LayerId;
  id: number;
  name: string;
  x: number;
  y: number;
  details: Record<string, string | number>;
  /** Vehicles: their line (card button "show the line"). */
  lineId?: number;
}

export const MODE_COLOR: Record<StationMode, string> = {
  rail: "#e2574c", road: "#f2a33a", tram: "#c86dd7", water: "#3fa7e0", air: "#9ad06b", other: "#9aa3ad",
};
export const WAREHOUSE_COLOR = "#6b7686";
/** Stop served by no shown line. */
export const STOP_NO_LINE = "#8a929e";

export const rgb = (c: [number, number, number] | null, a = 1) =>
  c ? `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})` : `rgba(200,200,200,${a})`;

/** Stable colour per industry type. */
export function typeColor(type: string): string {
  let h = 0;
  for (const ch of type) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 60%, 48%)`;
}

const halo = new Stroke({ color: "rgba(10,12,16,.85)", width: 3 });
const dark = new Stroke({ color: "#14171c", width: 1.2 });
export const fmtK = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Resolution (m/px) under which each layer's labels appear (zoomed in enough). */
const LABEL_RES: Record<LayerId, number> = { towns: 80, industries: 25, warehouses: 25, stations: 60, lines: 12, vehicles: 6 };
/** Station figures (waiting · per year) only closer than this. */
const FIGURES_RES = 15;

const label = (text: string, offsetY: number, size = 11, weight = 400, offsetX = 0) =>
  new Text({ text, font: `${weight} ${size}px system-ui, sans-serif`, offsetY, offsetX, padding: [1, 2, 1, 2],
    fill: new Fill({ color: "#eef1f5" }), stroke: halo, textAlign: offsetX ? "left" : "center" });

const ringStyles = new Map<string, Style[]>();
/** Selection ring in the object's own colour, with a white edge to stay readable. */
function ringStyle(color: string, radius = 12): Style[] {
  const key = `${color}|${radius}`;
  let s = ringStyles.get(key);
  if (!s) {
    s = [
      new Style({ image: new Circle({ radius, stroke: new Stroke({ color: "rgba(255,255,255,.9)", width: 5 }) }) }),
      new Style({ image: new Circle({ radius, stroke: new Stroke({ color, width: 3 }) }) }),
    ];
    ringStyles.set(key, s);
    if (ringStyles.size > 500) ringStyles.delete(ringStyles.keys().next().value!); // bounded: oldest out
  }
  return s;
}

const iconStyles = new Map<string, Icon>();
/** Pictogram style, cached. Icons are never hidden by decluttering: only labels give way. */
function icon(glyph: Parameters<typeof iconUri>[0], color: string, o: IconOpts & { size: number }): Icon {
  const key = `${glyph}|${color}|${o.size}|${o.ring}|${o.shape}|${o.corner}|${o.double}|${o.stripes?.join(";") ?? ""}`;
  let i = iconStyles.get(key);
  if (!i) {
    i = new Icon({ src: iconUri(glyph, color, o), width: o.size, height: o.size, declutterMode: "obstacle" });
    iconStyles.set(key, i);
    if (iconStyles.size > 2000) iconStyles.delete(iconStyles.keys().next().value!); // bounded: oldest out
  }
  return i;
}

/** "🧑 12/40 · 📦 3/10": passengers and cargo on board / capacity (colour pictograms, readable on dark). */
export function loadText(v: Pick<Vehicle, "pax" | "freight">): string {
  return [v.pax ? `${LOAD_ICON.pax} ${v.pax.n}/${v.pax.cap}` : "", v.freight ? `${LOAD_ICON.freight} ${v.freight.n}/${v.freight.cap}` : ""]
    .filter(Boolean).join(" · ");
}

/** Badges show from this resolution (m/px) down: not on the whole-map view. */
const BADGE_RES = 40;

export interface Labels {
  /** Name of the town nearest to (x, y) (industries have no name of their own). */
  industryNear: (x: number, y: number) => string;
  lineName: (id: number) => string;
  lineMode: (id: number) => StationMode;
  /** Translated label of a detail value (modes, uses, stock kinds) or unit ("perYear"). */
  value: (key: string, v: string) => string;
  cargoName: (id: number) => string;
}

export interface LiveOptions {
  labels: Record<LayerId, boolean>;
  /** Duration of a vehicle's glide to its new position (≈ the interval between updates). */
  glideMs: number;
  /** Options → Map: pictogram and label size factors, width and opacity of the line tracks. */
  iconScale: number;
  textScale: number;
  lineWidth: number;
  lineOpacity: number;
  /** Load badges on the vehicle pictograms. */
  vehicleBadge: "none" | "pax" | "freight" | "both";
  /** Performance caps (state/perf): street lines as one plain track; lines drawn on their track at most. */
  plainLines?: boolean;
  maxTrackedLines?: number;
  /** Vehicles jump to where they are now, no glide (the map was not updated for a while). */
  snap?: boolean;
}

/** Short stock summary: "Coal 120 → Steel 40" (inputs → outputs), storage as "Goods 250 · Coal 30". */
export function stockSummary(stocks: Stock[] | undefined, cargoName: (id: number) => string): string {
  if (!stocks?.length) return "";
  const fmt = (list: Stock[]) => list.filter((s) => s.n > 0 || list.length <= 2).slice(0, 2)
    .map((s) => `${cargoName(s.cargo)} ${fmtK(s.n)}`).join(" · ");
  const ins = stocks.filter((s) => s.kind === "in"), outs = stocks.filter((s) => s.kind === "out");
  const store = stocks.filter((s) => s.kind === "store");
  if (store.length) return fmt([...store].sort((a, b) => b.n - a.n));
  return [fmt(ins), fmt(outs)].filter(Boolean).join(" → ");
}

export type TownAreas = Map<number, { rings: Pt[][]; pop: number | null }>;

export interface LiveLayers {
  layers: VectorLayer[];
  /**
   * Bring the features up to date with the filtered data: each group (towns, industries, warehouses,
   * stations, lines and their lanes, vehicles) is rebuilt only when its own inputs changed;
   * vehicles are updated in place. Returns the time spent laying out the lanes (ms, 0 if reused).
   */
  update(frame: Frame, data: LiveData, routes: Map<number, Pt[][]>, parts: RouteParts | null, trails: Map<number, Pt[][]>,
    fills: Map<number, Pt[][]>, areas: TownAreas,
    labels: Labels, opts: LiveOptions, towns: readonly object[], locale: string): { layoutMs: number };
  /** Features drawn on the map (all live layers). */
  count(): number;
  /** Move vehicles along their current glide (from where they were drawn to their latest position). */
  animate(frame: Frame, nowMs: number): void;
  setSelected(key: string | null): void;
  /** Current info of a feature ("<layer>:<id>"), null if not drawn. */
  infoOf(key: string): FeatureInfo | null;
  extentOf(key: string): Extent | null;
}

export function createLiveLayers(): LiveLayers {
  const src = Object.fromEntries(LAYERS.map((l) => [l, new VectorSource()])) as Record<LayerId, VectorSource>;
  /** Town outlines: lowest layer, so that objects inside stay clickable. */
  const areaSrc = new VectorSource();
  const selection = new VectorSource();
  /** The selected line and its vehicles, drawn again above every other layer (same features). */
  const frontLines = new VectorSource();
  const frontVehicles = new VectorSource();
  let selectedKey: string | null = null;
  let selectedLine: number | null = null;
  let opts: LiveOptions = {
    labels: { towns: true, industries: false, warehouses: false, stations: true, lines: false, vehicles: false }, glideMs: 2000,
    iconScale: 1, textScale: 1, lineWidth: 1, lineOpacity: 0.75, vehicleBadge: "none",
  };
  /** Style fields that restyle every layer without rebuilding features. */
  const styleSig = (o: LiveOptions) =>
    [o.iconScale, o.textScale, o.lineWidth, o.lineOpacity, o.vehicleBadge, ...LAYERS.map((l) => (o.labels[l] ? 1 : 0))].join("|");
  let prevStyle = styleSig(opts);
  /** Track width (px) at this resolution: Options factor, and thicker when zoomed in close (< 6 m/px). */
  const lw = (px: number, res: number) => px * opts.lineWidth * (res < 6 ? Math.min(1.6, 1 + 0.2 * Math.log2(6 / res)) : 1);
  /** Sizes scaled by Options → Map. */
  const isz = (px: number) => Math.round(px * opts.iconScale);
  const lbl = (text: string, offsetY: number, size = 11, weight = 400, offsetX = 0) =>
    label(text, offsetY * opts.textScale, size * opts.textScale, weight, offsetX * opts.iconScale);
  /** Line names: one label per name (two-way lines), busiest lines first (declutter priority). */
  const lineLabelSrc = new VectorSource();
  /** Drawn position of each vehicle (world) and its current glide. */
  const drawn = new Map<number, { x: number; y: number }>();
  const glides = new Map<number, { fx: number; fy: number; tx: number; ty: number; t0: number; dur: number }>();
  /** A jump longer than this (m) is not animated (new vehicle, depot, teleport). */
  const SNAP_M = 2000;
  let vehicleFeatures = new Map<number, Feature>();
  const byKey = new Map<string, Feature>();
  const showLabel = (layer: LayerId, res: number) => opts.labels[layer] && res < LABEL_RES[layer];

  const townStyle = (f: FeatureLike, res: number) => {
    const size = f.get("size") as number;
    const px = Math.max(11, Math.min(20, 10 + Math.sqrt(size) / 2.5)) * opts.textScale;
    const area = f.get("hasArea") as boolean;
    return new Style({
      image: area ? undefined : new Circle({ radius: 4 * opts.iconScale, fill: new Fill({ color: "#fff" }), stroke: new Stroke({ color: "#222", width: 1.5 }) }),
      // Background name: light, under every other object and label (they are drawn on top).
      text: showLabel("towns", res) ? new Text({
        text: f.get("name"), font: `600 ${px}px system-ui, sans-serif`, offsetY: area ? 0 : -px,
        fill: new Fill({ color: "rgba(255,255,255,.7)" }), stroke: new Stroke({ color: "rgba(10,12,16,.55)", width: 2.5 }),
      }) : undefined,
    });
  };

  const areaStyle = (f: FeatureLike) => new Style({
    fill: new Fill({ color: selectedKey === f.get("key") ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.06)" }),
    stroke: new Stroke({ color: selectedKey === f.get("key") ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.55)",
      width: selectedKey === f.get("key") ? 2.5 : 1.2 }),
  });

  const industryStyle = (f: FeatureLike, res: number) => new Style({
    image: icon("factory", typeColor(f.get("type")), { size: isz(17), shape: "square" }),
    text: showLabel("industries", res) && f.get("stockLabel") ? lbl(f.get("stockLabel"), -15 * opts.iconScale / opts.textScale, 10.5) : undefined,
  });

  const warehouseStyle = (f: FeatureLike, res: number) => new Style({
    image: icon("warehouse", WAREHOUSE_COLOR, { size: isz(17), shape: "square" }),
    text: showLabel("warehouses", res) ? lbl(f.get("stockLabel") || f.get("name"), -15 * opts.iconScale / opts.textScale, 10.5) : undefined,
  });

  // Stations and stops: stop pictogram of the mode (vehicles have their own) on a rounded square in
  // the colour of the line(s) serving it (bands when several), sized by traffic; cargo stations have
  // a marked corner, mixed ones a second outline. Name when labels are on, figures when zoomed in.
  const stationStyle = (f: FeatureLike, res: number) => {
    const mode = f.get("mode") as StationMode;
    const size = isz(14 + Math.min(6, Math.log10(1 + (f.get("traffic") as number)) * 1.3));
    const cargo = f.get("cargo") as boolean, passengers = f.get("passengers") as boolean;
    let text: Text | undefined;
    if (showLabel("stations", res)) {
      const figures = res < FIGURES_RES ? (f.get("figures") as string) : "";
      text = label(figures ? `${f.get("name")}\n${figures}` : f.get("name"), -size / 2 - (figures ? 14 : 8) * opts.textScale,
        11 * opts.textScale);
    }
    return new Style({
      image: icon(stopGlyph(mode), (f.get("colors") as string[])[0] ?? STOP_NO_LINE, {
        size, shape: "square", corner: cargo && !passengers, double: cargo && passengers, stripes: f.get("colors"),
      }),
      text,
    });
  };

  // A selected line gets a halo in its own colour; the other lines are dimmed. Approximate pieces
  // are dashed (straight legs between stops) or dotted (boat trails).
  const lineStyle = (f: FeatureLike, res: number) => {
    const sel = selectedLine === f.get("lineId");
    const dim = selectedLine !== null && !sel;
    const kind = f.get("approx") as "" | "legs" | "trail" | "fill" | "stroke" | "joint";
    if (kind === "stroke") return strokeStyle(f, res);
    if (kind === "joint") return jointStyle(f, res);
    // Opacity from Options → Map; a selected line is opaque.
    const alpha = sel ? 1 : dim ? 0.25 * opts.lineOpacity : opts.lineOpacity;
    // A routed line's network edges are drawn as edge strokes: here only its halo (whole track)
    // and its own pieces (station lanes, bridges, free legs).
    const halo = sel ? new Style({ geometry: f.get("full") ?? undefined, stroke: new Stroke({ color: rgb(f.get("color"), 0.35), width: lw(13, res) }), zIndex: 2 }) : null;
    if (f.get("strokesOnly")) return halo ? [halo] : [];
    if (kind === "fill") {
      // Gap filled from the vehicles' trails: thin solid line in the line's colour, not selectable.
      return new Style({ stroke: new Stroke({ color: rgb(f.get("color"), alpha * 0.85), width: lw(sel ? 3.5 : 2, res) }), zIndex: sel ? 3 : 1 });
    }
    const k = lw(1, res);
    const dash = kind === "legs" ? [8 * k, 6 * k] : kind === "trail" ? [2 * k, 5 * k] : undefined;
    const main = new Style({
      stroke: new Stroke({ color: rgb(f.get("color"), alpha), width: (sel ? 5 : kind === "trail" ? 2 : 3) * k, lineDash: dash }),
      zIndex: sel ? 3 : 1,
    });
    return halo ? [halo, main] : main;
  };

  /** Feature of the selected line: its track, gap fills, or an edge stroke it runs on. */
  const onSelectedLine = (f: FeatureLike) => selectedLine !== null && (f.get("lineId") === selectedLine
    || ((f.get("approx") === "stroke" || f.get("approx") === "joint") && (f.get("lines") as number[]).includes(selectedLine)));
  /** Lines layer (front = false) or the front copy (true): each feature is drawn by one of them only. */
  const linesStyle = (front: boolean) => (f: FeatureLike, res: number) => (onSelectedLine(f) === front ? lineStyle(f, res) : []);

  /** Dash length (px, at line width 1) of shared strokes: each line of a shared stretch takes one dash in turn. */
  const DASH = 10;

  // Lane piece of a line (laneLayout): its own lane (solid), or a lane shared with others in stripes
  // (k lines, this one the i-th dash); `lanes`: offset of each point in lane widths, to the right of
  // the direction of travel. Lane width = a stroke + a 3 px gap, at every zoom and line width.
  const strokeStyle = (f: FeatureLike, res: number) => {
    const color = (f.get("colors") as string[])[0]!;
    const lanes = f.get("lanes") as number[];
    const k = f.get("k") as number, i = f.get("i") as number;
    const width = lw(3, res), dashLen = DASH * width / 3;
    let geometry: LineString | undefined;
    if (lanes.some((v) => v)) {
      const step = width + 3;
      const cached = f.get("offset") as { res: number; step: number; g: LineString } | undefined;
      if (cached?.res === res && cached.step === step) geometry = cached.g;
      else {
        // Normals of the whole track (map frame): consecutive pieces meet exactly.
        const pts = (f.getGeometry() as LineString).getCoordinates() as Pt[], nrm = f.get("nrm") as Pt[];
        geometry = new LineString(pts.map(([x, y], q) => {
          const d = lanes[q]! * step * res;
          return [x + nrm[q]![0] * d, y + nrm[q]![1] * d];
        }));
        (f as Feature).set("offset", { res, step, g: geometry }, true);
      }
    }
    if (selectedLine !== null && (f.get("lines") as number[]).includes(selectedLine)) {
      return new Style({ geometry, stroke: new Stroke({ color, width: lw(5, res) }), zIndex: 3 });
    }
    const alpha = selectedLine !== null ? 0.25 * opts.lineOpacity : opts.lineOpacity;
    const c = color.replace(/rgba\(([^)]*),\s*[\d.]+\)/, `rgba($1,${alpha})`);
    if (k <= 1) return new Style({ geometry, stroke: new Stroke({ color: c, width }), zIndex: 1 });
    // Stripes: this line's dashes, measured along the edge (arc), the same for every line on it.
    const cachedDash = f.get("dashes") as { res: number; dashLen: number; base: LineString | undefined; g: MultiLineString } | undefined;
    let dashes = cachedDash?.res === res && cachedDash.dashLen === dashLen && cachedDash.base === geometry ? cachedDash.g : undefined;
    if (!dashes) {
      const pts = (geometry ?? (f.getGeometry() as LineString)).getCoordinates() as Pt[];
      dashes = new MultiLineString(stripes(pts, f.get("arc") as number[], dashLen * res, k, i));
      (f as Feature).set("dashes", { res, dashLen, base: geometry, g: dashes }, true);
    }
    return new Style({ geometry: dashes, stroke: new Stroke({ color: c, width, lineCap: "butt" }), zIndex: 1 });
  };

  // Joint between two tracks of a line (branch, detour, gap in the data): a short curve from the end
  // of one lane to the start of the other, in the line's colour, solid.
  const jointStyle = (f: FeatureLike, res: number) => {
    const color = (f.get("colors") as string[])[0]!;
    const width = lw(3, res), step = width + 3;
    const cached = f.get("curve") as { res: number; step: number; g: LineString } | undefined;
    let geometry = cached?.res === res && cached.step === step ? cached.g : undefined;
    if (!geometry) {
      type End = { p: Pt; n: Pt; lane: number; dir: Pt };
      const at = (e: End): Pt => [e.p[0] + e.n[0] * e.lane * step * res, e.p[1] + e.n[1] * e.lane * step * res];
      const a = f.get("a") as End, b = f.get("b") as End, A = at(a), B = at(b);
      // Shorter handles where an end points away from the other one: no loop.
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, ux = (B[0] - A[0]) / len, uy = (B[1] - A[1]) / len;
      const ha = (len / 3) * Math.max(0.15, a.dir[0] * ux + a.dir[1] * uy);
      const hb = (len / 3) * Math.max(0.15, b.dir[0] * ux + b.dir[1] * uy);
      const c1: Pt = [A[0] + a.dir[0] * ha, A[1] + a.dir[1] * ha], c2: Pt = [B[0] - b.dir[0] * hb, B[1] - b.dir[1] * hb];
      const pts: Pt[] = [];
      for (let q = 0; q <= 8; q++) {
        const t = q / 8, u = 1 - t;
        pts.push([u * u * u * A[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * B[0],
          u * u * u * A[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * B[1]]);
      }
      geometry = new LineString(pts);
      (f as Feature).set("curve", { res, step, g: geometry }, true);
    }
    const sel = selectedLine !== null && (f.get("lines") as number[]).includes(selectedLine);
    const alpha = sel ? 1 : selectedLine !== null ? 0.25 * opts.lineOpacity : opts.lineOpacity;
    const c = color.replace(/rgba\(([^)]*),\s*[\d.]+\)/, `rgba($1,${alpha})`);
    return new Style({ geometry, stroke: new Stroke({ color: c, width: sel ? lw(5, res) : width }), zIndex: sel ? 3 : 1 });
  };

  // Vehicle: mode pictogram on a disc of its line's colour. Those of the selected line are bigger,
  // with bigger labels and badges, in the front layer.
  /** Styles shared between features that look the same; the oldest dropped past STYLE_CACHE_MAX. */
  const STYLE_CACHE_MAX = 4000;
  const styleCache = new Map<string, Style>();
  const cachedStyle = (key: string, make: () => Style): Style => {
    let st = styleCache.get(key);
    if (!st) {
      st = make();
      styleCache.set(key, st);
      if (styleCache.size > STYLE_CACHE_MAX) styleCache.delete(styleCache.keys().next().value!);
    }
    return st;
  };
  const vehicleStyle = (f: FeatureLike, res: number) => {
    const big = selectedLine !== null && f.get("line") === selectedLine;
    // Name only: the load is in its badge (and in the tooltip and the card).
    const text = showLabel("vehicles", res) ? (f.get("vname") as string) || "" : "";
    const size = isz(big ? 20 : 15);
    const fs = big ? 12.5 : 10, weight = big ? 700 : 600;
    // Shared by every vehicle that looks the same (styles are asked for at each animation frame).
    const main = cachedStyle(`v|${f.get("mode")}|${rgb(f.get("color"))}|${size}|${+big}|${text}|${opts.vehicleBadge !== "none"}|${opts.textScale}|${opts.iconScale}`,
      () => new Style({
        image: icon(f.get("mode"), rgb(f.get("color")), { size, ring: big ? "#ffffff" : undefined }),
        // With badges, the label moves below the icon (badges take its right side).
        text: text ? (opts.vehicleBadge !== "none" ? lbl(text, size * 0.75 / opts.textScale + 6 + (big ? 2 : 0), fs, weight)
          : lbl(text, 0, fs, weight, big ? 13 : 10)) : undefined,
        zIndex: big ? 2 : 1,
      }));
    if (opts.vehicleBadge === "none" || res >= BADGE_RES) return main;
    // Load badge right of the icon: one frame in the line's colour, passengers and / or cargo inside.
    type Load = { n: number; cap: number } | null;
    const pax = f.get("pax") as Load, freight = f.get("freight") as Load;
    const parts: BadgePart[] = [
      ...(opts.vehicleBadge !== "freight" && pax ? [{ kind: "pax" as const, text: `${fmtK(pax.n)}/${fmtK(pax.cap)}` }] : []),
      ...(opts.vehicleBadge !== "pax" && freight ? [{ kind: "freight" as const, text: `${fmtK(freight.n)}/${fmtK(freight.cap)}` }] : []),
    ];
    if (!parts.length) return main;
    const badge = badgeIcon(rgb(f.get("color")), parts, size, big ? 1.3 : 1);
    return [main, cachedStyle(`b|${badge.getSrc()}|${size}|${+big}`, () => new Style({ image: badge, zIndex: big ? 3 : 2 }))];
  };
  const vehiclesStyle = (front: boolean) => (f: FeatureLike, res: number) =>
    ((selectedLine !== null && f.get("line") === selectedLine) === front ? vehicleStyle(f, res) : []);

  const badgeIcons = new Map<string, Icon>();
  const badgeIcon = (border: string, parts: BadgePart[], size: number, grow = 1): Icon => {
    const b = loadBadge(border, parts, opts.textScale * grow);
    const key = `${b.uri}|${size}`;
    let i = badgeIcons.get(key);
    if (!i) {
      i = new Icon({ src: b.uri, width: b.width, height: b.height, anchor: [0, 0.5], displacement: [size / 2 + 2, 0] });
      if (badgeIcons.size > 2000) badgeIcons.clear();
      badgeIcons.set(key, i);
    }
    return i;
  };

  const mk = (layer: LayerId, style: (f: FeatureLike, res: number) => Style | Style[], z: number, declutter = false) =>
    new VectorLayer({ source: src[layer], style, zIndex: z, declutter, properties: { liveLayer: layer } });

  const layers = [
    new VectorLayer({ source: areaSrc, style: areaStyle, zIndex: 5, properties: { liveLayer: "towns" } }),
    mk("lines", linesStyle(false), 10),
    // Line names along their track: decluttered, one per name, busiest first.
    new VectorLayer({
      source: lineLabelSrc, zIndex: 10.5, declutter: true,
      style: (f, res) => (showLabel("lines", res) ? new Style({
        text: new Text({
          text: f.get("name"), placement: "line", font: `600 ${11 * opts.textScale}px system-ui, sans-serif`,
          fill: new Fill({ color: "#eef1f5" }), stroke: halo, overflow: false, padding: [2, 6, 2, 6],
        }),
      }) : undefined),
    }),
    mk("industries", industryStyle, 11, true),
    mk("warehouses", warehouseStyle, 11, true),
    mk("stations", stationStyle, 12, true),
    mk("vehicles", vehiclesStyle(false), 13),
    // Selected line in front of everything (stations, industries, other vehicles), then its vehicles.
    new VectorLayer({ source: frontLines, style: linesStyle(true), zIndex: 14, properties: { liveLayer: "lines" } }),
    new VectorLayer({ source: frontVehicles, style: vehiclesStyle(true), zIndex: 15, properties: { liveLayer: "vehicles" } }),
    // Town names sit in the background: just above the outlines, below lines and stops, and out of
    // the declutter so they never hide the other labels.
    mk("towns", townStyle, 6),
    new VectorLayer({
      source: selection, zIndex: 20,
      // Stops of the selected line: dot in white, or black on a light line colour.
      style: (f) => (f.get("kind") === "stops" ? new Style({
        image: new Circle({ radius: 4.5 * opts.iconScale, fill: new Fill({ color: inkOn(f.get("color")) }),
          stroke: new Stroke({ color: f.get("color"), width: 2.5 }) }),
      }) : ringStyle(f.get("color"), 12 * opts.iconScale)),
    }),
  ];

  const info = (f: Feature, i: FeatureInfo, hover: string, hl: string) => {
    const key = `${i.layer}:${i.id}`;
    f.setProperties({ info: i, key, hover, hl });
    byKey.set(key, f);
    return f;
  };

  /** Features of the selected line and of its vehicles into the front layers. */
  function refreshFront(): void {
    frontLines.clear();
    frontVehicles.clear();
    if (selectedLine === null) return;
    frontLines.addFeatures(src.lines.getFeatures().filter(onSelectedLine));
    frontVehicles.addFeatures(src.vehicles.getFeatures().filter((f) => f.get("line") === selectedLine));
  }

  /** Last key refreshSelection restyled the town outlines for (they read the selection). */
  let outlinesFor: string | null = null;
  function refreshSelection(): void {
    selection.clear();
    const f = selectedKey ? byKey.get(selectedKey) : undefined;
    if (outlinesFor !== selectedKey) {
      outlinesFor = selectedKey;
      areaSrc.changed();
    }
    if (!f) return;
    const color = f.get("hl") as string;
    if (selectedLine !== null) {
      const stops = f.get("stopPts") as [number, number][] | undefined;
      if (stops?.length) selection.addFeature(new Feature({ geometry: new MultiPoint(stops), kind: "stops", color }));
      return;
    }
    if (f.getGeometry()?.getType() === "Point") selection.addFeature(new Feature({ geometry: f.getGeometry()!.clone(), kind: "point", color }));
  }

  function setSelected(key: string | null): void {
    selectedKey = key;
    selectedLine = key?.startsWith("lines:") ? Number(key.slice(6)) : null;
    src.lines.changed();
    src.vehicles.changed();
    refreshFront();
    refreshSelection();
  }

  const stockDetails = (stocks: Stock[] | undefined, labels: Labels) => {
    const out: FeatureInfo["details"] = {};
    for (const s of stocks ?? []) out[`${labels.cargoName(s.cargo)} (${labels.value("stock", s.kind)})`] = s.cap ? `${s.n} / ${s.cap}` : s.n;
    return out;
  };

  /** Inputs each group was last built from: rebuilt only when one of them changed (=== element-wise). */
  const builtFrom = new Map<string, unknown[]>();
  const same = (group: string, deps: unknown[]): boolean => {
    const prev = builtFrom.get(group);
    return !!prev && prev.length === deps.length && prev.every((v, i) => v === deps[i]);
  };
  /** Remember deps only after a rebuild finished, so a throw retries next time. */
  const remember = (group: string, deps: unknown[]) => {
    builtFrom.set(group, deps);
  };
  /** Keys of a layer leave byKey when its group is rebuilt. */
  const forgetKeys = (layer: LayerId) => {
    for (const k of [...byKey.keys()]) if (k.startsWith(`${layer}:`)) byKey.delete(k);
  };
  /** Lane layout memo: same route parts, same routed lines (id, rank, two-way) → same pieces. */
  let lanesMemo: { parts: RouteParts; key: string; out: ReturnType<typeof laneLayout> } | null = null;

  return {
    layers,
    count() {
      let n = areaSrc.getFeatures().length + lineLabelSrc.getFeatures().length;
      for (const s of Object.values(src)) n += s.getFeatures().length;
      return n;
    },
    update(frame, d, routes, parts, trails, fills, areas, labels, o, towns, locale) {
      const optsChanged = opts.plainLines !== o.plainLines || opts.maxTrackedLines !== o.maxTrackedLines;
      const nextStyle = styleSig(o);
      const styleDirty = nextStyle !== prevStyle;
      prevStyle = nextStyle;
      opts = o;
      if (styleDirty) for (const layer of layers) layer.changed();
      let layoutMs = 0;
      const m = (x: number, y: number) => toMap(frame, x, y);
      const mapRing = (r: Pt[]) => [...r, r[0]!].map(([x, y]) => m(x, y));
      const townDeps = [frame, areas, ...d.towns];
      if (!same("towns", townDeps)) {
        forgetKeys("towns");
        src.towns.clear(true);
        areaSrc.clear(true);
        src.towns.addFeatures(d.towns.map((t) => {
          const area = areas.get(t.id);
          const details: FeatureInfo["details"] = { size: t.size };
          if (area?.pop != null) details.population = area.pop;
          const i: FeatureInfo = { layer: "towns", id: t.id, name: t.name, x: t.x, y: t.y, details };
          const point = info(new Feature({ geometry: new Point(m(t.x, t.y)), name: t.name, size: t.size, hasArea: !!area?.rings.length }),
            i, t.name, "#ffffff");
          if (area?.rings.length) {
            // The outline is the town's selectable shape (registered last: selection and "fit" use it).
            areaSrc.addFeature(info(new Feature({ geometry: new MultiPolygon(area.rings.map((r) => [mapRing(r)])) }), i, t.name, "#ffffff"));
          }
          return point;
        }));
        remember("towns", townDeps);
      }
      // Industry names name the nearest town (every town, not the filtered list) and follow the language.
      const industryDeps = [frame, locale, ...towns, ...d.industries];
      if (!same("industries", industryDeps)) {
        forgetKeys("industries");
        src.industries.clear(true);
        src.industries.addFeatures(d.industries.map((i) => {
          const name = `${industryLabel(i.type)} — ${labels.industryNear(i.x, i.y)}`;
          const stockLabel = stockSummary(i.stocks, labels.cargoName);
          return info(new Feature({ geometry: new Point(m(i.x, i.y)), type: i.type, stockLabel }),
            { layer: "industries", id: i.id, name, x: i.x, y: i.y,
              details: { type: industryLabel(i.type), level: i.level ?? "—", ...stockDetails(i.stocks, labels) } },
            stockLabel ? `${name}\n${stockLabel}` : name, typeColor(i.type));
        }));
        remember("industries", industryDeps);
      }
      const warehouseDeps = [frame, locale, ...d.warehouses];
      if (!same("warehouses", warehouseDeps)) {
        forgetKeys("warehouses");
        src.warehouses.clear(true);
        src.warehouses.addFeatures(d.warehouses.map((w) => {
          const stockLabel = stockSummary(w.stocks, labels.cargoName);
          return info(new Feature({ geometry: new Point(m(w.x, w.y)), name: w.name, stockLabel }),
            { layer: "warehouses", id: w.id, name: w.name, x: w.x, y: w.y, details: { total: stockTotal(w.stocks), ...stockDetails(w.stocks, labels) } },
            stockLabel ? `${w.name}\n${stockLabel}` : w.name, WAREHOUSE_COLOR);
        }));
        remember("warehouses", warehouseDeps);
      }
      // Station colours are those of the lines stopping there. Labels follow the language.
      const stationDeps = [frame, locale, ...d.stations, ...d.lines];
      if (!same("stations", stationDeps)) {
        forgetKeys("stations");
        src.stations.clear(true);
        // Busiest stations first: they keep their label when labels collide (declutter).
        const stations = [...d.stations].sort((a, b) => stationTraffic(b) - stationTraffic(a));
        // Colours of the shown lines stopping at each station group, busiest line first.
        const servedBy = new Map<number, Line[]>();
        for (const l of d.lines) for (const g of new Set(l.stops.map((s) => s.g))) (servedBy.get(g) ?? servedBy.set(g, []).get(g)!).push(l);
        const colorsOf = (g: number) => (servedBy.get(g) ?? [])
          .sort((a, b) => (b.traffic?.transported ?? 0) - (a.traffic?.transported ?? 0)).map((l) => rgb(l.color));
        src.stations.addFeatures(stations.map((s) => {
          const tr = s.traffic;
          const use = s.cargo && s.passengers ? "both" : s.cargo ? "cargo" : "passengers";
          const details: FeatureInfo["details"] = { mode: labels.value("mode", s.mode), cargo: labels.value("use", use) };
          if (tr) Object.assign(details, { loaded: tr.loaded, unloaded: tr.unloaded, waitP: tr.waitP, waitC: tr.waitC });
          const figures = tr ? `${fmtK(tr.waitP + tr.waitC)} · ${fmtK(tr.loaded + tr.unloaded)}${labels.value("perYear", "")}` : "";
          const colors = colorsOf(s.id);
          return info(new Feature({
            geometry: new Point(m(s.x, s.y)), mode: s.mode, cargo: s.cargo, passengers: s.passengers,
            traffic: stationTraffic(s), name: s.name, figures, colors,
          }), { layer: "stations", id: s.id, name: s.name, x: s.x, y: s.y, details }, figures ? `${s.name}\n${figures}` : s.name,
          colors[0] ?? STOP_NO_LINE);
        }));
        remember("stations", stationDeps);
      }
      const lineColor = new Map<number, Line["color"]>();
      for (const l of d.lines) lineColor.set(l.id, l.color);
      // Lines without a recorded track drawn from their vehicles' trails (ships, aircraft): only those
      // trails matter here (the whole trail map changes on every vehicle update).
      const trailDeps: unknown[] = [];
      for (const l of d.lines) {
        if (!routes.has(l.id) && (l.mode === "water" || l.mode === "air")) trailDeps.push(trails.get(l.id) ?? null);
      }
      let linesRebuilt = false;
      const lineDeps = [frame, locale, routes, parts, fills, selectedLine, ...trailDeps, ...d.lines];
      if (!same("lines", lineDeps) || optsChanged) {
        linesRebuilt = true;
        forgetKeys("lines");
        src.lines.clear(true);
        lineLabelSrc.clear(true);
        const labelCands: { name: string; rank: number; piece: Pt[] }[] = [];
        // Network edges of the routed lines are drawn as lanes (laneLayout): one continuous track per line
        // and direction, stripes where lines share it. Each line also keeps its own pieces (station
        // lanes, bridges, free legs). Performance caps: plain tracks, or only the busiest lines tracked.
        const lineRank = (l: Line) => (l.traffic?.transported ?? 0) * 1000 + l.vehicles;
        const tracked = new Set([...d.lines].filter((l) => routes.has(l.id)).sort((a, b) => lineRank(b) - lineRank(a))
          .slice(0, o.maxTrackedLines ?? Infinity).map((l) => l.id));
        const routed = parts && !o.plainLines ? d.lines.filter((l) => tracked.has(l.id)) : [];
        const lanesIn = routed.map((l) => ({ id: l.id, rank: lineRank(l), twoWay: l.mode === "road" || l.mode === "tram" }));
        const lanesKey = lanesIn.map((l) => `${l.id}:${+l.twoWay}`).join(",");
        let lanes = { pieces: [] as ReturnType<typeof laneLayout>["pieces"], joints: [] as ReturnType<typeof laneLayout>["joints"] };
        if (parts && routed.length) {
          if (lanesMemo?.parts === parts && lanesMemo.key === lanesKey) lanes = lanesMemo.out;
          else {
            const t0 = performance.now();
            lanes = laneLayout(parts, lanesIn);
            layoutMs = performance.now() - t0;
            lanesMemo = { parts, key: lanesKey, out: lanes };
          }
        }
        const byStroke = new Set(routed.map((l) => l.id));
        const strokeFeatures: Feature[] = [];
        const pieceLen = (p: Pt[]) => p.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - p[i - 1]![0], q[1] - p[i - 1]![1]) : 0), 0);
        src.lines.addFeatures(d.lines.flatMap((l) => {
          const route = tracked.has(l.id) ? routes.get(l.id) : undefined;
          const trail = !route && (l.mode === "water" || l.mode === "air") ? trails.get(l.id) : undefined;
          const fullParts = route ?? (trail?.length ? trail : stopLegs(l));
          // Drawn by lane strokes: this line's own feature is only for selection, halo and fit.
          const strokesOnly = byStroke.has(l.id);
          if (!fullParts.length) return [];
          const c = l.stops[0] ?? { x: fullParts[0]![0]![0], y: fullParts[0]![0]![1] };
          const details: FeatureInfo["details"] = { mode: labels.value("mode", l.mode), stops: l.stops.length, vehicles: l.vehicles };
          if (l.traffic) Object.assign(details, { transported: l.traffic.transported, waitP: l.traffic.waitP, waitC: l.traffic.waitC });
          // Label candidate: the longest piece of the track; the selected line ranks first.
          let longest = fullParts[0]!, longestLen = pieceLen(longest);
          for (const pc of fullParts) {
            const len = pieceLen(pc);
            if (len > longestLen) [longest, longestLen] = [pc, len];
          }
          const rank = l.id === selectedLine ? Infinity : lineRank(l);
          if (longest.length >= 2) labelCands.push({ name: l.name, rank, piece: longest });
          const fill = route ? fills.get(l.id) : undefined;
          const extra = fill?.length
            ? [new Feature({ geometry: new MultiLineString(fill.map((p) => p.map(([x, y]) => m(x, y)))), color: l.color, lineId: l.id, approx: "fill" })]
            : [];
          const geometry = new MultiLineString(fullParts.map((p) => p.map(([x, y]) => m(x, y))));
          return [...extra, info(new Feature({
            geometry, full: strokesOnly ? geometry : undefined,
            strokesOnly, color: l.color, lineId: l.id, name: l.name, approx: route ? "" : trail?.length ? "trail" : "legs",
            stopPts: l.stops.map((s) => m(s.x, s.y)),
          }), { layer: "lines", id: l.id, name: l.name, x: c.x, y: c.y, details }, l.name, rgb(l.color))];
        }));
        for (const pc of lanes.pieces) {
          const f = byKey.get(`lines:${pc.line}`);
          if (!f) continue;
          strokeFeatures.push(new Feature({
            // Normals turn with the frame like the points: world (x, y) → map (y, −x).
            geometry: new LineString(pc.pts.map(([x, y]) => m(x, y))), nrm: pc.nrm.map(([x, y]) => [y, -x]),
            approx: "stroke", lanes: pc.lane, k: pc.k, i: pc.i, arc: pc.arc,
            lines: [pc.line], colors: [rgb(f.get("color"), 1)],
          }));
        }
        // Joints: world (x, y) → map (y, −x) for the vectors, like the points.
        const turn = ([x, y]: Pt): Pt => [y, -x];
        for (const j of lanes.joints) {
          const f = byKey.get(`lines:${j.line}`);
          if (!f) continue;
          const end = (e: typeof j.a) => ({ p: m(e.p[0], e.p[1]), n: turn(e.n), lane: e.lane, dir: turn(e.dir) });
          strokeFeatures.push(new Feature({
            geometry: new LineString([m(j.a.p[0], j.a.p[1]), m(j.b.p[0], j.b.p[1])]), approx: "joint",
            a: end(j.a), b: end(j.b), lines: [j.line], colors: [rgb(f.get("color"), 1)],
          }));
        }
        src.lines.addFeatures(strokeFeatures);
        // One label per name (a two-way line, or two lines sharing a name), busiest first: when labels
        // collide, the declutter keeps the earliest ones.
        const seenNames = new Set<string>();
        for (const c of labelCands.sort((a, b) => b.rank - a.rank)) {
          if (seenNames.has(c.name)) continue;
          seenNames.add(c.name);
          lineLabelSrc.addFeature(new Feature({ geometry: new LineString(c.piece.map(([x, y]) => m(x, y))), name: c.name }));
        }
        remember("lines", lineDeps);
      }
      // Vehicles: updated in place (same features: no re-index, no flicker); only new ones are added
      // and gone ones removed. A new frame (another background) rebuilds them.
      const frameDeps = [frame];
      const frameChanged = !same("vehicleFrame", frameDeps);
      if (frameChanged) {
        src.vehicles.clear(true);
        vehicleFeatures = new Map();
        forgetKeys("vehicles");
        remember("vehicleFrame", frameDeps);
      }
      const now = Date.now();
      const seen = new Set<number>();
      const added: Feature[] = [];
      let lineMoved = false;
      for (const v of d.vehicles) {
        seen.add(v.id);
        // Glide from where the vehicle is drawn to its new position (no jump back and forth).
        const at = drawn.get(v.id);
        const g = glides.get(v.id);
        if (!at || o.snap || Math.hypot(v.x - at.x, v.y - at.y) > SNAP_M) {
          drawn.set(v.id, { x: v.x, y: v.y });
          glides.delete(v.id);
        } else if (!g || g.tx !== v.x || g.ty !== v.y) {
          glides.set(v.id, { fx: at.x, fy: at.y, tx: v.x, ty: v.y, t0: now, dur: Math.max(300, o.glideMs) });
        }
        const pos = drawn.get(v.id)!;
        const lineName = labels.lineName(v.line);
        const details: FeatureInfo["details"] = { line: lineName };
        if (v.pax) details.pax = `${v.pax.n} / ${v.pax.cap}`;
        if (v.freight) details.freight = `${v.freight.n} / ${v.freight.cap}`;
        const title = v.name || `#${v.id}`;
        const color = lineColor.get(v.line) ?? null;
        const lt = loadText(v);
        const props = { color, line: v.line, vname: v.name, loadText: lt, pax: v.pax, freight: v.freight, mode: labels.lineMode(v.line) };
        const i: FeatureInfo = { layer: "vehicles", id: v.id, name: `${title} — ${lineName}`, x: v.x, y: v.y, details, lineId: v.line };
        const hover = `${title} · ${lineName}${lt ? ` · ${lt}` : ""}`;
        let f = vehicleFeatures.get(v.id);
        if (f) {
          if (f.get("line") !== v.line) lineMoved = true;
          f.setProperties(props, true);
          if (!glides.has(v.id)) (f.getGeometry() as Point).setCoordinates(m(pos.x, pos.y));
          info(f, i, hover, rgb(color));
          f.changed();
        } else {
          f = info(new Feature({ geometry: new Point(m(pos.x, pos.y)), ...props }), i, hover, rgb(color));
          vehicleFeatures.set(v.id, f);
          added.push(f);
        }
      }
      if (added.length) src.vehicles.addFeatures(added);
      let removed = false;
      for (const [id, f] of vehicleFeatures) {
        if (seen.has(id)) continue;
        src.vehicles.removeFeature(f);
        vehicleFeatures.delete(id);
        byKey.delete(`vehicles:${id}`);
        removed = true;
      }
      for (const id of [...drawn.keys()]) if (!seen.has(id)) {
        drawn.delete(id);
        glides.delete(id);
      }
      if (linesRebuilt || added.length || removed || frameChanged || lineMoved) refreshFront();
      refreshSelection();
      return { layoutMs };
    },
    animate(frame, nowMs) {
      for (const [id, g] of glides) {
        const f = vehicleFeatures.get(id);
        const a = Math.min(1, (nowMs - g.t0) / g.dur);
        const p = { x: g.fx + (g.tx - g.fx) * a, y: g.fy + (g.ty - g.fy) * a };
        drawn.set(id, p);
        if (a >= 1) glides.delete(id);
        (f?.getGeometry() as Point | undefined)?.setCoordinates(toMap(frame, p.x, p.y));
      }
      if (selectedKey?.startsWith("vehicles:")) refreshSelection();
    },
    setSelected,
    infoOf(key) {
      return (byKey.get(key)?.get("info") as FeatureInfo | undefined) ?? null;
    },
    extentOf(key) {
      const f = byKey.get(key);
      return (f?.get("full") as MultiLineString | undefined)?.getExtent() ?? f?.getGeometry()?.getExtent() ?? null;
    },
  };
}
