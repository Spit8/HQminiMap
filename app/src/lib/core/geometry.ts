/**
 * Mosaic geometry — typed port of the miniMapper reference (gen_mosaic_cutscene.py /
 * scripts/shared/mm_geometry.js): pinhole v3 camera, seam heights, centre lattice, coverage.
 * Verified against the reference generator by test/geometry.test.ts (golden JSON).
 *
 * Axes: world X ↔ screen vertical (rows, nX), world Y ↔ screen horizontal (cols, nY).
 */
import type { Bounds, Heightmap } from "./lua";

/** CameraFrame validated FOV range (°) for HQminiMap v1 (x16 probe v3, fovScale 1.00000). */
export const FOV_V_DEG_MIN = 10;
export const FOV_V_DEG_MAX = 66;
/** Fixed-point passes: seam position ↔ seam height. */
export const SEAM_ITER = 4;
const EDGE_STEPS = 32;
/** Grid search limit for the minimal covering grid. */
const MAX_GRID = 200;

export type SeamMode = "cover" | "per_seam" | "constant";

/** Same keys as the reference mosaic_config.json. */
export interface MosaicConfig {
  Z_EYE: number;
  FOV_V_DEG: number;
  FOV_SCALE: number;
  PIXEL_ASPECT: number;
  GRID_NX: number;
  GRID_NY: number;
  STEP_SCALE_X: number;
  STEP_SCALE_Y: number;
  SEAM_MODE: SeamMode;
  COVER_MARGIN_M: number;
  CAPTURE_TIME_SEC: number;
  CAPTURE_DAY_OF_YEAR: number;
  CAPTURE_LATITUDE: number;
  screenW: number;
  screenH: number;
  /** Capture timing (s), optional: plan.ts constants when absent (see CAPTURE_PRESETS). */
  SEG_DUR?: number;
  SHOT_OFFSET?: number;
  ENV_SETTLE_SEC?: number;
  /** Name of the timing preset (traced in the plan). */
  SPEED_PRESET?: string;
  /** Screen size follows the game's latest screenshot (default); false once chosen by hand. */
  SCREEN_AUTO?: boolean;
}

export const DEFAULT_CONFIG: MosaicConfig = {
  Z_EYE: 5000,
  FOV_V_DEG: 15,
  FOV_SCALE: 1,
  PIXEL_ASPECT: 1,
  GRID_NX: 12,
  GRID_NY: 5,
  STEP_SCALE_X: 1,
  STEP_SCALE_Y: 1,
  SEAM_MODE: "cover",
  COVER_MARGIN_M: 5,
  CAPTURE_TIME_SEC: 36000,
  CAPTURE_DAY_OF_YEAR: 171,
  CAPTURE_LATITUDE: 0,
  screenW: 2560,
  screenH: 1080,
};

/** Python statistics.median (mean of the two middle values for an even count). */
export function median(values: ArrayLike<number>): number {
  const a = Float64Array.from(values).sort();
  const k = a.length;
  if (!k) return NaN;
  return k % 2 ? a[(k - 1) / 2] : (a[k / 2 - 1] + a[k / 2]) / 2;
}

/** Bilinear ground height at (x, y), clamped to the grid (ortho reprojection). */
export function heightAt(hm: Heightmap, x: number, y: number): number {
  const n = hm.n;
  let fi = (x - hm.minX) / hm.cellX - 0.5;
  let fj = (y - hm.minY) / hm.cellY - 0.5;
  fi = fi < 0 ? 0 : fi > n - 1 ? n - 1 : fi;
  fj = fj < 0 ? 0 : fj > n - 1 ? n - 1 : fj;
  const i0 = Math.min(n - 2, Math.floor(fi)), j0 = Math.min(n - 2, Math.floor(fj));
  const ti = fi - i0, tj = fj - j0;
  const d = hm.data, k = j0 * n + i0;
  const a = d[k] + (d[k + 1] - d[k]) * ti;
  const c = d[k + n] + (d[k + n + 1] - d[k + n]) * ti;
  return a + (c - a) * tj;
}

/** Visible terrain height along a seam line (constant world X = column, constant Y = row). */
export class SeamSampler {
  private readonly n: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly stepX: number;
  private readonly stepY: number;
  private readonly colMed: Float64Array;
  private readonly colMax: Float64Array;
  private readonly rowMed: Float64Array;
  private readonly rowMax: Float64Array;

