#!/usr/bin/env python3
"""Golden outputs of the miniMapper reference generator (gen_mosaic_cutscene.py) for the TS port.

The TS core (src/lib/core) must reproduce, for the same terrain and config, the same lattice
(centres, seam heights, coverage) and the same mosaic_plan.lua / cutscene text (comment lines
aside). This script drives the reference generator's functions directly (no file writes into
any mod) and stores the results as JSON next to the fixtures.

Usage:
  python test/tools/make_golden.py --gen <miniMapper>/minimapper/scripts/gen_mosaic_cutscene.py
  python test/tools/make_golden.py --gen ... --real-dir <UD>/minimapper   # also the real map
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent / "fixtures"
PREFIX = "hqminimap::/hqminimap/cutscenes/mosaic_run_p"
PITCH = -14.1372

CASES = [
    {"name": "cover_12x5_fov15", "Z_EYE": 5000, "FOV_V_DEG": 15, "GRID_NX": 12, "GRID_NY": 5, "SEAM_MODE": "cover", "CAPTURE_TIME_SEC": 36000},
    {"name": "cover_8x4_fov22", "Z_EYE": 4000, "FOV_V_DEG": 22.8165, "GRID_NX": 8, "GRID_NY": 4, "SEAM_MODE": "cover", "CAPTURE_TIME_SEC": 25200},
    {"name": "cover_short_fov10", "Z_EYE": 3000, "FOV_V_DEG": 10, "GRID_NX": 3, "GRID_NY": 2, "SEAM_MODE": "cover", "CAPTURE_TIME_SEC": 28800},
    {"name": "per_seam_9x4", "Z_EYE": 4500, "FOV_V_DEG": 19, "GRID_NX": 9, "GRID_NY": 4, "SEAM_MODE": "per_seam", "CAPTURE_TIME_SEC": 28800},
    {"name": "constant_10x4", "Z_EYE": 4500, "FOV_V_DEG": 19, "GRID_NX": 10, "GRID_NY": 4, "SEAM_MODE": "constant", "CAPTURE_TIME_SEC": 28800},
]
BASE = {"FOV_SCALE": 1.0, "PIXEL_ASPECT": 1.0, "STEP_SCALE_X": 1.0, "STEP_SCALE_Y": 1.0,
        "COVER_MARGIN_M": 5.0, "CAPTURE_DAY_OF_YEAR": 171, "CAPTURE_LATITUDE": 0.0,
        "ALLOW_PARTIAL": True, "screenW": 2560.0, "screenH": 1080.0}


def write_synthetic(dirpath: Path) -> None:
    """Deterministic 64² heightmap (hills, a valley, a lake at waterLevel) + matching map.lua."""
    n, size = 64, 14336.0
    min_xy, cell = -size / 2, size / 64
    water = 2.0
    rows = []
    for j in range(n):
        vals = []
        for i in range(n):
            x, y = min_xy + (i + 0.5) * cell, min_xy + (j + 0.5) * cell
            h = (220 * math.exp(-((x - 3000) ** 2 + (y + 2500) ** 2) / 4.0e6)
                 + 480 * math.exp(-((x + 5200) ** 2 + (y - 4200) ** 2) / 2.5e6)
                 + 35 * math.sin(x / 1300.0) * math.cos(y / 1700.0) + 40 - 0.004 * abs(y))
            vals.append(round(max(h, water), 2))
        rows.append("\t\t\t{ " + ", ".join(f"{v:g}" for v in vals) + " },")
    hm = ("function data()\nreturn { \n"
          f"\t\tcellX = {cell:g},\n\t\tcellY = {cell:g},\n\t\theight = {size:g},\n"
          f"\t\tmaxZ = 500,\n\t\tminX = {min_xy:g},\n\t\tminY = {min_xy:g},\n\t\tminZ = 0,\n"
          f"\t\tn = {n},\n\t\trows = {{\n" + "\n".join(rows) + "\n\t\t},\n"
          f"\t\tversion = 1,\n\t\twaterLevel = {water:g},\n\t\twidth = {size:g},\n\t}}\nend\n")
    mp = ("function data()\nreturn { \n\t\tbounds = { \n"
          f"\t\t\theight = {size:g},\n\t\t\tmaxX = {-min_xy:g},\n\t\t\tmaxY = {-min_xy:g},\n"
          f"\t\t\tminX = {min_xy:g},\n\t\t\tminY = {min_xy:g},\n\t\t\twidth = {size:g},\n\t\t}},\n"
          f"\t\tterrain = {{ waterLevel = {water:g}, }},\n\t\tversion = 1,\n\t}}\nend\n")
    dirpath.mkdir(parents=True, exist_ok=True)
    (dirpath / "heightmap.lua").write_text(hm, encoding="utf-8", newline="\n")
    (dirpath / "map.lua").write_text(mp, encoding="utf-8", newline="\n")


def load_gen(path: Path):
    spec = importlib.util.spec_from_file_location("gen_ref", path)
    g = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(g)
    return g


def run_case(g, case: dict, terrain_dir: Path) -> dict:
    cfg = {**BASE, **{k: v for k, v in case.items() if k != "name"}}
    for k, v in cfg.items():
        if k in g.CONFIG_KEYS:
            setattr(g, k, v)
    g.SCREEN_W, g.SCREEN_H = cfg["screenW"], cfg["screenH"]
    g.FOV_KEY = -math.radians(g.FOV_V_DEG)
    g.CUTSCENE_PREFIX = PREFIX
    cells, bounds, src = g.load_terrain(terrain_dir / "map.lua", terrain_dir / "heightmap.lua")
    z_ref = statistics.median(cells.values())
    mo = g.compute_mosaic(g.current_config(), cells, bounds, z_ref, 1.0, 1.0)
    geo = mo["geo"]
    geo.update(fovScale=1.0, pixelAspect=1.0, fovScaleSource="constant", zRef=z_ref,
               zRefSource="map_median", seamMode=mo["seamMode"], terrainSource=src,
               overlapX=mo["overlapX"], overlapY=mo["overlapY"], sunZenith=mo["sunZenith"],
               maxView=mo["maxView"], seamZX=mo["seamZX"], seamZY=mo["seamZY"])
    nx, ny = g.GRID_NX, g.GRID_NY
    cx, cy = mo["cx"], mo["cy"]
    geo.update(stepX=(cx[0] - cx[-1]) / (nx - 1) if nx > 1 else geo["viewX"],
               stepY=(cy[0] - cy[-1]) / (ny - 1) if ny > 1 else geo["viewY"])
    centers = g.center_out_grid(cx, cy)
    return {
        "name": case["name"], "config": cfg, "zRef": z_ref, "terrainSource": src,
        "seamZX": mo["seamZX"], "seamZY": mo["seamZY"], "cx": cx, "cy": cy,
        "deficitX": mo["deficitX"], "deficitY": mo["deficitY"],
        "minGrid": list(mo["minGrid"]) if mo["minGrid"] else None,
        "plan": g.render_plan(nx, ny, [PITCH], cfg["screenW"], cfg["screenH"], geo,
                              mo["mapCx"], mo["mapCy"], centers),
        "cutscene": g.render_cutscene_one_pitch(centers, PITCH, 1, nx, ny, geo),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--gen", type=Path, required=True)
    ap.add_argument("--real-dir", type=Path, default=None,
                    help="folder with a real map.lua + heightmap.lua (golden_real.json, not committed)")
    args = ap.parse_args()
    g = load_gen(args.gen)
    synth = FIXTURES / "synthetic"
    write_synthetic(synth)
    out = [run_case(g, c, synth) for c in CASES]
    (FIXTURES / "golden_synthetic.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"OK {len(out)} synthetic cases -> {FIXTURES / 'golden_synthetic.json'}")
    if args.real_dir is not None:
        real = FIXTURES / "real"
        real.mkdir(parents=True, exist_ok=True)
        for name in ("map.lua", "heightmap.lua"):
            (real / name).write_bytes((args.real_dir / name).read_bytes())
        out = [run_case(g, c, real) for c in CASES[:3]]
        (FIXTURES / "golden_real.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
        print(f"OK {len(out)} real cases -> {FIXTURES / 'golden_real.json'}")


if __name__ == "__main__":
    main()
