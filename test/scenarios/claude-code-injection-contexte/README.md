# Suite de régression « injection-contexte » (Claude Code)

Cette suite mesure ce que Claude Code injecte réellement dans le contexte du modèle (fichiers de mémoire, règles, skills, MCP et hooks), et ce que chaque élément coûte en tokens. Elle sert de référence à la jauge Claude Code de l'extension. Elle ne touche jamais au côté Antigravity, qui a sa propre suite (`../antigravity-injection-contexte/`).

La suite a deux parties :

- **la partie gratuite**, par `/context` seulement : aucun appel au modèle, l'usage de chaque lancement vaut 0 ;
- **la partie payante**, par `claude -p` : 38 appels au modèle, imputés sur le quota de l'abonnement claude.ai, jamais sur une facturation par API.

## Contenu du dossier

| Élément | Rôle |
|---|---|
| `fixtures/` | Les 58 fixtures **inertes** (suffixe `.fixture`, dossiers `_claude` et `_claude-plugin`, espace réservé `__projet__`). Le lanceur ne leur rend leur vrai nom que dans l'espace isolé, jamais dans le dépôt. |
| `inventaire.json` | La liste figée des fixtures, avec leur empreinte SHA-256 et leurs canaris. Le lanceur refuse de déployer une fixture dont l'empreinte diffère. |
| `mcp/serveur-fixture.js` | Le serveur MCP de fixture : stdio, modules intégrés de Node seulement, aucune action. |
| `SONDE.md` | Les invites exactes des appels au modèle. C'est la seule source d'invites que le lanceur accepte, et chacune est vérifiée par son empreinte. |
| `SCENARIOS-CLAUDE-CODE.md` | La grille des scénarios CC01 à CC37, avec une colonne par baseline. |
| `attendu/baseline-AAAA-MM-JJ.json` | Les baselines, une par version de Claude Code mesurée, commitées. Elles ne comparent que ce qui ne dépend pas du compte (voir « Ce que compare la baseline »). Une baseline existante n'est jamais modifiée, sauf par l'ajout d'une version à `versions_compatibles` (`sonde:claude-compatible`, après une comparaison complète sans écart). |
| `resultats/` | Les rapports normalisés (`context-…` et `payant-…`), écrits après la garde de confidentialité. **Ils restent locaux** : depuis le 2026-11-09, Git les ignore (sauf `.gitkeep`), car ils contiennent des totaux qui dépendent du compte. |
| `brut/` | Les sorties brutes, les compteurs, le journal de déploiement et le fichier `ARRET.txt`. **Ce dossier est ignoré par Git** : il contient des données locales. |

Les scripts sont dans `../scripts/` : `sonde-claude-code.js` (le lanceur, le seul point de lancement de `claude`), `sonde-claude-code-payant.js` (la partie payante, sans aucun lancement), `sonde-claude-code-commun.js` (le contrat partagé) et `compare-injection-claude.js` (le comparateur).

## Les commandes

Toutes les commandes se lancent depuis la racine du dépôt, dans un **terminal PowerShell ordinaire**, et non dans un terminal de VS Code ni de Claude Code.

| Commande | Effet | Coût |
|---|---|---|
| `npm run sonde:claude-etat` | La version, l'état de connexion, les préconditions et les compteurs | Nul |
| `npm run sonde:claude-context -- --lot E1` | La partie gratuite : 22 combinaisons et 4 bases, soit 26 `/context` | Nul (usage 0, contrôlé après chaque lancement) |
| `npm run sonde:claude-context -- --lot V1 --resultats` | La même partie gratuite, pour vérifier une nouvelle version de Claude Code (lot V1, `/context` seulement) | Nul |
| `npm run sonde:claude -- --a-sec` | Affiche les 38 appels prévus (argv, noms des variables, fichiers déployés), **sans rien lancer ni écrire** | Nul |
| `npm run sonde:claude -- --confirmer --plafond 38` | La partie payante, séries 1 à 5 | 38 appels au modèle, sur le quota de l'abonnement |
| `npm run sonde:claude-context -- --preparer-h14` | Déploie le jeu de H14 et affiche les gestes à faire dans VS Code | Nul ici ; 1 appel manuel dans le panneau |
| `node test/scenarios/scripts/sonde-claude-code.js retirer` | Retire un déploiement laissé en place (interruption, ou H14) | Nul |
| `npm run sonde:claude-baseline -- --depuis context-AAAA-MM-JJ-HHMM.json` | Écrit `attendu/baseline-<date>.json` d'après un rapport **valide** de `resultats/`, après la garde ; refuse d'écraser une baseline existante | Nul (aucun lancement de `claude`) |
| `npm run sonde:claude-compatible -- --rapport context-AAAA-MM-JJ-HHMM.json --baseline 2026-11-09` | Ajoute la version du rapport à `versions_compatibles` de la baseline désignée, et rien d'autre ; refuse si la série n'est pas valide, si une entrée n'est pas couverte ou s'il y a au moins un écart | Nul (aucun lancement de `claude`) |
| `npm run test:injection-claude` | Compare le dernier rapport de `resultats/` à sa baseline | Nul |

