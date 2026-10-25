# Faits vérifiés

Faits hérités de miniMapper (`../miniMapper/docs/agent-memory`, preuves là-bas) et faits propres à HQminiMap.

### Caméra CameraFrame (hérité, VERIFIED)
- Pitch nadir **−14.1372** (= −4,5π − 3,3e-5). L'orientation de l'image dépend du **signe** de `fovY` : la clé est **négative**, en **radians**, ramenée dans ±π. `fovV = |wrap(fovY)|·180/π` ; fovScale 0,99998 et pixelAspect 1,00003, donc 1.
- Modèle sténopé v3 : `tanH = tanV·W/H`, `h = Z_eye − Z_ref`, `viewX = 2h·tanV` (X monde ↔ vertical écran), `viewY = 2h·tanH` (Y monde ↔ horizontal écran). D'où grille `cols = nY`, `rows = nX`.
- Le pitch est figé pour toute la durée d'un `playCutscene` : une cutscene par pitch. Une cutscene ne peut ni lire un état partagé (`ug_require` est nil dedans) ni être écrite en jeu (`io` / `os.execute` sont nil). C'est pourquoi l'app écrit les cutscenes **avant** de lancer le jeu.
- Timings du plan : `segDur 1`, `shotOffset 0.25`, `holdEps 0.02`, `transit 0.05`, `envSettle 2 s` ; 4 images clés identiques par tuile.
- Éclairage : l'heure passe par `makeGameSetTimeOfDayCmd`. `light.latitude` est sans effet à l'exécution. Pas de reflets d'eau à 7 h ; la config miniMapper utilisait 10 h.
- UI : `react.onStep` doit être enregistré pendant le rendu de la recette Window, **à chaque rendu**. Depuis un onClick, il s'attache au bouton et ne s'exécute jamais.
- `saveUserdata` n'écrit que des tables `.lua` ; une grosse chaîne y ressort vide.

### Port TS ⇄ gen Python
- **Statut :** VERIFIED (vitest `test/plan.test.ts`, 2026-10-25)
- `computeMosaic` + `renderPlan` + `renderCutscene` donnent un `mosaic_plan.lua` et des cutscenes **identiques octet par octet** (lignes de commentaire exceptées) à ceux de `gen_mosaic_cutscene.py`. Testé sur 5 cas synthétiques (cover, per_seam, constant ; FOV 10 à 22,8°) et 3 cas sur la vraie carte (512²). Centres, raccords et déficits à moins de 1e-6.
- Les nombres sont formatés à la Python (`.Ng`, `.Nf`) à partir de la valeur binaire exacte, avec arrondi au pair (`pyfmt.ts`).

### Générateur TFUI
- **Statut :** VERIFIED (2026-10-25)
- **Sans le catalogue de composants**, le générateur TFUI écrit les emplacements à enfant unique sous forme de liste (`content = { builtin.X {...} }`). En jeu, cela plante : « Could not assign value to userdata 'content' » dans la recette HQminiMapModButton, puis « Script component root failed ». **Avec le catalogue**, la sortie est identique à la GUI miniMapper qui fonctionnait.
- La classe CSS d'un nœud est `tfui-` suivi des 8 premiers caractères hexadécimaux de son id : il faut des UUID aléatoires.
- Le schéma d'ouverture TFUI exige `catalogHash` (chaîne) et `mod.modRoot` relatif au fichier `.tfui.json`.
- **En jeu (2026-10-25)** : avec la GUI générée avec le catalogue, le bouton de la zone des mods et la fenêtre HQminiMap s'ouvrent (VERIFIED). L'export, la capture et la pompe `bindWindow` ne sont pas encore testés en jeu.

### Simulation du mod
- **Statut :** VERIFIED en simulation lupa (`tools/sim_mod.py`), NOT TESTED en jeu.
- Grille 3×2 : 6 captures sur 6, dans l'ordre (iy à l'extérieur, ix à l'intérieur), seq `[6,4,2,5,3,1]`, chacune à environ 0,27 s dans son maintien. Éclairage et caméra restaurés. Export : `map.lua` (128²) et `heightmap.lua` (512²).

### Ortho / pyramide (banc)
- **Statut :** VERIFIED (Node 22, `test/tools/bench-ortho.mts`, 2026-10-25)
- Plan réel 12×5, carte de 14 336 m, résolution au sol 1,218 m/px : ortho 11 771², 139 MP, 0 trou. Rendu Lanczos3 24,8 s, PNG 27,4 s, 54 s au total. Pyramide zMax 6, 2 839 tuiles. Au plus 20 tuiles décodées en mémoire.
- Test de reprojection synthétique (terrain plat et en relief) : erreur moyenne inférieure à 2 niveaux pour toutes les interpolations sauf le plus proche (inférieure à 4).

### Sonde en jeu des données en direct
- **Statut :** VERIFIED (sonde `live_probe.lua` en jeu, 2026-10-25 ; sonde retirée ensuite)
- La pompe `onStep` de la recette du bouton de la zone des mods tourne fenêtre fermée (961 ticks contre 828 pour la fenêtre).
- `api.gui.camera.focusPosition(Vec3f, dist)` déplace la caméra et renvoie sans erreur.
- **Villes et industries** : `makeMapFromGame`.
  - TOWN a `initialLandUseCapacities` (3 valeurs, utilisées comme taille).
  - INDUSTRY a `level`.
- **Gares** : STATION_GROUP a `stations` et NAME. La position vient de `streetConnectorSystem.getConstructionEntityForStation` puis `CONSTRUCTION.transf`.
- **Lignes** : `getLinesForPlayer`, 109 lignes dans la partie de test.
  - LINE a `stops {stationGroup, station, terminal}`.
  - COLOR a `.color {x, y, z}`.
- **Véhicules** : position par `api.engine.util.vehicle.getPosition(v)`. TRANSPORT_VEHICLE a `line`, `carrier`, `state`, `stopIndex`.
