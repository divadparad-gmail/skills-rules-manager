---
description: Règle conditionnelle ciblée sur les fichiers TypeScript via un trigger glob scalaire
trigger: glob
globs: "*.ts, *.tsx"
---

# Règle Conditionnelle Trigger Glob (Chaîne Simple)

Cette règle est conditionnelle sous Antigravity grâce à `trigger: glob` et `globs: "*.ts, *.tsx"`.
L'extension la compte pour **~20 tokens** au boot dans la jauge (estimation de l'extension, non chiffrée par la documentation).

## Directives TypeScript Spécifiques
- Toujours typer les arguments et le type de retour des fonctions publiques.
- Préférer les types d'union stricts aux chaînes de caractères arbitraires.
- Valider les données inconnues avec Zod avant traitement métier.
