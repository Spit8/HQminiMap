<script lang="ts">
  import { ask } from "@tauri-apps/plugin-dialog";
  import { t } from "$lib/i18n/index.svelte";
  import { joinPath } from "$lib/platform/fsx";
  import { orthoJob } from "$lib/state/orthoJob.svelte";
  import { fmtBytes } from "$lib/state/orthoSpeed";
  import { runLabel, runs, type RunMeta } from "$lib/state/runs.svelte";

  let selected = $state<Set<string>>(new Set());
  let sizes = $state<Record<string, number>>({});
  let busy = $state(false);
  let msg = $state<string | null>(null);
  let msgOk = $state(true);

  /** Runs that must not be deleted now (capture in progress, ortho being computed). */
  const locked = $derived(
    new Set([
      ...(runs.live && !runs.live.finished ? [runs.live.id] : []),
      ...(orthoJob.running ? [orthoJob.running.runId] : []),
    ]),
  );
  const deletable = $derived(runs.runs.filter((r) => !locked.has(r.id)));
  const allChecked = $derived(deletable.length > 0 && deletable.every((r) => selected.has(r.id)));
  const totalSize = $derived(Object.values(sizes).reduce((a, b) => a + b, 0));

  // Sizes are computed in the background (thousands of pyramid tiles per run).
  let sizedFor = "";
  $effect(() => {
    const key = runs.runs.map((r) => `${r.id}:${r.collected}:${r.hasOrtho}`).join(",");
    if (key === sizedFor) return;
    sizedFor = key;
    void (async () => {
      const next: Record<string, number> = {};
      for (const r of runs.runs) next[r.id] = await runs.dirSize(r);
      sizes = next;
    })();
  });

  function toggle(id: string): void {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    selected = s;
  }

  function toggleAll(): void {
    selected = allChecked ? new Set() : new Set(deletable.map((r) => r.id));
  }

  const fmtSize = (b: number | undefined) => (b === undefined ? "…" : fmtBytes(b));

  async function remove(list: RunMeta[]): Promise<void> {
    const ids = list.filter((r) => !locked.has(r.id)).map((r) => r.id);
    if (!ids.length) return;
    const size = ids.reduce((a, id) => a + (sizes[id] ?? 0), 0);
    const ok = await ask(t("history.confirm", { n: ids.length, size: fmtSize(size) }), {
      title: t("history.confirmTitle"), kind: "warning", okLabel: t("history.confirmOk"), cancelLabel: t("history.confirmCancel"),
    });
    if (!ok) return;
    busy = true;
    try {
      const failed = await runs.deleteRuns(ids);
      selected = new Set([...selected].filter((id) => !ids.includes(id) || failed.includes(id)));
      msg = failed.length
        ? t("history.deleteFailed", { n: failed.length, paths: failed.map((id) => joinPath(runs.runsDir ?? "", id)).join(", ") })
        : t("history.deleted", { n: ids.length });
      msgOk = !failed.length;
    } finally {
      busy = false;
    }
  }
</script>

<section class="card wide">
  <h3>{t("history.title")}</h3>
  {#if !runs.runs.length}
    <p class="dim">{t("history.empty")}</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th><input type="checkbox" checked={allChecked} onchange={toggleAll} title={t("history.selectAll")} /></th>
          <th>{t("history.col.name")}</th><th>{t("history.col.grid")}</th><th>{t("history.col.images")}</th>
          <th>{t("history.col.ortho")}</th><th class="num">{t("history.col.size")}</th>
        </tr>
      </thead>
      <tbody>
        {#each runs.runs as r (r.id)}
          <tr class:locked={locked.has(r.id)}>
            <td><input type="checkbox" checked={selected.has(r.id)} disabled={locked.has(r.id)} onchange={() => toggle(r.id)} /></td>
            <td>{runLabel(r)}{#if locked.has(r.id)}<span class="warn">{t("history.live")}</span>{/if}</td>
            <td>{r.nY}×{r.nX}</td>
            <td>{r.collected}/{r.expected}</td>
            <td>{r.hasOrtho ? t("history.yes") : "—"}</td>
            <td class="num">{fmtSize(sizes[r.id])}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <div class="row">
      <button disabled={busy || !selected.size} onclick={() => remove(runs.runs.filter((r) => selected.has(r.id)))}>
        {t("history.deleteSel", { n: selected.size })}</button>
      <button disabled={busy || !deletable.length} onclick={() => remove(deletable)}>{t("history.deleteAll")}</button>
      <span class="dim">{t("history.total", { size: fmtSize(totalSize) })}</span>
    </div>
    {#if msg}<p class={msgOk ? "ok" : "err"}>{msg}</p>{/if}
  {/if}
</section>

<style>
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 8px; }
  th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 500; font-size: 12px; }
  .num { text-align: right; }
  tr.locked td { opacity: .7; }
  .row { display: flex; gap: 8px; align-items: center; }
  p { margin: 4px 0; font-size: 13px; }
</style>
