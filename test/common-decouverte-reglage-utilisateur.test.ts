// Vue Découverte : seuls les réglages utilisateur antigravity.skills.nasDirectoryPath et
// antigravity.discovery.enabled sont retenus.
//
// Un dépôt ouvert peut poser des réglages dans .vscode/settings.json. Une valeur d'espace de
// nasDirectoryPath ne doit ni désigner le répertoire validé (stat, access, fichier témoin), ni faire
// développer une variable d'environnement dans un chemin ; une valeur d'espace de discovery.enabled
// ne doit pas activer la vue.
//
// Aucun test n'ouvre de connexion : le port de système de fichiers est simulé, il note chaque appel et
// refuse tout chemin qui commence par \\ ou //.
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe } from 'node:test';

// --- Faux module vscode minimal (seulement pour la lecture des réglages) ---
type Valeurs = { globalValue?: unknown; workspaceValue?: unknown };
const reglagesVsCode: Record<string, Valeurs> = {};
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'vscode') return 'vscode';
  return origResolve.call(this, request, ...args);
};
require.cache['vscode'] = {
  id: 'vscode',
  filename: 'vscode',
  loaded: true,
  exports: {
    workspace: {
      getConfiguration: (section?: string) => {
        const cle = (k: string) => (section ? `${section}.${k}` : k);
        return {
          // Valeur fusionnée, comme VS Code : l'espace de travail l'emporte sur l'utilisateur
          get: (k: string, def?: unknown) => reglagesVsCode[cle(k)]?.workspaceValue ?? reglagesVsCode[cle(k)]?.globalValue ?? def,
          inspect: (k: string) => ({ key: cle(k), defaultValue: undefined, ...reglagesVsCode[cle(k)] }),
        };
      },
    },
  },
} as any;

import { ConfigurationPort, ScopedSettingValue } from '../src/settings/RegistryConfigService';
import { FileSystemPort, NAS_DIRECTORY_SETTING, NasPathService } from '../src/settings/NasPathService';

const RACINE_EXTENSION = path.resolve(__dirname, '../..');
const DISCOVERY_ENABLED = 'antigravity.discovery.enabled';
const VALEUR_ESPACE = '\\\\hote\\partage\\%UNEVAR%';

/** Port de configuration simulé : get fusionné (l'espace l'emporte), inspect séparé. */
class FausseConfiguration implements ConfigurationPort {
  public user = new Map<string, unknown>();
  public workspace = new Map<string, unknown>();
  public inspect<T>(section: string): ScopedSettingValue<T> | undefined {
    return { userValue: this.user.get(section) as T | undefined, workspaceValue: this.workspace.get(section) as T | undefined };
  }
  public get<T>(section: string, defaultValue: T): T {
    if (this.workspace.has(section)) return this.workspace.get(section) as T;
    if (this.user.has(section)) return this.user.get(section) as T;
    return defaultValue;
  }
  public async update(): Promise<void> {
    throw new Error('aucune écriture de configuration attendue');
  }
}

/** Port de système de fichiers simulé : note chaque appel, refuse les chemins réseau, accepte le reste. */
function faux_fs(): { port: FileSystemPort; appels: string[] } {
  const appels: string[] = [];
  const noter = (nom: string, p: string) => {
    appels.push(`${nom} ${p}`);
    if (/^[\\/]{2}/.test(p)) throw Object.assign(new Error('ENOENT: chemin réseau refusé par le test'), { code: 'ENOENT' });
  };
  return {
    appels,
    port: {
      async stat(p) { noter('stat', p); return { isDirectory: true }; },
      async access(p) { noter('access', p); },
      async writeFile(p) { noter('writeFile', p); },
      async unlink(p) { noter('unlink', p); },
    },
  };
}

/** Environnement simulé qui note chaque variable lue. */
function fauxEnv(valeurs: Record<string, string>): { env: NodeJS.ProcessEnv; lues: string[] } {
  const lues: string[] = [];
  const env = new Proxy({ ...valeurs } as NodeJS.ProcessEnv, {
    get: (cible, cle) => {
      if (typeof cle === 'string') lues.push(cle);
      return (cible as any)[cle];
    },
  });
  return { env, lues };
}

/** Le module de lecture des réglages utilisateur (chargé à l'exécution : il n'existe pas avant la correction). */
function lectureUtilisateur(): { readUserSettingValue: <T>(cle: string) => T | undefined } {
  return require(path.join(RACINE_EXTENSION, 'out-test', 'src', 'settings', 'userSettingValue'));
}

