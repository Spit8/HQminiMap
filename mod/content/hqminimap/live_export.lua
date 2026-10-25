-- Live game data for the HQminiMap app (Visualiser layers) + app commands (teleport).
-- The app writes <UD>/hqminimap/live_request.lua { enabled, intervals = {towns=…, …}, cmd = {seq, …} };
-- this module re-reads it every REQUEST_FRAMES and, at the requested cadence, writes
-- live_towns / live_industries / live_stations / live_lines / live_vehicles / live_stats /
-- live_routes, plus live_status (job timings, first warning, last command). Driven every frame by
-- the GUI pumps (handlers). Fields verified in game by the live probe (2026-10-25).

local io_util = ug_require "hqminimap::/hqminimap/io_util.lua"

local M = {}

-- Cadence: request re-read every REQUEST_FRAMES frames; jobs and status on wall-clock seconds
-- (os.clock is CPU time, unreliable as a clock in a multi-threaded game; only used for durations).
local REQUEST_FRAMES = 30
local STATUS_SEC = 2
-- One job at a time. Long jobs (stations, stats, routes) run in steps, BUDGET_SEC per frame at most.
local BUDGET_SEC = 0.003
local MAX_STEPS = 200
-- A station whose position could not be read is retried after this delay.
local RETRY_SEC = 30
local KINDS = { "vehicles", "lines", "stations", "stats", "routes", "stocks", "towns", "industries", "townAreas", "history" }
-- Version of the files written here; the app warns when the game still runs an older mod
-- (ug_require keeps the old code until the save is reloaded).
local FORMAT = 5
-- Straight bridges over unreadable path edges only up to this length (m): longer ones are left open.
local MAX_BRIDGE = 80
-- Town outlines: building positions binned on a CELL m grid.
local CELL = 20
-- History: last HISTORY_POINTS points of each logbook series.
local HISTORY_POINTS = 24
local NAME_TTL = 30

local request = nil
local frame = 0
local lastStatus = -1
local lastRun = {}
local jobStats = {}
local warnings = {}
local lastCmdSeq = 0
local cmdResult = nil
local active = nil
local stationPosCache = {}
--- line → transport mode ("rail", "road", …), filled by the lines job.
local lineMode = {}
--- line → { fp = stops fingerprint, edges = {edge = true}, extra = {key = "x,y,x,y,…"} }: what was
--- seen on the line's vehicle paths (network edges, lane geometries, bridges over gaps, free legs).
local lineEdges = {}
--- edge → "x0,y0,tx0,ty0,x1,y1,tx1,ty1" (or false: no BASE_EDGE, e.g. inside a station).
local edgeGeom = {}
local routesSignature = nil
local routesDiag = nil
local historyDiag = nil
--- vehicle → { name, t }: names change rarely, read again after NAME_TTL s.
local vehicleNames = {}

local function clock()
	local ok, c = pcall(function()
		return os.clock()
	end)
	return ok and type(c) == "number" and c or 0
end

local function now()
	return io_util.nowUnix() or 0
end

local function warn(kind, msg)
	if warnings[kind] == nil then
		warnings[kind] = tostring(msg)
	end
end

local function comp(entity, ct)
	local ok, c = pcall(function()
		return api.engine.getComponent(entity, api.type.ComponentType[ct])
	end)
	return ok and c or nil
end

local function nameOf(entity)
	local n = comp(entity, "NAME")
	return n and n.name or nil
end

local function exists(entity)
	local ok, e = pcall(function()
		return api.engine.entityExists(entity)
	end)
	return not ok or e ~= false
end

local function round1(v)
	return math.floor(v + 0.5)
end

local function perYear(entity, logName)
	local ok, v = pcall(function()
		return api.engine.util.logbook.getLogValuePerYear(entity, logName)
	end)
	return ok and type(v) == "number" and v or 0
end

-- ------------------------------------------------------------------ positions and modes

