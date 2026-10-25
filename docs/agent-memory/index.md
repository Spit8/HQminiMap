# HQminiMap — Mémoire agent

Point d'entrée de la mémoire projet. Lire cet index en début de tâche substantielle, puis seulement les fichiers utiles.

| Fichier | Rôle |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Structure, flux joueur, modules |
| [VERIFIED_FACTS.md](./VERIFIED_FACTS.md) | Faits techniques étayés (dont ceux hérités de miniMapper) |
| [DECISIONS.md](./DECISIONS.md) | Décisions durables (HQ-xxx) |

## État du projet
- **Nom :** HQminiMap. Repartie à nu de miniMapper (`../miniMapper`, référence + oracle des tests) le 2026-10-25.
- **Statut :** v1 écrite ; en jeu, seule l'ouverture de la fenêtre est vérifiée. Simulation Lua du mod OK, 16 tests vitest OK (concordance octet par octet avec le gen Python de miniMapper), banc ortho pleine échelle OK.
- **Flux :** export → GridLab « Écrire dans le mod » → Capturer, **sans recharger la partie** (HQ-008).
- **Périmètre v1 :** workflow x1 seul, raccords **cover** seuls, FOV **10…66°**, pas de correction de brume, TileLab = ortho seulement.
- **Source de vérité :** code, tests, logs, instructions utilisateur (pas la mémoire seule).

## Statuts
VERIFIED · OBSERVED · HYPOTHESIS · FAILED · NOT TESTED · STALE (mêmes sens que miniMapper).
