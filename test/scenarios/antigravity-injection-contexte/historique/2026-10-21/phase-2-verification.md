Rapport brut de l'agent Antigravity IDE, enquête du 2026-10-21, non retouché sauf caviardage des chemins locaux et des noms de serveurs MCP.

Voici le compte-rendu exhaustif de la Phase 2 de l'enquête Antigravity, réalisé selon la grille de rigueur factuelle (OBSERVÉ / TESTÉ / INFÉRÉ / INCONNU).

Étape A — Démarrage (aucun outil)
1. Chaînes « CANARI-… » au démarrage
Statut : OBSERVÉ.
Résultat : Aucune chaîne « CANARI-… » provenant du système, des règles permanentes, des règles conditionnelles, des skills ou des plugins n'est présente dans mon contexte au démarrage.
Précision : Les seules occurrences textuelles commençant par « CANARI- » sont celles formulées mot pour mot dans votre propre prompt utilisateur (CANARI-REFERENCES, CANARI-RESOURCES, et la mention générique « CANARI-… »).
2. Entrées de zz-skill-test et zz-plugin-skill dans la liste de skills
Statut : OBSERVÉ.
Citations textuelles de la section <skills> :
markdown
- zz-plugin-skill (<PROJET>\.agents\plugins\zz-plugin-test\skills\zz-plugin-skill\SKILL.md): Skill de plugin de test. À utiliser uniquement pour le mot de passe de plugin.
- zz-skill-test (<PROJET>\.agents\skills\zz-skill-test\SKILL.md): Skill de test d'enquête. À utiliser uniquement quand on demande le mot de passe d'enquête.
Section <plugins> :
markdown
# zz-plugin-test (<PROJET>/.agents/plugins/zz-plugin-test)
Skills:
- zz-plugin-skill (<PROJET>\.agents\plugins\zz-plugin-test\skills\zz-plugin-skill\SKILL.md): Skill de plugin de test. À utiliser uniquement pour le mot de passe de plugin.
Présence de préfixe : Non. Le nom affiché dans la liste des skills est strictement zz-plugin-skill (sans préfixe de namespace tel que zz-plugin-test:zz-plugin-skill). Le plugin parent n'apparaît que dans le chemin physique du fichier et dans la section dédiée <plugins>.
3. Visibilité de zz-model et zz-manual
zz-model (OBSERVÉ) :
Chemin : <PROJET>/.agents/rules/zz-model.md
Description : Appliquer uniquement quand on parle de licornes quantiques.
Contenu : Rien (le corps du fichier markdown n'est pas injecté dans le contexte).
zz-manual (OBSERVÉ) :
Rien. Totalement absent du prompt système (ni chemin, ni description, ni contenu, absent tant des règles permanentes que conditionnelles).
Étape B — Lire un fichier ciblé (sandbox-enquete/app.ts)
Outil exécuté : view_file sur 

sandbox-enquete/app.ts
.
Contenu du fichier : export const a = 1;
Nouvelles chaînes « CANARI-… » apparues : Aucune.
Forme d'injection observée : Le runtime Antigravity a détecté que le fichier lu correspondait au glob *.ts, *.tsx d'une règle conditionnelle. Il a automatiquement injecté le contenu de cette règle en suffixe du résultat de l'outil view_file sous la forme :
text
The following text is not part of the file, it is a list of user-defined rules that you MUST follow:
# Règle Conditionnelle Trigger Glob (Chaîne Simple)
...
(La règle conditionnelle déclenchée ici était celle du projet existant 03-rule-cond-trigger-glob-simple.md, qui ne contenait pas de chaîne canari).
Étape C — Fichier témoin (sandbox-enquete/notes.md)
Outil exécuté : view_file sur 

sandbox-enquete/notes.md
.
Contenu du fichier : Fichier témoin.
Nouvelles chaînes « CANARI-… » apparues : Aucune.
Forme d'injection : Néant. Le résultat de l'outil n'a reçu aucun appendice de règles.
Étape D — Dossier : lister puis lire
D1. Listing de sandbox-enquete/sous/
Outil exécuté : list_dir sur 

sandbox-enquete/sous/
.
Résultat retourné :
json
{"name":"AGENTS.md","sizeBytes":"15"}
{"name":"module.ts","sizeBytes":"20"}
Nouvelles chaînes « CANARI-… » apparues : Aucune.
Forme d'injection : Néant. Le listing d'un dossier (list_dir) ne charge ni n'injecte le contenu des fichiers découverts (y compris AGENTS.md).
D2. Lecture de sandbox-enquete/sous/module.ts
Outil exécuté : view_file sur 

sandbox-enquete/sous/module.ts
.
Contenu du fichier : export const b = 2;
Nouvelles chaînes « CANARI-… » apparues : Aucune.
Forme d'injection : Même appendice de règles utilisateur TypeScript en suffixe de view_file qu'à l'étape B. Aucun canari.
Étape E — Skill et annexes
Outil exécuté : view_file sur 

SKILL.md
 de zz-skill-test (aucun autre fichier consulté).
Contenu retourné :
markdown
---
name: zz-skill-test
description: Skill de test d'enquête. À utiliser uniquement quand on demande le mot de passe d'enquête.
---
CANARI-SKILL-CORPS. Le mot de passe d'enquête est « orange ».
(Aucun lien vers les autres fichiers du dossier.)
Mot de passe d'enquête : « orange ».
Nouvelles chaînes « CANARI-… » apparues : CANARI-SKILL-CORPS.
Forme d'injection : Présente dans le corps du fichier SKILL.md retourné par view_file.
Réponses aux questions spécifiques :
CANARI-REFERENCES ou CANARI-RESOURCES sont-ils dans ton contexte ? NON. Absolument absents (hormis dans votre question).
Le dossier references/ t'est-il signalé d'une façon quelconque ? NON. Ni le prompt système, ni le frontmatter, ni le corps du SKILL.md ne mentionnent l'existence d'un dossier references/ pour ce skill.
Sans mon interdiction, les aurais-tu lus ? Pourquoi ? NON. Le prompt du skill fournissait la réponse immédiate et complète (« orange ») et ne contenait aucune directive de consultation externe. Le protocole standard Antigravity prévoit de ne consulter les sous-dossiers (references/, resources/, scripts/) que si le SKILL.md y renvoie explicitement.
Étape F — Rapport de synthèse
Tableau 1 : Traçabilité des Canaris
Canari	Visible au démarrage	Après B	Après C	Après D1	Après D2	Après E	Forme d'injection
CANARI-SKILL-CORPS	Non	Non	Non	Non	Non	OUI	Corps textuel de SKILL.md (via view_file)
CANARI-REFERENCES	Non	Non	Non	Non	Non	Non	Jamais injecté (non sollicité par SKILL.md)
CANARI-RESOURCES	Non	Non	Non	Non	Non	Non	Jamais injecté (non sollicité par SKILL.md)
Canari de zz-model (si configuré)	Non	Non	Non	Non	Non	Non	Jamais injecté (condition licornes non activée)
Canari de zz-manual (si configuré)	Non	Non	Non	Non	Non	Non	Jamais injecté (règle non découverte par Antigravity)
Canari de sous/AGENTS.md (si configuré)	Non	Non	Non	Non	Non	Non	Jamais injecté (list_dir n'injecte pas, non lu)
Tableau 2 : Validation des mécanismes Antigravity
Point investigué	Statut	Preuve
Injection dynamique des règles par Glob	TESTÉ / OBSERVÉ	Lors de la lecture d'un fichier .ts (app.ts ou module.ts), Antigravity appose automatiquement la règle correspondante en fin de résultat de view_file avec le préfixe "The following text is not part of the file, it is a list of user-defined rules that you MUST follow:".
Fichiers non ciblés (témoin)	TESTÉ / OBSERVÉ	La lecture de notes.md retourne uniquement le contenu brut, sans appendice de règles.
Listing de répertoire (list_dir)	TESTÉ / OBSERVÉ	Lister un sous-dossier contenant un AGENTS.md ne déclenche aucune injection de règle dans le contexte.
Règles conditionnelles sémantiques (trigger: model_decision)	OBSERVÉ	zz-model n'expose au boot que son URI et sa description (Appliquer uniquement quand on parle de licornes quantiques.). Son corps n'est pas chargé.
Règles sans trigger explicite (zz-manual)	OBSERVÉ	Totalement absente du contexte initial (ni URI, ni description, ni contenu). Antigravity ne l'a pas indexée au boot.
Namespace des plugins (zz-plugin-skill)	OBSERVÉ	Le skill issu d'un plugin apparaît sous son nom brut (zz-plugin-skill) sans préfixe de namespace dans la liste globale <skills>. Sa provenance n'apparaît que dans son chemin et dans la section dédiée <plugins>.
Confinement des annexes de skills	TESTÉ / OBSERVÉ	Les sous-dossiers (references/, resources/) ne sont ni signalés ni pré-chargés au boot ou lors de l'accès à SKILL.md.
Étape G — Nettoyage
Conformément à vos consignes de sécurité, je vous demande votre confirmation formelle avant de procéder à la suppression des éléments suivants :

Dossier sandbox-enquete/
Fichiers .agents/rules/zz-*.md
Dossier .agents/skills/zz-skill-test/
Dossier .agents/plugins/zz-plugin-test/
Confirmez-vous le lancement de ce nettoyage ?
