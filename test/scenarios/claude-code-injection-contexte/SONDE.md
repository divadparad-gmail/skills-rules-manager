# Sonde Claude Code — invites des appels au modèle (v1)

Ce fichier est la **seule source** des invites que la partie payante du lanceur peut envoyer au modèle (`npm run sonde:claude`). Chaque invite a un identifiant (le titre de sa section) et un texte exact (le bloc `text` de sa section).

## Les règles de ce fichier

- **Le lanceur vérifie chaque invite par son empreinte.** Il relit ce fichier, extrait le bloc de chaque section, calcule son SHA-256 et le compare à la constante `EMPREINTES_INVITES` de `test/scenarios/scripts/sonde-claude-code-payant.js`. Une invite modifiée sans mise à jour de cette constante est refusée, et `verifierArgv` refuse toute invite qui ne figure pas ici.
- **Aucune invite ne contient de canari.** Elles demandent de rapporter toute chaîne qui commence par `CANARI-`, sans en citer aucune ; sinon, le modèle retrouverait le canari dans l'invite elle-même. Le test `claude-sonde-payante` le vérifie sur les canaris de l'inventaire et sur le motif `CANARI-` suivi d'une lettre ou d'un chiffre.
- **Chaque invite tient sur une ligne, sans guillemet double**, pour passer telle quelle dans l'argv sous Windows. La réponse demandée est un objet JSON strict, décrit en prose plutôt que par un exemple.
- **Modifier une invite rend la baseline caduque** pour les entrées qui en dépendent : il faut alors une nouvelle baseline datée (voir le README de la suite).

## Les invites

### usage-ok

