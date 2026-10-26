/**
 * Small map pictograms (inline SVG, 16 × 16): a white glyph on a coloured disc. Used both by the
 * OpenLayers styles (data URIs) and by the panel / legend (markup).
 */
import type { StationMode } from "$lib/core/live";

export type StopGlyph = "stop_road" | "stop_rail" | "stop_tram" | "stop_water" | "stop_air" | "stop_other";
export type Glyph = StationMode | "factory" | "warehouse" | StopGlyph;

/** Stop pictogram of a mode (different from the vehicle's). */
export const stopGlyph = (m: StationMode): StopGlyph => `stop_${m}`;

/** White glyph paths per kind; `cut` parts are drawn in the disc colour (windows, door). */
const GLYPHS: Record<Glyph, { body: string; cut?: string; stroke?: string }> = {
  road: {
    body: "M4.6 4h6.8a1.1 1.1 0 0 1 1.1 1.1v5.4a1 1 0 0 1-1 1h-.4v1.2H9.6v-1.2H6.4v1.2H4.9v-1.2h-.4a1 1 0 0 1-1-1V5.1A1.1 1.1 0 0 1 4.6 4z",
    cut: "M4.8 5.3h6.4v2.6H4.8z",
  },
  rail: {
    body: "M5.6 3h4.8A1.6 1.6 0 0 1 12 4.6v5.2a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 9.8V4.6A1.6 1.6 0 0 1 5.6 3z",
    cut: "M5.2 4.3h5.6v2.6H5.2zM5.6 8.6h1.2v1.2H5.6zM9.2 8.6h1.2v1.2H9.2z",
    stroke: "M5.2 13.4l1.6-1.9M10.8 13.4l-1.6-1.9",
  },
  tram: {
    body: "M5.4 4.6h5.2A1.4 1.4 0 0 1 12 6v4.8a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 10.8V6a1.4 1.4 0 0 1 1.4-1.4z",
    cut: "M5.2 5.8h5.6v2.4H5.2z",
    stroke: "M8 4.6V2.6M6.2 2.4h3.6M5.6 13.6l1-1.4M10.4 13.6l-1-1.4",
  },
  water: {
    body: "M2.8 9.4h10.4l-1.9 3.2H4.7zM5.8 6.2h4.4v3.2H5.8z",
    stroke: "M8 3.2v3",
  },
  air: {
    body: "M8 2.2c.6 0 1 .5 1 1.2v3.1l4.2 2.4v1.4L9 9.1v2.4l1.4 1v1.1L8 13l-2.4.6v-1.1l1.4-1V9.1l-4.2 1.2V8.9L7 6.5V3.4c0-.7.4-1.2 1-1.2z",
  },
  other: { body: "M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" },
  factory: {
    body: "M2.8 13V7.6l2.8 1.7V7.6l2.8 1.7V7.6l2.8 1.7V3.4h1.6V13z",
    cut: "M4.2 10.6h1.4V12H4.2zM7 10.6h1.4V12H7zM9.8 10.6h1.4V12H9.8z",
  },
  stop_road: {
    body: "M7.3 7.4h1.4V14H7.3zM4.4 2h7.2a.8.8 0 0 1 .8.8v4a.8.8 0 0 1-.8.8H4.4a.8.8 0 0 1-.8-.8v-4a.8.8 0 0 1 .8-.8z",
    cut: "M5.7 3h1v1.5h2.6V3h1v3.6h-1V5.4H6.7v1.2h-1z",
  },
  stop_tram: {
    body: "M7.3 7.4h1.4V14H7.3zM4.4 2h7.2a.8.8 0 0 1 .8.8v4a.8.8 0 0 1-.8.8H4.4a.8.8 0 0 1-.8-.8v-4a.8.8 0 0 1 .8-.8z",
    cut: "M5.5 3h5v1.1H8.6v2.5H7.4V4.1H5.5z",
  },
  stop_rail: {
    body: "M2.2 5.6L8 2.4l5.8 3.2zM3.4 5.6h1.2v5.8H3.4zM11.4 5.6h1.2v5.8h-1.2zM1.8 11.4h12.4v2H1.8z",
  },
  stop_water: {
    body: "M8 1.6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z",
    stroke: "M8 4.6v8.8M5.2 6.6h5.6M3.2 9.4a4.8 4.8 0 0 0 9.6 0",
  },
  stop_air: {
    body: "M4.2 3.2h7.6l-1.2 2.9H5.4zM6.2 6.1h3.6l-.5 7.7H6.7z",
  },
  stop_other: { body: "M5 5h6v6H5z" },
  warehouse: {
    body: "M2.6 6.8L8 3.2l5.4 3.6V13H2.6z",
    cut: "M5.8 8.6h4.4V13H5.8z",
    stroke: "M5.8 10h4.4M5.8 11.5h4.4",
  },
};

