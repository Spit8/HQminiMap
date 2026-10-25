-- Handlers of hqminimap_gui: this file is ours (TFUI creates it once and never rewrites it).
-- react.onStep MUST be registered during the Window recipe render, on EVERY render (hooks
-- model): from an onClick it attaches to the Button and never ticks. The ProgressBar `value`
-- expression (evaluated in the Window render) calls handlers.bindWindow, which installs it.

local handlers = {}

local refs = { progress = nil, status = nil }
local pumpLogged = false

local function requireHq(path)
	local ok, mod = pcall(function()
		return ug_require(path)
	end)
	if not ok or mod == nil then
		print("[hqminimap] ug_require failed " .. path .. ": " .. tostring(mod))
		return nil
	end
	return mod
end

local function i18nMod()
	return requireHq "hqminimap::/hqminimap/i18n.lua"
end

--- Translated UI string (used by the TFUI texts: handlers.t("export_button")).
function handlers.t(key, ...)
	local i18n = i18nMod()
	return i18n ~= nil and i18n.t(key, ...) or key
end

local function settingsMod()
	return requireHq "hqminimap::/hqminimap/settings.lua"
end

local function captureMod()
	return requireHq "hqminimap::/hqminimap/capture.lua"
end

--- Push settings progress / status into the window state (coarse progress steps).
local function syncState()
	local settings = settingsMod()
	if settings == nil then
		return
	end
	if refs.progress ~= nil then
		local p, cur = settings.getProgress(), refs.progress:old()
		if (p >= 1 and cur < 1) or (p <= 0 and cur > 0) or math.abs(p - cur) >= 0.02 then
			refs.progress:set(p)
		end
	end
	if refs.status ~= nil then
		local s = settings.getStatus()
		if s ~= refs.status:old() then
			refs.status:set(s)
		end
	end
end

local function setStatus(text)
	local settings = settingsMod()
	if settings ~= nil then
		settings.setStatus(text)
	end
	print("[hqminimap] " .. tostring(text))
	syncState()
end

-- Watch for a new grid written by the app (~every 1.5 s): announce it in the window status.
local PLAN_CHECK_FRAMES = 90
local planCheckFrame = 0
local seenPlanStamp = nil

local function checkNewPlan(capture)
	planCheckFrame = planCheckFrame + 1
	if planCheckFrame < PLAN_CHECK_FRAMES then
		return
	end
	planCheckFrame = 0
	local io_util = requireHq "hqminimap::/hqminimap/io_util.lua"
	local settings = settingsMod()
	if io_util == nil or settings == nil then
		return
	end
	local plan = io_util.loadTable("capture_plan")
	local stamp = plan and plan.planStamp
	if stamp == nil or stamp == seenPlanStamp then
		return
	end
	seenPlanStamp = stamp
	if stamp ~= settings.getLastCapturedStamp() then
		setStatus(handlers.t("status_new_plan", plan.nY or 0, plan.nX or 0, (plan.nX or 0) * (plan.nY or 0)))
	end
end

-- Live data / app commands: ticked by the mod-button pump (always displayed); the window pump
-- only takes over when the button pump is not running.
local buttonPumpFrame = 0
-- buttonPumpFrame seen at the previous window step.
local windowPumpFrame = 0

--- Last react handle seen by a pump: lets live commands open in-game windows (selectEntity).
local lastReact = nil

local function liveTick()
	local live = requireHq "hqminimap::/hqminimap/live_export.lua"
	if live ~= nil then
		local ok, err = pcall(live.tick, lastReact)
		if not ok then
			print("[hqminimap] live tick error: " .. tostring(err))
		end
	end
end

local buttonPumpLogged = false

--- Mod-button label (TFUI: handlers.buttonLabel(react)). The button is always displayed, so its
--- recipe also installs a step pump: live data / commands keep running with the window closed.
function handlers.buttonLabel(react)
	if react ~= nil then
		lastReact = react
	end
	if react ~= nil and type(react.onStep) == "function" then
		local ok = pcall(function()
			react.onStep(function()
				buttonPumpFrame = buttonPumpFrame + 1
				liveTick()
			end)
		end)
		if ok and not buttonPumpLogged then
			buttonPumpLogged = true
			print("[hqminimap] button pump installed")
		end
	end
	return "HQminiMap"
end

local function onStep()
	-- The button pump did not tick since the previous window step: tick live data from here.
	if buttonPumpFrame == windowPumpFrame then
		liveTick()
	end
	windowPumpFrame = buttonPumpFrame
	local capture = captureMod()
	if capture ~= nil and capture.isBusy() then
		pcall(capture.tick)
	elseif capture ~= nil then
		pcall(checkNewPlan, capture)
	end
	pcall(syncState)
end

--- Status line of the window (TFUI text: handlers.statusText(status)).
function handlers.statusText(status)
	local v = status ~= nil and status:old() or nil
	if v == nil or v == "" then
		return handlers.t("status_ready")
	end
	return v
end

--- Called from the ProgressBar value during the Window render: keeps the state refs and
--- (re)registers the capture tick. Returns the progress value to display.
function handlers.bindWindow(react, progress, status)
	if react ~= nil and lastReact == nil then
		lastReact = react
	end
	refs.progress = progress
	refs.status = status
	if react ~= nil and type(react.onStep) == "function" then
		local ok, err = pcall(function()
			react.onStep(onStep)
		end)
		if not ok then
			print("[hqminimap] react.onStep threw: " .. tostring(err))
		elseif not pumpLogged then
			pumpLogged = true
			print("[hqminimap] window tick installed")
		end
		if type(react.onUnmount) == "function" then
			pcall(function()
				react.onUnmount(function()
					local capture = captureMod()
					if capture ~= nil and capture.isBusy() then
						pcall(capture.abort, handlers.t("err_window_closed"))
					end
					pumpLogged = false
				end)
			end)
		end
	end
	return progress ~= nil and progress:old() or 0
end

--- "Exporter la carte": map.lua + heightmap.lua for the HQminiMap app.
function handlers.onExport()
	local capture = captureMod()
	if capture ~= nil and capture.isBusy() then
		setStatus(handlers.t("status_busy_export"))
		return
	end
	local export_map = requireHq "hqminimap::/hqminimap/export_map.lua"
	if export_map == nil then
		setStatus(handlers.t("status_module_missing", "export_map"))
		return
	end
	setStatus(handlers.t("status_exporting"))
	local ok, res = pcall(export_map.run)
	if not ok then
		setStatus(handlers.t("status_export_error", tostring(res)))
	elseif not res.ok then
		setStatus(handlers.t("status_export_error", tostring(res.error)))
	else
		setStatus(handlers.t("status_exported"))
	end
end

--- "Capturer": play the mosaic written by the app.
function handlers.onCapture()
	local capture = captureMod()
	if capture == nil then
		setStatus(handlers.t("status_module_missing", "capture"))
		return
	end
	if capture.isBusy() then
		pcall(capture.abort, handlers.t("err_restarted"))
	end
	local ok, res = pcall(capture.start)
	if not ok then
		setStatus(handlers.t("status_capture_error", tostring(res)))
	elseif not res.ok then
		setStatus(handlers.t("status_capture_impossible", tostring(res.error)))
	end
	syncState()
end

return handlers
