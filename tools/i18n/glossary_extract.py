#!/usr/bin/env python3
"""Draft tools/i18n/glossary.json from Transport Fever 3's own translations (read-only).

The game ships gettext catalogs (msgid = English) in <game>/base/strings/<lang>/LC_MESSAGES/base.mo.
Game terms are taken from there (so the app speaks like the game); terms the game does not have
(orthophoto, tile, grid…) are proposals marked "to review". The draft is then reviewed by hand:
this script does not overwrite glossary.json unless --force.

  python tools/i18n/glossary_extract.py [--game "<Steam>/steamapps/common/Transport Fever 3"] [--force]
"""
from __future__ import annotations

import argparse
import gettext
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
LANGS = {"fr": "fr", "de": "de", "it": "it", "es": "es", "zh": "zh_CN"}  # zh: Simplified only

# (English term in the app's text, other English forms, game msgids [singular, plural]).
GAME_TERMS: list[tuple[str, list[str], list[str]]] = [
    ("line", ["lines"], ["Line", "Lines"]),
    ("station", ["stations"], ["Station", "Stations"]),
    ("warehouse", ["warehouses"], ["Warehouse", "Warehouses"]),
    ("industry", ["industries"], ["Industry", "Industries"]),
    ("town", ["towns"], ["Town", "Towns"]),
    ("vehicle", ["vehicles"], ["Vehicle", "Vehicles"]),
    ("passengers", ["passenger"], ["Passengers"]),
    ("mod", ["mods"], ["Mods"]),
    ("screenshot", ["screenshots", "screenshot(s)"], ["Screenshot", "Screenshots"]),
    ("traffic", [], ["Traffic"]),
    ("stocks", ["stock"], ["Stocks"]),
    ("population", [], ["Population"]),
    ("port", [], ["Port"]),
    ("airport", [], ["Airport"]),
    ("terrain", [], ["Terrain"]),
    ("resolution", [], ["Resolution"]),
    ("fullscreen", [], ["Fullscreen"]),
    ("train", ["trains"], ["Trains"]),
    ("tram", ["trams"], ["Trams"]),
    ("ship", ["ships"], ["Ships"]),
    ("truck", ["trucks"], ["Trucks"]),
]

# Game values that do not fit the app's sense: replaced, with the reason.
GAME_FIXES: dict[tuple[str, str], tuple[list[str], str]] = {
    ("airport", "zh"): (["机场"], "game: 双跑道机场 = a two-runway airport (one building type)"),
    ("mod", "de"): (["Mod", "Mods"], "game gives the plural only"),
    ("mod", "it"): (["mod"], ""),
    ("mod", "es"): (["mod", "mods"], "game gives the plural only"),
    ("mod", "fr"): (["mod", "mods"], ""),
    ("tram", "es"): (["tranvía", "tranvías"], "game gives the plural only"),
    ("station", "zh"): (["车站", "站点"], "game: 站点 (singular) / 车站 (plural); both accepted"),
    ("passengers", "zh"): (["乘客"], ""),
    ("train", "it"): (["treno", "treni"], "game gives the plural only"),
    ("ship", "it"): (["nave", "navi"], "game gives the plural only"),
    ("truck", "it"): (["camion"], ""),
    ("train", "es"): (["tren", "trenes"], "game gives the plural only"),
    ("ship", "es"): (["barco", "barcos"], "game gives the plural only"),
    ("truck", "es"): (["camión", "camiones"], "game gives the plural only"),
    ("train", "de"): (["Zug", "Züge"], "game gives the plural only"),
    ("ship", "de"): (["Schiff", "Schiffe"], "game gives the plural only"),
    ("truck", "de"): (["Lkw", "Lkws"], "game gives the plural only"),
    ("tram", "de"): (["Tram", "Trams"], "game gives the plural only"),
}

# Cargo: the game's it value ("Tipologia") is out of context; Goods is the game's word there.
EXTRA_GAME: list[dict] = [
    {"en": "cargo", "forms": [], "fr": "fret", "de": "Güter", "it": "merci", "es": "carga", "zh": "货物",
     "note": "game msgid 'Cargo' gives it 'Tipologia' (out of context) and es 'Cargamento'; it 'merci' = game 'Goods'. To review."},
]

