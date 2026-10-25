/**
 * Readers for the Lua tables the HQminiMap mod writes (app.saveUserdata → <UD>/hqminimap/*.lua)
 * and for the mosaic_plan.lua the app writes. Regex-based on purpose: the files are flat,
 * machine-written tables (same parsing as the miniMapper reference generator).
 */

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

/** Ground grid: data[j * n + i] = visible z at x = minX + (i + 0.5)·cellX, y = minY + (j + 0.5)·cellY. */
export interface Heightmap {
  n: number;
  minX: number;
  minY: number;
  width: number;
  height: number;
  cellX: number;
  cellY: number;
  data: Float64Array;
  source: "heightmap" | "map_cells";
  /** Map water level (z ≤ it on water cells), when the export carries it. */
  waterLevel: number | null;
}

const NUM = "([-+0-9.eE]+)";

/** First `key = <number>` in text (word-bounded), NaN if absent. */
export function luaNum(text: string, key: string): number {
  const m = text.match(new RegExp(`(?:^|[\\s,{.])${key}\\s*=\\s*${NUM}`, "m"));
  return m ? parseFloat(m[1]) : NaN;
}

/** First `key = "<string>"`, or null. */
export function luaStr(text: string, key: string): string | null {
  const m = text.match(new RegExp(`(?:^|[\\s,{.])${key}\\s*=\\s*"([^"]*)"`, "m"));
  return m ? m[1] : null;
}

/** map.lua `bounds = { ... }`. */
export function parseBounds(mapText: string): Bounds | null {
  const b = mapText.match(/bounds\s*=\s*\{([^}]+)\}/);
  if (!b) return null;
  const out = {} as Bounds;
  for (const k of ["minX", "maxX", "minY", "maxY", "width", "height"] as const) {
    const v = luaNum(b[1], k);
    if (!Number.isFinite(v)) return null;
    out[k] = v;
  }
  return out;
}

/** heightmap.lua (mod collect_terrain.sampleHeightmap): rows[j+1][i+1]. */
export function parseHeightmap(text: string): Heightmap | null {
  const n = luaNum(text, "n"), minX = luaNum(text, "minX"), minY = luaNum(text, "minY");
  const width = luaNum(text, "width"), height = luaNum(text, "height");
  const start = text.search(/\brows\s*=\s*\{/);
  if (![n, minX, minY, width, height].every(Number.isFinite) || start < 0) return null;
  const data = new Float64Array(n * n);
  const rowRe = /\{([^{}]*)\}/g;
  rowRe.lastIndex = text.indexOf("{", start) + 1;
  let j = 0;
  let m: RegExpExecArray | null;
  while (j < n && (m = rowRe.exec(text)) !== null) {
    const vals = m[1].match(/[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) || [];
    if (vals.length < n) return null;
    for (let i = 0; i < n; i++) data[j * n + i] = parseFloat(vals[i]);
    j++;
  }
  if (j !== n) return null;
  const wl = luaNum(text, "waterLevel");
  return {
    n, minX, minY, width, height, cellX: width / n, cellY: height / n, data, source: "heightmap",
    waterLevel: Number.isFinite(wl) ? wl : null,
  };
}

/** map.lua terrain cells {h, i, j} → same grid, z = max(h, waterLevel) (fallback terrain). */
export function parseMapCells(text: string): Heightmap | null {
  const b = parseBounds(text);
  if (!b) return null;
  const wl = luaNum(text, "waterLevel");
  const water = Number.isFinite(wl) ? wl : 0;
  const re = /\bh\s*=\s*([-+0-9.eE]+),\s*i\s*=\s*(\d+),\s*j\s*=\s*(\d+)/g;
  const cells: [number, number, number][] = [];
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const i = +m[2], j = +m[3];
    cells.push([i, j, Math.max(parseFloat(m[1]), water)]);
    n = Math.max(n, i + 1, j + 1);
  }
  if (!n || cells.length !== n * n) return null;
  const data = new Float64Array(n * n);
  for (const [i, j, z] of cells) data[j * n + i] = z;
  return {
    n, minX: b.minX, minY: b.minY, width: b.width, height: b.height,
    cellX: b.width / n, cellY: b.height / n, data, source: "map_cells",
    waterLevel: Number.isFinite(wl) ? wl : null,
  };
}

/** Terrain source label written in mosaic_plan.lua (reference: "heightmap_<n>" | "map_cells"). */
export function terrainSourceLabel(hm: Heightmap): string {
  return hm.source === "heightmap" ? `heightmap_${hm.n}` : "map_cells";
}

/** capture_index.lua (mod capture.lua): the fields the tile watcher needs. */
export interface CaptureIndex {
  startedAt: number | null;
  finishedAt: number | null;
  nX: number;
  nY: number;
  pitchCount: number;
  shotsTaken: number;
  /** planStamp of the capture_plan.lua the capture played (null for older mods). */
  planStamp: number | null;
  /** Wall time (unix s) of each screenshot, capture order; empty for older indexes. */
  shotTimes: number[];
  error: string | null;
}

/** Flat numeric list `key = { a, b, … }` (or `{ [1] = a, … }`), [] if absent. */
export function luaNumList(text: string, key: string): number[] {
  const m = text.match(new RegExp(`(?:^|[\\s,{.])${key}\\s*=\\s*\\{([^{}]*)\\}`, "m"));
  if (!m) return [];
  return [...m[1].replace(/\[\d+\]\s*=/g, "").matchAll(/[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g)].map((v) => +v[0]);
}

export function parseCaptureIndex(text: string): CaptureIndex {
  const num = (k: string) => {
    const v = luaNum(text, k);
    return Number.isFinite(v) ? v : null;
  };
  return {
    startedAt: num("startedAt"),
    finishedAt: num("finishedAt"),
    nX: num("nX") ?? 0,
    nY: num("nY") ?? 0,
    pitchCount: num("pitchCount") ?? 1,
    shotsTaken: num("shotsTaken") ?? 0,
    shotTimes: luaNumList(text, "shotTimes"),
    planStamp: num("planStamp"),
    error: luaStr(text, "error"),
  };
}

/** mosaic_plan.lua → what TileLab's ortho needs (camera + exact lattice). */
export interface PlanInfo {
  nX: number;
  nY: number;
  zEye: number;
  fovV: number;
  pixelAspect: number;
  screenW: number;
  screenH: number;
  gsdX: number;
  gsdY: number;
  centers: { x: number; y: number }[];
}

export function parsePlan(text: string): PlanInfo | null {
  const g = (k: string) => luaNum(text, `M\\.${k}`);
  const centers: { x: number; y: number }[] = [];
  const block = text.match(/M\.centers\s*=\s*\{([\s\S]*?)\n\}/);
  if (block) {
    const re = /x\s*=\s*([-+0-9.eE]+),\s*y\s*=\s*([-+0-9.eE]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block[1])) !== null) centers.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
  }
  const plan: PlanInfo = {
    nX: g("nX"), nY: g("nY"), zEye: g("zEye"), fovV: g("fovV"), pixelAspect: g("pixelAspect"),
    screenW: g("screenW"), screenH: g("screenH"), gsdX: g("gsdX"), gsdY: g("gsdY"), centers,
  };
  const ok = plan.nX >= 1 && plan.nY >= 1 && centers.length === plan.nX * plan.nY
    && [plan.zEye, plan.fovV, plan.screenW, plan.screenH].every(Number.isFinite);
  if (!ok) return null;
  if (!Number.isFinite(plan.pixelAspect)) plan.pixelAspect = 1;
  return plan;
}
