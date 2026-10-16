# Guide des Commandes GitHub CLI (`gh`) pour `wf-github-publish`

Ce guide récapitule les commandes essentielles utilisées par le workflow pour inspecter, créer et publier des dépôts et des releases avec GitHub CLI.

---

## 1. Vérification de l'Authentification

Avant toute opération distante, vérifier que le CLI GitHub est authentifié avec les scopes requis (`repo`, `workflow`) :

```bash
gh auth status
```

Pour récupérer le login actif en JSON :
```bash
gh api user --jq .login
```

Si non connecté ou token expiré :
```bash
gh auth login
```

---

## 2. Vérification de l'Existence d'un Dépôt

Pour savoir si le dépôt distant existe déjà pour l'utilisateur courant :

```bash
gh repo view <username>/<repo-name> --json name,isPrivate,url
```

Si le dépôt n'existe pas, la commande retourne une erreur (code 1), indiquant que le champ est libre pour la création.

---

## 3. Création du Dépôt Distant (`gh repo create`)

Créer un dépôt distant depuis le répertoire local courant et associer le remote `origin` :

```bash
# Pour un dépôt public :
gh repo create <repo-name> --public --source=. --remote=origin --description "<description>"

# Pour un dépôt privé :
gh repo create <repo-name> --private --source=. --remote=origin --description "<description>"
```

### Options clés :
- `--source=.` : Utilise le répertoire courant comme source du dépôt.
- `--remote=origin` : Configure automatiquement `origin` dans la configuration Git locale.
- `--push` : (Optionnel) Pousse immédiatement la branche courante. *Recommandé d'effectuer le push explicitement via `git push -u origin main` pour un contrôle précis.*
- `--description "..."` : Définit la description officielle du dépôt sur GitHub.

---

## 4. Push de la Branche Principale

Une fois le remote configuré :

```bash
git push -u origin main
```

---

## 5. Création d'une GitHub Release Officielle (`gh release create`)

Pour publier une release avec attachement direct d'un package binaire distribuable (ex: fichier `.vsix` ou archive `.zip`) :

```bash
gh release create <tag> <fichier-binaire> --title "<Titre de la Release>" --notes "<Notes de version>"
```

### Exemple concret (Extension VS Code v0.3.0) :
```bash
gh release create v0.3.0 skills-rules-manager-0.3.0.vsix --title "Skills & Rules Manager v0.3.0" --notes "Release officielle : support universel des profils utilisateurs, monitoring précis des tokens, détection des doublons et synchronisation résiliente NAS."
```

### Options avancées :
- `--latest` : Marque explicitement cette release comme étant la dernière version stable (défaut sur le tag le plus récent).
- `--prerelease` : Marque la version comme pré-version (beta/RC).
- `--generate-notes` : Génère automatiquement les notes de release basées sur les commits et pull requests.

---

## 6. Bonnes Pratiques & Sécurité

1. **Ne jamais committer de secrets** : S'assurer que `.env`, `node_modules/`, tokens ou fichiers sensibles sont déclarés dans `.gitignore`.
2. **Tag Git immuable** : La création d'une release via `gh release create vX.Y.Z` crée automatiquement le tag Git correspondant sur la branche distante s'il n'existe pas encore.
3. **Téléchargement direct** : Les fichiers attachés à la release sont accessibles publiquement via l'URL `https://github.com/<owner>/<repo>/releases/download/<tag>/<nom-du-fichier>`.
