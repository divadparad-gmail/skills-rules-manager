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
 * Résout le chemin effectif d'Antigravity global :
 * 1. Priorité au chemin personnalisé passé en paramètre direct
 * 2. Sinon, lecture de la configuration VS Code 'skillsManager.globalPath' (si non vide)
 * 3. Sinon, fallback automatique sur le répertoire utilisateur de la machine hôte (~/.gemini/config)
 */
export function getEffectiveGlobalAntigravityPath(customGlobalPath?: string): string {
  if (customGlobalPath && customGlobalPath.trim().length > 0) {
    return customGlobalPath.trim();
  }
  if (vscodeModule && vscodeModule.workspace) {
    const config = vscodeModule.workspace.getConfiguration('skillsManager');
    const configured = config ? config.get('globalPath') : null;
    if (configured && typeof configured === 'string' && configured.trim().length > 0) {
      return configured.trim();
    }
  }
  return getDefaultGlobalAntigravityPath();
}

/**
 * Résout le chemin effectif de Claude Code global :
 * 1. Priorité au chemin personnalisé passé en paramètre direct
 * 2. Sinon, lecture de la configuration VS Code 'skillsManager.claudeGlobalPath' (si non vide)
 * 3. Sinon, fallback automatique sur le répertoire utilisateur de la machine hôte (~/.claude)
 */
export function getEffectiveGlobalClaudePath(customClaudePath?: string): string {
  if (customClaudePath && customClaudePath.trim().length > 0) {
    return customClaudePath.trim();
  }
  if (vscodeModule && vscodeModule.workspace) {
    const config = vscodeModule.workspace.getConfiguration('skillsManager');
    const configured = config ? config.get('claudeGlobalPath') : null;
    if (configured && typeof configured === 'string' && configured.trim().length > 0) {
      return configured.trim();
    }
  }
  return getDefaultGlobalClaudePath();
}
