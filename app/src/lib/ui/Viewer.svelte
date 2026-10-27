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
  import { fmtDate, fmtNum, i18n, t, type MessageKey } from "$lib/i18n/index.svelte";
  import { joinPath, readBytes, readText, writeBytes } from "$lib/platform/fsx";
  import { app } from "$lib/state/app.svelte";
  import { live } from "$lib/state/live.svelte";
  import { PYRAMID_VERSION, type PyramidJson } from "$lib/state/orthoExport";
  import { runLabel, runs } from "$lib/state/runs.svelte";
  import { viewerFilters as vf } from "$lib/state/viewerFilters.svelte";
  import FeatureCard from "./viewer/FeatureCard.svelte";
  import LayersPanel from "./viewer/LayersPanel.svelte";
  import MapStyleSettings from "./MapStyleSettings.svelte";
  import { exportViewPng } from "./viewer/exportView";
  import { createLiveLayers, rgb, toMap, toWorld, type FeatureInfo, type Frame } from "./viewer/layers";
  import { insideRings } from "$lib/core/towns";
  import { TrackIndex, uncovered } from "$lib/core/routes";
  import { autoAdjust, NEUTRAL, RANGES, type ImageAdjust } from "$lib/core/imageAdjust";
  import { perf } from "$lib/state/perf.svelte";
  import { mapStyle } from "$lib/state/mapStyle.svelte";
  import { parseHeightmap, type Heightmap } from "$lib/core/lua";
  import { createReliefLayers, type ReliefInfo } from "./viewer/relief";
  import { createPlainBasemap } from "./viewer/basemap";

  /** active: the Visualiser tab is shown (hidden, it keeps its state but does no work). */
  let { runId = null, active = true }: { runId?: string | null; active?: boolean } = $props();

  /** Zoom-in levels beyond full resolution (×2, ×4, ×8), drawn from the finest tiles. */
  const EXTRA_ZOOM = 3;
  /** Zoom step between full resolution and the whole map. */
  const ZOOM_OUT_STEP = 2 ** (1 / 8);
  /** Selector value: live data on a neutral background, without ortho. */
  const NO_ORTHO = "__none";
  const BACKGROUND = "#0e1015";

  let target: HTMLDivElement;
  let map: Map | null = null;
  let tileLayer: WebGLTileLayer | null = null;
  /** Extent of the shown map (fit button). */
  let viewExtent: number[] | null = null;
  const liveLayers = createLiveLayers();
  const relief = createReliefLayers();
  const plain = createPlainBasemap();
  /** Heightmap of the contours: the shown run's own (matches its ortho), else the current export. */
  let runHm = $state<{ id: string; hm: Heightmap | null } | null>(null);
  /** Contour interval drawn (auto choice shown in the panel) and coloured altitude range (legend). */
  let reliefInfo = $state<ReliefInfo>({ step: null, ticks: null });
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
  let styleOpen = $state(false);
  // Tool bubbles (top in fullscreen, view bubble bottom right): same behaviour. Pinned: always shown;
  // otherwise faded out a moment after the pointer stops moving over the map (back on movement / hover),
  // and in fullscreen hidden altogether until the pointer comes over them.
  const LS_PINS = "hq.viewerPins";
  let pins = $state<{ top: boolean; bottom: boolean }>((() => {
    try {
      const v = JSON.parse(localStorage.getItem(LS_PINS) ?? "null") as { top?: boolean; bottom?: boolean } | null;
      return { top: v?.top ?? false, bottom: v?.bottom ?? true };
    } catch {
      return { top: false, bottom: true };
    }
  })());
  function togglePin(which: "top" | "bottom"): void {
    pins = { ...pins, [which]: !pins[which] };
    try {
      localStorage.setItem(LS_PINS, JSON.stringify(pins));
    } catch {
      /* storage unavailable */
    }
  }
  let pointerActive = $state(true);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  function poke(): void {
    pointerActive = true;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (pointerActive = false), 2500);
  }
  /** Heights of the bubbles: "fit" keeps the map clear of them. */
  let topH = $state(0), bottomH = $state(0);
  let styleBox = $state<HTMLDivElement | null>(null);
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
  // One derived per kind: each is recomputed only when its own sources change, so its objects stay
  // the same across the other updates (the map rebuilds a group only when its objects changed).
  const allIndustries = $derived.by(() => {
    const sk = live.stocks;
    return sk ? live.industries.map((i) => ({ ...i, stocks: sk.industries.get(i.id) })) : live.industries;
  });
  const allStations = $derived.by(() => {
    const st = live.stats;
    return st ? live.stations.map((s) => ({ ...s, traffic: st.stations.get(s.id) })) : live.stations;
  });
  const allLines = $derived.by(() => {
    const st = live.stats;
    return st ? live.lines.map((l) => ({ ...l, traffic: st.lines.get(l.id) })) : live.lines;
  });
  const all = $derived<LiveData>({
    towns: live.towns, vehicles: live.vehicles, industries: allIndustries,
    warehouses: live.stocks?.warehouses ?? [], stations: allStations, lines: allLines,
  });
  const shown = $derived(applyFilters(all, vf.current));

  // Follow a "Voir dans le visualiseur" request from GridLab.
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
  /** Spatial index of each track, kept while the track is the same (tracks change every 20 s or so). */
  const trackIndexes = new WeakMap<[number, number][][], TrackIndex>();
  function computeFills(): void {
    fillsTimer = null;
    if (!active || !perf.caps.fills) return;
    fillsAt = Date.now();
    const routes = live.routes, out = new globalThis.Map<number, [number, number][][]>();
    // Ships and aircraft: their averaged crossings are the track; their trails wander off it.
    const free = new Set(live.lines.filter((l) => l.mode === "water" || l.mode === "air").map((l) => l.id));
    for (const [line, byVehicle] of live.trails) {
      const route = routes.get(line);
      if (!route || free.has(line)) continue;
      let index = trackIndexes.get(route);
      if (!index) trackIndexes.set(route, (index = new TrackIndex(route)));
      const pieces = [...byVehicle.values()].flatMap((tr) => uncovered(tr, index));
      if (pieces.length) out.set(line, pieces);
    }
    fills = fillsEqual(fills, out) ? fills : out;
  }
  /** Same pieces (so a recomputation that changed nothing does not rebuild the lines). */
  function fillsEqual(a: globalThis.Map<number, [number, number][][]>, b: globalThis.Map<number, [number, number][][]>): boolean {
    if (a.size !== b.size) return false;
    for (const [id, pieces] of b) {
      const prev = a.get(id);
      if (!prev || prev.length !== pieces.length) return false;
      for (let i = 0; i < pieces.length; i++) {
        const p = prev[i], q = pieces[i];
        if (!p || !q || p.length !== q.length) return false;
        for (let k = 0; k < p.length; k++) if (p[k]![0] !== q[k]![0] || p[k]![1] !== q[k]![1]) return false;
      }
    }
    return true;
  }
  $effect(() => {
    void live.trailsVersion;
    void live.routes;
    // Hidden, or the performance controller gave the fills up: none, and no timer left running.
    if (!active || !perf.caps.fills) {
      if (fillsTimer) {
        clearTimeout(fillsTimer);
        fillsTimer = null;
      }
      if (untrack(() => fills.size)) fills = new globalThis.Map();
      return;
    }
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
      // An edge stroke carries every line drawn on it (shared stretch).
      const strokeLines = f.get("lines") as number[] | undefined;
      if (strokeLines) {
        for (const id of strokeLines) {
          const li = liveLayers.infoOf(`lines:${id}`);
          if (li && !lines.has(id)) lines.set(id, { info: li, hover: li.name });
        }
        return;
      }
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

  /** Zoomed out past full resolution: steps of 2^(1/8) (a slight resampling does not show there, and
   * "fit" can fill the window); from full resolution in, the exact pyramid levels (crisp pixels). */
  function viewResolutions(coarsest: number, gsd: number): number[] {
    const out: number[] = [];
    for (let r = coarsest * 2; r > gsd * 1.0001; r /= ZOOM_OUT_STEP) out.push(r);
    out.push(gsd);
    for (let k = 1; k <= EXTRA_ZOOM; k++) out.push(gsd / 2 ** k);
    return out;
  }

  /** Map area to fit: the map bounds (the ortho image overflows them: capture margins), inside the image. */
  function mapExtent(): number[] | null {
    if (!frame || !viewExtent) return viewExtent;
    const run = current;
    const hm = run && runHm?.id === run.id ? runHm.hm : null;
    const b = hm ? { minX: hm.minX, minY: hm.minY, maxX: hm.minX + hm.width, maxY: hm.minY + hm.height } : app.map?.bounds;
    if (!b) return viewExtent;
    const [x0, y0] = toMap(frame, b.minX, b.minY), [x1, y1] = toMap(frame, b.maxX, b.maxY);
    const e = [Math.max(Math.min(x0, x1), viewExtent[0]!), Math.max(Math.min(y0, y1), viewExtent[1]!),
      Math.min(Math.max(x0, x1), viewExtent[2]!), Math.min(Math.max(y0, y1), viewExtent[3]!)];
    return e[0]! < e[2]! && e[1]! < e[3]! ? e : viewExtent;
  }

  /**
   * Whole map in the window (keeps the rotation), clear of the layer panel and the view bubble: the
   * finest zoom step that shows all of it (steps of 2^(1/8): at most ≈ 9 % of margin).
   */
  function fitMap(animate = true): void {
    const view = map?.getView();
    const ext = mapExtent();
    if (!view || !ext) return;
    const panel = vf.panelOpen && hasView ? (target.parentElement?.querySelector(".panel") as HTMLElement | null)?.offsetWidth ?? 300 : 0;
    const top = app.fullscreen ? topH + 24 : 12, bottom = (hasView ? bottomH : 0) + 24;
    view.fit(ext, { padding: [top, 12, bottom, panel + 12], duration: animate ? 250 : 0 });
  }

  // The performance controller's tile cache applies to the shown ortho at once, not at the next
  // background (the renderer's cache is an LRU whose size can be changed in place).
  $effect(() => {
    const size = perf.caps.tileCache;
    const renderer = tileLayer?.getRenderer() as unknown as
      { tileRepresentationCache?: { setSize(n: number): void }; maxStaleKeys?: number } | null | undefined;
    if (!renderer?.tileRepresentationCache) return;
    renderer.tileRepresentationCache.setSize(size);
    renderer.maxStaleKeys = size * 0.5;
  });

  function setTiles(layer: WebGLTileLayer | null): void {
    if (!map) return;
    if (tileLayer) {
      map.removeLayer(tileLayer);
      // Removing does not free the WebGL renderer: its context and tile textures go with dispose().
      tileLayer.getSource()?.dispose();
      tileLayer.dispose();
    }
    tileLayer = layer;
    layer?.setVisible(vf.current.basemap);
    if (layer) map.getLayers().insertAt(0, layer);
  }

  /**
   * Image space in metres: x = world Y − minY (columns), y = −(world X − minX) (rows, downwards).
   * Tile (z, x, y) = pyramid/<z>/<x>_<y>.png, origin top-left, always 256×256.
   */
  let showSeq = 0;
  async function show(run: NonNullable<typeof current>): Promise<void> {
    const seq = ++showSeq;
    errorKey = null;
    const raw = await readText(joinPath(run.dir, "pyramid", "pyramid.json"));
    if (seq !== showSeq) return;
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
    const resolutions = viewResolutions(tileRes[0]!, p.gsd);
    // Settings saved for this very ortho (a new ortho of the run starts again from auto).
    const saved = imageStore[run.id]?.ortho === p.createdAt ? imageStore[run.id] : undefined;
    const adj = { ...NEUTRAL, ...(saved?.adj ?? {}) };
    imageOrtho = p.createdAt;
    setTiles(new WebGLTileLayer({
      preload: 1,
      // Tiles kept on the GPU: fewer when the performance controller is at its last level.
      cacheSize: untrack(() => perf.caps.tileCache),
      source: new ImageTileSource({ projection, tileGrid, interpolate: false, transition: 0, loader: loadTile }),
      style: {
        variables: { ...adj },
        brightness: ["var", "brightness"], contrast: ["var", "contrast"],
        saturation: ["var", "saturation"], gamma: ["var", "gamma"],
      },
    }));
    imageRun = run.id;
    imageAdjust = adj;
    imageAuto = saved?.mode !== "manual";
    if (imageAuto && seq === showSeq) void computeAuto(run);
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

  /** Next right angle (after a free Alt+Shift+drag rotation too). */
  function rotate(stepDeg: 90): void {
    const view = map?.getView();
    if (!view) return;
    const deg = (view.getRotation() * 180) / Math.PI;
    const next = (Math.floor(deg / stepDeg + 1e-6) + 1) * stepDeg;
    view.animate({ rotation: (next * Math.PI) / 180, duration: 200 });
  }

  /** ±1 = ×2 / ÷2: the zoom steps are finer when zoomed out (fit), the zoom speed must not be. */
  function zoomBy(delta: number): void {
    const view = map?.getView();
    const r = view?.getResolution();
    if (view && r) view.animate({ resolution: view.getConstrainedResolution(r / 2 ** delta, Math.sign(delta)), duration: 150 });
  }

  // Mouse wheel: a notch zooms ×2 like before, whatever the zoom steps (finer when zoomed out). Each
  // notch goes straight to a zoom step (no free zoom snapped afterwards: no bounce), within the
  // view's limits; a trackpad's small deltas add up until they make a step.
  let wheelTarget: number | null = null;
  let wheelAcc = 0;
  let wheelIdle: ReturnType<typeof setTimeout> | null = null;
  function onWheel(e: WheelEvent): void {
    const view = map?.getView();
    if (!map || !view) return;
    e.preventDefault();
    wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY;
    if (wheelIdle) clearTimeout(wheelIdle);
    wheelIdle = setTimeout(() => ((wheelTarget = null), (wheelAcc = 0)), 250);
    // A mouse notch is ~100 px: ×2; less (trackpad) waits for more, 25 px at least per move.
    if (Math.abs(wheelAcc) < 25) return;
    const steps = Math.max(-1, Math.min(1, wheelAcc / 100));
    wheelAcc = 0;
    const from = wheelTarget ?? view.getResolution();
    if (!from) return;
    const dir = steps > 0 ? -1 : 1;
    const to = view.getConstrainedResolution(from * 2 ** steps, dir);
    if (to === from) return;
    wheelTarget = to ?? null;
    view.cancelAnimations();
    view.animate({ resolution: to, anchor: map.getEventCoordinate(e), duration: 160 });
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
      const bytes = await exportViewPng(map, { scale: exportScale, legend, background: plainBackground ? "#000000" : BACKGROUND });
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

  // The shown run's heightmap (copied into the run at capture time).
  $effect(() => {
    const run = current;
    if (!run || runHm?.id === run.id) return;
    const id = run.id;
    void readText(joinPath(run.dir, "heightmap.lua")).then((text) => {
      const hm = text ? parseHeightmap(text) : null;
      const cur = app.map?.hm;
      if (hm && cur?.waterGrid && cur.minX === hm.minX && cur.minY === hm.minY && cur.width === hm.width) hm.waterGrid = cur.waterGrid;
      if (current?.id === id) runHm = { id, hm };
    });
  });

  // Relief: colours and / or contour lines, redrawn when the frame, the heightmap or their settings change.
  $effect(() => {
    const opts = vf.current.relief;
    const run = current;
    const hm = (run && runHm?.id === run.id ? runHm.hm : null) ?? app.map?.hm ?? null;
    if (!ready) return;
    reliefInfo = relief.update(frame, hm, opts);
  });

  // Basemap: the ortho, or (switched off, or no ortho) black with the water and the map outline.
  const plainBackground = $derived(!current || !vf.current.basemap);
  $effect(() => {
    const show = vf.current.basemap;
    const run = current;
    const hm = (run && runHm?.id === run.id ? runHm.hm : null) ?? app.map?.hm ?? null;
    if (!ready) return;
    tileLayer?.setVisible(show);
    plain.update(frame, hm, plainBackground, live.industries);
  });

  // Live features follow the data and the filters.
  // Hidden: nothing (the data keep coming in); shown again: one update with the latest data, the
  // vehicles straight where the game has them (no glide from where they were left).
  let resumed = false;
  $effect(() => {
    if (!active) {
      resumed = true;
      return;
    }
    const d = shown;
    const routes = live.routes;
    const tr = trails;
    const fl = fills;
    const areas = live.townAreas;
    const towns = live.towns;
    const locale = i18n.locale;
    const caps = perf.caps;
    const labelsOn = caps.movingLabels ? vf.current.labels : { ...vf.current.labels, vehicles: false, lines: false };
    const ms = mapStyle.current;
    if (!frame) return;
    const t0 = performance.now();
    const { layoutMs } = liveLayers.update(frame, d, routes, live.routeParts, tr, fl, areas, labels, {
      labels: labelsOn, glideMs: untrack(() => live.vehicleIntervalMs), ...ms,
      plainLines: caps.plainLines, maxTrackedLines: caps.maxTrackedLines, snap: resumed,
    }, towns, locale);
    resumed = false;
    const objects = liveLayers.count();
    const updateMs = performance.now() - t0;
    const layout = layoutMs || undefined;
    // Outside the effect: report() can change the level, which this effect reads through the caps.
    untrack(() => {
      queueMicrotask(() => perf.report(objects, updateMs, layout));
    });
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
  /** run → settings, mode and the ortho they were made for (pyramid.json createdAt). */
  type ImageStore = Record<string, { mode: "auto" | "manual"; adj: ImageAdjust; ortho?: string }>;
  const loadImageStore = (): ImageStore => {
    try {
      return JSON.parse(localStorage.getItem(LS_IMAGE) ?? "{}") as ImageStore;
    } catch {
      return {};
    }
  };
  let imageStore = $state(loadImageStore());
  let imageOrtho: string | undefined;
  let imageRun = $state<string | null>(null);
  let imageAdjust = $state<ImageAdjust>({ ...NEUTRAL });
  let imageAuto = $state(false);

  function applyImage(adj: ImageAdjust, mode: "auto" | "manual"): void {
    imageAdjust = adj;
    tileLayer?.updateStyleVariables({ ...adj });
    if (!imageRun) return;
    imageStore = { ...imageStore, [imageRun]: { mode, adj, ortho: imageOrtho } };
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
    if (!styleOpen) return;
    const onDown = (e: PointerEvent) => {
      if (styleBox && !styleBox.contains(e.target as Node)) styleOpen = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") styleOpen = false;
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
      target, controls: [], layers: [...plain.layers, ...relief.layers, ...liveLayers.layers],
      // Double-click teleports the in-game camera (zoom stays on the wheel and the buttons).
      interactions: defaultInteractions({ doubleClickZoom: false, mouseWheelZoom: false }),
    });
    target.addEventListener("wheel", onWheel, { passive: false });
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
      if (now - lastAnim < 33 || !frame || !active || !vf.current.layers.vehicles) return;
      lastAnim = now;
      liveLayers.animate(frame, Date.now());
    };
    raf = requestAnimationFrame(tick);
    ready = true;

    const ro = new ResizeObserver(() => map?.updateSize());
    ro.observe(target);
    // Keyboard: F / F11 toggle fullscreen, Escape leaves it, L toggles the filter panel (viewer visible only).
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      // Only text entry keeps the keys (a checkbox or a list with the focus does not).
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || !!el.closest("textarea")
        || (el instanceof HTMLInputElement && !["checkbox", "radio", "range", "button", "submit", "reset", "color", "file"].includes(el.type)));
      if (!target.offsetParent || typing) return;
      if (e.key === "f" || e.key === "F" || e.key === "F11") {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === "l" || e.key === "L") {
        vf.setPanel(!vf.panelOpen);
      } else if (e.key === "0") {
        fitMap();
      } else if (e.key === "Escape") {
        if (lineMenu) { lineMenu = null; return; }
        if (exportOpen || imageOpen || styleOpen) return;
        if (selected) select(null);
        else if (app.fullscreen) void app.setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    const onFs = () => {
      const on = !!document.fullscreenElement;
      if (app.fullscreen !== on) app.fullscreen = on;
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      target.removeEventListener("wheel", onWheel);
      if (wheelIdle) clearTimeout(wheelIdle);
      if (fillsTimer) clearTimeout(fillsTimer);
      if (toastTimer) clearTimeout(toastTimer);
      if (idleTimer) clearTimeout(idleTimer);
      cancelAnimationFrame(raf);
      map?.setTarget(undefined);
      tileLayer?.getSource()?.dispose();
      tileLayer?.dispose();
      map?.dispose();
      map = null;
    };
  });

  const fmtZoom = (f: number) => (f >= 1 ? `×${Math.round(f)}` : `1/${Math.round(1 / f)}`);
  const hasView = $derived(!!current || dataOnly);
  /** Shown at the bottom of the layer panel: ortho size and resolution (or map size), current zoom. */
  const viewInfo = $derived.by(() => {
    const zoom = zoomFactor ? ` · ${fmtZoom(zoomFactor)}` : "";
    if (info) return t("viewer.info", { w: fmtNum(info.width), h: fmtNum(info.height), gsd: info.gsd.toFixed(2) }) + zoom;
    const b = app.map?.bounds;
    return b ? t("viewer.mapSize", { w: fmtNum(b.width / 1000, 1), h: fmtNum(b.height / 1000, 1) }) : "";
  });
</script>

{#snippet tools()}
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
  <div class="group exp" bind:this={styleBox}>
    <button onclick={() => (styleOpen = !styleOpen)} title={t("viewer.mapSettingsTitle")}>⚙ {t("viewer.mapSettings")}</button>
    {#if styleOpen}<div class="pop style-pop"><MapStyleSettings /></div>{/if}
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
{/snippet}

{#snippet pin(which: "top" | "bottom")}
  <button class="pin" class:on={pins[which]} title={t(pins[which] ? "viewer.unpin" : "viewer.pin")} onclick={() => togglePin(which)}>📌</button>
{/snippet}

{#snippet viewBubble()}
  <div class="tb bubble" class:idle={!pins.bottom && !pointerActive} class:hide={app.fullscreen && !pins.bottom} bind:clientHeight={bottomH}>
    <div class="group">
      <button title={t("viewer.zoomOut")} onclick={() => zoomBy(-1)}>−</button>
      <button title={t("viewer.zoomIn")} onclick={() => zoomBy(1)}>+</button>
      {#if zoomFactor}<span class="dim zf">{fmtZoom(zoomFactor)}</span>{/if}
    </div>
    <button title={t("viewer.fitTitle")} onclick={() => fitMap()}>⛶ {t("viewer.fit")}</button>
    <button title={t("viewer.rot90")} onclick={() => rotate(90)}>⟳ 90°{#if rotationDeg}<span class="dim"> · {rotationDeg}°</span>{/if}</button>
    <button onclick={toggleFullscreen}>{app.fullscreen ? `⤡ ${t("viewer.exitFullscreen")}` : `⤢ ${t("viewer.fullscreen")}`}</button>
    <span class="dim mono pos">{cursor ? `X ${cursor.x.toFixed(0)} · Y ${cursor.y.toFixed(0)}` : "X — · Y —"}</span>
    <span class="help" title={t("viewer.hint")}>?</span>
    {@render pin("bottom")}
  </div>
{/snippet}

<div class="viewer" class:full={app.fullscreen}>
  {#if !app.fullscreen}
    <div class="bar">
      {#if withOrtho.length || app.map}
        <select value={current?.id ?? NO_ORTHO} onchange={(e) => (selectedId = (e.target as HTMLSelectElement).value)}>
          {#each withOrtho as r (r.id)}<option value={r.id}>{runLabel(r)}</option>{/each}
          {#if app.map}<option value={NO_ORTHO}>{t("viewer.noOrtho")}</option>{/if}
        </select>
        {@render tools()}
      {:else}
        <span class="dim">{t("viewer.none")}</span>
      {/if}
      {#if errorKey}<span class="warn">{t(errorKey)}</span>{/if}
    </div>
  {/if}
  <div class="stage" onpointermove={poke} role="presentation">
    <div class="map" class:plain={plainBackground} bind:this={target}></div>
    {#if hasView}
      {#if vf.panelOpen}
        <LayersPanel {all} {shown} {reliefInfo} hasOrtho={!!current} {viewInfo} hasRelief={!!(app.map || runHm?.hm)} names={nameOf} selectedKey={selected ? `${selected.layer}:${selected.id}` : null} onselect={selectKey} />
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
    {#if perf.warning}
      <!-- Performance controller: the display is simplified while the level is not "ok". -->
      <div class="perfwarn" class:critical={perf.level === "critical"}>
        <span>⚠ {t("perf.warning", {
          objects: fmtNum(perf.sample.objects),
          memory: perf.sample.memory !== null ? t("perf.warningMemory", { pct: Math.round(perf.sample.memory * 100) }) : "",
        })}</span>
        <button title={t("perf.close")} onclick={() => perf.dismiss()}>✕</button>
      </div>
    {/if}
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
      <div class="tb float" class:idle={!pins.top && !pointerActive} class:hide={!pins.top} bind:clientHeight={topH}>{@render tools()}{@render pin("top")}</div>
    {/if}
    {#if hasView}{@render viewBubble()}{/if}
  </div>
</div>

<style>
  .viewer { position: relative; display: grid; grid-template-rows: auto 1fr; height: 100%; }
  .viewer.full { grid-template-rows: 1fr; }
  .bar { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--line); font-size: 13px; }
  .group { display: flex; gap: 4px; align-items: center; }
  .group button { padding: 4px 9px; }
  .stage { position: relative; min-height: 0; }
  .map { position: absolute; inset: 0; background: #0e1015; }
  .map.plain { background: #000; }
  /* Tool bubbles: same look and behaviour (pin, fade when the pointer rests). */
  .tb { position: absolute; z-index: 4; display: flex; gap: 6px; align-items: center; padding: 5px 8px; border-radius: 10px;
    background: rgba(20, 23, 30, .82); backdrop-filter: blur(4px); border: 1px solid rgba(255, 255, 255, .06);
    font-size: 12.5px; transition: opacity .25s; }
  .tb.idle:not(:hover):not(:focus-within) { opacity: .25; }
  /* Fullscreen, not pinned: hidden until hovered; a wider invisible margin around it catches the pointer. */
  .tb.hide:not(:hover):not(:focus-within) { opacity: 0; }
  .tb.hide::before { content: ""; position: absolute; inset: -28px; z-index: -1; }
  .float { top: 12px; left: 50%; transform: translateX(-50%); flex-wrap: wrap; }
  /* View controls, bottom right of the map (also in fullscreen). */
  .bubble { right: 12px; bottom: 12px; }
  .pin { padding: 2px 5px; font-size: 11px; background: none; border: 1px solid transparent; opacity: .45; filter: grayscale(1); }
  .pin.on { opacity: 1; filter: none; border-color: var(--line); }
  .bubble button { padding: 3px 8px; font-size: 12.5px; }
  .bubble .zf { min-width: 30px; text-align: center; }
  .bubble .pos { min-width: 120px; text-align: right; font-size: 11.5px; }
  .help { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%;
    border: 1px solid var(--line); color: var(--muted); font-size: 11px; cursor: help; }
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
  .style-pop { width: 340px; }
  .pop p { margin: 0; font-size: 12px; word-break: break-all; }
  .toast { position: absolute; z-index: 7; left: 50%; top: 14px; transform: translateX(-50%); padding: 6px 14px; border-radius: 6px;
    background: rgba(24, 27, 34, .95); border: 1px solid var(--line); font-size: 13px; pointer-events: none; }
  .toast.ok { border-color: var(--ok); }
  .stale { position: absolute; z-index: 9; left: 50%; bottom: 14px; transform: translateX(-50%); max-width: 70%; padding: 6px 14px;
    border-radius: 8px; background: rgba(60, 40, 10, .95); border: 1px solid var(--warn); font-size: 13px; text-align: center; }
  .perfwarn { position: absolute; z-index: 9; left: 50%; top: 52px; transform: translateX(-50%); max-width: min(640px, 80%);
    display: flex; gap: 10px; align-items: center; padding: 5px 8px 5px 12px; border-radius: 8px; font-size: 12.5px;
    background: rgba(24, 27, 34, .94); border: 1px solid var(--warn); }
  .perfwarn.critical { border-color: var(--err); }
  .perfwarn button { padding: 1px 7px; font-size: 11px; background: none; }
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
