import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';

// Simulation de l'environnement VS Code pour l'exécution des tests unitaires hors VS Code
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'vscode') {
    return 'vscode';
  }
  return origResolve.call(this, request, ...args);
};
const vscodeSimule = {
  window: {
    createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
    showInformationMessage: () => Promise.resolve(),
    showErrorMessage: () => Promise.resolve(),
    // La fenêtre de confirmation de la corbeille est acceptée
    showWarningMessage: () => Promise.resolve('🗑️ Supprimer définitivement'),
  },
  workspace: {
    workspaceFolders: [] as Array<{ uri: { fsPath: string } }>,
    getConfiguration: () => ({ get: (_key: string, def: any) => def }),
  },
  env: { appName: 'Antigravity IDE' },
  Uri: { file: (f: string) => ({ fsPath: f, scheme: 'file' }) },
  commands: { executeCommand: () => Promise.resolve() },
};
if (!require.cache['vscode']) {
  require.cache['vscode'] = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscodeSimule } as any;
}

import { OptionsBanc, ScenarioManager } from '../src/services/ScenarioManager';
import { LocalScanner } from '../src/services/LocalScanner';
import { DeleteService } from '../src/services/DeleteService';
import { ResourceItem } from '../src/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const main = require(path.resolve(__dirname, '../../src/webview/main.js'));

