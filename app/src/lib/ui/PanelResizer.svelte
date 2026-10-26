<script module lang="ts">
  /** Saved width of a resizable panel (localStorage), within [min, max]. */
  export function loadWidth(key: string, fallback: number, min: number, max: number): number {
    try {
      const v = Number(localStorage.getItem(key));
      return Number.isFinite(v) && v > 0 ? Math.min(max, Math.max(min, v)) : fallback;
    } catch {
      return fallback;
    }
  }
</script>

<script lang="ts">
  /**
   * Drag handle on the right edge of a left side panel (place it inside the panel, which must be
   * positioned). Double-click: back to the default width. The width is remembered under `key`.
   */
  let { width = $bindable(), min = 240, max = 640, fallback = 300, key }:
    { width: number; min?: number; max?: number; fallback?: number; key: string } = $props();

  let drag: { x: number; w: number } | null = null;

  function save(): void {
    try {
      localStorage.setItem(key, String(Math.round(width)));
    } catch {
      /* storage unavailable */
    }
  }
  function onDown(e: PointerEvent): void {
    drag = { x: e.clientX, w: width };
    (e.target as Element).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onMove(e: PointerEvent): void {
    if (drag) width = Math.min(max, Math.max(min, drag.w + e.clientX - drag.x));
  }
  function onUp(): void {
    if (!drag) return;
    drag = null;
    save();
  }
</script>

<div class="resizer" role="separator" aria-orientation="vertical" title="⇔"
  onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} onpointercancel={onUp}
  ondblclick={() => { width = fallback; save(); }}></div>

<style>
  .resizer { position: absolute; z-index: 6; top: 0; bottom: 0; right: -4px; width: 8px; cursor: col-resize; touch-action: none; }
  .resizer:hover, .resizer:active { background: linear-gradient(90deg, transparent 3px, var(--accent) 3px, var(--accent) 5px, transparent 5px); }
</style>