  constructor(hm: Heightmap, private readonly fallback: number) {
    const n = (this.n = hm.n);
    this.minX = hm.minX;
    this.minY = hm.minY;
    this.stepX = hm.width / n;
    this.stepY = hm.height / n;
    this.colMed = new Float64Array(n);
    this.colMax = new Float64Array(n);
    this.rowMed = new Float64Array(n);
    this.rowMax = new Float64Array(n);
    const col = new Float64Array(n), row = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      let cMax = -Infinity, rMax = -Infinity;
      for (let t = 0; t < n; t++) {
        col[t] = hm.data[t * n + k];
        row[t] = hm.data[k * n + t];
        if (col[t] > cMax) cMax = col[t];
        if (row[t] > rMax) rMax = row[t];
      }
      this.colMed[k] = median(col);
      this.colMax[k] = cMax;
      this.rowMed[k] = median(row);
      this.rowMax[k] = rMax;
    }
  }

  private has(k: number): boolean {
    return k >= 0 && k < this.n;
  }

  atX(x: number): number {
    const i = Math.floor((x - this.minX) / this.stepX);
    return this.has(i) ? this.colMed[i] : this.fallback;
  }

  atY(y: number): number {
    const j = Math.floor((y - this.minY) / this.stepY);
    return this.has(j) ? this.rowMed[j] : this.fallback;
  }

  private bracketMax(v: number, v0: number, step: number, arr: Float64Array): number {
    const k = Math.floor((v - v0) / step - 0.5);
    let best = -Infinity, any = false;
    for (const t of [k, k + 1]) if (this.has(t)) { best = Math.max(best, arr[t]); any = true; }
    return any ? best : this.fallback;
  }

  maxX(x: number): number {
    return this.bracketMax(x, this.minX, this.stepX, this.colMax);
  }

  maxY(y: number): number {
    return this.bracketMax(y, this.minY, this.stepY, this.rowMax);
  }

  private rangeMax(a: number, b: number, v0: number, step: number, arr: Float64Array): number {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const k0 = Math.floor((lo - v0) / step), k1 = Math.floor((hi - v0) / step);
    let best = -Infinity, any = false;
    for (let t = k0; t <= k1; t++) if (this.has(t)) { best = Math.max(best, arr[t]); any = true; }
    return any ? best : this.fallback;
  }

  maxXRange(a: number, b: number): number {
    return this.rangeMax(a, b, this.minX, this.stepX, this.colMax);
  }

  maxYRange(a: number, b: number): number {
    return this.rangeMax(a, b, this.minY, this.stepY, this.rowMax);
  }
}

/** Angle (rad) wrapped to [-π, π). */
export function wrapPi(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** CameraFrame.fovY key (radians, negative = orientation Tile Lab expects) for a vertical FOV. */
export function fovKey(fovVDeg: number): number {
  return (-fovVDeg * Math.PI) / 180;
}

/** Vertical optical FOV (°) TF3 renders for a CameraFrame.fovY key. */
export function opticalFovDeg(key: number, fovScale: number): number {
  return (fovScale * Math.abs(wrapPi(key)) * 180) / Math.PI;
}

export interface Pinhole {
  fovV: number;
  fovH: number;
  tanV: number;
  tanH: number;
  h: number;
  /** Footprint along world X (screen vertical), m. */
  viewX: number;
  /** Footprint along world Y (screen horizontal), m. */
  viewY: number;
  gsdX: number;
  gsdY: number;
}

/** Single pinhole, H derived from V (probe v3: fovScale 1, square pixels, cu/cv 0). */
export function pinhole(key: number, fovScale: number, pixelAspect: number, zEye: number,
  zRef: number, screenW: number, screenH: number): Pinhole {
  const fovV = opticalFovDeg(key, fovScale);
  const tanV = Math.tan((fovV * Math.PI) / 180 / 2);
  const tanH = tanV * (screenW / screenH) * pixelAspect;
  const fovH = (2 * Math.atan(tanH) * 180) / Math.PI;
  const h = zEye - zRef;
  const viewX = 2 * h * tanV, viewY = 2 * h * tanH;
  return { fovV, fovH, tanV, tanH, h, viewX, viewY, gsdX: viewX / screenH, gsdY: viewY / screenW };
}

/** Centres along one axis from per-seam ground heights; index 0 = largest coordinate. */
export function axisCenters(mapC: number, seamZ: number[], zEye: number, tanHalf: number,
  stepScale: number): number[] {
  const rel = [0];
  for (const z of seamZ) rel.push(rel[rel.length - 1] - 2 * (zEye - z) * tanHalf * stepScale);
  const off = mapC - 0.5 * (rel[0] + rel[rel.length - 1]);
  return rel.map((r) => r + off);
}

/** Fixed point: seam heights sampled at the midpoint of the tiles they join. */
export function solveSeams(n: number, mapC: number, zRef: number, zEye: number, tanHalf: number,
  stepScale: number, sample: (v: number) => number): number[] {
  let seamZ: number[] = new Array(Math.max(0, n - 1)).fill(zRef);
  for (let it = 0; it < SEAM_ITER; it++) {
    const cs = axisCenters(mapC, seamZ, zEye, tanHalf, stepScale);
    seamZ = seamZ.map((_, k) => sample(0.5 * (cs[k] + cs[k + 1])));
  }
  return seamZ;
}

/** Worst uncovered distance (m) at both map edges of one axis; <= 0 means covered. */
export function edgeDeficit(cs: number[], lo: number, hi: number, zEye: number, tanHalf: number,
  stripMax: (a: number, b: number) => number): number {
  let worst = -Infinity;
  const last = cs[cs.length - 1];
  for (const [c, edge, outside] of [[cs[0], hi, cs[0] >= hi], [last, lo, last <= lo]] as const) {
    // Outer centre beyond the map edge: covered by it or its overlapping inner neighbour.
    if (outside) continue;
    for (let k = 1; k <= EDGE_STEPS; k++) {
      const v = c + ((edge - c) * k) / EDGE_STEPS;
      const z = stripMax(c + ((edge - c) * (k - 1)) / EDGE_STEPS, v);
      worst = Math.max(worst, Math.abs(v - c) - (zEye - z) * tanHalf);
    }
  }
  return worst;
}

/** Solar zenith angle (°), standard declination / hour-angle model. */
export function sunZenithDeg(timeSec: number, day: number, latDeg: number): number {
  const rad = Math.PI / 180;
  const decl = 23.44 * Math.sin((2 * Math.PI * (284 + day)) / 365) * rad;
  const hour = 15 * (timeSec / 3600 - 12) * rad;
  const lat = latDeg * rad;
  const cz = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hour);
  return Math.acos(Math.max(-1, Math.min(1, cz))) / rad;
}

