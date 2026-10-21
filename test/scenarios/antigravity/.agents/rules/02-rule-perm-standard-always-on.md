---
description: Règle permanente standard déclarée avec trigger always_on
trigger: always_on
tags:
  - securite
  - standard
---

# Règle Permanente Standard (Always-On)

Cette règle permanente contient un frontmatter YAML standard avec `trigger: always_on`, `description:` et `tags:`.
Elle doit donc être chargée en intégralité au démarrage (100% de ses tokens au boot) et rester active en permanence.

## Directives
- Ne jamais stocker de mots de passe, tokens JWT ou clés privées en clair dans le code.
- Utiliser systématiquement des variables d'environnement pour les secrets d'infrastructure.
