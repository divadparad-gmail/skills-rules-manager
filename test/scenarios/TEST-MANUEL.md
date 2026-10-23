# Test manuel du banc d'essai

Ce document décrit le test manuel du banc d'essai dans l'hôte de développement de VS Code : déploiement, sauvegarde des vrais fichiers, avertissements, fixture modifiée, restauration à l'identique, scripts npm et arguments invalides. Il a été établi le **2026-10-23**, lors du lot L2b. Le fonctionnement du banc d'essai est décrit dans le [README.md](README.md).

Chaque partie donne les commandes exactes, une par bloc de code, et le résultat attendu de chacune. Les commandes se lancent dans **PowerShell 7**, depuis la racine du dépôt, et dans **le même terminal du début à la fin** : plusieurs variables (`$utf8`, `$avant`, `$datesAvant`, `$h02`, `$code`, `$profilHote`) servent d'une partie à l'autre.

## Tableau récapitulatif

| Partie | Objet | Où |
|---|---|---|
| 0 | Prérequis | Terminal |
| 1 | Ouvrir l'hôte de développement dans une instance séparée | Terminal, puis hôte |
| 2 | Faux « vrais » fichiers, puis déploiement par « ⚡ Tous » | Terminal, puis hôte |
| 3 | Sauvegarde, refus du script sur un banc actif, avertissement au démarrage | Terminal, puis hôte |
| 4 | Fixture modifiée : la fenêtre « Écraser et restaurer », puis « Cancel » | Terminal, puis hôte |
| 5 | Restauration à l'identique | Hôte, puis terminal |
| 6 | Même cycle par les scripts npm | Terminal, puis hôte |
| 7 | Arguments invalides | Terminal |
| 8 | Nettoyage | Terminal, puis hôte |

**Où lancer quoi.** Le « terminal » est celui de la fenêtre principale de VS Code, ouverte sur le dépôt. L'« hôte » est la fenêtre « [Extension Development Host] » ouverte à la partie 1. Ne cliquez jamais sur un bouton de l'extension dans la fenêtre principale (voir les « Pièges connus »).

---

## 0 — Prérequis

**Ce qu'on vérifie.** Le poste a Windows et PowerShell 7, le dépôt est propre, et aucun banc d'essai ni aucun faux fichier n'est en place.

```powershell
$PSVersionTable.PSVersion
```

Attendu : `Major` vaut 7. L'encodage `utf8NoBOM`, utilisé à la partie 4, n'existe pas dans Windows PowerShell 5.1.

```powershell
git status --short
```

Attendu : aucune ligne.

```powershell
Test-Path .banc-essai-sauvegarde, .scenario-manifest.json, CLAUDE.md, .mcp.json
```

Attendu : `False` quatre fois.

```powershell
npm run bundle
```

Attendu : `[esbuild] construction terminée.`

## 1 — Ouvrir l'hôte de développement

**Ce qu'on vérifie.** L'extension du dépôt se charge dans une instance séparée de VS Code, sans toucher à la version installée. Une instance séparée est nécessaire, car une même instance de VS Code n'ouvre pas deux fois le même dossier : si le dépôt y est déjà ouvert, la fenêtre de développement n'apparaît pas.

```powershell
$code = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
```

Attendu : aucune sortie. `Test-Path $code` donne `True`. Pour une installation de VS Code pour tous les utilisateurs, le chemin est `"$env:ProgramFiles\Microsoft VS Code\bin\code.cmd"`.

```powershell
$profilHote = Join-Path $env:TEMP "vscode-hote-banc-essai"
```

Attendu : aucune sortie. Ce dossier contiendra les réglages de l'instance séparée.

```powershell
& $code --user-data-dir "$profilHote" --disable-extensions --extensionDevelopmentPath "$PWD" "$PWD"
```

Attendu : une nouvelle fenêtre s'ouvre.

- `--user-data-dir` crée l'instance séparée, avec ses propres réglages.
- `--disable-extensions` désactive les extensions installées, dont la version publiée de celle-ci. L'extension en développement reste chargée.
- `--extensionDevelopmentPath` charge l'extension depuis le dépôt.

