-- Live game data for the HQminiMap app (Visualiser layers) + app commands (teleport, focus, scan).
-- The app writes <UD>/hqminimap/live_request.lua { enabled, intervals = {towns=…, …}, cmd = {seq, …} };
-- this module re-reads it every REQUEST_SEC (REQUEST_FRAMES without a clock) and, at the requested cadence, writes
-- live_towns / live_industries / live_stations / live_lines / live_vehicles / live_stats /
-- live_routes, plus live_status (job timings, first warning, last command). Driven every frame by
-- the GUI pumps (handlers). Fields verified in game by the live probe (2026-10-25).

local io_util = ug_require "hqminimap::/hqminimap/io_util.lua"

local M = {}

-- Cadence: request re-read on the wall clock (REQUEST_SEC, below; every REQUEST_FRAMES frames when
-- os.time is unavailable); jobs and status on wall-clock seconds (os.clock is CPU time, unreliable as
-- a clock in a multi-threaded game; only used for durations).
local REQUEST_FRAMES = 30
local STATUS_SEC = 2
-- An app command is run only within this many seconds of being sent.
local CMD_MAX_AGE_SEC = 60
-- Status cadence while the live data are off.
local STATUS_IDLE_SEC = 10
-- One job at a time. Long jobs (stations, stats, routes) run in steps, BUDGET_SEC per frame at most.
local BUDGET_SEC = 0.003
local MAX_STEPS = 200
-- A station whose position could not be read is retried after this delay.
local RETRY_SEC = 30
local KINDS = { "vehicles", "lines", "stations", "stats", "routes", "stocks", "towns", "industries", "townAreas", "history" }
-- Version of the files written here; the app warns when the game still runs an older mod
-- (ug_require keeps the old code until the save is reloaded).
local FORMAT = 9
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
--- line → set of modes its vehicles use ({ road = true, tram = true } for a mixed line): the
--- pathfinding follows all of them.
local lineModes = {}
--- Where the lines job found each line's mode (diagnostic, live_status.lineModes): from its
--- vehicles, from the line itself (no vehicle), or nowhere ("other").
local modeSources = nil
--- Mode of each TransportMode of the game.
local MODE_OF = {
	TRAIN = "rail", ELECTRIC_TRAIN = "rail", TRAM = "tram", ELECTRIC_TRAM = "tram", TRAM_TRACK = "tram",
	ELECTRIC_TRAM_TRACK = "tram", BUS = "road", TRUCK = "road", CAR = "road", SHIP = "water", SMALL_SHIP = "water",
	AIRCRAFT = "air", SMALL_AIRCRAFT = "air", HELICOPTER = "air",
}

