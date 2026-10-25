<script lang="ts">
  import { onMount, untrack } from "svelte";
  import Map from "ol/Map";
  import View from "ol/View";
  import WebGLTileLayer from "ol/layer/WebGLTile";
  import ImageTileSource from "ol/source/ImageTile";
  import TileGrid from "ol/tilegrid/TileGrid";
  import Projection from "ol/proj/Projection";
  import { defaults as defaultInteractions } from "ol/interaction/defaults";
  import "ol/ol.css";
  import { save } from "@tauri-apps/plugin-dialog";
  import { applyFilters, hiddenKey, industryLabel, LAYERS, type LayerId, type LiveData } from "$lib/core/filters";
  import { fmtDate, fmtNum, t, type MessageKey } from "$lib/i18n/index.svelte";
  import { joinPath, readBytes, readText, writeBytes } from "$lib/platform/fsx";
  import { app } from "$lib/state/app.svelte";
  import { live } from "$lib/state/live.svelte";
  import { PYRAMID_VERSION, type PyramidJson } from "$lib/state/orthoExport";
  import { runLabel, runs } from "$lib/state/runs.svelte";
  import { viewerFilters as vf } from "$lib/state/viewerFilters.svelte";
  import FeatureCard from "./viewer/FeatureCard.svelte";
  import LayersPanel from "./viewer/LayersPanel.svelte";
  import { exportViewPng } from "./viewer/exportView";
  import { createLiveLayers, rgb, toWorld, type FeatureInfo, type Frame } from "./viewer/layers";
  import { insideRings } from "$lib/core/towns";
  import { TrackIndex, uncovered } from "$lib/core/routes";
  import { autoAdjust, NEUTRAL, RANGES, type ImageAdjust } from "$lib/core/imageAdjust";
  import { mapStyle } from "$lib/state/mapStyle.svelte";

  let { runId = null }: { runId?: string | null } = $props();

  /** Zoom-in levels beyond full resolution (×2, ×4, ×8), drawn from the finest tiles. */
  const EXTRA_ZOOM = 3;
  /** Selector value: live data on a neutral background, without ortho. */
  const NO_ORTHO = "__none";
  const BACKGROUND = "#0e1015";

  let target: HTMLDivElement;
  let map: Map | null = null;
  let tileLayer: WebGLTileLayer | null = null;
  /** Extent of the shown map (fit button). */
  let viewExtent: number[] | null = null;
  const liveLayers = createLiveLayers();
  let selectedId = $state<string | null>(null);
  let info = $state<PyramidJson | null>(null);
  let frame = $state<Frame | null>(null);
  let cursor = $state<{ x: number; y: number } | null>(null);
  let errorKey = $state<MessageKey | null>(null);
  let rotationDeg = $state(0);
  let zoomFactor = $state<number | null>(null);
  let selected = $state<FeatureInfo | null>(null);
  /** The OL map exists (created in onMount). */
  let ready = $state(false);
  let exportOpen = $state(false);
  let imageOpen = $state(false);
  let exportScale = $state<1 | 2 | 4>(2);
  let exportLegend = $state(true);
  let exportMsg = $state<{ ok: boolean; text: string } | null>(null);
  let exporting = $state(false);

  const withOrtho = $derived(runs.runs.filter((r) => r.hasOrtho));
  const choice = $derived(selectedId ?? runId);
  const current = $derived(choice === NO_ORTHO ? null : (withOrtho.find((r) => r.id === choice) ?? withOrtho[0] ?? null));
  /** Live data on a plain background (no ortho, or chosen), framed by the map bounds. */
  const dataOnly = $derived(!current && !!app.map);

  // Raw data joined with the traffic figures (live_stats).
  const all = $derived.by<LiveData>(() => {
    const st = live.stats;
    const sk = live.stocks;
    return {
      towns: live.towns, vehicles: live.vehicles,
      industries: sk ? live.industries.map((i) => ({ ...i, stocks: sk.industries.get(i.id) })) : live.industries,
      warehouses: sk?.warehouses ?? [],
      stations: st ? live.stations.map((s) => ({ ...s, traffic: st.stations.get(s.id) })) : live.stations,
      lines: st ? live.lines.map((l) => ({ ...l, traffic: st.lines.get(l.id) })) : live.lines,
    };
  });
  const shown = $derived(applyFilters(all, vf.current));

  // Follow a "Voir dans le visualiseur" request from TileLab.
  $effect(() => {
    if (runId) selectedId = runId;
  });

  function nearestTown(x: number, y: number): string {
    let best = "", d = Infinity;
    for (const tw of live.towns) {
      const dd = (tw.x - x) ** 2 + (tw.y - y) ** 2;
      if (dd < d) [d, best] = [dd, tw.name];
    }
    return best || "?";
  }

  const lineNames = $derived(new globalThis.Map(live.lines.map((l) => [l.id, l.name])));
  const lineModes = $derived(new globalThis.Map(live.lines.map((l) => [l.id, l.mode])));
  const labels = {
    industryNear: nearestTown,
    lineName: (id: number) => lineNames.get(id) ?? `#${id}`,
    lineMode: (id: number) => lineModes.get(id) ?? "other",
    value: (k: string, v: string) =>
      k === "mode" ? t(`lp.mode.${v}` as MessageKey) : k === "use" ? t(`lp.kind.${v}` as MessageKey)
        : k === "stock" ? t(`stock.${v}` as MessageKey) : t("unit.perYear"),
    cargoName: (id: number) => live.stocks?.cargo.get(id) ?? `#${id}`,
  };

  /** Vehicle trails per line (ships' fallback track, gap filling), refreshed when they grow. */
  const trails = $derived.by(() => {
    void live.trailsVersion;
    const out = new globalThis.Map<number, [number, number][][]>();
    for (const [line, byVehicle] of live.trails) out.set(line, [...byVehicle.values()].filter((p) => p.length >= 2).map((p) => [...p]));
    return out;
  });

  /**
   * Gap filling: pieces of the vehicles' trails that run away from the recorded track (portions the
   * mod's paths did not cover). Recomputed at most every 10 s.
   */
  let fills = $state(new globalThis.Map<number, [number, number][][]>());
  let fillsAt = 0, fillsTimer: ReturnType<typeof setTimeout> | null = null;
  function computeFills(): void {
    fillsTimer = null;
    fillsAt = Date.now();
    const routes = live.routes, out = new globalThis.Map<number, [number, number][][]>();
    for (const [line, byVehicle] of live.trails) {
      const route = routes.get(line);
      if (!route) continue;
      const index = new TrackIndex(route);
      const pieces = [...byVehicle.values()].flatMap((tr) => uncovered(tr, index));
      if (pieces.length) out.set(line, pieces);
    }
    fills = out;
  }
  $effect(() => {
    void live.trailsVersion;
    void live.routes;
    if (fillsTimer) return;
    fillsTimer = setTimeout(computeFills, Math.max(0, 10_000 - (Date.now() - fillsAt)));
  });

  // Hover tooltip (name, line of a vehicle, stock, waiting).
  let hover = $state<{ text: string; x: number; y: number } | null>(null);

  // Picking among lines that overlap (shared tracks).
  let lineMenu = $state<{ x: number; y: number; items: FeatureInfo[]; idx: number } | null>(null);
  let lastPick: { x: number; y: number; ids: number[]; idx: number } | null = null;
  type Hit = { info: FeatureInfo; hover: string };

  /**
   * Everything under a pixel: the topmost point object (stop, vehicle, industry…), every distinct
   * line (busiest first) and the town whose outline contains it.
   */
  function hitsAt(pixel: number[], tol: number): { point: Hit | null; lines: Hit[]; townInfo: FeatureInfo | null; town: Hit | null } {
    let point: Hit | null = null, town: Hit | null = null;
    const lines = new globalThis.Map<number, Hit>();
    map?.forEachFeatureAtPixel(pixel, (f) => {
      const info = f.get("info") as FeatureInfo | undefined;
      if (!info) return;
      const h = { info, hover: f.get("hover") as string };
      if (info.layer === "lines") {
        if (!lines.has(info.id)) lines.set(info.id, h);
      } else if (info.layer === "towns") {
        town ??= h;
      } else {
        point ??= h;
      }
    }, { hitTolerance: tol, layerFilter: (l) => !!l.get("liveLayer") });
    const traffic = (h: Hit) => live.lines.find((l) => l.id === h.info.id)?.traffic?.transported ?? 0;
    const sorted = [...lines.values()].sort((a, b) => traffic(b) - traffic(a));
    return { point, lines: sorted, townInfo: (town as Hit | null)?.info ?? null, town };
  }

  function pickLine(i: number): void {
    if (!lineMenu) return;
    select(lineMenu.items[i]!);
    if (lastPick) lastPick.idx = i;
    lineMenu = { ...lineMenu, idx: i };
  }

  // The line menu closes on Escape or a click outside it (a map click handles itself).
  let lineMenuBox = $state<HTMLDivElement | null>(null);
  $effect(() => {
    if (!lineMenu) return;
    const onDown = (e: PointerEvent) => {
      if (lineMenuBox && !lineMenuBox.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".map")) lineMenu = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") lineMenu = null;
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  });

  /** Display name of a hidden object ("<layer>:<id>"). */
  function nameOf(key: string): string {
    const [layer, idStr] = key.split(":") as [LayerId, string];
    const id = Number(idStr);
    const label = t(`live.kind.${layer}`);
    if (layer === "towns") return live.towns.find((x) => x.id === id)?.name ?? `${label} #${id}`;
    if (layer === "stations") return live.stations.find((x) => x.id === id)?.name ?? `${label} #${id}`;
    if (layer === "lines") return lineNames.get(id) ?? `${label} #${id}`;
    if (layer === "warehouses") return live.stocks?.warehouses.find((x) => x.id === id)?.name || `${label} #${id}`;
    if (layer === "industries") {
      const i = live.industries.find((x) => x.id === id);
      return i ? `${industryLabel(i.type)} — ${nearestTown(i.x, i.y)}` : `${label} #${id}`;
    }
    return `${label} #${id}`;
  }

  function setView(view: View, extent: number[], f: Frame): void {
    if (!map) return;
    frame = f;
    map.setView(view);
    view.on("change:rotation", () => (rotationDeg = Math.round((view.getRotation() * 180) / Math.PI) % 360));
    view.on("change:resolution", () => {
      const r = view.getResolution();
      zoomFactor = r && info ? info.gsd / r : null;
    });
    viewExtent = extent;
    fitMap(false);
  }

  /** Whole map in the window (keeps the rotation; leaves room for the layer panel). */
  function fitMap(animate = true): void {
    const view = map?.getView();
    if (!view || !viewExtent) return;
    const left = vf.panelOpen && hasView ? 320 : 20;
    view.fit(viewExtent, { padding: [20, 20, 20, left], duration: animate ? 250 : 0 });
  }

  function setTiles(layer: WebGLTileLayer | null): void {
    if (!map) return;
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = layer;
    if (layer) map.getLayers().insertAt(0, layer);
  }

  /**
   * Image space in metres: x = world Y − minY (columns), y = −(world X − minX) (rows, downwards).
   * Tile (z, x, y) = pyramid/<z>/<x>_<y>.png, origin top-left, always 256×256.
   */
  async function show(run: NonNullable<typeof current>): Promise<void> {
    errorKey = null;
    const raw = await readText(joinPath(run.dir, "pyramid", "pyramid.json"));
    if (!raw) {
      errorKey = "viewer.noPyramid";
      return;
    }
    const p = JSON.parse(raw) as PyramidJson;
    info = p;
    if ((p.version ?? 1) < PYRAMID_VERSION) errorKey = "viewer.oldPyramid";
    const wM = p.width * p.gsd, hM = p.height * p.gsd;
    const extent = [0, -hM, wM, 0];
    const projection = new Projection({ code: `hq-${run.id}`, units: "m", extent });
    const tileRes = Array.from({ length: p.zMax + 1 }, (_, z) => p.gsd * 2 ** (p.zMax - z));
    const tileGrid = new TileGrid({ origin: [0, 0], resolutions: tileRes, tileSize: p.tileSize, extent });
    // A read can fail transiently (many tiles requested at once): retry before giving up.
    const loadTile = async (z: number, x: number, y: number): Promise<ImageBitmap> => {
      const path = joinPath(run.dir, "pyramid", String(z), `${x}_${y}.png`);
      for (let left = 2; ; left--) {
        try {
          return await createImageBitmap(new Blob([await readBytes(path)], { type: "image/png" }));
        } catch (err) {
          if (left <= 0) {
            console.warn("tile", path, err);
            throw err;
          }
          await new Promise((r) => setTimeout(r, 150));
        }
      }
    };
    // One WebGL layer, no smoothing: the zoom snaps to the pyramid levels (1 tile pixel = 1 screen
    // pixel) and, beyond full resolution, the finest tiles are magnified as crisp pixels. The image
    // adjustments are shader variables: applied to the whole displayed map at once.
    const resolutions = [...tileRes, ...Array.from({ length: EXTRA_ZOOM }, (_, k) => p.gsd / 2 ** (k + 1))];
    const adj = adjustFor(run.id);
    setTiles(new WebGLTileLayer({
      preload: 1,
      source: new ImageTileSource({ projection, tileGrid, interpolate: false, transition: 0, loader: loadTile }),
      style: {
        variables: { ...adj },
        brightness: ["var", "brightness"], contrast: ["var", "contrast"],
        saturation: ["var", "saturation"], gamma: ["var", "gamma"],
      },
    }));
    imageRun = run.id;
    imageAdjust = adj;
    imageAuto = imageModes[run.id] !== "manual";
    if (imageModes[run.id] !== "manual") void computeAuto(run);
    setView(new View({
      projection, extent, resolutions, constrainResolution: true, showFullExtent: true,
      constrainOnlyCenter: true, enableRotation: true, rotation: (rotationDeg * Math.PI) / 180,
    }), extent, { minX: p.minX, minY: p.minY });
  }

  /** No ortho: same frame from the map bounds, free zoom. */
  function showDataOnly(): void {
    const b = app.map?.bounds;
    if (!b) return;
    errorKey = null;
    info = null;
    zoomFactor = null;
    const extent = [0, -(b.maxX - b.minX), b.maxY - b.minY, 0];
    const projection = new Projection({ code: "hq-data", units: "m", extent });
    setTiles(null);
    setView(new View({
      projection, extent, showFullExtent: true, constrainOnlyCenter: true, maxResolution: 200, minResolution: 0.05,
      rotation: (rotationDeg * Math.PI) / 180,
    }), extent, { minX: b.minX, minY: b.minY });
  }

  function rotate(deltaDeg: number | null): void {
    const view = map?.getView();
    if (!view) return;
    const rad = deltaDeg === null ? 0 : view.getRotation() + (deltaDeg * Math.PI) / 180;
    view.animate({ rotation: rad, duration: 200 });
  }

  function zoomBy(delta: number): void {
    const view = map?.getView();
    const z = view?.getZoom();
    if (view && z !== undefined) view.animate({ zoom: z + delta, duration: 150 });
  }

  function toggleFullscreen(): void {
    void app.setFullscreen(!app.fullscreen);
  }

  function select(i: FeatureInfo | null): void {
    selected = i;
    liveLayers.setSelected(i ? `${i.layer}:${i.id}` : null);
  }

  /** Select by key (panel line list); a second click deselects unless `force`. */
  function selectKey(key: string, force = false): void {
    if (!force && selected && `${selected.layer}:${selected.id}` === key) select(null);
    else select(liveLayers.infoOf(key));
  }

  function fitSelected(): void {
    if (!selected) return;
    const ext = liveLayers.extentOf(`${selected.layer}:${selected.id}`);
    const view = map?.getView();
    if (!ext || !view) return;
    const point = ext[0] === ext[2] && ext[1] === ext[3];
    if (point) view.animate({ center: [ext[0]!, ext[1]!], duration: 300 });
    else view.fit(ext, { padding: [60, 60, 60, vf.panelOpen ? 330 : 60], duration: 300 });
  }

  function hideSelected(): void {
    if (!selected) return;
    vf.hide(selected.layer, selected.id);
    select(null);
  }

  // ---- teleport (double-click or card) with the mod's acknowledgement
  let toastVisible = $state(false);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function teleport(x: number, y: number): void {
    void live.teleport(x, y);
  }

  /** Camera onto an object (its position; a line: its first stop) and, if asked, its in-game window. */
  function openInGame(i: FeatureInfo, open: boolean): void {
    void live.focus(i.layer, i.id, i.x, i.y, open);
  }
  $effect(() => {
    const c = live.command;
    if (!c) return;
    toastVisible = true;
    if (toastTimer) clearTimeout(toastTimer);
    if (c.state !== "pending") toastTimer = setTimeout(() => (toastVisible = false), c.state === "ok" ? 2500 : 6000);
  });
  const toast = $derived.by(() => {
    const c = live.command;
    if (!c) return null;
    if (c.state === "pending") return { cls: "", text: t("tp.pending") };
    if (c.state === "ok") return { cls: "ok", text: t("tp.ok") };
    return { cls: "err", text: c.error === "timeout" ? t("tp.timeout") : t("tp.error", { error: c.error ?? "" }) };
  });

  // ---- view export
  const LAYER_COLOR: Record<LayerId, string> = {
    towns: "#ffffff", industries: "#d9a441", warehouses: "#8a94a3", stations: "#e2574c", lines: "#6aa7e8", vehicles: "#9ad06b",
  };
  async function doExport(): Promise<void> {
    if (!map) return;
    exporting = true;
    exportMsg = null;
    try {
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
      const path = await save({ defaultPath: `hqminimap-${stamp}.png`, filters: [{ name: "PNG", extensions: ["png"] }] });
      if (!path) return;
      const legend = exportLegend ? {
        title: vf.activeName ?? (current ? runLabel(current) : "HQminiMap"),
        items: LAYERS.filter((l) => vf.current.layers[l] && shown[l].length)
          .map((l) => ({ label: `${t(`live.kind.${l}`)} (${fmtNum(shown[l].length)})`, color: LAYER_COLOR[l] })),
        footer: fmtDate(d.getTime()),
      } : null;
      const bytes = await exportViewPng(map, { scale: exportScale, legend, background: BACKGROUND });
      await writeBytes(path, bytes);
      exportMsg = { ok: true, text: t("export.done", { path }) };
      exportOpen = false;
      setTimeout(() => (exportMsg = null), 6000);
    } catch (err) {
      exportMsg = { ok: false, text: t("export.error", { error: String(err) }) };
    } finally {
      exporting = false;
    }
  }

  // ---- (re)build the background when the run or the map bounds change
  let shownFor: string | null = null;
  $effect(() => {
    const run = current;
    const key = run ? `${run.id}:${run.orthoVersion}` : dataOnly ? `data:${JSON.stringify(app.map?.bounds)}` : null;
    if (ready && map && shownFor !== key) {
      shownFor = key;
      if (run) void show(run);
      else if (dataOnly) showDataOnly();
    }
  });

  // Live features follow the data and the filters.
  $effect(() => {
    const d = shown;
    const routes = live.routes;
    const tr = trails;
    const fl = fills;
    const areas = live.townAreas;
    const labelsOn = vf.current.labels;
    const ms = mapStyle.current;
    if (!frame) return;
    liveLayers.update(frame, d, routes, live.routeParts, tr, fl, areas, labels, { labels: labelsOn, glideMs: untrack(() => live.vehicleIntervalMs), ...ms });
    // Keep the selection (fresh figures) across data refreshes.
    const sel = untrack(() => selected);
    if (sel) selected = liveLayers.infoOf(`${sel.layer}:${sel.id}`) ?? sel;
  });

  /** Extra figures of the selected object: objects inside a town's outline. */
  const extraDetails = $derived.by((): Record<string, number> => {
    if (selected?.layer !== "towns") return {};
    const area = live.townAreas.get(selected.id);
    if (!area?.rings.length) return {};
    const inside = <T extends { x: number; y: number }>(list: T[]) => list.filter((o) => insideRings(area.rings, o.x, o.y)).length;
    return { stationsIn: inside(shown.stations), industriesIn: inside(shown.industries), warehousesIn: inside(shown.warehouses) };
  });

  /** Logbook series of the selected line / station (card sparklines). */
  const selectedSeries = $derived.by(() => {
    const h = live.history;
    if (!h || !selected) return [];
    if (selected.layer === "lines") {
      const s = h.lines.get(selected.id);
      return s?.length ? [{ label: t("card.transported"), color: rgb(live.lines.find((l) => l.id === selected!.id)?.color ?? null), series: s }] : [];
    }
    if (selected.layer === "stations") {
      const s = h.stations.get(selected.id);
      if (!s) return [];
      return [
        { label: t("card.loaded"), color: "#6aa7e8", series: s.loaded },
        { label: t("card.unloaded"), color: "#f2a33a", series: s.unloaded },
      ].filter((x) => x.series.length);
    }
    return [];
  });

  // ---- image adjustments of the ortho (whole image, WebGL shader variables), saved per run
  const LS_IMAGE = "hq.imageAdjust";
  type ImageStore = Record<string, { mode: "auto" | "manual"; adj: ImageAdjust }>;
  const loadImageStore = (): ImageStore => {
    try {
      return JSON.parse(localStorage.getItem(LS_IMAGE) ?? "{}") as ImageStore;
    } catch {
      return {};
    }
  };
  let imageStore = loadImageStore();
  const imageModes = $derived(Object.fromEntries(Object.entries(imageStore).map(([k, v]) => [k, v.mode])) as Record<string, string>);
  let imageRun = $state<string | null>(null);
  let imageAdjust = $state<ImageAdjust>({ ...NEUTRAL });
  let imageAuto = $state(false);

  function adjustFor(runId: string): ImageAdjust {
    return { ...NEUTRAL, ...(imageStore[runId]?.adj ?? {}) };
  }

  function applyImage(adj: ImageAdjust, mode: "auto" | "manual"): void {
    imageAdjust = adj;
    tileLayer?.updateStyleVariables({ ...adj });
    if (!imageRun) return;
    imageStore = { ...imageStore, [imageRun]: { mode, adj } };
    imageAuto = mode === "auto";
    try {
      localStorage.setItem(LS_IMAGE, JSON.stringify(imageStore));
    } catch {
      /* storage unavailable */
    }
  }

  /** Auto settings from the run's global overview (ortho.png, the whole map scaled down). */
  async function computeAuto(run: NonNullable<typeof current>): Promise<void> {
    try {
      const bytes = await readBytes(joinPath(run.dir, "ortho.png"));
      const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      if (imageRun !== run.id) return;
      applyImage(autoAdjust(ctx.getImageData(0, 0, w, h).data), "auto");
    } catch (err) {
      console.warn("auto image", err);
    }
  }

  function setImage(key: keyof ImageAdjust, v: number): void {
    applyImage({ ...imageAdjust, [key]: v }, "manual");
  }

  // The export and image menus close on a click outside them and on Escape.
  let exportBox = $state<HTMLDivElement | null>(null);
  let imageBox = $state<HTMLDivElement | null>(null);
  $effect(() => {
    if (!imageOpen) return;
    const onDown = (e: PointerEvent) => {
      if (imageBox && !imageBox.contains(e.target as Node)) imageOpen = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") imageOpen = false;
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  });
  $effect(() => {
    if (!exportOpen) return;
    const onDown = (e: PointerEvent) => {
      if (exportBox && !exportBox.contains(e.target as Node) && !exporting) exportOpen = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !exporting) exportOpen = false;
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  });

  // Resize the map when the chrome appears / disappears, then fit the whole map in the new size.
  let fsSeen: boolean | null = null;
  $effect(() => {
    const fs = app.fullscreen;
    queueMicrotask(() => {
      map?.updateSize();
      if (fsSeen !== null && fsSeen !== fs) setTimeout(() => fitMap(), 60);
      fsSeen = fs;
    });
  });

  onMount(() => {
    void runs.refreshList();
    map = new Map({
      target, controls: [], layers: liveLayers.layers,
      // Double-click teleports the in-game camera (zoom stays on the wheel and the buttons).
      interactions: defaultInteractions({ doubleClickZoom: false }),
    });
    map.on("pointermove", (e) => {
      const [cx, cy] = e.coordinate;
      cursor = frame ? toWorld(frame, cx, cy) : null;
      if (e.dragging) return;
      const { point, lines, town } = hitsAt(e.pixel, 5);
      // Several lines under the cursor: all their names ("Ligne 9 · Ligne 4 · +2").
      const text = point?.hover ?? (lines.length > 1
        ? [...lines.slice(0, 3).map((l) => l.info.name), ...(lines.length > 3 ? [`+${lines.length - 3}`] : [])].join(" · ")
        : lines[0]?.hover ?? town?.hover);
      hover = text ? { text, x: e.pixel[0]!, y: e.pixel[1]! } : null;
      target.style.cursor = text ? "pointer" : "";
    });
    target.addEventListener("pointerleave", () => (hover = null));
    map.on("singleclick", (e) => {
      const { point, lines, townInfo } = hitsAt(e.pixel, 6);
      lineMenu = null;
      if (point) return select(point.info);
      if (lines.length > 1) {
        // Several lines here: menu to pick one; clicking again at the same spot steps to the next.
        const again = lastPick && Math.hypot(e.pixel[0]! - lastPick.x, e.pixel[1]! - lastPick.y) <= 4
          && lastPick.ids.join() === lines.map((l) => l.info.id).join();
        const idx = again ? (lastPick!.idx + 1) % lines.length : -1;
        lastPick = { x: e.pixel[0]!, y: e.pixel[1]!, ids: lines.map((l) => l.info.id), idx };
        if (idx >= 0) select(lines[idx]!.info);
        lineMenu = { x: e.pixel[0]!, y: e.pixel[1]!, items: lines.map((l) => l.info), idx };
        return;
      }
      lastPick = null;
      select(lines[0]?.info ?? townInfo ?? null);
    });
    // Double-click: on an object, camera onto it (+ its in-game window, option); elsewhere, camera there.
    map.on("dblclick", (e) => {
      if (!frame) return;
      const hs = hitsAt(e.pixel, 6);
      const hit = hs.point?.info ?? hs.lines[0]?.info ?? hs.townInfo;
      if (hit) {
        openInGame(hit, mapStyle.current.openInGame);
        return;
      }
      const w = toWorld(frame, e.coordinate[0], e.coordinate[1]);
      teleport(w.x, w.y);
    });

    // Vehicles glide from where they are drawn to their latest position (layers.animate).
    let raf = 0, lastAnim = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - lastAnim < 33 || !frame || !vf.current.layers.vehicles) return;
      lastAnim = now;
      liveLayers.animate(frame, Date.now());
    };
    raf = requestAnimationFrame(tick);
    ready = true;

    const ro = new ResizeObserver(() => map?.updateSize());
    ro.observe(target);
    // Keyboard: F / F11 toggle fullscreen, Escape leaves it, L toggles the filter panel (viewer visible only).
    const onKey = (e: KeyboardEvent) => {
      if (!target.offsetParent || (e.target as HTMLElement)?.closest("input, select, textarea")) return;
      if (e.key === "f" || e.key === "F" || e.key === "F11") {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === "l" || e.key === "L") {
        vf.setPanel(!vf.panelOpen);
      } else if (e.key === "0") {
        fitMap();
      } else if (e.key === "Escape") {
        if (exportOpen || imageOpen) return;
        if (selected) select(null);
        else if (app.fullscreen) void app.setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", onKey);
      map?.setTarget(undefined);
      map = null;
    };
  });

  const fmtZoom = (f: number) => (f >= 1 ? `×${Math.round(f)}` : `1/${Math.round(1 / f)}`);
  const hasView = $derived(!!current || dataOnly);
