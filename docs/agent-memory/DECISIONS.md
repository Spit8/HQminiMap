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
