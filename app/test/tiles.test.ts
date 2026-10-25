import { describe, expect, it } from "vitest";
import { matchShots, parseShotName, parseTileName, runShots, tileNameFor } from "../src/lib/core/tiles";

/** TF3-style screenshot name for local wall time `t` (unix s) and counter n. */
function shotName(t: number, n: number): string {
  const d = new Date(t * 1000);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}_img_${n}.png`;
}

describe("capture screenshots ↔ tiles", () => {
  const t0 = 1_792_931_169;
  const shotTimes = Array.from({ length: 6 }, (_, k) => t0 + 3 + k); // one tile per second
  const now = (t0 + 60) * 1000;
  const file = (t: number, n: number) => ({ name: shotName(t, n), mtimeMs: t * 1000 + 300, size: 1 });

  it("parses TF3 screenshot names", () => {
    expect(parseShotName(shotName(t0, 7))).toEqual({ time: t0, n: 7 });
    expect(parseShotName("tile_p01_001.png")).toBeNull();
  });

  it("pairs every tile, with a constant write lag", () => {
    for (const lagSec of [0, 1]) {
      const files = shotTimes.map((t, k) => file(t + lagSec, k));
      const m = matchShots(files, shotTimes, now);
      expect(m.matches.map((f) => f?.name)).toEqual(files.map((f) => f.name));
      expect(m.extras).toEqual([]);
    }
  });

  it("ignores manual screenshots taken during and around the run", () => {
    const files = shotTimes.map((t, k) => file(t + 1, k + 1));
    const manual = [file(t0 + 5, 3.5), file(t0 - 30, 0), file(t0 + 40, 99)]; // same second as a tile, before, after
    manual[0].name = shotName(t0 + 5, 50);
    const m = matchShots([...manual, ...files], shotTimes, now);
    expect(m.matches.map((f) => f?.name)).toEqual(files.map((f) => f.name));
    expect(m.extras.map((f) => f.name)).toEqual([manual[0].name]);
  });

  it("leaves missing tiles empty and skips files still being written", () => {
    const files = shotTimes.slice(0, 4).map((t, k) => file(t, k));
    files[3].mtimeMs = now - 100; // being written
    const m = matchShots(files, shotTimes, now);
    expect(m.matches.map((f) => (f ? f.name : null))).toEqual([files[0].name, files[1].name, files[2].name, null, null, null]);
  });
});

/** Reference: watch-screenshots.ps1 Get-DisplaySeq + tile_p{pitch:D2}_{seq:D3}. */
function psName(n: number, nX: number, nY: number): string {
  const per = nX * nY;
  const pitch = Math.floor((n - 1) / per) + 1;
  const local = ((n - 1) % per) + 1;
  const i = local - 1;
  const ix = i % nX;
  const iy = Math.floor(i / nX);
  const seq = (nX - 1 - ix) * nY + (nY - 1 - iy) + 1;
  return `tile_p${String(pitch).padStart(2, "0")}_${String(seq).padStart(3, "0")}.png`;
}

describe("tile naming", () => {
  it("matches the reference watcher on 12x5 and 8x4", () => {
    for (const [nX, nY] of [[12, 5], [8, 4], [1, 1], [3, 7]]) {
      const names = new Set<string>();
      for (let n = 1; n <= nX * nY; n++) {
        const t = tileNameFor(n, nX, nY);
        expect(t.name).toBe(psName(n, nX, nY));
        names.add(t.name);
      }
      expect(names.size).toBe(nX * nY);
    }
  });
  it("first shot (ix=0, iy=0 = largest X and Y) is the last display seq", () => {
    expect(tileNameFor(1, 12, 5).seq).toBe(60);
    expect(tileNameFor(60, 12, 5).seq).toBe(1);
    expect(parseTileName("tile_p01_042.png")).toEqual({ pitchIdx: 1, seq: 42 });
  });
  it("run window and young files", () => {
    const t0 = 1_800_000_000;
    const files = [
      { name: "old.png", mtimeMs: (t0 - 10) * 1000, size: 1 },
      { name: "b.png", mtimeMs: (t0 + 2) * 1000, size: 1 },
      { name: "a.png", mtimeMs: (t0 + 1) * 1000, size: 1 },
      { name: "c.png", mtimeMs: (t0 + 3) * 1000 + 900, size: 1 },
      { name: "note.txt", mtimeMs: (t0 + 1) * 1000, size: 1 },
    ];
    const now = (t0 + 4) * 1000;
    expect(runShots(files, t0, now).map((f) => f.name)).toEqual(["a.png", "b.png"]);
  });
});
