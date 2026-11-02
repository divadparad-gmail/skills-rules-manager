# Suite de régression « injection-contexte » (Antigravity IDE)

Cette suite fige le comportement d'**Antigravity IDE**, version par version : quand et comment Antigravity injecte des règles, des skills et des plugins dans le contexte de l'agent. Elle garde une baseline par version mesurée : la **2.5.5**, observée le 2026-10-21, et la **2.6.0**, observée le 2026-10-28. En relançant la sonde plus tard, chaque écart avec la baseline de la version indique précisément quel comportement a changé.

Ces comportements ne sont pas testables par du code seul, car ils dépendent du runtime d'Antigravity et d'une conversation d'agent fraîche. La suite fonctionne donc en deux temps :

1. Une **sonde**, c'est-à-dire un prompt figé ([SONDE.md](SONDE.md)), que tu lances toi-même dans Antigravity IDE. L'agent sondé écrit un rapport JSON dans `resultats/`.
2. Un **test automatisé**, qui compare le dernier rapport à la baseline de sa version : [`attendu/baseline-2026-10-21.json`](attendu/baseline-2026-10-21.json) pour la 2.5.5, ou [`attendu/baseline-2026-10-28.json`](attendu/baseline-2026-10-28.json) pour la 2.6.0.

Les douze scénarios, leur résultat figé et la tactique à suivre en cas d'écart sont décrits dans [SCENARIOS.md](SCENARIOS.md).

## Contenu du dossier

| Élément | Rôle |
|---|---|
| `SONDE.md` | Le prompt figé à coller dans Antigravity. Ne le modifie pas : les deux baselines correspondent à la version 1 de la sonde. |
| `SCENARIOS.md` | Le résumé des scénarios, avec une colonne de résultat par baseline, et la ligne « Si ça change » citée par le test en cas d'écart. |
| `attendu/baseline-2026-10-21.json` | Antigravity IDE 2.5.5 : les 156 résultats attendus, dont 105 observés pendant l'enquête et 51 transposés. |
| `attendu/baseline-2026-10-28.json` | Antigravity IDE 2.6.0 : les mêmes 156 entrées, toutes observées le 2026-10-28, dont 21 valeurs différentes de la 2.5.5. |
| `resultats/` | Les rapports produits par la sonde (`AAAA-MM-JJ-HHMM.json`) et les notes des tests manuels (`manuel-AAAA-MM-JJ.md`). |
| `historique/2026-10-21/` | Les rapports bruts de l'enquête d'origine. |
| `GEMINI.md`, `.agents/`, `sandbox-enquete/`, `src/` | Les fixtures : les règles, le skill, le plugin et les fichiers cibles de la sonde. |

Les fixtures sont au format Antigravity (`.agents/rules/*.md` avec `trigger:` et `globs:`). Plusieurs sont **volontairement invalides ou inefficaces** (liste YAML, motif avec chemin, fichier sans frontmatter) : c'est exactement ce que la suite mesure. Ne les corrige pas.

