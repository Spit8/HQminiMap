-- x1 mosaic capture: plays the CameraFrame cutscenes written by the HQminiMap app
-- (cutscenes/mosaic_run_pXX.lua, one per pitch — pitch is frozen per playCutscene) and takes one
-- screenshot per tile hold. Lattice and timings come from mosaic_plan.lua. Progress is written
-- to <userdata>/hqminimap/capture_index.lua, which the app uses to collect the screenshots.
-- Driven by tick() from the GUI window pump (react.onStep).

local io_util = ug_require "hqminimap::/hqminimap/io_util.lua"
local settings = ug_require "hqminimap::/hqminimap/settings.lua"
local i18n = ug_require "hqminimap::/hqminimap/i18n.lua"

local M = {}

local PLAN_USERDATA = "capture_plan"
local PLAN_PATH = "hqminimap::/hqminimap/mosaic_plan.lua"
local CUTSCENE_PREFIX = "hqminimap::/hqminimap/cutscenes/mosaic_run_p"
local SCREENSHOT_SCALE = 1
-- Fallback timings (the plan always provides them).
-- Defaults when the plan does not say (the app writes them): 1.25 s per tile, shot at 0.3125 s.
local SEG_DUR = 1.25
local SHOT_OFFSET = 0.3125
local ENV_SETTLE_SEC = 2
-- Waits are in wall-clock seconds (io_util.nowUnix, whole seconds), never in frames: the game may run
-- at 30 or 240 fps. A cutscene may last its length plus PLAY_MARGIN_SEC, at least MIN_MAX_WAIT_SEC.
local MIN_MAX_WAIT_SEC = 60
local PLAY_MARGIN_SEC = 10
-- playCutscene must report playing within this many seconds.
local PLAY_START_SEC = 3
-- Capture lighting defaults (the plan overrides them): sun away from zenith = no water glint.
local DEFAULT_TIME_SEC = 36000
local DEFAULT_DAY_OF_YEAR = 171
local DEFAULT_CALENDAR_SPEED = 4000

local job = nil
local ticking = false
local captureLight = { timeSec = DEFAULT_TIME_SEC, day = DEFAULT_DAY_OF_YEAR }

-- ---------------------------------------------------------------- lighting

local function getCloudCoverage()
	local ok, v = pcall(function()
		return api.gui.rendering.getEnvironment().atmosphere.cloudCoverage
	end)
	if ok and type(v) == "number" then
		return v
	end
	-- The environment read can fail; the WORLD component carries the same coverage.
	local okW, w = pcall(function()
		return api.engine.getComponent(api.engine.util.getWorld(), api.type.ComponentType.WORLD)
	end)
	if okW and w and type(w.cloudCoverage) == "number" then
		return w.cloudCoverage
	end
	return nil
end

local function setCloudCoverage(value)
	if type(value) ~= "number" then
		return
	end
	pcall(function()
		local e = api.gui.rendering.getEnvironment()
		e.atmosphere.cloudCoverage = value
		api.gui.rendering.setEnvironment(e)
	end)
	pcall(function()
		api.cmd.sendCommand(api.cmd.makeScriptingSendEventCmd("", "CloudCoverage", "OnManualCloudCoverageChanged", value))
	end)
	pcall(function()
		api.cmd.sendCommand(api.cmd.makeGameSetCloudCoverageCmd(value))
	end)
end

local function setTimeOfDaySec(sec)
	if type(sec) ~= "number" then
		return
	end
	sec = math.floor(sec + 0.5)
	pcall(function()
		local e = api.gui.rendering.getEnvironment()
		e.atmosphere.timeOfDaySec = sec
		api.gui.rendering.setEnvironment(e)
	end)
	-- The command is what actually moves the sun (env field alone is not enough).
	pcall(function()
		api.cmd.sendCommand(api.cmd.makeGameSetTimeOfDayCmd(sec))
	end)
end

local function setTimeOfDayMode(mode)
	if mode == nil then
		return
	end
	pcall(function()
		api.cmd.sendCommand(api.cmd.makeScriptingSendEventCmd("", "GameTime", "SetMode", { mode = mode }))
	end)
