# Scénarios de la suite « injection-contexte »

Ce document décrit les douze scénarios qui figent le comportement d'Antigravity IDE, version par version : quand et comment Antigravity injecte des règles, des skills et des plugins dans le contexte de l'agent. La procédure d'exécution se trouve dans le [README.md](README.md).

Deux baselines coexistent. Aucune ne remplace l'autre :

| Baseline | Version | Mesure | Rapport de référence |
|---|---|---|---|
| [`attendu/baseline-2026-10-21.json`](attendu/baseline-2026-10-21.json) | Antigravity IDE 2.5.5 | Enquête, puis étalonnage du 2026-10-21 | `resultats/2026-10-21-1714.json` |
| [`attendu/baseline-2026-10-28.json`](attendu/baseline-2026-10-28.json) | Antigravity IDE 2.6.0 (moteur `agy` v1.4.9) | Rejeu du 2026-10-28, confirmé par les transcriptions des conversations | `resultats/2026-10-28-1341.json` |

Les deux baselines portent les mêmes 156 entrées ; seules les valeurs attendues changent. La comparaison choisit la baseline selon la version notée dans le rapport. Chaque scénario regroupe des entrées de ces baselines. Quand le test de comparaison détecte un écart, il cite la colonne « Si ça change » du tableau ci-dessous pour chaque scénario touché.

## Tableau récapitulatif

> Le test `test/antigravity-injection-contexte.test.ts` lit ce tableau : garde l'identifiant `SCxx` en première colonne et la tactique « Si ça change » en dernière colonne. Une nouvelle baseline ajoute une colonne avant la dernière.

| ID | Scénario | Résultat figé en 2.5.5 (2026-10-21) | Résultat figé en 2.6.0 (2026-10-28) | Si ça change |
|---|---|---|---|---|
| SC01 | Règles permanentes et troncature | Contenu complet en `<RULE[…]>`, coupé au-delà de 24 Ko | Identique | Recalibrer la taille max dans le profil de comportement de la version concernée |
| SC02 | Glob par nom de fichier | `*.ts`, `**/*.ts`, `app.ts` fonctionnent | Aucune règle glob injectée, avec `globs:` comme avec `glob:` | 2.5.5 : revoir toutes les règles glob. 2.6.0 : si un glob réapparaît, revoir le profil de comportement 2.6.0 de l'extension |
| SC03 | Glob avec chemin | Ne se déclenche jamais (G1, G2, G5, G6, GLOB-CHAINE, MIXTE) | Ne se déclenche jamais, comme tout glob | Si G6 passe à présent : revenir à des motifs `src/**` plus précis ; en 2.6.0, vérifier d'abord SC02 |
| SC04 | Format de `globs` | Liste YAML rejetée, chaîne acceptée | Liste YAML toujours rejetée au chargement ; chaîne chargée, mais jamais injectée | Si L1 passe : la liste devient utilisable ; en 2.6.0, vérifier d'abord SC02 |
| SC05 | Frontmatter mixte (`paths:` + `globs:`) | Accepté (L2) | Chargé sans erreur, jamais injecté, comme tout glob | Si L2 disparaît en 2.5.5 : un fichier par outil. Si L2 apparaît en 2.6.0 : le glob est revenu, voir SC02 |
| SC06 | Activation `manual` / `model_decision` | Manual absente, model_decision = index chemin + description | Identique | Revoir le coût au démarrage dans le profil de comportement de la version concernée |
| SC07 | Rejet sans frontmatter | Règle ignorée silencieusement | Identique ; le journal d'`agy` trace le rejet | L'extension doit continuer à signaler ce cas, dans les deux versions |
| SC08 | `AGENTS.md` de sous-dossier | Jamais chargé | Jamais chargé, ni même découvert | Si DOSSIER apparaît : les règles de dossier redeviennent utilisables pour cette version |
| SC09 | Déclencheurs | Lecture, modification, création ; jamais `list_dir` | Aucun déclencheur ; `list_dir` n'existe plus, le listing passe par `run_command` | Revoir la colonne « Comportement » du guide, pour la version concernée |
| SC10 | Skills et plugins | Index nom + chemin + description ; pas de préfixe plugin ; annexes jamais chargées ; section `<plugins>` | Identique, sauf : plus de section `<plugins>`, remplacée par `<featured_plugins>`, sans le plugin du projet | Revoir la ligne Skills et Plugins, et le comptage des plugins du profil concerné |
| SC11 | Forme de l'injection | Suffixe du résultat d'outil, préambule figé (S11) | Aucun préambule (S11 = `null`) | Mettre à jour la doc de l'extension ; en 2.6.0, un préambule réapparu signale le retour du glob (SC02) |
| SC12 | Workflows et MCP | `/migrate-workflows` absent ; MCP en noms seuls | Identique ; `migrate-workflows` est un skill intégré, absent des commandes slash | Informatif |