Options utiles :

- `--resultats` écrit le rapport normalisé dans `resultats/` au lieu de `brut/` ; c'est ce rapport que lisent le comparateur et la commande de baseline (il reste local) ;
- `--combinaisons a,b` (partie gratuite) et `--series 1,3` (partie payante) relancent une partie seulement ;
- `--plafond <n>` abaisse le plafond de l'exécution ; il ne peut jamais dépasser 40.

## Les préconditions

Le lanceur les vérifie et refuse de partir si l'une manque.

1. **Le profil isolé est connecté par claude.ai, sur un abonnement** (Pro, Max, Team ou Enterprise), et `claude auth status` désigne bien ce profil (`configDirectory`). Aucune clé d'API n'est utilisée.
2. **L'espace isolé** est hors du dossier personnel, du dépôt et du profil, et aucun `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` ni `.claude` ne se trouve dans ses dossiers parents. Il est vide au départ.
3. **Aucun journal de déploiement n'est en attente**, et le fichier `brut/ARRET.txt` est absent.
4. **L'environnement du processus enfant est nettoyé** : toutes les variables `CLAUDE*` et `ANTHROPIC*` sont retirées, puis seules `CLAUDE_CONFIG_DIR` (le profil isolé) et `DISABLE_AUTOUPDATER=1` sont posées.

Les chemins par défaut sont calculés : le profil est `%LOCALAPPDATA%\canari-claude-code\config`, l'espace `<lecteur système>\canari-claude-code\espace`, et l'exécutable est cherché dans le `PATH` (jamais un `.cmd`). Les variables `CANARI_CLAUDE_CONFIG_DIR`, `CANARI_CLAUDE_ESPACE` et `CANARI_CLAUDE_EXE` les remplacent.

Après chaque série, le profil isolé est comparé à son état du début. Un écart inconnu rejette la série. Les écarts connus sont tolérés et comptés par motif et par nature (ajoutés, modifiés, retirés), sans nom de fichier : ce sont les caches de Claude Code et, depuis le 2026-11-09, la synchronisation du compte, qui modifie `skills/synced/` et `policy-limits.json` pendant une série. Aucune fixture ne peut viser ces deux chemins.

## Connecter le profil isolé (une seule fois)

Dans un nouveau terminal PowerShell ordinaire, hors de VS Code :

```powershell
# PowerShell
$env:CLAUDE_CONFIG_DIR = "$env:LOCALAPPDATA\canari-claude-code\config"
claude auth login --claudeai
claude auth status --text
Remove-Item Env:CLAUDE_CONFIG_DIR
```

`--claudeai` choisit l'abonnement Claude, et non `--console`, qui facturerait par l'API. Si l'organisation impose la connexion unique, ajouter `--sso`. Ce profil garde ses identifiants dans son propre `.credentials.json`, que le lanceur ne lit jamais.

## La procédure

### 1. La partie gratuite (lot E1, et après chaque mise à jour de Claude Code)

1. `npm run sonde:claude-etat` : les préconditions doivent être remplies.
2. `npm run sonde:claude-context -- --lot E1 --resultats`.
3. `npm run test:injection-claude`.
4. Pour une version sans baseline, et seulement sur décision : `npm run sonde:claude-baseline -- --depuis <rapport valide>`, puis la colonne de la version dans `SCENARIOS-CLAUDE-CODE.md`. On ne commite que la baseline.

Au premier lancement d'un lot, le lanceur archive le compteur du lot précédent dans `brut/` (par exemple `compteur-context-I2.json`) et l'annonce en console. Il ne remet jamais un compteur à zéro, et un lot archivé ne peut pas être rouvert.

### 1 bis. La vérification d'une nouvelle version (lot V1)

Le lot V1 (décision du 2026-11-10) sert aux vérifications de version : il n'accepte que `/context`, avec un plafond de 30 et son propre compteur. Toute commande payante y est refusée (`--lot V1` sur `sonde:claude`, appel au modèle, compteur du modèle).

