/**
 * @managedBy: wf-hook
 * @description: Moteur de gestion non destructive, fusion sécurisée, sauvegardes horodatées,
 * découverte dynamique et désinstallation chirurgicale pour les hooks d'agents et Git.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Assainit un identifiant de hook pour prévenir toute injection de chemin ou de nom.
 * @param {string} hookId
 * @returns {string} Identifiant assaini
 */
function sanitizeHookId(hookId) {
  return String(hookId || 'hook').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Crée un backup horodaté préalable avant toute modification.
 * @param {string} filePath - Chemin absolu du fichier à sauvegarder
 * @returns {string|null} Chemin du backup créé ou null si le fichier n'existait pas
 */
function createBackup(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.bak.${timestamp}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

/**
 * Nettoie les commentaires d'une chaîne JSON (support JSONC tolérant).
 * Préserve les chaînes de caractères contenant des // ou des slashs.
 * @param {string} jsoncString
 * @returns {string} Chaîne JSON pure sans commentaires
 */
function stripJsonComments(jsoncString) {
  return jsoncString.replace(/("(?:\\.|[^\\"])*")|(\/\*[\s\S]*?\*\/|\/\/[^\n\r]*)/g, (match, str) => {
    if (str) return str;
    return '';
  });
}

/**
 * Parse sécurisé d'un fichier JSON/JSONC.
 * Si le fichier est malformé ou invalide, lève une erreur explicite sans écraser.
 * @param {string} filePath
 * @returns {Object} Contenu parsé
 */
function safeParseJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) return {};

  try {
    const stripped = stripJsonComments(content);
    return JSON.parse(stripped);
  } catch (err) {
    throw new Error(
      `[wf-hook] SÉCURITÉ : Le fichier existant "${filePath}" contient un JSON invalide ou corrompu.\n` +
      `Détail de l'erreur : ${err.message}\n` +
      `Opération interrompue pour éviter toute corruption ou écrasement de vos réglages.`
    );
  }
}

/**
 * Installe ou fusionne un hook Claude Code dans settings.json de manière non destructive.
 * Garantie : Zéro clé custom (ni _managedBy, ni _id) injectée dans settings.json.
 * 
 * @param {Object} options
 * @param {string} options.settingsPath - Chemin absolu du settings.json
 * @param {string} options.hookId - Identifiant du hook
 * @param {string} options.scriptRelativePath - Chemin relatif du script validateur (wf-hook-<id>.js)
 * @param {string} [options.adapterRelativePath] - Chemin relatif de l'adaptateur Claude (optionnel)
 * @param {number} [options.timeout=60] - Timeout en secondes
 * @returns {{ installed: boolean, backup: string|null, skipped: boolean }}
 */
function installClaudeHook({ settingsPath, workspaceRoot, hookId, scriptRelativePath, adapterRelativePath, timeout = 60 }) {
  const safeId = sanitizeHookId(hookId);
  const backup = createBackup(settingsPath);
  const config = safeParseJson(settingsPath);

  config.hooks = config.hooks || {};
  config.hooks.PreToolUse = config.hooks.PreToolUse || [];

  const scriptIdentifier = `wf-hook-${safeId}.js`;
  
  // Vérification d'idempotence
  const alreadyExists = config.hooks.PreToolUse.some(group => 
    group.hooks && group.hooks.some(h => typeof h.command === 'string' && h.command.includes(scriptIdentifier))
  );

  if (alreadyExists) {
    return { installed: false, backup, skipped: true };
  }

  // Résolution automatique et systématique de l'adaptateur Claude
  let effectiveAdapterRel = adapterRelativePath;
  if (!effectiveAdapterRel) {
    const root = workspaceRoot || (path.basename(path.dirname(settingsPath)) === '.claude' 
      ? path.resolve(path.dirname(settingsPath), '..') 
      : path.dirname(settingsPath));
    const adapterAbs = path.join(__dirname, 'adapter-claude.js');
    effectiveAdapterRel = path.relative(root, adapterAbs);
    if (!effectiveAdapterRel || effectiveAdapterRel.startsWith('..')) {
      effectiveAdapterRel = '.agents/skills/wf-hook/scripts/adapter-claude.js';
    }
  }

  const normalizedAdapter = effectiveAdapterRel.replace(/\\/g, '/');
  const normalizedScript = scriptRelativePath.replace(/\\/g, '/');

  // Commande Fail-Closed Claude Code câblée OBLIGATOIREMENT sur l'adaptateur
  const execTarget = `node "\${CLAUDE_PROJECT_DIR}/${normalizedAdapter}" "\${CLAUDE_PROJECT_DIR}/${normalizedScript}"`;
  const failClosedCommand = `${execTarget} || { echo 'wf-hook: échec ou violation détectée — commande bloquée' >&2; exit 2; }`;

  const newHookEntry = {
    matcher: "Bash",
    hooks: [
      {
        type: "command",
        if: "Bash(git *)",
        command: failClosedCommand,
        timeout: timeout
      }
    ]
  };

  config.hooks.PreToolUse.push(newHookEntry);

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

  return { installed: true, backup, skipped: false };
}

