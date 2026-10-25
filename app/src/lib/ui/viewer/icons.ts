/**
 * Small map pictograms (inline SVG, 16 × 16): a white glyph on a coloured disc. Used both by the
 * OpenLayers styles (data URIs) and by the panel / legend (markup).
 */
import type { StationMode } from "$lib/core/live";

export type Glyph = StationMode | "factory" | "warehouse";

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
}

/** SVG markup of a pictogram: glyph in black or white (contrast) on a disc / rounded square. */
export function iconSvg(glyph: Glyph, color: string, sizeOrOpts: number | IconOpts = 16, ringArg?: string): string {
  const o: IconOpts = typeof sizeOrOpts === "number" ? { size: sizeOrOpts, ring: ringArg } : sizeOrOpts;
  const size = o.size ?? 16, ring = o.ring ?? "#0b0d10";
  const g = GLYPHS[glyph];
  const ink = inkOn(color);
  const bg = o.shape === "square"
    ? `<rect x="1" y="1" width="14" height="14" rx="3.2" fill="${color}" stroke="${ring}" stroke-width="1.2"/>`
      + (o.double ? `<rect x="2.6" y="2.6" width="10.8" height="10.8" rx="2" fill="none" stroke="${ink}" stroke-opacity=".55" stroke-width=".8"/>` : "")
      + (o.corner ? `<path d="M10 1.6h3.4a1 1 0 0 1 1 1V6z" fill="${ink}" fill-opacity=".85"/>` : "")
    : `<circle cx="8" cy="8" r="7.3" fill="${color}" stroke="${ring}" stroke-width="1.2"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16">` + bg
    + `<g transform="translate(8 8) scale(${o.shape === "square" ? 0.82 : 1}) translate(-8 -8)">`
    + `<path d="${g.body}" fill="${ink}"/>`
    + (g.cut ? `<path d="${g.cut}" fill="${color}"/>` : "")
    + (g.stroke ? `<path d="${g.stroke}" stroke="${glyph === "warehouse" ? color : ink}" stroke-width="1.1" stroke-linecap="round" fill="none"/>` : "")
    + `</g></svg>`;
}

const uris = new Map<string, string>();
/** Cached data URI of a pictogram (OpenLayers Icon source). */
export function iconUri(glyph: Glyph, color: string, o: IconOpts = {}): string {
  const key = `${glyph}|${color}|${o.size}|${o.ring}|${o.shape}|${o.corner}|${o.double}`;
  let u = uris.get(key);
  if (!u) {
    u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(glyph, color, o))}`;
    uris.set(key, u);
  }
  return u;
}
