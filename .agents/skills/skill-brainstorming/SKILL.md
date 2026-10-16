---
name: skill-brainstorming
description: "S'active AVANT tout travail créatif ou d'implémentation (nouvelle fonctionnalité, composant, etc.) pour explorer l'intention de l'utilisateur, les prérequis et le design."
---

# Brainstorming : Des Idées aux Spécifications

Cette compétence permet de transformer des idées brutes en designs et spécifications complets via un dialogue naturel et collaboratif.

## 1. Principes Inflexibles (Guardrails)

<HARD-GATE>
**INTERDICTIONS ABSOLUES** :
1. **Zéro Code Prématuré** : Interdiction absolue d'invoquer une compétence d'implémentation (code, scaffold, build) ou d'éditer le moindre fichier source avant d'avoir présenté un design et obtenu la validation claire de l'utilisateur.
2. **Livrable Physique Obligatoire (`docs/spec-*.md`)** : Interdiction formelle de clore la phase de brainstorming sans avoir **physiquement rédigé et enregistré la spécification dans le dossier sas : `docs/spec-{nom-en-kebab-case}.md`**. La création de ce fichier est l'état terminal obligatoire qui valide la fin du brainstorming.
</HARD-GATE>

**Anti-Pattern : "C'est trop simple pour nécessiter une spec"**  
Même pour une liste de tâches, un ajustement cosmétique, un composant isolé ou une refonte ergonomique. Les fonctionnalités prétendument "simples" sont celles où les hypothèses non vérifiées causent le plus de régressions et de retouches. La spécification peut être concise, mais elle **DOIT être formalisée dans `docs/spec-*.md` et validée**.

---

## 2. Processus d'Exécution Méthodique (Checklist)

L'Agent DOIT exécuter ces 6 étapes dans l'ordre chronologique strict :

1. **Explorer le contexte du projet** : Inspecter l'architecture, les composants existants, les règles locales (`@rules-dev`) et la documentation.
2. **Poser des questions de clarification** : Une à la fois, pour cerner l'objectif réel, l'ergonomie visuelle, les contraintes et les critères de succès. L'approche à choix multiples est privilégiée.
3. **Proposer 2 à 3 approches tranchées** : Détailler les compromis (*trade-offs*) de chacune avec votre recommandation explicite.
4. **Présenter le design validé** : Présenter la solution retenue, les maquettes, les flux utilisateurs et les cas limites. Recueillir l'accord de l'utilisateur.
5. **Rédiger OBLIGATOIREMENT la Spécification (`docs/spec-*.md`)** :
   - Dès la validation du design par l'utilisateur, l'Agent a l'**obligation formelle de générer le fichier physique** :  
     👉 **`docs/spec-{nom-en-kebab-case}.md`** *(ex: `docs/spec-favoris.md`, `docs/spec-menu-workflows.md`)*.
   - Ce document doit comporter : Contexte & Objectif, Choix fonctionnels & UI retenus, Maquettes textuelles ou ASCII, Cas d'usage et Découpage attendu.
6. **Clôture Formelle & Transition vers `/wf-plan-feature`** :
   - Présenter le lien vers `docs/spec-{nom}.md` à l'utilisateur.
   - L'inviter expressément à passer à la phase suivante via la commande :  
     `/wf-plan-feature "Basé sur docs/spec-{nom}.md"` pour générer ensuite `docs/plan-{nom}.md`.

---

## 3. Retours d'Expérience & Bonnes Pratiques

- **Une question à la fois** : Ne jamais submerger l'utilisateur avec une rafale de questions ouvertes dans le même message.
- **YAGNI (You Aren't Gonna Need It)** : Éliminer impitoyablement toute complexité ou fonctionnalité non demandée.
- **État Terminal Strict** : La compétence s'achève UNIQUEMENT après l'écriture du fichier `docs/spec-*.md` et l'invitation à lancer `/wf-plan-feature`. N'invoquer aucun outil de codage directement après le brainstorming.
