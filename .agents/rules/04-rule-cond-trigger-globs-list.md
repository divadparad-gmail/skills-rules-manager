---
description: Règle conditionnelle dont les globs sont écrits en liste YAML, un format non documenté
trigger: glob
globs:
  - "src/webview/**/*.js"
  - "src/webview/**/*.css"
---

# Règle Conditionnelle Trigger Globs (Liste YAML)

Cette règle écrit `globs:` en tableau YAML (`- "..."`), alors que la documentation d'Antigravity décrit une chaîne de motifs séparés par des virgules.
Elle reste détectée comme **Conditionnelle** (`trigger: glob`), mais l'extension doit afficher le badge `⚠️ Frontmatter` pour signaler le format de `globs`.

## Directives Webview UI
- Éviter les sélecteurs CSS globaux susceptibles de polluer d'autres panneaux.
- Utiliser systématiquement les variables de thème VS Code (`--vscode-*`).
