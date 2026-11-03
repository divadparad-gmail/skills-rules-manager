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
  ANTIGRAVITY_PROFILES,
  countBodyLines,
  countLines,
  GLOB_REINJECTION_HEADER,
  hasTableOfContents,
  ORDINARY_SESSION,
  RULES_BUDGET_TOKENS,
  sizeAdviceFor,
} from '../src/antigravity/behavior';
import { countTokens, clearTokenCache } from '../src/utils/tokenizer';
import { LocalScanner } from '../src/services/LocalScanner';
import { NasScanner } from '../src/services/NasScanner';
import { GlobalScanner } from '../src/services/GlobalScanner';
import { DuplicateService } from '../src/services/DuplicateService';
import { hasResourceWarning } from '../src/services/antigravityRuleItem';
import { collectAnnexNotes } from '../src/services/antigravitySkillItem';
import { computeAntigravityDynamicCosts, computeBudgetOverflow, computeGlobStacks } from '../src/services/antigravityDynamicCosts';
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
  return {
    createElement,
    getElementById: (id: string) => (byId[id] = byId[id] ?? createElement('div')),
  };
};

/** Pastilles d'une carte rendue : texte et infobulle. */
const pillsOf = (root: MockEl): Array<{ text: string; title: string; className: string }> => {
  const found: Array<{ text: string; title: string; className: string }> = [];
  const walk = (el: MockEl) => {
    if (el.className.includes('item-badge-pill') || el.className.includes('item-metrics-badge')) {
      found.push({ text: el.textContent || el.innerHTML.replace(/<[^>]+>/g, ''), title: el.title, className: el.className });
    }
    el.children.forEach(walk);
  };
  walk(root);
  return found;
};

const allText = (el: MockEl): string =>
  [el.textContent || el.innerHTML.replace(/<[^>]+>/g, ''), ...el.children.map(allText)].filter(Boolean).join('\n');

const bodyOf = (lineCount: number, line = (i: number) => `- Ligne ${i + 1}`) =>
  Array.from({ length: lineCount }, (_, i) => line(i)).join('\n');

const rule = (frontmatter: string, lineCount: number) => `---\n${frontmatter}\n---\n${bodyOf(lineCount)}\n`;

