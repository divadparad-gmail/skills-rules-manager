import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';

// Simulation de l'environnement VS Code pour l'exécution des tests unitaires hors VS Code ; le profil
// global de Claude Code est un dossier temporaire (réglage skillsManager.claudeGlobalPath)
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
      workspaceFolders: [],
      getConfiguration: () => ({
        get: (key: string, def: any) => (key === 'claudeGlobalPath' && claudeGlobalPath ? claudeGlobalPath : def),
      }),
    },
    env: { appName: 'Visual Studio Code' },
    Uri: { file: (f: string) => ({ fsPath: f, scheme: 'file' }) },
    commands: { executeCommand: () => Promise.resolve() },
  },
} as any;

import { CLAUDE_SKILL_DESCRIPTION_MAX_CHARS, claudeSkillBootStatus, claudeSkillListing, claudeSkillName } from '../src/claude/skillListing';
import { extractFrontmatter } from '../src/utils/frontmatter';
import { countTokens } from '../src/utils/tokenizer';
import {
  applyClaudeSkillPrecedence,
  claudeSkillDistance,
  claudeSkillHomonymKey,
  withoutMaskedSkills,
} from '../src/claude/skillPrecedence';
import { LocalScanner } from '../src/services/LocalScanner';
import { GlobalScanner } from '../src/services/GlobalScanner';
import { StateManager } from '../src/services/StateManager';
import { WorkspaceDetector } from '../src/services/WorkspaceDetector';
import { ResourceItem, WorkspaceContext } from '../src/types';

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES = path.join(ROOT, 'test', 'scenarios', 'claude-code-injection-contexte', 'fixtures');
const lireFixture = (rel: string) => fs.readFileSync(path.join(FIXTURES, ...rel.split('/')), 'utf8');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const main = require(path.join(ROOT, 'src', 'webview', 'main.js'));

/** Faux DOM minimal, comme dans les tests du webview. */
interface MockEl {
  tagName: string;
  className: string;
  innerHTML: string;
  textContent: string;
  title: string;
  children: MockEl[];
  style: Record<string, string>;
  appendChild: (child: MockEl) => MockEl;
  addEventListener: () => void;
  classList: { add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean };
}
const mockDoc = () => {
  const createElement = (tag: string): MockEl => {
    const classes = new Set<string>();
    const el: MockEl = {
      tagName: tag.toUpperCase(),
      className: '',
      innerHTML: '',
      textContent: '',
      title: '',
      children: [],
      style: {},
      appendChild(c: MockEl) {
        this.children.push(c);
        return c;
      },
      addEventListener() {},
      classList: {
        add: (c: string) => { classes.add(c); el.className = [...classes].join(' '); },
        remove: (c: string) => { classes.delete(c); el.className = [...classes].join(' '); },
        contains: (c: string) => classes.has(c),
      },
    };
    return el;
  };
  return { createElement, getElementById: () => createElement('div') };
};
const pillsOf = (root: MockEl): Array<{ text: string; title: string }> => {
  const found: Array<{ text: string; title: string }> = [];
  const walk = (el: MockEl) => {
    if (el.className.includes('item-badge-pill')) found.push({ text: el.textContent, title: el.title });
    el.children.forEach(walk);
  };
  walk(root);
  return found;
};

const skillMd = (fields: Record<string, string>, corps = 'Corps du skill.\n') =>
  `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${corps}`;

