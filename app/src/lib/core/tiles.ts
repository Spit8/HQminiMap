/**
 * Screenshot → tile naming during a capture run (port of miniMapper watch-screenshots.ps1).
 * TF3 writes screenshots in capture order (cutscene segments: iy outer, ix inner); tiles are
 * renamed tile_pPP_SSS.png with SSS the display order Tile Lab lays out row-major.
 */
import { seqOf } from "./geometry";

/** Screenshots older than this before the run start are ignored (clock skew margin), s. */
export const RUN_START_MARGIN_SEC = 2;
/** A screenshot younger than this may still be written by the game: wait, ms. */
export const MIN_FILE_AGE_MS = 700;
export const IMAGE_EXT = /\.(png|jpe?g|tga)$/i;

export interface TileName {
  pitchIdx: number;
  seq: number;
  ix: number;
  iy: number;
  name: string;
}

/** Name of the n-th screenshot (1-based, chronological) of a run on an nX×nY lattice. */
export function tileNameFor(n: number, nX: number, nY: number, ext = ".png"): TileName {
  const perPitch = nX * nY;
  const pitchIdx = Math.floor((n - 1) / perPitch) + 1;
  const i = (n - 1) % perPitch;
  const ix = i % nX;
  const iy = Math.floor(i / nX);
  const seq = seqOf(nX, nY, ix, iy);
  const name = `tile_p${String(pitchIdx).padStart(2, "0")}_${String(seq).padStart(3, "0")}${ext.toLowerCase()}`;
  return { pitchIdx, seq, ix, iy, name };
}

/** Parse tile_pPP_SSS → { pitchIdx, seq } (TileLab import). */
export function parseTileName(name: string): { pitchIdx: number; seq: number } | null {
  const m = name.match(/^tile_p(\d+)_(\d+)\.\w+$/i);
  return m ? { pitchIdx: +m[1], seq: +m[2] } : null;
}

export interface ShotFile {
  name: string;
  /** Last write time, ms since epoch. */
  mtimeMs: number;
  size: number;
}

/** TF3 screenshot name `YYYY-MM-DD_HH-MM-SS_img_N.ext` → local wall time (unix s) + counter N. */
export function parseShotName(name: string): { time: number; n: number } | null {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})_img_(\d+)\.\w+$/i);
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() / 1000;
  return { time: t, n: +m[7] };
}

/** Screenshot accepted for a shot taken at shotTime (s): [shotTime − before, shotTime + after]. */
export const SHOT_MATCH_BEFORE_SEC = 1;
export const SHOT_MATCH_AFTER_SEC = 2;

export interface ShotMatch<T> {
  /** File per capture index tile (chrono order), null when not found (yet). */
  matches: (T | null)[];
  /** Images taken during the run that belong to no tile (manual player screenshots). */
  extras: T[];
}

/**
 * Pair each capture tile (shot wall time from capture_index, unix s) with its screenshot, using the
 * time in the file name (else mtime) and the game counter `img_N` for order. Pairing is monotonic:
 * tile k+1 always gets a later file than tile k. Files younger than MIN_FILE_AGE_MS are skipped.
 */
export function matchShots<T extends ShotFile>(files: T[], shotTimes: number[], nowMs: number): ShotMatch<T> {
  if (!shotTimes.length) return { matches: [], extras: [] };
  const lo = Math.min(...shotTimes) - SHOT_MATCH_BEFORE_SEC;
  const hi = Math.max(...shotTimes) + SHOT_MATCH_AFTER_SEC;
  const keyed = files
    .filter((f) => IMAGE_EXT.test(f.name) && nowMs - f.mtimeMs >= MIN_FILE_AGE_MS)
    .map((f) => {
      const p = parseShotName(f.name);
      return { f, time: p ? p.time : Math.floor(f.mtimeMs / 1000), n: p ? p.n : -1 };
    })
    .filter((k) => k.time >= lo && k.time <= hi)
    .sort((a, b) => a.time - b.time || a.n - b.n || a.f.mtimeMs - b.f.mtimeMs);
  // Write lag (file time − shot time, usually 0 or 1 s): the lag that gives the most tiles an
  // exact-second file. Then each tile takes the candidate closest to shotTime + lag, so a manual
  // screenshot taken in the same window does not steal the tile's image.
  const times = new Set(keyed.map((k) => k.time));
  let lag = 0, bestHits = -1;
  for (let L = -SHOT_MATCH_BEFORE_SEC; L <= SHOT_MATCH_AFTER_SEC; L++) {
    const hits = shotTimes.filter((t) => times.has(t + L)).length;
    if (hits > bestHits || (hits === bestHits && Math.abs(L) < Math.abs(lag))) {
      bestHits = hits;
      lag = L;
    }
  }
  const pass = (lag: number) => {
    const picked: number[] = [];
    let from = 0;
    for (const t of shotTimes) {
      let hit = -1, best = Infinity;
      for (let i = from; i < keyed.length; i++) {
        if (keyed[i].time > t + SHOT_MATCH_AFTER_SEC) break;
        if (keyed[i].time < t - SHOT_MATCH_BEFORE_SEC) continue;
        const d = Math.abs(keyed[i].time - (t + lag));
        if (d < best) { best = d; hit = i; }
      }
      picked.push(hit);
      if (hit >= 0) from = hit + 1;
    }
    return picked;
  };
  const picked = pass(lag);
  const used = new Set(picked.filter((i) => i >= 0));
  const matches = picked.map((i) => (i >= 0 ? keyed[i].f : null));
  // Extras only between the first and the last matched tile (later files may be the next tiles).
  const lastUsed = Math.max(-1, ...used);
  const extras = keyed.filter((_, i) => !used.has(i) && i < lastUsed).map((k) => k.f);
  return { matches, extras };
}

/**
 * Screenshots belonging to the run started at `startedAt` (unix s), in capture order. Files still
 * being written (younger than MIN_FILE_AGE_MS at `nowMs`) stop the list so ranks never shift.
 */
export function runShots<T extends ShotFile>(files: T[], startedAt: number, nowMs: number): T[] {
  const since = (startedAt - RUN_START_MARGIN_SEC) * 1000;
  const sorted = files
    .filter((f) => IMAGE_EXT.test(f.name) && f.mtimeMs >= since)
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
  const out: T[] = [];
  for (const f of sorted) {
    if (nowMs - f.mtimeMs < MIN_FILE_AGE_MS) break;
    out.push(f);
  }
  return out;
}
