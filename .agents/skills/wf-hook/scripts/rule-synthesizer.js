/**
 * @managedBy: wf-hook
 * @description: Générateur dynamique de logique de validation (Cœur de validation sur mesure).
 * Produit un script autonome wf-hook-<id>.js qui constitue le CERVEAU UNIQUE pour une règle donnée.
 * Contrat d'exécution universel :
 *   - Sortie 0 = Succès (aucun problème détecté)
 *   - Sortie 1 = Échec (anomalie détectée, message explicite sur stderr)
 *   - Ne journalise jamais de secret en clair (masquage systématique).
 */

function generateValidatorCode({ hookId, ruleType = 'secrets', config = {} }) {
  const safeId = String(hookId).replace(/[^a-zA-Z0-9_-]/g, '_');

  let ruleImplementation = '';

  switch (ruleType) {
    case 'branch_protection': {
      const protectedBranches = config.protectedBranches || ['main', 'master', 'production', 'release'];
      ruleImplementation = `
    // Règle Métier : Protection de branches sensibles
    try {
      let currentBranch = '';
      try {
        currentBranch = execSync('git branch --show-current', { cwd, encoding: 'utf8' }).trim();
      } catch {}
      if (!currentBranch) {
        currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim();
      }
      const protectedList = ${JSON.stringify(protectedBranches)};
      if (protectedList.includes(currentBranch)) {
        violations.push({
          file: '<branche git>',
          rule: \`Action interdite directement sur la branche protégée "\${currentBranch}". Passer obligatoirement par une branche de fonctionnalité et une PR.\`
        });
      }
    } catch {}
`;
      break;
    }

    case 'commit_message': {
      const pattern = config.pattern || '^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|wip)(\\(.+\\))?: .+';
      ruleImplementation = `
    // Règle Métier : Validation du format du message de commit (Conventional Commits)
    let msg = '';
    if (context.command) {
      const commitMatch = context.command.match(/git\\s+.*commit\\s+.*-m\\s+["']([^"']+)["']/i);
      if (commitMatch) msg = commitMatch[1];
    }
    if (!msg && context.commitMsgFile && fs.existsSync(context.commitMsgFile)) {
      try {
        const fileContent = fs.readFileSync(context.commitMsgFile, 'utf8');
        const firstLine = fileContent.split('\\n').map(l => l.trim()).find(l => l && !l.startsWith('#'));
        if (firstLine) msg = firstLine;
      } catch {}
    }
    if (!msg && context.commitMsg) {
      msg = context.commitMsg;
    }
    if (msg) {
      const conventionRegex = new RegExp(${JSON.stringify(pattern)});
      if (!conventionRegex.test(msg)) {
        violations.push({
          file: context.commitMsgFile || '<message de commit>',
          rule: \`Le message de commit "\${msg}" ne respecte pas la convention requise (\${conventionRegex}).\`
        });
      }
    }
`;
      break;
    }

    case 'forbidden_patterns': {
      const patterns = config.patterns || [
        { name: 'Debugger résiduel', regex: 'debugger;' },
        { name: 'Console.log en production', regex: 'console\\.log\\(' }
      ];
      ruleImplementation = `
    // Règle Métier : Motifs et mots interdits
    const forbiddenPatterns = ${JSON.stringify(patterns)}.map(p => ({
      name: p.name,
      regex: new RegExp(p.regex, 'g')
    }));

    // Inspection de la ligne de commande
    if (context.command) {
      for (const { name, regex } of forbiddenPatterns) {
        regex.lastIndex = 0;
        if (regex.test(context.command)) {
          violations.push({
            file: '<ligne de commande>',
            rule: \`Motif interdit détecté dans la commande : \${name}\`
          });
        }
      }
    }

    // Inspection des fichiers indexés ou désignés
    for (const file of filesToCheck) {
      const content = readFileContent(file);
      if (content) {
        const lines = content.split('\\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          for (const { name, regex } of forbiddenPatterns) {
            regex.lastIndex = 0;
            if (regex.test(line)) {
              violations.push({
                file,
                line: i + 1,
                rule: \`Motif interdit détecté : \${name}\`
              });
            }
          }
        }
      }
    }
`;
      break;
    }

    case 'secrets':
    default: {
      ruleImplementation = `
    // Règle Métier : Détection de clés, tokens et secrets
    const secretPatterns = [
      { name: 'Clé AWS officielle test', regex: /AKIAIOSFODNN7EXAMPLE/g },
      { name: 'Clé d\\'accès AWS', regex: /AKIA[0-9A-Z]{16}/g },
      { name: 'Clé API Google', regex: /AIza[0-9A-Za-z\\-_]{35}/g },
      { name: 'GitHub Personal Access Token', regex: /ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}/g },
      { name: 'Clé privée RSA/OpenSSH', regex: /-----BEGIN ([A-Z ]+ )?PRIVATE KEY-----/g }
    ];

    const forbiddenFilePatterns = [
      /^\\.env(\\..+)?$/i,
      /\\.pem$/i,
      /\\.key$/i,
      /\\.pfx$/i,
      /\\.p12$/i,
      /^id_rsa$/i,
      /^id_ed25519$/i
    ];

    // 1. Inspection de la ligne de commande
    if (context.command) {
      for (const { name, regex } of secretPatterns) {
        regex.lastIndex = 0;
        const match = regex.exec(context.command);
        if (match) {
          violations.push({
            file: '<ligne de commande>',
            line: 1,
            rule: \`\${name} dans les arguments de la commande (valeur masquée : \${maskSensitive(match[0])})\`
          });
        }
      }
    }

    // 2. Inspection des fichiers indexés
    for (const file of filesToCheck) {
      const baseName = path.basename(file);
      for (const p of forbiddenFilePatterns) {
        if (p.test(baseName)) {
          violations.push({
            file,
            rule: \`Fichier sensible interdit : \${baseName}\`
          });
          break;
        }
      }

      const content = readFileContent(file);
      if (content) {
        const lines = content.split('\\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          for (const { name, regex } of secretPatterns) {
            regex.lastIndex = 0;
            const match = regex.exec(line);
            if (match) {
              violations.push({
                file,
                line: i + 1,
                rule: \`\${name} (valeur masquée : \${maskSensitive(match[0])})\`
              });
            }
          }
        }
      }
    }
`;
      break;
    }
  }

  return `/**
 * @managedBy: wf-hook
 * @hookId: ${safeId}
 * @ruleType: ${ruleType}
 * @createdAt: ${new Date().toISOString()}
 * 
 * Contrat universel :
 *   - Sortie 0 = Succès (aucun problème détecté)
 *   - Sortie 1 = Échec (anomalie détectée, message explicite sur stderr)
 *   - Ne journalise jamais de secret en clair (masquage systématique).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function maskSensitive(val) {
  if (!val || typeof val !== 'string') return '';
  if (val.length <= 8) return '****';
  return val.slice(0, 4) + '...' + val.slice(-4);
}

function validate(context = {}) {
  const cwd = context.cwd || process.cwd();
  const stagedOnly = context.stagedOnly !== undefined ? context.stagedOnly : true;
  const violations = [];
  let filesToCheck = context.files || [];

  // Si stagedOnly et aucun fichier fourni, on interroge git diff --name-only --cached
  if (stagedOnly && filesToCheck.length === 0) {
    try {
      const diffOutput = execSync('git diff --name-only --cached', { cwd, encoding: 'utf8' });
      filesToCheck = diffOutput.split('\\n').map(f => f.trim()).filter(Boolean);
    } catch {}
  }

  function readFileContent(file) {
    if (stagedOnly) {
      try {
        const normalized = file.replace(/\\\\/g, '/');
        return execSync(\`git show :\${JSON.stringify(normalized)}\`, {
          cwd,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
          maxBuffer: 2 * 1024 * 1024
        });
      } catch {}
    }
    const fullPath = path.isAbsolute(file) ? file : path.join(cwd, file);
    if (fs.existsSync(fullPath)) {
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size <= 1024 * 1024) {
          return fs.readFileSync(fullPath, 'utf8');
        }
      } catch {}
    }
    return null;
  }
${ruleImplementation}
  if (violations.length > 0) {
    const errorMsg = violations.map(v => 
      \`- \${v.file}\${v.line ? \`:\${v.line}\` : ''} : \${v.rule}\`
    ).join('\\n');

    return {
      ok: false,
      error: \`[wf-hook] Blocage (\${${JSON.stringify(ruleType)}}) :\\n\${errorMsg}\`,
      details: violations
    };
  }

  return { ok: true };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let files = [];
  let command = '';
  let cwd = process.cwd();
  let stagedOnly = true;
  let commitMsgFile = '';
  let commitMsg = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--command' && args[i + 1]) {
      command = args[++i];
    } else if (args[i] === '--cwd' && args[i + 1]) {
      cwd = args[++i];
    } else if (args[i] === '--files' && args[i + 1]) {
      files = args[++i].split(',').map(f => f.trim());
    } else if (args[i] === '--staged') {
      stagedOnly = true;
    } else if (args[i] === '--commit-msg-file' && args[i + 1]) {
      commitMsgFile = args[++i];
    } else if (args[i] === '--commit-msg' && args[i + 1]) {
      commitMsg = args[++i];
    } else if (args[i] === '--pre-push') {
      stagedOnly = false;
      try {
        const diff = execSync('git diff --name-only @{u}..HEAD', { cwd, encoding: 'utf8' });
        files = diff.split('\\n').map(f => f.trim()).filter(Boolean);
      } catch {}
    }
  }

  const result = validate({ cwd, command, files, stagedOnly, commitMsgFile, commitMsg });
  if (!result.ok) {
    process.stderr.write(result.error + '\\n');
    process.exit(1);
  }

  process.exit(0);
}

module.exports = {
  validate,
  maskSensitive
};
`;
}

module.exports = {
  generateValidatorCode
};
