/**
 * Streaming tile pyramid (for the Visualiser): full-resolution rows are pushed in order; each level
 * cuts complete 256-row strips into square tiles and feeds a 2×-downsampled strip to the level
 * above. Memory = one strip per level. Tiles: z = 0 is the coarsest (whole image ≤ one tile).
 * Pure: emits RGBA tiles through a callback.
 */

export const TILE = 256;

export interface PyramidInfo {
  width: number;
  height: number;
  tileSize: number;
  /** Finest level (full resolution). */
  zMax: number;
}

/** Number of 2× levels so the coarsest level fits in one tile. */
export function pyramidInfo(width: number, height: number, tileSize = TILE): PyramidInfo {
  let z = 0, w = width, h = height;
  while (w > tileSize || h > tileSize) {
    w = Math.ceil(w / 2);
    h = Math.ceil(h / 2);
    z++;
  }
  return { width, height, tileSize, zMax: z };
}

export interface OrthoEstimate {
  outW: number;
  outH: number;
  megapixels: number;
  zMax: number;
  /** Pyramid tiles over all levels. */
  tiles: number;
  overviewW: number;
  overviewH: number;
}

/**
 * Output size of an ortho before computing it: same rounding as OrthoRenderer (columns ↔ world Y
 * extent, rows ↔ world X extent), pyramid tile count and overview size (longest side ≤ maxSide).
 */
export function estimateOrtho(extentX: number, extentY: number, gsd: number, overviewMaxSide: number,
  tileSize = TILE): OrthoEstimate {
  const outW = Math.max(1, Math.round(extentY / gsd));
  const outH = Math.max(1, Math.round(extentX / gsd));
  const info = pyramidInfo(outW, outH, tileSize);
  let tiles = 0, w = outW, h = outH;
  for (let z = info.zMax; z >= 0; z--) {
    tiles += Math.ceil(w / tileSize) * Math.ceil(h / tileSize);
    w = Math.ceil(w / 2);
    h = Math.ceil(h / 2);
  }
  let ow = outW, oh = outH;
  while (Math.max(ow, oh) > overviewMaxSide) {
    ow = Math.ceil(ow / 2);
    oh = Math.ceil(oh / 2);
  }
  return { outW, outH, megapixels: (outW * outH) / 1e6, zMax: info.zMax, tiles, overviewW: ow, overviewH: oh };
}

export type TileSink = (z: number, x: number, y: number, rgba: Uint8ClampedArray, w: number, h: number) => void;

class Level {
  private strip: Uint8ClampedArray;
  private filled = 0;
  private rowY = 0;
  private parent: Level | null;

  constructor(
    private readonly z: number,
    private readonly width: number,
    private readonly height: number,
    private readonly ts: number,
    private readonly sink: TileSink,
  ) {
    this.strip = new Uint8ClampedArray(ts * width * 4);
    this.parent = z > 0 ? new Level(z - 1, Math.ceil(width / 2), Math.ceil(height / 2), ts, sink) : null;
  }

  /** Append `rows` full rows (width·4 bytes each). */
  push(data: Uint8ClampedArray, rows: number): void {
    const rowBytes = this.width * 4;
    let src = 0;
    while (rows > 0) {
      const take = Math.min(rows, this.ts - this.filled);
      this.strip.set(data.subarray(src * rowBytes, (src + take) * rowBytes), this.filled * rowBytes);
      this.filled += take;
      src += take;
      rows -= take;
      if (this.filled === this.ts || this.rowY + this.filled === this.height) this.flush();
    }
  }

  private flush(): void {
    const rows = this.filled, ts = this.ts, w = this.width;
    const ty = this.rowY / ts;
    for (let tx = 0; tx * ts < w; tx++) {
      // Always a full ts×ts tile (transparent beyond the image): viewers draw every tile as a
      // full square, a partial edge tile would be stretched.
      const tw = Math.min(ts, w - tx * ts);
      const tile = new Uint8ClampedArray(ts * ts * 4);
      for (let r = 0; r < rows; r++) {
        tile.set(this.strip.subarray((r * w + tx * ts) * 4, (r * w + tx * ts + tw) * 4), r * ts * 4);
      }
      this.sink(this.z, tx, ty, tile, ts, ts);
    }
    if (this.parent) {
      // 2×2 box filter (alpha-weighted; odd edges reuse the last row/column).
      const pw = Math.ceil(w / 2), pr = Math.ceil(rows / 2);
      const half = new Uint8ClampedArray(pw * pr * 4);
      for (let r = 0; r < pr; r++) {
        const r0 = 2 * r, r1 = Math.min(rows - 1, r0 + 1);
        for (let c = 0; c < pw; c++) {
          const c0 = 2 * c, c1 = Math.min(w - 1, c0 + 1);
          const ks = [(r0 * w + c0) * 4, (r0 * w + c1) * 4, (r1 * w + c0) * 4, (r1 * w + c1) * 4];
          let a = 0, rr = 0, gg = 0, bb = 0;
          for (const k of ks) {
            const al = this.strip[k + 3];
            a += al; rr += this.strip[k] * al; gg += this.strip[k + 1] * al; bb += this.strip[k + 2] * al;
          }
          const o = (r * pw + c) * 4;
          if (a > 0) { half[o] = rr / a; half[o + 1] = gg / a; half[o + 2] = bb / a; }
          half[o + 3] = a / 4;
        }
      }
      this.parent.push(half, pr);
    }
    this.rowY += rows;
    this.filled = 0;
  }
}

/** Build a pyramid writer; call push(rows) with full-resolution rows top to bottom. */
export function pyramidWriter(info: PyramidInfo, sink: TileSink): { push: (data: Uint8ClampedArray, rows: number) => void } {
  const top = new Level(info.zMax, info.width, info.height, info.tileSize, sink);
  return { push: (data, rows) => top.push(data, rows) };
}