Le dossier est placé à côté de `test/scenarios/antigravity/`, et non à l'intérieur, pour que le banc d'essai (`npm run test:deploy-antigravity` et le bouton de l'extension) ne le copie jamais à la racine du dépôt.

## Commandes

Toutes les commandes se lancent depuis la **racine du dépôt**, pas depuis ce dossier.

| Commande | Effet |
|---|---|
| `npm test` | Lance tous les tests du dépôt, dont le **test statique** de cette suite : intégrité des fixtures, unicité des canaris, validité des baselines et contrôle du comparateur. La comparaison au rapport de sonde y est toujours ignorée. |
| `npm run test:injection` | Compile les tests, puis lance cette suite avec `INJECTION_COMPARE=1` : le test statique **et la comparaison** du dernier rapport à la baseline de sa version. Tout écart fait échouer la commande. |
| `npm run test:injection-reset` | Remet les fixtures dans l'état d'avant la sonde : restaure `sandbox-enquete/sous/module.ts` et supprime `sandbox-enquete/nouveau.ts`. Ne touche jamais à `resultats/` ni à `historique/`. |

Les scripts associés se trouvent dans `test/scenarios/scripts/` :
- `compare-injection-contexte.js` est le lanceur de `test:injection`. Il définit `INJECTION_COMPARE=1` de façon portable, sans `cross-env`.
- `reset-injection-contexte.js` est le script de réinitialisation.
- `generate-injection-contexte-r-tronque.js` a généré la fixture `.agents/rules/r-tronque.md` (30 018 octets). Le test statique vérifie que le fichier commité est identique à sa sortie. Ne le relance que si tu modifies volontairement cette fixture : `node test/scenarios/scripts/generate-injection-contexte-r-tronque.js`.

## Préconditions de la sonde

**🛑 Arrête-toi avant de coller le moindre message de sonde**, et valide ces points un par un :

1. Le modèle est **Gemini 3.8 Flash (High)**.
2. Le Permission Preset est **Turbo**.
3. La Plan Review Policy est **Always Ask**.
4. La Browser Javascript Execution Policy est **Request Review**.
5. **Une seule fenêtre** d'Antigravity est ouverte : toute autre fenêtre d'Antigravity est fermée.
6. Le dossier ouvert est celui que la sonde indique (ce dossier, ou l'espace de la sonde), seul, et jamais la racine du dépôt.
7. Aucun onglet d'éditeur n'est ouvert après `Developer: Reload Window`.

Les réglages 2 à 4 sont ceux de toutes les sondes menées depuis le 2026-10-28.

**Ouvre une conversation neuve avant tout message.** Au lancement, Antigravity rouvre la dernière conversation (observé le 2026-11-02) : un message envoyé dans celle-ci mêlerait deux contextes.

**Après la sonde :**

1. Quitte Antigravity (Fichier > Quitter) et note l'heure.
2. Attends qu'aucun processus `agy` ni `Antigravity` ne figure dans le Gestionnaire des tâches, puis une minute de plus. Le moteur `agy` peut tourner jusqu'à 6 minutes après la fermeture de l'IDE (observé le 2026-10-28).
3. À la prochaine ouverture, remets le Permission Preset sur **Request Review**. Le préréglage Turbo ne change pas seulement les permissions : il modifie aussi, dans `~/.gemini/config/config.json`, l'exécution automatique (`autoExecutionPolicy`) et l'accès aux fichiers hors de l'espace de travail (`nonWorkspaceFileAccessPolicy`). Le retour à Request Review rétablit ces deux réglages : après ce retour, le fichier était identique, octet pour octet, à sa copie d'avant la sonde (observé le 2026-11-02).

## Procédure d'exécution

1. **Réinitialise les fixtures** depuis la racine du dépôt : `npm run test:injection-reset`.
2. **Ouvre ce dossier comme espace de travail autonome** dans Antigravity IDE : Fichier > Ouvrir le dossier, puis `test/scenarios/antigravity-injection-contexte/`. C'est indispensable, car Antigravity ne lit pas le dossier `.agents/` d'un sous-dossier : les fixtures doivent être à la racine de l'espace de travail ouvert.
3. **Recharge la fenêtre** avec la commande `Developer: Reload Window`.
4. **Ouvre une nouvelle conversation** et colles-y tout le contenu de [SONDE.md](SONDE.md).
5. **Vérifie qu'un fichier est apparu** dans `resultats/`, nommé `AAAA-MM-JJ-HHMM.json`.
6. **Note la version d'Antigravity avant la comparaison.** Dans l'objet `meta` du rapport, remplace la valeur `"A_REMPLIR"` de la clé `version_antigravity` par la version affichée dans Help > About, par exemple `"2.6.0"`. L'agent sondé écrit parfois `INCONNU`, car il ne voit pas la version : remplace aussi cette valeur. **La comparaison choisit la baseline d'après cette version** : tant qu'elle est absente ou vaut `A_REMPLIR` ou `INCONNU`, la comparaison échoue avec le message « Version d'Antigravity non renseignée dans le rapport : note-la d'abord… », sans rien deviner. **Ne renomme pas le fichier** : seuls les noms au format `AAAA-MM-JJ-HHMM.json` sont retenus automatiquement.
7. **Lance la comparaison** depuis la racine du dépôt : `npm run test:injection`. Si le test de confidentialité échoue (« Chemin personnel, de lecteur ou réseau : caviarder avant de commiter »), le rapport contient un chemin à masquer : **caviarde-le avant de le commiter**. C'est aussi le cas d'un chemin écrit en `~/…`, comme la sonde l'autorise, dès qu'il sort de `~/.gemini/` ou de `~/.claude/`. Remplace le chemin du projet, avec tout ce qui le précède, par `<PROJET>`, et celui du dossier personnel par `<HOME>`, aux lignes que le message indique.
8. **Relance la réinitialisation** : `npm run test:injection-reset`.

Pendant l'étape 7, la vérification « état avant sonde » du test statique est volontairement ignorée, car la sonde vient de modifier `module.ts` et de créer `nouveau.ts`. Si tu lances `npm test` sans avoir fait l'étape 8, ce test échoue avec le message « lance le script de réinitialisation ».

**La sonde reste en version 1.** `SONDE.md` n'a pas changé depuis le 2026-10-21, et les deux baselines y correspondent. L'étape E5 demande de lister un dossier sans nommer d'outil : en 2.5.5, l'agent utilise `list_dir` ; en 2.6.0, où `list_dir` n'existe plus, il passe par `run_command` (`Get-ChildItem`). Les deux mesures restent comparables (voir SC09 dans [SCENARIOS.md](SCENARIOS.md)).

**Remarques propres à la 2.6.0.**
- Tant qu'aucune conversation n'est ouverte, le moteur `agy` garde actif le dernier projet utilisé. L'avertissement « N customizations failed to load » et le panneau Settings peuvent donc décrire le projet précédent. Avec ce dossier ouvert, l'avertissement attendu est « 3 customizations failed to load » : ce sont les trois règles en liste YAML (SC04).
- Le moteur `agy` peut continuer d'écrire dans `~/.gemini/antigravity/` plusieurs minutes après la fermeture de l'IDE. Si tu compares des instantanés de ton profil avant et après la sonde, attends qu'aucun processus `agy` ne tourne.

## Dépendance à l'environnement

L'espace de travail sondé n'est pas isolé. Antigravity charge aussi les règles des dossiers parents, jusqu'à la racine du dépôt Git : le `GEMINI.md` et les règles `.agents/rules/*` de la racine du projet, en plus des règles globales `~/.gemini/` comme `~/.gemini/GEMINI.md`. Cela a été constaté en 2.5.5 lors de l'étalonnage du 2026-10-21, puis en 2.6.0 le 2026-10-28 (voir SC08 dans [SCENARIOS.md](SCENARIOS.md)). La sonde rapporte ces règles dans `autres_regles`, que le test affiche sans les comparer.

Ces règles s'ajoutent à celles de la suite et **partagent le budget de 20 000 tokens des règles permanentes**. Une grosse règle `always_on` ajoutée à la racine du projet ou dans `~/.gemini/` pourrait donc faire rétrograder `r-tronque.md` en simple pointeur, et produire un **faux écart sur SC01**.

**En cas d'écart sur SC01, vérifie d'abord la taille totale des règles permanentes de la racine** : le `GEMINI.md` et les fichiers `trigger: always_on` de `.agents/rules/` à la racine du dépôt, ainsi que `~/.gemini/GEMINI.md`. Ne conclus à un changement d'Antigravity qu'après avoir écarté cette cause.

À titre de repère :
- au moment de l'étalonnage de la 2.5.5 (2026-10-21), les règles permanentes de la racine du projet totalisaient 41 095 octets, car le banc d'essai était déployé. `06-rule-warn-size-exceeded-24kb.md` en représentait à lui seul 39 106 ; les autres étaient `GEMINI.md`, `02-rule-perm-standard-always-on.md`, `08-rule-dedup-active.md` et `rule-test-doublon.md` ;
- au moment de la mesure de la 2.6.0 (2026-10-28), la racine n'avait ni `GEMINI.md` ni banc d'essai déployé. Ses seules règles permanentes étaient `09-rule-securite-code.md` (2 062 octets) et `projet-consignes.md` (1 210 octets) ; `09b-rule-securite-code-detail.md`, en `model_decision`, ne figurait que dans l'index.

## Lire le résultat de la comparaison

Le test affiche le rapport comparé et la baseline retenue, avec la raison de ce choix. Il affiche ensuite un tableau `id | scénario | attendu | observé | confiance | verdict`, avec une ligne par entrée de la baseline, puis :

- **En cas d'écart**, la commande échoue et liste chaque scénario touché, avec le nombre d'écarts et sa ligne « Si ça change » de [SCENARIOS.md](SCENARIOS.md). Une entrée absente du rapport, par exemple une étape manquante, compte comme un écart et s'affiche « (absent du rapport) ». Une valeur `null` écrite par l'agent s'affiche `null` : elle n'est conforme que si la baseline attend `null` (S11 en 2.6.0).
- **Rapport suspect.** Si l'agent sondé déclare des infractions dans `meta.infractions` (lecture interdite, recherche textuelle…), un avertissement « RAPPORT SUSPECT » cite chacune d'elles. Vérifie-les avant de conclure à un changement d'Antigravity.
- **Informations, jamais en échec** : les canaris observés dans des cellules non figées, les `autres_regles` de chaque étape, `S5.octets_tronques`, `S10` (MCP) et `S12` (skills intégrés).
- **Fichiers ignorés.** Tout autre fichier `.json` de `resultats/` est signalé par un avertissement et n'est pas comparé.
- **Version non renseignée ou inconnue.** Si `meta.version_antigravity` est absente ou vaut `A_REMPLIR` ou `INCONNU`, la comparaison échoue et demande de noter la version d'abord (voir l'étape 6). Si la version n'a pas de baseline, par exemple `2.7.0`, la comparaison échoue aussi : désigne une baseline avec `SONDE_BASELINE`, ou crée une nouvelle baseline datée.

Le test tolère la rédaction libre de l'agent sondé :
- Dans `canaris`, chaque élément est fouillé, sans tenir compte de la casse. Par exemple, `"CANARI-G3 (réinjecté)"` compte comme `CANARI-G3`, et un élément sans canari est ignoré.
- Pour `S11` en 2.5.5, les guillemets et les accents graves sont retirés, et la valeur doit **contenir** le préambule attendu. En 2.6.0, `S11` doit valoir `null` de façon explicite.

### Comparer un rapport précis

La variable `SONDE_RAPPORT` désigne un rapport à comparer à la place du plus récent. Elle accepte un nom quelconque, et un chemin relatif est résolu depuis le dossier où la commande est lancée.

```powershell
# PowerShell
$env:SONDE_RAPPORT = "test/scenarios/antigravity-injection-contexte/resultats/2027-01-15-0930.json"; npm run test:injection; Remove-Item Env:SONDE_RAPPORT
```

```bash
# Bash
SONDE_RAPPORT=test/scenarios/antigravity-injection-contexte/resultats/2027-01-15-0930.json npm run test:injection
```

### Forcer une baseline

La variable `SONDE_BASELINE` impose la baseline, quelle que soit la version notée dans le rapport. Elle accepte la version (`2.5.5`, `2.6.0`), la date (`2026-10-21`, `2026-10-28`) ou le nom du fichier. Elle sert surtout à un contrôle croisé, par exemple pour mesurer ce qui a changé entre deux versions :

```powershell
# PowerShell : le rapport 2.6.0 comparé à la baseline 2.5.5 (21 écarts attendus)
$env:SONDE_RAPPORT = "test/scenarios/antigravity-injection-contexte/resultats/2026-10-28-1341.json"; $env:SONDE_BASELINE = "2.5.5"; npm run test:injection; Remove-Item Env:SONDE_RAPPORT, Env:SONDE_BASELINE
```

```bash
# Bash
SONDE_RAPPORT=test/scenarios/antigravity-injection-contexte/resultats/2026-10-28-1341.json SONDE_BASELINE=2.5.5 npm run test:injection
```

### Quand un écart est confirmé

Ne modifie jamais une baseline existante : chacune reste la trace de ce qui a été mesuré à sa date, pour sa version. Suis d'abord la ligne « Si ça change » du scénario concerné. Pour figer le comportement d'une nouvelle version, crée une nouvelle baseline datée, avec les mêmes entrées, et ajoute-la à la table `BASELINES` de `test/antigravity-injection-contexte.test.ts`, avec sa version et ses comptes. Ajoute aussi sa colonne dans le tableau récapitulatif de [SCENARIOS.md](SCENARIOS.md), avant la colonne « Si ça change ».

## Tests manuels

Ces tests couvrent des points que la sonde ne mesure pas (voir la section « Non couvert par la sonde » de [SCENARIOS.md](SCENARIOS.md)). Leurs résultats attendus ne sont pas figés.

Chaque test se fait **dans une nouvelle conversation**, avec ce même dossier ouvert comme espace de travail. Note le résultat dans `resultats/manuel-AAAA-MM-JJ.md` : ce fichier n'est pas un `.json`, donc le test de comparaison l'ignore.

- **Règle manuelle.** Tape `@zz-manual` dans le chat, puis demande « Quelles chaînes CANARI- vois-tu dans ton contexte ? ». Résultat attendu, non figé : `CANARI-MANUAL` est présent.
- **Skill en commande slash.** Tape `/zz-skill-test`. Note si la commande existe dans l'IDE et si `CANARI-SKILL-CORPS` apparaît.
- **Activation `model_decision`.** Demande « Parle-moi des licornes quantiques. », puis « Quelles chaînes CANARI- vois-tu ? ». Note si `CANARI-MODEL` apparaît, et sous quelle forme.

Après chaque test manuel, relance `npm run test:injection-reset`.

## Garde-fous du test statique

Le test statique échoue si une fixture est modifiée par accident, car une fixture abîmée fausserait toutes les comparaisons. Il vérifie notamment :
- que chaque fixture a son contenu exact, et que `zz-sans-fm.md` n'a pas de frontmatter ;
- que `r-tronque.md` dépasse 24 000 octets et reste bornée par `CANARI-TRONQUE-DEBUT` et `CANARI-TRONQUE-FIN` ;
- qu'aucun fichier inattendu n'a été ajouté à l'espace de travail sondé ;
- que chaque canari n'apparaît que dans sa fixture. Les seules exceptions sont `README.md`, `SCENARIOS.md`, `SONDE.md`, `attendu/`, `resultats/` et `historique/` ;
- qu'aucun fichier de `resultats/` ni de `historique/` ne contient de chemin à caviarder. Sont refusés partout : les chemins de lecteur (`X:\…`, `file:///x:/…`), les chemins réseau (`\\serveur\…`, qui révèlent un nom d'hôte) et les dossiers utilisateur macOS ou Linux (`/Users/…`, `/home/…`). Dans le dossier personnel (`~`, `<HOME>`, `%USERPROFILE%`, `$HOME`), seuls `.gemini/` et `.claude/` sont permis. Le message d'échec cite le fichier et la ligne, sans recopier le chemin.

Si tu ajoutes un document dans ce dossier, ajoute-le à la liste `DOCS` du test : sinon, il sera signalé comme fichier parasite.
