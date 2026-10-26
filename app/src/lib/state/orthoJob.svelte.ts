/**
 * The single ortho export job of the app: lives outside the UI (survives tab changes), one at a
 * time, cancellable, with a live clock (elapsed / remaining). GridLab and the header read it.
 */
import type { Interp } from "$lib/core/ortho";
import { exportOrtho, type OrthoExportHandle } from "./orthoExport";
import { recordExport } from "./orthoSpeed";
import { runs, type RunMeta } from "./runs.svelte";

/** Below this progress the remaining time comes from the model estimate, not the measured pace. */
const PACE_MIN_PROGRESS = 0.03;

export interface OrthoJobState {
  runId: string;
  label: string;
  interp: Interp;
  gsd: number;
  progress: number;
  startedMs: number;
  /** Duration announced before starting (s). */
  estimateSec: number;
}

export type OrthoResult =
  | { ok: boolean; kind: "done"; w: number; h: number; gsd: number; seconds: number; estimateSec: number; holes: number }
  | { ok: false; kind: "stopped"; error: string };

class OrthoJob {
  running = $state<OrthoJobState | null>(null);
  /** Last finished job outcome, per run id. */
  results = $state<Record<string, OrthoResult>>({});
  /** Wall clock, ticking every second while a job runs. */
  now = $state(Date.now());
  private handle: OrthoExportHandle | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;

  /** Seconds since the job started. */
  get elapsed(): number {
    return this.running ? Math.max(0, (this.now - this.running.startedMs) / 1000) : 0;
  }

  /** Seconds left: measured pace once past a few %, model estimate before. */
  get remaining(): number {
    const j = this.running;
    if (!j) return 0;
    if (j.progress >= PACE_MIN_PROGRESS) return (this.elapsed * (1 - j.progress)) / j.progress;
    return Math.max(0, j.estimateSec - this.elapsed);
  }

  start(run: RunMeta, label: string, gsd: number, interp: Interp, estimateSec: number, onEnd?: (r: OrthoResult) => void): void {
    if (this.running) return;
    const job: OrthoJobState = { runId: run.id, label, interp, gsd, progress: 0, startedMs: Date.now(), estimateSec };
    this.running = job;
    this.now = Date.now();
    this.clock = setInterval(() => (this.now = Date.now()), 1000);
    const { [run.id]: _old, ...rest } = this.results;
    this.results = rest;
    this.handle = exportOrtho(run, gsd, interp, (d, t) => {
      if (this.running) this.running = { ...this.running, progress: d / t };
    });
    this.handle.done
      .then((out) => {
        const seconds = (Date.now() - job.startedMs) / 1000;
        recordExport(interp, seconds, (out.width * out.height) / 1e6, out.tiles ?? 0, out.bytes ?? 0);
        this.results = {
          ...this.results,
          [run.id]: { ok: out.holes === 0, kind: "done", w: out.width, h: out.height, gsd, seconds, estimateSec, holes: out.holes },
        };
        onEnd?.(this.results[run.id]!);
      })
      .catch((err) => {
        this.results = {
          ...this.results,
          [run.id]: { ok: false, kind: "stopped", error: err instanceof Error ? err.message : String(err) },
        };
        onEnd?.(this.results[run.id]!);
      })
      .finally(() => {
        if (this.clock) clearInterval(this.clock);
        this.clock = null;
        this.running = null;
        this.handle = null;
        void runs.refreshList();
      });
  }

  cancel(): void {
    this.handle?.cancel();
  }
}

export const orthoJob = new OrthoJob();
