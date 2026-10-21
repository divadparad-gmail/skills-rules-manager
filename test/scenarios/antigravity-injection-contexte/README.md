# Suite de régression « injection-contexte » (Antigravity IDE)

Cette suite fige le comportement d'**Antigravity IDE** observé le **2026-10-21** : quand et comment Antigravity injecte des règles, des skills et des plugins dans le contexte de l'agent. En relançant la sonde plus tard, chaque écart avec la baseline indique précisément quel comportement a changé.

Ces comportements ne sont pas testables par du code seul, car ils dépendent du runtime d'Antigravity et d'une conversation d'agent fraîche. La suite fonctionne donc en deux temps :

1. Une **sonde**, c'est-à-dire un prompt figé ([SONDE.md](SONDE.md)), que tu lances toi-même dans Antigravity IDE. L'agent sondé écrit un rapport JSON dans `resultats/`.
2. Un **test automatisé**, qui compare le dernier rapport à la baseline figée [`attendu/baseline-2026-10-21.json`](attendu/baseline-2026-10-21.json).

Les douze scénarios, leur résultat figé et la tactique à suivre en cas d'écart sont décrits dans [SCENARIOS.md](SCENARIOS.md).

## Contenu du dossier

| Élément | Rôle |
|---|---|
| `SONDE.md` | Le prompt figé à coller dans Antigravity. Ne le modifie pas : la baseline correspond à la version 1 de la sonde. |
| `SCENARIOS.md` | Le résumé des scénarios et la ligne « Si ça change » citée par le test en cas d'écart. |
| `attendu/baseline-2026-10-21.json` | Les 156 résultats attendus : 105 observés pendant l'enquête et 51 transposés. |
| `resultats/` | Les rapports produits par la sonde (`AAAA-MM-JJ-HHMM.json`) et les notes des tests manuels (`manuel-AAAA-MM-JJ.md`). |
| `historique/2026-10-21/` | Les rapports bruts de l'enquête d'origine. |
| `GEMINI.md`, `.agents/`, `sandbox-enquete/`, `src/` | Les fixtures : les règles, le skill, le plugin et les fichiers cibles de la sonde. |

Les fixtures sont au format Antigravity (`.agents/rules/*.md` avec `trigger:` et `globs:`). Plusieurs sont **volontairement invalides ou inefficaces** (liste YAML, motif avec chemin, fichier sans frontmatter) : c'est exactement ce que la suite mesure. Ne les corrige pas.