--- Modes a line accepts (LINE.vehicleInfo.transportModes): for a line without vehicles. In game
--- it is a vector (one entry per mode, index = mode + 1; seen: 15 booleans); a table keyed by the
--- mode is read too. Often all false for a line without vehicles. The first vector read is logged
--- once with the enum values (a possible offset of 1 between index and mode).
local declaredLogged = false
local function lineDeclaredModes(line)
	local out, sample = {}, nil
	pcall(function()
		local tm = line.vehicleInfo.transportModes
		local n = 0
		pcall(function()
			n = #tm
		end)
		local vals = {}
		for name, mode in pairs(MODE_OF) do
			local e = api.type.enum.TransportMode[name]
			if e ~= nil then
				local ok, v = pcall(function()
					if n > 0 then
						return tm[e + 1]
					end
					return tm[e]
				end)
				if ok and (v == true or (tonumber(v) or 0) > 0) then
					out[mode] = true
				end
				-- Enum value next to the name: tells whether index = mode + 1 is the right offset.
				vals[#vals + 1] = name .. "(" .. tostring(e) .. ")=" .. tostring(ok and v)
			end
		end
		table.sort(vals)
		-- The raw vector, by index, for the same check.
		local raw = {}
		for i = 1, n do
			local ok, v = pcall(function()
				return tm[i]
			end)
			raw[#raw + 1] = tostring(ok and v)
		end
		sample = type(tm) .. "#" .. tostring(n) .. " " .. table.concat(vals, ",") .. " raw=[" .. table.concat(raw, ",") .. "]"
	end)
	if sample ~= nil and not declaredLogged then
		declaredLogged = true
		io_util.log("line declared modes: " .. sample)
	end
	return out, sample
end
--- line → { fp = stops fingerprint, edges = {edge = true}, extra = {key = "x,y,x,y,…"} }: what was
--- seen on the line's vehicle paths (network edges, lane geometries, bridges over gaps, free legs).
local lineEdges = {}
--- edge → "x0,y0,tx0,ty0,x1,y1,tx1,ty1" (or false: no BASE_EDGE, e.g. inside a station).
local edgeGeom = {}
--- street edge → { f = lanes along the edge, b = lanes against it } (or false: unknown / not a street).
local edgeLanes = {}
--- How the lane counts were read (diagnostic: the street APIs are not verified in TF3).
local lanesDiag = { rep = 0, network = 0, unknown = 0, samples = {} }
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

--- "rail" | "road" | "tram" | "water" | "air" | "other" from a construction file name (fallback,
--- for stations no line serves yet). Order matters: "airport" contains "port", "transport" too.
function M.fileMode(file)
	file = tostring(file or ""):lower()
	local function has(...)
		for _, w in ipairs({ ... }) do
			if file:find(w, 1, true) then
				return true
			end
		end
		return false
	end
	if has("tram") then
		return "tram"
	elseif has("rail", "train") then
		return "rail"
	elseif has("airport", "airfield", "aircraft", "/air/") or file:find("[_/]air_", 1) or file:find("^air_", 1) then
		return "air"
	end
	-- "port" as its own token: support / report / sport / transport / airport are not harbours.
	local stripped = file:gsub("airport", ""):gsub("transport", ""):gsub("support", ""):gsub("report", ""):gsub("sport", "")
	local harbour = has("harbor", "harbour", "water", "ship") or (stripped:find("port", 1, true) ~= nil)
	if harbour then
		return "water"
	elseif has("road", "bus", "truck", "street") then
		return "road"
	end
	return "other"
end
local fileMode = M.fileMode

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
	local map = api.engine.terrain.makeMapFromGame(false, true, false, false)
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
	local map = api.engine.terrain.makeMapFromGame(false, false, true, false)
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
				-- Mode of the lines serving it, the most frequent one (stop shared by buses and trams).
				local mode, count = nil, {}
				pcall(function()
					for _, ln in ipairs(api.engine.system.lineSystem.getLinesForStationGroup(group)) do
						local m = lineMode[ln]
						if m then
							count[m] = (count[m] or 0) + 1
							if mode == nil or count[m] > count[mode] then
								mode = m
							end
						end
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
	modeSources = { vehicles = 0, line = 0, none = 0 }
	for _, ln in ipairs(playerLines()) do
		local entry = { id = ln, name = nameOf(ln) or ("#" .. tostring(ln)), stops = {} }
		pcall(function()
			local c = comp(ln, "COLOR").color
			entry.r, entry.g, entry.b = c.x, c.y, c.z
		end)
		local line = comp(ln, "LINE")
		local stopFile = nil
		for _, stop in ipairs(line and line.stops or {}) do
			local sg = comp(stop.stationGroup, "STATION_GROUP")
			local st = sg and sg.stations and sg.stations[(stop.station or 0) + 1]
			local p = st and stationPos(st)
			stopFile = stopFile or (p and p.file ~= "" and p.file) or nil
			if p then
				entry.stops[#entry.stops + 1] = { g = stop.stationGroup, x = round1(p.x), y = round1(p.y) }
			end
		end
		local v = lineVehicles(ln)
		entry.vehicles = #v
		-- Mode: the first vehicle's; the pathfinding follows every vehicle's (mixed lines).
		local modes, first = {}, nil
		for _, veh in ipairs(v) do
			local tv = comp(veh, "TRANSPORT_VEHICLE")
			if tv and entry.carrier == nil then
				entry.carrier = tv.carrier
			end
			local m = tv and carrierMode(tv.carrier)
			if m then
				modes[m] = true
				first = first or m
			end
		end
		if first then
			lineMode[ln] = first
			modeSources.vehicles = modeSources.vehicles + 1
		else
			-- No vehicle: the modes the line accepts.
			local decl, sample = lineDeclaredModes(line)
			local m = decl.rail and "rail" or decl.tram and "tram" or decl.road and "road" or decl.water and "water"
				or decl.air and "air" or nil
			-- Else the kind of station of its first stop (file name of its construction).
			if m == nil and stopFile then
				local f = fileMode(stopFile)
				if f ~= "other" then
					m = f
					decl = { [f] = true }
				end
			end
			if m then
				lineMode[ln] = m
				modes = decl
				modeSources.line = modeSources.line + 1
			elseif lineMode[ln] == nil then
				modeSources.none = modeSources.none + 1
				modeSources.sample = modeSources.sample or (tostring(sample) .. " | stop file: " .. tostring(stopFile))
			end
		end
		if next(modes) then
			lineModes[ln] = modes
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
--- Spread over frames: one vehicle per step (the pump's budget loops steps).
jobs.vehicles = {
	begin = function()
		local list = {}
		for _, ln in ipairs(playerLines()) do
			for _, v in ipairs(lineVehicles(ln)) do
				list[#list + 1] = { v = v, ln = ln }
			end
		end
		return { list = list, i = 1, parts = {}, t = now() }
	end,
	step = function(s)
		local item = s.list[s.i]
		s.i = s.i + 1
		if item == nil then
			return true
		end
		pcall(function()
			local p = api.engine.util.vehicle.getPosition(item.v)
			if not p then
				return
			end
			local pn, pc, cn, cc = vehicleLoad(item.v)
			s.parts[#s.parts + 1] = string.format("%d,%d,%d,%d,%d,%d,%d,%d,%s", math.floor(item.v), math.floor(item.ln),
				round1(p.x), round1(p.y), math.floor(pn), math.floor(pc), math.floor(cn), math.floor(cc),
				vehicleName(item.v, s.t))
		end)
		return s.i > #s.list
	end,
	finish = function(s)
		local seen = {}
		for _, item in ipairs(s.list) do
			seen[item.v] = true
		end
		for id in pairs(vehicleNames) do
			if not seen[id] then
				vehicleNames[id] = nil
			end
		end
		return { v = table.concat(s.parts, ";"), n = #s.parts }
	end,
}

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

--- Length of a Lua table or of a game vector (userdata: no # in some builds): #, :size(), or count.
local function seqLen(v)
	if v == nil then
		return 0
	end
	local ok, n = pcall(function()
		return #v
	end)
	if ok and type(n) == "number" and n > 0 then
		return n
	end
	ok, n = pcall(function()
		return v:size()
	end)
	if ok and type(n) == "number" then
		return n
	end
	local k = 0
	pcall(function()
		while k < 64 and v[k + 1] ~= nil do
			k = k + 1
		end
	end)
	return k
end

local function field(v, name)
	local ok, x = pcall(function()
		return v[name]
	end)
	if ok then
		return x -- may be false (forward = false): not "ok and x or nil"
	end
	return nil
end

--- Driving lanes of a street edge, per direction: from its street type (laneConfigs, sidewalks
--- first and last), else from its TRANSPORT_NETWORK lanes open to buses (split evenly). Cached.
--- None of these game APIs is documented for TF3: what each step returned on the first edges that
--- gave nothing is kept in lanesDiag.samples (live_status.routes.streetLanes).
local function streetLanes(edge)
	local c = edgeLanes[edge]
	if c ~= nil then
		return c
	end
	local st = comp(edge, "BASE_EDGE_STREET")
	if st == nil then
		edgeLanes[edge] = false
		return false
	end
	local res, trace = false, {}
	local function note(k, v)
		trace[#trace + 1] = k .. "=" .. tostring(v)
	end
	local stype = field(st, "streetType")
	note("streetType", stype)
	local okRep, t = pcall(function()
		return api.res.streetTypeRep.get(stype)
	end)
	note("get", okRep and type(t) or ("error: " .. tostring(t)))
	pcall(function()
		note("name", api.res.streetTypeRep.getName(stype))
	end)
	local lc = okRep and t and field(t, "laneConfigs") or nil
	local n = seqLen(lc)
	note("laneConfigs", lc == nil and "nil" or (type(lc) .. "#" .. n))
	if n >= 3 then
		local f, b, flags = 0, 0, {}
		for k = 2, n - 1 do
			local fw = field(lc[k], "forward")
			flags[#flags + 1] = tostring(fw)
			if fw == false then
				b = b + 1
			else
				f = f + 1
			end
		end
		note("forward", table.concat(flags, "/"))
		res = { f = f, b = b }
		lanesDiag.rep = lanesDiag.rep + 1
	end
	if not res then
		local tn = comp(edge, "TRANSPORT_NETWORK")
		local lanes = tn and field(tn, "edges") or nil
		local m = seqLen(lanes)
		local bus = nil
		pcall(function()
			bus = api.type.enum.TransportMode.BUS
		end)
		note("tn.edges", lanes == nil and "nil" or m)
		note("BUS", bus)
		local count, modesSeen = 0, nil
		for k = 1, m do
			local tm = field(lanes[k], "transportModes")
			if modesSeen == nil and tm ~= nil then
				local parts = {}
				for q = 1, math.min(16, seqLen(tm)) do
					parts[#parts + 1] = tostring(field(tm, q))
				end
				modesSeen = type(tm) .. "[" .. table.concat(parts, ",") .. "]"
			end
			if tm ~= nil and bus ~= nil and (tonumber(field(tm, bus + 1)) or 0) > 0 then
				count = count + 1
			end
		end
		note("modes", modesSeen)
		if count > 0 then
			res = { f = math.ceil(count / 2), b = math.floor(count / 2) }
			lanesDiag.network = lanesDiag.network + 1
		else
			lanesDiag.unknown = lanesDiag.unknown + 1
		end
	end
	if #lanesDiag.samples < 3 and (not res or #lanesDiag.samples < 1) then
		lanesDiag.samples[#lanesDiag.samples + 1] = "edge " .. edge .. ": " .. table.concat(trace, "; ")
	end
	edgeLanes[edge] = res
	return res
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

--- Free legs (ships, aircraft): one track per crossing, both ways together: the mean of its last
--- FREE_TRIPS trips (a trip the other way is turned round), so one odd trip does not show. Trips
--- whose ends are within FREE_SNAP m of a crossing's ends (either way) are that crossing.
local FREE_TRIPS = 3
local FREE_SNAP = 150

--- pts resampled to n points evenly spaced along it.
local function resample(pts, n)
	local acc = { 0 }
	for i = 2, #pts do
		acc[i] = acc[i - 1] + math.sqrt((pts[i][1] - pts[i - 1][1]) ^ 2 + (pts[i][2] - pts[i - 1][2]) ^ 2)
	end
	local total, out, j = acc[#pts], {}, 2
	for k = 0, n - 1 do
		local t = total * k / (n - 1)
		while j < #pts and acc[j] < t do
			j = j + 1
		end
		local a, b = acc[j - 1], acc[j]
		local u = b > a and (t - a) / (b - a) or 0
		out[#out + 1] = { pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * u, pts[j - 1][2] + (pts[j][2] - pts[j - 1][2]) * u }
	end
	return out
end

--- Records a free-leg trip on the line `le` and returns its crossing's key and mean track.
local function freeTrip(le, pts)
	local a, b = pts[1], pts[#pts]
	local function near(p, q)
		return math.abs(p[1] - q[1]) <= FREE_SNAP and math.abs(p[2] - q[2]) <= FREE_SNAP
	end
	local leg
	for _, l in ipairs(le.free) do
		if near(l.a, a) and near(l.b, b) then
			leg = l
			break
		elseif near(l.a, b) and near(l.b, a) then
			-- The way back: turned round, so all the trips of a crossing run the same way.
			local r = {}
			for k = #pts, 1, -1 do
				r[#r + 1] = pts[k]
			end
			pts, leg = r, l
			break
		end
	end
	if not leg then
		leg = { a = a, b = b, trips = {}, key = string.format("free:%d,%d>%d,%d", round1(a[1] / 50), round1(a[2] / 50), round1(b[1] / 50), round1(b[2] / 50)) }
		le.free[#le.free + 1] = leg
	end
	-- The same trip is seen on every pass while the vehicle travels it: count it once.
	local sig = ptsString(pts)
	local known = false
	for _, t in ipairs(leg.trips) do
		known = known or t.sig == sig
	end
	if not known then
		leg.trips[#leg.trips + 1] = { sig = sig, pts = pts }
		if #leg.trips > FREE_TRIPS then
			table.remove(leg.trips, 1)
		end
	end
	if #leg.trips == 1 then
		return leg.key, leg.trips[1].pts
	end
	local n = 2
	for _, t in ipairs(leg.trips) do
		n = math.max(n, #t.pts)
	end
	local mean = {}
	for k = 1, n do
		mean[k] = { 0, 0 }
	end
	for _, t in ipairs(leg.trips) do
		for k, p in ipairs(resample(t.pts, n)) do
			mean[k][1] = mean[k][1] + p[1] / #leg.trips
			mean[k][2] = mean[k][2] + p[2] / #leg.trips
		end
	end
	return leg.key, mean
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

--- Reads one path element: a pair { EdgeId, dir } (vehicle paths) or an object with .edgeId/.dir
--- (EdgeIdDir), read under pcall since userdata may refuse a missing key. → id, forward, how
--- ("pair", "field" or "none": no direction found, taken as along the geometry).
local function pathStep(e)
	local function get(k)
		local ok, v = pcall(function()
			return e[k]
		end)
		if ok then
			return v
		end
	end
	local id = get(1) or get("edgeId")
	if type(id) ~= "table" and type(id) ~= "userdata" then
		return nil, true, "none"
	end
	local entOk, ent = pcall(function()
		return id.entity
	end)
	if not entOk or ent == nil then
		return nil, true, "none"
	end
	local dir, how = get(2), "pair"
	if dir == nil then
		dir, how = get("dir"), "field"
	end
	if dir == nil then
		return id, true, "none"
	end
	return id, dir ~= false, how
end

local function walkPath(path, le, d)
	local prevEnd, gap = nil, false
	for _, e in ipairs(path and path.edges or {}) do
		local id, fwd, how = pathStep(e)
		local entity, index = id and id.entity, id and id.index or 0
		d.dirs[how] = d.dirs[how] + 1
		local first, last = nil, nil
		local skipped = false
		if entity and entity >= 0 and isNode(entity) then
			skipped = true
			d.nodes = d.nodes + 1
		elseif entity and entity >= 0 then
			local g = edgeGeometry(entity)
			if g then
				-- Direction mask: 1 = along the edge geometry (position0 → position1), 2 = against it.
				local mask = le.edges[entity] or 0
				if fwd and mask % 2 == 0 then
					mask = mask + 1
				elseif not fwd and mask < 2 then
					mask = mask + 2
				end
				le.edges[entity] = mask
				le.edgeSeen = le.edgeSeen or {}
				le.edgeSeen[entity] = routesPass
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
						le.extraSeen = le.extraSeen or {}
						le.extraSeen["tn:" .. entity .. ":" .. index] = routesPass
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
					le.extraSeen = le.extraSeen or {}
					le.extraSeen[string.format("br:%d,%d", round1(prevEnd[1]), round1(prevEnd[2]))] = routesPass
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

--- Transport modes the game's pathfinding may use for a line's mode (legs between its stops).
local LEG_MODES = {
	rail = { "TRAIN", "ELECTRIC_TRAIN" }, road = { "BUS", "TRUCK", "CAR" },
	tram = { "TRAM", "ELECTRIC_TRAM", "TRAM_TRACK", "ELECTRIC_TRAM_TRACK" },
}
--- A leg's path is recomputed after this many routes passes (track changes).
local LEG_REFRESH = 10
--- Pathfinding calls per routes step (the rest of a line waits for the next frame).
local LEG_PER_STEP = 4
local legBudget = 0
--- "nodeA>nodeB" → { pass, path = {{EdgeId, dir}} } (false path: no route found).
local legCache = {}
local routesPass = 0

local function legHash(key)
	local h = 0
	for i = 1, #key do
		h = (h * 33 + key:byte(i)) % LEG_REFRESH
	end
	return h
end

--- Drop geometry caches every LEG_REFRESH passes, and legs not seen for ~3 passes of that.
local function purgeGeomCaches()
	if routesPass % LEG_REFRESH ~= 0 then
		return
	end
	edgeGeom = {}
	nodeCache = {}
	edgeLanes = {}
	stationPosCache = {}
	for k, c in pairs(legCache) do
		if routesPass - (c.pass or 0) >= 3 * LEG_REFRESH then
			legCache[k] = nil
		end
	end
end

local function purgeLines(lines)
	local alive = {}
	for _, ln in ipairs(lines or {}) do
		alive[ln] = true
	end
	for ln in pairs(lineEdges) do
		if not alive[ln] then
			lineEdges[ln] = nil
		end
	end
	for ln in pairs(lineMode) do
		if not alive[ln] then
			lineMode[ln] = nil
		end
	end
	for ln in pairs(lineModes) do
		if not alive[ln] then
			lineModes[ln] = nil
		end
	end
end

--- Forget edges and extra pieces of one line not seen for ~3 refresh cycles.
local function forgetStalePieces(le)
	local limit = 3 * LEG_REFRESH
	le.edgeSeen = le.edgeSeen or {}
	le.extraSeen = le.extraSeen or {}
	for e, p in pairs(le.edgeSeen) do
		if routesPass - p >= limit then
			le.edges[e] = nil
			le.edgeSeen[e] = nil
		end
	end
	for k, p in pairs(le.extraSeen) do
		if routesPass - p >= limit then
			le.extra[k] = nil
			le.extraSeen[k] = nil
		end
	end
end

--- Vehicle node of a line stop's terminal (where its vehicles stop): entity, index.
local function stopNode(stop)
	local sg = comp(stop.stationGroup, "STATION_GROUP")
	local st = sg and sg.stations and sg.stations[(stop.station or 0) + 1]
	local station = st and comp(st, "STATION")
	local term = station and station.terminals and station.terminals[(stop.terminal or 0) + 1]
	local n = term and term.vehicleNodeId
	if n and n.entity then
		return n.entity, n.index or 0
	end
	return nil
end

--- Path of every leg of a line (stop i → stop i+1, last → first) from the game's pathfinding, so a
--- leg shows even when no vehicle was seen on it. Cached; `d` counts computed / cached / failed.
--- `modes`: the line's modes (set, "rail" = true …); legs only for the network ones.
local function walkLegs(line, modes, le, d)
	local names = {}
	for m in pairs(modes or {}) do
		for _, n in ipairs(LEG_MODES[m] or {}) do
			names[#names + 1] = n
		end
	end
	local stops = line and line.stops or {}
	if #names == 0 or #stops < 2 then
		return
	end
	local modes = {}
	for _, n in ipairs(names) do
		local ok, m = pcall(function()
			return api.type.enum.TransportMode[n]
		end)
		if ok and m ~= nil then
			modes[#modes + 1] = m
		end
	end
	for i = 1, #stops do
		local ea, ia = stopNode(stops[i])
		local eb, ib = stopNode(stops[i % #stops + 1])
		if ea and eb then
			local key = ea .. ":" .. ia .. ">" .. eb .. ":" .. ib
			local c = legCache[key]
			local refresh = c == nil or routesPass - c.pass >= LEG_REFRESH
			-- Spread recomputes across passes (hash) so one frame does not pathfind every leg.
			local turn = c == nil or legHash(key) == (routesPass % LEG_REFRESH)
			if refresh and turn then
				if legBudget <= 0 then
					return true
				end
				legBudget = legBudget - 1
				local ok, path = pcall(function()
					local P = api.engine.util.pathfinding
					return P.findPathNodeToNode({ api.type.NodeId.new(ea, ia) }, { api.type.NodeId.new(eb, ib) }, modes)
				end)
				if ok and type(path) == "table" and #path > 0 then
					c = { pass = routesPass, path = path }
					d.legsComputed = d.legsComputed + 1
				else
					c = { pass = routesPass, path = false }
					if not ok then
						warn("routes", "leg " .. key .. ": " .. tostring(path))
					end
				end
				legCache[key] = c
			elseif c then
				d.legsCached = d.legsCached + 1
			end
			if c.path then
				walkPath({ edges = c.path }, le, d)
			else
				d.legsFailed = d.legsFailed + 1 -- no route between these stops (counted every pass)
			end
		end
	end
end

--- Line tracks: a line stores only its stops, so the paths of its vehicles are accumulated
--- (each path covers the current leg); the whole route fills in as vehicles run. Ships and aircraft
--- (MOVE_PATH_AIRCRAFT): network paths at the ports + the free leg (path1) sampled every ~50 m.
jobs.routes = {
	begin = function()
		routesPass = routesPass + 1
		local lines = playerLines()
		purgeGeomCaches()
		purgeLines(lines)
		return {
			lines = lines, i = 1, out = {}, used = {}, usedOrder = {},
			d = {
				missing = 0, bridges = 0, lanes = 0, free = 0, bigGaps = 0, nodes = 0, samples = {},
				legsComputed = 0, legsCached = 0, legsFailed = 0, dirs = { pair = 0, field = 0, none = 0 },
				paths = 0, edgesSum = 0, edgesMax = 0, idxSum = 0, idxN = 0, states = {},
			},
		}
	end,
	step = function(s)
		local ln = s.lines[s.i]
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
			le = { fp = fp, edges = {}, extra = {}, free = {} }
			lineEdges[ln] = le
		end
		le.free = le.free or {}
		forgetStalePieces(le)
		-- Every leg from the pathfinding, then the vehicles' actual paths (detours, other terminals).
		legBudget = LEG_PER_STEP
		local okL, more = pcall(walkLegs, line, lineModes[ln] or (lineMode[ln] and { [lineMode[ln]] = true }), le, s.d)
		if not okL then
			warn("routes", "legs of line " .. tostring(ln) .. ": " .. tostring(more))
		elseif more then
			return false
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
						local key, mean = freeTrip(le, pts)
						le.extra[key] = ptsString(mean)
						le.extraSeen = le.extraSeen or {}
						le.extraSeen[key] = routesPass
						s.d.free = s.d.free + 1
					end
				end
			end)
		end
		local ids = {}
		for edge, mask in pairs(le.edges) do
			if not exists(edge) then
				le.edges[edge] = nil
			elseif edgeGeometry(edge) then
				-- Signed ids: edge travelled along its geometry, -edge against it (both: both).
				if mask == true or mask % 2 == 1 then
					ids[#ids + 1] = edge
				end
				if mask ~= true and mask >= 2 then
					ids[#ids + 1] = -edge
				end
				if not s.used[edge] then
					s.used[edge] = true
					s.usedOrder[#s.usedOrder + 1] = edge
					streetLanes(edge)
				end
			end
		end
		table.sort(ids, function(a, b)
			local x, y = math.abs(a), math.abs(b)
			if x ~= y then
				return x < y
			end
			return a > b
		end)
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
		s.i = s.i + 1
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
			streetLanes = lanesDiag,
			legs = { computed = d.legsComputed, cached = d.legsCached, failed = d.legsFailed },
			-- How each path step gave its direction (pair [2], field .dir, none = taken as forward).
			dirs = d.dirs,
			pathStats = {
				paths = d.paths, edgesAvg = d.paths > 0 and math.floor(d.edgesSum / d.paths + 0.5) or 0, edgesMax = d.edgesMax,
				edgeIndexAvg = d.idxN > 0 and math.floor(d.idxSum / d.idxN + 0.5) or 0, states = d.states,
			},
		}
		table.sort(s.usedOrder)
		local parts, sig = {}, {}
		for _, edge in ipairs(s.usedOrder) do
			-- Streets: + driving lanes along / against the edge (the app limits the lines' lanes to them).
			local ln = streetLanes(edge)
			parts[#parts + 1] = tostring(edge) .. "," .. edgeGeom[edge] .. (ln and ("," .. ln.f .. "," .. ln.b) or "")
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
		local map = api.engine.terrain.makeMapFromGame(false, false, true, false)
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
			for _, t in ipairs(api.engine.terrain.makeMapFromGame(false, true, false, false).towns or {}) do
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
			local tv, vv = tonumber(vecAt(log.times_native, i)) or 0, tonumber(vecAt(log.values_native, i)) or 0
			out[#out + 1] = string.format("%d,%d", math.floor(tv), math.floor(vv))
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

--- Entity whose in-game window shows an object of the app: industries and warehouses open their
--- construction, stations their station group (the app's station id), the rest themselves.
local function windowEntity(kind, id)
	if kind == "industries" then
		local ok, con = pcall(function()
			return api.engine.system.streetConnectorSystem.getConstructionEntityForIndustry(id)
		end)
		return ok and con and con >= 0 and con or id
	elseif kind == "warehouses" then
		local w = comp(id, "WAREHOUSE")
		return w and w.construction and w.construction >= 0 and w.construction or id
	end
	return id
end

local function runCommand(cmd, react)
	local function focus()
		local z = api.engine.terrain.getHeightAt(api.type.Vec2f.new(cmd.x, cmd.y))
		api.gui.camera.focusPosition(api.type.Vec3f.new(cmd.x, cmd.y, z), tonumber(cmd.dist) or 800)
	end
	if cmd.action == "teleport" and type(cmd.x) == "number" and type(cmd.y) == "number" then
		local ok, err = pcall(focus)
		return { seq = cmd.seq, ok = ok, error = ok and nil or tostring(err) }
	end
	-- Double-click on an object of the app: camera on it, then (option) its in-game window.
	if cmd.action == "focus" and type(cmd.x) == "number" and type(cmd.y) == "number" then
		local ok, err = pcall(focus)
		if ok and cmd.open and type(cmd.id) == "number" then
			ok, err = pcall(function()
				if react == nil or type(react.fireEvent) ~= "function" then
					error("no GUI handle to open the window")
				end
				react.fireEvent(nil, "selectEntity", { entity = windowEntity(cmd.kind, cmd.id), stack = false })
			end)
		end
		return { seq = cmd.seq, ok = ok, error = ok and nil or tostring(err) }
	end
	-- Scan scheduled by the app (capture_plan + cutscene written just before): start it now. The
	-- scan is ticked by the GUI pump (mod button, always there), window open or not.
	if cmd.action == "scan" then
		local ok, res = pcall(function()
			local capture = ug_require "hqminimap::/hqminimap/capture.lua"
			if capture.isBusy() then
				return { ok = false, error = "busy" }
			end
			return capture.start()
		end)
		if not ok then
			return { seq = cmd.seq, ok = false, error = tostring(res) }
		end
		return { seq = cmd.seq, ok = res.ok == true, error = res.ok and nil or tostring(res.error) }
	end
	return { seq = cmd.seq, ok = false, error = "unknown action " .. tostring(cmd.action) }
end

local function writeStatus(t)
	local cam, screen = nil, nil
	pcall(function()
		local c = api.gui.camera.getCameraData()
		cam = { x = round1(c.x), y = round1(c.y) }
	end)
	-- Size of the game view in pixels = size of its screenshots (the app plans the scan with it).
	pcall(function()
		local v = api.gui.camera.getSize()
		local w, h = tonumber(v.x or v[1]), tonumber(v.y or v[2])
		if w and h and w > 0 and h > 0 then
			screen = { w = math.floor(w + 0.5), h = math.floor(h + 0.5) }
		end
	end)
	io_util.saveTable("live_status", {
		version = FORMAT, t = t, enabled = request and request.enabled and true or false,
		lastCmdSeq = lastCmdSeq, cmd = cmdResult, jobs = jobStats, camera = cam, screen = screen, routes = routesDiag, lineModes = modeSources,
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
-- Request re-read on the wall clock (frame count depends on the game's fps; os.time has whole
-- seconds, so this is about once a second). Without a clock: every REQUEST_FRAMES frames.
local REQUEST_SEC = 0.5
local lastRequestAt = nil

function M.tick(react)
	local t = now()
	frame = frame + 1
	local wall = io_util.nowUnix()
	local due
	if wall ~= nil then
		due = lastRequestAt == nil or wall - lastRequestAt >= REQUEST_SEC
	else
		due = frame == 1 or frame % REQUEST_FRAMES == 0
	end
	if due then
		lastRequestAt = wall
		local loaded = io_util.loadTable("live_request")
		-- A failed read must not drop the request we already have (that would cancel the running job).
		if loaded ~= nil then
			request = loaded
		end
		local cmd = request and request.cmd
		if type(cmd) == "table" and type(cmd.seq) == "number" and cmd.seq > lastCmdSeq then
			lastCmdSeq = cmd.seq
			-- Sent more than CMD_MAX_AGE_SEC ago (left in the file, read again after a save or mod
			-- reload): dropped, never replayed (a scan would start on its own).
			local wall = io_util.nowUnix()
			-- A scan must be stamped. Without a clock, a stamped command cannot be aged: treat it as stale.
			local stale = (cmd.action == "scan" and type(cmd.at) ~= "number")
				or (type(cmd.at) == "number" and (wall == nil or math.abs(wall - cmd.at) > CMD_MAX_AGE_SEC))
			if stale then
				cmdResult = { seq = cmd.seq, ok = false, error = "stale" }
			else
				cmdResult = runCommand(cmd, react)
			end
			writeStatus(t)
			lastStatus = t
		end
	end
	local captureBusy = false
	pcall(function()
		local cap = ug_require "hqminimap::/hqminimap/capture.lua"
		captureBusy = cap ~= nil and cap.isBusy()
	end)
	if captureBusy then
		if t - lastStatus >= STATUS_SEC then
			lastStatus = t
			writeStatus(t)
		end
		return
	end
	if request == nil or not request.enabled then
		active = nil
		-- Live data off: the status still tells the app the game runs, and its screen size.
		if t - lastStatus >= STATUS_IDLE_SEC then
			lastStatus = t
			writeStatus(t)
		end
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
