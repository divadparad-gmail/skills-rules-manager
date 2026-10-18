# Guide de Référence : Lifecycle Hooks Google Antigravity

Ce guide documente le fonctionnement officiel des Lifecycle Hooks dans Google Antigravity (App, CLI et IDE).

---

## 1. Emplacements de Configuration

| Portée | Emplacement | Rôle |
| :--- | :--- | :--- |
| **Machine Globale** | `~/.gemini/config/hooks.json` | Protège tous les projets traités par Antigravity. |
| **Projet Local** | `<racine-projet>/.agents/hooks.json` | Versionné, actif pour le workspace courant. |

> ⚠️ **Cycle de Vie & Découverte** : Dans Antigravity IDE, `hooks.json` est instancié à l'ouverture de la session ou synchronisé via le panneau latéral (**… > Customizations > Hooks**).

---

## 2. Format Officiel `hooks.json`

La racine est un objet JSON dont chaque clé est un nom de hook unique :

```json
{
  "wf-hook-<id>": {
    "enabled": true,
    "PreToolUse": [
      {
        "matcher": "run_command",
        "hooks": [
          {
            "type": "command",
            "command": "..\\scripts\\hooks\\runner-antigravity.cmd",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

---

## 3. Contrat d'Entrée / Sortie (`PreToolUse`)

### Entrée (`stdin`) :
Reçoit un objet JSON sérialisé avec :
```json
{
  "toolCall": {
    "name": "run_command",
    "args": {
      "CommandLine": "git commit -m '...'",
      "Cwd": "C:\\...",
      "WaitMsBeforeAsync": 5000
    }
  },
  "stepIdx": 19,
  "conversationId": "...",
  "workspacePaths": ["..."]
}
```

### Sortie (`stdout`) :
Doit émettre un JSON strict :
```json
{
  "decision": "deny",
  "reason": "Violation de sécurité détectée : message explicite sans secret."
}
```
Décisions supportées : `"allow"`, `"deny"`, `"ask"`, `"force_ask"`, `"auto_approve"`, `"deny_unless_prior_grant"`.

---

## 4. Règles d'Or de Sécurité & Fail-Closed Antigravity

1. **Vidage Synchrone (`fs.writeSync(1)`)** :
   Le JSON de décision doit être écrit de manière synchrone sur le descripteur de fichier 1 pour éviter toute perte de buffer lors de l'arrêt du processus.
2. **Sortie Exit 0 Impérative** :
   Dès qu'une décision (`allow` ou `deny`) est émise sur `stdout`, le script Node sort en `process.exit(0)`. Cela garantit que le wrapper runner n'émet pas de second JSON concaténé.
3. **Runner Fail-Closed Externe (`.cmd` / `.sh`)** :
   Sous Windows (`.cmd`) et macOS/Linux (`.sh`), le runner capture un plantage système de Node (`ERRORLEVEL != 0`) et émet une décision `deny` de secours.
4. **Résolution de Chemin (%~dp0)** :
   Le runner résout dynamiquement le script Node par rapport à son propre dossier d'installation, sans dépendre de chemins relatifs fragiles.
