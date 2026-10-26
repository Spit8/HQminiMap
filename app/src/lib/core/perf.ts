/**
 * Performance levels from what the Visualiser holds and costs: JS memory (share of the heap limit),
 * drawn objects, time of a map update. "busy" and "critical" simplify the display (see
 * PERF_CAPS); a level is left only once every measure is back under 80 % of its threshold, so the
 * display does not flip back and forth around a threshold.
 */

export type PerfLevel = "ok" | "busy" | "critical";

export interface PerfSample {
  /** Used / limit of the JS heap (0..1), null when the browser does not tell. */
  memory: number | null;
  /** Objects drawn on the map (all live layers). */
  objects: number;
  /** Duration of the last map update, ms. */
  updateMs: number;
}

export const PERF_THRESHOLDS: Record<Exclude<PerfLevel, "ok">, PerfSample & { memory: number }> = {
  busy: { memory: 0.6, objects: 25_000, updateMs: 150 },
  critical: { memory: 0.8, objects: 50_000, updateMs: 400 },
};

/** Share of a threshold a measure must fall under to leave its level. */
export const PERF_HYSTERESIS = 0.8;

const over = (s: PerfSample, t: PerfSample & { memory: number }, k = 1) =>
  (s.memory !== null && s.memory > t.memory * k) || s.objects > t.objects * k || s.updateMs > t.updateMs * k;

/** Level for a sample, given the current level (hysteresis on the way down). */
export function perfLevel(s: PerfSample, current: PerfLevel): PerfLevel {
  if (over(s, PERF_THRESHOLDS.critical)) return "critical";
  if (current === "critical" && over(s, PERF_THRESHOLDS.critical, PERF_HYSTERESIS)) return "critical";
  if (over(s, PERF_THRESHOLDS.busy)) return "busy";
  if (current !== "ok" && over(s, PERF_THRESHOLDS.busy, PERF_HYSTERESIS)) return "busy";
  return "ok";
}

/** What each level gives up (nothing is lost from the data: back at "ok", everything returns). */
export interface PerfCaps {
  /** Street lines as one plain track (no lanes per direction, stripes, joints). */
  plainLines: boolean;
  /** Share of the usual trail length kept. */
  trailShare: number;
  /** Gap filling from the vehicles' trails. */
  fills: boolean;
  /** Vehicle and line labels. */
  movingLabels: boolean;
  /** Lines drawn on their track (the others: straight legs between stops). */
  maxTrackedLines: number;
  /** Ortho tiles kept in the GPU cache. */
  tileCache: number;
}

export const PERF_CAPS: Record<PerfLevel, PerfCaps> = {
  ok: { plainLines: false, trailShare: 1, fills: true, movingLabels: true, maxTrackedLines: Infinity, tileCache: 512 },
  busy: { plainLines: true, trailShare: 0.5, fills: false, movingLabels: true, maxTrackedLines: Infinity, tileCache: 512 },
  critical: { plainLines: true, trailShare: 0.5, fills: false, movingLabels: false, maxTrackedLines: 40, tileCache: 128 },
};