# Terms of the app the game does not have: proposals.
APP_TERMS: list[dict] = [
    {"en": "ortho", "forms": ["orthophoto", "orthomosaic"], "fr": "ortho", "de": "Orthofoto", "it": "ortofoto", "es": "ortofoto", "zh": "正射影像"},
    {"en": "tile", "forms": ["tiles"], "fr": "tuile", "de": ["Kachel", "Kacheln"], "it": ["tassello", "tasselli"], "es": ["tesela", "teselas"], "zh": "图块",
     "note": "one screenshot of the scan grid"},
    {"en": "scan", "forms": ["scans"], "fr": "scan", "de": "Scan", "it": "scansione", "es": "escaneo", "zh": "扫描"},
    {"en": "capture", "forms": ["captures", "capture(s)"], "fr": "capture", "de": ["Aufnahme", "Aufnahmen"], "it": ["acquisizione", "acquisizioni"],
     "es": ["captura", "capturas"], "zh": "采集", "note": "the images collected by one scan (not a single screenshot)"},
    {"en": "this run", "forms": ["the run", "collected runs", "run's"], "fr": "run", "de": ["Durchlauf", "Durchläufe"], "it": ["sessione", "sessioni"], "es": ["sesión", "sesiones"], "zh": "批次",
     "note": "one scan session and its folder (noun only: 'run' is also a verb in the texts)"},
    {"en": "grid", "forms": [], "fr": "grille", "de": "Raster", "it": "griglia", "es": "cuadrícula", "zh": "网格"},
    {"en": "cutscene", "forms": [], "fr": "cutscene", "de": "Zwischensequenz", "it": "filmato", "es": "cinemática", "zh": "过场动画"},
    {"en": "contour line", "forms": ["contour lines", "contours", "contour"], "fr": "courbe de niveau", "de": ["Höhenlinie", "Höhenlinien"],
     "it": ["curva di livello", "curve di livello"], "es": ["curva de nivel", "curvas de nivel"], "zh": "等高线"},
    {"en": "index contour", "forms": [], "fr": "courbe maîtresse", "de": "Zähllinie", "it": "curva direttrice", "es": "curva maestra", "zh": "计曲线"},
    {"en": "basemap", "forms": [], "fr": "fond de carte", "de": "Grundkarte", "it": "mappa di base", "es": "mapa base", "zh": "底图"},
    {"en": "legend", "forms": [], "fr": "légende", "de": "Legende", "it": "legenda", "es": "leyenda", "zh": "图例"},
    {"en": "labels", "forms": ["label"], "fr": "étiquettes", "de": ["Beschriftungen", "Beschriftung"], "it": ["etichette", "etichetta"],
     "es": ["etiquetas", "etiqueta"], "zh": "标签"},
    {"en": "layer", "forms": ["layers"], "fr": "calque", "de": ["Ebene", "Ebenen"], "it": ["livello", "livelli"], "es": ["capa", "capas"], "zh": "图层",
     "note": "map layer (GIS sense); game it 'Strati' is for its own views"},
    {"en": "configuration", "forms": ["configurations", "configuration(s)"], "fr": "configuration", "de": ["Konfiguration", "Konfigurationen"],
     "it": ["configurazione", "configurazioni"], "es": ["configuración", "configuraciones"], "zh": "配置", "note": "a saved set of filters"},
    {"en": "viewer", "forms": ["visualiser"], "fr": "visualiseur", "de": "Kartenansicht", "it": "visualizzatore", "es": "visor", "zh": "地图查看器",
     "note": "name of the map tab"},
    {"en": "trail", "forms": ["trails"], "fr": "trace", "de": ["Spur", "Spuren"], "it": ["scia", "scie"], "es": ["estela", "estelas"], "zh": "航迹",
     "note": "positions left behind by a ship or aircraft"},
    {"en": "track", "forms": ["tracks"], "fr": "tracé", "de": ["Streckenverlauf", "Strecke"], "it": ["tracciato", "tracciati"], "es": ["trazado", "trazados"],
     "zh": "路径", "note": "drawn path of a line on the map (not rails: game 'Tracks' = Gleise / binari)"},
    {"en": "lane", "forms": ["lanes"], "fr": "voie", "de": ["Fahrspur", "Fahrspuren"], "it": ["corsia", "corsie"], "es": ["carril", "carriles"], "zh": "车道"},
    {"en": "relief", "forms": [], "fr": "relief", "de": "Relief", "it": "rilievo", "es": "relieve", "zh": "地形"},
    {"en": "pyramid", "forms": [], "fr": "pyramide", "de": "Pyramide", "it": "piramide", "es": "pirámide", "zh": "金字塔", "note": "tile pyramid of the orthophoto"},
    {"en": "/yr", "forms": [], "fr": "/an", "de": "/Jahr", "it": "/anno", "es": "/año", "zh": "/年"},
    {"en": "teleport", "forms": ["teleporting"], "fr": "téléporter", "de": "teleport", "it": "teletraspor", "es": "teletransport", "zh": "传送",
     "note": "stem check: any inflection accepted"},
]

