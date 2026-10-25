# HQminiMap

Carte haute qualité pour Transport Fever 3 : un mod léger (export de la carte + capture d'une
mosaïque top-down) et une application de bureau (Windows / Linux / Mac) qui calcule la grille,
range les captures, produit l'orthomosaïque et l'affiche.

## Utilisation
1. Dans le jeu, fenêtre **HQminiMap** → **Exporter la carte**.
2. Dans l'app, **GridLab** : régler l'altitude, le FOV (10…66°) et la grille → **Écrire dans le mod**.
3. Dans le jeu → **Capturer** (sans recharger la partie : le mod relit la grille à chaque capture).
   L'app récupère les captures toute seule.
4. **TileLab** → **Calculer l'ortho**, puis **Visualiseur**.

## Développement
```
cd app && npm install
npm run tauri dev        # app en mode dev
npm test                 # tests (concordance avec le gen miniMapper, ortho, pyramide)
npm run check            # svelte-check / TypeScript
npm run tauri build      # installeurs
node tools/deploy-dev.mjs   # copie mod/ dans <userdata>/staging_area/hqminimap
python tools/sim_mod.py <mosaic_plan.lua>   # simulation hors-jeu du mod (pip install lupa)
```
UI du mod : `hqminimap.tfui.json` (s'ouvre dans TFUI), régénérée avec le générateur de TFUI (voir
`docs/agent-memory/DECISIONS.md`, HQ-004). Mémoire projet : `docs/agent-memory/`.