/** Display seq of lattice cell (ix, iy) — tile_pXX_SEQ naming used by TileLab. */
export function seqOf(nX: number, nY: number, ix: number, iy: number): number {
  return (nX - 1 - ix) * nY + (nY - 1 - iy) + 1;
}

export interface Mosaic {
  config: MosaicConfig;
  geo: Pinhole;
  key: number;
  zRef: number;
  bounds: Bounds;
  mapCx: number;
  mapCy: number;
  seamMode: SeamMode;
  seamZX: number[];
  seamZY: number[];
  /** Row centres (world X), index 0 = largest X. */
  cx: number[];
  /** Column centres (world Y), index 0 = largest Y. */
  cy: number[];
  /** Capture order (cutscene segments): iy outer, ix inner. */
  centers: { x: number; y: number; ix: number; iy: number }[];
  overlapX: number[];
  overlapY: number[];
  deficitX: number;
  deficitY: number;
  covered: boolean;
  /** Grid needed from the current one when it does not cover (reference generator semantics). */
  minGrid: { nX: number; nY: number } | null;
  /** Smallest covering grid, always computed (GridLab « Min » button). */
  bestGrid: { nX: number; nY: number };
  stepX: number;
  stepY: number;
  sunZenith: number;
  maxView: number;
}

function boundsOf(hm: Heightmap): Bounds {
  return {
    minX: hm.minX, maxX: hm.minX + hm.width, minY: hm.minY, maxY: hm.minY + hm.height,
    width: hm.width, height: hm.height,
  };
}

/**
 * Whole lattice for a config: seam heights, centres, overlaps, coverage deficits, minimal grid.
 * Without terrain, seams fall back to zRef (constant mode).
 */