KEEP = ["HQminiMap", "GridLab", "Transport Fever 3", "TF3", "FOV", "Lanczos", "PNG", "GitHub", "MB", "GB", "px", "m/px",
        "map.lua", "heightmap.lua", "mosaic_plan.lua", "capture_plan.lua", "pyramid.json", "Steam", "Esc", "Alt", "Shift"]

STYLE = {
    "de": {"register": "Address the user informally with 'du' (as the game does). Swiss orthography as in the game: write 'ss', never 'ß'.",
           "button": "Commands (buttons, menu items, and labels or tooltips naming an action): infinitive form, as the game does ('Speichern', 'Diese Konfiguration löschen'). A status that something is in progress: 'Wird …'."},
    "it": {"register": "Address the user informally with 'tu' (as the game does). 'mod' is feminine: 'la mod'.",
           "button": "Commands (buttons, menu items, and labels or tooltips naming an action): imperative 2nd person singular, as the game does ('Salva', 'Elimina questa configurazione')."},
    "es": {"register": "Address the user informally with 'tú' (as the game does). 'mod' is masculine: 'el mod'.",
           "button": "Commands (buttons, menu items, and labels or tooltips naming an action): infinitive form, as the game does ('Guardar', 'Eliminar esta configuración')."},
    "zh": {"register": "Simplified Chinese only (zh-Hans). Address the user with '你' (as the game does).",
           "button": "Commands (buttons, menu items, and labels or tooltips naming an action): short verb phrase, as the game does ('保存', '删除此配置')."},
}


EVIDENCE_SENTENCES = [
    "The line manager lets you manage all the lines.",
    "If you already feel confident, you can end the tutorial at any time.",
    "Use the cargo filter in the vehicle store to filter by the cargo type you're interested in.",
]
EVIDENCE_BUTTONS = ["Save", "Delete", "Rename"]


def catalogs(game: Path) -> dict[str, dict]:
    out = {}
    for code, folder in LANGS.items():
        with (game / "base" / "strings" / folder / "LC_MESSAGES" / "base.mo").open("rb") as f:
            out[code] = gettext.GNUTranslations(f)._catalog
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--game", type=Path, default=Path("C:/Program Files (x86)/Steam/steamapps/common/Transport Fever 3"))
    p.add_argument("--force", action="store_true")
    a = p.parse_args()
    target = HERE / "glossary.json"
    if target.exists() and not a.force:
        raise SystemExit(f"{target} exists (reviewed by hand): --force to draft it again")
    cats = catalogs(a.game)
    terms = []
    for en, forms, msgids in GAME_TERMS:
        t: dict = {"en": en, "forms": forms, "source": "game: " + " / ".join(msgids)}
        for code in LANGS:
            vals = []
            for m in msgids:
                v = cats[code].get(m)
                if isinstance(v, str) and v not in vals:
                    vals.append(v)
            fix = GAME_FIXES.get((en, code))
            if fix:
                vals = fix[0]
                if fix[1]:
                    t.setdefault("note", "")
                    t["note"] = (t["note"] + "; " if t["note"] else "") + f"{code}: {fix[1]}"
            if code in ("fr", "it", "es"):
                # Game titles are capitalised; in the app's sentences these words are common nouns.
                vals = [v[:1].lower() + v[1:] for v in vals]
            t[code] = vals[0] if len(vals) == 1 else vals
        terms.append(t)
    terms += EXTRA_GAME
    terms += [{**t, "note": (t.get("note", "") + ("; " if t.get("note") else "") + "app term: to review")} for t in APP_TERMS]
    # The game's own sentences and buttons behind each style rule (for the review; not sent to the model).
    style = {code: {**rules, "evidence": {
        "register": [cats[code].get(m) for m in EVIDENCE_SENTENCES],
        "button": [cats[code].get(m) for m in EVIDENCE_BUTTONS],
    }} for code, rules in STYLE.items()}
    ctx = json.loads((HERE / "context.json").read_text(encoding="utf-8"))
    out = {"app": ctx["app"], "keep": KEEP, "style": style, "terms": terms}
    target.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{target}: {len(terms)} terms ({len(GAME_TERMS) + len(EXTRA_GAME)} from the game, {len(APP_TERMS)} app proposals)")


if __name__ == "__main__":
    main()
