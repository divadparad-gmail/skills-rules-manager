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
import {
  IntegrityService,
  areContentsIdentical,
  normalizeTextContent,
} from '../src/services/IntegrityService';
import { LocalScanner } from '../src/services/LocalScanner';
import { McpScanner } from '../src/services/McpScanner';
import { NasScanner } from '../src/services/NasScanner';
import { ImportService } from '../src/services/ImportService';
import { ScenarioManager } from '../src/services/ScenarioManager';
import { DuplicateService } from '../src/services/DuplicateService';
import { ResourceItem } from '../src/types';

describe('Suite de Tests : Intégrité & Synchronisation NAS vs Local', () => {
  let tempBaseDir: string;
  let nasDir: string;
  let localDir: string;

  before(async () => {
    // Création d'un environnement de simulation temporaire
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'test-rules-manager-'));
    nasDir = path.join(tempBaseDir, 'nas');
    localDir = path.join(tempBaseDir, 'local');

    await fs.promises.mkdir(path.join(nasDir, 'rules'), { recursive: true });
    await fs.promises.mkdir(path.join(localDir, 'rules'), { recursive: true });
    await fs.promises.mkdir(path.join(nasDir, 'skills', 'skill-demo'), { recursive: true });
    await fs.promises.mkdir(path.join(localDir, 'skills', 'skill-demo'), { recursive: true });
  });

  after(async () => {
    // Nettoyage de l'environnement de test
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // Tests 1 & 2 : Comparaison au caractère près et normalisation EOL
  // --------------------------------------------------------------------------
  test('1. areContentsIdentical : détecte l\'égalité parfaite même avec CRLF vs LF', () => {
    const textWindows = 'Line 1\r\nLine 2\r\nLine 3\r\n';
    const textUnix = 'Line 1\nLine 2\nLine 3\n';
    assert.strictEqual(areContentsIdentical(textWindows, textUnix), true);
  });

  test('2. areContentsIdentical : détecte une différence au caractère près', () => {
    const original = '# Ma Règle\nCeci est le texte original.';
    const modified = '# Ma Règle\nCeci est le texte modifié.';
    assert.strictEqual(areContentsIdentical(original, modified), false);
  });

  // --------------------------------------------------------------------------
  // Test 3 : Règle Locale Identique au NAS -> 'synced'
  // --------------------------------------------------------------------------
  test('3. Simulation : Fichier Local Identique au NAS -> statut "synced"', async () => {
    const ruleContent = '# Règle Commune\nContenu identique sur le NAS et en Local.';
    const nasRulePath = path.join(nasDir, 'rules', 'rule-identical.md');
    const localRulePath = path.join(localDir, 'rules', 'rule-identical.md');

    await fs.promises.writeFile(nasRulePath, ruleContent, 'utf8');
    await fs.promises.writeFile(localRulePath, ruleContent, 'utf8');

    const nasItem: ResourceItem = {
      id: 'rule-identical',
      name: 'Règle Identique',
      description: 'Test',
      type: 'rule',
      scope: 'nas',
      enabled: true,
      path: nasRulePath,
      targetTool: 'antigravity',
      isFolder: false,
    };

    const localItem: ResourceItem = {
      id: 'rule-identical',
      name: 'Règle Identique',
      description: 'Test',
      type: 'rule',
      scope: 'local',
      enabled: true,
      path: localRulePath,
      targetTool: 'antigravity',
      isFolder: false,
    };

    const status = await IntegrityService.evaluateSyncStatus(localItem, nasItem);
    assert.strictEqual(status, 'synced', 'Un fichier identique au NAS doit avoir le statut "synced"');
  });

  // --------------------------------------------------------------------------
  // Test 4 : Règle Locale Modifiée manuellement -> 'modified'
  // --------------------------------------------------------------------------
  test('4. Simulation : Fichier Local Modifié manuellement -> statut "modified"', async () => {
    const nasRulePath = path.join(nasDir, 'rules', 'rule-diverged.md');
    const localRulePath = path.join(localDir, 'rules', 'rule-diverged.md');

    await fs.promises.writeFile(nasRulePath, '# Version NAS officielle\nInstructions standard.', 'utf8');
    await fs.promises.writeFile(localRulePath, '# Version Locale modifiée\nInstructions personnalisées.', 'utf8');

    const nasItem: ResourceItem = {
      id: 'rule-diverged',
      name: 'Règle Modifiée',
      description: 'Test',
      type: 'rule',
      scope: 'nas',
      enabled: true,
      path: nasRulePath,
      targetTool: 'antigravity',
      isFolder: false,
    };

    const localItem: ResourceItem = {
      id: 'rule-diverged',
      name: 'Règle Modifiée',
      description: 'Test',
      type: 'rule',
      scope: 'local',
      enabled: true,
      path: localRulePath,
      targetTool: 'antigravity',
      isFolder: false,
    };

    const status = await IntegrityService.evaluateSyncStatus(localItem, nasItem);
    assert.strictEqual(status, 'modified', 'Un fichier modifié localement doit avoir le statut "modified"');
  });

  // --------------------------------------------------------------------------
  // Test 5 : Fichier Local inexistant sur le NAS -> 'local_only'
  // --------------------------------------------------------------------------
  test('5. Simulation : Nouveau fichier purement local (absent du NAS) -> statut "local_only"', async () => {
    const localRulePath = path.join(localDir, 'rules', 'rule-brand-new.md');
    await fs.promises.writeFile(localRulePath, '# Règle 100% locale\nN\'existe pas sur le NAS.', 'utf8');

    const localItem: ResourceItem = {
      id: 'rule-brand-new',
      name: 'Règle Nouvelle',
      description: 'Test',
      type: 'rule',
      scope: 'local',
      enabled: true,
      path: localRulePath,
      targetTool: 'antigravity',
      isFolder: false,
    };

    // Aucun équivalent NAS (undefined)
    const status = await IntegrityService.evaluateSyncStatus(localItem, undefined);
    assert.strictEqual(status, 'local_only', 'Un fichier absent du NAS doit avoir le statut "local_only"');
  });

  // --------------------------------------------------------------------------
  // Test 6 : NAS Hors Ligne -> 'nas_offline'
  // --------------------------------------------------------------------------
  test('6. Simulation : NAS hors ligne (offline) -> statut "nas_offline"', async () => {
    const localItem: ResourceItem = {
      id: 'rule-any',
      name: 'Règle Quelconque',
      description: 'Test',
      type: 'rule',
      scope: 'local',
      enabled: true,
      path: path.join(localDir, 'rules', 'any.md'),
      targetTool: 'antigravity',
      isFolder: false,
    };

    const enriched = await IntegrityService.enrichResourcesWithSyncStatus(
      [localItem],
      [], // liste NAS vide
      false // NAS OFFLINE
    );

    assert.strictEqual(enriched[0].syncStatus, 'nas_offline');
  });

  // --------------------------------------------------------------------------
  // Test 7 : Skill Dossier Local vs NAS Identique vs Modifié
  // --------------------------------------------------------------------------
  test('7. Simulation : Skill dossier identique -> "synced", puis modifié -> "modified"', async () => {
    const nasSkillFolder = path.join(nasDir, 'skills', 'skill-demo');
    const localSkillFolder = path.join(localDir, 'skills', 'skill-demo');

    const skillContent = '---\nname: skill-demo\ndescription: Demo skill\n---\n# Instructions Demo';
    await fs.promises.writeFile(path.join(nasSkillFolder, 'SKILL.md'), skillContent, 'utf8');
    await fs.promises.writeFile(path.join(localSkillFolder, 'SKILL.md'), skillContent, 'utf8');

    const nasItem: ResourceItem = {
      id: 'skill-demo',
      name: 'skill-demo',
      description: 'Demo',
      type: 'skill',
      scope: 'nas',
      enabled: true,
      path: nasSkillFolder,
      targetTool: 'antigravity',
      isFolder: true,
    };

    const localItem: ResourceItem = {
      id: 'skill-demo',
      name: 'skill-demo',
      description: 'Demo',
      type: 'skill',
      scope: 'local',
      enabled: true,
      path: localSkillFolder,
      targetTool: 'antigravity',
      isFolder: true,
    };

    // Cas Identique
    const syncedStatus = await IntegrityService.evaluateSyncStatus(localItem, nasItem);
    assert.strictEqual(syncedStatus, 'synced', 'Skill dossier identique doit être "synced"');

    // Cas Modifié : on altère le SKILL.md local
    await fs.promises.writeFile(
      path.join(localSkillFolder, 'SKILL.md'),
      skillContent + '\n-- Modification locale non poussée au NAS --',
      'utf8'
    );

    const modifiedStatus = await IntegrityService.evaluateSyncStatus(localItem, nasItem);
    assert.strictEqual(modifiedStatus, 'modified', 'Skill dossier altéré doit être "modified"');
  });

  // --------------------------------------------------------------------------
  // Test 8 : Règle désactivée (.md.disabled) mais identique au NAS -> 'synced'
  // --------------------------------------------------------------------------
  test('8. Simulation : Règle sous forme .md.disabled mais identique au NAS -> "synced"', async () => {
    const content = '# Règle Désactivée mais conforme au NAS';
    const nasRulePath = path.join(nasDir, 'rules', 'rule-disabled-test.md');
    const localDisabledRulePath = path.join(localDir, 'rules', 'rule-disabled-test.md.disabled');

    await fs.promises.writeFile(nasRulePath, content, 'utf8');
    await fs.promises.writeFile(localDisabledRulePath, content, 'utf8');

    const nasItem: ResourceItem = {
      id: 'rule-disabled-test',
      name: 'rule-disabled-test',
      description: 'Test',
      type: 'rule',
      scope: 'nas',
      enabled: true,
      path: nasRulePath,
      targetTool: 'antigravity',
      isFolder: false,
    };

    const localItem: ResourceItem = {
      id: 'rule-disabled-test',
      name: 'rule-disabled-test',
      description: 'Test',
      type: 'rule',
      scope: 'local',
      enabled: false,
      path: localDisabledRulePath,
      targetTool: 'antigravity',
      isFolder: false,
    };

    const status = await IntegrityService.evaluateSyncStatus(localItem, nasItem);
    assert.strictEqual(
      status,
      'synced',
      'Même sous extension .disabled, si le contenu est identique au NAS, elle doit être "synced"'
    );
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

  test('12. Isolation Claude Code : en mode tool="claude-code", aucun élément Antigravity n\'est scanné', async () => {
    const { LocalScanner } = await import('../src/services/LocalScanner');

    const fakeWorkspaceClaude = {
      hasWorkspace: true,
      workspacePath: localDir,
      tool: 'claude-code' as const,
      agentsDir: path.join(localDir, '.agents'),
      claudeDir: path.join(localDir, '.claude'),
      hasClaudeMd: true,
    };

    const scanResult = await LocalScanner.scan(fakeWorkspaceClaude);

    // 1. L'Âme doit être CLAUDE.md, pas GEMINI.md
    const geminiSoul = scanResult.items.find((i) => i.id === 'GEMINI.md');
    const claudeSoul = scanResult.items.find((i) => i.id === 'CLAUDE.md');
    assert.strictEqual(geminiSoul, undefined, 'GEMINI.md ne doit JAMAIS apparaître en mode Claude Code');
    assert.ok(claudeSoul, 'CLAUDE.md doit être présent en mode Claude Code');

    // 2. Aucune règle issue de .agents ne doit être retournée
    const agentsRule = scanResult.items.find((i) => i.id.includes('my-modular-rule'));
    assert.strictEqual(agentsRule, undefined, 'Les règles de .agents ne doivent jamais apparaître en mode Claude Code');

    // 3. Le tool doit être strictement claude-code
    assert.strictEqual(claudeSoul?.targetTool, 'claude-code');
  });

  test('13. Scan Global Claude Code : scanne ~/.claude/skills et ~/.claude/rules', async () => {
    const { GlobalScanner } = await import('../src/services/GlobalScanner');
    const result = await GlobalScanner.scan(undefined, 'claude-code');

    // Vérifier que le scanner renvoie les items de Claude Code
    assert.strictEqual(result.soulStat.scope, 'global');
    assert.strictEqual(result.skillsStat.scope, 'global');
    assert.ok(result.skillsStat.directoryPath.includes('.claude'), 'Le dossier des skills doit pointer vers .claude');

    // Vérifier qu'aucun item n'a pour cible Antigravity
    const anyAntigravityItem = result.items.find((i) => i.targetTool === 'antigravity');
    assert.strictEqual(anyAntigravityItem, undefined, 'Aucun élément Antigravity ne doit être scanné en mode Claude Code');
  });

  test('14. MCP Scanner : étanchéité Claude Code (~/.claude.json) vs Antigravity', async () => {
    const { McpScanner } = await import('../src/services/McpScanner');
    const claudeMcpStat = await McpScanner.scanGlobal(undefined, 'claude-code');
    const agyMcpStat = await McpScanner.scanGlobal(undefined, 'antigravity');

    assert.strictEqual(claudeMcpStat.scope, 'global');
    assert.ok(claudeMcpStat.directoryPath.includes('.claude.json'), 'Claude MCP doit inspecter .claude.json');
    assert.ok(agyMcpStat.directoryPath.includes('.gemini'), 'Antigravity MCP doit inspecter le dossier .gemini');
  });

  test('15. Bulk Toggle Workflows : bascule bidirectionnelle (ON -> OFF -> ON)', async () => {
    const { ToggleManager } = await import('../src/services/ToggleManager');
    const wfDir = path.join(localDir, 'skills', 'wf-test-deploy');
    await fs.promises.mkdir(wfDir, { recursive: true });
    const skillMd = path.join(wfDir, 'SKILL.md');
    const skillMdDisabled = path.join(wfDir, 'SKILL.md.disabled');
    await fs.promises.writeFile(skillMd, '# Workflow Test Deploy\nActions de déploiement.', 'utf8');

    const item: ResourceItem = {
      id: 'wf-test-deploy',
      name: 'wf-test-deploy',
      description: 'Test Workflow',
      type: 'workflow',
      scope: 'local',
      enabled: true,
      path: wfDir,
      targetTool: 'antigravity',
      isFolder: true,
    };

    // 1er clic : désactiver
    const res1 = await ToggleManager.bulkToggle([item], 'local', 'workflow');
    assert.strictEqual(res1.targetState, false, 'Le 1er clic doit désactiver le workflow actif');
    assert.strictEqual(res1.modifiedCount, 1);
    assert.ok(fs.existsSync(skillMdDisabled), 'SKILL.md.disabled doit exister');
    assert.ok(!fs.existsSync(skillMd), 'SKILL.md ne doit plus exister');

    // Mettre à jour l'état de l'item simulé
    item.enabled = false;
    item.path = skillMdDisabled;

    // 2ème clic : réactiver (le bug initial était qu'il ne se réactivait pas !)
    const res2 = await ToggleManager.bulkToggle([item], 'local', 'workflow');
    assert.strictEqual(res2.targetState, true, 'Le 2ème clic doit réactiver les workflows désactivés');
    assert.strictEqual(res2.modifiedCount, 1);
    assert.ok(fs.existsSync(skillMd), 'SKILL.md doit être réactivé');
    assert.ok(!fs.existsSync(skillMdDisabled), 'SKILL.md.disabled ne doit plus exister');
  });

  test('16. Bulk Toggle Règles : activation et désactivation en masse des règles', async () => {
    const { ToggleManager } = await import('../src/services/ToggleManager');
    const ruleFile = path.join(localDir, 'rules', 'rule-bulk-test.md');
    const ruleFileDisabled = `${ruleFile}.disabled`;
    await fs.promises.writeFile(ruleFile, '# Règle Bulk\nContenu test.', 'utf8');

    const item: ResourceItem = {
      id: 'rule-bulk-test',
      name: 'rule-bulk-test',
      description: 'Test Rule',
      type: 'rule',
      scope: 'local',
      enabled: true,
      path: ruleFile,
      targetTool: 'antigravity',
      isFolder: false,
    };

    // Forcer OFF
    const resOff = await ToggleManager.bulkToggle([item], 'local', 'rule', false);
    assert.strictEqual(resOff.targetState, false);
    assert.ok(fs.existsSync(ruleFileDisabled));

    item.enabled = false;
    item.path = ruleFileDisabled;

    // Forcer ON
    const resOn = await ToggleManager.bulkToggle([item], 'local', 'rule', true);
    assert.strictEqual(resOn.targetState, true);
    assert.ok(fs.existsSync(ruleFile));
  });

  test('17. Extraction hôte UNC : extrait correctement l\'hôte du NAS pour security.allowedUNCHosts', async () => {
    const { NasScanner } = await import('../src/services/NasScanner');
    assert.strictEqual(NasScanner.getUncHost('\\\\serveur\\partage\\catalogue'), 'serveur');
    assert.strictEqual(NasScanner.getUncHost('//SERVEUR/partage/dossier'), 'serveur');
    assert.strictEqual(NasScanner.getUncHost('C:\\Users\\LocalUser'), null);
  });

  test('18. Guide & Bonnes Pratiques IA (v0.3.12) : intégrité des templates et composants webview', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.version, '0.3.12', 'package.json doit être en version 0.3.12');

    const sidebarHtml = fs.readFileSync(path.join(rootDir, 'src/webview/sidebar.html'), 'utf8');
    const dashboardHtml = fs.readFileSync(path.join(rootDir, 'src/webview/dashboard.html'), 'utf8');
    const cheatsheetHtml = fs.readFileSync(path.join(rootDir, 'src/webview/cheatsheet.html'), 'utf8');
    const cheatsheetJs = fs.readFileSync(path.join(rootDir, 'src/webview/cheatsheet.js'), 'utf8');
    const stylesCss = fs.readFileSync(path.join(rootDir, 'src/webview/styles.css'), 'utf8');
    const mainJs = fs.readFileSync(path.join(rootDir, 'src/webview/main.js'), 'utf8');

    // Vérification de la Mini-Carte dans la sidebar
    assert.ok(sidebarHtml.includes('id="cheatSheetCard"'), 'sidebar.html doit contenir cheatSheetCard');
    assert.ok(sidebarHtml.includes('btnOpenCheatSheet'), 'sidebar.html doit contenir btnOpenCheatSheet');
    assert.ok(sidebarHtml.includes('pillClaude'), 'sidebar.html doit contenir pillClaude');
    assert.ok(sidebarHtml.includes('pillAntigravity'), 'sidebar.html doit contenir pillAntigravity');

    // Vérification du contrôle interactif Chrono & Diagnostic dans Banc d'Essai
    assert.ok(sidebarHtml.includes('id="btnToggleDebugTiming"'), 'sidebar.html doit contenir btnToggleDebugTiming');
    assert.ok(sidebarHtml.includes('id="timingConsoleWrapper"'), 'sidebar.html doit contenir timingConsoleWrapper');
    assert.ok(sidebarHtml.includes('id="timingConsoleOutput"'), 'sidebar.html doit contenir timingConsoleOutput');
    assert.ok(sidebarHtml.includes('id="btnClearTimingLogs"'), 'sidebar.html doit contenir btnClearTimingLogs');
    assert.ok(stylesCss.includes('.timing-toggle-pill'), 'styles.css doit contenir .timing-toggle-pill');
    assert.ok(stylesCss.includes('.timing-console-wrapper'), 'styles.css doit contenir .timing-console-wrapper');
    assert.ok(mainJs.includes('btnToggleDebugTiming'), 'main.js doit gérer btnToggleDebugTiming');

    // Vérification de la page cheatsheet.html (onglet plein éditeur à droite)
    assert.ok(cheatsheetHtml.includes('modalTabClaude'), 'cheatsheet.html doit contenir modalTabClaude');
    assert.ok(cheatsheetHtml.includes('modalTabAntigravity'), 'cheatsheet.html doit contenir modalTabAntigravity');
    assert.ok(cheatsheetHtml.includes('contentClaude'), 'cheatsheet.html doit contenir contentClaude');
    assert.ok(cheatsheetHtml.includes('contentAntigravity'), 'cheatsheet.html doit contenir contentAntigravity');
    assert.ok(cheatsheetHtml.includes('Comment se calcule le total de tokens des règles (Claude Code)'), 'cheatsheet.html doit expliquer le calcul tokens Claude');
    assert.ok(cheatsheetHtml.includes('Comment se calcule le total de tokens des règles (Antigravity)'), 'cheatsheet.html doit expliquer le calcul tokens Antigravity');
    assert.ok(cheatsheetHtml.includes('workspace-tool-pills'), 'cheatsheet.html doit utiliser le style pilules workspace-tool-pills');

    // Guide Antigravity (chantier B) : contenu vérifié par la suite de régression du 2026-10-21
    const antigravityHtml = cheatsheetHtml.slice(cheatsheetHtml.indexOf('id="contentAntigravity"'));
    assert.ok(antigravityHtml.includes('Antigravity IDE 2.5.5, Windows'), 'le guide Antigravity doit indiquer sa portée');
    assert.ok(antigravityHtml.includes('❔ non vérifié'), 'le guide Antigravity doit contenir la légende des sources');
    assert.ok(antigravityHtml.includes('id="ag-piege-glob"'), 'le guide Antigravity doit contenir la section « Le piège glob »');
    assert.ok(antigravityHtml.includes('Workflows (obsolètes)'), 'le tableau Antigravity doit contenir la ligne Workflows');
    assert.ok(antigravityHtml.includes('globs: "*.ts, *.tsx"'), 'le guide Antigravity doit proposer un exemple glob sur le nom de fichier');
    assert.ok(antigravityHtml.includes('À revoir</strong> — contredit par les tests (2026-10-21)'), 'les phrases conservées contredites doivent être signalées');
    assert.ok(!antigravityHtml.includes('architecture hybride transparente'), 'la note MCP infondée doit être supprimée');
    assert.ok(!antigravityHtml.includes('src/components/**/*.tsx'), "l'exemple glob avec dossier (jamais déclenché) doit être supprimé");
    assert.ok(!antigravityHtml.includes('nom-pack:skill'), 'le préfixe de plugin infondé doit être supprimé');
    assert.ok(!mainJs.includes('MCP illimité'), 'la carte résumée Antigravity ne doit plus annoncer MCP illimité');
    assert.ok(!mainJs.includes('Imbrication en sous-dossier'), 'la carte résumée Antigravity ne doit plus annoncer les sous-dossiers');

    // Vérification du script cheatsheet.js
    assert.ok(cheatsheetJs.includes('switchTab'), 'cheatsheet.js doit gérer switchTab');
    assert.ok(cheatsheetJs.includes('btn-copy-code'), 'cheatsheet.js doit gérer btn-copy-code');

    // Vérification des pilules de bascule CLAUDE / ANTIGRAVITY dans l'en-tête
    assert.ok(sidebarHtml.includes('workspace-tool-pills'), 'sidebar.html doit contenir workspace-tool-pills');
    assert.ok(sidebarHtml.includes('pillWorkspaceClaudeSidebar'), 'sidebar.html doit contenir pillWorkspaceClaudeSidebar');
    assert.ok(sidebarHtml.includes('pillWorkspaceAntigravitySidebar'), 'sidebar.html doit contenir pillWorkspaceAntigravitySidebar');
    assert.ok(dashboardHtml.includes('workspace-tool-pills'), 'dashboard.html doit contenir workspace-tool-pills');
    assert.ok(dashboardHtml.includes('pillWorkspaceClaudeDash'), 'dashboard.html doit contenir pillWorkspaceClaudeDash');
    assert.ok(dashboardHtml.includes('pillWorkspaceAntigravityDash'), 'dashboard.html doit contenir pillWorkspaceAntigravityDash');

    // Vérification des libellés précis Âme (global) et (local) sans 'l'
    assert.ok(sidebarHtml.includes('Âme (global)'), 'sidebar.html doit contenir Âme (global)');
    assert.ok(sidebarHtml.includes('Âme (local)'), 'sidebar.html doit contenir Âme (local)');
    assert.ok(!sidebarHtml.includes("l'Âme Globale"), "sidebar.html ne doit plus contenir l'Âme Globale");
    assert.ok(dashboardHtml.includes('Âme (global)'), 'dashboard.html doit contenir Âme (global)');
    assert.ok(dashboardHtml.includes('Âme (local)'), 'dashboard.html doit contenir Âme (local)');
    assert.ok(dashboardHtml.includes('Âme (total)'), 'dashboard.html doit contenir Âme (total)');

    // Vérification des styles et scripts
    assert.ok(stylesCss.includes('.cheat-sheet-card'), 'styles.css doit styliser .cheat-sheet-card');
    assert.ok(stylesCss.includes('.cs-pill'), 'styles.css doit styliser .cs-pill');
    assert.ok(stylesCss.includes('.workspace-tool-pills'), 'styles.css doit styliser .workspace-tool-pills');
    assert.ok(stylesCss.includes('.tool-pill'), 'styles.css doit styliser .tool-pill');
    assert.ok(stylesCss.includes('.btn-cheatsheet-toggle'), 'styles.css doit styliser .btn-cheatsheet-toggle');
    assert.ok(stylesCss.includes('.cheatsheet-container'), 'styles.css doit styliser .cheatsheet-container');
    assert.ok(mainJs.includes('renderCheatSheetCard'), 'main.js doit inclure renderCheatSheetCard');
    assert.ok(mainJs.includes('openCheatSheet'), 'main.js doit gérer openCheatSheet');
    assert.ok(mainJs.includes('toggleCheatSheet'), 'main.js doit gérer toggleCheatSheet');
    assert.ok(mainJs.includes('.tool-pill'), 'main.js doit écouter .tool-pill');
  });

  // --------------------------------------------------------------------------
  // Test 19 : Détection des règles conditionnelles (paths Claude vs trigger Antigravity)
  // --------------------------------------------------------------------------
  test('19. isRuleConditional : gère paths: Claude Code et trigger/globs Antigravity', async () => {
    const { isRuleConditional, extractFrontmatter, checkAntigravityRuleFrontmatter } = await import('../src/utils/frontmatter');

    // Claude Code avec paths
    const claudeRuleContent = `---
description: Règle API backend
paths:
  - "src/api/**/*.ts"
---
# Règle API`;
    const claudeFm = extractFrontmatter(claudeRuleContent).metadata;
    assert.strictEqual(isRuleConditional(claudeFm, 'claude-code'), true, 'Claude Code avec paths doit être conditionnel');
    assert.strictEqual(isRuleConditional(claudeFm, 'antigravity'), false, 'paths seul ne doit pas être conditionnel pour Antigravity');

    // Antigravity avec trigger: glob et globs
    const agyGlobRule = `---
description: Règle frontend
trigger: glob
globs: "*.tsx, *.jsx"
---
# Règle Frontend`;
    const agyFm = extractFrontmatter(agyGlobRule).metadata;
    assert.strictEqual(isRuleConditional(agyFm, 'antigravity'), true, 'Antigravity avec trigger: glob doit être conditionnel');
    assert.strictEqual(isRuleConditional(agyFm, 'claude-code'), false, 'trigger: glob ne doit pas impacter Claude Code');

    // Antigravity sans trigger : la règle n'est ni permanente ni conditionnelle, Antigravity l'ignore
    const agyNoTrigger = `---
description: Règle sans trigger
---
# Règle Standard`;
    const noTriggerFm = extractFrontmatter(agyNoTrigger).metadata;
    assert.strictEqual(isRuleConditional(noTriggerFm, 'antigravity'), false, 'Sans trigger, la règle Antigravity n\'est pas conditionnelle');
    assert.strictEqual(checkAntigravityRuleFrontmatter(agyNoTrigger).ignored, true, 'Sans trigger, Antigravity ignore la règle');

    // Antigravity avec trigger: always_on : permanente
    const agyAlwaysOn = `---
description: Règle toujours active
trigger: always_on
---
# Règle Standard`;
    const alwaysFm = extractFrontmatter(agyAlwaysOn).metadata;
    assert.strictEqual(isRuleConditional(alwaysFm, 'antigravity'), false, 'trigger: always_on rend la règle permanente');
    assert.strictEqual(checkAntigravityRuleFrontmatter(agyAlwaysOn).ignored, false);
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

  test('23. Alertes Claude Code MCP : Détecte la troncature > 2 048 car. par outil dans McpScanner', async () => {
    const claudeWsDir = path.join(tempBaseDir, 'claude-mcp-test');
    await fs.promises.mkdir(claudeWsDir, { recursive: true });

    // Fichier .mcp.json avec un serveur normal et un serveur dépassant 2048 caractères
    const normalServer = { command: 'node', args: ['server.js'] };
    const oversizedServer = {
      command: 'npx',
      args: ['-y', 'my-huge-mcp'],
      env: { HUGE_PROMPT: 'A'.repeat(2100) },
    };

    const mcpJson = {
      mcpServers: {
        normal: normalServer,
        oversized: oversizedServer,
      },
    };

    await fs.promises.writeFile(path.join(claudeWsDir, '.mcp.json'), JSON.stringify(mcpJson, null, 2), 'utf8');

    const mcpStat = await McpScanner.scanLocal({
      hasWorkspace: true,
      workspacePath: claudeWsDir,
      tool: 'claude-code',
      agentsDir: null,
      claudeDir: '.claude',
      hasClaudeMd: true,
    });

    assert.strictEqual(mcpStat.activeCount, 2, 'Doit compter 2 serveurs MCP');
    assert.strictEqual(mcpStat.warningCount, 1, 'Doit détecter exactement 1 serveur MCP dépassant 2 048 caractères');
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

  test('25. Chemins Universels : détection dynamique du profil hôte sans hardcoding', async () => {
    const {
      getUserHome,
      getDefaultGlobalAntigravityPath,
      getDefaultGlobalClaudePath,
      getEffectiveGlobalAntigravityPath,
      getEffectiveGlobalClaudePath,
    } = await import('../src/utils/paths');

    const home = getUserHome();
    assert.ok(home && home.length > 0, 'getUserHome doit renvoyer un chemin utilisateur non vide');

    const defaultAgy = getDefaultGlobalAntigravityPath();
    assert.ok(defaultAgy.includes('.gemini'), 'Le chemin Antigravity par défaut doit contenir .gemini');
    assert.ok(defaultAgy.includes('config'), 'Le chemin Antigravity par défaut doit contenir config');

    const defaultClaude = getDefaultGlobalClaudePath();
    assert.ok(defaultClaude.includes('.claude'), 'Le chemin Claude par défaut doit contenir .claude');

    // Test de priorité si un chemin custom est passé
    const customTestPath = path.join(home, 'custom', 'gemini');
    const effectiveAgy = getEffectiveGlobalAntigravityPath(customTestPath);
    assert.strictEqual(effectiveAgy, customTestPath, 'Le chemin custom doit prévaloir sur le chemin par défaut');

    // Test sans custom path : doit basculer sur le défaut dynamique
    const effectiveDefaultAgy = getEffectiveGlobalAntigravityPath();
    assert.strictEqual(effectiveDefaultAgy, defaultAgy, 'Doit basculer sur le chemin dynamique sans paramètre');

    const effectiveDefaultClaude = getEffectiveGlobalClaudePath();
    assert.strictEqual(effectiveDefaultClaude, defaultClaude, 'Doit basculer sur le chemin Claude dynamique sans paramètre');
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

  test('27. Protection lors du "Vider" : préserve les fichiers modifiés ou locaux et supprime les synchronisés', async () => {
    const ws = path.join(tempBaseDir, 'ws-smart-clean');
    const rulesDir = path.join(ws, '.agents', 'rules');
    await fs.promises.mkdir(rulesDir, { recursive: true });

    const syncedFile = path.join(rulesDir, 'rule-synced.md');
    const modifiedFile = path.join(rulesDir, 'rule-modified.md');
    const localOnlyFile = path.join(rulesDir, 'rule-custom.md');

    await fs.promises.writeFile(syncedFile, 'Content A', 'utf8');
    await fs.promises.writeFile(modifiedFile, 'Content B Modified', 'utf8');
    await fs.promises.writeFile(localOnlyFile, 'Content C Custom', 'utf8');

    const localItems: ResourceItem[] = [
      {
        id: 'rule-synced',
        name: 'rule-synced',
        description: '',
        type: 'rule',
        scope: 'local',
        enabled: true,
        path: syncedFile,
        targetTool: 'antigravity',
        isFolder: false,
        syncStatus: 'synced',
      },
      {
        id: 'rule-modified',
        name: 'rule-modified',
        description: '',
        type: 'rule',
        scope: 'local',
        enabled: true,
        path: modifiedFile,
        targetTool: 'antigravity',
        isFolder: false,
        syncStatus: 'modified',
      },
      {
        id: 'rule-custom',
        name: 'rule-custom',
        description: '',
        type: 'rule',
        scope: 'local',
        enabled: true,
        path: localOnlyFile,
        targetTool: 'antigravity',
        isFolder: false,
        syncStatus: 'local_only',
      },
    ];

    const cleanResult = await ScenarioManager.clean(ws, 'all', localItems);

    assert.strictEqual(cleanResult.deletedCount, 1, 'Exactement 1 fichier synchronisé doit être supprimé');
    assert.strictEqual(cleanResult.preservedCount, 2, '2 fichiers non synchronisés doivent être préservés');
    assert.deepStrictEqual(cleanResult.preservedNames, ['rule-modified', 'rule-custom']);

    assert.strictEqual(fs.existsSync(syncedFile), false, 'Le fichier synchronisé doit être supprimé du disque');
    assert.strictEqual(fs.existsSync(modifiedFile), true, 'Le fichier modifié doit TOUJOURS exister sur le disque');
    assert.strictEqual(fs.existsSync(localOnlyFile), true, 'Le fichier purement local doit TOUJOURS exister sur le disque');
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

  test('29. Banc d\'essai (Doublon) : rule-test-doublon est supprimé par clean() même sous statut local_only', async () => {
    const ws = path.join(tempBaseDir, 'ws-dup-clean');
    const agentsRules = path.join(ws, '.agents', 'rules');
    await fs.promises.mkdir(agentsRules, { recursive: true });

    const dupFile = path.join(agentsRules, 'rule-test-doublon.md');
    const protectedFile = path.join(agentsRules, 'rule-custom-perso.md');
    await fs.promises.writeFile(dupFile, '# Doublon test\nConsigne de test.', 'utf8');
    await fs.promises.writeFile(protectedFile, '# Règle perso non synchro', 'utf8');

    const localItems: ResourceItem[] = [
      {
        id: 'rule-test-doublon',
        name: 'rule-test-doublon',
        description: '',
        type: 'rule',
        scope: 'local',
        enabled: true,
        path: dupFile,
        targetTool: 'antigravity',
        isFolder: false,
        syncStatus: 'local_only', // Bien que local_only, c'est le fichier du banc d'essai
      },
      {
        id: 'rule-custom-perso',
        name: 'rule-custom-perso',
        description: '',
        type: 'rule',
        scope: 'local',
        enabled: true,
        path: protectedFile,
        targetTool: 'antigravity',
        isFolder: false,
        syncStatus: 'local_only', // Vraie règle locale non synchronisée -> doit être préservée
      },
    ];

    const cleanResult = await ScenarioManager.clean(ws, 'all', localItems);

    assert.strictEqual(fs.existsSync(dupFile), false, 'rule-test-doublon doit avoir été supprimé par le nettoyage du banc d\'essai');
    assert.strictEqual(fs.existsSync(protectedFile), true, 'rule-custom-perso doit impérativement être préservé');
    assert.strictEqual(cleanResult.preservedCount, 1);
    assert.deepStrictEqual(cleanResult.preservedNames, ['rule-custom-perso']);
  });

  test('30. Banc d\'essai : Détection étanche des scénarios (manifeste & fixtures) et protection d\'un vrai fichier contenant "test"', async () => {
    const ws = path.join(tempBaseDir, 'ws-scenario-manifest-clean');
    const agentsRules = path.join(ws, '.agents', 'rules');
    await fs.promises.mkdir(agentsRules, { recursive: true });

    // 1. Déploiement d'un scénario via ScenarioManager
    // On simule des fixtures présentes dans le manifeste
    const fixture1 = path.join(agentsRules, '02-rule-perm-standard-always-on.md');
    const fixture2 = path.join(agentsRules, '03-rule-cond-trigger-glob.md');
    const userTestRule = path.join(agentsRules, 'rule-test-unitaire-critique.md');

    await fs.promises.writeFile(fixture1, '---\nscenario_fixture: true\n---\n# Fixture 1', 'utf8');
    await fs.promises.writeFile(fixture2, '# Fixture 2', 'utf8');
    await fs.promises.writeFile(userTestRule, '# Règle de test unitaire personnelle de l\'utilisateur', 'utf8');

    // On écrit le manifeste du scénario contenant fixture1 et fixture2, mais PAS userTestRule
    const manifestPath = path.join(ws, ScenarioManager.MANIFEST_FILE);
    await fs.promises.writeFile(
      manifestPath,
      JSON.stringify({
        target: 'all',
        deployedAt: new Date().toISOString(),
        files: ['.agents/rules/02-rule-perm-standard-always-on.md', '.agents/rules/03-rule-cond-trigger-glob.md'],
      }),
      'utf8'
    );

    const localItems: ResourceItem[] = [
      {
        id: '02-rule-perm-standard-always-on',
        name: '02-rule-perm-standard-always-on',
        description: '',
        type: 'rule',
        scope: 'local',
        enabled: true,
        path: fixture1,
        targetTool: 'antigravity',
        isFolder: false,
        syncStatus: 'local_only',
        metadata: { scenario_fixture: true },
      },
      {
        id: '03-rule-cond-trigger-glob',
        name: '03-rule-cond-trigger-glob',
        description: '',
        type: 'rule',
        scope: 'local',
        enabled: true,
        path: fixture2,
        targetTool: 'antigravity',
        isFolder: false,
        syncStatus: 'local_only',
      },
      {
        id: 'rule-test-unitaire-critique',
        name: 'rule-test-unitaire-critique',
        description: 'Vrai fichier portant le mot test',
        type: 'rule',
        scope: 'local',
        enabled: true,
        path: userTestRule,
        targetTool: 'antigravity',
        isFolder: false,
        syncStatus: 'local_only', // NON présent sur le NAS, et NON issu du scénario -> DOIT ÊTRE PROTÉGÉ !
      },
    ];

    const cleanResult = await ScenarioManager.clean(ws, 'all', localItems);

    // Assertions
    assert.strictEqual(fs.existsSync(fixture1), false, 'La fixture 1 du scénario doit être nettoyée');
    assert.strictEqual(fs.existsSync(fixture2), false, 'La fixture 2 listée au manifeste doit être nettoyée');
    assert.strictEqual(fs.existsSync(userTestRule), true, 'Le vrai fichier portant "test" doit être STRICTEMENT PROTÉGÉ');
    assert.strictEqual(cleanResult.deletedCount, 2, 'Exactement 2 fixtures doivent avoir été supprimées');
    assert.strictEqual(cleanResult.preservedCount, 1, '1 vrai fichier utilisateur doit être préservé');
    assert.deepStrictEqual(cleanResult.preservedNames, ['rule-test-unitaire-critique']);
  });

  test('31. Banc d\'essai : GEMINI.md fixture a une description propre, isScenarioFixture=true et est supprimable', async () => {
    const ws = path.join(tempBaseDir, 'scenario-soul-test');
    await fs.promises.mkdir(ws, { recursive: true });

    const geminiPath = path.join(ws, 'GEMINI.md');
    await fs.promises.writeFile(
      geminiPath,
      '---\nscenario_fixture: true\n---\n\n# Instructions Maîtresses Locales Antigravity (Niveau 1 Projet)\n\nCe fichier représente l\'Âme locale du projet pour Google Antigravity IDE.\n',
      'utf8'
    );

    const scanResult = await LocalScanner.scan({
      hasWorkspace: true,
      workspacePath: ws,
      tool: 'antigravity',
      agentsDir: '.agents',
      claudeDir: null,
      hasClaudeMd: false,
    });

    const soulItem = scanResult.items.find((i: ResourceItem) => i.id === 'GEMINI.md');
    assert.ok(soulItem, 'GEMINI.md doit être scanné');
    assert.strictEqual(
      soulItem.metadata?.isScenarioFixture,
      true,
      'GEMINI.md contenant scenario_fixture: true doit avoir isScenarioFixture: true'
    );
    assert.ok(
      !soulItem.description.includes('scenario_fixture'),
      'La description ne doit JAMAIS contenir "scenario_fixture: true"'
    );
    assert.strictEqual(
      soulItem.description,
      "Ce fichier représente l'Âme locale du projet pour Google Antigravity IDE."
    );

    // Test de suppression via clean()
    soulItem.syncStatus = 'modified'; // Simule la différence avec le NAS
    const cleanResult = await ScenarioManager.clean(ws, 'antigravity', [soulItem]);
    assert.strictEqual(fs.existsSync(geminiPath), false, 'GEMINI.md de scénario doit être nettoyé');
    assert.strictEqual(cleanResult.deletedCount, 1, 'GEMINI.md doit être comptabilisé dans deletedCount');
    assert.strictEqual(cleanResult.preservedCount, 0, 'Aucun fichier ne doit être préservé');
  });

  // --------------------------------------------------------------------------
  // Test 32 : Protection de ScenarioManager.clean contre la destruction récursive
  // --------------------------------------------------------------------------
  test('32. Sécurité Banc d\'essai : clean() ne supprime JAMAIS récursivement .agents ou le travail du dev', async () => {
    const ws = path.join(tempBaseDir, 'ws-safe-clean-no-nuke');
    const userRulesDir = path.join(ws, '.agents', 'rules');
    const userSkillDir = path.join(ws, '.agents', 'skills', 'mon-skill', 'scripts');
    await fs.promises.mkdir(userRulesDir, { recursive: true });
    await fs.promises.mkdir(userSkillDir, { recursive: true });

    const userRule = path.join(userRulesDir, 'mon-guide-perso.md');
    const userSkillMd = path.join(ws, '.agents', 'skills', 'mon-skill', 'SKILL.md');
    const userScript = path.join(userSkillDir, 'helper.sh');
    const realGeminiMd = path.join(ws, 'GEMINI.md');

    await fs.promises.writeFile(userRule, '# Règle personnelle de dev', 'utf8');
    await fs.promises.writeFile(userSkillMd, '# Skill personnel de dev', 'utf8');
    await fs.promises.writeFile(userScript, '#!/bin/bash\necho "ok"', 'utf8');
    await fs.promises.writeFile(realGeminiMd, '# Vrai GEMINI.md du projet sans fixture', 'utf8');

    // Appel de clean sans manifest et sans localItems (le cas qui détruisait tout avant la correction !)
    const cleanResult = await ScenarioManager.clean(ws, 'all');

    // Vérification de survie absolue
    assert.strictEqual(fs.existsSync(userRule), true, 'La règle utilisateur doit TOUJOURS exister');
    assert.strictEqual(fs.existsSync(userSkillMd), true, 'Le skill utilisateur doit TOUJOURS exister');
    assert.strictEqual(fs.existsSync(userScript), true, 'Le script annexe utilisateur doit TOUJOURS exister');
    assert.strictEqual(fs.existsSync(realGeminiMd), true, 'Le GEMINI.md utilisateur doit TOUJOURS exister');
    assert.strictEqual(fs.existsSync(path.join(ws, '.agents')), true, 'Le dossier .agents doit TOUJOURS exister');
    assert.strictEqual(cleanResult.deletedCount, 0, 'Aucun fichier utilisateur ne doit être supprimé');
  });

  // --------------------------------------------------------------------------
  // Test 33 : Nettoyage ciblé du scénario sans localItems via le manifeste
  // --------------------------------------------------------------------------
  test('33. Nettoyage ciblé du scénario sans localItems : supprime uniquement les fichiers du manifeste', async () => {
    const ws = path.join(tempBaseDir, 'ws-manifest-targeted-clean');
    const rulesDir = path.join(ws, '.agents', 'rules');
    await fs.promises.mkdir(rulesDir, { recursive: true });

    const fixtureRule = path.join(rulesDir, 'fixture-rule.md');
    const userRule = path.join(rulesDir, 'user-rule.md');
    await fs.promises.writeFile(fixtureRule, '# Fixture', 'utf8');
    await fs.promises.writeFile(userRule, '# Vrai travail', 'utf8');

    const manifestPath = path.join(ws, ScenarioManager.MANIFEST_FILE);
    const manifestData = {
      target: 'antigravity',
      deployedAt: new Date().toISOString(),
      files: ['.agents/rules/fixture-rule.md'],
    };
    await fs.promises.writeFile(manifestPath, JSON.stringify(manifestData), 'utf8');

    // Exécution du nettoyage sans localItems
    const cleanResult = await ScenarioManager.clean(ws, 'antigravity');

    assert.strictEqual(fs.existsSync(fixtureRule), false, 'La fixture listée au manifeste doit être supprimée');
    assert.strictEqual(fs.existsSync(userRule), true, 'Le fichier utilisateur hors manifeste doit être préservé');
    assert.strictEqual(fs.existsSync(manifestPath), false, 'Le manifeste doit être nettoyé');
    assert.strictEqual(cleanResult.deletedCount, 1, 'Exactement 1 fichier de manifeste supprimé');
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
  // Test 35 : DuplicateService étanchéité par référence et type (Défaut n°3)
  // --------------------------------------------------------------------------
  test('35. DuplicateService : association étanche entre même type (skill vs skill, rule vs rule)', () => {
    const { DuplicateService } = require('../src/services/DuplicateService');

    const localSkill: ResourceItem = {
      id: 'deploy',
      name: 'Deploy Skill',
      description: '',
      type: 'skill',
      scope: 'local',
      enabled: true,
      path: '/loc/skills/deploy',
      targetTool: 'antigravity',
      isFolder: true,
      tokenCount: 50,
    };

    const localRule: ResourceItem = {
      id: 'deploy',
      name: 'Deploy Rule',
      description: '',
      type: 'rule',
      scope: 'local',
      enabled: true,
      path: '/loc/rules/deploy.md',
      targetTool: 'antigravity',
      isFolder: false,
      tokenCount: 100,
    };

    const globalSkill: ResourceItem = {
      id: 'deploy',
      name: 'Deploy Skill Twin',
      description: '',
      type: 'skill',
      scope: 'global',
      enabled: true,
      path: '/glob/skills/deploy',
      targetTool: 'antigravity',
      isFolder: true,
      tokenCount: 50,
    };

    const result = DuplicateService.detectDuplicates([globalSkill], [localSkill, localRule]);
    assert.strictEqual(result.stats.totalDuplicates, 1, 'Seul le skill doit matcher avec le skill');
    assert.strictEqual(result.enrichedLocal.length, 2, 'Il doit y avoir 2 items locaux');
    const skillRes = result.enrichedLocal.find((i: ResourceItem) => i.type === 'skill');
    const ruleRes = result.enrichedLocal.find((i: ResourceItem) => i.type === 'rule');
    assert.ok(skillRes, 'skillRes doit exister');
    assert.ok(ruleRes, 'ruleRes doit exister');
    assert.strictEqual(skillRes.metadata?.duplicateInfo?.hasDuplicate, true, 'Le skill local a un doublon');
    assert.strictEqual(ruleRes.metadata?.duplicateInfo?.hasDuplicate, undefined, 'La règle avec le même ID ne doit PAS être polluée');
  });

  // --------------------------------------------------------------------------
  // Test 36 : extractFrontmatter avec tirets dans le texte (Défaut n°4)
  // --------------------------------------------------------------------------
  test('36. extractFrontmatter : supporte les tirets dans les descriptions sans tronquer prématurément', () => {
    const { extractFrontmatter } = require('../src/utils/frontmatter');

    const sample = `---
name: rule-robust
description: Règle avec des tirets --- au milieu de sa description
trigger: glob
globs: "*.ts"
---

# Titre du Document
Corps du texte.`;

    const parsed = extractFrontmatter(sample);
    assert.strictEqual(parsed.metadata.name, 'rule-robust');
    assert.strictEqual(parsed.metadata.description, 'Règle avec des tirets --- au milieu de sa description');
    assert.strictEqual(parsed.metadata.trigger, 'glob');
    assert.strictEqual(parsed.metadata.globs, '*.ts');
    assert.ok(parsed.body.includes('# Titre du Document'), 'Le corps doit être préservé après le vrai délimiteur de fermeture');
  });

  // --------------------------------------------------------------------------
  // Test 37 : NasScanner sécurité et annulation de timer (Défauts n°5 et n°6)
  // --------------------------------------------------------------------------
  test('37. NasScanner.checkNasAccess : retourne available: false sans faux positif et libère le timer', async () => {
    const { NasScanner } = await import('../src/services/NasScanner');

    const nonExistentPath = path.join(tempBaseDir, 'chemin_qui_n_existe_pas_du_tout_12345');
    const result = await NasScanner.checkNasAccess(nonExistentPath, 500);

    assert.strictEqual(result.available, false, 'Un dossier inexistant doit retourner available: false');
    assert.ok(result.error, 'Un message d\'erreur explicite doit être fourni');
  });

  // --------------------------------------------------------------------------
  // Test 38 : ToggleManager symétrie sur formats divers sans forcer .md (Défaut n°8)
  // --------------------------------------------------------------------------
  test('38. ToggleManager : bascule symétrique de fichiers personnalisés sans forcer .md', async () => {
    const { ToggleManager } = await import('../src/services/ToggleManager');
    const testDir = path.join(tempBaseDir, 'ws-toggle-custom-ext');
    await fs.promises.mkdir(testDir, { recursive: true });

    const txtFile = path.join(testDir, 'instructions.txt');
    const txtDisabled = path.join(testDir, 'instructions.txt.disabled');
    await fs.promises.writeFile(txtFile, 'Consignes en texte brut', 'utf8');

    const itemTxt: ResourceItem = {
      id: 'instructions',
      name: 'instructions.txt',
      description: '',
      type: 'rule',
      scope: 'local',
      enabled: true,
      path: txtFile,
      targetTool: 'antigravity',
      isFolder: false,
    };

    // 1. Désactiver -> doit créer instructions.txt.disabled (et NON instructions.txt.md.disabled !)
    await ToggleManager.bulkToggle([itemTxt], 'local', 'rule', false);
    assert.strictEqual(fs.existsSync(txtDisabled), true, 'instructions.txt.disabled doit exister');
    assert.strictEqual(fs.existsSync(txtFile), false, 'instructions.txt doit avoir été renommé');

    // 2. Réactiver -> doit retrouver instructions.txt
    itemTxt.path = txtDisabled;
    itemTxt.enabled = false;
    await ToggleManager.bulkToggle([itemTxt], 'local', 'rule', true);
    assert.strictEqual(fs.existsSync(txtFile), true, 'instructions.txt doit être restauré avec son extension d\'origine');
    assert.strictEqual(fs.existsSync(txtDisabled), false, 'instructions.txt.disabled ne doit plus exister');
  });

  // --------------------------------------------------------------------------
  // Test 39 : Tokenizer BPE (o200k_base via gpt-tokenizer) et repli heuristique
  // --------------------------------------------------------------------------
  test('39. Tokenizer : countTokens utilise BPE o200k_base avec repli sur Math.ceil(length/4)', () => {
    const { countTokens } = require('../src/utils/tokenizer');

    // Cas limites textuels
    assert.strictEqual(countTokens(null), 0);
    assert.strictEqual(countTokens(''), 0);
    assert.strictEqual(countTokens(undefined), 0);

    // Décompte BPE réel vérifié (gpt-tokenizer o200k_base)
    assert.strictEqual(countTokens('abcd'), 1);
    assert.strictEqual(countTokens('Hello, world!'), 4);
    assert.strictEqual(countTokens('Bonjour le monde !'), 4);
    assert.strictEqual(countTokens('a'.repeat(400)), 50); // BPE regroupe les motifs répétitifs
  });

  // --------------------------------------------------------------------------
  // Test 40 : Durcissement clean() : jamais de suppression récursive de dossier sans localItems
  // --------------------------------------------------------------------------
  test('40. Sécurité ScenarioManager.clean() sans localItems : ne supprime JAMAIS de dossier utilisateur non vide', async () => {
    const ws = path.join(tempBaseDir, 'ws-clean-hardening');
    const userFolder = path.join(ws, '.agents', 'my-custom-skills');
    await fs.promises.mkdir(userFolder, { recursive: true });

    // Fichier de travail utilisateur qui ne doit JAMAIS disparaître
    const userFile = path.join(userFolder, 'SKILL.md');
    await fs.promises.writeFile(userFile, '# Mon skill utilisateur précieux\nNe pas supprimer !', 'utf8');

    // Sous-dossier utilisateur additionnel
    const nestedUserFolder = path.join(userFolder, 'scripts');
    await fs.promises.mkdir(nestedUserFolder, { recursive: true });
    const userScript = path.join(nestedUserFolder, 'build.sh');
    await fs.promises.writeFile(userScript, '#!/bin/bash\necho "test"', 'utf8');

    // On crée aussi un fichier racine utilisateur
    const userDoc = path.join(ws, 'DOCUMENTATION.md');
    await fs.promises.writeFile(userDoc, '# Doc importante', 'utf8');

    // Création d'une structure simulée de test/scenarios dans le workspace qui déclare des dossiers
    const scenariosBaseDir = path.join(ws, 'test', 'scenarios');
    await fs.promises.mkdir(scenariosBaseDir, { recursive: true });

    // Appel de ScenarioManager.clean() SANS localItems
    await ScenarioManager.clean(ws, 'antigravity');

    // Vérification absolue : les dossiers et fichiers utilisateur sont 100% préservés
    assert.strictEqual(fs.existsSync(userFile), true, 'Le fichier utilisateur ne doit jamais être supprimé');
    assert.strictEqual(fs.existsSync(userScript), true, 'Le script utilisateur imbriqué ne doit jamais être supprimé');
    assert.strictEqual(fs.existsSync(userFolder), true, 'Le dossier utilisateur ne doit jamais être supprimé');
    assert.strictEqual(fs.existsSync(nestedUserFolder), true, 'Le sous-dossier utilisateur ne doit jamais être supprimé');
    assert.strictEqual(fs.existsSync(userDoc), true, 'Le document utilisateur racine ne doit jamais être supprimé');
  });

  // --------------------------------------------------------------------------
  // Test 41 : Centralisation stricte des tokens : zéro Math.ceil(/4) hors tokenizer.ts
  // --------------------------------------------------------------------------
  test('41. Centralisation des tokens : aucun Math.ceil(.../4) résiduel dans le code source hors de tokenizer.ts', () => {
    const srcDir = path.resolve(__dirname, '../../src');

    function scanFiles(dir: string): string[] {
      const results: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...scanFiles(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const allSourceFiles = scanFiles(srcDir);
    const violatingFiles: Array<{ file: string; line: number; content: string }> = [];

    for (const filePath of allSourceFiles) {
      const normalizedPath = filePath.replace(/\\/g, '/');
      if (normalizedPath.endsWith('src/utils/tokenizer.ts')) {
        continue; // Seul point autorisé
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('Math.ceil') && line.includes('/ 4') && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
          violatingFiles.push({ file: path.relative(srcDir, filePath), line: i + 1, content: line.trim() });
        }
      }
    }

    assert.deepStrictEqual(
      violatingFiles,
      [],
      `Aucun Math.ceil(.../4) ne doit subsister hors de tokenizer.ts. Fichiers en faute : ${JSON.stringify(violatingFiles)}`
    );
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

  // --------------------------------------------------------------------------
  // Test 43 : Cache de décompte de tokens par (chemin + mtime + taille)
  // --------------------------------------------------------------------------
  test('43. Tokenizer Cache : deux appels identiques = 1 seul encodage, invalidation sur mtime/taille', async () => {
    const {
      countTokensForFile,
      clearTokenCache,
      resetTokenizerMetrics,
      getTokenizerMetrics,
      getTokenCacheSize,
    } = await import('../src/utils/tokenizer');

    clearTokenCache();
    resetTokenizerMetrics();

    const dummyFile = path.join(tempBaseDir, 'cached-token-file.md');
    const content1 = '# Titre 1\nContenu court pour tester le cache de décompte BPE o200k.';
    await fs.promises.writeFile(dummyFile, content1, 'utf8');
    const stat1 = await fs.promises.stat(dummyFile);

    // 1er appel : Cache Miss -> Doit encoder
    const count1 = countTokensForFile(dummyFile, stat1.size, stat1.mtimeMs, content1);
    assert.ok(count1 > 0);
    let metrics = getTokenizerMetrics();
    assert.strictEqual(metrics.encodedCount, 1, '1er appel doit encoder');
    assert.strictEqual(metrics.cachedCount, 0, '1er appel ne doit pas être servi du cache');
    assert.strictEqual(getTokenCacheSize(), 1, 'Le cache doit contenir 1 entrée');

    // 2ème appel avec mêmes (chemin, mtime, taille) : Cache Hit -> Ne doit PAS ré-encoder
    const count2 = countTokensForFile(dummyFile, stat1.size, stat1.mtimeMs, content1);
    assert.strictEqual(count2, count1, 'Le résultat doit être identique');
    metrics = getTokenizerMetrics();
    assert.strictEqual(metrics.encodedCount, 1, 'encodedCount ne doit pas avoir augmenté');
    assert.strictEqual(metrics.cachedCount, 1, 'cachedCount doit être passé à 1');

    // 3ème appel après modification du mtime : Cache Invalidation -> Ré-encodage
    const newMtime = stat1.mtimeMs + 5000;
    const count3 = countTokensForFile(dummyFile, stat1.size, newMtime, content1);
    assert.strictEqual(count3, count1);
    metrics = getTokenizerMetrics();
    assert.strictEqual(metrics.encodedCount, 2, 'Un changement de mtime doit forcer le ré-encodage');
    assert.strictEqual(metrics.cachedCount, 1);

    // 4ème appel après modification du contenu/taille : Cache Invalidation -> Ré-encodage
    const content2 = '# Titre 1\nContenu beaucoup plus long qui modifie la taille du fichier.';
    await fs.promises.writeFile(dummyFile, content2, 'utf8');
    const stat2 = await fs.promises.stat(dummyFile);
    const count4 = countTokensForFile(dummyFile, stat2.size, stat2.mtimeMs, content2);
    assert.ok(count4 !== count1);
    metrics = getTokenizerMetrics();
    assert.strictEqual(metrics.encodedCount, 3, 'Un changement de taille doit forcer le ré-encodage');
  });

  // --------------------------------------------------------------------------
  // Test 44 : Repli / chargement paresseux et résilience de gpt-tokenizer
  // --------------------------------------------------------------------------
  test('44. Tokenizer Lazy & Fallback : vrai BPE quand dispo, repli Math.ceil(length/4) sans crash si indisponible', async () => {
    const {
      countTokens,
      warmupTokenizer,
      _setEncoderForTesting,
      _resetEncoderStateForTesting,
    } = await import('../src/utils/tokenizer');

    // 1. Sans préchauffage explicite préalable, countTokens fonctionne sans planter
    const sampleText = 'Antigravity IDE et Claude Code partagent des règles modulaires.';
    const normalCount = countTokens(sampleText);
    assert.ok(normalCount > 0, 'countTokens doit renvoyer un décompte valide');

    // 2. Le préchauffage warmupTokenizer s\'exécute sans erreur
    assert.doesNotThrow(() => {
      warmupTokenizer();
    });

    // 3. Simulation d\'échec de require(\'gpt-tokenizer\')
    _setEncoderForTesting(null, true);
    const fallbackCount = countTokens(sampleText);
    const expectedFallback = Math.ceil(sampleText.length / 4);
    assert.strictEqual(
      fallbackCount,
      expectedFallback,
      `En cas d'échec de l'encodeur, doit basculer sur Math.ceil(length / 4) = ${expectedFallback}`
    );

    // 4. Aucun crash si du texte vide ou null est passé
    assert.strictEqual(countTokens(''), 0);
    assert.strictEqual(countTokens(null), 0);
    assert.strictEqual(countTokens(undefined), 0);

    // Rétablissement de l\'état initial
    _resetEncoderStateForTesting();
    const restoredCount = countTokens(sampleText);
    assert.strictEqual(restoredCount, normalCount, 'L\'encodeur normal doit être rétabli');
  });

  // --------------------------------------------------------------------------
  // Test 45 : Utilitaire de Debounce pour rafales de FileSystemWatcher
  // --------------------------------------------------------------------------
  test('45. Debounce Utility : une rafale de N appels rapprochés ne déclenche l\'exécution qu\'une seule fois', async () => {
    const { debounce } = await import('../src/utils/debounce');

    let executionCount = 0;
    let lastValue = '';

    const debouncedFn = debounce((val: string) => {
      executionCount++;
      lastValue = val;
    }, 50);

    // Rafale de 10 appels rapprochés
    for (let i = 1; i <= 10; i++) {
      debouncedFn(`call-${i}`);
    }

    assert.strictEqual(debouncedFn.pending(), true, 'Le debounce doit être en attente');
    assert.strictEqual(executionCount, 0, 'La fonction ne doit pas encore avoir été exécutée');

    // Attente du déclenchement
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.strictEqual(debouncedFn.pending(), false, 'Le debounce ne doit plus être en attente');
    assert.strictEqual(executionCount, 1, 'La fonction ne doit avoir été exécutée qu\'une seule fois pour toute la rafale');
    assert.strictEqual(lastValue, 'call-10', 'La dernière valeur transmise doit avoir été conservée');

    // Test de la méthode cancel()
    debouncedFn('will-be-cancelled');
    assert.strictEqual(debouncedFn.pending(), true);
    debouncedFn.cancel();
    assert.strictEqual(debouncedFn.pending(), false);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.strictEqual(executionCount, 1, 'Un appel annulé ne doit pas s\'exécuter');

    // Test de la méthode flush()
    debouncedFn('flushed-call');
    debouncedFn.flush();
    assert.strictEqual(executionCount, 2, 'flush() doit forcer l\'exécution immédiate');
    assert.strictEqual(lastValue, 'flushed-call');
  });

  // --------------------------------------------------------------------------
  // Test 46 : Journal de performance StateManager et non-régression concordance
  // --------------------------------------------------------------------------
  test('46. Journal de durée de scan StateManager & non-régression concordance cartes-totaux avec cache actif', async () => {
    const { StateManager } = await import('../src/services/StateManager');
    const { clearTokenCache } = await import('../src/utils/tokenizer');

    clearTokenCache();
    StateManager.setDebugTimingForTesting(true);

    // Exécution du scan
    const state1 = await StateManager.loadFullState(true);
    assert.ok(state1, 'Le scan doit réussir');
    assert.ok(StateManager.lastTimingLog, 'Un log de timing doit avoir été produit');

    // Format exact : Scan terminé en {total} ms — {N} fichiers, {E} encodés, {C} servis du cache, encodage cumulé {Y} ms.
    const timingRegex = /^Scan terminé en \d+ ms — \d+ fichiers, \d+ encodés, \d+ servis du cache, encodage cumulé \d+ ms\.$/;
    assert.match(
      StateManager.lastTimingLog,
      timingRegex,
      `Le log généré ("${StateManager.lastTimingLog}") doit correspondre exactement au format requis`
    );

    // 2ème scan consécutif (sans modification) : les fichiers doivent être servis du cache
    await StateManager.loadFullState(true);
    assert.ok(StateManager.lastTimingLog, 'Un second log doit avoir été produit');
    assert.match(StateManager.lastTimingLog, timingRegex);

    // Non-régression : concordance cartes-totaux (identique au Test 42)
    const wsDir = path.join(tempBaseDir, 'ws-concordance-test-46');
    await fs.promises.mkdir(path.join(wsDir, '.agents', 'skills', 'skill-demo'), { recursive: true });
    await fs.promises.mkdir(path.join(wsDir, '.agents', 'rules'), { recursive: true });
    await fs.promises.writeFile(
      path.join(wsDir, '.agents', 'skills', 'skill-demo', 'SKILL.md'),
      '---\nname: skill-demo\ndescription: Test skill cache\n---\n# Demo\nTest content.',
      'utf8'
    );
    await fs.promises.writeFile(
      path.join(wsDir, '.agents', 'rules', 'rule-perm.md'),
      '---\ntrigger: always_on\n---\n# Règle Permanente\nContenu permanent testé.',
      'utf8'
    );
    await fs.promises.writeFile(
      path.join(wsDir, '.agents', 'rules', 'rule-cond.md'),
      '---\ndescription: Cond\ntrigger: glob\nglobs: "*.ts"\n---\n# Cond\nContenu conditionnel.',
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

    const skillCards = scanResult.items.filter((i) => (i.type === 'skill' || i.type === 'workflow') && i.enabled);
    const permRuleCards = scanResult.items.filter((i) => i.type === 'rule' && i.enabled && !i.metadata?.isConditional);
    const condRuleCards = scanResult.items.filter((i) => i.type === 'rule' && i.enabled && i.metadata?.isConditional);

    const expectedSkillsTotal = skillCards.reduce((acc, i) => acc + (i.tokenCount || 0), 0);
    assert.strictEqual(scanResult.skillsStat.tokenCount, expectedSkillsTotal);

    const expectedCondTotal = condRuleCards.reduce((acc, i) => acc + (i.tokenCount || 0), 0);
    assert.strictEqual(scanResult.rulesStat.conditionalTokenCount, expectedCondTotal);

    const expectedRulesBoot = permRuleCards.reduce((acc, i) => acc + (i.tokenCount || 0), 0)
      + condRuleCards.reduce((acc, i) => acc + (i.metadata?.bootTokenCount || 0), 0);
    assert.strictEqual(scanResult.rulesStat.tokenCount, expectedRulesBoot);

    // Nettoyage de l'override de test
    StateManager.setDebugTimingForTesting(null);
  });

  // --------------------------------------------------------------------------
  // Test 47 : Contrôle Interactif du Chrono Anti-Lag (Bouton ON/OFF + Terminal)
  // --------------------------------------------------------------------------
  test('47. Chrono & Diagnostic Interactif : setDebugTiming bascule isDebugTiming, clearTimingLogs vide l\'historique', async () => {
    const { StateManager } = await import('../src/services/StateManager');

    // 1. Activation interactive du debug timing
    await StateManager.setDebugTiming(true);
    let state = await StateManager.loadFullState(true);
    assert.strictEqual(state.isDebugTiming, true, 'state.isDebugTiming doit être activé');
    assert.ok(state.lastTimingLog, 'state.lastTimingLog doit contenir le rapport du scan');
    assert.ok(state.timingHistory && state.timingHistory.length > 0, 'state.timingHistory doit contenir au moins 1 entrée');

    // 2. Vidage de l'historique via clearTimingLogs()
    StateManager.clearTimingLogs();
    assert.strictEqual(StateManager.getTimingHistory().length, 0, 'getTimingHistory doit être vide après clear');
    assert.strictEqual(StateManager.lastTimingLog, null, 'lastTimingLog doit être null après clear');

    // 3. Désactivation interactive
    await StateManager.setDebugTiming(false);
    state = await StateManager.loadFullState(true);
    assert.strictEqual(state.isDebugTiming, false, 'state.isDebugTiming doit être désactivé');

    // Nettoyage de l'override de test
    StateManager.setDebugTimingForTesting(null);
  });

  // --------------------------------------------------------------------------
  // Test 48 : FileSystemWatcher - Couverture des fichiers Âme racine & dossiers
  // --------------------------------------------------------------------------
  test('48. FileSystemWatcher : motifs distincts pour dossiers (.agents/.claude) et fichiers âme racine (CLAUDE/GEMINI/AGENTS)', async () => {
    const { WATCHER_PATTERNS } = await import('../src/extension');

    // 1. Vérification des motifs exportés
    assert.strictEqual(
      WATCHER_PATTERNS.configFolders,
      '**/{.agents,.agent,.claude}/**',
      'Le watcher des dossiers de config doit surveiller tout le contenu de .agents, .agent et .claude'
    );
    assert.strictEqual(
      WATCHER_PATTERNS.soulFiles,
      '**/{CLAUDE.md,GEMINI.md,AGENTS.md}',
      'Le watcher des âmes doit cibler spécifiquement les fichiers CLAUDE.md, GEMINI.md et AGENTS.md sans suffixe /**'
    );

    // 2. Vérification que l'ancien motif avec /** ne pouvait pas matcher les fichiers racine
    const oldRegex = /^.*[\\/](?:\.agents|\.agent|\.claude|CLAUDE\.md|GEMINI\.md)[\\/].+$/i;
    assert.strictEqual(oldRegex.test('CLAUDE.md'), false, 'L\'ancien motif échouait sur CLAUDE.md à la racine');
    assert.strictEqual(oldRegex.test('C:/project/CLAUDE.md'), false, 'L\'ancien motif échouait sur C:/project/CLAUDE.md');

    // 3. Vérification du nouveau motif soulFiles sur les fichiers isolés
    const soulRegex = /(?:^|[\\/])(CLAUDE\.md|GEMINI\.md|AGENTS\.md)$/i;
    assert.strictEqual(soulRegex.test('CLAUDE.md'), true, 'soulFiles doit matcher CLAUDE.md');
    assert.strictEqual(soulRegex.test('C:/workspace/CLAUDE.md'), true, 'soulFiles doit matcher C:/workspace/CLAUDE.md');
    assert.strictEqual(soulRegex.test('GEMINI.md'), true, 'soulFiles doit matcher GEMINI.md');
    assert.strictEqual(soulRegex.test('C:/workspace/GEMINI.md'), true, 'soulFiles doit matcher C:/workspace/GEMINI.md');
    assert.strictEqual(soulRegex.test('AGENTS.md'), true, 'soulFiles doit matcher AGENTS.md');
    assert.strictEqual(soulRegex.test('C:/workspace/AGENTS.md'), true, 'soulFiles doit matcher C:/workspace/AGENTS.md');
    assert.strictEqual(soulRegex.test('C:/workspace/README.md'), false, 'soulFiles ne doit pas matcher README.md');

    // 4. Vérification du motif configFolders sur les contenus internes
    const configRegex = /[\\/](?:\.agents|\.agent|\.claude)[\\/].+$/i;
    assert.strictEqual(configRegex.test('C:/workspace/.agents/rules/my-rule.md'), true);
    assert.strictEqual(configRegex.test('C:/workspace/.claude/skills/demo/SKILL.md'), true);
    assert.strictEqual(configRegex.test('C:/workspace/CLAUDE.md'), false);
  });

  // --------------------------------------------------------------------------
  // Test 49 : Filtre « doublons » réel (visibilité simultanée des N paires, Âme comprise)
  // --------------------------------------------------------------------------
  test('49. Filtre doublons réel : visibilité simultanée de toutes les paires actives (Âme comprise) et réversibilité', async () => {
    // Importer main.js pour accéder aux fonctions de filtrage de la webview
    const mainPath = path.resolve(__dirname, '../../src/webview/main.js');
    delete require.cache[mainPath];
    const mainModule = require(mainPath);
    const { filterItems, sortItemsWithPinnedSoul, setFilterState } = mainModule;

    // Jeu de test : 4 types variés de doublons actifs (Âme, règle, skill, workflow)
    // + 1 doublon inactif (bothEnabled: false)
    // + 1 ressource sans doublon
    const items: ResourceItem[] = [
      {
        id: 'GEMINI.md',
        name: 'GEMINI.md',
        description: 'Âme locale Antigravity',
        type: 'soul',
        scope: 'local',
        enabled: true,
        path: '/mock/GEMINI.md',
        targetTool: 'antigravity',
        isFolder: false,
        metadata: {
          isSoul: true,
          duplicateInfo: {
            hasDuplicate: true,
            duplicateScope: 'global',
            duplicatePath: '/global/GEMINI.md',
            isTwinEnabled: true,
            bothEnabled: true,
            isIdentical: false,
            wastedTokens: 1377,
          },
        },
      },
      {
        id: 'rule-test-doublon',
        name: 'Règle Test Doublon',
        description: 'Règle en double',
        type: 'rule',
        scope: 'local',
        enabled: true,
        path: '/mock/rule-test-doublon.md',
        targetTool: 'antigravity',
        isFolder: false,
        metadata: {
          duplicateInfo: {
            hasDuplicate: true,
            duplicateScope: 'global',
            duplicatePath: '/global/rule-test-doublon.md',
            isTwinEnabled: true,
            bothEnabled: true,
            isIdentical: true,
            wastedTokens: 250,
          },
        },
      },
      {
        id: 'skill-brainstorming',
        name: 'Brainstorming',
        description: 'Skill brainstorming',
        type: 'skill',
        scope: 'local',
        enabled: true,
        path: '/mock/skill-brainstorming',
        targetTool: 'antigravity',
        isFolder: true,
        metadata: {
          duplicateInfo: {
            hasDuplicate: true,
            duplicateScope: 'global',
            duplicatePath: '/global/skill-brainstorming',
            isTwinEnabled: true,
            bothEnabled: true,
            isIdentical: true,
            wastedTokens: 450,
          },
        },
      },
      {
        id: 'wf-deploy',
        name: 'Déploiement',
        description: 'Workflow de déploiement',
        type: 'workflow',
        scope: 'local',
        enabled: true,
        path: '/mock/wf-deploy',
        targetTool: 'antigravity',
        isFolder: true,
        metadata: {
          duplicateInfo: {
            hasDuplicate: true,
            duplicateScope: 'global',
            duplicatePath: '/global/wf-deploy',
            isTwinEnabled: true,
            bothEnabled: true,
            isIdentical: true,
            wastedTokens: 600,
          },
        },
      },
      // Ressource avec doublon INACTIF (twin non activé -> bothEnabled false)
      {
        id: 'rule-inactive-dup',
        name: 'Règle Inactive Jumeau',
        description: 'Règle inactive',
        type: 'rule',
        scope: 'local',
        enabled: false,
        path: '/mock/rule-inactive.md',
        targetTool: 'antigravity',
        isFolder: false,
        metadata: {
          duplicateInfo: {
            hasDuplicate: true,
            duplicateScope: 'global',
            duplicatePath: '/global/rule-inactive.md',
            isTwinEnabled: true,
            bothEnabled: false,
            isIdentical: true,
            wastedTokens: 0,
          },
        },
      },
      // Ressource locale sans aucun doublon
      {
        id: 'rule-unique-local',
        name: 'Règle Unique',
        description: 'Règle locale unique',
        type: 'rule',
        scope: 'local',
        enabled: true,
        path: '/mock/rule-unique.md',
        targetTool: 'antigravity',
        isFolder: false,
      },
    ];

    // 1. État normal (filtre doublon inactif) : les 6 items sont présents
    setFilterState({ showDuplicatesOnly: false, currentFilter: 'all', searchQuery: '' });
    const normalResult = filterItems(items);
    assert.strictEqual(normalResult.length, 6, 'Sans filtre doublons, tous les éléments sont visibles');

    // 2. Activation du filtre doublon
    setFilterState({ showDuplicatesOnly: true, currentFilter: 'all', searchQuery: '' });
    const dupResult = filterItems(items);

    // Vérification : exactement 4 éléments conservés simultanément (pas un seul)
    assert.strictEqual(dupResult.length, 4, 'Le filtre doublon doit conserver simultanément les 4 doublons actifs');

    // Vérification de la présence de l'Âme (coquille 2 résolue)
    const soulItem = dupResult.find((i: ResourceItem) => i.id === 'GEMINI.md');
    assert.ok(soulItem, 'L\'Âme (GEMINI.md / CLAUDE.md) doit être présente dans les doublons affichés');
    assert.strictEqual(soulItem.type, 'soul');

    // Vérification de la présence de tous les types variés (règle, skill, workflow)
    assert.ok(dupResult.some((i: ResourceItem) => i.type === 'rule' && i.id === 'rule-test-doublon'), 'La règle doublon doit être affichée');
    assert.ok(dupResult.some((i: ResourceItem) => i.type === 'skill' && i.id === 'skill-brainstorming'), 'Le skill doublon doit être affiché');
    assert.ok(dupResult.some((i: ResourceItem) => i.type === 'workflow' && i.id === 'wf-deploy'), 'Le workflow doublon doit être affiché');

    // Vérification de l'exclusion des non-doublons ou doublons inactifs
    assert.strictEqual(dupResult.some((i: ResourceItem) => i.id === 'rule-inactive-dup'), false, 'Le doublon inactif ne doit pas être affiché');
    assert.strictEqual(dupResult.some((i: ResourceItem) => i.id === 'rule-unique-local'), false, 'L\'élément sans doublon ne doit pas être affiché');

    // 3. Vérification du tri avec Âme épinglée en tête
    const sortedDups = sortItemsWithPinnedSoul(dupResult);
    assert.strictEqual(sortedDups[0].id, 'GEMINI.md', 'L\'Âme doit être épinglée en première position');

    // 4. Réversibilité : la désactivation du filtre restaure l'ensemble des éléments
    setFilterState({ showDuplicatesOnly: false, currentFilter: 'all', searchQuery: '' });
    const restoredResult = filterItems(items);
    assert.strictEqual(restoredResult.length, 6, 'La désactivation du filtre restaure immédiatement l\'ensemble des 6 éléments');

    // 5. Vérification du code source de main.js : aucun firstDup.name assigné à searchInput.value
    const mainJs = fs.readFileSync(path.join(__dirname, '../../src/webview/main.js'), 'utf8');
    assert.ok(!mainJs.includes('searchInput.value = firstDup'), 'main.js ne doit plus injecter firstDup dans searchInput');
    assert.ok(mainJs.includes('toggleDuplicateFilter'), 'main.js doit utiliser toggleDuplicateFilter');
  });

  // --------------------------------------------------------------------------
  // Test 50 : Intégrité CSS du chemin UNC (.nas-config-path)
  // --------------------------------------------------------------------------
  test('50. Chemin UNC : .nas-config-path ne porte plus direction: rtl et préserve le préfixe \\\\', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const stylesCss = fs.readFileSync(path.join(rootDir, 'src/webview/styles.css'), 'utf8');

    // 1. Extraction du bloc .nas-config-path
    const nasConfigPathMatch = stylesCss.match(/\.nas-config-path\s*\{([^}]+)\}/);
    assert.ok(nasConfigPathMatch, '.nas-config-path doit être défini dans styles.css');

    const blockContent = nasConfigPathMatch[1];

    // 2. Vérification de l'absence de direction: rtl et text-align: left
    assert.ok(
      !blockContent.includes('direction: rtl'),
      '.nas-config-path ne doit plus contenir "direction: rtl" (cause de l\'inversion UNC)'
    );
    assert.ok(
      !blockContent.includes('text-align: left'),
      '.nas-config-path ne doit plus contenir le "text-align: left" compensatoire'
    );

    // 3. Vérification de l'intégrité visuelle du chemin UNC
    const sampleUnc = '\\\\serveur\\partage\\catalogue';
    assert.strictEqual(sampleUnc.startsWith('\\\\'), true, 'Le chemin UNC doit commencer par \\\\');
    assert.strictEqual(sampleUnc.endsWith('\\\\'), false, 'Le chemin UNC ne doit pas avoir ses antislashs déplacés en fin');
  });

  // --------------------------------------------------------------------------
  // Test 51 : Calcul de wastedTokens dans DuplicateService
  // --------------------------------------------------------------------------
  test('51. DuplicateService : wastedTokens d\'une paire correspond à la taille de la copie globale éteinte (Claude Code)', () => {
    // Claude Code : le gaspillage est la copie globale. Antigravity compte le plus petit des deux coûts
    // au démarrage, et deux âmes différentes ne font pas un doublon (lot A3, test/antigravity-dynamic-costs.test.ts)
    const ws = path.join(tempBaseDir, 'ws-dup-tokens');
    fs.mkdirSync(ws, { recursive: true });

    const globalFile = path.join(ws, 'global.md');
    const localFile = path.join(ws, 'local.md');
    fs.writeFileSync(globalFile, '# Âme Globale\nInstructions globales étendues.', 'utf8');
    fs.writeFileSync(localFile, '# Âme Locale\nInstructions courtes.', 'utf8');

    // Cas 1 : Copie globale plus volumineuse que locale (ex: GEMINI.md global = 1377 tok, local = 99 tok)
    const global1: ResourceItem[] = [
      {
        id: 'GEMINI.md',
        name: 'GEMINI.md',
        description: 'Âme globale test',
        type: 'soul',
        scope: 'global',
        enabled: true,
        path: globalFile,
        targetTool: 'claude-code',
        isFolder: false,
        tokenCount: 1377,
      },
    ];
    const local1: ResourceItem[] = [
      {
        id: 'GEMINI.md',
        name: 'GEMINI.md',
        description: 'Âme locale test',
        type: 'soul',
        scope: 'local',
        enabled: true,
        path: localFile,
        targetTool: 'claude-code',
        isFolder: false,
        tokenCount: 99,
      },
    ];

    const res1 = DuplicateService.detectDuplicates(global1, local1);
    assert.strictEqual(
      res1.stats.totalWastedTokens,
      1377,
      'wastedTokens doit être exactement égal à la taille de la copie globale éteinte (1377 tok)'
    );
    assert.strictEqual(
      res1.enrichedLocal[0].metadata?.duplicateInfo?.wastedTokens,
      1377,
      'wastedTokens dans duplicateInfo doit refléter la copie globale (1377 tok)'
    );

    // Cas 2 : Copie locale plus volumineuse que globale (ex: local = 2500 tok, global = 800 tok)
    // L'ancien code avec Math.max aurait donné 2500 au lieu de 800 !
    const global2: ResourceItem[] = [
      {
        id: 'rule-custom',
        name: 'Règle Custom',
        description: 'Règle globale test',
        type: 'rule',
        scope: 'global',
        enabled: true,
        path: globalFile,
        targetTool: 'claude-code',
        isFolder: false,
        tokenCount: 800,
      },
    ];
    const local2: ResourceItem[] = [
      {
        id: 'rule-custom',
        name: 'Règle Custom',
        description: 'Règle locale test',
        type: 'rule',
        scope: 'local',
        enabled: true,
        path: localFile,
        targetTool: 'claude-code',
        isFolder: false,
        tokenCount: 2500,
      },
    ];

    const res2 = DuplicateService.detectDuplicates(global2, local2);
    assert.strictEqual(
      res2.stats.totalWastedTokens,
      800,
      'Si local (2500) > global (800), wastedTokens doit être 800 (copie globale éteinte), NON 2500'
    );
    assert.strictEqual(
      res2.enrichedLocal[0].metadata?.duplicateInfo?.wastedTokens,
      800
    );
  });

  // --------------------------------------------------------------------------
  // Test 52 : Incrément 1 des doublons (matrice couleur, libellés, popovers, bouton Éteindre Global)
  // --------------------------------------------------------------------------
  test('52. Doublons Incrément 1 : matrice couleur, libellés sans (+tok), popovers et extinction rapide', () => {
    const mainPath = path.resolve(__dirname, '../../src/webview/main.js');
    delete require.cache[mainPath];
    const { getDuplicateBadgeConfig, createDuplicateBadge } = require(mainPath);

    // Mock minimal du Document pour tester le DOM du badge
    interface MockEl {
      tagName: string;
      className: string;
      innerHTML: string;
      textContent: string;
      title: string;
      children: MockEl[];
      clickListeners: Array<(e: any) => void>;
      appendChild: (child: MockEl) => MockEl;
      addEventListener: (event: string, fn: (e: any) => void) => void;
    }

    const createMockDoc = () => ({
      createElement: (tag: string): MockEl => {
        const el: MockEl = {
          tagName: tag.toUpperCase(),
          className: '',
          innerHTML: '',
          textContent: '',
          title: '',
          children: [],
          clickListeners: [],
          appendChild(c: MockEl) {
            this.children.push(c);
            return c;
          },
          addEventListener(event: string, fn: (e: any) => void) {
            if (event === 'click') this.clickListeners.push(fn);
          },
        };
        return el;
      },
    });

    // Cas 1 : Âme Identique (ex: GEMINI.md global et local identiques)
    const soulIdentical: ResourceItem = {
      id: 'GEMINI.md',
      name: 'GEMINI.md',
      description: 'Âme identique',
      type: 'soul',
      scope: 'local',
      enabled: true,
      path: '/local/GEMINI.md',
      targetTool: 'antigravity',
      isFolder: false,
      metadata: {
        isSoul: true,
        duplicateInfo: {
          hasDuplicate: true,
          duplicateScope: 'global',
          duplicatePath: '/global/GEMINI.md',
          isTwinEnabled: true,
          bothEnabled: true,
          isIdentical: true,
          wastedTokens: 1377,
        },
      },
    };

    // Cas 2 : Âme Divergente (ex: GEMINI.md surchargé dans le projet)
    const soulDivergent: ResourceItem = {
      id: 'GEMINI.md',
      name: 'GEMINI.md',
      description: 'Âme divergente',
      type: 'soul',
      scope: 'local',
      enabled: true,
      path: '/local/GEMINI.md',
      targetTool: 'antigravity',
      isFolder: false,
      metadata: {
        isSoul: true,
        duplicateInfo: {
          hasDuplicate: true,
          duplicateScope: 'global',
          duplicatePath: '/global/GEMINI.md',
          isTwinEnabled: true,
          bothEnabled: true,
          isIdentical: false,
          wastedTokens: 1377,
        },
      },
    };

    // Cas 3 : Non-Âme Identique (ex: skill-brainstorming identique)
    const skillIdentical: ResourceItem = {
      id: 'skill-brainstorming',
      name: 'skill-brainstorming',
      description: 'Skill identique',
      type: 'skill',
      scope: 'local',
      enabled: true,
      path: '/local/skill-brainstorming',
      targetTool: 'antigravity',
      isFolder: true,
      metadata: {
        duplicateInfo: {
          hasDuplicate: true,
          duplicateScope: 'global',
          duplicatePath: '/global/skill-brainstorming',
          isTwinEnabled: true,
          bothEnabled: true,
          isIdentical: true,
          wastedTokens: 450,
        },
      },
    };

    // Cas 4 : Non-Âme Divergent (ex: rule-custom modifiée localement)
    const ruleDivergent: ResourceItem = {
      id: 'rule-custom',
      name: 'rule-custom',
      description: 'Règle divergente',
      type: 'rule',
      scope: 'local',
      enabled: true,
      path: '/local/rule-custom.md',
      targetTool: 'antigravity',
      isFolder: false,
      metadata: {
        duplicateInfo: {
          hasDuplicate: true,
          duplicateScope: 'global',
          duplicatePath: '/global/rule-custom.md',
          isTwinEnabled: true,
          bothEnabled: true,
          isIdentical: false,
          wastedTokens: 300,
        },
      },
    };

    // ========================================================================
    // Validation Cas 1 : Âme Identique -> Rouge, "Doublon actif", Popover Âme, Pas de bouton
    // ========================================================================
    const cfg1 = getDuplicateBadgeConfig(soulIdentical);
    assert.strictEqual(cfg1?.colorClass, 'pill-duplicate-active', 'Âme identique doit être rouge (pill-duplicate-active)');
    assert.ok(cfg1?.label.includes('Doublon actif'), 'Âme identique doit afficher le libellé "Doublon actif"');
    assert.ok(!cfg1?.label.includes('tok'), 'Âme identique ne doit plus avoir (+N tok) dans le libellé');
    assert.strictEqual(
      cfg1?.title,
      'Redondance inutile : la même Âme est injectée en double au démarrage. À corriger.',
      'Âme identique doit porter le popover spécifié'
    );
    assert.strictEqual(cfg1?.hasQuickOff, false, 'L\'Âme identique ne doit JAMAIS afficher le bouton Éteindre Global');

    const dom1 = createDuplicateBadge(soulIdentical, createMockDoc());
    assert.ok(dom1.className.includes('pill-duplicate-active'));
    assert.ok(!dom1.className.includes('pill-override-active'));
    assert.ok(!dom1.innerHTML.includes('tok'));
    assert.strictEqual(dom1.children.length, 0, 'Aucun bouton ne doit être injecté dans le badge de l\'Âme');

    // ========================================================================
    // Validation Cas 2 : Âme Divergente -> Orangé, "Surchargé divergent", Popover Âme, Pas de bouton
    // ========================================================================
    const cfg2 = getDuplicateBadgeConfig(soulDivergent);
    assert.strictEqual(cfg2?.colorClass, 'pill-override-active', 'Âme divergente doit être la SEULE à porter orangé (pill-override-active)');
    assert.ok(cfg2?.label.includes('Surchargé divergent'), 'Âme divergente doit afficher le libellé "Surchargé divergent"');
    assert.ok(!cfg2?.label.includes('tok'), 'Âme divergente ne doit plus avoir (+N tok) dans le libellé');
    assert.strictEqual(
      cfg2?.title,
      'Vérifiez que les règles locales ne répètent pas les règles globales et qu\'elles sont bien propres au projet.',
      'Âme divergente doit porter le popover spécifié'
    );
    assert.strictEqual(cfg2?.hasQuickOff, false, 'L\'Âme divergente ne doit JAMAIS afficher le bouton Éteindre Global');

    const dom2 = createDuplicateBadge(soulDivergent, createMockDoc());
    assert.ok(dom2.className.includes('pill-override-active'));
    assert.ok(!dom2.className.includes('pill-duplicate-active'));
    assert.ok(!dom2.innerHTML.includes('tok'));
    assert.strictEqual(dom2.children.length, 0, 'Aucun bouton ne doit être injecté dans le badge de l\'Âme divergente');

    // ========================================================================
    // Validation Cas 3 : Non-Âme Identique -> Rouge, "Doublon actif", Popover Non-Âme, Bouton Éteindre Global
    // ========================================================================
    const cfg3 = getDuplicateBadgeConfig(skillIdentical);
    assert.strictEqual(cfg3?.colorClass, 'pill-duplicate-active', 'Skill identique doit être rouge (pill-duplicate-active)');
    assert.ok(cfg3?.label.includes('Doublon actif'), 'Skill identique doit afficher "Doublon actif"');
    assert.ok(!cfg3?.label.includes('tok'), 'Skill identique ne doit plus avoir (+N tok) dans le libellé');
    assert.strictEqual(
      cfg3?.title,
      'Redondance inutile : les copies globale et locale sont identiques. Éteignez la globale pour récupérer les tokens.',
      'Skill identique doit porter le popover spécifié'
    );
    assert.strictEqual(cfg3?.hasQuickOff, true, 'Le skill identique doit avoir hasQuickOff = true');
    assert.strictEqual(cfg3?.quickOffLabel, 'Éteindre Global');

    const dom3 = createDuplicateBadge(skillIdentical, createMockDoc());
    assert.ok(dom3.className.includes('pill-duplicate-active'));
    assert.ok(!dom3.innerHTML.includes('tok'));
    assert.strictEqual(dom3.children.length, 1, 'Le bouton doit être présent');
    assert.strictEqual(dom3.children[0].className, 'btn-quick-off');
    assert.strictEqual(dom3.children[0].textContent, 'Éteindre Global');

    // ========================================================================
    // Validation Cas 4 : Non-Âme Divergent -> Rouge (plus orangé !), "Doublon divergent", Popover, Bouton Éteindre Global
    // ========================================================================
    const cfg4 = getDuplicateBadgeConfig(ruleDivergent);
    assert.strictEqual(cfg4?.colorClass, 'pill-duplicate-active', 'Règle divergente doit désormais être ROUGE (pill-duplicate-active, non orangé)');
    assert.ok(cfg4?.label.includes('Doublon divergent'), 'Règle divergente doit afficher "Doublon divergent"');
    assert.ok(!cfg4?.label.includes('tok'), 'Règle divergente ne doit plus avoir (+N tok) dans le libellé');
    assert.strictEqual(
      cfg4?.title,
      'Les copies globale et locale diffèrent. Vérifiez laquelle garder.',
      'Règle divergente doit porter le popover spécifié'
    );
    assert.strictEqual(cfg4?.hasQuickOff, true, 'La règle divergente doit avoir hasQuickOff = true');
    assert.strictEqual(cfg4?.quickOffLabel, 'Éteindre Global');

    const dom4 = createDuplicateBadge(ruleDivergent, createMockDoc());
    assert.ok(dom4.className.includes('pill-duplicate-active'));
    assert.ok(!dom4.className.includes('pill-override-active'));
    assert.ok(!dom4.innerHTML.includes('tok'));
    assert.strictEqual(dom4.children.length, 1, 'Le bouton doit être présent');
    assert.strictEqual(dom4.children[0].className, 'btn-quick-off');
    assert.strictEqual(dom4.children[0].textContent, 'Éteindre Global');

    // ========================================================================
    // Validation Cas 5 (Inactif) : Doublon identique inactif -> Gris, "♊ Doublon (inactif)", Pas de bouton
    // ========================================================================
    const inactiveIdentical: ResourceItem = {
      id: 'GEMINI.md',
      name: 'GEMINI.md',
      description: 'Âme identique inactive',
      type: 'soul',
      scope: 'local',
      enabled: false,
      path: '/local/GEMINI.md',
      targetTool: 'antigravity',
      isFolder: false,
      metadata: {
        isSoul: true,
        duplicateInfo: {
          hasDuplicate: true,
          duplicateScope: 'global',
          duplicatePath: '/global/GEMINI.md',
          isTwinEnabled: true,
          bothEnabled: false,
          isIdentical: true,
          wastedTokens: 0,
        },
      },
    };
    const cfg5 = getDuplicateBadgeConfig(inactiveIdentical);
    assert.strictEqual(cfg5?.colorClass, 'pill-duplicate-inactive', 'Doublon identique inactif doit être gris (pill-duplicate-inactive)');
    assert.strictEqual(cfg5?.label, '♊ Doublon (inactif)');
    assert.strictEqual(cfg5?.hasQuickOff, false, 'Doublon inactif ne doit avoir aucun bouton');

    const dom5 = createDuplicateBadge(inactiveIdentical, createMockDoc());
    assert.ok(dom5.className.includes('pill-duplicate-inactive'));
    assert.strictEqual(dom5.textContent, '♊ Doublon (inactif)');
    assert.strictEqual(dom5.children.length, 0);

    // ========================================================================
    // Validation Cas 6 (Inactif) : Doublon divergent inactif (Local) -> "⚡ Surcharge locale (optimisée)"
    // ========================================================================
    const inactiveDivergentLocal: ResourceItem = {
      id: 'rule-custom',
      name: 'rule-custom',
      description: 'Règle divergente inactive locale',
      type: 'rule',
      scope: 'local',
      enabled: false,
      path: '/local/rule-custom.md',
      targetTool: 'antigravity',
      isFolder: false,
      metadata: {
        duplicateInfo: {
          hasDuplicate: true,
          duplicateScope: 'global',
          duplicatePath: '/global/rule-custom.md',
          isTwinEnabled: true,
          bothEnabled: false,
          isIdentical: false,
          wastedTokens: 0,
        },
      },
    };
    const cfg6 = getDuplicateBadgeConfig(inactiveDivergentLocal);
    assert.strictEqual(cfg6?.colorClass, 'pill-duplicate-inactive');
    assert.strictEqual(cfg6?.label, '⚡ Surcharge locale (optimisée)');
    assert.strictEqual(cfg6?.hasQuickOff, false);

    const dom6 = createDuplicateBadge(inactiveDivergentLocal, createMockDoc());
    assert.ok(dom6.className.includes('pill-duplicate-inactive'));
    assert.strictEqual(dom6.textContent, '⚡ Surcharge locale (optimisée)');
    assert.strictEqual(dom6.children.length, 0);

    // ========================================================================
    // Validation Cas 7 (Inactif) : Doublon divergent inactif (Global) -> "⚡ Surchargé en local (optimisé)"
    // ========================================================================
    const inactiveDivergentGlobal: ResourceItem = {
      id: 'rule-custom',
      name: 'rule-custom',
      description: 'Règle divergente inactive globale',
      type: 'rule',
      scope: 'global',
      enabled: true,
      path: '/global/rule-custom.md',
      targetTool: 'antigravity',
      isFolder: false,
      metadata: {
        duplicateInfo: {
          hasDuplicate: true,
          duplicateScope: 'local',
          duplicatePath: '/local/rule-custom.md',
          isTwinEnabled: false,
          bothEnabled: false,
          isIdentical: false,
          wastedTokens: 0,
        },
      },
    };
    const cfg7 = getDuplicateBadgeConfig(inactiveDivergentGlobal);
    assert.strictEqual(cfg7?.colorClass, 'pill-duplicate-inactive');
    assert.strictEqual(cfg7?.label, '⚡ Surchargé en local (optimisé)');
    assert.strictEqual(cfg7?.hasQuickOff, false);

    const dom7 = createDuplicateBadge(inactiveDivergentGlobal, createMockDoc());
    assert.ok(dom7.className.includes('pill-duplicate-inactive'));
    assert.strictEqual(dom7.textContent, '⚡ Surchargé en local (optimisé)');
    assert.strictEqual(dom7.children.length, 0);
  });

  // --------------------------------------------------------------------------
  // Test 53 : Incrément 2 — Comparaison, Recommandation Heuristique et Bouton Comparer
  // --------------------------------------------------------------------------
  test('53. Doublons Incrément 2 : recommandation heuristique (local=NAS, global=NAS, aucun=NAS) et bouton Comparer', () => {
    const mainPath = path.resolve(__dirname, '../../src/webview/main.js');
    delete require.cache[mainPath];
    const { computeDuplicateRecommendation, createItemCard } = require(mainPath);

    // ========================================================================
    // 1. Tests de la fonction heuristique computeDuplicateRecommendation
    // ========================================================================

    // Cas A : local correspond au NAS seul -> local est la version maintenue
    const recLocalMaintained = computeDuplicateRecommendation({
      localSyncStatus: 'synced',
      globalSyncStatus: 'modified',
      localMtimeMs: 1729170000000,
      globalMtimeMs: 1729160000000,
      localCharCount: 1500,
      globalCharCount: 1200,
      localTokenCount: 375,
      globalTokenCount: 300,
    });
    assert.strictEqual(recLocalMaintained.type, 'local_maintained');
    assert.ok(recLocalMaintained.recommendation.toLowerCase().includes('probablement'));
    assert.ok(recLocalMaintained.recommendation.toLowerCase().includes('version maintenue'));
    assert.strictEqual(recLocalMaintained.moreRecent, 'local');
    assert.strictEqual(recLocalMaintained.moreDetailed, 'local');
    assert.ok(recLocalMaintained.signals.some((s: string) => s.includes('la copie locale est plus récente')));
    assert.ok(recLocalMaintained.signals.some((s: string) => s.includes('la copie locale est plus volumineuse')));

    // Cas B : global correspond au NAS seul -> local est une surcharge propre au projet
    const recLocalOverride = computeDuplicateRecommendation({
      localSyncStatus: 'modified',
      globalSyncStatus: 'synced',
      localMtimeMs: 1729150000000,
      globalMtimeMs: 1729180000000,
      localCharCount: 1000,
      globalCharCount: 1600,
      localTokenCount: 250,
      globalTokenCount: 400,
    });
    assert.strictEqual(recLocalOverride.type, 'local_override');
    assert.ok(recLocalOverride.recommendation.toLowerCase().includes('probablement'));
    assert.ok(recLocalOverride.recommendation.toLowerCase().includes('surcharge propre au projet'));
    assert.strictEqual(recLocalOverride.moreRecent, 'global');
    assert.strictEqual(recLocalOverride.moreDetailed, 'global');
    assert.ok(recLocalOverride.signals.some((s: string) => s.includes('la copie globale est plus récente')));
    assert.ok(recLocalOverride.signals.some((s: string) => s.includes('la copie globale est plus volumineuse')));

    // Cas C : aucun ne correspond au NAS -> les deux ont divergé du Catalogue
    const recBothDiverged = computeDuplicateRecommendation({
      localSyncStatus: 'modified',
      globalSyncStatus: 'modified',
      localMtimeMs: 1729170000000,
      globalMtimeMs: 1729170000000,
      localCharCount: 1200,
      globalCharCount: 1200,
      localTokenCount: 300,
      globalTokenCount: 300,
    });
    assert.strictEqual(recBothDiverged.type, 'both_diverged');
    assert.ok(recBothDiverged.recommendation.toLowerCase().includes('divergé'));
    assert.ok(recBothDiverged.recommendation.includes('Catalogue'));
    assert.strictEqual(recBothDiverged.moreRecent, 'same');
    assert.strictEqual(recBothDiverged.moreDetailed, 'same');
    assert.ok(recBothDiverged.signals.some((s: string) => s.includes('la même date de modification')));
    assert.ok(recBothDiverged.signals.some((s: string) => s.includes('le même nombre de caractères')));

    // Cas D : NAS hors-ligne
    const recOffline = computeDuplicateRecommendation({
      localSyncStatus: 'nas_offline',
      globalSyncStatus: 'nas_offline',
    });
    assert.strictEqual(recOffline.type, 'nas_offline');
    assert.ok(recOffline.recommendation.includes('Catalogue NAS hors-ligne'));

    // ========================================================================
    // 2. Tests de présence du bouton « Comparer » sur les cartes
    // ========================================================================

    interface MockCardEl {
      tagName: string;
      className: string;
      innerHTML: string;
      textContent: string;
      title: string;
      children: MockCardEl[];
      clickListeners: Array<(e: any) => void>;
      appendChild: (child: MockCardEl) => MockCardEl;
      addEventListener: (event: string, fn: (e: any) => void) => void;
      style: Record<string, string>;
      classList: {
        add: (c: string) => void;
        remove: (c: string) => void;
        contains: (c: string) => boolean;
      };
    }

    const createCardMockDoc = () => ({
      createElement: (tag: string): MockCardEl => {
        const classes = new Set<string>();
        const el: MockCardEl = {
          tagName: tag.toUpperCase(),
          className: '',
          innerHTML: '',
          textContent: '',
          title: '',
          children: [],
          clickListeners: [],
          style: {},
          appendChild(c: MockCardEl) {
            this.children.push(c);
            return c;
          },
          addEventListener(event: string, fn: (e: any) => void) {
            if (event === 'click') this.clickListeners.push(fn);
          },
          classList: {
            add: (c: string) => {
              classes.add(c);
              el.className = Array.from(classes).join(' ');
            },
            remove: (c: string) => {
              classes.delete(c);
              el.className = Array.from(classes).join(' ');
            },
            contains: (c: string) => classes.has(c),
          },
        };
        return el;
      },
    });

    const findElementByClass = (root: MockCardEl, cls: string): MockCardEl | null => {
      if (root.className && root.className.includes(cls)) return root;
      for (const child of root.children) {
        const found = findElementByClass(child, cls);
        if (found) return found;
      }
      return null;
    };

    // Carte A : Doublon divergent local (règle) -> bouton Comparer DOIT être présent
    const divergentLocalItem: ResourceItem = {
      id: 'rule-test',
      name: 'Règle Test Divergente',
      description: 'Règle locale divergente',
      type: 'rule',
      scope: 'local',
      enabled: true,
      path: '/local/rule-test.md',
      targetTool: 'antigravity',
      isFolder: false,
      metadata: {
        duplicateInfo: {
          hasDuplicate: true,
          duplicateScope: 'global',
          duplicatePath: '/global/rule-test.md',
          isTwinEnabled: true,
          bothEnabled: true,
          isIdentical: false,
          wastedTokens: 250,
        },
      },
    };
    const cardA = createItemCard(divergentLocalItem, false, createCardMockDoc());
    const btnCompareA = findElementByClass(cardA, 'btn-compare');
    assert.ok(btnCompareA !== null, 'Le bouton .btn-compare doit être présent sur un doublon divergent local');
    assert.ok(btnCompareA?.textContent.includes('Comparer') || btnCompareA?.innerHTML.includes('Comparer'));

    // Carte B : Doublon divergent global (règle) -> bouton Comparer DOIT également être présent sur la copie globale
    const divergentGlobalItem: ResourceItem = {
      id: 'rule-test',
      name: 'Règle Test Divergente',
      description: 'Règle globale divergente',
      type: 'rule',
      scope: 'global',
      enabled: true,
      path: '/global/rule-test.md',
      targetTool: 'antigravity',
      isFolder: false,
      metadata: {
        duplicateInfo: {
          hasDuplicate: true,
          duplicateScope: 'local',
          duplicatePath: '/local/rule-test.md',
          isTwinEnabled: true,
          bothEnabled: true,
          isIdentical: false,
          wastedTokens: 250,
        },
      },
    };
    const cardB = createItemCard(divergentGlobalItem, false, createCardMockDoc());
    const btnCompareB = findElementByClass(cardB, 'btn-compare');
    assert.ok(btnCompareB !== null, 'Le bouton .btn-compare doit être présent sur la carte globale du doublon divergent');
    assert.ok(btnCompareB?.textContent.includes('Comparer') || btnCompareB?.innerHTML.includes('Comparer'));

    // Carte C : Âme divergente -> bouton Comparer DOIT être présent
    const divergentSoulItem: ResourceItem = {
      id: 'GEMINI.md',
      name: 'GEMINI.md',
      description: 'Âme divergente',
      type: 'soul',
      scope: 'local',
      enabled: true,
      path: '/local/GEMINI.md',
      targetTool: 'antigravity',
      isFolder: false,
      metadata: {
        isSoul: true,
        duplicateInfo: {
          hasDuplicate: true,
          duplicateScope: 'global',
          duplicatePath: '/global/GEMINI.md',
          isTwinEnabled: true,
          bothEnabled: true,
          isIdentical: false,
          wastedTokens: 1200,
        },
      },
    };
    const cardC = createItemCard(divergentSoulItem, false, createCardMockDoc());
    const btnCompareC = findElementByClass(cardC, 'btn-compare');
    assert.ok(btnCompareC !== null, 'Le bouton .btn-compare doit être présent sur l\'Âme divergente');

    // Carte D : Doublon IDENTIQUE -> bouton Comparer NE DOIT PAS être présent (rien à comparer)
    const identicalItem: ResourceItem = {
      id: 'skill-brainstorming',
      name: 'skill-brainstorming',
      description: 'Skill identique',
      type: 'skill',
      scope: 'local',
      enabled: true,
      path: '/local/skill-brainstorming',
      targetTool: 'antigravity',
      isFolder: true,
      metadata: {
        duplicateInfo: {
          hasDuplicate: true,
          duplicateScope: 'global',
          duplicatePath: '/global/skill-brainstorming',
          isTwinEnabled: true,
          bothEnabled: true,
          isIdentical: true,
          wastedTokens: 350,
        },
      },
    };
    const cardD = createItemCard(identicalItem, false, createCardMockDoc());
    const btnCompareD = findElementByClass(cardD, 'btn-compare');
    assert.strictEqual(btnCompareD, null, 'Le bouton .btn-compare ne doit PAS apparaître sur un doublon identique');

    // Carte E : Ressource sans doublon -> bouton Comparer NE DOIT PAS être présent
    const singleItem: ResourceItem = {
      id: 'rule-unique',
      name: 'rule-unique',
      description: 'Règle sans doublon',
      type: 'rule',
      scope: 'local',
      enabled: true,
      path: '/local/rule-unique.md',
      targetTool: 'antigravity',
      isFolder: false,
    };
    const cardE = createItemCard(singleItem, false, createCardMockDoc());
    const btnCompareE = findElementByClass(cardE, 'btn-compare');
    assert.strictEqual(btnCompareE, null, 'Le bouton .btn-compare ne doit PAS apparaître sans doublon');

    // ========================================================================
    // 3. Tests de la Modale de Résumé et déclenchement compareDuplicate
    // ========================================================================
    const { openCompareModal } = require(mainPath);

    const docElements: MockCardEl[] = [];
    const mockModalDoc = {
      body: {
        appendChild(child: MockCardEl) {
          docElements.push(child);
          return child;
        },
      },
      getElementById(id: string): MockCardEl | null {
        return docElements.find((e) => (e as any).id === id) || null;
      },
      addEventListener() {},
      removeEventListener() {},
      createElement: (tag: string): MockCardEl => {
        const classes = new Set<string>();
        const el: MockCardEl & { id?: string; parentNode?: any } = {
          tagName: tag.toUpperCase(),
          className: '',
          innerHTML: '',
          textContent: '',
          title: '',
          children: [],
          clickListeners: [],
          style: {},
          appendChild(c: MockCardEl & { parentNode?: any }) {
            c.parentNode = el;
            this.children.push(c);
            return c;
          },
          addEventListener(event: string, fn: (e: any) => void) {
            if (event === 'click') this.clickListeners.push(fn);
          },
          classList: {
            add: (c: string) => {
              classes.add(c);
              el.className = Array.from(classes).join(' ');
            },
            remove: (c: string) => {
              classes.delete(c);
              el.className = Array.from(classes).join(' ');
            },
            contains: (c: string) => classes.has(c),
          },
        };
        return el;
      },
    };

    const sentMessages: any[] = [];
    (global as any).vscode = {
      postMessage: (msg: any) => {
        sentMessages.push(msg);
      },
    };

    openCompareModal(divergentLocalItem, mockModalDoc);

    assert.strictEqual(docElements.length, 1, 'La modale doit être injectée dans le body');
    const overlay = docElements[0];
    assert.strictEqual((overlay as any).id, 'compareModalOverlay');

    const btnDiff = findElementByClass(overlay, 'btn-diff-native');
    assert.ok(btnDiff !== null, 'Le bouton Diff natif VS Code doit être présent dans la modale');
    assert.ok(btnDiff.clickListeners.length > 0, 'Le bouton Diff doit avoir un listener click');

    // Déclencher le clic sur Diff natif
    btnDiff.clickListeners[0]({} as any);

    assert.strictEqual(sentMessages.length, 1, 'Un message compareDuplicate doit avoir été envoyé');
    assert.strictEqual(sentMessages[0].type, 'compareDuplicate');
    assert.strictEqual(sentMessages[0].payload.globalPath, '/global/rule-test.md');
    assert.strictEqual(sentMessages[0].payload.localPath, '/local/rule-test.md');
    assert.ok(sentMessages[0].payload.title.includes('Règle Test Divergente'));
  });

  // --------------------------------------------------------------------------
  // Test 54 : Aucun catalogue NAS par défaut
  // --------------------------------------------------------------------------
  test('54. Catalogue NAS non configuré : valeur par défaut vide, catalogue absent sans erreur', async () => {
    const rootDir = path.resolve(__dirname, '../..');
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    assert.strictEqual(
      pkg.contributes.configuration.properties['skillsManager.nasPath'].default,
      '',
      'skillsManager.nasPath doit être vide par défaut'
    );

    // Aucun chemin d'infrastructure réel ne doit subsister dans le code distribué
    for (const relative of [
      'package.json',
      'src/extension.ts',
      'src/services/NasScanner.ts',
      'src/providers/DashboardPanel.ts',
      'src/providers/SidebarViewProvider.ts',
      'src/webview/main.js',
      'src/webview/sidebar.html',
      'src/webview/dashboard.html',
      'src/webview/cheatsheet.html',
    ]) {
      const content = fs.readFileSync(path.join(rootDir, relative), 'utf8');
      assert.ok(!/Antigravity-Templates/.test(content), `${relative} ne doit plus contenir l'ancien chemin NAS par défaut`);
    }

    // Le réglage simulé renvoie la valeur par défaut : le scan ne tente aucun accès et ne signale aucune panne
    const result = await NasScanner.scan();
    assert.strictEqual(result.status.configured, false, 'Le catalogue doit être signalé comme non configuré');
    assert.strictEqual(result.status.online, false);
    assert.strictEqual(result.status.path, '');
    assert.strictEqual(result.status.error, undefined, 'Un catalogue absent n\'est pas une erreur');
    assert.deepStrictEqual(result.items, []);

    // Les ressources locales restent utilisables : elles sont simplement non vérifiables
    const enriched = await IntegrityService.enrichResourcesWithSyncStatus(
      [{ id: 'regle', name: 'regle.md', description: '', type: 'rule', scope: 'local', path: '/local/regle.md', enabled: true } as ResourceItem],
      result.items,
      result.status.online
    );
    assert.strictEqual(enriched.length, 1);
    assert.strictEqual(enriched[0].syncStatus, 'nas_offline');
  });
});






