/**
 * Small previews of the captured screenshots (TileLab grid): decoded once, scaled down to THUMB_W
 * and re-encoded as JPEG, so the full 2560 × 1080 bitmaps are not kept in memory.
 */
const THUMB_W = 320;

export async function makeThumb(png: Uint8Array<ArrayBuffer>): Promise<string> {
  const blob = new Blob([png], { type: "image/png" });
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { resizeWidth: THUMB_W, resizeQuality: "medium" });
  } catch {
    bmp = await createImageBitmap(blob); // resize options unsupported: scale on the canvas
  }
  const w = THUMB_W, h = Math.max(1, Math.round((bmp.height * THUMB_W) / bmp.width));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const small = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
  canvas.width = canvas.height = 0;
  return URL.createObjectURL(small ?? blob);
}
