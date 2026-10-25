-- Mod UI strings. The language follows the game (api.util.getLanguage), English otherwise.
-- Add a language: copy the `en` table under its code ("de", "es"…) and translate the values
-- (keep the %s / %d placeholders, in the same order). See docs/TRANSLATING.md.

local M = {}

local STRINGS = {
	en = {
		export_button = "Export map",
		capture_button = "Capture",
		help = "1. Export map  >  2. HQminiMap app: set the grid, “Write to mod”  >  3. Capture",
		status_ready = "Ready",
		status_exporting = "Exporting the map…",
		status_exported = "Map exported: set the grid in the HQminiMap app, write it to the mod, then Capture",
		status_export_error = "Export error: %s",
		status_busy_export = "Capture in progress: export not possible",
		status_module_missing = "Error: module %s not found (reload the mod)",
		status_capture_error = "Capture error: %s",
		status_capture_impossible = "Capture not possible: %s",
		status_new_plan = "New grid ready: %dx%d (%d images) - click “Capture”",
		status_capture_prep = "Capture %dx%d: preparing the lighting…",
		status_capture_progress = "Capture %d/%d",
		status_capture_done = "Capture finished: %d/%d images",
		status_error = "Error: %s",
		err_busy = "a capture is already running",
		err_no_plan = "no grid: write it from the HQminiMap app (GridLab)",
		err_plan_invalid = "invalid capture_plan.lua (nX/nY/centers)",
		err_mismatch = "the cutscene does not match the grid (%d images instead of %d): write the grid again from the app",
		err_not_started = "the cutscene did not start (grid written from the HQminiMap app?)",
		err_timeout = "cutscene timeout, images=%d",
		err_window_closed = "window closed",
		err_restarted = "restarted",
	},
	fr = {
		export_button = "Exporter la carte",
		capture_button = "Capturer",
		help = "1. Exporter la carte  >  2. App HQminiMap : régler la grille, « Écrire dans le mod »  >  3. Capturer",
		status_ready = "Prêt",
		status_exporting = "Export de la carte…",
		status_exported = "Carte exportée : régler la grille dans l'app HQminiMap, l'écrire dans le mod, puis Capturer",
		status_export_error = "Erreur export : %s",
		status_busy_export = "Capture en cours : export impossible",
		status_module_missing = "Erreur : module %s introuvable (recharger le mod)",
		status_capture_error = "Erreur capture : %s",
		status_capture_impossible = "Capture impossible : %s",
		status_new_plan = "Nouvelle grille prête : %dx%d (%d images) - clique « Capturer »",
		status_capture_prep = "Capture %dx%d : préparation de l'éclairage…",
		status_capture_progress = "Capture %d/%d",
		status_capture_done = "Capture terminée : %d/%d images",
		status_error = "Erreur : %s",
		err_busy = "capture déjà en cours",
		err_no_plan = "aucune grille : l'écrire depuis l'app HQminiMap (GridLab)",
		err_plan_invalid = "capture_plan.lua invalide (nX/nY/centers)",
		err_mismatch = "la cutscene ne correspond pas à la grille (%d images au lieu de %d) : réécrire la grille dans l'app",
		err_not_started = "la cutscene n'a pas démarré (grille écrite depuis l'app HQminiMap ?)",
		err_timeout = "timeout cutscene, images=%d",
		err_window_closed = "fenêtre fermée",
		err_restarted = "relancée",
	},
}

local lang = nil

--- Two-letter language of the game ("fr", "en"…), from api.util.getLanguage(); logged once.
local function detect()
	local ok, info = pcall(function()
		return api.util.getLanguage()
	end)
	local code = nil
	if ok and type(info) == "table" then
		local parts = {}
		for k, v in pairs(info) do
			parts[#parts + 1] = tostring(k) .. "=" .. tostring(v)
		end
		print("[hqminimap] game language: " .. table.concat(parts, ", "))
		code = info.code or info.locale or info.language or info.name or info.id
	elseif ok and type(info) == "string" then
		code = info
	end
	code = type(code) == "string" and code:sub(1, 2):lower() or "en"
	return STRINGS[code] and code or "en"
end

function M.language()
	if lang == nil then
		lang = detect()
	end
	return lang
end

--- Translated string for key, formatted with string.format(...) when arguments are given.
function M.t(key, ...)
	local s = STRINGS[M.language()][key] or STRINGS.en[key] or key
	if select("#", ...) > 0 then
		local ok, out = pcall(string.format, s, ...)
		return ok and out or s
	end
	return s
end

return M
