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

import { ANTIGRAVITY_PROFILES, splitRuleBody } from '../src/antigravity/behavior';
import { resolveAntigravityProfile } from '../src/antigravity/behaviorProfile';
import { LocalScanner } from '../src/services/LocalScanner';
import { GlobalScanner } from '../src/services/GlobalScanner';
import { StateManager } from '../src/services/StateManager';
import { DuplicateService } from '../src/services/DuplicateService';
import { DeleteService } from '../src/services/DeleteService';
import { isBulkToggleable, markdownWorkflowRefusal, ToggleManager } from '../src/services/ToggleManager';
import { buildAntigravitySkillItem } from '../src/services/antigravitySkillItem';
import { buildAntigravityWorkflowItem, markdownWorkflowPersonalizationTokens } from '../src/services/antigravityWorkflowItem';
import { countTokens } from '../src/utils/tokenizer';
import { ResourceItem, WorkspaceContext } from '../src/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const main = require(path.resolve(__dirname, '../../src/webview/main.js'));

const P255 = ANTIGRAVITY_PROFILES['2.5.5'];
const P260 = ANTIGRAVITY_PROFILES['2.6.0'];

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

/** Éléments d'une carte dont la classe contient `className`, avec leur texte et leur infobulle. */
const findAll = (root: MockEl, className: string): Array<{ text: string; title: string }> => {
  const found: Array<{ text: string; title: string }> = [];
  const walk = (el: MockEl) => {
    if (el.className.includes(className)) {
      found.push({ text: el.textContent || el.innerHTML.replace(/<[^>]+>/g, ''), title: el.title });
    }
    el.children.forEach(walk);
  };
  walk(root);
  return found;
};

const workspaceFor = (dir: string): WorkspaceContext => ({
  hasWorkspace: true,
  workspacePath: dir,
  tool: 'antigravity',
  agentsDir: '.agents',
  claudeDir: null,
  hasClaudeMd: false,
});

