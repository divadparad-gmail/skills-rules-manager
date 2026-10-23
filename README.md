# Skills & Rules Manager (VS Code & Antigravity IDE)

<div align="center">

[![GitHub Release](https://img.shields.io/github/v/release/divadparad-gmail/skills-rules-manager?color=7c3aed&style=for-the-badge&logo=github)](https://github.com/divadparad-gmail/skills-rules-manager/releases)
[![VS Code Engine](https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC?style=for-the-badge&logo=visualstudiocode)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald?style=for-the-badge)](LICENSE)

<p align="center">
  <strong>Gestionnaire visuel haute performance pour compétences (skills, workflows) et règles sous Google Antigravity IDE et Claude Code.</strong>
</p>

[ [⬇️ Télécharger la v0.4.0 (.vsix)](https://github.com/divadparad-gmail/skills-rules-manager/releases/latest) ] •
[ [🐛 Signaler un problème](https://github.com/divadparad-gmail/skills-rules-manager/issues) ] •
[ [📖 Guide des Bonnes Pratiques IA](#4-coach-ia--alertes-de-surcharge) ]

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

<br/>

### ⚠️ Détection Intelligente des Doublons (Global vs Local)
![Détection des Doublons](media/screenshots/duplicates.png)
*Détection en temps réel des règles et compétences actives en double, calcul précis des tokens gaspillés (+85 tok) et bouton d'action rapide pour éteindre la surcharge en 1 clic.*

</div>

---

## 🚀 Fonctionnalités Majeures

### 1. Cartographie d'Architecture en 3 Niveaux
- **🏛️ 1. Catalogue NAS (Maître Réseau)** : le dossier désigné par le réglage `skillsManager.nasPath`, par exemple `\\serveur\partage\catalogue\` (Source centrale de vérité). Ce réglage est vide par défaut : sans lui, la colonne du catalogue indique « Aucun catalogue configuré » et le reste de l'extension fonctionne normalement.
- **💻 2. Global (Machine Utilisateur)** : `~/.gemini/config/` et `~/.claude/` (Connecteurs et compétences par défaut).
- **📂 3. Local (Projet Courant)** : `./.agents/` ou `./.claude/` (Règles locales et configurations de projet).

### 2. Économie de Mémoire (Tier-1 Discovery)
- Désactivation instantanée sans perte de données : renommage non destructif (`SKILL.md` ↔ `SKILL.md.disabled`).
- Synchronisation automatique avec `~/.gemini/config/skills.json` (`exclude: [...]`).
- Bascule en 1 clic pour désactiver tous les workflows d'action (`wf-*`) pendant les sessions de développement standard. Sous Antigravity, ce sont des skills dont le nom commence par `wf-` : ils sont listés et comptés comme des skills, et ne sont pas concernés par la fin des workflows d'Antigravity (19 octobre 2026).

### 3. Détection des Doublons & Élimination du Gaspillage (DuplicateService)
- ⚠️ **Alerte Doublon Actif** : Détecte instantanément si une règle ou un skill est actif simultanément au niveau **Global (Machine)** et **Local (Projet)**.
- 📉 **Calcul Précis des Tokens Gaspillés** : Affiche le surcoût mémoire exact injecté en double au démarrage (ex: `⚠️ Doublon actif (+85 tok)`). Sous Antigravity, le surcoût est le plus petit des deux coûts au démarrage ; une paire `glob` ou `manual` ne coûte rien au démarrage et porte la mention « coût dynamique » ; deux âmes (globale et du projet) ne forment un doublon que si leurs contenus sont identiques.
- ⚡ **Extinction en 1 Clic** : Bouton d'action directe `Éteindre` sur la carte pour désactiver immédiatement la surcharge sans quitter la vue.

### 4. Coach IA & Alertes de Surcharge
- ⚠️ **Règles Claude Code > 200 lignes** : alerte sur le risque de dilution d'attention du modèle.
- ⚠️ **Skills > 500 lignes** : recommandation de découpage modulaire vers `references/` ou `scripts/`.
- ⚠️ **Tailles recommandées sous Antigravity** (lignes du corps, frontmatter exclu) : 200 lignes pour l'âme, les règles permanentes et celles des dossiers parents ; 30 lignes ou environ 420 tokens pour une règle `glob`, réinjectée à chaque fichier correspondant ; 200 lignes pour `model_decision` ; 500 lignes pour le corps d'un skill, qui n'a aucun plafond documenté. L'infobulle du badge donne la raison et la mesure, et une carte `✂️ Tronquée` ne reçoit pas de second avertissement. Les annexes de skill longues ou sans table des matières reçoivent un badge d'information `ℹ️ Annexes`.
- ⏱️ **Coûts dynamiques sous Antigravity** : chaque règle `glob` active affiche son coût par fichier correspondant, et le panneau « Coûts dynamiques », sous la jauge, regroupe ces règles par motif (par exemple : `*.ts` : 3 règles, 1 240 tokens injectés à chaque fichier `.ts` lu ou modifié). Les motifs qui déclenchent exactement les mêmes règles partagent une seule ligne (`*.ts` · `*.tsx`), car leurs coûts ne s'additionnent pas. Il signale aussi le dépassement du budget de 20 000 tokens (documentation, non testé) et liste les hooks de `.agents/hooks.json` et `~/.gemini/config/hooks.json`, avec un avertissement de coût dynamique pour `SessionStart`, `PreInvocation` et `PostInvocation`. Aucun hook n'est jamais exécuté.
- ✂️ **Règles et âmes Antigravity > 24 000 octets** : taille du corps mesurée en octets UTF-8, frontmatter non compté, inclusions `@[label](path)` comprises ; au-delà, Antigravity coupe le surplus. Le badge `✂️ Tronquée` indique les octets coupés et les tokens jamais lus par l'agent.
- 🧮 **Coût réel au démarrage sous Antigravity** (formats vérifiés dans Antigravity IDE 2.5.5) : la jauge compte ce que l'agent injecte, sous la forme où il l'injecte. Une règle permanente coûte son corps sans frontmatter, dans une balise qui porte deux fois son chemin ; une règle `model_decision`, son entrée d'index ; une règle `glob` ou `manual`, rien. Un skill coûte sa ligne d'index, deux fois pour un skill de plugin ; les skills intégrés sont comptés. Un serveur MCP coûte son titre et les noms de ses outils.
- ⛔ **Règles qu'Antigravity n'appliquera jamais** (comportement vérifié dans Antigravity IDE 2.5.5) : une règle de `rules/` sans frontmatter ou sans `trigger` valide (`always_on`, `model_decision`, `glob`, `manual`) porte le badge `⛔ Ignorée par Antigravity` ; des `globs` en liste YAML, `⛔ Ignorée : liste YAML` ; des motifs qui contiennent tous un dossier (`src/**/*.ts`), `⛔ Ne se déclenchera jamais`, et `⚠️ Partiellement active` si seuls certains motifs sont concernés. Ces règles restent visibles, mais sortent de la jauge et des compteurs de règles actives. Le badge `⚠️ Frontmatter` signale un champ obligatoire manquant (`description` pour `model_decision`, `globs` pour `glob`).
- 📂 **Emplacements Antigravity complets** : âmes globales et du projet (`AGENTS.md`, `GEMINI.md`, `.agents/AGENTS.md`), ancien dossier `.agent/rules/` et règles déclarées par `.agents/rules.json`. Les âmes et les règles des dossiers parents, jusqu'à la racine du dépôt Git, sont comptées (badge `⬆️ Héritée`, cartes verrouillées). Les règles des sous-dossiers, qu'Antigravity ne charge jamais, sont regroupées dans une section repliée (`⛔ Jamais chargée`). Elles sont sans effet, activées ou non : leur carte porte le badge `🚫 Sans effet`, sans interrupteur ni corbeille, et elles sont exclues des bascules en masse et de leurs compteurs. L'extension refuse aussi de les basculer ou de les supprimer si une demande lui parvient.
- ⚠️ **Outils Claude Code MCP > 2 048 car.** : détection des risques de troncature API.

### 4. Résilience Réseau NAS (SMB)
- Détection asynchrone non-bloquante avec timeout court.
- En cas de déconnexion du NAS, l'interface affiche élégamment l'état `⚠️ NAS Hors Ligne` sans bloquer le travail sur le projet local ou global.

### 5. Découverte & Intégration de Ressources Externes (expérimental, désactivé par défaut)

Voir [Fonctionnalités expérimentales](#-fonctionnalités-expérimentales) pour l'activer.

- **Recherche sémantique** : décrivez en langage naturel ce que vous cherchez (« extraire des tableaux dynamiques derrière une authentification ») ; le moteur déconstruit l'intention, la pile technique visée et les contraintes, puis explique pourquoi chaque résultat correspond. Sans clé Gemini, une analyse lexicale locale prend le relais : la recherche reste utilisable hors ligne.
- **Recherche fédérée multi-registres** : les registres que vous avez configurés sont interrogés en parallèle sous plafond de concurrence, les réponses agrégées, puis dédoublonnées — la source de plus haute priorité l'emporte et les autres sont citées en badge. Un registre lent ou en panne n'interrompt jamais la recherche. Aucun registre n'est interrogé implicitement : tant qu'aucun n'est configuré, la description saisie ne part vers aucun serveur.
- **Trois cibles d'intégration** : chaque fiche porte les actions « Intégrer au projet local », « Intégrer au NAS » et « Intégrer au projet global ». La destination réelle suit l'agent détecté (`.agents/` pour Anti-Gravity, `.claude/` pour Claude Code) et la politique de conflit choisie (demander, écraser ou incrémenter). Avant toute écriture, le manifeste est affiché en lecture seule et une confirmation explicite est demandée. Un hook n'est pas installé vers Antigravity : il se déclare dans `.agents/hooks.json` et lance des commandes shell, à ajouter soi-même après avoir relu la commande.
- **Favoris hors ligne** : les ressources mises en favori conservent leur manifeste en cache local, consultable et déployable sans réseau, avec étiquettes personnelles, export et import de collections.
- **Historique des recherches** : requêtes conservées dans deux portées (projet et machine), éviction du moins récemment utilisé, pastilles de rappel rapide et saisie semi-automatique. Rien ne quitte la machine.

### 6. Détection d'Environnement Adaptative (avec la vue Découverte)
- **Hôte** : une matrice heuristique à cinq signaux (métadonnées applicatives, `product.json`, chemin du binaire, variables d'environnement, socket locale) attribue un score sur 120 ; au-delà de 60 points, l'extension bascule en mode natif Anti-Gravity. La sonde est bornée à moins de 50 ms et n'interrompt jamais l'amorçage.
- **Agent** : les variables d'environnement et les marqueurs de l'espace de travail départagent Anti-Gravity de Claude Code, et les manifestes sont traduits en conséquence (frontmatter, déclarations d'outils MCP, commandes slash).
- **Dérogation manuelle** : le badge de la barre d'état ouvre un sélecteur de mode, et la commande de diagnostics détaille chaque signal avec son score brut.

### 7. Architecture Modulaire & Médiateur d'Événements
- Les vues sont des composants autonomes : aucune ne détient de référence vers une autre, toutes les interactions passent par un médiateur typé (`ExtensionEventBus`) à enveloppe normalisée.
- Une vue repliée ne perd rien : ses messages sont mis en file circulaire bornée puis rejoués à sa réapparition, après un instantané d'état qui élimine tout affichage périmé.
- Un abonné fautif ne fait jamais tomber l'hôte d'extension : son erreur part en file de lettres mortes et la diffusion se poursuit vers les vues voisines.

---

## 🧪 Fonctionnalités expérimentales

La vue « Découverte & Intégration » (sections 5 et 6) est **expérimentale et désactivée par défaut**. Elle recherche des ressources dans des registres et les installe après aperçu et confirmation. Elle nécessite un registre compatible, et aucun registre public n'existe à ce jour.

Pour l'essayer, activez le réglage `antigravity.discovery.enabled`, puis déclarez un registre dans l'onglet Réglages de la vue. Tant que ce réglage est désactivé, la vue, son badge d'environnement dans la barre d'état, ses commandes et ses raccourcis restent masqués, et aucune requête n'est envoyée.

Des limites connues, comme la destination absente de la fenêtre de confirmation, seront levées avant sa sortie de la phase expérimentale.

---

## ⚡ Installation Express (.vsix)

### Option 1 : En ligne de commande (CLI)
Téléchargez le fichier `skills-rules-manager-0.4.0.vsix` depuis les [Releases GitHub](https://github.com/divadparad-gmail/skills-rules-manager/releases/latest) et exécutez :

```powershell
code --install-extension skills-rules-manager-0.4.0.vsix
```

> L'identifiant de l'extension est `divadparad.skills-rules-manager` depuis la 0.4.0. Si la 0.3.0 (`antigravity.skills-rules-manager`) est installée, désinstallez-la d'abord. Les évolutions de chaque version sont décrites dans le [CHANGELOG](CHANGELOG.md).

### Option 2 : Depuis l'interface VS Code / Antigravity IDE
1. Ouvrez l'onglet Extensions (`Ctrl+Shift+X` ou `Cmd+Shift+X`).
2. Cliquez sur l'icône `...` (More Actions en haut à droite du panneau d'extensions).
3. Choisissez **Install from VSIX...** et sélectionnez `skills-rules-manager-0.4.0.vsix`.

---

## ⚙️ Configuration (`settings.json`)

| Paramètre | Type | Valeur par défaut | Description |
| :--- | :--- | :--- | :--- |
| `skillsManager.nasPath` | `string` | `""` | Chemin UNC ou local du catalogue maître NAS, par exemple `\\serveur\partage\catalogue`. Laisser vide sans catalogue |
| `skillsManager.globalPath` | `string` | `""` (auto-détecté `~/.gemini/config`) | Emplacement des compétences globales Antigravity |
| `skillsManager.claudeGlobalPath` | `string` | `""` (auto-détecté `~/.claude`) | Emplacement des compétences Claude Code |
| `skillsManager.defaultProjectTool` | `enum` | `"auto-detect"` | Outil cible local (`auto-detect`, `antigravity`, `claude-code`) |
| `skillsManager.debugTiming` | `boolean` | `false` | Mesure et journal de performance des scans et de la tokenisation |
| `antigravity.discovery.enabled` | `boolean` | `false` | **Expérimental.** Active la vue « Découverte & Intégration » ; les réglages `antigravity.*` suivants ne servent qu'à elle |
| `antigravity.skills.searchUrls` | `array` | `[]` | Registres interrogés lors de la recherche fédérée (identifiant, nom, URL, priorité, authentification, délai, catégories servies). C'est la seule source de la recherche : aucun registre par défaut n'est interrogé |
| `antigravity.skills.requestTimeoutMs` | `number` | `5000` | Délai d'attente de repli des requêtes de registres (1 000 à 30 000 ms) |
| `antigravity.skills.maxParallelRegistryQueries` | `number` | `5` | Nombre maximal de registres interrogés simultanément |
| `antigravity.skills.nasDirectoryPath` | `string` | `""` | Répertoire NAS d'intégration : chemins UNC, lecteurs mappés, montages POSIX et variables `${env:NOM}` |
| `antigravity.skills.conflictPolicy` | `enum` | `"prompt"` | Conduite à tenir si la ressource existe déjà (`prompt`, `overwrite`, `increment`) |
| `antigravity.search.recentSearchesLimit` | `number` | `10` | Nombre de recherches conservées dans l'historique (jusqu'à 50) |
| `antigravity.environment.hostOverride` | `enum` | `"auto"` | Force l'hôte (`auto`, `antigravity-native`, `vscode-standalone`) |
| `antigravity.environment.overrideMode` | `enum` | `"auto"` | Force l'agent ciblé (`auto`, `antigravity`, `claude-code`) |

> Les identifiants d'accès aux registres privés ne sont jamais écrits dans `settings.json` : ils sont confiés au coffre chiffré du système (`SecretStorage`) et référencés par `secretKeyRef`, qui vaut toujours `antigravity.registry.<id>`.

> Le réglage `antigravity.skills.enableDefaultRegistry` a été supprimé avec le registre par défaut qu'il activait. S'il subsiste dans votre `settings.json`, il est simplement ignoré.

---

## 🔒 Sécurité

La découverte de ressources (vue expérimentale, désactivée par défaut) fait entrer du contenu tiers dans le contexte de votre agent et envoie vos descriptions de recherche à des serveurs. Les garde-fous suivants s'appliquent.

### Registres définis par un dépôt

Un dépôt cloné peut déclarer ses propres registres dans son `.vscode/settings.json`. L'extension les traite comme non fiables :

- **Aucun accès au coffre.** Un registre d'espace de travail ne reçoit jamais de secret ni d'en-tête personnalisé, quelle que soit la valeur de `secretKeyRef`. Il ne peut pas non plus recevoir d'identifiant depuis la vue.
- **Origine non falsifiable.** L'origine d'un registre (utilisateur ou dépôt) est calculée à la lecture de la configuration ; un champ `origin` écrit dans `settings.json` est ignoré.
- **Clé de coffre canonique.** Un registre ne peut désigner que sa propre clé, `antigravity.registry.<id>`. Toute autre valeur, par exemple la clé Gemini, invalide l'entrée.
- **Pas d'usurpation.** Les identifiants en double sont écartés, et un registre de dépôt ne peut pas reprendre l'identifiant d'un de vos registres.
- **Internet public uniquement.** Un registre de dépôt ne peut viser ni votre poste (`localhost`, `127.0.0.0/8`, `0.0.0.0`, `::1`), ni votre réseau local ou d'entreprise (`10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `100.64/10`, `fc00::/7`, `fe80::/10`). Les formes détournées (`http://2130706433`, `[::ffff:127.0.0.1]`…) sont reconnues. Un nom de domaine qui *pointe* vers une adresse interne est arrêté au moment de la connexion, sur l'adresse réellement résolue. Vos propres registres, déclarés dans vos réglages utilisateur, peuvent viser une adresse interne (NAS, registre d'entreprise), et la tolérance HTTP de `localhost` leur reste réservée.
- **Signalement visuel.** La vue Découverte affiche un badge « défini par ce dépôt » sur ces registres.
- **Mode restreint.** Dans un espace de travail non approuvé, VS Code ignore les valeurs de dépôt de `antigravity.skills.searchUrls` et `antigravity.skills.nasDirectoryPath`.

### Installation d'un manifeste distant

Un manifeste installé est lu comme instruction par votre agent. Aucun filtre automatique ne peut garantir qu'il est inoffensif ; la décision vous revient :

- Le manifeste est ouvert dans un onglet en lecture seule, puis une fenêtre « Installer / Annuler » rappelle son nom et son registre d'origine. Rien n'est écrit sans confirmation.
- Une heuristique signale dans cette fenêtre les tournures suspectes : lecture de fichiers ou de secrets du poste, envoi vers une adresse extérieure, consigne cachée à l'utilisateur, instruction prioritaire, commande système. Elle avertit sans bloquer et ne remplace pas votre relecture.
- La provenance (registre, adresse, date d'installation) est consignée dans une clé `source:` du frontmatter, ou en commentaire final si le fichier n'a pas de frontmatter.

### Données transmises

- **Registres configurés** : la description saisie (reformulée par l'analyse d'intention lorsqu'elle est disponible), les catégories recherchées et le nombre de résultats souhaité, en paramètres `q`, `types` et `limit` de l'URL.
- **Gemini**, si une clé est enregistrée : la description à analyser, puis les descriptions des résultats candidats pour le calcul de pertinence. La clé voyage dans l'en-tête `x-goog-api-key`, jamais dans l'URL.

### Signaler une faille

Ne publiez pas de faille dans une issue : la marche à suivre pour un signalement privé est décrite dans [SECURITY.md](SECURITY.md).

---

## ⌨️ Commandes Disponibles

Accessibles depuis la palette de commandes (`Ctrl+Shift+P` / `Cmd+Shift+P`) :
- `Skills & Rules Manager: Ouvrir le Grand Dashboard`
- `Skills & Rules Manager: Ouvrir le Guide & Bonnes Pratiques IA (Cheat Sheet)`
- `Skills & Rules Manager: Actualiser les Skills et Règles`
- `Skills & Rules Manager: Désactiver tous les Workflows (wf-*)`
- `Skills & Rules Manager: Activer tous les Skills`
- `Skills & Rules Manager: Autoriser l'hôte NAS (UNC) dans la sécurité VS Code`

Les commandes « Anti-Gravity » suivantes et leurs raccourcis appartiennent à la vue Découverte : ils n'apparaissent que si le réglage expérimental `antigravity.discovery.enabled` est activé.

- `Anti-Gravity: Rechercher une compétence, une règle, un workflow ou un hook` — `Ctrl+Alt+S` / `Cmd+Alt+S`
- `Anti-Gravity: Palette de recherche rapide des compétences` — `Ctrl+Alt+K` / `Cmd+Alt+K`
- `Anti-Gravity: Déployer rapidement une compétence favorite`
- `Anti-Gravity: Basculer le mode de fonctionnement (IDE hôte et agent)` — `Ctrl+Alt+E` / `Cmd+Alt+E`
- `Anti-Gravity: Afficher les diagnostics d'environnement`
- `Anti-Gravity: Configurer la clé d'API Gemini pour la recherche sémantique`

Le panneau latéral s'ouvre depuis son icône dans la barre d'activité. Dans la liste de résultats, les flèches parcourent les fiches et `Alt+L`, `Alt+N`, `Alt+G` déclenchent respectivement l'intégration locale, NAS et globale.

---

## 🧪 Tests & Qualité de Code

Le projet est couvert par une suite de tests unitaires automatisés validant la synchronisation de données, l'intégrité, l'isolation bi-moteur, le Coach IA, le médiateur d'événements, la détection d'environnement, la recherche fédérée, les favoris hors ligne et le pipeline de déploiement :

```bash
npm test          # contrôle syntaxique des vues, compilation et tests unitaires
npm run test:antigravity # seulement les tests propres à Antigravity (test/antigravity-*.test.ts)
npm run test:claude      # seulement les tests propres à Claude Code (test/claude-*.test.ts)
npm run test:common      # seulement les tests communs aux deux outils (test/common-*.test.ts et .test.js)
npm run type-check # vérification de types stricte, sans émission
npm run bundle     # paquet de production esbuild (dist/extension.js)
npm run package    # archive .vsix distribuable
```

Les scripts de test demandent Node 22 ou plus récent (`engines.node`), car `node --test` ne développe les motifs de fichiers que depuis Node 21. Cette exigence ne concerne que le développement : l'extension s'exécute avec le Node intégré à VS Code. Chaque script de test vide `out-test/` avant de compiler, pour qu'un test renommé ne laisse pas d'ancienne copie exécutée en double. Les tests écrits en JavaScript (`test/*.test.js`, ceux du skill wf-hook) ne sont pas compilés : ils sont lancés depuis `test/`, et ils demandent Windows et Git Bash.

---

## 📜 Licence

Ce projet est sous licence MIT - voir le fichier [LICENSE](LICENSE) pour plus de détails.