## Comment lire les sections

**Les étapes de la sonde** (voir [SONDE.md](SONDE.md)) :

| Étape | Action de l'agent sondé |
|---|---|
| E0 | Inspection du contexte initial, sans outil |
| E1 | Lecture de `sandbox-enquete/app.ts` |
| E2 | Lecture de `sandbox-enquete/notes.md` |
| E3 | Lecture de `src/zz-test.ts` |
| E4 | Lecture de `sandbox-enquete/sous/profond/x.ts` |
| E5 | Listing de `sandbox-enquete/sous/` : `list_dir` en 2.5.5 ; `run_command` (`Get-ChildItem`) en 2.6.0, où `list_dir` n'existe plus |
| E6 | Lecture de `sandbox-enquete/sous/module.ts` |
| E7 | Modification de `sandbox-enquete/sous/module.ts` |
| E8 | Création de `sandbox-enquete/nouveau.ts` |
| E9 | Utilisation du skill `zz-skill-test` (lecture de `SKILL.md` seulement) |

**La confiance.** Dans la baseline 2.5.5, une étape suivie d'un astérisque (`E2*`) est une entrée **transposée** : le mécanisme a été observé sur une autre règle pendant l'enquête, mais ce canari précis est nouveau. Une étape sans astérisque est une entrée **observée** telle quelle le 2026-10-21. Un écart sur une entrée transposée peut donc venir de la transposition elle-même plutôt que d'un changement d'Antigravity. Dans la baseline 2.6.0, toutes les entrées sont **observées** : chacune a été mesurée telle quelle le 2026-10-28. Les astérisques des sections ci-dessous ne concernent que la 2.5.5.

**Étalonnage de la 2.5.5.** L'étalonnage du 2026-10-21 à 17:14 (`resultats/2026-10-21-1714.json`, Antigravity IDE 2.5.5) a confirmé les 51 entrées transposées, ainsi que les 105 entrées observées : 156 conformes sur 156, sans infraction. Leur confiance reste `transpose` dans la baseline, qui garde la trace de ce qui avait été mesuré pendant l'enquête.

**Mesure de la 2.6.0.** Le rejeu du 2026-10-28 à 13:41 (`resultats/2026-10-28-1341.json`, Antigravity IDE 2.6.0, Gemini 3.8 Flash (High)) a donné 135 entrées conformes à la baseline 2.5.5 et 21 écarts : SC02 (9), SC09 (6), SC05 (4), SC10 (1) et SC11 (1). L'absence des règles glob et du préambule ne repose pas seulement sur le compte rendu de l'agent sondé : elle est confirmée par les transcriptions des conversations, sur dix points d'entrée (chantier « Antigravity 2.6.0 », phase 2b, parties 2, 4 et 6).

**L'attribution des entrées.** Une entrée appartient par défaut au scénario de son canari. Deux exceptions s'appliquent :
- À l'étape E5 (le listing), toutes les entrées relèvent de SC09, sauf `CANARI-DOSSIER`, qui reste dans SC08.
- Aux étapes E7 et E8 (modification et création), les entrées où le canari est attendu **présent** relèvent de SC09. Les entrées attendues absentes restent dans le scénario de leur canari.