/** Relative luminance (0..1) of a CSS colour: #rgb, #rrggbb, rgb()/rgba(), hsl(). */
export function luminance(color: string): number {
  let r = 0.5, g = 0.5, b = 0.5;
  const c = color.trim();
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  const rgbM = c.match(/^rgba?\(([^)]+)\)/i);
  const hslM = c.match(/^hsla?\(\s*([\d.]+)[ ,]+([\d.]+)%[ ,]+([\d.]+)%/i);
  if (hex) {
    const h = hex[1]!.length === 3 ? hex[1]!.split("").map((x) => x + x).join("") : hex[1]!;
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  } else if (rgbM) {
    [r, g, b] = rgbM[1]!.split(",").slice(0, 3).map((x) => Number(x) / 255) as [number, number, number];
  } else if (hslM) {
    const h = Number(hslM[1]) / 360, s = Number(hslM[2]) / 100, l = Number(hslM[3]) / 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const hue = (t: number) => {
      t = (t + 1) % 1;
      return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    };
    [r, g, b] = [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
  }
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Glyph colour readable on `color`: black on light backgrounds, white otherwise. */
export const inkOn = (color: string) => (luminance(color) > 0.45 ? "#111418" : "#ffffff");

export interface IconOpts {
  size?: number;
  ring?: string;
  /** "disc" (vehicles) or "square" (places: stations, factories, warehouses). */
  shape?: "disc" | "square";
  /** Cargo station: a marked corner. */
  corner?: boolean;
  /** Passengers and cargo: a second outline. */
  double?: boolean;
  /** Square only: vertical bands of these colours (stations served by several lines). */
  stripes?: string[];
}

/** SVG markup of a pictogram: glyph in black or white (contrast) on a disc / rounded square. */
export function iconSvg(glyph: Glyph, color: string, sizeOrOpts: number | IconOpts = 16, ringArg?: string): string {
  const o: IconOpts = typeof sizeOrOpts === "number" ? { size: sizeOrOpts, ring: ringArg } : sizeOrOpts;
  const size = o.size ?? 16, ring = o.ring ?? "#0b0d10";
  const g = GLYPHS[glyph];
  const bands = o.shape === "square" && o.stripes && o.stripes.length > 1 ? o.stripes.slice(0, 3) : null;
  // Ink readable on all the bands (the lightest one decides).
  const ink = bands ? (bands.some((c) => inkOn(c) !== "#ffffff") ? "#111418" : "#ffffff") : inkOn(color);
  const bandsSvg = bands
    ? `<clipPath id="c"><rect x="1" y="1" width="14" height="14" rx="3.2"/></clipPath><g clip-path="url(#c)">`
      + bands.map((c, i) => `<rect x="${1 + (14 * i) / bands.length}" y="1" width="${14 / bands.length + 0.2}" height="14" fill="${c}"/>`).join("")
      + `</g><rect x="1" y="1" width="14" height="14" rx="3.2" fill="none" stroke="${ring}" stroke-width="1.2"/>`
    : "";
  const bg = o.shape === "square"
    ? (bandsSvg || `<rect x="1" y="1" width="14" height="14" rx="3.2" fill="${color}" stroke="${ring}" stroke-width="1.2"/>`)
      + (o.double ? `<rect x="2.6" y="2.6" width="10.8" height="10.8" rx="2" fill="none" stroke="${ink}" stroke-opacity=".55" stroke-width=".8"/>` : "")
      + (o.corner ? `<path d="M10 1.6h3.4a1 1 0 0 1 1 1V6z" fill="${ink}" fill-opacity=".85"/>` : "")
    : `<circle cx="8" cy="8" r="7.3" fill="${color}" stroke="${ring}" stroke-width="1.2"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16">` + bg
    + `<g transform="translate(8 8) scale(${o.shape === "square" ? 0.82 : 1}) translate(-8 -8)">`
    + `<path d="${g.body}" fill="${ink}"/>`
    + (g.cut ? `<path d="${g.cut}" fill="${bands ? (ink === "#ffffff" ? "#111418" : "#ffffff") : color}"/>` : "")
    + (g.stroke ? `<path d="${g.stroke}" stroke="${glyph === "warehouse" ? color : ink}" stroke-width="1.1" stroke-linecap="round" fill="none"/>` : "")
    + `</g></svg>`;
}

const uris = new Map<string, string>();
/** Cached data URI of a pictogram (OpenLayers Icon source). */
export function iconUri(glyph: Glyph, color: string, o: IconOpts = {}): string {
  const key = `${glyph}|${color}|${o.size}|${o.ring}|${o.shape}|${o.corner}|${o.double}|${o.stripes?.join(";") ?? ""}`;
  let u = uris.get(key);
  if (!u) {
    u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(glyph, color, o))}`;
    uris.set(key, u);
    if (uris.size > 2000) uris.delete(uris.keys().next().value!); // bounded: oldest out
  }
  return u;
}

/** Load pictograms (vehicle labels, card, badges): colour emoji, readable on dark. */
export const LOAD_ICON = { pax: "🧑", freight: "📦" } as const;

/** One part of a vehicle load badge: its pictogram and "on board/capacity". */
export interface BadgePart {
  kind: keyof typeof LOAD_ICON;
  text: string;
}

export interface Badge {
  uri: string;
  width: number;
  height: number;
}

const BADGE_FONT = "system-ui, 'Segoe UI', sans-serif";
const EMOJI_FONT = "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";
let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Rendered width of a text (canvas measure; estimated where there is no canvas, e.g. tests). */
function textWidth(text: string, font: string, px: number, weight = 700): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    } catch {
      measureCtx = null;
    }
  }
  if (!measureCtx) return [...text].length * px * (font === EMOJI_FONT ? 1.2 : 0.6);
  measureCtx.font = `${weight} ${px}px ${font}`;
  return measureCtx.measureText(text).width;
}

const badges = new Map<string, Badge>();
/**
 * Load badge of a vehicle: rounded frame outlined in its line's colour on a dark background, the
 * load pictogram (LOAD_ICON) + "12/40" per part (passengers, cargo). Cached; sizes in px at `scale`.
 */
export function loadBadge(border: string, parts: BadgePart[], scale = 1): Badge {
  const key = `${border}|${scale}|${parts.map((p) => `${p.kind}:${p.text}`).join(";")}`;
  let b = badges.get(key);
  if (b) return b;
  const fs = 9.5 * scale, es = 9 * scale, pad = 3 * scale, gap = 2 * scale, sep = 5 * scale;
  const height = Math.round(15 * scale), cy = height / 2;
  let x = pad, body = "";
  parts.forEach((p, i) => {
    if (i) x += sep;
    const icon = LOAD_ICON[p.kind];
    body += `<text x="${x}" y="${cy}" dominant-baseline="central" font-family="${EMOJI_FONT}" font-size="${es}">${icon}</text>`;
    x += textWidth(icon, EMOJI_FONT, es, 400) + gap;
    body += `<text x="${x}" y="${cy}" dominant-baseline="central" font-family="${BADGE_FONT}" font-size="${fs}" font-weight="700" fill="#f2f4f7">${p.text}</text>`;
    x += textWidth(p.text, BADGE_FONT, fs);
  });
  const width = Math.ceil(x + pad);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="${4 * scale}" fill="rgba(14,16,20,.9)" stroke="${border}" stroke-width="1.5"/>`
    + body + `</svg>`;
  b = { uri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, width, height };
  // Counts change all the time: keep the cache bounded.
  if (badges.size > 2000) badges.clear();
  badges.set(key, b);
  return b;
}
