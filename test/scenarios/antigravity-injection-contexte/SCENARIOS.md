# Scénarios de la suite « injection-contexte »

Ce document décrit les douze scénarios qui figent le comportement d'Antigravity IDE observé le **2026-10-21** : quand et comment Antigravity injecte des règles, des skills et des plugins dans le contexte de l'agent. La procédure d'exécution se trouve dans le [README.md](README.md).

Chaque scénario regroupe des entrées de la baseline [`attendu/baseline-2026-10-21.json`](attendu/baseline-2026-10-21.json). Quand le test de comparaison détecte un écart, il cite la colonne « Si ça change » du tableau ci-dessous pour chaque scénario touché.

## Tableau récapitulatif

> Le test `test/antigravity-injection-contexte.test.ts` lit ce tableau : garde l'identifiant `SCxx` en première colonne et la tactique « Si ça change » en dernière colonne.

| ID | Scénario | Résultat figé (2026-10-21) | Si ça change |
|---|---|---|---|
| SC01 | Règles permanentes et troncature | Contenu complet en `<RULE[…]>`, coupé au-delà de 24 Ko | Recalibrer la taille max dans l'extension |
| SC02 | Glob par nom de fichier | `*.ts`, `**/*.ts`, `app.ts` fonctionnent | Revoir toutes les règles glob |
| SC03 | Glob avec chemin | Ne se déclenche jamais (G1, G2, G5, G6, GLOB-CHAINE, MIXTE) | Si G6 passe à présent : revenir à des motifs `src/**` plus précis |
| SC04 | Format de `globs` | Liste YAML rejetée, chaîne acceptée | Si L1 passe : la liste devient utilisable |
| SC05 | Frontmatter mixte (`paths:` + `globs:`) | Accepté (L2) | Si L2 disparaît : un fichier par outil |
| SC06 | Activation `manual` / `model_decision` | Manual absente, model_decision = index chemin + description | Revoir le coût au démarrage dans l'extension |
| SC07 | Rejet sans frontmatter | Règle ignorée silencieusement | L'extension doit continuer à signaler ce cas |
| SC08 | `AGENTS.md` de sous-dossier | Jamais chargé | Si DOSSIER apparaît : les règles de dossier redeviennent utilisables |
| SC09 | Déclencheurs | Lecture, modification, création ; jamais `list_dir` | Revoir la colonne « Comportement » |
| SC10 | Skills et plugins | Index nom + chemin + description ; pas de préfixe plugin ; annexes jamais chargées | Revoir la ligne Skills et Plugins |
| SC11 | Forme de l'injection | Suffixe du résultat d'outil, préambule figé (S11) | Mettre à jour la doc de l'extension |
| SC12 | Workflows et MCP | `/migrate-workflows` absent ; MCP en noms seuls | Informatif |

## Comment lire les sections

**Les étapes de la sonde** (voir [SONDE.md](SONDE.md)) :

| Étape | Action de l'agent sondé |
|---|---|
| E0 | Inspection du contexte initial, sans outil |
| E1 | Lecture de `sandbox-enquete/app.ts` |
| E2 | Lecture de `sandbox-enquete/notes.md` |
| E3 | Lecture de `src/zz-test.ts` |
| E4 | Lecture de `sandbox-enquete/sous/profond/x.ts` |
| E5 | Listing de `sandbox-enquete/sous/` (`list_dir`) |
| E6 | Lecture de `sandbox-enquete/sous/module.ts` |
| E7 | Modification de `sandbox-enquete/sous/module.ts` |
| E8 | Création de `sandbox-enquete/nouveau.ts` |
| E9 | Utilisation du skill `zz-skill-test` (lecture de `SKILL.md` seulement) |

**La confiance.** Une étape suivie d'un astérisque (`E2*`) est une entrée **transposée** : le mécanisme a été observé sur une autre règle pendant l'enquête, mais ce canari précis est nouveau. Une étape sans astérisque est une entrée **observée** telle quelle le 2026-10-21. Un écart sur une entrée transposée peut donc venir de la transposition elle-même plutôt que d'un changement d'Antigravity.

**Étalonnage.** L'étalonnage du 2026-10-21 à 17:14 (`resultats/2026-10-21-1714.json`, Antigravity IDE 2.5.5) a confirmé les 51 entrées transposées, ainsi que les 105 entrées observées : 156 conformes sur 156, sans infraction. Leur confiance reste `transpose` dans la baseline, qui garde la trace de ce qui avait été mesuré pendant l'enquête.

**L'attribution des entrées.** Une entrée appartient par défaut au scénario de son canari. Deux exceptions s'appliquent :
- À l'étape E5 (`list_dir`), toutes les entrées relèvent de SC09, sauf `CANARI-DOSSIER`, qui reste dans SC08.
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

