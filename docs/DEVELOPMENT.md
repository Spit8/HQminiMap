# Développement de HQminiMap

**Prérequis** :
- [Node.js](https://nodejs.org) 22 ;
- [Rust](https://rustup.rs) stable ;
- les [dépendances Tauri](https://tauri.app/start/prerequisites/) de ton système (WebView2 sous Windows ; `libwebkit2gtk-4.1-dev` et compagnie sous Linux) ;
- pour les simulations du mod, Python 3 avec `pip install lupa`.

```bash
cd app && npm install
npm run tauri dev          # l'app en mode développement
npm test                   # tests (vitest)
npm run check              # svelte-check / TypeScript
npm run tauri build        # installeurs locaux
```

Outils (depuis la racine du dépôt) :

```bash
node tools/deploy-dev.mjs                 # copie mod/ dans <userdata>/staging_area/hqminimap
python tools/sim_live.py                  # simulation hors jeu des données en direct
python tools/sim_mod.py <capture_plan>    # simulation hors jeu de la capture
node tools/pack-mod.mjs                   # dist/hqminimap-mod-<version>.zip
node tools/bump-version.mjs <x.y.z>       # même version partout (app, Tauri, Cargo)
```

**Structure du dépôt** :

| Chemin | Contenu |
|---|---|
| `mod/` | le mod Transport Fever 3 (Lua) : export, capture, données en direct |
| `hqminimap.tfui.json` | l'interface du mod, éditable avec TFUI |
| `app/` | l'application Tauri 2 + SvelteKit (Svelte 5, TypeScript, OpenLayers) |
| `app/src/lib/core/` | logique pure et testée : grille, ortho, données en direct, filtres, tracés, contours |
| `tools/` | déploiement, simulations, packaging, version |
| `docs/` | traduction, notes de conception (`docs/agent-memory/`) |

## Publier une version
1. `node tools/bump-version.mjs 0.2.0`, puis commit.
2. `git tag v0.2.0 && git push origin main v0.2.0`.
3. La CI (`.github/workflows/release.yml`) construit les installeurs Windows, Linux et macOS et le zip du mod, dans une **release brouillon**.
4. Relis la release sur GitHub, puis publie-la.
