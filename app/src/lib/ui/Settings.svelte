<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
  import { fmtDate, fmtNum, i18n, LOCALES, t, type Locale } from "$lib/i18n/index.svelte";
  import { fileExists, joinPath } from "$lib/platform/fsx";
  import { detectUserdata } from "$lib/platform/paths";
  import { app } from "$lib/state/app.svelte";
  import History from "./History.svelte";
  import LiveSettings from "./LiveSettings.svelte";
  import MapStyleSettings from "./MapStyleSettings.svelte";
  import { updates } from "$lib/state/updates.svelte";
  import { perf } from "$lib/state/perf.svelte";

  void updates.init();
  const mb = (bytes: number) => fmtNum(bytes / 1e6, 1);

  let modInstalled = $state<boolean | null>(null);
  let detectMsg = $state<"settings.found" | "settings.notDetected" | null>(null);

  $effect(() => {
    const p = app.paths;
    modInstalled = null;
    if (p) fileExists(joinPath(p.modDir, "content", "hqminimap")).then((v) => (modInstalled = v));
  });

  const folders = $derived(app.paths ? ([
    ["settings.exports", app.paths.exportDir], ["settings.screenshots", app.paths.screenshots], ["settings.runs", app.paths.runsDir],
  ] as const) : []);

  async function pickUserdata(): Promise<void> {
    const dir = await open({ directory: true, title: t("settings.pickUserdata") });
    if (typeof dir === "string") app.setUserdata(dir);
  }

  async function pickModDir(): Promise<void> {
    const dir = await open({ directory: true, title: t("settings.pickModTitle") });
    if (typeof dir === "string") app.setUserdata(app.settings.userdata, dir);
  }

  async function redetect(): Promise<void> {
    const d = await detectUserdata();
    app.candidates = d.candidates;
    if (d.userdata) {
      app.setUserdata(d.userdata, "");
      detectMsg = "settings.found";
    } else {
      detectMsg = "settings.notDetected";
    }
  }
  /** Long paths: keep the start and the end, full path in the tooltip. */
  const short = (p: string, max = 52) => (p.length <= max ? p : `${p.slice(0, 18)}…${p.slice(-(max - 19))}`);

  function reveal(path: string): void {
    void revealItemInDir(path).catch((err) => console.warn("reveal", path, err));
  }
</script>

