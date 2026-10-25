/**
 * Ortho cost model for TileLab estimates: seconds per output megapixel (render + PNG tiles) and
 * bytes per pyramid tile, both per interpolation (a softer image compresses better). Starts from
 * measured defaults and learns from each successful export on this machine (localStorage).
 */
import type { Interp } from "$lib/core/ortho";
import { fmtNum, t } from "$lib/i18n/index.svelte";

const LS_KEY = "hq.orthoSpeed";

/** Full-scale bench (139 MP, Node 22): render s/MP per interpolation + PNG tiles 0.197 s/MP. */
const DEFAULT_SEC_PER_MP: Record<Interp, number> = {
  lanczos3: 0.178 + 0.197,
  bicubic: 0.128 + 0.197,
  bilinear: 0.047 + 0.197,
  nearest: 0.028 + 0.197,
};
/** First real run (Lanczos): 352 MB for 2 839 tiles. */
const DEFAULT_BYTES_PER_TILE = 124_000;

interface Model {
  secPerMp?: Partial<Record<Interp, number>>;
  bytesPerTile?: Partial<Record<Interp, number>> | number;
}

function load(): Model {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}") as Model;
  } catch {
    return {};
  }
}

export function secPerMp(interp: Interp): number {
  return load().secPerMp?.[interp] ?? DEFAULT_SEC_PER_MP[interp];
}

/** Bytes per tile for this interpolation: measured, else the mean of measured ones, else default. */
export function bytesPerTile(interp: Interp): number {
  const b = load().bytesPerTile;
  if (typeof b === "number") return b; // older single-value model
  const own = b?.[interp];
  if (own !== undefined) return own;
  const known = Object.values(b ?? {}).filter((v): v is number => typeof v === "number");
  return known.length ? known.reduce((a, v) => a + v, 0) / known.length : DEFAULT_BYTES_PER_TILE;
}

/** Whether the duration for this interpolation was measured on this machine. */
export function isMeasured(interp: Interp): boolean {
  return load().secPerMp?.[interp] !== undefined;
}

/** Record a finished export (seconds, megapixels, pyramid tiles and bytes). */
export function recordExport(interp: Interp, seconds: number, megapixels: number, tiles: number, bytes: number): void {
  const m = load();
  m.secPerMp = { ...(m.secPerMp ?? {}), [interp]: seconds / Math.max(0.01, megapixels) };
  if (tiles > 0 && bytes > 0) {
    const prev = typeof m.bytesPerTile === "object" ? m.bytesPerTile : {};
    m.bytesPerTile = { ...prev, [interp]: bytes / tiles };
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(m));
  } catch {
    /* storage unavailable */
  }
}

/** Rounded duration for estimates (~45 s, ~3 min). */
export function fmtDuration(sec: number): string {
  if (sec < 90) return `~${Math.max(1, Math.round(sec / 5) * 5)} s`;
  return `~${Math.round(sec / 60)} min`;
}

export function fmtBytes(b: number): string {
  return b >= 1e9 ? t("unit.go", { v: fmtNum(b / 1e9, 1) }) : t("unit.mo", { v: fmtNum(b / 1e6, 0) });
}