// Recommandations de taille et coûts dynamiques : src/antigravity/behavior.ts (lot A3)
describe('Suite de Tests : alertes et coûts dynamiques d\'Antigravity (lot A3a)', () => {
  let tempBaseDir: string;

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-a3-'));
    clearTokenCache();
  });

  after(async () => {
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  const writeFile = async (file: string, content: string) => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, content, 'utf8');
  };

  const workspaceFor = (dir: string): WorkspaceContext => ({
    hasWorkspace: true,
    workspacePath: dir,
    tool: 'antigravity',
    agentsDir: '.agents',
    claudeDir: null,
    hasClaudeMd: false,
  });

  const scanRules = async (name: string, files: Record<string, string>) => {
    const dir = path.join(tempBaseDir, name);
    for (const [relative, content] of Object.entries(files)) await writeFile(path.join(dir, relative), content);
    return LocalScanner.scan(workspaceFor(dir));
  };

  test('1. Lignes du corps : frontmatter exclu, lignes vides comprises, fin de ligne finale ignorée', () => {
    assert.strictEqual(countLines(''), 0);
    assert.strictEqual(countLines('a\n\nb\n'), 3);
    assert.strictEqual(countLines('a\r\nb'), 2);
    assert.strictEqual(countBodyLines('---\ntrigger: always_on\n---\nA\n\nB\n'), 3);
    assert.strictEqual(countBodyLines('---\r\ntrigger: glob\r\n---\r\nA'), 1);
    assert.strictEqual(countBodyLines('Sans frontmatter\nB'), 2);
  });

  test('2. Seuils : chaque type juste en dessous et juste au-dessus', () => {
    assert.strictEqual(sizeAdviceFor('permanent', 200), null);
    assert.deepStrictEqual(sizeAdviceFor('permanent', 201), { kind: 'permanent', lines: 201, maxLines: 200 });
    assert.strictEqual(sizeAdviceFor('model_decision', 200), null);
    assert.ok(sizeAdviceFor('model_decision', 201));
    assert.strictEqual(sizeAdviceFor('skill', 500), null);
    assert.ok(sizeAdviceFor('skill', 501));
    assert.strictEqual(sizeAdviceFor('glob', 30, 420), null);
    assert.ok(sizeAdviceFor('glob', 31, 100), '31 lignes dépassent la recommandation glob');
    assert.deepStrictEqual(sizeAdviceFor('glob', 10, 421), { kind: 'glob', lines: 10, maxLines: 30, tokens: 421, maxTokens: 420 });
  });

  test('3. Scanner : règles permanente, glob et model_decision, âme, au seuil et au-delà ; manual sans seuil', async () => {
    const result = await scanRules('seuils', {
      '.agents/rules/perm-200.md': rule('trigger: always_on\ndescription: Permanente', 200),
      '.agents/rules/perm-201.md': rule('trigger: always_on\ndescription: Permanente', 201),
      '.agents/rules/glob-30.md': rule('trigger: glob\nglobs: "*.ts"\ndescription: Glob', 30),
      '.agents/rules/glob-31.md': rule('trigger: glob\nglobs: "*.ts"\ndescription: Glob', 31),
      '.agents/rules/model-201.md': rule('trigger: model_decision\ndescription: Quand la tâche concerne X', 201),
      '.agents/rules/manual-500.md': rule('trigger: manual\ndescription: Manuelle', 500),
      'GEMINI.md': bodyOf(201),
    });
    const byId = (id: string) => result.items.find((i) => i.id === id)!;
    assert.strictEqual(byId('perm-200').metadata?.sizeAdvice, undefined);
    assert.strictEqual(byId('perm-201').metadata?.sizeAdvice?.kind, 'permanent');
    assert.strictEqual(byId('perm-201').metadata?.warningLinesExceeded, true);
    assert.strictEqual(byId('glob-30').metadata?.sizeAdvice, undefined);
    assert.strictEqual(byId('glob-31').metadata?.sizeAdvice?.kind, 'glob');
    assert.strictEqual(byId('model-201').metadata?.sizeAdvice?.kind, 'model_decision');
    assert.strictEqual(byId('manual-500').metadata?.sizeAdvice, undefined, 'manual : aucune recommandation');
    assert.strictEqual(byId('GEMINI.md').metadata?.sizeAdvice?.lines, 201);
    assert.ok(result.rulesStat.warningCount! >= 3, 'Les avertissements de taille comptent dans les avertissements');
  });

  test('4. Règle glob : avertissement au-delà de 420 tokens, même sous 30 lignes', async () => {
    const result = await scanRules('glob-tokens', {
      '.agents/rules/glob-dense.md': `---\ntrigger: glob\nglobs: "*.ts"\ndescription: Dense\n---\n${bodyOf(5, () => 'mot '.repeat(100))}\n`,
    });
    const advice = result.items.find((i) => i.id === 'glob-dense')!.metadata?.sizeAdvice;
    assert.strictEqual(advice?.kind, 'glob');
    assert.ok((advice?.tokens ?? 0) > 420);
    const label = main.describeSizeAdvice(advice);
    assert.match(label.label, /tok$/);
    assert.match(label.title, /réinjectée à chaque fichier correspondant/);
  });

  test('5. Un seul avertissement de taille : une règle tronquée porte ✂️ sans badge de lignes', async () => {
    const result = await scanRules('tronquee', {
      '.agents/rules/longue.md': `---\ntrigger: always_on\ndescription: Longue\n---\n${bodyOf(300, () => 'x'.repeat(99))}\n`,
    });
    const item = result.items.find((i) => i.id === 'longue')!;
    assert.ok((item.metadata?.truncatedBytes ?? 0) > 0, 'La règle dépasse 24 000 octets de corps');
    assert.strictEqual(item.metadata?.sizeAdvice, undefined);
    const pills = pillsOf(main.createItemCard(item, true, mockDoc()));
    assert.ok(pills.some((p) => p.text === '✂️ Tronquée'));
    assert.ok(!pills.some((p) => /li\.|> 24 Ko/.test(p.text)), 'Aucun second avertissement de taille');

    // Profil 2.6.0 : la coupe sur fin de ligne est observée sur deux fichiers (sonde du 2026-11-02)
    const ligne = pillsOf(main.createItemCard({ ...item, metadata: { ...item.metadata, truncationRule: 'line-end' } }, true, mockDoc()))
      .find((p) => p.text === '✂️ Tronquée')!;
    assert.match(ligne.title, /🧪 Règle de coupe observée dans Antigravity IDE 2\.6\.0 sur deux fichiers : r-tronque\.md \(5 960 octets coupés\) et la règle 06 du banc d'essai \(15 090 octets coupés, sonde du 2026-11-02\)/);
    assert.doesNotMatch(ligne.title, /déduite/);
  });

  test('6. Skill : 500 lignes de corps au plus, frontmatter exclu, et plus d\'alerte de 24 Ko', async () => {
    const frontmatter = '---\nname: s\ndescription: Un skill\nextra: 1\nautre: 2\n---\n';
    const result = await scanRules('skills', {
      '.agents/skills/s500/SKILL.md': `${frontmatter}${bodyOf(500)}\n`,
      '.agents/skills/s501/SKILL.md': `${frontmatter}${bodyOf(501)}\n`,
      '.agents/skills/gros/SKILL.md': `${frontmatter}${bodyOf(100, () => 'y'.repeat(300))}\n`,
    });
    const byId = (id: string) => result.items.find((i) => i.id === id)!;
    assert.strictEqual(byId('s500').metadata?.sizeAdvice, undefined, 'Le frontmatter ne compte pas dans les 500 lignes');
    assert.strictEqual(byId('s501').metadata?.sizeAdvice?.kind, 'skill');
    assert.ok(fs.statSync(path.join(byId('gros').path, 'SKILL.md')).size > 24000);
    assert.ok(!byId('gros').metadata?.warningSizeExceeded, 'Aucun plafond n\'est documenté pour un skill');
    const pills = pillsOf(main.createItemCard(byId('gros'), true, mockDoc()));
    assert.ok(!pills.some((p) => p.text.includes('24 Ko')));
  });

  test('7. Annexes de skill : information ℹ️, jamais un avertissement', async () => {
    const skill = path.join(tempBaseDir, 'annexes', '.agents', 'skills', 'avec-annexes');
    await writeFile(path.join(skill, 'SKILL.md'), '---\nname: avec-annexes\ndescription: Skill\n---\nCorps.\n');
    await writeFile(path.join(skill, 'references', 'courte.md'), bodyOf(100));
    await writeFile(path.join(skill, 'references', 'sans-toc.md'), bodyOf(101));
    await writeFile(path.join(skill, 'references', 'avec-toc.md'), `## Table des matières\n${bodyOf(150)}`);
    await writeFile(path.join(skill, 'references', 'liens.md'), `- [A](#a)\n- [B](#b)\n- [C](#c)\n${bodyOf(150)}`);
    await writeFile(path.join(skill, 'references', 'longue.md'), `# Sommaire\n${bodyOf(301)}`);
    await writeFile(path.join(skill, 'scripts', 'outil.sh'), bodyOf(400));

    assert.ok(hasTableOfContents('# Contents\n'));
    assert.ok(!hasTableOfContents('- [A](#a)\n- [B](#b)\n'));
    const notes = await collectAnnexNotes(skill);
    assert.deepStrictEqual(notes, [
      { file: 'references/longue.md', lines: 302, tooLong: true, missingToc: false },
      { file: 'references/sans-toc.md', lines: 101, tooLong: false, missingToc: true },
    ]);

    const result = await LocalScanner.scan(workspaceFor(path.join(tempBaseDir, 'annexes')));
    const item = result.items.find((i) => i.id === 'avec-annexes')!;
    assert.strictEqual(item.metadata?.annexNotes?.length, 2);
    assert.strictEqual(hasResourceWarning(item), false, 'Une annexe ne compte pas comme avertissement');
    assert.strictEqual(result.skillsStat.warningCount, 0);
    const pill = pillsOf(main.createItemCard(item, true, mockDoc())).find((p) => p.text.startsWith('ℹ️'))!;
    assert.strictEqual(pill.text, 'ℹ️ Annexes (2)');
    assert.ok(pill.className.includes('pill-info'));
    assert.match(pill.title, /sans-toc\.md : 101 lignes, pas de table des matières repérée/);
  });

  test('8. Coût par opération d\'une règle glob active : N tok par fichier correspondant, ≈ N × 20', async () => {
    const result = await scanRules('par-operation', {
      '.agents/rules/g.md': rule('trigger: glob\nglobs: "*.ts"\ndescription: Glob', 3),
      '.agents/rules/g-off.md.disabled': rule('trigger: glob\nglobs: "*.ts"\ndescription: Glob', 3),
    });
    const item = result.items.find((i) => i.id === 'g')!;
    const tokens = item.tokenCount!;
    const metrics = pillsOf(main.createItemCard(item, true, mockDoc())).find((p) => p.className.includes('item-metrics-badge'))!;
    assert.match(metrics.text, new RegExp(`0 tok au boot · ${tokens} tok par fichier correspondant`));
    const operations = ORDINARY_SESSION.reads + ORDINARY_SESSION.writes;
    assert.strictEqual(operations, 20);
    assert.ok(metrics.title.includes(`≈ ${tokens} × 20 = ${(tokens * 20).toLocaleString('fr-FR')} tokens sur une session ordinaire (15 lectures + 5 modifications)`));

    const off = result.items.find((i) => i.id === 'g-off')!;
    const offMetrics = pillsOf(main.createItemCard(off, true, mockDoc())).find((p) => p.className.includes('item-metrics-badge'))!;
    assert.ok(!offMetrics.text.includes('par fichier correspondant'), 'Une règle désactivée ne coûte rien');
  });

  test('9. Empilement par motif : **/ normalisé, motifs morts et règles ⛔ exclus, règles héritées comprises', async () => {
    const root = path.join(tempBaseDir, 'empilement');
    await fs.promises.mkdir(path.join(root, '.git'), { recursive: true });
    await writeFile(path.join(root, '.agents', 'rules', 'parent-glob.md'), rule('trigger: glob\nglobs: "*.ts"\ndescription: Parent', 2));
    const dir = path.join(root, 'projet');
    const files: Record<string, string> = {
      '.agents/rules/a.md': rule('trigger: glob\nglobs: "*.ts"\ndescription: A', 1),
      '.agents/rules/b.md': rule('trigger: glob\nglobs: "**/*.ts"\ndescription: B', 2),
      '.agents/rules/c.md': rule('trigger: glob\nglobs: "*.ts, *.tsx"\ndescription: C', 3),
      '.agents/rules/d.md': rule('trigger: glob\nglobs: "app.ts"\ndescription: D', 1),
      '.agents/rules/partielle.md': rule('trigger: glob\nglobs: "src/**/*.ts, *.md"\ndescription: P', 1),
      '.agents/rules/morte.md': rule('trigger: glob\nglobs: "src/**/*.ts"\ndescription: M', 1),
      '.agents/rules/eteinte.md.disabled': rule('trigger: glob\nglobs: "*.ts"\ndescription: E', 1),
      '.agents/rules/liste.md': '---\ntrigger: glob\nglobs:\n  - "*.ts"\ndescription: L\n---\nL\n',
      'sous/.agents/rules/imbriquee.md': rule('trigger: glob\nglobs: "*.ts"\ndescription: I', 1),
    };
    for (const [relative, content] of Object.entries(files)) await writeFile(path.join(dir, relative), content);

    const result = await LocalScanner.scan(workspaceFor(dir));
    const stacks = computeGlobStacks(result.items);
    const ts = stacks.find((s) => s.patterns.includes('*.ts'))!;
    assert.deepStrictEqual(ts.rules.map((r) => r.id.split('/').pop()).sort(), ['a', 'b', 'c', 'parent-glob']);
    assert.strictEqual(ts.rules.find((r) => r.id.endsWith('parent-glob'))?.inheritedFrom, '..');
    assert.strictEqual(ts.tokensPerFile, ts.rules.reduce((sum, r) => sum + r.tokensPerFile, 0));
    assert.strictEqual(ts.headerTokens, countTokens(GLOB_REINJECTION_HEADER));
    assert.deepStrictEqual(stacks.find((s) => s.patterns.includes('app.ts'))?.alsoMatchedBy, ['*.ts']);
    assert.deepStrictEqual(stacks.find((s) => s.patterns.includes('*.md'))?.rules.map((r) => r.id), ['partielle']);
    assert.deepStrictEqual(stacks.find((s) => s.patterns.includes('*.tsx'))?.rules.map((r) => r.id), ['c']);
    assert.deepStrictEqual(stacks.find((s) => s.patterns.includes('*.tsx'))?.alsoMatchedBy, [], '*.tsx n\'est pas couvert par *.ts');
    assert.ok(!stacks.some((s) => s.patterns.some((p) => p.includes('src/'))), 'Un motif mort ne s\'empile pas');
    assert.deepStrictEqual(stacks.flatMap((s) => s.patterns).sort(), ['*.md', '*.ts', '*.tsx', 'app.ts']);
  });

  const permanentItem = (id: string, tokens: number, overrides: Partial<ResourceItem> = {}): ResourceItem => ({
    id,
    name: id,
    description: '',
    type: 'rule',
    scope: 'local',
    enabled: true,
    path: `/virtuel/${id}.md`,
    targetTool: 'antigravity',
    isFolder: false,
    tokenCount: tokens,
    ...overrides,
    metadata: { trigger: 'always_on', antigravityStatus: 'active', bootTokenCount: tokens, ...(overrides.metadata ?? {}) },
  });

  test('10. Dépassement du budget : rien à 20 000 tokens ; au-delà, les plus gros fichiers jusqu\'à repasser sous le budget', () => {
    assert.strictEqual(RULES_BUDGET_TOKENS, 20000);
    const soul = permanentItem('GEMINI.md', 9000, { type: 'soul', metadata: { isSoul: true } });
    const atBudget = [soul, permanentItem('a', 6000), permanentItem('b', 5000)];
    assert.strictEqual(computeBudgetOverflow(atBudget), null);

    const over = [
      soul,
      permanentItem('a', 6000),
      permanentItem('b', 5001),
      permanentItem('glob', 50000, { metadata: { trigger: 'glob', bootTokenCount: 0 } }),
      permanentItem('model', 50000, { metadata: { trigger: 'model_decision', bootTokenCount: 40 } }),
      permanentItem('eteinte', 50000, { enabled: false }),
      permanentItem('jamais', 50000, { metadata: { antigravityStatus: 'never-loaded' } }),
    ];
    const overflow = computeBudgetOverflow(over)!;
    assert.strictEqual(overflow.totalTokens, 20001);
    assert.deepStrictEqual(overflow.pointerCandidates.map((c) => c.id), ['GEMINI.md'], 'Le plus gros fichier suffit à repasser sous le budget');

    const farOver = computeBudgetOverflow([permanentItem('x', 15000), permanentItem('y', 9000), permanentItem('z', 8000)])!;
    assert.deepStrictEqual(farOver.pointerCandidates.map((c) => c.id), ['x']);
    const veryFar = computeBudgetOverflow([permanentItem('x', 12000), permanentItem('y', 11000), permanentItem('z', 10000)])!;
    assert.deepStrictEqual(veryFar.pointerCandidates.map((c) => c.id), ['x', 'y']);
    assert.strictEqual(computeAntigravityDynamicCosts(atBudget).budgetOverflow, null);
  });

  test('11. Doublons Antigravity : le plus petit des deux coûts au démarrage ; glob et manual à 0, coût dynamique ; ⛔ jamais', () => {
    const local = (id: string, metadata: Record<string, unknown>, tokens = 999) =>
      permanentItem(id, tokens, { scope: 'local', path: `/local/${id}.md`, metadata: metadata as any });
    const global = (id: string, metadata: Record<string, unknown>, tokens = 999) =>
      permanentItem(id, tokens, { scope: 'global', path: `/global/${id}.md`, metadata: metadata as any });

    const { enrichedLocal, stats } = DuplicateService.detectDuplicates(
      [
        global('perm', { trigger: 'always_on', bootTokenCount: 300 }),
        global('mixte', { trigger: 'model_decision', bootTokenCount: 45 }),
        global('glob', { trigger: 'glob', bootTokenCount: 0 }),
        global('morte', { trigger: 'glob', bootTokenCount: 0, antigravityStatus: 'never-triggers' }),
      ],
      [
        local('perm', { trigger: 'always_on', bootTokenCount: 280 }),
        local('mixte', { trigger: 'always_on', bootTokenCount: 600 }),
        local('glob', { trigger: 'glob', bootTokenCount: 0 }),
        local('morte', { trigger: 'always_on', bootTokenCount: 500 }),
      ]
    );
    const info = (id: string) => enrichedLocal.find((i) => i.id === id)!.metadata!.duplicateInfo!;
    assert.strictEqual(info('perm').wastedTokens, 280, 'Copie redondante : la moins chère des deux');
    assert.strictEqual(info('mixte').wastedTokens, 45, 'model_decision : son entrée d\'index');
    assert.strictEqual(info('glob').wastedTokens, 0);
    assert.strictEqual(info('glob').dynamicCost, true);
    assert.strictEqual(info('perm').dynamicCost, undefined);
    assert.strictEqual(info('morte').bothEnabled, false, 'Une copie ⛔ ne fait pas un doublon actif');
    assert.strictEqual(info('morte').wastedTokens, 0);
    assert.deepStrictEqual(stats, { totalDuplicates: 4, activeDuplicates: 3, totalWastedTokens: 325 });

    const card = main.createItemCard(enrichedLocal.find((i) => i.id === 'glob'), true, mockDoc());
    assert.ok(allText(card).includes('· coût dynamique'));
  });

  test('12. Âmes Antigravity : doublon seulement si les contenus sont identiques ; Claude Code inchangé', async () => {
    const dir = path.join(tempBaseDir, 'ames');
    const soulAt = async (scope: 'global' | 'local', name: string, content: string, tool: 'antigravity' | 'claude-code' = 'antigravity'): Promise<ResourceItem> => {
      const file = path.join(dir, scope, name);
      await writeFile(file, content);
      return {
        id: name, name, description: '', type: 'soul', scope, enabled: true, path: file, targetTool: tool,
        isFolder: false, tokenCount: content.length, metadata: { isSoul: true, bootTokenCount: content.length },
      };
    };
    const different = DuplicateService.detectDuplicates(
      [await soulAt('global', 'GEMINI.md', 'Âme globale, longue')],
      [await soulAt('local', 'GEMINI.md', 'Âme du projet')]
    );
    assert.deepStrictEqual(different.stats, { totalDuplicates: 0, activeDuplicates: 0, totalWastedTokens: 0 });
    assert.strictEqual(different.enrichedLocal[0].metadata?.duplicateInfo, undefined);

    const same = DuplicateService.detectDuplicates(
      [await soulAt('global', 'AGENTS.md', 'Même contenu')],
      [await soulAt('local', 'AGENTS.md', 'Même contenu')]
    );
    assert.deepStrictEqual(same.stats, { totalDuplicates: 1, activeDuplicates: 1, totalWastedTokens: 'Même contenu'.length });

    // Claude Code : la paire divergente reste un doublon, au coût de la copie globale
    const claude = DuplicateService.detectDuplicates(
      [await soulAt('global', 'CLAUDE.md', 'Âme globale, longue', 'claude-code')],
      [await soulAt('local', 'CLAUDE.md', 'Âme du projet', 'claude-code')]
    );
    assert.deepStrictEqual(claude.stats, { totalDuplicates: 1, activeDuplicates: 1, totalWastedTokens: 'Âme globale, longue'.length });
  });

  test('13. Un seul badge ⛔ : une règle de sous-dossier invalide garde « Jamais chargée », avec le défaut en infobulle', async () => {
    const result = await scanRules('double-badge', {
      'sous/.agents/rules/sans-fm.md': '# Sans frontmatter\nCorps.\n',
      '.agents/rules/racine-sans-fm.md': '# Sans frontmatter\nCorps.\n',
    });
    const nested = result.items.find((i) => i.metadata?.antigravityStatus === 'never-loaded')!;
    const pills = pillsOf(main.createItemCard(nested, true, mockDoc())).filter((p) => p.text.startsWith('⛔'));
    assert.deepStrictEqual(pills.map((p) => p.text), ['⛔ Jamais chargée']);
    assert.match(pills[0].title, /Même à la racine, elle serait ignorée : le fichier ne commence pas par un frontmatter YAML/);

    const atRoot = result.items.find((i) => i.id === 'racine-sans-fm')!;
    const rootPills = pillsOf(main.createItemCard(atRoot, true, mockDoc())).filter((p) => p.text.startsWith('⛔'));
    assert.deepStrictEqual(rootPills.map((p) => p.text), ['⛔ Ignorée par Antigravity']);
  });

  test('14. Compteur de la colonne Local : sans les règles de sous-dossier ni les règles héritées (Antigravity seulement)', () => {
    const items = [
      permanentItem('a', 1),
      permanentItem('b', 1, { metadata: { antigravityStatus: 'never-loaded' } }),
      permanentItem('c', 1, { metadata: { inheritedFrom: '..' } }),
      permanentItem('d', 1, { type: 'skill' }),
    ];
    assert.strictEqual(main.localRulesHeaderCount(items, false), 1);
    assert.strictEqual(main.localRulesHeaderCount(items, true), 3, 'Claude Code : compteur inchangé');
  });

  test('15. Panneau des coûts dynamiques : masqué en Claude Code, empilement et budget en Antigravity', () => {
    const nodes: Record<string, MockEl> = {};
    const doc = mockDoc(nodes);
    main.renderDynamicCosts({ workspace: { tool: 'claude-code' }, stats: {} }, doc);
    assert.strictEqual(nodes.dynamicCostsPanel.style.display, 'none');

    const items = [
      permanentItem('GEMINI.md', 21000, { type: 'soul', metadata: { isSoul: true } }),
      permanentItem('g1', 100, { metadata: { trigger: 'glob', bootTokenCount: 0, globPatterns: ['*.ts'] } }),
      permanentItem('g2', 50, { metadata: { trigger: 'glob', bootTokenCount: 0, globPatterns: ['app.ts'] } }),
    ];
    const dynamicCosts = computeAntigravityDynamicCosts(items);
    main.renderDynamicCosts({ workspace: { tool: 'antigravity' }, stats: { dynamicCosts } }, doc);
    assert.strictEqual(nodes.dynamicCostsPanel.style.display, '');
    assert.strictEqual(nodes.dynamicCostsSummary.textContent, '⏱️ Coûts dynamiques : 2 motifs glob · ⚠️ budget dépassé');
    const text = allText(nodes.dynamicCostsBody);
    const header = countTokens(GLOB_REINJECTION_HEADER);
    assert.ok(text.includes('Antigravity transformera les plus gros fichiers en pointeurs (documentation, non testé)'));
    assert.ok(text.includes(' : 1 règle, 100 tok injectés à chaque fichier .ts lu ou modifié'));
    assert.ok(text.includes(`Ces fichiers correspondent aussi à *.ts : 2 règles et ${150 + header} tok à chaque opération`));
    assert.ok(text.includes(`≈ ${100 + header} × 20 = ${((100 + header) * 20).toLocaleString('fr-FR')} tokens sur une session ordinaire`));
  });

  test('16. Coûts dynamiques : les motifs qui déclenchent les mêmes règles forment une seule pile', () => {
    const items = [
      permanentItem('c', 132, { metadata: { trigger: 'glob', bootTokenCount: 0, globPatterns: ['*.ts', '**/*.tsx'] } }),
      permanentItem('m', 40, { metadata: { trigger: 'glob', bootTokenCount: 0, globPatterns: ['*.md'] } }),
    ];
    const stacks = computeGlobStacks(items);
    assert.deepStrictEqual(stacks.map((s) => s.patterns), [['*.ts', '*.tsx'], ['*.md']]);
    assert.strictEqual(stacks[0].tokensPerFile, 132, 'Les coûts des motifs regroupés ne s\'additionnent pas');

    const nodes: Record<string, MockEl> = {};
    main.renderDynamicCosts({ workspace: { tool: 'antigravity' }, stats: { dynamicCosts: computeAntigravityDynamicCosts(items) } }, mockDoc(nodes));
    assert.strictEqual(nodes.dynamicCostsSummary.textContent, '⏱️ Coûts dynamiques : 3 motifs glob');
    const text = allText(nodes.dynamicCostsBody);
    assert.ok(text.includes('*.ts\n · \n*.tsx\n : 1 règle, 132 tok injectés à chaque fichier .ts ou .tsx lu ou modifié'));
  });

  // Chantier 2.6.0, lot L7, D-5 : une règle glob est chargée mais jamais injectée (phase 2b)
  test('16. Règle glob par profil : active et empilée en 2.5.5 ; « ⛔ Sans effet dans l\'IDE 2.6.0 », hors coûts dynamiques en 2.6.0', async () => {
    const files = {
      '.agents/rules/pluriel.md': '---\ntrigger: glob\nglobs: "*.ts"\ndescription: P.\n---\n# Pluriel\nCorps glob.\n',
      '.agents/rules/singulier.md': '---\ntrigger: glob\nglob: "*.ts"\ndescription: S.\n---\n# Singulier\nCorps glob.\n',
      '.agents/rules/morte.md': '---\ntrigger: glob\nglobs: "src/*.ts"\ndescription: M.\n---\n# Morte\n',
      '.agents/rules/liste.md': '---\ntrigger: glob\nglobs:\n  - "*.ts"\ndescription: L.\n---\n# Liste\n',
      '.agents/rules/perm.md': '---\ntrigger: always_on\ndescription: A.\n---\n# Permanente\n',
    };
    const dir = path.join(tempBaseDir, 'glob-profils');
    for (const [relative, content] of Object.entries(files)) await writeFile(path.join(dir, relative), content);
    const statut = (items: ResourceItem[], id: string) => items.find((i) => i.id === id)!.metadata?.antigravityStatus;

    const v255 = await LocalScanner.scan(workspaceFor(dir), ANTIGRAVITY_PROFILES['2.5.5']);
    assert.deepStrictEqual(await LocalScanner.scan(workspaceFor(dir)), v255, 'Le profil par défaut est 2.5.5');
    assert.deepStrictEqual(
      ['pluriel', 'singulier', 'morte', 'liste'].map((id) => statut(v255.items, id)),
      ['active', 'active', 'never-triggers', 'ignored-yaml-list']
    );
    assert.strictEqual(computeGlobStacks(v255.items).length, 1, 'Les deux règles *.ts forment une pile');
    assert.strictEqual(v255.items.find((i) => i.id === 'pluriel')!.metadata?.noEffectIn, undefined);

    const v260 = await LocalScanner.scan(workspaceFor(dir), ANTIGRAVITY_PROFILES['2.6.0']);
    assert.deepStrictEqual(
      ['pluriel', 'singulier', 'morte', 'liste'].map((id) => statut(v260.items, id)),
      ['glob-no-effect', 'glob-no-effect', 'glob-no-effect', 'ignored-yaml-list'],
      'globs: et glob: sans effet ; la liste YAML échoue toujours au parsing'
    );
    const pluriel = v260.items.find((i) => i.id === 'pluriel')!;
    assert.strictEqual(pluriel.metadata?.noEffectIn, '2.6.0');
    assert.strictEqual(pluriel.metadata?.bootTokenCount, 0, 'Aucun coût au démarrage');
    assert.strictEqual(pluriel.enabled, true, 'Le fichier n\'est pas désactivé');
    assert.ok(hasResourceWarning(pluriel), 'Signalée dans les compteurs d\'avertissements');
    assert.deepStrictEqual(computeGlobStacks(v260.items), [], 'Aucune pile de coûts dynamiques');
    assert.deepStrictEqual(computeAntigravityDynamicCosts(v260.items).globStacks, []);
    assert.strictEqual(v260.rulesStat.tokenCount, v255.rulesStat.tokenCount, 'Coût au démarrage inchangé : une règle glob coûtait déjà 0');
    assert.strictEqual(statut(v260.items, 'perm'), 'active');

    // La carte : badge daté et sourcé, métrique à 0, interrupteur conservé
    const card = main.createItemCard(pluriel, true, mockDoc());
    const text = allText(card);
    assert.ok(text.includes('⛔ Sans effet dans l\'IDE 2.6.0'));
    const titles = (el: MockEl): string[] => [el.title, ...el.children.flatMap(titles)];
    const tooltip = titles(card).find((t) => t.includes('ne l\'injecte jamais'))!;
    assert.match(tooltip, /mesuré, phase 2b/);
    assert.match(tooltip, /model_decision/);
    // La conversion manuelle : une description qui nomme les fichiers visés, et le corps lu par l'agent
    assert.match(tooltip, /• model_decision, avec une description qui nomme les fichiers visés/);
    assert.match(tooltip, /lit le corps \(read_file\) quand il juge que le sujet correspond \(🧪 observé, sonde du 2026-11-02, Antigravity IDE 2\.6\.0\)/);
    assert.match(tooltip, /always_on/);
    assert.match(tooltip, /ne modifie pas la règle d'elle-même/);
    assert.ok(text.includes('0 tok au boot'));
    assert.ok(!text.includes('par fichier correspondant'), 'Plus de coût par opération');
  });

  test('17. Doublons en 2.6.0 : une copie glob sans effet n\'apporte aucun coût dynamique', () => {
    const local = permanentItem('glob', 999, { scope: 'local', path: '/local/glob.md', metadata: { trigger: 'glob', bootTokenCount: 0, antigravityStatus: 'glob-no-effect' } as any });
    const global = permanentItem('glob', 999, { scope: 'global', path: '/global/glob.md', metadata: { trigger: 'glob', bootTokenCount: 0, antigravityStatus: 'glob-no-effect' } as any });
    const { enrichedLocal } = DuplicateService.detectDuplicates([global], [local]);
    assert.strictEqual(enrichedLocal[0].metadata!.duplicateInfo!.dynamicCost, undefined);
  });

  // Chantier 2.6.0, lot L9, D-10 : seconde jauge « Other Customizations » (20 000 tokens)
  test('18. Seconde jauge D-10 (lot L9) : masquée en 2.5.5 et en Claude Code ; affichée en 2.6.0 avec ses segments, ses seuils de couleur et son infobulle sourcée', () => {
    const nodes: Record<string, MockEl> = {};
    const doc = mockDoc(nodes);
    const statSkillGlobal = {
      type: 'skill', scope: 'global', activeCount: 29, totalCount: 29,
      charCount: 10000, tokenCount: 2564, percentage: 12.8, directoryPath: '/virtuel/skills-global',
    };
    const statSkillLocal = {
      type: 'skill', scope: 'local', activeCount: 1, totalCount: 1,
      charCount: 400, tokenCount: 113, percentage: 0.6, directoryPath: '/virtuel/skills-local',
    };
    const statMcpGlobal = {
      type: 'mcp', scope: 'global', activeCount: 2, totalCount: 4,
      charCount: 160, tokenCount: 40, percentage: 0.2, directoryPath: '/virtuel/mcp-global',
    };
    const statMcpLocal = {
      type: 'mcp', scope: 'local', activeCount: 0, totalCount: 0,
      charCount: 0, tokenCount: 0, percentage: 0, directoryPath: '/virtuel/mcp-local',
    };
    const statSkillTotal = {
      type: 'skill', scope: 'global', activeCount: 30, totalCount: 30,
      charCount: 10400, tokenCount: 2677, percentage: 13.4, directoryPath: 'Cumul Global + Local',
    };
    const statMcpTotal = {
      type: 'mcp', scope: 'global', activeCount: 2, totalCount: 2,
      charCount: 160, tokenCount: 40, percentage: 0.2, directoryPath: 'Cumul Global + Local',
    };

    // 1. Claude Code et Antigravity 2.5.5 : seconde jauge masquée, libellé et infobulle 2.5.5 inchangés
    main.renderPersonalizationGauge({ workspace: { tool: 'claude-code' }, stats: { personalizationBudgetTotal: 20000 } }, doc);
    assert.strictEqual(nodes.personalizationGaugeWrap.style.display, 'none');
    assert.strictEqual(nodes.personalizationGaugeWrapSide.style.display, 'none');
    assert.strictEqual(nodes.personalizationGaugeWrap.title, '');

    const state255 = {
      workspace: { tool: 'antigravity' },
      stats: {
        budgetExcludesPersonalization: true,
        skillsGlobal: statSkillGlobal,
        skillsLocal: statSkillLocal,
        mcpGlobal: statMcpGlobal,
        mcpLocal: statMcpLocal,
      },
    };
    main.renderPersonalizationGauge(state255, doc);
    assert.strictEqual(nodes.personalizationGaugeWrap.style.display, 'none');
    assert.strictEqual(nodes.personalizationGaugeWrapSide.style.display, 'none');
    assert.strictEqual(nodes.barPersonalizationSkillGlobal.style.width, '0%');

    main.updateBreakdownRow('SkillGlobal', statSkillGlobal, 'Skills (global)', doc, state255);
    assert.strictEqual(nodes.valSkillGlobal.textContent, `${(2564).toLocaleString()} tok (hors budget des règles)`);
    main.updateBreakdownRow('SkillTotal', statSkillTotal, 'Skills (total)', doc, state255);
    assert.ok(
      nodes.tooltipSkillTotal.textContent.includes(
        'hors budget de 20 000 tokens des règles (budget de personnalisation distinct, non chiffré par la documentation d\'Antigravity)'
      ),
      'Profil 2.5.5 : infobulle SkillTotal inchangée'
    );
    main.updateBreakdownRow('McpGlobal', statMcpGlobal, 'MCP (global)', doc, state255);
    assert.strictEqual(nodes.valMcpGlobal.textContent, `${(40).toLocaleString()} tok (hors budget des règles)`);
    main.updateBreakdownRow('McpTotal', statMcpTotal, 'MCP (total)', doc, state255);
    assert.ok(
      nodes.tooltipMcpTotal.textContent.includes(
        'hors budget de 20 000 tokens des règles (budget de personnalisation distinct, non chiffré par la documentation d\'Antigravity)'
      ),
      'Profil 2.5.5 : infobulle McpTotal inchangée'
    );

    // 2. Antigravity 2.6.0 : seconde jauge affichée, segments calculés sur 20 000, infobulle exacte
    const state260 = {
      workspace: { tool: 'antigravity' },
      stats: {
        budgetExcludesPersonalization: true,
        personalizationBudgetTotal: 20000,
        personalizationUsedTokensTotal: 2717,
        personalizationAvailablePercentage: 86.4,
        skillsGlobal: statSkillGlobal,
        skillsLocal: statSkillLocal,
        mcpGlobal: statMcpGlobal,
        mcpLocal: statMcpLocal,
      },
    };
    main.renderPersonalizationGauge(state260, doc);
    assert.strictEqual(nodes.personalizationGaugeWrap.style.display, '');
    assert.strictEqual(nodes.personalizationGaugeWrapSide.style.display, '');
    assert.strictEqual(nodes.personalizationUsedPercent.textContent, '13.6%');
    assert.strictEqual(nodes.personalizationAvailablePercent.textContent, '86.4%');
    assert.strictEqual(nodes.personalizationUsedPercentSide.textContent, '14%');
    assert.strictEqual(nodes.personalizationAvailablePercentSide.textContent, '86%');
    assert.ok(nodes.personalizationUsedPercent.classList.contains('pct-normal'));
    assert.ok(nodes.personalizationAvailablePercent.classList.contains('pct-normal'));
    assert.ok(!nodes.personalizationProgressTrack.classList.contains('gauge-warning'));
    assert.ok(!nodes.personalizationProgressTrack.classList.contains('gauge-critical'));
    assert.strictEqual(nodes.barPersonalizationSkillGlobal.style.width, '12.8%');
    assert.strictEqual(nodes.barPersonalizationSkillLocal.style.width, '0.6%');
    assert.strictEqual(nodes.barPersonalizationMcpGlobal.style.width, '0.2%');
    assert.strictEqual(nodes.barPersonalizationMcpLocal.style.width, '0%');

    const expectedTooltip =
      `📊 Budget "Other Customizations" (skills, workflows et MCP) : ${(2717).toLocaleString('fr-FR')} / 20 000 tokens (13.6 %).\n` +
      '🗂️ Workflows Markdown : 0 tokens, pour leur nom et leur description (🧪 le panneau Settings les compte sans leur corps, sonde du 2026-11-02, Antigravity IDE 2.6.0). Ceux de .agent/, _agent/ et _agents/ sont comptés par prudence (❔ non vérifié).\n' +
      '🧪 Plafond de 20 000 tokens observé dans le panneau Settings d\'Antigravity IDE 2.6.0 (2026-10-28), distinct du budget de 20 000 tokens des règles.\n' +
      '📏 Estimation de l\'extension (tokeniseur o200k_base) : le panneau de l\'IDE peut afficher un autre chiffre.\n' +
      '🧩 Les skills intégrés et les skills présents à la fois en global et dans le projet sont comptés par prudence ; le panneau de l\'IDE semble les exclure (déduit, non vérifié).\n' +
      '❔ Au-delà du budget, l\'IDE annonce que les grosses personnalisations sont exclues : annoncé par l\'IDE, non testé.';
    assert.strictEqual(main.formatPersonalizationBudgetTooltip(2717, 20000), expectedTooltip);
    assert.strictEqual(nodes.personalizationGaugeWrap.title, expectedTooltip);
    assert.strictEqual(nodes.personalizationGaugeWrapSide.title, expectedTooltip);

    main.updateBreakdownRow('SkillGlobal', statSkillGlobal, 'Skills (global)', doc, state260);
    assert.strictEqual(nodes.valSkillGlobal.textContent, `${(2564).toLocaleString()} tok (12.8% / 20k)`);
    main.updateBreakdownRow('SkillTotal', statSkillTotal, 'Skills (total)', doc, state260);
    assert.ok(nodes.tooltipSkillTotal.textContent.includes('13.4% du budget « Other Customizations » de 20 000 tokens'));
    assert.ok(nodes.tooltipSkillTotal.textContent.includes(expectedTooltip));
    main.updateBreakdownRow('McpGlobal', statMcpGlobal, 'MCP (global)', doc, state260);
    assert.strictEqual(nodes.valMcpGlobal.textContent, `${(40).toLocaleString()} tok (0.2% / 20k)`);
    main.updateBreakdownRow('McpTotal', statMcpTotal, 'MCP (total)', doc, state260);
    assert.ok(nodes.tooltipMcpTotal.textContent.includes('0.2% du budget « Other Customizations » de 20 000 tokens'));
    assert.ok(nodes.tooltipMcpTotal.textContent.includes(expectedTooltip));

    // 2b. Budget fictif de 10 000 tokens : le pourcentage et le dénominateur suivent personalizationBudgetTotal
    const state260Budget10k = {
      workspace: { tool: 'antigravity' },
      stats: {
        ...state260.stats,
        personalizationBudgetTotal: 10000,
      },
    };
    main.updateBreakdownRow('SkillGlobal', statSkillGlobal, 'Skills (global)', doc, state260Budget10k);
    assert.strictEqual(nodes.valSkillGlobal.textContent, `${(2564).toLocaleString()} tok (25.6% / 10k)`);
    main.updateBreakdownRow('SkillTotal', statSkillTotal, 'Skills (total)', doc, state260Budget10k);
    assert.ok(nodes.tooltipSkillTotal.textContent.includes('26.8% du budget « Other Customizations » de 10 000 tokens'));
    main.updateBreakdownRow('McpGlobal', statMcpGlobal, 'MCP (global)', doc, state260Budget10k);
    assert.strictEqual(nodes.valMcpGlobal.textContent, `${(40).toLocaleString()} tok (0.4% / 10k)`);
    main.updateBreakdownRow('McpTotal', statMcpTotal, 'MCP (total)', doc, state260Budget10k);
    assert.ok(nodes.tooltipMcpTotal.textContent.includes('0.4% du budget « Other Customizations » de 10 000 tokens'));

    // 3. Seuils de couleur (warning <= 25%, critical < 10%) sans alerte dédiée
    main.renderPersonalizationGauge({
      workspace: { tool: 'antigravity' },
      stats: {
        ...state260.stats,
        personalizationUsedTokensTotal: 16000,
        personalizationAvailablePercentage: 20,
      },
    }, doc);
    assert.strictEqual(nodes.personalizationAvailablePercent.textContent, '⚠️ 20%');
    assert.ok(nodes.personalizationUsedPercent.classList.contains('pct-warning'));
    assert.ok(nodes.personalizationProgressTrack.classList.contains('gauge-warning'));
    assert.ok(!nodes.personalizationProgressTrack.classList.contains('gauge-critical'));

    main.renderPersonalizationGauge({
      workspace: { tool: 'antigravity' },
      stats: {
        ...state260.stats,
        personalizationUsedTokensTotal: 19000,
        personalizationAvailablePercentage: 5,
      },
    }, doc);
    assert.strictEqual(nodes.personalizationAvailablePercent.textContent, '🚨 5%');
    assert.ok(nodes.personalizationUsedPercent.classList.contains('pct-critical'));
    assert.ok(nodes.personalizationProgressTrack.classList.contains('gauge-critical'));
    assert.ok(!nodes.personalizationProgressTrack.classList.contains('gauge-warning'));
  });

  // Lot L10, partie 6a, commit 1 : les largeurs de la seconde jauge suivent le budget du profil, jamais
  // stat.percentage (calculé sur le budget des règles), et un cinquième segment porte les workflows Markdown
  test('19. Seconde jauge (lot L10) : largeurs sur le budget du profil, segment des workflows, tout à 0 % une fois masquée', () => {
    const nodes: Record<string, MockEl> = {};
    const doc = mockDoc(nodes);
    const segments = [
      'barPersonalizationSkillGlobal',
      'barPersonalizationSkillLocal',
      'barPersonalizationWorkflow',
      'barPersonalizationMcpGlobal',
      'barPersonalizationMcpLocal',
    ];
    const widths = () => segments.map((id) => nodes[id].style.width);
    const sumOfWidths = () => segments.reduce((acc, id) => acc + parseFloat(nodes[id].style.width), 0);
    // percentage volontairement faux : un calcul fondé sur stat.percentage donnerait 99 % ou 50 %
    const stat = (type: string, scope: string, tokenCount: number, percentage: number) => ({
      type, scope, activeCount: 1, totalCount: 1, charCount: 0, tokenCount, percentage, directoryPath: '/virtuel',
    });
    const stats260 = {
      budgetExcludesPersonalization: true,
      personalizationBudgetTotal: 20000,
      personalizationUsedTokensTotal: 3000,
      personalizationAvailablePercentage: 85,
      personalizationWorkflowTokens: 300,
      skillsGlobal: stat('skill', 'global', 2000, 99),
      skillsLocal: stat('skill', 'local', 500, 50),
      mcpGlobal: stat('mcp', 'global', 100, 99),
      mcpLocal: stat('mcp', 'local', 100, 50),
    };

    // 1. Profil 2.6.0, budget de 20 000 : tokenCount / budget, workflows compris ; la somme égale le pourcentage utilisé
    main.renderPersonalizationGauge({ workspace: { tool: 'antigravity' }, stats: stats260 }, doc);
    assert.deepStrictEqual(widths(), ['10%', '2.5%', '1.5%', '0.5%', '0.5%']);
    assert.strictEqual(nodes.personalizationUsedPercent.textContent, '15%');
    assert.ok(Math.abs(sumOfWidths() - 15) < 0.1, 'Les cinq segments somment au pourcentage utilisé');

    // 2. Budget fictif de 10 000 : les largeurs suivent personalizationBudgetTotal
    main.renderPersonalizationGauge({ workspace: { tool: 'antigravity' }, stats: { ...stats260, personalizationBudgetTotal: 10000 } }, doc);
    assert.deepStrictEqual(widths(), ['20%', '5%', '3%', '1%', '1%']);
    assert.strictEqual(nodes.personalizationUsedPercent.textContent, '30%');
    assert.ok(Math.abs(sumOfWidths() - 30) < 0.1);

    // 3. Sans personalizationWorkflowTokens : segment des workflows à 0 %
    const { personalizationWorkflowTokens: _ignore, ...sansWorkflows } = stats260;
    main.renderPersonalizationGauge({ workspace: { tool: 'antigravity' }, stats: { ...sansWorkflows, personalizationUsedTokensTotal: 2700 } }, doc);
    assert.strictEqual(nodes.barPersonalizationWorkflow.style.width, '0%');

    // 4. Profil 2.5.5 (pas de budget) et Claude Code : jauge masquée, les cinq segments remis à 0 %
    main.renderPersonalizationGauge({ workspace: { tool: 'antigravity' }, stats: stats260 }, doc);
    assert.strictEqual(nodes.barPersonalizationWorkflow.style.width, '1.5%');
    const { personalizationBudgetTotal: _budget, ...stats255 } = stats260;
    main.renderPersonalizationGauge({ workspace: { tool: 'antigravity' }, stats: stats255 }, doc);
    assert.strictEqual(nodes.personalizationGaugeWrap.style.display, 'none');
    assert.deepStrictEqual(widths(), ['0%', '0%', '0%', '0%', '0%'], '2.5.5 : segments remis à 0 %');
    main.renderPersonalizationGauge({ workspace: { tool: 'antigravity' }, stats: stats260 }, doc);
    main.renderPersonalizationGauge({ workspace: { tool: 'claude-code' }, stats: stats260 }, doc);
    assert.strictEqual(nodes.personalizationGaugeWrap.style.display, 'none');
    assert.deepStrictEqual(widths(), ['0%', '0%', '0%', '0%', '0%'], 'Claude Code : segments remis à 0 %');

    // 5. Les deux pages déclarent le segment, entre les skills et les MCP, avec sa classe de couleur
    const webview = path.resolve(__dirname, '../../src/webview');
    for (const page of ['dashboard.html', 'sidebar.html']) {
      const html = fs.readFileSync(path.join(webview, page), 'utf8');
      const ids = [...html.matchAll(/id="(barPersonalization[A-Za-z]+)"/g)].map((m) => m[1]);
      assert.deepStrictEqual(ids, segments, `${page} : cinq segments dans l'ordre`);
      assert.match(html, /id="barPersonalizationWorkflow" class="segment segment-workflow"/);
    }
    assert.match(fs.readFileSync(path.join(webview, 'styles.css'), 'utf8'), /\.segment-workflow \{/);
  });

  // Lot L10, partie 6a, commit 1 : une carte du catalogue n'est jamais chargée ; ses badges « ✂️ Tronquée »
  // et « ⚠️ > 24 Ko » parlent au conditionnel du déploiement. Une âme tronquée (globale, locale ou du catalogue)
  // est mesurée fichier entier ; les règles globales et locales gardent leur texte exact.
  test('20. Badges « ✂️ Tronquée » et « ⚠️ > 24 Ko » (lot L10) : conditionnel du déploiement pour le catalogue, âmes en fichier entier, règles locales inchangées', async () => {
    const base = path.join(tempBaseDir, 'l10-catalogue-tronque');
    const nasDir = path.join(base, 'catalogue');
    const longBody = bodyOf(300, (i) => `${i} ${'x'.repeat(95)}`);
    const longRule = `---\ntrigger: always_on\ndescription: Longue\n---\n${longBody}\n`;
    await writeFile(path.join(nasDir, 'rules', 'longue.md'), longRule);
    await writeFile(path.join(base, 'backup_cerveau_ia', '.gemini', 'GEMINI.md'), `${longBody}\n`);
    const projet = path.join(base, 'projet');
    await writeFile(path.join(projet, '.agents', 'rules', 'longue.md'), longRule);
    await writeFile(path.join(projet, 'GEMINI.md'), `${longBody}\n`);
    const globalConfigDir = path.join(base, 'global-home', '.gemini', 'config');
    await writeFile(path.join(base, 'global-home', '.gemini', 'GEMINI.md'), `${longBody}\n`);

    const pillOf = (item: ResourceItem) => pillsOf(main.createItemCard(item, true, mockDoc())).find((p) => p.text === '✂️ Tronquée');
    const fmt = (n?: number) => (n || 0).toLocaleString('fr-FR');
    const scope = '(frontmatter non compté, inclusions @[label](path) comprises)';
    const catalogueTail = 'que l\'agent ne lirait pas.\nLe coût estimé ne compte que la partie gardée. Le catalogue lui-même n\'est jamais chargé par Antigravity.';
    const lineEndNote = '\n🧪 Règle de coupe observée dans Antigravity IDE 2.6.0 sur deux fichiers : r-tronque.md (5 960 octets coupés) et la règle 06 du banc d\'essai (15 090 octets coupés, sonde du 2026-11-02).';
    const byteNote = '\n❔ Non vérifié : aucune fin de ligne ne précède la limite. L\'extension suppose une coupe à l\'octet ; le comportement d\'Antigravity IDE 2.6.0 dans ce cas n\'a pas été observé.';

    // 1. Profil 2.5.5 : règle du catalogue coupée à l'octet, au conditionnel ; la règle locale garde son texte exact
    const nas255 = (await NasScanner.scan(nasDir, 'antigravity', ANTIGRAVITY_PROFILES['2.5.5'])).items.find((i) => i.id === 'longue')!;
    assert.strictEqual(nas255.scope, 'nas');
    assert.ok((nas255.metadata?.truncatedBytes ?? 0) > 0 && nas255.metadata?.truncationRule === undefined);
    assert.strictEqual(
      pillOf(nas255)!.title,
      `Une fois déployé, Antigravity couperait le corps de ce fichier à 24 000 octets ${scope} : ${fmt(nas255.metadata?.truncatedBytes)} octets coupés, soit ≈ ${fmt(nas255.metadata?.lostTokens)} tokens ${catalogueTail}`
    );
    const local255 = (await LocalScanner.scan(workspaceFor(projet), ANTIGRAVITY_PROFILES['2.5.5'])).items.find((i) => i.id === 'longue')!;
    assert.strictEqual(
      pillOf(local255)!.title,
      `Antigravity coupe le corps de ce fichier à 24 000 octets ${scope} : ${fmt(local255.metadata?.truncatedBytes)} octets coupés, soit ≈ ${fmt(local255.metadata?.lostTokens)} tokens jamais lus par l'agent.\nLe coût affiché ne compte que la partie gardée.`
    );

    // 2. Profil 2.6.0 : règle et âme du catalogue coupées sur fin de ligne, au conditionnel, avec la note de coupe.
    // L'âme est mesurée fichier entier (measureAntigravitySoul) : pas de « frontmatter non compté »
    const scan260 = await NasScanner.scan(nasDir, 'antigravity', ANTIGRAVITY_PROFILES['2.6.0']);
    const nasRule260 = scan260.items.find((i) => i.id === 'longue')!;
    const nasSoul260 = scan260.items.find((i) => i.type === 'soul' && i.id === 'GEMINI.md')!;
    const expected260 = [
      [nasRule260, `Une fois déployé, Antigravity couperait le corps de ce fichier à la dernière fin de ligne avant 24 000 octets ${scope}`],
      [nasSoul260, 'Une fois déployé, Antigravity couperait ce fichier à la dernière fin de ligne avant 24 000 octets (fichier entier, inclusions @[label](path) comprises)'],
    ] as const;
    for (const [item, head] of expected260) {
      assert.ok(item, 'Carte du catalogue présente');
      assert.strictEqual(item.metadata?.truncationRule, 'line-end', `${item.type} : coupe sur fin de ligne`);
      const title = pillOf(item)!.title;
      assert.strictEqual(
        title,
        `${head} : ${fmt(item.metadata?.truncatedBytes)} octets coupés, soit ≈ ${fmt(item.metadata?.lostTokens)} tokens ${catalogueTail}${lineEndNote}`
      );
      assert.doesNotMatch(title, /jamais lus par l'agent/);
    }
    assert.doesNotMatch(pillOf(nasSoul260)!.title, /frontmatter non compté/, 'Âme du catalogue : fichier entier');
    const scanLocal260 = await LocalScanner.scan(workspaceFor(projet), ANTIGRAVITY_PROFILES['2.6.0']);
    const local260 = scanLocal260.items.find((i) => i.id === 'longue')!;
    assert.strictEqual(
      pillOf(local260)!.title,
      `Antigravity coupe le corps de ce fichier à la dernière fin de ligne avant 24 000 octets ${scope} : ${fmt(local260.metadata?.truncatedBytes)} octets coupés, soit ≈ ${fmt(local260.metadata?.lostTokens)} tokens jamais lus par l'agent.\nLe coût affiché ne compte que la partie gardée.${lineEndNote}`
    );
    // Âmes locale et globale tronquées : mesurées fichier entier (measureAntigravitySoul), comme l'âme du catalogue ;
    // la règle locale ci-dessus garde « le corps de ce fichier » et « frontmatter non compté »
    const localSoul260 = scanLocal260.items.find((i) => i.type === 'soul')!;
    const globalSoul260 = (await GlobalScanner.scan(globalConfigDir, 'antigravity', ANTIGRAVITY_PROFILES['2.6.0'])).items
      .find((i) => i.type === 'soul' && i.id === 'GEMINI.md')!;
    for (const [soul, portee] of [[localSoul260, 'locale'], [globalSoul260, 'globale']] as const) {
      assert.ok(soul && (soul.metadata?.truncatedBytes ?? 0) > 0, `Âme ${portee} tronquée présente`);
      assert.strictEqual(soul.metadata?.truncationRule, 'line-end');
      const title = pillOf(soul)!.title;
      assert.strictEqual(
        title,
        `Antigravity coupe ce fichier à la dernière fin de ligne avant 24 000 octets (fichier entier, inclusions @[label](path) comprises) : ${fmt(soul.metadata?.truncatedBytes)} octets coupés, soit ≈ ${fmt(soul.metadata?.lostTokens)} tokens jamais lus par l'agent.\nLe coût affiché ne compte que la partie gardée.${lineEndNote}`,
        `Âme ${portee} : fichier entier`
      );
      assert.doesNotMatch(title, /frontmatter non compté/);
    }
    assert.match(pillOf(local260)!.title, /^Antigravity coupe le corps de ce fichier .*\(frontmatter non compté, /, 'Règle locale : texte inchangé');

    // 2b. Profil 2.5.5 : l'âme du catalogue de plus de 24 000 caractères n'est pas mesurée (texte brut) ;
    // son badge « ⚠️ > 24 Ko » parle au conditionnel du déploiement
    const sizePillOf = (item: ResourceItem) => pillsOf(main.createItemCard(item, true, mockDoc())).find((p) => p.text === '⚠️ > 24 Ko');
    const nasSoul255 = (await NasScanner.scan(nasDir, 'antigravity', ANTIGRAVITY_PROFILES['2.5.5'])).items.find((i) => i.type === 'soul' && i.id === 'GEMINI.md')!;
    assert.strictEqual(nasSoul255.metadata?.warningSizeExceeded, true);
    assert.strictEqual(nasSoul255.metadata?.truncatedBytes, undefined, '2.5.5 : âme du catalogue non mesurée');
    const nasSizeTitle = sizePillOf(nasSoul255)!.title;
    assert.strictEqual(
      nasSizeTitle,
      'Attention : ce fichier du catalogue dépasse la limite de 24 000 octets d\'Antigravity. Une fois déployé, Antigravity le tronquerait.\nLe catalogue lui-même n\'est jamais chargé par Antigravity.'
    );
    assert.doesNotMatch(nasSizeTitle, /Antigravity le tronque\./);
    // Témoin : une règle locale ignorée (sans frontmatter) de plus de 24 000 octets garde son texte exact
    await writeFile(path.join(projet, '.agents', 'rules', 'sans-trigger.md'), `${longBody}\n`);
    const ignoree = (await LocalScanner.scan(workspaceFor(projet), ANTIGRAVITY_PROFILES['2.5.5'])).items.find((i) => i.id === 'sans-trigger')!;
    assert.ok(typeof ignoree.metadata?.byteSize === 'number', 'Taille en octets connue');
    assert.strictEqual(
      sizePillOf(ignoree)!.title,
      `Attention : ce fichier dépasse la limite de 24 000 octets d'Antigravity (${fmt(ignoree.metadata?.byteSize)} octets), inclusions @[label](path) comprises. Antigravity le tronque.`
    );

    // 3. Repli à l'octet (byte-fallback) : catalogue au conditionnel, avec la note « non vérifié »
    const nasFallback = { ...nas255, metadata: { ...nas255.metadata, truncationRule: 'byte-fallback' as const } };
    assert.strictEqual(
      pillOf(nasFallback)!.title,
      `Une fois déployé, Antigravity couperait le corps de ce fichier à 24 000 octets ${scope} : ${fmt(nas255.metadata?.truncatedBytes)} octets coupés, soit ≈ ${fmt(nas255.metadata?.lostTokens)} tokens ${catalogueTail}${byteNote}`
    );
  });
});
