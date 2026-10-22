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
});
