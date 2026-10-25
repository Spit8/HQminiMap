import { describe, expect, it } from "vitest";
import { encode } from "fast-png";
import { aspectName, pngSize, sameAspect } from "../src/lib/core/png";

describe("screen resolution", () => {
  it("reads the size from a PNG header", () => {
    const png = encode({ width: 37, height: 21, data: new Uint8Array(37 * 21 * 4), channels: 4, depth: 8 });
    expect(pngSize(png)).toEqual({ width: 37, height: 21 });
  });

  it("refuses truncated and non-PNG data", () => {
    const png = encode({ width: 4, height: 4, data: new Uint8Array(64), channels: 4, depth: 8 });
    expect(pngSize(png.slice(0, 20))).toBeNull();
    expect(pngSize(new TextEncoder().encode("this is not a png file at all"))).toBeNull();
  });

  it("names aspect ratios and compares shapes", () => {
    expect(aspectName(1920, 1080)).toBe("16:9");
    expect(aspectName(2560, 1080)).toBe("21:9");
    expect(aspectName(3440, 1440)).toBe("21:9");
    expect(aspectName(5120, 1440)).toBe("32:9");
    expect(aspectName(1920, 1200)).toBe("16:10");
    expect(aspectName(1366, 768)).toBe("16:9");
    expect(sameAspect(3840, 1620, 2560, 1080)).toBe(true);
    expect(sameAspect(1920, 1080, 2560, 1080)).toBe(false);
  });
});
