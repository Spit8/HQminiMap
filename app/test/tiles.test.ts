import { describe, expect, it } from "vitest";
import { counterBase, matchByCounter, matchShots, parseShotName, parseTileName, runShots, tileNameFor } from "../src/lib/core/tiles";

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

  it("takes every tile's file, but waits while an image is still being written in its window", () => {
    const files = shotTimes.map((t, k) => file(t + 1, k + 1));
    expect(matchShots(files, shotTimes, now).certainty).toEqual(shotTimes.map(() => "sure"));
    // Screenshots outside the scan's time span are never candidates.
    const before = file(shotTimes[0] - 5, 0), after = file(shotTimes[5] + 6, 99);
    const m = matchShots([before, ...files, after], shotTimes, now);
    expect(m.matches.map((f) => f?.name)).toEqual(files.map((f) => f.name));
    // An image still being written in a window: wait.
    const late = { ...file(shotTimes[5] + 1, 9), mtimeMs: now - 100 };
    expect(matchShots([...files.slice(0, 5), late], shotTimes, now).certainty.at(-1)).toBe("wait");
  });

  it("pairs by the game counter, whatever the write delays", () => {
    // Writes lag more and more (big PNGs): 0, 1, 2, 3, 3, 4 s after their shot; an older image
    // (another scan, before the start) and one long after are not this scan's.
    const lags = [0, 1, 2, 3, 3, 4];
    const files = shotTimes.map((t, k) => file(t + lags[k], 26 + k));
    const old = file(t0 - 300, 9), later = file(t0 + 600, 40);
    const all = [old, ...files, later];
    const base = counterBase(all, t0, shotTimes);
    expect(base).toBe(26);
    const got = matchByCounter(all, base!, [0, 1, 2, 3, 4, 5], shotTimes, now);
    expect(got.map((f) => f?.name)).toEqual(files.map((f) => f.name));
    // Only the tiles still missing are asked for; a file far too late is refused.
    expect(matchByCounter([{ ...files[4], name: shotName(shotTimes[4] + 20, 30) }], 26, [4], shotTimes, now)).toEqual([null]);
  });

  it("on a same-second tie, takes the file that continues the game counter", () => {
    const files = shotTimes.map((t, k) => file(t, 10 + k));
    const mine = { ...file(shotTimes[3], 0), name: shotName(shotTimes[3], 2) }; // earlier counter, same second
    const m = matchShots([mine, ...files], shotTimes, now);
    expect(m.matches[3]?.name).toBe(files[3].name);
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
