/**
 * @description: Banc d'essai réel de bout en bout pour le Jalon 3 du skill wf-hook.
 * Exécute un scénario complet d'intégration dans un bac à sable Git isolé :
 *   1. Initialisation d'un dépôt Git bac à sable dédié.
 *   2. Synthèse de validateurs réels (secrets, commit_message).
 *   3. Épreuve Git native de bout en bout (pre-commit & commit-msg) :
 *      - Blocage réel d'un `git commit` avec secret stagé
 *      - Blocage réel d'un `git commit` avec message non conventionnel
 *      - Autorisation d'un `git commit` propre et conforme
 *   4. Épreuve Claude Code de bout en bout :
 *      - Interception fail-closed de commandes avec options globales (--no-pager, -c, etc.)
 *      - Passage immédiat des commandes saines (git status)
 *   5. Épreuve Antigravity de bout en bout :
 *      - Interception et émission atomique de {"decision":"deny"} sur secret
 *      - Émission de {"decision":"allow"} sur commande saine
 *      - Émission du Fail-Closed par le runner .cmd en cas d'erreur de Node
 *   6. Épreuve de Désinstallation Chirurgicale & Anti-Lock-Out :
 *      - Suppression de tous les hooks sans affecter les configs tierces
 *      - Restauration et suppression des fichiers temporaires
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync, spawnSync } = require('child_process');

const SKILL_SCRIPTS = path.resolve(__dirname, '../.agents/skills/wf-hook/scripts');
const { generateValidatorCode } = require(path.join(SKILL_SCRIPTS, 'rule-synthesizer'));
const {
  installClaudeHook,
  installAntigravityHook,
  installGitHook,
  listManagedHooks,
  removeManagedHook
} = require(path.join(SKILL_SCRIPTS, 'hook-manager'));

const SANDBOX_DIR = path.join(__dirname, 'sandbox-e2e');

function setupSandbox() {
  if (fs.existsSync(SANDBOX_DIR)) {
    fs.rmSync(SANDBOX_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(SANDBOX_DIR, { recursive: true });

  // Initialisation Git
  execSync('git init', { cwd: SANDBOX_DIR, stdio: 'ignore' });
  execSync('git config user.name "Banc Essai Jalon 3"', { cwd: SANDBOX_DIR, stdio: 'ignore' });
  execSync('git config user.email "jalon3@test.local"', { cwd: SANDBOX_DIR, stdio: 'ignore' });

  // Commit initial vide pour positionner HEAD
  execSync('git commit --allow-empty -m "chore: initial bootstrap"', { cwd: SANDBOX_DIR, stdio: 'ignore' });
}

function cleanSandbox() {
  if (fs.existsSync(SANDBOX_DIR)) {
    fs.rmSync(SANDBOX_DIR, { recursive: true, force: true });
  }
}

console.log('=================================================================');
console.log('🚀 DÉMARRAGE DU BANC D\'ESSAI RÉEL JALON 3 (Preuves de Bout en Bout)');
console.log('=================================================================\n');

setupSandbox();

try {
  // ---------------------------------------------------------------------------
  // ÉTAPE 1 : Synthèse des scripts validateurs dans le bac à sable
  // ---------------------------------------------------------------------------
  console.log('📦 [1/5] Synthèse des scripts validateurs autonomes...');
  const scriptsDir = path.join(SANDBOX_DIR, '.agents', 'skills', 'wf-hook', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });

  // Validateur secrets
  const secretCode = generateValidatorCode({ hookId: 'sec-gate', ruleType: 'secrets' });
  const secretScript = path.join(scriptsDir, 'wf-hook-sec-gate.js');
  fs.writeFileSync(secretScript, secretCode, 'utf8');

  // Validateur convention de commit
  const commitMsgCode = generateValidatorCode({ hookId: 'msg-gate', ruleType: 'commit_message' });
  const commitMsgScript = path.join(scriptsDir, 'wf-hook-msg-gate.js');
  fs.writeFileSync(commitMsgScript, commitMsgCode, 'utf8');

  // Copie des adaptateurs et runners dans le bac à sable pour tester en isolation
  ['adapter-claude.js', 'adapter-antigravity.js', 'runner-antigravity.cmd', 'runner-antigravity.sh'].forEach(f => {
    fs.copyFileSync(path.join(SKILL_SCRIPTS, f), path.join(scriptsDir, f));
  });
  console.log('✅ Scripts validateurs et adaptateurs synthétisés avec succès.\n');

  // ---------------------------------------------------------------------------
  // ÉTAPE 2 : Épreuve Git native de bout en bout (pre-commit & commit-msg)
  // ---------------------------------------------------------------------------
  console.log('🔒 [2/5] Épreuve Git native de bout en bout (terminal / process Git réel)...');

  // Installation des hooks Git
  const gitRelSecret = '.agents/skills/wf-hook/scripts/wf-hook-sec-gate.js';
  const gitRelMsg = '.agents/skills/wf-hook/scripts/wf-hook-msg-gate.js';

  installGitHook({
    workspaceRoot: SANDBOX_DIR,
    hookType: 'pre-commit',
    hookId: 'sec-gate',
    scriptRelativePath: gitRelSecret
  });

  installGitHook({
    workspaceRoot: SANDBOX_DIR,
    hookType: 'commit-msg',
    hookId: 'msg-gate',
    scriptRelativePath: gitRelMsg
  });

  // A. Épreuve 2.1 : Tenter de committer un fichier avec secret via git commit réel
  const dirtyFile = path.join(SANDBOX_DIR, 'config.js');
  fs.writeFileSync(dirtyFile, 'const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";\n', 'utf8');
  execSync('git add config.js', { cwd: SANDBOX_DIR, stdio: 'ignore' });

  let gitCommitBlocked = false;
  let gitStderr = '';
  try {
    execSync('git commit -m "feat: add aws credentials"', {
      cwd: SANDBOX_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
  } catch (err) {
    gitCommitBlocked = true;
    gitStderr = (err.stderr || err.stdout || '').toString();
  }

  assert.strictEqual(gitCommitBlocked, true, 'Le git commit réel DOIT être bloqué par pre-commit');
  assert.ok(gitStderr.includes('AKIA...MPLE'), 'Le secret détecté doit être masqué dans la sortie Git');
  assert.ok(!gitStderr.includes('AKIAIOSFODNN7EXAMPLE'), 'Zéro secret en clair dans le terminal');
  console.log('  ✅ Épreuve 2.1 réussie : git commit avec secret bloqué en vrai par pre-commit.');

  // B. Épreuve 2.2 : Corriger le secret mais tenter un message non conventionnel
  fs.writeFileSync(dirtyFile, 'const AWS_KEY = process.env.AWS_KEY;\n', 'utf8');
  execSync('git add config.js', { cwd: SANDBOX_DIR, stdio: 'ignore' });

  let msgBlocked = false;
  let msgStderr = '';
  try {
    execSync('git commit -m "message invalide sans convention"', {
      cwd: SANDBOX_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
  } catch (err) {
    msgBlocked = true;
    msgStderr = (err.stderr || err.stdout || '').toString();
  }

  assert.strictEqual(msgBlocked, true, 'Le git commit réel DOIT être bloqué par commit-msg');
  assert.ok(msgStderr.includes('ne respecte pas la convention requise'), 'Erreur de convention attendue');
  console.log('  ✅ Épreuve 2.2 réussie : git commit avec message invalide bloqué en vrai par commit-msg.');

  // C. Épreuve 2.3 : Effectuer un commit parfaitement propre et conforme
  let cleanSuccess = false;
  try {
    const resClean = execSync('git commit -m "feat(config): sanitize credentials loading"', {
      cwd: SANDBOX_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    cleanSuccess = true;
  } catch (err) {
    cleanSuccess = false;
  }
  assert.strictEqual(cleanSuccess, true, 'Le commit propre et conforme DOIT réussir');
  console.log('  ✅ Épreuve 2.3 réussie : git commit propre et conventionnel autorisé sans encombre.\n');

function getShellPath() {
  const standardPaths = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\bin\\sh.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
  ];
  for (const p of standardPaths) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const gitExec = execSync('git --exec-path', { encoding: 'utf8' }).trim();
    const gitRoot = gitExec.replace(/[\/\\](ucrt64|mingw64|usr|libexec)[\s\S]*$/i, '');
    const b = path.join(gitRoot, 'bin', 'bash.exe');
    if (fs.existsSync(b)) return b;
    const s = path.join(gitRoot, 'bin', 'sh.exe');
    if (fs.existsSync(s)) return s;
  } catch {}
  return 'sh';
}

  // ---------------------------------------------------------------------------
  // ÉTAPE 3 : Épreuve Claude Code de bout en bout (Commande installée dans settings.json)
  // ---------------------------------------------------------------------------
  console.log('🤖 [3/5] Épreuve Claude Code de bout en bout (PreToolUse Bash via settings.json)...');

  const claudeSettings = path.join(SANDBOX_DIR, '.claude', 'settings.json');
  installClaudeHook({
    settingsPath: claudeSettings,
    workspaceRoot: SANDBOX_DIR,
    hookId: 'sec-gate',
    scriptRelativePath: gitRelSecret
  });

  // Extraction de la commande RÉELLEMENT installée dans settings.json
  const claudeConfig = JSON.parse(fs.readFileSync(claudeSettings, 'utf8'));
  const installedCommand = claudeConfig.hooks.PreToolUse[0].hooks[0].command;
  assert.ok(installedCommand.includes('adapter-claude.js'), 'La commande de settings.json DOIT invoquer adapter-claude.js');
  assert.ok(installedCommand.includes('wf-hook-sec-gate.js'), 'La commande de settings.json DOIT passer le script validateur');
  console.log(`  ℹ️ Commande installée dans settings.json : ${installedCommand}`);

  const shellBin = getShellPath();
  const claudeEnv = {
    ...process.env,
    CLAUDE_PROJECT_DIR: SANDBOX_DIR.replace(/\\/g, '/')
  };

  // A. Épreuve 3.1 : Secret UNIQUEMENT dans le message de commit (aucun secret sur disque/index)
  const payloadMsgOnly = JSON.stringify({
    tool_input: { command: 'git commit -m "add key AKIAIOSFODNN7EXAMPLE in commit message"' },
    cwd: SANDBOX_DIR
  });
  const resMsgOnly = spawnSync(shellBin, ['-c', installedCommand], {
    input: payloadMsgOnly,
    env: claudeEnv,
    cwd: SANDBOX_DIR,
    encoding: 'utf8'
  });
  assert.strictEqual(resMsgOnly.status, 2, 'Doit sortir en exit 2 même si le secret est UNIQUEMENT dans le message de commit');
  assert.ok(resMsgOnly.stderr.includes('AKIA...MPLE'), 'Erreur masquée sur stderr attendue');
  assert.ok(!resMsgOnly.stderr.includes('AKIAIOSFODNN7EXAMPLE'), 'Zéro secret en clair sur stderr');
  console.log('  ✅ Épreuve 3.1 réussie : Secret UNIQUEMENT dans le message bloqué en exit 2 via la commande installée.');

  // B. Épreuve 3.2 : Les 5 variantes d'options globales de contournement exécutées via la commande installée
  const claudeEvasiveTests = [
    'git commit -m "wip AKIAIOSFODNN7EXAMPLE"',
    'git --no-pager commit -m "wip AKIAIOSFODNN7EXAMPLE"',
    'git --git-dir=. commit -m "wip AKIAIOSFODNN7EXAMPLE"',
    'git --work-tree=. commit -m "wip AKIAIOSFODNN7EXAMPLE"',
    'git -c user.name="Hacker" commit -m "wip AKIAIOSFODNN7EXAMPLE"'
  ];

  for (const cmd of claudeEvasiveTests) {
    const payload = JSON.stringify({
      tool_input: { command: cmd },
      cwd: SANDBOX_DIR
    });
    const res = spawnSync(shellBin, ['-c', installedCommand], {
      input: payload,
      env: claudeEnv,
      cwd: SANDBOX_DIR,
      encoding: 'utf8'
    });
    assert.strictEqual(res.status, 2, `La commande installée DOIT sortir en exit 2 sur : ${cmd}`);
    assert.ok(res.stderr.includes('AKIA...MPLE'), `Secret masqué requis sur : ${cmd}`);
    assert.ok(!res.stderr.includes('AKIAIOSFODNN7EXAMPLE'), `Zéro secret en clair sur : ${cmd}`);
  }
  console.log('  ✅ Épreuve 3.2 réussie : Les 5 variantes de contournement bloquées à 100% (exit 2) via la commande de settings.json.');

  // C. Épreuve 3.3 : Commande saine (git status) via la commande installée
  const payloadClean = JSON.stringify({
    tool_input: { command: 'git status' },
    cwd: SANDBOX_DIR
  });
  const resClean = spawnSync(shellBin, ['-c', installedCommand], {
    input: payloadClean,
    env: claudeEnv,
    cwd: SANDBOX_DIR,
    encoding: 'utf8'
  });
  assert.strictEqual(resClean.status, 0, 'La commande installée DOIT sortir en exit 0 sur git status');
  console.log('  ✅ Épreuve 3.3 réussie : Commande saine autorisée immédiatement (exit 0) via la commande installée.\n');

  // ---------------------------------------------------------------------------
  // ÉTAPE 4 : Épreuve Antigravity de bout en bout
  // ---------------------------------------------------------------------------
  console.log('🌌 [4/5] Épreuve Antigravity de bout en bout (Harnais + Runner .cmd)...');

  const agyHooksPath = path.join(SANDBOX_DIR, '.agents', 'hooks.json');
  const runnerCmdPath = path.join(scriptsDir, 'runner-antigravity.cmd');

  installAntigravityHook({
    hooksJsonPath: agyHooksPath,
    workspaceRoot: SANDBOX_DIR,
    hookId: 'sec-gate',
    runnerPath: runnerCmdPath,
    scriptPath: secretScript
  });

  const adapterAgySandbox = path.join(scriptsDir, 'adapter-antigravity.js');

  // A. Épreuve 4.1 : Violation détectée -> decision: "deny", sortie impérative exit 0 (anti double-JSON)
  for (const cmd of claudeEvasiveTests) {
    const payload = JSON.stringify({
      toolCall: {
        name: 'run_command',
        args: { CommandLine: cmd, Cwd: SANDBOX_DIR }
      }
    });
    const resAgy = spawnSync(process.execPath, [adapterAgySandbox, secretScript], {
      input: payload,
      encoding: 'utf8',
      cwd: SANDBOX_DIR
    });
    assert.strictEqual(resAgy.status, 0, 'L\'adaptateur Antigravity sort TOUJOURS en exit 0');
    const jsonAgy = JSON.parse(resAgy.stdout.trim());
    assert.strictEqual(jsonAgy.decision, 'deny', `Antigravity doit refuser la commande : ${cmd}`);
    assert.ok(jsonAgy.reason.includes('AKIA...MPLE'), 'Raison avec masquage attendue');
  }
  console.log('  ✅ Épreuve 4.1 réussie : Antigravity émet {"decision":"deny"} en exit 0 sur toutes variantes.');

  // B. Épreuve 4.2 : Commande saine -> decision: "allow", sortie exit 0
  const payloadAgyAllow = JSON.stringify({
    toolCall: {
      name: 'run_command',
      args: { CommandLine: 'git status', Cwd: SANDBOX_DIR }
    }
  });
  const resAgyAllow = spawnSync(process.execPath, [adapterAgySandbox, secretScript], {
    input: payloadAgyAllow,
    encoding: 'utf8',
    cwd: SANDBOX_DIR
  });
  assert.strictEqual(resAgyAllow.status, 0);
  const jsonAgyAllow = JSON.parse(resAgyAllow.stdout.trim());
  assert.strictEqual(jsonAgyAllow.decision, 'allow');
  console.log('  ✅ Épreuve 4.2 réussie : Antigravity émet {"decision":"allow"} sur commande saine.');

  // C. Épreuve 4.3 : Fail-Closed du VRAI runner .cmd sur plantage amont de Node
  const resRunnerCrash = spawnSync(`"${runnerCmdPath}" "${secretScript}"`, {
    shell: true,
    cwd: SANDBOX_DIR,
    env: { ...process.env, NODE_OPTIONS: '--bad-flag-force-node-crash' },
    encoding: 'utf8'
  });
  const crashLines = resRunnerCrash.stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
  assert.strictEqual(crashLines.length, 1, 'Exactement 1 ligne JSON émise en secours');
  const jsonCrash = JSON.parse(crashLines[0]);
  assert.strictEqual(jsonCrash.decision, 'deny');
  assert.ok(jsonCrash.reason.includes('FAIL-CLOSED'), 'Raison FAIL-CLOSED attendue');
  console.log('  ✅ Épreuve 4.3 réussie : Le runner .cmd rattrape un plantage amont et émet {deny} en Fail-Closed.\n');

  // ---------------------------------------------------------------------------
  // ÉTAPE 5 : Épreuve de Découverte & Désinstallation Chirurgicale
  // ---------------------------------------------------------------------------
  console.log('🧹 [5/5] Épreuve de Découverte & Désinstallation Chirurgicale...');

  // Ajouter un hook utilisateur tiers à ne pas toucher dans .agents/hooks.json
  const initialAgy = JSON.parse(fs.readFileSync(agyHooksPath, 'utf8'));
  initialAgy['my-custom-audit'] = { enabled: true, PreToolUse: [] };
  fs.writeFileSync(agyHooksPath, JSON.stringify(initialAgy, null, 2) + '\n', 'utf8');

  // Découverte dynamique
  const hooks = listManagedHooks(SANDBOX_DIR);
  assert.ok(hooks.some(h => h.id === 'sec-gate' && h.target === 'antigravity'));
  assert.ok(hooks.some(h => h.id === 'sec-gate' && h.target === 'claude-code'));
  assert.ok(hooks.some(h => h.id === 'sec-gate' && h.target === 'git-pre-commit'));
  assert.ok(hooks.some(h => h.id === 'msg-gate' && h.target === 'git-commit-msg'));
  console.log(`  ✅ Découverte dynamique réussie : ${hooks.length} hooks répertoriés.`);

  // Désinstallation chirurgicale de 'sec-gate' via la signature positionnelle
  const removal = removeManagedHook(SANDBOX_DIR, 'sec-gate');
  assert.strictEqual(removal.removedFrom.length >= 3, true);
  assert.strictEqual(fs.existsSync(secretScript), false, 'Le fichier wf-hook-sec-gate.js doit être supprimé');

  // Vérifier que le hook tiers n'a pas été écrasé
  const finalAgy = JSON.parse(fs.readFileSync(agyHooksPath, 'utf8'));
  assert.ok(finalAgy['my-custom-audit'], 'Le hook custom de l\'utilisateur doit être intact');
  assert.strictEqual(finalAgy['wf-hook-sec-gate'], undefined, 'Le hook sec-gate doit être supprimé');

  console.log('  ✅ Désinstallation chirurgicale réussie : configurations épurées, fichiers détruits, hook tiers intact.\n');

  console.log('=================================================================');
  console.log('🎉 TOUTES LES ÉPREUVES DU BANC D\'ESSAI JALON 3 ONT RÉUSSI À 100%');
  console.log('=================================================================');
} finally {
  cleanSandbox();
}
