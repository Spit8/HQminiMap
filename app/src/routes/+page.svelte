<script lang="ts">
  import { onMount } from "svelte";
  import GridLab from "$lib/ui/GridLab.svelte";
  import Settings from "$lib/ui/Settings.svelte";
  import Steps from "$lib/ui/Steps.svelte";
  import TileLab from "$lib/ui/TileLab.svelte";
  import Viewer from "$lib/ui/Viewer.svelte";
  import { fmtClock, t as t_ } from "$lib/i18n/index.svelte";
  import { app } from "$lib/state/app.svelte";
  import { orthoJob } from "$lib/state/orthoJob.svelte";
  import { live } from "$lib/state/live.svelte";
  import { runs } from "$lib/state/runs.svelte";
  import { stepsBar } from "$lib/state/stepsBar.svelte";

  const TABS = [
    { id: "grid", label: "tabs.grid" },
    { id: "tiles", label: "tabs.tiles" },
    { id: "viewer", label: "tabs.viewer" },
    { id: "settings", label: "tabs.settings" },
  ] as const;
  type TabId = (typeof TABS)[number]["id"];

  let tab = $state<TabId>("grid");
  let viewerRun = $state<string | null>(null);

  // Fullscreen belongs to the viewer: leaving the tab leaves it.
  $effect(() => {
    if (tab !== "viewer" && app.fullscreen) app.setFullscreen(false);
  });

  // Collect capture screenshots in the background, whatever the open tab.
  $effect(() => runs.start(app.paths));
  // Live game data (Visualiser layers) + the cadences / commands written for the mod.
  $effect(() => live.start(app.paths));

  onMount(() => {
    void app.init().then(() => {
      if (!app.settings.userdata) tab = "settings";
    });
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
      <button class="job" title={t_("header.orthoTitle")} onclick={() => (tab = "tiles")}>
        {t_("header.ortho", { pct: Math.round(orthoJob.running.progress * 100), elapsed: fmtClock(orthoJob.elapsed) })}
        <progress value={orthoJob.running.progress}></progress>
      </button>
    {/if}
  </header>
  <div>{#if app.paths && stepsBar.visible}<Steps onGo={(t) => (tab = t)} onHide={() => stepsBar.hide()} />{/if}</div>
  <main>
    {#if tab === "grid"}<GridLab />{/if}
    {#if tab === "settings"}<Settings />{/if}
    <!-- Kept mounted: thumbnails and the map survive tab changes. -->
    <div class="pane" class:hidden={tab !== "tiles"}>
      <TileLab onShowViewer={(id) => { viewerRun = id; tab = "viewer"; }} />
    </div>
    <div class="pane" class:hidden={tab !== "viewer"}><Viewer runId={viewerRun} /></div>
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
</style>
