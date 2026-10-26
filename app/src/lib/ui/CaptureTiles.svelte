<script lang="ts">
  /**
   * GridLab › Captures view: the capture runs, the chosen one's previews (released once it has its
   * ortho or while one is computed). Reads the chosen run's plan into `lab`. The history (clean-up)
   * is in Options.
   */
  import { luaNum, parsePlan } from "$lib/core/lua";
  import { sameAspect } from "$lib/core/png";
  import { t } from "$lib/i18n/index.svelte";
  import { joinPath, readBytes, readText } from "$lib/platform/fsx";
  import { lab } from "$lib/state/lab.svelte";
  import { captureSize, tileFileName } from "$lib/state/orthoExport";
  import { orthoJob } from "$lib/state/orthoJob.svelte";
  import { runLabel, runs, type RunMeta } from "$lib/state/runs.svelte";
  import { makeThumb } from "./thumbs";

  let thumbs = $state<Record<number, string>>({});
  /** Previews of a run that already has its ortho are only loaded on request. */
  let showCaptures = $state(false);

  const selected = $derived(lab.run);
  // The whole grid fits in the view, like a "fit": as wide as the space allows, or as the height does.
  let boxW = $state(0), boxH = $state(0);
  const aspect = $derived(lab.plan ? { w: lab.plan.screenW, h: lab.plan.screenH } : { w: 2560, h: 1080 });
  const GAP = 2;
  function gridW(run: RunMeta): number {
    const cols = run.nY, rows = run.nX;
    const byHeight = ((boxH - GAP * (rows - 1)) / rows) * (aspect.w / aspect.h) * cols + GAP * (cols - 1);
    return Math.max(80, Math.floor(Math.min(boxW, byHeight)));
  }
  const job = $derived(orthoJob.running);
  let shownRun: string | null = null;
  let loadedFor: string | null = null;

  /** Previews are released (memory for the game) once the run has its ortho, and during an ortho. */
  const previewsWanted = $derived(!!selected && !job && (!selected.hasOrtho || showCaptures));

  function releaseThumbs(): void {
    for (const u of Object.values(thumbs)) URL.revokeObjectURL(u);
    thumbs = {};
  }

  // Load plan + thumbnails of the shown run: when it changes (choice, new capture, deletion), when
  // tiles arrive, and every 2 s while its plan is still missing.
  $effect(() => {
    const run = selected;
    const wanted = previewsWanted;
    const key = run ? `${run.id}:${run.collected}:${wanted}` : null;
    if (run?.id !== shownRun) {
      releaseThumbs();
      lab.plan = null;
      lab.extent = null;
      lab.planState = "loading";
      lab.resIssue = null;
      shownRun = run?.id ?? null;
      loadedFor = null;
      showCaptures = false;
    }
    if (!wanted && Object.keys(thumbs).length) releaseThumbs();
    if (!run || loadedFor === key) return;
    loadedFor = key;
    void loadRun(run, wanted);
  });
  $effect(() => {
    if (lab.planState !== "missing") return;
    const timer = setInterval(() => {
      if (selected) void loadRun(selected, previewsWanted);
    }, 2000);
    return () => clearInterval(timer);
  });

  async function loadRun(run: RunMeta, withPreviews: boolean): Promise<void> {
    const stale = () => run.id !== shownRun || (withPreviews && !previewsWanted);
    const text = await readText(joinPath(run.dir, "mosaic_plan.lua"));
    const hmText = await readText(joinPath(run.dir, "heightmap.lua"));
    if (stale()) return;
    const plan = text ? parsePlan(text) : null;
    lab.plan = plan;
    lab.planState = plan ? "ok" : "missing";
    const w = hmText ? luaNum(hmText, "width") : NaN, h = hmText ? luaNum(hmText, "height") : NaN;
    lab.extent = Number.isFinite(w) && Number.isFinite(h) ? { x: w, y: h } : null;
    if (plan && run.collected > 0) {
      const size = await captureSize(run);
      if (stale()) return;
      lab.resIssue = size && !sameAspect(size.width, size.height, plan.screenW, plan.screenH)
        ? { w: size.width, h: size.height, pw: plan.screenW, ph: plan.screenH } : null;
      // Same shape, another size (scaling): the ortho's ground resolution follows the real pixels
      // (half the pixels: twice the metres per pixel), instead of upsampling or dropping detail.
      if (size && !lab.resIssue && size.height !== plan.screenH) {
        const k = plan.screenH / size.height;
        lab.plan = { ...plan, gsdX: plan.gsdX * k, gsdY: plan.gsdY * k };
      }
    }
    if (!withPreviews) return;
    const next: Record<number, string> = { ...thumbs };
    for (let seq = 1; seq <= run.nX * run.nY; seq++) {
      if (next[seq]) continue;
      try {
        next[seq] = await makeThumb(await readBytes(joinPath(run.dir, tileFileName(seq))));
        if (stale()) break;
      } catch {
        /* not collected yet */
      }
    }
    if (stale()) {
      for (const [seq, u] of Object.entries(next)) if (!thumbs[+seq]) URL.revokeObjectURL(u);
      return;
    }
    thumbs = next;
  }
