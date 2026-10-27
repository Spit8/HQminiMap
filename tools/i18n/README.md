# Traductions (de, it, es, zh simplifié)

Les langues autres que le français et l'anglais sont produites par
`lowCost_Translator` (Ollama + `translategemma:12b`), en mode « unités » : chaque chaîne part de
l'anglais (le français est donné en référence), avec son contexte et un glossaire tiré des
traductions officielles du jeu.

| Fichier | Rôle |
|---|---|
| `context.json` | Écrit à la main : description de l'app, une phrase par section (préfixe de clé), type d'élément forcé pour certaines clés. |
| `export.mts` | `en.ts` / `fr.ts` + tables `en` / `fr` du mod → `units.json`. |
| `glossary_extract.py` | Brouillon de `glossary.json` à partir des catalogues du jeu (`base/strings/<lang>/LC_MESSAGES/base.mo`). |
| `glossary.json` | **Relu à la main** : termes imposés, mots à garder, registre et forme des boutons par langue. |
| `overrides.json` | Corrections manuelles `{lang: {id: texte}}`, appliquées en dernier. |
| `out/` | Sorties du traducteur : `<lang>.json` et `review_<lang>.csv` (à relire : colonne `flags`). |
| `import.mts` | `out/<lang>.json` → `app/src/lib/i18n/<lang>.ts` et tables générées de `i18n.lua`. |

## Mettre à jour après un changement de textes

```bash
cd app && npx tsx ../tools/i18n/export.mts
```

```bash
cd ../lowCost_Translator && python translate_locales.py --units ../HQminiMap/tools/i18n/units.json --glossary ../HQminiMap/tools/i18n/glossary.json --overrides ../HQminiMap/tools/i18n/overrides.json --source en --langs de,it,es,zh --cache-dir ../HQminiMap/tools/i18n/.cache --output-dir ../HQminiMap/tools/i18n/out --back-translate
```

Relire `out/review_<lang>.csv` (lignes avec `flags`), corriger dans `overrides.json` (ou dans le
glossaire / le contexte, puis relancer : seules les chaînes concernées sont retraduites), puis :

```bash
cd app && npx tsx ../tools/i18n/import.mts && npm run check && npm test
```

Ne pas modifier `app/src/lib/i18n/{de,it,es,zh}.ts` ni les tables générées de `i18n.lua` à la main :
elles sont réécrites à chaque import.
