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

import { checkAntigravityRuleFrontmatter, isRuleConditional, extractFrontmatter } from '../src/utils/frontmatter';
import { ensureAntigravityTrigger, expandRuleIncludes, inspectAntigravityRule } from '../src/utils/antigravityRules';
import { LocalScanner } from '../src/services/LocalScanner';
import { GlobalScanner } from '../src/services/GlobalScanner';
import { ImportService } from '../src/services/ImportService';
import { ResourceItem, WorkspaceContext } from '../src/types';
import { ANTIGRAVITY_PROFILES } from '../src/antigravity/behavior';

// Règles vérifiées selon https://antigravity.google/docs/rules/
describe('Suite de Tests : Règles Antigravity conformes à la documentation officielle', () => {
  let tempBaseDir: string;

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-rules-'));
  });

  after(async () => {
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  const workspaceFor = (dir: string, agentsDir: string | null = '.agents'): WorkspaceContext => ({
    hasWorkspace: true,
    workspacePath: dir,
    tool: 'antigravity',
    agentsDir,
    claudeDir: null,
    hasClaudeMd: false,
  });

  const writeFile = async (file: string, content: string) => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, content, 'utf8');
  };

  test('1. Frontmatter : absent ou sans trigger, la règle est ignorée', () => {
    const noFrontmatter = checkAntigravityRuleFrontmatter('# Règle\nContenu.');
    assert.strictEqual(noFrontmatter.ignored, true);
    assert.deepStrictEqual(noFrontmatter.issues, ['missing-frontmatter']);

    const noTrigger = checkAntigravityRuleFrontmatter('---\ndescription: Sans trigger\n---\n# Règle');
    assert.strictEqual(noTrigger.ignored, true);
    assert.deepStrictEqual(noTrigger.issues, ['missing-trigger']);
  });

  test('2. Trigger : seules les quatre valeurs exactes sont reconnues', () => {
    for (const trigger of ['always_on', 'model_decision', 'glob', 'manual']) {
      const check = checkAntigravityRuleFrontmatter(`---\ntrigger: ${trigger}\ndescription: d\nglobs: "*.ts"\n---\n# R`);
      assert.strictEqual(check.ignored, false, `${trigger} doit être reconnu`);
      assert.strictEqual(check.trigger, trigger);
    }
    for (const trigger of ['alwaysOn', 'modelDecision', 'Glob', 'MANUAL', 'globs']) {
      const check = checkAntigravityRuleFrontmatter(`---\ntrigger: ${trigger}\n---\n# R`);
      assert.strictEqual(check.ignored, true, `${trigger} doit être rejeté`);
      assert.deepStrictEqual(check.issues, ['invalid-trigger']);
      assert.strictEqual(isRuleConditional(extractFrontmatter(`---\ntrigger: ${trigger}\n---\n`).metadata, 'antigravity'), false);
    }
  });

  test('3. Champs obligatoires : description pour model_decision, globs pour glob, globs en chaîne', () => {
    assert.deepStrictEqual(checkAntigravityRuleFrontmatter('---\ntrigger: model_decision\n---\n# R').issues, ['missing-description']);
    assert.deepStrictEqual(checkAntigravityRuleFrontmatter('---\ntrigger: glob\n---\n# R').issues, ['missing-globs']);
    assert.deepStrictEqual(checkAntigravityRuleFrontmatter('---\ntrigger: glob\nglob: "*.py"\n---\n# R').issues, [], 'glob au singulier est accepté');
    assert.deepStrictEqual(
      checkAntigravityRuleFrontmatter('---\ntrigger: glob\nglobs:\n  - "*.ts"\n---\n# R').issues,
      ['globs-not-string'],
      'La liste YAML n\'est pas un format documenté'
    );
  });

  test('4. Taille : 24 000 octets UTF-8 mesurés après inclusions @[label](path)', async () => {
    const dir = path.join(tempBaseDir, 'size');
    // 13 000 caractères accentués = 26 000 octets : sous la limite en caractères, au-dessus en octets
    const accented = '---\ntrigger: always_on\n---\n' + 'é'.repeat(13000);
    const accentedPath = path.join(dir, 'accents.md');
    await writeFile(accentedPath, accented);
    const accentedInspection = await inspectAntigravityRule(accented, accentedPath);
    assert.ok(accented.length < 24000);
    assert.strictEqual(accentedInspection.warningSizeExceeded, true);

    // Inclusion relative : le frontmatter du fichier inclus est retiré, le contenu compte dans la taille
    await writeFile(path.join(dir, 'docs', 'standards.md'), '---\ntitle: x\n---\n' + 'S'.repeat(20000));
    const withInclude = '---\ntrigger: always_on\n---\n# R\n@[Standards](docs/standards.md)\n' + 'R'.repeat(5000);
    const includePath = path.join(dir, 'include.md');
    await writeFile(includePath, withInclude);
    const expanded = await expandRuleIncludes(withInclude, includePath);
    assert.strictEqual(expanded.includes.length, 1);
    assert.ok(!expanded.content.includes('title: x'), 'Le frontmatter inclus doit être retiré');
    assert.ok(!expanded.content.includes('@[Standards]'));
    const inspection = await inspectAntigravityRule(withInclude, includePath);
    assert.strictEqual(inspection.warningSizeExceeded, true, 'Le contenu inclus compte dans la limite');
    assert.ok(inspection.bodyTokenCount > 0);
    assert.ok(inspection.truncatedBytes > 0, 'Le corps développé dépasse 24 000 octets : il est tronqué');

    // @filename n'est pas développé
    const reference = await expandRuleIncludes('Voir @docs/standards.md', includePath);
    assert.strictEqual(reference.includes.length, 0);
  });

  test('5. LocalScanner : règle sans trigger signalée et exclue du budget', async () => {
    const dir = path.join(tempBaseDir, 'ignored');
    await writeFile(path.join(dir, '.agents', 'rules', 'perm.md'), '---\ntrigger: always_on\ndescription: Permanente\n---\n# Perm\nContenu.');
    await writeFile(path.join(dir, '.agents', 'rules', 'orphan.md'), '# Orpheline\nAucun frontmatter.');
    await writeFile(path.join(dir, '.agents', 'rules', 'camel.md'), '---\ntrigger: alwaysOn\n---\n# Camel');

    const result = await LocalScanner.scan(workspaceFor(dir));
    const orphan = result.items.find((i) => i.id === 'orphan')!;
    const camel = result.items.find((i) => i.id === 'camel')!;
    const perm = result.items.find((i) => i.id === 'perm')!;

    assert.strictEqual(orphan.metadata?.ignoredByAgent, true);
    assert.deepStrictEqual(orphan.metadata?.ruleIssues, ['missing-frontmatter']);
    assert.strictEqual(camel.metadata?.ignoredByAgent, true);
    assert.deepStrictEqual(camel.metadata?.ruleIssues, ['invalid-trigger']);
    assert.strictEqual(perm.metadata?.ignoredByAgent, false);

    assert.strictEqual(result.rulesStat.permanentCount, 1, 'Seule perm.md est permanente');
    assert.strictEqual(result.rulesStat.tokenCount, perm.tokenCount, 'Les règles ignorées ne comptent pas au boot');
    assert.strictEqual(result.rulesStat.warningCount, 2, 'Les deux règles ignorées sont signalées');
  });

  test('6. LocalScanner : warningNoDescription se fonde sur la clé description du frontmatter', async () => {
    const dir = path.join(tempBaseDir, 'description');
    await writeFile(path.join(dir, '.agents', 'rules', 'no-desc.md'), '---\ntrigger: always_on\n---\n# Titre\nUn paragraphe ne remplace pas la description.');
    await writeFile(path.join(dir, '.agents', 'rules', 'with-desc.md'), '---\ntrigger: always_on\ndescription: Résumé\n---\n# Titre');

    const result = await LocalScanner.scan(workspaceFor(dir));
    assert.strictEqual(result.items.find((i) => i.id === 'no-desc')?.metadata?.warningNoDescription, true);
    assert.strictEqual(result.items.find((i) => i.id === 'with-desc')?.metadata?.warningNoDescription, false);
    assert.strictEqual(result.items.find((i) => i.id === 'with-desc')?.description, 'Résumé');
  });

  test('7. LocalScanner : .agents/rules et l\'ancien .agent/rules sont tous deux chargés', async () => {
    const dir = path.join(tempBaseDir, 'legacy');
    await writeFile(path.join(dir, '.agents', 'rules', 'modern.md'), '---\ntrigger: always_on\n---\n# Moderne');
    await writeFile(path.join(dir, '.agent', 'rules', 'legacy.md'), '---\ntrigger: always_on\n---\n# Ancienne');

    const result = await LocalScanner.scan(workspaceFor(dir));
    assert.ok(result.items.some((i) => i.id === 'modern'));
    assert.ok(result.items.some((i) => i.id === '.agent/legacy'), 'La règle de .agent/rules doit être chargée');
    assert.strictEqual(result.rulesStat.permanentCount, 2);
  });

  test('8. LocalScanner : analyse plate de .agents/rules et règles déclarées par rules.json', async () => {
    const dir = path.join(tempBaseDir, 'rules-json');
    await writeFile(path.join(dir, '.agents', 'rules', 'top.md'), '---\ntrigger: always_on\n---\n# Haut');
    await writeFile(path.join(dir, '.agents', 'rules', 'frontend', 'react.md'), '---\ntrigger: glob\nglobs: "*.tsx"\n---\n# React');
    await writeFile(path.join(dir, '.agents', 'rules', 'frontend', 'vue.md'), '---\ntrigger: always_on\n---\n# Vue');
    await writeFile(path.join(dir, 'shared-rules', 'shared.md'), '---\ntrigger: always_on\n---\n# Partagée');
    await writeFile(path.join(dir, 'shared-rules', 'deprecated_rules.md'), '---\ntrigger: always_on\n---\n# Obsolète');
    await writeFile(path.join(dir, 'shared-rules', 'legacy', 'old.md'), '---\ntrigger: always_on\n---\n# Ancienne');

    // Sans rules.json, les sous-dossiers de .agents/rules sont ignorés
    const flat = await LocalScanner.scan(workspaceFor(dir));
    assert.ok(!flat.items.some((i) => i.path.includes('react.md')), 'Antigravity ignore les sous-dossiers de rules/');

    await writeFile(path.join(dir, '.agents', 'rules.json'), JSON.stringify({
      entries: [
        { path: '../shared-rules', exclude: ['deprecated_rules.md', 'legacy/'] },
        { path: 'rules', include_only: ['frontend/react.md'] },
      ],
    }));
    const withJson = await LocalScanner.scan(workspaceFor(dir));
    const ids = withJson.items.filter((i) => i.type === 'rule').map((i) => i.id).sort();
    assert.deepStrictEqual(ids, ['frontend/react', 'shared', 'top']);
    const react = withJson.items.find((i) => i.id === 'frontend/react')!;
    assert.strictEqual(react.metadata?.fromRulesJson, true);
    assert.strictEqual(react.metadata?.isConditional, true, 'Le trigger du fichier déclaré est conservé');
  });

  test('9. LocalScanner : règles de dossier et .agents/AGENTS.md', async () => {
    const dir = path.join(tempBaseDir, 'nested');
    await writeFile(path.join(dir, '.agents', 'AGENTS.md'), '# Instructions racine dans .agents');
    await writeFile(path.join(dir, 'src', 'api', 'AGENTS.md'), '# Règles API\nToujours valider les entrées.');
    await writeFile(path.join(dir, 'src', 'web', '.agents', 'rules', 'ui.md'), '---\ntrigger: always_on\n---\n# UI');
    await writeFile(path.join(dir, 'node_modules', 'pkg', 'AGENTS.md'), '# Ne doit pas être lu');

    const result = await LocalScanner.scan(workspaceFor(dir));
    const soul = result.items.find((i) => i.type === 'soul' && i.id === '.agents/AGENTS.md');
    assert.ok(soul, '.agents/AGENTS.md est une âme du projet');

    // R1 : les règles des sous-dossiers restent visibles mais ne sont jamais chargées
    const api = result.items.find((i) => i.id === 'src/api/AGENTS')!;
    assert.ok(api, 'src/api/AGENTS.md doit être trouvé');
    assert.strictEqual(api.metadata?.directoryScope, 'src/api');
    assert.strictEqual(api.metadata?.ignoredByAgent, false, 'AGENTS.md n\'utilise pas de frontmatter');
    assert.strictEqual(api.metadata?.antigravityStatus, 'never-loaded');

    const ui = result.items.find((i) => i.id === 'src/web/.agents/rules/ui')!;
    assert.ok(ui);
    assert.strictEqual(ui.metadata?.directoryScope, 'src/web');
    assert.strictEqual(ui.metadata?.antigravityStatus, 'never-loaded', 'Même avec un frontmatter valide');

    assert.ok(!result.items.some((i) => i.path.includes('node_modules')));
    assert.strictEqual(result.rulesStat.tokenCount, 0, 'Les règles de dossier ne coûtent rien au démarrage');
    assert.strictEqual(result.rulesStat.activeCount, 0, 'Les règles de dossier ne sont pas actives');
    assert.strictEqual(result.rulesStat.warningCount, 2, 'Elles restent comptées dans les avertissements');
  });

  test('10. GlobalScanner : quatre âmes globales cumulées et ~/.gemini/rules ignoré', async () => {
    const geminiRoot = path.join(tempBaseDir, 'home', '.gemini');
    const configDir = path.join(geminiRoot, 'config');
    await writeFile(path.join(geminiRoot, 'AGENTS.md'), '# A');
    await writeFile(path.join(geminiRoot, 'GEMINI.md'), '# G');
    await writeFile(path.join(configDir, 'AGENTS.md'), '# CA');
    await writeFile(path.join(configDir, 'GEMINI.md'), '# CG');
    await writeFile(path.join(configDir, 'rules', 'global.md'), '---\ntrigger: always_on\n---\n# Globale');
    await writeFile(path.join(geminiRoot, 'rules', 'stray.md'), '---\ntrigger: always_on\n---\n# Non documentée');

    const result = await GlobalScanner.scan(configDir, 'antigravity');
    const soulIds = result.items.filter((i) => i.type === 'soul').map((i) => i.id).sort();
    assert.deepStrictEqual(soulIds, ['AGENTS.md', 'GEMINI.md', 'config/AGENTS.md', 'config/GEMINI.md']);
    assert.ok(result.items.some((i) => i.id === 'global'));
    assert.ok(!result.items.some((i) => i.id === 'stray'), '~/.gemini/rules n\'est pas un emplacement documenté');
  });

  test('11. Import : une règle sans trigger reçoit un trigger valide', () => {
    const plain = ensureAntigravityTrigger('# Règle\nContenu.');
    assert.strictEqual(plain.addedTrigger, 'always_on');
    assert.strictEqual(checkAntigravityRuleFrontmatter(plain.content).ignored, false);

    // R3 : seul le nom de fichier compte ; le dossier est perdu, d'où l'avertissement
    const claude = ensureAntigravityTrigger('---\npaths:\n  - "src/**/*.{ts,tsx}"\n  - "package.json"\n---\n# Règle Claude');
    assert.strictEqual(claude.addedTrigger, 'glob');
    const fm = extractFrontmatter(claude.content).metadata;
    assert.strictEqual(fm.trigger, 'glob');
    assert.strictEqual(fm.globs, '*.ts, *.tsx, package.json');
    assert.match(claude.warnings.join(' '), /Portée élargie/);

    const valid = '---\ntrigger: manual\n---\n# Valide';
    assert.strictEqual(ensureAntigravityTrigger(valid).content, valid, 'Une règle valide est copiée telle quelle');

    assert.throws(() => ensureAntigravityTrigger('---\ntrigger: alwaysOn\n---\n# R'), /trigger/);
  });

  test('12. ImportService : la règle importée dans un projet Antigravity est complétée', async () => {
    const dir = path.join(tempBaseDir, 'import-target');
    const source = path.join(tempBaseDir, 'import-source', 'claude-rule.md');
    await writeFile(source, '---\npaths: "src/**/*.ts"\n---\n# Règle venue de Claude Code');
    await fs.promises.mkdir(dir, { recursive: true });

    const item: ResourceItem = {
      id: 'claude-rule',
      name: 'claude-rule',
      description: '',
      type: 'rule',
      scope: 'nas',
      enabled: true,
      path: source,
      targetTool: 'claude-code',
      isFolder: false,
    };
    const result = await ImportService.importResource(item, 'local', workspaceFor(dir));
    assert.strictEqual(result.success, true, result.error);
    assert.ok(result.notice && result.notice.includes('trigger: glob'));
    const written = await fs.promises.readFile(result.targetPath!, 'utf8');
    assert.strictEqual(checkAntigravityRuleFrontmatter(written).trigger, 'glob');
  });

  // Chantier 2.6.0, lot L7, D-6 : Antigravity IDE 2.6.0 n'injecte jamais une règle glob (phase 2b)
  test('13. Import par profil : paths: en glob en 2.5.5, en model_decision avec les fichiers visés en 2.6.0', () => {
    const corps = '\n# Conventions TypeScript\n\n- Typage strict, aucun any.\n';
    const claude = `---\npaths:\n  - "src/**/*.ts"\n  - "test/**/*.ts"\n---\n${corps}`;

    const v255 = ensureAntigravityTrigger(claude, ANTIGRAVITY_PROFILES['2.5.5']);
    assert.deepStrictEqual(v255, ensureAntigravityTrigger(claude), 'Le profil par défaut est 2.5.5');
    assert.strictEqual(
      v255.content,
      `---\ntrigger: glob\nglobs: "*.ts"\ndescription: "Conventions TypeScript"\npaths:\n  - "src/**/*.ts"\n  - "test/**/*.ts"\n---\n${corps}`
    );
    assert.strictEqual(v255.addedTrigger, 'glob');

    const v260 = ensureAntigravityTrigger(claude, ANTIGRAVITY_PROFILES['2.6.0']);
    const description = 'Conventions TypeScript. À appliquer quand on lit ou modifie des fichiers *.ts dans src/ ou test/ (motifs d\'origine : src/**/*.ts, test/**/*.ts).';
    assert.strictEqual(v260.content, `---\ntrigger: model_decision\ndescription: ${JSON.stringify(description)}\n---\n${corps}`);
    assert.strictEqual(v260.addedTrigger, 'model_decision');
    const fm = extractFrontmatter(v260.content).metadata;
    assert.deepStrictEqual([fm.trigger, fm.description, fm.globs, fm.paths], ['model_decision', description, undefined, undefined]);
    assert.strictEqual(checkAntigravityRuleFrontmatter(v260.content).ignored, false);
    assert.match(v260.warnings.join('\n'), /n'injecte jamais une règle « trigger: glob »/);
    assert.match(v260.warnings.join('\n'), /index d'une règle model_decision .* est mesuré .* n'est que documenté : il n'a pas été testé/);

    // L'exemple de la décision D-6, sans titre ni description d'origine
    const seul = ensureAntigravityTrigger('---\npaths: "src/**/*.ts"\n---\nCorps.', ANTIGRAVITY_PROFILES['2.6.0']);
    assert.strictEqual(
      extractFrontmatter(seul.content).metadata.description,
      'À appliquer quand on lit ou modifie des fichiers *.ts dans src/ (motifs d\'origine : src/**/*.ts).'
    );
    // Une description d'origine est gardée en tête ; un dossier entier et un fichier nommé
    const dossier = ensureAntigravityTrigger(
      '---\ndescription: Règles de la doc.\npaths:\n  - "docs/**"\n  - "package.json"\n---\nCorps.',
      ANTIGRAVITY_PROFILES['2.6.0']
    );
    assert.strictEqual(
      extractFrontmatter(dossier.content).metadata.description,
      'Règles de la doc. À appliquer quand on lit ou modifie des fichiers dans docs/ ou des fichiers package.json (motifs d\'origine : docs/**, package.json).'
    );
    assert.strictEqual((dossier.content.match(/^description:/gm) || []).length, 1, 'Une seule description');

    // Sans paths:, rien ne change ; une règle déjà en glob est copiée telle quelle, avec un avertissement
    assert.deepStrictEqual(
      ensureAntigravityTrigger('# Sans frontmatter\nCorps.', ANTIGRAVITY_PROFILES['2.6.0']),
      ensureAntigravityTrigger('# Sans frontmatter\nCorps.', ANTIGRAVITY_PROFILES['2.5.5'])
    );
    const dejaGlob = '---\ntrigger: glob\nglobs: "*.ts"\ndescription: D.\n---\nCorps.';
    const copie = ensureAntigravityTrigger(dejaGlob, ANTIGRAVITY_PROFILES['2.6.0']);
    assert.strictEqual(copie.content, dejaGlob, 'Rien n\'est converti automatiquement');
    assert.match(copie.warnings.join(' '), /ne l'injecte jamais/);
    assert.deepStrictEqual(ensureAntigravityTrigger(dejaGlob, ANTIGRAVITY_PROFILES['2.5.5']).warnings, []);
  });

  // Chantier 2.6.0, lot L8 : variantes .agent, _agent et _agents (D-8, D-9, D-20, phase 2c)
  test('14. Lot L8 : variantes .agent, _agent et _agents par profil, ordre observé, cohabitation et D-9', async () => {
    const skillContent = (nom: string) => `---\nname: ${nom}\ndescription: Skill ${nom}.\n---\n# ${nom}\n`;

    // 1a. Seulement .agent/ (agentsDir = '.agent') : en 2.5.5 ET en 2.6.0, même ordre, mêmes
    // identifiants sans préfixe pour .agent/rules/ (comme avant L8), mêmes statuts, sans badge
    const seulPointAgent = path.join(tempBaseDir, 'variantes-seul-point-agent');
    await writeFile(path.join(seulPointAgent, '.agent', 'rules', 'r-un.md'), '---\ntrigger: always_on\ndescription: R1\n---\n# R1');
    const pointAgent255 = await LocalScanner.scan(workspaceFor(seulPointAgent, '.agent'), ANTIGRAVITY_PROFILES['2.5.5']);
    const pointAgent260 = await LocalScanner.scan(workspaceFor(seulPointAgent, '.agent'), ANTIGRAVITY_PROFILES['2.6.0']);
    assert.deepStrictEqual(pointAgent255.items.map((i) => i.id), ['r-un'], 'En 2.5.5, .agent/ seul donne l\'identifiant sans préfixe');
    assert.deepStrictEqual(pointAgent260.items.map((i) => i.id), ['r-un'], 'En 2.6.0, l\'identifiant reste stable');
    assert.strictEqual(pointAgent255.items[0].metadata?.antigravityStatus, 'active');
    assert.strictEqual(pointAgent260.items[0].metadata?.antigravityStatus, 'active');
    assert.strictEqual(pointAgent255.items[0].metadata?.unverifiedVariantRule, undefined);
    assert.strictEqual(pointAgent260.items[0].metadata?.unverifiedVariantRule, undefined);
    assert.deepStrictEqual(pointAgent260, pointAgent255, 'Projet n\'ayant que .agent/ : résultat identique dans les deux profils');

    // 1b. Seulement _agent/ et _agents/ (agentsDir = null) : en 2.5.5, rien n'est lu (D-8) ;
    // en 2.6.0, les deux sont lus dans l'ordre _agent, _agents, sans badge pour les règles always_on
    const sansAgents = path.join(tempBaseDir, 'variantes-sans-agents');
    await writeFile(path.join(sansAgents, '_agents', 'rules', 'r-trois.md'), '---\ntrigger: always_on\ndescription: R3\n---\n# R3');
    await writeFile(path.join(sansAgents, '_agent', 'rules', 'r-deux.md'), '---\ntrigger: always_on\ndescription: R2\n---\n# R2');
    await writeFile(path.join(sansAgents, '_agent', 'skills', 's-ignore-1', 'SKILL.md'), skillContent('s-ignore-1'));
    await writeFile(path.join(sansAgents, '_agents', 'skills', 's-ignore-2', 'SKILL.md'), skillContent('s-ignore-2'));

    const sans255 = await LocalScanner.scan(workspaceFor(sansAgents, null), ANTIGRAVITY_PROFILES['2.5.5']);
    assert.deepStrictEqual(sans255.items.filter((i) => i.type === 'rule'), [], 'Profil 2.5.5 : aucune règle lue sous _agent/ ni _agents/ (D-8)');
    assert.deepStrictEqual(sans255.items.filter((i) => i.type === 'skill'), [], 'Profil 2.5.5 : aucun skill sous _agent/ ou _agents/ (D-9)');

    const sans260 = await LocalScanner.scan(workspaceFor(sansAgents, null), ANTIGRAVITY_PROFILES['2.6.0']);
    const reglesSans260 = sans260.items.filter((i) => i.type === 'rule');
    assert.deepStrictEqual(
      reglesSans260.map((i) => i.id),
      ['_agent/r-deux', '_agents/r-trois'],
      'Ordre observé en phase 2c : _agent, _agents'
    );
    assert.ok(
      reglesSans260.every((i) => i.metadata?.unverifiedVariantRule === undefined),
      'Sans .agents/, les règles always_on des variantes sont observées en 2.6.0 : aucune marque non vérifiée'
    );
    assert.strictEqual(sans260.rulesStat.permanentCount, 2);
    assert.strictEqual(sans260.rulesStat.activeCount, 2);
    assert.deepStrictEqual(sans260.items.filter((i) => i.type === 'skill'), [], 'D-9 : aucun skill lu sous _agent/skills/ ni _agents/skills/');

    // Avec les trois variantes (.agent, _agent, _agents) sans .agents/ : ordre .agent, _agent, _agents
    // et une règle non always_on porte unverifiedVariantRule: 'non-always-on'
    await writeFile(path.join(sansAgents, '.agent', 'rules', 'r-un.md'), '---\ntrigger: always_on\ndescription: R1\n---\n# R1');
    await writeFile(
      path.join(sansAgents, '_agent', 'rules', 'r-cond.md'),
      '---\ntrigger: model_decision\ndescription: Conditionnelle dans variante\n---\n# Cond'
    );
    const troisVariantes260 = await LocalScanner.scan(workspaceFor(sansAgents, null), ANTIGRAVITY_PROFILES['2.6.0']);
    assert.deepStrictEqual(
      troisVariantes260.items.filter((i) => i.type === 'rule').map((i) => i.id),
      ['.agent/r-un', '_agent/r-cond', '_agent/r-deux', '_agents/r-trois'],
      'Ordre observé en phase 2c : .agent, _agent, _agents'
    );
    assert.strictEqual(
      troisVariantes260.items.find((i) => i.id === '_agent/r-cond')?.metadata?.unverifiedVariantRule,
      'non-always-on'
    );
    assert.strictEqual(
      troisVariantes260.items.find((i) => i.id === '.agent/r-un')?.metadata?.unverifiedVariantRule,
      undefined
    );

    // 2. Avec .agents/ ET les variantes : cumul par prudence et marque unverifiedVariantRule en 2.6.0 ;
    // une règle sans frontmatter dans _agents/rules/ garde unverifiedVariantRule à undefined (ignoredByAgent vrai) ; D-9 pour .agent/skills/
    const avecAgents = path.join(tempBaseDir, 'variantes-avec-agents');
    await writeFile(path.join(avecAgents, '.agents', 'rules', 'r-zero.md'), '---\ntrigger: always_on\ndescription: R0\n---\n# R0');
    await writeFile(path.join(avecAgents, '.agent', 'rules', 'r-un.md'), '---\ntrigger: always_on\ndescription: R1\n---\n# R1');
    await writeFile(
      path.join(avecAgents, '_agent', 'rules', 'r-cond.md'),
      '---\ntrigger: model_decision\ndescription: Cond\n---\n# Cond'
    );
    await writeFile(path.join(avecAgents, '_agents', 'rules', 'r-trois.md'), '---\ntrigger: always_on\ndescription: R3\n---\n# R3');
    await writeFile(path.join(avecAgents, '_agents', 'rules', 'r-sans-fm.md'), '# Sans frontmatter dans une variante');
    await writeFile(path.join(avecAgents, '.agent', 'skills', 's-legacy', 'SKILL.md'), skillContent('s-legacy'));
    await writeFile(path.join(avecAgents, '_agent', 'skills', 's-ignore-1', 'SKILL.md'), skillContent('s-ignore-1'));
    await writeFile(path.join(avecAgents, '_agents', 'skills', 's-ignore-2', 'SKILL.md'), skillContent('s-ignore-2'));
    await writeFile(path.join(avecAgents, 'src', 'mod', '_agents', 'rules', 'imbriquee.md'), '---\ntrigger: always_on\n---\n# Sous');

    const avec255 = await LocalScanner.scan(workspaceFor(avecAgents, '.agents'), ANTIGRAVITY_PROFILES['2.5.5']);
    assert.deepStrictEqual(
      avec255.items.filter((i) => i.type === 'rule').map((i) => i.id),
      ['r-zero', '.agent/r-un'],
      'Profil 2.5.5 : ni _agent/ ni _agents/ ni sous-dossier _agents/ ne sont lus (D-8)'
    );
    assert.ok(avec255.items.every((i) => i.metadata?.unverifiedVariantRule === undefined), 'Aucune marque unverifiedVariantRule en 2.5.5');
    const skills255 = avec255.items.filter((i) => i.type === 'skill');
    assert.deepStrictEqual(skills255.map((i) => i.id), ['.agent/s-legacy'], 'D-9 en 2.5.5 : seul .agent/skills/ est lu');
    assert.strictEqual(skills255[0].metadata?.legacyLocation, true);

    const avec260 = await LocalScanner.scan(workspaceFor(avecAgents, '.agents'), ANTIGRAVITY_PROFILES['2.6.0']);
    const reglesRacine260 = avec260.items.filter((i) => i.type === 'rule' && !i.metadata?.directoryScope);
    assert.deepStrictEqual(
      reglesRacine260.map((i) => i.id),
      ['r-zero', '.agent/r-un', '_agent/r-cond', '_agents/r-sans-fm', '_agents/r-trois'],
      'Profil 2.6.0 : .agents puis .agent, _agent, _agents dans cet ordre'
    );
    assert.strictEqual(reglesRacine260.find((i) => i.id === 'r-zero')?.metadata?.unverifiedVariantRule, undefined);
    assert.strictEqual(reglesRacine260.find((i) => i.id === '.agent/r-un')?.metadata?.unverifiedVariantRule, 'cohabitation');
    assert.strictEqual(reglesRacine260.find((i) => i.id === '_agent/r-cond')?.metadata?.unverifiedVariantRule, 'both');
    assert.strictEqual(reglesRacine260.find((i) => i.id === '_agents/r-trois')?.metadata?.unverifiedVariantRule, 'cohabitation');
    const sansFmVariante = reglesRacine260.find((i) => i.id === '_agents/r-sans-fm')!;
    assert.strictEqual(sansFmVariante.metadata?.ignoredByAgent, true, 'Une règle sans frontmatter dans _agents/rules/ est ignorée');
    assert.strictEqual(sansFmVariante.metadata?.unverifiedVariantRule, undefined, 'Une règle ignorée ne reçoit pas unverifiedVariantRule');
    assert.strictEqual(avec260.rulesStat.permanentCount, 3);
    assert.strictEqual(avec260.rulesStat.conditionalCount, 1);

    const imbriquee260 = avec260.items.find((i) => i.id === 'src/mod/_agents/rules/imbriquee')!;
    assert.ok(imbriquee260, 'findNestedRuleSources reçoit la liste du profil 2.6.0');
    assert.strictEqual(imbriquee260.metadata?.antigravityStatus, 'never-loaded');

    const skills260 = avec260.items.filter((i) => i.type === 'skill');
    assert.deepStrictEqual(skills260.map((i) => i.id), ['.agent/s-legacy'], 'D-9 en 2.6.0 : seul .agent/skills/ reste lu');
    assert.strictEqual(skills260[0].metadata?.legacyLocation, true);

    // 3. D-20 : dans un projet n'ayant que _agents/ et _agent/, l'import local cible toujours .agents/
    const sourceRule = path.join(tempBaseDir, 'import-d20-source', 'r-import.md');
    await writeFile(sourceRule, '---\ntrigger: always_on\ndescription: Import D-20\n---\n# Import');
    const importRes = await ImportService.importResource(
      {
        id: 'r-import',
        name: 'r-import',
        description: 'Import D-20',
        type: 'rule',
        scope: 'nas',
        enabled: true,
        path: sourceRule,
        targetTool: 'antigravity',
        isFolder: false,
      },
      'local',
      workspaceFor(sansAgents, null)
    );
    assert.strictEqual(importRes.success, true, importRes.error);
    assert.strictEqual(importRes.targetPath, path.join(sansAgents, '.agents', 'rules', 'r-import.md'));
  });

  test('15. Lot L8 : la sauvegarde du banc d\'essai (.banc-essai-sauvegarde/racine/_agents/) n\'est jamais lue, dans aucun profil', async () => {
    const dir = path.join(tempBaseDir, 'sauvegarde-banc-agents');
    await writeFile(
      path.join(dir, '.banc-essai-sauvegarde', 'racine', '_agents', 'rules', '02-rule.md.sauvegarde'),
      '---\ntrigger: always_on\ndescription: Sauvegarde\n---\n# Règle sauvegardée'
    );
    await writeFile(
      path.join(dir, '.banc-essai-sauvegarde', 'racine', '_agents', 'rules', 'fuite.md'),
      '---\ntrigger: always_on\ndescription: Même sans suffixe .sauvegarde\n---\n# Fuite'
    );

    for (const profil of [ANTIGRAVITY_PROFILES['2.5.5'], ANTIGRAVITY_PROFILES['2.6.0']]) {
      const scan = await LocalScanner.scan(workspaceFor(dir, null), profil);
      assert.deepStrictEqual(scan.items, [], `Aucune ressource ne doit être lue depuis .banc-essai-sauvegarde/ (profil ${profil.id})`);
      assert.strictEqual(scan.rulesStat.totalCount, 0);
      assert.strictEqual(scan.rulesStat.tokenCount, 0);
    }
  });
});
