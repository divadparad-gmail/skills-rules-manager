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

import {
  HOOK_DYNAMIC_EVENTS,
  HOOK_EVENTS,
  HOOK_EVENTS_BUILTIN_DOC,
  HOOK_EVENTS_WEB_DOC_ONLY,
  parseHooksConfig,
} from '../src/antigravity/behavior';
import { readAntigravityHooks, readHooksFile } from '../src/services/antigravityHooks';
import { computeAntigravityDynamicCosts } from '../src/services/antigravityDynamicCosts';
import { LocalScanner } from '../src/services/LocalScanner';
import { antigravityHookRefusal, DeployFileSystemPort, MultiTargetDeployService } from '../src/deploy/MultiTargetDeployService';
import { DeployReviewPort, ReviewableResource, reviewAndDeploy } from '../src/deploy/deployReview';
import { NasPathService } from '../src/settings/NasPathService';
import { ResourceItem } from '../src/types';

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

const mockDoc = (byId: Record<string, MockEl> = {}) => {
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
  return { createElement, getElementById: (id: string) => (byId[id] = byId[id] ?? createElement('div')) };
};

const allText = (el: MockEl): string =>
  [el.textContent || el.innerHTML.replace(/<[^>]+>/g, ''), ...el.children.map(allText)].filter(Boolean).join('\n');

/** Système de fichiers en mémoire : aucune écriture réelle, et on voit tout ce qui serait écrit. */
class MemoryFileSystem implements DeployFileSystemPort {
  public readonly files = new Map<string, string>();
  public exists(targetPath: string): boolean {
    return this.files.has(targetPath);
  }
  public async mkdir(): Promise<void> {}
  public async writeFile(targetPath: string, content: string): Promise<void> {
    this.files.set(targetPath, content);
  }
}

/** Format documenté par le skill intégré agy-customizations (docs/hooks.md). */
const DOCUMENTED_HOOKS = {
  'lint-checker': {
    PostToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: './scripts/lint.sh', timeout: 10 }, { command: './scripts/b.sh' }] }],
  },
  'safety-gate': {
    enabled: false,
    PreToolUse: [{ matcher: 'run_command', hooks: [{ command: './scripts/safety-check.sh' }] }],
  },
  reminder: {
    PreInvocation: [{ type: 'command', command: './scripts/reminder.sh' }],
    SessionStart: [{ command: './scripts/start.sh' }],
    Inconnu: [{ command: './x.sh' }],
  },
};

