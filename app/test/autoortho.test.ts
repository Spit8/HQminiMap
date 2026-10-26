import { describe, expect, it } from "vitest";
import { shouldAutoOrtho, type AutoOrthoRun, type AutoOrthoState } from "../src/lib/state/autoOrtho";

const NOW = 1_800_000_000_000;
const run: AutoOrthoRun = { id: "42", finished: true, collected: 18, expected: 18, error: null, hasOrtho: false, startedAt: NOW / 1000 - 600 };
const state: AutoOrthoState = { watched: new Set(["42"]), attempted: new Set(), planReady: true, resIssue: false, busy: false, latest: false, now: NOW };

describe("automatic ortho", () => {
  it("starts once a capture seen running is finished and complete", () => {
    expect(shouldAutoOrtho(run, state)).toBe(true);
  });

  it("resumes the latest recent capture after a restart, never an old one, nor twice", () => {
    expect(shouldAutoOrtho(run, { ...state, watched: new Set() })).toBe(false);
    // Not seen running (the app was restarted), but the latest capture, 10 min old: resumed.
    expect(shouldAutoOrtho(run, { ...state, watched: new Set(), latest: true })).toBe(true);
    // Latest but 3 h old: an old capture, left alone.
    expect(shouldAutoOrtho({ ...run, startedAt: NOW / 1000 - 3 * 3600 }, { ...state, watched: new Set(), latest: true })).toBe(false);
    expect(shouldAutoOrtho(run, { ...state, attempted: new Set(["42"]) })).toBe(false);
    expect(shouldAutoOrtho(null, state)).toBe(false);
  });

  it("waits for a finished, complete, clean capture and a free ortho job", () => {
    expect(shouldAutoOrtho({ ...run, finished: false }, state)).toBe(false);
    expect(shouldAutoOrtho({ ...run, collected: 17 }, state)).toBe(false);
    expect(shouldAutoOrtho({ ...run, error: "cutscene" }, state)).toBe(false);
    expect(shouldAutoOrtho({ ...run, hasOrtho: true }, state)).toBe(false);
    expect(shouldAutoOrtho(run, { ...state, planReady: false })).toBe(false);
    expect(shouldAutoOrtho(run, { ...state, resIssue: true })).toBe(false);
    expect(shouldAutoOrtho(run, { ...state, busy: true })).toBe(false);
  });
});
