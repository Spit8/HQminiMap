# HQminiMap

**Carte haute qualité et données en direct pour Transport Fever 3.**

HQminiMap se compose de deux parties qui travaillent ensemble :

- **un mod léger** pour le jeu. Il exporte la carte (limites, relief), prend une mosaïque de captures vues du dessus et publie en continu les données de ta partie : villes, industries, entrepôts, gares, lignes, véhicules, trafic et stocks ;
- **une application de bureau** pour Windows, Linux et macOS. Elle calcule la grille de capture, assemble une **orthomosaïque** haute résolution et l'affiche dans un **visualiseur** interactif, avec toutes les données du jeu par-dessus.

```
 Transport Fever 3                         Application HQminiMap
┌───────────────────────┐   fichiers      ┌──────────────────────────────────────┐
│ mod HQminiMap          │  userdata TF3   │ GridLab   grille de capture          │
│  • export de la carte  │ ──────────────► │ TileLab   captures → orthomosaïque   │
│  • captures (cutscene) │                 │ Visualiseur  ortho + données en      │
│  • données en direct   │ ◄────────────── │             direct, filtres, export  │
└───────────────────────┘ grille, cadences,└──────────────────────────────────────┘
                           téléportation
```

L'app et le mod communiquent uniquement par fichiers, dans le dossier de données du jeu. Aucun serveur ni compte n'est nécessaire.

