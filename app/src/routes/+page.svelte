<script lang="ts">
  import { onMount } from "svelte";
  import GridLab from "$lib/ui/GridLab.svelte";
  import Settings from "$lib/ui/Settings.svelte";
  import Steps from "$lib/ui/Steps.svelte";
  import { perf } from "$lib/state/perf.svelte";
  import Viewer from "$lib/ui/Viewer.svelte";
  import { fmtClock, t as t_ } from "$lib/i18n/index.svelte";
  import { app } from "$lib/state/app.svelte";
  import { orthoJob } from "$lib/state/orthoJob.svelte";
  import { live } from "$lib/state/live.svelte";
  import { runs } from "$lib/state/runs.svelte";
  import { stepsBar } from "$lib/state/stepsBar.svelte";
  import { lab } from "$lib/state/lab.svelte";
  import { updates } from "$lib/state/updates.svelte";

  const TABS = [
    { id: "grid", label: "tabs.grid" },
    { id: "viewer", label: "tabs.viewer" },
    { id: "settings", label: "tabs.settings" },
  ] as const;
  type TabId = (typeof TABS)[number]["id"];

  /** First launch: GridLab (the map is made there); afterwards the app always opens on the Visualiser. */
  const LS_LAUNCHED = "hq.launched";
  function firstTab(): TabId {
    try {
      if (localStorage.getItem(LS_LAUNCHED)) return "viewer";
      localStorage.setItem(LS_LAUNCHED, "1");
    } catch {
      /* storage unavailable */
    }
    return "grid";
  }
  let tab = $state<TabId>(firstTab());

  /** Open a page; "tiles" is GridLab's captures view (steps bar, ortho indicator). */
  function go(to: TabId | "tiles"): void {
    if (to === "tiles" || to === "grid") lab.view = to === "tiles" ? "tiles" : "grid";
    tab = to === "tiles" ? "grid" : to;
  }
  let viewerRun = $state<string | null>(null);

  // Fullscreen belongs to the viewer: leaving the tab leaves it.
  $effect(() => {
    if (tab !== "viewer" && app.fullscreen) app.setFullscreen(false);
  });

  // Collect capture screenshots in the background, whatever the open tab.
  $effect(() => runs.start(app.paths));
  // Live game data (Visualiser layers) + the cadences / commands written for the mod.
  $effect(() => live.start(app.paths));
  perf.start();

  // A capture starts in the game: show it arriving (GridLab › Captures).
  $effect(() => {
    if (lab.captureShown) go("tiles");
  });
  // Its ortho is built: open it in the Visualiser.
  $effect(() => {
    const id = lab.doneRun;
    if (!id) return;
    viewerRun = id;
    tab = "viewer";
    lab.doneRun = null;
  });

  onMount(() => {
    void app.init().then(() => {
      if (!app.settings.userdata) tab = "settings";
    });
    return updates.start();
  });
</script>

<div class="shell" class:fullscreen={app.fullscreen}>
  <header>
    <span class="brand">HQminiMap</span>
    <nav>
      {#each TABS as t (t.id)}
        <button class:active={tab === t.id} onclick={() => (tab = t.id)}>{t_(t.label)}</button>
      {/each}
    </nav>
    {#if app.paths && !stepsBar.visible}
      <button class="steps-btn" title={t_("steps.showTitle")} onclick={() => stepsBar.show()}>☰ {t_("steps.show")}</button>
    {/if}
    {#if orthoJob.running}
      <button class="job" title={t_("header.orthoTitle")} onclick={() => go("tiles")}>
        {t_("header.ortho", { pct: Math.round(orthoJob.running.progress * 100), elapsed: fmtClock(orthoJob.elapsed) })}
        <progress value={orthoJob.running.progress}></progress>
      </button>
    {/if}
    {#if updates.badge}
      <button class="update" class:alone={!orthoJob.running} title={t_("header.updateTitle")} onclick={() => (tab = "settings")}>
        ⬆ {t_("header.update", { version: updates.available!.version })}
      </button>
    {/if}
  </header>
  <div>{#if app.paths && stepsBar.visible}<Steps onGo={go} onHide={() => stepsBar.hide()} />{/if}</div>
  <main>
    {#if tab === "settings"}<Settings />{/if}
    <!-- Kept mounted: the capture previews, the ortho state and the map survive tab changes. -->
    <div class="pane" class:hidden={tab !== "grid"}>
      <GridLab onShowViewer={(id) => { viewerRun = id; tab = "viewer"; }} />
    </div>
    <div class="pane" class:hidden={tab !== "viewer"}><Viewer runId={viewerRun} active={tab === "viewer"} /></div>
  </main>
</div>

<style>
  :global(:root) {
    --bg: #171a21; --panel: #1e222b; --line: #2c313c; --text: #e3e6eb; --muted: #8b93a1;
    --accent: #3b82c4; --ok: #4caf7d; --warn: #e0a030; --err: #e05a5a;
    color-scheme: dark;
  }
  :global(html, body) { margin: 0; height: 100%; background: var(--bg); color: var(--text);
    font: 14px/1.4 system-ui, "Segoe UI", sans-serif; }
  :global(button) { background: var(--panel); color: var(--text); border: 1px solid var(--line);
    border-radius: 5px; padding: 6px 12px; cursor: pointer; font: inherit; }
  :global(button:hover:not(:disabled)) { border-color: var(--accent); }
  :global(button:disabled) { opacity: .45; cursor: default; }
  :global(button.primary) { background: var(--accent); border-color: var(--accent); color: #fff; width: 100%; padding: 9px; }
  :global(input, select) { background: #12151b; color: var(--text); border: 1px solid var(--line);
    border-radius: 4px; padding: 5px 7px; font: inherit; box-sizing: border-box; }
  :global(.ok) { color: var(--ok); }
  :global(.warn) { color: var(--warn); }
  :global(.err) { color: var(--err); }
  :global(.dim) { color: var(--muted); }
  :global(.mono) { font-family: ui-monospace, Consolas, monospace; font-size: 12px; word-break: break-all; }
  .shell { display: grid; grid-template-rows: auto auto 1fr; height: 100vh; }
  /* Viewer fullscreen: only the main area stays. */
  .shell.fullscreen { grid-template-rows: 1fr; }
  .shell.fullscreen > header, .shell.fullscreen > div:not(main) { display: none; }
  header { display: flex; align-items: center; gap: 18px; padding: 0 14px; border-bottom: 1px solid var(--line);
    background: var(--panel); height: 42px; }
  .brand { font-weight: 700; letter-spacing: .02em; }
  nav { display: flex; gap: 4px; }
  nav button { border: none; background: none; padding: 10px 12px; border-bottom: 2px solid transparent; border-radius: 0; }
  nav button.active { border-bottom-color: var(--accent); color: #fff; }
  main { min-height: 0; overflow: hidden; }
  .pane { height: 100%; }
  .steps-btn { margin-left: 8px; padding: 2px 10px; font-size: 12px; color: var(--muted); }
  .pane.hidden { display: none; }
  .job { margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .job progress { width: 90px; }
  .update { padding: 2px 10px; font-size: 12px; color: var(--ok); border-color: var(--ok); }
  .update.alone { margin-left: auto; }
</style>