</script>

<div class="tiles">
  <div class="top">
    {#if runs.runs.length}
      <select value={selected?.id ?? ""} onchange={(e) => (lab.runId = (e.target as HTMLSelectElement).value)}>
        {#each runs.runs as r (r.id)}
          <option value={r.id}>{runLabel(r)} — {t("tiles.images", { collected: r.collected, expected: r.expected })}{r.error
            ? t("tiles.badge.error") : !r.finished ? t("tiles.badge.live") : ""}{r.hasOrtho ? t("tiles.badge.ortho") : ""}</option>
        {/each}
      </select>
    {:else}
      <p class="dim">{t("tiles.empty")}</p>
    {/if}
    {#if runs.live && !runs.live.finished}<span class="warn">{t("tiles.live", { collected: runs.live.collected, expected: runs.live.expected })}</span>{/if}
  </div>

  {#if selected}
    {#if selected.extras}<p class="warn">{t("tiles.extras", { n: selected.extras })}</p>{/if}
    {#if selected.error}<p class="err">{t("tiles.modError", { error: selected.error })}</p>{/if}
    {#if lab.planState === "missing"}
      <p class="err">{t("tiles.planMissing", { path: joinPath(selected.dir, "mosaic_plan.lua") })}</p>
      <p class="dim">{t("tiles.planRetry")}</p>
    {/if}
    {#if !previewsWanted}
      <div class="released">
        <p class="dim">{job ? t("tiles.previewsBusy") : t("tiles.previewsReleased")}</p>
        {#if !job}<button onclick={() => (showCaptures = true)}>{t("tiles.showCaptures")}</button>{/if}
      </div>
    {:else}
      <div class="fitbox" bind:clientWidth={boxW} bind:clientHeight={boxH}>
      <div class="grid" style="grid-template-columns: repeat({selected.nY}, 1fr)" style:width="{gridW(selected)}px"
        style:--ar={`${aspect.w} / ${aspect.h}`}>
        {#each Array.from({ length: selected.nX * selected.nY }, (_, k) => k + 1) as seq (seq)}
          <div class="cell">
            {#if thumbs[seq]}<img src={thumbs[seq]} alt={t("tiles.tileAlt", { n: seq })} />{:else}<span class="dim">{seq}</span>{/if}
          </div>
        {/each}
      </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .tiles { height: 100%; overflow: auto; padding: 12px 14px; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; }
  .top { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding-right: 160px; }
  .top select { max-width: 520px; }
  p { font-size: 13px; margin: 0; }
  .fitbox { flex: 1; min-height: 160px; display: flex; align-items: flex-start; justify-content: center; overflow: hidden; }
  .grid { display: grid; gap: 2px; }
  .released { flex: 1; min-height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; }
  .cell { aspect-ratio: var(--ar, 2560 / 1080); background: #12151b; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .cell img { width: 100%; height: 100%; object-fit: cover; }
</style>
