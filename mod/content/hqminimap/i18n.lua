-- Mod UI strings. The language follows the game (api.util.getLanguage), English otherwise.
-- `en` and `fr` are written by hand; the de / it / es / zh tables between the "generated" markers
-- are written by tools/i18n/import.mts (do not edit them: see tools/i18n/README.md). Every table
-- keeps the %s / %d placeholders of `en`, in the same order (checked by app/test/i18n.test.ts).

local M = {}

local STRINGS = {
	en = {
		export_button = "Export map",
		help = "1. Export map  >  2. HQminiMap app: choose a mode, “Scan the map in game”",
		status_ready = "Ready",
		status_exporting = "Exporting the map…",
		status_exported = "Map exported: in the HQminiMap app, choose a mode and \"Scan the map in game\"",
		status_export_error = "Export error: %s",
		status_busy_export = "Scan in progress: export not possible",
		status_module_missing = "Error: module %s not found (reload the mod)",
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
		err_skipped = "skipped image (tile %d)",
		err_window_closed = "window closed",
	},
	fr = {
		export_button = "Exporter la carte",
		help = "1. Exporter la carte  >  2. App HQminiMap : choisir un mode, « Scanner la carte en jeu »",
		status_ready = "Prêt",
		status_exporting = "Export de la carte…",
		status_exported = "Carte exportée : dans l'app HQminiMap, choisis un mode et « Scanner la carte en jeu »",
		status_export_error = "Erreur export : %s",
		status_busy_export = "Scan en cours : export impossible",
		status_module_missing = "Erreur : module %s introuvable (recharger le mod)",
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
		err_skipped = "image sautée (tuile %d)",
		err_window_closed = "fenêtre fermée",
	},
	-- BEGIN generated de (tools/i18n/import.mts)
	de = {
		export_button = "Karte exportieren",
		help = "1. Karte exportieren  >  2. HQminiMap-App: Modus wählen, „Karte im Spiel scannen“",
		status_ready = "Bereit",
		status_exporting = "Die Karte wird exportiert…",
		status_exported = "Karte exportiert: Wähle in der HQminiMap-App einen Modus, dann „Karte im Spiel scannen“",
		status_export_error = "Exportfehler: %s",
		status_busy_export = "Scan läuft: Export nicht möglich",
		status_module_missing = "Fehler: Modul %s nicht gefunden (Mod neu laden)",
		status_new_plan = "Neuer Scan empfangen: %dx%d (%d Bilder)",
		status_capture_prep = "Scan %dx%d: Vorbereitung der Beleuchtung…",
		status_capture_progress = "Scan %d/%d",
		status_capture_done = "Scan abgeschlossen: %d/%d Bilder",
		status_error = "Fehler: %s",
		err_busy = "ein Scan läuft bereits",
		err_no_plan = "kein Raster: Schreibe es in der HQminiMap-App (GridLab)",
		err_plan_invalid = "capture_plan.lua ist ungültig (nX/nY/Zentren)",
		err_mismatch = "die Zwischensequenz passt nicht zum Raster (%d Bilder statt %d): Starte den Scan erneut aus der App",
		err_not_started = "die Zwischensequenz ist nicht gestartet (Raster aus der HQminiMap-App geschrieben?)",
		err_timeout = "Zeitüberschreitung der Zwischensequenz, Bilder=%d",
		err_skipped = "übersprungenes Bild (Kachel %d)",
		err_window_closed = "Fenster geschlossen",
	},
	-- END generated de
	-- BEGIN generated it (tools/i18n/import.mts)
	it = {
		export_button = "Esporta mappa",
		help = "1. Esporta mappa  >  2. App HQminiMap: scegli una modalità, \"Scansiona la mappa nel gioco\"",
		status_ready = "Pronto",
		status_exporting = "Esportazione della mappa…",
		status_exported = "Mappa esportata: nell'app HQminiMap scegli una modalità, poi \"Scansiona la mappa nel gioco\"",
		status_export_error = "Errore durante l'esportazione: %s",
		status_busy_export = "Scansione in corso: impossibile esportare",
		status_module_missing = "Errore: il modulo %s non è stato trovato (ricarica la mod)",
		status_new_plan = "Nuova scansione ricevuta: %dx%d (%d immagini)",
		status_capture_prep = "Scansione %dx%d: preparazione dell'illuminazione…",
		status_capture_progress = "Scansione %d/%d",
		status_capture_done = "Scansione completata: %d/%d immagini",
		status_error = "Errore: %s",
		err_busy = "una scansione è già in corso",
		err_no_plan = "nessuna griglia: puoi crearla dall'app HQminiMap (GridLab)",
		err_plan_invalid = "capture_plan.lua non valido (nX/nY/centri)",
		err_mismatch = "il filmato non corrisponde alla griglia (%d immagini invece di %d): riavvia la scansione dall'applicazione",
		err_not_started = "il filmato non è partito (griglia scritta dall'app HQminiMap?)",
		err_timeout = "timeout del filmato, immagini=%d",
		err_skipped = "immagine saltata (tassello %d)",
		err_window_closed = "finestra chiusa",
	},
	-- END generated it
	-- BEGIN generated es (tools/i18n/import.mts)
	es = {
		export_button = "Exportar mapa",
		help = "1. Exportar mapa  >  2. Aplicación HQminiMap: elige un modo, \"Escanear el mapa en el juego\"",
		status_ready = "Listo",
		status_exporting = "Exportando el mapa…",
		status_exported = "Mapa exportado: en la aplicación HQminiMap, elige un modo y luego \"Escanear el mapa en el juego\"",
		status_export_error = "Error al exportar: %s",
		status_busy_export = "Escaneo en curso: la exportación no es posible",
		status_module_missing = "Error: el módulo %s no se encuentra (recarga el mod)",
		status_new_plan = "Nuevo escaneo recibido: %dx%d (%d imágenes)",
		status_capture_prep = "Escaneo %dx%d: preparando la iluminación...",
		status_capture_progress = "Escaneo %d/%d",
		status_capture_done = "Escaneo finalizado: %d/%d imágenes",
		status_error = "Error: %s",
		err_busy = "ya hay un escaneo en curso",
		err_no_plan = "no hay cuadrícula: escríbela desde la aplicación HQminiMap (GridLab)",
		err_plan_invalid = "capture_plan.lua no válido (nX/nY/centros)",
		err_mismatch = "la cinemática no coincide con la cuadrícula (%d imágenes en lugar de %d): vuelve a iniciar el escaneo desde la aplicación",
		err_not_started = "la cinemática no ha comenzado (¿cuadrícula escrita desde la aplicación HQminiMap?)",
		err_timeout = "tiempo de espera de la cinemática agotado, imágenes=%d",
		err_skipped = "imagen omitida (tesela %d)",
		err_window_closed = "ventana cerrada",
	},
	-- END generated es
	-- BEGIN generated zh (tools/i18n/import.mts)
	zh = {
		export_button = "导出地图",
		help = "1. 导出地图 > 2. HQminiMap 应用：选择模式，\"在游戏中扫描地图\"",
		status_ready = "已就绪",
		status_exporting = "正在导出地图…",
		status_exported = "地图已导出：在 HQminiMap 应用中，选择一个模式，然后点击“在游戏中扫描地图”",
		status_export_error = "导出错误：%s",
		status_busy_export = "扫描中：无法导出",
		status_module_missing = "错误：找不到模组 %s (请重新加载模组)",
		status_new_plan = "收到新的扫描：%dx%d (%d 张图片)",
		status_capture_prep = "扫描 %dx%d：正在准备光照…",
		status_capture_progress = "扫描 %d/%d",
		status_capture_done = "扫描完成：已处理 %d/%d 张图片",
		status_error = "错误：%s",
		err_busy = "已有扫描正在进行",
		err_no_plan = "没有网格：请在 HQminiMap 应用（GridLab）中写入",
		err_plan_invalid = "capture_plan.lua 文件无效 (nX/nY/中心点)",
		err_mismatch = "过场动画与网格不匹配（%d张图片，而不是%d张）：请从应用程序重新开始扫描",
		err_not_started = "过场动画未开始（网格数据是否由 HQminiMap 应用生成？）",
		err_timeout = "过场动画超时，图像数量：%d",
		err_skipped = "跳过图像 (图块 %d)",
		err_window_closed = "窗口已关闭",
	},
	-- END generated zh
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
