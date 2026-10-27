<script lang="ts">
  /** Workflow strip under the header: where the player is, and what to do next (all tabs). */
  import { t } from "$lib/i18n/index.svelte";
  import { app } from "$lib/state/app.svelte";
  import { orthoJob } from "$lib/state/orthoJob.svelte";
  import { lab } from "$lib/state/lab.svelte";
  import { runs } from "$lib/state/runs.svelte";

  let { onGo, onHide }: { onGo: (tab: "grid" | "tiles" | "viewer") => void; onHide: () => void } = $props();

  type State = "done" | "todo" | "active" | "error" | "idle";

  const plan = $derived(app.capturePlan);
  const cap = $derived(app.lastCapture);
  /** Capture of the current grid: started from this capture_plan stamp. */
  const capOfPlan = $derived(!!plan && !!cap && cap.planStamp === plan.stamp);
  const latestRun = $derived(runs.runs[0] ?? null);

  const steps = $derived.by(() => {
    const grid = plan ? `${plan.nY}×${plan.nX}` : "";
    const exportState: State = app.map ? "done" : "todo";
    const gridState: State = !app.map ? "idle" : plan ? "done" : "todo";
    let captureState: State = "idle";
    let captureText = t("steps.capture.idle");
    if (plan) {
      if (!capOfPlan && lab.scanSentStamp === plan.stamp) {
        captureState = "active";
        captureText = t("steps.capture.sent");
      } else if (!capOfPlan) {
        captureState = "todo";
        captureText = t("steps.capture.todo", { grid });
      } else if (cap!.error) {
        captureState = "error";
        captureText = t("steps.capture.error", { error: cap!.error });
      } else if (!cap!.finished) {
        captureState = "active";
        captureText = t("steps.capture.active", { shots: cap!.shots, expected: cap!.expected });
      } else {
        captureState = "done";
        captureText = t("steps.capture.done", { shots: cap!.shots });
      }
    }
    let orthoState: State = "idle";
    let orthoText = t("steps.ortho.idle");
    if (orthoJob.running) {
      orthoState = "active";
      orthoText = t("steps.ortho.active", { pct: Math.round(orthoJob.running.progress * 100) });
    } else if (captureState === "done" && latestRun) {
      orthoState = latestRun.hasOrtho ? "done" : "todo";
      orthoText = latestRun.hasOrtho ? t("steps.ortho.done") : t("steps.ortho.missing");
    }
    return [
      { n: 1, state: exportState, text: app.map ? t("steps.export.done") : t("steps.export.todo"), go: "grid" as const },
      { n: 2, state: gridState, text: plan ? t("steps.grid.done", { grid }) : t("steps.grid.todo"), go: "grid" as const },
      { n: 3, state: captureState, text: captureText, go: "tiles" as const },
      { n: 4, state: orthoState, text: orthoText, go: (orthoState === "done" ? "viewer" : "tiles") as "tiles" | "viewer" },
    ];
  });
</script>

<div class="steps">
  {#each steps as s (s.n)}
    <button class="step {s.state}" onclick={() => onGo(s.go)} title={s.text}>
      <span class="badge">{s.state === "done" ? "✓" : s.state === "error" ? "!" : s.n}</span>
      <span class="text">{s.text}</span>
    </button>
    {#if s.n < 4}<span class="sep">›</span>{/if}
  {/each}
  <button class="hide" title={t("steps.hideTitle")} onclick={onHide}>×</button>
</div>

<style>
  .steps { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-bottom: 1px solid var(--line);
    background: #1a1e26; overflow-x: auto; }
  .step { display: flex; align-items: center; gap: 7px; border: 1px solid transparent; background: none;
    padding: 4px 10px; border-radius: 16px; font-size: 12.5px; color: var(--muted); white-space: nowrap; }
  .badge { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%;
    background: #2a2f3a; color: var(--muted); font-size: 11px; font-weight: 700; flex: none; }
  .step.done { color: var(--text); }
  .step.done .badge { background: var(--ok); color: #fff; }
  .step.todo { color: #fff; border-color: var(--accent); background: rgba(59, 130, 196, .18); }
  .step.todo .badge { background: var(--accent); color: #fff; animation: pulse 1.6s ease-in-out infinite; }
  .step.active { color: #fff; border-color: var(--warn); }
  .step.active .badge { background: var(--warn); color: #000; }
  .step.error { color: var(--err); border-color: var(--err); }
  .step.error .badge { background: var(--err); color: #fff; }
  .text { overflow: hidden; text-overflow: ellipsis; max-width: 420px; }
  .sep { color: var(--muted); }
  .hide { margin-left: auto; padding: 0 8px; background: none; border: none; color: var(--muted); font-size: 16px; line-height: 1; }
  .hide:hover { color: var(--text); }
  @keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 196, .7); } 50% { box-shadow: 0 0 0 5px rgba(59, 130, 196, 0); } }
</style>
