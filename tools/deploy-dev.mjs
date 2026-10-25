#!/usr/bin/env node
/**
 * Dev deploy: copy mod/ into the game's local mods folder (<userdata>/staging_area/hqminimap).
 * Keeps the capture files the app wrote there (content/hqminimap/mosaic_plan.lua, cutscenes/).
 * Cross-platform (Node ≥ 18).
 *
 *   node tools/deploy-dev.mjs [<userdata>]
 *   (default userdata: Windows %PUBLIC%\Documents\Steam\RUNE\3493540\local)
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "mod");
const userdata = process.argv[2]
  ?? join(process.env.PUBLIC ?? "C:\\Users\\Public", "Documents", "Steam", "RUNE", "3493540", "local");
const dest = join(userdata, "staging_area", "hqminimap");

/** Files written by the app that a deploy must not touch. */
const keep = (rel) =>
  rel === join("content", "hqminimap", "mosaic_plan.lua") ||
  rel.startsWith(join("content", "hqminimap", "cutscenes"));

if (!existsSync(userdata)) {
  console.error(`userdata not found: ${userdata}`);
  process.exit(1);
}
mkdirSync(dest, { recursive: true });

// Remove files that no longer exist in mod/ (mirror), except the app-written ones.
function prune(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const rel = relative(dest, p);
    if (keep(rel)) continue;
    if (!existsSync(join(src, rel))) {
      rmSync(p, { recursive: true, force: true });
      console.log("removed", rel);
    } else if (e.isDirectory()) {
      prune(p);
    }
  }
}
prune(dest);
cpSync(src, dest, {
  recursive: true,
  filter: (s) => !keep(relative(src, s)),
});
console.log(`OK mod deployed -> ${dest}`);
