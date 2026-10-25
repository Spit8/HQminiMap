# Architecture

## Flux joueur (aucune étape manuelle hors jeu)
1. **Jeu, fenêtre HQminiMap → « Exporter la carte »** : `export_map.lua` écrit `<UD>/hqminimap/heightmap.lua` (512², repli 256) puis `map.lua` (bounds, méta, grille 128²). `<UD>` = `C:\Users\Public\Documents\Steam\RUNE\3493540\local` sous Windows.
2. **App, GridLab** : relit les deux fichiers tout seul (sondage de `map.lua` toutes les 1,5 s) et calcule la grille cover. Sur « Écrire dans le mod », il écrit `cutscenes/mosaic_run_p01.lua` dans le mod installé (défaut `<UD>/staging_area/hqminimap`) **et** le plan `<UD>/hqminimap/capture_plan.lua` (format userdata, `M.planStamp`).
3. Pas de rechargement de la partie : le jeu relit la cutscene à chaque `playCutscene`, et le mod relit le plan avec `app.loadUserdata` à chaque capture (HQ-008).
4. **Jeu → « Capturer »** : `capture.lua` joue la cutscene, 1 capture par tuile, et met à jour `<UD>/hqminimap/capture_index.lua`.
5. **App, collecteur (toujours actif)** : copie les captures de `<UD>/screenshots` vers `<UD>/hqminimap/runs/<startedAt>/tile_p01_SSS.png`, avec une copie du plan et de la heightmap du run.
6. **TileLab → « Calculer l'ortho »** (worker) : `pyramid/<z>/<x>_<y>.png` + `pyramid.json` + `ortho.png` (aperçu ≤ 6144 px).
7. **Visualiseur** : OpenLayers sur la pyramide (projection locale en mètres).

## Dépôt
- `mod/` — mod TF3 `hqminimap` (préfixe de ressources `hqminimap::/` = `mod/content/`).
  - `content/gui/` : UI TFUI générée par `tools/tfui/generate.mts` (avec le catalogue TFUI) depuis `hqminimap.tfui.json` (racine du dépôt), avec le générateur du dépôt `../TFUI`. Les handlers (`hqminimap_gui.handlers.lua`) sont écrits à la main.
  - `content/hqminimap/` : `io_util`, `collect_terrain`, `export_map`, `capture`, `settings`.
- `app/` — Tauri 2 + SvelteKit (SPA, adapter-static) + Svelte 5 + TS.
  - `src/lib/core/` : TS pur et testé — `geometry` (sténopé v3, raccords, couverture), `plan` (écrit le plan et les cutscenes), `pyfmt` (formatage de nombres à la Python), `lua` (lecteurs), `tiles` (nommage des tuiles), `ortho`, `pyramid`, `modwriter`.
  - `src/lib/platform/` : `fsx` (plugin fs) et `paths` (chemins du jeu ; la commande Rust `detect_paths` cherche `<UD>`, y compris dans le préfixe Proton sous Linux).
  - `src/lib/state/` : `app.svelte.ts` (réglages, carte, config), `runs.svelte.ts` (collecteur), `orthoExport.ts` (pilote le worker).
  - `src/lib/workers/ortho.worker.ts` : rendu, pyramide et PNG (fast-png ; les API Tauri ne sont pas disponibles dans un worker).
  - `src/lib/ui/` : `GridLab`, `TileLab`, `Viewer`, `Settings`.
  - `test/` : vitest (`npm test` via `npx vitest run`). `test/tools/make_golden.py` produit les références depuis le gen Python de miniMapper ; `bench-ortho.mts` est le banc pleine échelle.
- `tools/` : `deploy-dev.mjs` (copie du mod, garde le plan et les cutscenes écrits par l'app), `sim_mod.py` (simulation lupa de l'export et de la capture), `tfui/generate.mts`.
