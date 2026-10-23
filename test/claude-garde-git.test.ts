import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, describe } from 'node:test';
import { ScenarioManager } from '../src/services/ScenarioManager';

// Le hook PreToolUse de Claude Code (.claude/settings.json) refuse git clean -x ou -X et
// git commit --no-verify ou -n. Sa règle vit dans un module JavaScript exécuté par node seul :
// ce test l'importe directement, puis lance la commande exacte déclarée dans settings.json.
const repoRoot = path.resolve(__dirname, '../..');
const SCRIPT = path.join(repoRoot, 'scripts', 'garde-git-claude.js');
const SETTINGS = path.join(repoRoot, '.claude', 'settings.json');
const garde = require(SCRIPT);

type Refus = { regle: string; commande: string };
const regles = (commande: string, dialecte: 'bash' | 'powershell' = 'bash'): string[] =>
  (garde.analyserCommande(commande, dialecte) as Refus[]).map((r) => r.regle);

const verifierRefus = (cas: string[], regle: string, dialecte: 'bash' | 'powershell' = 'bash') => {
  const manques = cas.filter((commande) => !regles(commande, dialecte).includes(regle));
  assert.deepStrictEqual(manques, [], `Commandes qui auraient dû être refusées (${regle})`);
};
const verifierPermis = (cas: string[], dialecte: 'bash' | 'powershell' = 'bash') => {
  const refusees = cas.filter((commande) => regles(commande, dialecte).length > 0);
  assert.deepStrictEqual(refusees, [], 'Commandes qui auraient dû être permises');
};

/** Git Bash sous Windows (le shell des hooks de Claude Code), sh ailleurs ; null s'il est introuvable. */
const trouverShell = (): string | null => {
  if (process.platform !== 'win32') return 'sh';
  const candidats = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'];
  try {
    const execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
    candidats.push(path.join(execPath.replace(/[\\/](mingw64|ucrt64|clangarm64|usr)[\\/].*$/i, ''), 'bin', 'bash.exe'));
  } catch {
    // git absent : seuls les chemins standard restent
  }
  return candidats.find((candidat) => fs.existsSync(candidat)) ?? null;
};

const entree = (commande: unknown, toolName = 'Bash') =>
  JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: { command: commande }, cwd: repoRoot });

