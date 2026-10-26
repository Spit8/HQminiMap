import { describe, expect, it } from "vitest";
import { PERF_CAPS, perfLevel } from "../src/lib/core/perf";

describe("performance levels", () => {
  const s = (memory: number | null, objects: number, updateMs: number) => ({ memory, objects, updateMs });

  it("rises with memory, objects or update time", () => {
    expect(perfLevel(s(0.3, 5_000, 40), "ok")).toBe("ok");
    expect(perfLevel(s(0.65, 5_000, 40), "ok")).toBe("busy");
    expect(perfLevel(s(null, 30_000, 40), "ok")).toBe("busy");
    expect(perfLevel(s(0.3, 5_000, 500), "ok")).toBe("critical");
    expect(perfLevel(s(0.85, 5_000, 40), "busy")).toBe("critical");
  });

  it("comes down only well under the threshold (no flip-flop)", () => {
    // 22 000 objects: under busy (25 000) but over 80 % of it → stays busy once busy.
    expect(perfLevel(s(null, 22_000, 40), "busy")).toBe("busy");
    expect(perfLevel(s(null, 22_000, 40), "ok")).toBe("ok");
    expect(perfLevel(s(null, 19_000, 40), "busy")).toBe("ok");
    // 45 000: under critical (50 000) but over 80 % → stays critical.
    expect(perfLevel(s(null, 45_000, 40), "critical")).toBe("critical");
    expect(perfLevel(s(null, 35_000, 40), "critical")).toBe("busy");
  });

  it("gives up more at each level, nothing at ok", () => {
    expect(PERF_CAPS.ok).toMatchObject({ plainLines: false, fills: true, movingLabels: true, maxTrackedLines: Infinity });
    expect(PERF_CAPS.busy.plainLines && !PERF_CAPS.busy.fills).toBe(true);
    expect(PERF_CAPS.critical.maxTrackedLines).toBeLessThan(Infinity);
    expect(PERF_CAPS.critical.tileCache).toBeLessThan(PERF_CAPS.ok.tileCache);
  });
});