Dans l'hôte :

1. Choisissez « Continue without Signing In » si VS Code propose de se connecter.
2. Faites confiance au dossier si VS Code le demande.
3. Vérifiez que le titre de la fenêtre commence par « [Extension Development Host] ».
4. Lancez la commande « Developer: Show Running Extensions » : Skills & Rules Manager figure dans la liste.
5. Repérez l'icône de l'extension dans la barre d'activité, sous celle des extensions.

Ne cliquez jamais sur « Reload and Enable Extensions » : l'hôte rechargerait les extensions installées, dont la version publiée de celle-ci.

## 2 — Faux « vrais » fichiers, puis déploiement

**Ce qu'on vérifie.** Avant de déployer, l'extension liste les vrais fichiers qu'elle va sauvegarder, puis elle signale le banc actif partout.

Dans le terminal de la fenêtre principale :

```powershell
$utf8 = [System.Text.UTF8Encoding]::new($false)
```

Attendu : aucune sortie. C'est l'encodage UTF-8 sans BOM, pour écrire des octets exacts.

```powershell
[System.IO.File]::WriteAllText("$PWD\CLAUDE.md", "# Vrai CLAUDE.md (test manuel)`r`nÉté, façade.`r`n", $utf8)
```

Attendu : aucune sortie. Le fichier fait 49 octets, avec des fins de ligne CRLF.

```powershell
[System.IO.File]::WriteAllText("$PWD\.mcp.json", "{ `"mcpServers`": {} }`n", $utf8)
```

Attendu : aucune sortie. Le fichier fait 21 octets.

```powershell
$avant = Get-FileHash CLAUDE.md, .mcp.json -Algorithm SHA256 | Select-Object Path, Hash
```

Attendu : aucune sortie. `$avant` garde les deux empreintes.

```powershell
$datesAvant = Get-Item CLAUDE.md, .mcp.json | Select-Object Name, @{ n = 'Utc'; e = { $_.LastWriteTimeUtc.ToString('yyyy-MM-dd HH:mm:ss.fff') } }; $datesAvant
```

Attendu : les deux dates de dernière écriture, en UTC, à la milliseconde.

Dans l'hôte, ouvrez l'extension, puis cliquez sur « ⚡ Tous » dans le banc d'essai.

Attendu :

- Une fenêtre annonce le déploiement et liste `.mcp.json` et `CLAUDE.md`, qui seront sauvegardés puis restaurés au vidage. Cliquez sur « Déployer ».
- Une notification annonce « 🧪 Scénarios « all » injectés (31 fichiers). » et les 2 vrais fichiers sauvegardés.
- La barre d'état affiche « ⚠️ Banc d'essai actif ».
- Un bandeau « ⚠️ Banc d'essai actif » s'affiche en haut de la barre latérale, avec un bouton « Vider et restaurer ».
- Le même bandeau s'affiche dans le Grand Dashboard.
- Côté Claude Code, le `CLAUDE.md` local porte le badge « 🧪 Test Scénario », mais pas « Consignes du projet ».

## 3 — Sauvegarde, refus du script, avertissement au démarrage

**Ce qu'on vérifie.** Les originaux sont sauvegardés sous des noms qu'aucun agent ne lit, l'index ne contient aucun chemin absolu, et un script refuse de redéployer un banc actif.

```powershell
Get-ChildItem .banc-essai-sauvegarde -Recurse -File | Select-Object -ExpandProperty Name
```

Attendu : `index.json`, `.mcp.json.sauvegarde` et `CLAUDE.md.sauvegarde`, dans un ordre quelconque.

```powershell
Get-Content .banc-essai-sauvegarde\index.json -Encoding utf8
```

Attendu : deux entrées, `.mcp.json` et `CLAUDE.md`, avec des chemins relatifs (`copie` : `racine/…`), les tailles 21 et 49, une `date` et un champ `dateNs`.

```powershell
(Get-Content .scenario-manifest.json -Encoding utf8 | ConvertFrom-Json).etat
```

Attendu : `deploye`.

```powershell
npm run test:deploy-claude; $LASTEXITCODE
```

