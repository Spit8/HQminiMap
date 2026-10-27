#!/usr/bin/env python3
"""Offline simulation of the HQminiMap mod (lupa): export + full capture against a stubbed TF3 API.

Serves a capture plan through app.loadUserdata (as the app writes it: capture_plan.lua) and plays
its cutscene frame by frame at 60 fps; checks one screenshot per tile in capture order, lighting
restored, capture_index written; then runs the export. --short N plays a cutscene of N tiles only
(plan/cutscene mismatch): the capture must end in an explicit error.

  pip install lupa
  python tools/sim_mod.py <capture_plan.lua | mosaic_plan.lua> [--short N] [--lang fr|en|de|it|es|zh] [--fps N]
"""
from __future__ import annotations

import sys
from pathlib import Path

from lupa import lua54 as L

MOD = Path(__file__).resolve().parents[1] / "mod" / "content"


def main() -> None:
    plan_src = Path(sys.argv[1]).read_text(encoding="utf-8")
    short = int(sys.argv[sys.argv.index("--short") + 1]) if "--short" in sys.argv else None
    lang = sys.argv[sys.argv.index("--lang") + 1] if "--lang" in sys.argv else "fr"
    # Game frame rate: the mod's waits must not depend on it (they are in seconds).
    fps = int(sys.argv[sys.argv.index("--fps") + 1]) if "--fps" in sys.argv else 60
    rt = L.LuaRuntime()
    rt.globals().PLAN_SRC = plan_src
    rt.globals().SHORT = short
    rt.globals().LANG = lang
    rt.globals().MODDIR = str(MOD).replace("\\", "/")
    rt.execute(r'''
SIM = { t = nil, shots = 0, saves = {}, logs = {}, cmds = {}, env = { atmosphere = { cloudCoverage = 0.4, timeOfDaySec = 50000, dayOfYear = 80 } } }
local function noop() end
local function file(p) local f = assert(io.open(MODDIR .. "/" .. p, "r")); local s = f:read("a"); f:close(); return s end
-- Userdata format (function data() ... end) or a bare plan chunk (return M).
local chunk = assert(load(PLAN_SRC))
PLAN = chunk() or data()
local CUT_LEN = (SHORT or PLAN.nX * PLAN.nY) * PLAN.segDur
local function deep(t) if type(t) ~= "table" then return t end local o = {} for k, v in pairs(t) do o[k] = deep(v) end return o end
api = {
  type = { Vec2f = { new = function(x, y) return { x = x, y = y } end },
           Vec5f = { new = function(...) return { ... } end },
           ComponentType = { GAME_TIME = 1, GAME_SCRIPT = 2 } },
  engine = {
    terrain = {
      getBoundingBox = function() return { min = { x = -1000, y = -500 }, max = { x = 1000, y = 500 } } end,
      getHeightAt = function(p) return 10 + 0.01 * p.x end,
      isOnWater = function(p) return p.x < -900 end,
      makeMapFromGame = function() return { numTilesX = 2, numTilesY = 1, waterLevel = 5, climateId = "::/climates/temperate/temperate.clima.lua", offsetZ = 0 } end,
    },
    util = { getWorld = function() return 1 end },
    getComponent = function(_, ct) if ct == 1 then return { timeOfDaySec = 50000 } end return { state = { timeOfDayMode = "Normal" } } end,
    system = { gameScriptSystem = { getEntityForGameScript = function() return 7 end } },
  },
  gui = {
    rendering = { getEnvironment = function() return deep(SIM.env) end, setEnvironment = function(e) SIM.env = deep(e) end },
    mission = {
      playCutscene = function(path) SIM.t = 0; SIM.played = path end,
      isCutscenePlaying = function() return SIM.t ~= nil and SIM.t < CUT_LEN end,
      getCutsceneElapsedTime = function() return SIM.t end,
      stopCutscene = function() SIM.t = nil end,
    },
    camera = {
      takeScreenshot = function() SIM.shots = SIM.shots + 1; SIM.lastShotT = SIM.t end,
      getCameraData = function() return { x = 1, y = 2, z = 3000, w = 0, q = 1 } end,
      setCameraData = function(v) SIM.camRestored = v end,
      getEye = function() return { x = 0, y = 0, z = PLAN.zEye } end,
    },
  },
  util = { getLanguage = function() return { code = LANG, name = "sim" } end },
  cmd = setmetatable({ sendCommand = function(c) SIM.cmds[#SIM.cmds + 1] = c end },
    { __index = function(_, k) return function(...) return { k, ... } end end }),
}
app = {
  saveUserdata = function(dir, name, tbl) SIM.saves[dir .. "/" .. name] = tbl end,
  removeUserdata = noop,
  -- Re-read at each call (like the game); only the capture plan exists in this simulation.
  loadUserdata = function(dir, name)
    if dir == "hqminimap" and name == "capture_plan" then SIM.planLoads = (SIM.planLoads or 0) + 1; return PLAN end
    if dir == "hqminimap" and name == "live_request" then return REQUEST end
    return nil
  end,
  getUserDataFolder = function() return "C:/UD" end,
}
-- Wall clock: advanced by the frame loop (SIM.wall, seconds).
os = { time = function() return 1800000000 + math.floor(SIM.wall or 0) end }
print = function(s) SIM.logs[#SIM.logs + 1] = tostring(s) end
local cache = {}
ug_require = function(p)
  if cache[p] then return cache[p] end
  local r
  if p == "hqminimap::/hqminimap/mosaic_plan.lua" then error("plan must come from loadUserdata")
  else r = assert(load(file(p:gsub("^hqminimap::/", ""))))() end
  cache[p] = r
  return r
end
''')
    h = rt.eval('ug_require("hqminimap::/gui/hqminimap_gui.handlers.lua")')
    react = rt.eval("{ onStep = function(f) SIM.step = f end, onUnmount = function() end }")
    state = rt.eval("""function(v) local s = { v = v } function s:old() return self.v end
                       function s:set(x) self.v = x end return s end""")
    progress, status = state(0), state("Prêt")
    h.bindWindow(react, progress, status)
    sim = rt.eval("SIM")
    wall0 = sim.wall or 0
    while (sim.wall or 0) - wall0 < 2:  # the new grid is announced on the wall clock (~1.5 s)
        sim.step()
        sim.wall = (sim.wall or 0) + 1 / fps
    announced = status.old(status)
    print(f"  idle status='{announced}'")
    # Expected texts come from the mod's own table for the game language (fr, en, de, it, es, zh).
    i18n = rt.eval('ug_require("hqminimap::/hqminimap/i18n.lua")')
    assert i18n.language() == lang, f"mod language {i18n.language()} instead of {lang}"
    expect = lambda key: str(i18n.t(key)).split("%")[0].strip()
    assert expect("status_new_plan") in announced, announced
    sim.planLoads = 0
    # The app starts the scan (live_request cmd "scan"); the mod button's pump runs it, window closed.
    h.buttonIcon(rt.eval("{ onStep = function(f) SIM.btnStep = f end }"))
    # A scan left in the request by an older app (no time stamp), or sent long ago: never run.
    capture0 = rt.eval('ug_require("hqminimap::/hqminimap/capture.lua")')
    for stale in ('{ seq = 1, action = "scan" }', '{ seq = 2, action = "scan", at = 1799990000 }'):
        rt.execute(f'REQUEST = {{ cmd = {stale} }}')
        end = (sim.wall or 0) + 1  # the mod re-reads the request on the wall clock, not every frame
        while (sim.wall or 0) < end:
            sim.btnStep()
            sim.wall = (sim.wall or 0) + 1 / fps
        assert not capture0.isBusy() and sim.saves["hqminimap/live_status"].cmd.error == "stale", "stale scan ran"
    print("  stale scan commands dropped")
    sim.planLoads = 0  # the idle pump re-read the plan meanwhile
    rt.execute('REQUEST = { cmd = { seq = 3, action = "scan", at = 1800000000 } }')
    if "--skip" in sys.argv:
        # Jump the cutscene past the first hold: the scan must stop at once with "skipped image".
        rt.execute('REQUEST = { cmd = { seq = 3, action = "scan", at = 1800000000 } }')
        capture = rt.eval('ug_require("hqminimap::/hqminimap/capture.lua")')
        frames = 0
        while (not capture.isBusy() or sim.t is None) and frames < 8000:
            sim.btnStep()
            frames += 1
            sim.wall = (sim.wall or 0) + 1 / fps
        assert sim.t is not None, "cutscene did not start"
        sim.t = float(rt.eval("PLAN.segDur"))
        sim.btnStep()
        idx = sim.saves["hqminimap/capture_index"]
        print(f"  skipped: busy={capture.isBusy()} error={idx.error}")
        assert not capture.isBusy() and idx.error and expect("err_skipped") in idx.error, idx.error
        print("OK")
        return
    frames = 0
    capture = rt.eval('ug_require("hqminimap::/hqminimap/capture.lua")')
    started = sim.wall or 0
    while (capture.isBusy() or frames < 40 or (sim.wall or 0) - started < 1) and frames < 100000:
        sim.btnStep()
        frames += 1
        sim.wall = (sim.wall or 0) + 1 / fps
        if sim.t is not None:
            sim.t = sim.t + 1 / fps
    ls = sim.saves["hqminimap/live_status"]
    print(f"  scan command: seq={ls.cmd.seq} ok={ls.cmd.ok} error={ls.cmd.error}")
    assert ls.cmd.seq == 3 and ls.cmd.ok
    n = int(rt.eval("PLAN.nX * PLAN.nY * PLAN.pitchCount"))
    idx = sim.saves["hqminimap/capture_index"]
    tiles = [idx.tiles[i] for i in range(1, len(idx.tiles) + 1)]
    print(f"capture: frames={frames} shots={sim.shots}/{n} index.shots={idx.shotsTaken} error={idx.error}")
    print(f"  status='{status.old(status)}' progress={progress.old(progress)} played={sim.played}")
    print(f"  lighting restored: clouds={sim.env.atmosphere.cloudCoverage} tod={sim.env.atmosphere.timeOfDaySec} day={sim.env.atmosphere.dayOfYear} cam={sim.camRestored is not None}")
    order = [(t.ix, t.iy) for t in tiles]
    exp = [(i % int(rt.eval('PLAN.nX')), i // int(rt.eval('PLAN.nX'))) for i in range(n)]
    print(f"  capture order ok={order == exp} seqs={[t.seq for t in tiles][:8]}... elapsed={[round(t.elapsedAtShot, 3) for t in tiles][:4]}")
    st = [idx.shotTimes[i] for i in range(1, len(idx.shotTimes) + 1)]
    print(f"  shotTimes={st[:3]}... n={len(st)} planLoads={sim.planLoads} planStamp={idx.planStamp}")
    if short is not None:
        assert sim.shots == short and idx.error and expect("err_mismatch") in idx.error, idx.error
        print(f"  mismatch detected: '{idx.error}'")
        print("OK")
        return
    assert sim.shots == n and order == exp and idx.error is None and len(st) == n and sim.planLoads == 1
    h.onExport()
    m = sim.saves["hqminimap/map"]
    hm = sim.saves["hqminimap/heightmap"]
    print(f"export: status='{status.old(status)}' map.bounds={m.bounds.width}x{m.bounds.height} cells={len(m.terrain.cells)} "
          f"heightmap n={hm.n} row1[1]={hm.rows[1][1]} exportedAt={m.exportedAt}")
    print("OK")


if __name__ == "__main__":
    main()
