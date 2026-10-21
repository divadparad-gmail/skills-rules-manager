Rapport brut de l'agent Antigravity IDE, enquête du 2026-10-21, non retouché sauf caviardage des chemins locaux et des noms de serveurs MCP.

1. Au démarrage (aucun outil)
Chaînes CANARI visibles : Aucune [OBSERVÉ].
Le contexte initial au démarrage contenait les règles permanentes (GEMINI.md, 02-rule-perm-standard-always-on.md, 06-rule-warn-size-exceeded-24kb.md, 08-rule-dedup-active.md, rule-test-doublon.md), mais aucun canari n'y figurait.
2. Lecture de sandbox-enquete/app.ts
Nouvelles chaînes apparues : CANARI-G3 et CANARI-G4 [OBSERVÉ].
Forme d'injection : Ajout automatique en queue du résultat de l'outil view_file, sous un bloc débutant par :
The following text is not part of the file, it is a list of user-defined rules that you MUST follow: [OBSERVÉ].
3. Lecture de src/zz-test.ts
Nouvelles chaînes apparues : Aucune [OBSERVÉ].
Note sur le contexte de l'outil : CANARI-G3 est réinjecté dans le résultat de view_file ; CANARI-G4 est absent [OBSERVÉ].
4. Lecture de sandbox-enquete/sous/profond/x.ts
Nouvelles chaînes apparues : Aucune [OBSERVÉ].
Note sur le contexte de l'outil : CANARI-G3 est réinjecté dans le résultat de view_file ; CANARI-G4 est absent ; CANARI-DOSSIER (provenant de sandbox-enquete/sous/AGENTS.md) est absent [OBSERVÉ].
5. Modification de sandbox-enquete/sous/module.ts
Action exécutée : Ajout de // test via l'outil replace_file_content [TESTÉ].
Nouvelles chaînes apparues : Aucune [OBSERVÉ].
Note sur le contexte de l'outil : Le retour de replace_file_content contient également en queue le bloc de règle avec CANARI-G3 ; CANARI-DOSSIER est absent [OBSERVÉ].
6. Chemin exact tel qu'il apparaît dans les outils de lecture (view_file)
Chemin exact observé :
<PROJET>/sandbox-enquete/app.ts [OBSERVÉ]
Caractéristiques du format :
Préfixe d'URI absolu : file:///
Lettre de lecteur en minuscule : c:
Séparateurs : barres obliques / (slash POSIX)
Espaces encodés en URL : %20 (<PROJET>)
Rapport de synthèse des Canaris
Canari	Étape 1	Étape 2	Étape 3	Étape 4	Étape 5	Forme d'injection
CANARI-G1 (**/sandbox-enquete/**/*.ts)	Non	Non	Non	Non	Non	Jamais injecté [OBSERVÉ]
CANARI-G2 (sandbox-enquete/*.ts)	Non	Non	Non	Non	Non	Jamais injecté [OBSERVÉ]
CANARI-G3 (**/*.ts)	Non	Oui	Oui	Oui	Oui	Ajout au résultat d'outil (view_file, replace_file_content) [OBSERVÉ]
CANARI-G4 (app.ts)	Non	Oui	Non	Non	Non	Ajout au résultat d'outil (view_file) [OBSERVÉ]
CANARI-G5 (sandbox-enquete\**\*.ts)	Non	Non	Non	Non	Non	Jamais injecté [OBSERVÉ]
CANARI-G6 (src/**/*.ts)	Non	Non	Non	Non	Non	Jamais injecté [OBSERVÉ]
CANARI-GLOB-CHAINE (sandbox-enquete/**/*.ts)	Non	Non	Non	Non	Non	Jamais injecté [OBSERVÉ]
CANARI-GLOB-LISTE (["sandbox-enquete/**/*.ts"])	Non	Non	Non	Non	Non	Jamais injecté [OBSERVÉ]
CANARI-DOSSIER (sous/AGENTS.md)	Non	Non	Non	Non	Non	Jamais injecté [OBSERVÉ]
CANARI-SANS-FM (zz-sans-fm.md)	Non	Non	Non	Non	Non	Jamais injecté [OBSERVÉ]
CANARI-MANUAL (trigger: manual)	Non	Non	Non	Non	Non	Jamais injecté [OBSERVÉ]
CANARI-MIXTE (globs + paths)	Non	Non	Non	Non	Non	Jamais injecté [OBSERVÉ]
CANARI-MODEL (trigger: model_decision)	Non	Non	Non	Non	Non	Jamais injecté [OBSERVÉ]
7. Analyse du skill intégré agy-customizations
Fichiers consultés dans <HOME>\.gemini\antigravity-ide\builtin\skills\agy-customizations/ : 