export function computeMosaic(cfg: MosaicConfig, hm: Heightmap | null,
  opts: { zRef?: number; bounds?: Bounds } = {}): Mosaic {
  const W = cfg.screenW, H = cfg.screenH;
  const key = fovKey(cfg.FOV_V_DEG);
  const zRef = Number.isFinite(opts.zRef) ? (opts.zRef as number) : hm ? median(hm.data) : 0;
  const geo = pinhole(key, cfg.FOV_SCALE, cfg.PIXEL_ASPECT, cfg.Z_EYE, zRef, W, H);
  const bounds = hm ? boundsOf(hm) : opts.bounds;
  if (!bounds) throw new Error("computeMosaic: terrain or bounds required");
  const mapCx = 0.5 * (bounds.minX + bounds.maxX), mapCy = 0.5 * (bounds.minY + bounds.maxY);
  const sampler = hm ? new SeamSampler(hm, zRef) : null;
  const margin = cfg.COVER_MARGIN_M || 0;

  const seamsFor = (nx: number, ny: number): { zx: number[]; zy: number[]; mode: SeamMode } => {
    let fx: (v: number) => number, fy: (v: number) => number;
    if (sampler && cfg.SEAM_MODE === "cover") {
      fx = (x) => sampler.maxX(x) + margin;
      fy = (y) => sampler.maxY(y) + margin;
    } else if (sampler && cfg.SEAM_MODE === "per_seam") {
      fx = (x) => sampler.atX(x);
      fy = (y) => sampler.atY(y);
    } else {
      return { zx: new Array(nx - 1).fill(zRef), zy: new Array(ny - 1).fill(zRef), mode: "constant" };
    }
    return {
      zx: solveSeams(nx, mapCx, zRef, cfg.Z_EYE, geo.tanV, cfg.STEP_SCALE_X, fx),
      zy: solveSeams(ny, mapCy, zRef, cfg.Z_EYE, geo.tanH, cfg.STEP_SCALE_Y, fy),
      mode: cfg.SEAM_MODE,
    };
  };
  const deficits = (nx: number, ny: number): [number, number] => {
    const s = seamsFor(nx, ny);
    const cx = axisCenters(mapCx, s.zx, cfg.Z_EYE, geo.tanV, cfg.STEP_SCALE_X);
    const cy = axisCenters(mapCy, s.zy, cfg.Z_EYE, geo.tanH, cfg.STEP_SCALE_Y);
    const fx = sampler ? (a: number, b: number) => sampler.maxXRange(a, b) : () => zRef;
    const fy = sampler ? (a: number, b: number) => sampler.maxYRange(a, b) : () => zRef;
    return [
      edgeDeficit(cx, bounds.minX, bounds.maxX, cfg.Z_EYE, geo.tanV, fx),
      edgeDeficit(cy, bounds.minY, bounds.maxY, cfg.Z_EYE, geo.tanH, fy),
    ];
  };

  const nX = cfg.GRID_NX, nY = cfg.GRID_NY;
  const [dx, dy] = deficits(nX, nY);
  let minGrid: Mosaic["minGrid"] = null;
  if (dx > 0 || dy > 0) {
    let needX = nX, needY = nY;
    while (deficits(needX, nY)[0] > 0 && needX < MAX_GRID) needX++;
    while (deficits(nX, needY)[1] > 0 && needY < MAX_GRID) needY++;
    minGrid = { nX: needX, nY: needY };
  }
  // Smallest grid covering the map, whatever the current one (each axis on its own: the X
  // deficit only depends on nX, the Y deficit on nY).
  let bestX = 1, bestY = 1;
  while (deficits(bestX, nY)[0] > 0 && bestX < MAX_GRID) bestX++;
  while (deficits(nX, bestY)[1] > 0 && bestY < MAX_GRID) bestY++;
  const bestGrid = { nX: bestX, nY: bestY };
  const s = seamsFor(nX, nY);
  const cx = axisCenters(mapCx, s.zx, cfg.Z_EYE, geo.tanV, cfg.STEP_SCALE_X);
  const cy = axisCenters(mapCy, s.zy, cfg.Z_EYE, geo.tanH, cfg.STEP_SCALE_Y);
  const centers: Mosaic["centers"] = [];
  for (let iy = 0; iy < nY; iy++) for (let ix = 0; ix < nX; ix++) centers.push({ x: cx[ix], y: cy[iy], ix, iy });
  return {
    config: cfg, geo, key, zRef, bounds, mapCx, mapCy, seamMode: s.mode, seamZX: s.zx, seamZY: s.zy,
    cx, cy, centers,
    overlapX: cx.slice(0, -1).map((c, k) => 100 * (1 - (c - cx[k + 1]) / geo.viewX)),
    overlapY: cy.slice(0, -1).map((c, k) => 100 * (1 - (c - cy[k + 1]) / geo.viewY)),
    deficitX: dx, deficitY: dy, covered: !(dx > 0 || dy > 0), minGrid, bestGrid,
    stepX: nX > 1 ? (cx[0] - cx[nX - 1]) / (nX - 1) : geo.viewX * cfg.STEP_SCALE_X,
    stepY: nY > 1 ? (cy[0] - cy[nY - 1]) / (nY - 1) : geo.viewY * cfg.STEP_SCALE_Y,
    sunZenith: sunZenithDeg(cfg.CAPTURE_TIME_SEC, cfg.CAPTURE_DAY_OF_YEAR, cfg.CAPTURE_LATITUDE || 0),
    maxView: (Math.atan(Math.hypot(geo.tanV, geo.tanH)) * 180) / Math.PI,
  };
}
