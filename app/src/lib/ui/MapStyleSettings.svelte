<script lang="ts">
  /** Map information display settings (Options → Map and the Visualiser's ⚙ Map popover). */
  import { t } from "$lib/i18n/index.svelte";
  import { mapStyle, VEHICLE_BADGES } from "$lib/state/mapStyle.svelte";

  const SLIDERS = [["iconScale", 0.6, 2, 0.05], ["textScale", 0.6, 2, 0.05], ["lineWidth", 0.5, 3, 0.05], ["lineOpacity", 0.2, 1, 0.05]] as const;
</script>

<div class="ms">
  {#each SLIDERS as [key, min, max, step] (key)}
    <div class="kv">
      <span class="k">{t(`settings.map.${key}`)}</span>
      <input type="range" {min} {max} {step} value={mapStyle.current[key]}
        oninput={(e) => mapStyle.set({ [key]: Number((e.target as HTMLInputElement).value) })} />
      <span class="v mono">{Math.round(mapStyle.current[key] * 100)} %</span>
    </div>
  {/each}
  <div class="kv">
    <span class="k">{t("settings.map.vehicleBadge")}</span>
    <select value={mapStyle.current.vehicleBadge}
      onchange={(e) => mapStyle.set({ vehicleBadge: (e.target as HTMLSelectElement).value as typeof mapStyle.current.vehicleBadge })}>
      {#each VEHICLE_BADGES as b (b)}<option value={b}>{t(`settings.map.badge.${b}`)}</option>{/each}
    </select>
  </div>
  <label class="check"><input type="checkbox" checked={mapStyle.current.openInGame}
    onchange={(e) => mapStyle.set({ openInGame: (e.target as HTMLInputElement).checked })} /> {t("settings.map.openInGame")}</label>
  <p class="note dim">{t("settings.map.hint")} <button class="link" onclick={() => mapStyle.reset()}>{t("settings.map.reset")}</button></p>
</div>

<style>
  .ms { display: flex; flex-direction: column; }
  .kv { display: grid; grid-template-columns: 140px 1fr 48px; gap: 8px; align-items: center; min-height: 28px; font-size: 13px; }
  .kv + .kv { border-top: 1px solid var(--line); }
  .kv select { grid-column: 2 / -1; justify-self: start; }
  .kv input[type="range"] { width: 100%; }
  .k { color: var(--muted); font-size: 12px; }
  .v { font-size: 12px; text-align: right; }
  .check { display: flex; gap: 6px; align-items: center; font-size: 12.5px; margin: 6px 0 2px; }
  .note { margin: 4px 0 0; font-size: 12px; }
  .link { background: none; border: none; padding: 0; color: var(--accent); cursor: pointer; font-size: 12px; }
</style>
