import { describe, expect, it } from "vitest";
import { seqOf } from "../src/lib/core/geometry";
import type { Heightmap, PlanInfo } from "../src/lib/core/lua";
import { INTERPS, OrthoRenderer, type RgbaImage } from "../src/lib/core/ortho";
import { estimateOrtho, pyramidInfo, pyramidWriter } from "../src/lib/core/pyramid";

/** Smooth ground texture: the ortho must reproduce it wherever tiles see the ground. */
const tex = (X: number, Y: number) => [
  128 + 90 * Math.sin(X / 37),
  128 + 90 * Math.cos(Y / 53),
  128 + 60 * Math.sin((X + Y) / 71),
];

/** `scale`: captures taken at scale × the plan's screen size (same field of view). */
function synthetic(zGround: (X: number, Y: number) => number, scale = 1) {
  const W = 160, H = 120, zEye = 1000, fovV = 30;
  const fy = H / 2 / Math.tan((fovV * Math.PI) / 360), fx = fy;
  const nX = 3, nY = 2;
  // Centre lattice (index 0 = largest coordinate), footprints overlapping ~20 %.
  const viewX = (2 * zEye * H) / 2 / fy, viewY = (2 * zEye * W) / 2 / fx;
  const xs = [0.8 * viewX, 0, -0.8 * viewX], ys = [0.4 * viewY, -0.4 * viewY];
  const centers: { x: number; y: number }[] = [];
  for (let iy = 0; iy < nY; iy++) for (let ix = 0; ix < nX; ix++) centers.push({ x: xs[ix], y: ys[iy] });
  const plan: PlanInfo = { nX, nY, zEye, fovV, pixelAspect: 1, screenW: W, screenH: H, gsdX: viewX / H, gsdY: viewY / W, centers };
  // Map = union of footprints shrunk by 10 % (inside coverage).
  const n = 32, minX = -0.8 * viewX - 0.4 * viewX, minY = -0.4 * viewY - 0.4 * viewY;
  const width = 2 * (0.8 * viewX + 0.4 * viewX), height = 2 * (0.4 * viewY + 0.4 * viewY);
  const data = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    data[j * n + i] = zGround(minX + ((i + 0.5) * width) / n, minY + ((j + 0.5) * height) / n);
  }
  const hm: Heightmap = { n, minX, minY, width, height, cellX: width / n, cellY: height / n, data, source: "heightmap", waterLevel: null };
  // Tiles rendered by the forward camera model (flat-ish ground: solve d iteratively).
  const tiles = new Map<number, RgbaImage>();
  const TW = Math.round(W * scale), TH = Math.round(H * scale), tfx = fx * scale, tfy = fy * scale;
  for (let iy = 0; iy < nY; iy++) for (let ix = 0; ix < nX; ix++) {
    const img = { width: TW, height: TH, data: new Uint8ClampedArray(TW * TH * 4) };
    for (let v = 0; v < TH; v++) for (let u = 0; u < TW; u++) {
      let d = zEye, X = 0, Y = 0;
      for (let it = 0; it < 6; it++) {
        X = xs[ix] + ((v + 0.5 - TH / 2) * d) / tfy;
        Y = ys[iy] + ((u + 0.5 - TW / 2) * d) / tfx;
        d = zEye - zGround(X, Y);
      }
      const c = tex(X, Y), k = (v * TW + u) * 4;
      img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
    }
    tiles.set(seqOf(nX, nY, ix, iy), img);
  }
  return { plan, hm, tiles };
}

function renderAll(r: OrthoRenderer, tiles: Map<number, RgbaImage>) {
  const out = new Uint8ClampedArray(r.outW * r.outH * 4);
  for (let q0 = 0; q0 < r.outH; q0 += 16) {
    const rows = Math.min(16, r.outH - q0);
    for (const s of r.seqsForRows(q0, rows)) expect(tiles.has(s)).toBe(true);
    const band = new Uint8ClampedArray(rows * r.outW * 4);
    r.renderBand(q0, rows, (s) => tiles.get(s) ?? null, band);
    out.set(band, q0 * r.outW * 4);
  }
  return out;
}