Le dossier est placé à côté de `test/scenarios/antigravity/`, et non à l'intérieur, pour que le banc d'essai (`npm run test:deploy-antigravity` et le bouton de l'extension) ne le copie jamais à la racine du dépôt.

## Commandes

Toutes les commandes se lancent depuis la **racine du dépôt**, pas depuis ce dossier.

| Commande | Effet |
|---|---|
| `npm test` | Lance tous les tests du dépôt, dont le **test statique** de cette suite : intégrité des fixtures, unicité des canaris, validité de la baseline et contrôle du comparateur. La comparaison au rapport de sonde y est toujours ignorée. |
| `npm run test:injection` | Compile les tests, puis lance cette suite avec `INJECTION_COMPARE=1` : le test statique **et la comparaison** au dernier rapport. Tout écart fait échouer la commande. |
| `npm run test:injection-reset` | Remet les fixtures dans l'état d'avant la sonde : restaure `sandbox-enquete/sous/module.ts` et supprime `sandbox-enquete/nouveau.ts`. Ne touche jamais à `resultats/` ni à `historique/`. |

Les scripts associés se trouvent dans `test/scenarios/scripts/` :
- `compare-injection-contexte.js` est le lanceur de `test:injection`. Il définit `INJECTION_COMPARE=1` de façon portable, sans `cross-env`.
- `reset-injection-contexte.js` est le script de réinitialisation.
- `generate-injection-contexte-r-tronque.js` a généré la fixture `.agents/rules/r-tronque.md` (30 018 octets). Le test statique vérifie que le fichier commité est identique à sa sortie. Ne le relance que si tu modifies volontairement cette fixture : `node test/scenarios/scripts/generate-injection-contexte-r-tronque.js`.

## Procédure d'exécution

1. **Réinitialise les fixtures** depuis la racine du dépôt : `npm run test:injection-reset`.
2. **Ouvre ce dossier comme espace de travail autonome** dans Antigravity IDE : Fichier > Ouvrir le dossier, puis `test/scenarios/antigravity-injection-contexte/`. C'est indispensable, car Antigravity ne lit pas le dossier `.agents/` d'un sous-dossier : les fixtures doivent être à la racine de l'espace de travail ouvert.
3. **Recharge la fenêtre** avec la commande `Developer: Reload Window`.
4. **Ouvre une nouvelle conversation** et colles-y tout le contenu de [SONDE.md](SONDE.md).
5. **Vérifie qu'un fichier est apparu** dans `resultats/`, nommé `AAAA-MM-JJ-HHMM.json`.
6. **Lance la comparaison** depuis la racine du dépôt : `npm run test:injection`. Si le test de confidentialité échoue (« Chemin absolu vers un dossier utilisateur : caviarder avant de commiter »), le rapport contient un chemin absolu malgré la consigne de la sonde : **caviarde-le avant de le commiter**. Remplace le chemin du projet par `<PROJET>` et celui du dossier personnel par `<HOME>`, aux lignes que le message indique.
7. **Relance la réinitialisation** : `npm run test:injection-reset`.
8. **Note la version d'Antigravity** dans le rapport : dans l'objet `meta`, remplace la valeur `"A_REMPLIR"` de la clé `version_antigravity` par la version affichée dans Help > About. Le test l'affiche en tête de la comparaison. Tant que la valeur est absente ou vaut `A_REMPLIR`, le test affiche l'avertissement « Version d'Antigravity non renseignée (Help > About) », sans le compter comme un écart. **Ne renomme pas le fichier** : seuls les noms au format `AAAA-MM-JJ-HHMM.json` sont retenus automatiquement.

Pendant l'étape 6, la vérification « état avant sonde » du test statique est volontairement ignorée, car la sonde vient de modifier `module.ts` et de créer `nouveau.ts`. Si tu lances `npm test` sans avoir fait l'étape 7, ce test échoue avec le message « lance le script de réinitialisation ».

Les règles globales de ton profil Antigravity (`~/.gemini/…`) restent actives dans l'espace de travail sondé. La sonde les rapporte dans `autres_regles`, que le test affiche sans les comparer.

## Lire le résultat de la comparaison

Le test affiche un tableau `id | scénario | attendu | observé | confiance | verdict`, avec une ligne par entrée de la baseline, puis :

- **En cas d'écart**, la commande échoue et liste chaque scénario touché, avec le nombre d'écarts et sa ligne « Si ça change » de [SCENARIOS.md](SCENARIOS.md). Une entrée absente du rapport, par exemple une étape manquante, compte comme un écart et s'affiche « (absent du rapport) ».
- **Rapport suspect.** Si l'agent sondé déclare des infractions dans `meta.infractions` (lecture interdite, recherche textuelle…), un avertissement « RAPPORT SUSPECT » cite chacune d'elles. Vérifie-les avant de conclure à un changement d'Antigravity.
- **Informations, jamais en échec** : les canaris observés dans des cellules non figées, les `autres_regles` de chaque étape, `S5.octets_tronques`, `S10` (MCP) et `S12` (skills intégrés).
- **Fichiers ignorés.** Tout autre fichier `.json` de `resultats/` est signalé par un avertissement et n'est pas comparé.
- **Version non renseignée.** Si `meta.version_antigravity` est absente ou vaut encore `A_REMPLIR`, un avertissement le signale, sans écart (voir l'étape 8).

Le test tolère la rédaction libre de l'agent sondé :
- Dans `canaris`, chaque élément est fouillé, sans tenir compte de la casse. Par exemple, `"CANARI-G3 (réinjecté)"` compte comme `CANARI-G3`, et un élément sans canari est ignoré.
- Pour `S11`, les guillemets et les accents graves sont retirés, et la valeur doit **contenir** le préambule attendu.

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

### Quand un écart est confirmé

Ne modifie pas `baseline-2026-10-21.json` : elle reste la trace de ce qui a été mesuré le 2026-10-21. Suis d'abord la ligne « Si ça change » du scénario concerné. Pour figer un nouveau comportement, crée une nouvelle baseline datée et adapte `test/antigravity-injection-contexte.test.ts`, qui désigne le fichier de baseline et vérifie son nombre d'entrées.

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
- qu'aucun fichier de `resultats/` ni de `historique/` ne contient de chemin absolu vers un dossier utilisateur (`X:\Users\…`, `/Users/…`, `/home/…`). Le message d'échec cite le fichier et la ligne, sans recopier le chemin.

Si tu ajoutes un document dans ce dossier, ajoute-le à la liste `DOCS` du test : sinon, il sera signalé comme fichier parasite.
