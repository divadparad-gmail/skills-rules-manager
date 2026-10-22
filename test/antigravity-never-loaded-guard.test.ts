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
if (!require.cache['vscode']) {
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
        getConfiguration: () => ({ get: (_key: string, def: any) => def }),
      },
      env: { appName: 'Antigravity IDE' },
      Uri: { file: (f: string) => ({ fsPath: f, scheme: 'file' }) },
      commands: { executeCommand: () => Promise.resolve() },
    },
  } as any;
}

import { LocalScanner } from '../src/services/LocalScanner';
import { isBulkToggleable, NEVER_LOADED_REFUSAL, ToggleManager } from '../src/services/ToggleManager';
import { DeleteService } from '../src/services/DeleteService';
import { ResourceItem, WorkspaceContext } from '../src/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const main = require(path.resolve(__dirname, '../../src/webview/main.js'));

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

const descendants = (el: MockEl): MockEl[] => [el, ...el.children.flatMap(descendants)];

const permanentRule = '---\ntrigger: always_on\n---\nCorps de la règle\n';

// R1 : une règle de sous-dossier n'a aucun effet sous Antigravity, activée ou non
describe('Suite de Tests : règles de sous-dossier jamais chargées (bascules et suppression)', () => {
  let dir: string;
  let items: ResourceItem[];
  const nestedFiles = ['sous/.agents/rules/imbriquee.md', 'sous/profond/.agents/rules/fixture.md'];

  const workspace = (): WorkspaceContext => ({
    hasWorkspace: true,
    workspacePath: dir,
    tool: 'antigravity',
    agentsDir: '.agents',
    claudeDir: null,
    hasClaudeMd: false,
  });

  const nestedItems = () => items.filter((i) => i.metadata?.antigravityStatus === 'never-loaded');

  before(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-r1-garde-'));
    for (const relative of ['.agents/rules/racine.md', ...nestedFiles]) {
      const file = path.join(dir, relative);
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, permanentRule, 'utf8');
    }
    items = (await LocalScanner.scan(workspace())).items;
  });

  after(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  test('1. Les règles de sous-dossier sont « never-loaded » et exclues des bascules en masse', () => {
    assert.strictEqual(nestedItems().length, nestedFiles.length);
    assert.ok(nestedItems().every((i) => !isBulkToggleable(i)));
    assert.ok(items.filter((i) => i.type === 'rule' && i.metadata?.antigravityStatus !== 'never-loaded').every(isBulkToggleable));
  });

  test('2. Un OFF en masse des règles locales ne renomme aucun fichier de sous-dossier', async () => {
    const res = await ToggleManager.disableAllRules(items, 'local');
    assert.strictEqual(res.modifiedCount, 1, 'Seule la règle de la racine est désactivée');
    assert.ok(fs.existsSync(path.join(dir, '.agents/rules/racine.md.disabled')));
    for (const relative of nestedFiles) {
      assert.ok(fs.existsSync(path.join(dir, relative)), `${relative} est intact`);
      assert.ok(!fs.existsSync(path.join(dir, `${relative}.disabled`)), `${relative} n'est pas renommé`);
    }

    // Bascule intelligente : le total ne compte que la règle de la racine
    const toggled = await ToggleManager.toggleAllRules((await LocalScanner.scan(workspace())).items, 'local');
    assert.strictEqual(toggled.totalItems, 1);
    assert.ok(fs.existsSync(path.join(dir, '.agents/rules/racine.md')));
    for (const relative of nestedFiles) assert.ok(fs.existsSync(path.join(dir, relative)));
  });

  test('3. ToggleManager refuse de basculer une règle jamais chargée, même si la demande arrive', async () => {
    const nested = nestedItems()[0];
    const res = await ToggleManager.toggleItem(nested, false);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, NEVER_LOADED_REFUSAL);
    assert.ok(fs.existsSync(nested.path), 'Le fichier n\'est pas renommé');
    assert.ok(!fs.existsSync(`${nested.path}.disabled`));
  });

  test('4. La suppression refuse une règle jamais chargée, même marquée comme fixture synchronisée', async () => {
    const nested = { ...nestedItems()[0], syncStatus: 'synced' as const };
    nested.metadata = { ...nested.metadata, isScenarioFixture: true };
    const res = await DeleteService.deleteResource(nested);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, NEVER_LOADED_REFUSAL);
    assert.ok(fs.existsSync(nested.path), 'Le fichier n\'est pas supprimé');
  });

  test('5. Le compteur RÈGLES de la colonne Local n\'inclut pas les règles de sous-dossier', () => {
    const nodes: Record<string, MockEl> = {};
    const doc = { createElement, getElementById: (id: string) => (id.startsWith('count') ? (nodes[id] = nodes[id] ?? createElement('span')) : null) };
    const localItems = items.map((i) => ({ ...i, enabled: true }));
    main.updateBulkControl('local', 'rule', localItems, doc);
    assert.strictEqual(nodes.countRuleLocal.textContent, '1/1');
  });

  test('6. La carte d\'une règle jamais chargée affiche « 🚫 Sans effet », sans interrupteur ni corbeille', () => {
    const card = main.createItemCard(nestedItems()[0], true, { createElement });
    const all = descendants(card);
    assert.ok(all.some((el) => el.className === 'soul-locked-badge' && el.innerHTML.includes('Sans effet') && el.title.includes('ne la charge jamais')));
    assert.ok(!all.some((el) => el.tagName === 'INPUT'), 'Aucun interrupteur');
    assert.ok(!all.some((el) => el.className.includes('btn-trash')), 'Aucune corbeille');

    const rootCard = main.createItemCard(items.find((i) => i.id.includes('racine'))!, true, { createElement });
    assert.ok(descendants(rootCard).some((el) => el.tagName === 'INPUT'), 'La règle de la racine garde son interrupteur');
  });
});
