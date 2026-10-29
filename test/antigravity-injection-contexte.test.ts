import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe } from 'node:test';

// Suite de régression « injection-contexte » : fige le comportement observé d'Antigravity IDE, avec une
// baseline par version (2.5.5 le 2026-10-21, 2.6.0 le 2026-10-28). Le test statique protège les fixtures.
// La comparaison au dernier rapport de sonde ne s'exécute qu'avec INJECTION_COMPARE=1 (npm run test:injection) :
// elle choisit la baseline selon meta.version_antigravity du rapport, ou selon SONDE_BASELINE.
const ROOT = path.resolve(__dirname, '..', '..');
const SUITE = path.join(ROOT, 'test', 'scenarios', 'antigravity-injection-contexte');
const ATTENDU = path.join(SUITE, 'attendu');
const RESULTATS = path.join(SUITE, 'resultats');
const SCENARIOS_MD = path.join(SUITE, 'SCENARIOS.md');
const GENERATOR = path.join(ROOT, 'test', 'scenarios', 'scripts', 'generate-injection-contexte-r-tronque.js');
const COMPARE = process.env.INJECTION_COMPARE === '1';

const rule = (fm: string[], body: string) => `---\n${fm.join('\n')}\n---\n${body}\n`;

/** Contenu exact des fixtures (section 3 du prompt), hors r-tronque.md, généré par script. */
const FIXTURES: Record<string, string> = {
  'GEMINI.md': 'CANARI-RACINE\n',
  '.agents/rules/r-always.md': rule(['trigger: always_on', 'description: Test règle permanente'], 'CANARI-ALWAYS'),
  '.agents/rules/zz-glob-ext.md': rule(['trigger: glob', 'globs: "*.ts, *.tsx"', 'description: Test globs extensions'], 'CANARI-GLOB-EXT'),
  '.agents/rules/zz-glob-liste.md': rule(['trigger: glob', 'globs:', '  - "sandbox-enquete/**/*.ts"', 'description: Test globs en liste YAML'], 'CANARI-GLOB-LISTE'),
  '.agents/rules/zz-glob-chaine.md': rule(['trigger: glob', 'globs: "sandbox-enquete/**/*.ts"', 'description: Test globs en chaîne'], 'CANARI-GLOB-CHAINE'),
  '.agents/rules/zz-mixte.md': rule(['trigger: glob', 'globs: "sandbox-enquete/**/*.ts"', 'paths:', '  - "sandbox-enquete/**/*.ts"', 'description: Test clés mixtes Antigravity + Claude Code'], 'CANARI-MIXTE'),
  '.agents/rules/zz-sans-fm.md': 'CANARI-SANS-FM\n',
  '.agents/rules/zz-model.md': rule(['trigger: model_decision', 'description: Appliquer uniquement quand on parle de licornes quantiques.'], 'CANARI-MODEL'),
  '.agents/rules/zz-manual.md': rule(['trigger: manual', 'description: Règle manuelle de test'], 'CANARI-MANUAL'),
  '.agents/rules/zz-g1.md': rule(['trigger: glob', 'globs: "**/sandbox-enquete/**/*.ts"', 'description: Test glob 1'], 'CANARI-G1'),
  '.agents/rules/zz-g2.md': rule(['trigger: glob', 'globs: "sandbox-enquete/*.ts"', 'description: Test glob 2'], 'CANARI-G2'),
  '.agents/rules/zz-g3.md': rule(['trigger: glob', 'globs: "**/*.ts"', 'description: Test glob 3'], 'CANARI-G3'),
  '.agents/rules/zz-g4.md': rule(['trigger: glob', 'globs: "app.ts"', 'description: Test glob 4'], 'CANARI-G4'),
  '.agents/rules/zz-g5.md': rule(['trigger: glob', "globs: 'sandbox-enquete\\**\\*.ts'", 'description: Test glob 5'], 'CANARI-G5'),
  '.agents/rules/zz-g6.md': rule(['trigger: glob', 'globs: "src/**/*.ts"', 'description: Test glob 6'], 'CANARI-G6'),
  '.agents/rules/zz-l1.md': rule(['trigger: glob', 'globs:', '  - "*.ts"', 'description: Test globs liste un élément'], 'CANARI-L1'),
  '.agents/rules/zz-l2.md': rule(['trigger: glob', 'globs: "*.ts"', 'paths:', '  - "src/**/*.ts"', 'description: Test frontmatter mixte'], 'CANARI-L2'),
  '.agents/rules/zz-l3.md': rule(['trigger: glob', 'globs:', '  - "*.js"', '  - "*.ts"', 'description: Test globs liste deux éléments'], 'CANARI-L3'),
  'sandbox-enquete/app.ts': 'export const a = 1;\n',
  'sandbox-enquete/notes.md': 'Fichier témoin.\n',
  'sandbox-enquete/sous/AGENTS.md': 'CANARI-DOSSIER\n',
  'sandbox-enquete/sous/profond/x.ts': 'export const c = 3;\n',
  'src/zz-test.ts': 'export const z = 0;\n',
  // La ligne « Aucun lien » était présente lors de la mesure des annexes : elle fait partie des conditions.
  '.agents/skills/zz-skill-test/SKILL.md': rule(
    ['name: zz-skill-test', "description: Skill de test d'enquête. À utiliser uniquement quand on demande le mot de passe d'enquête."],
    "CANARI-SKILL-CORPS. Le mot de passe d'enquête est « orange ».\n(Aucun lien vers les autres fichiers du dossier.)"
  ),
  '.agents/skills/zz-skill-test/references/ref.md': 'CANARI-REFERENCES\n',
  '.agents/skills/zz-skill-test/resources/res.md': 'CANARI-RESOURCES\n',
  '.agents/plugins/zz-plugin-test/plugin.json': '{ "name": "zz-plugin-test", "description": "Plugin de test d\'enquête" }\n',
  '.agents/plugins/zz-plugin-test/skills/zz-plugin-skill/SKILL.md': rule(
    ['name: zz-plugin-skill', 'description: Skill de plugin de test. À utiliser uniquement pour le mot de passe de plugin.'],
    'CANARI-PLUGIN-SKILL'
  ),
};

