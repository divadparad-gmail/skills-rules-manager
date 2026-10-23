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
import { McpScanner } from '../src/services/McpScanner';
import { DuplicateService } from '../src/services/DuplicateService';
import { ResourceItem } from '../src/types';

// Tests extraits de test/common-integrity.test.ts (anciennement integrity.test.ts) : titres et numéros d'origine conservés
describe('Suite de Tests : Intégrité Claude Code (isolation, scan global, MCP, doublons)', () => {
  let tempBaseDir: string;
  let localDir: string;

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'test-rules-manager-claude-'));
    localDir = path.join(tempBaseDir, 'local');
    await fs.promises.mkdir(localDir, { recursive: true });

    // État laissé par les tests 9 à 11 (antigravity-integrity), dont dépend le test 12 :
    // les deux âmes et une règle de chaque outil dans le même espace de travail
    await fs.promises.writeFile(path.join(localDir, 'GEMINI.md'), '# Niveau 0 : Cadre Général\nInstructions fondamentales inviolables de l\'agent.', 'utf8');
    await fs.promises.mkdir(path.join(localDir, '.agents', 'rules'), { recursive: true });
    await fs.promises.writeFile(path.join(localDir, '.agents', 'rules', 'my-modular-rule.md'), '---\ntrigger: always_on\n---\n# Rule\nSome content', 'utf8');
    await fs.promises.writeFile(path.join(localDir, 'CLAUDE.md'), '# Claude Soul Instructions', 'utf8');
    await fs.promises.mkdir(path.join(localDir, '.claude', 'rules'), { recursive: true });
    await fs.promises.writeFile(path.join(localDir, '.claude', 'rules', 'claude-specific.md'), '# Claude Only Rule', 'utf8');
  });

  after(async () => {
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
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
});
