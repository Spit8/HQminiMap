-- Mod UI strings. The language follows the game (api.util.getLanguage), English otherwise.
-- Add a language: copy the `en` table under its code ("de", "es"…) and translate the values
-- (keep the %s / %d placeholders, in the same order). See docs/TRANSLATING.md.

local M = {}

local STRINGS = {
	en = {
		export_button = "Export map",
		capture_button = "Scan",
		help = "1. Export map  >  2. HQminiMap app: choose a mode, “Scan the map in game”",
		status_ready = "Ready",
		status_exporting = "Exporting the map…",
		status_exported = "Map exported: in the HQminiMap app, choose a mode and \"Scan the map in game\"",
		status_export_error = "Export error: %s",
		status_busy_export = "Scan in progress: export not possible",
		status_module_missing = "Error: module %s not found (reload the mod)",
		status_capture_error = "Scan error: %s",
		status_capture_impossible = "Scan not possible: %s",
		status_new_plan = "New scan received: %dx%d (%d images)",
		status_capture_prep = "Scan %dx%d: preparing the lighting…",
		status_capture_progress = "Scan %d/%d",
		status_capture_done = "Scan finished: %d/%d images",
		status_error = "Error: %s",
		err_busy = "a scan is already running",
		err_no_plan = "no grid: write it from the HQminiMap app (GridLab)",
		err_plan_invalid = "invalid capture_plan.lua (nX/nY/centers)",
		err_mismatch = "the cutscene does not match the grid (%d images instead of %d): start the scan again from the app",
		err_not_started = "the cutscene did not start (grid written from the HQminiMap app?)",
		err_timeout = "cutscene timeout, images=%d",
		err_window_closed = "window closed",
		err_restarted = "restarted",
	},
	fr = {
		export_button = "Exporter la carte",
		capture_button = "Scanner",
		help = "1. Exporter la carte  >  2. App HQminiMap : choisir un mode, « Scanner la carte en jeu »",
		status_ready = "Prêt",
		status_exporting = "Export de la carte…",
		status_exported = "Carte exportée : dans l'app HQminiMap, choisis un mode et « Scanner la carte en jeu »",
		status_export_error = "Erreur export : %s",
		status_busy_export = "Scan en cours : export impossible",
		status_module_missing = "Erreur : module %s introuvable (recharger le mod)",
		status_capture_error = "Erreur de scan : %s",
		status_capture_impossible = "Scan impossible : %s",
		status_new_plan = "Nouveau scan reçu : %dx%d (%d images)",
		status_capture_prep = "Scan %dx%d : préparation de l'éclairage…",
		status_capture_progress = "Scan %d/%d",
		status_capture_done = "Scan terminé : %d/%d images",
		status_error = "Erreur : %s",
		err_busy = "scan déjà en cours",
		err_no_plan = "aucune grille : l'écrire depuis l'app HQminiMap (GridLab)",
		err_plan_invalid = "capture_plan.lua invalide (nX/nY/centers)",
		err_mismatch = "la cutscene ne correspond pas à la grille (%d images au lieu de %d) : relancer le scan depuis l'app",
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
