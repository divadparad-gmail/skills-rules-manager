# 🧪 Banc d'Essai & Scénarios de Test (Skills & Rules Manager)

Ce répertoire constitue le **laboratoire officiel de fixtures et scénarios de test** pour l'extension VS Code **Skills & Rules Manager**.
Il reproduit l'ensemble des cas réels supportés par **Antigravity IDE (Gemini)** et **Claude Code**.

---

## 📋 Matrice des Scénarios Antigravity (`test/scenarios/antigravity/`)

| Fichier / Dossier | Type | Spécificité testée | Résultat visuel & comportement attendu |
| :--- | :--- | :--- | :--- |
| `GEMINI.md` | **Âme Système** | Racine projet N1 | • Badge `🔒 Always-On`<br>• Compté dans la catégorie Âme locale (`soulStat`)<br>• Protégé contre toute désactivation |
| `.agents/rules/01-rule-perm-no-frontmatter.md` | **Règle Permanente** | Aucun frontmatter YAML | • Titre extrait du premier `# Titre`<br>• 100% des tokens comptés au démarrage |
| `.agents/rules/02-rule-perm-standard-always-on.md` | **Règle Permanente** | Frontmatter avec `description:` seule | • Titre et résumé extraits des métadonnées<br>• Reste active en continu (Always-on) |
| `.agents/rules/03-rule-cond-trigger-glob.md` | **Règle Conditionnelle** | `trigger: glob` + `globs: "*.ts, *.tsx"` | • Badge **`⚡ Conditionnel`** (violet)<br>• Ne compte que **~20 tokens** au boot pour le routeur<br>• Métrique : `~20 tok (X plein)` |
| `.agents/rules/04-rule-cond-trigger-globs-list.md` | **Règle Conditionnelle** | `trigger: glob` + liste YAML `- "src/**"` | • Support du format syntaxique YAML en liste<br>• Badge **`⚡ Conditionnel`** |
| `.agents/rules/05-rule-cond-trigger-model-decision.md` | **Règle Conditionnelle** | `trigger: model_decision` | • Badge **`⚡ Conditionnel`**<br>• Activation sémantique par l'agent |
| `.agents/rules/06-rule-warn-size-exceeded-24kb.md` | **Règle Permanente** | Taille physique > 24 000 octets | • Badge rouge/ambre **`⚠️ > 24 Ko`**<br>• Avertit du dépassement de la limite physique Antigravity |
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

## 🚀 Utilisation

### Via l'Interface VS Code (Sidebar)
Dans la boîte **🧪 Banc d'Essai (Scénarios)** sous le guide complet :
- **🌌 Antigravity** : Nettoie et déploie l'arborescence Antigravity complète.
- **🤖 Claude Code** : Nettoie et déploie l'arborescence Claude Code complète.
- **⚡ Tous** : Déploie les deux environnements pour tester le commutateur d'outil.
- **🧹 Vider** : Réinitialise et supprime tous les fichiers temporaires de test.

### En Ligne de Commande (CLI)
```bash
npm run test:deploy-antigravity
npm run test:deploy-claude
npm run test:deploy-all
npm run test:clean
```