end

local function setCalendarSpeed(millisPerDay)
	if type(millisPerDay) ~= "number" then
		return
	end
	pcall(function()
		api.cmd.sendCommand(api.cmd.makeGameSetCalendarSpeedCmd(math.floor(millisPerDay + 0.5)))
	end)
end

local function setDayOfYear(day)
	if type(day) ~= "number" then
		return
	end
	pcall(function()
		local e = api.gui.rendering.getEnvironment()
		e.atmosphere.dayOfYear = day
		api.gui.rendering.setEnvironment(e)
	end)
end

local function setSpeedup(speedup)
	if type(speedup) ~= "number" then
		return
	end
	pcall(function()
		api.cmd.sendCommand(api.cmd.makeGameSetSpeedCmd(math.floor(speedup + 0.5)))
	end)
end

--- Lighting / time state to restore after the capture.
local function lightingSnapshot()
	local snap = { cloud = getCloudCoverage() }
	pcall(function()
		local e = api.gui.rendering.getEnvironment()
		snap.timeOfDaySec = e.atmosphere.timeOfDaySec
		snap.dayOfYear = e.atmosphere.dayOfYear
	end)
	pcall(function()
		local gt = api.engine.getComponent(api.engine.util.getWorld(), api.type.ComponentType.GAME_TIME)
		if gt and type(gt.timeOfDaySec) == "number" then
			snap.timeOfDaySec = gt.timeOfDaySec
		end
	end)
	pcall(function()
		local ent = api.engine.system.gameScriptSystem.getEntityForGameScript("::/game_mechanics/game_time/game_time.gs")
		local gs = api.engine.getComponent(ent, api.type.ComponentType.GAME_SCRIPT)
		if gs and gs.state and gs.state.timeOfDayMode ~= nil then
			snap.timeOfDayMode = gs.state.timeOfDayMode
		end
	end)
	pcall(function()
		local sp = api.engine.getComponent(api.engine.util.getWorld(), api.type.ComponentType.GAME_SPEED)
		if sp then
			if type(sp.millisPerDay) == "number" then
				snap.millisPerDay = sp.millisPerDay
			end
			if type(sp.speedup) == "number" then
				snap.speedup = sp.speedup
			end
		end
	end)
	for _, key in ipairs({ "cloud", "timeOfDaySec", "dayOfYear", "timeOfDayMode", "millisPerDay", "speedup" }) do
		if snap[key] == nil then
			io_util.log("WARN lighting snapshot missing " .. key)
		end
	end
	return snap
end

--- Clouds 0, capture time of day frozen (Constant mode, calendar stopped).
local function applyCaptureLighting()
	setCloudCoverage(0)
	setTimeOfDaySec(captureLight.timeSec)
	setTimeOfDayMode("Constant")
	setCalendarSpeed(0)
	setDayOfYear(captureLight.day)
end

local function restoreLighting(snap)
	if snap == nil then
		return
	end
	setCloudCoverage(snap.cloud)
	setTimeOfDaySec(snap.timeOfDaySec)
	setTimeOfDayMode(snap.timeOfDayMode)
	if type(snap.millisPerDay) == "number" then
		setCalendarSpeed(snap.millisPerDay)
	else
		setCalendarSpeed(snap.calendarSpeed or DEFAULT_CALENDAR_SPEED)
	end
	setSpeedup(snap.speedup)
	setDayOfYear(snap.dayOfYear)
end

-- ---------------------------------------------------------------- helpers

local function readCam()
	local ok, c = pcall(function()
		return api.gui.camera.getCameraData()
	end)
	if not ok or c == nil then
		return nil
	end
	return { x = c.x, y = c.y, z = c.z, w = c.w, q = c.q }
end

local function applyCam(c)
	pcall(function()
		api.gui.camera.setCameraData(api.type.Vec5f.new(c.x, c.y, c.z, c.w, c.q))
	end)
end

local function readEye()
	local ok, e = pcall(function()
		return api.gui.camera.getEye()
	end)
	if not ok or e == nil then
		return nil
	end
	return { x = e.x, y = e.y, z = e.z }
end