// Ligne d'un skill dans la liste de Claude Code (src/claude/skillListing.ts) : « - <nom>: <texte> »,
// sans chemin ni constante (CC24, mesuré), texte coupé à 1 536 caractères (CC27, testé ; documentation)
describe('Suite de Tests : ligne des skills de Claude Code, sans chemin et coupée à 1 536 caractères (lot C1)', () => {
  let tempBaseDir: string;

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'claude-c1-skills-'));
  });

  after(async () => {
    claudeGlobalPath = '';
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  const writeFile = async (file: string, content: string) => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, content, 'utf8');
  };

  const workspaceFor = (dir: string): WorkspaceContext => ({
    hasWorkspace: true,
    workspacePath: dir,
    tool: 'claude-code',
    agentsDir: null,
    claudeDir: path.join(dir, '.claude'),
    hasClaudeMd: false,
  });

  const scanLocal = async (dir: string) => (await LocalScanner.scan(workspaceFor(dir))).items.filter((i) => i.type === 'skill');

  test('1. Fonction pure : la ligne « - <nom>: <texte> », le nom du frontmatter sinon celui du dossier', () => {
    assert.deepStrictEqual(claudeSkillListing({ name: 'mon-skill', description: 'Fait une chose.' }, 'dossier'), {
      name: 'mon-skill', line: '- mon-skill: Fait une chose.', originalLength: 'Fait une chose.'.length, truncated: false,
    });
    assert.strictEqual(claudeSkillName({}, 'dossier'), 'dossier', 'Sans name, le nom du dossier');
    assert.strictEqual(claudeSkillName({ name: '   ' }, 'dossier'), 'dossier', 'Un name vide compte comme absent');
    assert.strictEqual(claudeSkillListing({ description: 'D.' }, 'dossier').line, '- dossier: D.');
    assert.strictEqual(claudeSkillListing({ name: 'n' }, 'dossier').line, '- n: ', 'Sans description');
  });

  test('2. Même SKILL.md sous deux chemins de longueurs différentes : même coût, sans chemin ni constante', async () => {
    const contenu = skillMd({ name: 'canari-chemin', description: 'Skill de mesure, il ne fait rien.' });
    const court = path.join(tempBaseDir, 'p');
    const long = path.join(tempBaseDir, 'un-dossier-de-projet-au-nom-nettement-plus-long', 'avec', 'plusieurs', 'niveaux');
    await writeFile(path.join(court, '.claude', 'skills', 's', 'SKILL.md'), contenu);
    await writeFile(path.join(long, '.claude', 'skills', 'un-dossier-de-skill-au-nom-bien-plus-long', 'SKILL.md'), contenu);

    const [a] = await scanLocal(court);
    const [b] = await scanLocal(long);
    const ligne = '- canari-chemin: Skill de mesure, il ne fait rien.';
    assert.strictEqual(a.tokenCount, b.tokenCount, 'Le chemin n\'entre pas dans le coût');
    assert.strictEqual(a.tokenCount, countTokens(ligne), 'Le coût est celui de la ligne entière, sans constante ajoutée');
    assert.strictEqual(a.charCount, ligne.length, 'Les caractères de la carte sont ceux de la ligne');
    assert.strictEqual(b.charCount, ligne.length);
  });

  test('3. Sans name dans le frontmatter, la ligne porte le nom du dossier', async () => {
    const dir = path.join(tempBaseDir, 'sans-nom');
    await writeFile(path.join(dir, '.claude', 'skills', 'nom-du-dossier', 'SKILL.md'), skillMd({ description: 'Sans name.' }));
    const [s] = await scanLocal(dir);
    assert.strictEqual(s.tokenCount, countTokens('- nom-du-dossier: Sans name.'));
    assert.strictEqual(s.charCount, '- nom-du-dossier: Sans name.'.length);
  });

  test('4. description et when_to_use réunis par un saut de ligne, puis coupés ensemble à 1 536 caractères', async () => {
    const courte = claudeSkillListing({ name: 'n', description: 'Quoi.', when_to_use: 'Quand.' }, 'd');
    assert.strictEqual(courte.line, '- n: Quoi.\nQuand.');
    assert.strictEqual(courte.truncated, false);
    assert.strictEqual(claudeSkillListing({ name: 'n', when_to_use: 'Seulement quand.' }, 'd').line, '- n: Seulement quand.');

    const description = 'd'.repeat(1000);
    const quand = 'w'.repeat(1000);
    const longue = claudeSkillListing({ name: 'n', description, when_to_use: quand }, 'd');
    assert.strictEqual(longue.truncated, true);
    assert.strictEqual(longue.originalLength, 2001);
    assert.strictEqual(longue.line, `- n: ${(description + '\n' + quand).slice(0, CLAUDE_SKILL_DESCRIPTION_MAX_CHARS)}`);

    const dir = path.join(tempBaseDir, 'quand');
    await writeFile(path.join(dir, '.claude', 'skills', 'q', 'SKILL.md'), skillMd({ name: 'q', description, when_to_use: quand }));
    const [s] = await scanLocal(dir);
    assert.strictEqual(s.charCount, `- q: `.length + CLAUDE_SKILL_DESCRIPTION_MAX_CHARS);
    assert.strictEqual(s.metadata?.claudeDescriptionOriginalLength, 2001);
  });

  test('5. Description de 1 500 et de 1 536 caractères : non coupée ; de 1 537 et plus : coupée', () => {
    for (const [taille, coupee] of [[1500, false], [1536, false], [1537, true], [3000, true]] as const) {
      const l = claudeSkillListing({ name: 'n', description: 'x'.repeat(taille) }, 'd');
      assert.strictEqual(l.truncated, coupee, `${taille} caractères`);
      assert.strictEqual(l.line.length, '- n: '.length + Math.min(taille, CLAUDE_SKILL_DESCRIPTION_MAX_CHARS));
      assert.strictEqual(l.originalLength, taille);
    }
  });

  test('6. Fixtures de la suite : canari-long (skills) coupé, canari-long (skill-long-1500) non coupé', () => {
    const coupe = lireFixture('skills/projet/_claude/skills/canari-long/SKILL.md.fixture');
    const l = claudeSkillListing(extractFrontmatter(coupe).metadata, 'canari-long');
    assert.strictEqual(l.truncated, true, 'Description de plus de 1 536 caractères (CC27)');
    assert.ok(l.line.includes('CANARI-CC-SKLONGDEBUT-EG4Q'), 'Le début de la description, vu par le modèle, reste compté');

    const entiere = lireFixture('skill-long-1500/projet/_claude/skills/canari-long/SKILL.md.fixture');
    const e = claudeSkillListing(extractFrontmatter(entiere).metadata, 'canari-long');
    assert.strictEqual(e.truncated, false, 'Description de 1 500 caractères');
    assert.ok(e.originalLength <= CLAUDE_SKILL_DESCRIPTION_MAX_CHARS);
  });

  test('7. GlobalScanner : la ligne d\'un skill global, sans chemin, coupée et signalée', async () => {
    const globalDir = path.join(tempBaseDir, 'global');
    await writeFile(path.join(globalDir, 'skills', 'g', 'SKILL.md'), skillMd({ name: 'g', description: 'y'.repeat(1600) }));
    await writeFile(path.join(globalDir, 'skills', 'h', 'SKILL.md'), skillMd({ name: 'h', description: 'Court.' }));
    claudeGlobalPath = globalDir;
    try {
      const result = await GlobalScanner.scan(undefined, 'claude-code');
      const g = result.items.find((i) => i.id === 'g')!;
      const h = result.items.find((i) => i.id === 'h')!;
      assert.strictEqual(g.charCount, '- g: '.length + CLAUDE_SKILL_DESCRIPTION_MAX_CHARS);
      assert.strictEqual(g.metadata?.claudeDescriptionOriginalLength, 1600);
      assert.strictEqual(h.tokenCount, countTokens('- h: Court.'));
      assert.strictEqual(h.metadata?.claudeDescriptionOriginalLength, undefined, 'Pas de coupe, pas de signalement');
      assert.strictEqual(result.skillsStat.tokenCount, (g.tokenCount || 0) + (h.tokenCount || 0));
    } finally {
      claudeGlobalPath = '';
    }
  });

  test('8. Webview : badge « ✂️ Description coupée » avec la longueur d\'origine, pour Claude Code seulement', () => {
    const skill = (targetTool: 'claude-code' | 'antigravity', metadata: Record<string, unknown>): ResourceItem => ({
      id: 's', name: 's', description: 'Skill', type: 'skill', scope: 'local', enabled: true, path: 's',
      targetTool, isFolder: true, charCount: 1541, tokenCount: 300, lineCount: 5, metadata,
    });
    const coupe = pillsOf(main.createItemCard(skill('claude-code', { claudeDescriptionOriginalLength: 2001 }), true, mockDoc()));
    const badge = coupe.find((p) => p.text === '✂️ Description coupée');
    assert.ok(badge, 'Badge présent');
    assert.ok(badge!.title.includes('1 536') && badge!.title.includes((2001).toLocaleString('fr-FR')) && badge!.title.includes('when_to_use'), badge!.title);

    const entier = pillsOf(main.createItemCard(skill('claude-code', {}), true, mockDoc()));
    assert.ok(!entier.some((p) => p.text === '✂️ Description coupée'), 'Pas de badge sans coupe');

    const agy = pillsOf(main.createItemCard(skill('antigravity', { claudeDescriptionOriginalLength: 2001 }), true, mockDoc()));
    assert.ok(!agy.some((p) => p.text === '✂️ Description coupée'), 'Aucune carte Antigravity ne reçoit ce badge');
  });

  // Skills absents de la liste au démarrage, mais actifs : disable-model-invocation (CC26, testé ;
  // documentation) et paths (CC28, mesuré ; sorties brutes de la série 5)
  test('9. Fonction pure : invocation manuelle et paths', () => {
    assert.deepStrictEqual(claudeSkillBootStatus({ 'disable-model-invocation': true }), { manualOnly: true, pathsTriggered: false });
    assert.deepStrictEqual(claudeSkillBootStatus({ paths: ['src/**/*.ts'] }), { manualOnly: false, pathsTriggered: true });
    assert.deepStrictEqual(claudeSkillBootStatus({ paths: 'src/**/*.ts' }), { manualOnly: false, pathsTriggered: true });
    assert.deepStrictEqual(claudeSkillBootStatus({ 'disable-model-invocation': false, paths: [], 'user-invocable': false }), { manualOnly: false, pathsTriggered: false });
    assert.deepStrictEqual(claudeSkillBootStatus({ 'disable-model-invocation': 'true' }), { manualOnly: false, pathsTriggered: false }, 'Une chaîne citée n\'est pas le booléen true (non vérifié)');
  });

  test('10. Fixtures : canari-cache (skills) et canari-paths (declencheurs) à 0 au démarrage, et toujours actifs', async () => {
    const dir = path.join(tempBaseDir, 'fixtures-0');
    await writeFile(path.join(dir, '.claude', 'skills', 'canari-cache', 'SKILL.md'), lireFixture('skills/projet/_claude/skills/canari-cache/SKILL.md.fixture'));
    await writeFile(path.join(dir, '.claude', 'skills', 'canari-paths', 'SKILL.md'), lireFixture('declencheurs/projet/_claude/skills/canari-paths/SKILL.md.fixture'));
    const result = await LocalScanner.scan(workspaceFor(dir));
    const cache = result.items.find((i) => i.id === 'canari-cache')!;
    const paths = result.items.find((i) => i.id === 'canari-paths')!;
    assert.strictEqual(cache.tokenCount, 0);
    assert.strictEqual(cache.charCount, 0);
    assert.strictEqual(cache.metadata?.claudeSkillManualOnly, true);
    assert.strictEqual(paths.tokenCount, 0);
    assert.strictEqual(paths.charCount, 0);
    assert.strictEqual(paths.metadata?.claudeSkillPathsTriggered, true);
    assert.strictEqual(result.skillsStat.tokenCount, 0);
    assert.strictEqual(result.skillsStat.charCount, 0);
    assert.strictEqual(result.skillsStat.activeCount, 2, 'Ces skills restent comptés parmi les actifs');
  });

  test('11. user-invocable: false ne change pas le coût', async () => {
    const dir = path.join(tempBaseDir, 'user-invocable');
    await writeFile(path.join(dir, '.claude', 'skills', 'u', 'SKILL.md'), skillMd({ name: 'u', description: 'Caché du menu.', 'user-invocable': 'false' }));
    const [u] = await scanLocal(dir);
    assert.strictEqual(u.tokenCount, countTokens('- u: Caché du menu.'));
    assert.strictEqual(u.metadata?.claudeSkillManualOnly, undefined);
  });

  test('12. Skill à la fois manuel et paths, skill global, et nombre d\'actifs', async () => {
    const dir = path.join(tempBaseDir, 'actifs');
    await writeFile(path.join(dir, '.claude', 'skills', 'normal', 'SKILL.md'), skillMd({ name: 'normal', description: 'Listé.' }));
    await writeFile(path.join(dir, '.claude', 'skills', 'manuel', 'SKILL.md'), skillMd({ name: 'manuel', description: 'Manuel.', 'disable-model-invocation': 'true' }));
    await writeFile(path.join(dir, '.claude', 'skills', 'les-deux', 'SKILL.md'),
      '---\nname: les-deux\ndescription: Manuel et paths.\ndisable-model-invocation: true\npaths:\n  - "**/*.md"\n---\nCorps.\n');
    await writeFile(path.join(dir, '.claude', 'skills', 'eteint', 'SKILL.md.disabled'), skillMd({ name: 'eteint', description: 'Désactivé.' }));
    const result = await LocalScanner.scan(workspaceFor(dir));
    const deux = result.items.find((i) => i.id === 'les-deux')!;
    assert.strictEqual(deux.metadata?.claudeSkillManualOnly, true);
    assert.strictEqual(deux.metadata?.claudeSkillPathsTriggered, true);
    assert.strictEqual(deux.tokenCount, 0);
    assert.strictEqual(result.skillsStat.activeCount, 3, 'normal, manuel et les-deux ; le skill désactivé ne compte pas');
    assert.strictEqual(result.skillsStat.tokenCount, countTokens('- normal: Listé.'), 'Seul le skill listé coûte au démarrage');
    assert.strictEqual(result.skillsStat.charCount, '- normal: Listé.'.length);

    const globalDir = path.join(tempBaseDir, 'global-manuel');
    await writeFile(path.join(globalDir, 'skills', 'gm', 'SKILL.md'), skillMd({ name: 'gm', description: 'x'.repeat(2000), 'disable-model-invocation': 'true' }));
    claudeGlobalPath = globalDir;
    try {
      const global = await GlobalScanner.scan(undefined, 'claude-code');
      const gm = global.items.find((i) => i.id === 'gm')!;
      assert.strictEqual(gm.tokenCount, 0);
      assert.strictEqual(gm.metadata?.claudeSkillManualOnly, true);
      assert.strictEqual(gm.metadata?.claudeDescriptionOriginalLength, undefined, 'Un skill absent de la liste n\'est pas signalé comme coupé');
      assert.strictEqual(global.skillsStat.activeCount, 1);
      assert.strictEqual(global.skillsStat.tokenCount, 0);
    } finally {
      claudeGlobalPath = '';
    }
  });

  test('13. Webview : badges « ✋ Invocation manuelle seulement » et « 📂 Sur fichier correspondant », métrique « 0 tok au boot »', () => {
    const skill = (targetTool: 'claude-code' | 'antigravity', metadata: Record<string, unknown>): ResourceItem => ({
      id: 'mon-skill', name: 'mon-skill', description: 'Skill', type: 'skill', scope: 'local', enabled: true, path: 's',
      targetTool, isFolder: true, charCount: 0, tokenCount: 0, lineCount: 5, metadata,
    });
    const metriqueDe = (root: MockEl): MockEl | undefined => {
      let found: MockEl | undefined;
      const walk = (el: MockEl) => { if (el.className.includes('item-metrics-badge')) found = el; el.children.forEach(walk); };
      walk(root);
      return found;
    };

    const manuel = main.createItemCard(skill('claude-code', { claudeSkillManualOnly: true }), true, mockDoc());
    const pManuel = pillsOf(manuel);
    const bManuel = pManuel.find((p) => p.text === '✋ Invocation manuelle seulement')!;
    assert.ok(bManuel.title.includes('absent de la liste destinée au modèle') && bManuel.title.includes('(testé ; documentation)') && bManuel.title.includes('user-invocable: false'), bManuel.title);
    assert.ok(bManuel.title.includes('/mon-skill'));
    assert.ok(!pManuel.some((p) => p.text === '📂 Sur fichier correspondant'));
    const mManuel = metriqueDe(manuel)!;
    assert.strictEqual(mManuel.innerHTML.replace(/<[^>]+>/g, ''), '0 tok au boot', 'Aucun coût de déclenchement affiché');
    assert.ok(mManuel.title.includes('non mesuré'), mManuel.title);

    const pPaths = pillsOf(main.createItemCard(skill('claude-code', { claudeSkillPathsTriggered: true }), true, mockDoc()));
    const bPaths = pPaths.find((p) => p.text === '📂 Sur fichier correspondant')!;
    assert.ok(bPaths.title.includes('absent au démarrage (mesuré)') && bPaths.title.includes('Read, Write ou Edit') && bPaths.title.includes('pas après Glob, Grep ni cat') && bPaths.title.includes('n\'est pas mesurée'), bPaths.title);

    const pDeux = pillsOf(main.createItemCard(skill('claude-code', { claudeSkillManualOnly: true, claudeSkillPathsTriggered: true }), true, mockDoc()));
    assert.ok(pDeux.some((p) => p.text === '✋ Invocation manuelle seulement') && pDeux.some((p) => p.text === '📂 Sur fichier correspondant'), 'Un skill manuel et paths porte les deux badges');

    const agy = main.createItemCard(skill('antigravity', { claudeSkillManualOnly: true, claudeSkillPathsTriggered: true }), true, mockDoc());
    const pAgy = pillsOf(agy);
    assert.ok(!pAgy.some((p) => p.text === '✋ Invocation manuelle seulement' || p.text === '📂 Sur fichier correspondant'), 'Aucune carte Antigravity ne reçoit ces badges');
    assert.notStrictEqual(metriqueDe(agy)!.innerHTML, '<span class="tok-highlight">0 tok au boot</span>', 'Ni cette métrique');
  });

  // Skills homonymes : un seul est listé, la copie personnelle l'emporte (CC25, mesuré et testé ;
  // documentation) ; la copie du projet est masquée, sans doublon ni gaspillage
  const vscodeMock = require('vscode');
  const chargerEtat = async (projet: string, globalDir: string) => {
    const origFolders = vscodeMock.workspace.workspaceFolders;
    vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: projet } }];
    WorkspaceDetector.setOverriddenTool('claude-code');
    claudeGlobalPath = globalDir;
    try {
      return await StateManager.loadFullState(true);
    } finally {
      claudeGlobalPath = '';
      WorkspaceDetector.setOverriddenTool(null);
      vscodeMock.workspace.workspaceFolders = origFolders;
    }
  };
  const homonymes = async (nom: string, perso: string, projet: string) => {
    const base = path.join(tempBaseDir, nom);
    const globalDir = path.join(base, 'global');
    const projetDir = path.join(base, 'projet');
    await writeFile(path.join(globalDir, 'skills', 'homo', perso.endsWith('.disabled') ? 'SKILL.md.disabled' : 'SKILL.md'), perso.replace(/\.disabled$/, ''));
    await writeFile(path.join(projetDir, '.claude', 'skills', 'homo', 'SKILL.md'), projet);
    return chargerEtat(projetDir, globalDir);
  };
  const copieProjet = (state: any) => state.localResources.find((i: ResourceItem) => i.type === 'skill' && i.id === 'homo') as ResourceItem;
  const copiePerso = (state: any) => state.globalResources.find((i: ResourceItem) => i.type === 'skill' && i.id === 'homo') as ResourceItem;

  test('14. Skill homonyme : la copie du projet est masquée, à 0 et non active, sans doublon ni gaspillage', async () => {
    const perso = skillMd({ name: 'homo', description: 'Version personnelle.' });
    const projet = skillMd({ name: 'homo', description: 'Version du projet, plus longue que la personnelle.' });
    const state = await homonymes('masque', perso, projet);
    const p = copieProjet(state);
    const g = copiePerso(state);
    assert.deepStrictEqual(p.metadata?.claudeSkillMaskedBy, { scope: 'global', path: g.path });
    assert.strictEqual(p.tokenCount, 0);
    assert.strictEqual(p.charCount, 0);
    assert.strictEqual(p.metadata?.duplicateInfo, undefined, 'Pas de doublon');
    assert.deepStrictEqual(g.metadata?.claudeSkillMasks, [{ scope: 'local', path: p.path }]);
    assert.strictEqual(g.tokenCount, countTokens('- homo: Version personnelle.'));
    assert.strictEqual(state.stats.skillsLocal.tokenCount, 0, 'La copie masquée ne coûte rien');
    assert.strictEqual(state.stats.skillsLocal.charCount, 0);
    assert.strictEqual(state.stats.skillsLocal.activeCount, 0, 'La copie masquée n\'est pas active');
    assert.strictEqual(state.stats.skillsGlobal.activeCount, 1);
    assert.strictEqual(state.stats.duplicateStats!.activeDuplicates, 0);
    assert.strictEqual(state.stats.duplicateStats!.totalDuplicates, 0);
    assert.strictEqual(state.stats.duplicateStats!.totalWastedTokens, 0);
    // Le coût MCP vient de la configuration du poste (hors de ce test) : il est retiré de la comparaison
    const horsMcp = state.stats.usedTokensTotal - state.stats.mcpGlobal.tokenCount - state.stats.mcpLocal.tokenCount;
    assert.strictEqual(horsMcp, g.tokenCount, 'Seule la copie personnelle entre dans la jauge');
  });

  test('15. Copie personnelle désactivée dans l\'extension : la copie du projet redevient comptée', async () => {
    const state = await homonymes('perso-desactivee', skillMd({ name: 'homo', description: 'Personnelle.' }) + '.disabled', skillMd({ name: 'homo', description: 'Du projet.' }));
    const p = copieProjet(state);
    assert.strictEqual(copiePerso(state).enabled, false);
    assert.strictEqual(p.metadata?.claudeSkillMaskedBy, undefined);
    assert.strictEqual(p.tokenCount, countTokens('- homo: Du projet.'));
    assert.strictEqual(state.stats.skillsLocal.activeCount, 1);
    assert.strictEqual(state.stats.skillsLocal.tokenCount, p.tokenCount);
    assert.strictEqual(state.stats.duplicateStats!.totalDuplicates, 0, 'Pas de doublon non plus');
  });

  test('16. Copie personnelle manuelle ou avec paths : la copie du projet reste comptée (non vérifié)', async () => {
    for (const [nom, champ] of [['perso-manuelle', 'disable-model-invocation: true'], ['perso-paths', 'paths:\n  - "**/*.md"']]) {
      const perso = `---\nname: homo\ndescription: Personnelle.\n${champ}\n---\nCorps.\n`;
      const state = await homonymes(nom, perso, skillMd({ name: 'homo', description: 'Du projet.' }));
      const p = copieProjet(state);
      assert.strictEqual(p.metadata?.claudeSkillMaskedBy, undefined, nom);
      assert.strictEqual(p.metadata?.claudeSkillHomonymNotMasked, true, nom);
      assert.strictEqual(p.tokenCount, countTokens('- homo: Du projet.'), nom);
      assert.strictEqual(state.stats.skillsLocal.activeCount, 1, nom);
      assert.strictEqual(copiePerso(state).metadata?.claudeSkillMasks, undefined, nom);
    }
  });

  test('17. Clé d\'homonymie : la casse ne compte pas, et le name l\'emporte sur le nom du dossier', async () => {
    const casse = await homonymes('casse', skillMd({ name: 'Homo', description: 'Personnelle.' }), skillMd({ name: 'homo', description: 'Du projet.' }));
    assert.ok(copieProjet(casse).metadata?.claudeSkillMaskedBy, 'Homo et homo sont homonymes');

    const base = path.join(tempBaseDir, 'name-dossier');
    await writeFile(path.join(base, 'global', 'skills', 'dossier-a', 'SKILL.md'), skillMd({ name: 'meme-nom', description: 'A.' }));
    await writeFile(path.join(base, 'projet', '.claude', 'skills', 'dossier-b', 'SKILL.md'), skillMd({ name: 'meme-nom', description: 'B.' }));
    await writeFile(path.join(base, 'projet', '.claude', 'skills', 'meme-nom', 'SKILL.md'), skillMd({ name: 'autre-nom', description: 'C.' }));
    const state = await chargerEtat(path.join(base, 'projet'), path.join(base, 'global'));
    const b = state.localResources.find((i: ResourceItem) => i.id === 'dossier-b')!;
    const c = state.localResources.find((i: ResourceItem) => i.id === 'meme-nom')!;
    assert.ok(b.metadata?.claudeSkillMaskedBy, 'Même name dans deux dossiers différents : masqué');
    assert.strictEqual(c.metadata?.claudeSkillMaskedBy, undefined, 'Le nom du dossier ne compte pas quand le name existe');
  });

  test('18. Fonction pure : un skill de plugin homonyme reste compté ; ordre de priorité prêt pour les dossiers parents', () => {
    const s = (id: string, scope: 'global' | 'local', metadata: Record<string, unknown> = {}): ResourceItem => ({
      id, name: 'homo', description: 'Skill', type: 'skill', scope, enabled: true, path: `${scope}/${id}`,
      targetTool: 'claude-code', isFolder: true, charCount: 10, tokenCount: 5, lineCount: 3, metadata,
    });
    const perso = s('perso', 'global');
    const plugin = s('plug', 'local', { pluginName: 'mon-plugin' });
    const r = applyClaudeSkillPrecedence([perso], [plugin]);
    assert.strictEqual(r.masked.length, 0, 'Le plugin a son propre espace de noms (plugin:skill)');
    assert.strictEqual(r.localItems[0], plugin, 'Élément rendu tel quel');
    assert.strictEqual(claudeSkillHomonymKey(plugin), 'mon-plugin:homo');

    // Copie du projet (distance 0) contre copie d'un dossier parent (distance 2) : la plus proche l'emporte
    const projet = s('projet', 'local');
    const parent = s('parent', 'local', { inheritedFrom: '../..' });
    const r2 = applyClaudeSkillPrecedence([], [parent, projet]);
    assert.deepStrictEqual(r2.masked.map((i) => i.id), ['parent']);
    assert.strictEqual(claudeSkillDistance(parent), 2);
    const parentMasque = r2.localItems.find((i) => i.id === 'parent')!;
    assert.deepStrictEqual(parentMasque.metadata?.claudeSkillMaskedBy, { scope: 'local', path: 'local/projet' });

    // La statistique perd les tokens, les caractères et l'actif de la copie masquée
    const stat = { type: 'skill' as const, scope: 'local' as const, activeCount: 2, totalCount: 2, charCount: 20, tokenCount: 10, warningCount: 0, percentage: 0.1, directoryPath: '' };
    assert.deepStrictEqual(withoutMaskedSkills(stat, r2.masked), { ...stat, activeCount: 1, charCount: 10, tokenCount: 5, warningCount: 0, percentage: 0 });
    assert.strictEqual(withoutMaskedSkills(stat, []), stat);
  });

  test('18 bis. Deux copies de même origine et de même distance ne se masquent pas (non vérifié) ; une copie du projet, si', () => {
    const s = (id: string, scope: 'global' | 'local'): ResourceItem => ({
      id, name: 'meme-nom', description: 'Skill', type: 'skill', scope, enabled: true, path: `${scope}/${id}`,
      targetTool: 'claude-code', isFolder: true, charCount: 10, tokenCount: 5, lineCount: 3, metadata: {},
    });
    const persoA = s('a', 'global');
    const persoB = s('b', 'global');
    const r = applyClaudeSkillPrecedence([persoA, persoB], []);
    assert.strictEqual(r.masked.length, 0, 'Deux skills personnels de même name restent comptés tous les deux');
    assert.deepStrictEqual(r.globalItems.map((i) => [i.id, i.tokenCount, i.metadata?.claudeSkillSameScopeHomonym]), [['a', 5, true], ['b', 5, true]], 'Chaque copie est signalée « de même portée »');

    const projet = s('p', 'local');
    const r2 = applyClaudeSkillPrecedence([persoA, persoB], [projet]);
    assert.deepStrictEqual(r2.masked.map((i) => i.id), ['p'], 'La copie du projet est masquée, les deux copies personnelles restent');
    assert.strictEqual(r2.globalItems.filter((i) => i.metadata?.claudeSkillMaskedBy).length, 0);
    assert.ok(r2.globalItems.every((i) => i.metadata?.claudeSkillSameScopeHomonym), 'Les deux copies personnelles restent signalées');
    assert.ok(r2.globalItems[0].metadata?.claudeSkillMasks, 'La première garde l\'indication du masquage');
    assert.strictEqual(r2.localItems[0].metadata?.claudeSkillSameScopeHomonym, undefined, 'La copie masquée n\'est pas « de même portée »');

    // Un skill sans homonyme de même portée n'est pas signalé
    assert.strictEqual(applyClaudeSkillPrecedence([persoA], [projet]).globalItems[0].metadata?.claudeSkillSameScopeHomonym, undefined);
  });

  test('19. Webview : badges « 🙈 Masquée », « ℹ️ Masque la copie du projet » et « ❔ Homonyme non masqué », sans doublon', () => {
    const skill = (scope: 'global' | 'local', targetTool: 'claude-code' | 'antigravity', metadata: Record<string, unknown>): ResourceItem => ({
      id: 'homo', name: 'homo', description: 'Skill', type: 'skill', scope, enabled: true, path: `${scope}/homo`,
      targetTool, isFolder: true, charCount: 0, tokenCount: 0, lineCount: 3, metadata,
    });
    const masque = pillsOf(main.createItemCard(skill('local', 'claude-code', { claudeSkillMaskedBy: { scope: 'global', path: 'global/homo' } }), true, mockDoc()));
    const bMasque = masque.find((p) => p.text === '🙈 Masquée')!;
    assert.strictEqual(bMasque.title, 'Claude Code liste la version personnelle de ce skill. Désactiver la version personnelle ferait apparaître celle du projet.');
    assert.ok(!masque.some((p) => /Doublon|Éteindre/.test(p.text)), 'Ni doublon ni bouton');

    const gagnant = pillsOf(main.createItemCard(skill('global', 'claude-code', { claudeSkillMasks: [{ scope: 'local', path: 'local/homo' }] }), true, mockDoc()));
    assert.ok(gagnant.some((p) => p.text === 'ℹ️ Masque la copie du projet'));

    const nonMasque = pillsOf(main.createItemCard(skill('local', 'claude-code', { claudeSkillHomonymNotMasked: true }), true, mockDoc()));
    const bNon = nonMasque.find((p) => p.text === '❔ Homonyme non masqué')!;
    assert.ok(bNon.title.includes('non vérifié'), bNon.title);

    const memePortee = pillsOf(main.createItemCard(skill('global', 'claude-code', { claudeSkillSameScopeHomonym: true }), true, mockDoc()));
    const bMeme = memePortee.find((p) => p.text === '❔ Homonyme de même portée')!;
    assert.strictEqual(bMeme.title, 'Claude Code liste-t-il les deux copies, ou une seule ? Non vérifié : les deux sont comptées.');

    const agy = pillsOf(main.createItemCard(skill('local', 'antigravity', { claudeSkillMaskedBy: { scope: 'global', path: 'g' }, claudeSkillMasks: [{ scope: 'local', path: 'l' }], claudeSkillHomonymNotMasked: true, claudeSkillSameScopeHomonym: true }), true, mockDoc()));
    assert.ok(!agy.some((p) => ['🙈 Masquée', 'ℹ️ Masque la copie du projet', '❔ Homonyme non masqué', '❔ Homonyme de même portée'].includes(p.text)), 'Aucune carte Antigravity ne reçoit ces badges');
  });

  test('20. Webview : le texte sur le chemin de fichier n\'apparaît plus pour Claude Code, et reste pour Antigravity', () => {
    const doublon = { hasDuplicate: true, duplicateScope: 'global', duplicatePath: 'g', isTwinEnabled: true, bothEnabled: true, isIdentical: true, wastedTokens: 0 };
    const titreDe = (targetTool: 'claude-code' | 'antigravity', type: 'soul' | 'rule' | 'skill') => {
      const item: ResourceItem = {
        id: 'x', name: 'x', description: 'X', type, scope: 'local', enabled: true, path: 'x', targetTool,
        isFolder: type === 'skill', charCount: 10, tokenCount: 4, lineCount: 2, metadata: { duplicateInfo: doublon as any },
      };
      let titre = '';
      const walk = (el: MockEl) => { if (el.className.includes('item-metrics-badge')) titre = el.title; el.children.forEach(walk); };
      walk(main.createItemCard(item, true, mockDoc()));
      return titre;
    };
    for (const type of ['soul', 'rule', 'skill'] as const) {
      const claude = titreDe('claude-code', type);
      assert.ok(!claude.includes('chemin de fichier'), `${type} Claude Code : ${claude}`);
      assert.ok(claude.includes('Contenu identique au doublon global.'), `${type} Claude Code : ${claude}`);
    }
    assert.ok(titreDe('antigravity', 'rule').includes('(la légère différence de taille affichée provient du chemin de fichier)'), 'Antigravity garde le texte');
  });

  test('21. Copie masquée et coupée : pas de badge de coupe ; la copie personnelle coupée le porte', async () => {
    // Les deux copies dépassent 1 536 caractères ; seule la copie personnelle est listée (CC25)
    const state = await homonymes('masque-coupe',
      skillMd({ name: 'homo', description: 'p'.repeat(1600) }),
      skillMd({ name: 'homo', description: 'q'.repeat(2000) }));
    const p = copieProjet(state);
    const g = copiePerso(state);
    assert.ok(p.metadata?.claudeSkillMaskedBy, 'La copie du projet est masquée');
    assert.strictEqual(p.tokenCount, 0);
    // La métadonnée de coupe reste posée par le scanner : c'est le webview qui écarte le badge
    assert.strictEqual(p.metadata?.claudeDescriptionOriginalLength, 2000);

    const pillsProjet = pillsOf(main.createItemCard(p, true, mockDoc()));
    assert.ok(pillsProjet.some((b) => b.text === '🙈 Masquée'), 'Badge « Masquée » présent');
    assert.ok(!pillsProjet.some((b) => b.text === '✂️ Description coupée'), 'Pas de badge de coupe sur une copie masquée, qui compte 0');

    const pillsPerso = pillsOf(main.createItemCard(g, true, mockDoc()));
    const coupe = pillsPerso.find((b) => b.text === '✂️ Description coupée');
    assert.ok(coupe, 'La copie personnelle coupée porte le badge');
    assert.ok(coupe!.title.includes((1600).toLocaleString('fr-FR')), coupe!.title);
  });
});
