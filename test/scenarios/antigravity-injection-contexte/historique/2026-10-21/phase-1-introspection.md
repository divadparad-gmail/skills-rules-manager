Rapport brut de l'agent Antigravity IDE, enquête du 2026-10-21, non retouché sauf caviardage des chemins locaux et des noms de serveurs MCP.

Étape 1 — Introspection (état initial du contexte)
1. Liste des skills disponibles
Statut : OBSERVÉ

Les skills sont injectés dans une section <skills> sous la forme d'une liste à puces. Voici la citation textuelle exacte de l'en-tête et des deux premières entrées :

text
Available skills:
- agy-customizations (<HOME>\.gemini\antigravity-ide\builtin\skills\agy-customizations\SKILL.md): Comprehensive guide and reference for the Antigravity Customization System. Use to explain how customizations work, their loading priority, discovery mechanisms, and to guide the creation of skills, rules, plugins, hooks, and MCP servers.
- antigravity-guide (<HOME>\.gemini\antigravity-ide\builtin\skills\antigravity_guide\SKILL.md): Provides a comprehensive guide, quick reference, and sitemap for Google Antigravity (AGY), including the Antigravity CLI (agy), Antigravity 2.0, Antigravity IDE, Python SDK, slash commands, keybindings, and customizations (skills, rules, MCP, sidecars). Activate this skill when the user asks questions about how to use, configure, or customize Antigravity, AGY, the agy CLI, the Antigravity IDE, or Antigravity 2.0.
Format exact d'une entrée : - <nom-du-skill> (<chemin-absolu-vers-SKILL.md>): <description-extraite-du-frontmatter>

2. Format et visibilité des rules
Statut : OBSERVÉ

Le prompt contient deux mécanismes distincts selon le type de règle :

A. Règles permanentes / actives injectées en ligne
Elles sont encapsulées dans des balises pseudo-XML <RULE[<chemin_ou_id>]> avec leur contenu markdown complet (ou tronqué au-delà d'un plafond) :

text
<RULE[<PROJET>\.agents\rules\02-rule-perm-standard-always-on.md]>
# Règle Permanente Standard (Always-On)
Cette règle permanente contient un frontmatter YAML standard avec `trigger: always_on`, `description:` et `tags:`.
Elle doit donc être chargée en intégralité au démarrage (100% de ses tokens au boot) et rester active en permanence.
...
</RULE[<PROJET>\.agents\rules\02-rule-perm-standard-always-on.md]>
(Note observée : Pour la règle 06-rule-warn-size-exceeded-24kb.md, le contenu se termine par <truncated 14978 bytes>).

B. Règles conditionnelles (pointeurs / index)
À la fin du bloc <user_rules>, les règles conditionnelles sont introduites sous forme de pointeurs URI :

text
The following are conditional rules, formatted as: - [absolute path]: [description].
The description provides conditions under which the rule applies. If you believe a rule should apply, view the file for further instructions.
- <PROJET>/.agents/rules/05-rule-cond-trigger-model-decision.md: Règle conditionnelle activée sémantiquement par le modèle selon le contexte
3. État des serveurs et outils MCP
Statut : OBSERVÉ

Dans la section <mcp_servers>, cinq serveurs sont déclarés :

text
# serveur-mcp-1
# serveur-mcp-2
Lazy:
create_or_update_file
search_repositories
create_repository
get_file_contents
push_files
fork_repository
create_branch
search_code
# serveur-mcp-3
# serveur-mcp-4
Lazy:
query
# serveur-mcp-5
Visibilité des schémas : Les schémas ne sont pas visibles d'emblée. Le prompt indique :
"For lazily-loaded tools, read the corresponding schema file to understand the arguments and usage, then call the tool using the call_mcp_tool tool."

Outils Eager vs Lazy : Aucun outil n'est listé sous Eager:. Seuls les noms des outils sous Lazy: sont énumérés pour serveur-mcp-2 et serveur-mcp-4. Aucun outil n'est listé pour serveur-mcp-1, serveur-mcp-3 et serveur-mcp-5.
Descriptions visibles : 0 caractère. Aucune description textuelle d'outil MCP n'est fournie dans le prompt (uniquement le nom de la fonction, ex: create_or_update_file).
4. Slash commands et dossier workflows
Statut : OBSERVÉ / INCONNU

Commande /migrate-workflows : ABSENTE. La section <slash_commands> liste exclusivement : /goal, /schedule, /plan, /grill-me, /learn. (OBSERVÉ)
Dossier .agents/workflows/ : Non mentionné dans la section d'architecture <customizations> (qui ne documente que skills/, rules/, plugins/, mcp_config.json, hooks.json). Son existence physique sur le disque dans ce projet est INCONNUE au niveau de l'introspection pure (aucun outil utilisé en Étape 1).
Étape 2 — Création des fichiers de test
Les 15 fichiers ont été créés avec write_to_file. Conformément à la consigne stricte, aucun fichier n'a été relu après création.

.agents/rules/zz-glob-liste.md
.agents/rules/zz-glob-chaine.md
.agents/rules/zz-mixte.md
.agents/rules/zz-sans-fm.md
.agents/rules/zz-model.md
.agents/rules/zz-manual.md
sandbox-enquete/app.ts
sandbox-enquete/notes.md
sandbox-enquete/sous/AGENTS.md
sandbox-enquete/sous/module.ts
.agents/skills/zz-skill-test/SKILL.md
.agents/skills/zz-skill-test/references/ref.md
.agents/skills/zz-skill-test/resources/res.md
.agents/plugins/zz-plugin-test/plugin.json
.agents/plugins/zz-plugin-test/skills/zz-plugin-skill/SKILL.md
(Observation émergente lors de la création de app.ts et module.ts : le harnais Antigravity a réagi en injectant immédiatement dans le retour d'outil la règle conditionnelle trigger: glob matchant *.ts).

Étape 3 — Rapport synthétique
#	Point investigué	Statut	Preuve (citation textuelle courte ou résultat)
1	Format de liste des skills	OBSERVÉ	- <nom> (<chemin-absolu-vers-SKILL.md>): <description>
2	Format des rules permanentes	OBSERVÉ	Balises <RULE[<chemin_absolu>]> contenant le markdown complet
3	Tronquage de rules volumineuses	OBSERVÉ	<truncated 14978 bytes> présent dans la règle 06-rule-warn-size-exceeded-24kb.md
4	Index des rules conditionnelles / model_decision	OBSERVÉ	The following are conditional rules, formatted as: - [absolute path]: [description].
5	Schémas d'outils MCP	OBSERVÉ	Non chargés d'avance ; mécanisme lazy via lecture de fichier .json sur disque
6	Descriptions d'outils MCP visibles	OBSERVÉ	0 caractère visible (seuls les identifiants textuels bruts sont listés sous Lazy:)
7	Commande /migrate-workflows	OBSERVÉ	Absente du bloc <slash_commands> (5 commandes déclarées : goal, schedule, plan, grill-me, learn)
8	Dossier .agents/workflows/	INCONNU	Non mentionné dans le prompt système <customizations> ; non inspecté par outil en Étape 1
9	Création des 15 fichiers canaris	TESTÉ	15 fichiers créés sans relecture via write_to_file
⚠️ Rappel pour la Phase 2 : Pour observer la prise en compte à froid des nouveaux fichiers canaris (skills, rules glob/model/manual, plugins), veuillez recharger la fenêtre de l'IDE (Developer: Reload Window) puis ouvrir une NOUVELLE session de chat fraîche.