// Lot L2b, C2 : une fixture du banc d'essai se reconnaît à son contenu, jamais à un marqueur, à
// son nom ou à son seul chemin. Un vrai CLAUDE.md ne doit être ni présenté ni supprimé comme une fixture.
describe('Suite de Tests : reconnaissance des fixtures du banc d\'essai par leur contenu (L2b)', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  let tempBaseDir: string;
  let compteur = 0;

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'banc-essai-reconnaissance-'));
  });

  after(async () => {
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  async function creerEspace(): Promise<{ ws: string; home: string; opts: OptionsBanc }> {
    const base = path.join(tempBaseDir, `cas-${++compteur}`);
    const ws = path.join(base, 'projet');
    const home = path.join(base, 'home');
    await fs.promises.mkdir(home, { recursive: true });
    for (const outil of ['antigravity', 'claude-code']) {
      await fs.promises.cp(path.join(repoRoot, 'test', 'scenarios', outil), path.join(ws, 'test', 'scenarios', outil), {
        recursive: true,
      });
    }
    return { ws, home, opts: { dossierPersonnel: home, profilGlobal: path.join(home, '.gemini', 'config') } };
  }

  const ecrire = (fichier: string, contenu: string | Buffer) => {
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.writeFileSync(fichier, contenu);
    return fichier;
  };
  const source = (outil: string, rel: string) => fs.readFileSync(path.join(repoRoot, 'test', 'scenarios', outil, ...rel.split('/')));
  const element = (chemin: string, extra: Partial<ResourceItem> = {}): ResourceItem => ({
    id: path.basename(chemin),
    name: path.basename(chemin),
    description: '',
    type: 'rule',
    scope: 'local',
    enabled: true,
    path: chemin,
    targetTool: 'antigravity',
    isFolder: false,
    ...extra,
  });

  test('1. Sans manifeste : un fichier n\'est une fixture que s\'il est identique à sa source', async () => {
    const { ws, opts } = await creerEspace();
    const fixtures = ScenarioManager.reconnaitreFixtures(ws, opts);
    const estFixture = (chemin: string, extra?: Partial<ResourceItem>) =>
      ScenarioManager.isScenarioFixture(ws, element(chemin, extra), fixtures);

    const claudeMd = ecrire(path.join(ws, 'CLAUDE.md'), '# Vrai CLAUDE.md\n');
    assert.strictEqual(estFixture(claudeMd), false, 'Un vrai CLAUDE.md n\'est pas une fixture, malgré son chemin');

    const geminiMd = ecrire(path.join(ws, 'GEMINI.md'), '---\nscenario_fixture: true\nisScenarioFixture: true\n---\n# Vrai GEMINI.md\n');
    assert.strictEqual(
      estFixture(geminiMd, { metadata: { isScenarioFixture: true, scenario_fixture: true } }),
      false,
      'Un marqueur porté par le fichier ne suffit pas'
    );

    const doublon = ecrire(path.join(ws, '.agents', 'rules', 'rule-test-doublon.md'), '# Autre contenu\n');
    assert.strictEqual(estFixture(doublon, { id: 'rule-test-doublon', name: 'rule-test-doublon' }), false, 'Le nom ne suffit pas');

    ecrire(claudeMd, source('claude-code', 'CLAUDE.md'));
    ecrire(geminiMd, source('antigravity', 'GEMINI.md').toString('utf8').replace(/\n/g, '\r\n'));
    assert.strictEqual(estFixture(claudeMd), true, 'Une copie de la source est une fixture');
    assert.strictEqual(estFixture(geminiMd), true, 'Fins de ligne normalisées sans manifeste');
    assert.strictEqual(estFixture(path.join(ws, 'absent.md')), false);
    assert.strictEqual(ScenarioManager.isScenarioFixture('', element(claudeMd)), false, 'Sans espace de travail, rien n\'est une fixture');
  });

  test('2. Après un déploiement : l\'empreinte du manifeste fait foi, bascules comprises', async () => {
    const { ws, home, opts } = await creerEspace();
    await ScenarioManager.deploy(ws, 'all', opts);
    const reconnaitre = () => ScenarioManager.reconnaitreFixtures(ws, opts);

    const regle = path.join(ws, '.agents', 'rules', '02-rule-perm-standard-always-on.md');
    assert.strictEqual(reconnaitre().fichier(regle), true);
    fs.renameSync(regle, `${regle}.disabled`);
    assert.strictEqual(reconnaitre().fichier(`${regle}.disabled`), true, 'Fixture désactivée par bascule');
    const desactivee = path.join(ws, '.agents', 'rules', '07-rule-disabled-suffix.md');
    fs.renameSync(`${desactivee}.disabled`, desactivee);
    assert.strictEqual(reconnaitre().fichier(desactivee), true, 'Fixture activée par bascule');

    fs.appendFileSync(`${regle}.disabled`, '\nModifiée.\n');
    assert.strictEqual(reconnaitre().fichier(`${regle}.disabled`), false, 'Une fixture modifiée n\'est plus une fixture');

    const doublonGlobal = path.join(home, '.gemini', 'config', 'rules', 'rule-test-doublon.md');
    assert.strictEqual(reconnaitre().fichier(doublonGlobal), true, 'Règle doublon déployée dans le profil global');
    fs.writeFileSync(doublonGlobal, '# Remplacée par une vraie règle\n');
    assert.strictEqual(reconnaitre().fichier(doublonGlobal), false);

    await ScenarioManager.clean(ws, { ...opts, ecraser: true });
  });

  test('3. Un dossier de skill n\'est une fixture que si tous ses fichiers en sont', async () => {
    const { ws, opts } = await creerEspace();
    await ScenarioManager.deploy(ws, 'antigravity', opts);
    const skill = path.join(ws, '.agents', 'skills', 'skill-with-annexes');
    const dossier = (p: string) => ScenarioManager.isScenarioFixture(ws, element(p, { type: 'skill', isFolder: true }), ScenarioManager.reconnaitreFixtures(ws, opts));

    assert.strictEqual(dossier(skill), true);
    const ajout = ecrire(path.join(skill, 'scripts', 'mon-script.ps1'), 'Write-Output "à moi"\n');
    assert.strictEqual(dossier(skill), false, 'Un fichier ajouté par l\'utilisateur protège le dossier');
    fs.rmSync(ajout);
    fs.mkdirSync(path.join(ws, '.agents', 'skills', 'vide'), { recursive: true });
    assert.strictEqual(dossier(path.join(ws, '.agents', 'skills', 'vide')), false, 'Un dossier vide n\'est pas une fixture');

    await ScenarioManager.clean(ws, opts);
  });

  test('4. LocalScanner pose toujours l\'indicateur calculé, qui remplace le marqueur du frontmatter', async () => {
    const { ws } = await creerEspace();
    const vraie = ecrire(path.join(ws, '.agents', 'rules', 'ma-regle.md'), '---\ntrigger: always_on\nisScenarioFixture: true\n---\n# Vraie règle\n');
    const fixture = ecrire(path.join(ws, '.agents', 'rules', '03-rule-cond-trigger-glob.md'), source('antigravity', '.agents/rules/03-rule-cond-trigger-glob.md'));
    const geminiMd = ecrire(path.join(ws, 'GEMINI.md'), '---\nscenario_fixture: true\n---\n# Vrai GEMINI.md\n');

    const { items } = await LocalScanner.scan({
      hasWorkspace: true,
      workspacePath: ws,
      tool: 'antigravity',
      agentsDir: '.agents',
      claudeDir: null,
      hasClaudeMd: false,
    });
    const indicateur = (p: string) => items.find((i) => i.path === p)?.metadata?.isScenarioFixture;
    assert.strictEqual(indicateur(vraie), false, 'Le frontmatter isScenarioFixture: true est remplacé par false');
    assert.strictEqual(indicateur(geminiMd), false);
    assert.strictEqual(indicateur(fixture), true);
  });

  test('5. La carte n\'affiche le badge « Test Scénario » que pour l\'indicateur calculé', () => {
    const doc = { createElement: (tag: string) => creerElement(tag) };
    const badge = (metadata: Record<string, unknown>) =>
      descendants(main.createItemCard(element('/projet/GEMINI.md', { metadata } as Partial<ResourceItem>), true, doc)).some((e) =>
        e.className.includes('pill-fixture')
      );
    assert.strictEqual(badge({ scenario_fixture: true, isScenarioFixture: false }), false, 'Marqueur du frontmatter seul : pas de badge');
    assert.strictEqual(badge({ scenario_fixture: 'true' }), false);
    assert.strictEqual(badge({ isScenarioFixture: true }), true);
  });

  test('6. La corbeille refuse un vrai CLAUDE.md marqué comme fixture, et accepte une vraie fixture', async () => {
    const { ws } = await creerEspace();
    vscodeSimule.workspace.workspaceFolders = [{ uri: { fsPath: ws } }];
    try {
      // Attaque rejouée : métadonnées et frontmatter se déclarent fixture, le contenu n'en est pas une
      const claudeMd = ecrire(path.join(ws, 'CLAUDE.md'), '---\nisScenarioFixture: true\n---\n# Vrai CLAUDE.md\n');
      const refus = await DeleteService.deleteResource(
        element(claudeMd, {
          type: 'soul',
          targetTool: 'claude-code',
          syncStatus: 'local_only',
          metadata: { isScenarioFixture: true, scenario_fixture: true },
        })
      );
      assert.strictEqual(refus.success, false);
      assert.match(refus.error ?? '', /Catalogue NAS/);
      assert.ok(fs.existsSync(claudeMd), 'Le vrai CLAUDE.md n\'est pas supprimé');

      const fixture = ecrire(path.join(ws, '.agents', 'rules', '03-rule-cond-trigger-glob.md'), source('antigravity', '.agents/rules/03-rule-cond-trigger-glob.md'));
      await DeleteService.deleteResource(element(fixture, { syncStatus: 'local_only' }));
      assert.ok(!fs.existsSync(fixture), 'Une copie de fixture reste supprimable sans copie dans le NAS');
    } finally {
      vscodeSimule.workspace.workspaceFolders = [];
    }
  });
});

interface ElementSimule {
  tagName: string;
  className: string;
  innerHTML: string;
  textContent: string;
  title: string;
  children: ElementSimule[];
  style: Record<string, string>;
  appendChild: (child: ElementSimule) => ElementSimule;
  addEventListener: () => void;
  classList: { add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean };
}

function creerElement(tag: string): ElementSimule {
  const classes = new Set<string>();
  const el: ElementSimule = {
    tagName: tag.toUpperCase(),
    className: '',
    innerHTML: '',
    textContent: '',
    title: '',
    children: [],
    style: {},
    appendChild(c: ElementSimule) {
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
}

const descendants = (el: ElementSimule): ElementSimule[] => [el, ...el.children.flatMap(descendants)];
