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

import { CLAUDE_SKILL_DESCRIPTION_MAX_CHARS, claudeSkillListing, claudeSkillName } from '../src/claude/skillListing';
import { extractFrontmatter } from '../src/utils/frontmatter';
import { countTokens } from '../src/utils/tokenizer';
import { LocalScanner } from '../src/services/LocalScanner';
import { GlobalScanner } from '../src/services/GlobalScanner';
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
});
