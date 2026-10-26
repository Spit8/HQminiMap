/**
 * Performance controller: samples memory, drawn objects and map update time (every PERF_SAMPLE_MS and
 * after each map update), sets the level and its caps (core/perf.ts). The Visualiser applies the
 * caps and shows a warning while the level is not "ok".
 */
import { PERF_CAPS, perfLevel, type PerfCaps, type PerfLevel, type PerfSample } from "$lib/core/perf";

const PERF_SAMPLE_MS = 5000;

/** performance.memory (Chromium / WebView2 only, non-standard). */
type MemoryInfo = { usedJSHeapSize: number; jsHeapSizeLimit: number };
const memoryInfo = (): MemoryInfo | null => {
  const m = (performance as Performance & { memory?: MemoryInfo }).memory;
  return m && m.jsHeapSizeLimit > 0 ? m : null;
};

class PerfState {
  level = $state<PerfLevel>("ok");
  /** Last measures, shown in Options. */
  sample = $state<PerfSample & { usedMb: number | null; limitMb: number | null; layoutMs: number }>({
    memory: null, objects: 0, updateMs: 0, usedMb: null, limitMb: null, layoutMs: 0,
  });
  /** The warning was closed at this level (shown again at a higher one). */
  dismissedAt = $state<PerfLevel | null>(null);
  private objects = 0;
  private updateMs = 0;
  private layoutMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  get caps(): PerfCaps {
    return PERF_CAPS[this.level];
  }

  get warning(): boolean {
    if (this.level === "ok") return false;
    return this.dismissedAt === null || (this.dismissedAt === "busy" && this.level === "critical");
  }

  start(): void {
    if (!this.timer) this.timer = setInterval(() => this.measure(), PERF_SAMPLE_MS);
  }

  /** After a map update: what it drew and how long it took (lane layout included). */
  report(objects: number, updateMs: number, layoutMs?: number): void {
    this.objects = objects;
    this.updateMs = updateMs;
    if (layoutMs !== undefined) this.layoutMs = layoutMs;
    this.measure();
  }

  dismiss(): void {
    this.dismissedAt = this.level;
  }

  private measure(): void {
    const m = memoryInfo();
    const s: PerfSample = { memory: m ? m.usedJSHeapSize / m.jsHeapSizeLimit : null, objects: this.objects, updateMs: this.updateMs };
    this.sample = {
      ...s, layoutMs: this.layoutMs,
      usedMb: m ? m.usedJSHeapSize / 2 ** 20 : null, limitMb: m ? m.jsHeapSizeLimit / 2 ** 20 : null,
    };
    const next = perfLevel(s, this.level);
    if (next !== this.level) {
      this.level = next;
      if (next === "ok") this.dismissedAt = null;
    }
  }
}

export const perf = new PerfState();
