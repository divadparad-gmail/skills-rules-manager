# Guide des Commandes GitHub CLI (`gh`) pour `wf-github-publish`

Ce guide récapitule les commandes essentielles utilisées par le workflow `/wf-github-publish` pour inspecter, diagnostiquer, créer et publier des dépôts et des releases avec GitHub CLI.

---

## 1. Vérification de l'Authentification & Scopes

Avant toute opération distante, vérifier que le CLI GitHub est authentifié avec les permissions requises (`repo`, `workflow`) :

```bash
gh auth status
```

Pour récupérer le login actif en JSON :
```bash
gh api user --jq .login
```

Si non connecté ou en cas de jeton invalide / expiré :
```bash
gh auth login
# Ou pour rafraîchir les scopes nécessaires :
gh auth refresh -s repo
```

---

## 2. Diagnostic Automatique du Mode (Cas A vs Cas B)

Le workflow inspecte systématiquement le dépôt avant d'agir :

### 2.1 Inspection de la configuration locale
```bash
# Vérifier si le dossier courant est un repo Git
git rev-parse --is-inside-work-tree

# Vérifier la présence et l'URL du remote origin
git remote get-url origin
```

### 2.2 Inspection du dépôt distant sur GitHub
```bash
# Vérifier si le dépôt existe sur le compte GitHub
gh repo view <username>/<repo-name> --json name,isPrivate,url
```
- **Si le dépôt existe** : La commande retourne l'objet JSON. Le workflow s'oriente vers le **Cas B (Mise à Jour)**.
- **Si le dépôt n'existe pas** : La commande retourne une erreur (code 1). Le champ est libre pour le **Cas A (Publication Inaugurale)**.

### 2.3 Inspection des releases existantes
```bash
gh release list --limit 5
```
Permet d'identifier le dernier tag publié et d'éviter toute collision de version.

---

## 3. Cas A : Publication Inaugurale (Nouveau Projet)

### 3.1 Initialisation Git & Branche Principale
```bash
git init
git branch -M main
```

### 3.2 Création du Dépôt Distant (`gh repo create`)
```bash
# Pour un dépôt public :
gh repo create <repo-name> --public --source=. --remote=origin --description "<description>"

# Pour un dépôt privé :
gh repo create <repo-name> --private --source=. --remote=origin --description "<description>"
```

#### Options clés :
- `--source=.` : Utilise le répertoire courant comme source du dépôt.
- `--remote=origin` : Configure automatiquement `origin` dans la configuration Git locale.
- `--description "..."` : Définit la description officielle du projet sur GitHub.

### 3.3 Commit Inaugural & Premier Push
```bash
git add .
git commit -m "feat: initial release vX.Y.Z of [Nom du Projet]"
git push -u origin main
```

### 3.4 Release Inaugurale avec Binaire
```bash
gh release create vX.Y.Z <fichier-binaire> --title "[Nom du Projet] vX.Y.Z" --notes "<Notes de version inaugurales>"
```

---

## 4. Cas B : Mise à Jour de Version & Nouvelle Release (Projet Existant)

> ⚠️ **Règle absolue** : Ne jamais relancer `git init` ou `gh repo create` sur un projet déjà initialisé avec un remote `origin` actif.

### 4.1 Vérification de l'État de Travail
```bash
git status -s
```

### 4.2 Commit Conventionnel de Version
```bash
git add .
git commit -m "feat: release vX.Y.Z - <synthèse des ajouts et correctifs>"
git log -1 --oneline
```

### 4.3 Push des Changements sur `main`
```bash
git push origin main
```

### 4.4 Création de la Nouvelle Release avec Binaire
```bash
gh release create vX.Y.Z <fichier-binaire> --title "[Nom du Projet] vX.Y.Z" --notes "<Notes de version détaillées>" --latest
```

### 4.5 Commandes Utiles de Gestion des Releases
```bash
# Voir les détails de la dernière release :
gh release view vX.Y.Z

# Télécharger le binaire d'une release :
gh release download vX.Y.Z -p "*.vsix"

# Ajouter ou remplacer un asset sur une release existante :
gh release upload vX.Y.Z <nouveau-fichier-binaire> --clobber

# Modifier le titre ou les notes d'une release existante :
gh release edit vX.Y.Z --title "[Nom] vX.Y.Z" --notes "<Nouvelles notes>"
```

---

## 5. Résolution des Erreurs Fréquentes

| Erreur Constatée | Cause | Solution Workflow |
| :--- | :--- | :--- |
| `GraphQL: Name already exists on this account` | Tentative d'exécution de `gh repo create` sur un dépôt déjà existant. | **Bascule Cas B** : Ne pas appeler `gh repo create`. Utiliser directement `git push origin main` et `gh release create`. |
| `release tag vX.Y.Z already exists` | Le tag existe déjà sur GitHub. | Incrémenter la version dans `package.json`, recompiler/packager et créer la release sous le nouveau tag. |
| `error: failed to push some refs to '...'` | Des commits distants ne sont pas présents localement. | Exécuter `git pull --rebase origin main` avant de retenter `git push`. |
| `missing required scope 'repo'` | Le jeton d'authentification GitHub CLI n'a pas les droits nécessaires. | Exécuter `gh auth refresh -s repo` pour accorder les permissions de dépôt. |

---

## 6. Synthèse des URLs Standardisées

À chaque publication, GitHub génère les URLs suivantes :
- **Dépôt** : `https://github.com/<owner>/<repo>`
- **Commit** : `https://github.com/<owner>/<repo>/commit/<commit-hash>`
- **Page de la Release** : `https://github.com/<owner>/<repo>/releases/tag/vX.Y.Z`
- **Lien Direct de Téléchargement du Package** : `https://github.com/<owner>/<repo>/releases/download/vX.Y.Z/<nom-fichier-binaire>`
