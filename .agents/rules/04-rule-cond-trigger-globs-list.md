---
description: Règle conditionnelle avec liste de motifs globaux en tableau YAML
trigger: glob
globs:
  - "src/webview/**/*.js"
  - "src/webview/**/*.css"
---

# Règle Conditionnelle Trigger Globs (Liste YAML)

Cette règle teste la prise en charge de la syntaxe de tableau YAML (`- "..."`) pour la clé `globs:`.
Elle doit être détectée comme **Conditionnelle** avec le badge `⚡ Conditionnel` et décomptée à ~20 tokens au boot.

## Directives Webview UI
- Éviter les sélecteurs CSS globaux susceptibles de polluer d'autres panneaux.
- Utiliser systématiquement les variables de thème VS Code (`--vscode-*`).
