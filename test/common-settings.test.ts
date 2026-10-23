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
  registrySecretKey,
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
import { GEMINI_API_KEY_SECRET } from '../src/search/GeminiClient';

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
  /** Clés lues, pour vérifier qu'un registre n'a pas interrogé le coffre. */
  public reads: string[] = [];
  public async get(key: string): Promise<string | undefined> {
    this.reads.push(key);
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
      buildRegistry({ authType: 'bearer', secretKeyRef: 'antigravity.registry.registre-interne' })
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
      secretKeyRef: 'antigravity.registry.hub',
    });
    await secrets.store('antigravity.registry.hub', 'jeton-secret');

    const disabled = await service.toggleRegistry('hub', false);
    assert.strictEqual(disabled.enabled, false);

    await service.removeRegistry('hub');
    assert.strictEqual(service.getEffectiveRegistries().length, 0);
    assert.strictEqual(await secrets.get('antigravity.registry.hub'), undefined, 'Le secret est purgé avec le registre.');
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
    await secrets.store('antigravity.registry.registre-interne', 'valeur-secrete');

    const bearer = await service.buildAuthHeaders(
      buildRegistry({ authType: 'bearer', secretKeyRef: 'antigravity.registry.registre-interne' })
    );
    assert.strictEqual(bearer.Authorization, 'Bearer valeur-secrete');

    const apiKey = await service.buildAuthHeaders(
      buildRegistry({ authType: 'apiKey', secretKeyRef: 'antigravity.registry.registre-interne' })
    );
    assert.strictEqual(apiKey['X-API-Key'], 'valeur-secrete');

    const basic = await service.buildAuthHeaders(
      buildRegistry({ authType: 'basic', secretKeyRef: 'antigravity.registry.registre-interne' })
    );
    assert.strictEqual(basic.Authorization, `Basic ${Buffer.from('valeur-secrete').toString('base64')}`);

    await secrets.store('antigravity.registry.entete', 'X-Organization-ID: ai-core');
    const custom = await service.buildAuthHeaders(
      buildRegistry({ id: 'entete', authType: 'customHeader', secretKeyRef: 'antigravity.registry.entete' })
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

    assert.strictEqual(service.getGlobalTimeoutMs(), 5000);
    assert.strictEqual(service.getMaxParallelQueries(), 5);

    config.user.set('antigravity.skills.requestTimeoutMs', 99999);
    config.user.set('antigravity.skills.maxParallelRegistryQueries', 0);
    assert.strictEqual(service.getGlobalTimeoutMs(), 30000, 'Le délai est ramené à sa borne haute.');
    assert.strictEqual(service.getMaxParallelQueries(), 1, 'La concurrence ne descend pas sous 1.');
  });

  test("17. Chemins réseau : chaque syntaxe de plateforme est normalisée sans être dénaturée", () => {
    assert.strictEqual(normalizeNetworkPath('\\\\serveur\\partage\\skills\\'), '\\\\serveur\\partage\\skills');
    assert.strictEqual(normalizeNetworkPath('//serveur/partage/skills'), '\\\\serveur\\partage\\skills');
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
    config.user.set(NAS_DIRECTORY_SETTING, '\\\\serveur\\partage\\skills');
    const service = new NasPathService(config, undefined, {} as NodeJS.ProcessEnv);
    assert.strictEqual(service.getEffectivePath(), '\\\\serveur\\partage\\skills');

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
    assert.strictEqual(NasPathService.getUncHost('\\\\serveur\\partage'), 'serveur');
    assert.strictEqual(NasPathService.getUncHost('//Serveur/partage'), 'serveur');
    assert.strictEqual(NasPathService.getUncHost('Z:\\skills'), null);
    assert.strictEqual(NasPathService.getUncHost(''), null);
  });

  // ------------------------------------------------------------------
  // Non-régression : registry-secretref-workspace-scope (audit run-1)
  // ------------------------------------------------------------------

  test("23. Registre d'espace de travail : aucun secret ni en-tête imposé, coffre jamais interrogé", async () => {
    const config = new FakeConfiguration();
    const secrets = new FakeSecretStorage();
    await secrets.store(GEMINI_API_KEY_SECRET, 'cle-gemini-de-la-victime');
    const service = new RegistryConfigService(config, secrets);

    const headers = await service.buildAuthHeaders(
      buildRegistry({
        id: 'hub',
        url: 'https://collecteur.exemple.tld/v1/search',
        authType: 'bearer',
        secretKeyRef: GEMINI_API_KEY_SECRET,
        customHeaders: { 'X-Exfiltration': 'oui' },
        origin: 'workspace',
      })
    );

    assert.deepStrictEqual(headers, { Accept: 'application/json' });
    assert.deepStrictEqual(secrets.reads, [], "Le coffre ne doit jamais être ouvert pour l'espace de travail.");
  });

  test("24. Origine forgée : « origin: user » écrit par un dépôt reste traité comme espace de travail", async () => {
    const config = new FakeConfiguration();
    const secrets = new FakeSecretStorage();
    await secrets.store(registrySecretKey('hub'), 'jeton-utilisateur');
    config.workspace.set(SEARCH_URLS_SETTING, [
      {
        ...buildRegistry({
          id: 'hub',
          url: 'https://collecteur.exemple.tld/v1/search',
          authType: 'bearer',
          secretKeyRef: registrySecretKey('hub'),
          customHeaders: { 'X-Exfiltration': 'oui' },
        }),
        origin: 'user',
      },
    ]);
    const service = new RegistryConfigService(config, secrets);

    const [registry] = service.getEffectiveRegistries();
    assert.strictEqual(registry.origin, 'workspace');

    const headers = await service.buildAuthHeaders(registry);
    assert.strictEqual(headers.Authorization, undefined);
    assert.strictEqual(headers['X-Exfiltration'], undefined);
    assert.deepStrictEqual(secrets.reads, []);
  });

  test('25. Référence de secret non canonique : elle est refusée, quelle que soit la portée', async () => {
    const issues = RegistryConfigService.validate(
      buildRegistry({ id: 'hub', authType: 'bearer', secretKeyRef: GEMINI_API_KEY_SECRET })
    );
    assert.ok(issues.some((issue) => issue.field === 'secretKeyRef'));
    assert.ok(
      RegistryConfigService.validate(
        buildRegistry({ id: 'hub', authType: 'bearer', secretKeyRef: registrySecretKey('autre') })
      ).some((issue) => issue.field === 'secretKeyRef'),
      "Un registre ne peut pas viser la clé d'un autre registre."
    );

    const config = new FakeConfiguration();
    const piege = buildRegistry({ id: 'hub', authType: 'bearer', secretKeyRef: GEMINI_API_KEY_SECRET });
    config.user.set(SEARCH_URLS_SETTING, [piege]);
    config.workspace.set(SEARCH_URLS_SETTING, [{ ...piege, url: 'https://autre.exemple.tld/v1' }]);
    const service = new RegistryConfigService(config);
    assert.deepStrictEqual(service.getEffectiveRegistries(), []);

    await assert.rejects(
      () => service.addRegistry({ ...piege, url: 'https://encore.exemple.tld/v1' }),
      /antigravity\.registry\.hub/
    );
  });

  test('26. Identifiants en double : seule la première entrée est retenue à la lecture', () => {
    const config = new FakeConfiguration();
    config.workspace.set(SEARCH_URLS_SETTING, [
      buildRegistry({ id: 'hub', name: 'Premier', url: 'https://a.exemple.tld/v1' }),
      buildRegistry({ id: 'hub', name: 'Second', url: 'https://b.exemple.tld/v1' }),
    ]);

    const effective = new RegistryConfigService(config).getEffectiveRegistries();

    assert.deepStrictEqual(effective.map((entry) => entry.name), ['Premier']);
  });

  test("27. Usurpation d'identifiant : un registre d'espace de travail ne peut pas reprendre celui d'un registre utilisateur", () => {
    const config = new FakeConfiguration();
    config.user.set(SEARCH_URLS_SETTING, [buildRegistry({ id: 'hub', url: 'https://hub.exemple.com/v1' })]);
    config.workspace.set(SEARCH_URLS_SETTING, [
      buildRegistry({ id: 'hub', url: 'https://collecteur.exemple.tld/v1' }),
    ]);

    const effective = new RegistryConfigService(config).getEffectiveRegistries();

    assert.strictEqual(effective.length, 1);
    assert.strictEqual(effective[0].url, 'https://hub.exemple.com/v1');
    assert.strictEqual(effective[0].origin, 'user');
  });

  test("28. Champ d'origine : il n'est jamais persisté par l'ajout, la mise à jour ni le réordonnancement", async () => {
    const config = new FakeConfiguration();
    const service = new RegistryConfigService(config);
    await service.addRegistry({ id: 'a', name: 'A', url: 'https://a.exemple.com/v1', origin: 'workspace' });
    await service.addRegistry({ id: 'b', name: 'B', url: 'https://b.exemple.com/v1' });
    await service.updateRegistry('b', { name: 'B modifié', origin: 'workspace' });
    await service.reorderRegistries(['b', 'a']);

    const persisted = JSON.stringify(config.user.get(SEARCH_URLS_SETTING));
    assert.ok(!persisted.includes('origin'), "Le champ d'origine ne doit jamais atteindre settings.json.");
    assert.ok(service.getEffectiveRegistries().every((entry) => entry.origin === 'user'));
  });

  test('29. Identifiants : la clé canonique est imposée et refusée aux registres du dépôt', async () => {
    const config = new FakeConfiguration();
    const secrets = new FakeSecretStorage();
    const service = new RegistryConfigService(config, secrets);

    const registry = await service.addRegistry({
      id: 'hub',
      name: 'Hub',
      url: 'https://hub.exemple.com/v1',
      authType: 'bearer',
    });
    assert.strictEqual(registry.secretKeyRef, registrySecretKey('hub'));
    assert.strictEqual(await service.storeCredential(registry, 'jeton'), registrySecretKey('hub'));

    await assert.rejects(
      () => service.storeCredential({ ...registry, origin: 'workspace' }, 'jeton'),
      /espace de travail/
    );
  });

  // ------------------------------------------------------------------
  // Non-régression : registry-localhost-ssrf (audit run-1)
  // ------------------------------------------------------------------

  test("30. Adresse de bouclage : écartée pour l'espace de travail, admise pour l'utilisateur", () => {
    const local = buildRegistry({ id: 'local', url: 'http://127.0.0.1:8080/v1/search' });

    const depot = new FakeConfiguration();
    depot.workspace.set(SEARCH_URLS_SETTING, [local]);
    assert.deepStrictEqual(new RegistryConfigService(depot).getEffectiveRegistries(), []);

    const utilisateur = new FakeConfiguration();
    utilisateur.user.set(SEARCH_URLS_SETTING, [local]);
    const effective = new RegistryConfigService(utilisateur).getEffectiveRegistries();
    assert.deepStrictEqual(effective.map((entry) => entry.id), ['local']);
  });

  test('31. Adresse de bouclage : toutes ses formes sont refusées à un dépôt, même en HTTPS', async () => {
    [
      'http://localhost:3000/v1',
      'https://localhost/v1',
      'http://api.localhost/v1',
      'http://127.1.2.3/v1',
      'http://0.0.0.0:8080/v1',
      'http://[::1]:8080/v1',
    ].forEach((url) => {
      assert.match(validateRegistryUrl(url, 'workspace') ?? '', /adresse locale/, url);
    });
    assert.strictEqual(validateRegistryUrl('http://[::1]:8080/v1', 'user'), null);

    const service = new RegistryConfigService(new FakeConfiguration());
    await assert.rejects(
      () => service.addRegistry({ id: 'local', name: 'Local', url: 'http://localhost:3000/v1' }, 'workspace'),
      /adresse locale/
    );
  });
});
