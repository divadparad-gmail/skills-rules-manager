# 🧪 Banc d'Essai & Scénarios de Test (Skills & Rules Manager)

Ce répertoire constitue le **laboratoire officiel de fixtures et scénarios de test** pour l'extension VS Code **Skills & Rules Manager**.
Il reproduit l'ensemble des cas réels supportés par **Antigravity IDE (Gemini)** et **Claude Code**.

---

## 📋 Matrice des Scénarios Antigravity (`test/scenarios/antigravity/`)

| Fichier / Dossier | Type | Spécificité testée | Résultat visuel & comportement attendu |
| :--- | :--- | :--- | :--- |
| `GEMINI.md` | **Âme Système** | Racine projet N1 | • Badge `🔒 Always-On`<br>• Compté dans la catégorie Âme locale (`soulStat`)<br>• Protégé contre toute désactivation |
| `.agents/rules/01-rule-perm-no-frontmatter.md` | **Règle Ignorée** | Aucun frontmatter YAML | • Badge **`⛔ Ignorée par Antigravity`**<br>• 0 token au démarrage : Antigravity ignore en silence une règle sans frontmatter |
| `.agents/rules/02-rule-perm-standard-always-on.md` | **Règle Permanente** | `trigger: always_on` + `description:` | • Titre et résumé extraits des métadonnées<br>• Reste active en continu (Always-on) |
| `.agents/rules/03-rule-cond-trigger-glob.md` | **Règle Conditionnelle** | `trigger: glob` + `globs: "*.ts, *.tsx"` | • Badge **`⚡ Conditionnel`** (violet)<br>• Compte **~20 tokens** au boot (estimation de l'extension)<br>• Métrique : `~20 tok (X plein)` |
| `.agents/rules/04-rule-cond-trigger-globs-list.md` | **Règle Conditionnelle** | `trigger: glob` + liste YAML `- "src/**"` | • Badge **`⚡ Conditionnel`**<br>• Badge **`⚠️ Frontmatter`** : la documentation décrit `globs` comme une chaîne séparée par des virgules |
| `.agents/rules/05-rule-cond-trigger-model-decision.md` | **Règle Conditionnelle** | `trigger: model_decision` + `description:` | • Badge **`⚡ Conditionnel`**<br>• Activation par l'agent à partir de la description |
| `.agents/rules/06-rule-warn-size-exceeded-24kb.md` | **Règle Permanente** | Taille > 24 000 octets (UTF-8, inclusions comprises) | • Badge rouge/ambre **`⚠️ > 24 Ko`**<br>• Antigravity tronque le fichier au-delà de la limite |
| `.agents/rules/07-rule-disabled-suffix.md.disabled` | **Règle Désactivée** | Extension physique `.disabled` | • Switch à l'état **OFF**<br>• Ne consomme 0 token au boot |
| `.agents/rules/08-rule-dedup-active.md` & `.md.disabled` | **Déduplication** | Même identifiant présent en `.md` et `.disabled` | • Le fichier actif gagne sans créer de doublon visuel |
| `.agents/skills/skill-standard/SKILL.md` | **Skill** | Compétence standard avec tags | • Nom et description découverts au boot (~20-50 tok)<br>• Switch actif |
| `.agents/skills/wf-action-deploy/SKILL.md` | **Workflow** | Préfixe conventionnel `wf-` | • Badge violet **`Workflow`** |
| `.agents/skills/skill-disabled/SKILL.md.disabled` | **Skill Désactivé** | `SKILL.md.disabled` | • Switch à l'état **OFF** |
| `.agents/skills/skill-with-annexes/` | **Skill Structuré** | Sous-dossiers `scripts/` et `references/` | • Les fichiers annexes ne sont **pas** comptabilisés au boot<br>• Seul le fichier `SKILL.md` est découvert |
| `.agents/plugins/pack-audit-pro/` | **Plugin Modulaire** | Skills et Rules isolés dans un pack | • Badge cyan **`🧩 pack-audit-pro`** sur chaque item<br>• Identifiants préfixés `pack-audit-pro:<id>` |
| `.agents/mcp_config.json` | **MCP Local** | Configuration JSON serveurs MCP | • Détecté et comptabilisé dans `mcpLocal` |
| `.agents/hooks.json` | **Lifecycle Hooks** | Interceptions synchrones `PreToolUse`, `Stop` | • Déclarations de sécurité du cycle de vie |

---

## 🤖 Matrice des Scénarios Claude Code (`test/scenarios/claude-code/`)

| Fichier / Dossier | Type | Spécificité testée | Résultat visuel & comportement attendu |
| :--- | :--- | :--- | :--- |
| `CLAUDE.md` | **Âme Système** | Racine projet Claude Code | • Badge `🔒 Always-On`<br>• Comptabilisé dans `soulStat` |
| `.claude/rules/01-rule-claude-perm-standard.md` | **Règle Permanente** | Règle sans directive `paths:` | • 100% de ses tokens comptés au démarrage |
| `.claude/rules/02-rule-claude-cond-paths-string.md` | **Règle Conditionnelle** | `paths: "src/**/*.js"` | • Badge **`⚡ Conditionnel`**<br>• ~20 tokens au boot |
| `.claude/rules/03-rule-claude-cond-paths-list.md` | **Règle Conditionnelle** | `paths: ["src/**", "tests/**"]` (liste YAML) | • Badge **`⚡ Conditionnel`**<br>• Filtrage sur plusieurs motifs |
| `.claude/rules/04-rule-claude-disabled.md.disabled` | **Règle Désactivée** | Extension `.disabled` | • Switch à l'état **OFF** |
| `.claude/skills/skill-claude-traduction/SKILL.md` | **Skill Claude** | Compétence locale Claude Code | • Répertorié dans les skills locaux Claude Code |
| `.claude/skills/skill-claude-disabled/SKILL.md.disabled` | **Skill Désactivé** | Skill désactivé Claude Code | • Switch à l'état **OFF** |

---

## 🔬 Suite de régression « injection-contexte » (`test/scenarios/antigravity-injection-contexte/`)

Ce dossier n'est **pas** déployé par le banc d'essai. Il fige le comportement réel d'Antigravity IDE observé le 2026-10-21 : quand et comment les règles, les skills et les plugins sont injectés dans le contexte de l'agent. Il s'ouvre comme espace de travail autonome dans Antigravity pour y lancer une sonde, dont le rapport est ensuite comparé à une baseline figée.

- `npm test` vérifie l'intégrité de ses fixtures.
- `npm run test:injection` compare le dernier rapport de sonde à la baseline.
- `npm run test:injection-reset` remet les fixtures dans l'état d'avant la sonde.

La procédure complète est décrite dans son [README.md](antigravity-injection-contexte/README.md), et les scénarios dans son [SCENARIOS.md](antigravity-injection-contexte/SCENARIOS.md).

---

## 🚀 Utilisation

### Via l'Interface VS Code (Sidebar)
Dans la boîte **🧪 Banc d'Essai (Scénarios)** sous le guide complet :
- **🌌 Antigravity** : Déploie l'arborescence Antigravity complète.
- **🤖 Claude Code** : Déploie l'arborescence Claude Code complète.
- **⚡ Tous** : Déploie les deux environnements pour tester le commutateur d'outil, ainsi que la règle `rule-test-doublon.md` dans le profil global d'Antigravity.
- **🧹 Vider** : Supprime les fixtures intactes et restaure les vrais fichiers sauvegardés.

Avant de déployer, une fenêtre liste les vrais fichiers qui seront sauvegardés puis remplacés, et les fichiers déjà identiques à leur fixture. Si un banc est déjà déployé, l'extension propose « Vider et redéployer ». Une fixture modifiée pendant le test n'est jamais écrasée sans la fenêtre « Écraser et restaurer », qui en donne la liste.

Tant que le banc est déployé, ou qu'une opération est inachevée, l'extension l'indique :

- dans la barre d'état (« ⚠️ Banc d'essai actif » ou « ⛔ Banc d'essai interrompu ») ;
- par un bandeau en haut de la barre latérale et du Grand Dashboard, avec un bouton « Vider et restaurer » ;
- par un avertissement au démarrage, qui propose de vider le banc.

La commande « Skills & Rules Manager: Vider le banc d'essai et restaurer les originaux » fait la même chose depuis la palette.

### En Ligne de Commande (CLI)
```bash
npm run test:deploy-antigravity
npm run test:deploy-claude
npm run test:deploy-all
npm run test:clean
```

Les boutons et les scripts passent par le même module, `src/services/ScenarioManager.ts`.

### Sauvegarde des vrais fichiers

- **Avant un déploiement**, chaque vrai fichier qu'une fixture remplacerait (par exemple un vrai `CLAUDE.md` ou un vrai `.agents/hooks.json`) est copié dans `.banc-essai-sauvegarde/`, puis vérifié (SHA-256 et taille). Les copies sont rangées sous `racine/` et `profil-global/`, avec `_agents` et `_claude` à la place de `.agents` et `.claude`, et le suffixe `.sauvegarde` : aucun agent ne les lit. Leur liste est dans `index.json`.
- **Un fichier déjà identique à sa fixture** n'est pas sauvegardé : il est traité comme une fixture et supprimé au vidage. Le déploiement le signale.
- **Le manifeste `.scenario-manifest.json` sert de journal** (`deploiement-en-cours`, `deploye`, `restauration-en-cours`) et garde l'empreinte de chaque fixture déployée. Une opération interrompue est reprise au vidage suivant.
- **Au vidage**, seuls les fichiers identiques à leur fixture sont supprimés. Les originaux sont restaurés à l'identique, date comprise, puis la sauvegarde et le manifeste sont retirés. Un fichier différent de sa fixture, mais qui n'a pas été déployé, est conservé et signalé.
- **Un banc déjà déployé** n'est pas redéployé : videz-le d'abord. Avec `npm run test:deploy-* -- --ecraser`, le script vide, restaure puis redéploie, sauf si une fixture a été modifiée pendant le test.
- **Une fixture modifiée pendant le test** n'est jamais écrasée sans accord : `npm run test:clean` refuse et liste les fichiers en cause, et `npm run test:clean -- --ecraser` les écrase avant de restaurer les originaux.
- **Codes de sortie des scripts** : 0 en cas de succès, 1 en cas d'erreur, 2 en cas de refus (rien n'a été modifié).
- **Ne supprimez jamais `.banc-essai-sauvegarde/` à la main**, et n'utilisez jamais `git clean -x` ou `git clean -X` : ce dossier est ignoré par Git, et il contient les seules copies des originaux.

Le test manuel du banc d'essai, dans l'hôte de développement de VS Code, est décrit dans [TEST-MANUEL.md](TEST-MANUEL.md).
