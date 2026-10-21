---
scenario_fixture: true
description: Règle de test du scénario doublon Global vs Local
trigger: always_on
---

# Règle Test : Scénario Doublon Global vs Local

Cette règle de test est injectée simultanément dans la configuration **Globale** (`~/.gemini/config/rules/`) et dans le projet **Local** (`.agents/rules/`).

Elle sert à valider le banc d'essai :
1. La détection du doublon actif au démarrage.
2. Le calcul des tokens gaspillés (+150 tok).
3. L'apparition du badge d'alerte orange et de la pilule supérieure.
4. Le bouton d'extinction rapide en 1 clic pour éliminer le gaspillage.