1. `npm run sonde:claude-etat` : noter la version, et vérifier les préconditions.
2. `npm run sonde:claude-context -- --lot V1 --resultats` (26 `/context`). Au premier lancement, le compteur E1 est archivé sous `brut/compteur-context-E1.json`, et le lot E1 ne peut plus être rouvert.
3. Comparer à la baseline de la version précédente, désignée explicitement :

   ```powershell
   # PowerShell
   $env:SONDE_BASELINE_CLAUDE = "2026-11-09"; npm run test:injection-claude; Remove-Item Env:SONDE_BASELINE_CLAUDE
   ```

   La console annonce alors « comparaison inter-versions : rapport X contre baseline Y ».
4. Avec 0 écart et toutes les entrées couvertes : `npm run sonde:claude-compatible -- --rapport <rapport V1> --baseline 2026-11-09`, puis commiter la baseline. Avec au moins un écart : suivre la colonne « Si ça change » de la grille et décider d'une nouvelle baseline datée.

Le lot E2 archivera à son tour le compteur V1 : une vérification de version ultérieure demandera un nouveau lot, sur décision.

### 2. La partie payante (lot E2)

1. **D'abord à sec** : `npm run sonde:claude -- --a-sec`. Vérifier le total annoncé (38 appels au modèle et 33 `/context`), l'argv de chaque série et la liste des fichiers déployés.
2. **Puis pour de vrai** : `npm run sonde:claude -- --confirmer --plafond 38 --resultats`.
3. `npm run test:injection-claude`.

Le déroulement :

- avant chaque série, `auth status` est relu ; une connexion non conforme écrit `ARRET.txt` ;
- chaque série commence par un `/context` gratuit, qui vérifie le dossier de mémoire et les options de la série avant tout appel au modèle ;
- dans les séries 1 à 3, chaque appel est précédé d'un `/context` sur les mêmes fixtures (protocole 4 de la conception) ; les séries 4 et 5 ont des `/context` de bornes, au début et à la fin ;
- pendant chaque appel, la **garde de flux** lit le stream-json et tue le processus au premier écart : `apiKeySource` différent de `none` ou modèle différent dès l'initialisation, un tour de trop, un outil non prévu, un chemin hors de la cible, une commande Bash autre que `cat` ;
- après chaque appel, `apiKeySource` doit valoir `none`, sinon `ARRET.txt` est écrit. `total_cost_usd` est relevé, mais **ce n'est pas un critère** : il vaut plus de 0 même avec l'abonnement, car c'est un équivalent au prix public (`costBasis: "list"`) ;
- les bases de chaque série sont comparées au début et à la fin, avec une tolérance de 0 ; sinon, la série est rejetée.

### 3. H14 : le panneau Claude Code de VS Code (lot E3)

`npm run sonde:claude-context -- --preparer-h14` déploie la mémoire, les règles, les skills et le hook (sans MCP), les laisse en place, puis affiche les gestes. L'essentiel :

- une instance séparée de VS Code est lancée avec un `--user-data-dir` distinct, depuis un terminal où le profil isolé est posé ; **il n'est pas nécessaire de fermer les autres fenêtres** ;
- le `/status` du panneau tranche : profil isolé, connexion claude.ai sur un abonnement, aucune clé d'API ; sinon, on ne tape rien d'autre ;
- un seul appel au modèle : l'invite `h14-panneau` de `SONDE.md` ;
- le retrait se fait par `node test/scenarios/scripts/sonde-claude-code.js retirer`.

## Le coût

| Partie | Appels au modèle | `/context` | Plafond |
|---|---|---|---|
| Gratuite (E1) | 0 | 26 | 60 `/context` pour le lot E1 (relevé de 50 le 2026-11-09) |
| Vérification de version (V1) | 0 (refusés) | 26 | 30 `/context` pour le lot V1 |
| Payante (E2) | 38 (séries 1 à 5 : 17, 6, 4, 3 et 8) | 33 | 40 appels au modèle et 40 `/context` pour le lot E2 |
| H14 (E3) | 1, tapé à la main | 1 | — |

Les deux compteurs sont dans `brut/` (`compteur-context.json` et `compteur-modele.json`). Ils sont incrémentés **avant** chaque lancement ; un lancement interrompu compte. L'option `--plafond` ne peut qu'abaisser la limite d'une exécution. Un plafond ne se relève que par une décision inscrite dans le code (`RELEVEMENTS_PLAFOND`, une par lot au plus) : au lancement suivant, le compteur du lot passe au nouveau plafond en gardant ses utilisés, avec la trace du changement dans `historique_plafond`, et le lanceur l'annonce en console. Les appels au modèle passent par le quota de l'abonnement. Un appel des séries 1 à 4 fait un seul tour d'API ; un appel de déclencheur (série 5) en fait 2 ou 3.

## Lire les résultats

