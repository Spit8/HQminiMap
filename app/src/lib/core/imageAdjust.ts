/**
 * Map image adjustments (Visualiser): brightness, contrast, saturation and gamma, applied by the
 * WebGL tile layer to the whole displayed ortho (never tile by tile). "Auto" derives them once from
 * the global overview (ortho.png): a levels stretch on the luminance percentiles, a gamma bringing
 * the median to mid-grey, and a saturation boost for dull images.
 *
 * OpenLayers' shader order and formulas (ol/layer/WebGLTile): contrast  y = (c + 1)·x − c/2,
 * saturation (luminance mix), gamma  y = x^(1/g), brightness  y = x + b — each clamped to [0, 1].
 */

export interface ImageAdjust {
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
}

export const NEUTRAL: ImageAdjust = { brightness: 0, contrast: 0, saturation: 0, gamma: 1 };

/** Slider ranges (UI) — auto values stay inside them. */
export const RANGES: Record<keyof ImageAdjust, { min: number; max: number; step: number }> = {
  brightness: { min: -0.5, max: 0.5, step: 0.01 },
  contrast: { min: -0.5, max: 0.8, step: 0.01 },
  saturation: { min: -1, max: 1, step: 0.01 },
  gamma: { min: 0.5, max: 2, step: 0.01 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Value of the sorted array at quantile q (0..1). */
function quantile(sorted: Float32Array, q: number): number {
  if (!sorted.length) return 0.5;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;
}

/**
 * Auto settings from RGBA pixels of the whole map (any size; pixels with alpha < 8 — holes outside
 * the map — are ignored).
 */
export function autoAdjust(rgba: ArrayLike<number>): ImageAdjust {
  const n = Math.floor(rgba.length / 4);
  const lum = new Float32Array(n);
  let count = 0, chroma = 0;
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3]! < 8) continue;
    const r = rgba[i * 4]! / 255, g = rgba[i * 4 + 1]! / 255, b = rgba[i * 4 + 2]! / 255;
    lum[count++] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    chroma += Math.max(r, g, b) - Math.min(r, g, b);
  }
  if (!count) return { ...NEUTRAL };
  const l = lum.subarray(0, count).sort();
  const lo = quantile(l, 0.01), hi = quantile(l, 0.99), med = quantile(l, 0.5);

  // Levels: widen the 1–99 % range to ~0.92 of the scale (contrast is centred on 0.5).
  const k = clamp(0.92 / Math.max(0.05, hi - lo), 0.8, 1.8);
  const contrast = clamp(k - 1, RANGES.contrast.min, RANGES.contrast.max);
  const after = (x: number) => clamp((contrast + 1) * x - contrast / 2, 0.001, 0.999);
  // Gamma: the median (after contrast) towards mid-grey.
  const m = after(med);
  const gamma = clamp(Math.log(m) / Math.log(0.5), 0.7, 1.5);
  // Brightness: half of what is left to centre the mean.
  let mean = 0;
  for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 4096))) mean += after(l[i]!) ** (1 / gamma);
  mean /= Math.ceil(count / Math.max(1, Math.floor(count / 4096)));
  const brightness = clamp((0.5 - mean) * 0.5, -0.15, 0.15);
  // Saturation: lift dull images (mean chroma < 0.18), never more than +0.35.
  const meanChroma = chroma / count;
  const saturation = clamp(((0.18 - meanChroma) / 0.18) * 0.35, 0, 0.35);

  return { brightness: round2(brightness), contrast: round2(contrast), saturation: round2(saturation), gamma: round2(gamma) };
}

/** Same values (two decimals)? */
export const sameAdjust = (a: ImageAdjust, b: ImageAdjust) =>
  (Object.keys(NEUTRAL) as (keyof ImageAdjust)[]).every((k) => round2(a[k]) === round2(b[k]));
