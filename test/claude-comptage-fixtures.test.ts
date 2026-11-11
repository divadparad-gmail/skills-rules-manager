import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';

// Simulation de l'environnement VS Code pour l'exécution des tests unitaires hors VS Code ; le profil
// global de Claude Code est le dossier « global » du jeu déployé (réglage skillsManager.claudeGlobalPath)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'vscode') {
    return 'vscode';
  }
  return origResolve.call(this, request, ...args);
};
let claudeGlobalPath = '';
require.cache['vscode'] = {
  id: 'vscode',
  filename: 'vscode',
  loaded: true,
  exports: {
    window: {
      createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
      showInformationMessage: () => Promise.resolve(),
      showErrorMessage: () => Promise.resolve(),
      showWarningMessage: () => Promise.resolve(),
    },
    workspace: {
      workspaceFolders: [] as any[],
      getConfiguration: () => ({
        get: (key: string, def: any) => (key === 'claudeGlobalPath' && claudeGlobalPath ? claudeGlobalPath : def),
      }),
    },
    env: { appName: 'Visual Studio Code' },
    Uri: { file: (f: string) => ({ fsPath: f, scheme: 'file' }) },
    commands: { executeCommand: () => Promise.resolve() },
  },
} as any;

import { StateManager } from '../src/services/StateManager';
import { WorkspaceDetector } from '../src/services/WorkspaceDetector';
import { ManagerFullState, ResourceItem } from '../src/types';

/**
 * L'oracle du comptage de Claude Code (lot C1) : les fixtures inertes de la suite d'injection
 * (test/scenarios/claude-code-injection-contexte/fixtures/) sont déployées dans un dossier temporaire,
 * puis lues par l'extension (StateManager, comme dans l'extension). On compare :
 * - la présence au démarrage, la portée et le statut de chaque élément aux entrées « context » de
 *   attendu/baseline-2026-11-10.json (jeux niveaux, skills, skill-long-1500, declencheurs, et
 *   cout-regle-paths dans la combinaison cout-regles) ;
 * - pour le jeu doublons-d6, absent de toute baseline publiée, aux mesures de la grille commitée
 *   SCENARIOS-CLAUDE-CODE.md (lignes CC38 à CC40, lot E4, 2.1.319) ;
 * - les tokens o200k de chaque élément lu, en valeurs exactes figées au lot C1.
 * Les tokens de Claude (champ `tokens` de la baseline, en /context) ne sont pas comparés : ils le seront
 * avec le facteur de la jauge, à un lot ultérieur. Les éléments que Claude Code charge et que l'extension
 * ne lit pas encore sont listés à part (ATTENDUS_PLUS_TARD), et le test vérifie qu'ils sont absents.
 */
const ROOT = path.resolve(__dirname, '..', '..');
const SUITE = path.join(ROOT, 'test', 'scenarios', 'claude-code-injection-contexte');
const FIXTURES = path.join(SUITE, 'fixtures');
interface Commun {
  convertir: (rel: string, nomProjet?: string) => { jeu: string; cible: string; chemin: string };
  racinesCibles: (r: { configDir: string; espace: string }) => Record<string, string>;
  nomDossierMemoire: (cheminProjet: string) => string;
  lireInventaire: (texte: string) => Map<string, { sha256: string; canaris: string[] }>;
  ecartsEmpreintes: (jeux: string[], contenus: Map<string, string>, inventaire: Map<string, unknown>) => string[];
}
// Le module partagé de la suite (lot I2), sans copie de ses fonctions
// eslint-disable-next-line @typescript-eslint/no-var-requires
const commun = require(path.join(ROOT, 'test', 'scenarios', 'scripts', 'sonde-claude-code-commun.js')) as Commun;

interface EntreeContext {
  id: string;
  combinaison: string;
  element?: string;
  skill?: string;
  attendu: { present?: boolean; type?: string; source?: string; delta?: number };
}

