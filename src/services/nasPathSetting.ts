/**
 * Lecture du réglage `skillsManager.nasPath` (chemin du catalogue NAS).
 *
 * Seule la valeur des réglages utilisateur est retenue. Une valeur posée par l'espace de travail
 * (par exemple le `.vscode/settings.json` d'un dépôt ouvert) est ignorée, en mode restreint comme
 * après l'accord de confiance : le dépôt n'est pas une source fiable pour un chemin consulté
 * automatiquement. La portée « machine » de package.json retire déjà le réglage de l'espace ; cette
 * lecture vaut aussi pour un éditeur dérivé qui ne respecterait pas la portée.
 *
 * Tous les sites qui lisent ce réglage passent par cette fonction.
 */

let vscodeModule: any = null;
try {
  vscodeModule = require('vscode');
} catch {
  // Hors hôte VS Code (tests unitaires)
}

export const NAS_PATH_SETTING = 'nasPath';

/**
 * Valeur utilisateur de `skillsManager.nasPath`, sans espaces autour ; chaîne vide si elle est
 * absente. Sans `inspect` (hôte simulé incomplet), aucune valeur n'est retenue.
 */
export function getUserNasPath(): string {
  const config = vscodeModule && vscodeModule.workspace ? vscodeModule.workspace.getConfiguration('skillsManager') : null;
  if (!config || typeof config.inspect !== 'function') return '';
  const value = config.inspect(NAS_PATH_SETTING)?.globalValue;
  return typeof value === 'string' ? value.trim() : '';
}
