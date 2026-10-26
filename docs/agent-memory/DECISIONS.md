# Décisions

### HQ-001 — Repartir à nu : mod mince et app externe
- **Date :** 2026-10-25 · **Statut :** accepted
- **Décision :** le mod ne fait qu'exporter (relief, limites) et capturer. Tout le reste (grille, ortho, visualisation) est fait dans une app desktop Tauri 2 multiplateforme (Windows, Linux, Mac), sans étape manuelle hors du jeu sauf recharger la partie après l'écriture de la grille. miniMapper reste intact comme référence.
- **Pourquoi :** le jeu ne permet pas d'écrire des fichiers bruts ni de construire des cutscenes à l'exécution. L'affichage en jeu demanderait une reprojection impossible à faire dans le mod.

### HQ-002 — Svelte 5 + TS + Vite (SvelteKit SPA), cartographie OpenLayers
- **Date :** 2026-10-25 · **Statut :** accepted
- **Pourquoi :** l'app devra plus tard afficher beaucoup de contenu vivant (véhicules, stocks, passagers). Svelte gère l'état réactif de l'UI ; le rendu lourd va dans OpenLayers ou un canvas, indépendamment du framework.
- Le calcul vit dans `src/lib/core`, en TS pur testé par vitest. Il n'y a ni sidecar ni serveur en v1.

### HQ-003 — Périmètre v1 : x1, cover, FOV 10…66°
- **Date :** 2026-10-25 · **Statut :** accepted
- Une seule cutscene (pitch −14,1372), raccords cover (marge 5 m), `FOV_V_DEG_MIN = 10`. La borne de 2,5° de miniMapper (D-031) n'est pas reprise.
- `geometry.ts` garde les modes `per_seam` et `constant` uniquement pour les tests de concordance ; l'UI ne propose que cover.

### HQ-004 — Interface du mod en TFUI (générateur du dépôt TFUI)
- **Date :** 2026-10-25 · **Statut :** accepted
- `hqminimap.tfui.json` (racine du dépôt, `modRoot: "mod"`, `catalogHash` du catalogue TFUI) est la source ; il s'ouvre dans l'éditeur TFUI. Régénération en ligne de commande : depuis `../TFUI`, `npx tsx ../HQminiMap/tools/tfui/generate.mts ../HQminiMap/hqminimap.tfui.json` ; validation du schéma : `tools/tfui/check.mts`.
- **Le catalogue TFUI est obligatoire pour générer** : sans lui, le générateur écrit les emplacements à enfant unique sous forme de liste (`content = { … }`), et le jeu plante au chargement (« Could not assign value to userdata 'content' », vu en jeu le 2026-10-25). `generate.mts` charge donc `loadMergedCatalogFromDisk()`. Avec le catalogue, la sortie est identique au `main_gui.script.lua` de miniMapper qui fonctionnait en jeu.
- Il n'y a pas d'emplacement « corps de recette » dans TFUI. La pompe `react.onStep` est donc installée par l'expression `value` de la ProgressBar (évaluée pendant le rendu de la Window) via `handlers.bindWindow`, ce qui survit aux régénérations.

### HQ-005 — Ortho : pyramide de tuiles PNG et aperçu
- **Date :** 2026-10-25 · **Statut :** accepted
- Le worker produit en flux la pyramide 256 px (filtre boîte 2×2) et un `ortho.png` d'aperçu de 6144 px maximum de côté. La pleine résolution ne vit que dans la pyramide (139 MP ne tiendraient pas dans une seule image en mémoire).
- PNG via fast-png, pour être portable : WebKit ne sait pas encoder le WebP.

### HQ-006 — Collecte des captures par l'app (portage du watcher)
- **Date :** 2026-10-25 · **Statut :** accepted (NOT TESTED en jeu)
- La fenêtre de collecte part de `startedAt` de `capture_index.lua` moins 2 s. Un fichier de moins de 700 ms est attendu. Le rang chronologique donne `tile_p01_SSS` (même `displaySeq` que miniMapper, testé). Le plan et la heightmap du run sont copiés au début.

