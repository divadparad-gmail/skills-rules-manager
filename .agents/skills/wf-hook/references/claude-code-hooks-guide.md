# Guide de Référence : Hooks d'Agent Claude Code

Ce guide documente la déclaration, le cycle de vie et les règles de sécurité strictes des hooks dans Claude Code.

---

## 1. Emplacements de Configuration

| Portée | Emplacement | Rôle |
| :--- | :--- | :--- |
| **Projet Partagé (Recommandé)** | `<racine-projet>/.claude/settings.json` | Cible officielle éprouvée, versionnée dans Git. |
| **Projet Local** | `<racine-projet>/.claude/settings.local.json` | Propre à votre machine, non versionné. |
| **Machine Globale (Limite connue)** | `~/.claude/settings.json` | ℹ️ Non recommandé actuellement car `${CLAUDE_PROJECT_DIR}` est résolu à la racine du projet actif. |

Les réglages fusionnent automatiquement dans l'ordre : Global $\rightarrow$ Projet $\rightarrow$ Local.

---

## 2. Déclaration `PreToolUse` & Règle Fail-Closed

Claude Code exécute les hooks déclarés sous `hooks.PreToolUse`. L'invocation passe systématiquement par l'adaptateur `adapter-claude.js` qui lit `stdin` et relaie la validation au script synthétisé :

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(git *)",
            "command": "node \"${CLAUDE_PROJECT_DIR}/.agents/skills/wf-hook/scripts/adapter-claude.js\" \"${CLAUDE_PROJECT_DIR}/.agents/skills/wf-hook/scripts/wf-hook-<id>.js\" || { echo 'wf-hook: échec ou violation détectée — commande bloquée' >&2; exit 2; }",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

### Directives Cardinales de Sécurité :
1. **Règle Fail-Closed** :
   - Dans Claude Code, seul le **code de sortie 2** (avec message sur `stderr`) ou un JSON spécifique bloque l'exécution.
   - Les codes de sortie 1, 127 (script introuvable) ou les timeouts sont par défaut **non bloquants** (fail-open) !
   - L'utilisation du wrapper shell `... || { echo '...' >&2; exit 2; }` est donc **obligatoire et non négociable**.
2. **Dynamisme du Répertoire de Travail (`cwd`)** :
   - Le script reçoit sur `stdin` un payload JSON contenant `tool_input.command` et `cwd`.
   - L'inspection doit impérativement utiliser `payload.cwd` (pour suivre les changements de répertoire `cd` et les Git worktrees) et ne pas se reposer sur `${CLAUDE_PROJECT_DIR}` figé.
3. **Zéro Clé Custom** :
   - Ne jamais injecter de propriétés non documentées (comme `_managedBy` ou `_id`) dans `settings.json`.
   - La détection d'idempotence et la désinstallation s'appuient exclusivement sur la chaîne de commande `command` ciblant `scripts/hooks/wf-hook-<id>.js`.
