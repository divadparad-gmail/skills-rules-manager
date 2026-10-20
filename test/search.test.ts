/**
 * Suite de tests du moteur de découverte : résolution d'intention floue,
 * classement hybride, diffusion fédérée et historique des recherches
 * (chapitres 3.2, 3.3 et 3.7 du PRD).
 */

import * as assert from 'node:assert';
import { test, describe } from 'node:test';
import {
  cosineSimilarity,
  parseIntentResponse,
  SemanticSearchEngine,
} from '../src/search/SemanticSearchEngine';
import { RankingEngine, logNormalize } from '../src/search/RankingEngine';
import {
  buildDedupKey,
  buildSearchUrl,
  DEFAULT_REGISTRY,
  FederatedSearchService,
  parseRegistryResponse,
  runWithConcurrencyLimit,
} from '../src/search/FederatedSearchService';
import { RecentSearchesStore, MementoPort } from '../src/search/RecentSearchesStore';
import {
  ConfigurationPort,
  RegistryConfigService,
  ScopedSettingValue,
  SEARCH_URLS_SETTING,
} from '../src/settings/RegistryConfigService';
import { CustomSearchUrlConfig, SkillSearchResult } from '../src/common/discoveryTypes';
import { ExtensionEventBus } from '../src/common/ExtensionEventBus';
import { GEMINI_API_KEY_SECRET, GeminiClient } from '../src/search/GeminiClient';
import { HttpRequestOptions, request } from '../src/search/httpClient';

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
    if (this.user.has(section)) return this.user.get(section) as T;
    return defaultValue;
  }
  public async update(section: string, value: unknown, scope: 'user' | 'workspace'): Promise<void> {
    (scope === 'user' ? this.user : this.workspace).set(section, value);
  }
}

class FakeMemento implements MementoPort {
  private readonly store = new Map<string, unknown>();
  public get<T>(key: string, defaultValue: T): T {
    return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
  }
  public async update(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }
}

function buildResult(overrides: Partial<SkillSearchResult> = {}): SkillSearchResult {
  return {
    id: 'registre:ressource',
    name: 'Ressource',
    description: 'Description de la ressource',
    type: 'skills',
    registryId: 'registre',
    registryName: 'Registre',
    url: 'https://exemple.com/ressource',
    tags: [],
    metrics: { downloads: 0, stars: 0, comments: 0, rating: 0, verified: false },
    semanticScore: 0.5,
    hybridScore: 0,
    matchRationale: '',
    ...overrides,
  };
}

function buildRegistry(overrides: Partial<CustomSearchUrlConfig> = {}): CustomSearchUrlConfig {
  return {
    id: 'registre',
    name: 'Registre',
    url: 'https://skills.exemple.com/v1/search',
    enabled: true,
    priority: 10,
    authType: 'none',
    timeoutMs: 5000,
    supportedTypes: ['skills', 'rules', 'workflows', 'hooks'],
    ...overrides,
  };
}

