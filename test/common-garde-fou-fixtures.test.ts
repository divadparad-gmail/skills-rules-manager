import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, describe, before, after } from 'node:test';
import { ScenarioManager } from '../src/services/ScenarioManager';

// Le garde-fou empêche de commiter une fixture du banc d'essai. Il vit dans un module JavaScript
// exécutable par node seul, partagé avec le hook .githooks/pre-commit : ce test et le hook
// appliquent la même règle. Chaque cas travaille dans un dépôt Git temporaire.
const repoRoot = path.resolve(__dirname, '../..');
const guard = require(path.join(repoRoot, 'scripts', 'garde-fou-fixtures.js'));
const HOOK = path.join(repoRoot, '.githooks', 'pre-commit');

// Une variable héritée d'un hook Git ferait viser un autre dépôt ou un autre index
for (const name of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete process.env[name];

type Violation = { rule: string; path: string; message: string };

describe('Garde-fou des fixtures du banc d\'essai (npm test et hook pre-commit)', () => {
  let tempBase: string;
  let counter = 0;

  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });

  /** Dépôt temporaire avec les sources des fixtures, le .gitignore et le .vscodeignore réels. */
  const makeRepo = (): string => {
    const repo = path.join(tempBase, `depot-${++counter}`);
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'config', 'user.email', 'test@example.invalid');
    // Sans .gitattributes ni conversion : un fichier en CRLF reste en CRLF dans l'index
    git(repo, 'config', 'core.autocrlf', 'false');
    for (const dir of guard.FIXTURE_SOURCE_DIRS) {
      fs.cpSync(path.join(repoRoot, dir), path.join(repo, dir), { recursive: true });
    }
    for (const file of ['.gitignore', '.vscodeignore']) {
      fs.copyFileSync(path.join(repoRoot, file), path.join(repo, file));
    }
    return repo;
  };

  const write = (repo: string, rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), content);
  };

  /** Contenu de la fixture déployée à ce chemin. */
  const fixture = (rel: string): string => {
    for (const dir of guard.FIXTURE_SOURCE_DIRS) {
      const file = path.join(repoRoot, dir, rel);
      if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    }
    throw new Error(`Fixture introuvable : ${rel}`);
  };

  /** Déploie toutes les fixtures et le manifeste dans l'arbre de travail, comme test:deploy-all. */
  const deployBench = (repo: string) => {
    const files: string[] = guard.listFixtureFiles(repo);
    for (const rel of files) write(repo, rel, fixture(rel));
    write(repo, guard.MANIFEST_FILE, JSON.stringify({ target: 'all', files }, null, 2));
  };

  const violations = (repo: string): Violation[] => {
    const result = guard.checkAll(repo);
    assert.strictEqual(result.inGitRepo, true, `${repo} doit être reconnu comme un dépôt Git`);
    return result.violations;
  };

  const assertRefused = (list: Violation[], rule: string, rel: string) => {
    assert.ok(
      list.some((v) => v.rule === rule && v.path === rel),
      `Attendu : refus ${rule} sur ${rel}. Obtenu :\n${guard.formatViolations(list) || '  (aucun refus)'}`
    );
  };

  const assertAccepted = (list: Violation[]) => {
    assert.deepStrictEqual(list, [], `Aucun refus attendu. Obtenu :\n${guard.formatViolations(list)}`);
  };

  before(() => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'garde-fou-'));
  });

  after(() => {
    fs.rmSync(tempBase, { recursive: true, force: true });
  });

  test('1. Le dépôt réel passe le garde-fou', (t) => {
    if (!guard.isRepoRoot(repoRoot)) {
      t.skip('Hors d\'un dépôt Git : rien à vérifier.');
      return;
    }
    assertAccepted(guard.checkAll(repoRoot).violations);
  });

  test('2. La liste des fixtures est celle de ScenarioManager.getScenarioFiles() (fichiers seulement)', () => {
    const root = path.join(tempBase, 'equivalence');
    for (const dir of guard.FIXTURE_SOURCE_DIRS) {
      fs.cpSync(path.join(repoRoot, dir), path.join(root, dir), { recursive: true });
    }
    // Sans manifeste : getScenarioFiles() ne lit alors que les sources
    const isDirectory = (rel: string) =>
      guard.FIXTURE_SOURCE_DIRS.some((dir: string) => {
        const file = path.join(root, dir, rel);
        return fs.existsSync(file) && fs.statSync(file).isDirectory();
      });
    const fromManager = [...ScenarioManager.getScenarioFiles(root)].filter((rel) => !isDirectory(rel)).sort();
    assert.deepStrictEqual(guard.listFixtureFiles(root), fromManager);
    for (const canonical of guard.CANONICAL_PATHS) {
      assert.ok(fromManager.includes(canonical), `${canonical} doit être une fixture du banc d'essai`);
    }
  });

  test('3. Une fixture non canonique indexée est refusée (a)', () => {
    const repo = makeRepo();
    const rel = '.agents/rules/02-rule-perm-standard-always-on.md';
    write(repo, rel, fixture(rel));
    git(repo, 'add', '-f', rel);
    assertRefused(violations(repo), 'a', rel);
  });

  test('4. Les variantes de désactivation d\'une fixture sont refusées (a)', () => {
    const repo = makeRepo();
    const disabled = '.agents/rules/02-rule-perm-standard-always-on.md.disabled';
    const enabled = '.agents/rules/07-rule-disabled-suffix.md';
    write(repo, disabled, fixture('.agents/rules/02-rule-perm-standard-always-on.md'));
    write(repo, enabled, fixture('.agents/rules/07-rule-disabled-suffix.md.disabled'));
    git(repo, 'add', '-f', disabled, enabled);
    const list = violations(repo);
    assertRefused(list, 'a', disabled);
    assertRefused(list, 'a', enabled);
  });

  test('5. Le manifeste et la sauvegarde du banc d\'essai indexés sont refusés (a)', () => {
    const repo = makeRepo();
    const backup = `${guard.BACKUP_DIR}/racine/_agents/rules/02.md.sauvegarde`;
    write(repo, guard.MANIFEST_FILE, '{ "files": [] }');
    write(repo, backup, '# Sauvegarde');
    git(repo, 'add', '-f', guard.MANIFEST_FILE, backup);
    const list = violations(repo);
    assertRefused(list, 'a', guard.MANIFEST_FILE);
    assertRefused(list, 'a', backup);
  });

  test('6. Un fichier canonique identique à sa fixture est refusé, en LF comme en CRLF (b)', () => {
    const repo = makeRepo();
    write(repo, 'GEMINI.md', fixture('GEMINI.md').replace(/\r\n/g, '\n'));
    write(repo, '.mcp.json', fixture('.mcp.json').replace(/\r?\n/g, '\r\n'));
    git(repo, 'add', 'GEMINI.md', '.mcp.json');
    assert.match(git(repo, 'cat-file', 'blob', ':.mcp.json'), /\r\n/, 'La version indexée doit être en CRLF');
    const list = violations(repo);
    assertRefused(list, 'b', 'GEMINI.md');
    assertRefused(list, 'b', '.mcp.json');
  });

  test('7. Un fichier canonique différent de sa fixture est accepté', () => {
    const repo = makeRepo();
    write(repo, 'GEMINI.md', '# Vraies consignes du projet\n');
    write(repo, '.agents/hooks.json', '{ "hooks": [] }\n');
    git(repo, 'add', 'GEMINI.md', '.agents/hooks.json');
    assertAccepted(violations(repo));
  });

  test('8. Un vrai fichier est accepté', () => {
    const repo = makeRepo();
    write(repo, '.agents/rules/projet-consignes.md', '---\ntrigger: always_on\n---\n# Consignes\n');
    git(repo, 'add', '.agents/rules/projet-consignes.md');
    assertAccepted(violations(repo));
  });

  test('9. Un banc déployé mais non indexé est accepté ; git add -A n\'indexe que les 5 canoniques, refusés (b)', () => {
    const repo = makeRepo();
    deployBench(repo);
    assertAccepted(violations(repo));

    git(repo, 'add', '-A');
    const indexed = new Set(git(repo, 'ls-files').split('\n').filter(Boolean));
    const deployed = [...guard.listFixtureFiles(repo), guard.MANIFEST_FILE].filter((rel: string) => indexed.has(rel));
    assert.deepStrictEqual(deployed.sort(), [...guard.CANONICAL_PATHS].sort());
    const list = violations(repo);
    for (const rel of guard.CANONICAL_PATHS) assertRefused(list, 'b', rel);
    assert.ok(list.every((v) => v.rule === 'b'), guard.formatViolations(list));
  });

  test('10. Un .gitignore incomplet est refusé (c)', () => {
    const repo = makeRepo();
    const rel = '.agents/rules/03-rule-cond-trigger-glob.md';
    const gitignore = fs.readFileSync(path.join(repo, '.gitignore'), 'utf8');
    const kept = gitignore.split('\n').filter((line) => line !== `/${rel}` && line !== `/${guard.BACKUP_DIR}/`);
    fs.writeFileSync(path.join(repo, '.gitignore'), kept.join('\n'));
    const list = violations(repo);
    assertRefused(list, 'c', rel);
    assertRefused(list, 'c', `${guard.BACKUP_DIR}/index.json`);
    assert.ok(list.some((v) => v.message.includes(`/${rel}`)), 'Le message doit donner la ligne à ajouter');
  });

  test('11. Un .gitignore qui ignore un chemin canonique est refusé (e)', () => {
    const repo = makeRepo();
    fs.appendFileSync(path.join(repo, '.gitignore'), '\n/GEMINI.md\n');
    assertRefused(violations(repo), 'e', 'GEMINI.md');
  });

  test('12. Un .vscodeignore sans la sauvegarde, ou avec une négation, est refusé (d)', () => {
    const repo = makeRepo();
    const file = path.join(repo, '.vscodeignore');
    const original = fs.readFileSync(file, 'utf8');

    fs.writeFileSync(file, original.split('\n').filter((line) => line.trim() !== guard.VSCODEIGNORE_LINE).join('\n'));
    assertRefused(violations(repo), 'd', '.vscodeignore');

    fs.writeFileSync(file, `${original}\n!${guard.BACKUP_DIR}/index.json\n`);
    const list = violations(repo);
    assertRefused(list, 'd', '.vscodeignore');
    assert.ok(list.some((v) => v.message.includes('négation')));

    fs.writeFileSync(file, original);
    assertAccepted(violations(repo));
  });

  test('13. Le hook pre-commit refuse une fixture et accepte un vrai fichier', () => {
    const repo = makeRepo();
    const commit = () =>
      spawnSync('git', ['-c', `core.hooksPath=${path.dirname(HOOK)}`, 'commit', '-q', '-m', 'essai'], {
        cwd: repo,
        encoding: 'utf8',
      });

    const rel = '.claude/rules/01-rule-claude-perm-standard.md';
    write(repo, rel, fixture(rel));
    git(repo, 'add', '-f', rel);
    const refused = commit();
    assert.notStrictEqual(refused.status, 0, 'Le commit d\'une fixture doit être refusé');
    assert.match(refused.stderr, /Commit refusé/);
    assert.match(refused.stderr, /01-rule-claude-perm-standard\.md/);

    git(repo, 'rm', '-q', '--cached', rel);
    write(repo, '.claude/rules/projet-consignes.md', '# Consignes\n');
    git(repo, 'add', '.claude/rules/projet-consignes.md');
    const accepted = commit();
    assert.strictEqual(accepted.status, 0, `Le commit d'un vrai fichier doit passer : ${accepted.stderr}`);
  });

  test('14. Le hook est exécutable, en LF, activé par « prepare » et exclu du paquet', (t) => {
    const hook = fs.readFileSync(HOOK, 'utf8');
    assert.ok(!hook.includes('\r'), 'Le hook doit être en LF : sh ne lit pas « #!/bin/sh\\r »');
    assert.match(hook, /^#!\/bin\/sh\n/);
    assert.match(hook, /scripts\/garde-fou-fixtures\.js/, 'Le hook doit appeler le module du garde-fou');

    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.scripts.prepare, 'node scripts/activer-hooks.js');

    const vscodeignore = fs.readFileSync(path.join(repoRoot, '.vscodeignore'), 'utf8');
    assert.match(vscodeignore, /^\.githooks\/\*\*$/m, 'Le hook n\'entre pas dans le paquet');
    assert.match(vscodeignore, /^scripts\/\*\*$/m, 'Les scripts du dépôt n\'entrent pas dans le paquet');

    if (!guard.isRepoRoot(repoRoot)) {
      t.skip('Hors d\'un dépôt Git : le mode du hook dans l\'index ne peut pas être vérifié.');
      return;
    }
    const entry = git(repoRoot, 'ls-files', '-s', '.githooks/pre-commit');
    assert.match(entry, /^100755 /, 'Le hook doit être exécutable dans l\'index (git add --chmod=+x)');
  });

  test('15. activer-hooks.js règle core.hooksPath dans un dépôt, et ne fait rien ailleurs', () => {
    const install = (root: string) => {
      for (const rel of ['scripts/activer-hooks.js', 'scripts/garde-fou-fixtures.js', '.githooks/pre-commit']) {
        write(root, rel, fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
      }
    };
    const run = (root: string) =>
      execFileSync(process.execPath, [path.join(root, 'scripts', 'activer-hooks.js')], {
        cwd: root,
        encoding: 'utf8',
        // Empêche Git de remonter vers un éventuel dépôt au-dessus du dossier temporaire
        env: { ...process.env, GIT_CEILING_DIRECTORIES: tempBase },
      });
    const hooksPath = (root: string) =>
      spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' }).stdout.trim();

    const outside = path.join(tempBase, 'hors-git');
    install(outside);
    assert.match(run(outside), /Hors d'un dépôt Git/);

    const repo = path.join(tempBase, 'avec-git');
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q');
    install(repo);
    assert.match(run(repo), /activé/);
    assert.strictEqual(hooksPath(repo), '.githooks');

    const parent = path.join(tempBase, 'parent');
    fs.mkdirSync(parent, { recursive: true });
    git(parent, 'init', '-q');
    const nested = path.join(parent, 'paquet');
    install(nested);
    assert.match(run(nested), /Hors d'un dépôt Git/);
    assert.strictEqual(hooksPath(parent), '', 'Le dépôt parent ne doit pas être configuré');
  });
});
