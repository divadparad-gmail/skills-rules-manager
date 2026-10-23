# Journal des modifications

Toutes les évolutions notables de l'extension sont consignées ici.
Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et la numérotation suit [SemVer](https://semver.org/lang/fr/).

## [Non publié]

### Développement

- Les fixtures du banc d'essai ne sont plus suivies par Git : la racine du dépôt n'en contient plus par défaut. `npm run test:deploy-*` les déploie et `npm run test:clean` les retire.
- Un test de `npm test` et un hook `pre-commit` (activé par `npm install` via le script `prepare`, qui règle `core.hooksPath`) refusent de commiter une fixture.
- Le banc d'essai sauvegarde dans `.banc-essai-sauvegarde/` chaque vrai fichier qu'un déploiement remplacerait, vérifie la copie (SHA-256 et taille), puis restaure l'original à l'identique au vidage. Une opération interrompue est reprise au vidage suivant.
- Le bouton « Nettoyer » et `npm run test:clean` suivent la même règle : seuls les fichiers identiques à la fixture déployée sont supprimés. Le critère « identique au catalogue NAS » est abandonné, et un vrai `CLAUDE.md` ou `.mcp.json` n'est plus supprimé.
- Une fixture modifiée pendant le test n'est jamais écrasée sans accord : les scripts refusent (code de sortie 2), sauf avec `-- --ecraser`. Un banc déjà déployé n'est pas redéployé sans être vidé d'abord.
- Un banc d'essai actif ou interrompu est signalé dans la barre d'état, par un bandeau dans la barre latérale et le Grand Dashboard (bouton « Vider et restaurer ») et au démarrage de l'extension. Avant un déploiement, une fenêtre liste les vrais fichiers qui seront sauvegardés et les fichiers identiques à leur fixture ; une fixture modifiée n'est écrasée qu'après la fenêtre « Écraser et restaurer ». Nouvelle commande : « Vider le banc d'essai et restaurer les originaux ».
- Les fichiers de test sont classés par outil, avec les préfixes `antigravity-`, `claude-` et `common-`. Les scripts `npm run test:antigravity`, `npm run test:claude` et `npm run test:common` lancent un seul groupe, et `npm test` les lance tous en une seule exécution. Les scripts de test vident `out-test/` avant de compiler et demandent Node 22 ou plus récent (`engines.node`). Un test refuse un fichier de test sans préfixe et un groupe sans fichier.
- Les tests d'`integrity` sont répartis entre `antigravity-integrity`, `claude-integrity` et `common-integrity`, avec leurs titres et leurs numéros d'origine.
- Un hook `PreToolUse` de Claude Code, déclaré dans `.claude/settings.json` pour les outils Bash et PowerShell (`scripts/garde-git-claude.js`), refuse dans ce dépôt `git clean -x` et `git clean -X`, y compris dans des options groupées comme `-fdx`, ainsi que `git commit --no-verify` et `git commit -n`, même dans des commandes enchaînées ou des sous-commandes. Le refus passe par la décision `deny` documentée, valable dans tous les modes de permission. En cas d'erreur interne, le hook laisse passer la commande avec un avertissement.
- Les deux tests de bout en bout du skill wf-hook, jamais exécutés jusqu'ici, sont lancés par `npm test` et `npm run test:common` sous les noms `common-wf-hook-moteur` et `common-wf-hook-bout-en-bout`. Ils travaillent dans le dossier temporaire du système au lieu de `test/`, et ils sont ignorés, avec leur raison, hors de Windows ou sans Git Bash. Le test de préfixe couvre désormais les fichiers `.test.js`, et un test vérifie que les copies `.agents` et `.claude` de wf-hook restent identiques.

### Corrections

- La fixture Claude Code `05-rule-claude-warn-lines.md` du banc d'essai contenait l'expression JavaScript `Array.from({ length: 215 } …` écrite telle quelle, au lieu des 215 lignes attendues : elle ne déclenchait donc pas l'alerte « plus de 200 lignes » qu'elle doit tester. Elle est désormais générée par `test/scenarios/scripts/generate-claude-code-05-warn-lines.js` (229 lignes, environ 4 600 tokens au démarrage du banc), et un test vérifie qu'elle est identique à la sortie du générateur.
- Le banc d'essai restaure la date de dernière écriture exacte de chaque original : elle était arrondie à la milliseconde la plus proche. Les originaux sont désormais sauvegardés et restaurés par copie, et `index.json` note la date tronquée (`date`) ainsi que sa valeur exacte en nanosecondes (`dateNs`).
- `npm run test:deploy-*` et `npm run test:clean` refusent une option inconnue, un argument en trop, une cible inconnue ou une racine invalide avec un message qui nomme l'argument en cause, sans pile d'appels (code de sortie 1).
- Un vrai `CLAUDE.md` ou `GEMINI.md`, ou tout fichier dont le frontmatter porte `scenario_fixture` ou `isScenarioFixture`, n'est plus présenté comme « 🧪 Test Scénario » ni supprimable par la corbeille sans copie dans le catalogue NAS. Une fixture du banc d'essai se reconnaît désormais à son contenu, identique à la fixture déployée ou à sa source, et non plus à son chemin, à son nom ou à un marqueur.

## [0.4.0] — 2026-10-22

### Changement d'identifiant

- L'extension est désormais publiée par `divadparad` : son identifiant devient `divadparad.skills-rules-manager` (auparavant `antigravity.skills-rules-manager`). Les réglages et les commandes ne changent pas.
- Si vous aviez installé la 0.3.0, désinstallez-la avant d'installer la 0.4.0 : VS Code les traite comme deux extensions distinctes.

### Ajouts

- Une vue « Découverte & Intégration », **expérimentale et désactivée par défaut** (réglage `antigravity.discovery.enabled`). Elle nécessite un registre compatible, et aucun registre public n'existe à ce jour. Elle propose une recherche fédérée dans vos registres, avec analyse d'intention facultative par Gemini, et le déploiement d'une ressource vers le projet local, le projet global ou le NAS. Elle intègre dès sa sortie des protections contre les dépôts non fiables et le contenu tiers :
  - un registre déclaré par un dépôt n'a accès ni à vos secrets ni à votre réseau local, et il est signalé par un badge « défini par ce dépôt » ;
  - chaque manifeste distant est affiché en lecture seule et son installation doit être confirmée, et sa provenance est consignée dans le fichier installé ;
  - la clé d'API Gemini est transmise dans un en-tête, jamais dans l'adresse des requêtes ;
  - aucun registre n'est interrogé par défaut : vos recherches ne partent que vers les registres que vous configurez ;
  - le déploiement d'un hook vers Antigravity est refusé avec un message explicatif.
- Antigravity : des alertes de taille propres à chaque type de fichier, un panneau « ⏱️ Coûts dynamiques » (règles `glob` empilées par motif, dépassement du budget) et la lecture des fichiers `hooks.json` du projet et du profil global.
- Les skills `wf-*` portent une infobulle dédiée.

### Corrections

- Antigravity : les statuts des règles et le comptage des tokens au démarrage reflètent ce que l'agent charge réellement (IDE 2.5.5).
- Les règles placées dans un sous-dossier (mode Antigravity), qu'Antigravity ne charge jamais, sont signalées « 🚫 Sans effet » et ne peuvent plus être basculées ni supprimées.
- Le chemin du catalogue NAS (`skillsManager.nasPath`) est désormais vide par défaut. Sans chemin, la colonne du catalogue indique « Aucun catalogue configuré », sans message d'erreur. Si votre catalogue se trouvait à l'ancien emplacement par défaut, renseignez ce réglage.
- Les raccourcis en conflit avec VS Code sont retirés : `Ctrl+Shift+G` (`Cmd+Shift+G`), qui remplaçait l'ouverture du contrôle de code source, et `Ctrl+Alt+I` (`Cmd+Alt+I`), qui remplaçait l'ouverture de la vue Chat.
- Le paquet ne contient plus de fichiers de test (`GEMINI.md`, `.scenario-manifest.json`).

### Documentation

- Le guide Antigravity a été réécrit d'après une suite de tests de régression, et le README a été mis à jour, avec une section « Fonctionnalités expérimentales ».
- Un fichier `SECURITY.md` explique comment signaler une faille en privé.

## [0.3.0] — 2026-10-16

Première version publique : prise en charge des profils utilisateurs, suivi des tokens au démarrage, détection des doublons entre les niveaux global et local, alertes du Coach IA et synchronisation avec le catalogue NAS.

[Non publié]: https://github.com/divadparad-gmail/skills-rules-manager/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/divadparad-gmail/skills-rules-manager/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/divadparad-gmail/skills-rules-manager/releases/tag/v0.3.0
