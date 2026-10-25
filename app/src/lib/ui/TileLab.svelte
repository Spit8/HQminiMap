<script lang="ts">
  import { INTERPS, type Interp } from "$lib/core/ortho";
  import { luaNum, parsePlan, type PlanInfo } from "$lib/core/lua";
  import { estimateOrtho } from "$lib/core/pyramid";
  import { fmtClock, fmtNum, t, type MessageKey } from "$lib/i18n/index.svelte";
  import { joinPath, readBytes, readText } from "$lib/platform/fsx";
  import { OVERVIEW_MAX_SIDE, PYRAMID_VERSION, tileFileName } from "$lib/state/orthoExport";
  import { bytesPerTile, fmtBytes, fmtDuration, isMeasured, secPerMp } from "$lib/state/orthoSpeed";
  import { orthoJob, type OrthoResult } from "$lib/state/orthoJob.svelte";
  import { runLabel, runs, type RunMeta } from "$lib/state/runs.svelte";
  import { makeThumb } from "./thumbs";

  let { onShowViewer }: { onShowViewer?: (runId: string) => void } = $props();

  let selectedId = $state<string | null>(null);
  let plan = $state<PlanInfo | null>(null);
  /** World extent of the run's heightmap (m): X rows, Y columns. */
  let extent = $state<{ x: number; y: number } | null>(null);
  let thumbs = $state<Record<number, string>>({});
  let halfRes = $state(false);
  let interp = $state<Interp>("lanczos3");
  let labelDraft = $state("");
  /** Previews of a run that already has its ortho are only loaded on request. */
  let showCaptures = $state(false);

  const selected = $derived<RunMeta | null>(runs.runs.find((r) => r.id === selectedId) ?? runs.runs[0] ?? null);
  const gsd = $derived(plan ? plan.gsdX * (halfRes ? 2 : 1) : 0);
  const job = $derived(orthoJob.running);
  const result = $derived<OrthoResult | undefined>(selected ? orthoJob.results[selected.id] : undefined);
  const est = $derived(extent && gsd > 0 ? estimateOrtho(extent.x, extent.y, gsd, OVERVIEW_MAX_SIDE) : null);
  /** Estimated seconds and bytes per interpolation (re-evaluated after each export: the model learns). */
  const cost = $derived.by(() => {
    void orthoJob.results;
    const out = {} as Record<Interp, { sec: number; bytes: number }>;
    for (const i of INTERPS) out[i] = est ? { sec: est.megapixels * secPerMp(i), bytes: est.tiles * bytesPerTile(i) } : { sec: 0, bytes: 0 };
    return out;
  });

  /** "loading" until the run's plan has been read; "missing" is retried (the collector may add it). */
  let planState = $state<"loading" | "ok" | "missing">("loading");
  let shownRun: string | null = null;
  let loadedFor: string | null = null;

  /**
   * The previews are released (memory for the game and the other apps) once the run has its ortho,
   * and while an ortho is being computed; they come back on request ("show the captures").
   */
  const previewsWanted = $derived(!!selected && !job && (!selected.hasOrtho || showCaptures));

  function releaseThumbs(): void {
    for (const u of Object.values(thumbs)) URL.revokeObjectURL(u);
    thumbs = {};
  }

  // Load plan + thumbnails of the shown run: when it changes (click, new capture, deletion), when
  // tiles arrive, and every 2 s while its plan is still missing.
  $effect(() => {
    const run = selected;
    const wanted = previewsWanted;
    const key = run ? `${run.id}:${run.collected}:${wanted}` : null;
    if (run?.id !== shownRun) {
      releaseThumbs();
      plan = null;
      extent = null;
      planState = "loading";
      shownRun = run?.id ?? null;
      labelDraft = run?.label ?? "";
      loadedFor = null;
      showCaptures = false;
    }
    if (!wanted && Object.keys(thumbs).length) releaseThumbs();
    if (!run || loadedFor === key) return;
    loadedFor = key;
    void loadRun(run, wanted);
  });
  $effect(() => {
    if (planState !== "missing") return;
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
    plan = text ? parsePlan(text) : null;
    planState = plan ? "ok" : "missing";
    const w = hmText ? luaNum(hmText, "width") : NaN, h = hmText ? luaNum(hmText, "height") : NaN;
    extent = Number.isFinite(w) && Number.isFinite(h) ? { x: w, y: h } : null;
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

  function saveLabel(): void {
    if (selected && labelDraft.trim() !== (selected.label ?? "")) void runs.setLabel(selected, labelDraft);
  }

  function start(): void {
    if (!selected || !est) return;
    orthoJob.start(selected, runLabel(selected), gsd, interp, cost[interp].sec);
  }

  function resultText(r: OrthoResult): string {
    if (r.kind === "stopped") {
      const key = `ortho.err.${r.error}` as MessageKey;
      return t("tiles.stopped", { error: t(key) === key ? r.error : t(key) });
    }
    return t("tiles.done", {
      w: fmtNum(r.w), h: fmtNum(r.h), gsd: r.gsd.toFixed(3), duration: fmtClock(r.seconds), estimate: fmtClock(r.estimateSec),
    }) + (r.holes ? t("tiles.doneHoles", { holes: fmtNum(r.holes) }) : t("tiles.doneNoHole"));
  }
</script>

<div class="lab">
  <aside class="panel">
    <h3>{t("tiles.captures")}</h3>
    {#if runs.live && !runs.live.finished}
      <p class="warn">{t("tiles.live", { collected: runs.live.collected, expected: runs.live.expected })}</p>
    {/if}
    {#if !runs.runs.length}<p class="dim">{t("tiles.empty")}</p>{/if}
    <ul>
      {#each runs.runs as r (r.id)}
        <li>
          <button class:active={selected?.id === r.id} onclick={() => (selectedId = r.id)}>
            <span>{runLabel(r)}</span>
            <span class="dim">{t("tiles.images", { collected: r.collected, expected: r.expected })}
              {#if r.error}<span class="err">{t("tiles.badge.error")}</span>{:else if !r.finished}<span class="warn">{t("tiles.badge.live")}</span>{/if}
              {#if r.hasOrtho}<span class="ok">{t("tiles.badge.ortho")}</span>{/if}</span>
          </button>
        </li>
      {/each}
    </ul>

    {#if selected}
      <section>
        <h3>{t("tiles.run")}</h3>
        <label>{t("tiles.name")}
          <input type="text" placeholder={runLabel({ ...selected, label: undefined })} bind:value={labelDraft}
            onchange={saveLabel} onkeydown={(e) => e.key === "Enter" && saveLabel()} /></label>
        {#if selected.extras}<p class="warn">{t("tiles.extras", { n: selected.extras })}</p>{/if}
        {#if selected.error}<p class="err">{t("tiles.modError", { error: selected.error })}</p>{/if}
      </section>

      <section>
        <h3>{t("tiles.ortho")}</h3>
        {#if plan}
          <label>{t("tiles.interp")}
            <select bind:value={interp} disabled={!!job}>
              {#each INTERPS as i (i)}
                <option value={i}>{t(`tiles.interp.${i}`)}{est ? ` — ${fmtDuration(cost[i].sec)} · ${fmtBytes(cost[i].bytes)}` : ""}</option>
              {/each}
            </select></label>
          <label class="check"><input type="checkbox" bind:checked={halfRes} disabled={!!job} /> {t("tiles.halfRes")}</label>
          {#if est}
            <table class="kv">
              <tbody>
                <tr><td>{t("tiles.e.resolution")}</td><td>{gsd.toFixed(3)} m/px</td></tr>
                <tr><td>{t("tiles.e.image")}</td><td><b>{fmtNum(est.outW)} × {fmtNum(est.outH)}</b> px
                  ({fmtNum(est.megapixels)} MP)</td></tr>
                <tr><td>{t("tiles.e.viewer")}</td>
                  <td>{t("tiles.e.viewerValue", { tiles: fmtNum(est.tiles), size: fmtBytes(cost[interp].bytes) })}</td></tr>
                <tr><td>{t("tiles.e.overview")}</td><td>ortho.png {est.overviewW} × {est.overviewH} px</td></tr>
                <tr><td>{t("tiles.e.duration")}</td><td><b>{fmtDuration(cost[interp].sec)}</b>
                  <span class="dim">{isMeasured(interp) ? t("tiles.e.measured") : t("tiles.e.estimated")}</span></td></tr>
              </tbody>
            </table>
          {/if}
          {#if job}
            <p class="warn">{t("tiles.computing", { label: job.label })}</p>
            <progress value={job.progress}></progress>
            <p class="clock">{t("tiles.clock", {
              elapsed: fmtClock(orthoJob.elapsed), remaining: fmtClock(orthoJob.remaining),
              total: fmtClock(orthoJob.elapsed + orthoJob.remaining),
            })}</p>
            <button onclick={() => orthoJob.cancel()}>{t("tiles.cancel")}</button>
          {:else}
            <button class="primary" disabled={selected.collected < selected.expected || !est} onclick={start}>
              {t("tiles.compute")}</button>
          {/if}
          {#if selected.collected < selected.expected}
            <p class="warn">{t("tiles.incomplete", { collected: selected.collected, expected: selected.expected })}</p>
          {/if}
          {#if result}<p class={result.ok ? "ok" : "warn"}>{resultText(result)}</p>{/if}
          {#if selected.hasOrtho && (selected.orthoVersion ?? 1) < PYRAMID_VERSION}<p class="warn">{t("tiles.oldOrtho")}</p>{/if}
          {#if selected.hasOrtho && onShowViewer && !job}
            <button onclick={() => onShowViewer?.(selected!.id)}>{t("tiles.showViewer")}</button>
          {/if}
        {:else if planState === "missing"}
          <p class="err">{t("tiles.planMissing", { path: joinPath(selected.dir, "mosaic_plan.lua") })}</p>
          <p class="dim">{t("tiles.planRetry")}</p>
        {:else}
          <p class="dim">{t("tiles.loading")}</p>
        {/if}
      </section>
    {/if}
  </aside>

  <div class="grid-view">
    {#if selected && !previewsWanted}
      <div class="released">
        <p class="dim">{job ? t("tiles.previewsBusy") : t("tiles.previewsReleased")}</p>
        {#if !job}<button onclick={() => (showCaptures = true)}>{t("tiles.showCaptures")}</button>{/if}
      </div>
    {:else if selected}
      <div class="grid" style="grid-template-columns: repeat({selected.nY}, 1fr)">
        {#each Array.from({ length: selected.nX * selected.nY }, (_, k) => k + 1) as seq (seq)}
          <div class="cell">
            {#if thumbs[seq]}<img src={thumbs[seq]} alt={t("tiles.tileAlt", { n: seq })} />{:else}<span class="dim">{seq}</span>{/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .lab { display: grid; grid-template-columns: 330px 1fr; height: 100%; min-height: 0; }
  .panel { overflow: auto; padding: 12px 14px; border-right: 1px solid var(--line); }
  h3 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  section { margin-bottom: 16px; }
  ul { list-style: none; padding: 0; margin: 0 0 16px; display: flex; flex-direction: column; gap: 4px; }
  li button { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 2px; }
  li button.active { border-color: var(--accent); }
  label { display: flex; flex-direction: column; gap: 3px; font-size: 13px; margin-bottom: 8px; }
  label.check { flex-direction: row; align-items: center; gap: 6px; }
  select, input[type="text"] { width: 100%; }
  progress { width: 100%; margin: 6px 0 2px; }
  p { font-size: 13px; margin: 6px 0; }
  .clock { font-variant-numeric: tabular-nums; margin-top: 2px; }
  .kv { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 4px 0 10px; }
  .kv td { padding: 1px 0; vertical-align: top; }
  .kv td:first-child { color: var(--muted); width: 84px; }
  .grid-view { overflow: auto; padding: 12px; }
  .grid { display: grid; gap: 2px; }
  .released { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; }
  .cell { aspect-ratio: 2560 / 1080; background: #12151b; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .cell img { width: 100%; height: 100%; object-fit: cover; }
</style>