/** Fichiers que la sonde modifie ou crée : vérifiés à part, avec renvoi au script de réinitialisation. */
const MODULE_TS = 'sandbox-enquete/sous/module.ts';
const MODULE_TS_ORIGINAL = 'export const b = 2;\n';
const NOUVEAU_TS = 'sandbox-enquete/nouveau.ts';
const R_TRONQUE = '.agents/rules/r-tronque.md';

/** Fichiers et dossiers où un canari peut apparaître hors de sa fixture. */
const DOCS = ['README.md', 'SCENARIOS.md', 'SONDE.md'];
const AUTRES_DOSSIERS = ['attendu/', 'resultats/', 'historique/'];

const CANARY_PATTERN = /CANARI-[A-Z0-9][A-Z0-9-]*/g;
/** Extraction tolérante dans le rapport : « CANARI-G3 (réinjecté) » compte comme CANARI-G3. */
const CANARY_REPORT_PATTERN = /CANARI-[A-Z0-9-]+/gi;
/** Guillemets droits et typographiques, apostrophes et accents graves retirés de S11. */
const QUOTES_PATTERN = /["'`“”«»‘’]/g;
/**
 * Chemins à caviarder avant tout commit : tout chemin de lecteur (`C:\…`, `file:///c:/…`), tout chemin
 * réseau (`\\serveur\…`, qui révèle un nom d'hôte), tout dossier utilisateur macOS ou Linux, et tout
 * chemin du dossier personnel (`~`, `<HOME>`, `%USERPROFILE%`, `$HOME`) hors de la liste blanche
 * `.gemini` et `.claude`. Les antislashs peuvent être doublés, comme dans un fichier JSON.
 */
const CHEMINS_UTILISATEUR = [
  /(?:^|[^A-Za-z0-9])[A-Za-z]:(?:\\|\/)/,
  /(?:^|[\s"'`(])(?:\\\\){1,2}[A-Za-z0-9][\w.-]*\\{1,2}\S/,
  /\/(home|Users)\/[^\/<\s]+/,
  /(?:~|<HOME>|%USERPROFILE%|\$HOME|\$\{HOME\}|\$env:USERPROFILE)(?:\\{1,2}|\/)(?!\.(?:gemini|claude)(?:[\\/"'\s`]|$))[^\s"'`]/i,
];
/** Seuls les rapports nommés AAAA-MM-JJ-HHMM.json sont sélectionnés automatiquement. */
const RAPPORT_NOM = /^\d{4}-\d{2}-\d{2}-\d{4}\.json$/;
const ETAPES = ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9'];
const RESET_HINT = 'lance le script de réinitialisation : npm run test:injection-reset';
const README_HINT = 'voir test/scenarios/antigravity-injection-contexte/README.md';

/** Une baseline par version d'Antigravity, jamais modifiée après coup : une nouvelle version reçoit une nouvelle baseline datée. */
interface BaselineConnue {
  fichier: string;
  date: string;
  version: string;
  entrees: number;
  observees: number;
  transposees: number;
}
const BASELINES: BaselineConnue[] = [
  { fichier: 'baseline-2026-10-21.json', date: '2026-10-21', version: '2.5.5', entrees: 156, observees: 105, transposees: 51 },
  { fichier: 'baseline-2026-10-28.json', date: '2026-10-28', version: '2.6.0', entrees: 156, observees: 156, transposees: 0 },
];
const BASELINES_CONNUES = BASELINES.map((b) => `${b.version} → attendu/${b.fichier}`).join(', ');

interface EntreeBaseline {
  id: string;
  type: 'canari' | 'structure';
  etape?: string;
  canari?: string;
  cle?: string;
  /** null : la valeur attendue est un null explicite dans le rapport (S11 en 2.6.0 : aucun préambule). */
  attendu: boolean | string | null;
  confiance: 'observe' | 'transpose';
  scenario: string;
}

interface Baseline {
  baseline: string;
  environnement: Record<string, string>;
  remarques?: string[];
  entrees: EntreeBaseline[];
}

/** Valeur observée : `null` si le rapport écrit null de façon explicite, `undefined` s'il ne fournit pas la valeur. */
type Observation = boolean | string | null | undefined;

interface EtapeRapport {
  canaris?: unknown[];
  autres_regles?: string[];
  notes?: string;
}

interface Rapport {
  version_sonde?: string;
  meta?: { date?: string; modele?: string; version_antigravity?: string; infractions?: string[] };
  etapes?: Record<string, EtapeRapport>;
  structure?: Record<string, any>;
}

interface LigneComparaison {
  id: string;
  scenario: string;
  attendu: boolean | string | null;
  observe: Observation;
  confiance: string;
  ecart: boolean;
}

const read = (rel: string) => fs.readFileSync(path.join(SUITE, rel), 'utf8');

const listFiles = (dir: string, base = ''): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...listFiles(path.join(dir, entry.name), rel));
    } else {
      out.push(rel);
    }
  }
  return out;
};

const loadBaseline = (connue: BaselineConnue = BASELINES[0]): Baseline =>
  JSON.parse(fs.readFileSync(path.join(ATTENDU, connue.fichier), 'utf8'));

/** Canaris d'une étape, extraits de chaque élément et normalisés en majuscules, ou null si le tableau manque. */
const extraireCanaris = (rapport: Rapport, etape: string): string[] | null => {
  const elements = rapport.etapes?.[etape]?.canaris;
  if (!Array.isArray(elements)) return null;
  const canaris = new Set<string>();
  for (const element of elements) {
    if (typeof element !== 'string') continue;
    for (const canari of element.match(CANARY_REPORT_PATTERN) ?? []) canaris.add(canari.toUpperCase());
  }
  return [...canaris];
};

const normaliserTexte = (valeur: string) => valeur.replace(QUOTES_PATTERN, '').trim();

/**
 * Valeur observée pour une entrée de la baseline : `null` si le rapport écrit null de façon explicite,
 * `undefined` si le rapport ne fournit pas la valeur (étape, clé absente ou de type inattendu).
 */
const observer = (entree: EntreeBaseline, rapport: Rapport): Observation => {
  if (entree.type === 'canari') {
    const canaris = extraireCanaris(rapport, entree.etape!);
    return canaris ? canaris.includes(entree.canari!) : undefined;
  }
  const [cle, champ] = entree.cle!.split('.');
  const conteneur = champ ? rapport.structure?.[cle] : rapport.structure;
  const brut = conteneur !== null && typeof conteneur === 'object' ? conteneur[champ ?? cle] : undefined;
  if (brut === null) return null;
  if (typeof brut === 'boolean') return brut;
  if (typeof brut === 'string') return normaliserTexte(brut);
  return undefined;
};

/**
 * Une attente textuelle (S11 en 2.5.5) est satisfaite si la valeur observée la contient. Une attente
 * null exige un null explicite : une valeur absente du rapport reste un écart.
 */
const conforme = (attendu: boolean | string | null, observe: Observation) =>
  typeof attendu === 'string' ? typeof observe === 'string' && observe.includes(attendu) : observe === attendu;

const comparer = (baseline: Baseline, rapport: Rapport): LigneComparaison[] =>
  baseline.entrees.map((entree) => {
    const observe = observer(entree, rapport);
    return {
      id: entree.id,
      scenario: entree.scenario,
      attendu: entree.attendu,
      observe,
      confiance: entree.confiance,
      ecart: !conforme(entree.attendu, observe),
    };
  });

/** Canaris observés dans les cellules non figées (« – ») de la matrice. */
const cellulesNonFigees = (baseline: Baseline, rapport: Rapport): string[] => {
  const figees = new Set(baseline.entrees.filter((e) => e.type === 'canari').map((e) => e.id));
  const out: string[] = [];
  for (const etape of ETAPES) {
    for (const canari of extraireCanaris(rapport, etape) ?? []) {
      if (!figees.has(`${etape}:${canari}`)) out.push(`${etape}:${canari}`);
    }
  }
  return out;
};

/** Valeur de meta.version_antigravity dans le schéma de SONDE.md, à remplacer après la sonde. */
const VERSION_A_REMPLIR = 'A_REMPLIR';
/** Valeurs qui ne renseignent pas la version : l'agent sondé écrit INCONNU quand il ne la connaît pas. */
const VERSIONS_NON_RENSEIGNEES = new Set(['', VERSION_A_REMPLIR, 'INCONNU']);
const AVERTISSEMENT_VERSION = "⚠️ Version d'Antigravity non renseignée (Help > About)";

/** Avertissements à afficher avant la comparaison, sans jamais produire d'écart. */
const avertissementsRapport = (rapport: Rapport): string[] => {
  const out: string[] = [];
  const infractions = rapport.meta?.infractions ?? [];
  if (infractions.length > 0) {
    out.push(`⚠️ RAPPORT SUSPECT : la sonde déclare ${infractions.length} infraction(s) :`);
    out.push(...infractions.map((infraction) => `   - ${infraction}`));
  }
  const version = rapport.meta?.version_antigravity;
  if (typeof version !== 'string' || VERSIONS_NON_RENSEIGNEES.has(version.trim().toUpperCase())) {
    out.push(AVERTISSEMENT_VERSION);
  }
  return out;
};

/**
 * Baseline à comparer au rapport : celle désignée par SONDE_BASELINE (version, date ou nom de fichier),
 * sinon celle de meta.version_antigravity. Une version non renseignée ou inconnue n'est jamais devinée.
 */
const choisirBaseline = (rapport: Rapport, forcee?: string): { baseline: BaselineConnue } | { erreur: string } => {
  const voulue = forcee?.trim();
  if (voulue) {
    const baseline = BASELINES.find((b) => [b.version, b.date, b.fichier].includes(voulue));
    return baseline
      ? { baseline }
      : { erreur: `SONDE_BASELINE=${voulue} ne désigne aucune baseline connue (${BASELINES_CONNUES}).` };
  }
  const version = rapport.meta?.version_antigravity;
  if (typeof version !== 'string' || VERSIONS_NON_RENSEIGNEES.has(version.trim().toUpperCase())) {
    return {
      erreur: "Version d'Antigravity non renseignée dans le rapport : note-la d'abord dans meta.version_antigravity "
        + `(Help > About), puis relance la comparaison (${README_HINT}). Pour forcer une baseline, utilise SONDE_BASELINE.`,
    };
  }
  const baseline = BASELINES.find((b) => b.version === version.trim());
  return baseline
    ? { baseline }
    : {
      erreur: `Aucune baseline pour Antigravity ${version.trim()} (connues : ${BASELINES_CONNUES}). Pour comparer `
        + `quand même, désigne-en une avec SONDE_BASELINE ; pour figer cette version, crée une nouvelle baseline datée (${README_HINT}).`,
    };
};

/**
 * Rapport le plus récent d'un dossier, parmi les fichiers nommés AAAA-MM-JJ-HHMM.json
 * (l'ordre alphabétique est alors l'ordre chronologique). Les autres .json sont ignorés et signalés.
 */
const choisirRapport = (dir: string): { rapport: string | null; ignores: string[] } => {
  const json = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  const valides = json.filter((f) => RAPPORT_NOM.test(f));
  return {
    rapport: valides.length ? path.join(dir, valides[valides.length - 1]) : null,
    ignores: json.filter((f) => !RAPPORT_NOM.test(f)),
  };
};

/** Numéros des lignes qui contiennent un chemin à caviarder (voir CHEMINS_UTILISATEUR). */
const lignesAvecCheminUtilisateur = (texte: string): number[] =>
  texte.split(/\r?\n/).flatMap((ligne, i) => (CHEMINS_UTILISATEUR.some((re) => re.test(ligne)) ? [i + 1] : []));

/** Ligne « Si ça change » de chaque scénario, lue dans le tableau récapitulatif de SCENARIOS.md. */
const lireSiCaChange = (): Record<string, string> => {
  if (!fs.existsSync(SCENARIOS_MD)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(SCENARIOS_MD, 'utf8').split(/\r?\n/)) {
    const match = /^\|\s*(SC\d{2})\s*\|/.exec(line);
    if (!match) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    out[match[1]] = cells[cells.length - 1];
  }
  return out;
};

const formater = (valeur: Observation, type: 'canari' | 'structure') => {
  if (valeur === undefined) return '(absent du rapport)';
  if (valeur === null) return 'null';
  if (typeof valeur === 'string') return JSON.stringify(valeur);
  if (type === 'canari') return valeur ? 'présent' : 'absent';
  return String(valeur);
};

describe('Suite de Tests : Injection de contexte Antigravity (intégrité des fixtures)', () => {
  test('1. Fixtures : chaque fichier de la section 3 existe avec son contenu exact', () => {
    for (const [rel, expected] of Object.entries(FIXTURES)) {
      const abs = path.join(SUITE, rel);
      assert.ok(fs.existsSync(abs), `Fixture manquante : ${rel}`);
      assert.strictEqual(read(rel), expected, `Contenu modifié : ${rel}`);
    }
    assert.ok(!read('.agents/rules/zz-sans-fm.md').startsWith('---'), 'zz-sans-fm.md ne doit pas avoir de frontmatter');
  });

  test('2. r-tronque.md : plus de 24 000 octets, bornée par les canaris de début et de fin', () => {
    const content = read(R_TRONQUE);
    const lines = content.trimEnd().split('\n');
    assert.ok(Buffer.byteLength(content, 'utf8') > 24000, 'r-tronque.md doit dépasser 24 000 octets');
    assert.strictEqual(lines.slice(0, 4).join('\n'), '---\ntrigger: always_on\ndescription: Test troncature 24 Ko\n---');
    assert.strictEqual(lines[4], 'CANARI-TRONQUE-DEBUT', 'Le corps doit commencer par CANARI-TRONQUE-DEBUT');
    assert.strictEqual(lines[lines.length - 1], 'CANARI-TRONQUE-FIN', 'Le fichier doit finir par CANARI-TRONQUE-FIN');
    const { buildRTronque } = require(GENERATOR) as { buildRTronque: () => string };
    assert.strictEqual(content, buildRTronque(), 'r-tronque.md diffère du générateur : relance generate-injection-contexte-r-tronque.js');
  });

  test('3. État avant sonde : module.ts d\'origine et nouveau.ts absent', (t) => {
    if (COMPARE) {
      t.skip('Comparaison en cours : la sonde a pu modifier module.ts et créer nouveau.ts.');
      return;
    }
    assert.strictEqual(read(MODULE_TS), MODULE_TS_ORIGINAL, `module.ts a été modifié : ${RESET_HINT}`);
    assert.ok(!fs.existsSync(path.join(SUITE, NOUVEAU_TS)), `nouveau.ts existe : ${RESET_HINT}`);
  });

  test('4. Aucun fichier parasite dans l\'espace de travail sondé', () => {
    const attendus = new Set([...Object.keys(FIXTURES), R_TRONQUE, MODULE_TS, NOUVEAU_TS, ...DOCS]);
    const parasites = listFiles(SUITE).filter(
      (rel) => !attendus.has(rel) && !AUTRES_DOSSIERS.some((dir) => rel.startsWith(dir))
    );
    assert.deepStrictEqual(parasites, [], 'Un fichier inattendu peut fausser la mesure de la sonde');
  });

  test('5. Canaris : chacun n\'apparaît que dans sa fixture et dans les documents autorisés', () => {
    const home = new Map<string, string>();
    for (const [rel, content] of Object.entries(FIXTURES)) {
      for (const canari of content.match(CANARY_PATTERN) ?? []) home.set(canari, rel);
    }
    home.set('CANARI-TRONQUE-DEBUT', R_TRONQUE);
    home.set('CANARI-TRONQUE-FIN', R_TRONQUE);
    assert.strictEqual(home.size, 25, 'La section 3 définit 25 canaris');

    const fuites: string[] = [];
    for (const rel of listFiles(SUITE)) {
      if (DOCS.includes(rel) || AUTRES_DOSSIERS.some((dir) => rel.startsWith(dir))) continue;
      for (const canari of fs.readFileSync(path.join(SUITE, rel), 'utf8').match(CANARY_PATTERN) ?? []) {
        if (home.get(canari) !== rel) fuites.push(`${canari} dans ${rel}`);
      }
    }
    assert.deepStrictEqual(fuites, []);
  });

  test('6. Baselines : JSON valide, sans doublon, une par version, avec ses comptes (2.5.5 : 156 dont 105 observées ; 2.6.0 : 156 observées)', () => {
    assert.deepStrictEqual(
      fs.readdirSync(ATTENDU).filter((f) => f.endsWith('.json')).sort(),
      BASELINES.map((b) => b.fichier).sort(),
      'Chaque fichier de attendu/ doit figurer dans la table BASELINES du test'
    );
    assert.strictEqual(new Set(BASELINES.map((b) => b.version)).size, BASELINES.length, 'Une seule baseline par version');

    for (const connue of BASELINES) {
      const baseline = loadBaseline(connue);
      const ids = baseline.entrees.map((e) => e.id);
      assert.strictEqual(new Set(ids).size, ids.length, `Doublon d'id dans ${connue.fichier}`);
      assert.strictEqual(baseline.baseline, connue.date, connue.fichier);
      assert.strictEqual(baseline.environnement.version, connue.version, connue.fichier);
      assert.strictEqual(baseline.entrees.length, connue.entrees, connue.fichier);
      assert.strictEqual(baseline.entrees.filter((e) => e.confiance === 'observe').length, connue.observees, connue.fichier);
      assert.strictEqual(baseline.entrees.filter((e) => e.confiance === 'transpose').length, connue.transposees, connue.fichier);
      for (const e of baseline.entrees) {
        assert.match(e.scenario, /^SC(0[1-9]|1[0-2])$/, `Scénario invalide : ${e.id}`);
        if (e.type === 'canari') {
          assert.ok(ETAPES.includes(e.etape!), `Étape invalide : ${e.id}`);
          assert.strictEqual(e.id, `${e.etape}:${e.canari}`);
          assert.strictEqual(typeof e.attendu, 'boolean');
        } else {
          assert.strictEqual(e.id, e.cle);
          assert.ok(e.attendu === null || ['boolean', 'string'].includes(typeof e.attendu), `Attente invalide : ${e.id}`);
        }
      }
    }

    // Les baselines portent les mêmes entrées, dans le même ordre : seules les valeurs attendues changent
    const signature = (connue: BaselineConnue) => loadBaseline(connue).entrees.map((e) => `${e.id}|${e.type}|${e.scenario}`);
    for (const connue of BASELINES.slice(1)) {
      assert.deepStrictEqual(signature(connue), signature(BASELINES[0]), `${connue.fichier} doit reprendre les entrées de ${BASELINES[0].fichier}`);
    }
    // S11 : le préambule en 2.5.5, un null explicite en 2.6.0 (aucun préambule)
    const s11 = (version: string) => loadBaseline(BASELINES.find((b) => b.version === version)!).entrees.find((e) => e.id === 'S11')!.attendu;
    assert.strictEqual(typeof s11('2.5.5'), 'string');
    assert.strictEqual(s11('2.6.0'), null);
  });

  test('7. Comparateur : écarts, rédaction libre du rapport, choix du rapport et avertissements', async () => {
    // Rapports fabriqués en mémoire pour vérifier l'outillage : ce ne sont pas des résultats de sonde.
    const baseline = loadBaseline();
    const conformeA = (reference: Baseline): Rapport => {
      const rapport: Rapport = { meta: { version_antigravity: '1.2.3', infractions: [] }, etapes: {}, structure: { S5: {} } };
      for (const etape of ETAPES) rapport.etapes![etape] = { canaris: [] };
      for (const e of reference.entrees) {
        if (e.type === 'canari') {
          if (e.attendu) rapport.etapes![e.etape!].canaris!.push(e.canari!);
        } else if (e.cle === 'S5.present') {
          rapport.structure!.S5.present = e.attendu;
        } else {
          rapport.structure![e.cle!] = e.attendu;
        }
      }
      return rapport;
    };
    const conformeALaBaseline = () => conformeA(baseline);
    const ecartsDe = (rapport: Rapport) => comparer(baseline, rapport).filter((l) => l.ecart);

    // Rapport conforme, puis une cellule inversée et une étape absente
    const rapport = conformeALaBaseline();
    assert.deepStrictEqual(ecartsDe(rapport), []);
    rapport.etapes!.E1.canaris!.push('CANARI-G6');
    delete rapport.etapes!.E9;
    const ecarts = ecartsDe(rapport);
    assert.ok(ecarts.some((l) => l.id === 'E1:CANARI-G6' && l.scenario === 'SC03' && l.observe === true));
    assert.ok(ecarts.filter((l) => l.id.startsWith('E9:')).every((l) => l.observe === undefined), 'Une étape absente du rapport est un écart');
    assert.strictEqual(ecarts.length, 1 + baseline.entrees.filter((e) => e.etape === 'E9').length);

    // Point 1 : canaris annotés, en minuscules ou noyés dans du texte ; éléments sans canari ignorés
    const annote = conformeALaBaseline();
    annote.etapes!.E1.canaris = ['CANARI-G3 (réinjecté)', 'canari-g4', 'Règles CANARI-L2 et Canari-Glob-Ext vues en fin de résultat', 'aucun', 42, null];
    assert.deepStrictEqual(ecartsDe(annote), []);
    assert.deepStrictEqual(extraireCanaris(annote, 'E1')!.sort(), ['CANARI-G3', 'CANARI-G4', 'CANARI-GLOB-EXT', 'CANARI-L2']);
    annote.etapes!.E1.canaris = ['CANARI-G3 (réinjecté)', 'canari-g4', 'CANARI-GLOB-EXT'];
    assert.deepStrictEqual(ecartsDe(annote).map((l) => l.id), ['E1:CANARI-L2'], 'Un canari réellement absent reste un écart');

    // Point 2 : S11 entre guillemets ou accents graves, avec du texte autour, est conforme
    const preambule = baseline.entrees.find((e) => e.id === 'S11')!.attendu as string;
    for (const redaction of [`"${preambule}"`, `« ${preambule} »`, `\`${preambule}\``, `“${preambule}”\n\n- règle…`, `  ${preambule}  `]) {
      const s11 = conformeALaBaseline();
      s11.structure!.S11 = redaction;
      assert.deepStrictEqual(ecartsDe(s11), [], `S11 doit être conforme : ${JSON.stringify(redaction)}`);
    }
    for (const redaction of [preambule.replace('MUST', 'SHOULD'), null]) {
      const s11 = conformeALaBaseline();
      s11.structure!.S11 = redaction;
      assert.deepStrictEqual(ecartsDe(s11).map((l) => l.id), ['S11'], `S11 doit être un écart : ${JSON.stringify(redaction)}`);
    }

    // Point 3 : seuls les fichiers AAAA-MM-JJ-HHMM.json sont retenus, les autres .json sont signalés
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'injection-resultats-'));
    try {
      assert.deepStrictEqual(choisirRapport(dir), { rapport: null, ignores: [] });
      for (const f of ['2026-10-21-1405.json', '2027-01-15-0930.json', 'zz-copie.json', '2027-02-01.json', 'manuel-2027-01-15.md']) {
        await fs.promises.writeFile(path.join(dir, f), '{}', 'utf8');
      }
      const choix = choisirRapport(dir);
      assert.strictEqual(choix.rapport, path.join(dir, '2027-01-15-0930.json'), 'zz-copie.json ne doit pas passer devant par ordre alphabétique');
      assert.deepStrictEqual(choix.ignores, ['2027-02-01.json', 'zz-copie.json']);
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }

    // Point 4 : des infractions déclarées rendent le rapport suspect
    assert.deepStrictEqual(avertissementsRapport(conformeALaBaseline()), []);
    const suspect = conformeALaBaseline();
    suspect.meta!.infractions = ['Lecture de .agents/rules/zz-g3.md à E2'];
    const avertissements = avertissementsRapport(suspect);
    assert.match(avertissements[0], /RAPPORT SUSPECT/);
    assert.ok(avertissements.some((a) => a.includes('zz-g3.md')), 'Chaque infraction est citée');
    assert.deepStrictEqual(ecartsDe(suspect), [], 'Une infraction avertit sans produire d\'écart');

    // Point 5 : version d'Antigravity absente, vide, laissée à A_REMPLIR ou déclarée INCONNU par l'agent :
    // avertissement, jamais un écart (l'étalonnage du 2026-10-21 a produit "INCONNU")
    for (const version of [undefined, '', '  ', VERSION_A_REMPLIR, 'a_remplir', 'INCONNU', ' inconnu ']) {
      const sansVersion = conformeALaBaseline();
      sansVersion.meta!.version_antigravity = version;
      assert.deepStrictEqual(avertissementsRapport(sansVersion), [AVERTISSEMENT_VERSION], `version ${JSON.stringify(version)}`);
      assert.deepStrictEqual(ecartsDe(sansVersion), []);
    }
    const sansMeta = conformeALaBaseline();
    delete sansMeta.meta;
    assert.deepStrictEqual(avertissementsRapport(sansMeta), [AVERTISSEMENT_VERSION]);
    const versionNonTexte = conformeALaBaseline();
    (versionNonTexte.meta as Record<string, unknown>).version_antigravity = 2.5;
    assert.deepStrictEqual(avertissementsRapport(versionNonTexte), [AVERTISSEMENT_VERSION]);
    const versionRenseignee = conformeALaBaseline();
    versionRenseignee.meta!.version_antigravity = '2.5.5';
    assert.deepStrictEqual(avertissementsRapport(versionRenseignee), [], 'Une vraie version ne donne aucun avertissement');

    // Point 6 : chemins personnels, de lecteur ou réseau, détectés quelle que soit leur forme ;
    // dans le dossier personnel, seuls .gemini et .claude sont permis (liste blanche)
    const fuite = [
      '{ "S12": "C:\\\\Users\\\\jdupont\\\\.gemini\\\\builtin" }',
      'aucun chemin ici',
      '- file:///c:/Users/jdupont/projet/app.ts',
      'D:\\Users\\jdupont',
      '/home/jdupont/.gemini',
      'Chemin : /Users/jdupont/Documents',
      '"~/Documents/projet-fictif/.agents/rules/regle.md",',
      '~\\Documents\\projet-fictif',
      '<HOME>/Desktop/notes.md',
      '"\\\\\\\\serveur\\\\partage\\\\catalogue"',
      '\\\\serveur\\partage\\catalogue',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Users\\<HOME>',
      'E:/sauvegardes/rapport.json',
      '%USERPROFILE%\\Documents\\projet-fictif',
      '$HOME/projets/fictif',
      '~/.geminifictif/x',
    ].join('\n');
    assert.deepStrictEqual(lignesAvecCheminUtilisateur(fuite), [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    const propre = [
      '<HOME>\\.gemini\\antigravity-ide\\builtin\\skills\\',
      '<PROJET>/sandbox-enquete/app.ts',
      'file:///<PROJET>/.agents/rules/zz-model.md',
      '~/.gemini/antigravity-ide/builtin/skills/',
      '"S12": "~/.gemini/antigravity/builtin/skills"',
      '~\\.gemini\\config\\rules\\regle.md',
      '~/.claude/rules/regle.md',
      '"~/.gemini/GEMINI.md",',
      'sandbox-enquete/sous/module.ts',
      '"sandbox-enquete\\\\sous\\\\module.ts"',
      '"date": "2026-10-28T13:41"',
      'Voir https://antigravity.google/docs/rules',
      '≈ ~20 tokens au démarrage',
    ].join('\n');
    assert.deepStrictEqual(lignesAvecCheminUtilisateur(propre), []);

    // Point 7 : baseline 2.6.0, où S11 attend un null explicite ; une clé absente ou un préambule restent des écarts
    const baseline26 = loadBaseline(BASELINES.find((b) => b.version === '2.6.0')!);
    const ecarts26 = (r: Rapport) => comparer(baseline26, r).filter((l) => l.ecart);
    assert.deepStrictEqual(ecarts26(conformeA(baseline26)), []);
    const sansS11 = conformeA(baseline26);
    delete sansS11.structure!.S11;
    assert.deepStrictEqual(ecarts26(sansS11).map((l) => [l.id, l.observe]), [['S11', undefined]], 'Une clé S11 absente n\'est pas un null explicite');
    const avecPreambule = conformeA(baseline26);
    avecPreambule.structure!.S11 = preambule;
    assert.deepStrictEqual(ecarts26(avecPreambule).map((l) => l.id), ['S11'], 'Un préambule réapparu est un écart en 2.6.0');
    assert.strictEqual(formater(null, 'structure'), 'null');
    assert.strictEqual(formater(undefined, 'structure'), '(absent du rapport)');

    // Point 8 : choix de la baseline selon la version du rapport, ou forcé par SONDE_BASELINE ; jamais deviné
    const avecVersion = (version: string | undefined): Rapport => {
      const r = conformeALaBaseline();
      r.meta!.version_antigravity = version;
      return r;
    };
    const choisie = (r: Rapport, forcee?: string) => {
      const choix = choisirBaseline(r, forcee);
      return 'baseline' in choix ? choix.baseline.fichier : choix.erreur;
    };
    assert.strictEqual(choisie(avecVersion('2.5.5')), 'baseline-2026-10-21.json');
    assert.strictEqual(choisie(avecVersion(' 2.6.0 ')), 'baseline-2026-10-28.json');
    for (const version of [undefined, '', VERSION_A_REMPLIR, 'INCONNU']) {
      assert.match(choisie(avecVersion(version)), /note-la d'abord dans meta\.version_antigravity/, `version ${JSON.stringify(version)}`);
    }
    assert.match(choisie(avecVersion('2.7.0')), /Aucune baseline pour Antigravity 2\.7\.0/);
    assert.strictEqual(choisie(avecVersion('2.6.0'), '2.5.5'), 'baseline-2026-10-21.json', 'SONDE_BASELINE prime sur la version du rapport');
    assert.strictEqual(choisie(avecVersion(VERSION_A_REMPLIR), '2026-10-28'), 'baseline-2026-10-28.json');
    assert.strictEqual(choisie(avecVersion('2.5.5'), 'baseline-2026-10-28.json'), 'baseline-2026-10-28.json');
    assert.strictEqual(choisie(avecVersion('2.5.5'), '  '), 'baseline-2026-10-21.json', 'Une variable vide ne force rien');
    assert.match(choisie(avecVersion('2.5.5'), 'zz'), /SONDE_BASELINE=zz ne désigne aucune baseline connue/);
  });

  test('8. Confidentialité : aucun chemin personnel, de lecteur ou réseau dans resultats/ ni historique/', () => {
    const fuites: string[] = [];
    for (const dossier of ['resultats', 'historique']) {
      const abs = path.join(SUITE, dossier);
      if (!fs.existsSync(abs)) continue;
      for (const rel of listFiles(abs, dossier)) {
        for (const ligne of lignesAvecCheminUtilisateur(fs.readFileSync(path.join(SUITE, rel), 'utf8'))) {
          fuites.push(`${rel}:${ligne}`);
        }
      }
    }
    assert.deepStrictEqual(
      fuites,
      [],
      `Chemin personnel, de lecteur ou réseau : caviarder avant de commiter.\n${fuites.map((f) => `- ${f}`).join('\n')}`
    );
  });
});

describe('Suite de Tests : Injection de contexte Antigravity (comparaison au rapport de sonde)', () => {
  test('9. Le dernier rapport de sonde est conforme à la baseline de sa version d\'Antigravity', (t) => {
    if (!COMPARE) {
      t.skip('Comparaison désactivée dans npm test : lance npm run test:injection.');
      return;
    }

    const log: string[] = [];
    let rapportPath: string;
    if (process.env.SONDE_RAPPORT) {
      rapportPath = path.resolve(process.env.SONDE_RAPPORT);
      assert.ok(fs.existsSync(rapportPath), `SONDE_RAPPORT désigne un fichier introuvable : ${rapportPath}`);
    } else {
      const choix = choisirRapport(RESULTATS);
      for (const ignore of choix.ignores) {
        log.push(`⚠️ resultats/${ignore} ignoré : son nom ne suit pas le format AAAA-MM-JJ-HHMM.json (SONDE_RAPPORT permet de le désigner).`);
      }
      if (!choix.rapport) {
        if (log.length) console.log(log.join('\n'));
        t.skip(`Aucun rapport dans resultats/ : lance d'abord la sonde (${README_HINT}).`);
        return;
      }
      rapportPath = choix.rapport;
    }

    const rapport: Rapport = JSON.parse(fs.readFileSync(rapportPath, 'utf8'));
    log.push(`Rapport : ${path.relative(ROOT, rapportPath)}`);
    log.push(
      `Sonde v${rapport.version_sonde ?? '?'} | date ${rapport.meta?.date ?? '?'} | modèle ${rapport.meta?.modele ?? '?'}`
      + ` | Antigravity ${rapport.meta?.version_antigravity ?? '(version non notée)'}`
    );

    const forcee = process.env.SONDE_BASELINE;
    const choixBaseline = choisirBaseline(rapport, forcee);
    if ('erreur' in choixBaseline) {
      console.log(log.join('\n'));
      assert.fail(choixBaseline.erreur);
    }
    const connue = choixBaseline.baseline;
    const baseline = loadBaseline(connue);
    log.push(`Baseline : attendu/${connue.fichier} (Antigravity ${connue.version}, ${forcee?.trim() ? 'forcée par SONDE_BASELINE' : 'choisie selon la version du rapport'})`);

    const infractions = rapport.meta?.infractions ?? [];
    log.push(...avertissementsRapport(rapport));

    const lignes = comparer(baseline, rapport);
    const types = new Map(baseline.entrees.map((e) => [e.id, e.type]));
    const rows = [['id', 'scénario', 'attendu', 'observé', 'confiance', 'verdict']].concat(
      lignes.map((l) => [
        l.id,
        l.scenario,
        formater(l.attendu, types.get(l.id)!),
        formater(l.observe, types.get(l.id)!),
        l.confiance,
        l.ecart ? 'ÉCART' : 'OK',
      ])
    );
    const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
    for (const r of rows) log.push(r.map((c, i) => c.padEnd(widths[i])).join(' | '));

    log.push('', 'Informations (jamais en échec) :');
    const nonFigees = cellulesNonFigees(baseline, rapport);
    log.push(`- Cellules non figées observées : ${nonFigees.length ? nonFigees.join(', ') : 'aucune'}`);
    for (const etape of ETAPES) {
      const autres = rapport.etapes?.[etape]?.autres_regles ?? [];
      if (autres.length) log.push(`- ${etape} autres_regles : ${autres.join(', ')}`);
    }
    log.push(`- S5.octets_tronques : ${JSON.stringify(rapport.structure?.S5?.octets_tronques ?? null)}`);
    log.push(`- S10 : ${JSON.stringify(rapport.structure?.S10 ?? null)}`);
    log.push(`- S12 : ${JSON.stringify(rapport.structure?.S12 ?? null)}`);
    console.log(log.join('\n'));

    const ecarts = lignes.filter((l) => l.ecart);
    if (ecarts.length > 0) {
      const siCaChange = lireSiCaChange();
      const scenarios = [...new Set(ecarts.map((l) => l.scenario))].sort();
      const details = scenarios.map((sc) => {
        const n = ecarts.filter((l) => l.scenario === sc).length;
        return `- ${sc} (${n} écart(s)) : ${siCaChange[sc] ?? '(ligne « Si ça change » introuvable dans SCENARIOS.md)'}`;
      });
      const suspect = infractions.length > 0 ? ' Rapport SUSPECT : vérifie les infractions avant de conclure.' : '';
      assert.fail(`${ecarts.length} écart(s) avec la baseline du ${connue.date} (Antigravity ${connue.version}).${suspect}\n${details.join('\n')}`);
    }
  });
});
