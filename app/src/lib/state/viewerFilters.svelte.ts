/**
 * Current Visualiser filters + named filter configurations (presets), persisted in the app data
 * (localStorage) with JSON import / export.
 */
import { DEFAULT_FILTERS, hiddenKey, normalizeFilters, type FilterState, type LayerId } from "$lib/core/filters";

const LS_CURRENT = "hq.filters";
const LS_PRESETS = "hq.filterPresets";
const LS_PANEL = "hq.filtersPanel";

export interface FilterPreset {
  name: string;
  state: FilterState;
}

interface PresetStore {
  presets: FilterPreset[];
  defaultName: string | null;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

class ViewerFilters {
  store = $state<PresetStore>(load(LS_PRESETS, { presets: [], defaultName: null }));
  current = $state<FilterState>(this.initial());
  /** Name of the preset the current state was loaded from (null = unsaved). */
  activeName = $state<string | null>(null);
  panelOpen = $state<boolean>(load(LS_PANEL, true));

  private initial(): FilterState {
    const def = this.store.defaultName ? this.store.presets.find((p) => p.name === this.store.defaultName) : null;
    return normalizeFilters(def ? def.state : load<Partial<FilterState> | null>(LS_CURRENT, null));
  }

  set(patch: Partial<FilterState>): void {
    this.current = { ...this.current, ...patch };
    save(LS_CURRENT, this.current);
  }

  toggleLayer(layer: LayerId): void {
    this.set({ layers: { ...this.current.layers, [layer]: !this.current.layers[layer] } });
  }

  hide(layer: LayerId, id: number): void {
    const k = hiddenKey(layer, id);
    if (!this.current.hidden.includes(k)) this.set({ hidden: [...this.current.hidden, k] });
  }

  unhide(key: string | null): void {
    this.set({ hidden: key ? this.current.hidden.filter((k) => k !== key) : [] });
  }

  reset(): void {
    this.current = structuredClone(DEFAULT_FILTERS);
    this.activeName = null;
    save(LS_CURRENT, this.current);
  }

  setPanel(open: boolean): void {
    this.panelOpen = open;
    save(LS_PANEL, open);
  }

  // ---- presets
  private persist(): void {
    save(LS_PRESETS, this.store);
  }

  saveAs(name: string): void {
    const n = name.trim();
    if (!n) return;
    const presets = this.store.presets.filter((p) => p.name !== n);
    presets.push({ name: n, state: structuredClone($state.snapshot(this.current)) as FilterState });
    presets.sort((a, b) => a.name.localeCompare(b.name));
    this.store = { ...this.store, presets };
    this.activeName = n;
    this.persist();
  }

  apply(name: string): void {
    const p = this.store.presets.find((x) => x.name === name);
    if (!p) return;
    this.current = normalizeFilters(structuredClone(p.state));
    this.activeName = name;
    save(LS_CURRENT, this.current);
  }

  rename(from: string, to: string): void {
    const n = to.trim();
    if (!n || this.store.presets.some((p) => p.name === n)) return;
    this.store = {
      presets: this.store.presets.map((p) => (p.name === from ? { ...p, name: n } : p)),
      defaultName: this.store.defaultName === from ? n : this.store.defaultName,
    };
    if (this.activeName === from) this.activeName = n;
    this.persist();
  }

  remove(name: string): void {
    this.store = {
      presets: this.store.presets.filter((p) => p.name !== name),
      defaultName: this.store.defaultName === name ? null : this.store.defaultName,
    };
    if (this.activeName === name) this.activeName = null;
    this.persist();
  }

  setDefault(name: string | null): void {
    this.store = { ...this.store, defaultName: name };
    this.persist();
  }

  /** JSON of all presets (export). */
  exportJson(): string {
    return JSON.stringify({ format: "hqminimap-filters", version: 1, ...$state.snapshot(this.store) }, null, 1);
  }

  /** Merge presets from an exported JSON; returns how many were imported. */
  importJson(text: string): number {
    const data = JSON.parse(text) as { format?: string; presets?: FilterPreset[] };
    if (data.format !== "hqminimap-filters" || !Array.isArray(data.presets)) throw new Error("format");
    const byName = new Map(this.store.presets.map((p) => [p.name, p]));
    for (const p of data.presets) if (p && typeof p.name === "string") byName.set(p.name, { name: p.name, state: normalizeFilters(p.state) });
    this.store = { ...this.store, presets: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) };
    this.persist();
    return data.presets.length;
  }
}

export const viewerFilters = new ViewerFilters();