// Hooks, déploiement Discovery et workflows : src/antigravity/behavior.ts (lot A3)
describe('Suite de Tests : hooks et workflows d\'Antigravity (lot A3b)', () => {
  let tempBaseDir: string;

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-a3b-'));
  });

  after(async () => {
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  const writeFile = async (file: string, content: string) => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, content, 'utf8');
  };

  test('1. Événements : 5 dans la documentation intégrée à l\'IDE 2.5.5, SessionStart en plus dans la documentation web', () => {
    assert.deepStrictEqual([...HOOK_EVENTS_BUILTIN_DOC], ['PreToolUse', 'PostToolUse', 'PreInvocation', 'PostInvocation', 'Stop']);
    assert.deepStrictEqual([...HOOK_EVENTS_WEB_DOC_ONLY], ['SessionStart']);
    assert.strictEqual(HOOK_EVENTS.length, 6);
    assert.deepStrictEqual([...HOOK_DYNAMIC_EVENTS], ['SessionStart', 'PreInvocation', 'PostInvocation']);
  });

  test('2. Format documenté : nom, événements, gestionnaires, enabled, clés inconnues et coût dynamique', () => {
    const parsed = parseHooksConfig(DOCUMENTED_HOOKS);
    assert.strictEqual(parsed.status, 'ok');
    if (parsed.status !== 'ok') return;
    assert.deepStrictEqual(parsed.hooks, [
      { name: 'lint-checker', enabled: true, events: ['PostToolUse'], unknownKeys: [], handlerCount: 2, dynamicEvents: [] },
      { name: 'safety-gate', enabled: false, events: ['PreToolUse'], unknownKeys: [], handlerCount: 1, dynamicEvents: [] },
      { name: 'reminder', enabled: true, events: ['PreInvocation', 'SessionStart'], unknownKeys: ['Inconnu'], handlerCount: 2, dynamicEvents: ['PreInvocation', 'SessionStart'] },
    ]);
  });

  test('3. Formats non reconnus : tableau sous « hooks » (fichier de ce dépôt), valeur non objet, racine non objet', () => {
    const projectFormat = { hooks: [{ event: 'PreToolUse', matcher: { tool: 'run_command' }, action: { decision: 'force_ask' } }] };
    assert.deepStrictEqual(parseHooksConfig(projectFormat), { status: 'unrecognized-format' });
    assert.deepStrictEqual(parseHooksConfig({ a: 'texte' }), { status: 'unrecognized-format' });
    assert.deepStrictEqual(parseHooksConfig([DOCUMENTED_HOOKS]), { status: 'unrecognized-format' });
    assert.deepStrictEqual(parseHooksConfig(null), { status: 'unrecognized-format' });
    assert.deepStrictEqual(parseHooksConfig({}), { status: 'ok', hooks: [] });
  });

  test('4. Lecture des fichiers : absent, JSON invalide, BOM, format non reconnu ; jamais d\'exécution ni de commande transmise', async () => {
    const dir = path.join(tempBaseDir, 'lecture');
    const proof = path.join(dir, 'PREUVE-EXECUTION');
    const command = `node -e "require('fs').writeFileSync(${JSON.stringify(proof)}, 'x')"`;
    await writeFile(path.join(dir, 'ok.json'), `﻿${JSON.stringify({ espion: { SessionStart: [{ command }], PreInvocation: [{ command }] } })}`);
    await writeFile(path.join(dir, 'casse.json'), '{ "a": ');
    await writeFile(path.join(dir, 'tableau.json'), JSON.stringify({ hooks: [] }));

    assert.strictEqual((await readHooksFile(path.join(dir, 'absent.json'), 'local')).status, 'absent');
    assert.strictEqual((await readHooksFile(path.join(dir, 'casse.json'), 'local')).status, 'invalid-json');
    assert.strictEqual((await readHooksFile(path.join(dir, 'tableau.json'), 'local')).status, 'unrecognized-format');
    const ok = await readHooksFile(path.join(dir, 'ok.json'), 'global');
    assert.strictEqual(ok.status, 'ok');
    assert.strictEqual(ok.scope, 'global');
    assert.deepStrictEqual(ok.hooks.map((hook) => hook.name), ['espion']);

    const costs = computeAntigravityDynamicCosts([], [ok]);
    const nodes: Record<string, MockEl> = {};
    main.renderDynamicCosts({ workspace: { tool: 'antigravity' }, stats: { dynamicCosts: costs } }, mockDoc(nodes));
    assert.ok(!JSON.stringify(costs).includes('writeFileSync'), 'Les commandes ne sont pas transmises au webview');
    assert.ok(!fs.existsSync(proof), 'Aucun hook n\'est exécuté');
  });

  test('5. Emplacements : .agents/hooks.json du projet, puis hooks.json du dossier global ~/.gemini/config', async () => {
    const workspace = path.join(tempBaseDir, 'emplacements', 'projet');
    const globalConfig = path.join(tempBaseDir, 'emplacements', 'gemini', 'config');
    await writeFile(path.join(workspace, '.agents', 'hooks.json'), JSON.stringify(DOCUMENTED_HOOKS));
    const readings = await readAntigravityHooks(workspace, globalConfig);
    assert.deepStrictEqual(readings.map((r) => [r.scope, path.relative(tempBaseDir, r.path), r.status]), [
      ['local', path.join('emplacements', 'projet', '.agents', 'hooks.json'), 'ok'],
      ['global', path.join('emplacements', 'gemini', 'config', 'hooks.json'), 'absent'],
    ]);
    assert.strictEqual((await readAntigravityHooks(null, globalConfig)).length, 1, 'Sans projet ouvert : le fichier global seul');
  });

  test('6. Panneau : hooks listés, avertissements SessionStart et PreInvocation, aucun pour un hook désactivé ; 0 au démarrage', () => {
    const parsed = parseHooksConfig(DOCUMENTED_HOOKS);
    if (parsed.status !== 'ok') throw new Error('format documenté non reconnu');
    const costs = computeAntigravityDynamicCosts([], [
      { scope: 'local', path: '/projet/.agents/hooks.json', status: 'unrecognized-format', hooks: [] },
      { scope: 'global', path: '/home/.gemini/config/hooks.json', status: 'ok', hooks: parsed.hooks },
    ]);
    const nodes: Record<string, MockEl> = {};
    main.renderDynamicCosts({ workspace: { tool: 'antigravity' }, stats: { dynamicCosts: costs } }, mockDoc(nodes));
    assert.strictEqual(nodes.dynamicCostsSummary.textContent, '⏱️ Coûts dynamiques : 0 motif glob · 2 hooks · ❔ hooks.json');
    const text = allText(nodes.dynamicCostsBody);
    assert.ok(text.includes('Hooks (0 token au démarrage'));
    assert.ok(text.includes('❔ Projet, .agents/hooks.json : format non reconnu'));
    assert.ok(text.includes('Global, ~/.gemini/config/hooks.json : 3 hooks'));
    assert.ok(text.includes('lint-checker : PostToolUse (2 gestionnaires)'));
    assert.ok(text.includes('safety-gate : PreToolUse (1 gestionnaire) · désactivé'));
    assert.ok(text.includes('clés inconnues : Inconnu'));
    assert.ok(text.includes('⚠️ reminder : coût dynamique, ce que le script injecte à chaque appel au modèle (PreInvocation) ; une fois, au démarrage de la session (SessionStart : 📄 documentation web ; absent de la documentation intégrée à l\'IDE 2.5.5 ❔). Non mesurable sans exécution.'));
    assert.ok(!text.includes('⚠️ safety-gate'), 'Un hook désactivé ou sans événement dynamique n\'a pas d\'avertissement');
    assert.ok(!text.includes('⚠️ lint-checker'));
  });

  const hookResource: ReviewableResource = {
    id: 'hub:garde-fou',
    name: 'Garde-fou',
    type: 'hooks',
    manifest: '---\nname: garde-fou\ndescription: Hook\n---\nrm -rf /\n',
    registryId: 'hub',
    registryName: 'Hub interne',
  };

  const reviewUi = () => {
    const calls = { shown: 0, confirmed: 0, errors: [] as string[] };
    const ui: DeployReviewPort = {
      showManifest: async () => { calls.shown++; },
      confirmInstall: async () => { calls.confirmed++; return true; },
      resolveConflict: async () => undefined,
      report: (level, message) => { if (level === 'error') calls.errors.push(message); },
    };
    return { calls, ui };
  };

  test('7. Discovery : un hook destiné à Antigravity est refusé avant l\'aperçu, sans rien écrire', async () => {
    const files = new MemoryFileSystem();
    const service = new MultiTargetDeployService({} as NasPathService, files);
    const { calls, ui } = reviewUi();
    const result = await reviewAndDeploy(service, hookResource, {
      target: 'local',
      conflictPolicy: 'overwrite',
      context: { runtime: 'antigravity', workspaceRoot: path.join('/projet'), agentsDirName: '.agents' },
    }, ui);

    assert.strictEqual(result?.success, false);
    assert.match(result?.error ?? '', /Le hook « Garde-fou » n'a pas été installé : Antigravity ne lit pas les hooks sous forme de fichier \.md/);
    assert.match(result?.error ?? '', /\.agents\/hooks\.json et lance des commandes shell/);
    assert.deepStrictEqual(calls.errors, [result?.error]);
    assert.strictEqual(calls.shown, 0, 'Aucun aperçu');
    assert.strictEqual(calls.confirmed, 0, 'Aucune confirmation demandée');
    assert.strictEqual(files.files.size, 0, 'Rien n\'est écrit');
  });

  test('8. Défense en profondeur : deploy() refuse aussi un hook vers Antigravity ; Claude Code et les skills inchangés', async () => {
    const files = new MemoryFileSystem();
    const service = new MultiTargetDeployService({} as NasPathService, files);
    const direct = await service.deploy(
      { skillId: 'garde-fou', name: 'Garde-fou', type: 'hooks', manifest: hookResource.manifest, target: 'local', conflictPolicy: 'overwrite' },
      { runtime: 'antigravity', workspaceRoot: path.join('/projet'), agentsDirName: '.agents' }
    );
    assert.strictEqual(direct.success, false);
    assert.strictEqual(files.files.size, 0);

    assert.strictEqual(antigravityHookRefusal('claude-code', 'hooks', 'x'), null, 'Claude Code : comportement inchangé');
    assert.strictEqual(antigravityHookRefusal('antigravity', 'skills', 'x'), null);
    assert.strictEqual(antigravityHookRefusal('antigravity', 'rules', 'x'), null);

    const { calls, ui } = reviewUi();
    const claude = await reviewAndDeploy(service, hookResource, {
      target: 'local',
      conflictPolicy: 'overwrite',
      context: { runtime: 'claude-code', workspaceRoot: path.join('/projet'), agentsDirName: null },
    }, ui);
    assert.strictEqual(calls.shown, 1, 'Claude Code : l\'aperçu est toujours montré');
    assert.strictEqual(claude?.success, true);
  });

  test('9. Workflows wf-* : des skills, comptés dans la jauge, sans ⛔, avec l\'infobulle explicative', async () => {
    const dir = path.join(tempBaseDir, 'workflows');
    await writeFile(path.join(dir, '.agents', 'skills', 'wf-deploy', 'SKILL.md'), '---\nname: wf-deploy\ndescription: Déploie le projet\n---\nÉtapes.\n');
    await writeFile(path.join(dir, '.agents', 'skills', 'skill-a', 'SKILL.md'), '---\nname: skill-a\ndescription: Un skill\n---\nCorps.\n');
    const result = await LocalScanner.scan({ hasWorkspace: true, workspacePath: dir, tool: 'antigravity', agentsDir: '.agents', claudeDir: null, hasClaudeMd: false });
    const workflow = result.items.find((i) => i.id === 'wf-deploy')!;
    assert.strictEqual(workflow.type, 'workflow');
    assert.strictEqual(workflow.enabled, true);
    assert.strictEqual(workflow.metadata?.antigravityStatus, undefined, 'Aucun statut ⛔');
    assert.strictEqual(result.skillsStat.activeCount, 2);
    const skill = result.items.find((i) => i.id === 'skill-a')!;
    assert.strictEqual(result.skillsStat.tokenCount, (workflow.tokenCount ?? 0) + (skill.tokenCount ?? 0), 'Le skill wf-* reste compté');

    const typeBadge = (item: ResourceItem) => {
      const card = main.createItemCard(item, true, mockDoc());
      const find = (el: MockEl): MockEl | null =>
        el.className.includes('item-type-badge') ? el : el.children.map(find).find(Boolean) ?? null;
      return find(card)!;
    };
    assert.match(typeBadge(workflow).title, /Skill dont le nom commence par wf- : Antigravity le liste comme un skill/);
    assert.match(typeBadge(workflow).title, /format retiré le 19 octobre 2026/);
    assert.strictEqual(typeBadge({ ...workflow, targetTool: 'claude-code' }).title, '', 'Claude Code : aucune infobulle ajoutée');
  });
});
