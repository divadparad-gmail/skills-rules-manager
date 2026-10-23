import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe } from 'node:test';

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

const repoRoot = path.resolve(__dirname, '../..');
const FIXTURE_05 = path.join(repoRoot, 'test', 'scenarios', 'claude-code', '.claude', 'rules', '05-rule-claude-warn-lines.md');
const GENERATOR_05 = path.join(repoRoot, 'test', 'scenarios', 'scripts', 'generate-claude-code-05-warn-lines.js');

describe('Suite de Tests : fixtures du banc d\'essai Claude Code', () => {
  test('1. Fixture 05 : identique octet pour octet à la sortie de son générateur, en LF', () => {
    // Lecture brute, sans normaliser les fins de ligne : un CR laissé sur le disque doit faire échouer le test
    const content = fs.readFileSync(FIXTURE_05, 'utf8');
    assert.ok(!content.includes('\r'), '05-rule-claude-warn-lines.md contient un CR : relance generate-claude-code-05-warn-lines.js');
    const { build05WarnLines } = require(GENERATOR_05) as { build05WarnLines: () => string };
    assert.strictEqual(content, build05WarnLines(), '05-rule-claude-warn-lines.md diffère du générateur : relance generate-claude-code-05-warn-lines.js');
  });

  test('2. Fixture 05 : règle permanente de plus de 200 lignes, signalée par l\'alerte de longueur', async () => {
    const ws = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'claude-fixture-05-'));
    try {
      const rulesDir = path.join(ws, '.claude', 'rules');
      await fs.promises.mkdir(rulesDir, { recursive: true });
      await fs.promises.copyFile(FIXTURE_05, path.join(rulesDir, '05-rule-claude-warn-lines.md'));

      const scanResult = await LocalScanner.scan({
        hasWorkspace: true,
        workspacePath: ws,
        tool: 'claude-code',
        agentsDir: null,
        claudeDir: path.join(ws, '.claude'),
        hasClaudeMd: false,
      });

      const rule = scanResult.items.find((i) => i.id === '05-rule-claude-warn-lines');
      assert.ok(rule, 'La fixture 05 doit être scannée');
      assert.ok(rule.lineCount! > 200, `lineCount doit dépasser 200 (reçu : ${rule.lineCount})`);
      assert.strictEqual(rule.metadata?.isConditional, false, 'Sans paths:, la règle est permanente');
      assert.strictEqual(rule.metadata?.warningLinesExceeded, true, 'Une règle Claude Code de plus de 200 lignes est signalée');
      assert.strictEqual(scanResult.rulesStat.warningCount, 1);
    } finally {
      await fs.promises.rm(ws, { recursive: true, force: true });
    }
  });
});