Attendu : l'encadré « ⚠️ Banc d'essai actif », le refus « Un banc d'essai est déjà déployé (…) », le conseil (« Lancez « npm run test:clean »… »), puis `2`.

Dans l'hôte, lancez « Developer: Reload Window ».

Attendu : un avertissement indique que le banc d'essai est encore déployé et propose « Vider et restaurer » ou « Plus tard ». Cliquez sur « Plus tard » : le bandeau et la barre d'état restent affichés.

## 4 — Fixture modifiée : annulation

**Ce qu'on vérifie.** Une fixture modifiée pendant le test n'est jamais écrasée sans accord, et « Cancel » ne modifie rien.

```powershell
Add-Content .agents\rules\02-rule-perm-standard-always-on.md "`nModifié pendant le test manuel." -Encoding utf8NoBOM
```

Attendu : aucune sortie.

```powershell
$h02 = (Get-FileHash .agents\rules\02-rule-perm-standard-always-on.md -Algorithm SHA256).Hash
```

Attendu : aucune sortie. `$h02` garde l'empreinte de la fixture modifiée.

Dans l'hôte, cliquez sur « Vider et restaurer » dans le bandeau, confirmez avec « Vider et restaurer », puis, dans la fenêtre « Écraser et restaurer » qui liste `.agents/rules/02-rule-perm-standard-always-on.md`, cliquez sur « Cancel ».

Attendu : une notification « Vidage annulé : rien n'a été modifié. »

```powershell
(Get-FileHash .agents\rules\02-rule-perm-standard-always-on.md -Algorithm SHA256).Hash -eq $h02
```

Attendu : `True`.

```powershell
Test-Path .banc-essai-sauvegarde, .scenario-manifest.json
```

Attendu : `True` deux fois.

## 5 — Restauration à l'identique

**Ce qu'on vérifie.** Les originaux reviennent octet pour octet, avec leur date, et le banc est entièrement retiré, profil global compris.

Dans l'hôte, cliquez sur « Vider et restaurer », confirmez, puis cliquez sur « Écraser et restaurer ».

Attendu :

- Une notification annonce « 🧹 Banc d'essai vidé : 29 fixture(s) supprimée(s), 2 original(aux) restauré(s). », puis la fixture modifiée écrasée.
- Le bandeau et la barre d'état disparaissent.

```powershell
Compare-Object $avant (Get-FileHash CLAUDE.md, .mcp.json -Algorithm SHA256 | Select-Object Path, Hash) -Property Path, Hash
```

Attendu : aucune sortie, donc des empreintes SHA-256 identiques.

```powershell
Compare-Object $datesAvant (Get-Item CLAUDE.md, .mcp.json | Select-Object Name, @{ n = 'Utc'; e = { $_.LastWriteTimeUtc.ToString('yyyy-MM-dd HH:mm:ss.fff') } }) -Property Name, Utc
```

Attendu : aucune sortie, donc des dates identiques à la milliseconde.

```powershell
Test-Path .banc-essai-sauvegarde, .scenario-manifest.json, .agents\rules\02-rule-perm-standard-always-on.md, "$HOME\.gemini\config\rules\rule-test-doublon.md"
```

Attendu : `False` quatre fois. La règle doublon du profil global est retirée.

```powershell
git status --short
```

Attendu : `?? .mcp.json` et `?? CLAUDE.md` seulement.

## 6 — Même cycle par les scripts

**Ce qu'on vérifie.** Les scripts npm suivent les mêmes règles que les boutons, et l'hôte réagit à leurs changements grâce à son observateur.

```powershell
npm run test:deploy-all
```

Attendu : « Vrais fichiers sauvegardés, restaurés au vidage : » avec `.mcp.json` et `CLAUDE.md`, « Total fichiers déployés : 31 », puis l'encadré « ⚠️ Banc d'essai actif ». Dans l'hôte, le bandeau et la barre d'état apparaissent.

```powershell
npm run test:clean
```

Attendu : « Originaux restaurés : » avec `.mcp.json` et `CLAUDE.md`, puis « Vidage terminé : 29 fixture(s) supprimée(s), 2 original(aux) restauré(s). » Dans l'hôte, le bandeau et la barre d'état disparaissent.

```powershell
Compare-Object $avant (Get-FileHash CLAUDE.md, .mcp.json -Algorithm SHA256 | Select-Object Path, Hash) -Property Path, Hash
```

Attendu : aucune sortie.

## 7 — Arguments invalides

**Ce qu'on vérifie.** Un argument invalide est nommé, avec la ligne d'usage, sans pile d'appels, et rien n'est modifié.

```powershell
npm run test:deploy-all -- --force; $LASTEXITCODE
```

Attendu : « [Scenarios Runner] Erreur : Option inconnue : « --force ». Seule l'option --ecraser est reconnue. », la ligne « [Scenarios Runner] Usage : … », puis `1`. Aucune ligne `at …`.

La commande suivante reproduit volontairement une commande collée deux fois sur une même ligne :

```powershell
npm run test:deploy-all npm run test:deploy-all; $LASTEXITCODE
```

Attendu : « Argument(s) en trop : « run », « test:deploy-all ». », « Racine introuvable : « npm » n'est pas un dossier existant (résolue en …) », la ligne d'usage, puis `1`. Aucune ligne `at …`.

```powershell
Test-Path npm, run, .banc-essai-sauvegarde, .scenario-manifest.json
```

Attendu : `False` quatre fois. Aucun dossier n'a été créé, et rien n'a été déployé.

## 8 — Nettoyage

**Ce qu'on vérifie.** Le dépôt et le poste reviennent à leur état de départ.

```powershell
Remove-Item CLAUDE.md, .mcp.json
```

Attendu : aucune sortie.

```powershell
npm run test:clean
```

Attendu : « Vidage terminé : 0 fixture(s) supprimée(s), 0 original(aux) restauré(s). »

```powershell
git status --short
```

Attendu : aucune ligne.

Fermez la fenêtre de l'hôte, puis :

```powershell
$profilHote
```

Attendu : un chemin qui se termine par `\vscode-hote-banc-essai`. Ne lancez pas la commande suivante si ce n'est pas le cas.

```powershell
Remove-Item -Recurse -Force $profilHote
```

Attendu : aucune sortie.

```powershell
Test-Path $profilHote
```

Attendu : `False`.

---

## Pièges connus

- **Une seule commande par ligne.** Une commande collée deux fois sur la même ligne transmet des arguments en trop au script (voir la partie 7).
- **Le même terminal du début à la fin.** `$utf8`, `$avant`, `$datesAvant`, `$h02`, `$code` et `$profilHote` n'existent que dans le terminal qui les a définis.
- **Rien à cliquer dans la fenêtre principale.** Elle exécute la version installée de l'extension, avec ses propres règles de nettoyage. Seule la fenêtre « [Extension Development Host] » exécute la version du dépôt.
- **L'hôte hérite des variables d'environnement du terminal** qui l'a lancé. `--disable-extensions` empêche les autres extensions d'y accéder.
- **Ne vous connectez à aucun compte dans l'hôte** : le dossier temporaire garderait des informations d'identification jusqu'à sa suppression.
- **Les dates sont en UTC** (`LastWriteTimeUtc`).
- **Le « doublon actif » côté Claude Code.** La jauge Claude Code compte comme doublon actif le `CLAUDE.md` global et celui du projet. Ce comportement connu est à l'étude : ce n'est pas un échec du test.

## Grille de résultats

À remplir à chaque passage : ✅ conforme, ❌ écart (à décrire dans les remarques), – non exécuté.

| Date | Commit ou version | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | Remarques |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-23 | `2dde2ba` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | 5 : date de `.mcp.json` restaurée avec 1 ms d'avance (arrondi). 7 : commande collée deux fois, pile d'appels affichée ; `--force` non essayé. 8 : le dossier temporaire s'appelait alors `vscode-hote-l2b`. Les écarts des parties 5 et 7 sont corrigés par `1a9f18c` et couverts par des tests automatiques, mais pas encore revérifiés à la main : à contrôler au prochain passage. |
