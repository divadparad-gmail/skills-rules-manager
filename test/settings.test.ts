/**
 * Suite de tests de l'autorité de configuration : registres de recherche
 * personnalisés (§3.3) et répertoire NAS d'intégration (§3.5).
 */

import * as assert from 'node:assert';
import { test, describe } from 'node:test';
import {
  canonicalizeUrl,
  ConfigurationPort,
  RegistryConfigService,
  SEARCH_URLS_SETTING,
  ScopedSettingValue,
  SecretStoragePort,
  validateRegistryUrl,
} from '../src/settings/RegistryConfigService';
import {
  FileSystemPort,
  NasPathService,
  NAS_DIRECTORY_SETTING,
  normalizeNetworkPath,
} from '../src/settings/NasPathService';
import { CustomSearchUrlConfig } from '../src/common/discoveryTypes';

/** Configuration en mémoire reproduisant les deux portées de VS Code. */
class FakeConfiguration implements ConfigurationPort {
  public user = new Map<string, unknown>();
  public workspace = new Map<string, unknown>();

  public inspect<T>(section: string): ScopedSettingValue<T> | undefined {
    return {
      userValue: this.user.get(section) as T | undefined,
      workspaceValue: this.workspace.get(section) as T | undefined,
    };
  }

  public get<T>(section: string, defaultValue: T): T {
    if (this.workspace.has(section)) return this.workspace.get(section) as T;
    if (this.user.has(section)) return this.user.get(section) as T;
    return defaultValue;
  }

  public async update(section: string, value: unknown, scope: 'user' | 'workspace'): Promise<void> {
    (scope === 'user' ? this.user : this.workspace).set(section, value);
  }
}

class FakeSecretStorage implements SecretStoragePort {
  public store_ = new Map<string, string>();
  public async get(key: string): Promise<string | undefined> {
    return this.store_.get(key);
  }
  public async store(key: string, value: string): Promise<void> {
    this.store_.set(key, value);
  }
  public async delete(key: string): Promise<void> {
    this.store_.delete(key);
  }
}

function buildRegistry(overrides: Partial<CustomSearchUrlConfig> = {}): CustomSearchUrlConfig {
  return {
    id: 'registre-interne',
    name: 'Hub interne',
    url: 'https://skills.exemple.internal/v1/search',
    enabled: true,
    priority: 10,
    authType: 'none',
    timeoutMs: 5000,
    supportedTypes: ['skills', 'rules', 'workflows', 'hooks'],
    ...overrides,
  };
}

