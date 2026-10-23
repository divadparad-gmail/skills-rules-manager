import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, describe, before, after } from 'node:test';

// Le banc d'essai en ligne de commande ne doit jamais effacer le travail de l'utilisateur :
// les vrais fichiers sont sauvegardés avant un déploiement et restaurés au vidage.
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

  // Profil isolé : la règle doublon globale ne doit jamais toucher le vrai ~/.gemini
  const env = () => ({ ...process.env, USERPROFILE: home, HOME: home });
  const run = (...args: string[]) =>
    execFileSync(process.execPath, [runner, args[0], workspace, ...args.slice(1)], { encoding: 'utf8', env: env() });
  const runStatut = (...args: string[]) =>
    spawnSync(process.execPath, [runner, args[0], workspace, ...args.slice(1)], { encoding: 'utf8', env: env() });

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
    const sortie = run('antigravity');
    assert.ok(fs.existsSync(path.join(workspace, '.agents', 'rules', '02-rule-perm-standard-always-on.md')));
    assert.ok(fs.existsSync(path.join(workspace, 'GEMINI.md')), 'GEMINI.md est une fixture du banc d\'essai');
    assert.match(sortie, /Banc d'essai actif/, 'Le terminal signale le banc actif');
    assertUserFilesIntact('test:deploy-antigravity');
  });

  test('2. Un banc actif est refusé (code 2) ; --ecraser vide, restaure puis redéploie', () => {
    const refus = runStatut('claude-code');
    assert.strictEqual(refus.status, 2, refus.stderr);
    assert.match(refus.stderr, /déjà déployé/);
    assert.match(refus.stderr, /npm run test:clean/);
    assert.ok(!fs.existsSync(path.join(workspace, 'CLAUDE.md')), 'Rien n\'a été déployé');

    run('claude-code', '--ecraser');
    assert.ok(fs.existsSync(path.join(workspace, '.claude', 'rules', '01-rule-claude-perm-standard.md')));
    assert.ok(
      !fs.existsSync(path.join(workspace, '.agents', 'rules', '02-rule-perm-standard-always-on.md')),
      'Le nouveau déploiement remplace entièrement le précédent'
    );
    assertUserFilesIntact('test:deploy-claude');

    run('all', '--ecraser');
    assert.ok(fs.existsSync(path.join(workspace, 'CLAUDE.md')));
    assert.ok(fs.existsSync(path.join(home, '.gemini', 'config', 'rules', 'rule-test-doublon.md')), 'Doublon global dans le profil isolé');
    assertUserFilesIntact('test:deploy-all');
  });

  test('3. test:clean ne supprime que les fixtures, puis retire la sauvegarde et le manifeste', () => {
    run('clean');
    assert.ok(!fs.existsSync(path.join(workspace, '.agents', 'rules', '02-rule-perm-standard-always-on.md')), 'Fixture supprimée');
    assert.ok(!fs.existsSync(path.join(workspace, 'CLAUDE.md')), 'CLAUDE.md fixture supprimé');
    assert.ok(!fs.existsSync(path.join(home, '.gemini', 'config', 'rules', 'rule-test-doublon.md')));
    assert.ok(fs.existsSync(path.join(workspace, '.agents')), 'Le dossier .agents/ n\'est jamais supprimé');
    assert.ok(fs.existsSync(path.join(workspace, '.claude')), 'Le dossier .claude/ n\'est jamais supprimé');
    assert.ok(!fs.existsSync(path.join(workspace, '.banc-essai-sauvegarde')), 'La sauvegarde est retirée');
    assert.ok(!fs.existsSync(path.join(workspace, '.scenario-manifest.json')), 'Le manifeste est retiré');
    assertUserFilesIntact('test:clean');
  });

  test('4. Les scripts npm compilent ScenarioManager avant de lancer runner.js', () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts;
    for (const name of ['test:deploy-antigravity', 'test:deploy-claude', 'test:deploy-all', 'test:clean']) {
      assert.match(scripts[name], /^tsc -p tsconfig\.test\.json && node test\/scenarios\/scripts\/runner\.js /, name);
    }
  });

  test('5. Un vrai CLAUDE.md est sauvegardé, listé, puis restauré à l\'identique par test:clean', () => {
    const claudeMd = path.join(workspace, 'CLAUDE.md');
    const original = Buffer.from('# Vrai CLAUDE.md\r\nÉté, façade.\r\n', 'utf8');
    fs.writeFileSync(claudeMd, original);

    const sortie = run('claude-code');
    assert.match(sortie, /Vrais fichiers sauvegardés, restaurés au vidage :\n {2}- CLAUDE\.md/);
    assert.ok(fs.existsSync(path.join(workspace, '.banc-essai-sauvegarde', 'racine', 'CLAUDE.md.sauvegarde')));

    const vidage = run('clean');
    assert.match(vidage, /Originaux restaurés :\n {2}- CLAUDE\.md/);
    assert.ok(fs.readFileSync(claudeMd).equals(original), 'CLAUDE.md est restauré octet pour octet');
    fs.rmSync(claudeMd);
  });

  test('6. Une fixture modifiée : test:clean refuse (code 2) et liste, --ecraser restaure ; le redéploiement refuse aussi', () => {
    run('antigravity');
    const fixture = path.join(workspace, '.agents', 'rules', '02-rule-perm-standard-always-on.md');
    fs.appendFileSync(fixture, '\nModifié pendant le test.\n');

    const refusVidage = runStatut('clean');
    assert.strictEqual(refusVidage.status, 2, refusVidage.stderr);
    assert.match(refusVidage.stderr, /- \.agents\/rules\/02-rule-perm-standard-always-on\.md/);
    assert.match(refusVidage.stderr, /npm run test:clean -- --ecraser/);
    assert.ok(fs.existsSync(fixture), 'Rien n\'a été supprimé');

    // --ecraser au déploiement ne vaut pas accord pour écraser une fixture modifiée
    const refusRedeploiement = runStatut('claude-code', '--ecraser');
    assert.strictEqual(refusRedeploiement.status, 2, refusRedeploiement.stderr);
    assert.match(refusRedeploiement.stderr, /npm run test:clean -- --ecraser/);
    assert.ok(fs.readFileSync(fixture, 'utf8').endsWith('Modifié pendant le test.\n'), 'La fixture modifiée est intacte');

    run('clean', '--ecraser');
    assert.ok(!fs.existsSync(fixture));
    assert.ok(!fs.existsSync(path.join(workspace, '.scenario-manifest.json')));
    assertUserFilesIntact('test:clean -- --ecraser');
  });

  test('7. Une option inconnue est refusée (code 1)', () => {
    const resultat = runStatut('clean', '--force');
    assert.strictEqual(resultat.status, 1);
    assert.match(resultat.stderr, /Option inconnue/);
  });
});