</script>

{#snippet controls()}
  <div class="group">
    <button title={t("viewer.zoomOut")} onclick={() => zoomBy(-1)}>−</button>
    <button title={t("viewer.zoomIn")} onclick={() => zoomBy(1)}>+</button>
    <button title={t("viewer.fitTitle")} onclick={() => fitMap()} disabled={!hasView}>⛶ {t("viewer.fit")}</button>
    {#if zoomFactor}<span class="dim">{fmtZoom(zoomFactor)}</span>{/if}
  </div>
  {#if current}
    <div class="group exp" bind:this={imageBox}>
      <button onclick={() => (imageOpen = !imageOpen)} title={t("image.title")}>◐ {t("image.button")}</button>
      {#if imageOpen}
        <div class="pop">
          {#each ["brightness", "contrast", "saturation", "gamma"] as const as k (k)}
            <label class="slider"><span class="sl"><span>{t(`image.${k}`)}</span><span class="mono">{imageAdjust[k].toFixed(2)}</span></span>
              <input type="range" min={RANGES[k].min} max={RANGES[k].max} step={RANGES[k].step} value={imageAdjust[k]}
                oninput={(e) => setImage(k, Number((e.target as HTMLInputElement).value))} /></label>
          {/each}
          <div class="prow">
            <button class:on={imageAuto} onclick={() => current && void computeAuto(current)}>{t("image.auto")}</button>
            <button onclick={() => applyImage({ ...NEUTRAL }, "manual")}>{t("image.neutral")}</button>
          </div>
          <p class="dim">{imageAuto ? t("image.isAuto") : t("image.isManual")}</p>
        </div>
      {/if}
    </div>
  {/if}
  <div class="group">
    <button title={t("viewer.rotL")} onclick={() => rotate(-15)}>⟲ 15°</button>
    <button title={t("viewer.rotR")} onclick={() => rotate(15)}>⟳ 15°</button>
    <button title={t("viewer.rot90")} onclick={() => rotate(90)}>⟳ 90°</button>
    <button title={t("viewer.straightTitle")} onclick={() => rotate(null)}>{t("viewer.straight")}</button>
    <span class="dim">{rotationDeg}°</span>
  </div>
  <div class="group exp" bind:this={exportBox}>
    <button onclick={() => (exportOpen = !exportOpen)} disabled={!hasView}>⤓ {t("export.button")}</button>
    {#if exportMsg?.ok && !exportOpen}<span class="ok saved" title={exportMsg.text}>✓ {t("export.saved")}</span>{/if}
    {#if exportOpen}
      <div class="pop">
        <label>{t("export.scale")}
          <select bind:value={exportScale}>
            <option value={1}>×1</option><option value={2}>×2</option><option value={4}>×4</option>
          </select></label>
        <label><input type="checkbox" bind:checked={exportLegend} /> {t("export.legend")}</label>
        <button onclick={doExport} disabled={exporting}>{exporting ? t("export.running") : t("export.go")}</button>
        {#if exportMsg}<p class={exportMsg.ok ? "ok" : "err"}>{exportMsg.text}</p>{/if}
      </div>
    {/if}
  </div>
  <button class="fs" onclick={toggleFullscreen}>
    {app.fullscreen ? `⤡ ${t("viewer.exitFullscreen")}` : `⤢ ${t("viewer.fullscreen")}`}</button>
{/snippet}

<div class="viewer" class:full={app.fullscreen}>
  {#if !app.fullscreen}
    <div class="bar">
      {#if withOrtho.length || app.map}
        <select value={current?.id ?? NO_ORTHO} onchange={(e) => (selectedId = (e.target as HTMLSelectElement).value)}>
          {#each withOrtho as r (r.id)}<option value={r.id}>{runLabel(r)}</option>{/each}
          {#if app.map}<option value={NO_ORTHO}>{t("viewer.noOrtho")}</option>{/if}
        </select>
        {@render controls()}
        {#if info}<span class="dim">{t("viewer.info", { w: fmtNum(info.width), h: fmtNum(info.height), gsd: info.gsd.toFixed(3) })}</span>{/if}
        {#if cursor}<span class="dim mono">X {cursor.x.toFixed(0)} · Y {cursor.y.toFixed(0)}</span>{/if}
      {:else}
        <span class="dim">{t("viewer.none")}</span>
      {/if}
      {#if errorKey}<span class="warn">{t(errorKey)}</span>{/if}
    </div>
  {/if}
  <div class="stage">
    <div class="map" bind:this={target}></div>
    {#if hasView}
      {#if vf.panelOpen}
        <LayersPanel {all} {shown} names={nameOf} selectedKey={selected ? `${selected.layer}:${selected.id}` : null} onselect={selectKey} />
      {:else}
        <button class="open-panel" title={t("lp.showPanel")} onclick={() => vf.setPanel(true)}>☰ {t("lp.title")}</button>
      {/if}
    {/if}
    {#if selected}
      <FeatureCard info={selected} extra={extraDetails} series={selectedSeries} onhide={hideSelected} onteleport={() => teleport(selected!.x, selected!.y)} onopen={() => openInGame(selected!, true)} onfit={fitSelected}
        onshowline={selected.lineId !== undefined ? () => selectKey(`lines:${selected!.lineId}`, true) : undefined}
        onclose={() => select(null)} />
    {/if}
    {#if live.staleMod}<div class="stale">⚠ {t("live.staleMod")}</div>{/if}
    {#if lineMenu}
      <div class="linemenu" bind:this={lineMenuBox} style:left="{lineMenu.x + 10}px" style:top="{lineMenu.y + 10}px">
        <div class="lmh">{t("viewer.linesHere", { n: lineMenu.items.length })}</div>
        {#each lineMenu.items as it, i (it.id)}
          {@const l = live.lines.find((x) => x.id === it.id)}
          <button class:on={i === lineMenu.idx} onclick={() => pickLine(i)}>
            <span class="lsw" style:background={rgb(l?.color ?? null)}></span>
            <span class="lmn">{it.name}</span>
            {#if l?.traffic}<span class="dim">{fmtNum(l.traffic.transported)}</span>{/if}
          </button>
        {/each}
        <div class="lmf dim">{t("viewer.linesHint")}</div>
      </div>
    {/if}
    {#if hover}<div class="tip" style:left="{hover.x + 14}px" style:top="{hover.y + 12}px">{hover.text}</div>{/if}
    {#if toastVisible && toast}<div class="toast {toast.cls}">{toast.text}</div>{/if}
    {#if app.fullscreen}
      <div class="float">
        {@render controls()}
        {#if cursor}<span class="dim mono">X {cursor.x.toFixed(0)} · Y {cursor.y.toFixed(0)}</span>{/if}
      </div>
    {:else}
      <span class="hint">{t("viewer.hint")}</span>
    {/if}
  </div>
</div>

<style>
  .viewer { position: relative; display: grid; grid-template-rows: auto 1fr; height: 100%; }
  .viewer.full { grid-template-rows: 1fr; }
  .bar { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--line); font-size: 13px; }
  .group { display: flex; gap: 4px; align-items: center; }
  .group button, .fs { padding: 4px 9px; }
  .stage { position: relative; min-height: 0; }
  .map { position: absolute; inset: 0; background: #0e1015; }
  .hint { position: absolute; right: 10px; bottom: 8px; font-size: 11px; color: var(--muted); pointer-events: none; }
  .float { position: absolute; top: 12px; right: 12px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
    padding: 6px 10px; border-radius: 8px; background: rgba(20, 23, 30, .72); backdrop-filter: blur(4px);
    font-size: 13px; opacity: .55; transition: opacity .15s; z-index: 4; }
  .float:hover, .float:focus-within { opacity: 1; }
  .open-panel { position: absolute; z-index: 5; top: 10px; left: 10px; padding: 4px 10px; background: rgba(24, 27, 34, .9); }
  .exp { position: relative; }
  .pop { position: absolute; z-index: 10; top: calc(100% + 6px); left: 0; display: flex; flex-direction: column; gap: 6px;
    width: 220px; padding: 8px 10px; border-radius: 8px; background: var(--panel); border: 1px solid var(--line); }
  .saved { font-size: 12px; }
  .slider { display: flex; flex-direction: column; gap: 1px; font-size: 12px; }
  .slider .sl { display: flex; justify-content: space-between; color: var(--muted); }
  .slider input { width: 100%; margin: 0; }
  .prow { display: flex; gap: 6px; }
  .prow button.on { border-color: var(--accent); }
  .pop p { margin: 0; font-size: 12px; word-break: break-all; }
  .toast { position: absolute; z-index: 7; left: 50%; top: 14px; transform: translateX(-50%); padding: 6px 14px; border-radius: 6px;
    background: rgba(24, 27, 34, .95); border: 1px solid var(--line); font-size: 13px; pointer-events: none; }
  .toast.ok { border-color: var(--ok); }
  .stale { position: absolute; z-index: 9; left: 50%; bottom: 14px; transform: translateX(-50%); max-width: 70%; padding: 6px 14px;
    border-radius: 8px; background: rgba(60, 40, 10, .95); border: 1px solid var(--warn); font-size: 13px; text-align: center; }
  .linemenu { position: absolute; z-index: 9; min-width: 200px; max-width: 300px; padding: 4px; border-radius: 8px;
    background: rgba(20, 23, 30, .97); border: 1px solid var(--line); box-shadow: 0 6px 20px rgba(0, 0, 0, .4); font-size: 12.5px; }
  .linemenu button { display: flex; align-items: center; gap: 7px; width: 100%; padding: 3px 6px; background: none; border: none;
    border-radius: 5px; text-align: left; color: var(--text); }
  .linemenu button:hover, .linemenu button.on { background: rgba(255, 255, 255, .09); }
  .lsw { width: 12px; height: 4px; border-radius: 2px; flex: none; }
  .lmn { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lmh, .lmf { padding: 2px 6px; font-size: 11px; color: var(--muted); }
  .tip { position: absolute; z-index: 8; pointer-events: none; max-width: 260px; padding: 3px 7px; border-radius: 5px; white-space: pre-line;
    background: rgba(16, 18, 24, .92); border: 1px solid var(--line); font-size: 12px; color: var(--text); }
  .toast.err { border-color: var(--err); }
</style>