SKILL.md
, 

docs/rules.md
, 

docs/skills.md
, 

docs/plugins.md
, 

docs/hooks.md
, 

docs/mcp_servers.md
, 

docs/json_configs.md
.

a. Correspondance des globs (relatif à la racine, absolu ou nom seul ; séparateurs Windows)
Ce que dit le skill : INCONNU. Le terme glob ou globs n'apparaît nulle part dans 

SKILL.md
 ni dans ses documents de référence (seul le mot Global y figure).
Contradiction / Constat avec les étapes 1 à 5 :
[OBSERVÉ] : Bien que non documenté dans ce skill, le runtime Antigravity supporte bien les déclencheurs conditionnels trigger: glob.
[OBSERVÉ] : Sur Windows, tous les motifs contenant des répertoires relatifs (sandbox-enquete/*.ts, src/**/*.ts, **/sandbox-enquete/**/*.ts, sandbox-enquete\**\*.ts) ont échoué à se déclencher. Seuls le nom de fichier strict (globs: "app.ts"), les extensions génériques (globs: "*.ts, *.tsx") et le wildcard total (globs: "**/*.ts") ont fonctionné.
b. Chargement des AGENTS.md / GEMINI.md de sous-dossier : déclencheur exact
Citations textuelles :
Dans 

SKILL.md
 :
« As you open or edit files, the agent walks up from the file's directory to the repository root, loading all rules it finds. »
Dans 

docs/rules.md
 :
« The system walks up from the current working directory to the repository root and loads these files. They apply to the directory they reside in and all its subdirectories. »
Dans 

docs/rules.md
 :
« Standalone GEMINI.md / AGENTS.md files do not support frontmatter and are always active for their directory scope. »
Contradiction directe avec les étapes 1 à 5 :
[OBSERVÉ] : Contradiction flagrante. La documentation affirme que lors de l'ouverture ou de la modification d'un fichier, le système remonte l'arborescence depuis le dossier du fichier (« walks up from the file's directory to the repository root ») pour charger les fichiers de règles.
Or, lors de l'étape 4 (lecture de sandbox-enquete/sous/profond/x.ts) et de l'étape 5 (modification de sandbox-enquete/sous/module.ts), le fichier 

sandbox-enquete/sous/AGENTS.md
 contenant CANARI-DOSSIER n'a JAMAIS été chargé ni injecté dans le contexte de l'agent.
c. Workflows et leur migration
Ce que dit le skill : INCONNU.
Le mot "migration" n'apparaît à aucun endroit.
Le mot "workflow" n'apparaît que comme terme générique désignant les procédures des skills (ex. dans 

docs/skills.md
 : « They serve as "cheatsheets" or runbooks for specific workflows »). Aucun concept de fichier/dossier distinct nommé "workflow" ni procédure de migration n'y est décrit.
d. MCP : critère classant un outil en Eager ou en Lazy
Ce que dit le skill : INCONNU.
Les termes Eager et Lazy sont totalement absents du skill et de 

docs/mcp_servers.md
.
La documentation se limite à décrire l'injection globale :
« Discovered tools are automatically added to the agent's toolset and listed in the system prompt. » (

docs/mcp_servers.md
). Aucun critère de découpage Eager/Lazy n'est documenté.