/** Ce que l'extension montre d'un élément lu : portée, présence au démarrage, statut et tokens o200k de la carte. */
interface Vu { cle: string; portee: 'global' | 'local'; auDemarrage: boolean; statut: string; o200k: number }

/** Les éléments de chaque jeu que l'extension lit au lot C1, avec leurs valeurs figées (o200k mesurés au lot C1). */
const ATTENDUS_C1: Record<string, Vu[]> = {
  niveaux: [
    { cle: '<global>/CLAUDE.md', portee: 'global', auDemarrage: true, statut: 'âme', o200k: 27 },
    { cle: '<global>/rules/g-paths.md', portee: 'global', auDemarrage: false, statut: 'règle conditionnelle', o200k: 21 },
    { cle: '<global>/rules/g-perm.md', portee: 'global', auDemarrage: true, statut: 'règle permanente', o200k: 20 },
    { cle: '<projet>/.claude/rules/p-paths.md', portee: 'local', auDemarrage: false, statut: 'règle conditionnelle', o200k: 24 },
    { cle: '<projet>/.claude/rules/p-perm.md', portee: 'local', auDemarrage: true, statut: 'règle permanente', o200k: 21 },
    { cle: '<projet>/.claude/rules/p-yaml-invalide.md', portee: 'local', auDemarrage: true, statut: 'règle permanente (YAML invalide)', o200k: 24 },
    { cle: '<projet>/CLAUDE.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 26 },
  ],
  skills: [
    { cle: 'skill canari-cache@<projet>', portee: 'local', auDemarrage: false, statut: 'skill manuel', o200k: 0 },
    { cle: 'skill canari-g1@<global>', portee: 'global', auDemarrage: true, statut: 'skill listé', o200k: 31 },
    { cle: 'skill canari-homo@<global>', portee: 'global', auDemarrage: true, statut: 'skill listé', o200k: 31 },
    { cle: 'skill canari-homo@<projet>', portee: 'local', auDemarrage: false, statut: 'skill masqué', o200k: 0 },
    { cle: 'skill canari-long@<projet>', portee: 'local', auDemarrage: true, statut: 'skill listé (coupé)', o200k: 209 },
    { cle: 'skill canari-p1@<projet>', portee: 'local', auDemarrage: true, statut: 'skill listé', o200k: 31 },
  ],
  'skill-long-1500': [
    { cle: 'skill canari-long@<projet>', portee: 'local', auDemarrage: true, statut: 'skill listé', o200k: 210 },
  ],
  declencheurs: [
    { cle: '<projet>/.claude/rules/d-paths.md', portee: 'local', auDemarrage: false, statut: 'règle conditionnelle', o200k: 29 },
    { cle: 'skill canari-paths@<projet>', portee: 'local', auDemarrage: false, statut: 'skill paths', o200k: 0 },
  ],
  'cout-regle-paths': [
    { cle: '<projet>/.claude/rules/r-paths.md', portee: 'local', auDemarrage: false, statut: 'règle conditionnelle', o200k: 33 },
  ],
  'doublons-d6': [
    { cle: '<global>/rules/d6-meme-nom.md', portee: 'global', auDemarrage: true, statut: 'règle permanente', o200k: 29 },
    { cle: '<projet>/.claude/rules/d6-meme-nom.md', portee: 'local', auDemarrage: true, statut: 'règle permanente', o200k: 61 },
    { cle: '<projet>/CLAUDE.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 22 },
    { cle: 'skill canari-d6-homo@<projet>', portee: 'local', auDemarrage: true, statut: 'skill listé', o200k: 50 },
  ],
};

/**
 * Les éléments chargés par Claude Code que l'extension ne lit pas encore (mémoire du projet et des
 * dossiers parents, imports, MEMORY.md, règles des sous-dossiers et des parents, skills des parents
 * et des plugins). Le lot qui les lira devra retirer chaque élément de cette liste et l'ajouter à
 * ATTENDUS_C1 : le test échoue dès qu'un de ces éléments apparaît dans l'état.
 */
const ATTENDUS_PLUS_TARD: Record<string, string[]> = {
  niveaux: [
    '<global>/projects/<memoire>/memory/MEMORY.md',
    '<parent>/.claude/CLAUDE.md',
    '<parent>/.claude/rules/par-regle.md',
    '<parent>/CLAUDE.md',
    '<projet>/.claude/CLAUDE.md',
    '<projet>/.claude/rules/sous/p-sous.md',
    '<projet>/CLAUDE.local.md',
    '<projet>/import-1.md',
    '<projet>/import-2.md',
    '<projet>/import-3.md',
    '<projet>/import-4.md',
  ],
  skills: ['skill canari-parent', 'skill canari-plugin:canari-plug'],
  'skill-long-1500': [],
  declencheurs: [],
  'cout-regle-paths': [],
  // CC39 : la copie du parent n'est pas listée par Claude Code, et l'extension ne lit pas encore les parents
  'doublons-d6': ['<projet>/CLAUDE.local.md', '<projet>/d6-commun.md', 'skill canari-d6-homo@<parent>'],
};

/**
 * Jeu doublons-d6 : mesures de la grille SCENARIOS-CLAUDE-CODE.md (lot E4, /context, 2.1.319) :
 * - CC38 : les deux règles de même nom sont listées, la globale (User, 50) et celle du projet (Project, 109) ;
 * - CC39 : canari-d6-homo présent une seule fois, projectSettings, 72 : la copie du projet (déduit des tokens) ;
 * - CC40 : d6-commun.md listé une seule fois (Project, 36), à côté du CLAUDE.md (Project, 39) et du
 *   CLAUDE.local.md (Local, 45) qui l'importent.
 */
const GRILLE_DOUBLONS_D6: EntreeContext[] = [
  { id: 'CC38:global', combinaison: 'doublons-d6', element: '<global>/rules/d6-meme-nom.md', attendu: { present: true, type: 'User' } },
  { id: 'CC38:projet', combinaison: 'doublons-d6', element: '<projet>/.claude/rules/d6-meme-nom.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC39', combinaison: 'doublons-d6', skill: 'canari-d6-homo', attendu: { present: true, source: 'projectSettings' } },
  { id: 'CC40:commun', combinaison: 'doublons-d6', element: '<projet>/d6-commun.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC40:claude', combinaison: 'doublons-d6', element: '<projet>/CLAUDE.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC40:local', combinaison: 'doublons-d6', element: '<projet>/CLAUDE.local.md', attendu: { present: true, type: 'Local' } },
];

const JEUX = ['niveaux', 'skills', 'skill-long-1500', 'declencheurs', 'cout-regle-paths', 'doublons-d6'];
/** Combinaison de la baseline qui porte les entrées d'un jeu (le jeu cout-regle-paths est mesuré dans cout-regles). */
const COMBINAISON: Record<string, string> = { 'cout-regle-paths': 'cout-regles' };

const lister = (dir: string, base = ''): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? lister(path.join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`]);
const posix = (p: string) => p.split(path.sep).join('/');

describe('Suite de Tests : oracle du comptage de Claude Code sur les fixtures inertes de la suite d\'injection (lot C1)', () => {
  let tempBaseDir: string;
  const vscodeMock = require('vscode');
  const baseline = JSON.parse(fs.readFileSync(path.join(SUITE, 'attendu', 'baseline-2026-11-10.json'), 'utf8')) as { entrees: Array<EntreeContext & { instrument: string }> };
  const inventaire = commun.lireInventaire(fs.readFileSync(path.join(SUITE, 'inventaire.json'), 'utf8'));
  const toutes = lister(FIXTURES);

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'claude-c1-oracle-'));
  });

  after(async () => {
    claudeGlobalPath = '';
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  /** Déploie un jeu dans le dossier temporaire et charge l'état de l'extension, comme dans VS Code. */
  const deployerEtCharger = async (jeu: string) => {
    const racines = commun.racinesCibles({ configDir: path.join(tempBaseDir, jeu, 'global'), espace: path.join(tempBaseDir, jeu, 'espace') });
    fs.mkdirSync(racines.projet, { recursive: true });
    fs.mkdirSync(racines.global, { recursive: true });
    const contenus = new Map<string, string>();
    for (const rel of toutes.filter((r) => r.split('/')[0] === jeu)) {
      const texte = fs.readFileSync(path.join(FIXTURES, ...rel.split('/')), 'utf8');
      contenus.set(rel, texte);
      const { cible, chemin } = commun.convertir(rel, commun.nomDossierMemoire(racines.projet));
      const dest = path.join(racines[cible], ...chemin.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, texte, 'utf8');
    }

    const origFolders = vscodeMock.workspace.workspaceFolders;
    vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: racines.projet } }];
    WorkspaceDetector.setOverriddenTool('claude-code');
    claudeGlobalPath = racines.global;
    try {
      const state = await StateManager.loadFullState(true);
      return { state, racines, contenus };
    } finally {
      claudeGlobalPath = '';
      WorkspaceDetector.setOverriddenTool(null);
      vscodeMock.workspace.workspaceFolders = origFolders;
    }
  };

  /** Le nom masqué d'un chemin réel : <projet>, <parent> ou <global>, en séparateurs « / ». */
  const masquer = (p: string, racines: Record<string, string>) => {
    for (const [nom, racine] of [['projet', racines.projet], ['parent', racines.parent], ['global', racines.global]] as const) {
      const rel = path.relative(racine, p);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) return `<${nom}>${rel ? `/${posix(rel)}` : ''}`;
    }
    return p;
  };

  /** Ce que l'extension montre des âmes, des règles et des skills de Claude Code. */
  const vus = (state: ManagerFullState, racines: Record<string, string>): Vu[] =>
    [...state.globalResources, ...state.localResources]
      .filter((i: ResourceItem) => i.targetTool === 'claude-code' && ['soul', 'rule', 'skill'].includes(i.type))
      .map((i: ResourceItem): Vu => {
        const portee = i.scope === 'global' ? 'global' : 'local';
        const m = i.metadata ?? {};
        if (i.type === 'skill') {
          const lieu = masquer(i.path, racines).split('/')[0];
          const statut = m.claudeSkillMaskedBy ? 'skill masqué' : m.claudeSkillManualOnly ? 'skill manuel' : m.claudeSkillPathsTriggered ? 'skill paths'
            : m.claudeDescriptionOriginalLength ? 'skill listé (coupé)' : 'skill listé';
          return { cle: `skill ${i.name}@${lieu}`, portee, auDemarrage: statut.startsWith('skill listé') && i.enabled, statut, o200k: i.tokenCount ?? 0 };
        }
        if (i.type === 'soul') return { cle: masquer(i.path, racines), portee, auDemarrage: i.enabled, statut: 'âme', o200k: i.tokenCount ?? 0 };
        const statut = m.isConditional ? 'règle conditionnelle' : m.claudeYamlInvalid ? 'règle permanente (YAML invalide)' : 'règle permanente';
        return { cle: masquer(i.path, racines), portee, auDemarrage: i.enabled && !m.isConditional, statut, o200k: i.tokenCount ?? 0 };
      })
      .sort((a, b) => a.cle.localeCompare(b.cle));

  /** Compare une entrée « context » (baseline ou grille) à ce que montre l'extension. */
  const comparer = (entree: EntreeContext, liste: Vu[], plusTard: string[]) => {
    const { present, type, source } = entree.attendu;
    if (entree.skill !== undefined) {
      const nom = entree.skill;
      if (plusTard.includes(`skill ${nom}`)) {
        assert.ok(!liste.some((v) => v.cle.startsWith(`skill ${nom}@`) || v.cle.startsWith(`skill ${nom.split(':').pop()}@`)), `${entree.id} : lu trop tôt`);
        return;
      }
      const listes = liste.filter((v) => v.cle.startsWith(`skill ${nom}@`) && v.auDemarrage);
      if (present) {
        assert.strictEqual(listes.length, 1, `${entree.id} : une seule copie listée au démarrage`);
        assert.strictEqual(listes[0].portee, source === 'userSettings' ? 'global' : 'local', `${entree.id} : portée`);
      } else {
        assert.strictEqual(listes.length, 0, `${entree.id} : absent au démarrage`);
      }
      return;
    }
    const element = entree.element!;
    if (plusTard.includes(element)) {
      assert.ok(!liste.some((v) => v.cle === element), `${entree.id} : ${element} est lu, la liste des éléments attendus plus tard est à mettre à jour`);
      return;
    }
    const vu = liste.find((v) => v.cle === element);
    if (present) {
      assert.ok(vu && vu.auDemarrage, `${entree.id} : ${element} présent au démarrage`);
      assert.strictEqual(vu!.portee, type === 'User' ? 'global' : 'local', `${entree.id} : portée`);
    } else {
      assert.ok(!vu || !vu.auDemarrage, `${entree.id} : ${element} absent au démarrage`);
    }
  };

  const entreesDe = (jeu: string): EntreeContext[] => {
    if (jeu === 'doublons-d6') return GRILLE_DOUBLONS_D6;
    const combinaison = COMBINAISON[jeu] ?? jeu;
    const fichiersDuJeu = new Set(toutes.filter((r) => r.split('/')[0] === jeu).map((r) => {
      const { cible, chemin } = commun.convertir(r, '<memoire>');
      return `<${cible}>/${chemin}`;
    }));
    return baseline.entrees.filter((e) => e.instrument === 'context' && e.combinaison === combinaison && e.attendu.delta === undefined)
      .filter((e) => combinaison === jeu || (e.element !== undefined && fichiersDuJeu.has(e.element)));
  };

  test('1. Les fixtures lues sont celles de l\'inventaire (empreintes)', () => {
    const contenus = new Map(toutes.filter((r) => JEUX.includes(r.split('/')[0]))
      .map((r) => [r, fs.readFileSync(path.join(FIXTURES, ...r.split('/')), 'utf8')] as [string, string]));
    assert.deepStrictEqual(commun.ecartsEmpreintes(JEUX, contenus, inventaire), []);
    assert.ok(contenus.size > 0);
  });

  for (const jeu of JEUX) {
    test(`2. Jeu ${jeu} : présence, portée, statut et tokens o200k`, async () => {
      const { state, racines, contenus } = await deployerEtCharger(jeu);
      assert.strictEqual(state.workspace.tool, 'claude-code');
      assert.deepStrictEqual(commun.ecartsEmpreintes([jeu], contenus, inventaire), [], 'Fixtures conformes à l\'inventaire');

      const liste = vus(state, racines);
      // Ce que l'extension lit au lot C1, ni plus ni moins, avec les tokens o200k exacts
      assert.deepStrictEqual(liste, ATTENDUS_C1[jeu]);

      // Chaque entrée « context » de la baseline (ou de la grille) : présence et portée
      const entrees = entreesDe(jeu);
      assert.ok(entrees.length > 0, `${jeu} : au moins une entrée de référence`);
      for (const entree of entrees) comparer(entree, liste, ATTENDUS_PLUS_TARD[jeu]);

      // Les éléments attendus plus tard sont absents de l'état
      for (const cle of ATTENDUS_PLUS_TARD[jeu]) {
        assert.ok(!liste.some((v) => v.cle === cle || v.cle.startsWith(`${cle}@`)), `${jeu} : ${cle} est lu, à rattacher à l'oracle`);
      }
      // Aucun doublon ni gaspillage parmi les skills
      const doublonsSkills = [...state.globalResources, ...state.localResources].filter((i) => i.type === 'skill' && i.metadata?.duplicateInfo);
      assert.strictEqual(doublonsSkills.length, 0, `${jeu} : aucun skill en doublon`);
    });
  }
});
