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
require.cache['vscode'] = {
  id: 'vscode',
  filename: 'vscode',
  loaded: true,
  exports: {
    window: {
      createOutputChannel: (name: string) => ({
        appendLine: () => {},
        dispose: () => {},
      }),
      showInformationMessage: () => Promise.resolve(),
      showErrorMessage: () => Promise.resolve(),
      showWarningMessage: () => Promise.resolve(),
    },
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({
        get: (key: string, def: any) => def,
      }),
    },
    env: { appName: 'Antigravity IDE' },
    Uri: {
      file: (f: string) => ({ fsPath: f, scheme: 'file' }),
    },
    commands: {
      executeCommand: () => Promise.resolve(),
    },
  },
} as any;
import { LocalScanner } from '../src/services/LocalScanner';
import { NasScanner } from '../src/services/NasScanner';
import { ImportService } from '../src/services/ImportService';
import { DuplicateService } from '../src/services/DuplicateService';
import { ResourceItem } from '../src/types';

// Tests extraits de test/common-integrity.test.ts (anciennement integrity.test.ts) : titres et numéros d'origine conservés
describe('Suite de Tests : Intégrité Antigravity (âme, isolation, alertes, doublons, concordance)', () => {
  let tempBaseDir: string;
  let localDir: string;

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'test-rules-manager-agy-'));
    localDir = path.join(tempBaseDir, 'local');
    await fs.promises.mkdir(localDir, { recursive: true });
  });

  after(async () => {
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // Tests 9 & 10 : Détection de l'Âme de l'agent et Séparation Métriques
  // --------------------------------------------------------------------------
  test('9. Simulation : Détection de l\'Âme (GEMINI.md racine) comme type "soul" avec badge Always-On', async () => {
    const geminiSoulContent = '# Niveau 0 : Cadre Général\nInstructions fondamentales inviolables de l\'agent.';
    const soulPath = path.join(localDir, 'GEMINI.md');
    await fs.promises.writeFile(soulPath, geminiSoulContent, 'utf8');

    const { LocalScanner } = await import('../src/services/LocalScanner');
    const fakeWorkspace = {
      hasWorkspace: true,
      workspacePath: localDir,
      tool: 'antigravity' as const,
      agentsDir: path.join(localDir, '.agents'),
      claudeDir: null,
      hasClaudeMd: false,
    };

    const scanResult = await LocalScanner.scan(fakeWorkspace);
    const soulItem = scanResult.items.find((i) => i.id === 'GEMINI.md');

    assert.ok(soulItem, 'GEMINI.md doit être présent dans les items scannés');
    assert.strictEqual(soulItem?.type, 'soul', 'Le type de GEMINI.md doit être "soul"');
    assert.strictEqual(soulItem?.metadata?.isSoul, true, 'isSoul doit valoir true');
    assert.strictEqual(soulItem?.metadata?.locked, true, 'locked doit valoir true pour un badge Always-On');
  });

  test('10. Simulation : Les métriques de l\'Âme (soulStat) sont strictement séparées de rulesStat', async () => {
    const { LocalScanner } = await import('../src/services/LocalScanner');
    const agentsRulesDir = path.join(localDir, '.agents', 'rules');
    await fs.promises.mkdir(agentsRulesDir, { recursive: true });
    // Frontmatter valide : sans lui, Antigravity ignorerait la règle (R6) et elle ne serait pas active
    await fs.promises.writeFile(path.join(agentsRulesDir, 'my-modular-rule.md'), '---\ntrigger: always_on\n---\n# Rule\nSome content', 'utf8');

    const fakeWorkspace = {
      hasWorkspace: true,
      workspacePath: localDir,
      tool: 'antigravity' as const,
      agentsDir: path.join(localDir, '.agents'),
      claudeDir: null,
      hasClaudeMd: false,
    };

    const scanResult = await LocalScanner.scan(fakeWorkspace);

    assert.strictEqual(scanResult.soulStat.activeCount, 1, 'Il doit y avoir 1 fichier d\'Âme actif');
    assert.ok(scanResult.soulStat.charCount > 0, 'soulStat doit contenir le nombre de caractères de GEMINI.md');
    assert.ok(scanResult.soulStat.tokenCount > 0, 'soulStat doit contenir les tokens de l\'Âme');

    // Vérifier que la règle modulaire est bien comptabilisée dans rulesStat et non mélangée avec l'Âme
    assert.strictEqual(scanResult.rulesStat.totalCount, 1, 'Il doit y avoir 1 règle modulaire distincte');
    assert.strictEqual(scanResult.rulesStat.activeCount, 1, 'La règle modulaire doit être active');
  });

  // --------------------------------------------------------------------------
  // Tests 11 & 12 : Isolation Contextuelle Stricte (Zéro Pollution)
  // --------------------------------------------------------------------------
  test('11. Isolation Antigravity : en mode tool="antigravity", aucun élément Claude n\'est scanné', async () => {
    const { LocalScanner } = await import('../src/services/LocalScanner');

    // Préparer un dossier .claude et un CLAUDE.md dans le même workspace
    const claudeSoulPath = path.join(localDir, 'CLAUDE.md');
    await fs.promises.writeFile(claudeSoulPath, '# Claude Soul Instructions', 'utf8');

    const claudeDir = path.join(localDir, '.claude');
    const claudeRulesDir = path.join(claudeDir, 'rules');
    await fs.promises.mkdir(claudeRulesDir, { recursive: true });
    await fs.promises.writeFile(path.join(claudeRulesDir, 'claude-specific.md'), '# Claude Only Rule', 'utf8');

    const fakeWorkspaceAntigravity = {
      hasWorkspace: true,
      workspacePath: localDir,
      tool: 'antigravity' as const,
      agentsDir: path.join(localDir, '.agents'),
      claudeDir: claudeDir,
      hasClaudeMd: true,
    };

    const scanResult = await LocalScanner.scan(fakeWorkspaceAntigravity);

    // 1. L'Âme doit être GEMINI.md, pas CLAUDE.md
    const claudeSoul = scanResult.items.find((i) => i.id === 'CLAUDE.md');
    const geminiSoul = scanResult.items.find((i) => i.id === 'GEMINI.md');
    assert.strictEqual(claudeSoul, undefined, 'CLAUDE.md ne doit JAMAIS apparaître en mode Antigravity');
    assert.ok(geminiSoul, 'GEMINI.md doit être présent en mode Antigravity');

    // 2. Aucune règle issue de .claude ne doit être retournée
    const claudeRule = scanResult.items.find((i) => i.id.includes('claude-specific'));
    assert.strictEqual(claudeRule, undefined, 'Les règles de .claude ne doivent jamais apparaître en mode Antigravity');

    // 3. Le tool doit être strictement antigravity
    assert.strictEqual(geminiSoul?.targetTool, 'antigravity');
  });

  // --------------------------------------------------------------------------
  // Test 20 : LocalScanner décompte fin boot (~20 tok) vs permanent & détection plugins
  // --------------------------------------------------------------------------
  test('20. LocalScanner : décompte ~20 tokens pour conditionnelles et scan plugins .agents/plugins', async () => {
    const { LocalScanner } = await import('../src/services/LocalScanner');
    const projectDir = path.join(tempBaseDir, 'test-plugin-workspace');
    await fs.promises.mkdir(path.join(projectDir, '.agents', 'rules'), { recursive: true });
    await fs.promises.mkdir(path.join(projectDir, '.agents', 'plugins', 'my-pack', 'skills', 'pack-skill'), { recursive: true });
    await fs.promises.mkdir(path.join(projectDir, '.agents', 'plugins', 'my-pack', 'rules'), { recursive: true });

    // 1 règle permanente (400 chars -> 100 tok)
    const permContent = '---\ntrigger: always_on\n---\n# Perm Rule\n' + 'A'.repeat(380);
    await fs.promises.writeFile(path.join(projectDir, '.agents', 'rules', 'perm.md'), permContent, 'utf8');

    // 1 règle conditionnelle (1200 chars -> 80 chars au boot ~20 tok, conditionnel = 1200 chars)
    const condContent = `---
description: Test conditionnel
trigger: glob
globs: "*.ts"
---
` + 'B'.repeat(1100);
    await fs.promises.writeFile(path.join(projectDir, '.agents', 'rules', 'cond.md'), condContent, 'utf8');

    // Skill et règle dans le plugin
    await fs.promises.writeFile(
      path.join(projectDir, '.agents', 'plugins', 'my-pack', 'skills', 'pack-skill', 'SKILL.md'),
      '---\nname: pack-skill\ndescription: Skill du plugin\n---\n# Skill',
      'utf8'
    );
    await fs.promises.writeFile(
      path.join(projectDir, '.agents', 'plugins', 'my-pack', 'rules', 'plugin-rule.md'),
      '---\ntrigger: always_on\n---\n# Plugin Rule\nRègle du plugin.',
      'utf8'
    );

    const scanResult = await LocalScanner.scan({
      hasWorkspace: true,
      workspacePath: projectDir,
      tool: 'antigravity',
      agentsDir: '.agents',
      claudeDir: null,
      hasClaudeMd: false,
    });

    assert.strictEqual(scanResult.rulesStat.permanentCount, 2, 'Doit compter 2 règles permanentes (perm.md + plugin-rule.md)');
    assert.strictEqual(scanResult.rulesStat.conditionalCount, 1, 'Doit compter 1 règle conditionnelle (cond.md)');
    assert.ok(scanResult.rulesStat.conditionalTokenCount! > 0, 'Le total de tokens conditionnels doit être calculé');

    const pluginSkill = scanResult.items.find((i) => i.id === 'my-pack:pack-skill');
    assert.ok(pluginSkill, 'Le skill du plugin doit être scanné avec le préfixe my-pack');
    assert.strictEqual(pluginSkill?.metadata?.pluginName, 'my-pack');

    const pluginRule = scanResult.items.find((i) => i.id === 'my-pack:plugin-rule');
    assert.ok(pluginRule, 'La règle du plugin doit être scannée');
    assert.strictEqual(pluginRule?.metadata?.pluginName, 'my-pack');
  });

  // --------------------------------------------------------------------------
  // Tests 21 à 24 : Système d'Alertes Techniques (Coach IA Proactif)
  // --------------------------------------------------------------------------
  test('21. Alertes Lignes : règle Antigravity permanente > 200 lignes de corps (lot A3), Skill > 500 li. détecté', async () => {
    const coachDir = path.join(tempBaseDir, 'coach-lines-test');
    await fs.promises.mkdir(path.join(coachDir, '.agents', 'rules'), { recursive: true });
    await fs.promises.mkdir(path.join(coachDir, '.agents', 'skills', 'skill-large'), { recursive: true });

    // Règle de 250 lignes (> 200)
    const longRuleLines = Array.from({ length: 250 }, (_, i) => `Ligne ${i + 1} de la règle`).join('\n');
    await fs.promises.writeFile(
      path.join(coachDir, '.agents', 'rules', 'rule-long.md'),
      `---\ntrigger: always_on\n---\n# Longue Règle\nDescription de la règle.\n${longRuleLines}`,
      'utf8'
    );

    // Skill de 550 lignes (> 500)
    const longSkillLines = Array.from({ length: 550 }, (_, i) => `Instruction étape ${i + 1}`).join('\n');
    await fs.promises.writeFile(
      path.join(coachDir, '.agents', 'skills', 'skill-large', 'SKILL.md'),
      `---\nname: skill-large\ndescription: Compétence très longue\n---\n# Skill Grand\n${longSkillLines}`,
      'utf8'
    );

    const scanResult = await LocalScanner.scan({
      hasWorkspace: true,
      workspacePath: coachDir,
      tool: 'antigravity',
      agentsDir: '.agents',
      claudeDir: null,
      hasClaudeMd: false,
    });

    const ruleItem = scanResult.items.find((i: ResourceItem) => i.id === 'rule-long');
    assert.ok(ruleItem, 'La règle rule-long doit exister');
    assert.ok(ruleItem?.lineCount! > 200, `lineCount doit dépasser 200 (reçu: ${ruleItem?.lineCount})`);
    // Recommandation du guide (📰📘) : une règle permanente de moins de 200 lignes de corps
    assert.strictEqual(ruleItem?.metadata?.warningLinesExceeded, true, 'Une règle permanente de plus de 200 lignes de corps est signalée');
    assert.deepStrictEqual(ruleItem?.metadata?.sizeAdvice, { kind: 'permanent', lines: 252, maxLines: 200 });

    const skillItem = scanResult.items.find((i: ResourceItem) => i.id === 'skill-large');
    assert.ok(skillItem, 'Le skill skill-large doit exister');
    assert.ok(skillItem?.lineCount! > 500, `lineCount doit dépasser 500 (reçu: ${skillItem?.lineCount})`);
    assert.strictEqual(skillItem?.metadata?.warningLinesExceeded, true, 'warningLinesExceeded doit être true sur skill > 500 lignes');
  });

  test('22. Alertes Poids & Métadonnées : Détecte warningSizeExceeded (> 24 Ko) et warningNoDescription', async () => {
    const warnDir = path.join(tempBaseDir, 'coach-warn-test');
    await fs.promises.mkdir(path.join(warnDir, '.agents', 'rules'), { recursive: true });
    await fs.promises.mkdir(path.join(warnDir, '.agents', 'skills', 'skill-no-desc'), { recursive: true });

    // Règle volumineuse > 24 000 octets
    const heavyContent = '---\ntrigger: always_on\n---\n# Règle Volumineuse\n' + 'X'.repeat(25000);
    await fs.promises.writeFile(path.join(warnDir, '.agents', 'rules', 'rule-heavy.md'), heavyContent, 'utf8');

    // Skill sans champ description dans le frontmatter
    await fs.promises.writeFile(
      path.join(warnDir, '.agents', 'skills', 'skill-no-desc', 'SKILL.md'),
      '---\nname: skill-no-desc\n---\n# Pas de description ici',
      'utf8'
    );

    const scanResult = await LocalScanner.scan({
      hasWorkspace: true,
      workspacePath: warnDir,
      tool: 'antigravity',
      agentsDir: '.agents',
      claudeDir: null,
      hasClaudeMd: false,
    });

    const heavyRule = scanResult.items.find((i: ResourceItem) => i.id === 'rule-heavy');
    assert.strictEqual(heavyRule?.metadata?.warningSizeExceeded, true, 'warningSizeExceeded doit être true pour fichier > 24 Ko sous Antigravity');

    const noDescSkill = scanResult.items.find((i: ResourceItem) => i.id === 'skill-no-desc');
    assert.strictEqual(noDescSkill?.metadata?.warningNoDescription, true, 'warningNoDescription doit être true si le frontmatter omet la description');
  });

  test('24. Aggrégation warningCount : rulesStat et skillsStat cumulent les alertes actives', async () => {
    const aggDir = path.join(tempBaseDir, 'coach-agg-test');
    await fs.promises.mkdir(path.join(aggDir, '.agents', 'rules'), { recursive: true });

    // 2 règles avec alertes (une ignorée faute de trigger, une > 24 Ko) et 1 normale
    const normalRule = '---\ntrigger: always_on\ndescription: Règle normale\n---\n# Règle Normale\nContenu court et propre.';
    const longRule = '---\ndescription: Règle sans trigger\n---\n' + Array.from({ length: 220 }, (_, i) => `Ligne ${i + 1}`).join('\n');
    const heavyRule = '---\ntrigger: always_on\ndescription: Règle lourde\n---\n# Règle Lourde\n' + 'H'.repeat(25000);

    await fs.promises.writeFile(path.join(aggDir, '.agents', 'rules', 'rule-norm.md'), normalRule, 'utf8');
    await fs.promises.writeFile(path.join(aggDir, '.agents', 'rules', 'rule-long.md'), longRule, 'utf8');
    await fs.promises.writeFile(path.join(aggDir, '.agents', 'rules', 'rule-heavy.md'), heavyRule, 'utf8');

    const scanResult = await LocalScanner.scan({
      hasWorkspace: true,
      workspacePath: aggDir,
      tool: 'antigravity',
      agentsDir: '.agents',
      claudeDir: null,
      hasClaudeMd: false,
    });

    assert.strictEqual(scanResult.rulesStat.totalCount, 3);
    assert.strictEqual(scanResult.rulesStat.warningCount, 2, 'rulesStat.warningCount doit être 2 (rule-long ignorée et rule-heavy)');
  });

  test('26. Détection et Import de l\'Âme Réseau (GEMINI.md) via NasScanner et ImportService', async () => {
    const testNas = path.join(tempBaseDir, 'catalogue');
    const testWorkspace = path.join(tempBaseDir, 'ws-soul-test');
    const backupCerveauDir = path.join(tempBaseDir, 'backup_cerveau_ia', '.gemini');

    await fs.promises.mkdir(testNas, { recursive: true });
    await fs.promises.mkdir(backupCerveauDir, { recursive: true });
    await fs.promises.mkdir(path.join(testWorkspace, '.agents'), { recursive: true });

    const soulContent = '# Instructions Maîtresses Réseau Antigravity\nDirectives universelles du cerveau IA.';
    const nasSoulPath = path.join(backupCerveauDir, 'GEMINI.md');
    await fs.promises.writeFile(nasSoulPath, soulContent, 'utf8');

    // 1. Scan via NasScanner
    const scanResult = await NasScanner.scan(testNas, 'antigravity');
    assert.strictEqual(scanResult.status.online, true, 'Le catalogue NAS doit être en ligne');

    const soulItem = scanResult.items.find((i) => i.type === 'soul');
    assert.ok(soulItem, 'L\'Âme Maître GEMINI.md doit être détectée dans le scan NAS');
    assert.strictEqual(soulItem.id, 'GEMINI.md');
    assert.strictEqual(soulItem.scope, 'nas');
    assert.strictEqual(soulItem.metadata?.isSoul, true);
    assert.strictEqual(soulItem.metadata?.locked, true);

    // 2. Importation vers le projet local
    const importRes = await ImportService.importResource(soulItem, 'local', {
      hasWorkspace: true,
      workspacePath: testWorkspace,
      tool: 'antigravity',
      agentsDir: '.agents',
      claudeDir: null,
      hasClaudeMd: false,
    });

    assert.strictEqual(importRes.success, true, 'L\'importation locale doit réussir');
    const importedFile = path.join(testWorkspace, 'GEMINI.md');
    assert.ok(fs.existsSync(importedFile), 'Le fichier GEMINI.md local doit avoir été créé à la racine du workspace');
    const importedContent = await fs.promises.readFile(importedFile, 'utf8');
    assert.strictEqual(importedContent, soulContent, 'Le contenu importé doit être identique mot pour mot');
  });

  test('28. Détection des doublons Global vs Local et calcul des tokens gaspillés (DuplicateService)', async () => {
    const ws = path.join(tempBaseDir, 'ws-dup-test');
    await fs.promises.mkdir(ws, { recursive: true });

    const globalFile = path.join(ws, 'global-rule.md');
    const localFile = path.join(ws, 'local-rule.md');
    const content = '# Règle Commune\nConsigne identique.';
    await fs.promises.writeFile(globalFile, content, 'utf8');
    await fs.promises.writeFile(localFile, content, 'utf8');

    const globalResources: ResourceItem[] = [
      {
        id: 'rule-cole',
        name: 'Protocole Cole',
        description: '',
        type: 'rule',
        scope: 'global',
        enabled: true,
        path: globalFile,
        targetTool: 'antigravity',
        isFolder: false,
        tokenCount: 1055,
        // Coût au démarrage d'une règle permanente (enveloppe F1), porté par toute carte Antigravity
        metadata: { trigger: 'always_on', bootTokenCount: 1055 },
      },
      {
        id: 'rule-unique-global',
        name: 'Règle Globale Seule',
        description: '',
        type: 'rule',
        scope: 'global',
        enabled: true,
        path: globalFile,
        targetTool: 'antigravity',
        isFolder: false,
        tokenCount: 500,
        // Coût au démarrage d'une règle permanente (enveloppe F1), porté par toute carte Antigravity
        metadata: { trigger: 'always_on', bootTokenCount: 500 },
      },
    ];

    const localResources: ResourceItem[] = [
      {
        id: 'rule-cole',
        name: 'Protocole Cole',
        description: '',
        type: 'rule',
        scope: 'local',
        enabled: true,
        path: localFile,
        targetTool: 'antigravity',
        isFolder: false,
        tokenCount: 1055,
        // Coût au démarrage d'une règle permanente (enveloppe F1), porté par toute carte Antigravity
        metadata: { trigger: 'always_on', bootTokenCount: 1055 },
      },
    ];

    const { enrichedGlobal, enrichedLocal, stats } = DuplicateService.detectDuplicates(
      globalResources,
      localResources
    );

    assert.strictEqual(stats.totalDuplicates, 1, 'Exactement 1 paire en double doit être trouvée');
    assert.strictEqual(stats.activeDuplicates, 1, 'La paire doit être active (les 2 sont ON)');
    assert.strictEqual(stats.totalWastedTokens, 1055, 'Doit comptabiliser exactement 1 055 tokens gaspillés');

    const localCole = enrichedLocal.find((r) => r.id === 'rule-cole');
    assert.ok(localCole?.metadata?.duplicateInfo?.hasDuplicate, 'Le jumeau local doit avoir duplicateInfo');
    assert.strictEqual(localCole.metadata.duplicateInfo.bothEnabled, true);
    assert.strictEqual(localCole.metadata.duplicateInfo.isIdentical, true);
    assert.strictEqual(localCole.metadata.duplicateInfo.wastedTokens, 1055);

    const globalCole = enrichedGlobal.find((r) => r.id === 'rule-cole');
    assert.ok(globalCole?.metadata?.duplicateInfo?.hasDuplicate, 'Le jumeau global doit avoir duplicateInfo');
    assert.strictEqual(globalCole.metadata.duplicateInfo.bothEnabled, true);

    const globalSolo = enrichedGlobal.find((r) => r.id === 'rule-unique-global');
    assert.strictEqual(globalSolo?.metadata?.duplicateInfo, undefined, 'La ressource sans jumeau ne doit pas avoir duplicateInfo');
  });

  // --------------------------------------------------------------------------
  // Test 34 : GlobalScanner anti-duplication de candidate dirs (Défaut n°2)
  // --------------------------------------------------------------------------
  test('34. GlobalScanner : aucune duplication de règles ou de tokens lors du scan global', async () => {
    const { GlobalScanner } = await import('../src/services/GlobalScanner');
    const fakeGlobal = path.join(tempBaseDir, 'fake-global-dir', 'config');
    const rulesDir1 = path.join(fakeGlobal, 'rules');
    await fs.promises.mkdir(rulesDir1, { recursive: true });

    const ruleFile = path.join(rulesDir1, 'unique-rule.md');
    await fs.promises.writeFile(ruleFile, '# Titre Règle\nConsigne de test de 100 caractères pour tester le décompte unique.', 'utf8');

    const scanResult = await GlobalScanner.scan(fakeGlobal, 'antigravity');
    const matches = scanResult.items.filter((i) => i.id === 'unique-rule');

    assert.strictEqual(matches.length, 1, 'La règle ne doit apparaître qu\'une seule fois dans les items');
    assert.strictEqual(scanResult.rulesStat.totalCount, 1, 'Le totalCount de règles doit être 1');
  });

  // --------------------------------------------------------------------------
  // Test 42 : Concordance absolue : chaque total de catégorie = somme des cartes
  // --------------------------------------------------------------------------
  test('42. Concordance absolue : chaque total de catégorie est strictement égal à la somme des cartes', async () => {
    const { LocalScanner } = await import('../src/services/LocalScanner');

    const wsDir = path.join(tempBaseDir, 'ws-token-concordance');
    const skillsDir = path.join(wsDir, '.agents', 'skills');
    const rulesDir = path.join(wsDir, '.agents', 'rules');
    await fs.promises.mkdir(path.join(skillsDir, 'skill-alpha'), { recursive: true });
    await fs.promises.mkdir(path.join(skillsDir, 'skill-beta'), { recursive: true });
    await fs.promises.mkdir(rulesDir, { recursive: true });

    // 1. Âme locale
    const soulContent = '# Âme du projet de test\nInstructions prioritaires locales.';
    await fs.promises.writeFile(path.join(wsDir, 'GEMINI.md'), soulContent, 'utf8');

    // 2. Skills
    await fs.promises.writeFile(
      path.join(skillsDir, 'skill-alpha', 'SKILL.md'),
      '---\nname: skill-alpha\ndescription: Premier skill de test\n---\n# Alpha\nContenu du skill alpha.',
      'utf8'
    );
    await fs.promises.writeFile(
      path.join(skillsDir, 'skill-beta', 'SKILL.md'),
      '---\nname: skill-beta\ndescription: Deuxième skill de test avec plus de consignes\n---\n# Beta\nContenu beta détaillé.',
      'utf8'
    );

    // 3. Règles permanentes
    await fs.promises.writeFile(
      path.join(rulesDir, 'rule-perm-one.md'),
      '---\ntrigger: always_on\n---\n# Règle Permanente 1\nDirectives strictes pour le code TypeScript.',
      'utf8'
    );
    await fs.promises.writeFile(
      path.join(rulesDir, 'rule-perm-two.md'),
      '---\ntrigger: always_on\n---\n# Règle Permanente 2\nArchitecture et design patterns recommandés.',
      'utf8'
    );

    // 4. Règle conditionnelle
    await fs.promises.writeFile(
      path.join(rulesDir, 'rule-cond-one.md'),
      '---\ndescription: Règle conditionnelle pour les tests\ntrigger: glob\nglobs: "*.spec.ts"\n---\n# Règle Tests\nConsignes conditionnelles très détaillées.',
      'utf8'
    );

    const scanResult = await LocalScanner.scan({
      hasWorkspace: true,
      workspacePath: wsDir,
      tool: 'antigravity',
      agentsDir: '.agents',
      claudeDir: null,
      hasClaudeMd: false,
    });

    // Extraction des cartes par type
    const skillCards = scanResult.items.filter((i) => (i.type === 'skill' || i.type === 'workflow') && i.enabled);
    const soulCards = scanResult.items.filter((i) => i.type === 'soul' && i.enabled);
    const permRuleCards = scanResult.items.filter((i) => i.type === 'rule' && i.enabled && !i.metadata?.isConditional);
    const condRuleCards = scanResult.items.filter((i) => i.type === 'rule' && i.enabled && i.metadata?.isConditional);

    // Vérification de concordance Skills : total === somme des cartes
    const expectedSkillsTotal = skillCards.reduce((acc, i) => acc + (i.tokenCount || 0), 0);
    assert.strictEqual(
      scanResult.skillsStat.tokenCount,
      expectedSkillsTotal,
      `skillsStat.tokenCount (${scanResult.skillsStat.tokenCount}) doit être STRICTEMENT égal à la somme des cartes (${expectedSkillsTotal})`
    );

    // Vérification de concordance Âme : total === somme des cartes
    const expectedSoulTotal = soulCards.reduce((acc, i) => acc + (i.tokenCount || 0), 0);
    assert.strictEqual(
      scanResult.soulStat.tokenCount,
      expectedSoulTotal,
      `soulStat.tokenCount (${scanResult.soulStat.tokenCount}) doit être STRICTEMENT égal à la somme des cartes (${expectedSoulTotal})`
    );

    // Vérification de concordance Règles conditionnelles : conditionalTokenCount === somme des cartes conditionnelles
    const expectedCondTotal = condRuleCards.reduce((acc, i) => acc + (i.tokenCount || 0), 0);
    assert.strictEqual(
      scanResult.rulesStat.conditionalTokenCount,
      expectedCondTotal,
      `rulesStat.conditionalTokenCount (${scanResult.rulesStat.conditionalTokenCount}) doit être STRICTEMENT égal à la somme des cartes conditionnelles (${expectedCondTotal})`
    );

    // Vérification de concordance Règles au boot : permanentes + coût au démarrage des conditionnelles
    // (Antigravity, lot A2 : entrée d'index pour model_decision, 0 pour glob et manual)
    const expectedRulesBoot = permRuleCards.reduce((acc, i) => acc + (i.tokenCount || 0), 0)
      + condRuleCards.reduce((acc, i) => acc + (i.metadata?.bootTokenCount || 0), 0);
    assert.strictEqual(
      scanResult.rulesStat.tokenCount,
      expectedRulesBoot,
      `rulesStat.tokenCount (${scanResult.rulesStat.tokenCount}) doit être STRICTEMENT égal au boot attendu (${expectedRulesBoot})`
    );
  });
});
