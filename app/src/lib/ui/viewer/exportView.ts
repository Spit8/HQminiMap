/**
 * PNG export of the current Visualiser view (ortho + visible live layers), standard OpenLayers
 * method: compose the layer canvases at `rendercomplete`. Scale ×2 / ×4 renders the same view on a
 * larger canvas (finer tiles, crisp labels), then restores the map.
 */
import type OlMap from "ol/Map";
import View from "ol/View";

export interface LegendItem {
  label: string;
  color: string;
}

export interface ExportOptions {
  scale: 1 | 2 | 4;
  /** Legend lines (title first) drawn bottom-left; null = no legend. */
  legend: { title: string; items: LegendItem[]; footer: string } | null;
  background: string;
}

function compose(map: OlMap, w: number, h: number, background: string): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  const canvases = Array.from(map.getViewport()?.querySelectorAll<HTMLCanvasElement>(".ol-layer canvas, canvas.ol-layer") ?? []);
  for (const c of canvases) {
    if (!c.width) continue;
    const parent = c.parentNode as HTMLElement;
    const opacity = parent.style.opacity || c.style.opacity;
    ctx.globalAlpha = opacity === "" ? 1 : Number(opacity);
    const m = c.style.transform.match(/^matrix\(([^(]*)\)$/)?.[1]?.split(",").map(Number);
    const [a, b, cc, d, e, f] = m && m.length === 6 ? m : [1, 0, 0, 1, 0, 0];
    ctx.setTransform(a!, b!, cc!, d!, e!, f!);
    ctx.drawImage(c, 0, 0);
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return out;
}

function drawLegend(canvas: HTMLCanvasElement, s: number, legend: NonNullable<ExportOptions["legend"]>): void {
  const ctx = canvas.getContext("2d")!;
  const pad = 10 * s, line = 18 * s, sw = 10 * s;
  ctx.font = `${12 * s}px system-ui, sans-serif`;
  const rows = [legend.title, ...legend.items.map((i) => i.label), legend.footer];
  const w = Math.max(...rows.map((r) => ctx.measureText(r).width)) + pad * 2 + sw + 6 * s;
  const h = rows.length * line + pad * 2 - 4 * s;
  const x0 = pad, y0 = canvas.height - h - pad;
  ctx.fillStyle = "rgba(20,23,30,.82)";
  ctx.fillRect(x0, y0, w, h);
  ctx.textBaseline = "middle";
  let y = y0 + pad + line / 2 - 2 * s;
  ctx.fillStyle = "#fff";
  ctx.font = `600 ${13 * s}px system-ui, sans-serif`;
  ctx.fillText(legend.title, x0 + pad, y);
  ctx.font = `${12 * s}px system-ui, sans-serif`;
  for (const it of legend.items) {
    y += line;
    ctx.fillStyle = it.color;
    ctx.fillRect(x0 + pad, y - sw / 2, sw, sw);
    ctx.fillStyle = "#e8ecf2";
    ctx.fillText(it.label, x0 + pad + sw + 6 * s, y);
  }
  y += line;
  ctx.fillStyle = "#9aa3ad";
  ctx.fillText(legend.footer, x0 + pad, y);
}

const waitRender = (map: OlMap) =>
  new Promise<void>((resolve) => {
    map.once("rendercomplete", () => resolve());
    map.render();
  });

/** Render the current view to PNG bytes. */
export async function exportViewPng(map: OlMap, opts: ExportOptions): Promise<Uint8Array> {
  const size = map.getSize();
  const view = map.getView();
  const res = view.getResolution();
  if (!size || !res) throw new Error("map not ready");
  const s = opts.scale;
  const [w, h] = [Math.round(size[0] * s), Math.round(size[1] * s)];
  let canvas: HTMLCanvasElement;
  if (s === 1) {
    await waitRender(map);
    canvas = compose(map, w, h, opts.background);
  } else {
    // Same centre / rotation on a larger canvas; a plain view so the resolution is not snapped.
    const tmp = new View({
      projection: view.getProjection(), center: view.getCenter(), rotation: view.getRotation(), resolution: res / s,
    });
    map.setView(tmp);
    map.setSize([w, h]);
    try {
      await waitRender(map);
      canvas = compose(map, w, h, opts.background);
    } finally {
      map.setView(view);
      map.updateSize();
    }
  }
  if (opts.legend) drawLegend(canvas, s, opts.legend);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("png");
  return new Uint8Array(await blob.arrayBuffer());
}
