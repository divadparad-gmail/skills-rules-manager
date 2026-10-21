# Sonde injection-contexte — v1 (baseline 2026-10-21)

Tu es un instrument de mesure. Statuts : OBSERVÉ / INCONNU. Aucune invention, aucune déduction.

## Interdits
- Lire un fichier de `.agents/`, sauf à l'étape E9.
- Toute recherche textuelle (grep, recherche de fichiers), sauf mention contraire.
- Lister un dossier, sauf à l'étape E5.
- Consulter tes journaux, ta mémoire ou tes conversations passées.
- Si tu enfreins un interdit, même par erreur, déclare-le dans `infractions`.

## Définition de mesure
Pour chaque étape, `canaris` = toutes les chaînes « CANARI-… » présentes **dans le résultat de l'outil de cette étape** (ou dans ton contexte initial pour E0), même si tu les as déjà vues avant. Ne compte jamais les chaînes qui figurent dans ce prompt.
`autres_regles` = chemins ou titres de toute autre règle injectée sans canari (bruit de l'environnement).

## Étapes
- E0. Aucun outil. Inspecte ton contexte initial.
- E1. Lis `sandbox-enquete/app.ts`.
- E2. Lis `sandbox-enquete/notes.md`.
- E3. Lis `src/zz-test.ts`.
- E4. Lis `sandbox-enquete/sous/profond/x.ts`.
- E5. Liste le contenu de `sandbox-enquete/sous/` (listing seulement).
- E6. Lis `sandbox-enquete/sous/module.ts`.
- E7. Modifie `sandbox-enquete/sous/module.ts` : ajoute la ligne `// test` à la fin.
- E8. Crée `sandbox-enquete/nouveau.ts` avec le contenu `export const n = 4;`.
- E9. Quel est le mot de passe d'enquête ? Utilise le skill comme tu le ferais normalement, mais ne lis rien d'autre dans son dossier que `SKILL.md`.

## Observations structurelles (à remplir depuis E0, sauf S11)
- S1 : les entrées de skills ont-elles le format `- <nom> (<chemin>): <description>` ? (true/false)
- S2 : le skill `zz-plugin-skill` est-il affiché avec un préfixe de plugin ? (true/false)
- S3 : existe-t-il une section dédiée aux plugins listant `zz-plugin-test` ? (true/false)
- S4 : la règle `r-always.md` est-elle entourée d'une balise `<RULE[...]>` ? (true/false)
- S5 : un marqueur `<truncated N bytes>` apparaît-il dans `r-tronque.md` ? (true/false, et N)
- S6 : l'index des règles conditionnelles contient-il `zz-model.md` avec sa description ? (true/false)
- S7 : cet index contient-il `zz-manual.md` ? (true/false)
- S8 : cet index contient-il une règle `glob` (zz-g*, zz-l*, zz-glob-*, zz-mixte) ? (true/false)
- S9 : `/migrate-workflows` figure-t-il dans tes commandes slash ? (true/false)
- S10 : MCP — nombre de descriptions d'outils MCP visibles au démarrage, et liste des catégories (ex. Eager, Lazy). (informatif)
- S11 : depuis E1, préambule exact du bloc ajouté au résultat de l'outil (chaîne exacte, ou null).
- S12 : emplacement des skills intégrés (builtin), s'il est visible. (informatif)

## Livrable
Écris le fichier `resultats/<AAAA-MM-JJ-HHMM>.json` (date et heure locales) avec exactement ce schéma, puis affiche-le :

```json
{
  "version_sonde": "1",
  "meta": { "date": "AAAA-MM-JJTHH:MM", "modele": "<nom du modèle ou INCONNU>", "version_antigravity": "A_REMPLIR", "infractions": [] },
  "etapes": {
    "E0": { "canaris": [], "autres_regles": [], "notes": "" },
    "E1": { "canaris": [], "autres_regles": [], "notes": "" },
    "E2": { "canaris": [], "autres_regles": [], "notes": "" },
    "E3": { "canaris": [], "autres_regles": [], "notes": "" },
    "E4": { "canaris": [], "autres_regles": [], "notes": "" },
    "E5": { "canaris": [], "autres_regles": [], "notes": "" },
    "E6": { "canaris": [], "autres_regles": [], "notes": "" },
    "E7": { "canaris": [], "autres_regles": [], "notes": "" },
    "E8": { "canaris": [], "autres_regles": [], "notes": "" },
    "E9": { "canaris": [], "autres_regles": [], "notes": "" }
  },
  "structure": {
    "S1": null, "S2": null, "S3": null, "S4": null,
    "S5": { "present": null, "octets_tronques": null },
    "S6": null, "S7": null, "S8": null, "S9": null,
    "S10": { "descriptions_visibles": null, "categories": [] },
    "S11": null,
    "S12": null
  }
}
```

Ne nettoie rien et ne modifie aucun autre fichier.
