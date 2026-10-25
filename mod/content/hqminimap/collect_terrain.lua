-- Terrain sampling: map bounds, game map meta, coarse grid (map.lua) and fine heightmap.

local M = {}

local function vec2(x, y)
	return api.type.Vec2f.new(x, y)
end

local function heightAt(pos)
	local ok, h = pcall(function()
		return api.engine.terrain.getHeightAt(pos)
	end)
	return (ok and type(h) == "number") and h or 0
end

local function onWater(pos)
	local ok, w = pcall(function()
		return api.engine.terrain.isOnWater(pos)
	end)
	return ok and w == true
end

function M.getBounds()
	local ok, bbox = pcall(function()
		return api.engine.terrain.getBoundingBox()
	end)
	if not ok or bbox == nil or bbox.min == nil or bbox.max == nil then
		return nil, "getBoundingBox failed"
	end
	local b = { minX = bbox.min.x, minY = bbox.min.y, maxX = bbox.max.x, maxY = bbox.max.y }
	b.width = b.maxX - b.minX
	b.height = b.maxY - b.minY
	return b
end

--- Map meta from makeMapFromGame (water level, climate, size); nil if unavailable.
function M.gameMapMeta()
	local ok, map = pcall(function()
		return api.engine.terrain.makeMapFromGame(true, true, true, false)
	end)
	if not ok or map == nil then
		return nil
	end
	return {
		numTilesX = map.numTilesX,
		numTilesY = map.numTilesY,
		waterLevel = map.waterLevel,
		climateId = map.climateId,
		offsetZ = map.offsetZ,
	}
end

--- Coarse grid (gridN²): cells {i, j, h, water}, x = minX + (i+0.5)·stepX.
function M.sampleGrid(bounds, gridN)
	local stepX = bounds.width / gridN
	local stepY = bounds.height / gridN
	local cells = {}
	local minH, maxH = math.huge, -math.huge
	for j = 0, gridN - 1 do
		for i = 0, gridN - 1 do
			local pos = vec2(bounds.minX + (i + 0.5) * stepX, bounds.minY + (j + 0.5) * stepY)
			local h = heightAt(pos)
			minH = math.min(minH, h)
			maxH = math.max(maxH, h)
			cells[#cells + 1] = { i = i, j = j, h = h, water = onWater(pos) }
		end
	end
	return { gridN = gridN, stepX = stepX, stepY = stepY, minH = minH, maxH = maxH, cells = cells }
end

--- Fine visible-ground heightmap (seam heights + ortho reprojection in the app).
--- rows[j+1][i+1] = max(h, waterLevel if on water) at x = minX + (i+0.5)·cellX, y = minY + (j+0.5)·cellY.
function M.sampleHeightmap(bounds, n, waterLevel)
	local stepX = bounds.width / n
	local stepY = bounds.height / n
	local water = waterLevel or 0
	local rows = {}
	local minZ, maxZ = math.huge, -math.huge
	for j = 0, n - 1 do
		local row = {}
		local y = bounds.minY + (j + 0.5) * stepY
		for i = 0, n - 1 do
			local pos = vec2(bounds.minX + (i + 0.5) * stepX, y)
			local z = heightAt(pos)
			if z < water and onWater(pos) then
				z = water
			end
			z = math.floor(z * 100 + 0.5) / 100
			minZ = math.min(minZ, z)
			maxZ = math.max(maxZ, z)
			row[i + 1] = z
		end
		rows[j + 1] = row
	end
	return {
		version = 1,
		n = n,
		minX = bounds.minX,
		minY = bounds.minY,
		width = bounds.width,
		height = bounds.height,
		cellX = stepX,
		cellY = stepY,
		waterLevel = water,
		minZ = minZ,
		maxZ = maxZ,
		layout = "rows[j+1][i+1]; x=minX+(i+0.5)*cellX, y=minY+(j+0.5)*cellY; z=max(h,waterLevel on water)",
		rows = rows,
	}
end

return M