describe('Suite de Tests : Découverte sémantique, classement et recherche fédérée', () => {
  test("1. Résolution d'intention locale : pile technique et contraintes sont extraites", () => {
    const engine = new SemanticSearchEngine();
    const intent = engine.interpretQueryLocally(
      'scraper des tableaux dynamiques derrière une authentification avec playwright'
    );

    assert.ok(intent.keywords.includes('tableaux'));
    assert.ok(intent.techStack.includes('web'), 'Le lexique doit reconnaître la navigation automatisée.');
    assert.ok(intent.constraints.includes('authentification'));
    assert.strictEqual(intent.ambiguous, false);
  });

  test('2. Requête ambiguë : des pistes de précision sont proposées', () => {
    const engine = new SemanticSearchEngine();
    const intent = engine.interpretQueryLocally('aide');

    assert.strictEqual(intent.ambiguous, true);
    assert.strictEqual(intent.refinements.length, 3);
  });

  test('3. Mots vides : ils sont écartés des mots-clés retenus', () => {
    const engine = new SemanticSearchEngine();
    const intent = engine.interpretQueryLocally('je cherche un outil pour les tests unitaires');

    assert.ok(!intent.keywords.includes('pour'));
    assert.ok(!intent.keywords.includes('les'));
    assert.ok(intent.keywords.includes('unitaires'));
  });

  test('4. Appariement lexical : le nom pèse davantage que la description', async () => {
    const engine = new SemanticSearchEngine();
    const intent = engine.interpretQueryLocally('extraction de tableaux');

    const scored = await engine.scoreCandidates(intent, [
      { id: '1', name: 'Extracteur de tableaux', description: 'Divers' },
      { id: '2', name: 'Outil générique', description: 'Permet une extraction de tableaux' },
      { id: '3', name: 'Sans rapport', description: 'Gestion de calendrier' },
    ]);

    assert.ok(scored[0].semanticScore > scored[1].semanticScore);
    assert.ok(scored[1].semanticScore > scored[2].semanticScore);
    assert.strictEqual(scored[2].semanticScore, 0);
  });

  test("5. Explication de correspondance : elle cite les termes réellement couverts", async () => {
    const engine = new SemanticSearchEngine();
    const intent = engine.interpretQueryLocally('extraction de tableaux avec playwright');
    const scored = await engine.scoreCandidates(intent, [
      { id: '1', name: 'Extracteur de tableaux', description: 'Appuyé sur playwright' },
    ]);

    assert.match(scored[0].matchRationale, /tableaux/);
    assert.match(scored[0].matchRationale, /pertinence estimée/);
  });

  test("6. Repli hors ligne : l'échec du modèle n'interrompt pas la recherche", async () => {
    const engine = new SemanticSearchEngine({
      generate: async () => {
        throw new Error('Service injoignable');
      },
      embed: async () => {
        throw new Error('Service injoignable');
      },
    });

    const intent = await engine.interpretQuery('analyser les goulots de rendu react');
    assert.ok(intent.keywords.length > 0, "L'analyse lexicale prend le relais.");

    const scored = await engine.scoreCandidates(intent, [
      { id: '1', name: 'Profileur react', description: 'Analyse les goulots de rendu' },
    ]);
    assert.ok(scored[0].semanticScore > 0, 'Un score lexical reste produit sans le modèle.');
  });

  test('7. Appariement vectoriel : la similarité du modèle enrichit le score lexical', async () => {
    const engine = new SemanticSearchEngine({
      generate: async () => '{}',
      // Le premier vecteur est celui de la requête ; le candidat aligné obtient
      // la similarité maximale, l'autre une similarité opposée.
      embed: async () => [
        [1, 0],
        [1, 0],
        [-1, 0],
      ],
    });

    const intent = engine.interpretQueryLocally('documentation technique');
    const scored = await engine.scoreCandidates(intent, [
      { id: 'aligne', name: 'Candidat aligné', description: '' },
      { id: 'oppose', name: 'Candidat opposé', description: '' },
    ]);

    assert.ok(scored[0].semanticScore > scored[1].semanticScore);
    assert.strictEqual(scored[1].semanticScore, 0, 'Une similarité opposée annule le score.');
  });

  test("8. Lecture de la réponse du modèle : le JSON est extrait même entouré de texte", () => {
    const parsed = parseIntentResponse(
      'Voici l’analyse : {"normalizedQuery":"tests e2e","keywords":["tests","e2e"],"techStack":["testing"],"constraints":[],"ambiguous":false,"refinements":[]} — fin.'
    );

    assert.ok(parsed);
    assert.strictEqual(parsed.normalizedQuery, 'tests e2e');
    assert.deepStrictEqual(parsed.techStack, ['testing']);
    assert.strictEqual(parseIntentResponse('aucun objet ici'), null);
  });

  test('9. Similarité cosinus : les cas limites sont neutres plutôt que fautifs', () => {
    assert.strictEqual(cosineSimilarity([1, 0], [1, 0]), 1);
    assert.strictEqual(cosineSimilarity([1, 0], [-1, 0]), -1);
    assert.strictEqual(cosineSimilarity([0, 0], [1, 1]), 0);
    assert.strictEqual(cosineSimilarity([], []), 0);
  });

  test("10. Classement hybride : la pertinence prime, les métriques départagent", () => {
    const ranked = RankingEngine.rank(
      [
        buildResult({ id: 'a', name: 'A', semanticScore: 0.9, metrics: { downloads: 10, stars: 1, comments: 0, rating: 3, verified: false } }),
        buildResult({ id: 'b', name: 'B', semanticScore: 0.2, metrics: { downloads: 100000, stars: 900, comments: 500, rating: 5, verified: true } }),
      ],
      { query: 'x', types: ['skills'], sortBy: 'relevance' }
    );

    assert.strictEqual(ranked[0].name, 'A', 'En mode pertinence, le score sémantique domine.');
    assert.ok(ranked[0].hybridScore > 0 && ranked[0].hybridScore <= 1);
  });

  test('11. Tri par téléchargements : le mode demandé prévaut sur la pondération', () => {
    const ranked = RankingEngine.rank(
      [
        buildResult({ id: 'a', name: 'A', semanticScore: 0.95, metrics: { downloads: 10, stars: 0, comments: 0, rating: 0, verified: false } }),
        buildResult({ id: 'b', name: 'B', semanticScore: 0.1, metrics: { downloads: 50000, stars: 0, comments: 0, rating: 0, verified: false } }),
      ],
      { query: 'x', types: ['skills'], sortBy: 'downloads' }
    );

    assert.strictEqual(ranked[0].name, 'B');
  });

  test('12. Filtres de qualité : note minimale, badge vérifié et catégorie', () => {
    const results = [
      buildResult({ id: 'a', name: 'A', type: 'skills', metrics: { downloads: 0, stars: 0, comments: 0, rating: 4.8, verified: true } }),
      buildResult({ id: 'b', name: 'B', type: 'skills', metrics: { downloads: 0, stars: 0, comments: 0, rating: 2.5, verified: false } }),
      buildResult({ id: 'c', name: 'C', type: 'rules', metrics: { downloads: 0, stars: 0, comments: 0, rating: 5, verified: true } }),
    ];

    const parRating = RankingEngine.rank(results, {
      query: 'x',
      types: ['skills', 'rules'],
      sortBy: 'relevance',
      minRating: 4,
    });
    assert.deepStrictEqual(parRating.map((r) => r.name), ['C', 'A']);

    const verifiees = RankingEngine.rank(results, {
      query: 'x',
      types: ['skills'],
      sortBy: 'relevance',
      verifiedOnly: true,
    });
    assert.deepStrictEqual(verifiees.map((r) => r.name), ['A']);

    const regles = RankingEngine.rank(results, { query: 'x', types: ['rules'], sortBy: 'relevance' });
    assert.deepStrictEqual(regles.map((r) => r.name), ['C']);
  });

  test('13. Normalisation logarithmique : un petit registre reste comparable à un grand hub', () => {
    assert.strictEqual(logNormalize(0, 1000), 0);
    assert.strictEqual(logNormalize(1000, 1000), 1);
    assert.ok(logNormalize(100, 10000) > 0.4, "L'échelle logarithmique évite l'écrasement des petites valeurs.");
    assert.strictEqual(logNormalize(50, 0), 0);
  });

  test('14. Plafond de résultats : la limite demandée est respectée', () => {
    const results = Array.from({ length: 10 }, (_, index) =>
      buildResult({ id: `r${index}`, name: `Ressource ${index}` })
    );
    const ranked = RankingEngine.rank(results, {
      query: 'x',
      types: ['skills'],
      sortBy: 'relevance',
      limit: 3,
    });
    assert.strictEqual(ranked.length, 3);
  });

  test("15. Construction d'URL : la requête et les catégories prises en charge sont transmises", () => {
    const url = buildSearchUrl(
      buildRegistry({ url: 'https://skills.exemple.com/v1/search?tenant=acme', supportedTypes: ['skills'] }),
      { query: 'brut', types: ['skills', 'rules'], sortBy: 'relevance', limit: 20 },
      'requête normalisée'
    );

    const parsed = new URL(url);
    assert.strictEqual(parsed.searchParams.get('tenant'), 'acme', "Les paramètres d'origine sont préservés.");
    assert.strictEqual(parsed.searchParams.get('q'), 'requête normalisée');
    assert.strictEqual(parsed.searchParams.get('types'), 'skills', 'Seules les catégories servies sont demandées.');
    assert.strictEqual(parsed.searchParams.get('limit'), '20');
  });

  test('16. Lecture de réponse : les deux formes de schéma sont acceptées, les autres rejetées', () => {
    assert.strictEqual(parseRegistryResponse('[{"id":"a"}]').length, 1);
    assert.strictEqual(parseRegistryResponse('{"results":[{"id":"a"},{"id":"b"}]}').length, 2);
    assert.throws(() => parseRegistryResponse('pas du json'), /JSON/);
    assert.throws(() => parseRegistryResponse('{"donnees":[]}'), /schéma/);
  });

  test('17. Plafond de concurrence : jamais plus de N tâches simultanées', async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 12 }, () => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });

    await runWithConcurrencyLimit(tasks, 3);

    assert.ok(maxActive <= 3, `Au plus 3 tâches simultanées, ${maxActive} observées.`);
    assert.strictEqual(active, 0, 'Toutes les tâches sont achevées.');
  });

  test("18. Dédoublonnage : la source de plus haute priorité l'emporte et les autres sont citées", () => {
    const registries = [
      buildRegistry({ id: 'premium', name: 'Registre premium', priority: 1 }),
      buildRegistry({ id: 'public', name: 'Registre public', priority: 50, url: 'https://public.exemple.com/v1' }),
    ];

    const deduplicated = FederatedSearchService.deduplicate(
      [
        buildResult({ id: 'public:extracteur', name: 'Extracteur de tableaux', registryId: 'public', registryName: 'Registre public' }),
        buildResult({ id: 'premium:extracteur', name: 'Extracteur de Tableaux', registryId: 'premium', registryName: 'Registre premium' }),
      ],
      registries
    );

    assert.strictEqual(deduplicated.length, 1, 'Les deux entrées désignent la même ressource.');
    assert.strictEqual(deduplicated[0].registryName, 'Registre premium');
    assert.deepStrictEqual(deduplicated[0].alsoFoundIn, ['Registre public']);
  });

  test('19. Clé de dédoublonnage : la casse et les accents ne créent pas de faux doublons distincts', () => {
    assert.strictEqual(
      buildDedupKey(buildResult({ name: 'Extracteur de Tableaux' })),
      buildDedupKey(buildResult({ name: 'extracteur-de-tableaux' }))
    );
    assert.notStrictEqual(
      buildDedupKey(buildResult({ name: 'Extracteur', type: 'skills' })),
      buildDedupKey(buildResult({ name: 'Extracteur', type: 'rules' }))
    );
  });

  test('20. Diffusion fédérée : les sources sont agrégées et les événements publiés', async () => {
    const config = new FakeConfiguration();
    config.user.set(SEARCH_URLS_SETTING, [
      buildRegistry({ id: 'interne', name: 'Hub interne', url: 'https://interne.exemple.com/v1', priority: 2 }),
    ]);
    config.user.set('antigravity.skills.enableDefaultRegistry', false);

    const bus = new ExtensionEventBus();
    const topics: string[] = [];
    bus.subscribe('skill:search:initiated', (envelope) => { topics.push(envelope.topic); });
    bus.subscribe('skill:search:completed', (envelope) => { topics.push(envelope.topic); });

    const service = new FederatedSearchService(
      new RegistryConfigService(config),
      {
        get: async () =>
          ({
            statusCode: 200,
            body: JSON.stringify([
              { id: 'extracteur', name: 'Extracteur de tableaux', description: 'Extraction de tableaux dynamiques', type: 'skills', downloads: 1200, rating: 4.6, verified: true },
            ]),
          }),
      },
      new SemanticSearchEngine(),
      bus
    );

    const outcome = await service.search({
      query: 'extraction de tableaux',
      types: ['skills'],
      sortBy: 'relevance',
    });

    assert.strictEqual(outcome.results.length, 1);
    assert.strictEqual(outcome.results[0].registryName, 'Hub interne');
    assert.strictEqual(outcome.results[0].id, 'interne:extracteur');
    assert.ok(outcome.results[0].matchRationale.length > 0);
    assert.deepStrictEqual(topics, ['skill:search:initiated', 'skill:search:completed']);
    bus.dispose();
  });

  test("21. Registre en panne : la recherche aboutit et l'échec est rapporté", async () => {
    const config = new FakeConfiguration();
    config.user.set(SEARCH_URLS_SETTING, [
      buildRegistry({ id: 'sain', name: 'Sain', url: 'https://sain.exemple.com/v1', priority: 1 }),
      buildRegistry({ id: 'panne', name: 'En panne', url: 'https://panne.exemple.com/v1', priority: 2 }),
    ]);
    config.user.set('antigravity.skills.enableDefaultRegistry', false);

    const service = new FederatedSearchService(
      new RegistryConfigService(config),
      {
        get: async (url: string) => {
          if (url.includes('panne')) {
            throw new Error("Délai d'attente dépassé");
          }
          return {
            statusCode: 200,
            body: JSON.stringify([{ id: 'a', name: 'Ressource saine', type: 'skills' }]),
          };
        },
      },
      new SemanticSearchEngine()
    );

    const outcome = await service.search({ query: 'ressource', types: ['skills'], sortBy: 'relevance' });

    assert.strictEqual(outcome.results.length, 1);
    assert.strictEqual(outcome.failures.length, 1);
    assert.strictEqual(outcome.failures[0].registryId, 'panne');
    assert.match(outcome.failures[0].reason, /Délai/);
  });

  test('22. Identifiants refusés : le registre est signalé comme en échec authentifié', async () => {
    const config = new FakeConfiguration();
    config.user.set(SEARCH_URLS_SETTING, [buildRegistry({ id: 'prive', name: 'Privé' })]);
    config.user.set('antigravity.skills.enableDefaultRegistry', false);

    const service = new FederatedSearchService(
      new RegistryConfigService(config),
      { get: async () => ({ statusCode: 403, body: '' }) },
      new SemanticSearchEngine()
    );

    const outcome = await service.search({ query: 'x', types: ['skills'], sortBy: 'relevance' });

    assert.strictEqual(outcome.results.length, 0);
    assert.match(outcome.failures[0].reason, /refusés/);
  });

  test('23. Registre officiel : il est interrogé en tête tant qu’il reste activé', () => {
    const config = new FakeConfiguration();
    const service = new FederatedSearchService(
      new RegistryConfigService(config),
      { get: async () => ({ statusCode: 200, body: '[]' }) },
      new SemanticSearchEngine()
    );

    const avec = service.collectRegistries(['skills']);
    assert.strictEqual(avec[0].id, DEFAULT_REGISTRY.id);

    config.user.set('antigravity.skills.enableDefaultRegistry', false);
    assert.strictEqual(service.collectRegistries(['skills']).length, 0);
  });

  test("24. Historique : la ré-exécution promeut la requête sans la dupliquer", async () => {
    const globalState = new FakeMemento();
    const workspaceState = new FakeMemento();
    const store = new RecentSearchesStore(globalState, workspaceState, () => 10);

    await store.record({ query: 'tests e2e', types: ['skills'], sortBy: 'relevance', resultCount: 3 });
    await store.record({ query: 'profilage react', types: ['skills'], sortBy: 'relevance', resultCount: 5 });
    await store.record({ query: 'tests e2e', types: ['skills'], sortBy: 'relevance', resultCount: 4 });

    const entries = store.list('user');
    assert.strictEqual(entries.length, 2, 'La requête répétée ne crée pas de doublon.');
    assert.strictEqual(entries[0].query, 'tests e2e', 'La requête réexécutée repasse en tête.');
    assert.strictEqual(entries[0].resultCount, 4, 'Le compte de résultats est actualisé.');
  });

  test("25. Éviction du moins récemment utilisé : la limite configurée est respectée", async () => {
    const store = new RecentSearchesStore(new FakeMemento(), new FakeMemento(), () => 3);

    for (let index = 1; index <= 5; index += 1) {
      await store.record({
        query: `requête ${index}`,
        types: ['skills'],
        sortBy: 'relevance',
        resultCount: index,
        timestamp: Date.now() + index,
      });
    }

    const entries = store.list('user');
    assert.strictEqual(entries.length, 3);
    assert.deepStrictEqual(
      entries.map((entry) => entry.query),
      ['requête 5', 'requête 4', 'requête 3'],
      'Les requêtes les plus anciennes sont évincées.'
    );
  });

  test("26. Limite hors bornes : elle est ramenée dans l'intervalle admis", async () => {
    const store = new RecentSearchesStore(new FakeMemento(), new FakeMemento(), () => 500);
    for (let index = 0; index < 60; index += 1) {
      await store.record({
        query: `q${index}`,
        types: ['skills'],
        sortBy: 'relevance',
        resultCount: 0,
        timestamp: Date.now() + index,
      });
    }
    assert.strictEqual(store.list('user').length, 50, 'Le plafond absolu de 50 entrées est appliqué.');
  });

  test("27. Saisie semi-automatique : les correspondances par préfixe passent devant", async () => {
    const store = new RecentSearchesStore(new FakeMemento(), new FakeMemento(), () => 10);
    await store.record({ query: 'analyser le rendu react', types: ['skills'], sortBy: 'relevance', resultCount: 1, timestamp: 1 });
    await store.record({ query: 'react : profilage avancé', types: ['skills'], sortBy: 'relevance', resultCount: 1, timestamp: 2 });

    const suggestions = store.suggest('react');

    assert.strictEqual(suggestions.length, 2);
    assert.strictEqual(suggestions[0].query, 'react : profilage avancé', 'Le préfixe exact est privilégié.');
  });

  test('28. Double portée : les deux mémoires sont alimentées et purgeables séparément', async () => {
    const globalState = new FakeMemento();
    const workspaceState = new FakeMemento();
    const store = new RecentSearchesStore(globalState, workspaceState, () => 10);

    await store.record({ query: 'requête partagée', types: ['rules'], sortBy: 'rating', resultCount: 2 });

    assert.strictEqual(store.list('user').length, 1);
    assert.strictEqual(store.list('workspace').length, 1);
    assert.strictEqual(store.listMerged().length, 1, 'La fusion ne duplique pas une requête identique.');

    await store.clear('workspace');
    assert.strictEqual(store.list('workspace').length, 0);
    assert.strictEqual(store.list('user').length, 1);

    await store.remove('requête partagée');
    assert.strictEqual(store.list('user').length, 0);
  });

  test("29. Entrées corrompues : elles sont ignorées sans faire échouer la lecture", () => {
    const globalState = new FakeMemento();
    void globalState.update('antigravity.search.recent', [
      { query: 'valide', types: ['skills'], sortBy: 'relevance', timestamp: 5, resultCount: 1 },
      { types: ['skills'] },
      'texte inattendu',
      null,
    ]);

    const store = new RecentSearchesStore(globalState, new FakeMemento(), () => 10);
    const entries = store.list('user');

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].query, 'valide');
  });

  // ------------------------------------------------------------------
  // Non-régression : gemini-key-in-query-string (audit run-1)
  // ------------------------------------------------------------------

  test("30. Clé Gemini : elle voyage dans l'en-tête x-goog-api-key, jamais dans l'URL", async () => {
    const cle = 'AIza-cle-tres-secrete';
    const appels: Array<{ url: string; options: HttpRequestOptions }> = [];
    const client = new GeminiClient(
      {
        get: async (key: string) => (key === GEMINI_API_KEY_SECRET ? cle : undefined),
        store: async () => undefined,
        delete: async () => undefined,
      },
      {
        transport: async (url, options) => {
          appels.push({ url, options });
          return url.includes('batchEmbedContents')
            ? { statusCode: 200, body: JSON.stringify({ embeddings: [{ values: [1, 0] }] }) }
            : { statusCode: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }) };
        },
      }
    );

    await client.generate('demande');
    await client.embed(['texte']);

    assert.strictEqual(appels.length, 2);
    for (const appel of appels) {
      assert.ok(!appel.url.includes(cle), "La clé ne doit jamais figurer dans l'URL.");
      assert.ok(!/[?&]key=/.test(appel.url), 'Aucun paramètre key= ne doit subsister.');
      assert.strictEqual(appel.options.headers['x-goog-api-key'], cle);
    }
  });

  test("31. Transport : le message d'URL invalide ne cite pas l'URL, donc aucun identifiant", async () => {
    const cle = 'AIza-cle-tres-secrete';
    await assert.rejects(
      () => request(`pas une url ?key=${cle}`, { headers: {}, timeoutMs: 1000 }),
      (err: Error) => {
        assert.ok(!err.message.includes(cle), 'Le message ne doit pas contenir la clé.');
        assert.match(err.message, /n'est pas valide/);
        return true;
      }
    );
  });
});
