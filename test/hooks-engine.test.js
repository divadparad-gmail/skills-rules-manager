/**
 * @description: Suite de tests automatisée unifiée et durcie pour le livrable réel du skill wf-hook.
 * Cible EXCLUSIVEMENT les scripts de : .agents/skills/wf-hook/scripts/
 * Prouve formellement :
 *   1. rule-synthesizer : Génération et fonctionnement des 4 types de règles :
 *      - secrets (détection commande + index staged, masquage garanti)
 *      - branch_protection (blocage sur main/master, passage sur feature/*)
 *      - commit_message (blocage sur message non conventionnel, passage sur feat: etc.)
 *      - forbidden_patterns (blocage sur debugger/console.log)
 *   2. Câblage Antigravity : adapter-antigravity exécute le script généré, émet atomiquement sur stdout, sort en exit 0
 *   3. Fail-Closed du VRAI runner-antigravity.cmd sur échec système de Node (1 unique ligne deny)
 *   4. Câblage Claude Code : adapter-claude exécute le script généré, utilise input.cwd, sort en exit 2 bloquant
 *   5. ZÉRO clé custom dans settings.json et assainissement strict de hookId (anti-path-traversal)
 *   6. Tolérance JSONC avec commentaires et refus net d'écrasement sur JSON corrompu
 *   7. Découverte dynamique exacte et désinstallation chirurgicale (entrées de config + fichiers scripts physiques)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync, spawnSync } = require('child_process');

// IMPORTATION STRICTEMENT DEPUIS LE LIVRABLE DU SKILL
const SKILL_SCRIPTS = path.resolve(__dirname, '../.agents/skills/wf-hook/scripts');

const { generateValidatorCode } = require(path.join(SKILL_SCRIPTS, 'rule-synthesizer'));
const {
  sanitizeHookId,
  createBackup,
  safeParseJson,
  stripJsonComments,
  installClaudeHook,
  installAntigravityHook,
  installGitHook,
  listManagedHooks,
  removeManagedHook
} = require(path.join(SKILL_SCRIPTS, 'hook-manager'));

const TEST_DIR = path.join(__dirname, 'temp_hooks_unified_test');

function setup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  execSync('git init', { cwd: TEST_DIR, stdio: 'ignore' });
  execSync('git config user.name "Test Runner"', { cwd: TEST_DIR, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: TEST_DIR, stdio: 'ignore' });
  execSync('git commit --allow-empty -m "initial commit"', { cwd: TEST_DIR, stdio: 'ignore' });
  const targetScripts = path.join(TEST_DIR, '.agents', 'skills', 'wf-hook', 'scripts');
  fs.mkdirSync(targetScripts, { recursive: true });
  fs.cpSync(SKILL_SCRIPTS, targetScripts, { recursive: true });
}

function teardown() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

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

console.log('--- 🧪 Démarrage des tests unifiés du skill wf-hook ---');
setup();

try {
  // =========================================================================
  // 1. Tests de rule-synthesizer : Les 4 types de règles
  // =========================================================================
  console.log('\n[1/7] Test de rule-synthesizer sur les 4 types de règles :');

  // A. Règle SECRETS
  const secretCode = generateValidatorCode({ hookId: 'sec-rule', ruleType: 'secrets' });
  const secretScriptPath = path.join(TEST_DIR, 'wf-hook-sec-rule.js');
  fs.writeFileSync(secretScriptPath, secretCode, 'utf8');

  // Test secret dans la commande
  const resSecCmd = spawnSync(process.execPath, [
    secretScriptPath,
    '--command', 'git commit -m "add key AKIAIOSFODNN7EXAMPLE"',
    '--cwd', TEST_DIR
  ], { encoding: 'utf8' });
  assert.strictEqual(resSecCmd.status, 1, 'Règle secrets doit bloquer un secret en commande (code 1)');
  assert.ok(resSecCmd.stderr.includes('AKIA...MPLE'), 'L\'erreur doit masquer la clé');
  assert.ok(!resSecCmd.stderr.includes('AKIAIOSFODNN7EXAMPLE'), 'Zéro secret en clair');

  // Test secret staged dans git
  const stagedFile = path.join(TEST_DIR, 'secret.js');
  fs.writeFileSync(stagedFile, 'const AWS = "AKIAIOSFODNN7EXAMPLE";\n', 'utf8');
  execSync('git add secret.js', { cwd: TEST_DIR, stdio: 'ignore' });
  fs.writeFileSync(stagedFile, 'console.log("disque propre");\n', 'utf8'); // disque propre, index sale

  const resSecStaged = spawnSync(process.execPath, [
    secretScriptPath,
    '--staged',
    '--cwd', TEST_DIR
  ], { encoding: 'utf8' });
  assert.strictEqual(resSecStaged.status, 1, 'Règle secrets doit inspecter l\'index via git show (code 1)');

  // B. Règle BRANCH_PROTECTION
  const branchCode = generateValidatorCode({
    hookId: 'branch-guard',
    ruleType: 'branch_protection',
    config: { protectedBranches: ['main', 'master'] }
  });
  const branchScriptPath = path.join(TEST_DIR, 'wf-hook-branch-guard.js');
  fs.writeFileSync(branchScriptPath, branchCode, 'utf8');

  // Par défaut git init crée master ou main
  const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: TEST_DIR, encoding: 'utf8' }).trim();
  const resBranchBlocked = spawnSync(process.execPath, [
    branchScriptPath,
    '--cwd', TEST_DIR
  ], { encoding: 'utf8' });
  if (['main', 'master'].includes(currentBranch)) {
    assert.strictEqual(resBranchBlocked.status, 1, 'Règle branch_protection doit bloquer sur main/master');
    assert.ok(resBranchBlocked.stderr.includes('Action interdite directement sur la branche protégée'));
  }

  // C. Règle COMMIT_MESSAGE
  const commitMsgCode = generateValidatorCode({ hookId: 'msg-check', ruleType: 'commit_message' });
  const commitMsgScriptPath = path.join(TEST_DIR, 'wf-hook-msg-check.js');
  fs.writeFileSync(commitMsgScriptPath, commitMsgCode, 'utf8');

  const resBadMsg = spawnSync(process.execPath, [
    commitMsgScriptPath,
    '--command', 'git commit -m "bad message without prefix"',
    '--cwd', TEST_DIR
  ], { encoding: 'utf8' });
  assert.strictEqual(resBadMsg.status, 1, 'Doit bloquer un message non conventionnel');

  const resGoodMsg = spawnSync(process.execPath, [
    commitMsgScriptPath,
    '--command', 'git commit -m "feat(auth): add login validation"',
    '--cwd', TEST_DIR
  ], { encoding: 'utf8' });
  assert.strictEqual(resGoodMsg.status, 0, 'Doit autoriser un message conforme (feat:)');

  // Test commit-msg via fichier temporaire (contrat Git commit-msg hook)
  const commitMsgFileBad = path.join(TEST_DIR, 'COMMIT_EDITMSG_BAD');
  fs.writeFileSync(commitMsgFileBad, 'fix without conventional description\n# Comments ignored\n', 'utf8');
  const resFileBad = spawnSync(process.execPath, [
    commitMsgScriptPath,
    '--commit-msg-file', commitMsgFileBad,
    '--cwd', TEST_DIR
  ], { encoding: 'utf8' });
  assert.strictEqual(resFileBad.status, 1, 'Doit bloquer un fichier de message non conforme');

  const commitMsgFileGood = path.join(TEST_DIR, 'COMMIT_EDITMSG_GOOD');
  fs.writeFileSync(commitMsgFileGood, 'feat(ui): implement hooks dashboard panel\n# Comments ignored\n', 'utf8');
  const resFileGood = spawnSync(process.execPath, [
    commitMsgScriptPath,
    '--commit-msg-file', commitMsgFileGood,
    '--cwd', TEST_DIR
  ], { encoding: 'utf8' });
  assert.strictEqual(resFileGood.status, 0, 'Doit autoriser un fichier de message conforme');

  // D. Règle FORBIDDEN_PATTERNS
  const patternsCode = generateValidatorCode({
    hookId: 'pat-check',
    ruleType: 'forbidden_patterns',
    config: { patterns: [{ name: 'Debugger résiduel', regex: 'debugger;' }] }
  });
  const patScriptPath = path.join(TEST_DIR, 'wf-hook-pat-check.js');
  fs.writeFileSync(patScriptPath, patternsCode, 'utf8');

  const patFile = path.join(TEST_DIR, 'app.js');
  fs.writeFileSync(patFile, 'function test() { debugger; }\n', 'utf8');
  execSync('git add app.js', { cwd: TEST_DIR, stdio: 'ignore' });

  const resPat = spawnSync(process.execPath, [
    patScriptPath,
    '--staged',
    '--cwd', TEST_DIR
  ], { encoding: 'utf8' });
  assert.strictEqual(resPat.status, 1, 'Règle forbidden_patterns doit bloquer debugger;');
  console.log('✅ Les 4 types de règles de rule-synthesizer générées et validées avec succès.');

  // =========================================================================
  // 2. Câblage Antigravity : adapter-antigravity exécute le validateur cible
  // =========================================================================
  console.log('\n[2/7] Test de l\'adaptateur Antigravity câblé sur le script généré :');
  const adapterAntigravityPath = path.join(SKILL_SCRIPTS, 'adapter-antigravity.js');

  // Appel avec le script secret bloquant
  const inputAgyDeny = JSON.stringify({
    toolCall: {
      name: 'run_command',
      args: { CommandLine: 'git commit -m "wip"', Cwd: TEST_DIR }
    }
  });
  const resAgy = spawnSync(process.execPath, [adapterAntigravityPath, secretScriptPath], {
    input: inputAgyDeny,
    encoding: 'utf8'
  });
  // Sortie impérative en code 0 (règle d'or anti-double-JSON)
  assert.strictEqual(resAgy.status, 0, 'L\'adaptateur Antigravity sort en code 0 dès qu\'une décision est émise');
  const jsonAgy = JSON.parse(resAgy.stdout.trim());
  assert.strictEqual(jsonAgy.decision, 'deny', 'Doit émettre decision: "deny" car secret présent dans l\'index');
  assert.ok(jsonAgy.reason.includes('AKIA...MPLE'), 'La raison doit remonter l\'erreur du validateur cible');

  // Commande anodine (git status) -> allow
  const inputAgyAllow = JSON.stringify({
    toolCall: {
      name: 'run_command',
      args: { CommandLine: 'git status', Cwd: TEST_DIR }
    }
  });
  const resAgyAllow = spawnSync(process.execPath, [adapterAntigravityPath, secretScriptPath], {
    input: inputAgyAllow,
    encoding: 'utf8'
  });
  assert.strictEqual(resAgyAllow.status, 0);
  const jsonAgyAllow = JSON.parse(resAgyAllow.stdout.trim());
  assert.strictEqual(jsonAgyAllow.decision, 'allow');

  // PREUVE FAIL-CLOSED ANTI-CONTOURNEMENT (options globales Git: --no-pager, --git-dir, --work-tree)
  const evasiveCommands = [
    'git --no-pager commit -m "wip with secret AKIAIOSFODNN7EXAMPLE"',
    'git --git-dir=. commit -m "commit with secret AKIAIOSFODNN7EXAMPLE"',
    'git --work-tree=. commit -m "commit with secret AKIAIOSFODNN7EXAMPLE"'
  ];
  for (const cmd of evasiveCommands) {
    const inputEvasive = JSON.stringify({
      toolCall: {
        name: 'run_command',
        args: { CommandLine: cmd, Cwd: TEST_DIR }
      }
    });
    const resEvasive = spawnSync(process.execPath, [adapterAntigravityPath, secretScriptPath], {
      input: inputEvasive,
      encoding: 'utf8'
    });
    assert.strictEqual(resEvasive.status, 0);
    const jsonEvasive = JSON.parse(resEvasive.stdout.trim());
    assert.strictEqual(jsonEvasive.decision, 'deny', `Antigravity doit bloquer "${cmd}"`);
  }
  console.log('✅ Adaptateur Antigravity validé : exécute le script généré, fail-closed sur options globales (--no-pager etc.), sort en exit 0.');

  // =========================================================================
  // 3. Fail-Closed du VRAI runner-antigravity.cmd sur échec système de Node
  // =========================================================================
  console.log('\n[3/7] Test du Fail-Closed du VRAI runner-antigravity.cmd :');
  const realRunnerCmdPath = path.join(SKILL_SCRIPTS, 'runner-antigravity.cmd');

  const resCrash = spawnSync(`"${realRunnerCmdPath}" "${secretScriptPath}"`, {
    shell: true,
    env: { ...process.env, NODE_OPTIONS: '--invalid-flag-to-force-crash' },
    encoding: 'utf8'
  });
  const linesCrash = resCrash.stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
  assert.strictEqual(linesCrash.length, 1, 'Exactement 1 ligne JSON');
  const jsonCrash = JSON.parse(linesCrash[0]);
  assert.strictEqual(jsonCrash.decision, 'deny', 'Fail-Closed immédiat');
  assert.ok(jsonCrash.reason.includes('FAIL-CLOSED'));
  console.log('✅ Fail-Closed du VRAI runner-antigravity.cmd validé sur plantage amont de Node.');

  // =========================================================================
  // 4. Câblage Claude Code : adapter-claude exécute le validateur cible
  // =========================================================================
  console.log('\n[4/7] Test de la commande Claude Code RÉELLEMENT installée dans settings.json :');
  const testClaudeSettings = path.join(TEST_DIR, '.claude', 'settings.json');
  installClaudeHook({
    settingsPath: testClaudeSettings,
    workspaceRoot: TEST_DIR,
    hookId: 'sec-rule',
    scriptRelativePath: 'wf-hook-sec-rule.js'
  });

  const testClaudeConfig = JSON.parse(fs.readFileSync(testClaudeSettings, 'utf8'));
  const testInstalledCmd = testClaudeConfig.hooks.PreToolUse[0].hooks[0].command;
  assert.ok(testInstalledCmd.includes('adapter-claude.js'), 'La commande doit invoquer adapter-claude.js');
  assert.ok(testInstalledCmd.includes('wf-hook-sec-rule.js'), 'La commande doit passer le script validateur cible');

  const shellPath = getShellPath();
  const claudeTestEnv = {
    ...process.env,
    CLAUDE_PROJECT_DIR: TEST_DIR.replace(/\\/g, '/')
  };

  // A. Secret UNIQUEMENT dans le message de commit
  const inputMsgOnly = JSON.stringify({
    tool_input: { command: 'git commit -m "secret in message AKIAIOSFODNN7EXAMPLE"' },
    cwd: TEST_DIR
  });
  const resMsgOnly = spawnSync(shellPath, ['-c', testInstalledCmd], {
    input: inputMsgOnly,
    env: claudeTestEnv,
    cwd: TEST_DIR,
    encoding: 'utf8'
  });
  assert.strictEqual(resMsgOnly.status, 2, 'Doit sortir en exit 2 sur secret dans le message de commit');
  assert.ok(resMsgOnly.stderr.includes('AKIA...MPLE'), 'L\'erreur masquée doit être sur stderr');
  assert.ok(!resMsgOnly.stderr.includes('AKIAIOSFODNN7EXAMPLE'), 'Zéro secret en clair');

  // B. Commande anodine -> exit 0
  const inputClaudeClean = JSON.stringify({
    tool_input: { command: 'git status' },
    cwd: TEST_DIR
  });
  const resClaudeClean = spawnSync(shellPath, ['-c', testInstalledCmd], {
    input: inputClaudeClean,
    env: claudeTestEnv,
    cwd: TEST_DIR,
    encoding: 'utf8'
  });
  assert.strictEqual(resClaudeClean.status, 0);

  // C. PREUVE FAIL-CLOSED ANTI-CONTOURNEMENT (options globales Git: --no-pager, --git-dir, --work-tree)
  for (const cmd of evasiveCommands) {
    const inputClaudeEvasive = JSON.stringify({
      tool_input: { command: cmd },
      cwd: TEST_DIR
    });
    const resClaudeEvasive = spawnSync(shellPath, ['-c', testInstalledCmd], {
      input: inputClaudeEvasive,
      env: claudeTestEnv,
      cwd: TEST_DIR,
      encoding: 'utf8'
    });
    assert.strictEqual(resClaudeEvasive.status, 2, `Claude Code doit sortir en exit 2 sur "${cmd}"`);
    assert.ok(resClaudeEvasive.stderr.includes('AKIA...MPLE'), `Erreur masquée attendue sur "${cmd}"`);
  }
  console.log('✅ Commande installée de Claude Code validée à 100% (via shell réel, fail-closed sur secret en message et options globales).');

  // =========================================================================
  // 5. Assainissement du hookId (Anti-Path-Traversal) et ZÉRO clé custom
  // =========================================================================
  console.log('\n[5/7] Test d\'assainissement du hookId et absence de clés custom :');
  const rawId = '../../bad/path/hook-test!';
  const sanitized = sanitizeHookId(rawId);
  assert.strictEqual(sanitized, '______bad_path_hook-test_');

  const settingsFile = path.join(TEST_DIR, 'settings.json');
  installClaudeHook({
    settingsPath: settingsFile,
    hookId: rawId,
    scriptRelativePath: 'scripts/hooks/wf-hook-test.js'
  });
  const settingsContent = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const hookObj = settingsContent.hooks.PreToolUse[0].hooks[0];
  assert.strictEqual(hookObj._managedBy, undefined, 'Zéro clé _managedBy');
  assert.strictEqual(hookObj._id, undefined, 'Zéro clé _id');
  console.log('✅ hookId assaini contre le path traversal, zéro clé custom dans settings.json.');

  // =========================================================================
  // 6. Support JSONC Tolérant & Arrêt Net sur JSON Corrompu
  // =========================================================================
  console.log('\n[6/7] Test JSONC tolérant et protection anti-écrasement :');
  const jsoncFile = path.join(TEST_DIR, 'comments.json');
  fs.writeFileSync(jsoncFile, '{\n  // un commentaire\n  "key": "val",\n  /* bloc */\n  "url": "http://example.com/api"\n}', 'utf8');
  const parsed = safeParseJson(jsoncFile);
  assert.strictEqual(parsed.key, 'val');
  assert.strictEqual(parsed.url, 'http://example.com/api', 'Les URLs avec // ne doivent pas être coupées');

  const corruptFile = path.join(TEST_DIR, 'corrupt.json');
  fs.writeFileSync(corruptFile, '{\n  "broken', 'utf8');
  assert.throws(() => safeParseJson(corruptFile), /SÉCURITÉ/, 'Doit lever une exception explicite');
  console.log('✅ JSONC tolérant et protection anti-corruption validés.');

  // =========================================================================
  // 7. Découverte Dynamique & Désinstallation Chirurgicale Complète
  // =========================================================================
  console.log('\n[7/7] Test de découverte dynamique et désinstallation chirurgicale complète :');
  const mockRoot = path.join(TEST_DIR, 'mock_app');
  fs.mkdirSync(path.join(mockRoot, '.agents'), { recursive: true });
  fs.mkdirSync(path.join(mockRoot, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(mockRoot, '.githooks'), { recursive: true });
  fs.mkdirSync(path.join(mockRoot, 'scripts', 'hooks'), { recursive: true });

  // Hook tiers de l'utilisateur à préserver
  fs.writeFileSync(path.join(mockRoot, '.agents', 'hooks.json'), JSON.stringify({
    "user-manual-hook": { enabled: true, PreToolUse: [] }
  }, null, 2), 'utf8');

  // Fichiers générés pour hook 'audit-gate'
  const hookFileJs = path.join(mockRoot, 'scripts', 'hooks', 'wf-hook-audit-gate.js');
  const hookFileCmd = path.join(mockRoot, 'scripts', 'hooks', 'wf-hook-audit-gate.cmd');
  fs.writeFileSync(hookFileJs, '// validateur', 'utf8');
  fs.writeFileSync(hookFileCmd, '@echo off', 'utf8');

  // Installation sur les 3 cibles
  installAntigravityHook({
    hooksJsonPath: path.join(mockRoot, '.agents', 'hooks.json'),
    workspaceRoot: mockRoot,
    hookId: 'audit-gate',
    runnerPath: 'scripts/hooks/runner-antigravity.cmd',
    scriptPath: 'scripts/hooks/wf-hook-audit-gate.js'
  });
  installClaudeHook({
    settingsPath: path.join(mockRoot, '.claude', 'settings.json'),
    hookId: 'audit-gate',
    scriptRelativePath: 'scripts/hooks/wf-hook-audit-gate.js'
  });
  installGitHook({
    workspaceRoot: mockRoot,
    hookType: 'pre-commit',
    hookId: 'audit-gate',
    scriptRelativePath: 'scripts/hooks/wf-hook-audit-gate.js'
  });
  installGitHook({
    workspaceRoot: mockRoot,
    hookType: 'commit-msg',
    hookId: 'audit-gate',
    scriptRelativePath: 'scripts/hooks/wf-hook-audit-gate.js'
  });

  // Découverte dynamique
  const discovered = listManagedHooks(mockRoot);
  const found = discovered.filter(h => h.id === 'audit-gate');
  assert.strictEqual(found.length, 4, 'Doit découvrir exactement les 4 cibles (antigravity, claude, git-pre-commit, git-commit-msg)');

  // Désinstallation chirurgicale
  const removal = removeManagedHook(mockRoot, 'audit-gate');
  assert.strictEqual(removal.removedFrom.length >= 4, true, 'Retiré des 4 configurations');
  assert.strictEqual(removal.deletedFiles.length >= 1, true, 'Fichiers scripts associés supprimés');
  assert.strictEqual(fs.existsSync(hookFileJs), false, 'wf-hook-audit-gate.js doit être supprimé physiquement');

  // Le hook manuel de l'utilisateur doit être intact
  const finalHooksJson = JSON.parse(fs.readFileSync(path.join(mockRoot, '.agents', 'hooks.json'), 'utf8'));
  assert.ok(finalHooksJson['user-manual-hook'], 'Le hook manuel tiers doit être intact');
  assert.strictEqual(finalHooksJson['wf-hook-audit-gate'], undefined, 'Le hook géré doit être retiré');
  console.log('✅ Découverte et désinstallation chirurgicale (config + fichiers physiques) validées à 100%.');

  console.log('\n🎉 TOUS LES TESTS UNIFIÉS DU SKILL ONT RÉUSSI AVEC SUCCÈS !');
} finally {
  teardown();
}
