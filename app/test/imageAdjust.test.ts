import { describe, expect, it } from "vitest";
import { autoAdjust, NEUTRAL, sameAdjust } from "../src/lib/core/imageAdjust";

/** RGBA pixels with luminance spread over [lo, hi] and a given colourfulness. */
function image(lo: number, hi: number, chroma: number, n = 10_000): Uint8ClampedArray {
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = (lo + ((hi - lo) * i) / (n - 1)) * 255;
    px[i * 4] = v + chroma * 128;
    px[i * 4 + 1] = v;
    px[i * 4 + 2] = v - chroma * 128;
    px[i * 4 + 3] = 255;
  }
  return px;
}

describe("auto image adjustments", () => {
  it("a dull, low-contrast image gets more contrast and saturation", () => {
    const a = autoAdjust(image(0.35, 0.65, 0.02));
    expect(a.contrast).toBeGreaterThan(0.4);
    expect(a.saturation).toBeGreaterThan(0.2);
  });

  it("an image already spread and colourful stays close to neutral", () => {
    const a = autoAdjust(image(0.04, 0.96, 0.4));
    expect(Math.abs(a.contrast)).toBeLessThan(0.12); // clipped extremes narrow the 1–99 % range a little
    expect(a.saturation).toBe(0);
    expect(Math.abs(a.gamma - 1)).toBeLessThan(0.15);
    expect(Math.abs(a.brightness)).toBeLessThan(0.05);
  });

  it("a dark image is lifted (gamma > 1); holes (transparent) are ignored", () => {
    const dark = autoAdjust(image(0.02, 0.4, 0.2));
    expect(dark.gamma).toBeGreaterThan(1.1);
    const holes = new Uint8ClampedArray(400); // all transparent
    expect(sameAdjust(autoAdjust(holes), NEUTRAL)).toBe(true);
  });
});