local function isCutscenePlaying()
	local ok, playing = pcall(function()
		return api.gui.mission.isCutscenePlaying()
	end)
	return ok and playing == true
end

local function cutsceneElapsed()
	local ok, t = pcall(function()
		return api.gui.mission.getCutsceneElapsedTime()
	end)
	return (ok and type(t) == "number") and t or nil
end

--- Display order used by the app to name tiles (tile_pPP_SSS).
local function displaySeq(ix, iy, nX, nY)
	return (nX - 1 - ix) * nY + (nY - 1 - iy) + 1
end

--- Capture plan written by the app (<userdata>/hqminimap/capture_plan.lua), re-read at each call
--- with app.loadUserdata — unlike ug_require, which keeps a stale copy until the save is reloaded
--- while the cutscene files themselves are re-read. Returns the plan or nil + reason.
function M.loadPlan()
	local plan = io_util.loadTable(PLAN_USERDATA)
	if plan == nil then
		-- Last resort (app.loadUserdata unavailable): plan shipped in the mod (cached by the game).
		local ok, p = pcall(function()
			return ug_require(PLAN_PATH)
		end)
		plan = ok and type(p) == "table" and p or nil
	end
	if plan == nil then
		return nil, i18n.t("err_no_plan")
	end
	if type(plan.nX) ~= "number" or plan.nX < 1 or type(plan.nY) ~= "number" or plan.nY < 1
		or type(plan.centers) ~= "table" or type(plan.zEye) ~= "number" then
		return nil, i18n.t("err_plan_invalid")
	end
	local pitches = {}
	local n = math.max(1, math.floor(tonumber(plan.pitchCount) or 1))
	for i = 1, n do
		pitches[i] = (type(plan.pitches) == "table" and tonumber(plan.pitches[i])) or settings.CAMERAFRAME_NADIR_PITCH
	end
	plan.pitches = pitches
	plan.pitchCount = n
	return plan
end

-- ---------------------------------------------------------------- index

local function buildIndex(j, err, finished)
	return {
		version = 1,
		source = "hqminimap.capture",
		mode = "cutscene_mosaic",
		planStamp = j.plan.planStamp,
		nX = j.nX,
		nY = j.nY,
		pitchCount = j.pitchCount,
		pitches = j.pitches,
		zEye = j.zEye,
		segDur = j.segDur,
		shotOffset = j.shotOffset,
		envSettleSec = j.settleSec,
		gsdX = j.plan.gsdX,
		gsdY = j.plan.gsdY,
		fovY = j.plan.fovY,
		captureTimeSec = captureLight.timeSec,
		captureDayOfYear = captureLight.day,
		startedAt = j.startedAt,
		finishedAt = finished and io_util.nowUnix() or nil,
		maxShots = j.maxShots,
		shotsTaken = j.shotsTaken,
		-- Wall time (os.time, s) of each screenshot in capture order: the app pairs them with the
		-- screenshot files (named by time) and ignores the player's own screenshots.
		shotTimes = j.shotTimes,
		tiles = j.tiles,
		error = err,
		seqOrder = "display_ltr",
		tileNameHint = "tile_p{pitchIdx:02d}_{seq:03d} (screenshots in capture order)",
	}
end

local function saveIndex(j, err, finished)
	return io_util.saveTable("capture_index", buildIndex(j, err, finished))
end

--- Index at most every 2 s during a pass; forced at the end of a pass and in finishJob.
local function saveIndexSoon(j, err, finished, force)
	local now = io_util.nowUnix()
	if not force and not finished and type(now) == "number" and type(j.lastIndexAt) == "number" and now - j.lastIndexAt < 2 then
		return
	end
	j.lastIndexAt = now
	pcall(function()
		saveIndex(j, err, finished)
	end)
end

