/**
 * Orthorectified mosaic from the x1 nadir captures (port of miniMapper Tile Lab "MiniOrtho").
 * Camera = pinhole v3: for a ground point (X, Y, z) seen from tile centre (cx, cy, zEye),
 *   d = zEye − z,  u = W/2 + fx·(Y − cy)/d  (screen right = +Y),  v = H/2 + fy·(X − cx)/d  (down = +X)
 *   fy = (H/2)/tan(fovV/2), fx = fy / pixelAspect — pixel centres at (i + 0.5).
 * Output pixel (p, q) ↔ Y = minY + (p + 0.5)·gsd, X = minX + (q + 0.5)·gsd (tile orientation).
 * Each output pixel comes from the tile whose centre is nearest per axis (least parallax), with a
 * 3×3 neighbour fallback when the point falls outside that image. Pure: no DOM, no I/O.
 */
import { heightAt, seqOf } from "./geometry";
import type { Heightmap, PlanInfo } from "./lua";

export const INTERPS = ["lanczos3", "bicubic", "bilinear", "nearest"] as const;
export type Interp = (typeof INTERPS)[number];

/** Decoded RGBA tile (row-major, 4 bytes per pixel). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

const LANCZOS_A = 3;
const LUT_RES = 1024;
const LANCZOS_LUT = (() => {
  const t = new Float64Array(LANCZOS_A * LUT_RES + 2);
  for (let k = 0; k < t.length; k++) {
    const x = k / LUT_RES;
    if (x === 0) t[k] = 1;
    else if (x >= LANCZOS_A) t[k] = 0;
    else {
      const px = Math.PI * x;
      t[k] = (LANCZOS_A * Math.sin(px) * Math.sin(px / LANCZOS_A)) / (px * px);
    }
  }
  return t;
})();
const lanczos = (x: number) => {
  const ax = Math.abs(x);
  return ax >= LANCZOS_A ? 0 : LANCZOS_LUT[Math.round(ax * LUT_RES)];
};
/** Catmull-Rom (Keys a = −0.5). */
const cubic = (x: number) => {
  const ax = Math.abs(x);
  if (ax < 1) return 1.5 * ax * ax * ax - 2.5 * ax * ax + 1;
  if (ax < 2) return -0.5 * ax * ax * ax + 2.5 * ax * ax - 4 * ax + 2;
  return 0;
};

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Sampler: writes RGBA at out[o] for continuous pixel coords (u, v); false if outside the image. */
export type Sampler = (img: RgbaImage | null, u: number, v: number, out: Uint8ClampedArray, o: number) => boolean;

export function makeSampler(interp: Interp): Sampler {
  const inside = (img: RgbaImage | null, x: number, y: number): img is RgbaImage =>
    !!img && x >= 0 && y >= 0 && x <= img.width - 1 && y <= img.height - 1;
  if (interp === "nearest") {
    return (img, u, v, out, o) => {
      const x = u - 0.5, y = v - 0.5;
      if (!inside(img, x, y)) return false;
      const k = (Math.round(y) * img.width + Math.round(x)) * 4, d = img.data;
      out[o] = d[k]; out[o + 1] = d[k + 1]; out[o + 2] = d[k + 2]; out[o + 3] = 255;
      return true;
    };
  }
  if (interp === "bilinear") {
    return (img, u, v, out, o) => {
      const x = u - 0.5, y = v - 0.5;
      if (!inside(img, x, y)) return false;
      const x0 = Math.min(img.width - 2, Math.floor(x)), y0 = Math.min(img.height - 2, Math.floor(y));
      const tx = x - x0, ty = y - y0, d = img.data, rw = img.width * 4;
      const k = y0 * rw + x0 * 4;
      for (let c = 0; c < 3; c++) {
        const a = d[k + c] + (d[k + 4 + c] - d[k + c]) * tx;
        const b = d[k + rw + c] + (d[k + rw + 4 + c] - d[k + rw + c]) * tx;
        out[o + c] = a + (b - a) * ty;
      }
      out[o + 3] = 255;
      return true;
    };
  }
  // Separable kernels: taps ix−r+1 … ix+r, normalised weights (Lanczos is not partition-of-unity).
  const r = interp === "bicubic" ? 2 : LANCZOS_A;
  const kern = interp === "bicubic" ? cubic : lanczos;
  const n = 2 * r;
  const wx = new Float64Array(n), wy = new Float64Array(n);
  const cx = new Int32Array(n), cy = new Int32Array(n);
  return (img, u, v, out, o) => {
    const x = u - 0.5, y = v - 0.5;
    if (!inside(img, x, y)) return false;
    const W = img.width, H = img.height, d = img.data;
    const ix = Math.floor(x), iy = Math.floor(y);
    let sx = 0, sy = 0;
    for (let t = 0; t < n; t++) {
      const kx = ix - r + 1 + t, ky = iy - r + 1 + t;
      wx[t] = kern(x - kx); sx += wx[t];
      wy[t] = kern(y - ky); sy += wy[t];
      cx[t] = (kx < 0 ? 0 : kx >= W ? W - 1 : kx) * 4;
      cy[t] = (ky < 0 ? 0 : ky >= H ? H - 1 : ky) * W * 4;
    }
    let r0 = 0, g0 = 0, b0 = 0;
    for (let j = 0; j < n; j++) {
      const row = cy[j], wj = wy[j];
      let rr = 0, gg = 0, bb = 0;
      for (let i = 0; i < n; i++) {
        const k = row + cx[i], w = wx[i];
        rr += d[k] * w; gg += d[k + 1] * w; bb += d[k + 2] * w;
      }
      r0 += rr * wj; g0 += gg * wj; b0 += bb * wj;
    }
    const norm = 1 / (sx * sy);
    out[o] = clamp8(r0 * norm); out[o + 1] = clamp8(g0 * norm); out[o + 2] = clamp8(b0 * norm); out[o + 3] = 255;
    return true;
  };
}

