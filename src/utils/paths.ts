import * as os from 'os';
import * as path from 'path';

let vscodeModule: any = null;
try {
  vscodeModule = require('vscode');
} catch {
  // Hors hôte VS Code (ex: tests unitaires ou runner Node indépendant)
}

/**
 * Retourne le dossier racine de l'utilisateur hôte de manière universelle
 * (compatible Windows, macOS et Linux).
 */
export function getUserHome(): string {
  return os.homedir() || process.env.USERPROFILE || process.env.HOME || '';
}

/**
 * Retourne le chemin par défaut du dossier global Antigravity (~/.gemini/config).
 */
export function getDefaultGlobalAntigravityPath(): string {
  const home = getUserHome();
  return home ? path.join(home, '.gemini', 'config') : '';
}

/**
 * Retourne le chemin par défaut du dossier global Claude Code (~/.claude).
 */
export function getDefaultGlobalClaudePath(): string {
  const home = getUserHome();
  return home ? path.join(home, '.claude') : '';
}

/**
 * Valeur utilisateur d'un réglage de chemin de `skillsManager` (`inspect().globalValue`), sans
 * espaces autour ; chaîne vide si elle est absente. Une valeur posée par l'espace de travail (par
 * exemple le `.vscode/settings.json` d'un dépôt ouvert) est ignorée, en mode restreint comme après
 * l'accord de confiance : un profil global n'est jamais désigné par le dépôt. La portée « machine »
 * de package.json retire déjà ces réglages de l'espace ; cette lecture vaut aussi pour un éditeur
 * dérivé qui ne respecterait pas la portée. Sans `inspect` (hôte simulé incomplet), rien n'est retenu.
 */
function readUserPathSetting(key: 'globalPath' | 'claudeGlobalPath'): string {
  if (!vscodeModule || !vscodeModule.workspace) return '';
  const config = vscodeModule.workspace.getConfiguration('skillsManager');
  if (!config || typeof config.inspect !== 'function') return '';
  const value = config.inspect(key)?.globalValue;
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Résout le chemin effectif d'Antigravity global :
 * 1. Priorité au chemin personnalisé passé en paramètre direct
 * 2. Sinon, la valeur utilisateur de 'skillsManager.globalPath' (si non vide)
 * 3. Sinon, fallback automatique sur le répertoire utilisateur de la machine hôte (~/.gemini/config)
 */
export function getEffectiveGlobalAntigravityPath(customGlobalPath?: string): string {
  if (customGlobalPath && customGlobalPath.trim().length > 0) {
    return customGlobalPath.trim();
  }
  const configured = readUserPathSetting('globalPath');
  if (configured) {
    return configured;
  }
  return getDefaultGlobalAntigravityPath();
}

/**
 * Résout le chemin effectif de Claude Code global :
 * 1. Priorité au chemin personnalisé passé en paramètre direct
 * 2. Sinon, la valeur utilisateur de 'skillsManager.claudeGlobalPath' (si non vide)
 * 3. Sinon, fallback automatique sur le répertoire utilisateur de la machine hôte (~/.claude)
 */
export function getEffectiveGlobalClaudePath(customClaudePath?: string): string {
  if (customClaudePath && customClaudePath.trim().length > 0) {
    return customClaudePath.trim();
  }
  const configured = readUserPathSetting('claudeGlobalPath');
  if (configured) {
    return configured;
  }
  return getDefaultGlobalClaudePath();
}