local function finishJob(j, err)
	-- Clear first: a failure below must not leave the scan stuck (isBusy stays true otherwise).
	job = nil
	if isCutscenePlaying() then
		pcall(function()
			api.gui.mission.stopCutscene()
		end)
	end
	if j.savedCam then
		pcall(function()
			applyCam(j.savedCam)
		end)
	end
	pcall(function()
		restoreLighting(j.lighting)
	end)
	local okIdx, info = false, nil
	pcall(function()
		okIdx, info = saveIndex(j, err, true)
	end)
	pcall(function()
		if err then
			settings.setProgress(0)
			settings.setStatus(i18n.t("status_error", tostring(err)))
			io_util.log("ERROR capture: " .. tostring(err))
		else
			settings.setProgress(1)
			settings.setStatus(i18n.t("status_capture_done", j.shotsTaken, j.maxShots))
			io_util.log(string.format("capture OK %dx%d shots=%d/%d -> %s", j.nX, j.nY, j.shotsTaken, j.maxShots,
				tostring(okIdx and info and info.pathHint or "capture_index.lua")))
		end
	end)
end

-- ---------------------------------------------------------------- cutscenes

--- Seconds for the waits: the wall clock, else (no os.time) the frames counted by step at 60 fps.
local function nowSec(j)
	return io_util.nowUnix() or (j.frames or 0) / 60
end

local function playPitch(j, pitchIdx)
	j.pitchIdx = pitchIdx
	j.segShot = {}
	j.phaseStart = nowSec(j)
	j.playingSeen = false
	pcall(applyCaptureLighting)
	local path = string.format("%s%02d.lua", j.plan.cutscenePathPrefix or CUTSCENE_PREFIX, pitchIdx)
	local ok, err = pcall(function()
		api.gui.mission.playCutscene(path, false)
	end)
	io_util.log(string.format("play pitch %d/%d %s ok=%s %s", pitchIdx, j.pitchCount, path, tostring(ok),
		ok and "" or tostring(err)))
	if not ok then
		return false, "playCutscene " .. path .. ": " .. tostring(err)
	end
	j.phase = "play"
	return true
end

local function doShot(j, seg)
	local i = seg - 1
	local ix, iy = i % j.nX, math.floor(i / j.nX)
	local c = j.plan.centers[seg] or {}
	local ok, err = pcall(function()
		api.gui.camera.takeScreenshot(SCREENSHOT_SCALE)
	end)
	if not ok then
		finishJob(j, "takeScreenshot: " .. tostring(err))
		return
	end
	j.shotsTaken = j.shotsTaken + 1
	local shotTime = io_util.nowUnix()
	j.shotTimes[j.shotsTaken] = shotTime
	local eye = readEye()
	j.tiles[#j.tiles + 1] = {
		chrono = j.shotsTaken,
		shotTime = shotTime,
		pitchIdx = j.pitchIdx,
		ix = ix,
		iy = iy,
		seq = displaySeq(ix, iy, j.nX, j.nY),
		keyframe = { x = c.x, y = c.y, z = j.zEye },
		eyeAtShot = eye,
		dEye = (eye and c.x) and { dx = eye.x - c.x, dy = eye.y - c.y, dz = eye.z - j.zEye } or nil,
		elapsedAtShot = cutsceneElapsed(),
	}
	pcall(function()
		saveIndexSoon(j, nil, false, false)
	end)
	settings.setProgress(j.shotsTaken / j.maxShots)
	settings.setStatus(i18n.t("status_capture_progress", j.shotsTaken, j.maxShots))
end

-- ---------------------------------------------------------------- API

function M.isBusy()
	return job ~= nil
end

function M.abort(reason)
	if job ~= nil then
		finishJob(job, reason or "aborted")
	end
end

