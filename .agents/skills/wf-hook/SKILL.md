---
name: wf-hook
description: "Action : Générateur interactif de hooks de sécurité et de validation pour l'Agent (Antigravity hooks.json, Claude Code settings.json) et Git (.githooks). S'active UNIQUEMENT sur saisie explicite de /wf-hook par l'utilisateur. Interdiction stricte au modèle de charger ou d'exécuter ce workflow de sa propre initiative."
tags:
  - workflow
  - hooks
  - security
---

# 🪝 Générateur Interactif de Hooks (/wf-hook)

Ce workflow d'action interactif guide l'utilisateur pas-à-pas pour concevoir, prévisualiser, installer de façon non destructive et tester un hook de sécurité ou de validation sur mesure.

---

## 🔒 Principes Directeurs & Garde-Fous Non Négociables

1. **Aperçu Obligatoire avant Installation** : L'Agent montre systématiquement le script de validation généré ET la déclaration de configuration exacte. Aucune écriture n'a lieu sans validation explicite préalable de l'utilisateur.
2. **Règle Fail-Closed Stricte** :
   - Claude Code : Encapsulation par le wrapper shell `... || { echo '...' >&2; exit 2; }` pour garantir le blocage sur tout échec (code 127, timeout, crash).
   - Antigravity : Écriture synchrone `fs.writeSync(1)` et sortie `exit 0` systématique dès qu'une décision est émise, combinée au runner externe (`.cmd` / `.sh`) pour capturer les défaillances amont de Node.
