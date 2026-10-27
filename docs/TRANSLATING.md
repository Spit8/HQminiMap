# Traduire HQminiMap

Langues : français et anglais (écrits à la main), allemand, italien, espagnol et chinois simplifié
(générés). Le français est la langue de repli de l'app, l'anglais celle du mod.

## Langues écrites à la main : fr, en
- App : `app/src/lib/i18n/fr.ts` (référence des clés) et `en.ts`. Ne pas toucher aux clés ni aux paramètres `{nom}`.
- Mod : tables `en` et `fr` de `mod/content/hqminimap/i18n.lua`, en gardant les `%s` / `%d` **dans le même ordre**.

Toute nouvelle clé doit être ajoutée à `fr.ts` et `en.ts` (et au mod si besoin), puis traduite dans
les autres langues : voir ci-dessous.

## Langues générées : de, it, es, zh
Produites depuis l'anglais par `lowCost_Translator` (LLM local), avec le contexte de chaque chaîne et
un glossaire tiré des traductions officielles de Transport Fever 3. Marche à suivre complète :
[`tools/i18n/README.md`](../tools/i18n/README.md). En résumé :

1. `cd app && npx tsx ../tools/i18n/export.mts` (textes à traduire → `tools/i18n/units.json`) ;
2. traduction avec `lowCost_Translator` (seules les chaînes nouvelles ou changées sont traduites) ;
3. relecture de `tools/i18n/out/review_<lang>.csv`, corrections dans `tools/i18n/overrides.json` ;
4. `npx tsx ../tools/i18n/import.mts`, puis `npm run check && npm test`.

Ne jamais modifier à la main `app/src/lib/i18n/{de,it,es,zh}.ts` ni les tables générées de
`i18n.lua` : elles sont réécrites à chaque import.

Choix de traduction (repris du jeu) : tutoiement ; vocabulaire du jeu pour les objets (lignes, gares,
entrepôts…) ; allemand à la suisse (« ss », pas de « ß ») ; boutons à l'infinitif (de, es) ou à
l'impératif (it) ; chinois simplifié uniquement.

## Vérifications
- `npm run check` signale toute clé manquante (type `Record<MessageKey, string>`) ;
- `npm test` vérifie que chaque langue a les mêmes clés et `{paramètres}` que `fr.ts`, et que chaque
  table du mod a les mêmes clés et `%` que `en`.

La langue suit le système au premier lancement, puis se choisit dans **Options → Langue**. Le mod suit
la langue du jeu (`api.util.getLanguage()`, ligne `[hqminimap] game language: …` dans `stdout.txt`) ;
une langue sans table retombe sur l'anglais, `zh_TW` prend le chinois simplifié.

Les textes de la fenêtre du mod (boutons, aide, état) viennent de `handlers.t("clé")` et
`handlers.statusText(status)`, déclarés dans `hqminimap.tfui.json` : les traductions ne demandent aucune
régénération TFUI.
