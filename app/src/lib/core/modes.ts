/**
 * Ready-made capture modes (GridLab): about 1, 4, 16 or 64 images. For any game resolution and map,
 * the grid shape follows the map and the image proportions, then the camera (FOV, altitude) and the
 * sun (hour) are solved so that the grid covers the map. Pure: computeMosaic does the geometry.
 */
import { computeMosaic, FOV_V_DEG_MAX, FOV_V_DEG_MIN, sunZenithDeg, type MosaicConfig } from "./geometry";
import type { Heightmap } from "./lua";

export type CaptureMode = "simple" | "x4" | "x16" | "x64";
export type ModeChoice = CaptureMode | "custom";

/** Images aimed at by each mode. */
export const CAPTURE_MODES: Record<CaptureMode, number> = { simple: 1, x4: 4, x16: 16, x64: 64 };
export const MODE_LIST = Object.keys(CAPTURE_MODES) as CaptureMode[];
export const DEFAULT_MODE: CaptureMode = "x16";

/** Above this the game veils the view with a blur (seen in game, ≈ 12 000 m). */
export const Z_MAX_MODE = 12000;
const Z_MIN_MODE = 500;
/** Capture day of the modes (summer: high sun) and the hour window searched for it. */
const MODE_DAY = 171;
const HOUR_MIN = 7, HOUR_MAX = 17;
/** Same rule as GridLab: water glint when the sun is within the view cone + 10°. */
const GLINT_MARGIN_DEG = 10;
/** Extra rows / columns tried when even the widest FOV at the highest altitude does not cover. */
const MAX_GROW = 40;

/**
 * Grid shape (nX rows along world X, nY columns along world Y) for about n images. One image covers
 * W/H as much along Y (screen width) as along X: nY / nX ≈ (map Y / map X) / (W / H).
 */
export function modeGrid(n: number, mapX: number, mapY: number, screenW: number, screenH: number): { nX: number; nY: number } {
  const a = screenW / screenH, m = mapY / mapX;
  const nX = Math.min(n, Math.max(1, Math.round(Math.sqrt((n * a) / m))));
  return { nX, nY: Math.max(1, Math.round(n / nX)) };
}

/** Smallest value in [lo, hi] (rounded up to `step`) for which ok() holds; null if hi fails. */
function smallest(lo: number, hi: number, step: number, ok: (v: number) => boolean): number | null {
  if (!ok(hi)) return null;
  if (ok(lo)) return lo;
  let a = lo, b = hi;
  while (b - a > step / 2) {
    const mid = (a + b) / 2;
    if (ok(mid)) b = mid;
    else a = mid;
  }
  const v = Math.min(hi, Math.ceil(b / step) * step);
  return ok(v) ? v : hi;
}

/** Hour closest to noon without water glint (15 min steps); the least bad one otherwise. */
export function glintFreeHour(maxViewDeg: number, day = MODE_DAY, latDeg = 0): number {
  let best = 12, bestZenith = -1;
  for (let d = 0; d <= (HOUR_MAX - 12) * 4; d++) {
    for (const h of d ? [12 - d / 4, 12 + d / 4] : [12]) {
      if (h < HOUR_MIN || h > HOUR_MAX) continue;
      const z = sunZenithDeg(h * 3600, day, latDeg);
      if (z >= maxViewDeg + GLINT_MARGIN_DEG) return h;
      if (z > bestZenith) [best, bestZenith] = [h, z];
    }
  }
  return best;
}

/**
 * Settings for about n images: grid, then the narrowest FOV covering the map from Z_MAX_MODE (a more
 * vertical view: cleaner seams), or, when even the narrowest FOV covers from there, the lowest
 * altitude that still covers (finer resolution); a row / column more while nothing covers. Then the sun.
 */
function solveFor(n: number, cfg: MosaicConfig, hm: Heightmap): Partial<MosaicConfig> {
  let { nX, nY } = modeGrid(n, hm.width, hm.height, cfg.screenW, cfg.screenH);
  const covers = (patch: Partial<MosaicConfig>) => computeMosaic({ ...cfg, ...patch, GRID_NX: nX, GRID_NY: nY }, hm).covered;
  let fov = FOV_V_DEG_MAX, z = Z_MAX_MODE;
  for (let grow = 0; grow <= MAX_GROW; grow++) {
    const f = smallest(FOV_V_DEG_MIN, FOV_V_DEG_MAX, 0.5, (v) => covers({ FOV_V_DEG: v, Z_EYE: Z_MAX_MODE }));
    if (f !== null) {
      fov = f;
      z = f === FOV_V_DEG_MIN ? smallest(Z_MIN_MODE, Z_MAX_MODE, 100, (v) => covers({ FOV_V_DEG: f, Z_EYE: v })) ?? Z_MAX_MODE : Z_MAX_MODE;
      break;
    }
    // Widest FOV at the highest altitude still leaves a gap: grow the axis that lacks most.
    const mo = computeMosaic({ ...cfg, FOV_V_DEG: FOV_V_DEG_MAX, Z_EYE: Z_MAX_MODE, GRID_NX: nX, GRID_NY: nY }, hm);
    if (mo.deficitX >= mo.deficitY) nX++;
    else nY++;
  }
  const mo = computeMosaic({ ...cfg, FOV_V_DEG: fov, Z_EYE: z, GRID_NX: nX, GRID_NY: nY }, hm);
  return {
    GRID_NX: nX, GRID_NY: nY, FOV_V_DEG: fov, Z_EYE: z,
    CAPTURE_DAY_OF_YEAR: MODE_DAY, CAPTURE_TIME_SEC: Math.round(glintFreeHour(mo.maxView, MODE_DAY, cfg.CAPTURE_LATITUDE || 0) * 3600),
  };
}

const images = (p: Partial<MosaicConfig>) => (p.GRID_NX ?? 1) * (p.GRID_NY ?? 1);

/**
 * Settings of the four modes, solved in one pass. The modes always stay distinct: on a large map
 * the altitude cap forces more images than a mode aims at, so each mode takes at least about twice
 * the images of the one before it (never the same grid twice).
 */
export function modeConfigs(cfg: MosaicConfig, hm: Heightmap): Record<CaptureMode, Partial<MosaicConfig>> {
  const out = {} as Record<CaptureMode, Partial<MosaicConfig>>;
  let prev = 0;
  for (const m of MODE_LIST) {
    let n = Math.max(CAPTURE_MODES[m], 2 * prev);
    let p = solveFor(n, cfg, hm);
    // Grid rounding may land on the previous count: aim higher until it is really more.
    for (let k = 0; images(p) <= prev && k < 20; k++) p = solveFor(++n, cfg, hm);
    out[m] = p;
    prev = images(p);
  }
  return out;
}

/** Settings of one mode (see modeConfigs; the modes before it are solved too). */
export function modeConfig(mode: CaptureMode, cfg: MosaicConfig, hm: Heightmap): Partial<MosaicConfig> {
  return modeConfigs(cfg, hm)[mode];
}

/** What changes the modes' solution (besides the terrain): not their outputs (grid, FOV, altitude, hour). */
export function modeKey(cfg: MosaicConfig): string {
  return [cfg.screenW, cfg.screenH, cfg.FOV_SCALE, cfg.PIXEL_ASPECT, cfg.STEP_SCALE_X, cfg.STEP_SCALE_Y,
    cfg.SEAM_MODE, cfg.COVER_MARGIN_M, cfg.CAPTURE_LATITUDE].join("|");
}
