# Scénarios de la suite d'injection Claude Code (CC01 à CC37)

Cette grille dit, pour chaque scénario, ce qu'il vérifie, avec quels jeux de fixtures, par quel instrument et par quels appels, ce qu'en dit la documentation, ce que suppose aujourd'hui l'extension, et quoi faire si le résultat change. Elle porte une colonne par baseline. Elle est distincte de `SCENARIOS.md` de la suite Antigravity.

## Légendes

- **Instruments** : **ctx** = `/context` (champ `context_usage`), gratuit ; **U** = différence d'usage réel (tokens d'entrée), payant ; **K** = canari rapporté par le modèle, payant.
- **Appels** : les identifiants du plan de la partie payante (`npm run sonde:claude -- --a-sec` les affiche). « Gratuit » désigne une combinaison de `sonde:claude-context` ; « E3 » est l'appel manuel dans le panneau.
- **Niveaux** : G = profil isolé (global), Pa = dossier parent (l'espace), Pr = projet.
- **Baselines** : une colonne par baseline datée de `attendu/`. Une cellule vide signifie que le scénario n'a pas encore été mesuré. Une colonne n'est jamais modifiée après coup.

## La grille

| N° | Ce qui est vérifié | Jeux de fixtures | Instrument | Appels | Attendu selon la documentation | Ce que suppose l'extension | Baseline 1 (à venir) | Si ça change |
|---|---|---|---|---|---|---|---|---|
| CC01 | Les bases, mesurées au début et à la fin de chaque série | aucun | U, ctx | U0a, U0b, S0a, S0b, T0a, T0b ; bornes des séries 4 et 5 | — | — | | Une base différente au début et à la fin rejette la série : relancer la série. |
| CC02 | CLAUDE.md global chargé | niveaux, cout-f-global | ctx, U, K | gratuit, U-global, 4b | Chargé | Lu, fichier brut compté en o200k | | Revoir le statut du CLAUDE.md global dans la jauge. |
| CC03 | `./CLAUDE.md` et `./.claude/CLAUDE.md` ensemble | niveaux | ctx, K | gratuit, 4b | L'un ou l'autre | Seulement `./CLAUDE.md` | | Revoir la lecture de `.claude/CLAUDE.md` du projet. |
| CC04 | `CLAUDE.local.md` | niveaux | ctx | gratuit | Chargé | Ignoré | | Ajouter ou retirer ce fichier de la jauge. |
| CC05 | CLAUDE.md du dossier parent | niveaux, cout-f-parent | ctx, U | gratuit, U2 | Chargé | Ignoré | | Ajouter ou retirer les dossiers parents de la jauge. |
| CC06 | `.claude/CLAUDE.md` du dossier parent (H16a) | niveaux | ctx, K | gratuit, 4b | Non explicite | Ignoré | | Idem CC05. |
| CC07 | CLAUDE.md global atteint aussi comme `.claude/CLAUDE.md` d'un parent (H16b) | aucune fixture | observation manuelle | lot E1 | Dédoublonnage non documenté | Compté une fois | | Revoir le dédoublonnage dans la jauge. |
| CC08 | CLAUDE.md d'un sous-dossier | declencheurs | ctx, K | gratuit, ER-sous | Chargé à la demande | Ignoré | | Revoir les coûts dynamiques des sous-dossiers. |
| CC09 | Imports `@` sur cinq niveaux | niveaux | ctx, K | gratuit, 4b | Quatre sauts au plus | Ligne `@` brute | | Revoir le comptage des imports. |
| CC10 | Commentaire HTML de bloc retiré (H8) | niveaux | ctx, K | gratuit, 4b | Retiré | Compté | | Retirer les commentaires du comptage. |
| CC11 | Frontmatter d'un CLAUDE.md retiré (H3) | niveaux | ctx, K | gratuit, 4b | Non documenté | Compté | | Retirer le frontmatter du comptage. |
| CC12 | CLAUDE.md global et du projet, contenus distincts (H1) | niveaux | ctx, U | gratuit, U1, U-global | Les deux concaténés | Doublon, global « gaspillé » | | Corriger l'alerte de doublon de la jauge. |
| CC13 | Contenus identiques à plusieurs niveaux (H1) | cout-f-* | ctx, U | gratuit, U2, U3 | Non documenté | Doublon | | Idem CC12. |
| CC14 | Coût de l'en-tête et du chemin (H2) | cout-f-* | U | U1, U2, U3, U-global, U4 | Non documenté | Aucun en-tête | | Ajouter l'en-tête mesuré au comptage (décomposition). |
| CC15 | Règles sans `paths`, globale et du projet | niveaux, cout-regle-court | ctx, U | gratuit, U5 | Chargées | Lues, frontmatter compté | | Revoir le comptage des règles permanentes. |
| CC16 | Frontmatter d'une règle retiré (H3) | niveaux | ctx, K | gratuit, 4b | Retiré | Compté | | Retirer le frontmatter du comptage. |
| CC17 | Règle `paths` absente au démarrage (H4) | niveaux, cout-regle-paths | ctx, U | gratuit, U7 | Non chargée | 20 tokens forfaitaires | | Retirer le forfait des règles `paths`. |
| CC18 | Déclencheurs d'une règle `paths` (H5) | declencheurs | K, U par tour | ER, EW, EE, EG, EGr, EB, témoin | Read, Write, Edit | « À la demande », sans précision | | Revoir les coûts dynamiques et le guide. |
| CC19 | Règle d'un sous-dossier de `rules/` (H6) | niveaux | ctx | gratuit | Récursif | Ignorée | | Ajouter les sous-dossiers de `rules/` à la jauge. |
| CC20 | Règles du dossier parent | niveaux | ctx | gratuit | Non explicite | Ignorées | | Idem CC05. |
| CC21 | Règle au YAML invalide | niveaux | ctx, K | gratuit, 4b | Chargée sans condition | Conditionnelle si `paths` n'est pas vide | | Revoir l'analyse du frontmatter de l'extension. |
| CC22 | `AGENTS.md` seul, puis avec un CLAUDE.md | agents-seul, agents-avec-claude | ctx | gratuit | Lu seulement sans CLAUDE.md | Ignoré | | Ajouter `AGENTS.md` à la jauge. |
| CC23 | `MEMORY.md` de la mémoire automatique | niveaux | ctx | gratuit | 200 lignes ou 25 Ko | Non lu | | Ajouter la mémoire automatique à la jauge. |
| CC24 | Skills global, du projet et du parent : coût et chemin (H9) | skills, cout-skill-* | ctx, U | gratuit, S1, S2 | Nom et description | Nom, description et chemin absolu | | Retirer le chemin du comptage des skills. |
| CC25 | Skill homonyme (H10) | skills | ctx, K | gratuit, 4c | Le skill personnel l'emporte | Doublon | | Revoir les doublons de skills. |
| CC26 | `disable-model-invocation` et skill de plugin (H11) | skills | ctx | gratuit | Retiré ; préfixe `plugin:` | Champ ignoré ; plugins non lus | | Revoir le comptage des skills cachés et des plugins. |
| CC27 | Description longue (plafond de 1 536 caractères) | skills, skill-long-1500 | ctx, U, K | gratuit, S-long, 4c | Coupée à 1 536 caractères | — | | Appliquer la coupe au comptage. |
| CC28 | Skill avec `paths:` | declencheurs | ctx, K | gratuit, 4c, ER-sous | Chargé avec un fichier correspondant | Compté comme actif | | Revoir le statut des skills `paths`. |
| CC29 | Skills sans l'outil Skill | skills | ctx | gratuit | — | Comptés | | Ne compter les skills que si l'outil Skill est actif. |
| CC30 | MCP : instructions, outils, variable d'environnement non injectée (H12) | mcp-canari, cout-mcp-* | U, K | M1, M2, M3, 4b | Noms des outils et instructions | JSON de la configuration | | Revoir le comptage des serveurs MCP. |
| CC31 | MCP différé ou chargé d'emblée | cout-mcp-a1 | U | M1, T1 | Mode `auto` : chargé sous 10 % | — | | Idem CC30. |
| CC32 | MCP : textes longs (4 096 caractères) | mcp-long | U, K | T-long, 4b | Coupés à 4 096 caractères | Alerte de 2 Ko par serveur | | Revoir l'alerte et la coupe. |
| CC33 | Sortie d'un hook `SessionStart` (H13) | hook-sortie | ctx, U, K | gratuit, H1, 4a | Sortie standard ajoutée, 10 000 caractères | Non lue | | Ajouter les hooks au panneau des coûts dynamiques. |
| CC34 | Hook muet : sa définition ne coûte rien | hook-muet | U | H2 | Non documenté | — | | Idem CC33. |
| CC35 | Format exact des enveloppes | niveaux, skills, hook-sortie, mcp-canari | K | 4a | Non documenté | — | | Mettre à jour le guide (texte dans `brut/`, à relire). |
| CC36 | `claude -p` et le panneau VS Code (H14) | niveaux, skills, hook-sortie | ctx, K | E3 | La CLI embarquée par l'extension | — | | Noter l'écart de version ; le comportement du panneau prime pour l'extension. |
| CC37 | Tokenizer de Claude et o200k (H15) | cout-f-projet, cout-h15-* | U, ctx | U1, U4, H15-en, H15-code | — | o200k fait foi | | Recalibrer la jauge d'après le rapport mesuré. |
