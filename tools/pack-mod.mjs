#!/usr/bin/env node
/**
 * Release package of the mod: dist/hqminimap-mod-<version>.zip containing a "hqminimap/" folder
 * ready to copy into the game's local mods folder. Files the app writes into the installed mod
 * (capture plan, cutscenes) are left out. Plain Node (zlib), no zip tool needed.
 *
 *   node tools/pack-mod.mjs [--out <dir>]
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { RUNTIME_FILES, writeContentJson } from "./content-list.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "mod");
const outIdx = process.argv.indexOf("--out");
const outDir = outIdx > 0 ? process.argv[outIdx + 1] : join(root, "dist");
const version = JSON.parse(readFileSync(join(root, "app", "package.json"), "utf8")).version;

/** Written by the app at run time (or the Mod Hub link), never shipped — except the placeholder
 *  cutscenes _content.json lists. */
const skip = (rel) =>
  rel === "_metadata/mod.io_fileid.txt" ||
  rel === "content/hqminimap/mosaic_plan.lua" || rel.endsWith(".log") ||
  (rel.startsWith("content/hqminimap/cutscenes/") && !RUNTIME_FILES.includes(rel.slice("content/".length)));

if (writeContentJson(src)) console.log("mod/_content.json updated");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date/time of a Date (zip headers). */
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const entries = walk(src)
  .map((full) => ({ full, rel: relative(src, full).split(sep).join("/") }))
  .filter((e) => !skip(e.rel))
  .sort((a, b) => a.rel.localeCompare(b.rel));

const locals = [], centrals = [];
let offset = 0;
for (const { full, rel } of entries) {
  const data = readFileSync(full);
  const packed = deflateRawSync(data, { level: 9 });
  const name = Buffer.from(`hqminimap/${rel}`, "utf8");
  const crc = crc32(data);
  const { time, date } = dosTime(statSync(full).mtime);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  locals.push(local, name, packed);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);
  offset += local.length + name.length + packed.length;
}
const centralSize = centrals.reduce((a, b) => a + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(outDir, { recursive: true });
const out = join(outDir, `hqminimap-mod-${version}.zip`);
writeFileSync(out, Buffer.concat([...locals, ...centrals, end]));
console.log(`${out} (${entries.length} files)`);