> **English summary** — HQminiMap is a Transport Fever 3 companion: a lightweight mod that exports
> the map, captures a top-down screenshot mosaic and streams live game data, plus a desktop app
> (Windows / Linux / macOS) that plans the capture grid, builds a high-resolution orthomosaic and
> shows it in an interactive viewer with towns, industries, stations, line tracks and moving
> vehicles. Download the installer and the mod zip from the
> [Releases](https://github.com/Spit8/HQminiMap/releases) page. The UI is available in French and
> English.

## Installation

### Application
Télécharge l'installeur de ton système depuis la page [Releases](https://github.com/Spit8/HQminiMap/releases) :

| Système | Fichier |
|---|---|
| Windows | `HQminiMap_<version>_x64-setup.exe` (ou le `.msi`) |
| Windows, portable | `HQminiMap_<version>_x64-portable.zip` : à décompresser n'importe où, puis lancer `HQminiMap.exe`, sans installation |
| Linux | `.AppImage` (portable) ou `.deb` |
| macOS | `.dmg` (Apple Silicon et Intel) |

L'app s'appuie sur **Microsoft WebView2**, déjà présent sur Windows 11 et la plupart des Windows 10 :
- les installeurs Windows l'installent automatiquement s'il manque (connexion internet nécessaire) ;
- la version portable fournit `MicrosoftEdgeWebview2Setup.exe`, à lancer seulement si l'app ne démarre pas.

Les installeurs ne sont **pas encore signés**. La première fois :
- **Windows** : SmartScreen demande une confirmation (« Informations complémentaires » → « Exécuter quand même ») ;
- **macOS** : Gatekeeper aussi (clic droit sur l'app → « Ouvrir »).

**Mises à jour** : l'app vérifie les releases au démarrage (Options → Mises à jour). Installée par un
installeur (ou en AppImage), elle se met à jour elle-même : « Installer et redémarrer ». La version
portable et le `.deb` affichent seulement la nouvelle version, avec un lien vers sa page. Le mod se
met à jour à part (voir ci-dessous).

### Mod
Le mod n'est pas (encore) publié sur mod.io : il est fourni dans chaque release.
1. Télécharge `hqminimap-mod-<version>.zip` et décompresse-le.
2. Copie le dossier `hqminimap` dans le dossier des mods locaux du jeu :
   `<données TF3>/staging_area/`. Sous Windows, c'est par défaut `C:\Users\Public\Documents\Steam\RUNE\3493540\local\staging_area\`.
3. Dans le jeu, active **HQminiMap** dans la liste des mods de la partie.

Au premier lancement, l'app détecte le dossier de données du jeu. Si elle ne le trouve pas, choisis-le dans **Options** (le dossier `…/Steam/RUNE/3493540/local`).

**Après une mise à jour du mod, recharge ta sauvegarde** : le jeu garde l'ancien code du mod jusque-là. L'app affiche un bandeau tant que le jeu exécute une version plus ancienne qu'elle.

## Utilisation

### Orthomosaïque de la carte
1. **Dans le jeu** : fenêtre HQminiMap (bouton de la barre des mods) → **Exporter la carte**.
2. **GridLab** :
   - vérifie la **résolution du jeu** : elle est détectée sur ta dernière capture d'écran du jeu, ou se choisit dans la liste (toutes les résolutions et tous les formats : 16:9, 16:10, 21:9, 32:9…) ;
   - règle l'altitude de la caméra, le champ de vision (10 à 66°) et la grille ;
   - le bouton **Min** propose la plus petite grille qui couvre la carte, et la taille finale de l'image est estimée avant la capture ;
   - termine par **Écrire dans le mod**.
3. **Dans le jeu** : **Capturer** (inutile de recharger la partie). L'app récupère les captures toute seule.
4. **TileLab** : choisis l'interpolation, puis **Calculer l'ortho**. La durée et la taille sont estimées à l'avance ; le calcul continue même si tu changes d'onglet.
5. **Visualiseur** : zoom jusqu'au pixel, rotation, plein écran (touche **F**), **Ajuster** pour voir toute la carte (touche **0**).
   Le menu **Image** règle la luminosité, le contraste, la saturation et le gamma de toute la carte : en automatique (calculé sur la carte entière) ou à la main.

### Données en direct
Le mod publie les données de la partie aux cadences réglées dans **Options → Données en direct**. La colonne « Coût » donne le temps de calcul par mise à jour, la colonne « Charge » la part du temps du jeu utilisée. Le minimum est de 1 s pour les véhicules.

Dans le **Visualiseur**, le panneau **Calques et filtres** (touche **L**) propose :
- des calques **villes** (contours), **lignes** (tracés réels, couleur du jeu), **gares et arrêts** (aux couleurs des lignes qui les desservent), **véhicules** (animés, avec leur chargement), **industries** et **entrepôts** (stocks) ;
- des **filtres** : recherche par nom, mode de transport, trafic minimal, stock minimal, sélection de lignes, lignes inactives ;
- des **étiquettes** par calque (🏷) et la visibilité (👁) ;
- des **configurations** de filtres nommées : enregistrer, charger au démarrage, importer ou exporter en JSON.

Sur la carte et dans les fiches :
- **clic** sur un objet : sa fiche (chiffres, stocks, historique en mini-courbes), avec **Cadrer**, **Masquer** et **Téléporter ici** ;
- **double-clic** sur la carte : la caméra du jeu s'y déplace ;
- **Exporter la vue** : PNG ×1, ×2 ou ×4 de la vue actuelle, filtres et réglages d'image appliqués, avec une légende en option.

Dans **Options → Carte** : la taille des icônes et des textes de la carte, et l'opacité des lignes.

### Limites connues
- Les **tracés des lignes** viennent des trajets des véhicules. Ils se complètent au fil des passages : une ligne récente peut avoir des portions provisoires, en trait fin ou en tirets.
- Les **contours de villes** sont recalculés toutes les 2 minutes environ à partir des bâtiments.
- Les installeurs ne sont pas signés (voir plus haut).

## Contribuer
Les instructions de compilation, les outils et la structure du code sont dans
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Traduire
Le français et l'anglais sont fournis. Pour ajouter une langue, voir [docs/TRANSLATING.md](docs/TRANSLATING.md).

## Licence
[GPL-3.0](LICENSE) © 2026 Wilfried Lambert.

Transport Fever est une marque d'Urban Games. HQminiMap est un projet de fan indépendant, ni affilié ni approuvé par Urban Games.
