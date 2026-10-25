#!/usr/bin/env python3
"""Offline simulation of the live-data export (mod/content/hqminimap/live_export.lua) with a stubbed
TF3 API: request cadences, the five data files, the teleport command and live_status.

  pip install lupa
  python tools/sim_live.py
"""
from __future__ import annotations

from pathlib import Path

from lupa import lua54 as L

MOD = Path(__file__).resolve().parents[1] / "mod" / "content"


def main() -> None:
    rt = L.LuaRuntime()
    rt.globals().MODDIR = str(MOD).replace("\\", "/")
    rt.execute(r'''
T = 1000
SAVED, WRITES, FOCUS = {}, {}, nil
REQUEST = nil
local function file(p) local f = assert(io.open(MODDIR .. "/" .. p, "r")); local s = f:read("a"); f:close(); return s end
os = { time = function() return T end, clock = function() return T end }
app = {
  saveUserdata = function(d, n, t) SAVED[n] = t; WRITES[n] = (WRITES[n] or 0) + 1 end,
  removeUserdata = function() end,
  loadUserdata = function(d, n) if d == "hqminimap" and n == "live_request" then return REQUEST end end,
  getUserDataFolder = function() return "C:/UD" end,
}
local CT = setmetatable({}, { __index = function(_, k) return k end })
-- Native vector stub (0-based :at, like the engine's).
local function vec(t) return { size = function() return #t end, at = function(_, i) return t[i + 1] end } end
function logbook(logs)
  return { name2log_native = { find = function(_, n) return logs[n] end } }
end
function log(times, values) return { times_native = vec(times), values_native = vec(values) } end
comps = {
  [101] = { TOWN = { initialLandUseCapacities = { 100, 50, 10 } } },
  [301] = { STATION_GROUP = { stations = { 311, 312 } }, NAME = { name = "Gare A" } },
  [311] = { BOUNDING_VOLUME = { bbox = { min = { x = 990, y = 1990 }, max = { x = 1010, y = 2010 } } },
            STATION = { terminals = { { vehicleNodeId = { entity = 3110, index = 0 } } } } },
  [312] = { STATION = { terminals = { { vehicleNodeId = { entity = 3120, index = 2 } } } } },
  -- Only reached by the pathfinding (no vehicle path goes through it).
  [708] = { BASE_EDGE = { position0 = { x = 500, y = 500 }, position1 = { x = 600, y = 500 },
                          tangent0 = { x = 100, y = 0 }, tangent1 = { x = 100, y = 0 } } },
  [701] = { BASE_EDGE = { position0 = { x = 1000, y = 2000 }, position1 = { x = 1100, y = 2100 },
                          tangent0 = { x = 100, y = 100 }, tangent1 = { x = 100, y = 100 } } },
  [702] = {},
  [1001] = { TOWN_BUILDING = {}, BOUNDING_VOLUME = { bbox = { min = { x = 0, y = 0 }, max = { x = 10, y = 10 } } } },
  [1002] = { TOWN_BUILDING = {}, BOUNDING_VOLUME = { bbox = { min = { x = 60, y = 0 }, max = { x = 70, y = 10 } } } },
  [703] = { TRANSPORT_NETWORK = { edges = { { geometry = { type = "STRAIGHT", straight = { pos = { { x = 1100, y = 2100 }, { x = 1120, y = 2100 } } },
              length = 20 } } } } },
  [705] = {},
  -- A crossing: its turn lane must not be drawn.
  [707] = { BASE_NODE = {}, TRANSPORT_NETWORK = { edges = { { geometry = { type = "STRAIGHT",
              straight = { pos = { { x = 1100, y = 2100 }, { x = 1105, y = 2110 } } }, length = 11 } } } } },
  [706] = { BASE_EDGE = { position0 = { x = 2000, y = 2100 }, position1 = { x = 2100, y = 2100 },
                          tangent0 = { x = 100, y = 0 }, tangent1 = { x = 100, y = 0 } } },
  [704] = { BASE_EDGE = { position0 = { x = 1150, y = 2100 }, position1 = { x = 1300, y = 2100 },
                          tangent0 = { x = 100, y = 0 }, tangent1 = { x = 100, y = 0 } } },
  [502] = { NAME = { name = "Bac" }, LINE = { stops = { { stationGroup = 301, station = 0, terminal = 0 } } } },
  -- Same line, the other way along 701.
  [603] = { TRANSPORT_VEHICLE = { carrier = 1, line = 501 }, MOVE_PATH = { path = { edges = { { { entity = 701, index = 0 }, false } } } } },
  [602] = { TRANSPORT_VEHICLE = { carrier = 5, line = 502 },
            MOVE_PATH_AIRCRAFT = { path0 = { edges = {} }, path2 = { edges = {} },
              path1 = { { { type = "CUBIC_SPLINE", length = 500, cubicSpline = { pos = { { x = 0, y = 0 }, { x = 0, y = 500 } },
                tangent = { { x = 0, y = 500 }, { x = 0, y = 500 } } } }, true } } } },
  [201] = { INDUSTRY = { level = 2, stockList = 801 } },
  [801] = { STOCK_LIST = { stocks = { { type = "IN", cargoType = 1, capacity = 100 }, { type = "OUT", cargoType = 2, capacity = 50 } } } },
  [901] = { WAREHOUSE = { stockList = 802, construction = 902 } },
  [802] = { STOCK_LIST = { stocks = { { type = "STORE", cargoType = 2, capacity = 400 } } } },
  [902] = { NAME = { name = "Entrepot A" }, BOUNDING_VOLUME = { bbox = { min = { x = 0, y = 0 }, max = { x = 20, y = 40 } } } },
  [401] = { CONSTRUCTION = { transf = { 1000, 2000 }, fileName = "station/rail/cargo_station.con" } },
  [402] = { CONSTRUCTION = { transf = { 1100, 2100 }, fileName = "station/rail/cargo_station.con" } },
  [501] = { NAME = { name = "Ligne 1" }, COLOR = { color = { x = 0.1, y = 0.5, z = 1 } },
            LINE = { stops = { { stationGroup = 301, station = 0, terminal = 0 }, { stationGroup = 301, station = 1, terminal = 0 } } } },
  [601] = { NAME = { name = "Bus; 1" }, TRANSPORT_VEHICLE = { carrier = 1, line = 501, config = { capacities = { 40, 0, 10 } } },
            MOVE_PATH = { state = 2, dyn = { pathPos = { edgeIndex = 3 } }, path = { edges = { { { entity = 701, index = 0 }, true },
              { { entity = 707, index = 0 }, true }, { { entity = 702, index = 0 }, true },
              { { entity = 704, index = 0 }, true }, { { entity = 703, index = 0 }, true },
              { { entity = 705, index = 0 }, true }, { { entity = 706, index = 0 }, true } } } } },
}
api = {
  type = { ComponentType = CT, Vec2f = { new = function(x, y) return { x = x, y = y } end },
           Vec3f = { new = function(x, y, z) return { x = x, y = y, z = z } end },
           Mat4f = { getTransl = function(m) return { x = m[1], y = m[2], z = 0 } end },
           NodeId = { new = function(e, i) return { entity = e, index = i } end },
           enum = { Carrier = { ROAD = 0, RAIL = 1, TRAM = 2, OTHER = 3, AIR = 4, WATER = 5 },
                    TransportMode = { TRAIN = "TRAIN", ELECTRIC_TRAIN = "ELECTRIC_TRAIN", BUS = "BUS", TRUCK = "TRUCK", CAR = "CAR", TRAM = "TRAM", ELECTRIC_TRAM = "ELECTRIC_TRAM" },
                    StockListType = { InputStock = "IN", OutputStock = "OUT", StorageStock = "STORE" } },
           -- No calcPos: the native helper cannot take the Lua tables getComponent returns.
           EdgeGeometry = { Type = { ARC = "ARC", STRAIGHT = "STRAIGHT", CUBIC_SPLINE = "CUBIC_SPLINE", CUBIC_OFFSET_SPLINE = "CUBIC_OFFSET_SPLINE" } } },
  res = { cargoTypeRep = { getPassengerCargoTypeId = function() return 0 end,
                           getAll = function() return { [0] = "PASSENGERS", [1] = "COAL", [2] = "GOODS" } end,
                           get = function(id) return { name = ({ [0] = "Passagers", [1] = "Charbon", [2] = "Marchandises" })[id] } end } },
  engine = {
    getComponent = function(e, ct) return comps[e] and comps[e][ct] or nil end,
    entityExists = function(e) return comps[e] ~= nil end,
    forEachEntityWithComponent = function(fn, ct)
      if ct == "STATION_GROUP" then fn(301) elseif ct == "WAREHOUSE" then fn(901)
      elseif ct == "TOWN_BUILDING" then fn(1001); fn(1002) end
    end,
    terrain = {
      makeMapFromGame = function() return {
        towns = { { existing = 101, name = "Ville", pos = { x = 10.4, y = 20.6 } } },
        industries = { { existing = 201, tag = "coal_mine", fileName = "::/industries/coal_mine/coal_mine.con", pos = { x = -5, y = 7 } } },
      } end,
      getHeightAt = function() return 12 end,
    },
    util = { getPlayer = function() return 1 end, vehicle = { getPosition = function(v) return { x = 1500.4, y = 2500.6, z = 3 } end },
             station = { isStationOfType = function(st, cargo) return cargo end },
             -- Leg 3110:0 → 3120:2 goes through edge 708; the way back is not found.
             pathfinding = { findPathNodeToNode = function(a, b, modes)
               LEGCALLS = (LEGCALLS or 0) + 1
               if a[1].entity == 3110 and b[1].entity == 3120 and b[1].index == 2 and modes[1] == "TRAIN" then
                 return { { { entity = 708, index = 0 }, true } }
               end
               return {}
             end },
             logbook = { getLogValuePerYear = function(e, n) return n == "itemsTransported" and 1234 or n == "itemsLoaded" and 50 or 70 end } },
    system = {
      lineSystem = { getLinesForPlayer = function() return { 501, 502 } end, getLinesForStationGroup = function() return { 501 } end },
      simEntityAtTerminalSystem = { getLineStopSimEntitiesCount = function(l, k, c) return c == 0 and 3 or 2 end },
      transportVehicleSystem = { getLineVehicles = function(l) return l == 501 and { 601, 603 } or { 602 } end },
      townBuildingSystem = { getLandUsePersonCapacities = function() return { 100, 50, 10 } end },
      simEntityAtVehicleSystem = { getVehicleSimEntitiesCountForCargoType = function(v, c) return c == 0 and 12 or 3 end },
      simEntityAtStockSystem = { getStockCount = function(sl, i) return sl == 801 and (i == 0 and 30 or 12) or 250 end },
      streetConnectorSystem = { getConstructionEntityForStation = function(st) return st == 311 and 401 or 402 end,
        getConstructionEntityForTownBuilding = function(b) return b + 1000 end,
        getConstructionEntityForIndustry = function(i) return i + 2000 end,
        getConstructionClosestTown = function(con) return con == 2001 and 101 or -1 end },
    },
  },
  gui = { camera = { focusPosition = function(p, d) FOCUS = { x = p.x, y = p.y, z = p.z, d = d } end,
                     getCameraData = function() return { x = 1, y = 2 } end } },
}
REACT = { fireEvent = function(src, name, p) OPENED = { name = name, entity = p.entity, stack = p.stack } end }
ug_require = function(p) return assert(load(file(p:gsub("^hqminimap::/", ""))))() end
print = function() end
''')
    live = rt.eval('ug_require("hqminimap::/hqminimap/live_export.lua")')
    g = rt.globals()

    def run(seconds: int, fps: int = 30) -> None:
        for _ in range(seconds):
            for _ in range(fps):
                live.tick(g.REACT)
            g.T = g.T + 1

    run(3)
    assert g.SAVED["live_towns"] is None, "disabled by default (no request)"
    rt.execute('REQUEST = { enabled = true, intervals = { towns = 10, industries = 10, stations = 5, lines = 5, vehicles = 1, stats = 5, routes = 5, stocks = 5, townAreas = 5, history = 5 } }')
    rt.execute('comps[501].LOG_BOOK = logbook({ itemsTransported = log({ 1000, 2000, 3000 }, { 10, 25, 45 }) })')
    rt.execute('comps[301].LOG_BOOK = logbook({ itemsLoaded = log({ 1000 }, { 7 }) })')
    run(20)
    w = g.WRITES
    counts = {k: w[k] for k in ("live_towns", "live_industries", "live_stations", "live_lines", "live_vehicles", "live_status")}
    print("writes over 20 s:", counts)
    assert 2 <= counts["live_towns"] <= 3 and counts["live_vehicles"] >= 15 and counts["live_stations"] >= 3
    s = g.SAVED
    town = s["live_towns"].towns[1]
    st = s["live_stations"].stations[1]
    ln = s["live_lines"].lines[1]
    print("town:", town.name, town.x, town.y, town.size)
    print("station:", st.name, st.x, st.y, st.mode, st.cargo)
    print("line:", ln.name, ln.r, ln.g, ln.b, len(ln.stops), "carrier", ln.carrier)
    print("vehicles:", s["live_vehicles"].v, s["live_vehicles"].n)
    assert (town.x, town.y, town.size) == (10, 21, 160)
    # 311: bounding volume centre (1000, 2000); 312: construction transform (1100, 2100)
    assert (st.x, st.y, st.mode, st.cargo, st.passengers) == (1050, 2050, "rail", True, False), (st.x, st.y, st.mode)
    stats = s["live_stats"]
    sl, ss = stats.lines[1], stats.stations[1]
    print("stats line:", sl.transported, sl.waitP, sl.waitC, "station:", ss.id, ss.loaded, ss.unloaded, ss.waitP, ss.waitC)
    assert (sl.transported, sl.waitP, sl.waitC) == (1234, 6, 8) and (ss.loaded, ss.unloaded, ss.waitP) == (50, 70, 9)
    routes = s["live_routes"]
    print("routes:", routes.edges, "| line 501:", routes.lines[1].e, routes.lines[1].p, "| ship:", routes.lines[2].p)
    # Signed ids: 701 both ways (601 along it, 603 against it); 708 from the pathfinding.
    assert routes.lines[1].e == "701,-701,704,706,708", routes.lines[1].e
    # 702 unreadable: bridged 701 end (1100, 2100) → 704 start (1150, 2100), 50 m; 703 is a lane;
    # 705 unreadable but the gap 703 end (1120) → 706 start (2000) is 880 m: left open, no diagonal.
    assert routes.lines[1].p == "1100,2100,1150,2100|1100,2100,1120,2100", routes.lines[1].p
    ship = routes.lines[2].p.split(",")
    assert ship[:2] == ["0", "0"] and ship[-2:] == ["0", "500"] and len(ship) == 2 * 11, ship
    st2 = s["live_status"]
    print("diag:", st2.routes.missing, st2.routes.bridges, st2.routes.lanes, st2.routes.free, "warn:", st2.jobs.routes.warn)
    assert st2.routes.bridges == 1 and st2.routes.bigGaps == 1 and st2.routes.lanes == 1 and st2.routes.free == 1 and st2.jobs.routes.warn
    lg = st2.routes.legs
    print("legs:", lg.computed, lg.cached, lg.failed, "calls", g.LEGCALLS)
    assert lg.failed == 1 and (lg.computed + lg.cached) >= 1
    ps = st2.routes.pathStats
    print("nodes:", st2.routes.nodes, "pathStats:", ps.paths, ps.edgesAvg, ps.edgesMax, ps.edgeIndexAvg, dict(ps.states))
    assert st2.routes.nodes == 1 and ps.edgesMax == 7 and ps.edgeIndexAvg == 3
    print("samples:", list(st2.routes.samples.values()))
    stocks = s["live_stocks"]
    si, sw = stocks.industries[1], stocks.warehouses[1]
    print("stocks:", si.id, [(x.kind, x.cargo, x.n, x.cap) for x in si.s.values()], sw.name, sw.x, sw.y, sw.s[1].n)
    assert [(x.kind, x.n) for x in si.s.values()] == [("in", 30), ("out", 12)] and (sw.name, sw.x, sw.y, sw.s[1].n) == ("Entrepot A", 10, 20, 250)
    assert w["live_routes"] == 1, "unchanged routes are not rewritten"
    assert s["live_status"].jobs.stations.warn is None
    # 601: passengers 12 / 40, cargo 3 / 10; 602 has no config: unknown
    assert s["live_vehicles"].v.startswith("601,501,1500,2501,12,40,3,10,Bus  1;603,501,1500,2501,-1,-1,-1,-1,;602,502,1500,2501,-1,-1,-1,-1,"), s["live_vehicles"].v
    ta = s["live_townAreas"].towns[1]
    print("town area:", ta.id, ta.cells, ta.pop)
    assert (ta.id, ta.cells, ta.pop) == (101, "0,0;3,0", 160)
    hist = s["live_history"]
    print("history:", hist.lines[1].tr, hist.stations[1].ld, "|", hist.stations[1].ul, "| diag", s["live_status"].history.n)
    assert hist.lines[1].tr == "1000,10;2000,25;3000,45" and hist.stations[1].ld == "1000,7" and hist.stations[1].ul == ""
    assert s["live_status"].format == 8
    rt.execute('REQUEST.cmd = { seq = 1, action = "teleport", x = 300, y = -400, dist = 900 }')
    run(2)
    f = g.FOCUS
    status = s["live_status"]
    print("teleport:", f.x, f.y, f.z, f.d, "status seq", status.lastCmdSeq, "ok", status.cmd.ok)
    assert (f.x, f.y, f.z, f.d) == (300, -400, 12, 900) and status.lastCmdSeq == 1 and status.cmd.ok
    g.FOCUS = None
    run(2)
    assert g.FOCUS is None, "a command runs once"
    # Double-click on an object: camera + its in-game window (industry → construction, warehouse →
    # construction, vehicle → itself); open = false: camera only.
    for seq, kind, oid, want in ((2, "industries", 201, 2201), (3, "warehouses", 901, 902), (4, "vehicles", 601, 601)):
        g.OPENED = None
        rt.execute(f'REQUEST.cmd = {{ seq = {seq}, action = "focus", x = 10, y = 20, dist = 500, kind = "{kind}", id = {oid}, open = true }}')
        run(2)
        o = g.OPENED
        print("focus", kind, "->", o and o.name, o and o.entity, "ok", s["live_status"].cmd.ok)
        assert o and o.name == "selectEntity" and o.entity == want and s["live_status"].cmd.ok
    g.OPENED = None
    rt.execute('REQUEST.cmd = { seq = 5, action = "focus", x = 1, y = 2, kind = "lines", id = 501, open = false }')
    run(2)
    assert g.OPENED is None and g.FOCUS.x == 1 and s["live_status"].cmd.ok
    print("OK")


if __name__ == "__main__":
    main()
