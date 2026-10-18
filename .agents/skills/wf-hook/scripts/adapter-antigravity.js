/**
 * @managedBy: wf-hook
 * @description: Adaptateur traducteur universel pour Google Antigravity (PreToolUse).
 * Rôle :
 *   - Lit le stdin JSON d'Antigravity (toolCall).
 *   - Exécute le script validateur généré passé en argument (process.argv[2]).
 *   - Traduit :
 *       - code de sortie 0  -> { "decision": "allow" }
 *       - code de sortie ≠ 0 -> { "decision": "deny", "reason": stderr }
 *   - Émet le JSON de façon atomique et synchrone (fs.writeSync).
 *   - Sort TOUJOURS en exit 0 dès qu'une décision est émise (anti double-JSON).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function emitDecision(decision, reason) {
  const payload = { decision };
  if (reason) {
    payload.reason = reason;
  }
  fs.writeSync(1, JSON.stringify(payload) + '\n');
  process.exit(0);
}

process.on('uncaughtException', (err) => {
  emitDecision('deny', `wf-hook [FAIL-CLOSED] Erreur inattendue dans l'adaptateur Antigravity : ${err.message}`);
});

const targetValidatorScript = process.argv[2];

let inputData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  try {
    if (!inputData.trim()) {
      emitDecision('deny', 'wf-hook [FAIL-CLOSED] : Stdin vide reçu.');
    }

    if (!targetValidatorScript || !fs.existsSync(targetValidatorScript)) {
      emitDecision('deny', `wf-hook [FAIL-CLOSED] : Script de validation cible introuvable : ${targetValidatorScript}`);
    }

    let payload;
    try {
      payload = JSON.parse(inputData);
    } catch {
      emitDecision('deny', 'wf-hook [FAIL-CLOSED] : Payload stdin Antigravity invalide.');
    }

    const commandLine = payload?.toolCall?.args?.CommandLine || '';
    const cwd = payload?.toolCall?.args?.Cwd || process.cwd();

    // Filtrage robuste fail-closed : tolère toutes les options globales (--no-pager, --git-dir, -C, etc.)
    const gitCmdMatch = commandLine.match(/\bgit(?:\.exe)?\b[\s\S]*?\b(commit|push)\b/i);
    if (!gitCmdMatch) {
      emitDecision('allow');
    }

    const gitVerb = gitCmdMatch[1].toLowerCase();
    const modeFlag = gitVerb === 'push' ? '--pre-push' : '--staged';

    // Exécution du script validateur autonome
    const child = spawnSync(process.execPath, [
      targetValidatorScript,
      '--command', commandLine,
      '--cwd', cwd,
      modeFlag
    ], {
      cwd,
      encoding: 'utf8',
      env: process.env
    });

    if (child.status === 0) {
      emitDecision('allow');
    } else {
      const errorMsg = (child.stderr || child.stdout || 'Violation détectée').trim();
      emitDecision('deny', errorMsg);
    }
  } catch (err) {
    emitDecision('deny', `wf-hook [FAIL-CLOSED] : Exception d'exécution : ${err.message}`);
  }
});
