---
description: Règle permanente standard avec métadonnées explicites mais sans trigger (Always-On)
tags:
  - securite
  - standard
---

# Règle Permanente Standard (Always-On)

Cette règle permanente contient un frontmatter YAML standard avec `description:` et `tags:`, mais **aucun trigger**.
Elle doit donc être chargée en intégralité au démarrage (100% de ses tokens au boot) et rester active en permanence.

## Directives
- Ne jamais stocker de mots de passe, tokens JWT ou clés privées en clair dans le code.
- Utiliser systématiquement des variables d'environnement pour les secrets d'infrastructure.
