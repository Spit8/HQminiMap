<script lang="ts">
  import { onMount } from "svelte";
  import { computeMosaic, FOV_V_DEG_MAX, FOV_V_DEG_MIN, type Mosaic } from "$lib/core/geometry";
  import { modFiles, planSignature, writeIssue, type WriteIssue } from "$lib/core/modwriter";
  import { estimateOrtho } from "$lib/core/pyramid";
  import { fmtDate, fmtNum, t } from "$lib/i18n/index.svelte";
  import { OVERVIEW_MAX_SIDE } from "$lib/state/orthoExport";
  import { bytesPerTile, fmtBytes, fmtDuration, secPerMp } from "$lib/state/orthoSpeed";
  import { ensureDir, fileExists, joinPath, listFiles, removeFile, writeText } from "$lib/platform/fsx";
  import { capturePlanPath, cutsceneDir, legacyModPlanPath } from "$lib/platform/paths";
  import { app } from "$lib/state/app.svelte";
  import { heightRange, reliefCanvas, screenToWorld, worldToScreen, type ViewState } from "./mapview";

  let host: HTMLDivElement;
  let cv: HTMLCanvasElement;
  let view: ViewState = { scale: 0.05, ox: 0, oy: 0 };
  let relief: HTMLCanvasElement | null = null;
  let reliefFor: unknown = null;
  let writeMsg = $state<{ ok: boolean; text: string } | null>(null);
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
  const mo = $derived.by<Mosaic | null>(() => {
    if (!app.map) return null;
    try {
      return computeMosaic(cfg, app.map.hm);
    } catch {
      return null;
    }
  });
  const issue = $derived<WriteIssue | null>(mo ? writeIssue(mo) : null);
  const blocker = $derived(!mo ? t("grid.block.noMap") : issue ? issueText(issue) : null);
  /** The current grid is already the smallest one covering the map. */
  const atBest = $derived(!!mo && mo.bestGrid.nX === cfg.GRID_NX && mo.bestGrid.nY === cfg.GRID_NY);

  /** Ortho TileLab will produce from this capture (full resolution, Lanczos defaults). */
  const orthoEst = $derived(
    mo && app.map ? estimateOrtho(app.map.hm.width, app.map.hm.height, mo.geo.gsdX, OVERVIEW_MAX_SIDE) : null,
  );
  const orthoBytes = $derived(orthoEst ? orthoEst.tiles * bytesPerTile("lanczos3") : 0);
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

  function fit(): void {
    if (!mo || !cv) return;
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

  function draw(): void {
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = host.clientWidth, h = host.clientHeight;
    cv.width = Math.max(1, Math.floor(w * dpr));
    cv.height = Math.max(1, Math.floor(h * dpr));
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
    const { lo, hi } = heightRange(app.map.hm);
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

  async function writeToMod(): Promise<void> {
    writeMsg = null;
    const p = app.paths;
    if (!mo || !app.map || !p || blocker) return;
    if (!(await fileExists(joinPath(p.modDir, "content", "hqminimap")))) {
      writeMsg = { ok: false, text: t("grid.modMissing", { dir: p.modDir }) };
      return;
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
    } catch (err) {
      writeMsg = { ok: false, text: t("grid.writeFailed", { error: String(err) }) };
    }
  }

  onMount(() => {
    const ro = new ResizeObserver(() => draw());
    ro.observe(host);
    return () => ro.disconnect();
  });

  let fittedFor: unknown = null;
  $effect(() => {
    // Redraw on any change; fit the view the first time a map shows up.
    void mo;
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
</script>

<div class="lab">
  <aside class="panel">
    <div class="scroll">
      <div class="status">
        {#if app.map}
          <p><span class="ok">●</span> {t("grid.status.map", {
            w: fmtNum(app.map.bounds.width / 1000, 1), h: fmtNum(app.map.bounds.height / 1000, 1), date: exportedLabel,
          })}</p>
        {:else if app.mapError}
          <p class="err">● {t(app.mapError)}</p>
        {:else}
          <p class="warn">● {t("grid.status.noExport")}</p>
        {/if}
        {#if modPlan === null}
          <p class="dim">● {t("grid.status.noPlan")}</p>
        {:else if modPlan}
          <p title={t("grid.status.planWritten", { date: fmtDate(modPlan.mtimeMs) })}>
            <span class={modPlanSame ? "ok" : "warn"}>●</span> {t("grid.status.plan", { grid: `${modPlan.nY}×${modPlan.nX}` })}
            {#if modPlanSame === false}<span class="warn">{t("grid.status.planDiffers")}</span>{/if}
            {#if lastCaptureStamp && lastCaptureStamp === modPlan.stamp}<span class="dim">{t("grid.status.captured")}</span>{/if}
          </p>
        {/if}
      </div>

      <h3>{t("grid.camera")}</h3>
      <div class="g2">
        <label>{t("grid.altitude")}
          <input type="number" min="500" max="50000" step="100" value={cfg.Z_EYE}
            onchange={(e) => app.setConfig({ Z_EYE: num(e) })} /></label>
        <label>{t("grid.fov")}
          <input type="number" min={FOV_V_DEG_MIN} max={FOV_V_DEG_MAX} step="0.5" value={cfg.FOV_V_DEG}
            onchange={(e) => app.setConfig({ FOV_V_DEG: num(e) })} /></label>
      </div>
      <input class="range" type="range" min={FOV_V_DEG_MIN} max={FOV_V_DEG_MAX} step="0.5" value={cfg.FOV_V_DEG}
        title={`FOV ${FOV_V_DEG_MIN}…${FOV_V_DEG_MAX}°`} oninput={(e) => app.setConfig({ FOV_V_DEG: num(e) })} />

      <h3>{t("grid.grid")} <span class="dim">{t("grid.gridHint", { m: cfg.COVER_MARGIN_M })}</span></h3>
      <div class="g3">
        <label>{t("grid.cols")}
          <input type="number" min="1" max="200" value={cfg.GRID_NY}
            onchange={(e) => app.setConfig({ GRID_NY: Math.max(1, Math.round(num(e))) })} /></label>
        <label>{t("grid.rows")}
          <input type="number" min="1" max="200" value={cfg.GRID_NX}
            onchange={(e) => app.setConfig({ GRID_NX: Math.max(1, Math.round(num(e))) })} /></label>
        <button class="min" class:suggest={!!mo && !atBest} disabled={!mo || atBest} title={t("grid.minTitle")}
          onclick={() => mo && app.setConfig({ GRID_NX: mo.bestGrid.nX, GRID_NY: mo.bestGrid.nY })}>
          {atBest ? "✓ " : ""}{t("grid.min")}{mo ? ` ${mo.bestGrid.nY}×${mo.bestGrid.nX}` : ""}</button>
      </div>

      <h3>{t("grid.lighting")}</h3>
      <div class="g2">
        <label>{t("grid.hour")}
          <input type="number" min="5" max="19" step="0.25" value={hours}
            onchange={(e) => app.setConfig({ CAPTURE_TIME_SEC: Math.round(num(e) * 3600) })} /></label>
        <label>{t("grid.day")}
          <input type="number" min="1" max="365" value={cfg.CAPTURE_DAY_OF_YEAR}
            onchange={(e) => app.setConfig({ CAPTURE_DAY_OF_YEAR: Math.round(num(e)) })} /></label>
      </div>

      {#if mo}
        <h3>{t("grid.result")}</h3>
        <table class="kv">
          <tbody>
            <tr><td>{t("grid.r.images")}</td><td><b>{mo.centers.length}</b> ({cfg.GRID_NY}×{cfg.GRID_NX})</td></tr>
            <tr><td>{t("grid.r.resolution")}</td><td><b>{mo.geo.gsdX.toFixed(3)}</b> m/px</td></tr>
            {#if orthoEst}
              <tr><td>{t("grid.r.ortho")}</td><td><b>{fmtNum(orthoEst.outW)} × {fmtNum(orthoEst.outH)}</b> px
                ({fmtNum(orthoEst.megapixels)} MP)</td></tr>
              <tr><td></td><td class={orthoBig ? "big" : "dim"} title={orthoBig ? t("grid.r.orthoBigTitle") : undefined}>
                {orthoBig ? "⚠ " : ""}{t("grid.r.orthoCost", {
                  size: fmtBytes(orthoBytes),
                  duration: fmtDuration(orthoEst.megapixels * secPerMp("lanczos3")),
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
      {/if}
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
      <button class="primary" disabled={!!blocker || !app.paths} onclick={writeToMod}>
        {modPlan && modPlanSame ? t("grid.rewrite") : t("grid.write")}</button>
      {#if blocker && app.map}<p class="err">{blocker}</p>{/if}
      {#if writeMsg}<p class={writeMsg.ok ? "ok" : "err"}>{writeMsg.text}</p>{/if}
    </div>
  </aside>

  <div class="view" bind:this={host} onwheel={onWheel} onpointerdown={onDown} onpointermove={onMove}
    onpointerup={() => (drag = null)} ondblclick={fit} role="presentation">
    <canvas bind:this={cv}></canvas>
    <span class="hint">{t("grid.hint")}</span>
  </div>
</div>

<style>
  .lab { display: grid; grid-template-columns: 300px 1fr; height: 100%; min-height: 0; }
  .panel { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); font-size: 12.5px; }
  .scroll { flex: 1; overflow: auto; padding: 8px 12px 4px; }
  .status { display: flex; flex-direction: column; gap: 2px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
  h3 { margin: 9px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 600; }
  h3 .dim { text-transform: none; letter-spacing: 0; font-weight: 400; }
  label { display: flex; flex-direction: column; gap: 2px; font-size: 11.5px; color: var(--muted); min-width: 0; }
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
  .view { position: relative; overflow: hidden; cursor: grab; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .hint { position: absolute; right: 10px; bottom: 8px; font-size: 11px; color: var(--muted); pointer-events: none; }
</style>
