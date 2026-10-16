---
description: Règle conditionnelle activée sémantiquement par le modèle selon le contexte
trigger: model_decision
---

# Règle Conditionnelle Trigger Model Decision

Cette règle utilise le mode de déclenchement `trigger: model_decision`.
Elle est conditionnelle : l'agent ne l'injecte dans son contexte que lorsqu'il juge la tâche en cours pertinente pour cette thématique.
Coût au boot : ~20 tokens pour l'enregistrement du descripteur.

## Directives d'Optimisation des Performances
- Profiler la consommation mémoire avant d'augmenter la taille des tampons.
- Éviter les boucles imbriquées sur de grands tableaux d'objets.