// Lot LW-2 : workflows Markdown en profil Antigravity IDE 2.6.0 (sonde du 2026-11-02, Antigravity IDE 2.6.0)
describe('Suite de Tests : workflows Markdown d\'Antigravity IDE 2.6.0 (lot LW-2)', () => {
  let tempBaseDir: string;

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-lw2-'));
  });

  after(async () => {
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  const writeFile = async (file: string, content: string) => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, content, 'utf8');
  };

  const workflowContent = (description: string, body = 'Étape 1.\nÉtape 2.\n') => `---\ndescription: ${description}\n---\n${body}`;

  test('1. Profil 2.5.5 : l\'infobulle « ✂️ Tronquée » reste inchangée (texte complet, sans note de coupe)', async () => {
    const dir = path.join(tempBaseDir, 'tronquee-255');
    const lines = Array.from({ length: 300 }, (_, i) => `${i} ${'x'.repeat(95)}`).join('\n');
    await writeFile(path.join(dir, '.agents', 'rules', 'longue.md'), `---\ntrigger: always_on\ndescription: Longue\n---\n${lines}\n`);
    const scan = await LocalScanner.scan(workspaceFor(dir), P255);
    const item = scan.items.find((i) => i.id === 'longue')!;
    const truncated = item.metadata?.truncatedBytes ?? 0;
    const lost = item.metadata?.lostTokens ?? 0;
    assert.ok(truncated > 0 && lost > 0, 'La règle dépasse 24 000 octets de corps');
    assert.strictEqual(item.metadata?.truncationRule, undefined, '2.5.5 : coupe à l\'octet, sans truncationRule');

    const pill = findAll(main.createItemCard(item, true, mockDoc()), 'item-badge-pill').find((p) => p.text === '✂️ Tronquée')!;
    assert.strictEqual(
      pill.title,
      `Antigravity coupe le corps de ce fichier à 24 000 octets (frontmatter non compté, inclusions @[label](path) comprises (documentation)) : ${truncated.toLocaleString('fr-FR')} octets coupés, soit ≈ ${lost.toLocaleString('fr-FR')} tokens jamais lus par l'agent.\nLe coût affiché ne compte que la partie gardée.`
    );
  });

  test('2. Profil 2.6.0, projet : .agents/workflows/ et variantes lus ; 0 au démarrage, nom et description dans « Other », corps à l\'invocation ; skills inchangés', async () => {
    const dir = path.join(tempBaseDir, 'projet-260');
    const deploy = path.join(dir, '.agents', 'workflows', 'deploy.md');
    await writeFile(deploy, workflowContent('Déploie le projet'));
    await writeFile(path.join(dir, '_agents', 'workflows', 'variante.md'), workflowContent('Variante'));
    await writeFile(path.join(dir, '.agents', 'workflows', 'notes.txt'), 'Pas un workflow');
    await writeFile(path.join(dir, '.agents', 'skills', 'skill-a', 'SKILL.md'), '---\nname: skill-a\ndescription: Un skill\n---\nCorps.\n');
    await writeFile(path.join(dir, '.agents', 'skills', 'wf-deploy', 'SKILL.md'), '---\nname: wf-deploy\ndescription: Skill wf\n---\nCorps.\n');

    const scan = await LocalScanner.scan(workspaceFor(dir), P260);
    const wf = scan.items.find((i) => i.id === '.agents/workflows/deploy')!;
    assert.deepStrictEqual(
      [wf.type, wf.name, wf.description, wf.scope, wf.enabled, wf.isFolder, wf.path],
      ['workflow', 'deploy', 'Déploie le projet', 'local', true, false, deploy]
    );
    assert.strictEqual(wf.metadata?.markdownWorkflow, true);
    assert.strictEqual(wf.metadata?.markdownWorkflowSource, 'workspace');
    assert.strictEqual(wf.metadata?.locked, true, 'Lecture seule');
    assert.strictEqual(wf.metadata?.bootTokenCount, 0, 'Absent du prompt système');
    assert.strictEqual(wf.tokenCount, countTokens(splitRuleBody(await fs.promises.readFile(deploy, 'utf8')).body), 'Corps sans frontmatter');
    assert.strictEqual(wf.metadata?.personalizationTokenCount, countTokens('deploy') + countTokens('Déploie le projet'));
    assert.strictEqual(wf.metadata?.antigravityStatus, undefined);

    const variante = scan.items.find((i) => i.id === '_agents/workflows/variante')!;
    assert.strictEqual(variante.metadata?.markdownWorkflowSource, 'workspace-variant');
    assert.ok(!scan.items.some((i) => i.id.includes('notes')), 'Seuls les fichiers .md sont des workflows');

    // Les workflows Markdown ne sont pas des skills ; le skill wf-* reste un skill compté
    const skills = scan.items.filter((i) => !i.metadata?.markdownWorkflow && (i.type === 'skill' || i.type === 'workflow'));
    assert.strictEqual(skills.length, 2);
    assert.strictEqual(scan.skillsStat.totalCount, 2);
    assert.strictEqual(scan.skillsStat.tokenCount, skills.reduce((sum, i) => sum + (i.tokenCount ?? 0), 0));

    // Variantes lues même sans .agents/
    const sansAgents = path.join(tempBaseDir, 'sans-agents-260');
    await writeFile(path.join(sansAgents, '_agent', 'workflows', 'seul.md'), workflowContent('Seul'));
    const scanSans = await LocalScanner.scan({ ...workspaceFor(sansAgents), agentsDir: null }, P260);
    assert.strictEqual(scanSans.items.find((i) => i.id === '_agent/workflows/seul')?.metadata?.markdownWorkflowSource, 'workspace-variant');
  });

  test('3. Profil 2.6.0, global : global_workflows lu ; config/workflows, antigravity-ide et antigravity/global_workflows sans effet et non comptés', async () => {
    const gemini = path.join(tempBaseDir, 'global-260', '.gemini');
    const config = path.join(gemini, 'config');
    await writeFile(path.join(config, 'global_workflows', 'global.md'), workflowContent('Global'));
    await writeFile(path.join(config, 'workflows', 'ancien.md'), workflowContent('Ancien'));
    await writeFile(path.join(gemini, 'antigravity-ide', 'global_workflows', 'ide.md'), workflowContent('IDE'));
    await writeFile(path.join(gemini, 'antigravity', 'global_workflows', 'ag.md'), workflowContent('AG'));

    const scan = await GlobalScanner.scan(config, 'antigravity', P260);
    const byId = (id: string) => scan.items.find((i) => i.id === id)!;
    const global = byId('global_workflows/global');
    assert.strictEqual(global.metadata?.markdownWorkflowSource, 'global');
    assert.strictEqual(global.metadata?.antigravityStatus, undefined);
    for (const id of ['config/workflows/ancien', 'antigravity-ide/global_workflows/ide', 'antigravity/global_workflows/ag']) {
      const ignored = byId(id);
      assert.strictEqual(ignored.metadata?.markdownWorkflowSource, 'ignored', id);
      assert.strictEqual(ignored.metadata?.antigravityStatus, 'not-read', id);
      assert.strictEqual(ignored.metadata?.notReadBy, '2.6.0', id);
    }
    assert.strictEqual(scan.skillsStat.totalCount, 0, 'Aucun workflow Markdown parmi les skills');
    assert.strictEqual(markdownWorkflowPersonalizationTokens(scan.items), global.metadata?.personalizationTokenCount, 'Seul global_workflows compte');
  });

  test('4. Lecture seule : toggleItem et deleteResource refusés avec leur propre message, fichiers intacts, bascule en masse exclue', async () => {
    const dir = path.join(tempBaseDir, 'lecture-seule');
    const file = path.join(dir, '.agents', 'workflows', 'garde.md');
    const content = workflowContent('Garde');
    await writeFile(file, content);
    const wf = (await LocalScanner.scan(workspaceFor(dir), P260)).items.find((i) => i.id === '.agents/workflows/garde')!;

    const refusal = markdownWorkflowRefusal(wf);
    assert.match(refusal, /^Workflow Markdown en lecture seule : Antigravity ne lui connaît aucun état désactivé/);
    const toggle = await ToggleManager.toggleItem(wf, false);
    assert.deepStrictEqual([toggle.success, toggle.error], [false, refusal]);
    const deletion = await DeleteService.deleteResource(wf);
    assert.deepStrictEqual([deletion.success, deletion.error], [false, refusal]);
    assert.strictEqual(await fs.promises.readFile(file, 'utf8'), content, 'Fichier intact');
    assert.ok(!fs.existsSync(`${file}.disabled`), 'Aucun renommage');

    assert.strictEqual(isBulkToggleable(wf), false);
    const bulk = await ToggleManager.bulkToggle([wf], 'local', 'workflow', false);
    assert.deepStrictEqual([bulk.modifiedCount, bulk.totalItems], [0, 0]);

    const ignored = await buildAntigravityWorkflowItem(file, { scope: 'global', idPrefix: 'config/workflows/', source: 'ignored', notReadBy: '2.6.0' });
    const ignoredRefusal = markdownWorkflowRefusal(ignored);
    assert.match(ignoredRefusal, /^Workflow Markdown d'un emplacement qu'Antigravity IDE 2\.6\.0 ne lit pas/);
    assert.strictEqual((await ToggleManager.toggleItem(ignored, false)).error, ignoredRefusal);
    assert.strictEqual((await DeleteService.deleteResource(ignored)).error, ignoredRefusal);
    assert.strictEqual(await fs.promises.readFile(file, 'utf8'), content, 'Fichier intact');
  });

  test('5. Doublons : un workflow Markdown n\'est comparé ni à un skill de même nom, ni à un workflow de même nom de l\'autre portée', async () => {
    const dir = path.join(tempBaseDir, 'doublons');
    await writeFile(path.join(dir, 'global', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: Skill\n---\nCorps.\n');
    await writeFile(path.join(dir, 'global', 'global_workflows', 'deploy.md'), workflowContent('Global'));
    await writeFile(path.join(dir, 'projet', '.agents', 'workflows', 'deploy.md'), workflowContent('Projet'));
    const skill = await buildAntigravitySkillItem(path.join(dir, 'global', 'skills', 'deploy'), { scope: 'global', fallbackDescription: () => '' });
    const globalWf = await buildAntigravityWorkflowItem(path.join(dir, 'global', 'global_workflows', 'deploy.md'), { scope: 'global', idPrefix: 'global_workflows/', source: 'global' });
    const localWf = await buildAntigravityWorkflowItem(path.join(dir, 'projet', '.agents', 'workflows', 'deploy.md'), { scope: 'local', idPrefix: '.agents/workflows/', source: 'workspace' });
    const localSkill: ResourceItem = { ...skill, scope: 'local' };

    const res = DuplicateService.detectDuplicates([skill, globalWf], [localWf, localSkill]);
    assert.strictEqual(res.stats.totalDuplicates, 1, 'Seule la paire de skills est un doublon');
    assert.strictEqual(res.enrichedLocal.find((i) => i.id === localWf.id)?.metadata?.duplicateInfo, undefined);
    assert.strictEqual(res.enrichedGlobal.find((i) => i.id === globalWf.id)?.metadata?.duplicateInfo, undefined);
  });

  test('6. Seconde jauge : StateManager ajoute nom et description des workflows lus (variantes comprises, emplacements ignorés exclus) ; rien en 2.5.5', async () => {
    const base = path.join(tempBaseDir, 'etat');
    const projet = path.join(base, 'projet');
    const gemini = path.join(base, '.gemini');
    const config = path.join(gemini, 'config');
    await writeFile(path.join(projet, '.agents', 'workflows', 'local.md'), workflowContent('Workflow du projet'));
    await writeFile(path.join(projet, '_agents', 'workflows', 'variante.md'), workflowContent('Workflow de variante'));
    await writeFile(path.join(config, 'global_workflows', 'global.md'), workflowContent('Workflow global'));
    await writeFile(path.join(config, 'workflows', 'ignore.md'), workflowContent('Workflow ignoré'));
    const attendu = [['local', 'Workflow du projet'], ['variante', 'Workflow de variante'], ['global', 'Workflow global']]
      .reduce((sum, [nom, description]) => sum + countTokens(nom) + countTokens(description), 0);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscodeMock = require('vscode');
    const origFolders = vscodeMock.workspace.workspaceFolders;
    const origGetConfig = vscodeMock.workspace.getConfiguration;
    const indicesVides = { newStructure: false, migrationMarker: false, oldStructure: false };
    try {
      vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: projet } }];
      vscodeMock.workspace.getConfiguration = () => ({
        get: (key: string, def: any) => {
          if (key === 'globalPath') return config;
          if (key === 'claudeGlobalPath') return path.join(base, 'claude-home');
          return def;
        },
      });

      StateManager.setAntigravityProfileForTesting(resolveAntigravityProfile('2.6.0', indicesVides));
      const state260 = await StateManager.loadFullState(true);
      const stats = state260.stats;
      assert.strictEqual(stats.personalizationWorkflowTokens, attendu);
      assert.strictEqual(
        stats.personalizationUsedTokensTotal,
        stats.skillsGlobal.tokenCount + stats.skillsLocal.tokenCount + stats.mcpGlobal.tokenCount + stats.mcpLocal.tokenCount + attendu
      );
      assert.ok(state260.globalResources.some((i) => i.id === 'config/workflows/ignore' && i.metadata?.antigravityStatus === 'not-read'));

      StateManager.setAntigravityProfileForTesting(resolveAntigravityProfile('2.5.5', indicesVides));
      const state255 = await StateManager.loadFullState(true);
      assert.strictEqual(state255.stats.personalizationWorkflowTokens, undefined);
      assert.ok(![...state255.globalResources, ...state255.localResources].some((i) => i.metadata?.markdownWorkflow), '2.5.5 : aucun workflow Markdown lu');
    } finally {
      StateManager.setAntigravityProfileForTesting(null);
      vscodeMock.workspace.workspaceFolders = origFolders;
      vscodeMock.workspace.getConfiguration = origGetConfig;
    }

    // Infobulle de la seconde jauge : la part des workflows
    const tooltip = main.formatPersonalizationBudgetTooltip(2717, 20000, 77);
    assert.match(tooltip, /^📊 Budget "Other Customizations" \(skills, workflows et MCP\) : /);
    assert.match(tooltip, /\n🗂️ Workflows Markdown : 77 tokens, pour leur nom et leur description \(🧪 le panneau Settings les compte sans leur corps, sonde du 2026-11-02, Antigravity IDE 2\.6\.0\)\. Ceux de \.agent\/, _agent\/ et _agents\/ sont comptés par prudence \(❔ non vérifié\)\.\n/);
  });

  test('7. Profil 2.5.5 : avec les mêmes fichiers sur le disque, éléments et statistiques identiques à ceux d\'un disque sans ces fichiers', async () => {
    const base = path.join(tempBaseDir, 'neutre-255');
    const projet = path.join(base, 'projet');
    const gemini = path.join(base, '.gemini');
    const config = path.join(gemini, 'config');
    await writeFile(path.join(projet, '.agents', 'rules', 'r.md'), '---\ntrigger: always_on\n---\nRègle.\n');
    await writeFile(path.join(projet, '.agents', 'skills', 'skill-a', 'SKILL.md'), '---\nname: skill-a\ndescription: Un skill\n---\nCorps.\n');
    await writeFile(path.join(config, 'skills', 'skill-g', 'SKILL.md'), '---\nname: skill-g\ndescription: Global\n---\nCorps.\n');

    const avantLocal = await LocalScanner.scan(workspaceFor(projet), P255);
    const avantGlobal = await GlobalScanner.scan(config, 'antigravity', P255);

    await writeFile(path.join(projet, '.agents', 'workflows', 'a.md'), workflowContent('A'));
    for (const variante of ['.agent', '_agent', '_agents']) {
      await writeFile(path.join(projet, variante, 'workflows', 'v.md'), workflowContent('V'));
    }
    await writeFile(path.join(config, 'global_workflows', 'g.md'), workflowContent('G'));
    await writeFile(path.join(config, 'workflows', 'c.md'), workflowContent('C'));
    await writeFile(path.join(gemini, 'antigravity-ide', 'global_workflows', 'i.md'), workflowContent('I'));
    await writeFile(path.join(gemini, 'antigravity', 'global_workflows', 'n.md'), workflowContent('N'));

    assert.deepStrictEqual(await LocalScanner.scan(workspaceFor(projet), P255), avantLocal, '2.5.5 : scan local identique');
    assert.deepStrictEqual(await GlobalScanner.scan(config, 'antigravity', P255), avantGlobal, '2.5.5 : scan global identique');
  });

  test('8. Webview : badges, infobulles et verrou des cartes de workflow, sans la note des skills wf-* ; entrée de chemin de colonne', async () => {
    const dir = path.join(tempBaseDir, 'webview');
    const file = path.join(dir, '.agents', 'workflows', 'deploy.md');
    await writeFile(file, workflowContent('Déploie'));
    const projet = await buildAntigravityWorkflowItem(file, { scope: 'local', idPrefix: '.agents/workflows/', source: 'workspace' });
    const global = await buildAntigravityWorkflowItem(file, { scope: 'global', idPrefix: 'global_workflows/', source: 'global' });
    const variante = await buildAntigravityWorkflowItem(file, { scope: 'local', idPrefix: '_agents/workflows/', source: 'workspace-variant' });
    const ignore = await buildAntigravityWorkflowItem(file, { scope: 'global', idPrefix: 'config/workflows/', source: 'ignored', notReadBy: '2.6.0' });

    const card = (item: ResourceItem) => main.createItemCard(item, true, mockDoc());
    const pills = (item: ResourceItem) => findAll(card(item), 'item-badge-pill');

    // Workflow du projet : injection observée, verrou « Lecture seule », pas de note wf-*
    const pillsProjet = pills(projet);
    const invocation = pillsProjet.find((p) => p.text === '⚡ Sur invocation')!;
    assert.match(invocation.title, /Coût au démarrage : 0 token \(🧪 absent du prompt système\)/);
    assert.match(invocation.title, /🧪 Son corps \(\d+ tokens, sans frontmatter\) est injecté en entier quand on l'invoque par \/deploy, et seulement alors \(observé, sonde du 2026-11-02, Antigravity IDE 2\.6\.0\)/);
    assert.ok(!pillsProjet.some((p) => p.text.startsWith('❔') || p.text.startsWith('⛔')));
    const typeBadge = findAll(card(projet), 'item-type-badge')[0];
    assert.doesNotMatch(typeBadge.title, /wf-/, 'La note des skills wf-* ne s\'applique pas');
    assert.match(typeBadge.title, /^Workflow Markdown \(deploy\.md\), invoqué par \/deploy/);
    const lock = findAll(card(projet), 'soul-locked-badge')[0];
    assert.strictEqual(lock.text.replace(/\s+/g, ''), '🔒Lectureseule');
    assert.match(lock.title, /aucun état désactivé/);
    const metrics = findAll(card(projet), 'item-metrics-badge')[0];
    assert.match(metrics.text, /0 tok au boot · \d+ tok à l'invocation/);

    // Workflow global : injection déduite
    assert.match(pills(global).find((p) => p.text === '⚡ Sur invocation')!.title,
      /serait injecté en entier quand on l'invoque par \/deploy : déduit du mécanisme observé pour \.agents\/workflows\//);
    // Lot L10, 6b : 🧪 pour la présence dans « / » (observée), 🔎 pour l'injection du corps (déduite)
    assert.match(main.describeMarkdownWorkflowCost(global),
      /🧪 Il est listé dans « \/ » \(observé\)\. 🔎 Son corps \(\d+ tokens, sans frontmatter\) serait injecté en entier quand on l'invoque par \/deploy : déduit du mécanisme observé pour \.agents\/workflows\/ \(sonde du 2026-11-02, Antigravity IDE 2\.6\.0\)\./);
    assert.doesNotMatch(main.describeMarkdownWorkflowCost(projet), /🔎/, 'Workflow du projet : injection observée, sans marque de déduction');

    // Variante : badge « ❔ Non vérifié », comptée par prudence
    assert.match(pills(variante).find((p) => p.text === '❔ Non vérifié')!.title, /compté par prudence dans le budget « Other Customizations »/);

    // Emplacement ignoré : « ⛔ Sans effet dans l'IDE 2.6.0 », 🚫 Sans effet, aucun coût, ni « Non lu » des skills
    const pillsIgnore = pills(ignore);
    assert.match(pillsIgnore.find((p) => p.text === '⛔ Sans effet dans l\'IDE 2.6.0')!.title, /n'apparaissent ni dans « \/ », ni dans le panneau Settings \(🧪 observé, sonde du 2026-11-02, Antigravity IDE 2\.6\.0\)/);
    assert.ok(!pillsIgnore.some((p) => p.text.startsWith('⛔ Non lu') || p.text === '⚡ Sur invocation'));
    assert.strictEqual(findAll(card(ignore), 'soul-locked-badge')[0].text.replace(/\s+/g, ''), '🚫Sanseffet');
    assert.match(findAll(card(ignore), 'item-metrics-badge')[0].title, /^Workflow d'un emplacement qu'Antigravity IDE 2\.6\.0 ne lit pas : aucun coût/);

    // Entrée de chemin de colonne : seulement s'il existe un workflow de cet emplacement
    assert.deepStrictEqual(main.markdownWorkflowPathItem([projet, variante], 'workspace', 'projet-local\\.agents\\workflows\\'),
      { label: 'projet-local\\.agents\\workflows\\', fullPath: path.dirname(file), icon: '📁', count: 1 });
    assert.strictEqual(main.markdownWorkflowPathItem([variante], 'workspace', 'x'), null);
    // Chemin sans séparateur : dossier parent vide, sans amputer le nom du fichier
    assert.strictEqual(main.markdownWorkflowPathItem([{ ...projet, path: 'deploy.md' }], 'workspace', 'x').fullPath, '');
    assert.strictEqual(main.markdownWorkflowPathItem([], 'global', 'x'), null);
  });
});
