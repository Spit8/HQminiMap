<script lang="ts">
  import { LIVE_KINDS, MIN_INTERVALS, type LiveKind } from "$lib/core/live";
  import { fmtDate, fmtNum, t } from "$lib/i18n/index.svelte";
  import { live } from "$lib/state/live.svelte";

  function setInterval(kind: LiveKind, e: Event): void {
    const input = e.target as HTMLInputElement;
    const v = Math.max(0, Number(input.value) || 0);
    live.setSettings({ intervals: { ...live.settings.intervals, [kind]: v } });
    input.value = String(live.settings.intervals[kind]); // raised to the minimum if below it
  }
  /** Share of the game's time spent on a kind: cost of one run / interval. */
  const load = (k: LiveKind) => {
    const job = live.status?.jobs[k], every = live.settings.intervals[k];
    return job && every > 0 ? job.ms / (every * 1000) : null;
  };
  const fmtPct = (r: number) => (r < 0.001 ? t("live.lessThan") : `${fmtNum(r * 100, r < 0.01 ? 2 : 1)} %`);

  const warns = $derived(Object.entries(live.status?.jobs ?? {}).filter(([, j]) => j?.warn || (j && !j.ok)));
</script>

<section class="card">
  <div class="head">
    <h3>{t("live.title")}</h3>
    <span class="pill" class:on={!!live.status}></span>
    <span class="dim small">{live.status ? t("live.statusShort", { date: fmtDate(live.status.t * 1000) }) : t("live.statusNone")}</span>
  </div>
  {#if live.staleMod}<p class="warn small">⚠ {t("live.staleMod")}</p>{/if}
  <label class="check">
    <input type="checkbox" checked={live.settings.enabled}
      onchange={(e) => live.setSettings({ enabled: (e.target as HTMLInputElement).checked })} />
    {t("live.enabled")}
  </label>
  <table>
    <thead><tr>
      <th>{t("live.col.kind")}</th><th>{t("live.col.every")}</th><th>{t("live.col.last")}</th>
      <th class="num" title={t("live.col.costTitle")}>{t("live.col.cost")}</th>
      <th class="num" title={t("live.col.loadTitle")}>{t("live.col.load")}</th>
    </tr></thead>
    <tbody>
      {#each LIVE_KINDS as k (k)}
        {@const job = live.status?.jobs[k]}
        {@const l = load(k)}
        <tr>
          <td>{t(`live.kind.${k}`)}{#if job && (job.warn || !job.ok)}<span class="warn" title={job.error ?? job.warn}> ⚠</span>{/if}</td>
          <td><input type="number" min="0" max="3600" step="1" value={live.settings.intervals[k]}
            title={t("live.minTitle", { n: MIN_INTERVALS[k] })}
            disabled={!live.settings.enabled} onchange={(e) => setInterval(k, e)} /> s</td>
          <td class="dim">{live.updatedAt[k] ? fmtDate(live.updatedAt[k]! * 1000) : "—"}</td>
          <td class="num {job && !job.ok ? 'err' : 'dim'}">{job ? `${job.ms} ms` : "—"}</td>
          <td class="num {l !== null && l > 0.02 ? 'warn' : 'dim'}">{l === null ? "—" : fmtPct(l)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if warns.length}
    <details><summary class="warn small">{t("live.warn", { n: warns.length })}</summary>
      {#each warns as [k, j] (k)}<p class="mono small">{t(`live.kind.${k as LiveKind}`)} : {j?.error ?? j?.warn}</p>{/each}
    </details>
  {/if}
  <p class="dim small">{t("live.hint")}</p>
  <p class="dim small">{t("live.minHint")}</p>
</section>

<style>
  .head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .head h3 { margin: 0 !important; }
  .pill { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; }
  .pill.on { background: var(--ok); }
  .small { font-size: 12px; }
  .check { display: flex; gap: 6px; align-items: center; font-size: 12.5px; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 4px; }
  th, td { text-align: left; padding: 2px 8px 2px 0; }
  tbody tr + tr td { border-top: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 500; font-size: 11.5px; }
  .num { text-align: right; padding-right: 0; }
  input[type="number"] { width: 52px; padding: 1px 4px; }
  p { margin: 3px 0; }
  details p { word-break: break-all; }
</style>
