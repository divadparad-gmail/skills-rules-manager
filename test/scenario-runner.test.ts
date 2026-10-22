import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { test, describe, before, after } from 'node:test';

// Le banc d'essai en ligne de commande ne doit jamais effacer le travail de l'utilisateur :
// seuls les fichiers du manifeste et les fixtures de test/scenarios/ sont concernés.
describe('Suite de Tests : banc d\'essai en ligne de commande (runner.js)', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const runner = path.join(repoRoot, 'test', 'scenarios', 'scripts', 'runner.js');
  let tempBaseDir: string;
  let workspace: string;
  let home: string;

  // Fichiers de l'utilisateur, absents des fixtures : ils doivent survivre à toutes les commandes
  const userFiles: Record<string, string> = {
    '.agents/rules/09-rule-securite-code.md': '---\ntrigger: always_on\ndescription: Vraie règle\n---\n# Sécurité',
    '.agents/hooks.json.bak': '{ "sauvegarde": true }',
    '.agents/skills/wf-hook/SKILL.md': '---\nname: wf-hook\ndescription: Skill réel\n---\n# Hook',
    '.claude/rules/06-rule-securite-code.md': '---\npaths:\n  - "src/**/*.ts"\n---\n# Sécurité Claude',
    '.claude/skills/security-audit/SKILL.md': '---\nname: security-audit\ndescription: Non suivi par Git\n---\n# Audit',
    'AGENTS.md': '# Âme de l\'utilisateur, pas une fixture',
  };

  const run = (target: string) =>
    execFileSync(process.execPath, [runner, target, workspace], {
      encoding: 'utf8',
      // Profil isolé : la règle doublon globale ne doit jamais toucher le vrai ~/.gemini
      env: { ...process.env, USERPROFILE: home, HOME: home },
    });

  const assertUserFilesIntact = (after: string) => {
    for (const [rel, content] of Object.entries(userFiles)) {
      const file = path.join(workspace, rel);
      assert.ok(fs.existsSync(file), `${rel} doit survivre à ${after}`);
      assert.strictEqual(fs.readFileSync(file, 'utf8'), content, `${rel} ne doit pas être modifié par ${after}`);
    }
  };

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scenario-runner-'));
    workspace = path.join(tempBaseDir, 'projet');
    home = path.join(tempBaseDir, 'home');
    await fs.promises.mkdir(home, { recursive: true });
    for (const tool of ['antigravity', 'claude-code']) {
      await fs.promises.cp(
        path.join(repoRoot, 'test', 'scenarios', tool),
        path.join(workspace, 'test', 'scenarios', tool),
        { recursive: true }
      );
    }
    for (const [rel, content] of Object.entries(userFiles)) {
      await fs.promises.mkdir(path.dirname(path.join(workspace, rel)), { recursive: true });
      await fs.promises.writeFile(path.join(workspace, rel), content, 'utf8');
    }
  });

  after(async () => {
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  test('1. test:deploy-antigravity déploie les fixtures sans effacer les fichiers de l\'utilisateur', () => {
    run('antigravity');
    assert.ok(fs.existsSync(path.join(workspace, '.agents', 'rules', '02-rule-perm-standard-always-on.md')));
    assert.ok(fs.existsSync(path.join(workspace, 'GEMINI.md')), 'GEMINI.md est une fixture du banc d\'essai');
    assertUserFilesIntact('test:deploy-antigravity');
  });

  test('2. test:deploy-claude puis test:deploy-all préservent les fichiers de l\'utilisateur', () => {
    run('claude-code');
    assert.ok(fs.existsSync(path.join(workspace, '.claude', 'rules', '01-rule-claude-perm-standard.md')));
    assertUserFilesIntact('test:deploy-claude');

    run('all');
    assert.ok(fs.existsSync(path.join(workspace, 'CLAUDE.md')));
    assert.ok(fs.existsSync(path.join(home, '.gemini', 'config', 'rules', 'rule-test-doublon.md')), 'Doublon global dans le profil isolé');
    assertUserFilesIntact('test:deploy-all');
  });

  test('3. test:clean ne supprime que les fixtures', () => {
    run('clean');
    assert.ok(!fs.existsSync(path.join(workspace, '.agents', 'rules', '02-rule-perm-standard-always-on.md')), 'Fixture supprimée');
    assert.ok(!fs.existsSync(path.join(workspace, 'CLAUDE.md')), 'CLAUDE.md fixture supprimé');
    assert.ok(!fs.existsSync(path.join(home, '.gemini', 'config', 'rules', 'rule-test-doublon.md')));
    assert.ok(fs.existsSync(path.join(workspace, '.agents')), 'Le dossier .agents/ n\'est jamais supprimé');
    assert.ok(fs.existsSync(path.join(workspace, '.claude')), 'Le dossier .claude/ n\'est jamais supprimé');
    assertUserFilesIntact('test:clean');
  });

  test('4. Les scripts npm compilent ScenarioManager avant de lancer runner.js', () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts;
    for (const name of ['test:deploy-antigravity', 'test:deploy-claude', 'test:deploy-all', 'test:clean']) {
      assert.match(scripts[name], /^tsc -p tsconfig\.test\.json && node test\/scenarios\/scripts\/runner\.js /, name);
    }
  });
});
