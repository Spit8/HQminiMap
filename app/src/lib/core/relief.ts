/**
 * Relief in colours: altitude → colour between a low and a high colour, and the RGBA image of a
 * heightmap in the map frame. Pure (no canvas).
 */
import { heightRange, waterCells } from "./contours";
import type { ReliefScale, ReliefStop } from "./filters";
import type { Heightmap } from "./lua";

type Rgb = [number, number, number];
type Hsl = [number, number, number];

function hexRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1]!, 16) : 0x808080;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbHsl([r, g, b]: Rgb): Hsl {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslRgb([h, s, l]: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Colour at t (0 = low, 1 = high): hue along the short way round the colour wheel (green → yellow
 * → red, not a muddy brown), saturation and lightness linear. A grey end takes the other's hue.
 */
export function mixColor(low: string, high: string, t: number): Rgb {
  const a = rgbHsl(hexRgb(low)), b = rgbHsl(hexRgb(high));
  t = Math.min(1, Math.max(0, t));
  const ha = a[1] ? a[0] : b[0], hb = b[1] ? b[0] : ha;
  let dh = hb - ha;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return hslRgb([(ha + dh * t + 360) % 360, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/** Colour and opacity at t (0 = first stop, 1 = last): colour as mixColor, opacity linear, per segment. */
export function rampColor(stops: ReliefStop[], t: number): [number, number, number, number] {
  const first = stops[0] ?? { color: "#808080", alpha: 1 };
  if (stops.length < 2) return [...mixColor(first.color, first.color, 0), first.alpha];
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const k = Math.min(stops.length - 2, Math.floor(x)), u = x - k;
  const a = stops[k]!, b = stops[k + 1]!;
  return [...mixColor(a.color, b.color, u), a.alpha + (b.alpha - a.alpha) * u];
}

/** Altitude range coloured: lowest ground above the water → highest. */
export function reliefRange(hm: Heightmap): { min: number; max: number } {
  const { min, max } = heightRange(hm);
  return { min: Math.min(max, Math.max(min, hm.waterLevel ?? min)), max };
}

/** Classes of the equalised histogram. */
const BINS = 1024;

/**
 * Altitude → position on the colour ramp (0 = low colour, 1 = high), monotone, over reliefRange.
 * "equalize": cumulative share of the ground below z (histogram of the cells above the water), so
 * every colour covers as much ground — mostly low maps no longer stay one colour; "sqrt" / "log"
 * spread the low ground and squeeze the peaks; "linear" as the altitude.
 */
export function reliefScale(hm: Heightmap, scale: ReliefScale): (z: number) => number {
  const { min, max } = reliefRange(hm);
  const span = max - min || 1;
  const lin = (z: number) => Math.min(1, Math.max(0, (z - min) / span));
  if (scale === "linear") return lin;
  if (scale === "sqrt") return (z) => Math.sqrt(lin(z));
  if (scale === "log") return (z) => Math.log1p(lin(z) * span) / Math.log1p(span);
  const water = hm.waterLevel ?? -Infinity;
  const hist = new Float64Array(BINS);
  let total = 0;
  for (const z of hm.data) {
    if (z <= water) continue;
    hist[Math.min(BINS - 1, Math.floor(lin(z) * BINS))]!++;
    total++;
  }
  // cdf[k] = share of the ground below the start of class k (linear inside a class).
  const cdf = new Float64Array(BINS + 1);
  for (let k = 0; k < BINS; k++) cdf[k + 1] = cdf[k]! + hist[k]! / (total || 1);
  return (z) => {
    const x = lin(z) * BINS, k = Math.min(BINS - 1, Math.floor(x));
    return cdf[k]! + (cdf[k + 1]! - cdf[k]!) * (x - k);
  };
}

/** Balance: t^(2^(−2·b)); b < 0 gives more of the low colour, b > 0 more of the high one. */
export function applyBalance(t: number, balance: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t ** (2 ** (-2 * Math.min(1, Math.max(-1, balance))));
}

/** Altitudes under the legend ramp at positions `at` (bisection on the monotone scale + balance). */
export function reliefTicks(hm: Heightmap, scale: ReliefScale, balance: number, at = [0, 0.25, 0.5, 0.75, 1]): number[] {
  const { min, max } = reliefRange(hm);
  const f = reliefScale(hm, scale);
  return at.map((target) => {
    let lo = min, hi = max;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (applyBalance(f(mid), balance) < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  });
}

/**
 * RGBA pixels (n × n) of the heightmap in the map frame: image columns follow world Y and rows
 * world X (as toMap), so pixel (col j, row i) is cell data[j·n + i]; alpha from the stops' opacity.
 * Water cells are transparent.
 */
export function reliefPixels(hm: Heightmap, stops: ReliefStop[], scale: ReliefScale = "linear", balance = 0): Uint8ClampedArray {
  const { n, data } = hm;
  const f = reliefScale(hm, scale);
  // Transparent on the game's water only (dry ground below the water level keeps its colour).
  const water = waterCells(hm);
  // 256-entry palette: one colour conversion per step, not per pixel.
  const pal = Array.from({ length: 256 }, (_, k) => rampColor(stops, k / 255));
  const out = new Uint8ClampedArray(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const z = data[j * n + i]!, o = (i * n + j) * 4;
      if (water[j * n + i]) continue;
      const c = pal[Math.round(applyBalance(f(z), balance) * 255)]!;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = Math.round(c[3] * 255);
    }
  }
  return out;
}
