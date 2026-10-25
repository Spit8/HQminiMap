<script lang="ts">
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { fold, industryLabel, isInactive, LAYERS, STATION_MODES, stationTraffic, stockTotal, type LayerId, type LiveData } from "$lib/core/filters";
  import type { StationMode } from "$lib/core/live";
  import { fmtNum, t } from "$lib/i18n/index.svelte";
  import { readText, writeText } from "$lib/platform/fsx";
  import { viewerFilters as vf } from "$lib/state/viewerFilters.svelte";
  import { iconSvg } from "./icons";
  import { MODE_COLOR, WAREHOUSE_COLOR } from "./layers";

  let { all, shown, names, selectedKey, onselect }: {
    /** Unfiltered data (lists, totals). */
    all: LiveData;
    /** Filtered data (counts). */
    shown: LiveData;
    /** "<layer>:<id>" → display name (hidden list). */
    names: (key: string) => string;
    /** Selected feature ("<layer>:<id>"), highlighted in the line list. */
    selectedKey: string | null;
    onselect: (key: string) => void;
  } = $props();

  const f = $derived(vf.current);
  const industryTypes = $derived([...new Set(all.industries.map((i) => i.type))].sort());
  const maxTownSize = $derived(Math.max(0, ...all.towns.map((x) => x.size)));
  let lineQuery = $state("");
  let lineSort = $state<"name" | "traffic">("name");
  const lineList = $derived(all.lines.filter((l) => !lineQuery || fold(l.name).includes(fold(lineQuery)))
    .sort((a, b) => lineSort === "traffic"
      ? (b.traffic?.transported ?? 0) - (a.traffic?.transported ?? 0)
      : a.name.localeCompare(b.name, undefined, { numeric: true })));
  const shownLines = $derived(new Set(shown.lines.map((l) => l.id)));
  const maxTransported = $derived(Math.max(0, ...all.lines.map((l) => l.traffic?.transported ?? 0)));
  const maxStationTraffic = $derived(Math.max(0, ...all.stations.map(stationTraffic)));
  const maxStock = $derived(Math.max(0, ...all.industries.map((i) => stockTotal(i.stocks)), ...all.warehouses.map((w) => stockTotal(w.stocks))));
  const inactiveCount = $derived(all.lines.filter(isInactive).length);
  const lineModesPresent = $derived(STATION_MODES.filter((m) => all.lines.some((l) => l.mode === m)));
  const stationModesPresent = $derived(STATION_MODES.filter((m) => all.stations.some((s) => s.mode === m)));
  /** Slider over 0..max with ~100 steps rounded to a "nice" value. */
  const niceStep = (max: number) => {
    const raw = Math.max(1, max / 100), p = 10 ** Math.floor(Math.log10(raw));
    return Math.ceil(raw / p) * p;
  };

  // Which layer sections are unfolded (remembered).
  const LS_OPEN = "hq.lpOpen";
  let unfolded = $state<Record<string, boolean>>((() => {
    try {
      return JSON.parse(localStorage.getItem(LS_OPEN) ?? "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  })());
  function fold_(layer: LayerId): void {
    unfolded = { ...unfolded, [layer]: !unfolded[layer] };
    try {
      localStorage.setItem(LS_OPEN, JSON.stringify(unfolded));
    } catch {
      /* storage unavailable */
    }
  }

  let presetName = $state("");
  let renaming = $state(false);
  let message = $state<string | null>(null);
  let presetTools = $state(false);

  const rgb = (c: [number, number, number] | null) =>
    c ? `rgb(${c.map((v) => Math.round(v * 255)).join(",")})` : "#aaa";

  function toggleIn<T>(list: T[] | null, allValues: T[], v: T): T[] | null {
    const cur = list ?? allValues;
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    return next.length === allValues.length ? null : next;
  }

  const toggleMode = (list: StationMode[], m: StationMode) => (list.includes(m) ? list.filter((x) => x !== m) : [...list, m]);

  function savePreset(): void {
    if (renaming && vf.activeName) vf.rename(vf.activeName, presetName);
    else vf.saveAs(presetName);
    renaming = false;
    presetName = "";
  }

  async function exportPresets(): Promise<void> {
    const path = await save({ defaultPath: "hqminimap-filters.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path) return;
    await writeText(path, vf.exportJson());
    message = t("lp.exported");
  }

  async function importPresets(): Promise<void> {
    const path = await open({ filters: [{ name: "JSON", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    try {
      message = t("lp.imported", { n: vf.importJson((await readText(path)) ?? "") });
    } catch {
      message = t("lp.importError");
    }
  }

  /** Symbol of each layer (same pictograms as on the map). */
  const LAYER_ICON: Record<LayerId, string> = {
    towns: `<svg viewBox="0 0 16 16" width="16" height="16"><path d="M3 4.5c2-1.6 5-.8 6.4-1.4 1.8-.8 3.8.6 3.6 3-.2 2 1 3.4-.6 5.4-1.6 2-4.6 1.4-6.8 1.4C3 12.9 1.7 10.6 2 8.4c.2-1.6 0-2.6 1-3.9z" fill="rgba(255,255,255,.12)" stroke="#fff" stroke-width="1.2"/></svg>`,
    industries: iconSvg("factory", "hsl(28, 60%, 48%)", { size: 16, shape: "square" }),
    warehouses: iconSvg("warehouse", WAREHOUSE_COLOR, { size: 16, shape: "square" }),
    stations: iconSvg("rail", MODE_COLOR.rail, { size: 16, shape: "square" }),
    lines: `<svg viewBox="0 0 16 16" width="16" height="16"><path d="M1.5 12c3-1 3.5-7 7-7s3.5 4 6 3" fill="none" stroke="#6aa7e8" stroke-width="2.6" stroke-linecap="round"/></svg>`,
    vehicles: iconSvg("road", "#6aa7e8"),
  };
</script>

<aside class="panel">
  <header>
    <strong>{t("lp.title")}</strong>
    <button class="ghost" title={t("lp.hide")} onclick={() => vf.setPanel(false)}>«</button>
  </header>

  <div class="card tools">
    <input class="search" type="search" placeholder={t("lp.search")} value={f.search}
      oninput={(e) => vf.set({ search: (e.target as HTMLInputElement).value })} />
    <div class="row">
      <select class="grow" value={vf.activeName ?? ""} onchange={(e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (v) vf.apply(v);
      }}>
        <option value="">{vf.activeName ? "" : t("lp.unsaved")}</option>
        {#each vf.store.presets as p (p.name)}
          <option value={p.name}>{p.name}{vf.store.defaultName === p.name ? " ★" : ""}</option>
        {/each}
      </select>
      {#if vf.activeName}
        <button class="ghost" title={t("lp.update")} onclick={() => vf.saveAs(vf.activeName!)}>💾</button>
        <button class="ghost" title={vf.store.defaultName === vf.activeName ? t("lp.undefault") : t("lp.default")}
          onclick={() => vf.setDefault(vf.store.defaultName === vf.activeName ? null : vf.activeName)}>
          {vf.store.defaultName === vf.activeName ? "★" : "☆"}</button>
      {/if}
      <button class="ghost" class:on={presetTools} title={t("lp.more")} onclick={() => (presetTools = !presetTools)}>⋯</button>
    </div>
    {#if presetTools}
      <form class="row" onsubmit={(e) => { e.preventDefault(); savePreset(); }}>
        <input class="grow" placeholder={renaming ? t("lp.newName") : t("lp.saveAsPlaceholder")} bind:value={presetName} />
        <button type="submit" disabled={!presetName.trim()}>{renaming ? t("lp.renameOk") : t("lp.saveAs")}</button>
      </form>
      <div class="row wrap small">
        {#if vf.activeName}
          <button onclick={() => { renaming = true; presetName = vf.activeName ?? ""; }}>✎ {t("lp.rename")}</button>
          <button onclick={() => vf.remove(vf.activeName!)}>🗑 {t("lp.delete")}</button>
        {/if}
        <button onclick={importPresets}>{t("lp.import")}</button>
        <button onclick={exportPresets} disabled={!vf.store.presets.length}>{t("lp.export")}</button>
        <button onclick={() => vf.reset()}>{t("lp.reset")}</button>
      </div>
      {#if message}<p class="dim small">{message}</p>{/if}
    {/if}
  </div>

  {#snippet range(text: string, value: number, max: number, onset: (v: number) => void)}
    <label class="range">
      <span class="rl"><span>{text}</span><span class="rv">{fmtNum(value)}</span></span>
      <input type="range" min="0" {max} step={niceStep(max)} {value} oninput={(e) => onset(Number((e.target as HTMLInputElement).value))} />
    </label>
  {/snippet}

  {#snippet modeChips(present: StationMode[], list: StationMode[], onset: (l: StationMode[]) => void)}
    <div class="chips">
      {#each present as m (m)}
        <button class="chip" class:on={list.includes(m)} onclick={() => onset(toggleMode(list, m))}>
          <span class="dot" style:background={MODE_COLOR[m]}></span>{t(`lp.mode.${m}`)}</button>
      {/each}
    </div>
  {/snippet}

  {#snippet layerCard(layer: LayerId, body: (() => ReturnType<import("svelte").Snippet>) | null)}
    <div class="card layer" class:off={!f.layers[layer]}>
      <div class="lhead">
        <button class="chev" class:open={unfolded[layer]} disabled={!body} onclick={() => fold_(layer)} aria-label={t("lp.filters")}>›</button>
        <span class="licon">{@html LAYER_ICON[layer]}</span>
        <button class="lname" onclick={() => body && fold_(layer)}>{t(`live.kind.${layer}`)}</button>
        <span class="pill">{shown[layer].length}<span class="dim">/{all[layer].length}</span></span>
        <button class="tgl" class:on={f.labels[layer]} disabled={!f.layers[layer]} title={t(`lp.labels.${layer}`)}
          onclick={() => vf.set({ labels: { ...f.labels, [layer]: !f.labels[layer] } })}>🏷</button>
        <button class="tgl" class:on={f.layers[layer]} title={t("lp.visible")} onclick={() => vf.toggleLayer(layer)}>👁</button>
      </div>
      {#if body && unfolded[layer] && f.layers[layer]}<div class="lbody">{@render body()}</div>{/if}
    </div>
  {/snippet}

  {#snippet townsBody()}
    {#if maxTownSize > 0}{@render range(t("lp.townMinLabel"), f.townMinSize, maxTownSize, (v) => vf.set({ townMinSize: v }))}{/if}
  {/snippet}

  {#snippet industriesBody()}
    {#if maxStock > 0}{@render range(t("lp.stockMinLabel"), f.stockMin, maxStock, (v) => vf.set({ stockMin: v }))}{/if}
    {#if industryTypes.length}
      <div class="chips">
        {#each industryTypes as ty (ty)}
          <button class="chip" class:on={!f.industryTypes || f.industryTypes.includes(ty)}
            onclick={() => vf.set({ industryTypes: toggleIn(f.industryTypes, industryTypes, ty) })}>{industryLabel(ty)}</button>
        {/each}
      </div>
    {/if}
  {/snippet}

  {#snippet warehousesBody()}
    {#if !all.warehouses.length}<p class="dim small">{t("lp.noWarehouses")}</p>
    {:else if maxStock > 0}{@render range(t("lp.stockMinLabel"), f.stockMin, maxStock, (v) => vf.set({ stockMin: v }))}{/if}
  {/snippet}

  {#snippet stationsBody()}
    {@render modeChips(stationModesPresent, f.stationModes, (l) => vf.set({ stationModes: l }))}
    <div class="seg">
      {#each ["all", "passengers", "cargo"] as const as k (k)}
        <button class:on={f.stationKind === k} onclick={() => vf.set({ stationKind: k })}>{t(`lp.kind.${k}`)}</button>
      {/each}
    </div>
    {#if maxStationTraffic > 0}
      {@render range(t("lp.stationMinLabel"), f.stationMinTraffic, maxStationTraffic, (v) => vf.set({ stationMinTraffic: v }))}
    {/if}
  {/snippet}

  {#snippet linesBody()}
    {#if lineModesPresent.length > 1}{@render modeChips(lineModesPresent, f.lineModes, (l) => vf.set({ lineModes: l }))}{/if}
    {#if inactiveCount}
      <label class="check small"><input type="checkbox" checked={f.showInactiveLines}
        onchange={(e) => vf.set({ showInactiveLines: (e.target as HTMLInputElement).checked })} />
        {t("lp.inactiveLines", { n: inactiveCount })}</label>
    {/if}
    {#if maxTransported > 0}
      {@render range(t("lp.lineMinLabel"), f.lineMinTransported, maxTransported, (v) => vf.set({ lineMinTransported: v }))}
    {/if}
    <div class="row small">
      <input class="grow" type="search" placeholder={t("lp.filterLines")} bind:value={lineQuery} />
      <button class="ghost" title={t("lp.all")} onclick={() => vf.set({ lineIds: null })}>☑</button>
      <button class="ghost" title={t("lp.none")} onclick={() => vf.set({ lineIds: [] })}>☐</button>
      <button class="ghost" title={t("lp.sortTitle")} onclick={() => (lineSort = lineSort === "name" ? "traffic" : "name")}>
        {lineSort === "name" ? "A→Z" : "↓"}</button>
    </div>
    <div class="list">
      {#each lineList as l (l.id)}
        {@const sel = selectedKey === `lines:${l.id}`}
        <div class="lrow" class:sel class:off={!shownLines.has(l.id)} style:--c={rgb(l.color)}>
          <input type="checkbox" checked={!f.lineIds || f.lineIds.includes(l.id)}
            onchange={() => vf.set({ lineIds: toggleIn(f.lineIds, all.lines.map((x) => x.id), l.id) })} />
          <span class="mi">{@html iconSvg(l.mode, rgb(l.color), 14)}</span>
          <button class="ln" title={t("lp.selectLine")} onclick={() => onselect(`lines:${l.id}`)}>{l.name}</button>
          {#if isInactive(l)}<span class="tag-inactive">{t("lp.inactive")}</span>{/if}
          {#if l.traffic && maxTransported > 0}
            <span class="bar" title={fmtNum(l.traffic.transported)}><span style:width="{(l.traffic.transported / maxTransported) * 100}%"></span></span>
          {/if}
        </div>
      {/each}
    </div>
  {/snippet}

  {#snippet vehiclesBody()}
    <label class="check small"><input type="checkbox" checked={f.vehiclesFollowLines}
      onchange={(e) => vf.set({ vehiclesFollowLines: (e.target as HTMLInputElement).checked })} /> {t("lp.followLines")}</label>
  {/snippet}

  {@render layerCard("towns", townsBody)}
  {@render layerCard("lines", linesBody)}
  {@render layerCard("stations", stationsBody)}
  {@render layerCard("vehicles", vehiclesBody)}
  {@render layerCard("industries", industriesBody)}
  {@render layerCard("warehouses", warehousesBody)}

  {#if f.hidden.length}
    <div class="card">
      <div class="row between"><strong class="small">{t("lp.hidden", { n: f.hidden.length })}</strong>
        <button class="small" onclick={() => vf.unhide(null)}>{t("lp.showAll")}</button></div>
      <div class="list">
        {#each f.hidden as k (k)}
          <div class="row between small"><span>{names(k)}</span><button class="ghost" title={t("lp.show")} onclick={() => vf.unhide(k)}>👁</button></div>
        {/each}
      </div>
    </div>
  {/if}

  <details class="card symbols">
    <summary>{t("lp.legend")}</summary>
    <div class="sgrid">
      {#each ["rail", "road", "tram", "water", "air"] as const as m (m)}
        <span class="sym">{@html iconSvg(m, MODE_COLOR[m], 14)}</span><span>{t(`lp.mode.${m}`)}</span>
      {/each}
      <span class="sym">{@html iconSvg("road", MODE_COLOR.road, { size: 14, shape: "square" })}</span>
      <span>{t("lp.legend.passengers")}</span>
      <span class="sym">{@html iconSvg("road", MODE_COLOR.road, { size: 14, shape: "square", corner: true })}</span>
      <span>{t("lp.legend.cargo")}</span>
      <span class="sym">{@html iconSvg("road", MODE_COLOR.road, { size: 14, shape: "square", double: true })}</span>
      <span>{t("lp.legend.both")}</span>
      <span class="sym">{@html iconSvg("road", "#6aa7e8", 14)}</span>
      <span>{t("lp.legend.vehicleDisc")}</span>
      <span class="sym">{@html iconSvg("factory", "hsl(28, 60%, 48%)", { size: 14, shape: "square" })}</span>
      <span>{t("live.kind.industries")}</span>
      <span class="sym">{@html iconSvg("warehouse", WAREHOUSE_COLOR, { size: 14, shape: "square" })}</span>
      <span>{t("live.kind.warehouses")}</span>
      <span class="sym"><svg viewBox="0 0 24 10" width="22" height="10"><line x1="1" y1="5" x2="23" y2="5" stroke="#6aa7e8" stroke-width="3"/></svg></span>
      <span>{t("lp.legend.track")}</span>
      <span class="sym"><svg viewBox="0 0 24 10" width="22" height="10"><line x1="1" y1="5" x2="23" y2="5" stroke="#6aa7e8" stroke-width="3" stroke-dasharray="5 3"/></svg></span>
      <span>{t("lp.legend.legs")}</span>
      <span class="sym"><svg viewBox="0 0 24 10" width="22" height="10"><line x1="1" y1="5" x2="23" y2="5" stroke="#3fa7e0" stroke-width="2" stroke-dasharray="1 3" stroke-linecap="round"/></svg></span>
      <span>{t("lp.legend.trail")}</span>
    </div>
  </details>

  {#if !LAYERS.some((l) => all[l].length)}<p class="dim small">{t("lp.noData")}</p>{/if}
</aside>

<style>
  .panel { position: absolute; z-index: 5; top: 0; left: 0; bottom: 0; width: 300px; overflow: auto; box-sizing: border-box;
    padding: 8px; display: flex; flex-direction: column; gap: 6px;
    background: rgba(18, 21, 27, .93); backdrop-filter: blur(6px); border-right: 1px solid var(--line); font-size: 13px; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 2px 4px; }
  header strong { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .card { background: rgba(255, 255, 255, .035); border: 1px solid rgba(255, 255, 255, .06); border-radius: 9px; padding: 6px 8px; }
  .tools { display: flex; flex-direction: column; gap: 5px; }
  .row { display: flex; gap: 4px; align-items: center; }
  .wrap { flex-wrap: wrap; }
  .grow { flex: 1; min-width: 0; }
  .between { justify-content: space-between; }
  .small, .small button { font-size: 12px; }
  .search { width: 100%; box-sizing: border-box; border-radius: 7px; padding: 5px 8px; }
  button { padding: 2px 7px; }
  .ghost { background: none; border: 1px solid transparent; padding: 1px 6px; opacity: .75; }
  .ghost:hover, .ghost.on { opacity: 1; border-color: var(--line); }

  .layer.off .licon, .layer.off .lname { opacity: .45; }
  .lhead { display: flex; align-items: center; gap: 6px; }
  .chev { background: none; border: none; padding: 0 2px; color: var(--muted); font-size: 15px; line-height: 1; transition: transform .15s; }
  .chev.open { transform: rotate(90deg); }
  .chev:disabled { visibility: hidden; }
  .licon { display: inline-flex; width: 16px; height: 16px; }
  .lname { flex: 1; text-align: left; background: none; border: none; padding: 0; font-weight: 600; color: var(--text); cursor: pointer; }
  .pill { font-size: 11px; padding: 0 6px; border-radius: 9px; background: rgba(255, 255, 255, .07); font-variant-numeric: tabular-nums; }
  .tgl { background: none; border: none; padding: 0 2px; font-size: 13px; opacity: .3; filter: grayscale(1); }
  .tgl.on { opacity: 1; filter: none; }
  .tgl:disabled { opacity: .12; }
  .lbody { display: flex; flex-direction: column; gap: 6px; padding: 6px 0 2px 22px; }

  .range { display: flex; flex-direction: column; gap: 1px; font-size: 12px; color: var(--muted); }
  .rl { display: flex; justify-content: space-between; }
  .rv { color: var(--text); font-variant-numeric: tabular-nums; }
  .range input { width: 100%; margin: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; padding: 1px 8px; border-radius: 11px;
    background: rgba(255, 255, 255, .04); border: 1px solid var(--line); opacity: .5; }
  .chip.on { opacity: 1; background: rgba(255, 255, 255, .1); }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 7px; overflow: hidden; align-self: flex-start; }
  .seg button { border: none; border-radius: 0; font-size: 11.5px; padding: 2px 9px; background: none; opacity: .6; }
  .seg button.on { background: rgba(255, 255, 255, .12); opacity: 1; }
  .check { display: flex; gap: 6px; align-items: center; }

  .list { max-height: 260px; overflow: auto; display: flex; flex-direction: column; gap: 1px; }
  .lrow { display: flex; gap: 5px; align-items: center; padding: 2px 4px; border-radius: 5px; border-left: 3px solid var(--c); }
  .lrow.sel { background: color-mix(in srgb, var(--c) 28%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 70%, transparent); }
  .lrow.off .ln, .lrow.off .mi { opacity: .45; }
  .mi { display: inline-flex; }
  .ln { flex: 1; min-width: 0; text-align: left; background: none; border: none; padding: 0; color: var(--text);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; font-size: 12px; }
  .ln:hover { text-decoration: underline; }
  .tag-inactive { font-size: 10px; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 0 4px; }
  .bar { width: 38px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, .08); overflow: hidden; flex: none; }
  .bar span { display: block; height: 100%; background: var(--c); }

  .symbols summary { cursor: pointer; font-size: 12px; color: var(--muted); }
  .sgrid { display: grid; grid-template-columns: 24px 1fr 24px 1fr; gap: 4px 4px; align-items: center; margin-top: 6px; font-size: 11.5px; }
  .sym { display: inline-flex; justify-content: center; }
  p { margin: 2px 0; }
</style>
