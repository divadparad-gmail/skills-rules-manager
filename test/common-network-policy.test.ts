/**
 * Suite de tests de la politique réseau des registres définis par un dépôt :
 * refus des adresses internes écrites dans l'URL, puis refus des noms de
 * domaine qui pointent vers une adresse interne, vérifiés à la connexion.
 *
 * Non-régression de registry-localhost-ssrf (audit run-1), étendue aux
 * réseaux privés et à la résolution DNS.
 */

import * as assert from 'node:assert';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { test, describe, before, after } from 'node:test';
import {
  createPublicOnlyLookup,
  isNonPublicAddress,
  isNonPublicHostname,
  LookupFunction,
  NonPublicDestinationError,
} from '../src/common/networkPolicy';
import { request } from '../src/search/httpClient';
import {
  ConfigurationPort,
  RegistryConfigService,
  ScopedSettingValue,
  SEARCH_URLS_SETTING,
  validateRegistryUrl,
} from '../src/settings/RegistryConfigService';
import { FederatedSearchService } from '../src/search/FederatedSearchService';
import { SemanticSearchEngine } from '../src/search/SemanticSearchEngine';
import { CustomSearchUrlConfig } from '../src/common/discoveryTypes';

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
    return this.user.has(section) ? (this.user.get(section) as T) : defaultValue;
  }
  public async update(section: string, value: unknown, scope: 'user' | 'workspace'): Promise<void> {
    (scope === 'user' ? this.user : this.workspace).set(section, value);
  }
}

function buildRegistry(overrides: Partial<CustomSearchUrlConfig> = {}): CustomSearchUrlConfig {
  return {
    id: 'depot',
    name: 'Registre du dépôt',
    url: 'https://registre.exemple.com/v1/search',
    enabled: true,
    priority: 10,
    authType: 'none',
    timeoutMs: 5000,
    supportedTypes: ['skills', 'rules', 'workflows', 'hooks'],
    ...overrides,
  };
}

/** Résolveur factice : chaque nom connu renvoie l'adresse indiquée. */
function fakeResolver(table: Record<string, string[]>): LookupFunction {
  return (hostname, options, callback) => {
    const addresses = table[hostname];
    if (!addresses) {
      const err: NodeJS.ErrnoException = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
      err.code = 'ENOTFOUND';
      callback(err, '', 0);
      return;
    }
    const entries = addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    if (options.all) {
      callback(null, entries);
    } else {
      callback(null, entries[0].address, entries[0].family);
    }
  };
}

function lookupOnce(lookup: LookupFunction, hostname: string, all: boolean): Promise<NodeJS.ErrnoException | null> {
  return new Promise((resolve) => {
    lookup(hostname, { all }, (err) => resolve(err));
  });
}

