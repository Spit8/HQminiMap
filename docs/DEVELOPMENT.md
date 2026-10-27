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
| `docs/` | traduction, notes de version |

## Publier une version
1. `node tools/bump-version.mjs 0.2.0`, puis commit.
2. `git tag v0.2.0 && git push origin main v0.2.0`.
3. La CI (`.github/workflows/release.yml`) construit les installeurs Windows, Linux et macOS et le zip du mod, dans une **release brouillon**.
4. Relis la release sur GitHub, puis publie-la. Tant qu'elle reste en brouillon (ou en pré-release), les apps installées ne la voient pas.

### Publier le mod sur le Mod Hub (mod.io)
1. Augmente `revision` dans `mod/mod.json`, puis `node tools/deploy-dev.mjs` : le mod part dans `staging_area`.
2. Dans le jeu : **Mod Hub** → **My Mods** → HQminiMap. Vérifie que le message en bas à gauche dit « The existing mod on mod.io will be updated », écris le message de version, puis **Update** (**Upload** la première fois).
3. Au premier envoi, le jeu écrit `_metadata/mod.io_fileid.txt` dans `staging_area` : il relie le mod à sa page mod.io. `deploy-dev.mjs` ne l'efface pas ; s'il est perdu, recrée-le avec l'identifiant affiché sur la page mod.io du mod.

### Clé de mise à jour (une fois)
Les mises à jour automatiques (`tauri-plugin-updater`) exigent des paquets signés. La clé publique est
dans `app/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`), la clé privée dans les secrets du dépôt.

```powershell
# PowerShell : ~ n'est pas développé pour un programme externe, d'où $env:USERPROFILE
npx tauri signer generate -w "$env:USERPROFILE\.tauri\hqminimap.key"   # choisir un mot de passe
Get-Content "$env:USERPROFILE\.tauri\hqminimap.key" -Raw | gh secret set TAURI_SIGNING_PRIVATE_KEY
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD                        # colle le mot de passe
```

Copie le contenu de `~/.tauri/hqminimap.key.pub` dans `pubkey`. **Garde la clé privée** (sauvegarde) :
si elle est perdue, les apps déjà installées ne pourront plus se mettre à jour toutes seules.
`npm run tauri build` en local demande aussi ces deux variables (`TAURI_SIGNING_PRIVATE_KEY`, `…_PASSWORD`).
