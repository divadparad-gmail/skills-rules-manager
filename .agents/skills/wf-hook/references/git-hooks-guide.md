# Guide de Référence : Hooks Git (.githooks & core.hooksPath)

Ce guide documente la mise en place et l'exécution des hooks Git universels.

---

## 1. Pourquoi `.githooks/` au lieu de `.git/hooks/` ?

- Par défaut, les hooks placés dans `.git/hooks/` **ne sont pas versionnés** et ne sont ni clonés ni partagés avec vos collaborateurs.
- En configurant `git config core.hooksPath .githooks`, Git exécute directement les hooks du dossier `.githooks/` situé à la racine du projet.
- **Bénéfice** : La protection voyage avec le dépôt et protège tous les membres de l'équipe, quel que soit l'outil utilisé (terminal manuel, VS Code, Antigravity ou Claude Code).

---

## 2. Déclencheurs Principaux

| Événement | Moment d'Exécution | Rôle Cardinal |
| :--- | :--- | :--- |
| **`pre-commit`** | Avant la création du commit | **Rempart principal** : Bloque l'entrée d'un secret ou d'une anomalie dans l'historique Git avant tout `git commit`. |
| **`pre-push`** | Avant l'envoi réseau (`git push`) | **Filet de sécurité** : Intercepte les commits déjà créés avant leur publication sur le serveur distant. |
| **`commit-msg`** | Après la rédaction du message | Valide le respect des normes (Conventional Commits). |

---

## 3. Structure d'un Hook Git

Chaque fichier de hook dans `.githooks/` est un script exécutable POSIX (`chmod +x`) :

```sh
#!/usr/bin/env sh
# Managed by wf-hook: <id>
node ".agents/skills/wf-hook/scripts/wf-hook-<id>.js" --staged
if [ $? -ne 0 ]; then
  exit 1
fi
```

### Contrat de Sortie :
- **Code 0** : Git poursuit l'opération normalement.
- **Code ≠ 0** : Git annule immédiatement l'opération et affiche le message d'erreur sur `stderr`.

> ℹ️ Sous Windows, Git for Windows exécute ces scripts via le shell Bash émulé (`sh.exe`).