local function bboxCentre(entity)
	local bv = comp(entity, "BOUNDING_VOLUME")
	local b = bv and bv.bbox
	if b and b.min and b.max then
		return (b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2
	end
	return nil
end

--- World position of a station: centre of its bounding volume, else of its construction (bbox,
--- then transform). Successes are cached (stations do not move); failures are retried later.
local function stationPos(station)
	local cached = stationPosCache[station]
	if cached ~= nil and (cached.x ~= nil or now() - cached.failedAt < RETRY_SEC) then
		return cached.x ~= nil and cached or nil
	end
	local pos = nil
	local ok, err = pcall(function()
		local x, y = bboxCentre(station)
		local con = api.engine.system.streetConnectorSystem.getConstructionEntityForStation(station)
		local c = con and con >= 0 and comp(con, "CONSTRUCTION") or nil
		if x == nil and con and con >= 0 then
			x, y = bboxCentre(con)
		end
		if x == nil and c and c.transf then
			local p = api.type.Mat4f.getTransl(c.transf)
			x, y = p.x, p.y
		end
		if x ~= nil then
			pos = { x = x, y = y, file = c and c.fileName or "" }
		end
	end)
	if not ok then
		warn("stations", "station " .. tostring(station) .. ": " .. tostring(err))
	elseif pos == nil then
		warn("stations", "station " .. tostring(station) .. ": no bounding volume nor construction")
	end
	stationPosCache[station] = pos or { failedAt = now() }
	return pos
end

local CARRIER_NAMES = { "ROAD", "RAIL", "TRAM", "AIR", "WATER" }
local function carrierMode(carrier)
	if carrier == nil then
		return nil
	end
	local found = nil
	pcall(function()
		for _, name in ipairs(CARRIER_NAMES) do
			if api.type.enum.Carrier[name] == carrier then
				found = name:lower()
				return
			end
		end
	end)
	if found == "water" or found == "air" or found == "rail" or found == "road" or found == "tram" then
		return found
	end
	return nil
end

--- "rail" | "road" | "tram" | "water" | "air" | "other" from a construction file name (fallback).
local function fileMode(file)
	file = tostring(file or ""):lower()
	return file:find("rail") and "rail" or file:find("tram") and "tram" or file:find("harbor") and "water"
		or file:find("port") and "water" or file:find("water") and "water" or file:find("air") and "air"
		or file:find("road") and "road" or file:find("bus") and "road" or file:find("truck") and "road" or "other"
end

local function stationIs(station, cargo)
	local ok, v = pcall(function()
		return api.engine.util.station.isStationOfType(station, cargo)
	end)
	return ok and v == true
end

-- ------------------------------------------------------------------ jobs
-- A job is either a function returning the data table, or { begin, step, finish }: begin() → state,
-- step(state) → true when done, finish(state) → data (nil = nothing to write this time).

local jobs = {}

function jobs.towns()
	local out = {}
	local map = api.engine.terrain.makeMapFromGame(true, true, true, false)
	for _, t in ipairs(map.towns or {}) do
		local size = 0
		pcall(function()
			for _, v in ipairs(comp(t.existing, "TOWN").initialLandUseCapacities) do
				size = size + v
			end
		end)
		out[#out + 1] = { id = t.existing, name = t.name, x = round1(t.pos.x), y = round1(t.pos.y), size = size }
	end
	return { towns = out }
end

function jobs.industries()
	local out = {}
	local map = api.engine.terrain.makeMapFromGame(true, true, true, false)
	for _, ind in ipairs(map.industries or {}) do
		local level = nil
		pcall(function()
			level = comp(ind.existing, "INDUSTRY").level
		end)
		out[#out + 1] = {
			id = ind.existing, type = ind.tag, file = ind.fileName, level = level,
			x = round1(ind.pos.x), y = round1(ind.pos.y),
		}
	end
	return { industries = out }
end

local function playerLines()
	local ok, list = pcall(function()
		return api.engine.system.lineSystem.getLinesForPlayer(api.engine.util.getPlayer())
	end)
	return ok and list or {}
end

local function lineVehicles(ln)
	local ok, list = pcall(function()
		return api.engine.system.transportVehicleSystem.getLineVehicles(ln)
	end)
	return ok and list or {}
end

jobs.stations = {
	begin = function()
		local groups = {}
		api.engine.forEachEntityWithComponent(function(group)
			groups[#groups + 1] = group
		end, api.type.ComponentType.STATION_GROUP)
		return { groups = groups, i = 1, out = {} }
	end,
	step = function(s)
		local group = s.groups[s.i]
		s.i = s.i + 1
		if group == nil then
			return true
		end
		local sg = comp(group, "STATION_GROUP")
		if sg and sg.stations then
			local sx, sy, n, file = 0, 0, 0, nil
			local cargo, passengers = false, false
			for _, st in ipairs(sg.stations) do
				local p = stationPos(st)
				if p then
					sx, sy, n = sx + p.x, sy + p.y, n + 1
					file = file or p.file
				end
				cargo = cargo or stationIs(st, true)
				passengers = passengers or stationIs(st, false)
			end
			if n > 0 then
				local mode = nil
				pcall(function()
					for _, ln in ipairs(api.engine.system.lineSystem.getLinesForStationGroup(group)) do
						mode = mode or lineMode[ln]
					end
				end)
				s.out[#s.out + 1] = {
					id = group, name = nameOf(group) or "", x = round1(sx / n), y = round1(sy / n),
					mode = mode or fileMode(file), cargo = cargo, passengers = passengers,
				}
			end
		end
		return s.i > #s.groups
	end,
	finish = function(s)
		return { stations = s.out }
	end,
}

function jobs.lines()
	local out = {}
	for _, ln in ipairs(playerLines()) do
		local entry = { id = ln, name = nameOf(ln) or ("#" .. tostring(ln)), stops = {} }
		pcall(function()
			local c = comp(ln, "COLOR").color
			entry.r, entry.g, entry.b = c.x, c.y, c.z
		end)
		local line = comp(ln, "LINE")
		for _, stop in ipairs(line and line.stops or {}) do
			local sg = comp(stop.stationGroup, "STATION_GROUP")
			local st = sg and sg.stations and sg.stations[(stop.station or 0) + 1]
			local p = st and stationPos(st)
			if p then
				entry.stops[#entry.stops + 1] = { g = stop.stationGroup, x = round1(p.x), y = round1(p.y) }
			end
		end
		local v = lineVehicles(ln)
		entry.vehicles = #v
		if #v > 0 then
			local tv = comp(v[1], "TRANSPORT_VEHICLE")
			entry.carrier = tv and tv.carrier
			lineMode[ln] = carrierMode(entry.carrier) or lineMode[ln]
		end
		entry.mode = lineMode[ln] or "other"
		out[#out + 1] = entry
	end
	return { lines = out }
end

local function vehicleName(v, t)
	local c = vehicleNames[v]
	if c == nil or t - c.t >= NAME_TTL then
		c = { name = (nameOf(v) or ""):gsub("[,;|]", " "), t = t }
		vehicleNames[v] = c
	end
	return c.name
end

local passengerType = nil
--- On board: passengers n / capacity, cargo n / capacity (as the game's cargo_util: per cargo type
--- with a capacity in TRANSPORT_VEHICLE.config.capacities). -1 when unknown.
local function vehicleLoad(v)
	local pn, pc, cn, cc = -1, -1, -1, -1
	pcall(function()
		if passengerType == nil then
			passengerType = api.res.cargoTypeRep.getPassengerCargoTypeId()
		end
		local tv = comp(v, "TRANSPORT_VEHICLE")
		local caps = tv and tv.config and tv.config.capacities
		if not caps then
			return
		end
		pn, pc, cn, cc = 0, 0, 0, 0
		local sys = api.engine.system.simEntityAtVehicleSystem
		for i, cap in ipairs(caps) do
			if cap > 0 then
				local n = sys.getVehicleSimEntitiesCountForCargoType(v, i - 1) or 0
				if i - 1 == passengerType then
					pn, pc = pn + n, pc + cap
				else
					cn, cc = cn + n, cc + cap
				end
			end
		end
	end)
	return pn, pc, cn, cc
end

--- Compact "vehicleId,lineId,x,y,pass,passCap,cargo,cargoCap,name;…" (metres; -1 = unknown).
function jobs.vehicles()
	local parts = {}
	local t = now()
	for _, ln in ipairs(playerLines()) do
		for _, v in ipairs(lineVehicles(ln)) do
			local ok, p = pcall(function()
				return api.engine.util.vehicle.getPosition(v)
			end)
			if ok and p then
				local pn, pc, cn, cc = vehicleLoad(v)
				parts[#parts + 1] = string.format("%d,%d,%d,%d,%d,%d,%d,%d,%s", v, ln, round1(p.x), round1(p.y),
					pn, pc, cn, cc, vehicleName(v, t))
			end
		end
	end
	return { v = table.concat(parts, ";"), n = #parts }
end

--- Traffic: per line (transported per year, waiting at its stops) and per station group (loaded /
--- unloaded per year, waiting). Waiting = passengers (waitP) and all other cargo types (waitC).
jobs.stats = {
	begin = function()
		local s = { lines = playerLines(), i = 1, outLines = {}, groups = {}, groupOrder = {}, cargo = {} }
		pcall(function()
			s.passenger = api.res.cargoTypeRep.getPassengerCargoTypeId()
		end)
		pcall(function()
			for id in pairs(api.res.cargoTypeRep.getAll()) do
				if id ~= s.passenger then
					s.cargo[#s.cargo + 1] = id
				end
			end
		end)
		return s
	end,
	step = function(s)
		local ln = s.lines[s.i]
		s.i = s.i + 1
		if ln == nil then
			return true
		end
		local line = comp(ln, "LINE")
		local waitP, waitC = 0, 0
		for k, stop in ipairs(line and line.stops or {}) do
			local p, c = 0, 0
			pcall(function()
				local sys = api.engine.system.simEntityAtTerminalSystem
				if s.passenger ~= nil then
					p = sys.getLineStopSimEntitiesCount(ln, k - 1, s.passenger) or 0
				end
				for _, id in ipairs(s.cargo) do
					c = c + (sys.getLineStopSimEntitiesCount(ln, k - 1, id) or 0)
				end
			end)
			waitP, waitC = waitP + p, waitC + c
			local g = stop.stationGroup
			local gs = s.groups[g]
			if gs == nil then
				gs = { id = g, waitP = 0, waitC = 0 }
				s.groups[g] = gs
				s.groupOrder[#s.groupOrder + 1] = g
			end
			gs.waitP, gs.waitC = gs.waitP + p, gs.waitC + c
		end
		s.outLines[#s.outLines + 1] = { id = ln, transported = perYear(ln, "itemsTransported"), waitP = waitP, waitC = waitC }
		return s.i > #s.lines
	end,
	finish = function(s)
		local outStations = {}
		for _, g in ipairs(s.groupOrder) do
			local gs = s.groups[g]
			gs.loaded = perYear(g, "itemsLoaded")
			gs.unloaded = perYear(g, "itemsUnloaded")
			outStations[#outStations + 1] = gs
		end
		return { lines = s.outLines, stations = outStations }
	end,
}

local function edgeGeometry(edge)
	local g = edgeGeom[edge]
	if g ~= nil then
		return g
	end
	pcall(function()
		local be = comp(edge, "BASE_EDGE")
		if be and be.position0 and be.position1 then
			local p0, p1, t0, t1 = be.position0, be.position1, be.tangent0, be.tangent1
			g = string.format("%d,%d,%d,%d,%d,%d,%d,%d", round1(p0.x), round1(p0.y), round1(t0.x), round1(t0.y),
				round1(p1.x), round1(p1.y), round1(t1.x), round1(t1.y))
		end
	end)
	if g then
		edgeGeom[edge] = g -- only successes are cached: a failure is retried on the next pass
	end
	return g or false
end

--- Points of an EdgeGeometry (lane inside a crossing / construction, or a ship's free leg).
--- Points of an EdgeGeometry read as a Lua table (getComponent converts it, so the native
--- EdgeGeometry.calcPos cannot be used): straight, cubic (offset) spline or arc, computed here.
local function vxy(v)
	if v == nil then
		return nil
	end
	return v.x or v[1], v.y or v[2]
end

local function geomPoints(geom, n)
	local T = nil
	pcall(function()
		T = api.type.EdgeGeometry.Type
	end)
	local function is(name)
		return T ~= nil and T[name] ~= nil and geom.type == T[name]
	end
	local pts = {}
	local arc, cs, st = geom.arc, geom.cubicSpline, geom.straight
	if is("CUBIC_OFFSET_SPLINE") then
		cs = geom.cubicOffsetSpline
	end
	local kind = (is("ARC") and "arc") or ((is("CUBIC_SPLINE") or is("CUBIC_OFFSET_SPLINE")) and "cubic") or (is("STRAIGHT") and "straight")
	if kind == nil then -- type unknown: guess from the filled parameters
		kind = (arc and (arc.radius or 0) > 0 and "arc") or (cs and cs.pos and cs.pos[1] and "cubic") or "straight"
	end
	if kind == "arc" then
		local cx, cy = vxy(arc.center)
		for i = 0, n - 1 do
			local a = arc.startAngle + arc.angle * i / (n - 1)
			pts[#pts + 1] = { cx + arc.radius * math.cos(a), cy + arc.radius * math.sin(a) }
		end
	elseif kind == "cubic" then
		local x0, y0 = vxy(cs.pos[1])
		local x1, y1 = vxy(cs.pos[2])
		local tx0, ty0 = vxy(cs.tangent[1])
		local tx1, ty1 = vxy(cs.tangent[2])
		for i = 0, n - 1 do
			local t = i / (n - 1)
			local t2, t3 = t * t, t * t * t
			local h00, h10, h01, h11 = 2 * t3 - 3 * t2 + 1, t3 - 2 * t2 + t, -2 * t3 + 3 * t2, t3 - t2
			pts[#pts + 1] = { h00 * x0 + h10 * tx0 + h01 * x1 + h11 * tx1, h00 * y0 + h10 * ty0 + h01 * y1 + h11 * ty1 }
		end
	else
		local g = st and st.pos and st or cs
		local x0, y0 = vxy(g.pos[1])
		local x1, y1 = vxy(g.pos[2])
		pts = { { x0, y0 }, { x1, y1 } }
	end
	return pts
end

local samplePoints = geomPoints

local function ptsString(pts)
	local out = {}
	for _, p in ipairs(pts) do
		out[#out + 1] = round1(p[1]) .. "," .. round1(p[2])
	end
	return table.concat(out, ",")
end

--- Walk a network path in order and record its pieces on the line `le`: BASE_EDGE edges by id,
--- other lanes (crossings, stations) by their geometry, and a straight bridge over any edge whose
--- shape cannot be read, so the drawn track has no hole. `d` collects diagnostics.
local DIAG_COMPONENTS = { "BASE_EDGE", "TRANSPORT_NETWORK", "CONSTRUCTION", "BASE_NODE", "BASE_EDGE_STREET", "BASE_EDGE_TRACK" }

--- entity → true when it is a crossing (BASE_NODE): its turn lanes are not drawn, the edges on
--- both sides already meet at the node.
local nodeCache = {}
local function isNode(entity)
	local v = nodeCache[entity]
	if v == nil then
		v = comp(entity, "BASE_NODE") ~= nil
		nodeCache[entity] = v
	end
	return v
end

local function walkPath(path, le, d)
	local prevEnd, gap = nil, false
	for _, e in ipairs(path and path.edges or {}) do
		local id = e[1] or e.edgeId or e
		local entity, index = id and id.entity, id and id.index or 0
		local fwd = e[2] ~= false
		local first, last = nil, nil
		local skipped = false
		if entity and entity >= 0 and isNode(entity) then
			skipped = true
			d.nodes = d.nodes + 1
		elseif entity and entity >= 0 then
			local g = edgeGeometry(entity)
			if g then
				le.edges[entity] = true
				local n = {}
				for v in g:gmatch("-?%d+") do
					n[#n + 1] = tonumber(v)
				end
				first, last = { n[1], n[2] }, { n[5], n[6] }
				if not fwd then
					first, last = last, first
				end
			else
				local ok, err = pcall(function()
					local tn = comp(entity, "TRANSPORT_NETWORK")
					local edge = tn and tn.edges and tn.edges[index + 1]
					local pts = edge and edge.geometry and samplePoints(edge.geometry, 4) or {}
					if #pts >= 2 then
						-- Lanes inside constructions (stations, depots): a straight piece, no arc.
						first, last = pts[1], pts[#pts]
						le.extra["tn:" .. entity .. ":" .. index] = ptsString({ first, last })
						if not fwd then
							first, last = last, first
						end
						d.lanes = d.lanes + 1
					end
				end)
				if first == nil then
					d.missing = d.missing + 1
					if d.sample == nil then
						d.sample = tostring(entity) .. (ok and "" or " (error)")
					end
					if #d.samples < 5 then
						local has = {}
						for _, c in ipairs(DIAG_COMPONENTS) do
							if comp(entity, c) ~= nil then
								has[#has + 1] = c
							end
						end
						d.samples[#d.samples + 1] = string.format("%d:%d [%s] %s", entity, index, table.concat(has, " "),
							ok and "no geometry" or tostring(err))
					end
				end
			end
		end
		if first then
			if gap and prevEnd then
				local len = math.sqrt((first[1] - prevEnd[1]) ^ 2 + (first[2] - prevEnd[2]) ^ 2)
				if len <= MAX_BRIDGE then
					le.extra[string.format("br:%d,%d", round1(prevEnd[1]), round1(prevEnd[2]))] =
						ptsString({ prevEnd, first })
					d.bridges = d.bridges + 1
				else
					d.bigGaps = d.bigGaps + 1
				end
			end
			prevEnd, gap = last, false
		elseif not skipped then
			gap = true
		end
	end
end

--- Line tracks: a line stores only its stops, so the paths of its vehicles are accumulated
--- (each path covers the current leg); the whole route fills in as vehicles run. Ships and aircraft
--- (MOVE_PATH_AIRCRAFT): network paths at the ports + the free leg (path1) sampled every ~50 m.
jobs.routes = {
	begin = function()
		return {
			lines = playerLines(), i = 1, out = {}, used = {}, usedOrder = {},
			d = {
				missing = 0, bridges = 0, lanes = 0, free = 0, bigGaps = 0, nodes = 0, samples = {},
				paths = 0, edgesSum = 0, edgesMax = 0, idxSum = 0, idxN = 0, states = {},
			},
		}
	end,
	step = function(s)
		local ln = s.lines[s.i]
		s.i = s.i + 1
		if ln == nil then
			return true
		end
		local line = comp(ln, "LINE")
		local fp = {}
		for _, stop in ipairs(line and line.stops or {}) do
			fp[#fp + 1] = tostring(stop.stationGroup) .. ":" .. tostring(stop.station) .. ":" .. tostring(stop.terminal)
		end
		fp = table.concat(fp, ",")
		local le = lineEdges[ln]
		if le == nil or le.fp ~= fp then
			le = { fp = fp, edges = {}, extra = {} }
			lineEdges[ln] = le
		end
		for _, v in ipairs(lineVehicles(ln)) do
			pcall(function()
				local mp = comp(v, "MOVE_PATH")
				if mp then
					walkPath(mp.path, le, s.d)
					-- Path coverage: is it the whole leg or a window ahead of the vehicle?
					local n = mp.path and mp.path.edges and #mp.path.edges or 0
					local d = s.d
					d.paths, d.edgesSum, d.edgesMax = d.paths + 1, d.edgesSum + n, math.max(d.edgesMax, n)
					local idx = mp.dyn and mp.dyn.pathPos and mp.dyn.pathPos.edgeIndex
					if type(idx) == "number" then
						d.idxSum, d.idxN = d.idxSum + idx, d.idxN + 1
					end
					if mp.state ~= nil then
						local k = "state" .. tostring(mp.state)
						d.states[k] = (d.states[k] or 0) + 1
					end
					return
				end
				local mpa = comp(v, "MOVE_PATH_AIRCRAFT")
				if mpa then
					walkPath(mpa.path0, le, s.d)
					walkPath(mpa.path2, le, s.d)
					local pts = {}
					for _, piece in ipairs(mpa.path1 or {}) do
						local geom = piece[1] or piece
						local len = tonumber(geom.length) or 0
						for _, p in ipairs(samplePoints(geom, math.max(2, math.min(60, math.ceil(len / 50) + 1)))) do
							pts[#pts + 1] = p
						end
					end
					if #pts >= 2 then
						local a, b = pts[1], pts[#pts]
						local key = string.format("free:%d,%d>%d,%d", round1(a[1] / 50), round1(a[2] / 50), round1(b[1] / 50), round1(b[2] / 50))
						le.extra[key] = ptsString(pts)
						s.d.free = s.d.free + 1
					end
				end
			end)
		end
		local ids = {}
		for edge in pairs(le.edges) do
			if not exists(edge) then
				le.edges[edge] = nil
			elseif edgeGeometry(edge) then
				ids[#ids + 1] = edge
				if not s.used[edge] then
					s.used[edge] = true
					s.usedOrder[#s.usedOrder + 1] = edge
				end
			end
		end
		table.sort(ids)
		local keys = {}
		for k in pairs(le.extra) do
			keys[#keys + 1] = k
		end
		table.sort(keys)
		local polys = {}
		for _, k in ipairs(keys) do
			polys[#polys + 1] = le.extra[k]
		end
		s.out[#s.out + 1] = { id = ln, e = table.concat(ids, ","), p = table.concat(polys, "|") }
		return s.i > #s.lines
	end,
	finish = function(s)
		local d = s.d
		if d.missing > 0 then
			warn("routes", string.format("%d path edge(s) without geometry, %d bridged, %d gap(s) > %d m left open (e.g. %s)",
				d.missing, d.bridges, d.bigGaps, MAX_BRIDGE, d.samples[1] or d.sample or "?"))
		end
		routesDiag = {
			missing = d.missing, bridges = d.bridges, lanes = d.lanes, free = d.free, bigGaps = d.bigGaps, nodes = d.nodes,
			samples = d.samples,
			pathStats = {
				paths = d.paths, edgesAvg = d.paths > 0 and math.floor(d.edgesSum / d.paths + 0.5) or 0, edgesMax = d.edgesMax,
				edgeIndexAvg = d.idxN > 0 and math.floor(d.idxSum / d.idxN + 0.5) or 0, states = d.states,
			},
		}
		table.sort(s.usedOrder)
		local parts, sig = {}, {}
		for _, edge in ipairs(s.usedOrder) do
			parts[#parts + 1] = tostring(edge) .. "," .. edgeGeom[edge]
		end
		for _, l in ipairs(s.out) do
			sig[#sig + 1] = tostring(l.id) .. "=" .. l.e .. "/" .. l.p
		end
		sig = table.concat(sig, ";")
		if sig == routesSignature then
			return nil -- unchanged: keep the file on disk
		end
		routesSignature = sig
		return { version = 2, edges = table.concat(parts, ";"), n = #parts, lines = s.out }
	end,
}

--- Stocks of industries and warehouses: per stock {cargo, kind = in|out|store, n, cap}.
local function stocksOf(stockList)
	local out = {}
	local sl = comp(stockList, "STOCK_LIST")
	local enum = api.type.enum.StockListType
	for i, st in ipairs(sl and sl.stocks or {}) do
		local okN, n = pcall(function()
			return api.engine.system.simEntityAtStockSystem.getStockCount(stockList, i - 1)
		end)
		local kind = st.type == enum.InputStock and "in" or st.type == enum.OutputStock and "out" or "store"
		out[#out + 1] = { cargo = st.cargoType, kind = kind, n = okN and tonumber(n) or 0, cap = st.capacity }
	end
	return out
end

jobs.stocks = {
	begin = function()
		local s = { items = {}, i = 1, industries = {}, warehouses = {}, cargo = {} }
		pcall(function()
			for id, name in pairs(api.res.cargoTypeRep.getAll()) do
				local okN, n = pcall(function()
					return api.res.cargoTypeRep.get(id).name
				end)
				s.cargo[#s.cargo + 1] = { id = id, name = okN and n or tostring(name) }
			end
		end)
		local map = api.engine.terrain.makeMapFromGame(true, true, true, false)
		for _, ind in ipairs(map.industries or {}) do
			s.items[#s.items + 1] = { kind = "industry", entity = ind.existing }
		end
		pcall(function()
			api.engine.forEachEntityWithComponent(function(w)
				s.items[#s.items + 1] = { kind = "warehouse", entity = w }
			end, api.type.ComponentType.WAREHOUSE)
		end)
		return s
	end,
	step = function(s)
		local it = s.items[s.i]
		s.i = s.i + 1
		if it == nil then
			return true
		end
		local ok, err = pcall(function()
			if it.kind == "industry" then
				local ind = comp(it.entity, "INDUSTRY")
				if ind and ind.stockList then
					s.industries[#s.industries + 1] = { id = it.entity, s = stocksOf(ind.stockList) }
				end
			else
				local w = comp(it.entity, "WAREHOUSE")
				if w and w.stockList then
					local x, y = bboxCentre(w.construction)
					if x == nil then
						x, y = bboxCentre(it.entity)
					end
					if x ~= nil then
						s.warehouses[#s.warehouses + 1] = {
							id = it.entity, name = nameOf(w.construction) or nameOf(it.entity) or "",
							x = round1(x), y = round1(y), s = stocksOf(w.stockList),
						}
					end
				end
			end
		end)
		if not ok then
			warn("stocks", tostring(it.entity) .. ": " .. tostring(err))
		end
		return s.i > #s.items
	end,
	finish = function(s)
		return { industries = s.industries, warehouses = s.warehouses, cargo = s.cargo }
	end,
}

--- Town outlines: every town building, binned on a CELL m grid per town (the app draws the outline
--- of the occupied cells). Plus the real population (person capacities).
jobs.townAreas = {
	begin = function()
		local s = { buildings = {}, i = 1, cells = {}, order = {}, towns = {} }
		pcall(function()
			for _, t in ipairs(api.engine.terrain.makeMapFromGame(true, true, true, false).towns or {}) do
				s.towns[#s.towns + 1] = { id = t.existing, x = t.pos.x, y = t.pos.y }
			end
		end)
		api.engine.forEachEntityWithComponent(function(b)
			s.buildings[#s.buildings + 1] = b
		end, api.type.ComponentType.TOWN_BUILDING)
		return s
	end,
	step = function(s)
		local b = s.buildings[s.i]
		s.i = s.i + 1
		if b == nil then
			return true
		end
		local ok, err = pcall(function()
			local sc = api.engine.system.streetConnectorSystem
			local okC, con = pcall(function()
				return sc.getConstructionEntityForTownBuilding(b)
			end)
			con = okC and con or nil
			local x, y = bboxCentre(b)
			if x == nil and con and con >= 0 then
				x, y = bboxCentre(con)
			end
			local town = nil
			if con and con >= 0 then
				pcall(function()
					town = sc.getConstructionClosestTown(con)
				end)
			end
			if (town == nil or town < 0) and x ~= nil then -- fallback: nearest town centre
				local best = math.huge
				for _, tw in ipairs(s.towns) do
					local dd = (tw.x - x) ^ 2 + (tw.y - y) ^ 2
					if dd < best then
						best, town = dd, tw.id
					end
				end
			end
			if town and town >= 0 and x ~= nil then
				local cells = s.cells[town]
				if cells == nil then
					cells = {}
					s.cells[town] = cells
					s.order[#s.order + 1] = town
				end
				cells[math.floor(x / CELL) .. "," .. math.floor(y / CELL)] = true
			end
		end)
		if not ok then
			warn("townAreas", tostring(b) .. ": " .. tostring(err))
		end
		return s.i > #s.buildings
	end,
	finish = function(s)
		local out = {}
		for _, town in ipairs(s.order) do
			local keys = {}
			for k in pairs(s.cells[town]) do
				keys[#keys + 1] = k
			end
			table.sort(keys)
			local pop = nil
			pcall(function()
				pop = 0
				for _, v in pairs(api.engine.system.townBuildingSystem.getLandUsePersonCapacities(town)) do
					pop = pop + v
				end
			end)
			out[#out + 1] = { id = town, cells = table.concat(keys, ";"), pop = pop }
		end
		return { cell = CELL, towns = out }
	end,
}

--- Index base of a native vector (:at), detected once: 0 or 1.
local vecBase = nil
local function vecAt(vec, i)
	if vecBase == nil then
		vecBase = pcall(function()
			return vec:at(0)
		end) and 0 or 1
	end
	return vec:at(i - 1 + vecBase)
end

--- Last HISTORY_POINTS points of a logbook series: "t,v;…" (t = game time in ms).
local function series(entity, logName)
	local out = {}
	local ok = pcall(function()
		local lb = comp(entity, "LOG_BOOK")
		local log = lb and lb.name2log_native:find(logName)
		if not log then
			return
		end
		local n = log.times_native:size()
		for i = math.max(1, n - HISTORY_POINTS + 1), n do
			out[#out + 1] = string.format("%d,%d", vecAt(log.times_native, i), vecAt(log.values_native, i))
		end
		if historyDiag == nil and n > 0 then
			historyDiag = { name = logName, n = n, first = out[1], last = out[#out] }
		end
	end)
	if not ok then
		warn("history", tostring(entity) .. " " .. logName)
	end
	return table.concat(out, ";")
end

--- Yearly history of lines (transported) and station groups (loaded / unloaded), from their logbooks.
jobs.history = {
	begin = function()
		local s = { items = {}, i = 1, lines = {}, stations = {}, seen = {} }
		for _, ln in ipairs(playerLines()) do
			s.items[#s.items + 1] = { kind = "line", entity = ln }
			local line = comp(ln, "LINE")
			for _, stop in ipairs(line and line.stops or {}) do
				local g = stop.stationGroup
				if not s.seen[g] then
					s.seen[g] = true
					s.items[#s.items + 1] = { kind = "station", entity = g }
				end
			end
		end
		return s
	end,
	step = function(s)
		local it = s.items[s.i]
		s.i = s.i + 1
		if it == nil then
			return true
		end
		if it.kind == "line" then
			s.lines[#s.lines + 1] = { id = it.entity, tr = series(it.entity, "itemsTransported") }
		else
			s.stations[#s.stations + 1] = {
				id = it.entity, ld = series(it.entity, "itemsLoaded"), ul = series(it.entity, "itemsUnloaded"),
			}
		end
		return s.i > #s.items
	end,
	finish = function(s)
		return { lines = s.lines, stations = s.stations }
	end,
}

-- ------------------------------------------------------------------ commands

local function runCommand(cmd)
	if cmd.action == "teleport" and type(cmd.x) == "number" and type(cmd.y) == "number" then
		local ok, err = pcall(function()
			local z = api.engine.terrain.getHeightAt(api.type.Vec2f.new(cmd.x, cmd.y))
			api.gui.camera.focusPosition(api.type.Vec3f.new(cmd.x, cmd.y, z), tonumber(cmd.dist) or 800)
		end)
		return { seq = cmd.seq, ok = ok, error = ok and nil or tostring(err) }
	end
	return { seq = cmd.seq, ok = false, error = "unknown action " .. tostring(cmd.action) }
end

local function writeStatus(t)
	local cam = nil
	pcall(function()
		local c = api.gui.camera.getCameraData()
		cam = { x = round1(c.x), y = round1(c.y) }
	end)
	io_util.saveTable("live_status", {
		version = FORMAT, t = t, enabled = request and request.enabled and true or false,
		lastCmdSeq = lastCmdSeq, cmd = cmdResult, jobs = jobStats, camera = cam, routes = routesDiag,
		history = historyDiag, format = FORMAT,
	})
end

local function save(kind, data, t, ms)
	if type(data) == "table" then
		data.version = data.version or 1
		data.t = t
		io_util.saveTable("live_" .. kind, data)
	end
	jobStats[kind] = { ms = ms, t = t, ok = true, warn = warnings[kind] }
end

local function fail(kind, err, t, ms)
	jobStats[kind] = { ms = ms, t = t, ok = false, error = tostring(err), warn = warnings[kind] }
end

--- Advance the running stepped job within the frame budget; true when it finished.
local function advance(t)
	local a = active
	local t0 = clock()
	local steps = 0
	while true do
		local ok, done = pcall(a.job.step, a.state)
		steps = steps + 1
		if not ok then
			active = nil
			fail(a.kind, done, t, a.ms + math.floor((clock() - t0) * 1000 + 0.5))
			return true
		end
		if done then
			break
		end
		if steps >= MAX_STEPS or clock() - t0 >= BUDGET_SEC then
			a.ms = a.ms + (clock() - t0) * 1000
			return false
		end
	end
	local ok, data = pcall(a.job.finish, a.state)
	local ms = math.floor(a.ms + (clock() - t0) * 1000 + 0.5)
	active = nil
	if ok then
		save(a.kind, data, t, ms)
	else
		fail(a.kind, data, t, ms)
	end
	return true
end

--- One frame of work: read the request, run a pending command, run (or continue) at most one job.
function M.tick()
	local t = now()
	frame = frame + 1
	if frame == 1 or frame % REQUEST_FRAMES == 0 then
		request = io_util.loadTable("live_request")
		local cmd = request and request.cmd
		if type(cmd) == "table" and type(cmd.seq) == "number" and cmd.seq > lastCmdSeq then
			lastCmdSeq = cmd.seq
			cmdResult = runCommand(cmd)
			writeStatus(t)
			lastStatus = t
		end
	end
	if request == nil or not request.enabled then
		active = nil
		return
	end
	if active then
		advance(t)
	else
		local intervals = request.intervals or {}
		for _, kind in ipairs(KINDS) do
			local every = tonumber(intervals[kind]) or 0
			if every > 0 and (lastRun[kind] == nil or t - lastRun[kind] >= every) then
				lastRun[kind] = t
				warnings[kind] = nil
				local job = jobs[kind]
				if type(job) == "table" then
					local t0 = clock()
					local ok, state = pcall(job.begin)
					if ok then
						active = { kind = kind, job = job, state = state, ms = (clock() - t0) * 1000 }
						advance(t)
					else
						fail(kind, state, t, math.floor((clock() - t0) * 1000 + 0.5))
					end
				else
					local t0 = clock()
					local ok, data = pcall(job)
					local ms = math.floor((clock() - t0) * 1000 + 0.5)
					if ok and type(data) == "table" then
						save(kind, data, t, ms)
					else
						fail(kind, data, t, ms)
					end
				end
				break
			end
		end
	end
	if t - lastStatus >= STATUS_SEC then
		lastStatus = t
		writeStatus(t)
	end
end

return M