describe('Hook PreToolUse de Claude Code contre les commandes Git dangereuses', () => {
  test('1. git clean avec -x ou -X est refusé, options groupées et options globales comprises', () => {
    verifierRefus(
      [
        'git clean -x',
        'git clean -X',
        'git clean -fdx',
        'git clean -xdf',
        'git clean -dX',
        'git clean -n -x',
        'git clean -nX',
        'git clean -f -d -x',
        'git clean -fx -- src',
        'git clean -e "*.log" -x',
        'git clean --exclude "*.log" -x',
        'git clean . -x',
        'git -C sous-dossier clean -x',
        'git -c core.quotepath=false clean -fdx',
        'git --git-dir=.git --work-tree=. clean -X',
        'git --git-dir .git clean -x',
        'git --no-pager clean -xn',
        'git.exe clean -x',
        'GIT clean -x',
        '"C:/Program Files/Git/cmd/git.exe" clean -x',
        '"C:\\Program Files\\Git\\cmd\\git.exe" clean -x',
        '/usr/bin/git clean -x',
        'git-clean -fdx',
        'GIT_DIR=.git git clean -x',
        'env git clean -x',
        'sudo git clean -fdx',
        'xargs git clean -x',
        'echo git clean -x',
      ],
      'git-clean-x'
    );
  });

  test('2. git clean sans -x ni -X est permis, et une valeur ou un chemin nommé x ne compte pas', () => {
    verifierPermis([
      'git clean -n',
      'git clean -fd',
      'git clean -fdn',
      'git clean -i',
      'git clean -fdex',
      'git clean -e -x -fd',
      'git clean --exclude=-x -fd',
      'git clean --exclude -x -n',
      'git clean -f -- -x',
      'git clean --dry-run',
      'git cherry-pick -x abc123',
      'git log -X',
    ]);
  });

  test('3. git commit avec --no-verify ou -n est refusé, options groupées et abréviations comprises', () => {
    verifierRefus(
      [
        'git commit --no-verify -m "x"',
        'git commit -n -m "x"',
        'git commit -nm "x"',
        'git commit -anm "x"',
        'git commit -m "x" -n',
        'git commit --no-veri -m x',
        'git commit --no-verif -m x',
        'git commit --dry-run --no-verify',
        'git commit --no-verify --verify -m x',
        'git -C . commit -n',
        'git -c user.name=x commit --no-verify',
        'git commit -F msg.txt -n',
        'git commit --file msg.txt --no-verify',
        'git commit -S -n -m x',
        'git-commit -n',
      ],
      'git-commit-no-verify'
    );
  });

  test('4. Les options courantes de git commit sont permises, et une valeur nommée n ne compte pas', () => {
    verifierPermis([
      'git commit -am "message"',
      'git commit -m "message"',
      'git commit -mn',
      'git commit -m -n',
      'git commit -m "x" -- -n',
      'git commit --message -n',
      'git commit -F msg.txt',
      'git commit -C HEAD',
      'git commit --amend --no-edit',
      'git commit -v -m x',
      'git commit --no-verbose -m x',
      'git commit --no-ver -m x',
      'git commit -Sn -m x',
      'git commit --dry-run',
      'git push -n',
      'git add -n .',
      'git status',
      'git log --oneline -5',
      'npm test',
      'git clean --help',
    ]);
  });

  test('5. Les commandes enchaînées, les sous-shells et les sous-commandes sont analysés', () => {
    verifierRefus(
      [
        'npm test && git clean -fdx',
        'git status; git clean -X',
        'echo ok | git clean -x',
        'false || git clean -x',
        'sleep 1 & git clean -x',
        'npm test\ngit clean -x',
        'npm test \\\n && git clean -x',
        '(cd test && git clean -x)',
        '{ git clean -x; }',
        'echo $(git clean -fdx)',
        'echo "$(git clean -fdx)"',
        'echo $(echo $(git clean -x))',
        'echo `git clean -fdx`',
        'bash -c "git clean -fdx"',
        'bash -o pipefail -c "git clean -fdx"',
        'sh -lc \'git clean -x\'',
        'eval "git clean -x"',
        'cmd /c "git clean -x"',
        'pwsh -NoProfile -Command "git clean -x"',
      ],
      'git-clean-x'
    );
    verifierRefus(
      ['git add . && git commit -nm x', 'sh -c \'git commit -n -m x\'', 'echo $(git commit --no-verify -m x)'],
      'git-commit-no-verify'
    );
    assert.deepStrictEqual(regles('git clean -x && git commit -n'), ['git-clean-x', 'git-commit-no-verify']);
  });

  test('6. Les textes cités, les messages de commit et le corps des heredocs ne sont pas analysés', () => {
    verifierPermis([
      'echo "git clean -x"',
      'grep -r "git clean -x" docs',
      'git commit -m "docs : interdire git clean -x et git commit --no-verify"',
      "git commit -m 'git clean -fdx; git commit -n'",
      'git commit -m "$(cat <<\'EOF\'\nchore: interdire git clean -x\n\nN\'utilisez jamais git commit --no-verify.\nEOF\n)"',
      'cat <<EOF > note.txt\ngit clean -fdx\nEOF\ngit status',
      'cat <<-FIN\n\tgit clean -x\n\tFIN\nnpm test',
      'git commit -m "guillemets non fermés git clean -x',
      'npm test # git clean -x en commentaire',
    ]);
    // Après la fin du heredoc, l'analyse reprend
    verifierRefus(['cat <<EOF\ntexte\nEOF\ngit clean -x'], 'git-clean-x');
  });

  test('7. PowerShell : enchaînements, opérateur d\'appel, blocs et here-strings', () => {
    verifierRefus(
      [
        'git clean -fdx; npm test',
        '& git clean -x',
        '& "C:\\Program Files\\Git\\cmd\\git.exe" clean -X',
        'npm test && git clean -x',
        'Invoke-Command { git clean -x }',
        '(git clean -x)',
        'Write-Host "$(git clean -x)"',
        'git clean `\n  -fdx',
        `pwsh -EncodedCommand ${Buffer.from('git clean -x', 'utf16le').toString('base64')}`,
      ],
      'git-clean-x',
      'powershell'
    );
    verifierRefus(['git commit -nm "x"', 'git commit --no-verify -m x'], 'git-commit-no-verify', 'powershell');
    verifierPermis(
      [
        "git commit -m @'\nchore: interdire git clean -x\n\nN'utilisez jamais git commit --no-verify.\n'@",
        'git commit -m @"\nRefuser git clean -fdx\n"@',
        "Write-Host 'git clean -x'",
        "git commit -m 'l''outil refuse git clean -x'",
        'git status; git log -1',
        '<# git clean -x #> git status',
      ],
      'powershell'
    );
    verifierRefus(['$m = @"\n$(git clean -x)\n"@'], 'git-clean-x', 'powershell');
  });

  test('8. La raison du refus est en français et nomme la règle et l\'alternative', () => {
    const clean = garde.raisonRefus([{ regle: 'git-clean-x', commande: 'git clean -x' }]);
    assert.match(clean, /git clean/);
    assert.match(clean, /\.banc-essai-sauvegarde\//);
    assert.match(clean, /npm run test:clean/);
    const commit = garde.raisonRefus([{ regle: 'git-commit-no-verify', commande: 'git commit -n' }]);
    assert.match(commit, /--no-verify ou -n/);
    assert.match(commit, /pre-commit/);

    // Sortie documentée de PreToolUse, en ASCII seul (caractères accentués échappés)
    const sortie = garde.sortieRefus([{ regle: 'git-clean-x', commande: 'git clean -x' }]);
    assert.match(sortie, /^[\x20-\x7e]+$/);
    const json = JSON.parse(sortie);
    assert.deepStrictEqual(Object.keys(json), ['hookSpecificOutput']);
    assert.strictEqual(json.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.strictEqual(json.hookSpecificOutput.permissionDecision, 'deny');
    assert.strictEqual(json.hookSpecificOutput.permissionDecisionReason, clean);
  });

  test('9. De bout en bout : la commande de settings.json, lancée par le shell des hooks, refuse ou laisse passer', (t) => {
    const shell = trouverShell();
    if (!shell) {
      t.skip('Git Bash introuvable : Claude Code ne lance pas l\'outil Bash sous Windows sans lui.');
      return;
    }
    const commande = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).hooks.PreToolUse[0].hooks[0].command;
    // Comme Claude Code : chemin Windows avec barres obliques inverses, et ici avec une espace
    const lancer = (contenu: string) =>
      spawnSync(shell, ['-c', commande], {
        input: contenu,
        cwd: repoRoot,
        env: { ...process.env, CLAUDE_PROJECT_DIR: repoRoot },
        encoding: 'utf8',
      });

    for (const [toolName, cmd] of [
      ['Bash', 'git clean -n -x'],
      ['Bash', 'git commit --dry-run --no-verify'],
      ['PowerShell', 'git clean -fdX; npm test'],
    ]) {
      const res = lancer(entree(cmd, toolName));
      assert.strictEqual(res.status, 0, `${cmd} : le refus passe par la sortie JSON, avec le code 0\n${res.stderr}`);
      const json = JSON.parse(res.stdout);
      assert.strictEqual(json.hookSpecificOutput.permissionDecision, 'deny', cmd);
      assert.match(json.hookSpecificOutput.permissionDecisionReason, /Commande refusée par le hook PreToolUse/);
    }

    const permis = lancer(entree('git status'));
    assert.strictEqual(permis.status, 0, permis.stderr);
    assert.strictEqual(permis.stdout, '', 'Une commande permise ne produit aucune sortie');
    assert.strictEqual(permis.stderr, '');
  });

  test('10. Une erreur interne laisse passer la commande (code 1, non bloquant) avec un avertissement', () => {
    for (const [cas, contenu] of [
      ['JSON illisible', '{ pas du json'],
      ['entrée vide', ''],
      ['tool_input absent', JSON.stringify({ tool_name: 'Bash' })],
      ['command non textuelle', entree(['git', 'clean', '-x'])],
    ]) {
      const res = spawnSync(process.execPath, [SCRIPT], { input: contenu, encoding: 'utf8' });
      assert.strictEqual(res.status, 1, `${cas} : code 1 attendu (erreur non bloquante)`);
      assert.strictEqual(res.stdout, '', `${cas} : aucune décision ne doit être émise`);
      assert.match(res.stderr, /^\[garde-git\] Avertissement : analyse impossible, .*laissée passer/, cas);
    }
    // Une imbrication démesurée est une erreur interne : la commande passe, avec l'avertissement
    assert.throws(() => garde.analyserCommande('$('.repeat(20) + 'git clean -x'), /imbrication trop profonde/);
    const profonde = spawnSync(process.execPath, [SCRIPT], { input: entree('$('.repeat(20) + 'git clean -x'), encoding: 'utf8' });
    assert.strictEqual(profonde.status, 1);
    assert.strictEqual(profonde.stdout, '');
    assert.match(profonde.stderr, /imbrication trop profonde/);
  });

  test('11. settings.json déclare le hook sans chemin personnel, et ce n\'est pas une fixture', () => {
    const settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
    const groupes = settings.hooks.PreToolUse;
    assert.strictEqual(groupes.length, 1);
    assert.strictEqual(groupes[0].matcher, 'Bash|PowerShell');
    assert.deepStrictEqual(groupes[0].hooks, [
      { type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/scripts/garde-git-claude.js"', timeout: 10 },
    ]);
    const texte = fs.readFileSync(SETTINGS, 'utf8');
    // Lettre de lecteur isolée (pas le « s:/ » de https://), barre oblique inverse, dossier personnel
    assert.doesNotMatch(texte, /(^|[^A-Za-z])[A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\//, 'Aucun chemin absolu ni personnel');
    assert.ok(fs.existsSync(SCRIPT), 'Le script du hook doit exister');

    assert.ok(!ScenarioManager.getScenarioFiles(repoRoot).has('.claude/settings.json'), 'settings.json ne doit pas être une fixture');
    const ignore = spawnSync('git', ['check-ignore', '-q', '--no-index', '.claude/settings.json'], { cwd: repoRoot });
    if (ignore.status !== 128) assert.strictEqual(ignore.status, 1, 'settings.json ne doit pas être ignoré par Git');
  });
});