**Résultat figé.** Le contenu complet est entouré de `<RULE[chemin]>…</RULE[chemin]>`. Au-delà de 24 Ko, le contenu est coupé avec un marqueur `<truncated N bytes>`. Pendant l'enquête, la règle 06 du banc d'essai affichait `<truncated 14978 bytes>`. La valeur de N mesurée par la sonde (`S5.octets_tronques`) est affichée sans être comparée.

**Si ça change.** Recalibrer la taille maximale dans l'extension. Si `CANARI-TRONQUE-FIN` apparaît, la limite a augmenté ou disparu. Si `CANARI-TRONQUE-DEBUT` disparaît, la règle n'est peut-être plus chargée du tout.

## SC02 — Glob par nom de fichier

**Ce qu'on teste.** Une règle `trigger: glob` ne coûte rien au démarrage. Elle est injectée quand le **nom** du fichier lu correspond au motif.

**Fixtures.** `zz-glob-ext.md` (`"*.ts, *.tsx"`), `zz-g3.md` (`"**/*.ts"`) et `zz-g4.md` (`"app.ts"`).

**Entrées de la baseline (20, dont 9 observées et 11 transposées).**
- `CANARI-GLOB-EXT` : présent en E1*, E3*, E4* et E6* ; absent en E0* et E2*.
- `CANARI-G3` : présent en E1, E3, E4 et E6* ; absent en E0 et E2*.
- `CANARI-G4` : présent en E1 ; absent en E0, E2*, E3, E4, E6*, E7 et E8*.

**Résultat figé.** `*.ts`, `**/*.ts` et `app.ts` fonctionnent, quel que soit le dossier du fichier. Un fichier `.md` (E2) ne déclenche aucune de ces règles, et `app.ts` ne correspond qu'à `sandbox-enquete/app.ts`.

**Si ça change.** Revoir toutes les règles glob.

## SC03 — Glob avec chemin

**Ce qu'on teste.** Antigravity compare seulement le nom de fichier au motif. Un motif qui contient un dossier ne se déclenche donc jamais.

**Fixtures.** `zz-g1.md` (`"**/sandbox-enquete/**/*.ts"`), `zz-g2.md` (`"sandbox-enquete/*.ts"`), `zz-g5.md` (`'sandbox-enquete\**\*.ts'`), `zz-g6.md` (`"src/**/*.ts"`), `zz-glob-chaine.md` (`"sandbox-enquete/**/*.ts"`) et `zz-mixte.md` (même motif, avec une clé `paths:` en plus).

**Entrées de la baseline (36, dont 32 observées et 4 transposées).**
- `CANARI-GLOB-CHAINE` et `CANARI-MIXTE` : absents en E0, E1, E2, E3, E4 et E7.
- `CANARI-G1`, `CANARI-G2`, `CANARI-G5` et `CANARI-G6` : absents en E0, E1, E2*, E3, E4 et E7.

**Résultat figé.** Aucun de ces motifs ne se déclenche, ni à la lecture, ni à la modification. `CANARI-G6` est le témoin le plus direct : son motif `src/**/*.ts` correspond pourtant au fichier lu en E3.

**Si ça change.** Si G6 passe à présent, revenir à des motifs `src/**` plus précis. Si seuls certains motifs passent, comparer G1 (préfixe `**/`), G2 (un seul niveau) et G5 (antislash) pour savoir quelle forme de chemin Antigravity reconnaît désormais.

## SC04 — Format de `globs`

**Ce qu'on teste.** La clé `globs` écrite en liste YAML est rejetée en silence. Seule la chaîne séparée par des virgules fonctionne.

**Fixtures.** `zz-l1.md` (liste à un élément `- "*.ts"`), `zz-l3.md` (liste à deux éléments `- "*.js"` et `- "*.ts"`) et `zz-glob-liste.md` (liste à un élément `- "sandbox-enquete/**/*.ts"`).

**Entrées de la baseline (16, dont 10 observées et 6 transposées).**
- `CANARI-GLOB-LISTE` : absent en E0, E1, E2, E3, E4 et E7.
- `CANARI-L1` : absent en E0, E1, E2*, E3* et E4*.
- `CANARI-L3` : absent en E0, E1, E2*, E3* et E4*.

**Résultat figé.** Aucune règle écrite en liste YAML ne se déclenche, même avec un motif qui fonctionne en chaîne (`*.ts`, comparé à SC02).