3. **Fusion Non Destructive & Sauvegardes** :
   - Sauvegarde préalable horodatée (`.bak.<timestamp>`) avant toute écriture.
   - Arrêt net avec alerte si le fichier JSON/JSONC existant est malformé (interdiction absolue d'écraser).
   - Préservation stricte de tous les hooks manuels existants de l'utilisateur.
4. **Anti-Lock-Out (Portée Projet d'abord)** :
   - Par défaut, tout hook est installé et testé en **portée projet**. La promotion en **portée globale machine** n'est proposée qu'après validation complète.
5. **Zéro Clé Custom** : Pas de clés non standard (`_managedBy`) dans `settings.json` de Claude Code. Identification par le nom unique de script (`scripts/hooks/wf-hook-<id>.js`).
6. **Scan de l'Index Réel** : Pour les vérifications pre-commit, inspection du contenu réellement indexé (`git show :<file>`), et non du disque.

---

## 🧭 Déroulement Interactif du Workflow

### Étape 0 — Déclenchement & Intention
1. Invoqué par `/wf-hook` suivi éventuellement d'une description libre (ex: `/wf-hook interdire le commit de fichiers .env et de clés privées`).
2. Reformuler clairement l'intention comprise et demander confirmation à l'utilisateur avant de passer à l'étape suivante.

---

### Étape 1 — Choix de la Famille de Hook
Poser la question à l'utilisateur :
- **A. Hook d'Agent (Harness IDE)** : Intercepte les commandes lancées par l'IA avant leur exécution dans l'éditeur.
- **B. Hook Git Universel** : Protège le dépôt quel que soit l'outil utilisé (même un `git commit` ou `git push` manuel tapé au terminal).
- **C. Les Deux (Défense en Profondeur - Recommandé)** : Hook d'agent + Hook Git appelant le même cœur de validation.

---

### Étape 2 — Précision des Déclencheurs & Cibles
Selon la famille retenue :
- **Si Hook d'Agent** :
  - Quel IDE cibler : **Claude Code** (`settings.json`), **Antigravity** (`hooks.json`), ou **Les Deux** ?
  - Déclencheur / Outil : `run_command` (Antigravity), `Bash` avec filtre d'autorisation `if: "Bash(git *)"` (Claude Code).
- **Si Hook Git** :
  - Quel événement Git : `pre-commit` (bloque avant l'entrée dans l'historique — obligatoire pour les secrets), `pre-push` (bloque avant le départ réseau), ou `commit-msg` (valide le message).

---

### Étape 3 — Règle Métier & Synthèse Générique
`wf-hook` est un générateur **générique** : il synthétise le cœur de validation selon le besoin exprimé :
1. **Secrets & Tokens** : Détection de clés d'API (AWS, Google, GitHub PAT, etc.), certificats et fichiers `.env`.
2. **Protection de Branche** : Blocage des commits ou pushs directs sur `main`, `master` ou `production`.
3. **Mots / Motifs Interdits** : Recherche de `debugger;`, `console.log` en prod, ou tokens internes.
4. **Convention de Commit** : Vérification du format Conventional Commits (`feat:`, `fix:`, etc.).
5. **Règle sur Mesure** : Logique JavaScript personnalisée.

*Décision en cas d'échec* :
- **Bloquer** (Fail-Closed : exit 2 pour Claude, deny pour Antigravity, exit 1 pour Git).
- **Avertir** (Log sans bloquer).

---

### Étape 4 — Portée & Emplacement
- **Recommandation par défaut** : Portée **Projet local** (`.agents/hooks.json`, `.claude/settings.json`, `.githooks/`).
- ℹ️ **Limite connue portée Machine globale** : La portée globale machine (`~/.claude/settings.json`) n'est pas encore recommandée pour Claude Code car les commandes installées s'appuient sur `${CLAUDE_PROJECT_DIR}` (spécifique au projet ouvert). La portée projet local (`.claude/settings.json`) est la cible officielle éprouvée.

---

### Étape 5 — Synthèse & Aperçu Obligatoire (Point de Contrôle)
Générer et **afficher intégralement à l'écran** :
1. Le script de validation généré : `wf-hook-<id>.js` (posé dans `.agents/skills/wf-hook/scripts/` ou `.githooks/`).
2. L'adaptateur cible et son runner Fail-Closed.
3. La déclaration exacte qui sera fusionnée dans `settings.json` ou `hooks.json`.

> ⚠️ **AUCUNE INSTALLATION NE DOIT ÊTRE ENGAGÉE AVANT L'ÉTAPE 6.**

---

### Étape 6 — Validation Explicite de l'Utilisateur
Poser la question formelle :
> *"Valides-tu l'installation de ce hook avec ces réglages ?"*
Attendre le « Oui » ou intégrer les modifications demandées.

---

### Étape 7 — Installation Non Destructive
Exécuter l'installation via le moteur [`hook-manager.js`](./scripts/hook-manager.js) :
1. Création de la copie de sauvegarde `.bak.<timestamp>`.
2. Vérification syntaxique (arrêt si JSON corrompu).
3. Injection idempotente de l'entrée (aucun doublon créé).
4. Pour Git : configuration automatique de `git config core.hooksPath .githooks`.

---

### Étape 8 — Test de Preuve Immédiat
Prouver en conditions réelles que le hook fonctionne :
1. **Test de Blocage** : Déclencher un cas d'épreuve (ex: faux secret officiel `AKIAIOSFODNN7EXAMPLE`) $\rightarrow$ montrer que l'action est **bloquée**, avec un message d'erreur clair et la valeur **masquée**.
2. **Test de Passage** : Déclencher une action saine $\rightarrow$ montrer que le flux est **autorisé sans encombre**.

---

### Étape 9 — Récapitulatif & Procédure de Désinstallation
Afficher la synthèse de livraison :
- Cibles configurées et fichiers scripts posés.
- Emplacement du backup horodaté créé.
- **Procédure de désinstallation d'urgence** :
  ```bash
  node -e "require('./.agents/skills/wf-hook/scripts/hook-manager').removeManagedHook(process.cwd(), '<hook-id>')"
  ```
  Ou indication des lignes à retirer manuellement en cas de lock-out.

---

## 📚 Guides de Référence Techniques
- [Guide des Hooks Claude Code](./references/claude-code-hooks-guide.md)
- [Guide des Hooks Antigravity](./references/antigravity-hooks-guide.md)
- [Guide des Hooks Git](./references/git-hooks-guide.md)
