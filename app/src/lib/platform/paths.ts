/**
 * TF3 folders used by the app, derived from the userdata root (Steam: `<Steam>/userdata/<SteamID>/3493540/local`).
 * The root and the mod folder (staging_area, mods or Mod Hub download) are auto-detected by the Rust
 * `detect_paths` command; the user can override both.
 */
import { invoke } from "@tauri-apps/api/core";
import { fileExists, joinPath } from "./fsx";

export const MOD_ID = "hqminimap";

export interface GamePaths {
  userdata: string;
  /** Exports written by the mod (map.lua, heightmap.lua, capture_index.lua). */
  exportDir: string;
  /** saveUserdata fallback when <UD>/hqminimap is refused: towns_industries/hqminimap_<name>.lua. */
  fallbackDir: string;
  /** Installed mod root (contains content/hqminimap/). */
  modDir: string;
  screenshots: string;
  /** Collected capture runs (tiles + plan + heightmap + ortho). */
  runsDir: string;
}

export function gamePaths(userdata: string, modDir?: string): GamePaths {
  return {
    userdata,
    exportDir: joinPath(userdata, MOD_ID),
    fallbackDir: joinPath(userdata, "towns_industries"),
    modDir: modDir || joinPath(userdata, "mods", MOD_ID),
    screenshots: joinPath(userdata, "screenshots"),
    runsDir: joinPath(userdata, MOD_ID, "runs"),
  };
}

/** Export file path (`map`, `heightmap`, `capture_index`), preferring the main export dir. */
export async function exportFile(p: GamePaths, name: string): Promise<string> {
  const main = joinPath(p.exportDir, `${name}.lua`);
  if (await fileExists(main)) return main;
  const fb = joinPath(p.fallbackDir, `${MOD_ID}_${name}.lua`);
  return (await fileExists(fb)) ? fb : main;
}

/** Capture plan read by the mod at each scan (app.loadUserdata, never cached). */
export function capturePlanPath(p: GamePaths): string {
  return joinPath(p.exportDir, "capture_plan.lua");
}

/** Plan shipped inside the mod by older app versions (cached by the game: removed on write). */
export function legacyModPlanPath(p: GamePaths): string {
  return joinPath(p.modDir, "content", MOD_ID, "mosaic_plan.lua");
}

export function cutsceneDir(p: GamePaths): string {
  return joinPath(p.modDir, "content", MOD_ID, "cutscenes");
}

export interface DetectedPaths {
  userdata: string | null;
  /** Installed mod root: staging_area, manual install in mods, or a Mod Hub (mod.io) download. */
  modDir: string | null;
  candidates: string[];
}

export async function detectUserdata(): Promise<DetectedPaths> {
  try {
    return await invoke("detect_paths");
  } catch {
    return { userdata: null, modDir: null, candidates: [] };
  }
}
