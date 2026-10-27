<script lang="ts">
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { CONTOUR_STEPS, RELIEF_MODES, RELIEF_STOPS, RELIEF_STOPS_MAX, RELIEF_SCALES, fold, industryLabel, isInactive, LAYERS, STATION_MODES, stationTraffic, stockTotal, type LayerId, type LiveData } from "$lib/core/filters";
  import type { StationMode } from "$lib/core/live";
  import { fmtNum, t } from "$lib/i18n/index.svelte";
  import { readText, writeText } from "$lib/platform/fsx";
  import { viewerFilters as vf } from "$lib/state/viewerFilters.svelte";
  import { iconSvg } from "./icons";
  import { MODE_COLOR, WAREHOUSE_COLOR } from "./layers";
  import { loadBadge, stopGlyph } from "./icons";
  import PanelResizer, { loadWidth } from "../PanelResizer.svelte";
  import { rampColor } from "$lib/core/relief";
  import type { ReliefInfo } from "./relief";

  let { all, shown, reliefInfo, viewInfo, hasRelief, hasOrtho, names, selectedKey, onselect }: {
    /** Unfiltered data (lists, totals). */
    all: LiveData;
    /** Contour interval drawn and the altitudes of the colour ramp (legend). */
    reliefInfo: ReliefInfo;
    /** Image size and resolution (or map size) and zoom, at the bottom of the panel. */
    viewInfo: string;
    /** A heightmap is available for the contours. */
    hasRelief: boolean;
    /** An ortho is shown (its image can be switched off). */
    hasOrtho: boolean;
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
  /**
   * Relief colour ramp as drawn on the map: 33 stops (CSS interpolates in RGB between stops while the
   * map follows the hue, few stops showed kinks), at the colour layer's opacity over the map background.
   */
  const rampCss = $derived.by(() => {
    const a = Math.min(1, Math.max(0.1, f.relief.opacity));
    const stops = Array.from({ length: 65 }, (_, i) => i / 64)
      .map((k) => {
        const [r, g, b, al] = rampColor(f.relief.stops, k);
        return `rgba(${r},${g},${b},${(al * a).toFixed(3)}) ${(k * 100).toFixed(2)}%`;
      }).join(", ");
    return `linear-gradient(90deg, ${stops})`;
  });

  const PANEL_W = { key: "hq.layersPanelW", min: 260, max: 560, fallback: 300 };
  let panelW = $state(loadWidth(PANEL_W.key, PANEL_W.fallback, PANEL_W.min, PANEL_W.max));

  /** Panel sections: the legend starts folded, the layers open. */
  const SECTION_DEFAULT: Record<string, boolean> = { legend: false, layers: true };
  const secOpen = (id: string) => unfolded[`sec.${id}`] ?? SECTION_DEFAULT[id] ?? true;
  function fold_(key: string, open = !unfolded[key]): void {
    unfolded = { ...unfolded, [key]: open };
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
    try {
      await writeText(path, vf.exportJson());
      message = t("lp.exported");
    } catch (err) {
      message = t("lp.exportError", { error: String(err) });
    }
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

  const RELIEF_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#fff" stroke-width="1.1"><path d="M1.5 12.5c2.5-1 4-4.5 6.5-4.5s4 3 6.5 4" stroke-opacity=".9"/><path d="M4 12.8c1.5-.6 2.6-2.6 4-2.6s2.5 1.7 4 2.4" stroke-opacity=".5"/><path d="M5 6.5c1-1.5 2-3 3-3s2 1.4 3 3" stroke-opacity=".7"/></svg>`;

  const BASEMAP_ICON = `<svg viewBox="0 0 16 16" width="16" height="16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="#000" stroke="#fff" stroke-width="1.1"/><path d="M2.2 10.5c2-1.6 3.6.4 5.6-.8s3.2-1.4 5.8-.4V13H2.2z" fill="#3fa7e0" fill-opacity=".55"/><path d="M2.2 10.5c2-1.6 3.6.4 5.6-.8s3.2-1.4 5.8-.4" fill="none" stroke="#3fa7e0" stroke-width="1"/></svg>`;

  /** Example load badge (same drawing as on the map). */
  const LEGEND_BADGE = loadBadge("#6aa7e8", [
    { kind: "pax", text: "12/40" }, { kind: "freight", text: "3/10" },
  ]);

  /** Symbol of each layer (same pictograms as on the map). */
  const LAYER_ICON: Record<LayerId, string> = {
    towns: `<svg viewBox="0 0 16 16" width="16" height="16"><path d="M3 4.5c2-1.6 5-.8 6.4-1.4 1.8-.8 3.8.6 3.6 3-.2 2 1 3.4-.6 5.4-1.6 2-4.6 1.4-6.8 1.4C3 12.9 1.7 10.6 2 8.4c.2-1.6 0-2.6 1-3.9z" fill="rgba(255,255,255,.12)" stroke="#fff" stroke-width="1.2"/></svg>`,
    industries: iconSvg("factory", "hsl(28, 60%, 48%)", { size: 16, shape: "square" }),
    warehouses: iconSvg("warehouse", WAREHOUSE_COLOR, { size: 16, shape: "square" }),
    stations: iconSvg("stop_road", "#6aa7e8", { size: 16, shape: "square" }),
    lines: `<svg viewBox="0 0 16 16" width="16" height="16"><path d="M1.5 12c3-1 3.5-7 7-7s3.5 4 6 3" fill="none" stroke="#6aa7e8" stroke-width="2.6" stroke-linecap="round"/></svg>`,
    vehicles: iconSvg("road", "#6aa7e8"),
  };
</script>

<aside class="panel" style:width="{panelW}px">
  <PanelResizer bind:width={panelW} {...PANEL_W} />
  <!-- The content scrolls, not the panel: the resize handle stays along the whole edge. -->
  <div class="inner">
  {#snippet section(id: string, title: string, body: () => ReturnType<import("svelte").Snippet>, extra: (() => ReturnType<import("svelte").Snippet>) | null)}
    <section class="sec">
      <div class="sechead">
        <button class="sectitle" aria-expanded={secOpen(id)} onclick={() => fold_(`sec.${id}`, !secOpen(id))}>
          <span class="chev" class:open={secOpen(id)}>›</span>{title}</button>
        {#if extra}{@render extra()}{/if}
      </div>
      {#if secOpen(id)}<div class="secbody">{@render body()}</div>{/if}
    </section>
  {/snippet}

  {#snippet hideButton()}
    <button class="ghost" title={t("lp.hide")} onclick={() => vf.setPanel(false)}>«</button>
  {/snippet}

  {#snippet legendBody()}
    <div class="card symbols">
  <div class="sgrid">
      {#each STATION_MODES as m (m)}
        <span class="sym">{@html iconSvg(m, MODE_COLOR[m], 14)}</span><span>{t(`lp.mode.${m}`)}</span>
      {/each}
      {#each STATION_MODES as m (m)}
        <span class="sym">{@html iconSvg(stopGlyph(m), "#6aa7e8", { size: 14, shape: "square" })}</span><span>{t(`lp.stop.${m}`)}</span>
      {/each}
      <span class="sym">{@html iconSvg("stop_road", "#6aa7e8", { size: 14, shape: "square", stripes: ["#e2574c", "#6aa7e8", "#f2c94c"] })}</span>
      <span>{t("lp.legend.multi")}</span>
      <span class="sym">{@html iconSvg("stop_road", "#6aa7e8", { size: 14, shape: "square", corner: true })}</span>
      <span>{t("lp.legend.cargo")}</span>
      <span class="sym">{@html iconSvg("stop_road", "#6aa7e8", { size: 14, shape: "square", double: true })}</span>
      <span>{t("lp.legend.both")}</span>
      <span class="sym">{@html iconSvg("road", "#6aa7e8", 14)}</span>
      <span>{t("lp.legend.vehicleDisc")}</span>
      <span class="sym">{@html iconSvg("factory", "hsl(28, 60%, 48%)", { size: 14, shape: "square" })}</span>
      <span>{t("live.kind.industries")}</span>
      <span class="sym">{@html iconSvg("warehouse", WAREHOUSE_COLOR, { size: 14, shape: "square" })}</span>
      <span>{t("live.kind.warehouses")}</span>
      <span class="sym"><svg viewBox="0 0 24 10" width="22" height="10"><line x1="1" y1="5" x2="23" y2="5" stroke="#6aa7e8" stroke-width="3"/></svg></span>
      <span>{t("lp.legend.track")}</span>
      <span class="sym"><svg viewBox="0 0 24 10" width="22" height="10"><line x1="1" y1="5" x2="23" y2="5" stroke="#e2574c" stroke-width="3" stroke-dasharray="5 5"/><line x1="1" y1="5" x2="23" y2="5" stroke="#6aa7e8" stroke-width="3" stroke-dasharray="5 5" stroke-dashoffset="5"/></svg></span>
      <span>{t("lp.legend.shared")}</span>
      <span class="sym"><svg viewBox="0 0 24 10" width="22" height="10"><line x1="1" y1="3" x2="23" y2="3" stroke="#6aa7e8" stroke-width="2.4"/><line x1="1" y1="7.5" x2="23" y2="7.5" stroke="#6aa7e8" stroke-width="2.4"/></svg></span>
      <span>{t("lp.legend.twoWay")}</span>
      <span class="sym"><svg viewBox="0 0 24 10" width="22" height="10"><line x1="1" y1="5" x2="23" y2="5" stroke="rgba(255,255,255,.6)" stroke-width="0.8"/></svg></span>
      <span>{t("lp.legend.contour")}</span>
      <span class="sym"><svg viewBox="0 0 24 10" width="22" height="10"><line x1="1" y1="5" x2="23" y2="5" stroke="rgba(255,255,255,.8)" stroke-width="1.5"/></svg></span>
      <span>{t("lp.legend.contourMajor")}</span>
      <span class="legend-badge"><img alt="" src={LEGEND_BADGE.uri} width={LEGEND_BADGE.width} height={LEGEND_BADGE.height} /></span>
      <span class="legend-badge-text">{t("lp.legend.badges")}</span>
      <span class="sym"><svg viewBox="0 0 24 10" width="22" height="10"><line x1="1" y1="5" x2="23" y2="5" stroke="#6aa7e8" stroke-width="3" stroke-dasharray="5 3"/></svg></span>
      <span>{t("lp.legend.legs")}</span>
      <span class="sym"><svg viewBox="0 0 24 10" width="22" height="10"><line x1="1" y1="5" x2="23" y2="5" stroke="#3fa7e0" stroke-width="2" stroke-dasharray="1 3" stroke-linecap="round"/></svg></span>
      <span>{t("lp.legend.trail")}</span>
      <span class="sym"><svg viewBox="0 0 24 10" width="22" height="10"><line x1="1" y1="5" x2="23" y2="5" stroke="#6aa7e8" stroke-width="1.6" stroke-opacity=".8"/></svg></span>
      <span>{t("lp.legend.fill")}</span>
      {#if f.relief.show && f.relief.mode !== "lines" && reliefInfo.ticks}
        <span class="legend-ramp">
          <span class="ramp" style:background-image={rampCss}></span>
          <span class="ticks">{#each reliefInfo.ticks as z, k (k)}<span>{fmtNum(z)}</span>{/each}</span>
          <span class="dim">{t("lp.legend.reliefM")}</span>
        </span>
      {/if}
    </div>
    </div>
  {/snippet}

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
      {#if present.length > 1}{@render allNone(() => onset([...STATION_MODES]), () => onset([]))}{/if}
    </div>
  {/snippet}

  {#snippet allNone(onall: () => void, onnone: () => void)}
    <span class="allnone">
      <button class="ghost" title={t("lp.checkAll")} onclick={onall}>☑</button>
      <button class="ghost" title={t("lp.uncheckAll")} onclick={onnone}>☐</button>
    </span>
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
        {#if industryTypes.length > 1}{@render allNone(() => vf.set({ industryTypes: null }), () => vf.set({ industryTypes: [] }))}{/if}
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


  {#snippet layersBody()}
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

  {#if hasOrtho}
    <div class="card layer" class:off={!f.basemap}>
      <div class="lhead">
        <span class="chev-space"></span>
        <span class="licon">{@html BASEMAP_ICON}</span>
        <span class="lname static">{t("lp.basemap")}</span>
        <span class="dim small">{f.basemap ? t("lp.basemap.ortho") : t("lp.basemap.plain")}</span>
        <button class="tgl" class:on={f.basemap} title={t("lp.basemap.title")} onclick={() => vf.set({ basemap: !f.basemap })}>👁</button>
      </div>
    </div>
  {/if}
  {@render layerCard("towns", townsBody)}
  {@render layerCard("lines", linesBody)}
  {@render layerCard("stations", stationsBody)}
  {@render layerCard("vehicles", vehiclesBody)}
  {@render layerCard("industries", industriesBody)}
  {@render layerCard("warehouses", warehousesBody)}

  {#if hasRelief}
    {@const c = f.relief}
    <div class="card layer" class:off={!c.show}>
      <div class="lhead">
        <button class="chev" class:open={unfolded.relief} onclick={() => fold_("relief")} aria-label={t("lp.filters")}>›</button>
        <span class="licon">{@html RELIEF_ICON}</span>
        <button class="lname" onclick={() => fold_("relief")}>{t("lp.relief")}</button>
        {#if c.show && reliefInfo.step}<span class="pill">{fmtNum(reliefInfo.step)} m</span>{/if}
        <button class="tgl" class:on={c.labels} disabled={!c.show || c.mode === "colors"} title={t("lp.relief.labels")}
          onclick={() => vf.set({ relief: { ...c, labels: !c.labels } })}>🏷</button>
        <button class="tgl" class:on={c.show} title={t("lp.visible")} onclick={() => vf.set({ relief: { ...c, show: !c.show } })}>👁</button>
      </div>
      {#if unfolded.relief && c.show}
        <div class="lbody">
          <div class="seg">
            {#each RELIEF_MODES as m (m)}
              <button class:on={c.mode === m} onclick={() => vf.set({ relief: { ...c, mode: m } })}>{t(`lp.relief.mode.${m}`)}</button>
            {/each}
          </div>
          {#if c.mode !== "lines"}
            <span class="ramp" style:background-image={rampCss}></span>
            <!-- One row per colour, lowest ground first: colour, its opacity (wide slider), remove. -->
            <div class="colors">
              {#each c.stops as st, k (k)}
                {@const setStop = (patch: Partial<typeof st>) => vf.set({ relief: { ...c, stops: c.stops.map((x, i) => (i === k ? { ...x, ...patch } : x)) } })}
                <div class="stop">
                  <input type="color" value={st.color} title={t("lp.relief.stop", { n: k + 1 })}
                    oninput={(e) => setStop({ color: (e.target as HTMLInputElement).value })} />
                  <span class="sname">{k === 0 ? t("lp.relief.low") : k === c.stops.length - 1 ? t("lp.relief.high") : ""}</span>
                  <input class="alpha" type="range" min="0" max="1" step="0.05" value={st.alpha}
                    title={t("lp.relief.stopAlpha", { pct: Math.round(st.alpha * 100) })}
                    oninput={(e) => setStop({ alpha: Number((e.target as HTMLInputElement).value) })} />
                  <span class="pct">{Math.round(st.alpha * 100)} %</span>
                  {#if c.stops.length > 2}<button class="ghost rm" title={t("lp.relief.removeStop")}
                    onclick={() => vf.set({ relief: { ...c, stops: c.stops.filter((_, i) => i !== k) } })}>×</button>{:else}<span></span>{/if}
                </div>
              {/each}
              {#if c.stops.length < RELIEF_STOPS_MAX}<button class="ghost add" title={t("lp.relief.addStop")}
                onclick={() => vf.set({ relief: { ...c, stops: [...c.stops, { ...c.stops[c.stops.length - 1]! }] } })}>+ {t("lp.relief.addStop")}</button>{/if}
            </div>
            <label class="range"><span class="rl"><span>{t("lp.relief.scale")}</span></span>
              <select value={c.scale} onchange={(e) => vf.set({ relief: { ...c, scale: (e.target as HTMLSelectElement).value as typeof c.scale } })}>
                {#each RELIEF_SCALES as sc (sc)}<option value={sc}>{t(`lp.relief.scale.${sc}`)}</option>{/each}
              </select>
            </label>
            <div class="range">
              <span class="rl"><span>{t("lp.relief.balance")}</span>
                <span class="rv">{c.balance > 0 ? "+" : ""}{fmtNum(c.balance * 100)}{#if c.balance}
                  <button class="link small" title={t("lp.relief.balanceReset")} onclick={() => vf.set({ relief: { ...c, balance: 0 } })}> ↺</button>{/if}</span></span>
              <input type="range" min="-1" max="1" step="0.05" value={c.balance}
                oninput={(e) => vf.set({ relief: { ...c, balance: Number((e.target as HTMLInputElement).value) } })} />
            </div>
            <label class="range">
              <span class="rl"><span>{t("lp.relief.opacity")}</span><span class="rv">{Math.round(c.opacity * 100)} %</span></span>
              <input type="range" min="0.1" max="1" step="0.05" value={c.opacity}
                oninput={(e) => vf.set({ relief: { ...c, opacity: Number((e.target as HTMLInputElement).value) } })} />
            </label>
            {#if JSON.stringify(c.stops) !== JSON.stringify(RELIEF_STOPS) || c.opacity !== 1}
              <button class="link small" onclick={() => vf.set({ relief: { ...c, stops: RELIEF_STOPS.map((s) => ({ ...s })), opacity: 1 } })}>{t("lp.relief.resetColors")}</button>
            {/if}
          {/if}
          {#if c.mode !== "colors"}
            <label class="range"><span class="rl"><span>{t("lp.relief.step")}</span></span>
              <select value={c.step} onchange={(e) => vf.set({ relief: { ...c, step: Number((e.target as HTMLSelectElement).value) } })}>
                {#each CONTOUR_STEPS as st (st)}
                  <option value={st}>{st ? `${st} m` : t("lp.relief.auto", { step: c.step === 0 && reliefInfo.step ? fmtNum(reliefInfo.step) : "…" })}</option>
                {/each}
              </select>
            </label>
            <label class="range">
              <span class="rl"><span>{t("lp.relief.width")}</span><span class="rv">{Math.round(c.width * 100)} %</span></span>
              <input type="range" min="0.5" max="3" step="0.1" value={c.width}
                oninput={(e) => vf.set({ relief: { ...c, width: Number((e.target as HTMLInputElement).value) } })} />
            </label>
          {/if}
          <p class="dim small">{t("lp.relief.hint")}</p>
        </div>
      {/if}
    </div>
  {/if}

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

  {#if !LAYERS.some((l) => all[l].length)}<p class="dim small">{t("lp.noData")}</p>{/if}
  {/snippet}

  {@render section("legend", t("lp.legend"), legendBody, hideButton)}
  {@render section("layers", t("lp.title"), layersBody, null)}
  {#if viewInfo}<footer class="vinfo dim">{viewInfo}</footer>{/if}
  </div>
</aside>

<style>
  .panel { position: absolute; z-index: 5; top: 0; left: 0; bottom: 0; width: 300px; box-sizing: border-box;
    background: rgba(18, 21, 27, .93); backdrop-filter: blur(6px); border-right: 1px solid var(--line); font-size: 13px; }
  .inner { height: 100%; overflow: auto; box-sizing: border-box; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
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
  .chev-space { width: 13px; flex: none; }
  .lname.static { cursor: default; }
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
  .allnone { display: inline-flex; margin-left: auto; }
  .allnone .ghost { font-size: 12px; padding: 0 4px; }
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

  .sgrid { display: grid; grid-template-columns: 24px 1fr 24px 1fr; gap: 4px 4px; align-items: center; font-size: 11.5px; }
  .sym { display: inline-flex; justify-content: center; }
  .legend-badge { grid-column: 1 / 3; display: inline-flex; align-items: center; }
  .legend-ramp { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 1px; font-size: 10.5px; }
  .ticks { display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; }
  /* Map background under the colours. The gradient covers the border box and does not repeat:
     otherwise it tiles again under the border and the rounded ends show a sliver of the opposite colour. */
  .ramp { display: inline-block; width: 100%; min-width: 40px; height: 9px; border-radius: 3px; border: 1px solid rgba(255, 255, 255, .15);
    background-color: #0e1015; background-origin: border-box; background-repeat: no-repeat; }
  .colors { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); }
  .stop { display: grid; grid-template-columns: 26px 30px 1fr 38px 18px; gap: 6px; align-items: center; }
  .stop input[type="color"] { width: 26px; height: 20px; padding: 0; border: 1px solid var(--line); border-radius: 4px; background: none; cursor: pointer; }
  .stop .sname { font-size: 11px; }
  .stop .alpha { width: 100%; margin: 0; }
  .stop .pct { font-size: 11px; text-align: right; font-variant-numeric: tabular-nums; }
  .stop .rm { padding: 0 4px; font-size: 12px; }
  .add { align-self: flex-start; padding: 1px 6px; font-size: 11.5px; }
  .link { background: none; border: none; padding: 0; color: var(--accent); cursor: pointer; align-self: flex-start; }
  .vinfo { margin-top: auto; padding: 6px 4px 2px; border-top: 1px solid rgba(255, 255, 255, .06); font-size: 11.5px; font-variant-numeric: tabular-nums; }
  .sec { display: flex; flex-direction: column; gap: 6px; }
  .sechead { display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; }
  .sectitle { display: inline-flex; align-items: center; gap: 6px; background: none; border: none; padding: 0; cursor: pointer;
    font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .sectitle:hover { color: var(--text); }
  .sectitle .chev { font-size: 15px; letter-spacing: 0; }
  .secbody { display: flex; flex-direction: column; gap: 6px; }
  .legend-badge-text { grid-column: 3 / -1; }
  p { margin: 2px 0; }
</style>