describe('Suite de Tests : Politique réseau des registres définis par un dépôt', () => {
  let server: http.Server;
  let port = 0;
  let hits = 0;

  before(async () => {
    server = http.createServer((_req, res) => {
      hits += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('1. Classification : bouclage, plages privées, lien local et IPv6 interne sont reconnus', () => {
    [
      '127.0.0.1', '127.8.9.10', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.255',
      '192.168.50.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '255.255.255.255',
      '::1', '::', '[::1]', 'fd00::1', 'fc12:3456::1', 'fe80::1', 'ff02::1',
      '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:c0a8:3201', '64:ff9b::a00:1',
    ].forEach((address) => assert.strictEqual(isNonPublicAddress(address), true, address));

    [
      '8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.255.255', '100.128.0.1',
      '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8',
    ].forEach((address) => assert.strictEqual(isNonPublicAddress(address), false, address));

    assert.strictEqual(isNonPublicAddress('registre.exemple.com'), false, "Un nom n'est jugé qu'après résolution.");
    assert.strictEqual(isNonPublicHostname('localhost'), true);
    assert.strictEqual(isNonPublicHostname('api.localhost.'), true);
  });

  test("2. Validation : toute adresse interne écrite dans l'URL est refusée à un dépôt, sous toutes ses formes", () => {
    [
      'https://192.168.50.1/v1',
      'https://10.0.0.5/v1',
      'https://172.20.1.1/v1',
      'https://169.254.169.254/latest/meta-data',
      'https://100.64.0.1/v1',
      'https://[fd00::1]/v1',
      'https://[fe80::1]/v1',
      'https://[::ffff:127.0.0.1]/v1',
      'http://2130706433/v1', // 127.0.0.1 en notation décimale
      'http://0x7f.1/v1', // 127.0.0.1 en notation hexadécimale abrégée
      'http://0177.0.0.1/v1', // 127.0.0.1 en notation octale
    ].forEach((url) => {
      assert.match(validateRegistryUrl(url, 'workspace') ?? '', /réseau interne/, url);
    });

    assert.strictEqual(validateRegistryUrl('https://registre.exemple.com/v1', 'workspace'), null);
    assert.strictEqual(validateRegistryUrl('https://8.8.8.8/v1', 'workspace'), null);
  });

  test('3. Portée utilisateur : un registre interne reste admis (NAS, registre d’entreprise)', () => {
    assert.strictEqual(validateRegistryUrl('https://192.168.50.10/v1', 'user'), null);
    assert.strictEqual(validateRegistryUrl('https://10.0.0.5/v1', 'user'), null);

    const config = new FakeConfiguration();
    config.user.set(SEARCH_URLS_SETTING, [buildRegistry({ id: 'nas', url: 'https://192.168.50.10/v1' })]);
    config.workspace.set(SEARCH_URLS_SETTING, [buildRegistry({ id: 'piege', url: 'https://192.168.50.1/v1' })]);

    const effective = new RegistryConfigService(config).getEffectiveRegistries();

    assert.deepStrictEqual(effective.map((entry) => entry.id), ['nas']);
  });

  test('4. Résolution contrôlée : un nom qui pointe vers une adresse interne est refusé', async () => {
    const lookup = createPublicOnlyLookup(
      fakeResolver({
        'vers-boucle.exemple': ['127.0.0.1'],
        'vers-routeur.exemple': ['192.168.50.1'],
        'vers-metadonnees.exemple': ['169.254.169.254'],
        'vers-ipv6.exemple': ['::1'],
        'mixte.exemple': ['93.184.216.34', '10.0.0.1'],
        'public.exemple': ['93.184.216.34', '2606:2800:220:1::1'],
      })
    );

    for (const hostname of ['vers-boucle.exemple', 'vers-routeur.exemple', 'vers-metadonnees.exemple', 'vers-ipv6.exemple']) {
      for (const all of [false, true]) {
        const err = await lookupOnce(lookup, hostname, all);
        assert.ok(err instanceof NonPublicDestinationError, `${hostname} (all=${all})`);
      }
    }
    assert.ok(
      (await lookupOnce(lookup, 'mixte.exemple', true)) instanceof NonPublicDestinationError,
      'Une réponse mixte publique et interne est refusée en entier.'
    );
    assert.strictEqual(await lookupOnce(lookup, 'public.exemple', true), null);
    assert.strictEqual(await lookupOnce(lookup, 'public.exemple', false), null);
    assert.strictEqual((await lookupOnce(lookup, 'inconnu.exemple', false))?.code, 'ENOTFOUND');
  });

  test("5. Transport : un nom qui résout vers le poste n'atteint jamais le service local", async () => {
    hits = 0;
    const resolve = fakeResolver({ 'registre-piege.exemple': ['127.0.0.1'] });

    await assert.rejects(
      () =>
        request(`http://registre-piege.exemple:${port}/v1/search`, {
          headers: {},
          timeoutMs: 2000,
          publicOnly: true,
          resolve,
        }),
      NonPublicDestinationError
    );
    await assert.rejects(
      () => request(`http://localhost:${port}/v1/search`, { headers: {}, timeoutMs: 2000, publicOnly: true }),
      NonPublicDestinationError
    );
    await assert.rejects(
      () => request(`http://127.0.0.1:${port}/v1/search`, { headers: {}, timeoutMs: 2000, publicOnly: true }),
      NonPublicDestinationError
    );
    assert.strictEqual(hits, 0, 'Aucune requête ne doit atteindre le service local.');

    const allowed = await request(`http://127.0.0.1:${port}/v1/search`, { headers: {}, timeoutMs: 2000 });
    assert.strictEqual(allowed.statusCode, 200, 'Sans restriction, le registre utilisateur local reste joignable.');
    assert.strictEqual(hits, 1);
  });

  test('6. Recherche et sonde : la restriction est demandée pour un registre de dépôt, et lui seul', async () => {
    const config = new FakeConfiguration();
    config.user.set(SEARCH_URLS_SETTING, [buildRegistry({ id: 'perso', url: 'https://perso.exemple.com/v1' })]);
    config.workspace.set(SEARCH_URLS_SETTING, [buildRegistry({ id: 'depot', url: 'https://depot.exemple.com/v1' })]);

    const searchCalls = new Map<string, boolean | undefined>();
    const probeCalls = new Map<string, boolean | undefined>();
    const registryConfig = new RegistryConfigService(config, undefined, {
      probe: async (url, options) => {
        probeCalls.set(new URL(url).hostname, options.publicOnly);
        return { statusCode: 200, body: '[]' };
      },
    });
    const service = new FederatedSearchService(
      registryConfig,
      {
        get: async (url, options) => {
          searchCalls.set(new URL(url).hostname, options.publicOnly);
          return { statusCode: 200, body: '[]' };
        },
      },
      new SemanticSearchEngine()
    );

    await service.search({ query: 'revue de code', types: ['skills'], sortBy: 'relevance' });
    for (const registry of registryConfig.getEffectiveRegistries()) {
      await registryConfig.testConnection(registry);
    }

    assert.strictEqual(searchCalls.get('depot.exemple.com'), true);
    assert.strictEqual(searchCalls.get('perso.exemple.com'), false);
    assert.strictEqual(probeCalls.get('depot.exemple.com'), true);
    assert.strictEqual(probeCalls.get('perso.exemple.com'), false);
  });
});