**Attention : `CANARI-GLOB-LISTE` cumule deux conditions.** Sa règle combine le format en liste YAML **et** un motif avec chemin, qui ne se déclenche jamais d'après SC03. Ce canari ne peut donc passer à « présent » que si les deux comportements changent en même temps. Il ne permet pas, à lui seul, de savoir si le format en liste est devenu utilisable. **Le témoin du format en liste seul est `CANARI-L1`**, dont le motif `*.ts` fonctionne en chaîne. `CANARI-L3` confirme le cas d'une liste à plusieurs éléments.

**Si ça change.** Si L1 passe, la liste devient utilisable. Si L1 passe mais pas L3, seule la liste à un élément est acceptée.

## SC05 — Frontmatter mixte (`paths:` + `globs:`)

**Ce qu'on teste.** Une clé `paths:` propre à Claude Code, ajoutée à côté d'une clé `globs:` en chaîne, ne casse pas la règle Antigravity. Un même fichier peut donc servir aux deux outils.

**Fixture.** `zz-l2.md` (`globs: "*.ts"` et `paths:` en liste `- "src/**/*.ts"`).

**Entrées de la baseline (6, dont 2 observées et 4 transposées).**
- `CANARI-L2` : présent en E1, E3*, E4* et E6* ; absent en E0 et E2*.

Les entrées de `CANARI-L2` aux étapes E7 et E8 relèvent de SC09.

**Résultat figé.** La règle se comporte exactement comme une règle `globs: "*.ts"` seule. La clé `paths:` est ignorée.

**Si ça change.** Si L2 disparaît, il faut un fichier par outil.

## SC06 — Activation `manual` / `model_decision`

**Ce qu'on teste.** Ce que coûtent au démarrage les règles qui ne s'activent ni en permanence ni par motif.

**Fixtures.** `zz-model.md` (`trigger: model_decision`, description sur les licornes quantiques) et `zz-manual.md` (`trigger: manual`).

