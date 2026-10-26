/**
 * Display preferences of the map information (Options → Map): pictogram and label sizes, line
 * width and opacity. Persisted per viewer (localStorage).
 */
const LS = "hq.mapStyle";

export interface MapStyle {
  /** Pictogram size factor (0.6–2). */
  iconScale: number;
  /** Label size factor (0.6–2). */
  textScale: number;
  /** Width factor of the line tracks (0.5–3); they also thicken by themselves when zoomed in close. */
  lineWidth: number;
  /** Opacity of the line tracks (0.2–1); a selected line is always opaque. */
  lineOpacity: number;
  /** Double-click on an object also opens its in-game window (else: camera only). */
  openInGame: boolean;
  /** Load shown on the vehicle pictograms. */
  vehicleBadge: VehicleBadge;
}

export type VehicleBadge = "none" | "pax" | "freight" | "both";
export const VEHICLE_BADGES: VehicleBadge[] = ["none", "pax", "freight", "both"];

export const MAP_STYLE_DEFAULT: MapStyle = {
  iconScale: 1.1, textScale: 1, lineWidth: 1.3, lineOpacity: 0.75, openInGame: true, vehicleBadge: "none",
};
/** Settings format: 2 = larger default icons (1 → 1.1) and the line width. */
const VERSION = 2;

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** Saved settings → valid style (bounds, defaults; version 1 kept the old default icon size 1). */
export function parseMapStyle(raw: (Partial<MapStyle> & { v?: number }) | null): MapStyle {
  const oldDefaultIcons = raw && !raw.v && raw.iconScale === 1;
  return {
    iconScale: oldDefaultIcons ? MAP_STYLE_DEFAULT.iconScale : clamp(raw?.iconScale, 0.6, 2, MAP_STYLE_DEFAULT.iconScale),
    textScale: clamp(raw?.textScale, 0.6, 2, MAP_STYLE_DEFAULT.textScale),
    lineWidth: clamp(raw?.lineWidth, 0.5, 3, MAP_STYLE_DEFAULT.lineWidth),
    lineOpacity: clamp(raw?.lineOpacity, 0.2, 1, MAP_STYLE_DEFAULT.lineOpacity),
    openInGame: typeof raw?.openInGame === "boolean" ? raw.openInGame : MAP_STYLE_DEFAULT.openInGame,
    vehicleBadge: VEHICLE_BADGES.includes(raw?.vehicleBadge as VehicleBadge) ? raw!.vehicleBadge! : MAP_STYLE_DEFAULT.vehicleBadge,
  };
}

function load(): MapStyle {
  try {
    return parseMapStyle(JSON.parse(localStorage.getItem(LS) ?? "null"));
  } catch {
    return { ...MAP_STYLE_DEFAULT };
  }
}

class MapStyleState {
  current = $state<MapStyle>(load());

  set(patch: Partial<MapStyle>): void {
    this.current = { ...this.current, ...patch };
    try {
      localStorage.setItem(LS, JSON.stringify({ ...this.current, v: VERSION }));
    } catch {
      /* storage unavailable */
    }
  }

  reset(): void {
    this.set({ ...MAP_STYLE_DEFAULT });
  }
}

export const mapStyle = new MapStyleState();
