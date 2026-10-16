# Modèle de README.md Vitrine Haute Performance

Ce modèle sert de référence pour générer un `README.md` attrayant, structuré et immédiatement exploitable pour un projet hébergé sur GitHub.

---

```markdown
# [Nom du Projet] <!-- ex: Skills & Rules Manager -->

<div align="center">

[![GitHub Release](https://img.shields.io/github/v/release/{owner}/{repo}?color=7c3aed&style=for-the-badge&logo=github)](https://github.com/{owner}/{repo}/releases)
[![VS Code Engine](https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC?style=for-the-badge&logo=visualstudiocode)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald?style=for-the-badge)](LICENSE)
[![Status: Stable](https://img.shields.io/badge/Status-Production%20Ready-success?style=for-the-badge)](#)

<p align="center">
  <strong>[Phrase d'accroche principale : Description percutante de la proposition de valeur]</strong>
</p>

[ [Télécharger la dernière version ({version})](https://github.com/{owner}/{repo}/releases/latest) ] •
[ [Signaler un problème](https://github.com/{owner}/{repo}/issues) ] •
[ [Guide des Bonnes Pratiques](#guide-dutilisation) ]

</div>

---

## ✨ Points Forts & Valeur Ajoutée

- **[Fonctionnalité Clé 1]** : [Explication concrète du bénéfice utilisateur].
- **[Fonctionnalité Clé 2]** : [Explication concrète du bénéfice utilisateur].
- **[Fonctionnalité Clé 3]** : [Explication concrète du bénéfice utilisateur].

---

## 📸 Aperçus Visuels (Showroom)

<div align="center">

### 🖥️ Grand Tableau de Bord Comparatif
![Dashboard](media/screenshots/dashboard.png)
*Visualisation et synchronisation en 3 colonnes : NAS, Machine Globale et Projet Local.*

<br/>

| 🧭 Vue Latérale VS Code | 📖 Guide & Bonnes Pratiques IA |
| :---: | :---: |
| ![Sidebar](media/screenshots/sidebar.png) | ![Cheat Sheet](media/screenshots/cheatsheet.png) |
| *Accès rapide, statut de synchronisation et bascules groupées.* | *Comparatif Antigravity vs Claude Code et règles d'or.* |

<br/>

### ⚠️ Détection Intelligente des Doublons (Global vs Local)
![Détection des Doublons](media/screenshots/duplicates.png)
*Identification en temps réel des surcharges et calcul des tokens gaspillés.*

</div>

---

## 🏛️ Architecture & Fonctionnalités Majeures

### 1. Orchestration Hiérarchique Multi-Niveaux
- **🏛️ Niveau 3 (Catalogue NAS)** : Source centrale de vérité et modèles maîtres.
- **💻 Niveau 2 (Global Machine)** : Compétences et connecteurs actifs partagés sur le poste.
- **📂 Niveau 1 (Projet Local)** : Règles et compétences spécifiques au projet courant.

### 2. Économie de Mémoire & Tokens (Tier-1 Discovery)
- Désactivation instantanée des modules non utilisés via renommage non destructif (`.disabled`).
- Jauge interactive de charge fixe pour anticiper et maîtriser l'empreinte mémoire au démarrage de session.

### 3. Coach IA & Alertes Proactives
- Détection automatique des fichiers surdimensionnés (> 200 lignes pour les règles, > 500 lignes pour les compétences).
- Alerte sur le poids brut (> 24 Ko) et les métadonnées manquantes.

---

## ⚡ Installation Express (Moins de 10 secondes)

### Option A : Via la ligne de commande (CLI)
1. Téléchargez le package `.vsix` depuis les [Releases GitHub](https://github.com/{owner}/{repo}/releases/latest).
2. Lancez la commande suivante dans votre terminal :
```bash
code --install-extension {package-name}-{version}.vsix
```

### Option B : Via l'interface VS Code / Antigravity
1. Ouvrez le panneau des extensions (`Ctrl+Shift+X` ou `Cmd+Shift+X`).
2. Cliquez sur le menu `...` (More Actions en haut à droite du panneau).
3. Sélectionnez **Install from VSIX...** et choisissez le fichier téléchargé.

---

## ⚙️ Configuration (`settings.json`)

| Paramètre | Type | Valeur par défaut | Description |
| :--- | :--- | :--- | :--- |
| `skillsManager.nasPath` | `string` | `\\\\Nas1\\DD2\\IA\\Antigravity-Templates` | Chemin UNC vers le catalogue maître NAS |
| `skillsManager.globalPath` | `string` | `""` (auto-détecté `~/.gemini/config`) | Emplacement des compétences globales Antigravity |
| `skillsManager.claudeGlobalPath` | `string` | `""` (auto-détecté `~/.claude`) | Emplacement des compétences Claude Code |
| `skillsManager.defaultProjectTool` | `enum` | `"auto-detect"` | Outil cible local (`auto-detect`, `antigravity`, `claude-code`) |

---

## 📜 Licence

Ce projet est sous licence MIT - voir le fichier [LICENSE](LICENSE) pour plus de détails.
```
