#!/usr/bin/env node
/**
 * Dev deploy: copy mod/ into the game's staging area (<userdata>/staging_area/hqminimap), the folder
 * the Mod Hub publishes from. Rewrites mod/_content.json first. Keeps the capture files the app wrote
 * there (content/hqminimap/mosaic_plan.lua, cutscenes/; a missing listed cutscene gets the shipped
 * placeholder) and the mod page images (_metadata/<n>.png). The Mod Hub link to the mod.io entry
 * (_metadata/mod.io_fileid.txt) comes from the repository: without it the next upload creates a new mod.
 * Cross-platform (Node ≥ 18).
 *
 *   node tools/deploy-dev.mjs [<userdata>]
 *   (default userdata: the most recently used <Steam>/userdata/<SteamID>/3493540/local of the
 *   default Steam install)
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_FILES, writeContentJson } from "./content-list.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "mod");
const userdata = process.argv[2] ?? defaultUserdata();

/** Most recently used TF3 userdata folder of the default Steam install (any Steam account). */
function defaultUserdata() {
  const steam = process.platform === "win32"
    ? join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Steam")
    : process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "Steam")
      : join(homedir(), ".local", "share", "Steam");
  const users = join(steam, "userdata");
  const found = existsSync(users)
    ? readdirSync(users).map((id) => join(users, id, "3493540", "local")).filter((p) => existsSync(p))
    : [];
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0] ?? join(users, "<SteamID>", "3493540", "local");
}
const dest = join(userdata, "staging_area", "hqminimap");

/** Files written by the app, or added by hand to the staging copy, that a deploy must not touch. */
const keep = (rel) =>
  /^_metadata[\\/]\d+\.png$/.test(rel) ||
  rel === join("content", "hqminimap", "mosaic_plan.lua") ||
  rel.startsWith(join("content", "hqminimap", "cutscenes"));

if (!existsSync(userdata)) {
  console.error(`userdata not found: ${userdata}`);
  process.exit(1);
}
if (writeContentJson(src)) console.log("mod/_content.json updated");
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
for (const rel of RUNTIME_FILES) {
  const to = join(dest, "content", rel);
  if (!existsSync(to)) copyFileSync(join(src, "content", rel), to);
}
console.log(`OK mod deployed -> ${dest}`);
