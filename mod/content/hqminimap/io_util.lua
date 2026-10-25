-- Userdata I/O (GUI context only). TF3 sandbox: `io` is nil, the only write path is
-- app.saveUserdata(dir, name, table) → <userdata>/<dir>/<name>.lua (read by the HQminiMap app).
-- Some directories may refuse writes: fall back to towns_industries/hqminimap_<name>.lua.

local M = {}

M.EXPORT_DIR = "hqminimap"
M.FALLBACK_DIR = "towns_industries"
M.FILE_PREFIX = "hqminimap_"

function M.resolveApp()
	local ok, candidate = pcall(function()
		return app
	end)
	if not ok or candidate == nil or type(candidate) == "boolean" then
		return nil
	end
	local okFn = pcall(function()
		return candidate.saveUserdata
	end)
	if not okFn or candidate.saveUserdata == nil then
		return nil
	end
	return candidate
end

local function sep()
	return package.config:sub(1, 1)
end

local function dirPath(appObj, directory)
	local ok, base = pcall(function()
		return appObj.getUserDataFolder()
	end)
	if not ok or type(base) ~= "string" or base == "" then
		return directory
	end
	if base:sub(-1) == "/" or base:sub(-1) == "\\" then
		return base .. directory
	end
	return base .. sep() .. directory
end

local function trySave(appObj, directory, fileName, tbl)
	pcall(function()
		appObj.removeUserdata(directory, fileName)
	end)
	local ok, err = pcall(function()
		appObj.saveUserdata(directory, fileName, tbl)
	end)
	if ok then
		return true
	end
	return false, tostring(err)
end

--- Save a Lua table as <userdata>/hqminimap/<fileBase>.lua (fallback dir if refused).
--- @return ok, info { directory, fileName, pathHint, fallback } or error string
function M.saveTable(fileBase, tbl)
	local appObj = M.resolveApp()
	if appObj == nil then
		return false, "app.saveUserdata unavailable (GUI context required)"
	end
	local ok, err = trySave(appObj, M.EXPORT_DIR, fileBase, tbl)
	if ok then
		return true, {
			directory = M.EXPORT_DIR,
			fileName = fileBase,
			pathHint = dirPath(appObj, M.EXPORT_DIR) .. sep() .. fileBase .. ".lua",
		}
	end
	local fallbackName = M.FILE_PREFIX .. fileBase
	local ok2, err2 = trySave(appObj, M.FALLBACK_DIR, fallbackName, tbl)
	if ok2 then
		return true, {
			directory = M.FALLBACK_DIR,
			fileName = fallbackName,
			pathHint = dirPath(appObj, M.FALLBACK_DIR) .. sep() .. fallbackName .. ".lua",
			fallback = true,
			primaryError = err,
		}
	end
	return false, "saveUserdata failed in " .. M.EXPORT_DIR .. " (" .. tostring(err)
		.. ") and " .. M.FALLBACK_DIR .. " (" .. tostring(err2) .. ")"
end

--- Read <userdata>/hqminimap/<fileBase>.lua (fallback dir: hqminimap_<fileBase>) fresh from disk.
--- @return table or nil
function M.loadTable(fileBase)
	local appObj = M.resolveApp()
	if appObj == nil then
		return nil
	end
	for _, loc in ipairs({ { M.EXPORT_DIR, fileBase }, { M.FALLBACK_DIR, M.FILE_PREFIX .. fileBase } }) do
		local ok, tbl = pcall(function()
			return appObj.loadUserdata(loc[1], loc[2])
		end)
		if ok and type(tbl) == "table" then
			return tbl
		end
	end
	return nil
end

function M.nowUnix()
	local ok, t = pcall(function()
		return os.time()
	end)
	if ok and type(t) == "number" then
		return t
	end
	return nil
end

function M.log(msg)
	print("[hqminimap] " .. tostring(msg))
end

return M
