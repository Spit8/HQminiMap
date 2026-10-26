<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { computeMosaic, FOV_V_DEG_MAX, FOV_V_DEG_MIN, type Mosaic } from "$lib/core/geometry";
  import { modFiles, planSignature, writeIssue, type WriteIssue } from "$lib/core/modwriter";
  import { estimateOrtho } from "$lib/core/pyramid";
  import { fmtDate, fmtNum, t } from "$lib/i18n/index.svelte";
  import { OVERVIEW_MAX_SIDE } from "$lib/state/orthoExport";
  import { bytesPerTile, fmtBytes, fmtDuration, secPerMp } from "$lib/state/orthoSpeed";
  import { ensureDir, fileExists, joinPath, listFiles, removeFile, writeText } from "$lib/platform/fsx";
  import { capturePlanPath, cutsceneDir, legacyModPlanPath } from "$lib/platform/paths";
  import { app } from "$lib/state/app.svelte";
  import { aspectName, pngSize, RESOLUTIONS } from "$lib/core/png";
  import { parseShotName } from "$lib/core/tiles";
  import { readBytes } from "$lib/platform/fsx";
  import { runs } from "$lib/state/runs.svelte";
  import { tileFileName } from "$lib/state/orthoExport";
  import { heightRange, reliefCanvas, screenToWorld, worldToScreen, type ViewState } from "./mapview";
  import { DEFAULT_MODE, MODE_LIST, modeConfigs, modeKey, type CaptureMode, type ModeChoice } from "$lib/core/modes";
  import type { Heightmap } from "$lib/core/lua";
  import { captureDurationSec, captureTiming } from "$lib/core/plan";
  import { INTERPS, type Interp } from "$lib/core/ortho";
  import { fmtClock } from "$lib/i18n/index.svelte";
  import { lab } from "$lib/state/lab.svelte";
  import { live } from "$lib/state/live.svelte";
  import { orthoJob, type OrthoResult } from "$lib/state/orthoJob.svelte";
  import { PYRAMID_VERSION } from "$lib/state/orthoExport";
  import { isMeasured } from "$lib/state/orthoSpeed";
  import { runLabel } from "$lib/state/runs.svelte";
  import type { MessageKey } from "$lib/i18n/index.svelte";
  import CaptureTiles from "./CaptureTiles.svelte";
  import PanelResizer, { loadWidth } from "./PanelResizer.svelte";

  let { onShowViewer }: { onShowViewer?: (runId: string) => void } = $props();

  let host: HTMLDivElement;
  let cv: HTMLCanvasElement;
  let view: ViewState = { scale: 0.05, ox: 0, oy: 0 };
  let relief: HTMLCanvasElement | null = null;
  let reliefFor: unknown = null;
  let writeMsg = $state<{ ok: boolean; text: string } | null>(null);
  /** The scan request sent, waiting for the game's answer. */
  let launching = $state(false);
  const modPlan = $derived(app.capturePlan);
  const lastCaptureStamp = $derived(app.lastCapture?.planStamp ?? null);
  const refreshModPlan = () => app.refreshCapture();

  /** The written grid has not been captured yet: the player's next action is in the game. */
  const awaitingCapture = $derived(!!modPlan && app.lastCapture?.planStamp !== modPlan.stamp);
  const capturing = $derived(!!modPlan && app.lastCapture?.planStamp === modPlan.stamp && !app.lastCapture.finished);

  const modPlanSame = $derived.by(() => {
    if (!modPlan || !mo || !app.map) return null;
    return planSignature(modFiles(mo, app.map.hm, 0).plan) === planSignature(modPlan.text);
  });

  const cfg = $derived(app.config);

  // ---- game resolution: the shape of every capture (grid footprint, ortho reprojection)
  let detected = $state<{ width: number; height: number } | null>(null);
  let detectState = $state<"idle" | "busy" | "none">("idle");
  /** The shown resolution comes from an earlier detection (no screenshot readable now). */
  let fromMemory = $state(false);
  /** Detected by the running game itself (its view size), not from a screenshot file. */
  let fromGame = $state(false);
  /** The game's view size, while it answers (status updated in the last 30 s). */
  const gameScreen = $derived(live.status?.screen && Date.now() - live.statusAt < 30_000 ? live.status.screen : null);
  const resKey = $derived(`${cfg.screenW}x${cfg.screenH}`);
  const isPreset = $derived(RESOLUTIONS.some(([w, h]) => w === cfg.screenW && h === cfg.screenH));
  let customRes = $state(false);
  /** Resolution taken from the game's screenshots (default) rather than chosen by hand. */
  const autoRes = $derived(cfg.SCREEN_AUTO !== false);

  /** A resolution found: remembered, and (default) used by the grid. */
  function useDetected(size: { width: number; height: number }, game: boolean): void {
    detected = size;
    detectState = "idle";
    fromMemory = false;
    fromGame = game;
    const known = cfg.SCREEN_DETECTED;
    if (!known || known.w !== size.width || known.h !== size.height) {
      app.setConfig({ SCREEN_DETECTED: { w: size.width, h: size.height, at: Date.now() } });
    }
    if (autoRes && (size.width !== cfg.screenW || size.height !== cfg.screenH)) {
      app.setConfig({ screenW: size.width, screenH: size.height });
    }
  }

  /**
   * The game's resolution: its view size, given by the running game (mod status); else the size of
   * its newest screenshot (files named by the game only), else of the last capture's first tile.
   */
  async function detectResolution(): Promise<void> {
    const p = app.paths;
    if (!p) return;
    if (gameScreen) {
      useDetected({ width: gameScreen.w, height: gameScreen.h }, true);
      return;
    }
    detectState = "busy";
    try {
      const shots = (await listFiles(p.screenshots, /\.png$/i))
        .filter((f) => parseShotName(f.name))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      const candidates = [...shots.slice(0, 3).map((f) => f.path)];
      const run = runs.runs.find((r) => r.collected > 0);
      if (run) candidates.push(joinPath(run.dir, tileFileName(1)));
      for (const path of candidates) {
        try {
          const size = pngSize(await readBytes(path));
          if (size) {
            useDetected(size, false);
            return;
          }
        } catch {
          /* unreadable: next */
        }
      }
      // No screenshot readable now: the last detected resolution still holds.
      const known = cfg.SCREEN_DETECTED;
      detected = known ? { width: known.w, height: known.h } : null;
      detectState = known ? "idle" : "none";
      fromMemory = !!known;
      fromGame = false;
    } finally {
      if (detectState === "busy") detectState = "idle";
    }
  }

  // The game reports its view size (with the live status): follow it as soon as it comes or changes.
  $effect(() => {
    const g = gameScreen;
    if (g) untrack(() => useDetected({ width: g.w, height: g.h }, true));
  });

  /** Resolution chosen by hand: stops following the detection. */
  function setResolution(w: number, h: number): void {
    if (w > 0 && h > 0) app.setConfig({ screenW: Math.round(w), screenH: Math.round(h), SCREEN_AUTO: false });
  }

  /** Back to the default: follow the game's latest screenshot. */
  function useAutoResolution(): void {
    customRes = false;
    app.setConfig({ SCREEN_AUTO: true, ...(detected ? { screenW: detected.width, screenH: detected.height } : {}) });
    void detectResolution();
  }
  const mo = $derived.by<Mosaic | null>(() => {
    if (!app.map) return null;
    try {
      return computeMosaic(cfg, app.map.hm);
    } catch {
      return null;
    }
  });
  const issue = $derived<WriteIssue | null>(mo ? writeIssue(mo) : null);
  /** Following the game's resolution but it was never found: a scan would use a guess. */
  const resUnknown = $derived(autoRes && !detected && detectState === "none" && !cfg.SCREEN_DETECTED);
  const blocker = $derived(!mo ? t("grid.block.noMap") : resUnknown ? t("grid.resolutionNone") : issue ? issueText(issue) : null);
  /** The current grid is already the smallest one covering the map. */
  const atBest = $derived(!!mo && mo.bestGrid.nX === cfg.GRID_NX && mo.bestGrid.nY === cfg.GRID_NY);

  /** Ortho this capture will give, with the panel's ortho settings (interpolation, half resolution). */
  const orthoGsd = $derived(mo ? mo.geo.gsdX * (lab.halfRes ? 2 : 1) : 0);
  const orthoEst = $derived(
    mo && app.map ? estimateOrtho(app.map.hm.width, app.map.hm.height, orthoGsd, OVERVIEW_MAX_SIDE) : null,
  );
  const orthoBytes = $derived(orthoEst ? orthoEst.tiles * bytesPerTile(lab.interp) : 0);
  const orthoSec = $derived(orthoEst ? orthoEst.megapixels * secPerMp(lab.interp) : 0);
  const captureSec = $derived(mo ? captureDurationSec(captureTiming(cfg), mo.centers.length) : 0);

  // ---- ready-made modes: grid, FOV, altitude and sun solved for the map and the game resolution.
  // The four are solved together (≈ 150 ms) ahead of time, when the map or the resolution arrives,
  // and cached: a click on a mode only reads the cache.
  const mode = $derived<ModeChoice>(cfg.MODE ?? DEFAULT_MODE);
  let modeCache: { hm: Heightmap; key: string; all: ReturnType<typeof modeConfigs> } | null = null;
  function modesFor(hm: Heightmap) {
    const key = modeKey(cfg);
    if (modeCache?.hm !== hm || modeCache.key !== key) modeCache = { hm, key, all: modeConfigs(cfg, hm) };
    return modeCache.all;
  }
  function applyMode(m: CaptureMode): void {
    if (app.map) app.setConfig({ MODE: m, ...modesFor(app.map.hm)[m] });
  }
  /** An advanced setting changed by hand: custom mode. */
  function custom(patch: Partial<typeof cfg>): void {
    app.setConfig({ ...patch, MODE: "custom" });
  }
  // Solve ahead, after the frame is shown (even in custom mode: the next click is instant).
  $effect(() => {
    const hm = app.map?.hm, key = modeKey(cfg);
    if (!hm) return;
    const timer = setTimeout(() => untrack(() => modesFor(hm)), 0);
    void key;
    return () => clearTimeout(timer);
  });
  // A mode follows the map and the game resolution: its cached solution is applied when they change.
  $effect(() => {
    const m = mode, hm = app.map?.hm;
    void modeKey(cfg);
    if (!hm || m === "custom") return;
    untrack(() => {
      const patch = modesFor(hm)[m];
      if (Object.entries(patch).some(([k, v]) => cfg[k as keyof typeof cfg] !== v)) app.setConfig(patch);
    });
  });

  // ---- captures: shown while running, ortho started by itself once complete
  $effect(() => {
    void runs.live;
    void runs.runs;
    void lab.estimate;
    void lab.resIssue;
    void orthoJob.running;
    untrack(() => lab.follow());
  });

  // ---- ortho of the chosen capture (side panel)
  const job = $derived(orthoJob.running);
  const orthoRun = $derived(lab.run);
  const orthoResult = $derived<OrthoResult | undefined>(orthoRun ? orthoJob.results[orthoRun.id] : undefined);
  let labelDraft = $state("");
  $effect(() => {
    labelDraft = lab.run?.label ?? "";
  });
  function saveLabel(): void {
    const r = lab.run;
    if (r && labelDraft.trim() !== (r.label ?? "")) void runs.setLabel(r, labelDraft);
  }
  function resultText(r: OrthoResult): string {
    if (r.kind === "stopped") {
      const key = `ortho.err.${r.error}` as MessageKey;
      return t("tiles.stopped", { error: t(key) === key ? r.error : t(key) });
    }
    return t("tiles.done", {
      w: fmtNum(r.w), h: fmtNum(r.h), gsd: r.gsd.toFixed(3), duration: fmtClock(r.seconds), estimate: fmtClock(r.estimateSec),
    }) + (r.holes ? t("tiles.doneHoles", { holes: fmtNum(r.holes) }) : t("tiles.doneNoHole"));
  }
  let advanced = $state(false);
  const PANEL_W = { key: "hq.gridPanelW", min: 260, max: 620, fallback: 300 };
  let panelW = $state(loadWidth(PANEL_W.key, PANEL_W.fallback, PANEL_W.min, PANEL_W.max));
  /** Above this, the ortho size is highlighted (disk + computation time). */
  const ORTHO_BIG_BYTES = 500e6;
  const orthoBig = $derived(orthoBytes > ORTHO_BIG_BYTES);
  // Water glint expected when the sun is within the image's view cone (+10° margin).
  const glint = $derived(mo ? mo.sunZenith < mo.maxView + 10 : false);

  function issueText(i: WriteIssue): string {
    switch (i.kind) {
      case "fov":
        return t("grid.block.fov", { fov: i.fov, min: i.min, max: i.max });
      case "coverage":
        return t("grid.block.coverage", { dx: fmtNum(i.dx), dy: fmtNum(i.dy) }) +
          (i.minGrid ? t("grid.block.minGrid", { grid: `${i.minGrid.nY}×${i.minGrid.nX}` }) : "");
      case "segTooShort":
        return t("grid.block.segTooShort", { min: i.min });
      case "shotOutsideHold":
        return t("grid.block.shotOutsideHold", { min: i.min, max: i.max });
      case "negativeSettle":
        return t("grid.block.negativeSettle");
    }
  }

  function num(e: Event): number {
    return Number((e.target as HTMLInputElement).value);
  }

  /** A fit is due (new map) but the view has no size yet (hidden): done when it gets one. */
  let fitPending = false;
  function fit(): void {
    if (!mo || !cv) return;
    if (host.clientWidth < 20 || host.clientHeight < 20) {
      fitPending = true;
      return;
    }
    fitPending = false;
    const pad = 24;
    const w = host.clientWidth, h = host.clientHeight;
    // World Y spans the canvas width, world X its height; keep 15 % margin for outer tiles.
    const scale = Math.max(1e-5, Math.min(
      (w - 2 * pad) / (mo.bounds.height * 1.15),
      (h - 2 * pad) / (mo.bounds.width * 1.15),
    ));
    view = { scale, ox: -mo.mapCy * scale, oy: -mo.mapCx * scale };
    draw();
  }

  /** Altitude range of the map (every cell scanned: once per map, not at every drawing). */
  let range: ReturnType<typeof heightRange> | null = null, rangeFor: Heightmap | null = null;
  function draw(): void {
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = host.clientWidth, h = host.clientHeight;
    // Resized only when the panel changed (resizing reallocates the canvas at every drag step).
    const cw = Math.max(1, Math.floor(w * dpr)), ch = Math.max(1, Math.floor(h * dpr));
    if (cv.width !== cw || cv.height !== ch) {
      cv.width = cw;
      cv.height = ch;
    }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#12151b";
    ctx.fillRect(0, 0, w, h);
    if (!mo || !app.map) return;
    const S = (wx: number, wy: number) => worldToScreen(view, w, h, wx, wy);
    const b = mo.bounds;
    if (reliefFor !== app.map.hm) {
      relief = reliefCanvas(app.map.hm);
      reliefFor = app.map.hm;
    }
    const a = S(b.minX, b.minY), c = S(b.maxX, b.maxY);
    if (relief) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(relief, a.sx, a.sy, c.sx - a.sx, c.sy - a.sy);
    }
    ctx.strokeStyle = "#3d7a5a";
    ctx.lineWidth = 2;
    ctx.strokeRect(a.sx, a.sy, c.sx - a.sx, c.sy - a.sy);

    // Tile footprints at the reference ground height + capture order.
    const vX = mo.geo.viewX, vY = mo.geo.viewY;
    ctx.font = "10px system-ui, sans-serif";
    mo.centers.forEach((ct, k) => {
      const tl = S(ct.x - vX / 2, ct.y - vY / 2), br = S(ct.x + vX / 2, ct.y + vY / 2);
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = "#e05050";
      ctx.fillRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = "#e05050";
      ctx.lineWidth = 1;
      ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
      ctx.globalAlpha = 1;
      const p = S(ct.x, ct.y);
      ctx.fillStyle = "#f0a030";
      ctx.fillRect(p.sx - 2, p.sy - 2, 4, 4);
      ctx.fillText(String(k + 1), p.sx + 4, p.sy - 4);
    });

    // Seam lines coloured by their cover height (blue = low, red = high).
    if (rangeFor !== app.map.hm) {
      range = heightRange(app.map.hm);
      rangeFor = app.map.hm;
    }
    const { lo, hi } = range!;
    const col = (z: number) =>
      `hsl(${Math.round(240 * (1 - Math.max(0, Math.min(1, (z - lo) / Math.max(1e-6, hi - lo)))))}, 85%, 58%)`;
    ctx.lineWidth = 2;
    mo.seamZX.forEach((z, k) => {
      const xw = 0.5 * (mo.cx[k] + mo.cx[k + 1]);
      const s0 = S(xw, b.minY), s1 = S(xw, b.maxY);
      ctx.strokeStyle = col(z);
      ctx.beginPath(); ctx.moveTo(s0.sx, s0.sy); ctx.lineTo(s1.sx, s1.sy); ctx.stroke();
      ctx.fillStyle = col(z);
      ctx.fillText(`${z.toFixed(0)} m`, s1.sx + 4, s1.sy + 3);
    });
    mo.seamZY.forEach((z, k) => {
      const yw = 0.5 * (mo.cy[k] + mo.cy[k + 1]);
      const s0 = S(b.minX, yw), s1 = S(b.maxX, yw);
      ctx.strokeStyle = col(z);
      ctx.beginPath(); ctx.moveTo(s0.sx, s0.sy); ctx.lineTo(s1.sx, s1.sy); ctx.stroke();
      ctx.fillStyle = col(z);
      ctx.fillText(`${z.toFixed(0)} m`, s1.sx - 14, s1.sy + 12);
    });
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const r = host.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const w = host.clientWidth, h = host.clientHeight;
    const wpt = screenToWorld(view, w, h, mx, my);
    const s = Math.max(1e-5, Math.min(5, view.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    view = { scale: s, ox: mx - w / 2 - wpt.wy * s, oy: my - h / 2 - wpt.wx * s };
    draw();
  }

  let drag: { x: number; y: number; ox: number; oy: number } | null = null;
  function onDown(e: PointerEvent): void {
    drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy };
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function onMove(e: PointerEvent): void {
    if (!drag) return;
    view = { ...view, ox: drag.ox + e.clientX - drag.x, oy: drag.oy + e.clientY - drag.y };
    draw();
  }

  /** "Scanner": write the grid (cutscene + plan), then have the game start the scan right away. */
  async function scan(): Promise<void> {
    if (launching) return;
    launching = true;
    try {
      if (!(await writeToMod())) return;
      const r = await live.scan();
      if (r.ok) writeMsg = { ok: true, text: t("grid.scanStarted") };
      else if (r.error === "timeout") writeMsg = { ok: false, text: t("grid.scanNoGame") };
      else if (r.error === "busy") writeMsg = { ok: false, text: t("grid.scanBusy") };
      // A mod older than the app does not know the command: the save must be reloaded.
      else if (live.staleMod || r.error?.startsWith("unknown action")) writeMsg = { ok: false, text: t("grid.scanOldMod") };
      else if (r.error !== "superseded") writeMsg = { ok: false, text: t("grid.scanFailed", { error: r.error ?? "?" }) };
    } finally {
      launching = false;
    }
  }

  /** Writes the grid for the mod. @returns false when it could not (message shown). */
  async function writeToMod(): Promise<boolean> {
    writeMsg = null;
    const p = app.paths;
    // The player may have changed resolution since: detect again before writing the grid.
    if (autoRes) await detectResolution();
    if (!mo || !app.map || !p || blocker) return false;
    if (!(await fileExists(joinPath(p.modDir, "content", "hqminimap")))) {
      writeMsg = { ok: false, text: t("grid.modMissing", { dir: p.modDir }) };
      return false;
    }
    try {
      // Cutscene (mod) and plan (userdata) are always written together, with the same stamp.
      const files = modFiles(mo, app.map.hm, Date.now() / 1000);
      const dir = cutsceneDir(p);
      await ensureDir(dir);
      for (const f of await listFiles(dir, /^mosaic_run_p\d+\.lua$/)) await removeFile(f.path);
      for (const c of files.cutscenes) await writeText(joinPath(dir, c.name), c.text);
      await ensureDir(p.exportDir);
      await writeText(capturePlanPath(p), files.plan);
      await removeFile(legacyModPlanPath(p));
      await refreshModPlan();
      writeMsg = null;
      return true;
    } catch (err) {
      writeMsg = { ok: false, text: t("grid.writeFailed", { error: String(err) }) };
      return false;
    }
  }

  onMount(() => {
    void detectResolution();
    const ro = new ResizeObserver(() => (fitPending ? fit() : draw()));
    ro.observe(host);
    return () => ro.disconnect();
  });

  let fittedFor: unknown = null;
  $effect(() => {
    // Redraw on any change; fit the view the first time a map shows up.
    void mo;
    void lab.view;
    if (app.map && fittedFor !== app.map.hm) {
      fittedFor = app.map.hm;
      queueMicrotask(fit);
    } else {
      draw();
    }
  });

  const exportedLabel = $derived(
    app.map?.exportedAt ? fmtDate(app.map.exportedAt * 1000) : t("map.unknownDate"),
  );
  const hours = $derived(cfg.CAPTURE_TIME_SEC / 3600);
  const fmtHour = (sec: number) => `${Math.floor(sec / 3600)} h ${String(Math.round((sec % 3600) / 60)).padStart(2, "0")}`;
</script>

<div class="lab" style:grid-template-columns="{panelW}px 1fr">
  <aside class="panel">
    <PanelResizer bind:width={panelW} {...PANEL_W} />
    <div class="scroll">
      <div class="status">
        <!-- The detected map, then in small under it: when it was exported, the scan programmed. -->
        {#if app.map}
          <p><span class="ok">●</span> {t("grid.status.map", { w: fmtNum(app.map.bounds.width / 1000, 1), h: fmtNum(app.map.bounds.height / 1000, 1) })}</p>
          <p class="sub dim">{t("grid.status.exported", { date: exportedLabel })}</p>
        {:else if app.mapError}
          <p class="err">● {t(app.mapError)}</p>
        {:else}
          <p class="warn">● {t("grid.status.noExport")}</p>
        {/if}
        <!-- Last scan sent: settings changed since (orange), or captured (green); nothing otherwise. -->
        {#if modPlan && modPlanSame === false}
          <p class="sub warn" title={t("grid.status.planWritten", { date: fmtDate(modPlan.mtimeMs) })}>{t("grid.status.planDiffers")}</p>
        {:else if modPlan && lastCaptureStamp && lastCaptureStamp === modPlan.stamp}
          <p class="sub ok" title={t("grid.status.planWritten", { date: fmtDate(modPlan.mtimeMs) })}>{t("grid.status.captured", { grid: `${modPlan.nY}×${modPlan.nX}` })}</p>
        {/if}
      </div>

      <h3>{t("grid.resolution")} <span class="dim">{aspectName(cfg.screenW, cfg.screenH)}</span></h3>
      <div class="res">
        <select value={autoRes ? "auto" : customRes || !isPreset ? "custom" : resKey} onchange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v === "auto") { useAutoResolution(); return; }
          if (v === "custom") { customRes = true; app.setConfig({ SCREEN_AUTO: false }); return; }
          customRes = false;
          const [w, h] = v.split("x").map(Number);
          setResolution(w!, h!);
        }}>
          <option value="auto">{t("grid.resolutionAuto", { res: `${cfg.screenW} × ${cfg.screenH} (${aspectName(cfg.screenW, cfg.screenH)})` })}</option>
          {#each RESOLUTIONS as [w, h] (`${w}x${h}`)}<option value={`${w}x${h}`}>{w} × {h} ({aspectName(w, h)})</option>{/each}
          <option value="custom">{t("grid.resolutionOther")}</option>
        </select>
        <button onclick={detectResolution} disabled={detectState === "busy"} title={t("grid.resolutionDetectTitle")}>{t("grid.resolutionDetect")}</button>
      </div>
      {#if !autoRes && (customRes || !isPreset)}
        <div class="g2">
          <label>{t("grid.width")}<input type="number" min="320" max="16384" step="1" value={cfg.screenW}
            onchange={(e) => setResolution(num(e), cfg.screenH)} /></label>
          <label>{t("grid.height")}<input type="number" min="240" max="16384" step="1" value={cfg.screenH}
            onchange={(e) => setResolution(cfg.screenW, num(e))} /></label>
        </div>
      {/if}
      {#if detected && (detected.width !== cfg.screenW || detected.height !== cfg.screenH)}
        <!-- Chosen by hand and different from the game's screenshots: offer the detected one. -->
        <p class="warn">{t("grid.resolutionDetected", { w: detected.width, h: detected.height, a: aspectName(detected.width, detected.height) })}
          <button onclick={useAutoResolution}>{t("grid.resolutionUse")}</button></p>
      {:else if detected && autoRes && cfg.SCREEN_DETECTED && detectState === "idle" && fromMemory}
        <p class="dim">{t("grid.resolutionRemembered", { date: fmtDate(cfg.SCREEN_DETECTED.at) })}</p>
      {:else if detected && autoRes && fromGame}
        <p class="dim">{t("grid.resolutionFromGame")}</p>
      {:else if detected && autoRes}
        <p class="dim">{t("grid.resolutionAutoOk")}</p>
      {:else if detected}
        <p class="dim">{t("grid.resolutionOk")}</p>
      {:else if detectState === "none"}
        <p class="warn">{t("grid.resolutionNone")}</p>
      {/if}

      <h3>{t("grid.mode")}</h3>
      <div class="modes">
        {#each MODE_LIST as m (m)}
          <button class:on={mode === m} disabled={!app.map} title={t(`grid.mode.${m}.title`)} onclick={() => applyMode(m)}>{t(`grid.mode.${m}`)}</button>
        {/each}
      </div>
      {#if mode === "custom"}<p class="dim custom">{t("grid.mode.customShort")}</p>{/if}

      {#if mo}
        <table class="kv summary">
          <tbody>
            <tr><td>{t("grid.summary.session")}</td><td>
              {#if lab.run}<input class="name" type="text" placeholder={runLabel({ ...lab.run, label: undefined })} bind:value={labelDraft}
                onchange={saveLabel} onkeydown={(e) => e.key === "Enter" && saveLabel()} />{:else}<span class="dim">{t("grid.summary.noSession")}</span>{/if}</td></tr>
            <tr><td>{t("grid.r.images")}</td><td><b>{mo.centers.length}</b></td></tr>
            {#if orthoEst}
              <tr><td>{t("grid.summary.size")}</td><td class={orthoBig ? "big" : ""} title={orthoBig ? t("grid.r.orthoBigTitle") : undefined}>
                {orthoBig ? "⚠ " : ""}<b>{fmtBytes(orthoBytes)}</b></td></tr>
            {/if}
            <tr><td>{t("grid.summary.time")}</td><td><b>{fmtDuration(captureSec + orthoSec)}</b></td></tr>
          </tbody>
        </table>
      {/if}

      {#if mo}
        <details class="advanced">
          <summary>{t("grid.details")}</summary>
          <p class="dim modeinfo">{mode === "custom" ? t("grid.mode.custom") : t("grid.d.modeAuto", { mode: t(`grid.mode.${mode}.title`) })}</p>
          <table class="kv">
          <tbody>
            <tr><td>{t("grid.d.grid")}</td><td>{cfg.GRID_NY} × {cfg.GRID_NX}</td></tr>
            <tr><td>{t("grid.d.camera")}</td><td>{t("grid.d.cameraValue", { fov: fmtNum(cfg.FOV_V_DEG, 1), z: fmtNum(cfg.Z_EYE) })}</td></tr>
            <tr><td>{t("grid.d.sun")}</td><td>{t("grid.d.sunValue", { hour: fmtHour(cfg.CAPTURE_TIME_SEC), day: cfg.CAPTURE_DAY_OF_YEAR })}</td></tr>
            <tr><td>{t("grid.r.images")}</td><td><b>{mo.centers.length}</b> ({cfg.GRID_NY}×{cfg.GRID_NX})</td></tr>
            <tr><td>{t("grid.r.resolution")}</td><td><b>{orthoGsd.toFixed(2)}</b> m/px</td></tr>
            {#if orthoEst}
              <tr><td>{t("grid.r.ortho")}</td><td><b>{fmtNum(orthoEst.outW)} × {fmtNum(orthoEst.outH)}</b> px
                ({fmtNum(orthoEst.megapixels)} MP)</td></tr>
              <tr><td></td><td class={orthoBig ? "big" : "dim"} title={orthoBig ? t("grid.r.orthoBigTitle") : undefined}>
                {orthoBig ? "⚠ " : ""}{t("grid.r.orthoCost", {
                  size: fmtBytes(orthoBytes),
                  duration: fmtDuration(orthoSec),
                })}</td></tr>
            {/if}
            <tr><td>{t("grid.r.footprint")}</td><td>{fmtNum(mo.geo.viewY / 1000, 2)} × {fmtNum(mo.geo.viewX / 1000, 2)} km</td></tr>
            <tr><td>{t("grid.r.overlap")}</td><td>X {Math.min(...mo.overlapX, 100).toFixed(0)}–{Math.max(...mo.overlapX, 0).toFixed(0)} %
              · Y {Math.min(...mo.overlapY, 100).toFixed(0)}–{Math.max(...mo.overlapY, 0).toFixed(0)} %</td></tr>
            <tr><td>{t("grid.r.coverage")}</td>
              <td class={mo.covered ? "ok" : "err"}>{mo.covered ? t("grid.r.coverageOk") : t("grid.r.coverageKo")}</td></tr>
            <tr><td>{t("grid.r.sun")}</td><td class={glint ? "warn" : ""}>{t("grid.r.sunValue", {
              deg: mo.sunZenith.toFixed(0), glint: glint ? t("grid.r.glint") : t("grid.r.noGlint"),
            })}</td></tr>
          </tbody>
        </table>
        </details>
      {/if}

      <details class="advanced" bind:open={advanced}>
        <summary>{t("grid.advanced")}</summary>
        <h3>{t("grid.camera")}</h3>
        <div class="g2">
          <label>{t("grid.altitude")}
            <input type="number" min="500" max="50000" step="100" value={cfg.Z_EYE}
              onchange={(e) => custom({ Z_EYE: num(e) })} /></label>
          <label>{t("grid.fov")}
            <input type="number" min={FOV_V_DEG_MIN} max={FOV_V_DEG_MAX} step="0.5" value={cfg.FOV_V_DEG}
              onchange={(e) => custom({ FOV_V_DEG: num(e) })} /></label>
        </div>
        <input class="range" type="range" min={FOV_V_DEG_MIN} max={FOV_V_DEG_MAX} step="0.5" value={cfg.FOV_V_DEG}
          title={`FOV ${FOV_V_DEG_MIN}…${FOV_V_DEG_MAX}°`} oninput={(e) => custom({ FOV_V_DEG: num(e) })} />

        <h3>{t("grid.grid")} <span class="dim">{t("grid.gridHint", { m: cfg.COVER_MARGIN_M })}</span></h3>
        <div class="g3">
          <label>{t("grid.cols")}
            <input type="number" min="1" max="200" value={cfg.GRID_NY}
              onchange={(e) => custom({ GRID_NY: Math.max(1, Math.round(num(e))) })} /></label>
          <label>{t("grid.rows")}
            <input type="number" min="1" max="200" value={cfg.GRID_NX}
              onchange={(e) => custom({ GRID_NX: Math.max(1, Math.round(num(e))) })} /></label>
          <button class="min" class:suggest={!!mo && !atBest} disabled={!mo || atBest} title={t("grid.minTitle")}
            onclick={() => mo && custom({ GRID_NX: mo.bestGrid.nX, GRID_NY: mo.bestGrid.nY })}>
            {atBest ? "✓ " : ""}{t("grid.min")}{mo ? ` ${mo.bestGrid.nY}×${mo.bestGrid.nX}` : ""}</button>
        </div>

        <h3>{t("grid.lighting")}</h3>
        <div class="g2">
          <label>{t("grid.hour")}
            <input type="number" min="5" max="19" step="0.25" value={hours}
              onchange={(e) => custom({ CAPTURE_TIME_SEC: Math.round(num(e) * 3600) })} /></label>
          <label>{t("grid.day")}
            <input type="number" min="1" max="365" value={cfg.CAPTURE_DAY_OF_YEAR}
              onchange={(e) => custom({ CAPTURE_DAY_OF_YEAR: Math.round(num(e)) })} /></label>
        </div>

        <h3>{t("grid.orthoSettings")}</h3>
        <label>{t("tiles.interp")}
          <select value={lab.interp} disabled={!!job} onchange={(e) => lab.setOrtho({ interp: (e.target as HTMLSelectElement).value as Interp })}>
            {#each INTERPS as i (i)}
              <option value={i}>{t(`tiles.interp.${i}`)}{orthoEst ? ` — ${fmtDuration(orthoEst.megapixels * secPerMp(i))} · ${fmtBytes(orthoEst.tiles * bytesPerTile(i))}` : ""}{isMeasured(i) ? "" : " *"}</option>
            {/each}
          </select></label>
        <label class="check"><input type="checkbox" checked={lab.halfRes} disabled={!!job} onchange={(e) => lab.setOrtho({ halfRes: (e.target as HTMLInputElement).checked })} /> {t("tiles.halfRes")}</label>

      </details>
    </div>

    <div class="actions">
      {#if modPlan && modPlanSame && awaitingCapture}
        <div class="callout">
          <b>{t("grid.written", { grid: `${modPlan.nY}×${modPlan.nX}`, n: modPlan.nX * modPlan.nY })}</b>
          <span>{t("grid.next")}</span>
        </div>
      {:else if capturing}
        <div class="callout active"><b>{t("grid.capturing")}</b>
          <span>{t("grid.capturingCount", { shots: app.lastCapture?.shots ?? 0, expected: app.lastCapture?.expected ?? 0 })}</span></div>
      {/if}
      <button class="primary" disabled={!!blocker || !app.paths || launching} onclick={scan}>
        {launching ? t("grid.scanLaunching") : t("grid.write")}</button>
      {#if blocker && app.map}<p class="err">{blocker}</p>{/if}
      {#if writeMsg}<p class={writeMsg.ok ? "ok" : "err"}>{writeMsg.text}</p>{/if}

      {#if orthoRun && orthoRun.collected > 0}
        <div class="ortho">
          {#if job}
            <p class="warn">{t("tiles.computing", { label: job.label })}</p>
            <progress value={job.progress}></progress>
            <p class="clock">{t("tiles.clock", {
              elapsed: fmtClock(orthoJob.elapsed), remaining: fmtClock(orthoJob.remaining),
              total: fmtClock(orthoJob.elapsed + orthoJob.remaining),
            })}</p>
            <button onclick={() => orthoJob.cancel()}>{t("tiles.cancel")}</button>
          {:else}
            {#if !orthoRun.finished}
              <p class="dim">{t("grid.auto.after")}</p>
            {:else if lab.canRetry}
              <button class="link" onclick={() => lab.startOrtho()}>{t(orthoResult ? "grid.auto.retry" : "grid.auto.manual", { name: runLabel(orthoRun) })}</button>
            {/if}
            {#if lab.resIssue}
              <p class="err">{t("tiles.resolutionMismatch", { w: lab.resIssue.w, h: lab.resIssue.h, a: aspectName(lab.resIssue.w, lab.resIssue.h),
                pw: lab.resIssue.pw, ph: lab.resIssue.ph, pa: aspectName(lab.resIssue.pw, lab.resIssue.ph) })}</p>
            {/if}
            {#if orthoRun.collected < orthoRun.expected}
              <p class="warn">{t("tiles.incomplete", { collected: orthoRun.collected, expected: orthoRun.expected })}</p>
            {/if}
          {/if}
          {#if orthoResult}<p class={orthoResult.ok ? "ok" : "warn"}>{resultText(orthoResult)}</p>{/if}
          {#if orthoRun.hasOrtho && (orthoRun.orthoVersion ?? 1) < PYRAMID_VERSION}<p class="warn">{t("tiles.oldOrtho")}</p>{/if}
          {#if orthoRun.hasOrtho && onShowViewer && !job}
            <button onclick={() => onShowViewer?.(orthoRun!.id)}>{t("tiles.showViewer")}</button>
          {/if}
        </div>
      {/if}
    </div>
  </aside>

  <div class="main">
    <div class="view" class:hidden={lab.view !== "grid"} bind:this={host} onwheel={onWheel} onpointerdown={onDown} onpointermove={onMove}
      onpointerup={() => (drag = null)} ondblclick={fit} role="presentation">
      <canvas bind:this={cv}></canvas>
      <span class="hint">{t("grid.hint")}</span>
    </div>
    <!-- Kept mounted: the previews survive switching views. -->
    <div class="tilesview" class:hidden={lab.view !== "tiles"}><CaptureTiles /></div>
    <div class="switch">
      <button class:on={lab.view === "grid"} onclick={() => (lab.view = "grid")}>▦ {t("grid.view.grid")}</button>
      <button class:on={lab.view === "tiles"} onclick={() => (lab.view = "tiles")}>🖼 {t("grid.view.tiles")}</button>
    </div>
  </div>
</div>

<style>
  .lab { display: grid; grid-template-columns: 300px 1fr; height: 100%; min-height: 0; }
  .panel { position: relative; display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); font-size: 12.5px; }
  .scroll { flex: 1; overflow: auto; padding: 8px 12px 4px; }
  .status { display: flex; flex-direction: column; gap: 2px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
  /* Details of the status lines, in small under them (aligned with their text, after the dot). */
  .status .sub { font-size: 11px; padding-left: 14px; }
  h3 { margin: 9px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 600; }
  h3 .dim { text-transform: none; letter-spacing: 0; font-weight: 400; }
  label { display: flex; flex-direction: column; gap: 2px; font-size: 11.5px; color: var(--muted); min-width: 0; }
  .res { display: flex; gap: 6px; margin-bottom: 6px; }
  .res select { flex: 1; min-width: 0; }
  .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .g3 { display: grid; grid-template-columns: 1fr 1fr auto; gap: 6px; align-items: end; }
  input[type="number"] { width: 100%; padding: 3px 6px; color: var(--text); }
  .range { width: 100%; margin: 4px 0 0; }
  .min { padding: 4px 8px; font-size: 12px; white-space: nowrap; }
  .min.suggest { border-color: var(--accent); color: #fff; }
  .big { color: var(--warn); font-weight: 600; }
  .kv { width: 100%; border-collapse: collapse; }
  .kv td { padding: 1px 0; vertical-align: top; }
  .kv td:first-child { color: var(--muted); width: 92px; }
  p { margin: 2px 0; }
  .actions { padding: 8px 12px 10px; border-top: 1px solid var(--line); background: var(--panel); }
  .actions p { font-size: 12px; margin-top: 5px; }
  .callout { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; padding: 8px 10px; border-radius: 6px;
    border: 1px solid var(--ok); background: rgba(76, 175, 125, .14); font-size: 12.5px; }
  .callout b { color: #fff; }
  .callout.active { border-color: var(--warn); background: rgba(224, 160, 48, .12); }
  .main { position: relative; min-width: 0; min-height: 0; }
  .view, .tilesview { position: absolute; inset: 0; }
  .view { overflow: hidden; cursor: grab; }
  .hidden { display: none; }
  .switch { position: absolute; z-index: 3; top: 10px; right: 12px; display: inline-flex; border: 1px solid var(--line);
    border-radius: 8px; overflow: hidden; background: rgba(20, 23, 30, .9); }
  .switch button { border: none; border-radius: 0; padding: 4px 11px; font-size: 12.5px; background: none; opacity: .65; }
  .switch button.on { background: rgba(255, 255, 255, .12); opacity: 1; }
  .modes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
  .modes button { padding: 5px 4px; font-size: 12px; }
  .modes button.on { border-color: var(--accent); background: rgba(59, 130, 196, .22); color: #fff; }
  .custom { font-size: 11.5px; margin-top: 4px; }
  .modeinfo { font-size: 11.5px; margin: 4px 0; }
  .summary { margin-top: 8px; }
  .summary td:first-child { width: 78px; }
  .summary .name { width: 100%; padding: 2px 5px; font-size: 12px; }
  .advanced { margin-top: 8px; border-top: 1px solid var(--line); padding-top: 6px; }
  .advanced summary { cursor: pointer; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 600; }
  label.check { flex-direction: row; align-items: center; gap: 6px; margin-top: 4px; }
  .ortho { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
  .ortho progress { width: 100%; }
  .link { background: none; border: none; padding: 0; color: var(--accent); cursor: pointer; font-size: 12px; text-align: left; }
  .clock { font-variant-numeric: tabular-nums; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .hint { position: absolute; right: 10px; bottom: 8px; font-size: 11px; color: var(--muted); pointer-events: none; }
</style>
