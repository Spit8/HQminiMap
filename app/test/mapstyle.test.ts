import { describe, expect, it } from "vitest";
import { MAP_STYLE_DEFAULT, parseMapStyle } from "../src/lib/state/mapStyle.svelte";
import { loadBadge } from "../src/lib/ui/viewer/icons";

describe("map style settings", () => {
  it("uses the new defaults when nothing is saved", () => {
    expect(parseMapStyle(null)).toEqual(MAP_STYLE_DEFAULT);
    expect(MAP_STYLE_DEFAULT.iconScale).toBe(1.1);
    expect(MAP_STYLE_DEFAULT.lineWidth).toBe(1.3);
  });

  it("moves the old default icon size to the new one, keeps a size set by hand", () => {
    expect(parseMapStyle({ iconScale: 1 }).iconScale).toBe(1.1);
    expect(parseMapStyle({ iconScale: 1.4 }).iconScale).toBe(1.4);
    expect(parseMapStyle({ iconScale: 1, v: 2 }).iconScale).toBe(1);
  });

  it("bounds the line width and fills it in for old settings", () => {
    expect(parseMapStyle({ iconScale: 1.2 }).lineWidth).toBe(1.3);
    expect(parseMapStyle({ lineWidth: 9 }).lineWidth).toBe(3);
    expect(parseMapStyle({ lineWidth: 0.1 }).lineWidth).toBe(0.5);
  });
});

describe("vehicle load badge", () => {
  const svg = (uri: string) => decodeURIComponent(uri.slice(uri.indexOf(",") + 1));

  it("frames the load in the line's colour, one part per load", () => {
    const b = loadBadge("rgba(10,200,30,1)", [
      { kind: "pax", text: "12/40" }, { kind: "freight", text: "3/10" },
    ]);
    const s = svg(b.uri);
    expect(s).toContain('stroke="rgba(10,200,30,1)"');
    expect(s).toContain(">12/40</text>");
    expect(s).toContain(">3/10</text>");
    expect(s).toContain(">🧑</text>");
    expect(s).toContain(">📦</text>");
    const one = loadBadge("rgba(10,200,30,1)", [{ kind: "pax", text: "12/40" }]);
    expect(one.width).toBeLessThan(b.width);
    expect(b.height).toBe(one.height);
  });

  it("is cached and scales", () => {
    const parts = [{ kind: "freight" as const, text: "1/2" }];
    expect(loadBadge("#fff", parts)).toBe(loadBadge("#fff", parts));
    expect(loadBadge("#fff", parts, 2).height).toBeGreaterThan(loadBadge("#fff", parts).height);
  });
});
