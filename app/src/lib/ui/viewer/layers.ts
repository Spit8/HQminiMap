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
import { stopLegs, type Pt } from "$lib/core/routes";
import { iconUri, stopGlyph, type IconOpts } from "./icons";

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
function ringStyle(color: string): Style[] {
  let s = ringStyles.get(color);
  if (!s) {
    s = [
      new Style({ image: new Circle({ radius: 12, stroke: new Stroke({ color: "rgba(255,255,255,.9)", width: 5 }) }) }),
      new Style({ image: new Circle({ radius: 12, stroke: new Stroke({ color, width: 3 }) }) }),
    ];
    ringStyles.set(color, s);
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
  }
  return i;
}

/** "👤 12/40 · 📦 3/10": passengers and cargo on board / capacity. */
export function loadText(v: Pick<Vehicle, "pax" | "freight">): string {
  return [v.pax ? `👤 ${v.pax.n}/${v.pax.cap}` : "", v.freight ? `📦 ${v.freight.n}/${v.freight.cap}` : ""].filter(Boolean).join(" · ");
}

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
  /** Rebuild every feature from the filtered data. */
  update(frame: Frame, data: LiveData, routes: Map<number, Pt[][]>, trails: Map<number, Pt[][]>, fills: Map<number, Pt[][]>, areas: TownAreas,
    labels: Labels, opts: LiveOptions): void;
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
  let selectedKey: string | null = null;
  let selectedLine: number | null = null;
  let opts: LiveOptions = {
    labels: { towns: true, industries: false, warehouses: false, stations: true, lines: false, vehicles: false }, glideMs: 2000,
  };
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
    const px = Math.max(11, Math.min(20, 10 + Math.sqrt(size) / 2.5));
    const area = f.get("hasArea") as boolean;
    return new Style({
      image: area ? undefined : new Circle({ radius: 4, fill: new Fill({ color: "#fff" }), stroke: new Stroke({ color: "#222", width: 1.5 }) }),
      text: showLabel("towns", res) ? label(f.get("name"), area ? 0 : -px, px, 600) : undefined,
    });
  };

  const areaStyle = (f: FeatureLike) => new Style({
    fill: new Fill({ color: selectedKey === f.get("key") ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.06)" }),
    stroke: new Stroke({ color: selectedKey === f.get("key") ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.55)",
      width: selectedKey === f.get("key") ? 2.5 : 1.2 }),
  });

  const industryStyle = (f: FeatureLike, res: number) => new Style({
    image: icon("factory", typeColor(f.get("type")), { size: 17, shape: "square" }),
    text: showLabel("industries", res) && f.get("stockLabel") ? label(f.get("stockLabel"), -15, 10.5) : undefined,
  });

  const warehouseStyle = (f: FeatureLike, res: number) => new Style({
    image: icon("warehouse", WAREHOUSE_COLOR, { size: 17, shape: "square" }),
    text: showLabel("warehouses", res) ? label(f.get("stockLabel") || f.get("name"), -15, 10.5) : undefined,
  });

  // Stations and stops: stop pictogram of the mode (vehicles have their own) on a rounded square in
  // the colour of the line(s) serving it (bands when several), sized by traffic; cargo stations have
  // a marked corner, mixed ones a second outline. Name when labels are on, figures when zoomed in.
  const stationStyle = (f: FeatureLike, res: number) => {
    const mode = f.get("mode") as StationMode;
    const size = Math.round(14 + Math.min(6, Math.log10(1 + (f.get("traffic") as number)) * 1.3));
    const cargo = f.get("cargo") as boolean, passengers = f.get("passengers") as boolean;
    let text: Text | undefined;
    if (showLabel("stations", res)) {
      const figures = res < FIGURES_RES ? (f.get("figures") as string) : "";
      text = label(figures ? `${f.get("name")}\n${figures}` : f.get("name"), -size / 2 - (figures ? 14 : 8));
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
    const kind = f.get("approx") as "" | "legs" | "trail" | "fill";
    if (kind === "fill") {
      // Gap filled from the vehicles' trails: thin solid line in the line's colour, not selectable.
      return new Style({ stroke: new Stroke({ color: rgb(f.get("color"), dim ? 0.22 : 0.8), width: sel ? 3.5 : 2 }), zIndex: sel ? 3 : 1 });
    }
    const dash = kind === "legs" ? [8, 6] : kind === "trail" ? [2, 5] : undefined;
    const main = new Style({
      stroke: new Stroke({ color: rgb(f.get("color"), dim ? 0.22 : 0.95), width: sel ? 5 : kind === "trail" ? 2 : 3, lineDash: dash }),
      text: showLabel("lines", res) ? new Text({ text: f.get("name"), placement: "line", font: "11px system-ui, sans-serif",
        fill: new Fill({ color: "#eef1f5" }), stroke: halo, overflow: false }) : undefined,
      zIndex: sel ? 3 : 1,
    });
    return sel ? [new Style({ stroke: new Stroke({ color: rgb(f.get("color"), 0.35), width: 13 }), zIndex: 2 }), main] : main;
  };

  // Vehicle: mode pictogram on a disc of its line's colour.
  const vehicleStyle = (f: FeatureLike, res: number) => {
    const big = selectedLine !== null && f.get("line") === selectedLine;
    const text = showLabel("vehicles", res) ? [f.get("vname"), f.get("loadText")].filter(Boolean).join(" · ") : "";
    return new Style({
      image: icon(f.get("mode"), rgb(f.get("color")), { size: big ? 20 : 15, ring: big ? "#ffffff" : undefined }),
      text: text ? label(text, 0, 10, 600, big ? 13 : 10) : undefined,
      zIndex: big ? 2 : 1,
    });
  };

  const mk = (layer: LayerId, style: (f: FeatureLike, res: number) => Style | Style[], z: number, declutter = false) =>
    new VectorLayer({ source: src[layer], style, zIndex: z, declutter, properties: { liveLayer: layer } });

  const layers = [
    new VectorLayer({ source: areaSrc, style: areaStyle, zIndex: 5, properties: { liveLayer: "towns" } }),
    mk("lines", lineStyle, 10),
    mk("industries", industryStyle, 11, true),
    mk("warehouses", warehouseStyle, 11, true),
    mk("stations", stationStyle, 12, true),
    mk("vehicles", vehicleStyle, 13),
    mk("towns", townStyle, 14, true),
    new VectorLayer({
      source: selection, zIndex: 20,
      style: (f) => (f.get("kind") === "stops" ? new Style({
        image: new Circle({ radius: 4.5, fill: new Fill({ color: "#fff" }), stroke: new Stroke({ color: f.get("color"), width: 2.5 }) }),
      }) : ringStyle(f.get("color"))),
    }),
  ];

  const info = (f: Feature, i: FeatureInfo, hover: string, hl: string) => {
    const key = `${i.layer}:${i.id}`;
    f.setProperties({ info: i, key, hover, hl });
    byKey.set(key, f);
    return f;
  };

  function refreshSelection(): void {
    selection.clear();
    const f = selectedKey ? byKey.get(selectedKey) : undefined;
    areaSrc.changed();
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
    refreshSelection();
  }

  const stockDetails = (stocks: Stock[] | undefined, labels: Labels) => {
    const out: FeatureInfo["details"] = {};
    for (const s of stocks ?? []) out[`${labels.cargoName(s.cargo)} (${labels.value("stock", s.kind)})`] = s.cap ? `${s.n} / ${s.cap}` : s.n;
    return out;
  };

  return {
    layers,
    update(frame, d, routes, trails, fills, areas, labels, o) {
      opts = o;
      byKey.clear();
      for (const s of Object.values(src)) s.clear();
      areaSrc.clear();
      const m = (x: number, y: number) => toMap(frame, x, y);
      const mapRing = (r: Pt[]) => [...r, r[0]!].map(([x, y]) => m(x, y));
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
      src.industries.addFeatures(d.industries.map((i) => {
        const name = `${industryLabel(i.type)} — ${labels.industryNear(i.x, i.y)}`;
        const stockLabel = stockSummary(i.stocks, labels.cargoName);
        return info(new Feature({ geometry: new Point(m(i.x, i.y)), type: i.type, stockLabel }),
          { layer: "industries", id: i.id, name, x: i.x, y: i.y,
            details: { type: industryLabel(i.type), level: i.level ?? "—", ...stockDetails(i.stocks, labels) } },
          stockLabel ? `${name}\n${stockLabel}` : name, typeColor(i.type));
      }));
      src.warehouses.addFeatures(d.warehouses.map((w) => {
        const stockLabel = stockSummary(w.stocks, labels.cargoName);
        return info(new Feature({ geometry: new Point(m(w.x, w.y)), name: w.name, stockLabel }),
          { layer: "warehouses", id: w.id, name: w.name, x: w.x, y: w.y, details: { total: stockTotal(w.stocks), ...stockDetails(w.stocks, labels) } },
          stockLabel ? `${w.name}\n${stockLabel}` : w.name, WAREHOUSE_COLOR);
      }));
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
        return info(new Feature({
          geometry: new Point(m(s.x, s.y)), mode: s.mode, cargo: s.cargo, passengers: s.passengers,
          traffic: stationTraffic(s), name: s.name, figures, colors: colorsOf(s.id),
        }), { layer: "stations", id: s.id, name: s.name, x: s.x, y: s.y, details }, figures ? `${s.name}\n${figures}` : s.name,
        colorsOf(s.id)[0] ?? STOP_NO_LINE);
      }));
      const lineColor = new Map<number, Line["color"]>();
      for (const l of d.lines) lineColor.set(l.id, l.color);
      src.lines.addFeatures(d.lines.flatMap((l) => {
        const route = routes.get(l.id);
        const trail = !route && (l.mode === "water" || l.mode === "air") ? trails.get(l.id) : undefined;
        const parts = route ?? (trail?.length ? trail : stopLegs(l));
        if (!parts.length) return [];
        const c = l.stops[0] ?? { x: parts[0]![0]![0], y: parts[0]![0]![1] };
        const details: FeatureInfo["details"] = { mode: labels.value("mode", l.mode), stops: l.stops.length, vehicles: l.vehicles };
        if (l.traffic) Object.assign(details, { transported: l.traffic.transported, waitP: l.traffic.waitP, waitC: l.traffic.waitC });
        const fill = route ? fills.get(l.id) : undefined;
        const extra = fill?.length
          ? [new Feature({ geometry: new MultiLineString(fill.map((p) => p.map(([x, y]) => m(x, y)))), color: l.color, lineId: l.id, approx: "fill" })]
          : [];
        return [...extra, info(new Feature({
          geometry: new MultiLineString(parts.map((p) => p.map(([x, y]) => m(x, y)))),
          color: l.color, lineId: l.id, name: l.name, approx: route ? "" : trail?.length ? "trail" : "legs",
          stopPts: l.stops.map((s) => m(s.x, s.y)),
        }), { layer: "lines", id: l.id, name: l.name, x: c.x, y: c.y, details }, l.name, rgb(l.color))];
      }));
      vehicleFeatures = new Map();
      const now = Date.now();
      const seen = new Set<number>();
      src.vehicles.addFeatures(d.vehicles.map((v) => {
        seen.add(v.id);
        // Glide from where the vehicle is drawn to its new position (no jump back and forth).
        const at = drawn.get(v.id);
        const g = glides.get(v.id);
        if (!at || Math.hypot(v.x - at.x, v.y - at.y) > SNAP_M) {
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
        const f = info(new Feature({
          geometry: new Point(m(pos.x, pos.y)), color, line: v.line, vname: v.name, loadText: lt,
          mode: labels.lineMode(v.line),
        }), { layer: "vehicles", id: v.id, name: `${title} — ${lineName}`, x: v.x, y: v.y, details, lineId: v.line },
        `${title} · ${lineName}${lt ? ` · ${lt}` : ""}`, rgb(color));
        vehicleFeatures.set(v.id, f);
        return f;
      }));
      for (const id of [...drawn.keys()]) if (!seen.has(id)) {
        drawn.delete(id);
        glides.delete(id);
      }
      refreshSelection();
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
      return byKey.get(key)?.getGeometry()?.getExtent() ?? null;
    },
  };
}