<div class="settings">
  <!-- Three stacks (wrapping on narrow windows): app and folders · map and history · live data. -->
  <div class="grid">
    <div class="col">
      <section class="card">
        <h3>{t("settings.general")}</h3>
        <div class="kv">
          <span class="k">{t("settings.language")}</span>
          <select value={i18n.locale} onchange={(e) => i18n.set((e.target as HTMLSelectElement).value as Locale)}>
            {#each Object.entries(LOCALES) as [code, dict] (code)}<option value={code}>{dict["lang.name"]}</option>{/each}
          </select>
        </div>
        <div class="kv">
          <span class="k">{t("settings.gameData")}</span>
          <span class="v mono" title={app.settings.userdata}>{app.settings.userdata ? short(app.settings.userdata) : t("settings.notFound")}</span>
          <span class="btns">
            <button onclick={redetect}>{t("settings.detect")}</button>
            <button onclick={pickUserdata}>{t("settings.choose")}</button>
          </span>
        </div>
        {#if detectMsg}<p class="note dim">{t(detectMsg)}</p>{/if}
        {#if app.candidates.length}
          <details class="note"><summary class="dim">{t("settings.tried")}</summary>
            {#each app.candidates as c (c)}<p class="mono dim">{c}</p>{/each}
          </details>
        {/if}
        {#if app.paths}
          <div class="kv">
            <span class="k">{t("settings.mod")}</span>
            <span class="v mono" title={app.paths.modDir}>
              {#if modInstalled !== null}<span class="pill" class:on={modInstalled} title={modInstalled ? t("settings.modFound") : t("settings.modMissing")}></span>{/if}
              {short(app.paths.modDir)}</span>
            <span class="btns"><button onclick={pickModDir}>{t("settings.choose")}</button></span>
          </div>
          {#if modInstalled === false}<p class="note err">{t("settings.modMissing")}</p>{/if}
        {/if}
      </section>
      {#if app.paths}
        <section class="card">
          <h3>{t("settings.folders")}</h3>
          {#each folders as [label, path] (label)}
            <div class="kv stacked">
              <span class="k">{t(label)}</span>
              <span class="v mono" title={path}>{short(path)}</span>
              <span class="btns"><button title={t("settings.reveal")} onclick={() => reveal(path)}>📂</button></span>
            </div>
          {/each}
        </section>
      {/if}
      <section class="card">
        <h3>{t("updates.title")}</h3>
        <div class="kv">
          <span class="k">{t("updates.installed")}</span>
          <span class="v mono">{updates.current ? `v${updates.current}` : "…"}</span>
          <span class="btns">
            <button disabled={updates.phase === "checking" || updates.phase === "downloading" || updates.phase === "installing"}
              onclick={() => updates.checkNow()}>{t("updates.check")}</button>
          </span>
        </div>
        <div class="kv">
          <span class="k">{t("updates.status")}</span>
          <span class="v">
            {#if updates.phase === "checking"}<span class="dim">{t("updates.checking")}</span>
            {:else if updates.phase === "upToDate"}<span class="ok">{t("updates.upToDate")}</span>
            {:else if updates.phase === "error"}<span class="err" title={t(`updates.err.${updates.error ?? "other"}`)}>{t(`updates.err.${updates.error ?? "other"}`)}</span>
            {:else if updates.available}<span class="ok">{t("updates.available", { version: updates.available.version })}</span>
            {:else}<span class="dim">{t("updates.never")}</span>{/if}
          </span>
          <span></span>
        </div>
        {#if updates.available && updates.phase !== "upToDate"}
          {@const av = updates.available}
          {#if updates.phase === "downloading" || updates.phase === "installing"}
            <div class="kv">
              <span class="k">{t(updates.phase === "installing" ? "updates.installing" : "updates.downloading")}</span>
              <progress value={updates.progress?.total ? updates.progress.done / updates.progress.total : undefined}></progress>
              <span class="v mono">{#if updates.progress}{updates.progress.total ? `${mb(updates.progress.done)} / ` : ""}{t("unit.mo", { v: mb(updates.progress.total ?? updates.progress.done) })}{/if}</span>
            </div>
          {:else}
            <div class="actions">
              {#if updates.selfUpdate}
                <button class="go" onclick={() => updates.install()}>{t("updates.install")}</button>
              {:else}
                <button class="go" onclick={() => openUrl(av.url)}>{t("updates.download")}</button>
              {/if}
              <button onclick={() => openUrl(av.url)}>{t("updates.notes")}</button>
              {#if updates.skipped !== av.version}<button class="link" onclick={() => updates.skip()}>{t("updates.skip")}</button>{/if}
            </div>
            {#if !updates.selfUpdate}<p class="note dim">{t(updates.portable ? "updates.manualPortable" : "updates.manual")}</p>{/if}
          {/if}
        {/if}
        <label class="check2"><input type="checkbox" checked={updates.auto}
          onchange={(e) => updates.setAuto((e.target as HTMLInputElement).checked)} /> {t("updates.auto")}</label>
        <p class="note dim">
          {#if updates.lastCheck}{t("updates.lastCheck", { date: fmtDate(updates.lastCheck) })} · {/if}{t("updates.modHint")}
        </p>
      </section>
    </div>
    {#if app.paths}
      <div class="col">
        <section class="card">
          <h3>{t("settings.map")}</h3>
          <MapStyleSettings />
        </section>
        <!-- Capture sessions: open their folder, clean up old ones. -->
        <History />
      </div>
      <div class="col">
        <LiveSettings />
        <section class="card">
          <h3>{t("perf.title")}</h3>
          <div class="kv">
            <span class="k">{t("perf.level")}</span>
            <span class="v" class:warn={perf.level === "busy"} class:err={perf.level === "critical"}>{t(`perf.level.${perf.level}`)}</span><span></span>
          </div>
          <div class="kv">
            <span class="k">{t("perf.memory")}</span>
            <span class="v mono">{perf.sample.usedMb !== null && perf.sample.limitMb !== null
              ? t("perf.memoryValue", { used: fmtNum(perf.sample.usedMb, 0), limit: fmtNum(perf.sample.limitMb, 0), pct: Math.round((perf.sample.memory ?? 0) * 100) })
              : t("perf.memoryNone")}</span><span></span>
          </div>
          <div class="kv"><span class="k">{t("perf.objects")}</span><span class="v mono">{fmtNum(perf.sample.objects)}</span><span></span></div>
          <div class="kv"><span class="k">{t("perf.update")}</span><span class="v mono">{t("perf.ms", { v: fmtNum(perf.sample.updateMs, 0) })}</span><span></span></div>
          <div class="kv"><span class="k">{t("perf.layout")}</span><span class="v mono">{t("perf.ms", { v: fmtNum(perf.sample.layoutMs, 0) })}</span><span></span></div>
          <p class="note dim">{t("perf.hint")}</p>
        </section>
      </div>
    {/if}
  </div>
</div>

<style>
  .settings { padding: 14px 18px; overflow: auto; height: 100%; box-sizing: border-box; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 12px; align-items: start; max-width: 1500px; }
  .col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .settings :global(section.card) { margin: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); min-width: 0; }
  .settings :global(section.card.wide) { grid-column: 1 / -1; }
  .settings :global(section.card h3) { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin: 0 0 8px; }
  .kv { display: grid; grid-template-columns: 120px 1fr auto; gap: 8px; align-items: center; min-height: 28px; font-size: 13px; }
  .kv + .kv { border-top: 1px solid var(--line); }
  /* Folders: the name above, the path and its button under it. */
  .kv.stacked { grid-template-columns: 1fr auto; gap: 2px 8px; padding: 4px 0; }
  .kv.stacked .k { grid-column: 1 / -1; }
  .k { color: var(--muted); font-size: 12px; }
  .v { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; display: flex; align-items: center; gap: 6px; }
  .kv select { justify-self: start; grid-column: 2 / -1; }
  .btns { display: flex; gap: 4px; }
  .btns button { padding: 2px 8px; font-size: 12px; }
  .note { margin: 2px 0 4px 128px; font-size: 12px; }
  .check2 { display: flex; gap: 6px; align-items: center; font-size: 12.5px; margin: 6px 0 2px; }
  .link { background: none; border: none; padding: 0; color: var(--accent); cursor: pointer; font-size: 12px; }
  .actions { display: flex; gap: 6px; align-items: center; margin: 6px 0 2px 128px; }
  .actions button { padding: 3px 10px; font-size: 12px; }
  .actions .go { background: var(--accent); border-color: var(--accent); color: #fff; }
  .kv progress { width: 100%; }
  .pill { width: 8px; height: 8px; border-radius: 50%; background: var(--err); flex: none; }
  .pill.on { background: var(--ok); }
  p { margin: 2px 0; }
</style>