Appels : les séries 1 à 3 (mesure de l'usage). L'invite est la même pour tous ces appels, pour que la différence d'usage n'isole que les fixtures.

```text
Réponds uniquement par un objet JSON strict qui contient une seule clé, ok, de valeur true, sans aucun autre texte, sans bloc de code et sans utiliser d'outil.
```

### enveloppes

Appel : 4a (CC35, format exact des enveloppes).

```text
Tu es un instrument de mesure : n'invente rien et n'utilise aucun outil. Cherche dans ton contexte initial (prompt système, rappels et messages qui précèdent cette question) chaque chaîne complète qui commence par CANARI- ; cette question n'en contient aucune. Pour chacune, recopie mot pour mot la ligne qui ouvre le bloc qui la contient (en-tête, balise ou phrase d'introduction) et la ligne qui le ferme, ou une chaîne vide s'il n'y en a pas. Réponds uniquement par un objet JSON strict, sans bloc de code, avec une seule clé, canaris, dont la valeur est une liste d'objets ayant trois clés : chaine, ouverture et fermeture.
```

### inventaire-canaris

Appels : 4b (contenu de la mémoire, des règles et du MCP) et 4c (skills).

```text
Tu es un instrument de mesure : n'invente rien et n'utilise aucun outil. Relève dans ton contexte initial (prompt système, rappels et messages qui précèdent cette question) toutes les chaînes complètes qui commencent par CANARI- ; cette question n'en contient aucune. Réponds uniquement par un objet JSON strict, sans bloc de code, avec une seule clé, canaris, dont la valeur est la liste de ces chaînes, chacune une seule fois, dans l'ordre où elles apparaissent.
```

### d-read

Appel : ER (série 5), outil Read seul.

```text
Tu es un instrument de mesure : n'invente rien. Fais exactement une action, puis plus aucune : lis le fichier src/a.ts avec l'outil Read. Ensuite, sans autre outil, réponds uniquement par un objet JSON strict, sans bloc de code, avec deux clés : avant_outil, la liste des chaînes complètes qui commencent par CANARI- présentes dans ton contexte avant cette action, et apres_outil, la liste de celles apparues dans le résultat de l'outil ou dans un rappel ajouté après lui. Cette question n'en contient aucune.
```

### d-write

Appel : EW (série 5), outil Write seul.

```text
Tu es un instrument de mesure : n'invente rien. Fais exactement une action, puis plus aucune : crée le fichier src/c.ts avec l'outil Write, avec pour seul contenu la ligne export const c = 3; suivie d'un saut de ligne. Ensuite, sans autre outil, réponds uniquement par un objet JSON strict, sans bloc de code, avec deux clés : avant_outil, la liste des chaînes complètes qui commencent par CANARI- présentes dans ton contexte avant cette action, et apres_outil, la liste de celles apparues dans le résultat de l'outil ou dans un rappel ajouté après lui. Cette question n'en contient aucune.
```

### d-edit

Appel : EE (série 5), outils Read et Edit : sans Read disponible, Edit exigerait une lecture préalable (voir le README).

```text
Tu es un instrument de mesure : n'invente rien. Fais exactement une action, puis plus aucune : avec l'outil Edit, et sans lire le fichier au préalable, remplace dans src/a.ts le texte a = 1 par a = 2. Ensuite, sans autre outil, réponds uniquement par un objet JSON strict, sans bloc de code, avec deux clés : avant_outil, la liste des chaînes complètes qui commencent par CANARI- présentes dans ton contexte avant cette action, et apres_outil, la liste de celles apparues dans le résultat de l'outil ou dans un rappel ajouté après lui. Cette question n'en contient aucune.
```

### d-glob

Appel : EG (série 5), outil Glob seul.

```text
Tu es un instrument de mesure : n'invente rien. Fais exactement une action, puis plus aucune : cherche les fichiers qui correspondent au motif src/**/*.ts avec l'outil Glob. Ensuite, sans autre outil, réponds uniquement par un objet JSON strict, sans bloc de code, avec deux clés : avant_outil, la liste des chaînes complètes qui commencent par CANARI- présentes dans ton contexte avant cette action, et apres_outil, la liste de celles apparues dans le résultat de l'outil ou dans un rappel ajouté après lui. Cette question n'en contient aucune.
```

### d-grep

Appel : EGr (série 5), outil Grep seul.

```text
Tu es un instrument de mesure : n'invente rien. Fais exactement une action, puis plus aucune : cherche le texte export dans le dossier src avec l'outil Grep. Ensuite, sans autre outil, réponds uniquement par un objet JSON strict, sans bloc de code, avec deux clés : avant_outil, la liste des chaînes complètes qui commencent par CANARI- présentes dans ton contexte avant cette action, et apres_outil, la liste de celles apparues dans le résultat de l'outil ou dans un rappel ajouté après lui. Cette question n'en contient aucune.
```

### d-cat

Appel : EB (série 5), outil Bash seul, limité à `cat`.

```text
Tu es un instrument de mesure : n'invente rien. Fais exactement une action, puis plus aucune : affiche le fichier src/a.ts avec l'outil Bash et la seule commande cat src/a.ts. Ensuite, sans autre outil, réponds uniquement par un objet JSON strict, sans bloc de code, avec deux clés : avant_outil, la liste des chaînes complètes qui commencent par CANARI- présentes dans ton contexte avant cette action, et apres_outil, la liste de celles apparues dans le résultat de l'outil ou dans un rappel ajouté après lui. Cette question n'en contient aucune.
```

### d-read-sous

Appel : ER-sous (série 5), outil Read seul.

```text
Tu es un instrument de mesure : n'invente rien. Fais exactement une action, puis plus aucune : lis le fichier sous/note.txt avec l'outil Read. Ensuite, sans autre outil, réponds uniquement par un objet JSON strict, sans bloc de code, avec deux clés : avant_outil, la liste des chaînes complètes qui commencent par CANARI- présentes dans ton contexte avant cette action, et apres_outil, la liste de celles apparues dans le résultat de l'outil ou dans un rappel ajouté après lui. Cette question n'en contient aucune.
```

### d-read-temoin

Appel : le témoin (série 5), outil Read seul, sur un fichier qu'aucune règle ne vise.

```text
Tu es un instrument de mesure : n'invente rien. Fais exactement une action, puis plus aucune : lis le fichier b.txt avec l'outil Read. Ensuite, sans autre outil, réponds uniquement par un objet JSON strict, sans bloc de code, avec deux clés : avant_outil, la liste des chaînes complètes qui commencent par CANARI- présentes dans ton contexte avant cette action, et apres_outil, la liste de celles apparues dans le résultat de l'outil ou dans un rappel ajouté après lui. Cette question n'en contient aucune.
```

### h14-panneau

Appel : H14 (lot E3), tapé à la main dans le panneau Claude Code de VS Code, une seule fois. Le lanceur ne l'envoie jamais ; `--preparer-h14` l'affiche.

```text
Tu es un instrument de mesure dans le panneau Claude Code : n'invente rien et n'utilise aucun outil. Relève dans ton contexte initial (prompt système, rappels et messages qui précèdent cette question) toutes les chaînes complètes qui commencent par CANARI- ; cette question n'en contient aucune. Réponds uniquement par un objet JSON strict, sans bloc de code, avec une seule clé, canaris, dont la valeur est la liste de ces chaînes, chacune une seule fois, dans l'ordre où elles apparaissent.
```
