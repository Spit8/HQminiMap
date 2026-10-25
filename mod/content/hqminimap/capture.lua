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
local SEG_DUR = 1
local SHOT_OFFSET = 0.25
local ENV_SETTLE_SEC = 2
local MIN_MAX_WAIT_FRAMES = 3600
-- playCutscene must report playing within this many frames.
local PLAY_START_TIMEOUT = 90
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
	return (ok and type(v) == "number") and v or nil
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
	setCalendarSpeed(snap.calendarSpeed or DEFAULT_CALENDAR_SPEED)
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
	if type(plan.nX) ~= "number" or type(plan.nY) ~= "number" or type(plan.centers) ~= "table" then
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

local function finishJob(j, err)
	if isCutscenePlaying() then
		pcall(function()
			api.gui.mission.stopCutscene()
		end)
	end
	if j.savedCam then
		applyCam(j.savedCam)
	end
	pcall(function()
		restoreLighting(j.lighting)
	end)
	local okIdx, info = saveIndex(j, err, true)
	if err then
		settings.setProgress(0)
		settings.setStatus(i18n.t("status_error", tostring(err)))
		io_util.log("ERROR capture: " .. tostring(err))
	else
		settings.setProgress(1)
		settings.setStatus(i18n.t("status_capture_done", j.shotsTaken, j.maxShots))
		io_util.log(string.format("capture OK %dx%d shots=%d/%d -> %s", j.nX, j.nY, j.shotsTaken, j.maxShots,
			tostring(okIdx and info.pathHint or "capture_index.lua")))
	end
	job = nil
end

-- ---------------------------------------------------------------- cutscenes

local function playPitch(j, pitchIdx)
	j.pitchIdx = pitchIdx
	j.segShot = {}
	j.waitFrames = 0
	j.playingSeen = false
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
	pcall(applyCaptureLighting)
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
		saveIndex(j, nil, false)
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
		settleSec = settleSec,
		settleFrames = math.ceil(settleSec * 60),
		maxWaitFrames = math.max(MIN_MAX_WAIT_FRAMES, math.ceil(per * segDur * 60) + 600),
		maxShots = per * plan.pitchCount,
		shotsTaken = 0,
		shotTimes = {},
		tiles = {},
		savedCam = readCam(),
		lighting = lightingSnapshot(),
		startedAt = io_util.nowUnix(),
		phase = "settle",
		waitFrames = 0,
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
	j.waitFrames = j.waitFrames + 1
	-- Sky / time of day settle before the first cutscene.
	if j.phase == "settle" then
		if j.waitFrames >= j.settleFrames then
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
		-- One shot per tile, inside the stationary hold.
		if elapsed >= (seg - 1) * j.segDur + j.shotOffset and not j.segShot[seg] then
			j.segShot[seg] = true
			doShot(j, seg)
			return
		end
	end
	if j.playingSeen and not playing then
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
	if not j.playingSeen and j.waitFrames >= PLAY_START_TIMEOUT then
		finishJob(j, i18n.t("err_not_started"))
		return
	end
	if j.waitFrames >= j.maxWaitFrames then
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
