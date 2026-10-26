import { describe, expect, it } from "vitest";
import { parseLive, parseStatus, parseVehicles, renderRequest, DEFAULT_INTERVALS, type Line, type Station, type Town } from "../src/lib/core/live";
import { parseUserdata } from "../src/lib/core/luadata";

// Shapes as written by app.saveUserdata (tabs, trailing commas, sorted keys).
const TOWNS = `function data()
return {
		t = 1800000000,
		towns = {
			{
				id = 46641,
				name = "Cherbourg-en-Cotentin \\"Nord\\"",
				size = 160,
				x = 10,
				y = -21,
			},
		},
		version = 1,
	}
end`;

describe("userdata reader", () => {
  it("parses nested tables, arrays, escapes and numbers", () => {
    const v = parseUserdata(`function data() return { a = { 1, 2.5, -3e2 }, ["b c"] = true, [3] = "x", n = nil, s = 'q\\'' } end`) as Record<string, unknown>;
    expect(v.a).toEqual([1, 2.5, -300]);
    expect(v["b c"]).toBe(true);
    expect(v["3"]).toBe("x");
    expect(v.s).toBe("q'");
  });
  it("returns null on a truncated file", () => {
    expect(parseUserdata("function data()\nreturn { towns = { { id = 1,")).toBeNull();
  });
});

describe("live files", () => {
  it("towns", () => {
    const r = parseLive("towns", TOWNS)!;
    expect(r.t).toBe(1800000000);
    expect(r.items as Town[]).toEqual([{ id: 46641, name: 'Cherbourg-en-Cotentin "Nord"', x: 10, y: -21, size: 160 }]);
  });
  it("stations and lines", () => {
    const st = parseLive("stations", `function data() return { stations = { { cargo = true, id = 301, mode = "rail", name = "Gare A", x = 1050, y = 2050 } }, t = 5 } end`)!;
    expect((st.items as Station[])[0]).toEqual({ id: 301, name: "Gare A", x: 1050, y: 2050, mode: "rail", cargo: true, passengers: false });
    const ln = parseLive("lines", `function data() return { lines = { { b = 1, carrier = 1, g = 0.5, id = 501, name = "Ligne 1", r = 0.1,
      stops = { { g = 301, x = 1000, y = 2000 }, { g = 302, x = 1100, y = 2100 } }, vehicles = 3 } }, t = 5 } end`)!;
    const l = (ln.items as Line[])[0];
    expect(l.color).toEqual([0.1, 0.5, 1]);
    expect(l.stops.map((s) => s.g)).toEqual([301, 302]);
    expect([l.vehicles, l.carrier]).toEqual([3, 1]);
  });
  it("vehicles string", () => {
    expect(parseVehicles("601,501,1500,2501;602,501,-3,4;bad")).toEqual([
      { id: 601, line: 501, x: 1500, y: 2501, pax: null, freight: null, name: "" }, { id: 602, line: 501, x: -3, y: 4, pax: null, freight: null, name: "" },
    ]);
    expect(parseLive("vehicles", `function data() return { n = 1, t = 9, v = "601,501,1500,2501" } end`)!.items).toHaveLength(1);
  });
  it("status", () => {
    const s = parseStatus(`function data() return { camera = { x = 1, y = 2 }, cmd = { ok = true, seq = 4 },
      enabled = true, jobs = { towns = { ms = 3, ok = true, t = 10 } }, lastCmdSeq = 4, t = 12 } end`)!;
    expect(s.lastCmdSeq).toBe(4);
    expect(s.cmd).toEqual({ seq: 4, ok: true, error: null });
    expect(s.jobs.towns).toEqual({ ms: 3, t: 10, ok: true, error: undefined });
  });

  it("shows a mode it does not know as other", () => {
    const r = parseLive("lines", "function data() return { t = 1, lines = { { id = 9, name = \"Z\", mode = \"zeppelin\", stops = {} } } } end")!;
    expect((r.items[0] as Line).mode).toBe("other");
  });

  it("reads the game's view size (its screenshots' size), absent with an older mod", () => {
    const s = parseStatus("function data() return { t = 1, screen = { w = 3440, h = 1440 } } end")!;
    expect(s.screen).toEqual({ w: 3440, h: 1440 });
    expect(parseStatus("function data() return { t = 1 } end")!.screen).toBeNull();
  });
});

describe("request", () => {
  it("round-trips through the userdata reader", () => {
    const text = renderRequest({ enabled: true, intervals: DEFAULT_INTERVALS, cmd: { seq: 2, action: "teleport", x: 300, y: -400, dist: 900 } });
    expect(text.startsWith("function data()\nreturn {")).toBe(true);
    expect(parseUserdata(text)).toEqual({
      enabled: true, intervals: { ...DEFAULT_INTERVALS }, cmd: { seq: 2, action: "teleport", x: 300, y: -400, dist: 900 },
    });
  });

  it("carries the scan command started from GridLab", () => {
    const text = renderRequest({ enabled: false, intervals: DEFAULT_INTERVALS, cmd: { seq: 7, action: "scan" } });
    expect((parseUserdata(text) as { cmd: unknown }).cmd).toEqual({ seq: 7, action: "scan" });
  });
});
