/**
 * Relief layers of the Visualiser, above the ortho and under every other object, not clickable:
 * colours by altitude (an image of the heightmap) and / or thin contour lines.
 * The contours are drawn as an image (VectorImageLayer): redrawn when the view moves, not on every
 * frame of the vehicle animation; their altitudes are a separate, small decluttered layer.
 */
import Feature from "ol/Feature";
import MultiLineString from "ol/geom/MultiLineString";
import ImageLayer from "ol/layer/Image";
import VectorLayer from "ol/layer/Vector";
import VectorImageLayer from "ol/layer/VectorImage";
import ImageStatic from "ol/source/ImageStatic";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style, Text } from "ol/style";
import type BaseLayer from "ol/layer/Base";
import type { FeatureLike } from "ol/Feature";
import { contourLines, contourStep } from "$lib/core/contours";
import type { Relief } from "$lib/core/filters";
import type { Heightmap } from "$lib/core/lua";
import { reliefPixels, reliefRange, reliefTicks } from "$lib/core/relief";
import { toMap, type Frame } from "./layers";

/** Ordinary contours fade out above this resolution (m/px): the whole map would turn grey. */
const MINOR_RES = 40;
/** Altitude labels closer than this (m/px). */
const LABEL_RES = 15;

/** Styles of the ordinary and index contours at a width factor (cached). */
const styles = new Map<number, { minor: Style[]; major: Style[] }>();
function stylesFor(w: number): { minor: Style[]; major: Style[] } {
  let s = styles.get(w);
  if (!s) {
    s = {
      minor: [new Style({ stroke: new Stroke({ color: "rgba(255,255,255,.22)", width: 0.7 * w }) })],
      major: [
        new Style({ stroke: new Stroke({ color: "rgba(10,12,16,.25)", width: 2.4 * w }) }),
        new Style({ stroke: new Stroke({ color: "rgba(255,255,255,.45)", width: 1.2 * w }) }),
      ],
    };
    styles.set(w, s);
    if (styles.size > 200) styles.delete(styles.keys().next().value!); // bounded: oldest out
  }
  return s;
}

export interface ReliefInfo {
  /** Contour interval drawn (m), null when no contours. */
  step: number | null;
  /** Altitudes at 0, 1/4, 1/2, 3/4 and 1 of the colour ramp (scale and balance applied), null without colours. */
  ticks: number[] | null;
}

export interface ReliefLayers {
  layers: BaseLayer[];
  /** Redraw for this heightmap and settings; returns the contour interval and the legend altitudes. */
  update(frame: Frame | null, hm: Heightmap | null, r: Relief): ReliefInfo;
}

export function createReliefLayers(): ReliefLayers {
  let width = 1;
  const lines = new VectorSource();
  const labels = new VectorSource();
  const lineLayer = new VectorImageLayer({
    source: lines, zIndex: 4, imageRatio: 1.5, properties: { relief: true },
    style: (f: FeatureLike, res: number) => {
      const { minor, major } = stylesFor(width);
      return f.get("major") ? major : res < MINOR_RES ? minor : [];
    },
  });
  const labelLayer = new VectorLayer({
    source: labels, zIndex: 4.1, declutter: true, properties: { relief: true },
    style: (f: FeatureLike, res: number) => (res < LABEL_RES ? new Style({
      text: new Text({
        text: `${f.get("z")} m`, placement: "line", font: "600 10px system-ui, sans-serif", repeat: 600,
        fill: new Fill({ color: "rgba(255,255,255,.8)" }), stroke: new Stroke({ color: "rgba(10,12,16,.7)", width: 2.5 }),
      }),
    }) : undefined),
  });
  const colorLayer = new ImageLayer({ zIndex: 3.5, properties: { relief: true } });

  /** Last drawn inputs, to skip identical redraws (the filters change often). */
  let drawnLines: { hm: Heightmap; step: number; frame: Frame } | null = null;
  let drawnColors: { hm: Heightmap; key: string; frame: Frame } | null = null;
  let labelsFor: { hm: Heightmap; step: number; frame: Frame } | null = null;
  const same = (a: Frame, b: Frame) => a.minX === b.minX && a.minY === b.minY;

  function drawColors(frame: Frame, hm: Heightmap, r: Relief): void {
    const key = [...r.stops.map((s) => `${s.color}:${s.alpha}`), r.scale, r.balance].join("|");
    if (drawnColors && drawnColors.hm === hm && drawnColors.key === key && same(drawnColors.frame, frame)) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = hm.n;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(new ImageData(reliefPixels(hm, r.stops, r.scale, r.balance) as Uint8ClampedArray<ArrayBuffer>, hm.n, hm.n), 0, 0);
    // Rows = world X downwards, columns = world Y (reliefPixels), placed with toMap.
    const [x0, y0] = toMap(frame, hm.minX, hm.minY), [x1, y1] = toMap(frame, hm.minX + hm.width, hm.minY + hm.height);
    colorLayer.setSource(new ImageStatic({
      url: canvas.toDataURL(), imageExtent: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)],
    }));
    drawnColors = { hm, key, frame };
  }

  return {
    layers: [colorLayer, lineLayer, labelLayer],
    update(frame, hm, r) {
      const colors = r.show && r.mode !== "lines", showLines = r.show && r.mode !== "colors";
      colorLayer.setVisible(colors);
      colorLayer.setOpacity(Math.min(1, Math.max(0.1, r.opacity)));
      lineLayer.setVisible(showLines);
      labelLayer.setVisible(showLines && r.labels);
      if (!frame || !hm) {
        lines.clear();
        labels.clear();
        colorLayer.setSource(null);
        drawnLines = drawnColors = labelsFor = null;
        return { step: null, ticks: null };
      }
      const range = reliefRange(hm);
      const step = r.step > 0 ? r.step : contourStep(range.min, range.max);
      if (colors) drawColors(frame, hm, r);
      if (showLines && !(drawnLines && drawnLines.hm === hm && drawnLines.step === step && same(drawnLines.frame, frame))) {
        const m = (x: number, y: number) => toMap(frame, x, y);
        lines.clear();
        lines.addFeatures(contourLines(hm, step).map((l) => new Feature({
          geometry: new MultiLineString(l.lines.map((line) => line.map(([x, y]) => m(x, y)))), z: Math.round(l.z), major: l.major,
        })));
        drawnLines = { hm, step, frame };
      }
      // Altitude labels: only the index contours, only when asked.
      if (showLines && r.labels && labelsFor !== drawnLines) {
        labels.clear();
        labels.addFeatures(lines.getFeatures().filter((f) => f.get("major")).map((f) => new Feature({ geometry: f.getGeometry(), z: f.get("z") })));
        labelsFor = drawnLines;
      }
      const w = Math.min(3, Math.max(0.5, r.width || 1));
      if (w !== width) {
        width = w;
        lineLayer.changed();
      }
      return { step: showLines ? step : null, ticks: colors ? reliefTicks(hm, r.scale, r.balance) : null };
    },
  };
}