Ainsi, une règle glob qui ne se déclenche plus à la modification renvoie à SC09, tandis qu'une règle glob avec chemin qui se met à fonctionner renvoie à SC03.

**Les cellules non figées.** Les cellules marquées « – » dans la matrice d'origine n'ont pas d'entrée dans la baseline. Le test les affiche à titre d'information, sans jamais échouer.

---

## SC01 — Règles permanentes et troncature

**Ce qu'on teste.** Une règle `always_on` et le fichier `GEMINI.md` à la racine de l'espace de travail sont injectés en entier dès le démarrage. Une règle permanente qui dépasse 24 Ko est coupée.

**Fixtures.** `.agents/rules/r-always.md`, `.agents/rules/r-tronque.md` (30 018 octets, générée par `test/scenarios/scripts/generate-injection-contexte-r-tronque.js`) et `GEMINI.md`.

**Entrées de la baseline (6, dont 1 observée et 5 transposées).**
- `CANARI-ALWAYS` : présent en E0*.
- `CANARI-TRONQUE-DEBUT` : présent en E0*.
- `CANARI-TRONQUE-FIN` : absent en E0*.
- `CANARI-RACINE` : présent en E0*.
- `S4` (la règle est entourée d'une balise `<RULE[...]>`) : `true`.
- `S5.present` (un marqueur `<truncated N bytes>` apparaît) : `true`*.

**Résultat figé en 2.5.5.** Le contenu complet est entouré de `<RULE[chemin]>…</RULE[chemin]>`. Au-delà de 24 Ko, le contenu est coupé avec un marqueur `<truncated N bytes>`. Pendant l'enquête, la règle 06 du banc d'essai affichait `<truncated 14978 bytes>`. La valeur de N mesurée par la sonde (`S5.octets_tronques`) est affichée sans être comparée : 5 957 à l'étalonnage.

**En 2.6.0.** Identique. `S5.octets_tronques` vaut 5 960, et le journal d'`agy` confirme la limite (« limit 24000 bytes »). L'écart de 3 octets correspond à une coupe sur la dernière fin de ligne avant 24 000 octets, comme l'annonce la documentation intégrée de la 2.6.0 (déduit ici, non comparé par la suite). Cette règle de coupe a été observée le 2026-11-02, hors de cette suite, sur la règle 06 du banc d'essai : 15 090 octets coupés, conformes au calcul.

**Si ça change.** Recalibrer la taille maximale dans le profil de comportement de la version concernée. Si `CANARI-TRONQUE-FIN` apparaît, la limite a augmenté ou disparu. Si `CANARI-TRONQUE-DEBUT` disparaît, la règle n'est peut-être plus chargée du tout.

## SC02 — Glob par nom de fichier

**Ce qu'on teste.** Une règle `trigger: glob` ne coûte rien au démarrage. Elle est injectée quand le **nom** du fichier lu correspond au motif.

**Fixtures.** `zz-glob-ext.md` (`"*.ts, *.tsx"`), `zz-g3.md` (`"**/*.ts"`) et `zz-g4.md` (`"app.ts"`).

**Entrées de la baseline (20, dont 9 observées et 11 transposées).**
- `CANARI-GLOB-EXT` : présent en E1*, E3*, E4* et E6* ; absent en E0* et E2*.
- `CANARI-G3` : présent en E1, E3, E4 et E6* ; absent en E0 et E2*.
- `CANARI-G4` : présent en E1 ; absent en E0, E2*, E3, E4, E6*, E7 et E8*.

**Résultat figé en 2.5.5.** `*.ts`, `**/*.ts` et `app.ts` fonctionnent, quel que soit le dossier du fichier. Un fichier `.md` (E2) ne déclenche aucune de ces règles, et `app.ts` ne correspond qu'à `sandbox-enquete/app.ts`.

**En 2.6.0.** Aucune règle glob n'est injectée, à aucune étape : les 9 entrées « présent » de la 2.5.5 passent à « absent ». Les règles sont pourtant chargées sans erreur, puisqu'elles figurent dans l'état interne du moteur et dans le panneau Settings. Les transcriptions le confirment sur dix points d'entrée (lecture, modification, création, commande, onglet actif, mention `@`), avec la clé `globs:` des fixtures comme avec la clé `glob:` au singulier, celle du modèle de nouvelle règle de la 2.6.0, testée dans une fixture temporaire, hors de la suite.

**Si ça change.** En 2.5.5, revoir toutes les règles glob. En 2.6.0, si un canari glob réapparaît, le glob est revenu : revoir le profil de comportement 2.6.0 de l'extension et le guide, puis rejouer la sonde pour établir une nouvelle baseline.

## SC03 — Glob avec chemin

**Ce qu'on teste.** Antigravity compare seulement le nom de fichier au motif. Un motif qui contient un dossier ne se déclenche donc jamais.

**Fixtures.** `zz-g1.md` (`"**/sandbox-enquete/**/*.ts"`), `zz-g2.md` (`"sandbox-enquete/*.ts"`), `zz-g5.md` (`'sandbox-enquete\**\*.ts'`), `zz-g6.md` (`"src/**/*.ts"`), `zz-glob-chaine.md` (`"sandbox-enquete/**/*.ts"`) et `zz-mixte.md` (même motif, avec une clé `paths:` en plus).

**Entrées de la baseline (36, dont 32 observées et 4 transposées).**
- `CANARI-GLOB-CHAINE` et `CANARI-MIXTE` : absents en E0, E1, E2, E3, E4 et E7.
- `CANARI-G1`, `CANARI-G2`, `CANARI-G5` et `CANARI-G6` : absents en E0, E1, E2*, E3, E4 et E7.

**Résultat figé en 2.5.5.** Aucun de ces motifs ne se déclenche, ni à la lecture, ni à la modification. `CANARI-G6` est le témoin le plus direct : son motif `src/**/*.ts` correspond pourtant au fichier lu en E3.

**En 2.6.0.** Les valeurs sont les mêmes, mais leur absence est désormais triviale : aucune règle glob ne se déclenche (SC02).

**Si ça change.** Si G6 passe à présent, revenir à des motifs `src/**` plus précis. Si seuls certains motifs passent, comparer G1 (préfixe `**/`), G2 (un seul niveau) et G5 (antislash) pour savoir quelle forme de chemin Antigravity reconnaît désormais. En 2.6.0, vérifier d'abord SC02 : un motif avec chemin ne peut fonctionner que si le glob est revenu.

## SC04 — Format de `globs`

**Ce qu'on teste.** La clé `globs` écrite en liste YAML est rejetée en silence. Seule la chaîne séparée par des virgules fonctionne.

**Fixtures.** `zz-l1.md` (liste à un élément `- "*.ts"`), `zz-l3.md` (liste à deux éléments `- "*.js"` et `- "*.ts"`) et `zz-glob-liste.md` (liste à un élément `- "sandbox-enquete/**/*.ts"`).

**Entrées de la baseline (16, dont 10 observées et 6 transposées).**
- `CANARI-GLOB-LISTE` : absent en E0, E1, E2, E3, E4 et E7.
- `CANARI-L1` : absent en E0, E1, E2*, E3* et E4*.
- `CANARI-L3` : absent en E0, E1, E2*, E3* et E4*.

**Résultat figé.** Aucune règle écrite en liste YAML ne se déclenche, même avec un motif qui fonctionne en chaîne (`*.ts`, comparé à SC02).

**Attention : `CANARI-GLOB-LISTE` cumule deux conditions.** Sa règle combine le format en liste YAML **et** un motif avec chemin, qui ne se déclenche jamais d'après SC03. Ce canari ne peut donc passer à « présent » que si les deux comportements changent en même temps. Il ne permet pas, à lui seul, de savoir si le format en liste est devenu utilisable. **Le témoin du format en liste seul est `CANARI-L1`**, dont le motif `*.ts` fonctionne en chaîne. `CANARI-L3` confirme le cas d'une liste à plusieurs éléments.

**En 2.6.0.** Les valeurs sont les mêmes. Les trois règles en liste YAML échouent toujours au chargement : l'IDE affiche « 3 customizations failed to load », et elles sont absentes du panneau Settings. Une règle en chaîne est chargée, mais jamais injectée (SC02).

**Si ça change.** Si L1 passe, la liste devient utilisable. Si L1 passe mais pas L3, seule la liste à un élément est acceptée. En 2.6.0, vérifier d'abord SC02.

## SC05 — Frontmatter mixte (`paths:` + `globs:`)

**Ce qu'on teste.** Une clé `paths:` propre à Claude Code, ajoutée à côté d'une clé `globs:` en chaîne, ne casse pas la règle Antigravity. Un même fichier peut donc servir aux deux outils.

**Fixture.** `zz-l2.md` (`globs: "*.ts"` et `paths:` en liste `- "src/**/*.ts"`).

**Entrées de la baseline (6, dont 2 observées et 4 transposées).**
- `CANARI-L2` : présent en E1, E3*, E4* et E6* ; absent en E0 et E2*.

Les entrées de `CANARI-L2` aux étapes E7 et E8 relèvent de SC09.

**Résultat figé en 2.5.5.** La règle se comporte exactement comme une règle `globs: "*.ts"` seule. La clé `paths:` est ignorée.

**En 2.6.0.** `CANARI-L2` n'apparaît plus, comme tous les canaris glob : les 4 entrées « présent » de ce scénario passent à « absent ». La clé `paths:` ne casse toujours pas la règle, qui est chargée sans erreur et listée dans le panneau Settings.

**Si ça change.** En 2.5.5, si L2 disparaît, il faut un fichier par outil. En 2.6.0, si L2 apparaît, le glob est revenu : voir SC02.

## SC06 — Activation `manual` / `model_decision`

**Ce qu'on teste.** Ce que coûtent au démarrage les règles qui ne s'activent ni en permanence ni par motif.

**Fixtures.** `zz-model.md` (`trigger: model_decision`, description sur les licornes quantiques) et `zz-manual.md` (`trigger: manual`).

**Entrées de la baseline (17, toutes observées).**
- `CANARI-MODEL` : absent en E0, E1, E2, E3, E4, E6 et E7.
- `CANARI-MANUAL` : absent en E0, E1, E2, E3, E4, E6 et E7.
- `S6` (l'index des règles conditionnelles contient `zz-model.md` avec sa description) : `true`.
- `S7` (cet index contient `zz-manual.md`) : `false`.
- `S8` (cet index contient une règle `glob`) : `false`.

**Résultat figé en 2.5.5.** Une règle `manual` est totalement absente au démarrage. Pour une règle `model_decision`, seuls le chemin `file:///…` et la description figurent dans l'index au démarrage, jamais le corps. Les règles `glob` ne figurent pas dans cet index.

**En 2.6.0.** Identique.

**Si ça change.** Revoir le coût au démarrage dans le profil de comportement de la version concernée.

## SC07 — Rejet sans frontmatter

**Ce qu'on teste.** Une règle placée dans `.agents/rules/` sans frontmatter n'est jamais chargée.

**Fixture.** `zz-sans-fm.md`, dont le contenu se limite au canari.

**Entrées de la baseline (7, toutes observées).**
- `CANARI-SANS-FM` : absent en E0, E1, E2, E3, E4, E6 et E7.

**Résultat figé en 2.5.5.** La règle est ignorée silencieusement, sans message pour l'utilisateur.

**En 2.6.0.** Identique pour le modèle et pour l'utilisateur. Le journal d'`agy` trace toutefois le rejet, à chaque rechargement des règles : « Invalid rule trigger: CORTEX_MEMORY_TRIGGER_UNSPECIFIED ».

**Si ça change.** L'extension doit continuer à signaler ce cas, dans les deux versions. Si la règle apparaît, vérifier sous quelle forme : un chargement permanent par défaut changerait le budget de démarrage.

## SC08 — `AGENTS.md` de sous-dossier

**Ce qu'on teste.** Un fichier `AGENTS.md` placé dans un sous-dossier de l'espace de travail n'est jamais chargé.

**Fixture.** `sandbox-enquete/sous/AGENTS.md`.

**Entrées de la baseline (8, toutes observées).**
- `CANARI-DOSSIER` : absent en E0, E1, E2, E3, E4, E5, E6 et E7.

**Résultat figé en 2.5.5.** Le fichier n'est chargé ni au démarrage, ni à la lecture d'un fichier du dossier (E6) ou d'un sous-dossier (E4), ni au listing du dossier (E5), ni à la modification (E7).

**En 2.6.0.** Le fichier n'est toujours chargé à aucune étape, et il n'est même pas découvert : il est absent de la liste des règles du panneau Settings, et aucune étape `DIRECTORY_RULES` n'apparaît dans les transcriptions, y compris à la lecture de `sous/profond/x.ts`. La documentation intégrée de la 2.6.0 annonce pourtant que l'agent remonte du dossier du fichier ouvert jusqu'à la racine : les tests font foi.

**Précision : les dossiers parents, eux, sont chargés** (informatif). Les `autres_regles` montrent qu'Antigravity charge aussi les règles des dossiers **parents** de l'espace de travail, jusqu'à la racine du dépôt Git, ainsi que le fichier global `~/.gemini/GEMINI.md` :
- **en 2.5.5** (étalonnage du 2026-10-21 à 17:14, étapes E0 à E8) : le `GEMINI.md` et les règles `.agents/rules/*` de la racine du projet, selon leur déclencheur. Les règles permanentes sont chargées au démarrage, la règle `model_decision` figure dans l'index, et la règle glob `03-rule-cond-trigger-glob.md` est injectée à chaque fichier `.ts` ;
- **en 2.6.0** (rapport du 2026-10-28 à 13:41, étape E0) : les deux règles `always_on` de la racine du projet, `09-rule-securite-code.md` et `projet-consignes.md`. La racine n'avait alors ni `GEMINI.md` ni règle glob.

Le chargement remonte donc vers les dossiers parents, mais ne descend jamais dans un sous-dossier. **La forme des chemins dépend de la version.** En 2.5.5, le rapport écrit les chemins de la racine sous la forme `../../…`, alors que la racine du dépôt se trouve trois niveaux au-dessus de la suite (`../../../`) : c'est une approximation de l'agent sondé, laissée telle quelle dans le rapport brut. En 2.6.0, l'agent écrit des chemins en `~/…` à partir du dossier personnel ; le rapport commité les remplace par `<PROJET>/…`, selon la garde de confidentialité. Ces règles s'ajoutent à celles de la suite (voir « Dépendance à l'environnement » dans le [README.md](README.md#dépendance-à-lenvironnement)).

**Si ça change.** Si DOSSIER apparaît, les règles de dossier redeviennent utilisables pour cette version. Noter l'étape où il apparaît : elle indique le déclencheur.

## SC09 — Déclencheurs

**Ce qu'on teste.** Les actions d'outil qui déclenchent l'injection des règles glob : la lecture, la modification et la création, mais jamais le listing d'un dossier.

**Fixtures.** Toutes les règles de `.agents/rules/`. Les cibles sont `sandbox-enquete/sous/` (E5), `sandbox-enquete/sous/module.ts` (E7) et `sandbox-enquete/nouveau.ts` (E8).

**Les outils selon la version.** En 2.5.5, l'agent dispose de `view_file`, `replace_file_content`, `write_to_file` et `list_dir`. En 2.6.0, ces outils ne sont plus déclarés : l'agent utilise `read_file`, `edit_file`, `write_file` et `run_command`. **`list_dir` n'existe plus**, et le listing de l'étape E5 passe par `run_command` (`Get-ChildItem sandbox-enquete/sous`). La consigne de la sonde, « Liste le contenu… », ne nomme aucun outil : elle reste valable sans modification (sonde v1).

**Entrées de la baseline (22, dont 1 observée et 21 transposées).**
- `CANARI-G3` : présent en E7 et E8* ; absent en E5*.
- `CANARI-GLOB-EXT` et `CANARI-L2` : présents en E7* et E8* ; absents en E5*.
- Les 13 autres canaris de règles (`CANARI-GLOB-LISTE`, `CANARI-GLOB-CHAINE`, `CANARI-MIXTE`, `CANARI-SANS-FM`, `CANARI-MODEL`, `CANARI-MANUAL`, `CANARI-G1`, `CANARI-G2`, `CANARI-G4`, `CANARI-G5`, `CANARI-G6`, `CANARI-L1` et `CANARI-L3`) : absents en E5*.

**Résultat figé en 2.5.5.** Une règle glob est injectée à la lecture, à la modification et à la création d'un fichier correspondant. `list_dir` ne déclenche aucune injection. Seule l'entrée `E7:CANARI-G3` a été observée telle quelle : les autres sont transposées de ce constat.

**En 2.6.0.** Aucune action ne déclenche d'injection : les 6 entrées « présent » aux étapes E7 et E8 (`CANARI-G3`, `CANARI-GLOB-EXT` et `CANARI-L2`) passent à « absent ». Le listing par `run_command` n'injecte rien non plus. Les transcriptions confirment que le résultat de chaque outil s'arrête au contenu du fichier ou de la commande.

**Si ça change.** Revoir la colonne « Comportement » du guide, pour la version concernée. En 2.6.0, une injection réapparue signale le retour du glob : voir SC02.

## SC10 — Skills et plugins

**Ce qu'on teste.** La forme de l'index des skills au démarrage, le chargement du corps à la demande, le traitement des dossiers annexes et l'affichage des skills de plugin.

**Fixtures.** `.agents/skills/zz-skill-test/` (`SKILL.md`, `references/ref.md` et `resources/res.md`) et `.agents/plugins/zz-plugin-test/` (`plugin.json` et `skills/zz-plugin-skill/SKILL.md`). Le `SKILL.md` du skill de test se termine par la ligne `(Aucun lien vers les autres fichiers du dossier.)`, présente lors de la mesure : elle fait partie des conditions figées.

**Entrées de la baseline (16, toutes observées).**
- `CANARI-SKILL-CORPS` : présent en E9 ; absent en E0, E1 et E2.
- `CANARI-REFERENCES` et `CANARI-RESOURCES` : absents en E0, E1, E2 et E9.
- `CANARI-PLUGIN-SKILL` : absent en E0.
- `S1` (les entrées de skills ont le format `- <nom> (<chemin>): <description>`) : `true`.
- `S2` (le skill de plugin porte un préfixe de plugin) : `false`.
- `S3` (une section dédiée aux plugins liste `zz-plugin-test`) : `true`.

**Résultat figé en 2.5.5.** Au démarrage, l'index contient seulement `- <nom> (<chemin absolu>): <description>`. Le corps n'arrive qu'à la lecture du `SKILL.md`. Les dossiers `references/` et `resources/` ne sont ni chargés ni signalés. Le skill de plugin s'affiche sans préfixe (`zz-plugin-skill`, et non `zz-plugin-test:zz-plugin-skill`), et une section `<plugins>` séparée liste le plugin.

**En 2.6.0.** Identique, sauf S3, qui passe à `false` : la section `<plugins>` n'existe plus. Elle est remplacée par une section `<featured_plugins>`, qui liste des plugins proposés par Antigravity, mais pas `zz-plugin-test`. Le skill du plugin reste dans l'index des skills, une seule fois et sans préfixe. Le panneau Settings, lui, affiche ce skill avec le badge « Plugin: zz-plugin-test ».

**Si ça change.** Revoir la ligne Skills et Plugins du guide, et le comptage des plugins dans le profil de comportement de la version concernée.

## SC11 — Forme de l'injection

**Ce qu'on teste.** La forme du bloc qu'Antigravity ajoute au résultat d'un outil quand une règle glob se déclenche.

**Fixtures.** Les règles glob qui se déclenchent en E1 (voir SC02).

**Entrée de la baseline (1, observée).**
- `S11` en 2.5.5 : le préambule `The following text is not part of the file, it is a list of user-defined rules that you MUST follow:`.
- `S11` en 2.6.0 : `null`, de façon explicite.

**Résultat figé en 2.5.5.** Les règles sont ajoutées **à la fin** du résultat de l'outil, précédées de ce préambule exact. Le test retire les guillemets et les accents graves de la valeur rapportée, puis vérifie qu'elle **contient** le préambule. Une rédaction plus longue de l'agent sondé reste donc conforme, mais un seul mot changé produit un écart.

**En 2.6.0.** Aucun préambule n'est ajouté au résultat d'un outil, puisqu'aucune règle glob n'est injectée. Le gabarit du préambule existe toujours dans le binaire d'`agy`, mais il n'a jamais été produit. La baseline attend `null` de façon **explicite** : le rapport doit écrire `"S11": null`. Une clé `S11` absente du rapport reste un écart, tout comme un préambule réapparu.

**Si ça change.** Mettre à jour la doc de l'extension. En 2.6.0, un préambule réapparu signale le retour du glob : voir SC02.

## SC12 — Workflows et MCP

**Ce qu'on teste.** Deux éléments visibles au démarrage : la commande `/migrate-workflows` et la présentation des outils MCP.

**Fixtures.** Aucune : ces observations dépendent de l'installation d'Antigravity et de la configuration MCP de l'utilisateur.

**Entrée de la baseline (1, observée).**
- `S9` (`/migrate-workflows` figure dans les commandes slash) : `false`.

**Informations non figées.** `S10` (nombre de descriptions d'outils MCP visibles au démarrage et catégories) et `S12` (emplacement des skills intégrés) sont affichés sans comparaison. Leurs valeurs dépendent de la mesure :
- **pendant l'enquête du 2026-10-21** (`historique/2026-10-21/phase-1-introspection.md`), `S10` montrait 0 description et les catégories `Eager` et `Lazy`, et `S12` montrait `~/.gemini/antigravity-ide/builtin/skills/` ;
- **à l'étalonnage du 2026-10-21 à 17:14** (2.5.5), l'agent sondé n'a déclaré que la catégorie `Lazy`, et il a laissé `S12` à `null` ;
- **au rejeu du 2026-10-28 à 13:41** (2.6.0), `S10` montre 0 description et la catégorie `Lazy`, et `S12` vaut `~/.gemini/antigravity/builtin/skills`.

**En 2.6.0.** `S9` reste `false` : `/migrate-workflows` ne figure pas dans les commandes slash, alors que `migrate-workflows` est désormais l'un des skills intégrés.

**Si ça change.** Informatif.

---

## Non couvert par la sonde

Les points suivants ne sont pas mesurés par la sonde automatique. Les trois premiers font l'objet de tests manuels décrits dans le [README.md](README.md#tests-manuels).

- L'activation d'une règle `manual` par une mention `@` (test manuel).
- La commande `/zz-skill-test` dans l'IDE (test manuel).
- L'activation effective d'une règle `model_decision`, c'est-à-dire le chargement de son corps quand la description correspond (test manuel). En 2.6.0, elle a été observée le 2026-11-02, hors de cette suite : l'agent lit le corps (`read_file`) quand le sujet correspond, et ne le lit pas sinon (un modèle, un essai). Aucun scénario ne la fige.
- Le critère qui sépare les outils MCP `Eager` et `Lazy`.
- Le comportement de l'App et du CLI Antigravity : les baselines ne couvrent que l'IDE. En 2.6.0, l'agent de l'IDE est le moteur `agy`, que le CLI utilise aussi, mais le CLI n'a pas été mesuré.
- Les fichiers du profil global (`~/.gemini/AGENTS.md`, `~/.gemini/config/rules/`, `~/.gemini/config/skills/`, `~/.gemini/config/plugins/`) et les variantes `.agent/`, `_agents/` et `_agent/` de l'espace de travail : ils ont été mesurés en 2.6.0 par des canaris temporaires, hors de cette suite, et ne font pas partie des baselines.
- Les workflows Markdown de l'IDE 2.6.0 (listés dans « / » et invoqués) : observés le 2026-11-02 hors de cette suite ; un scénario « workflows » demanderait une nouvelle baseline.
