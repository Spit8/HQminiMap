/**
 * Display preferences of the map information (Options → Map): pictogram and label sizes, line
 * opacity. Persisted per viewer (localStorage).
 */
const LS = "hq.mapStyle";

export interface MapStyle {
  /** Pictogram size factor (0.6–2). */
  iconScale: number;
  /** Label size factor (0.6–2). */
  textScale: number;
  /** Opacity of the line tracks (0.2–1); a selected line is always opaque. */
  lineOpacity: number;
}

export const MAP_STYLE_DEFAULT: MapStyle = { iconScale: 1, textScale: 1, lineOpacity: 0.75 };

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

function load(): MapStyle {
  try {
    const raw = JSON.parse(localStorage.getItem(LS) ?? "null") as Partial<MapStyle> | null;
    return {
      iconScale: clamp(raw?.iconScale, 0.6, 2, MAP_STYLE_DEFAULT.iconScale),
      textScale: clamp(raw?.textScale, 0.6, 2, MAP_STYLE_DEFAULT.textScale),
      lineOpacity: clamp(raw?.lineOpacity, 0.2, 1, MAP_STYLE_DEFAULT.lineOpacity),
    };
  } catch {
    return { ...MAP_STYLE_DEFAULT };
  }
}

class MapStyleState {
  current = $state<MapStyle>(load());

  set(patch: Partial<MapStyle>): void {
    this.current = { ...this.current, ...patch };
    try {
      localStorage.setItem(LS, JSON.stringify(this.current));
    } catch {
      /* storage unavailable */
    }
  }

  reset(): void {
    this.set({ ...MAP_STYLE_DEFAULT });
  }
}

export const mapStyle = new MapStyleState();