function nearestIndex(list: number[], v: number): number {
  let best = 0, bd = Infinity;
  for (let k = 0; k < list.length; k++) {
    const dd = Math.abs(list[k] - v);
    if (dd < bd) { bd = dd; best = k; }
  }
  return best;
}

export interface OrthoStats {
  holes: number;
  fallback: number;
}

/** Render geometry for one run; renderBand() fills output rows using already-decoded tiles. */
export class OrthoRenderer {
  readonly outW: number;
  readonly outH: number;
  readonly stats: OrthoStats = { holes: 0, fallback: 0 };
  private readonly fx: number;
  private readonly fy: number;
  private readonly xs: number[];
  private readonly ys: number[];
  private readonly iyOfCol: Int32Array;
  private readonly sample: Sampler;

  constructor(
    readonly plan: PlanInfo,
    readonly hm: Heightmap,
    readonly gsd: number,
    interp: Interp = "lanczos3",
  ) {
    this.fy = plan.screenH / 2 / Math.tan((plan.fovV * Math.PI) / 180 / 2);
    this.fx = this.fy / plan.pixelAspect;
    this.xs = [];
    this.ys = [];
    for (let ix = 0; ix < plan.nX; ix++) this.xs.push(plan.centers[ix].x);
    for (let iy = 0; iy < plan.nY; iy++) this.ys.push(plan.centers[iy * plan.nX].y);
    this.outW = Math.max(1, Math.round(hm.height / gsd)); // columns ↔ world Y
    this.outH = Math.max(1, Math.round(hm.width / gsd)); // rows ↔ world X
    this.iyOfCol = new Int32Array(this.outW);
    for (let p = 0; p < this.outW; p++) this.iyOfCol[p] = nearestIndex(this.ys, hm.minY + (p + 0.5) * gsd);
    this.sample = makeSampler(interp);
  }

  /** Display seqs (tile_pXX_SSS) the rows [q0, q0+rows) may read: nearest row ±1, all columns. */
  seqsForRows(q0: number, rows: number): number[] {
    const a = nearestIndex(this.xs, this.hm.minX + (q0 + 0.5) * this.gsd);
    const b = nearestIndex(this.xs, this.hm.minX + (q0 + rows - 0.5) * this.gsd);
    const lo = Math.max(0, Math.min(a, b) - 1), hi = Math.min(this.plan.nX - 1, Math.max(a, b) + 1);
    const out: number[] = [];
    for (let ix = lo; ix <= hi; ix++) {
      for (let iy = 0; iy < this.plan.nY; iy++) out.push(seqOf(this.plan.nX, this.plan.nY, ix, iy));
    }
    return out;
  }

  /** Fill `out` (rows·outW·4) for output rows [q0, q0+rows); tiles by display seq. */
  renderBand(q0: number, rows: number, tile: (seq: number) => RgbaImage | null, out: Uint8ClampedArray): void {
    const { plan, hm, gsd, xs, ys, fx, fy } = this;
    const W = plan.screenW, H = plan.screenH, zEye = plan.zEye;
    const proj = (ix: number, iy: number, X: number, Y: number, d: number, o: number) =>
      this.sample(tile(seqOf(plan.nX, plan.nY, ix, iy)),
        W / 2 + (fx * (Y - ys[iy])) / d, H / 2 + (fy * (X - xs[ix])) / d, out, o);
    for (let r = 0; r < rows; r++) {
      const X = hm.minX + (q0 + r + 0.5) * gsd;
      const ixN = nearestIndex(xs, X);
      for (let p = 0; p < this.outW; p++) {
        const Y = hm.minY + (p + 0.5) * gsd;
        const d = zEye - heightAt(hm, X, Y);
        const o = (r * this.outW + p) * 4;
        const iyN = this.iyOfCol[p];
        if (proj(ixN, iyN, X, Y, d, o)) continue;
        let ok = false;
        for (let di = -1; di <= 1 && !ok; di++) {
          for (let dj = -1; dj <= 1 && !ok; dj++) {
            const ix = ixN + di, iy = iyN + dj;
            if ((di || dj) && ix >= 0 && iy >= 0 && ix < plan.nX && iy < plan.nY) ok = proj(ix, iy, X, Y, d, o);
          }
        }
        if (ok) this.stats.fallback++;
        else {
          this.stats.holes++;
          out[o + 3] = 0;
        }
      }
    }
  }
}
