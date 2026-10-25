# Traduire HQminiMap

Deux parties à traduire. Le français est la langue source de l'app, l'anglais la langue de repli du mod.

## L'app (`app/src/lib/i18n/`)
1. Copier `en.ts` sous le code de la langue, par exemple `de.ts`, et renommer l'objet (`export const de`).
2. Traduire les valeurs **sans toucher aux clés** ni aux paramètres `{nom}`, qui doivent tous rester présents.
3. Dans `index.svelte.ts`, ajouter la langue à `LOCALES` (`{ fr, en, de }`) et son format de nombres/dates dans `I18n.tag`.
4. Vérifier :
   - `npm run check` signale toute clé manquante (le type `Record<MessageKey, string>`) ;
   - `npm test` vérifie que chaque langue a les mêmes clés et les mêmes `{paramètres}` que `fr.ts`.

La langue suit le système au premier lancement, puis se choisit dans **Réglages → Langue**.

## Le mod (`mod/content/hqminimap/i18n.lua`)
1. Copier la table `en` sous le code à deux lettres (`de = { … }`).
2. Traduire les valeurs en gardant les `%s` / `%d` **dans le même ordre**.
3. La langue du jeu est lue via `api.util.getLanguage()`. Au premier affichage, le mod écrit dans le log (`stdout.txt`) une ligne `[hqminimap] game language: …` qui montre ce que le jeu renvoie. Une langue sans table retombe sur l'anglais.

Les textes de la fenêtre (boutons, aide, état) viennent de `handlers.t("clé")` et `handlers.statusText(status)`, déclarés dans `hqminimap.tfui.json`. Les traductions ne demandent donc aucune régénération TFUI.

> Le jeu utilise gettext (`_("…")`, catalogues `.mo` dans `base/strings/<lang>/LC_MESSAGES/`). L'emplacement des catalogues d'un mod n'est pas vérifié pour TF3 : on garde donc nos propres tables tant que ce n'est pas confirmé.