--- Start the capture described by mosaic_plan.lua. @return { ok, error, nX, nY, shots }
function M.start()
	if job ~= nil then
		return { ok = false, error = i18n.t("err_busy") }
	end
	local plan, err = M.loadPlan()
	if plan == nil then
		return { ok = false, error = err }
	end
	settings.setLastCapturedStamp(plan.planStamp)
	captureLight = {
		timeSec = tonumber(plan.captureTimeSec) or DEFAULT_TIME_SEC,
		day = tonumber(plan.captureDayOfYear) or DEFAULT_DAY_OF_YEAR,
	}
	local settleSec = math.max(0, tonumber(plan.envSettleSec) or ENV_SETTLE_SEC)
	local segDur = tonumber(plan.segDur) or SEG_DUR
	local per = plan.nX * plan.nY
	job = {
		plan = plan,
		nX = plan.nX,
		nY = plan.nY,
		zEye = plan.zEye,
		pitches = plan.pitches,
		pitchCount = plan.pitchCount,
		segDur = segDur,
		shotOffset = tonumber(plan.shotOffset) or SHOT_OFFSET,
		transit = tonumber(plan.transit) or 0.05,
		holdEps = tonumber(plan.holdEps) or 0.02,
		settleSec = settleSec,
		maxWaitSec = math.max(MIN_MAX_WAIT_SEC, math.ceil(per * segDur) + PLAY_MARGIN_SEC),
		maxShots = per * plan.pitchCount,
		shotsTaken = 0,
		shotTimes = {},
		tiles = {},
		savedCam = readCam(),
		lighting = lightingSnapshot(),
		startedAt = io_util.nowUnix(),
		phase = "settle",
		frames = 0,
		phaseStart = io_util.nowUnix() or 0,
	}
	pcall(applyCaptureLighting)
	settings.setProgress(0)
	settings.setStatus(i18n.t("status_capture_prep", job.nY, job.nX))
	pcall(function()
		saveIndex(job, nil, false)
	end)
	io_util.log(string.format("capture start grid=%dx%d pitches=%d shots=%d zEye=%s t=%ss settle=%.1fs",
		job.nX, job.nY, job.pitchCount, job.maxShots, tostring(job.zEye), tostring(captureLight.timeSec), settleSec))
	return { ok = true, nX = job.nX, nY = job.nY, shots = job.maxShots }
end

local function step(j)
	j.frames = (j.frames or 0) + 1
	-- Whole seconds: "> ceil(s)" waits until ceil(s)+1 on an integer clock.
	local waited = nowSec(j) - j.phaseStart
	if j.phase == "settle" then
		if waited > math.ceil(j.settleSec) then
			local ok, err = playPitch(j, 1)
			if not ok then
				finishJob(j, err)
			end
		end
		return
	end
	if j.phase ~= "play" then
		return
	end
	local playing = isCutscenePlaying()
	if playing then
		j.playingSeen = true
	end
	local elapsed = cutsceneElapsed()
	local per = j.nX * j.nY
	if playing and elapsed ~= nil and elapsed >= 0 then
		local seg = math.min(per, math.floor(elapsed / j.segDur) + 1)
		-- A segment already left without a shot: stop now, do not wait for the end.
		if seg > 1 and not j.segShot[seg - 1] then
			finishJob(j, i18n.t("err_skipped", seg - 1))
			return
		end
		local segStart = (seg - 1) * j.segDur
		local holdEnd = segStart + j.segDur - (j.transit or 0) - (j.holdEps or 0)
		if not j.segShot[seg] then
			if elapsed > holdEnd then
				finishJob(j, i18n.t("err_skipped", seg))
				return
			end
			if elapsed >= segStart + j.shotOffset then
				j.segShot[seg] = true
				doShot(j, seg)
				return
			end
		end
	end
	if j.playingSeen and not playing then
		saveIndexSoon(j, nil, false, true)
		if j.pitchIdx < j.pitchCount then
			local ok, err = playPitch(j, j.pitchIdx + 1)
			if not ok then
				finishJob(j, err)
			end
			return
		end
		if j.shotsTaken ~= j.maxShots then
			finishJob(j, i18n.t("err_mismatch", j.shotsTaken, j.maxShots))
			return
		end
		finishJob(j, nil)
		return
	end
	if not j.playingSeen and waited > math.ceil(PLAY_START_SEC) then
		finishJob(j, i18n.t("err_not_started"))
		return
	end
	if waited > math.ceil(j.maxWaitSec) then
		finishJob(j, i18n.t("err_timeout", j.shotsTaken))
	end
end

function M.tick()
	if ticking or job == nil then
		return
	end
	ticking = true
	local j = job
	local ok, err = pcall(step, j)
	ticking = false
	if not ok then
		io_util.log("tick error: " .. tostring(err))
		if job ~= nil then
			finishJob(job, "tick: " .. tostring(err))
		end
	end
end

return M
