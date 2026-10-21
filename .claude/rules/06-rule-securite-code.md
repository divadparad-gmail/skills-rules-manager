---
paths:
  - "src/**/*.ts"
  - "src/**/*.js"
  - "package.json"
---

# Sécurité du code : secrets, réseau et contenu destiné aux agents

Cette règle est née d'un audit d'octobre 2026, qui a trouvé cinq failles dans du code généré par un agent : un secret du coffre envoyé vers un serveur choisi par un dépôt, des requêtes dirigées vers `localhost`, un manifeste distant installé comme instruction sans aperçu, une clé d'API placée dans l'URL et un registre par défaut inventé sur un domaine tiers. Aucune de ces failles ne venait d'une technique complexe. Elles venaient toutes d'un **mauvais modèle de menace**, d'un **biais de commodité** ou d'une **infrastructure inventée**. Les directives ci-dessous ferment ces trois portes.

## 1. Commencer par le modèle de menace

Avant d'écrire du code qui touche à la configuration, au réseau, aux secrets ou aux fichiers lus par un agent, identifie **qui contrôle chaque valeur** :

- **L'utilisateur** (réglages utilisateur, saisie explicite) est la seule source de confiance.
- **Le dépôt ouvert** (`.vscode/settings.json`, fichiers du projet) n'est pas fiable, **même après que l'utilisateur a accordé sa confiance à l'espace de travail** : ce geste est une routine, pas une vérification.
- **Un registre ou un serveur distant** n'est pas fiable, ni dans ses réponses, ni dans le contenu qu'il fournit.
- **Les intermédiaires réseau** (proxys, journaux de serveur) voient les URL complètes.

Un réflexe de sécurité ne vaut que pour la frontière qu'il protège. Un filtre anti-`<script>` protège un rendu HTML, **pas** le contexte d'instructions d'un agent, où la menace est l'injection de consignes.

## 2. Secrets

- Un secret du coffre (`SecretStorage`) ne part **que** vers une destination définie par l'utilisateur. Une valeur venue de l'espace de travail ne doit jamais pouvoir choisir ni la clé lue, ni le serveur qui la reçoit.
- **Conserve l'origine de chaque valeur jusqu'au point d'usage.** Ne fusionne jamais les portées utilisateur et espace de travail en perdant cette information. Calcule l'origine à la lecture de la configuration, et ne la lis **jamais** depuis la configuration elle-même : un dépôt écrirait simplement `"origin": "user"`. Ne persiste pas ce champ.
- **Place la garde au point d'étranglement unique**, c'est-à-dire la fonction qui construit les en-têtes, pas chacun des appelants. Pour une source non fiable, elle ne renvoie ni secret ni en-tête personnalisé.
- **Ne laisse pas la configuration nommer une clé du coffre.** Dérive la clé de l'identifiant (`<préfixe>.<id>`), refuse toute autre valeur, et impose l'unicité des identifiants à la lecture comme à l'écriture.
- **Mets les secrets dans un en-tête**, jamais dans l'URL : `x-goog-api-key`, `Authorization` ou l'en-tête dédié du service. Les exemples de démarrage rapide qui utilisent `?key=` sont du prototypage, pas une référence.
- **Un message d'erreur ne cite jamais une URL complète**, un en-tête ou un corps de requête : ils peuvent porter un identifiant. Cite au plus l'origine, ou rien.

## 3. Configuration d'espace de travail

- Pour tout réglage de portée `resource` ou `window` qu'un dépôt peut détourner (URL, chemin, commande, secret référencé), déclare dans `package.json` `capabilities.untrustedWorkspaces` avec `restrictedConfigurations`. Cette mesure ne vaut qu'en mode restreint : elle **complète** la garde de code sans la remplacer.
- Une entrée d'espace de travail ne doit pas pouvoir **usurper** une entrée utilisateur, ni par son identifiant, ni par son nom affiché.
- **Montre l'origine dans l'interface** (par exemple un badge « défini par ce dépôt ») et désactive les actions qui n'ont pas de sens pour cette origine. Insère tout texte par `textContent`, jamais par `innerHTML`.

## 4. Requêtes réseau