### HQ-007 — Retours du premier run réel (2026-10-25)
- **Statut :** accepted (tests vitest OK ; NOT TESTED en jeu ni dans l'app)
- **Ortho = tâche globale** (`state/orthoJob.svelte.ts`) : une seule tâche à la fois, annulable, indépendante des onglets (indicateur dans l'en-tête). TileLab et le Visualiseur restent montés (masqués en CSS).
  - Écriture dans `pyramid.tmp/`, puis remplacement de `pyramid/` une fois terminé : une annulation ne casse jamais l'ancienne ortho.
  - Au plus 8 écritures de tuiles en parallèle.
- **Pyramide v2** : toutes les tuiles font 256² (transparent hors image). En v1, les tuiles de bord partielles étaient étirées par OpenLayers, d'où un « étirement en bas » qui variait avec le zoom. Le Visualiseur et TileLab signalent les orthos v1 à recalculer.
- **Visualiseur** :
  - zoom calé sur les niveaux de la pyramide (`constrainResolution`), ce qui supprime le flou dû au rééchantillonnage entre niveaux (l'écran est à 96 DPI, pas d'effet d'échelle) ;
  - 3 niveaux au-delà de la pleine résolution (×2, ×4, ×8), sans lissage (couche `interpolate: false`) ;
  - rotation par boutons ±15° / 90° / « Droit » et par Alt+Maj+glisser.
- **Interpolations** (banc de 35 MP, rendu seul) : Lanczos 7,5 s, bicubique 5,4 s, bilinéaire 2,0 s, plus proche 1,2 s. L'encodage PNG prend environ 8 à 10 s dans tous les cas.
- **Captures isolées** :
  - le mod écrit `shotTimes` (os.time de chaque prise) dans `capture_index.lua` ;
  - le jeu nomme ses captures `YYYY-MM-DD_HH-MM-SS_img_N.png`, et `takeScreenshot(scale)` ne permet pas de choisir le nom ;
  - `matchShots` estime le décalage d'écriture (la seconde où le plus de tuiles ont un fichier exact), puis associe à chaque tuile le fichier le plus proche, dans l'ordre ;
  - les fichiers du run sont **déplacés** (copie, vérification de la taille, suppression) ; les captures d'écran du joueur sont ignorées et comptées dans `extras` ;
  - un index sans `shotTimes` (ancien mod) revient au classement par date, en copie seule.
- **Runs nommés** : `label` dans `run.json`, modifiable dans TileLab.
- **GridLab** : section « Grille dans le mod » (date, grille, identique ou différente de la grille affichée). C'est l'app, et elle seule, qui écrit le plan et les cutscenes.

### HQ-008 — Pas de rechargement : plan en userdata, relu à chaque capture
- **Date :** 2026-10-25 · **Statut :** accepted (simulation OK, NOT TESTED en jeu)
- **Preuve du problème** (`stdout.txt`) : après un changement de grille sans recharger, `capture start grid=12x5 shots=60` puis `capture OK shots=21/60`. La cutscene est relue à chaque `playCutscene`, mais `mosaic_plan.lua`, chargé par `ug_require`, reste en cache jusqu'au rechargement.
- **Décision :**
  - l'app écrit le plan dans `<UD>/hqminimap/capture_plan.lua` (enrobage `function data()` de `renderPlan()` + `M.planStamp`) ;
  - le mod le lit avec `app.loadUserdata("hqminimap","capture_plan")` (`io_util.loadTable`), à chaque « Capturer » ;
  - l'ancien `content/hqminimap/mosaic_plan.lua` est supprimé à l'écriture ;
  - si le nombre de prises ne correspond pas à `nX·nY·pitchCount`, la capture finit en erreur explicite ;
  - `capture_index.planStamp` permet à GridLab d'afficher « déjà capturée ».
- **Attention :** le **code** du mod (`capture.lua`…) passe lui aussi par `ug_require`. Une mise à jour du mod demande donc toujours de relancer le jeu ou de recharger la partie ; seules les données (grille, cutscene) se rechargent à chaud.

### HQ-009 — GridLab compact, historique, estimations TileLab
- **Date :** 2026-10-25 · **Statut :** accepted (`npm run check` + 23 tests OK ; UI NOT TESTED)
- **GridLab** : panneau de 300 px, deux lignes d'état (carte, grille du jeu), champs en grille, tableau de résultat, bouton d'écriture fixé en bas.
- **Réglages → Historique des captures** (`ui/History.svelte`) :
  - taille calculée en arrière-plan (`runs.dirSize`) ;
  - suppression de la sélection ou de tout, avec confirmation (`ask` du plugin dialog) via `runs.deleteRuns` ;
  - verrou sur le run en cours de capture et sur celui dont l'ortho est en calcul.
- **TileLab** :
  - `estimateOrtho()` donne l'image finale (même arrondi que `OrthoRenderer`, testé), le nombre de tuiles et l'aperçu ;
  - durée par interpolation tirée de `state/orthoSpeed.ts` : valeurs par défaut du banc, puis s/MP mesurées après chaque export (`localStorage`) ;
  - taille sur disque = tuiles × octets par tuile (124 Ko mesurés sur le 1er run réel, puis appris).

### HQ-010 — Étapes visibles, annonce en jeu, chargement fiable du plan dans TileLab
- **Date :** 2026-10-25 · **Statut :** accepted (check + 23 tests + simulation OK ; UI NOT TESTED)
- **Bandeau d'étapes** (`ui/Steps.svelte`, sous l'en-tête, dans tous les onglets) : 1 Export › 2 Grille écrite › 3 Capturer dans le jeu › 4 Ortho.
  - L'étape à faire clignote ; un clic ouvre l'onglet concerné.
  - L'état vient de `app.capturePlan` et `app.lastCapture` (sondés toutes les 1,5 s dans `app.svelte.ts`). Une capture appartient à la grille courante si son `planStamp` est celui de `capture_plan.lua`.
- **GridLab** : encadré « ✔ Grille écrite → dans le jeu : HQminiMap → Capturer » tant que la grille n'a pas été capturée, puis « Capture en cours x/y ».
- **Mod** : quand la fenêtre est ouverte et inactive, la pompe relit `capture_plan` toutes les 90 images et affiche « Nouvelle grille prête : NxM (K images), clique « Capturer » ». `settings.lastCapturedStamp` évite de réannoncer une grille déjà capturée.
- **TileLab** :
  - le run affiché peut changer sans clic (nouvelle capture, suppression) ; plan et vignettes sont alors réinitialisés ;
  - les chargements en retard sont ignorés ;
  - « Chargement… » est distingué de « introuvable », avec un nouvel essai toutes les 2 s.
  - Cause probable du « introuvable » : le plan et les vignettes de l'ancien run restaient affichés quand le run changeait sans clic.
- **Collecteur** : la copie du plan et de la heightmap dans le run est retentée à chaque passage, jusqu'à ce que les deux soient là. Seul un plan dont le `planStamp` est celui de la capture est accepté.

### HQ-011 — Chrono de l'ortho, poids par interpolation, plein écran, i18n, vitesse de capture
- **Date :** 2026-10-25 · **Statut :** accepted (check + 26 tests + simulation FR/EN OK ; UI et jeu NOT TESTED)
- **Ortho** :
  - `orthoJob` affiche écoulé / restant / total, une seconde à la fois. Le restant suit la progression mesurée au-delà de 3 %, et l'estimation du modèle avant.
  - Le résultat compare la durée réelle à celle annoncée.
- **Interpolation et taille** : l'interpolation ne change pas les pixels, seulement leur calcul ; seul le poids PNG varie. `orthoSpeed` apprend donc les octets par tuile **par interpolation**, et le menu affiche durée et poids par option.
- **Plein écran** : `app.setFullscreen` (`getCurrentWindow().setFullscreen`, permission `core:window:allow-set-fullscreen`) masque l'en-tête et le bandeau d'étapes, avec des commandes flottantes. Raccourcis F / F11 / Échap.
- **i18n app** :
  - `src/lib/i18n` : `fr.ts` source, `en.ts` typé `Record<MessageKey,string>`, `t()` réactif, `fmtDate` / `fmtNum` / `fmtClock` ;
  - langue choisie dans Réglages ;
  - les états renvoient des codes (`mapError`, `WriteIssue`, erreurs `ortho.err.*`), traduits par l'UI.
- **i18n mod** :
  - `hqminimap/i18n.lua` (tables `en` / `fr`), langue lue via `api.util.getLanguage()` (format non documenté, loggé une fois) ;
  - textes TFUI en `handlers.t(…)` / `handlers.statusText(status)` ;
  - doc dans `docs/TRANSLATING.md`. Les catalogues gettext d'un mod ne sont pas vérifiés, d'où le choix de tables propres.
- **Vitesse de capture (test)** :
  - `MosaicConfig.SEG_DUR` / `SHOT_OFFSET` / `ENV_SETTLE_SEC` / `SPEED_PRESET`, écrits dans le plan (`M.speedPreset`) ;
  - préréglages : normal 1 / 0,25 / 2 · rapide 0,5 / 0,2 / 1 · très rapide 0,25 / 0,12 / 0,5 ;
  - `timingIssue` exige que la prise tombe dans le maintien immobile et une durée d'au moins 0,2 s ;
  - les valeurs par défaut ne changent rien à la concordance avec le générateur de référence.

### HQ-012 — Un run supprimé ne doit pas renaître
- **Date :** 2026-10-25 · **Statut :** accepted (check + tests OK ; NOT TESTED dans l'app)
- **Bug constaté :** supprimer le run de la dernière capture le faisait réapparaître aussitôt avec 0 image (seulement le plan et la heightmap). Le collecteur le recréait, puisque `capture_index.lua` pointait encore sur ce `startedAt`.
- **Correctif :**
  - les ids supprimés sont mémorisés (`localStorage hq.deletedRuns`) **avant** la suppression, et le collecteur les ignore ;
  - la suppression attend la fin d'un passage du collecteur en cours ;
  - `removeDir` fait 3 essais et renvoie le succès ; l'Historique liste les dossiers restés verrouillés (fichiers ouverts par un autre programme).

### HQ-013 — Vitesse de capture retirée de l'UI, estimation de l'ortho dans GridLab, plein écran corrigé
- **Date :** 2026-10-25 · **Statut :** accepted (check + tests OK ; NOT TESTED dans l'app)
- **Vitesse de capture** : en jeu, les préréglages rapides finissaient systématiquement en erreur (OBSERVED par l'utilisateur ; cause probable : à faible FPS, une image du jeu dure plus que le maintien de 0,25–0,5 s, donc des tuiles sont sautées et la capture finit en « la cutscene ne correspond pas »).
  - La section a été retirée de GridLab, et les réglages enregistrés sont purgés au chargement.
  - Le cœur garde le support (`captureTiming`, valeurs par défaut = référence).
- **GridLab** : le tableau de résultat annonce, **avant capture**, l'ortho finale (`estimateOrtho`, dimensions en px et MP), son poids et la durée de calcul (modèle Lanczos). La note sur l'interpolation de TileLab est retirée.
- **Plein écran** : le contenu disparaissait parce que la grille `.shell` gardait `0 0 1fr` alors que l'en-tête et le bandeau passaient en `display: none`, ce qui écrasait `main` dans une rangée de hauteur 0. Désormais `.shell.fullscreen { grid-template-rows: 1fr }`, avec repli sur l'API web Fullscreen si l'API fenêtre Tauri échoue.

### HQ-014 — Bouton « Min » : toujours la plus petite grille couvrante
- **Date :** 2026-10-25 · **Statut :** accepted (tests OK : 8 cas, dont la vraie carte)
- `Mosaic.bestGrid` est toujours calculé : le plus petit nX tel que le déficit X ≤ 0, puis le plus petit nY tel que le déficit Y ≤ 0. Les axes sont indépendants, puisque le déficit X ne dépend que de nX.
- `minGrid` (sémantique du générateur de référence, uniquement quand la grille ne couvre pas) est conservé pour la concordance. Les tests vérifient que `bestGrid` couvre la carte, qu'un cran de moins sur un axe ne la couvre plus, et que `bestGrid` égale `minGrid` quand ce dernier existe.
- **GridLab** : le bouton « Min NyxNx » est toujours proposé (mis en avant si la grille courante n'est pas la minimale) et affiche « ✓ Min » quand elle l'est déjà.

### HQ-015 — Visualiseur à une seule couche ; ortho volumineuse signalée
- **Date :** 2026-10-25 · **Statut :** accepted (check OK ; NOT TESTED dans l'app)
- **Symptôme** (utilisateur) : au fort zoom, des tuiles disparaissent.
- **Hypothèse** : le passage entre deux couches OpenLayers (lissée au-dessus de la pleine résolution, nette en dessous, chacune avec sa propre source et son cache) forçait un rechargement complet, et une lecture de tuile ratée donnait un GIF vide **définitif**.
- **Changement** :
  - une seule couche `interpolate: false`, sans perte de qualité puisque le zoom est calé sur les niveaux de la pyramide ; `cacheSize` à 1024, `preload` à 1 ;
  - 2 nouvelles lectures par tuile avant d'abandonner, avec `console.warn` sur l'échec définitif.
- **GridLab** : au-delà de 500 Mo estimés, le poids de l'ortho s'affiche en orange avec ⚠, et une infobulle propose des solutions (altitude, FOV, demi-résolution).

### HQ-016 — Données en direct exportées par HQminiMap, cadence réglée dans l'app
- **Date :** 2026-10-25 · **Statut :** accepted (sim_live OK ; NOT TESTED en jeu)
- **Source** : export propre au mod (`live_export.lua`), aucune dépendance à un autre mod ; le dossier `towns_industries` n'est pas utilisé.
- **Fichiers** (`<UD>/hqminimap/`) : `live_towns|industries|stations|lines|vehicles.lua` + `live_status.lua` écrits par le mod ; `live_request.lua` écrit par l'app (`enabled`, `intervals` en s, `cmd`).
- **Pompe** : `react.onStep` installé depuis la recette du bouton de la zone des mods (tourne fenêtre fermée, sonde : 961 ticks) ; la fenêtre ne tique que si la pompe du bouton n'a pas avancé.
- **Cadence** en temps réel `os.time` (pas `os.clock`, qui est du temps CPU), une tâche par image au plus.

### HQ-017 — Visualiseur : calques, filtres, configurations, export de vue, téléportation
- **Date :** 2026-10-25 · **Statut :** accepted (check + 41 tests OK ; NOT TESTED dans l'app ni en jeu)
- **Calques** OpenLayers vectoriels dans le repère image (`ui/viewer/layers.ts`) ; sans ortho, repère pris dans les bornes de `map.lua` (option « Sans ortho »).
- **Filtres** purs dans `core/filters.ts` ; état courant, panneau ouvert ou fermé et configurations nommées dans `state/viewerFilters.svelte.ts` (localStorage, import/export JSON `format: "hqminimap-filters"`).
- **Export** PNG : composition des canvas au `rendercomplete` ; ×2/×4 via une vue temporaire non contrainte et une carte agrandie, puis restauration.
- **Téléportation** : double-clic (DoubleClickZoom désactivé) ou bouton de la fiche → `cmd teleport` avec `seq` croissant ; acquittement par `live_status.cmd`, délai de 6 s → « pas de réponse du mod ».
- Les véhicules sont interpolés entre les deux dernières mises à jour : ils ont donc un intervalle de retard sur le jeu.

### HQ-018 — Tracés des lignes, trafic, positions des gares
- **Date :** 2026-10-25 · **Statut :** accepted (sim_live, check, 45 tests et build OK ; NOT TESTED en jeu)
- **Symptôme** : 0 gare et des `stops` vides, avec des jobs `ok`. `stationPos` échouait sous un `pcall` muet et mettait l'échec en cache pour toujours.
- **Positions des gares** :
  - centre de `BOUNDING_VOLUME.bbox` de la gare (comme `entity_util.getPosition` dans le jeu) ;
  - repli sur la construction (bbox puis `transf`) ;
  - échec retenté après 30 s, première erreur remontée dans `live_status.jobs.<kind>.warn`.
- **Tracés** : une ligne ne stocke que ses arrêts. Le job `routes` cumule les arêtes de `MOVE_PATH.path.edges` de ses véhicules ; une arête est une courbe d'Hermite (`BASE_EDGE`).
  - Le cumul est remis à zéro quand les arrêts changent.
  - `live_routes` n'est réécrit que s'il change.
  - Pour l'avion, le bateau et les tracés encore inconnus, l'app trace des tirets entre arrêts.
- **Trafic** (job `stats`) :
  - `logbook.getLogValuePerYear` : ligne `itemsTransported`, groupe de gares `itemsLoaded` / `itemsUnloaded` ;
  - attente par `simEntityAtTerminalSystem.getLineStopSimEntitiesCount`, passagers ou autres marchandises.
- **Exécution** : les jobs longs (`stations`, `stats`, `routes`) avancent par pas, au plus 3 ms par frame.

### HQ-019 — Tracés continus, bateaux, stocks, étiquettes, minimums de cadence
- **Date :** 2026-10-25 · **Statut :** accepted (sim_live, check, 49 tests et build OK ; NOT TESTED en jeu)
- **Constat** :
  - les 16 lignes water n'avaient aucune arête : les bateaux utilisent `MOVE_PATH_AIRCRAFT`, pas `MOVE_PATH` ;
  - « Urville_workers » comptait 12 extrémités pendantes (trous de 17 à 800 m).
- **Tracés** : chemin parcouru dans l'ordre.
  - `BASE_EDGE` : Hermite.
  - Sinon `TRANSPORT_NETWORK.edges[i+1].geometry` échantillonnée par `EdgeGeometry.calcPos`.
  - Sinon pont droit entre deux pièces connues.
  - Seuls les succès de géométrie sont mis en cache.
  - Bateaux : `path1` échantillonné tous les ≈ 50 m, par tronçon.
  - `live_routes` v2 ajoute `p` (polylignes) par ligne. Le diagnostic va dans `live_status.routes` et `jobs.routes.warn`.
  - Repli app : trace des positions des bateaux et avions (`live.trails`).
- **Stocks** :
  - job `stocks` : `simEntityAtStockSystem.getStockCount` sur `INDUSTRY.stockList` et `WAREHOUSE.stockList` ;
  - chargement des véhicules : `simEntityAtVehicleSystem.getVehicleSimEntitiesCount`, en 5ᵉ champ de `live_vehicles`.
- **Étiquettes** : `FilterState.labels` par calque, enregistrées avec les configurations. L'ancien `showTraffic` est migré vers `labels.stations`.
- **Cadences minimales** (`MIN_INTERVALS`) :
  - véhicules 1 s (pas de `os.time`) ;
  - lignes, gares, trafic 5 s ;
  - le reste 10 s.
- **Colonnes de Réglages** : « Coût » = ms par exécution ; « Charge » = coût ÷ intervalle.

### HQ-020 — Mod périmé détecté, logos, contours de villes, historique, panneau refait
- **Date :** 2026-10-25 · **Statut :** accepted (sim_live, check, 54 tests et build OK ; NOT TESTED en jeu)
- **Constat** : au test de 18:15, le jeu exécutait encore l'ancien `live_export.lua` (rien de HQ-019 dans les fichiers), car `ug_require` garde le code jusqu'au rechargement de la sauvegarde.
- **Détection** : `live_status.format = 3`, et `LIVE_FORMAT` côté app. Si les deux diffèrent, `live.staleMod` affiche un bandeau dans le Visualiseur et dans Réglages. **Augmenter les deux** à chaque changement de format.
- **Icônes** : `ui/viewer/icons.ts`, pictogrammes SVG (glyphe blanc sur pastille).
  - Véhicule : logo de son mode, dans la couleur de sa ligne.
  - Industrie : usine. Entrepôt : bâtiment.
  - Arrêts : retour au rond plein (carré pour le fret).
- **Sélection** : halo dans la couleur de la ligne ou de l'objet (plus de jaune).
- **Contours de villes** :
  - job `townAreas` : `TOWN_BUILDING` → `townBuildingSystem.getTown` → cases de 60 m ;
  - côté app, `core/towns.ts` trace les frontières des cases (trous retirés) puis lisse par Chaikin ;
  - le polygone est sur le calque le plus bas, pour que les objets à l'intérieur restent cliquables.
- **Historique** : job `history`, 24 derniers points de `LOG_BOOK` (`itemsTransported`, `itemsLoaded` / `itemsUnloaded`).
  - Une série qui ne décroît jamais est traitée comme un cumul : la mini-courbe trace ses écarts.
  - La nature réelle des séries est à vérifier en jeu (`live_status.history`).
- **Véhicules** : nom en 6ᵉ champ de `live_vehicles` (cache 30 s, séparateurs remplacés).
- **Panneau des calques** :
  - une carte par calque (icône, compteur, 🏷, 👁, filtres repliables mémorisés dans `hq.lpOpen`) ;
  - puces de mode ;
  - encart « Symboles ».

### HQ-021 — Géométrie calculée, ponts courts, chargement, villes, animation sans saut
- **Date :** 2026-10-25 · **Statut :** accepted (sim_live, check, 56 tests et build OK ; NOT TESTED en jeu)
- **Constats en jeu (format 3, 18:55)** :
  - `missing 7939`, `bridges 4037`, `lanes 0`, `free 0` : `api.type.EdgeGeometry.calcPos` échoue sur les tables Lua que renvoie `getComponent`. D'où les diagonales (ponts) et les lignes coupées.
  - Chargement `-1` partout : `getVehicleSimEntitiesCount` échoue.
  - `townBuildingSystem.getTown` n'existe pas.
- **Géométrie** : `geomPoints` calcule les points d'une EdgeGeometry à partir de ses champs (straight / cubic / arc, d'après `api.type.EdgeGeometry.Type`). Sert aux voies `TRANSPORT_NETWORK` et au `path1` des bateaux.
- **Ponts** : seulement s'ils font ≤ 80 m, sinon le trou reste ouvert (compté dans `bigGaps`). Les 5 premiers échecs sont détaillés dans `live_status.routes.samples`.
- **Chargement** : `TRANSPORT_VEHICLE.config.capacities[i]` > 0, puis `getVehicleSimEntitiesCountForCargoType(v, i-1)`. Format du véhicule : `id,ligne,x,y,pass,passCap,fret,fretCap,nom`. `FORMAT` et `LIVE_FORMAT` passent à 4.
- **Villes** : `streetConnectorSystem.getConstructionEntityForTownBuilding` puis `getConstructionClosestTown`. Repli sur la ville la plus proche.
- **Animation** : glissement depuis la position **affichée**, pendant l'intervalle mesuré entre mises à jour. Un saut de plus de 2 km est posé sans animation.
- **Icônes** :
  - glyphe noir si la luminance du fond dépasse 0,45 ;
  - lieux en carré arrondi (coin marqué = fret, double liseré = mixte), véhicules en rond ;
  - `declutterMode: "obstacle"` : les icônes ne sont plus masquées par le declutter.
- **Lignes inactives** (aucun véhicule, ou moins de 2 arrêts) : masquées par défaut (`showInactiveLines`).

### HQ-022 — Sans voies de carrefour, comblement par traces, contours nets, arrêts aux couleurs des lignes
- **Date :** 2026-10-25 · **Statut :** accepted (sim_live, check, 58 tests et build OK ; NOT TESTED en jeu)
- **Constats en jeu (format 4)** :
  - `missing 0`, `lanes 7378`, `free 31` ;
  - les « lanes » étaient les voies de virage des carrefours (`BASE_NODE`, 2–49 m), d'où les arrondis ;
  - il restait des trous de 600–800 m sur les tracés centraux, alors qu'aucun chemin relevé ne les couvre.
- **Mod (FORMAT 5)** :
  - arêtes de carrefour ignorées sans trou (les tronçons voisins se touchent au nœud) ;
  - voies internes des constructions dessinées en segment droit ;
  - `routes.pathStats` (arêtes par chemin, `edgeIndex`, états) pour savoir si un chemin est une fenêtre ou un trajet complet — **à lire au prochain test** ;
  - cases des villes de 20 m.
- **App** :
  - traces de tous les véhicules (25 m entre deux points, 800 au plus) ;
  - `uncovered()` (`core/routes.ts`) garde les morceaux de trace à plus de 20 m du tracé connu, dessinés en trait fin de la couleur de la ligne, recalculés toutes les 10 s au plus ;
  - seules les traces des bateaux et avions sont gardées sur disque.
- **Villes** : fermeture morphologique (+50 m / −35 m), puis Douglas-Peucker 12 m et un seul passage de Chaikin.
- **Arrêts** : pictogramme d'arrêt du mode (panneau, quai, T, ancre, tour), dans la couleur des lignes visibles qui les desservent (bandes si plusieurs, la plus fréquentée en premier). Gris si aucune ligne.

### HQ-023 — Première publication : GPL-3.0, CI, releases brouillons, zip du mod
- **Date :** 2026-10-25 · **Statut :** accepted (check, 58 tests, build, `cargo check`, sim_live OK ; workflows non exécutés tant que rien n'est poussé)
- **Licence** : GPL-3.0-only (`LICENSE`, `package.json`, `Cargo.toml`). Le paquet Cargo s'appelle `hqminimap` ; la bibliothèque reste `app_lib`.
- **Version unique** : `tools/bump-version.mjs <x.y.z> [--check]` pour `package.json` (+ lock), `tauri.conf.json` et `Cargo.toml` (+ lock). `modinfo.json` n'a **pas** de champ `version` (format du jeu non vérifié) : la version du mod est dans le nom du zip.
- **Zip du mod** : `tools/pack-mod.mjs` → `dist/hqminimap-mod-<version>.zip` (dossier `hqminimap/`, sans `mosaic_plan.lua` ni `cutscenes/`), en zip écrit par Node, sans outil externe.
- **CI** (`ci.yml`) : check, tests, build, `sim_live`, versions, zip.
- **Release** (`release.yml`, tag `v*`) : vérification de version, tauri-action en release **brouillon** (Windows NSIS/MSI, Linux AppImage/deb, macOS universel), zip du mod joint. Installeurs non signés.
- **Mod** : pas publié sur mod.io ; installation manuelle dans `<userdata>/staging_area/`.
- **Viewer** : contours de villes avec fermeture +90/−70 m, DP 25 m, 2 passes de Chaikin, anneaux < 0,02 km² retirés ; noms des villes en arrière-plan (zIndex 6, hors declutter).

### HQ-024 — Étapes par pathfinding, réglages d'image WebGL, styles de carte, étiquettes de lignes, Options
- **Date :** 2026-10-25 · **Statut :** accepted (sim_live, check, 61 tests, build et `cargo check` OK ; NOT TESTED en jeu ni dans l'app)
- **Constat** (`pathStats`) : chemins de 54 arêtes en moyenne, `edgeIndex` moyen de 26. Les chemins des véhicules couvrent **toute l'étape**. Les trous (ex. `passenger_SAINT-BRICQ-LAHA`, tronçon D → E → F) viennent d'étapes jamais relevées pendant qu'un véhicule y circulait.
- **Mod (FORMAT 6)** :
  - chaque étape (arrêt *i* → *i+1*, et retour au premier) passe par `findPathNodeToNode` : `STATION.terminals[t+1].vehicleNodeId` des deux arrêts, recréés par `api.type.NodeId.new`, avec les modes de la ligne ;
  - mise en cache par paire de nœuds, recalcul toutes les 10 passes ;
  - diagnostic dans `routes.legs` ;
  - les chemins des véhicules restent cumulés en complément.
- **Image** :
  - l'ortho passe en `WebGLTileLayer` + `ImageTileSource` (loader → `ImageBitmap`) ;
  - variables de shader `brightness` / `contrast` / `saturation` / `gamma`, appliquées à toute l'image ;
  - l'auto (`core/imageAdjust.ts`) se calcule sur `ortho.png` : percentiles 1–99 %, médiane vers 0,5 et saturation des images ternes ;
  - réglages enregistrés par run dans `hq.imageAdjust`.
- **Options → Carte** (`state/mapStyle.svelte.ts`) : `iconScale`, `textScale`, `lineOpacity` (une ligne sélectionnée reste opaque).
- **Étiquettes de lignes** : calque séparé avec declutter, une étiquette par nom (lignes bidirectionnelles), sur le plus long morceau du tracé ; ajoutées par trafic décroissant, la ligne sélectionnée en premier.
- **Points d'arrêt de la ligne sélectionnée** : couleur `inkOn(couleur de la ligne)`.
- **Bouton « Ajuster »** (touche 0) ; ajustement automatique à l'entrée et à la sortie du plein écran.
- **Bande des étapes** (`state/stepsBar.svelte.ts`) : × la masque pour la grille courante (`hq.stepsHidden`) ; elle revient à la grille suivante ou par le bouton « Étapes » de l'en-tête.
- L'onglet « Réglages » devient **« Options »** (FR et EN).

### HQ-025 — Fenêtres en jeu au double-clic, lignes partagées en bandes, choix de ligne, historique dans TileLab
- **Date :** 2026-10-25 · **Statut :** accepted (sim_live, check, 63 tests, build et `cargo check` OK ; NOT TESTED en jeu ni dans l'app)
- **Réglages d'image** : uniquement sur la couche WebGL de l'ortho, jamais sur les calques vectoriels (lignes, icônes, textes).
- **Fenêtre en jeu** :
  - le jeu ouvre une fenêtre d'entité par `react.fireEvent(nil, "selectEntity", { entity, stack })` (`view_manager.tl`) ;
  - le mod reçoit `react` par la pompe du bouton (`live_export.tick(react)`) ;
  - commande `focus { x, y, dist, kind, id, open }` (FORMAT 7) ; entité ouverte : la construction pour une usine (`getConstructionEntityForIndustry`) ou un entrepôt (`WAREHOUSE.construction`), sinon l'id lui-même (véhicule, ligne, groupe de gares, ville) ;
  - option `mapStyle.openInGame`.
- **Lignes superposées** :
  - `routeParts()` donne le détail par arête ; `sharedEdges()` liste les arêtes empruntées par plusieurs lignes visibles, triées par trafic ;
  - ces arêtes sont retirées de la géométrie propre de chaque ligne et dessinées en bandes concentriques (la plus grosse ligne dehors, −2,6 px par ligne, liseré sombre) ;
  - le `full` de l'entité ligne sert au cadrage.
- **Clic sur plusieurs lignes** : menu au curseur ; un nouveau clic au même endroit (≤ 4 px) passe à la ligne suivante. L'infobulle liste les lignes. Un point garde la priorité, et la ville passe en dernier.
- **Historique des captures** : déplacé d'Options vers TileLab, en section repliable (colonnes grille et images masquées).

### HQ-026 — Tracés comme dans le jeu : pointillés multicolores, deux sens côte à côte, pastilles de chargement
- **Date :** 2026-10-25 · **Statut :** accepted (sim_live, check, 65 tests, build et `cargo check` OK ; NOT TESTED en jeu ni dans l'app). **Remplace** les bandes concentriques de HQ-025, jugées trop épaisses.
- **Mod (FORMAT 8)** : masque de sens par arête (1 = le long de la géométrie `position0 → position1`, 2 = à contresens). Export en ids signés : `id`, `-id`, ou les deux.
- **App** :
  - `routeParts.lineEdges` donne `{ id, dir }` ;
  - `edgeStrokes()` produit un trait par (arête, côté) : une rue (road / tram) parcourue dans les deux sens donne deux côtés (avant à droite, circulation à droite), sinon un trait centré ;
  - les lignes d'un trait sont triées par trafic.
- **Dessin** :
  - une ligne : trait plein ;
  - k lignes : `lineDash [10, (k−1)·10]` avec `lineDashOffset (k−i)·10`, une couleur par tiret ;
  - décalage latéral de 3 px × `iconScale`, calculé en pixels (`offsetLine` × résolution, mis en cache) ;
  - la ligne sélectionnée est tracée en plein sur ses traits, avec son halo sur `full` ;
  - les entités de trait portent `lines`, et `hitsAt` les déplie (menu de choix).
- **Véhicules** :
  - pastilles de chargement (`mapStyle.vehicleBadge` : rien / passagers / fret / les deux), passagers `#9fd3ff`, fret `#ffc861`, sous 40 m/px ;
  - la vignette passagers 👤 devient 🧑, en couleur.

### HQ-027 — Toutes les résolutions du jeu
- **Date :** 2026-10-25 · **Statut :** accepted (check, 74 tests et build OK ; NOT TESTED en jeu)
- **Constat** : `screenW` / `screenH` étaient figés à 2560 × 1080 (`DEFAULT_CONFIG`) sans réglage dans l'interface. Or ils fixent la forme de l'empreinte, le pas de la grille et la reprojection de l'ortho : en 16:9 ou en 32:9, la grille et l'ortho étaient fausses.
- **GridLab** :
  - bloc « Résolution du jeu » : préréglages de 1280 × 720 à 5120 × 2160, ou valeur libre, avec le format affiché (`core/png.ts` : `aspectName`) ;
  - détection par l'en-tête IHDR (`pngSize`) de la capture d'écran la plus récente du jeu, ou à défaut de la première capture d'un run ; bandeau « Utiliser ».
- **Garde-fous** :
  - TileLab compare la taille réelle des captures (`captureSize`) au plan : un format différent (> 1 %) affiche un message et bloque l'ortho ;
  - `exportOrtho` : même format mais autre taille → le plan prend la taille réelle (même FOV, reprojection identique, testée à ×1,5) ; format différent → `resolutionMismatch`.
- Les vignettes de TileLab prennent le format du plan.
- Le mod ne change pas (`takeScreenshot(1)` = résolution du jeu).
- **Complément (HQ-027)** : par défaut, la grille **suit** la résolution détectée (`MosaicConfig.SCREEN_AUTO`, absent = vrai).
  - Elle est appliquée en silence à l'ouverture de GridLab et redétectée avant chaque « Écrire dans le mod ».
  - Choisir un préréglage ou une taille libre passe en manuel (`SCREEN_AUTO = false`) ; l'entrée « Auto » de la liste, ou « Utiliser » dans le bandeau, y revient.

### HQ-028 — Mises à jour de l'app depuis les releases GitHub
- **Date :** 2026-10-26 · **Statut :** accepted (check, 78 tests et `cargo check` OK ; NOT TESTED avec une vraie release)
- **Mécanisme** : `tauri-plugin-updater` + `tauri-plugin-process` (relance). Point de terminaison `releases/latest/download/latest.json`, généré et joint par tauri-action (`createUpdaterArtifacts`, `updaterJsonPreferNsis`). Seules les releases **publiées** comptent (ni brouillon ni pré-release).
- **Signature** : minisign, clé publique dans `tauri.conf.json`, clé privée et mot de passe dans les secrets `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` (procédure dans `docs/DEVELOPMENT.md`). Clé perdue = plus de mise à jour automatique pour les installs existantes.
- **Qui s'auto-installe** : commande Rust `install_info` → `selfUpdate`. Faux pour le zip portable (marqueur `HQminiMap.portable` à côté de l'exe, écrit par release.yml : l'updater y installerait une seconde copie), pour Linux hors AppImage (`.deb`) et en dev. Ces cas lisent l'API GitHub (`releases/latest`) et proposent seulement un lien.
- **App** (`state/updates.svelte.ts`, `core/version.ts`) : vérification 5 s après le lancement (désactivable, `hq.updates.auto`), pastille dans l'en-tête, carte « Mises à jour » dans Options (vérifier, installer et redémarrer avec progression, notes, ignorer une version `hq.updates.skip`). Confirmation si une ortho ou une capture est en cours. Windows : installeur en mode `passive`.
- **Mod** : hors périmètre, il reste installé et rechargé côté jeu (zip joint à la release).
- **Première version** : les installs 0.2.0 n'ont pas l'updater ; la version qui l'apporte s'installe encore à la main.

### HQ-029 — Étiquettes de chargement encadrées, épaisseur des lignes, tout cocher / décocher, modes des gares
- **Date :** 2026-10-26 · **Statut :** accepted (check, 83 tests, build et sim_live OK ; NOT TESTED dans l'app ni en jeu)
- **Chargement des véhicules** : `loadBadge()` (`ui/viewer/icons.ts`) dessine une seule étiquette SVG à droite de l'icône : cadre de la couleur de la ligne sur fond sombre, pictogrammes déjà utilisés par l'app (`LOAD_ICON` : 🧑 passagers, 📦 fret, aussi dans les étiquettes et la fiche) suivis de `n/cap`. Largeurs mesurées au canvas (estimée sans canvas, dans les tests). Caches bornés à 2000 entrées (les comptes changent sans arrêt).
- **Épaisseur** : `mapStyle.lineWidth` (0,5–3, défaut 1,3), curseur dans Options → Carte. Toutes les largeurs de tracé, les tirets (partagés, étapes, traces) et le décalage des deux sens (demi-trait + 1,5 px) suivent ; sous 6 m/px, le trait grossit encore jusqu'à ×1,6.
- **Défauts** : icônes 1,1 (au lieu de 1). Réglages enregistrés avec `v: 2` ; un ancien réglage (sans `v`) resté à 1 passe à 1,1.
- **Filtres** : boutons ☑ / ☐ sur les types d'industries et les puces de mode (gares, lignes).
- **Audit des modes** : lignes (carrier du véhicule), étapes par pathfinding (rail, route, tram), bateaux et avions (`MOVE_PATH_AIRCRAFT` + traces), glyphes, couleurs, libellés : les 5 modes + « autre » sont couverts.
  - **Bug corrigé** dans `fileMode` (repli pour une gare sans ligne) : « airport » et « transport » contenaient « port » et donnaient « bateau ». Ordre tram → rail → air → eau → route, testé dans `sim_live.py`.
  - Une gare desservie par plusieurs modes prend le plus fréquent parmi ses lignes (au lieu du premier).
  - La légende montre aussi le mode « autre ». Pas de changement de `FORMAT`.
- **Tracés continus** : les traits par arête (`edgeStrokes`) sont réunis en polylignes continues par `strokePaths` (`core/routes.ts`) quand ils ont les mêmes lignes et le même côté : chaînage orienté pour les deux sens d'une rue, dans les deux sens sinon (`chainUndirected`). Plus de jointure visible (superposition des bouts arrondis en semi-transparence) entre deux arêtes, jointures arrondies, tirets qui se suivent. Il reste une jointure là où l'ensemble des lignes change.
- **Ligne sélectionnée devant tout** : ses tracés (traits partagés compris, en plein dans sa couleur) et ses véhicules sont dessinés par deux calques de premier plan (zIndex 14 et 15, sous l'anneau de sélection) qui partagent les mêmes entités ; les calques normaux ne les dessinent plus pendant la sélection, donc les clics et l'animation restent inchangés. Ses véhicules ont des étiquettes en 12,5 px gras et des badges ×1,3.

### HQ-030 — Relief en courbes de niveau dans le Visualiseur
- **Date :** 2026-10-26 · **Statut :** accepted (check, 90 tests et build OK ; NOT TESTED dans l'app)
- **Calcul** (`core/contours.ts`, pur) : marching squares sur les centres de cases de la heightmap (512² exportée par le mod), points-selles tranchés par la moyenne des 4 coins, segments reliés par **arête de grille** (points identiques entre cases voisines). Niveaux sous `waterLevel` ignorés. Douglas-Peucker (0,15 case) puis un passage de Chaikin. ≈ 0,2 s pour 512² et 20 niveaux.
- **Équidistance** : auto (`contourStep` : 1 / 2 / 5 × 10ⁿ m, ≈ 25 courbes sur l'amplitude au-dessus de l'eau) ou 5 / 10 / 25 / 50 / 100 m ; une courbe maîtresse toutes les 5.
- **Calque** (`ui/viewer/contours.ts`) : zIndex 4 (sur l'ortho, sous les contours de villes et tout le reste), non cliquable. Courbes fines `rgba(255,255,255,.22)` masquées au-delà de 40 m/px, maîtresses 1,2 px avec liseré sombre ; altitudes le long des maîtresses sous 15 m/px (option 🏷).
- **Heightmap** : celle du run affiché (`<run>/heightmap.lua`, alignée sur son ortho), sinon celle de l'export courant (`app.map.hm`).
- **Réglage** : `FilterState.contours { show, step, width, labels }` (épaisseur 0,5–3, curseur dans la carte « Relief ») (affiché par défaut), carte « Relief » du panneau des calques, enregistré avec les configurations.

### HQ-031 — Relief en couleurs ou en courbes, courbes sans ralentissement, panneau en deux sections, réglages de carte dans le Visualiseur
- **Date :** 2026-10-26 · **Statut :** accepted (check, 93 tests et build OK ; NOT TESTED dans l'app)
- **Ralentissement des courbes** : le calque était un `VectorLayer` décluttéré de centaines de milliers de sommets, redessiné à chaque image de l'animation des véhicules. Désormais `VectorImageLayer` (image réutilisée tant que la vue ne bouge pas), sans declutter ; les altitudes sont un petit `VectorLayer` à part, rempli seulement quand 🏷 est actif (courbes maîtresses).
- **Relief** : `FilterState.relief { show, mode: colors | lines | both, step, width, labels, low, high, opacity }` (ancien `contours` repris par `normalizeFilters`), mode « Courbes » par défaut. Couleurs : `core/relief.ts`, interpolation de teinte HSL par le chemin court (vert → jaune → rouge par défaut, `#3cb44b` → `#e04040`), palette de 256 teintes, eau transparente, bornes = plus bas au-dessus de l'eau → plus haut ; `ImageLayer` + `ImageStatic` (canvas n × n, lissage bilinéaire) en zIndex 3,5, opacité réglable (0,45).
- **Panneau des calques** : deux sections repliables au même style de titre, Légende (repliée par défaut, porte le bouton «) puis Calques et filtres ; état dans `hq.lpOpen` (`sec.legend`, `sec.layers`). Légende du dégradé avec les altitudes min/max en mode couleurs.
- **Réglages de carte** : `ui/MapStyleSettings.svelte` partagé entre Options → Carte et le bouton « ⚙ Carte » de la barre du Visualiseur (aussi en plein écran).
- **Étiquette des véhicules** : le nom seul ; le chargement reste dans le badge, l'infobulle et la fiche.

### HQ-032 — Échelle et balance du relief, barre du Visualiseur allégée, bulle de vue, « Ajuster » sur la carte
- **Date :** 2026-10-26 · **Statut :** accepted (check, 97 tests et build OK ; NOT TESTED dans l'app)
- **Palette** : `Relief.stops`, 2 à 6 arrêts `{ color, alpha }` (défaut vert 45 % → rouge 55 % → violet 70 % → noir 85 % : le noir ne se voit pas en semi-transparence), couleur interpolée en teinte HSL par le chemin court (`rampColor`), opacité linéaire, écrite dans l'alpha de chaque pixel ; `opacity` devient une opacité générale (défaut 1) qui multiplie celle des arrêts. Anciens réglages (deux couleurs bas / haut, ou liste de couleurs + opacité unique) : chaque arrêt prend l'ancienne opacité, l'opacité générale passe à 1.
- **Relief en couleurs** : `Relief.scale` (`equalize` par défaut, `linear`, `sqrt`, `log`) et `balance` (−1…1). Égalisée = histogramme de 1024 classes des cases hors de l'eau, t = part cumulée du terrain : une carte surtout basse n'est plus d'une seule couleur. Balance : t^(2^(−2·b)). La légende affiche les altitudes à 0, ¼, ½, ¾ et 1 de la rampe (`reliefTicks`, bissection sur l'échelle).
- **Barre du haut** : choix du run, ◐ Image, ⚙ Carte, ⤓ Exporter (en plein écran : flottants en haut au centre). ⟲/⟳ 15° et « Droit » supprimés.
- **Bulle en bas à droite** (aussi en plein écran) : −/+, zoom, Ajuster, ⟳ 90° (cale sur l'angle droit suivant, l'angle courant affiché s'il n'est pas nul), plein écran, X/Y du curseur, « ? » portant l'aide. La fiche d'objet passe en haut à droite.
- **Infos image** (taille, m/px, zoom ; sans ortho : taille de la carte en km) en pied du panneau des calques.
- **Ajuster** : cadre les bornes de la carte (heightmap du run ou `app.map.bounds`) dans l'image, plus l'image entière (marges de capture) ; marges réelles (largeur du panneau, bulle) ; sur l'ortho, le niveau de pyramide plus fin est pris s'il ne rogne pas plus de 10 % (`nearest`).

### HQ-033 — GridLab et TileLab réunis, modes de capture
- **Date :** 2026-10-26 · **Statut :** accepted (check, 105 tests et build OK ; NOT TESTED dans l'app ni en jeu)
- **Un seul onglet GridLab**, avec une bascule **Grille / Captures** (`state/lab.svelte.ts` : vue, capture choisie, son plan, interpolation et demi-résolution). L'onglet TileLab est supprimé ; sa vue de droite devient `ui/CaptureTiles.svelte` (liste des captures, vignettes, historique), gardée montée. GridLab est désormais gardé monté lui aussi (état de l'ortho, vignettes). Lancer l'ortho et les étapes 3–4 du bandeau ouvrent la vue Captures.
- **Panneau** : état, **mode**, résumé toujours visible (session = nom de la capture choisie, images, taille, temps total = capture + ortho), « Réglages avancés » repliable (résolution, caméra, grille, éclairage, ortho, détails), pied avec « Écrire dans le mod » puis « Calculer l'ortho ».
- **Modes** (`core/modes.ts`) : ≈ 1 / 4 / 16 / 64 images. Grille `nX = round(√(n·a/m))` (a = W/H des captures, m = carte Y / X), puis FOV le plus étroit qui couvre depuis **12 000 m** (au-delà, voile flou en jeu, OBSERVED par l'utilisateur) ; si 10° couvre déjà, altitude la plus basse qui couvre ; une rangée / colonne de plus si rien ne couvre. Soleil : jour 171, heure la plus proche de midi sans reflet (zénith ≥ champ de vue + 10°). Recalculé quand la carte ou la résolution changent, pour toutes les résolutions (balayage testé : 17 résolutions × 7 tailles de carte, toujours couvert). **Modes toujours distincts** : chaque mode vise au moins le double des images du précédent (sur une grande carte, le plafond d'altitude impose plus d'images ; ex. 32 km en 16:9 : 6 / 10 / 18 / 66). Exemple (carte de test, 21:9) : 1×1 FOV 62,5° · 3×1 28,5° · 6×3 12° · 12×5 10° à 7 200 m.
- `MosaicConfig.MODE` (défaut x16). Une config enregistrée avant les modes passe en `custom` (rien n'est recalculé : la grille réglée à la main est gardée). Les réglages de résolution et d'ortho ne font pas passer en personnalisé.
- **Onglet au démarrage** : GridLab au premier lancement (`hq.launched`), puis toujours le Visualiseur (Options si le dossier du jeu manque).

### HQ-034 — Modes instantanés, ortho automatique, ouverture du Visualiseur
- **Date :** 2026-10-26 · **Statut :** accepted (check, tests et build OK ; NOT TESTED dans l'app ni en jeu)
- **Latence des modes** : la chaîne des quatre modes (≈ 150 ms) était recalculée deux fois par clic sur le fil principal. Désormais `modeConfigs` résout les quatre en une passe, mis en cache dans GridLab (clé : heightmap + `modeKey` : résolution, échelles, marge, latitude), calculé à l'avance dans un `setTimeout(0)` quand la carte ou la résolution arrive ; un clic lit le cache.
- **Ortho automatique** (`state/autoOrtho.ts` `shouldAutoOrtho`, `lab.follow()`) : une capture vue en cours dans la session est choisie et montrée (GridLab › Captures, l'app y bascule) ; une fois terminée, complète, sans erreur ni format incompatible et son plan lu, son ortho démarre seule (une fois : un échec n'est pas relancé en boucle). Les anciennes captures ne déclenchent rien.
- **Fin d'ortho** : `orthoJob.start(…, onEnd)` ; un résultat `done` ouvre le Visualiseur sur cette carte. Annulation ou erreur : GridLab garde le message et propose « Relancer l'ortho ».
- **Plus de bouton « Calculer l'ortho »** ; seul recours manuel : relancer après un échec, ou calculer une ancienne capture sans ortho choisie dans la vue Captures. L'étape 4 du bandeau n'est plus « à faire ».
- **Suite (HQ-034)** : la vue Grille se cadre seulement quand elle a une taille (GridLab est monté caché au démarrage sur le Visualiseur : le cadrage à 0 px la laissait au dézoom maximal). Panneaux de gauche de GridLab et du Visualiseur redimensionnables (`ui/PanelResizer.svelte`, largeur mémorisée, double-clic = défaut). La résolution du jeu sort des réglages avancés (au-dessus du mode). Le résumé n'affiche que le temps total.

### HQ-035 — Cadrages, fond de carte, dépôt privé, résolution mémorisée, « Programmer le scan »
- **Date :** 2026-10-26 · **Statut :** accepted (check, tests et build OK ; NOT TESTED dans l'app)
- **Ajuster (Visualiser)** : le vide autour venait des niveaux de pyramide (facteur 2). Plus dézoomé que la pleine résolution, la vue a des paliers de 2^(1/8) ; à partir de la pleine résolution, les niveaux exacts (pixels nets) et ×2/×4/×8. `fitMap` prend le palier le plus fin qui montre toute la carte (≈ 9 % de marge au plus). La molette et les boutons −/+ zooment toujours par ×2 (molette gérée à la main : `adjustResolution` puis calage sur un palier à l'arrêt), sinon les paliers fins rendaient le zoom 8 fois plus lent au dézoom.
- **Vue Captures** : la grille de vignettes tient en largeur et en hauteur (cadrée comme un « Ajuster »).
- **Fond de carte** : `FilterState.basemap` (calque « Fond de carte » du panneau, quand une ortho est affichée). Désactivé ou sans ortho : fond noir, eau en bleu (`waterMask`, image 28 %) détourée (`shorelines` : courbe à `waterLevel` + 0,5 m), contour de carte continu (`ui/viewer/basemap.ts`). L'export PNG prend le fond noir.
- **Mises à jour** : le dépôt `Spit8/HQminiMap` est privé (voulu) ; l'API et `latest.json` répondent 404. Nouveau code `notFound` (« aucune version publique, dépôt privé ? ») au lieu de « GitHub injoignable ». La vérification ne peut pas aboutir tant que les releases ne sont pas publiques.
- **Résolution** : `MosaicConfig.SCREEN_DETECTED { w, h, at }` enregistré à chaque détection ; sans capture lisible, la dernière détection est gardée (« Détectée le … ») et l'avertissement n'apparaît que si rien n'a jamais été détecté. Le mod n'appelle aucune fonction du jeu pour la taille d'écran (seulement `takeScreenshot(1)`) ; la détection lit l'en-tête PNG des captures d'écran / tuiles.
- **Panneau GridLab** : en-tête en deux lignes (carte, scan programmé / capturé / à reprogrammer), résolution, mode, résumé ; « Détails » dépliable (réglages choisis par le mode + tableau de résultat) ; « Réglages avancés » seulement modifiables. « Écrire dans le mod » devient **« Programmer le scan »** (toujours ce libellé, même pour reprogrammer).
- **Suite (HQ-035)** :
  - **Eau** : seules les cases à exactement `waterLevel` sont de l'eau (le mod ne relève au niveau de l'eau que les cases que le jeu dit sur l'eau ; un sol sec plus bas garde sa hauteur), et les flaques de moins de 6 cases sont ignorées (`waterCells`). Les rivages sont le contour de ces cases ; le relief en couleurs n'est transparent que sur elles. Les petits ronds bleus venaient du sol sec sous le niveau de l'eau.
  - **Molette sans rebond** : chaque cran va directement à un palier (×2, `getConstrainedResolution` vers le sens du zoom, borné par la vue), animé ; un pavé tactile cumule ses petits déplacements jusqu'à un palier.
  - **Bulles d'outils** (haut en plein écran, vue en bas à droite) : même style et même comportement ; épingle 📌 par bulle (mémorisée, `hq.viewerPins`, bas épinglée par défaut) ; non épinglée, elle s'estompe 2,5 s après le dernier mouvement de souris sur la carte. « Ajuster » laisse la place aux deux (hauteurs mesurées).
  - **Lacs fantômes près des usines** (analyse de la vraie carte) : `waterLevel` = 0 ; les mines et carrières creusent le terrain jusqu'à −10 m et le jeu y répond `isOnWater` = vrai (grille grossière de `map.lua`), alors qu'aucune eau n'est dessinée. Règles : (1) le mod exporte désormais le drapeau du jeu par case fine (`heightmap.lua` `waterRows`, `isOnWater` testé seulement là où le sol est au niveau de l'eau ou en dessous ; nouvel export de carte nécessaire) ; (2) sinon, une flaque doit contenir une case d'eau de la grille grossière (`parseWaterGrid`, reprise pour la heightmap d'un run de même emprise) ; (3) une flaque de moins de 60 cases à moins de 300 m d'une industrie est une fosse, pas de l'eau. Résultat sur la carte réelle : 47 → 5 étendues d'eau (la mer et 4 lacs).

### HQ-036 — Rues en couloirs, « Scanner » dans le jeu
- **Date :** 2026-10-26 · **Statut :** accepted (check, 122 tests, build, sim_mod et sim_live OK ; NOT TESTED en jeu ni dans l'app)
- **Rues (route, tram)** : `edgeStrokes` donne **une voie par ligne et par sens** (`EdgeStroke.lane`, décalage en largeurs de voie à droite du sens de marche) : dans les deux sens, les lignes de chaque sens côte à côte depuis le milieu (la plus fréquentée au centre) ; à sens unique, les voies centrées. Plus de pointillés dans les rues. Largeur de voie = trait + 3 px. Le rail garde un trait centré par voie (les doubles voies sont des arêtes distinctes), en pointillés alternés quand plusieurs lignes le partagent.
- **Mod** : le bouton « Capturer » devient **« Scanner »** (« Scan » en anglais), et les états en jeu parlent de scan (« Scan 3/18 », « Nouveau scan prêt… »). Textes de l'app et README qui renvoient à ce bouton mis à jour.

### HQ-037 — Voies continues par ligne, nombre de voies des rues, rayures conservées
- **Date :** 2026-10-26 · **Statut :** accepted (check, tests, build et sim_live OK ; NOT TESTED en jeu ni dans l'app) — **remplace** les traits par arête de HQ-026 / HQ-036.
- **Cassures (HQ-036)** : chaque arête ordonnait seule ses voies et était dessinée à part ; une ligne changeait de voie d'une arête à l'autre et les morceaux décalés ne se rejoignaient pas.
- **Mod (FORMAT 9)** : voies de circulation par sens de chaque rue (`streetLanes`) : `BASE_EDGE_STREET.streetType` → `api.res.streetTypeRep.get(...).laneConfigs` (sans trottoirs : première et dernière ; `forward == false` = à contresens), sinon voies `TRANSPORT_NETWORK` ouvertes au bus partagées par moitié. Ajoutées aux arêtes de `live_routes` (`…,f,b`). **API non vérifiées dans TF3** : diagnostic `live_status.routes.streetLanes` (`rep`, `network`, `unknown`, 3 exemples bruts) à lire au premier test en jeu.
- **App** (`core/routes.ts` `laneLayout`) : ordre global des lignes (trafic, id) ; par arête de rue et par sens, `S` voies (inconnu : 1) ; au-delà, partage en tourniquet, en **rayures** ; double sens : voie j à j + ½ à droite du sens de marche ; sens unique : voies centrées. Rail : voie centrée par arête, rayures entre lignes. Chaque ligne = tracés continus (arêtes chaînées dans le sens de marche), passage d'une voie à l'autre en rampe de 15 m aux nœuds (décalage par sommet, `offsetLine` à décalage variable) ; un demi-tour reste un seul tracé. Morceaux découpés là où le partage change, pour aligner les rayures.
- **Premier test en jeu (HQ-037)** : `streetLanes` = `{ rep 0, network 0, unknown 1622 }` : aucune des deux lectures ne répond. Le mod enregistre maintenant, pour les 3 premières arêtes sans résultat, ce que chaque étape renvoie (`streetType`, type de `get`, `getName`, `laneConfigs` et sa longueur — `#`, `:size()` ou comptage —, `tn.edges`, `BUS`, premiers `transportModes`) dans `streetLanes.samples`. Correctif au passage : `field()` renvoyait nil pour une valeur `false` (`ok and x or nil`), donc `forward = false` aurait été lu comme « dans le sens ». En attendant : 1 voie par sens (rayures).
- **Ortho non faite après la capture (15 h 05)** : `pyramid.tmp` vide, aucun message, aucune ortho en cours : l'ortho a été interrompue sans que l'app garde trace (rechargement ou fermeture de l'app très probable). L'ortho automatique **reprend** désormais la dernière capture complète de moins de 2 h sans ortho, même non vue en cours dans la session (`RESUME_MS`). Le bandeau marque l'étape 4 « à faire » (« Ortho pas encore calculée ») au lieu de la laisser neutre.
- **Voies : au moins 2 par sens** (`MIN_LANES`), le nombre réel n'étant pas lisible pour l'instant.
- **Tracés vraiment continus** : chaque ligne est d'abord assemblée en un seul tracé (arêtes + ses propres morceaux : voies de gare, ponts, qui prennent la voie de leur voisin au lieu d'être dessinés au centre), puis ses **normales sont calculées sur tout le tracé** (`mitredNormals`, en onglet borné dans les virages) et seulement ensuite il est découpé là où le partage de voie change. Les morceaux partagent leurs extrémités, leurs normales et leurs décalages : plus de cassure aux virages ni aux changements de voie. Avant, chaque morceau calculait ses normales seul (cassure à chaque jonction) et les morceaux propres restaient centrés.
- **Fragmentation mesurée sur les vraies lignes** : une ligne de bus de 144 arêtes donnait ~30 tracés séparés. Les arêtes du réseau seules ont ~25 extrémités sans suite (détours, trajets partiels relevés) et les morceaux propres (voies de station, de carrefour) sont posés sur les voies, à quelques mètres de l'axe. Corrections : jonction des extrémités à moins de **12 m** (grille spatiale), morceaux propres retournables, au carrefour le prolongement **le plus droit** gagne ; un embranchement emprunte les **12 derniers mètres** du tracé qu'il quitte (`withStubs`) et en sort par la rampe habituelle. Vérifié par un rendu hors app des vraies lignes (zone la plus dense) : tracés continus, virages et bifurcations sans cassure.
- **Version 3 (retours : pointillés « vides », cassures, changements de voie sans raison)** :
  - **Voies attribuées ligne par ligne en suivant son tracé**, de la plus fréquentée à la moins fréquentée : une ligne garde la voie de l'arête précédente si elle y est libre, sinon prend la première libre ; elle ne partage une voie (rayures) que si toutes sont prises. Avant, l'ordre était recalculé arête par arête : une ligne changeait de voie dès qu'une autre entrait ou sortait.
  - **Rayures sans vide** : le nombre de lignes d'une voie partagée est compté sur les vrais occupants de cette voie sur cette arête ; un morceau partagé couvre exactement une arête, depuis son premier nœud, pour toutes ses lignes (rayures alignées). Les morceaux propres (voies de station) sont dessinés pleins.
  - **Jonctions** (`LaneJoint`) : là où les données laissent une ligne en plusieurs tracés (embranchements, détours, trous jusqu'à 40 m), une courbe de Bézier relie la fin d'un tracé, dans sa voie, au point le plus proche d'un autre tracé de la ligne. Remplace l'emprunt de 12 m (`withStubs`), qui doublait les rayures.
  - Vérifié sur un rendu hors app des vraies lignes de bus.

### HQ-038 — Conduite à droite, sens de marche corrigé par le tracé
- **Date :** 2026-10-26 · **Statut :** accepted (check, 126 tests, build et sim_live OK ; NOT TESTED en jeu ni dans l'app)
- **Pas d'option de conduite à gauche dans TF3** (vérifié dans le jeu installé : `settings.lua`, API `api/tealdef`, textes fr/en de l'interface). Règle fixe : **conduite à droite**, voies à droite du sens de marche. L'API décrit les voies d'un type de rue (`LaneConfig.forward`, `offset`) : de quoi confirmer le côté plus tard si la sonde des voies les lit.
- **Cause des « inversions » (mod)** : `walkPath` lisait le sens d'une étape par `e[2]` seulement. Il lit maintenant `e[2]`, sinon le champ `.dir` (objet `EdgeIdDir`), chaque accès sous `pcall`, sinon « dans le sens ». Diagnostic `live_status.routes.dirs` = `{ pair, field, none }` : à lire en jeu pour savoir comment le pathfinding (`findPathNodeToNode`, typé `{{EdgeId, boolean}}`) rend le sens. `sim_live` : une étape de pathfinding `{ edgeId, dir = false }` sort en `-708`.
- **App** (`chainSegs`) : en double sens, une arête du réseau n'est retournée que si rien ne suit dans son sens enregistré (`flip`) ; elle prend alors la voie de l'autre sens (clé `arête|−sens`). Un tracé fait surtout d'arêtes retournées est retourné en entier (il était parti d'une arête mal orientée). Un aller-retour dans la même rue garde ses deux côtés.
- **Jonctions** : d'abord vers le **début** (ou la fin) d'un autre tracé de la ligne, sinon un point au milieu ; seulement si les sens de marche s'accordent (écart ≤ ~100°, pas de demi-tour à travers la rue) ; aucune si les deux bouts se confondent déjà (même point, même décalage) ; poignées de Bézier raccourcies quand un bout part à l'opposé de l'autre (plus de boucles).
- **Mesuré sur les vraies lignes** (rendu hors app) : tracés séparés 679 → 148, jonctions 684 → 64.
- **Retours (pointillés imprécis, 4 traits parallèles)** :
  - **Une seule voie par sens** (fin de `MIN_LANES` = 2) : un trait par sens de circulation, partagé en rayures entre toutes les lignes qui passent ; sens unique : un trait centré. Le nombre de voies lu dans le jeu ne sert plus qu'à reconnaître les sens uniques.
  - **Rayures mesurées le long de l'arête** (`LanePiece.arc`, `stripes()` dans `layers.ts`, géométrie `MultiLineString` en cache par résolution) au lieu de `lineDash` sur le trait décalé : chaque ligne commençait son motif au début de son propre morceau (raccord jusqu'à 12 m, angle du virage d'avant), d'où des pointillés superposés puis un vide.
  - **Bug** : un morceau partagé débordait d'un point sur l'arête suivante (`piecesOf` coupait à `q` au lieu de `q − 1`) ; il s'arrête maintenant sur le nœud.

### HQ-039 — Rives lissées, traversées des bateaux moyennées
- **Date :** 2026-10-26 · **Statut :** accepted (check, tests, build et sim_live OK ; NOT TESTED en jeu ni dans l'app)
- **Rives (fond uni)** : `shorelines` adoucit le champ eau / terre (−1 / +1) d'un flou 3 × 3 (`blur`, une passe : deux effaceraient les plus petits lacs, 6 cases) avant de tracer son contour 0, puis simplifie plus (0,35 case) et lisse en 3 passes de Chaikin (`contourLines` prend ces réglages en option ; les courbes de niveau gardent 0,15 et 1 passe). Vérifié sur la vraie carte : plus d'escaliers. Le remplissage de l'eau reste en cases.
- **Bateaux (et avions)** : le mod garde par ligne les **3 derniers trajets** de chaque traversée libre (`path1` ; mêmes extrémités à 150 m près = même traversée ; un trajet revu à chaque passe compte une fois) et exporte leur **moyenne** (rééchantillonnés au même nombre de points le long du trajet), au lieu du dernier trajet sous une clé arrondie à 50 m (qui en multipliait les variantes). `sim_live` : trajets à x = 0, 60, −60, 90 → 30 puis 30.
- **Retour : un seul tracé par traversée** : l'aller et le retour d'une même traversée (extrémités à 150 m près, dans un sens ou dans l'autre) sont désormais **la même traversée** ; un trajet retour est retourné avant d'entrer dans la moyenne des 3 derniers. Un bac A ↔ B a donc un seul tracé, remoyenné à chaque nouveau trajet (avant : un tracé par sens). Données réelles de 15 h 05 (ancien mod) : 2 à 3 tracés libres par ligne de bateaux. `sim_live` : retour 500 → 0 à x = 120 → un seul tracé, x = 50.

### HQ-040 — GridLab épuré, en-tête compact, bulles du plein écran, réglages d'image par ortho
- **Date :** 2026-10-26 · **Statut :** accepted (check, tests, build OK ; NOT TESTED dans l'app)
- **GridLab** : le résumé ne montre plus que le nombre d'images, la taille du fichier et le temps (plus de grille, de m/px ni de taille en pixels) ; ces chiffres restent dans « Détails », où la résolution est désormais celle de l'ortho (demi-résolution comprise).
- **En-tête** : « ● Carte L × H km », puis en petit dessous « exportée le … » (gris) et « Scan programmé : X×X » dans sa couleur (vert, orange si réglages changés, gris si pas programmé), « · capturé » à la suite.
- **Plein écran** : une bulle d'outils non épinglée est masquée (opacité 0) et réapparaît au survol (marge invisible de 28 px autour pour la retrouver) ou quand un de ses menus a le focus ; épinglée, toujours visible. Hors plein écran : fondu à 25 % comme avant.
- **Réglages d'image** : ils sont enregistrés avec l'ortho pour laquelle ils ont été faits (`pyramid.json` `createdAt`) ; une nouvelle ortho (même run recalculé) repart en **auto**, même après des réglages manuels. Le magasin des réglages est maintenant réactif (`$state`) : avant, le mode « manuel / auto » lu au chargement d'un fond restait celui du démarrage de l'app. Les anciens réglages enregistrés (sans ortho) repassent tous en auto une fois.

### HQ-041 — Le scan se lance depuis l'app (plus de bouton « Scanner » dans le jeu)
- **Date :** 2026-10-26 · **Statut :** accepted (check, tests, build, sim_mod fr/en/--short et sim_live OK ; NOT TESTED en jeu)
- **App** : le bouton de GridLab devient **« Scanner »** : il écrit la grille (cutscene + `capture_plan`) puis envoie la commande `{ action = "scan" }` par `live_request` (même canal que téléporter / focus) et attend la réponse du mod dans `live_status.cmd` (`live.scan()`, 12 s). Messages : lancé ; pas de réponse → « Le jeu ne répond pas : lance TF3 avec ta partie (mod activé) » ; `busy` → scan déjà en cours ; mod plus ancien (`unknown action`) → recharger la partie ; mod absent du dossier → message existant. Le bouton n'est plus bloqué par une capture « en cours » (une capture interrompue par la fermeture du jeu ne finit jamais).
- **Mod** : `runCommand` action `scan` → `capture.start()` (refus si déjà en cours). Le scan est maintenant entraîné par la **pompe du bouton du mod** (toujours affiché) en plus des données live : il tourne fenêtre fermée ; fermer la fenêtre n'interrompt plus le scan (sauf si la pompe du bouton ne tourne pas). Bouton « Scanner » retiré de la fenêtre (`hqminimap.tfui.json`, régénéré) et `handlers.onCapture` supprimé ; textes du mod mis à jour (« Scanner » dans l'app). Il ne reste dans le jeu que « Exporter la carte ».
- `sim_mod.py` lance la capture par la commande de l'app, pompe du bouton seule (fenêtre fermée), et vérifie la réponse `live_status.cmd`.

### HQ-042 — Check de compatibilité global (résolutions, cartes, lignes, fichiers du joueur)
- **Date :** 2026-10-26 · **Statut :** accepted (check, 132 tests, build, sim_mod 60/144/240 fps + `--short` + en, sim_live OK ; NOT TESTED en jeu)
- **Vérifié OK** (lecture du code + API `E:\Transport Fever 3\api\tealdef`) : géométrie sans format figé (32:9, portrait, 4K/8K, tailles impaires ; tests sur cartes 4-32 km et non carrées) ; export de carte à coût fixe, pyramide en flux ; tous les transporteurs du jeu (route, rail, tram, air dont hélicos et zeppelins, eau, autre) ; sauvegardes, autres mods et cutscenes du jeu jamais touchés (nos cutscenes sont dans le dossier du mod, seuls nos `mosaic_run_p*.lua` sont effacés) ; noms des captures choisis par le jeu (jamais écrasés).
- **Fichiers du joueur** (`core/tiles.ts` `matchShots` → `certainty`, `state/runs.svelte.ts`) : une capture n'est **déplacée** hors de `screenshots/` que si aucune autre image ne partage sa fenêtre de temps (`sure`) ; sinon, après la fin du scan, **copiée seulement** (les deux fichiers restent) ; image encore en écriture dans la fenêtre → attendre. Égalité de seconde : le fichier dont le compteur `img_N` suit la tuile précédente. Captures réglées mémorisées sur disque (`<UD>/hqminimap/runs_done.json`, en plus du stockage du navigateur) ; jamais de recréation d'un run de plus de 2 h ; plus de recherche 10 min après la fin d'un scan. PNG seulement (l'ortho ne lit que le PNG).
- **Mod, délais en secondes** (`capture.lua`) : les attentes comptaient des images à 60 fps (à 144 fps, scan de plus de ~25 s → « timeout »). Maintenant horloge murale (`io_util.nowUnix`, secondes entières ; repli : images/60) : stabilisation, démarrage de la cutscene (3 s), durée max par passe (durée + 10 s, 60 s au moins). `sim_mod.py --fps N`.
- **Résolution donnée par le jeu** : le mod écrit la taille de la vue (`api.gui.camera.getSize()`) dans `live_status.screen`, et le statut est désormais écrit toutes les 10 s même données live coupées. GridLab la suit automatiquement (« Donnée par le jeu. ») ; repli : dernière capture **nommée par le jeu** ; sinon, en auto, scan bloqué (« Résolution du jeu inconnue… »). **À vérifier en jeu** : que `getSize` = taille réelle des captures (mise à l'échelle Windows). Solution de secours (idée utilisateur) si faux : commande sonde (capture prise par le mod, lue puis supprimée par l'app si seul fichier nouveau).
- **Forme des captures** (`png.ts` `sameAspect(réel, plan)`) : refus si plus étroites que prévu au-delà de 0,1 % (trous aux raccords), acceptées jusqu'à 1 % plus larges. Même forme, autre taille : le m/px de l'ortho suit les vrais pixels (`CaptureTiles` ajuste `gsdX/gsdY`). Chaque tuile vérifiée au décodage par le worker de l'ortho (`resolutionMismatch`).
- **Lignes** (mod) : mode d'une ligne sans véhicule tiré de `LINE.vehicleInfo.transportModes` (table indexée par mode, ou vecteur 0/1 indice mode + 1 ; exemple brut dans `live_status.lineModes.sample` si rien n'est trouvé) ; pathfinding sur les modes de **tous** les véhicules (lignes mixtes) ; tram : + `TRAM_TRACK`, `ELECTRIC_TRAM_TRACK`. Diagnostic `live_status.lineModes` = `{ vehicles, line, none }`. `sim_live` : ligne rail sans véhicule → `rail`, tracé `-708`.
- **App** : mode inconnu → « autre » (`parseLive`) ; trace d'un véhicule passé sur une autre ligne retirée de l'ancienne ; pas de remplissage par les traces pour bateaux et avions.
- **Laissé de côté** : mémoire de l'ortho en 8K portrait, demi-résolution automatique des très grosses orthos, heightmap non carrée pour cartes très allongées, plafond de grille 200, export PNG ×4 très large, waypoints des lignes, étalement du pathfinding, véhicules sans ligne (dépôt), icône hélicoptère, droits fichiers larges de l'app (`$HOME/**`), test en jeu à 32:9 et en portrait.

### HQ-043 — Scans qui se relancent seuls, captures laissées dans screenshots, scan ×10 (essai)
- **Date :** 2026-10-26 · **Statut :** accepted (check, 132 tests, build, sim_mod, sim_live OK ; NOT TESTED en jeu)
- **Scans relancés en boucle (OBSERVED : 5 scans en quelques minutes)** : la commande `scan` restait dans `live_request.lua` (l'app y gardait la dernière commande) et le mod, qui repart à `lastCmdSeq = 0` à chaque rechargement (partie, module), la rejouait. Corrigé des deux côtés : l'app horodate chaque commande (`at`, unix s) et la **retire du fichier** dès la réponse ou l'abandon ; le mod ne lance une commande que si elle a moins de 60 s (`CMD_MAX_AGE_SEC`) et refuse tout `scan` non horodaté (fichiers d'anciennes versions) → réponse `stale`. `sim_mod.py` vérifie les deux refus.
- **Captures « sur le carreau »** (retour utilisateur : personne ne prend de capture pendant un scan) : la règle « copie seule si ambiguïté » (HQ-042) est retirée ; toute image appariée dans la plage de temps du scan est déplacée. Une fois le scan fini et toutes les tuiles prises, les images restantes de cette plage (doublons du jeu) vont dans `runs/<id>/extras/` au lieu de rester dans `screenshots/`. Les captures du joueur hors de la plage du scan ne sont jamais candidates. La collecte continue jusqu'au réglage de la capture (10 min après sa fin).
- **Scan ×10 (essai temporaire, à retirer ou valider)** : GridLab écrit 0,1 s par tuile (prise à 0,04 s) au lieu de 1 s (`SCAN_SPEED_TEST` dans `GridLab.svelte`). Le cœur accepte des segments jusqu'à 0,05 s (`MIN_SEG_DUR`) en réduisant transit et marges de maintien sous 0,25 s (`transitOf`, `holdEpsOf` ; inchangés au-dessus, sorties de référence identiques). Simulation OK à 30, 60 et 144 fps ; en jeu, à faible fps, une prise peut tomber pendant le déplacement ou une tuile être sautée (erreur « la cutscene ne correspond pas »).
- **Ligne sans véhicule (OBSERVED : `lineModes.sample = "table#15 … tous false"`)** : le vecteur des modes de la ligne a 15 entrées et était lu à l'indice du mode (au lieu de mode + 1) ; il est de toute façon vide pour une ligne sans véhicule. Correction de l'indice, et repli sur le type de la gare du premier arrêt (nom de fichier de sa construction, `fileMode`). Le diagnostic garde un exemple brut (+ fichier de l'arrêt) si rien n'est trouvé.
- **Résolution donnée par le jeu : VERIFIED en jeu** (`live_status.screen` = 2560 × 1080, la résolution du joueur).

### HQ-044 — Cadence du scan : 1,25 s par image
- **Date :** 2026-10-26 · **Statut :** accepted (tests, build, sim_mod OK ; NOT TESTED en jeu)
- L'essai ×10 (HQ-043, 0,1 s par image) : **OBSERVED en jeu**, le jeu saute des images. Retiré (`SCAN_SPEED_TEST` supprimé de GridLab).
- Cadence par défaut ralentie de 25 % par rapport à la référence validée : **1,25 s par image**, prise à **0,3125 s** dans le maintien (`plan.ts` `SEG_DUR`, `SHOT_OFFSET` ; mêmes valeurs par défaut côté mod dans `capture.lua`). Les minuteries suivent : durée estimée du scan dans GridLab (`captureDurationSec`), attente max du mod (calculée depuis la cadence écrite dans le plan). Les tests de concordance avec le générateur de référence tournent à la cadence de référence (1 s, `REF_TIMING`).
- Le support des segments courts (`transitOf`, `holdEpsOf`, `MIN_SEG_DUR` = 0,05 s) reste, sans effet à cette cadence.

### HQ-045 — Captures associées par le compteur du jeu
- **Date :** 2026-10-26 · **Statut :** accepted (check, 133 tests, build ; NOT TESTED dans l'app)
- **OBSERVED** (scan 1793041169, 60 prises de vue, 60 fichiers écrits) : 59 tuiles rangées, `tile_p01_001` manquante et `…19-59-43_img_26.png` laissée dans `screenshots/` (« 1 capture n'appartient pas à la mosaïque »). Le jeu n'avait rien sauté : l'association par l'heure a dérivé (PNG de 5 Mo écrits de plus en plus tard) et décalé d'un cran toutes les tuiles suivantes. Les 2 autres fichiers restés venaient des scans ×10 ratés (19:53).
- **Correctif** (`core/tiles.ts` `counterBase`, `matchByCounter` ; `state/runs.svelte.ts`) : le jeu numérote ses captures (`img_N`, +1 à chaque) et personne n'en prend pendant un scan ; la tuile k est donc l'image `base + k`, `base` = plus petit compteur des images écrites depuis le début du scan jusqu'à 6 s après la première prise (trouvé une fois, gardé dans `run.json` `counterBase`). Contrôle : l'image doit dater d'une seconde avant à 6 s après sa prise (`COUNTER_MAX_LAG_SEC`). L'association par l'heure ne sert plus que si les noms n'ont pas de compteur.
- **Fin de scan, réussi ou non** : 6 s après la fin, les images restantes de la plage du scan (du début à la fin + 6 s) vont dans `runs/<id>/extras/`.
- Le scan 1793041169 a ses tuiles 1-60 décalées (à refaire) ; les 3 fichiers déjà laissés dans `screenshots/` ne sont plus traités (captures réglées) : à supprimer à la main.

### HQ-046 — Nouvel essai ×10 avec l'association par compteur
- **Date :** 2026-10-26 · **Statut :** essai temporaire (NOT TESTED en jeu)
- Après HQ-045 (images associées par le compteur du jeu), nouvel essai à 10× la cadence par défaut : 0,125 s par tuile, prise à 0,05 s (`SCAN_SPEED_TEST` dans `GridLab.svelte`, à retirer après l'essai). Maintien immobile de 0,006 à 0,094 s dans chaque segment. But : savoir si les « sauts » de l'essai HQ-043 venaient du jeu ou de l'ancienne association par l'heure.
- **Résultat (OBSERVED par l'utilisateur)** : à ×10, le jeu saute toujours des images, même avec l'association par compteur. La cadence compte vraiment : retour à **1,25 s par image** (HQ-044), essai retiré.

### HQ-047 — Contrôleur de performance et passe d'optimisation
- **Date :** 2026-10-26 · **Statut :** accepted (check, 136 tests, build ; NOT TESTED dans l'app)
- **Constat** (audit sur les vraies données : 109 lignes, 402 véhicules, 3 126 arêtes, 199 gares) : le coût venait surtout de **tout reconstruire toutes les ~2 s** (tous les objets de la carte, la disposition des voies, leurs géométries en cache), même Visualiseur caché, et d'une animation à ~30 images/s créant de nouveaux styles pour chaque véhicule à chaque image.
- **Contrôleur** (`core/perf.ts`, `state/perf.svelte.ts`) : mesure toutes les 5 s et après chaque mise à jour de la carte la mémoire JS (`performance.memory`, WebView2), les objets affichés (`liveLayers.count()`) et la durée de la mise à jour. Niveaux `ok` / `busy` (mémoire > 60 %, > 25 000 objets ou > 150 ms) / `critical` (> 80 %, > 50 000, > 400 ms), descente à 80 % des seuils (hystérésis). Plafonds (`PERF_CAPS`) : `busy` = lignes en trait simple (pas de voies, rayures, raccords), traces à moitié, pas de remplissage ; `critical` = en plus sans étiquettes de véhicules et de lignes, 40 lignes tracées au plus (les autres entre arrêts), cache de tuiles d'ortho 128 au lieu de 512. Bandeau dans le Visualiseur (fermable, revient au niveau supérieur) ; carte « Performance » dans Options (état, mémoire, objets, durées).
- **Carte** (`layers.ts` `update`) : chaque groupe (villes, industries, entrepôts, gares, lignes + voies, véhicules) n'est reconstruit que si ses entrées ont changé (comparaison élément par élément) ; véhicules mis à jour **sur place** (mêmes objets, ajout/retrait des seuls nouveaux/disparus) ; disposition des voies mémorisée (mêmes tracés, mêmes lignes et rangs) ; `clear(true)` ; double géométrie des lignes supprimée. Données du Visualiseur découpées par sorte (`allIndustries`, `allStations`, `allLines`) et listes live en `$state.raw` : les objets restent les mêmes tant que leur fichier ne change pas.
- **Visualiseur caché** (prop `active`) : ni mise à jour de la carte, ni animation, ni remplissages ; une seule mise à jour au retour.
- **Relevé des fichiers live** : les changements d'un même relevé sont appliqués ensemble (une mise à jour au lieu d'une par fichier) ; arêtes échantillonnées une seule fois (`buildRoutes(routes, sampled)`).
- **Styles des véhicules** partagés (cache par apparence, 4 000 au plus) ; caches d'icônes/styles/relief bornés.
- **Algorithmes** : raccords indexés par ligne + boîte englobante (`jointsOf`, avant en carré du nombre de tracés), passes linéaires dans `mitredNormals` et `piecesOf`, index spatial des tracés gardé tant que le tracé est le même (remplissages). Mesuré sur les vraies données : disposition des voies 35-90 ms (5 163 morceaux, 68 raccords), désormais seulement quand les tracés ou les lignes changent (~20 s) au lieu de toutes les 2 s.
- **Traces** : véhicules disparus et lignes supprimées retirés ; longueur rognée au plafond courant.
- **Fuites** : l'ancienne couche d'ortho est libérée (`dispose()` de la couche et de sa source : contexte WebGL et textures) ; `map.dispose()` et arrêt de l'animation au démontage.
- **Fichiers** : `capture_index.lua` n'est relu que s'il a changé (avant ~1,7 fois/s en permanence) ; pendant un scan, l'entrée du run est mise à jour sans relire toutes les sessions ; l'Historique ne recalcule la taille que des sessions changées (et d'un scan en cours seulement à la fin). GridLab : plus de réallocation du canevas ni de calcul de l'altitude min/max à chaque déplacement de souris.
- **Retour sur le Visualiseur (OBSERVED : véhicules « en accéléré »)** : les véhicules glissaient depuis leur position d'avant le masquage jusqu'à la position actuelle. Au retour, la première mise à jour les place directement où le jeu les a (`LiveOptions.snap`, glissements annulés) ; seule la carte est suspendue pendant le masquage, la lecture des données du jeu et les traces continuent.