describe('Suite de Tests : vue Découverte, réglages utilisateur seulement', () => {
  test('1. nasDirectoryPath d\'espace en \\\\hote avec une variable, sans valeur utilisateur : chemin vide, aucune variable lue, aucun appel fs', async () => {
    const config = new FausseConfiguration();
    config.workspace.set(NAS_DIRECTORY_SETTING, VALEUR_ESPACE);
    const { env, lues } = fauxEnv({ UNEVAR: 'valeur-secrete' });
    const { port, appels } = faux_fs();
    const service = new NasPathService(config, port, env);

    assert.strictEqual(service.getEffectivePath(), '', 'la valeur d\'espace est ignorée');
    assert.strictEqual(service.isConfigured(), false);
    const verdict = await service.validatePath();
    assert.strictEqual(verdict.status, 'not_configured');
    assert.doesNotMatch(JSON.stringify(verdict), /valeur-secrete|hote/);
    assert.deepStrictEqual(appels, [], 'aucun appel au système de fichiers');
    assert.ok(!lues.includes('UNEVAR'), 'aucune variable d\'environnement développée');
    assert.deepStrictEqual((await service.preflight()).status, 'not_configured', 'le déploiement vers le NAS est refusé');
  });

  test('2. Valeur utilisateur locale : comportement inchangé, variables développées comprises ; elle l\'emporte sur une valeur d\'espace', async () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'decouverte-reglage-utilisateur-'));
    try {
      const config = new FausseConfiguration();
      config.user.set(NAS_DIRECTORY_SETTING, '%RACINE_NAS%/skills/');
      const { env } = fauxEnv({ RACINE_NAS: racine, UNEVAR: 'valeur-secrete' });
      const { port, appels } = faux_fs();
      const service = new NasPathService(config, port, env);
      const attendu = path.join(racine, 'skills');

      assert.strictEqual(service.getEffectivePath(), attendu, 'variable développée, séparateur final retiré');
      assert.strictEqual((await service.validatePath()).status, 'connected');
      assert.ok(appels.length > 0 && appels.every((a) => a.includes(attendu)), 'seul le chemin utilisateur est consulté');

      config.workspace.set(NAS_DIRECTORY_SETTING, VALEUR_ESPACE);
      appels.length = 0;
      assert.strictEqual(service.getEffectivePath(), attendu, 'la valeur utilisateur l\'emporte sur celle de l\'espace');
      assert.strictEqual((await service.validatePath()).status, 'connected');
      assert.ok(appels.every((a) => !/hote|valeur-secrete/.test(a)), 'la valeur d\'espace n\'est jamais consultée');
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });

  test('3. discovery.enabled : seule la valeur utilisateur active la vue', () => {
    const { readUserSettingValue } = lectureUtilisateur();
    const poser = (v: Valeurs) => { reglagesVsCode[DISCOVERY_ENABLED] = v; };

    poser({ workspaceValue: true });
    assert.strictEqual(readUserSettingValue<boolean>(DISCOVERY_ENABLED), undefined, 'valeur d\'espace ignorée');
    poser({ globalValue: true });
    assert.strictEqual(readUserSettingValue<boolean>(DISCOVERY_ENABLED), true);
    poser({ globalValue: false, workspaceValue: true });
    assert.strictEqual(readUserSettingValue<boolean>(DISCOVERY_ENABLED), false, 'l\'espace ne peut pas réactiver la vue');
  });

  test('4. isDiscoveryEnabled passe par la lecture de la valeur utilisateur, jamais par get()', () => {
    const source = fs.readFileSync(path.join(RACINE_EXTENSION, 'src', 'ui', 'discoveryCommands.ts'), 'utf8');
    const corps = source.slice(source.indexOf('export function isDiscoveryEnabled'));
    const fonction = corps.slice(0, corps.indexOf('\n}') + 2);
    assert.match(fonction, /readUserSettingValue<boolean>\(DISCOVERY_ENABLED_SETTING\)\s*===\s*true/);
    assert.doesNotMatch(fonction, /\.get\b/);
  });

  test('5. package.json déclare la portée « machine » pour nasDirectoryPath et discovery.enabled ; restrictedConfigurations inchangé', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(RACINE_EXTENSION, 'package.json'), 'utf8'));
    const proprietes = pkg.contributes.configuration.properties;
    assert.strictEqual(proprietes[NAS_DIRECTORY_SETTING].scope, 'machine');
    assert.strictEqual(proprietes[DISCOVERY_ENABLED].scope, 'machine');
    assert.deepStrictEqual([...pkg.capabilities.untrustedWorkspaces.restrictedConfigurations].sort(), [
      'antigravity.skills.nasDirectoryPath',
      'antigravity.skills.searchUrls',
    ]);
  });
});
