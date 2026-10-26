/**
 * When GridLab starts the ortho by itself: a capture that has just finished, complete and clean —
 * seen running in this session, or (the app was closed or reloaded meanwhile) the latest capture,
 * taken less than RESUME_MS ago, still without its ortho. Pure (the state lives in lab.svelte.ts).
 */
export const RESUME_MS = 2 * 3600 * 1000;
export interface AutoOrthoRun {
  id: string;
  finished: boolean;
  collected: number;
  expected: number;
  error: string | null;
  hasOrtho: boolean;
  /** Capture start (s, os.time). */
  startedAt: number;
}

export interface AutoOrthoState {
  /** Runs seen still running in this session (old captures never start anything). */
  watched: ReadonlySet<string>;
  /** Runs whose ortho was already started automatically (a failure is not retried in a loop). */
  attempted: ReadonlySet<string>;
  /** The run's plan is read and the ortho can be estimated. */
  planReady: boolean;
  /** Captures of another shape than the plan's screen. */
  resIssue: boolean;
  /** An ortho is being computed. */
  busy: boolean;
  /** The run is the latest capture. */
  latest: boolean;
  /** Now (ms). */
  now: number;
}

export function shouldAutoOrtho(run: AutoOrthoRun | null, s: AutoOrthoState): boolean {
  if (!run || s.attempted.has(run.id)) return false;
  const resumed = s.latest && s.now - run.startedAt * 1000 < RESUME_MS;
  if (!s.watched.has(run.id) && !resumed) return false;
  return run.finished && !run.error && run.collected >= run.expected && run.expected > 0 && !run.hasOrtho
    && s.planReady && !s.resIssue && !s.busy;
}
