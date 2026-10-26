/**
 * Plain map background of the Visualiser (basemap off, or no ortho): the water in light blue with
 * its shores outlined, and a continuous outline of the map, over a black background.
 */
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import MultiLineString from "ol/geom/MultiLineString";
import ImageLayer from "ol/layer/Image";
import VectorLayer from "ol/layer/Vector";
import ImageStatic from "ol/source/ImageStatic";
import VectorSource from "ol/source/Vector";
import { Stroke, Style } from "ol/style";
import type BaseLayer from "ol/layer/Base";
import { shorelines, waterMask } from "$lib/core/contours";
import type { Heightmap } from "$lib/core/lua";
import { toMap, type Frame } from "./layers";

export const WATER_COLOR = "#3fa7e0";
const shoreStyle = new Style({ stroke: new Stroke({ color: WATER_COLOR, width: 1.5 }) });
const borderStyle = new Style({ stroke: new Stroke({ color: "rgba(255,255,255,.85)", width: 1.5 }) });

export interface PlainBasemap {
  layers: BaseLayer[];
  /** `industries`: their positions (small water patches next to them are pits, not water). */
  update(frame: Frame | null, hm: Heightmap | null, show: boolean, industries: readonly { x: number; y: number }[]): void;
}

export function createPlainBasemap(): PlainBasemap {
  const lines = new VectorSource();
  const water = new ImageLayer({ zIndex: 3.2, opacity: 0.28, properties: { basemap: true } });
  const outline = new VectorLayer({
    source: lines, zIndex: 4.5, properties: { basemap: true },
    style: (f) => (f.get("kind") === "border" ? borderStyle : shoreStyle),
  });
  let drawnFor: { hm: Heightmap; frame: Frame; ind: string } | null = null;

  return {
    layers: [water, outline],
    update(frame, hm, show, industries) {
      water.setVisible(show);
      outline.setVisible(show);
      if (!show || !frame || !hm) return;
      // Industries only matter by where they are (positions rounded: their stocks change all the time).
      const ind = industries.map((p) => `${Math.round(p.x / 50)},${Math.round(p.y / 50)}`).sort().join(";");
      if (drawnFor?.hm === hm && drawnFor.ind === ind && drawnFor.frame.minX === frame.minX && drawnFor.frame.minY === frame.minY) return;
      drawnFor = { hm, frame, ind };
      const opts = { industries };
      const m = (x: number, y: number) => toMap(frame, x, y);
      const x0 = hm.minX, y0 = hm.minY, x1 = hm.minX + hm.width, y1 = hm.minY + hm.height;
      lines.clear();
      lines.addFeatures([
        new Feature({ geometry: new MultiLineString(shorelines(hm, opts).map((l) => l.map(([x, y]) => m(x, y)))), kind: "shore" }),
        new Feature({ geometry: new LineString([m(x0, y0), m(x0, y1), m(x1, y1), m(x1, y0), m(x0, y0)]), kind: "border" }),
      ]);
      // Water cells as an image (rows = world X, columns = world Y, as waterMask), placed with toMap.
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = hm.n;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const mask = waterMask(hm, opts), img = ctx.createImageData(hm.n, hm.n);
      for (let k = 0; k < mask.length; k++) {
        if (!mask[k]) continue;
        img.data[4 * k] = 63; img.data[4 * k + 1] = 167; img.data[4 * k + 2] = 224; img.data[4 * k + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const [ax, ay] = m(x0, y0), [bx, by] = m(x1, y1);
      water.setSource(new ImageStatic({
        url: canvas.toDataURL(), imageExtent: [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)],
      }));
    },
  };
}
