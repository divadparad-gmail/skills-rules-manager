/**
 * Lecture de la seule valeur utilisateur d'un réglage (`inspect().globalValue`).
 *
 * Une valeur posée par l'espace de travail (par exemple le `.vscode/settings.json` d'un dépôt
 * ouvert) est ignorée, en mode restreint comme après l'accord de confiance. Module sans autre
 * dépendance que `vscode`, chargé à la demande pour rester testable hors de l'hôte.
 */

let vscodeModule: any = null;
try {
  vscodeModule = require('vscode');
} catch {
  // Hors hôte VS Code (tests unitaires)
}

/**
 * Valeur utilisateur du réglage `key` (clé complète, par exemple `antigravity.discovery.enabled`),
 * ou `undefined` si elle est absente. Sans `inspect` (hôte simulé incomplet), rien n'est retenu.
 */
export function readUserSettingValue<T>(key: string): T | undefined {
  const config = vscodeModule?.workspace?.getConfiguration?.();
  if (!config || typeof config.inspect !== 'function') return undefined;
  return config.inspect(key)?.globalValue as T | undefined;
}
