import { describe, expect, it } from "vitest";
import { applyFilters, DEFAULT_FILTERS, fold, hiddenKey, normalizeFilters, type FilterState, type LiveData } from "../src/lib/core/filters";

const data: LiveData = {
  towns: [{ id: 1, name: "Évreux", x: 0, y: 0, size: 300 }, { id: 2, name: "Caen", x: 0, y: 0, size: 80 }],
  industries: [
    { id: 10, type: "coal_mine", file: "", level: 1, x: 0, y: 0 },
    { id: 11, type: "steel_mill", file: "", level: 2, x: 0, y: 0 },
  ],
  stations: [
    { id: 20, name: "Évreux Gare", x: 0, y: 0, mode: "rail", cargo: false, passengers: true, traffic: { loaded: 500, unloaded: 500, waitP: 3, waitC: 0 } },
    { id: 21, name: "Caen Fret", x: 0, y: 0, mode: "road", cargo: true, passengers: false },
  ],
  lines: [
    { id: 30, name: "Ligne 1", color: null, stops: [{ g: 1, x: 0, y: 0 }, { g: 2, x: 1, y: 1 }], vehicles: 1, carrier: 1, mode: "rail", traffic: { transported: 900, waitP: 0, waitC: 0 } },
    { id: 31, name: "Ligne 2", color: null, stops: [{ g: 1, x: 0, y: 0 }, { g: 2, x: 1, y: 1 }], vehicles: 1, carrier: 0, mode: "road" },
  ],
  warehouses: [
    { id: 50, name: "Dépôt Nord", x: 0, y: 0, stocks: [{ cargo: 2, kind: "store", n: 250, cap: 400 }] },
    { id: 51, name: "Dépôt Sud", x: 0, y: 0, stocks: [] },
  ],
  vehicles: [{ id: 40, line: 30, x: 0, y: 0, pax: { n: 12, cap: 40 }, freight: null, name: "Bus 1" }, { id: 41, line: 31, x: 0, y: 0, pax: null, freight: null, name: "" }],
};
const f = (patch: Partial<FilterState>): FilterState => ({ ...structuredClone(DEFAULT_FILTERS), ...patch });
const ids = (d: LiveData) => ({
  t: d.towns.map((x) => x.id), i: d.industries.map((x) => x.id), s: d.stations.map((x) => x.id),
  l: d.lines.map((x) => x.id), v: d.vehicles.map((x) => x.id), w: d.warehouses.map((x) => x.id),
});

describe("filters", () => {
  it("default shows everything", () => {
    expect(ids(applyFilters(data, DEFAULT_FILTERS))).toEqual({ t: [1, 2], i: [10, 11], s: [20, 21], l: [30, 31], v: [40, 41], w: [50, 51] });
  });
  it("layer switches and hidden objects", () => {
    const r = applyFilters(data, f({ layers: { ...DEFAULT_FILTERS.layers, towns: false }, hidden: [hiddenKey("stations", 21)] }));
    expect(ids(r).t).toEqual([]);
    expect(ids(r).s).toEqual([20]);
  });
  it("search ignores case and accents", () => {
    expect(fold("Évreux")).toBe("evreux");
    const r = applyFilters(data, f({ search: "evreux" }));
    expect(ids(r).t).toEqual([1]);
    expect(ids(r).s).toEqual([20]);
    expect(ids(r).i).toEqual([]);
  });
  it("per-type criteria", () => {
    const r = applyFilters(data, f({ townMinSize: 100, industryTypes: ["steel_mill"], stationModes: ["road"], stationKind: "cargo" }));
    expect(ids(r)).toMatchObject({ t: [1], i: [11], s: [21] });
  });
  it("vehicles follow the line selection", () => {
    expect(ids(applyFilters(data, f({ lineIds: [31] }))).v).toEqual([41]);
    expect(ids(applyFilters(data, f({ lineIds: [31], vehiclesFollowLines: false }))).v).toEqual([40, 41]);
    expect(ids(applyFilters(data, f({ hidden: [hiddenKey("lines", 30)] }))).v).toEqual([41]);
  });
  it("traffic and line mode filters", () => {
    expect(ids(applyFilters(data, f({ stationMinTraffic: 100 }))).s).toEqual([20]);
    expect(ids(applyFilters(data, f({ stationKind: "passengers" }))).s).toEqual([20]);
    const r = applyFilters(data, f({ lineModes: ["road"] }));
    expect(ids(r).l).toEqual([31]);
    expect(ids(r).v).toEqual([41]);
    expect(ids(applyFilters(data, f({ lineMinTransported: 500 }))).l).toEqual([30]);
  });
  it("stock filter on warehouses and industries", () => {
    const r = applyFilters(data, f({ stockMin: 100 }));
    expect(ids(r).w).toEqual([50]);
    expect(ids(r).i).toEqual([]);
  });
  it("inactive lines are hidden by default", () => {
    const idle = { ...data, lines: [...data.lines, { id: 32, name: "Vide", color: null, stops: [], vehicles: 0, carrier: null, mode: "road" as const }] };
    expect(ids(applyFilters(idle, DEFAULT_FILTERS)).l).toEqual([30, 31]);
    expect(ids(applyFilters(idle, f({ showInactiveLines: true }))).l).toEqual([30, 31, 32]);
  });
  it("migrates the old traffic-label switch", () => {
    const n = normalizeFilters({ showTraffic: true, labels: { towns: false } } as unknown as Partial<FilterState>);
    expect(n.labels.stations).toBe(true);
    expect(n.labels.towns).toBe(false);
    expect("showTraffic" in n).toBe(false);
  });
  it("normalizes saved configurations", () => {
    const n = normalizeFilters({ search: "x", layers: { towns: false } as FilterState["layers"] });
    expect(n.search).toBe("x");
    expect(n.layers).toEqual({ ...DEFAULT_FILTERS.layers, towns: false });
    expect(n.stationModes).toEqual(DEFAULT_FILTERS.stationModes);
    expect(n.lineModes).toEqual(DEFAULT_FILTERS.lineModes);
    expect(n.stationMinTraffic).toBe(0);
  });
});
