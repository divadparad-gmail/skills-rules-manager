/**
 * @managedBy: wf-hook
 * @description: Adaptateur traducteur universel pour Claude Code (PreToolUse).
 * Rôle :
 *   - Lit le stdin JSON de Claude Code (tool_input.command, cwd).
 *   - Utilise fidèlement input.cwd (suit les cd et worktrees).
 *   - Filtre : si la commande n'est ni commit ni push, sort immédiatement en exit 0.
 *   - Exécute le script validateur généré passé en argument (process.argv[2]).
 *   - Si le validateur réussit (exit 0) -> sort en exit 0.
 *   - Si le validateur échoue (exit ≠ 0) -> écrit le message d'erreur sur stderr et sort en exit 2.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const targetValidatorScript = process.argv[2];

let inputData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  try {
    if (!inputData.trim()) {
      process.stderr.write('[wf-hook] Erreur : Stdin vide reçu pour Claude Code.\n');
      process.exit(2);
    }

    if (!targetValidatorScript || !fs.existsSync(targetValidatorScript)) {
      process.stderr.write(`[wf-hook] Erreur : Script validateur cible introuvable : ${targetValidatorScript}\n`);
      process.exit(2);
    }

    let payload;
    try {
      payload = JSON.parse(inputData);
    } catch {
      process.stderr.write('[wf-hook] Erreur : Payload stdin Claude Code invalide.\n');
      process.exit(2);
    }

    const command = payload?.tool_input?.command || '';
    // POINT CRITIQUE : Utiliser input.cwd (qui suit les cd et worktrees)
    const cwd = payload?.cwd || process.cwd();

    // Filtrage robuste fail-closed : tolère toutes les options globales (--no-pager, --git-dir, -C, etc.)
    const gitCmdMatch = command.match(/\bgit(?:\.exe)?\b[\s\S]*?\b(commit|push)\b/i);
    if (!gitCmdMatch) {
      process.exit(0);
    }

    const gitVerb = gitCmdMatch[1].toLowerCase();
    const modeFlag = gitVerb === 'push' ? '--pre-push' : '--staged';

    // Exécution du script validateur autonome
    const child = spawnSync(process.execPath, [
      targetValidatorScript,
      '--command', command,
      '--cwd', cwd,
      modeFlag
    ], {
      cwd,
      encoding: 'utf8',
      env: process.env
    });

    if (child.status === 0) {
      process.exit(0);
    } else {
      const errorMsg = (child.stderr || child.stdout || 'Violation détectée').trim();
      process.stderr.write(`${errorMsg}\n`);
      process.exit(2);
    }
  } catch (err) {
    process.stderr.write(`[wf-hook] Erreur inattendue dans l'adaptateur Claude Code : ${err.message}\n`);
    process.exit(2);
  }
});
