# Plan de corrections de bugs (à appliquer par Cursor)

## Context
Beaucoup de changements récents (scan lancé depuis l'app, association par compteur, contrôleur de performance, reconstruction de la carte par groupes, délais du mod en secondes…) n'ont pas été testés dans l'app ni en jeu. Une revue complète (app, mod Lua, interface/plateforme) a relevé les bugs ci-dessous, triés par gravité. Ce plan sera **copié dans le dépôt** (`docs/agent-memory/BUGFIX_PLAN.md`) pour que Cursor l'applique. Chaque point : fichier (fonction/ligne approximative), problème, correctif attendu. Conventions du projet : code et commentaires en anglais, textes UI fr + en (`app/src/lib/i18n/fr.ts`, `en.ts`, mêmes clés), décision consignée dans `docs/agent-memory/DECISIONS.md` (nouvelle entrée HQ-048), ne pas toucher `mod/content/gui/hqminimap_gui.script.lua` (généré par TFUI).

## Lot 1 — Critique (à faire en premier)

**A1. Options d'affichage sans effet jusqu'au prochain déplacement de carte** — `app/src/lib/ui/viewer/layers.ts` `update()`.
Depuis la reconstruction par groupes, changer `iconScale`, `textScale`, `lineWidth`, `lineOpacity`, `vehicleBadge` ou les étiquettes ne redessine pas les calques (seuls les véhicules ont `f.changed()`).
→ Garder les options précédentes ; si un champ de style diffère, appeler `layer.changed()` sur tous les calques de `layers`.

**A2. Boucle du contrôleur de performance (niveau qui oscille, carte figée)** — `app/src/lib/ui/Viewer.svelte` (effet de mise à jour), `app/src/lib/state/perf.svelte.ts`, `app/src/lib/core/perf.ts`.
L'effet lit `perf.caps` puis appelle `perf.report()` qui peut changer `perf.level` → l'effet se relance ; les plafonds réduisent les objets sous le seuil de sortie → ok → busy → … (`effect_update_depth_exceeded`).
→ Appeler `perf.report` hors de l'effet (`untrack` + `queueMicrotask`) ; ne pas compter la mise à jour qui suit un changement de niveau ; hystérésis temporelle : rester au moins 15 s à un niveau avant de redescendre (ajouter `since` dans `perfLevel` ou dans le state) ; test unitaire de non-oscillation.

**A3. Changer un réglage live fait tout relire et reconstruire** — `app/src/routes/+page.svelte` (`$effect(() => live.start(app.paths))`), `app/src/lib/state/live.svelte.ts` `start()`.
`start()` lit `settings` via `writeRequest` → l'effet dépend des réglages → `mtimes.clear()` à chaque changement.
→ `$effect(() => { const p = app.paths; untrack(() => live.start(p)); })` ; idem pour `runs.start`.

**A4. Le bouton de scan réécrit le plan d'un scan en cours** — `app/src/lib/ui/GridLab.svelte` `scan()` / bouton « Scanner la carte en jeu ».
→ Désactiver le bouton quand `capturing` (déjà calculé) ; idéalement envoyer d'abord la commande et n'écrire les fichiers que si le jeu n'est pas occupé (sinon message `grid.scanBusy`).

**A5. Des images d'avant le scan peuvent devenir la tuile 1** — `app/src/lib/state/runs.svelte.ts` `collectShots`, `app/src/lib/core/lua.ts` `parseCaptureIndex`.
Pendant la stabilisation, `shotTimes` est vide → branche « ancien mod » (`runShots`) qui copie tout PNG récent comme `tile_p01_001`, puis désactive l'association par compteur.
→ N'utiliser la branche ancien mod que si la clé `shotTimes` est **absente** de l'index (exposer `hasShotTimes`) ; si vide, ne rien faire.

**A6. Le mod reconstruit la heightmap complète plusieurs fois par minute** — `mod/content/hqminimap/live_export.lua` (appels `makeMapFromGame(true, …)` dans les jobs towns, industries, stocks, townAreas).
Le 1er argument est `withHeightmap`.
→ `makeMapFromGame(false, true, false, false)` (villes / zones) et `(false, false, true, false)` (industries / stocks) ; vérifier que `waterLevel` reste disponible pour `gameMapMeta` ; `tools/sim_live.py` : compter les appels avec heightmap.

**A7. Les données live tournent pendant un scan (saccades → images sautées)** — `mod/content/hqminimap/live_export.lua` `M.tick`, `mod/content/gui/hqminimap_gui.handlers.lua` `pump`.
→ Pendant `capture.isBusy()` : traiter commandes et statut seulement, ne lancer ni avancer aucun job.

**A8. Prise de vue hors du maintien / tuile sautée détectée seulement à la fin** — `mod/content/hqminimap/capture.lua` `step`.
→ Ne prendre la vue que si `elapsed <= t0 + segDur - transit - eps` (transit/eps = valeurs du plan `M.transit`, `M.holdEps`) ; si un segment est dépassé sans prise, arrêter tout de suite avec une erreur explicite « image sautée (tuile N) » (nouvelle clé i18n fr/en) au lieu d'attendre la fin.

**A9. La vitesse du calendrier du joueur est perdue après chaque scan** — `capture.lua` `lightingSnapshot` / `restoreLighting`.
→ Sauver la vitesse réelle (`GAME_SPEED` : `millisPerDay` et `speedup`) dans l'instantané et la restaurer.

**A10. Linux/Proton et dossiers choisis à la main : accès fichiers refusé** — `app/src-tauri/capabilities/default.json`, `app/src-tauri/tauri.conf.json`, `app/src/lib/ui/Settings.svelte` (`open({ directory: true })`).
→ `plugins.fs.requireLiteralLeadingDot: false` ; `recursive: true` dans les deux `open()` ; persister les autorisations (plugin `tauri-plugin-persisted-scope`) ou les réaccorder au démarrage via une commande Rust pour les dossiers enregistrés (données du jeu, mod, bibliothèques Steam détectées).

## Lot 2 — Important

**B1. Association par compteur fragile** — `app/src/lib/core/tiles.ts` `counterBase`, `matchByCounter`.
→ Fenêtre de la base à partir de `shotTimes[0] - 1` (pas `startedAt`) et vérifier que l'image de base date de [−1, +2] s de la première prise ; dans `matchByCounter`, ne garder que les fichiers de la plage du scan avant d'indexer par numéro (doublons de compteur après redémarrage du jeu). Tests dans `app/test/tiles.test.ts`.

**B2. Un seul échec de mise à jour bloque la lecture live** — `live.svelte.ts` `poll()`.
→ Chaque closure de `apply` dans son propre `try/catch` ; `busy = false` dans un `finally` ; en cas d'exception de parsing d'un fichier, oublier son `mtime` pour réessayer.

**B3. Fiches/textes de la carte dans l'ancienne langue, noms d'industries « — ? »** — `layers.ts` (dépendances des groupes).
→ Ajouter la langue courante (`i18n.locale`) aux dépendances des groupes gares, lignes, industries ; pour les industries, dépendre de toutes les villes (`live.towns`, à passer à `update`) et non des villes filtrées.

**B4. Véhicule passé sur la ligne sélectionnée invisible** — `layers.ts` (mise à jour sur place des véhicules).
→ Si `f.get("line") !== v.line` avant `setProperties`, appeler `refreshFront()`.

**B5. Groupe « lignes » reconstruit trop souvent** — `layers.ts`, `Viewer.svelte` (effet des remplissages).
→ Ne dépendre que des traces des lignes qui les utilisent ; lire `fills.size` sous `untrack` et ne réassigner `fills` que si le contenu change ; annuler `fillsTimer` quand masqué/désactivé et revérifier `active && perf.caps.fills` dans `computeFills` ; clé de la disposition des voies sans le trafic exact (ordre des lignes seulement).

**B6. Changement rapide de fond : mauvaise ortho affichée** — `Viewer.svelte` `show()`.
→ Jeton de séquence : après chaque `await`, abandonner si un autre fond a été demandé.

**B7. Ortho lancée avec une mauvaise résolution sol** — `app/src/lib/ui/CaptureTiles.svelte` `loadRun`, `app/src/lib/state/lab.svelte.ts`.
→ Calculer le plan ajusté (taille réelle des captures) avant d'assigner `lab.plan` et `planState = "ok"` ; ne pas lancer l'ortho auto avant la vérification de taille ; mémoriser `attempted` pour qu'une ortho annulée ne reparte pas seule après rechargement.

**B8. GridLab dit « scan envoyé » après un échec** — `GridLab.svelte` (encadré), `app/src/lib/ui/Steps.svelte`.
→ Mémoriser le résultat de la dernière demande de scan ; encadré « envoyé » et étape « Scan lancé » seulement après une réponse `ok`.

**B9. Résolution « donnée par le jeu » périmée** — `live.svelte.ts` (`statusAt`), `GridLab.svelte` (`gameScreen`).
→ `statusAt` = date de modification du fichier de statut (pas l'heure de lecture) ; horloge réactive (état mis à jour toutes les 5 s) pour l'expiration de 30 s ; ne réassigner `detected` que si la taille change.

**B10. Traces de bateaux tronquées ou effacées** — `live.svelte.ts` `recordTrails`, `saveTrailsSoon`.
→ Ne pas rogner tant que `lines` est vide ; calculer la liste des lignes à sauver au moment de l'écriture.

**B11. Mod : `finishJob` qui plante laisse le scan coincé** — `capture.lua` `finishJob`.
→ `job = nil` en premier ; restauration, index et statut chacun sous `pcall`.

**B12. Mod : `package` non protégé** — `mod/content/hqminimap/io_util.lua` `sep()`.
→ `pcall`, repli `"/"`.

**B13. Mod : `capture_index` réécrit à chaque prise + éclairage réappliqué à chaque prise** — `capture.lua` `doShot`, `saveIndex`, `applyCaptureLighting`.
→ Index écrit au plus toutes les 2 s, à chaque fin de passe et dans `finishJob` ; éclairage appliqué une fois par passe (`playPitch`).

**B14. Mod : restauration de l'éclairage silencieuse** — `capture.lua` `lightingSnapshot` / `restoreLighting`.
→ Repli sur le composant WORLD pour les nuages ; avertissement dans le log si un champ de l'instantané est nil.

**B15. Mod : requête illisible = job interrompu** — `live_export.lua` `M.tick`.
→ Si `loadTable("live_request")` renvoie nil, garder la requête précédente.

**B16. Mod : chaque sauvegarde efface d'abord le fichier** — `io_util.lua` `trySave`, `export_map.lua`.
→ Vérifier si `saveUserdata` écrase seul ; sinon garder mais ne pas écrire `map.lua` si la heightmap a échoué.

**B17. Mod : caches par entité jamais vidés, tracés qui n'oublient jamais** — `live_export.lua` (`edgeGeom`, `nodeCache`, `edgeLanes`, `legCache`, `stationPosCache`, `lineEdges`, `lineMode`, `vehicleNames`).
→ Vider ces caches tous les `LEG_REFRESH` passages ; dans `lineEdges`, noter le passage où chaque arête/morceau a été vu et l'oublier après ~3 × `LEG_REFRESH` ; purger les entrées des lignes/véhicules disparus.

**B18. Mod : pics de calcul** — `live_export.lua` (job véhicules non étalé, pathfinding de tous les trajets au même passage, voies de toutes les rues dans `finish`).
→ Job véhicules en `begin/step/finish` ; rafraîchissement des trajets décalé par clé (hash % `LEG_REFRESH`) et plafonné par image ; voies des rues calculées dans les étapes.

**B19. Mod : fermeture de fenêtre** — `hqminimap_gui.handlers.lua` `bindWindow` / `onUnmount`.
→ Interrompre le scan si la pompe du bouton n'a pas tourné depuis la dernière étape de la fenêtre (`buttonPumpFrame == windowPumpFrame`), pas seulement si elle n'a jamais tourné.

**B20. Mises à jour : dépôt privé / absence de release mal classée** — `app/src/lib/state/updates.svelte.ts`.
→ Ajouter `/valid release json|release.?not.?found/i` au cas `notFound` ; corriger `app/test/updates.test.ts` avec le vrai message (« Could not fetch a valid release JSON from the remote ») ; 403 GitHub (limite) → message dédié.

**B21. Champs numériques à 0 / config invalide** — `GridLab.svelte` (`custom()`, `setResolution`), `app/src/lib/state/app.svelte.ts` (fusion de la config).
→ Ignorer les valeurs non finies, borner chaque champ (min/max), ignorer les `null` stockés ; message « réglages invalides » distinct de « aucune carte ».

**B22. Nom de session effacé pendant la saisie** — `GridLab.svelte` (`labelDraft`).
→ Ne resynchroniser que si l'id du run ou son libellé enregistré change.

**B23. Historique : tailles en course** — `app/src/lib/ui/History.svelte`.
→ Jeton de génération ; clé posée après succès ; cache des tailles dans `runs` (survit au changement d'onglet).

**B24. Aperçus des captures : relectures et URL non libérées** — `CaptureTiles.svelte`.
→ Un seul chargement à la fois (jeton) ; révoquer les URL remplacées et au démontage.

## Lot 3 — Mineur
- Commandes : attendre le premier statut avant d'envoyer (seq) ; écrire `live_request` en file (pas d'écritures concurrentes) ; ne pas laisser une téléportation remplacer un scan en attente (`live.svelte.ts`).
- `layers.ts` : `changed()` ne mémorise les dépendances qu'après une reconstruction réussie ; `refreshSelection` sans `areaSrc.changed()` inutile à chaque image.
- `Viewer.svelte` au démontage : annuler `fillsTimer`, `toastTimer`, `idleTimer`, libérer la source de tuiles ; appliquer le cache de tuiles réduit sans attendre un changement de fond.
- `runs.svelte.ts` : un `refreshList` en cours ne doit pas écraser la mise à jour sur place du run en cours ; index de capture partiellement écrit (pas de `finishedAt`) : ne pas le mettre en cache.
- Traces restaurées : à la première vue d'un véhicule, le retirer des autres lignes.
- Raccourcis clavier (`Viewer.svelte`) : ignorer Ctrl/Alt/Meta et `e.repeat` ; ne bloquer que les champs texte ; Échap ferme d'abord le menu des lignes.
- Plein écran : écouter `fullscreenchange` / redimensionnement pour resynchroniser `app.fullscreen`.
- `LiveSettings.svelte` : saisie invalide ≠ 0 (garder l'ancienne valeur).
- Filtres (`viewerFilters`) : noms de préréglages nettoyés, validation au chargement, erreur d'export affichée.
- Mises à jour : `install_info` ou `getVersion` en échec gérés.
- Options : « Détecter » ne doit pas effacer un dossier du mod choisi à la main ; sélection de l'Historique purgée des sessions supprimées ; mémoire affichée en Mo = 10⁶ ou libellé « Mio ».
- Mod : attentes en secondes entières → attendre `ceil(s) + 1` ; valider le plan (`zEye`, `nX`, `nY`, centres) ; sans `os.time`, considérer un scan horodaté comme périmé ; `%d` sur valeurs non entières (`math.floor`) dans l'historique et les véhicules (chaque véhicule sous `pcall`) ; vérifier le type de l'id dans `pathStep` ; `fileMode` : faux positifs (support/report/sport, chair_) ; `checkNewPlan` à l'horloge murale ; lecture de la requête à l'horloge et non en images ; `fireReactEvent` à valider pour l'ouverture des fenêtres en jeu ; modes déclarés de ligne : journaliser les valeurs de l'énumération avec le vecteur (décalage possible de 1).
- Textes obsolètes : `tiles.resolutionMismatch` (« réécris la grille » → « relance le scan »), `viewer.none` (bouton « Calculer l'ortho » disparu), `live.minHint` (minimum 60 s pour zones/historique) ; commentaires « Capturer » dans `paths.ts`, `app.svelte.ts`, `modwriter.ts` ; clés i18n mortes à supprimer (`steps.ortho.todo`, `grid.result`, `tiles.captures`, `tiles.run`, `tiles.name`, `tiles.ortho`, `tiles.e.*`, `tiles.compute`, `tiles.loading`, `settings.title`, `settings.pickMod`, `live.statusOk` ; côté mod `capture_button`, `status_capture_error`, `status_capture_impossible`, `err_restarted`).
- Sécurité (plus tard) : restreindre `$HOME/**` aux dossiers TF3, définir une CSP de base.

## Vérification
- `cd app && npm run check && npm test && npm run build` (ajouter les tests cités : perf sans oscillation, tiles compteur/plage, updates message réel, parseCaptureIndex sans `shotTimes`).
- `python tools/sim_mod.py <capture_plan.lua>` (+ `--fps 30/144/240`, `--short N`, `--lang en`) ; nouveau cas : une image sautée → erreur immédiate « image sautée ». `python tools/sim_live.py` : plus d'appel heightmap dans les jobs live, jobs suspendus pendant un scan.
- En jeu (après redéploiement : `node tools/deploy-dev.mjs`, puis recharger la partie) : scan complet sans image sautée, vitesse du calendrier conservée, Visualiseur fluide, options d'affichage appliquées immédiatement, retour au Visualiseur sans accéléré.
