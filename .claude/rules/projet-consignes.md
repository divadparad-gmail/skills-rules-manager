# Consignes du projet

- Réponds en français : conversation, documentation et messages de commit.
- Rédige les commits au format Conventional Commits, en français, avec un type `feat`, `fix`, `docs` ou `chore` et une portée.
- Montre toujours le message de commit et attends mon accord avant de commiter. Ne pousse jamais sans demande explicite.
- Lance `npm test` avant de proposer un commit, et signale tout échec.
- N'exécute jamais `git clean -x` ou `git clean -X` dans ce dépôt.
- Si le dossier `.banc-essai-sauvegarde/` existe, ne le modifie ni ne le supprime jamais : signale-le, et vide le banc d'essai avec `npm run test:clean`.
- Le dossier `docs/` est ignoré par Git : n'y force aucun ajout.
- N'écris aucune donnée locale (chemin personnel, nom d'hôte, nom réel de serveur MCP) dans un fichier suivi par Git.
- N'utilise jamais `git commit --no-verify` dans ce dépôt.
- Ne corrige jamais un fait testé d'après la documentation officielle d'Antigravity : en cas de contradiction, les tests de `test/scenarios/antigravity-injection-contexte/` font foi.