describe('Suite de Tests : Réglages des registres et du répertoire NAS', () => {
  test("1. Ajout d'un registre : les valeurs par défaut du PRD sont appliquées", async () => {
    const config = new FakeConfiguration();
    const service = new RegistryConfigService(config);

    const registry = await service.addRegistry({
      id: 'hub',
      name: 'Hub interne',
      url: 'https://skills.exemple.internal/v1/search',
    });

    assert.strictEqual(registry.enabled, true);
    assert.strictEqual(registry.priority, 10);
    assert.strictEqual(registry.timeoutMs, 5000);
    assert.strictEqual(registry.authType, 'none');
    assert.deepStrictEqual(registry.supportedTypes, ['skills', 'rules', 'workflows', 'hooks']);
  });

  test('2. Validation HTTPS : le protocole HTTP est refusé hors adresses de bouclage', () => {
    assert.strictEqual(validateRegistryUrl('https://skills.exemple.com/v1'), null);
    assert.strictEqual(validateRegistryUrl('http://localhost:8080/search'), null);
    assert.strictEqual(validateRegistryUrl('http://127.0.0.1:3000/search'), null);
    assert.match(validateRegistryUrl('http://skills.exemple.com/v1') ?? '', /HTTPS/);
    assert.match(validateRegistryUrl('ftp://exemple.com') ?? '', /pas pris en charge/);
    assert.match(validateRegistryUrl('pas une url') ?? '', /valide/);
    assert.match(validateRegistryUrl('') ?? '', /obligatoire/);
  });

  test("3. Authentification : un mode autre que « none » exige une référence de secret", () => {
    const sansSecret = RegistryConfigService.validate(buildRegistry({ authType: 'bearer' }));
    assert.ok(sansSecret.some((issue) => issue.field === 'secretKeyRef'));

    const avecSecret = RegistryConfigService.validate(
      buildRegistry({ authType: 'bearer', secretKeyRef: 'cle-hub' })
    );
    assert.strictEqual(avecSecret.length, 0);
  });

  test('4. Bornes : priorité et délai hors plage sont signalés', () => {
    const issues = RegistryConfigService.validate(
      buildRegistry({ priority: 500, timeoutMs: 120000 })
    );
    assert.ok(issues.some((issue) => issue.field === 'priority'));
    assert.ok(issues.some((issue) => issue.field === 'timeoutMs'));
  });

  test('5. URL canonique : protocole, hôte et chemin sont normalisés pour le dédoublonnage', () => {
    assert.strictEqual(
      canonicalizeUrl('HTTPS://Skills.Exemple.COM/V1/Search/'),
      'https://skills.exemple.com/v1/search'
    );
    assert.strictEqual(
      canonicalizeUrl('https://skills.exemple.com:8443/v1'),
      'https://skills.exemple.com:8443/v1'
    );
  });

  test("6. Précédence : l'espace de travail l'emporte sur l'utilisateur pour une même URL", () => {
    const config = new FakeConfiguration();
    config.user.set(SEARCH_URLS_SETTING, [
      buildRegistry({ id: 'global', name: 'Vue utilisateur', priority: 5 }),
    ]);
    config.workspace.set(SEARCH_URLS_SETTING, [
      buildRegistry({ id: 'local', name: 'Vue espace de travail', priority: 5 }),
    ]);

    const effective = new RegistryConfigService(config).getEffectiveRegistries();

    assert.strictEqual(effective.length, 1, 'Les deux entrées partagent la même URL canonique.');
    assert.strictEqual(effective[0].name, 'Vue espace de travail');
  });

  test("7. Fusion : les registres d'URL distinctes sont cumulés et triés par priorité", () => {
    const config = new FakeConfiguration();
    config.user.set(SEARCH_URLS_SETTING, [
      buildRegistry({ id: 'u1', url: 'https://a.exemple.com/v1', priority: 30 }),
    ]);
    config.workspace.set(SEARCH_URLS_SETTING, [
      buildRegistry({ id: 'w1', url: 'https://b.exemple.com/v1', priority: 2 }),
    ]);

    const effective = new RegistryConfigService(config).getEffectiveRegistries();

    assert.deepStrictEqual(effective.map((entry) => entry.id), ['w1', 'u1']);
  });

  test('8. Entrée invalide : elle est écartée sans faire échouer la lecture du réglage', () => {
    const config = new FakeConfiguration();
    config.user.set(SEARCH_URLS_SETTING, [
      buildRegistry({ id: 'valide', url: 'https://ok.exemple.com/v1' }),
      { id: 'cassé', name: 'Sans URL' },
      'chaîne inattendue',
    ]);

    const effective = new RegistryConfigService(config).getEffectiveRegistries();

    assert.strictEqual(effective.length, 1);
    assert.strictEqual(effective[0].id, 'valide');
  });

  test('9. Doublon dans la même portée : un second registre de même URL est refusé', async () => {
    const config = new FakeConfiguration();
    const service = new RegistryConfigService(config);
    await service.addRegistry({ id: 'a', name: 'A', url: 'https://skills.exemple.com/v1' });

    await assert.rejects(
      () => service.addRegistry({ id: 'b', name: 'B', url: 'https://skills.exemple.com/v1/' }),
      /déjà configuré/
    );
  });

  test('10. Bascule et suppression : le registre se désactive puis disparaît avec son secret', async () => {
    const config = new FakeConfiguration();
    const secrets = new FakeSecretStorage();
    const service = new RegistryConfigService(config, secrets);

    await service.addRegistry({
      id: 'hub',
      name: 'Hub',
      url: 'https://skills.exemple.com/v1',
      authType: 'bearer',
      secretKeyRef: 'cle-hub',
    });
    await secrets.store('cle-hub', 'jeton-secret');

    const disabled = await service.toggleRegistry('hub', false);
    assert.strictEqual(disabled.enabled, false);

    await service.removeRegistry('hub');
    assert.strictEqual(service.getEffectiveRegistries().length, 0);
    assert.strictEqual(await secrets.get('cle-hub'), undefined, 'Le secret est purgé avec le registre.');
  });

  test('11. Réordonnancement : la position dans la liste fixe la priorité de recherche', async () => {
    const config = new FakeConfiguration();
    const service = new RegistryConfigService(config);
    await service.addRegistry({ id: 'a', name: 'A', url: 'https://a.exemple.com/v1' });
    await service.addRegistry({ id: 'b', name: 'B', url: 'https://b.exemple.com/v1' });
    await service.addRegistry({ id: 'c', name: 'C', url: 'https://c.exemple.com/v1' });

    const reordered = await service.reorderRegistries(['c', 'a']);

    assert.deepStrictEqual(reordered.map((entry) => entry.id), ['c', 'a', 'b']);
    assert.deepStrictEqual(reordered.map((entry) => entry.priority), [1, 2, 3]);
  });

  test("12. Filtrage par catégorie : seuls les registres servant le type demandé sont retenus", async () => {
    const config = new FakeConfiguration();
    const service = new RegistryConfigService(config);
    await service.addRegistry({
      id: 'regles-seules',
      name: 'Règles',
      url: 'https://regles.exemple.com/v1',
      supportedTypes: ['rules'],
    });
    await service.addRegistry({
      id: 'competences',
      name: 'Compétences',
      url: 'https://skills.exemple.com/v1',
      supportedTypes: ['skills'],
    });
    await service.toggleRegistry('competences', false);

    const actifs = service.getActiveRegistries(['rules']);

    assert.deepStrictEqual(actifs.map((entry) => entry.id), ['regles-seules']);
  });

  test("13. En-têtes d'authentification : le secret est injecté selon le schéma déclaré", async () => {
    const config = new FakeConfiguration();
    const secrets = new FakeSecretStorage();
    const service = new RegistryConfigService(config, secrets);
    await secrets.store('cle', 'valeur-secrete');

    const bearer = await service.buildAuthHeaders(
      buildRegistry({ authType: 'bearer', secretKeyRef: 'cle' })
    );
    assert.strictEqual(bearer.Authorization, 'Bearer valeur-secrete');

    const apiKey = await service.buildAuthHeaders(
      buildRegistry({ authType: 'apiKey', secretKeyRef: 'cle' })
    );
    assert.strictEqual(apiKey['X-API-Key'], 'valeur-secrete');

    const basic = await service.buildAuthHeaders(
      buildRegistry({ authType: 'basic', secretKeyRef: 'cle' })
    );
    assert.strictEqual(basic.Authorization, `Basic ${Buffer.from('valeur-secrete').toString('base64')}`);

    await secrets.store('cle-entete', 'X-Organization-ID: ai-core');
    const custom = await service.buildAuthHeaders(
      buildRegistry({ authType: 'customHeader', secretKeyRef: 'cle-entete' })
    );
    assert.strictEqual(custom['X-Organization-ID'], 'ai-core');
  });

  test("14. Aucun identifiant n'est écrit dans la configuration", async () => {
    const config = new FakeConfiguration();
    const secrets = new FakeSecretStorage();
    const service = new RegistryConfigService(config, secrets);

    const registry = await service.addRegistry({
      id: 'hub',
      name: 'Hub',
      url: 'https://skills.exemple.com/v1',
      authType: 'bearer',
      secretKeyRef: 'antigravity.registry.hub',
    });
    await service.storeCredential(registry, 'jeton-tres-secret');

    const persisted = JSON.stringify(config.user.get(SEARCH_URLS_SETTING));
    assert.ok(!persisted.includes('jeton-tres-secret'), 'Le secret ne doit jamais atteindre settings.json.');
    assert.strictEqual(await secrets.get('antigravity.registry.hub'), 'jeton-tres-secret');
  });

  test('15. Sonde de santé : chaque situation produit un diagnostic distinct', async () => {
    const config = new FakeConfiguration();
    const secrets = new FakeSecretStorage();

    const connected = new RegistryConfigService(config, secrets, {
      probe: async () => ({
        statusCode: 200,
        body: JSON.stringify([{ id: 'a', name: 'A', type: 'skills' }]),
      }),
    });
    const connectedResult = await connected.testConnection(buildRegistry());
    assert.strictEqual(connectedResult.status, 'connected');
    assert.deepStrictEqual(connectedResult.supportedTypes, ['skills']);

    const unauthorized = new RegistryConfigService(config, secrets, {
      probe: async () => ({ statusCode: 401, body: '' }),
    });
    assert.strictEqual((await unauthorized.testConnection(buildRegistry())).status, 'unauthorized');

    const invalid = new RegistryConfigService(config, secrets, {
      probe: async () => ({ statusCode: 200, body: 'ceci est du HTML' }),
    });
    assert.strictEqual((await invalid.testConnection(buildRegistry())).status, 'invalid_schema');

    const unreachable = new RegistryConfigService(config, secrets, {
      probe: async () => {
        throw new Error("Délai d'attente dépassé");
      },
    });
    const unreachableResult = await unreachable.testConnection(buildRegistry());
    assert.strictEqual(unreachableResult.status, 'unreachable');
    assert.match(unreachableResult.message, /Délai/);
  });

  test('16. Réglages auxiliaires : les valeurs par défaut et les bornes du PRD sont respectées', () => {
    const config = new FakeConfiguration();
    const service = new RegistryConfigService(config);

    assert.strictEqual(service.isDefaultRegistryEnabled(), true);
    assert.strictEqual(service.getGlobalTimeoutMs(), 5000);
    assert.strictEqual(service.getMaxParallelQueries(), 5);

    config.user.set('antigravity.skills.requestTimeoutMs', 99999);
    config.user.set('antigravity.skills.maxParallelRegistryQueries', 0);
    assert.strictEqual(service.getGlobalTimeoutMs(), 30000, 'Le délai est ramené à sa borne haute.');
    assert.strictEqual(service.getMaxParallelQueries(), 1, 'La concurrence ne descend pas sous 1.');
  });

  test("17. Chemins réseau : chaque syntaxe de plateforme est normalisée sans être dénaturée", () => {
    assert.strictEqual(normalizeNetworkPath('\\\\Nas1\\DD2\\IA\\skills\\'), '\\\\Nas1\\DD2\\IA\\skills');
    assert.strictEqual(normalizeNetworkPath('//Nas1/DD2/IA/skills'), '\\\\Nas1\\DD2\\IA\\skills');
    assert.strictEqual(normalizeNetworkPath('Z:\\skills\\'), 'Z:\\skills');
    assert.strictEqual(normalizeNetworkPath('/Volumes/nas/skills/'), '/Volumes/nas/skills');
    assert.strictEqual(normalizeNetworkPath('/mnt//nas///skills'), '/mnt/nas/skills');
  });

  test("18. Variables d'environnement : les trois syntaxes sont développées", () => {
    const config = new FakeConfiguration();
    const service = new NasPathService(config, undefined, {
      NAS_ROOT: '/mnt/nas',
      HANGAR_ROOT_LOCAL: '/opt/hangar',
    } as NodeJS.ProcessEnv);

    assert.strictEqual(service.resolvePath('${env:NAS_ROOT}/skills'), '/mnt/nas/skills');
    assert.strictEqual(service.resolvePath('$HANGAR_ROOT_LOCAL/skills'), '/opt/hangar/skills');
    assert.strictEqual(service.expandEnvironmentVariables('%NAS_ROOT%/skills'), '/mnt/nas/skills');
    assert.strictEqual(
      service.resolvePath('${env:INEXISTANTE}/skills'),
      '/skills',
      "Une variable absente laisse un chemin manifestement invalide plutôt qu'un chemin erroné."
    );
  });

  test("19. Précédence du chemin NAS : l'espace de travail prime sur l'utilisateur", () => {
    const config = new FakeConfiguration();
    config.user.set(NAS_DIRECTORY_SETTING, '\\\\Nas1\\DD2\\IA\\skills');
    const service = new NasPathService(config, undefined, {} as NodeJS.ProcessEnv);
    assert.strictEqual(service.getEffectivePath(), '\\\\Nas1\\DD2\\IA\\skills');

    config.workspace.set(NAS_DIRECTORY_SETTING, 'Z:\\equipe\\skills');
    assert.strictEqual(service.getEffectivePath(), 'Z:\\equipe\\skills');
    assert.strictEqual(service.isConfigured(), true);
  });

  test('20. Validation du partage : les quatre états de diagnostic sont distingués', async () => {
    const config = new FakeConfiguration();

    const notConfigured = new NasPathService(config, undefined, {} as NodeJS.ProcessEnv);
    assert.strictEqual((await notConfigured.validatePath()).status, 'not_configured');

    config.user.set(NAS_DIRECTORY_SETTING, '/mnt/nas/skills');

    const unreachable = new NasPathService(
      config,
      {
        stat: async () => {
          throw new Error('Hôte réseau introuvable');
        },
        access: async () => undefined,
        writeFile: async () => undefined,
        unlink: async () => undefined,
      },
      {} as NodeJS.ProcessEnv
    );
    const unreachableResult = await unreachable.validatePath();
    assert.strictEqual(unreachableResult.status, 'unreachable');
    assert.match(unreachableResult.message, /injoignable/);

    const readOnly = new NasPathService(
      config,
      {
        stat: async () => ({ isDirectory: true }),
        access: async () => undefined,
        writeFile: async () => {
          throw new Error('Accès refusé');
        },
        unlink: async () => undefined,
      },
      {} as NodeJS.ProcessEnv
    );
    const readOnlyResult = await readOnly.validatePath();
    assert.strictEqual(readOnlyResult.status, 'permission_denied');
    assert.strictEqual(readOnlyResult.writable, false);

    const probes: string[] = [];
    const connected = new NasPathService(
      config,
      {
        stat: async () => ({ isDirectory: true }),
        access: async () => undefined,
        writeFile: async (target: string) => {
          probes.push(target);
        },
        unlink: async (target: string) => {
          probes.push(`supprimé:${target}`);
        },
      },
      {} as NodeJS.ProcessEnv
    );
    const connectedResult = await connected.validatePath();
    assert.strictEqual(connectedResult.status, 'connected');
    assert.strictEqual(connectedResult.writable, true);
    assert.strictEqual(probes.length, 2, 'Le témoin est écrit puis retiré.');
    assert.ok(probes[1].startsWith('supprimé:'), 'Aucun fichier témoin ne subsiste sur le partage.');
  });

  test("21. Chemin désignant un fichier : le partage est déclaré injoignable", async () => {
    const config = new FakeConfiguration();
    config.user.set(NAS_DIRECTORY_SETTING, '/mnt/nas/fichier.txt');
    const fileSystem: FileSystemPort = {
      stat: async () => ({ isDirectory: false }),
      access: async () => undefined,
      writeFile: async () => undefined,
      unlink: async () => undefined,
    };

    const result = await new NasPathService(config, fileSystem, {} as NodeJS.ProcessEnv).validatePath();

    assert.strictEqual(result.status, 'unreachable');
    assert.match(result.message, /dossier/);
  });

  test("22. Hôte UNC : le nom de serveur est extrait d'un chemin réseau Windows", () => {
    assert.strictEqual(NasPathService.getUncHost('\\\\Nas1\\DD2\\IA'), 'nas1');
    assert.strictEqual(NasPathService.getUncHost('//Serveur/partage'), 'serveur');
    assert.strictEqual(NasPathService.getUncHost('Z:\\skills'), null);
    assert.strictEqual(NasPathService.getUncHost(''), null);
  });
});