/**
 * Installe ou fusionne un hook Antigravity dans hooks.json de manière non destructive.
 * 
 * @param {Object} options
 * @param {string} options.hooksJsonPath - Chemin absolu de hooks.json
 * @param {string} options.workspaceRoot - Racine du projet
 * @param {string} options.hookId - Identifiant du hook
 * @param {string} options.runnerPath - Chemin vers le runner (.cmd ou .sh)
 * @param {string} options.scriptPath - Chemin vers le validateur cible (wf-hook-<id>.js)
 * @param {number} [options.timeout=30] - Timeout en secondes
 * @returns {{ installed: boolean, backup: string|null, skipped: boolean }}
 */
function installAntigravityHook({ hooksJsonPath, workspaceRoot, hookId, runnerPath, scriptPath, timeout = 30 }) {
  const safeId = sanitizeHookId(hookId);
  const backup = createBackup(hooksJsonPath);
  const config = safeParseJson(hooksJsonPath);

  const hookKey = `wf-hook-${safeId}`;

  if (config[hookKey]) {
    return { installed: false, backup, skipped: true };
  }

  const hooksDir = path.dirname(hooksJsonPath);
  const root = workspaceRoot || hooksDir;

  const runnerAbsPath = path.isAbsolute(runnerPath) ? runnerPath : path.resolve(root, runnerPath);
  const scriptAbsPath = path.isAbsolute(scriptPath) ? scriptPath : path.resolve(root, scriptPath);

  let calculatedRunner = path.relative(hooksDir, runnerAbsPath);
  let calculatedScript = path.relative(hooksDir, scriptAbsPath);

  if (process.platform === 'win32') {
    calculatedRunner = calculatedRunner.replace(/\//g, '\\');
    calculatedScript = calculatedScript.replace(/\//g, '\\');
    if (!calculatedRunner.startsWith('.')) calculatedRunner = '.\\' + calculatedRunner;
  } else {
    calculatedRunner = calculatedRunner.replace(/\\/g, '/');
    calculatedScript = calculatedScript.replace(/\\/g, '/');
    if (!calculatedRunner.startsWith('.')) calculatedRunner = './' + calculatedRunner;
  }

  // La commande invoque le runner en lui passant le validateur cible
  const hookCommand = `${calculatedRunner} "${calculatedScript}"`;

  config[hookKey] = {
    enabled: true,
    PreToolUse: [
      {
        matcher: "run_command",
        hooks: [
          {
            type: "command",
            command: hookCommand,
            timeout: timeout
          }
        ]
      }
    ]
  };

  fs.mkdirSync(path.dirname(hooksJsonPath), { recursive: true });
  fs.writeFileSync(hooksJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

  return { installed: true, backup, skipped: false };
}

/**
 * Installe un hook Git universel dans .githooks/
 * @param {Object} options
 * @param {string} options.workspaceRoot - Racine du dépôt git
 * @param {string} options.hookType - 'pre-commit' ou 'pre-push'
 * @param {string} options.hookId - Identifiant unique
 * @param {string} options.scriptRelativePath - Chemin relatif vers wf-hook-<id>.js
 * @returns {{ installed: boolean, backup: string|null, skipped: boolean }}
 */
function installGitHook({ workspaceRoot, hookType = 'pre-commit', hookId, scriptRelativePath }) {
  const safeId = sanitizeHookId(hookId);
  const githooksDir = path.join(workspaceRoot, '.githooks');
  const hookFilePath = path.join(githooksDir, hookType);

  fs.mkdirSync(githooksDir, { recursive: true });
  const backup = createBackup(hookFilePath);

  let content = '';
  if (fs.existsSync(hookFilePath)) {
    content = fs.readFileSync(hookFilePath, 'utf8');
  } else {
    content = '#!/usr/bin/env sh\n# Git hooks directory managed with core.hooksPath\n';
  }

  const marker = `# Managed by wf-hook: ${safeId}`;
  if (content.includes(marker)) {
    return { installed: false, backup, skipped: true };
  }

  const normalizedScript = scriptRelativePath.replace(/\\/g, '/');
  let flag = '--staged';
  if (hookType === 'pre-push') {
    flag = '--pre-push';
  } else if (hookType === 'commit-msg') {
    flag = '--commit-msg-file "$1"';
  }

  const hookInvocation = `\n${marker}\nnode "${normalizedScript}" ${flag}\nif [ $? -ne 0 ]; then\n  exit 1\nfi\n`;
  content += hookInvocation;

  fs.writeFileSync(hookFilePath, content, { encoding: 'utf8', mode: 0o755 });

  try {
    execSync('git config core.hooksPath .githooks', { cwd: workspaceRoot, stdio: 'ignore' });
  } catch {}

  return { installed: true, backup, skipped: false };
}

/**
 * Découverte dynamique de tous les hooks gérés par wf-hook
 * @param {string} workspaceRoot
 * @returns {Array<{ id: string, target: string, file: string, enabled: boolean }>}
 */
function listManagedHooks(workspaceRoot) {
  const discovered = [];

  // 1. Antigravity hooks.json (.agents/hooks.json ou hooks.json racine)
  const antigravityPaths = [
    path.join(workspaceRoot, '.agents', 'hooks.json'),
    path.join(workspaceRoot, 'hooks.json')
  ];

  for (const agyPath of antigravityPaths) {
    if (fs.existsSync(agyPath)) {
      try {
        const config = safeParseJson(agyPath);
        for (const [key, val] of Object.entries(config)) {
          if (key.startsWith('wf-hook-')) {
            discovered.push({
              id: key.replace('wf-hook-', ''),
              target: 'antigravity',
              file: agyPath,
              enabled: val.enabled !== false
            });
          }
        }
      } catch {}
    }
  }

  // 2. Claude Code settings.json (.claude/settings.json ou settings.json)
  const claudePaths = [
    path.join(workspaceRoot, '.claude', 'settings.json'),
    path.join(workspaceRoot, 'settings.json')
  ];

  for (const cPath of claudePaths) {
    if (fs.existsSync(cPath)) {
      try {
        const config = safeParseJson(cPath);
        const preTools = config?.hooks?.PreToolUse || [];
        for (const group of preTools) {
          for (const h of (group.hooks || [])) {
            if (typeof h.command === 'string') {
              const match = h.command.match(/wf-hook-([a-zA-Z0-9_\-]+)\.js/);
              if (match) {
                discovered.push({
                  id: match[1],
                  target: 'claude-code',
                  file: cPath,
                  enabled: true
                });
              }
            }
          }
        }
      } catch {}
    }
  }

  // 3. Git hooks (.githooks/)
  const githooksDir = path.join(workspaceRoot, '.githooks');
  if (fs.existsSync(githooksDir)) {
    ['pre-commit', 'pre-push', 'commit-msg'].forEach(type => {
      const filePath = path.join(githooksDir, type);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const regex = /# Managed by wf-hook:\s*([a-zA-Z0-9_\-]+)/g;
        let m;
        while ((m = regex.exec(content)) !== null) {
          discovered.push({
            id: m[1],
            target: `git-${type}`,
            file: filePath,
            enabled: true
          });
        }
      }
    });
  }

  return discovered;
}

/**
 * Désinstallation chirurgicale d'un hook géré (retire la configuration ET les fichiers scripts générés)
 * @param {string} workspaceRoot
 * @param {string} hookId
 * @returns {{ removedFrom: string[], deletedFiles: string[], backups: string[] }}
 */
function removeManagedHook(workspaceRoot, hookId) {
  const safeId = sanitizeHookId(hookId);
  const removedFrom = [];
  const deletedFiles = [];
  const backups = [];
  const scriptIdentifier = `wf-hook-${safeId}`;

  // 1. Antigravity (.agents/hooks.json et hooks.json racine)
  [
    path.join(workspaceRoot, '.agents', 'hooks.json'),
    path.join(workspaceRoot, 'hooks.json')
  ].forEach(antigravityPath => {
    if (fs.existsSync(antigravityPath)) {
      try {
        const config = safeParseJson(antigravityPath);
        const key = `wf-hook-${safeId}`;
        if (config[key]) {
          const bkp = createBackup(antigravityPath);
          if (bkp) backups.push(bkp);
          delete config[key];
          fs.writeFileSync(antigravityPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
          removedFrom.push(antigravityPath);
        }
      } catch {}
    }
  });

  // 2. Claude Code (.claude/settings.json et settings.json)
  [
    path.join(workspaceRoot, '.claude', 'settings.json'),
    path.join(workspaceRoot, 'settings.json')
  ].forEach(claudePath => {
    if (fs.existsSync(claudePath)) {
      try {
        const config = safeParseJson(claudePath);
        let changed = false;
        if (config?.hooks?.PreToolUse) {
          config.hooks.PreToolUse = config.hooks.PreToolUse.map(group => {
            if (group.hooks) {
              const originalLen = group.hooks.length;
              group.hooks = group.hooks.filter(h => !(typeof h.command === 'string' && h.command.includes(scriptIdentifier)));
              if (group.hooks.length !== originalLen) changed = true;
            }
            return group;
          }).filter(group => group.hooks && group.hooks.length > 0);
        }
        if (changed) {
          const bkp = createBackup(claudePath);
          if (bkp) backups.push(bkp);
          fs.writeFileSync(claudePath, JSON.stringify(config, null, 2) + '\n', 'utf8');
          removedFrom.push(claudePath);
        }
      } catch {}
    }
  });

  // 3. Git hooks
  const githooksDir = path.join(workspaceRoot, '.githooks');
  if (fs.existsSync(githooksDir)) {
    ['pre-commit', 'pre-push', 'commit-msg'].forEach(type => {
      const filePath = path.join(githooksDir, type);
      if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        const marker = `# Managed by wf-hook: ${safeId}`;
        if (content.includes(marker)) {
          const bkp = createBackup(filePath);
          if (bkp) backups.push(bkp);
          const blockRegex = new RegExp(`\\n?${marker}[\\s\\S]*?fi\\n`, 'g');
          content = content.replace(blockRegex, '\n').trim() + '\n';
          fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o755 });
          removedFrom.push(filePath);
        }
      }
    });
  }

  // 4. Suppression physique des scripts et runners associés générés pour ce hookId
  const candidateFiles = [
    path.join(workspaceRoot, '.agents', 'skills', 'wf-hook', 'scripts', `wf-hook-${safeId}.js`),
    path.join(workspaceRoot, '.githooks', `wf-hook-${safeId}.js`),
    path.join(workspaceRoot, 'scripts', 'hooks', `wf-hook-${safeId}.js`),
    path.join(workspaceRoot, 'scripts', 'hooks', `wf-hook-${safeId}.cmd`),
    path.join(workspaceRoot, 'scripts', 'hooks', `wf-hook-${safeId}.sh`),
    path.join(workspaceRoot, '.agents', 'hooks', `wf-hook-${safeId}.js`),
    path.join(workspaceRoot, '.agents', 'hooks', `wf-hook-${safeId}.cmd`),
    path.join(workspaceRoot, '.agents', 'hooks', `wf-hook-${safeId}.sh`)
  ];

  for (const cand of candidateFiles) {
    if (fs.existsSync(cand)) {
      try {
        fs.unlinkSync(cand);
        deletedFiles.push(cand);
      } catch {}
    }
  }

  return { removedFrom, deletedFiles, backups };
}

module.exports = {
  sanitizeHookId,
  createBackup,
  safeParseJson,
  stripJsonComments,
  installClaudeHook,
  installAntigravityHook,
  installGitHook,
  listManagedHooks,
  removeManagedHook
};
