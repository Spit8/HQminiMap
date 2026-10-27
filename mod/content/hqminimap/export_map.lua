-- "Exporter la carte": map.lua (bounds, meta, coarse terrain) + heightmap.lua (fine relief)
-- in <userdata>/hqminimap/. The HQminiMap app watches these files and plans the capture.

local io_util = ug_require "hqminimap::/hqminimap/io_util.lua"
local collect_terrain = ug_require "hqminimap::/hqminimap/collect_terrain.lua"

local M = {}

local GRID_N = 128
-- Retried at the fallback size if saveUserdata rejects the larger table.
local HEIGHTMAP_N = 512
local HEIGHTMAP_N_FALLBACK = 256

local function exportHeightmap(bounds, waterLevel, exportedAt)
	for _, n in ipairs({ HEIGHTMAP_N, HEIGHTMAP_N_FALLBACK }) do
		local hm = collect_terrain.sampleHeightmap(bounds, n, waterLevel)
		hm.exportedAt = exportedAt
		local ok, info = io_util.saveTable("heightmap", hm)
		if ok then
			io_util.log(string.format("heightmap %dx%d z=[%.1f..%.1f] -> %s", n, n, hm.minZ, hm.maxZ,
				tostring(info.pathHint)))
			return true, n
		end
		io_util.log(string.format("WARN heightmap %dx%d save failed: %s", n, n, tostring(info)))
	end
	return false, nil
end

--- @return { ok, error, mapPath, heightmapN }
function M.run()
	local bounds, err = collect_terrain.getBounds()
	if bounds == nil then
		return { ok = false, error = err }
	end
	local meta = collect_terrain.gameMapMeta()
	local waterLevel = meta and meta.waterLevel or nil
	local exportedAt = io_util.nowUnix()
	local grid = collect_terrain.sampleGrid(bounds, GRID_N)
	local payload = {
		version = 1,
		source = "hqminimap",
		exportedAt = exportedAt,
		bounds = bounds,
		gameMap = meta,
		terrain = {
			gridN = grid.gridN,
			stepX = grid.stepX,
			stepY = grid.stepY,
			minH = grid.minH,
			maxH = grid.maxH,
			waterLevel = waterLevel,
			cells = grid.cells,
		},
	}
	-- Heightmap first: the app reloads when map.lua changes, map.lua must come last.
	-- A failed heightmap must not publish a map the app would load without relief.
	local okHm, n = exportHeightmap(bounds, waterLevel, exportedAt)
	if not okHm then
		return { ok = false, error = "heightmap failed" }
	end
	local ok, info = io_util.saveTable("map", payload)
	if not ok then
		return { ok = false, error = "map: " .. tostring(info) }
	end
	if info.fallback then
		io_util.log("WARN userdata/hqminimap refused; wrote under " .. tostring(info.directory))
	end
	io_util.log(string.format("export OK bounds=%.0fx%.0f heightmap=%s -> %s", bounds.width, bounds.height,
		tostring(n), tostring(info.pathHint)))
	return { ok = true, mapPath = info.pathHint, heightmapN = okHm and n or nil }
end

return M