**Entrées de la baseline (17, toutes observées).**
- `CANARI-MODEL` : absent en E0, E1, E2, E3, E4, E6 et E7.
- `CANARI-MANUAL` : absent en E0, E1, E2, E3, E4, E6 et E7.
- `S6` (l'index des règles conditionnelles contient `zz-model.md` avec sa description) : `true`.
- `S7` (cet index contient `zz-manual.md`) : `false`.
- `S8` (cet index contient une règle `glob`) : `false`.

**Résultat figé.** Une règle `manual` est totalement absente au démarrage. Pour une règle `model_decision`, seuls le chemin `file:///…` et la description figurent dans l'index au démarrage, jamais le corps. Les règles `glob` ne figurent pas dans cet index.

**Si ça change.** Revoir le coût au démarrage dans l'extension.

## SC07 — Rejet sans frontmatter

**Ce qu'on teste.** Une règle placée dans `.agents/rules/` sans frontmatter n'est jamais chargée.

**Fixture.** `zz-sans-fm.md`, dont le contenu se limite au canari.

**Entrées de la baseline (7, toutes observées).**
- `CANARI-SANS-FM` : absent en E0, E1, E2, E3, E4, E6 et E7.

**Résultat figé.** La règle est ignorée silencieusement, sans message pour l'utilisateur.

**Si ça change.** L'extension doit continuer à signaler ce cas. Si la règle apparaît, vérifier sous quelle forme : un chargement permanent par défaut changerait le budget de démarrage.

## SC08 — `AGENTS.md` de sous-dossier

**Ce qu'on teste.** Un fichier `AGENTS.md` placé dans un sous-dossier de l'espace de travail n'est jamais chargé.

**Fixture.** `sandbox-enquete/sous/AGENTS.md`.

**Entrées de la baseline (8, toutes observées).**
- `CANARI-DOSSIER` : absent en E0, E1, E2, E3, E4, E5, E6 et E7.

**Résultat figé.** Le fichier n'est chargé ni au démarrage, ni à la lecture d'un fichier du dossier (E6) ou d'un sous-dossier (E4), ni au listing du dossier (E5), ni à la modification (E7).

**Précision : les dossiers parents, eux, sont chargés** (source : étalonnage 2026-10-21 17:14, informatif). Les `autres_regles` des étapes E0 à E8 montrent qu'Antigravity charge aussi les règles des dossiers **parents** de l'espace de travail, jusqu'à la racine du dépôt Git :
- le `GEMINI.md` et les règles `.agents/rules/*` de la racine du projet, selon leur déclencheur : les règles permanentes au démarrage, la règle `model_decision` dans l'index, et la règle glob `03-rule-cond-trigger-glob.md` à chaque fichier `.ts` ;
- le fichier global `~/.gemini/GEMINI.md`.

Le chargement remonte donc vers les dossiers parents, mais ne descend jamais dans un sous-dossier. Le rapport écrit les chemins de la racine sous la forme `../../…`, alors que la racine du dépôt se trouve trois niveaux au-dessus de la suite (`../../../`). C'est une approximation de l'agent sondé, laissée telle quelle dans le rapport brut. Ces règles s'ajoutent à celles de la suite (voir « Dépendance à l'environnement » dans le [README.md](README.md#dépendance-à-lenvironnement)).

**Si ça change.** Si DOSSIER apparaît, les règles de dossier redeviennent utilisables. Noter l'étape où il apparaît : elle indique le déclencheur.

## SC09 — Déclencheurs

**Ce qu'on teste.** Les actions d'outil qui déclenchent l'injection des règles glob : la lecture, la modification et la création, mais jamais le listing d'un dossier.

**Fixtures.** Toutes les règles de `.agents/rules/`. Les cibles sont `sandbox-enquete/sous/` (E5), `sandbox-enquete/sous/module.ts` (E7) et `sandbox-enquete/nouveau.ts` (E8).

**Entrées de la baseline (22, dont 1 observée et 21 transposées).**
- `CANARI-G3` : présent en E7 et E8* ; absent en E5*.
- `CANARI-GLOB-EXT` et `CANARI-L2` : présents en E7* et E8* ; absents en E5*.
- Les 13 autres canaris de règles (`CANARI-GLOB-LISTE`, `CANARI-GLOB-CHAINE`, `CANARI-MIXTE`, `CANARI-SANS-FM`, `CANARI-MODEL`, `CANARI-MANUAL`, `CANARI-G1`, `CANARI-G2`, `CANARI-G4`, `CANARI-G5`, `CANARI-G6`, `CANARI-L1` et `CANARI-L3`) : absents en E5*.

**Résultat figé.** Une règle glob est injectée à la lecture, à la modification et à la création d'un fichier correspondant. `list_dir` ne déclenche aucune injection. Seule l'entrée `E7:CANARI-G3` a été observée telle quelle : les autres sont transposées de ce constat.

**Si ça change.** Revoir la colonne « Comportement ».

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

**Résultat figé.** Au démarrage, l'index contient seulement `- <nom> (<chemin absolu>): <description>`. Le corps n'arrive qu'à la lecture du `SKILL.md`. Les dossiers `references/` et `resources/` ne sont ni chargés ni signalés. Le skill de plugin s'affiche sans préfixe (`zz-plugin-skill`, et non `zz-plugin-test:zz-plugin-skill`), et une section `<plugins>` séparée liste le plugin.

**Si ça change.** Revoir la ligne Skills et Plugins.

## SC11 — Forme de l'injection

**Ce qu'on teste.** La forme du bloc qu'Antigravity ajoute au résultat d'un outil quand une règle glob se déclenche.

**Fixtures.** Les règles glob qui se déclenchent en E1 (voir SC02).

**Entrée de la baseline (1, observée).**
- `S11` : le préambule `The following text is not part of the file, it is a list of user-defined rules that you MUST follow:`.

**Résultat figé.** Les règles sont ajoutées **à la fin** du résultat de l'outil, précédées de ce préambule exact. Le test retire les guillemets et les accents graves de la valeur rapportée, puis vérifie qu'elle **contient** le préambule. Une rédaction plus longue de l'agent sondé reste donc conforme, mais un seul mot changé produit un écart.

**Si ça change.** Mettre à jour la doc de l'extension.

## SC12 — Workflows et MCP

**Ce qu'on teste.** Deux éléments visibles au démarrage : la commande `/migrate-workflows` et la présentation des outils MCP.

**Fixtures.** Aucune : ces observations dépendent de l'installation d'Antigravity et de la configuration MCP de l'utilisateur.

**Entrée de la baseline (1, observée).**
- `S9` (`/migrate-workflows` figure dans les commandes slash) : `false`.

**Informations non figées.** `S10` (nombre de descriptions d'outils MCP visibles au démarrage et catégories) et `S12` (emplacement des skills intégrés) sont affichés sans comparaison. Le 2026-10-21, `S10` montrait 0 description et les catégories `Eager` et `Lazy`, et `S12` montrait `~/.gemini/antigravity-ide/builtin/skills/`.

**Si ça change.** Informatif.

---

## Non couvert par la sonde

Les points suivants ne sont pas mesurés par la sonde automatique. Les trois premiers font l'objet de tests manuels décrits dans le [README.md](README.md#tests-manuels).

- L'activation d'une règle `manual` par une mention `@` (test manuel).
- La commande `/zz-skill-test` dans l'IDE (test manuel).
- L'activation effective d'une règle `model_decision`, c'est-à-dire le chargement de son corps quand la description correspond (test manuel).
- Le critère qui sépare les outils MCP `Eager` et `Lazy`.
- Le comportement de l'App et du CLI Antigravity : la baseline ne couvre que l'IDE.
