# Relancer les tests

Ce document dit quels tests relancer, et dans quel ordre, après une modification du code, une mise à jour d'Antigravity ou une mise à jour de l'outillage (Node, `@vscode/vsce`, esbuild). Il renvoie aux documents de référence sans les recopier. Toutes les commandes se lancent depuis la racine du dépôt ; chaque exemple indique son shell.

## 1. Les tests automatiques

```powershell
# PowerShell
npm test
```

Lance tous les tests en une seule exécution. Attendu : aucun échec ; les tests ignorés affichent leur raison (par exemple, les tests de wf-hook hors de Windows ou sans Git Bash). Les scripts `npm run test:antigravity`, `test:claude` et `test:common` lancent un seul groupe. Un nouveau fichier de test porte le préfixe `antigravity-`, `claude-` ou `common-` : le test `common-organisation-tests` le vérifie.

```powershell
# PowerShell
npm run test:injection
```

Compare le dernier rapport de sonde de la suite « injection-contexte » à la baseline de sa version, lue dans `meta.version_antigravity` du rapport. La variable `SONDE_RAPPORT` désigne un autre rapport, et `SONDE_BASELINE` impose une baseline (version, date ou nom de fichier) :

```powershell
# PowerShell
$env:SONDE_BASELINE = "2.6.0"; npm run test:injection; Remove-Item Env:SONDE_BASELINE
```

Le détail, avec les exemples en Git Bash, est dans le [README de la suite](scenarios/antigravity-injection-contexte/README.md), sections « Commandes », « Comparer un rapport précis » et « Forcer une baseline ».

## 2. Après une mise à jour d'Antigravity : refaire la sonde

Les faits testés font foi, et non la documentation d'Antigravity. Après une mise à jour de l'IDE, refais la sonde avant de modifier l'extension :

1. Respecte les préconditions : [README de la suite](scenarios/antigravity-injection-contexte/README.md), section « Préconditions de la sonde ».
2. Joue la sonde : même README, section « Procédure d'exécution » (réinitialisation, version notée dans le rapport, comparaison, réinitialisation).
3. Lis le résultat : section « Lire le résultat de la comparaison ».
4. En cas d'écart, suis la colonne « Si ça change » du scénario touché dans [SCENARIOS.md](scenarios/antigravity-injection-contexte/SCENARIOS.md), puis la section « Quand un écart est confirmé » du README : ne modifie jamais une baseline existante, crée une nouvelle baseline datée, et reporte le fait observé dans le profil de comportement de la version (`src/antigravity/behavior.ts`).

## 2 bis. Après une mise à jour de Claude Code : la suite d'injection Claude Code

La jauge Claude Code de l'extension s'appuie sur la suite `scenarios/claude-code-injection-contexte/`. Après une mise à jour de Claude Code, et avant de modifier la jauge :

1. Respecte les préconditions et connecte le profil isolé si besoin : [README de la suite](scenarios/claude-code-injection-contexte/README.md), sections « Les préconditions » et « Connecter le profil isolé ».
2. Lance d'abord la partie gratuite (`/context`, sans appel au modèle), puis la comparaison : même README, section « La procédure », point 1.
3. La partie payante (appels au modèle sur le quota de l'abonnement) ne se relance que sur décision, toujours précédée de son mode à sec : même README, point 2.
4. Lis le résultat et, en cas d'écart, suis la colonne « Si ça change » de [SCENARIOS-CLAUDE-CODE.md](scenarios/claude-code-injection-contexte/SCENARIOS-CLAUDE-CODE.md) : ne modifie jamais une baseline existante.

`npm run test:injection-claude` compare le dernier rapport à sa baseline ; comme `test:injection`, cette comparaison est ignorée dans `npm test`. Les rapports de `resultats/` restent locaux (ignorés par Git) ; seule la baseline est commitée, et elle ne compare que ce qui ne dépend pas du compte.

## 3. Le test manuel

Avant une publication, ou après une modification du banc d'essai ou du profil Antigravity, joue [TEST-MANUEL.md](scenarios/TEST-MANUEL.md) dans l'hôte de développement (instance séparée de VS Code), puis remplis sa grille de résultats.

## 4. La baseline du VSIX et le canari

À faire avant une publication et après toute mise à jour de l'outillage. La sortie va dans un dossier de `docs/`, qui est ignoré par Git : `<dossier>` désigne ce dossier, et `<fichier>` le nom du VSIX produit. Les commandes suivantes se lancent dans **Git Bash**.

1. Supprimer l'ancienne construction par son chemin explicite, pour que le VSIX ne contienne que ce qui vient d'être construit :

   ```bash
   # Git Bash
   rm -f dist/extension.js dist/extension.js.map
   ```

2. Construire le VSIX, avec un chemin de sortie relatif (la sortie ne contient alors aucun chemin personnel) et l'entrée standard fermée, pour qu'aucune question ne reste en attente. Garder la sortie complète :

   ```bash
   # Git Bash
   mkdir -p docs/<dossier>
   node node_modules/@vscode/vsce/vsce package --no-git-tag-version -o docs/<dossier>/ < /dev/null > docs/<dossier>/sortie-vsce.txt 2>&1
   ```

   `vsce package` lance `vscode:prepublish`, qui vérifie les types et reconstruit `dist/extension.js` en production.

3. Extraire le VSIX et calculer les empreintes au format `chemin<TAB>taille<TAB>SHA-256`, triées par chemin :

   ```bash
   # Git Bash
   unzip -q docs/<dossier>/<fichier>.vsix -d docs/<dossier>/extrait
   (cd docs/<dossier>/extrait && find . -type f | sed 's|^\./||' | LC_ALL=C sort | while IFS= read -r f; do printf '%s\t%s\t%s\n' "$f" "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -d' ' -f1)"; done) > docs/<dossier>/empreintes.txt
   ```

4. Comparer avec les empreintes de la dernière construction validée, puis vérifier le canari `extension/dist/extension.js` :

   ```bash
   # Git Bash
   diff docs/<reference>/empreintes.txt docs/<dossier>/empreintes.txt
   ```

   - Chaque écart doit s'expliquer : la version (`extension.vsixmanifest`, `extension/package.json`), le README, le CHANGELOG ou un fichier de `src/webview/` modifié.
   - Le canari n'est comparable que si ni les sources TypeScript de `src/`, ni esbuild, ni les dépendances regroupées dans `dist/extension.js` (aujourd'hui `gpt-tokenizer`) n'ont changé depuis la référence. Sinon, seuls les autres fichiers se comparent.
   - L'empreinte de l'archive `.vsix` elle-même change à chaque construction (dates du ZIP) : elle ne sert jamais de point de comparaison.
   - Le VSIX ne doit contenir aucune sourcemap (`.map`).

## 5. Avant une publication

Dans l'ordre : `npm test`, `npm run test:injection`, la baseline du VSIX (section 4) et `vsce ls`, la recherche de données locales (chemins personnels, noms d'hôte, noms réels de serveurs MCP) dans le diff depuis la dernière version, dans le VSIX extrait **et dans les captures d'écran** (une recherche textuelle ne voit pas les images), puis le test manuel (section 3), avec sa grille remplie.
