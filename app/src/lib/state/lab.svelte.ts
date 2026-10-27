/**
 * GridLab state shared by its side panel and its two views (grid / captures): the view shown, the
 * capture run chosen, its plan (read by the captures view) and the ortho settings.
 */
import { INTERPS, type Interp } from "$lib/core/ortho";
import type { PlanInfo } from "$lib/core/lua";
import { estimateOrtho } from "$lib/core/pyramid";
import { OVERVIEW_MAX_SIDE } from "./orthoExport";
import { orthoJob } from "./orthoJob.svelte";
import { bytesPerTile, secPerMp } from "./orthoSpeed";
import { runLabel, runs, type RunMeta } from "./runs.svelte";
import { shouldAutoOrtho } from "./autoOrtho";

const LS = "hq.lab";

function load(): { interp: Interp; halfRes: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(LS) ?? "null") as { interp?: Interp; halfRes?: boolean } | null;
    return { interp: INTERPS.includes(raw?.interp as Interp) ? raw!.interp! : "lanczos3", halfRes: raw?.halfRes === true };
  } catch {
    return { interp: "lanczos3", halfRes: false };
  }
}

export type LabView = "grid" | "tiles";

class Lab {
  /** Grid by default (not remembered); the captures view opens with the ortho and from the steps. */
  view = $state<LabView>("grid");
  runId = $state<string | null>(null);
  interp = $state<Interp>(load().interp);
  halfRes = $state(load().halfRes);
  /** Plan and heightmap extent of the chosen run, read by the captures view. */
  plan = $state<PlanInfo | null>(null);
  extent = $state<{ x: number; y: number } | null>(null);
  planState = $state<"loading" | "ok" | "missing">("loading");
  /** Captures of another shape than the plan's screen. */
  resIssue = $state<{ w: number; h: number; pw: number; ph: number } | null>(null);
  /** planStamp of the last scan command the game accepted (the steps say "scan started" only then). */
  scanSentStamp = $state<number | null>(null);

  /** Runs seen running in this session, and those whose ortho was started automatically. */
  readonly watched = new Set<string>();
  readonly attempted = new Set<string>();
  /** Requests to the page: a capture started (open GridLab › Captures), an ortho ended (open the Visualiser). */
  captureShown = $state(0);
  doneRun = $state<string | null>(null);

  /** Chosen run, else the latest. */
  get run(): RunMeta | null {
    return runs.runs.find((r) => r.id === this.runId) ?? runs.runs[0] ?? null;
  }

  get gsd(): number {
    return this.plan ? this.plan.gsdX * (this.halfRes ? 2 : 1) : 0;
  }

  get estimate() {
    return this.extent && this.gsd > 0 ? estimateOrtho(this.extent.x, this.extent.y, this.gsd, OVERVIEW_MAX_SIDE) : null;
  }

  /** Estimated seconds and bytes per interpolation (the speed model learns after each export). */
  get cost(): Record<Interp, { sec: number; bytes: number }> {
    void orthoJob.results;
    const est = this.estimate;
    const out = {} as Record<Interp, { sec: number; bytes: number }>;
    for (const i of INTERPS) out[i] = est ? { sec: est.megapixels * secPerMp(i), bytes: est.tiles * bytesPerTile(i) } : { sec: 0, bytes: 0 };
    return out;
  }

  /** The chosen run can be turned into an ortho now. */
  get canCompute(): boolean {
    const r = this.run;
    return !!r && !orthoJob.running && r.collected >= r.expected && !!this.estimate && !this.resIssue;
  }

  setOrtho(patch: Partial<{ interp: Interp; halfRes: boolean }>): void {
    if (patch.interp) this.interp = patch.interp;
    if (patch.halfRes !== undefined) this.halfRes = patch.halfRes;
    try {
      localStorage.setItem(LS, JSON.stringify({ interp: this.interp, halfRes: this.halfRes }));
    } catch {
      /* storage unavailable */
    }
  }

  /** Start the ortho of the chosen run and show its captures (progress); when it is built, the
   * page opens it in the Visualiser. */
  startOrtho(): void {
    const r = this.run;
    if (!r || !this.canCompute) return;
    orthoJob.start(r, runLabel(r), this.gsd, this.interp, this.cost[this.interp].sec, (res) => {
      if (res.kind === "done") this.doneRun = r.id;
    });
    this.view = "tiles";
  }

  /**
   * Follow the captures (called by GridLab on every change): a capture starting is chosen and shown;
   * once it is finished and complete, its ortho starts by itself (once).
   */
  follow(): void {
    const live = runs.live;
    if (live && !live.finished && !this.watched.has(live.id)) {
      this.watched.add(live.id);
      this.runId = live.id;
      this.view = "tiles";
      this.captureShown++;
    }
    const r = this.run;
    const auto = shouldAutoOrtho(r, {
      watched: this.watched, attempted: this.attempted, planReady: !!this.estimate, resIssue: !!this.resIssue, busy: !!orthoJob.running,
      latest: !!r && runs.runs[0]?.id === r.id, now: Date.now(),
    });
    if (r && auto) {
      this.attempted.add(r.id);
      this.startOrtho();
    }
  }

  /** Manual start is only offered when the automatic one did not happen or did not succeed. */
  get canRetry(): boolean {
    const r = this.run;
    return !!r && this.canCompute && !r.hasOrtho && (this.attempted.has(r.id) || !this.watched.has(r.id) || !!orthoJob.results[r.id]);
  }
}

export const lab = new Lab();
