# Skills & Rules Manager (VS Code & Antigravity IDE)

<div align="center">

[![GitHub Release](https://img.shields.io/github/v/release/divadparad-gmail/skills-rules-manager?color=7c3aed&style=for-the-badge&logo=github)](https://github.com/divadparad-gmail/skills-rules-manager/releases)
[![VS Code Engine](https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC?style=for-the-badge&logo=visualstudiocode)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald?style=for-the-badge)](LICENSE)
[![Tests: 31/31](https://img.shields.io/badge/Tests-31%2F31%20Passed-success?style=for-the-badge)](#)

<p align="center">
  <strong>Gestionnaire visuel haute performance pour compétences (skills, workflows) et règles sous Google Antigravity IDE et Claude Code.</strong>
</p>

[ [⬇️ Télécharger la v0.3.0 (.vsix)](https://github.com/divadparad-gmail/skills-rules-manager/releases/latest) ] •
[ [🐛 Signaler un problème](https://github.com/divadparad-gmail/skills-rules-manager/issues) ] •
[ [📖 Guide des Bonnes Pratiques IA](#-guide--bonnes-pratiques-ia-intégré) ]

</div>

---

## 💡 Pourquoi Skills & Rules Manager ?

Lorsqu'on orchestre des agents IA modernes (Google Antigravity, Claude Code), l'accumulation de règles globales, de prompts et de dizaines de compétences entraîne une **saturation de la fenêtre de contexte** (Tier-1 Discovery) dès le premier message.

**Skills & Rules Manager** résout ce défi en offrant :
- 📉 **Jauge de tokens dynamique** : visualisez en temps réel l'empreinte mémoire injectée au boot et désactivez les workflows non pertinents en 1 clic.
- 🏛️ **Vue comparative en 3 colonnes** : cartographiez et synchronisez instantanément vos briques entre le Catalogue NAS maître, votre machine globale et votre projet local.
- 🛡️ **Coach IA Proactif & Résilience NAS** : alertes automatiques sur les règles trop verbeuses (> 200 lignes), les compétences surchargées (> 500 lignes), et tolérance aux pannes réseau SMB.

---

## 📸 Aperçus Visuels (Showroom)

<div align="center">

### 🖥️ Grand Tableau de Bord Comparatif
![Dashboard](media/screenshots/dashboard.png)
*Comparaison interactive et synchronisation bidirectionnelle : 🏛️ NAS (Maître) ↔ 💻 Global (Machine) ↔ 📂 Local (Projet).*

<br/>

| 🧭 Vue Latérale & Actions Rapides | 📖 Guide & Bonnes Pratiques IA |
| :---: | :---: |
| ![Sidebar](media/screenshots/sidebar.png) | ![Cheat Sheet](media/screenshots/cheatsheet.png) |
| *Accès direct, badges d'état et bascules groupées.* | *Tableaux de bord des règles d'or et synthèse Antigravity vs Claude.* |

</div>

---

## 🚀 Fonctionnalités Majeures

### 1. Cartographie d'Architecture en 3 Niveaux
- **🏛️ 1. Catalogue NAS (Maître Réseau)** : `\\Nas1\DD2\IA\Antigravity-Templates\` (Source centrale de vérité).
- **💻 2. Global (Machine Utilisateur)** : `~/.gemini/config/` et `~/.claude/` (Connecteurs et compétences par défaut).
- **📂 3. Local (Projet Courant)** : `./.agents/` ou `./.claude/` (Règles locales et configurations de projet).

### 2. Économie de Mémoire (Tier-1 Discovery)
- Désactivation instantanée sans perte de données : renommage non destructif (`SKILL.md` ↔ `SKILL.md.disabled`).
- Synchronisation automatique avec `~/.gemini/config/skills.json` (`exclude: [...]`).
- Bascule en 1 clic pour désactiver tous les workflows d'action (`wf-*`) pendant les sessions de développement standard.

### 3. Coach IA & Alertes de Surcharge
- ⚠️ **Règles > 200 lignes** : alerte sur le risque de dilution d'attention du modèle.
- ⚠️ **Skills > 500 lignes** : recommandation de découpage modulaire vers `references/` ou `scripts/`.
- ⚠️ **Poids physique > 24 Ko** : signalement préventif de saturation de tokens.
- ⚠️ **Outils Claude Code MCP > 2 048 car.** : détection des risques de troncature API.

### 4. Résilience Réseau NAS (SMB)
- Détection asynchrone non-bloquante avec timeout court.
- En cas de déconnexion du NAS, l'interface affiche élégamment l'état `⚠️ NAS Hors Ligne` sans bloquer le travail sur le projet local ou global.

---

## ⚡ Installation Express (.vsix)

### Option 1 : En ligne de commande (CLI)
Téléchargez le fichier `skills-rules-manager-0.3.0.vsix` depuis les [Releases GitHub](https://github.com/divadparad-gmail/skills-rules-manager/releases/latest) et exécutez :

```powershell
code --install-extension skills-rules-manager-0.3.0.vsix
```

### Option 2 : Depuis l'interface VS Code / Antigravity IDE
1. Ouvrez l'onglet Extensions (`Ctrl+Shift+X` ou `Cmd+Shift+X`).
2. Cliquez sur l'icône `...` (More Actions en haut à droite du panneau d'extensions).
3. Choisissez **Install from VSIX...** et sélectionnez `skills-rules-manager-0.3.0.vsix`.

---

## ⚙️ Configuration (`settings.json`)

| Paramètre | Type | Valeur par défaut | Description |
| :--- | :--- | :--- | :--- |
| `skillsManager.nasPath` | `string` | `\\\\Nas1\\DD2\\IA\\Antigravity-Templates` | Chemin UNC vers le catalogue maître NAS |
| `skillsManager.globalPath` | `string` | `""` (auto-détecté `~/.gemini/config`) | Emplacement des compétences globales Antigravity |
| `skillsManager.claudeGlobalPath` | `string` | `""` (auto-détecté `~/.claude`) | Emplacement des compétences Claude Code |
| `skillsManager.defaultProjectTool` | `enum` | `"auto-detect"` | Outil cible local (`auto-detect`, `antigravity`, `claude-code`) |

---

## ⌨️ Commandes Disponibles

Accessibles depuis la palette de commandes (`Ctrl+Shift+P` / `Cmd+Shift+P`) :
- `Skills & Rules Manager: Ouvrir le Grand Dashboard`
- `Skills & Rules Manager: Ouvrir le Guide & Bonnes Pratiques IA (Cheat Sheet)`
- `Skills & Rules Manager: Actualiser les Skills et Règles`
- `Skills & Rules Manager: Désactiver tous les Workflows (wf-*)`
- `Skills & Rules Manager: Activer tous les Skills`
- `Skills & Rules Manager: Autoriser l'hôte NAS (UNC) dans la sécurité VS Code`

---

## 🧪 Tests & Qualité de Code

Le projet est couvert par une suite de 31 tests unitaires automatisés validant la synchronisation de données, l'intégrité, l'isolation bi-moteur et le Coach IA :

```bash
npm test
```

---

## 📜 Licence

Ce projet est sous licence MIT - voir le fichier [LICENSE](LICENSE) pour plus de détails.