- **Le rapport** (`resultats/payant-AAAA-MM-JJ-HHMM.json`) donne, pour chaque appel, l'entrée (trois compteurs), la sortie, la somme des quatre compteurs, l'usage par tour, les canaris rapportés et les outils appelés. Le texte des enveloppes de l'appel 4a reste dans `brut/` : le rapport n'en garde que le nombre et l'empreinte.
- **La décomposition** (`decomposition` du rapport) est calculée sur l'entrée des seules séries valides : préambule, en-têtes de type Project et User, pente par caractère de chemin, constante par élément, enveloppe que `/context` ne voit pas, validité de `/context` comme instrument (protocole 4) et rapport au compte o200k (H15). Une valeur dont une mesure manque vaut `null`.
- **Ce que compare la baseline** (décision du 2026-11-09) : la présence, le type (ou la source) et les tokens de chaque fixture, et l'écart de chaque combinaison à la base de même jeu d'outils, dans la même série (`delta_base`). Jamais les totaux absolus ni les éléments hors fixtures (skills, plugins et outils du compte), qui changent avec la synchronisation du compte et d'un poste à l'autre. Les outils MCP ne sont comparés qu'en présence (anomalie A2), et l'écart d'une combinaison avec MCP est pris sans la catégorie « MCP tools ». Les observations manuelles (CC07) sont dans les remarques de la baseline.
- **La comparaison** (`npm run test:injection-claude`) choisit la baseline d'après la version du rapport ou ses `versions_compatibles`. La variable `SONDE_BASELINE_CLAUDE` en impose une (version, date ou nom de fichier), et `SONDE_RAPPORT_CLAUDE` désigne un autre rapport :

  ```powershell
  # PowerShell
  $env:SONDE_BASELINE_CLAUDE = "2026-11-05"; npm run test:injection-claude; Remove-Item Env:SONDE_BASELINE_CLAUDE
  ```

  Une baseline imposée est acceptée même si sa version diffère de celle du rapport ; la console l'annonce alors comme une « comparaison inter-versions : rapport X contre baseline Y ».

  Une entrée « non couverte » est une entrée que le rapport ne mesure pas (autre partie, série rejetée) : ce n'est pas un écart. Elle empêche pourtant l'ajout à `versions_compatibles`, car une série partielle ne prouve pas la compatibilité.
- **Un écart confirmé** : suivre la colonne « Si ça change » du scénario dans `SCENARIOS-CLAUDE-CODE.md`. On ne modifie jamais une baseline existante (sauf `versions_compatibles`, par la commande dédiée et sans aucun écart) ; une nouvelle version de Claude Code qui change un résultat reçoit une nouvelle baseline datée, et une nouvelle colonne dans la grille.

## Si une série est rejetée

- Le lanceur s'arrête à la première étape en écart de la série : aucun appel suivant de cette série n'est lancé. La série suivante démarre normalement.
- **Deux séries rejetées dans le lot arrêtent tout** : `ARRET.txt` est écrit, et le rapport est quand même produit.
- La cause est dans la console et dans `series[].raisons_rejet` du rapport ; les sorties brutes de chaque étape sont dans `brut/payant-<horodatage>/`.
- Une série se relance seule avec `--series <n>`, dans la limite du plafond restant. Le lanceur ne relance jamais rien de lui-même.

## Si `ARRET.txt` est présent

Le fichier bloque tout lancement de `claude`, `--version` compris. Il donne la date et la cause. Les causes possibles : un appel qui ne passait pas par l'abonnement (`apiKeySource`), une connexion non conforme avant une série, un dossier de mémoire inattendu, un `/context` dont l'usage n'était pas nul, ou deux séries rejetées.

1. Lire la cause, puis examiner les sorties brutes de l'étape concernée.
2. Vérifier la connexion du profil isolé (`claude auth status`, avec `CLAUDE_CONFIG_DIR` posé).
3. Ne retirer le fichier à la main qu'une fois la cause comprise.

## La confidentialité

Les rapports de `resultats/` et les baselines de `attendu/` passent par une garde avant toute écriture : aucun chemin absolu (ils sont réécrits en `<global>`, `<parent>`, `<projet>`, `<plugin>`, `<mcp>` et `<memoire>`), aucune adresse, aucun identifiant de session ni d'organisation, et aucun nom de skill, de plugin ou de serveur hors des fixtures (liste blanche `canari*`). Dans les rapports locaux, les éléments du compte n'apparaissent qu'en totaux ; la baseline n'en contient aucun, ni aucun total absolu. Le test `claude-injection-contexte` refait ce contrôle sur les baselines, les documents et les rapports locaux présents dans `resultats/`.
