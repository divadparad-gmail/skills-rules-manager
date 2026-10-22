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

import { convertClaudePaths, findParentRuleDirs, validateGlobs } from '../src/antigravity/behavior';
import { extractFrontmatter } from '../src/utils/frontmatter';
import { ensureAntigravityTrigger } from '../src/utils/antigravityRules';
import { LocalScanner } from '../src/services/LocalScanner';
import { DuplicateService } from '../src/services/DuplicateService';
import { ImportService } from '../src/services/ImportService';
import { ToggleManager } from '../src/services/ToggleManager';
import { buildAntigravityRuleItem } from '../src/services/antigravityRuleItem';
import { ResourceItem, WorkspaceContext } from '../src/types';

// Faits R1 à R6 : test/scenarios/antigravity-injection-contexte/SCENARIOS.md
describe('Suite de Tests : comportement mesuré d\'Antigravity IDE 2.5.5 (lot A1)', () => {
  let tempBaseDir: string;

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-behavior-'));
  });

  after(async () => {
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  const writeFile = async (file: string, content: string) => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, content, 'utf8');
  };

  const workspaceFor = (dir: string, tool: 'antigravity' | 'claude-code' = 'antigravity'): WorkspaceContext => ({
    hasWorkspace: true,
    workspacePath: dir,
    tool,
    agentsDir: tool === 'antigravity' ? '.agents' : null,
    claudeDir: tool === 'claude-code' ? '.claude' : null,
    hasClaudeMd: tool === 'claude-code',
  });

  /** Valeur de `globs` telle que lue dans le frontmatter d'une fixture de la suite. */
  const globsFrom = (frontmatterLines: string) =>
    extractFrontmatter(`---\ntrigger: glob\n${frontmatterLines}\n---\n# R`).metadata.globs;

  test('1. Validation des motifs globs : les dix cas des fixtures de la suite (R3, R4)', () => {
    const cases: Array<[string, string, string[]]> = [
      ['globs: "*.ts, *.tsx"', 'active', []],
      ['globs: "**/*.ts"', 'active', []],
      ['globs: "app.ts"', 'active', []],
      ['globs: "src/**/*.ts"', 'never-triggers', ['src/**/*.ts']],
      ['globs: "sandbox-enquete/*.ts"', 'never-triggers', ['sandbox-enquete/*.ts']],
      ['globs: "**/sandbox-enquete/**/*.ts"', 'never-triggers', ['**/sandbox-enquete/**/*.ts']],
      ["globs: 'sandbox-enquete\\**\\*.ts'", 'never-triggers', ['sandbox-enquete\\**\\*.ts']],
      ['globs: "*.ts, src/**/*.js"', 'partial', ['src/**/*.js']],
      ['globs:\n  - "*.ts"', 'yaml-list', []],
      ['globs:\n  - "*.js"\n  - "*.ts"', 'yaml-list', []],
    ];
    for (const [lines, status, dead] of cases) {
      const verdict = validateGlobs(globsFrom(lines));
      assert.strictEqual(verdict.status, status, lines);
      assert.deepStrictEqual(verdict.deadPatterns, dead, lines);
    }
  });

  test('2. Statut des cartes : liste YAML, motif avec dossier, règle partielle, frontmatter absent', async () => {
    const dir = path.join(tempBaseDir, 'statuts', '.agents', 'rules');
    const build = async (name: string, content: string) => {
      const file = path.join(dir, `${name}.md`);
      await writeFile(file, content);
      return buildAntigravityRuleItem(file, { id: name, scope: 'local', fallbackDescription: '' });
    };

    const yaml = await build('liste', '---\ntrigger: glob\nglobs:\n  - "*.ts"\n---\n# R');
    assert.strictEqual(yaml.metadata?.antigravityStatus, 'ignored-yaml-list');
    const folder = await build('dossier', '---\ntrigger: glob\nglobs: "src/**/*.ts"\n---\n# R');
    assert.strictEqual(folder.metadata?.antigravityStatus, 'never-triggers');
    const partial = await build('partielle', '---\ntrigger: glob\nglobs: "*.ts, src/**/*.js"\n---\n# R');
    assert.strictEqual(partial.metadata?.antigravityStatus, 'partial');
    assert.deepStrictEqual(partial.metadata?.deadGlobs, ['src/**/*.js']);
    const mixte = await build('mixte', '---\ntrigger: glob\nglobs: "*.ts"\npaths:\n  - "src/**/*.ts"\n---\n# R');
    assert.strictEqual(mixte.metadata?.antigravityStatus, 'active', 'R5 : paths en plus ne casse pas la règle');
    const sansFm = await build('sans-fm', 'CANARI-SANS-FM');
    assert.strictEqual(sansFm.metadata?.antigravityStatus, 'ignored');
  });

  test('3. Conversion paths → globs : les six exemples attendus', () => {
    const convert = (paths: string[] | null) => {
      const frontmatter = paths ? `---\npaths:\n${paths.map((p) => `  - "${p}"`).join('\n')}\n---\n` : '';
      const result = ensureAntigravityTrigger(`${frontmatter}# Règle importée\n- Contenu.`);
      return { ...result, metadata: extractFrontmatter(result.content).metadata };
    };

    const src = convert(['src/**/*.ts']);
    assert.strictEqual(src.metadata.trigger, 'glob');
    assert.strictEqual(src.metadata.globs, '*.ts');
    assert.match(src.warnings.join(' '), /Portée élargie : Antigravity ne peut pas cibler un dossier ; la règle s'appliquera à tous les fichiers `\*\.ts` du projet\./);

    const several = convert(['src/**/*.{ts,tsx}', 'lib/**/*.ts']);
    assert.strictEqual(several.metadata.globs, '*.ts, *.tsx');
    assert.match(several.warnings.join(' '), /Portée élargie/);

    const md = convert(['**/*.md']);
    assert.strictEqual(md.metadata.globs, '*.md');
    assert.deepStrictEqual(md.warnings, []);

    const pkg = convert(['package.json']);
    assert.strictEqual(pkg.metadata.globs, 'package.json');
    assert.deepStrictEqual(pkg.warnings, []);

    const docs = convert(['docs/**']);
    assert.strictEqual(docs.metadata.trigger, 'model_decision');
    assert.strictEqual(docs.metadata.globs, undefined);
    assert.match(String(docs.metadata.description), /S'applique aux fichiers de `docs\/`/);
    assert.strictEqual(docs.warnings.length, 1);

    const none = convert(null);
    assert.strictEqual(none.metadata.trigger, 'always_on');

    // Toujours un trigger valide et une description, et jamais de liste
    for (const result of [src, several, md, pkg, docs, none]) {
      assert.ok(typeof result.metadata.description === 'string' && result.metadata.description.length > 0);
      assert.ok(!Array.isArray(result.metadata.globs));
    }
    assert.strictEqual(convertClaudePaths(['src/**/*']).trigger, 'model_decision');
  });

  test('4. Conversion : une description existante est reprise, une règle valide n\'est pas réécrite', () => {
    const withDescription = ensureAntigravityTrigger('---\ndescription: Règles de documentation\npaths:\n  - "docs/**"\n---\n# Docs');
    const metadata = extractFrontmatter(withDescription.content).metadata;
    assert.strictEqual(metadata.description, "Règles de documentation. S'applique aux fichiers de `docs/`.");
    assert.strictEqual((withDescription.content.match(/^description:/gm) || []).length, 1, 'Aucune clé en double');

    const dead = '---\ntrigger: glob\nglobs: "src/**/*.ts"\ndescription: R\n---\n# R';
    const kept = ensureAntigravityTrigger(dead);
    assert.strictEqual(kept.content, dead, 'Le contenu de l\'utilisateur n\'est pas réécrit');
    assert.match(kept.warnings.join(' '), /ne se déclenchera jamais/);
  });

  test('5. Dossiers parents : remontée jusqu\'à la racine Git (dossier ou fichier .git), et cas sans dépôt', async () => {
    const repo = path.join(tempBaseDir, 'repo');
    const work = path.join(repo, 'a', 'b');
    await fs.promises.mkdir(path.join(repo, '.git'), { recursive: true });
    await fs.promises.mkdir(work, { recursive: true });

    assert.deepStrictEqual(findParentRuleDirs(work), { gitRoot: repo, parentDirs: [path.join(repo, 'a'), repo] });
    assert.deepStrictEqual(findParentRuleDirs(repo), { gitRoot: repo, parentDirs: [] }, 'La racine Git ouverte n\'a pas de parent à lire');

    const worktree = path.join(tempBaseDir, 'worktree');
    await writeFile(path.join(worktree, '.git'), 'gitdir: ../repo/.git/worktrees/w');
    await fs.promises.mkdir(path.join(worktree, 'sous'), { recursive: true });
    assert.strictEqual(findParentRuleDirs(path.join(worktree, 'sous')).gitRoot, worktree);

    const noRepo = path.join(tempBaseDir, 'sans-depot', 'projet');
    await fs.promises.mkdir(noRepo, { recursive: true });
    const ancestorHasGit = (() => {
      let dir = noRepo;
      while (path.dirname(dir) !== dir) {
        if (fs.existsSync(path.join(dir, '.git'))) return true;
        dir = path.dirname(dir);
      }
      return false;
    })();
    if (!ancestorHasGit) {
      assert.deepStrictEqual(findParentRuleDirs(noRepo), { gitRoot: null, parentDirs: [] });
    }
  });

  test('6. LocalScanner : règles héritées comptées et verrouillées, sous-dossiers jamais chargés (R1, R2)', async () => {
    const repo = path.join(tempBaseDir, 'monorepo');
    const work = path.join(repo, 'apps', 'web');
    await fs.promises.mkdir(path.join(repo, '.git'), { recursive: true });
    await writeFile(path.join(repo, 'GEMINI.md'), '# Âme du dépôt\nToujours répondre en français.');
    await writeFile(path.join(repo, '.agents', 'rules', 'perm.md'), '---\ntrigger: always_on\n---\n# Permanente héritée');
    await writeFile(path.join(repo, '.agents', 'rules', 'perm.md.disabled'), '---\ntrigger: always_on\n---\n# Ancienne copie');
    await writeFile(path.join(repo, '.agents', 'rules', 'ts.md'), '---\ntrigger: glob\nglobs: "*.ts"\n---\n# Glob héritée');
    // Non testés chez les parents : jamais lus
    await writeFile(path.join(repo, '.agents', 'AGENTS.md'), '# Ne doit pas être lu');
    await writeFile(path.join(repo, '.agent', 'rules', 'ancienne.md'), '---\ntrigger: always_on\n---\n# Ne doit pas être lue');
    await writeFile(path.join(repo, 'apps', 'AGENTS.md'), '# Âme intermédiaire');

    await writeFile(path.join(work, '.agents', 'rules', 'locale.md'), '---\ntrigger: always_on\n---\n# Locale');
    await writeFile(path.join(work, 'sous', 'AGENTS.md'), '# Jamais chargée');

    const result = await LocalScanner.scan(workspaceFor(work));
    assert.deepStrictEqual(result.antigravityParents, { gitRootFound: true, parentDirs: [path.join(repo, 'apps'), repo] });

    const inheritedSouls = result.items.filter((i) => i.type === 'soul' && i.metadata?.inheritedFrom !== undefined).map((i) => i.id).sort();
    assert.deepStrictEqual(inheritedSouls, ['../../GEMINI.md', '../AGENTS.md']);
    const perms = result.items.filter((i) => i.id === '../../.agents/rules/perm');
    assert.strictEqual(perms.length, 1, 'Un .md et son .md.disabled ne font qu\'une carte');
    const perm = perms[0];
    assert.strictEqual(perm.enabled, true, 'Le fichier actif est prioritaire');
    assert.strictEqual(perm.metadata?.inheritedFrom, '../..');
    assert.strictEqual(perm.metadata?.locked, true);
    assert.strictEqual(perm.metadata?.antigravityStatus, 'active');
    assert.ok(!result.items.some((i) => i.path.includes(path.join('.agents', 'AGENTS.md')) && i.metadata?.inheritedFrom !== undefined));
    assert.ok(!result.items.some((i) => i.path.includes('ancienne')), '.agent/rules/ d\'un parent n\'est pas lu');

    const sous = result.items.find((i) => i.id === 'sous/AGENTS')!;
    assert.strictEqual(sous.metadata?.antigravityStatus, 'never-loaded');

    // Héritées comprises dans les totaux locaux, avec leur part affichée
    assert.strictEqual(result.rulesStat.activeCount, 3, 'locale + perm + ts héritées');
    assert.strictEqual(result.rulesStat.inheritedCount, 2);
    assert.strictEqual(result.rulesStat.permanentCount, 2);
    assert.strictEqual(result.rulesStat.conditionalCount, 1);
    assert.strictEqual(result.soulStat.inheritedCount, 2);
    assert.ok(result.rulesStat.tokenCount > perm.tokenCount!, 'Les héritées entrent dans la jauge');
  });

  test('7. Sans dépôt Git : aucun dossier parent n\'est lu', async (t) => {
    const parent = path.join(tempBaseDir, 'isole');
    const work = path.join(parent, 'projet');
    await writeFile(path.join(parent, 'GEMINI.md'), '# Parent sans dépôt');
    await writeFile(path.join(work, '.agents', 'rules', 'r.md'), '---\ntrigger: always_on\n---\n# R');
    if (findParentRuleDirs(work).gitRoot !== null) {
      t.skip('Un dossier .git existe au-dessus du dossier temporaire.');
      return;
    }
    const result = await LocalScanner.scan(workspaceFor(work));
    assert.deepStrictEqual(result.antigravityParents, { gitRootFound: false, parentDirs: [] });
    assert.ok(!result.items.some((i) => i.metadata?.inheritedFrom !== undefined));
  });

  test('8. Compteurs et doublons : une règle ⛔ ne compte ni comme active ni comme doublon actif (R6)', async () => {
    const dir = path.join(tempBaseDir, 'compteurs');
    await writeFile(path.join(dir, '.agents', 'rules', 'sans-fm.md'), '# Sans frontmatter');
    await writeFile(path.join(dir, '.agents', 'rules', 'yaml.md'), '---\ntrigger: glob\nglobs:\n  - "*.ts"\n---\n# Y');
    await writeFile(path.join(dir, '.agents', 'rules', 'ok.md'), '---\ntrigger: always_on\ndescription: Règle valide\n---\n# OK');
    const result = await LocalScanner.scan(workspaceFor(dir));
    assert.strictEqual(result.rulesStat.activeCount, 1);
    assert.strictEqual(result.rulesStat.warningCount, 2, 'Les ⛔ restent comptées dans les avertissements');
    assert.strictEqual(result.rulesStat.conditionalCount, 0, 'Une règle glob en liste YAML ne coûte rien au démarrage');

    const local = result.items.find((i) => i.id === 'sans-fm')!;
    const global: ResourceItem = { ...local, scope: 'global', path: path.join(tempBaseDir, 'global-sans-fm.md') };
    const { stats } = DuplicateService.detectDuplicates([global], [local]);
    assert.strictEqual(stats.totalDuplicates, 1);
    assert.strictEqual(stats.activeDuplicates, 0);
  });

  test('9. Bascule en masse : les règles héritées verrouillées ne sont jamais renommées', async () => {
    const lockedFile = path.join(tempBaseDir, 'verrou', 'herite.md');
    const ownFile = path.join(tempBaseDir, 'verrou', 'propre.md');
    await writeFile(lockedFile, '---\ntrigger: always_on\n---\n# H');
    await writeFile(ownFile, '---\ntrigger: always_on\n---\n# P');
    const base = { type: 'rule' as const, scope: 'local' as const, enabled: true, targetTool: 'antigravity' as const, isFolder: false, name: '', description: '' };
    const items: ResourceItem[] = [
      { ...base, id: 'herite', path: lockedFile, metadata: { locked: true, inheritedFrom: '..' } },
      { ...base, id: 'propre', path: ownFile },
    ];
    const res = await ToggleManager.bulkToggle(items, 'local', 'rule', false);
    assert.strictEqual(res.modifiedCount, 1);
    assert.ok(fs.existsSync(lockedFile), 'Le fichier du dossier parent est intact');
    assert.ok(fs.existsSync(`${ownFile}.disabled`));
  });

  test('10. Non-régression Claude Code : CLAUDE.md de sous-dossier et paths inchangés, aucun parent lu', async () => {
    const repo = path.join(tempBaseDir, 'claude-repo');
    const work = path.join(repo, 'projet');
    await fs.promises.mkdir(path.join(repo, '.git'), { recursive: true });
    await writeFile(path.join(repo, 'CLAUDE.md'), '# Parent');
    await writeFile(path.join(repo, 'GEMINI.md'), '# Parent Antigravity');
    await writeFile(path.join(work, 'CLAUDE.md'), '# Racine');
    await writeFile(path.join(work, 'sous', 'CLAUDE.md'), '# Sous-dossier');
    await writeFile(path.join(work, '.claude', 'rules', 'api.md'), '---\npaths:\n  - "src/api/**/*.ts"\n---\n# API');
    await writeFile(path.join(work, '.claude', 'rules', 'perm.md'), '# Permanente');

    const result = await LocalScanner.scan(workspaceFor(work, 'claude-code'));
    // État actuel figé : seul le CLAUDE.md racine est recensé (constat hors périmètre de A1)
    assert.deepStrictEqual(result.items.filter((i) => i.type === 'soul').map((i) => i.id), ['CLAUDE.md']);
    assert.strictEqual(result.antigravityParents, undefined);
    assert.ok(result.items.every((i) => i.metadata?.antigravityStatus === undefined && i.metadata?.inheritedFrom === undefined));
    const api = result.items.find((i) => i.id === 'api')!;
    assert.strictEqual(api.metadata?.isConditional, true);
    assert.deepStrictEqual((api.metadata as Record<string, unknown>).paths, ['src/api/**/*.ts']);
    assert.strictEqual(result.rulesStat.activeCount, 2);
    assert.strictEqual(result.rulesStat.conditionalCount, 1);
    assert.strictEqual(result.rulesStat.permanentCount, 1);

    // Import vers Claude Code : la règle est copiée octet pour octet
    const target = path.join(tempBaseDir, 'claude-cible');
    await fs.promises.mkdir(target, { recursive: true });
    const imported = await ImportService.importResource(api, 'local', workspaceFor(target, 'claude-code'));
    assert.strictEqual(imported.success, true);
    assert.strictEqual(fs.readFileSync(imported.targetPath!, 'utf8'), fs.readFileSync(api.path, 'utf8'));
    assert.strictEqual(imported.notice, undefined);
  });
});
