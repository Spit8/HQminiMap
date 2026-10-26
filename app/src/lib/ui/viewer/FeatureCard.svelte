<script lang="ts">
  import type { Series } from "$lib/core/live";
  import { fmtNum, t, type MessageKey } from "$lib/i18n/index.svelte";
  import type { FeatureInfo } from "./layers";

  let { info, extra = {}, series = [], onhide, onteleport, onopen, onfit, onshowline, onclose }: {
    info: FeatureInfo;
    /** Figures computed by the viewer (objects inside a town…). */
    extra?: Record<string, number>;
    /** Logbook history (sparklines). */
    series?: { label: string; color: string; series: Series }[];
    onhide: () => void;
    onteleport: () => void;
    /** Camera onto the object and its in-game window. */
    onopen: () => void;
    onfit: () => void;
    /** Vehicles: select their line. */
    onshowline?: () => void;
    onclose: () => void;
  } = $props();

  /** Fixed detail keys are translated; stock rows ("Coal (input)") are already labels. */
  const term = (k: string) => {
    const key = `card.${k}` as MessageKey;
    const s = t(key);
    return s === key ? k : s;
  };

  const W = 228, H = 38;
  /**
   * Points of a sparkline. A logbook series that never decreases is a running total: its steps
   * (value per period) are drawn instead.
   */
  function spark(s: Series): { path: string; last: number; min: number; max: number } {
    const cumulative = s.length > 2 && s.every((p, i) => i === 0 || p[1] >= s[i - 1]![1]);
    const v = cumulative ? s.slice(1).map((p, i) => p[1] - s[i]![1]) : s.map((p) => p[1]);
    const min = Math.min(...v), max = Math.max(...v);
    const span = max - min || 1;
    const path = v.map((y, i) => `${i ? "L" : "M"}${((i / Math.max(1, v.length - 1)) * W).toFixed(1)},${(H - 3 - ((y - min) / span) * (H - 6)).toFixed(1)}`).join("");
    return { path, last: v[v.length - 1] ?? 0, min, max };
  }
</script>

<div class="card">
  <div class="head">
    <span class="kind">{t(`live.kind.${info.layer}`)}</span>
    <button class="x" onclick={onclose}>×</button>
  </div>
  <strong>{info.name}</strong>
  <dl>
    {#each Object.entries({ ...info.details, ...extra }) as [k, v] (k)}
      <dt>{#if k === "pax" || k === "freight"}<span class="bdg" style:background={k === "pax" ? "#9fd3ff" : "#ffc861"}></span>{/if}{term(k)}</dt>
      <dd>{typeof v === "number" ? fmtNum(v) : v}</dd>
    {/each}
    <dt>X · Y</dt><dd class="mono">{info.x.toFixed(0)} · {info.y.toFixed(0)}</dd>
  </dl>
  {#each series as s (s.label)}
    {#if s.series.length >= 2}
      {@const sp = spark(s.series)}
      <div class="spark">
        <div class="sl"><span>{s.label}</span><span class="dim">{fmtNum(sp.last)} · {t("card.range", { min: fmtNum(sp.min), max: fmtNum(sp.max) })}</span></div>
        <svg viewBox="0 0 {W} {H}" width={W} height={H} aria-hidden="true">
          <path d={sp.path} fill="none" stroke={s.color} stroke-width="1.8" stroke-linejoin="round" />
        </svg>
      </div>
    {/if}
  {/each}
  <div class="actions">
    {#if onshowline}<button onclick={onshowline}>{t("card.showLine")}</button>{/if}
    <button onclick={onfit}>{t("card.fit")}</button>
    <button onclick={onhide}>{t("card.hide")}</button>
    <button onclick={onteleport}>{t("card.teleport")}</button>
    <button onclick={onopen} title={t("card.openInGameTitle")}>↗ {t("card.openInGame")}</button>
  </div>
</div>

<style>
  .card { position: absolute; z-index: 6; right: 12px; top: 12px; width: 252px; max-height: 65%; overflow: auto; padding: 9px 12px; border-radius: 10px;
    background: rgba(22, 25, 32, .96); border: 1px solid var(--line); box-shadow: 0 6px 24px rgba(0, 0, 0, .35); font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: center; }
  .kind { font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
  .x { padding: 0 7px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 6px 0; font-size: 12px; }
  dt { color: var(--muted); }
  .bdg { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
  dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
  .spark { margin: 6px 0; }
  .sl { display: flex; justify-content: space-between; font-size: 11.5px; }
  .spark svg { display: block; margin-top: 2px; background: rgba(255, 255, 255, .03); border-radius: 4px; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .actions button { padding: 3px 8px; }
</style>
