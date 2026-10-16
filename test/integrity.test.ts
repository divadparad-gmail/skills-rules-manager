import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';
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
    await fs.promises.writeFile(path.join(agentsRulesDir, 'my-modular-rule.md'), '# Rule\nSome content', 'utf8');

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
    assert.strictEqual(NasScanner.getUncHost('\\\\Nas1\\DD2\\IA\\Templates'), 'nas1');
    assert.strictEqual(NasScanner.getUncHost('//NAS1/share/folder'), 'nas1');
    assert.strictEqual(NasScanner.getUncHost('C:\\Users\\LocalUser'), null);
  });

  test('18. Guide & Bonnes Pratiques IA (v0.3.0) : intégrité des templates et composants webview', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.version, '0.3.0', 'package.json doit être en version 0.3.0');

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

    // Vérification de la page cheatsheet.html (onglet plein éditeur à droite)
    assert.ok(cheatsheetHtml.includes('modalTabClaude'), 'cheatsheet.html doit contenir modalTabClaude');
    assert.ok(cheatsheetHtml.includes('modalTabAntigravity'), 'cheatsheet.html doit contenir modalTabAntigravity');
    assert.ok(cheatsheetHtml.includes('contentClaude'), 'cheatsheet.html doit contenir contentClaude');
    assert.ok(cheatsheetHtml.includes('contentAntigravity'), 'cheatsheet.html doit contenir contentAntigravity');
    assert.ok(cheatsheetHtml.includes('workspace-tool-pills'), 'cheatsheet.html doit utiliser le style pilules workspace-tool-pills');

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
    const { isRuleConditional, extractFrontmatter } = await import('../src/utils/frontmatter');

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

    // Antigravity sans trigger (always_on)
    const agyAlwaysOn = `---
description: Règle toujours active
---
# Règle Standard`;
    const alwaysFm = extractFrontmatter(agyAlwaysOn).metadata;
    assert.strictEqual(isRuleConditional(alwaysFm, 'antigravity'), false, 'Sans trigger, la règle Antigravity est permanente');
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
    const permContent = '# Perm Rule\n' + 'A'.repeat(380);
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
      '# Plugin Rule\nRègle du plugin.',
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
  test('21. Alertes Lignes : Détecte warningLinesExceeded sur Règle > 200 li. et Skill > 500 li.', async () => {
    const coachDir = path.join(tempBaseDir, 'coach-lines-test');
    await fs.promises.mkdir(path.join(coachDir, '.agents', 'rules'), { recursive: true });
    await fs.promises.mkdir(path.join(coachDir, '.agents', 'skills', 'skill-large'), { recursive: true });

    // Règle de 250 lignes (> 200)
    const longRuleLines = Array.from({ length: 250 }, (_, i) => `Ligne ${i + 1} de la règle`).join('\n');
    await fs.promises.writeFile(
      path.join(coachDir, '.agents', 'rules', 'rule-long.md'),
      `# Longue Règle\nDescription de la règle.\n${longRuleLines}`,
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
    assert.strictEqual(ruleItem?.metadata?.warningLinesExceeded, true, 'warningLinesExceeded doit être true sur règle > 200 lignes');

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
    const heavyContent = '# Règle Volumineuse\n' + 'X'.repeat(25000);
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

    // 2 règles avec alertes (une > 200 lignes, une > 24 Ko) et 1 normale
    const normalRule = '# Règle Normale\nContenu court et propre.';
    const longRule = Array.from({ length: 220 }, (_, i) => `Ligne ${i + 1}`).join('\n');
    const heavyRule = '# Règle Lourde\n' + 'H'.repeat(25000);

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
    assert.strictEqual(scanResult.rulesStat.warningCount, 2, 'rulesStat.warningCount doit être 2 (rule-long et rule-heavy)');
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
    const testNas = path.join(tempBaseDir, 'Antigravity-Templates');
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
});






