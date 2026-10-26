/**
 * Screen resolutions: size of a PNG read from its header (IHDR, no decoding), common game
 * resolutions and their aspect ratios.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width × height of a PNG from its first 24 bytes, or null if it is not a PNG. */
export function pngSize(bytes: ArrayLike<number>): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return null;
  // Chunk 1 must be IHDR: length (4), "IHDR" (4), width (4, big-endian), height (4).
  if (String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) !== "IHDR") return null;
  const u32 = (o: number) => ((bytes[o]! << 24) >>> 0) + (bytes[o + 1]! << 16) + (bytes[o + 2]! << 8) + bytes[o + 3]!;
  const width = u32(16), height = u32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Common game resolutions (GridLab presets). */
export const RESOLUTIONS: [number, number][] = [
  [1280, 720], [1366, 768], [1600, 900], [1920, 1080], [1920, 1200], [2560, 1080], [2560, 1440],
  [2560, 1600], [3440, 1440], [3840, 1600], [3840, 2160], [5120, 1440], [5120, 2160],
];

/** Usual name of an aspect ratio ("16:9", "21:9", "32:9"…) or the reduced fraction. */
export function aspectName(w: number, h: number): string {
  const r = w / h;
  const known: [number, string][] = [[4 / 3, "4:3"], [16 / 10, "16:10"], [16 / 9, "16:9"], [21 / 9, "21:9"], [32 / 9, "32:9"]];
  // "21:9" covers the ultrawide family (2560×1080 is 2.37, 3440×1440 is 2.39).
  for (const [v, n] of known) if (Math.abs(r - v) / v < 0.03) return n;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

/**
 * Do captures of (w, h) fit a grid planned for (pw, ph)? Same shape, any size: captures of another
 * size are reprojected. Narrower than planned (beyond rounding, 0.1 %) leaves gaps between
 * neighbouring images (the grid has no overlap to spare): refused. Slightly wider (≤ 1 %) only
 * overlaps more: accepted.
 */
export const sameAspect = (w: number, h: number, pw: number, ph: number) => {
  const r = w / h, p = pw / ph;
  return r >= p * (1 - 0.001) && r <= p * (1 + 0.01);
};