- Pour une URL issue d'une source non fiable, refuse les adresses de **bouclage** sous toutes leurs formes : `localhost`, `*.localhost`, `127.0.0.0/8`, `0.0.0.0`, `::1` et `[::1]`. Refuse aussi les **réseaux privés et le lien local** : `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `100.64/10`, `fc00::/7` et `fe80::/10`, y compris sous forme IPv4 projetée (`::ffff:a.b.c.d`). Juge le nom d'hôte **après** normalisation par `new URL()`, qui convertit `2130706433` ou `0x7f.1` en `127.0.0.1`.
- La tolérance HTTP ou locale du développement est réservée à la configuration **utilisateur**. Le confort de développement n'est jamais une raison d'ouvrir une porte à une autre origine.
- Un contrôle sur le nom d'hôte ne voit pas un nom de domaine qui se résout vers une adresse interne. Vérifie l'adresse **résolue au moment de la connexion**, avec l'option `lookup` de la requête Node (voir `createPublicOnlyLookup` dans `src/common/networkPolicy.ts`). Une vérification faite avant la requête est contournable, car le nom peut changer d'adresse entre la vérification et la connexion.
- Garde les protections du transport : pas de suivi automatique de redirection quand un secret est joint, vérification TLS active, délai d'attente et taille de réponse bornés.

## 5. Contenu destiné à un agent

Un fichier écrit dans `.agents/`, `.claude/`, un profil global ou un partage d'équipe **devient une instruction** pour un modèle. Aucun filtre ne peut garantir qu'il est inoffensif.

- **Barrière humaine obligatoire.** Avant d'écrire du contenu d'origine externe, affiche-le **intégralement** dans un document en lecture seule, puis demande une confirmation explicite (« Installer / Annuler ») qui cite le nom et la source. Rien n'est écrit sans ce consentement. Ne sacrifie jamais cette étape au « zéro friction ».
- **Factorise ce parcours en une seule fonction partagée**, appelée par tous les points d'entrée (vue, palette, raccourci). Une logique d'écriture dupliquée finit toujours par avoir une copie non protégée.
- Une détection heuristique des tournures suspectes est utile **pour avertir, pas pour bloquer**. Exemples de tournures : lire des fichiers ou des secrets du poste, envoyer des données vers une URL, cacher une action à l'utilisateur, « ignore les instructions précédentes », commande système.
- **Ne nomme pas un contrôle d'après une protection qu'il n'apporte pas.** Un contrôle de forme s'appelle « contrôle de forme », pas « validation de sécurité ».
- **Consigne la provenance** (source, adresse, date) dans le fichier écrit, sans casser son format : une clé `source:` dans le frontmatter existant, qui reste en tête du fichier. Remplace toute clé `source:` fournie par la source elle-même.

## 6. Ne jamais inventer d'infrastructure

- **N'ajoute aucune URL, aucun domaine, aucun registre ni service par défaut** qui ne figure pas explicitement dans la spécification ou dans une demande de l'utilisateur. Un domaine plausible inventé peut appartenir à un tiers, qui recevrait alors les données de tous les utilisateurs.
- Si une valeur manque, **demande-la**, ou laisse le réglage vide avec un message clair. Ne transmets jamais de données sans action explicite de l'utilisateur.
- Signale toute valeur que tu as **déduite** plutôt que reçue, dans le rapport et dans un commentaire de code, comme un point à confirmer avant publication.

## 7. Signaux d'arrêt

Arrête-toi et applique la section correspondante dès que tu écris :

- `secrets.get(` alimenté par une valeur de configuration (section 2) ;
- une fusion de portées de configuration, ou `inspect()` suivi d'une liste unique (section 2) ;
- un secret dans une chaîne d'URL, dans `URLSearchParams` ou dans un message d'erreur (section 2) ;
- une exception « sauf pour localhost » (section 4) ;
- `writeFile` vers un dossier lu par un agent (section 5) ;
- une URL `https://` littérale absente de la spécification (section 6).

## 8. Avant de livrer

- Pour chaque faille corrigée, ajoute un **test de non-régression qui rejoue l'attaque**. Par exemple : une entrée d'espace de travail qui porte `"origin": "user"` et vise la clé Gemini ne doit déclencher aucune lecture du coffre.
- Utilise des **ports injectables** (coffre, transport HTTP, système de fichiers, interactions utilisateur) pour que ces tests tournent hors de VS Code.
- Si un point dépend d'une décision ou d'un fait hors du code, comme la propriété d'un domaine, **pose la question** au lieu de trancher seul.