describe("ortho reprojection", () => {
  for (const [label, ground] of [
    ["flat", () => 0],
    ["relief", (X: number, Y: number) => 60 * Math.sin(X / 300) + 40 * Math.cos(Y / 250)],
  ] as const) {
    it(`reproduces the ground texture (${label})`, () => {
      const { plan, hm, tiles } = synthetic(ground);
      for (const interp of INTERPS) {
        const r = new OrthoRenderer(plan, hm, plan.gsdX * 1.3, interp);
        const out = renderAll(r, tiles);
        expect(r.stats.holes).toBe(0);
        let err = 0, n = 0;
        for (let q = 2; q < r.outH - 2; q++) for (let p = 2; p < r.outW - 2; p++) {
          const X = hm.minX + (q + 0.5) * r.gsd, Y = hm.minY + (p + 0.5) * r.gsd;
          const c = tex(X, Y), k = (q * r.outW + p) * 4;
          err += Math.abs(out[k] - c[0]) + Math.abs(out[k + 1] - c[1]) + Math.abs(out[k + 2] - c[2]);
          n += 3;
        }
        expect(err / n, interp).toBeLessThan(interp === "nearest" ? 4 : 2);
      }
    });
  }
});

describe("captures at another resolution of the same shape", () => {
  it("reproject the same once the plan takes the captures' real size", () => {
    const ground = (X: number, Y: number) => 30 * Math.sin(X / 300);
    const base = synthetic(ground);
    const big = synthetic(ground, 1.5);
    const err = (plan: PlanInfo, tiles: Map<number, RgbaImage>) => {
      const r = new OrthoRenderer(plan, base.hm, base.plan.gsdX * 1.3, "bilinear");
      const out = renderAll(r, tiles);
      let e = 0, n = 0;
      for (let q = 2; q < r.outH - 2; q++) for (let p = 2; p < r.outW - 2; p++) {
        const X = base.hm.minX + (q + 0.5) * r.gsd, Y = base.hm.minY + (p + 0.5) * r.gsd;
        const c = tex(X, Y), k = (q * r.outW + p) * 4;
        e += Math.abs(out[k] - c[0]) + Math.abs(out[k + 1] - c[1]) + Math.abs(out[k + 2] - c[2]);
        n += 3;
      }
      return { e: e / n, holes: r.stats.holes };
    };
    const ref = err(base.plan, base.tiles);
    // What orthoExport does: the real size (240 × 180) replaces the plan's (160 × 120).
    const scaled = err({ ...base.plan, screenW: 240, screenH: 180 }, big.tiles);
    expect(scaled.holes).toBe(0);
    expect(scaled.e).toBeLessThan(2);
    expect(Math.abs(scaled.e - ref.e)).toBeLessThan(1);
  });
});

describe("ortho estimate", () => {
  it("matches the renderer size and the pyramid writer tile count", () => {
    const { plan, hm } = synthetic(() => 0);
    for (const k of [1, 1.7, 4]) {
      const gsd = plan.gsdX * k;
      const r = new OrthoRenderer(plan, hm, gsd);
      const est = estimateOrtho(hm.width, hm.height, gsd, 100);
      expect([est.outW, est.outH]).toEqual([r.outW, r.outH]);
      let n = 0;
      const info = pyramidInfo(r.outW, r.outH);
      expect(est.zMax).toBe(info.zMax);
      const w = pyramidWriter(info, () => n++);
      w.push(new Uint8ClampedArray(r.outW * r.outH * 4), r.outH);
      expect(est.tiles).toBe(n);
      expect(Math.max(est.overviewW, est.overviewH)).toBeLessThanOrEqual(100);
    }
  });
});

describe("tile pyramid", () => {
  it("emits every tile of every level as a full square, transparent beyond the image", () => {
    const W = 600, H = 530;
    const info = pyramidInfo(W, H);
    expect(info.zMax).toBe(2);
    const seen = new Map<string, Uint8ClampedArray>();
    const w = pyramidWriter(info, (z, x, y, rgba, tw, th) => {
      expect([tw, th]).toEqual([256, 256]);
      expect(rgba.length).toBe(256 * 256 * 4);
      seen.set(`${z}/${x}/${y}`, rgba);
    });
    const img = new Uint8ClampedArray(W * H * 4).fill(200);
    for (let q = 0; q < H; q += 100) w.push(img.subarray(q * W * 4, Math.min(H, q + 100) * W * 4), Math.min(100, H - q));
    expect(seen.size).toBe(9 + 4 + 1);
    // Valid area of the corner tiles: 88×18 (z2), 44×9 (z1), 150×133 (z0).
    const alphaAt = (t: Uint8ClampedArray, x: number, y: number) => t[(y * 256 + x) * 4 + 3];
    for (const [key, vw, vh] of [["2/2/2", 88, 18], ["1/1/1", 44, 9], ["0/0/0", 150, 133]] as const) {
      const t = seen.get(key)!;
      expect(alphaAt(t, vw - 1, vh - 1), key).toBe(200);
      expect(alphaAt(t, vw, 0), key).toBe(0);
      expect(alphaAt(t, 0, vh), key).toBe(0);
    }
  });
});
