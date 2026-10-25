-- Shared state between the GUI handlers and the capture job.

local M = {}

-- CameraFrame nadir pitch: -14.1372 = -4.5π - 3.3e-5 rad (probe-locked; image orientation is
-- set by the SIGN of CameraFrame.fovY, written negative by the app).
M.CAMERAFRAME_NADIR_PITCH = -14.1372

local progress = 0
-- nil = "ready" (translated by the window, which knows the language).
local status = nil
-- planStamp of the grid last captured (the window stops announcing it as new).
local lastCapturedStamp = nil

function M.setProgress(p)
	progress = math.max(0, math.min(1, tonumber(p) or 0))
end

function M.getProgress()
	return progress
end

function M.setStatus(s)
	status = s ~= nil and tostring(s) or nil
end

function M.getStatus()
	return status
end

function M.setLastCapturedStamp(stamp)
	lastCapturedStamp = stamp
end

function M.getLastCapturedStamp()
	return lastCapturedStamp
end

return M
