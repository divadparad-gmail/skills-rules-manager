/**
 * Exécution fédérée de la recherche sur l'ensemble des registres actifs
 * (§3.2 et §3.3 du PRD).
 *
 * Le service diffuse la requête en parallèle vers tous les points de
 * terminaison activés, sous plafond de concurrence, agrège les réponses,
 * élimine les doublons entre sources et confie le classement au moteur
 * hybride. Un registre lent ou en panne n'interrompt jamais la recherche : il
 * est simplement signalé dans le compte rendu.
 */

import { randomUUID } from 'crypto';
import {
  CustomSearchUrlConfig,
  RawRegistryEntry,
  SearchCriteria,
  SkillSearchResult,
} from '../common/discoveryTypes';
import { DiscoveryResourceType } from '../common/eventTypes';
import { ExtensionEventBus } from '../common/ExtensionEventBus';
import { normalizeResourceType, RegistryConfigService } from '../settings/RegistryConfigService';
import { SemanticSearchEngine } from './SemanticSearchEngine';
import { RankingEngine } from './RankingEngine';

/** Transport HTTP minimal, injectable pour les tests. */
export interface HttpSearchPort {
  get(
    url: string,
    options: { headers: Record<string, string>; timeoutMs: number }
  ): Promise<{ statusCode: number; body: string }>;
}

export interface FederatedSearchOutcome {
  queryId: string;
  results: SkillSearchResult[];
  /** Registres n'ayant pas répondu, avec le motif de l'échec. */
  failures: Array<{ registryId: string; registryName: string; reason: string }>;
  durationMs: number;
  /** Propositions de précision lorsque la demande est jugée ambiguë. */
  refinements: string[];
}

export class FederatedSearchService {
  constructor(
    private readonly registryConfig: RegistryConfigService,
    private readonly http: HttpSearchPort,
    private readonly semantic: SemanticSearchEngine,
    private readonly bus?: ExtensionEventBus
  ) {}

  /**
   * Exécute une recherche complète : résolution d'intention, diffusion
   * parallèle, agrégation, dédoublonnage et classement.
   */
  public async search(criteria: SearchCriteria): Promise<FederatedSearchOutcome> {
    const queryId = randomUUID();
    const started = Date.now();

    const registries = this.collectRegistries(criteria.types);

    this.bus?.publish('skill:search:initiated', 'search.service', {
      queryId,
      query: criteria.query,
      types: criteria.types,
      registryCount: registries.length,
    });

    const intent = await this.semantic.interpretQuery(criteria.query);

    const failures: FederatedSearchOutcome['failures'] = [];
    const harvested: Array<{ registry: CustomSearchUrlConfig; entry: RawRegistryEntry }> = [];

    const tasks = registries.map((registry) => async () => {
      try {
        const entries = await this.queryRegistry(registry, criteria, intent.normalizedQuery);
        for (const entry of entries) {
          harvested.push({ registry, entry });
        }
      } catch (err) {
        failures.push({
          registryId: registry.id,
          registryName: registry.name,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    });

    await runWithConcurrencyLimit(tasks, this.registryConfig.getMaxParallelQueries());

    const scored = await this.semantic.scoreCandidates(
      intent,
      harvested.map((item) => item.entry)
    );

    const normalized = harvested.map((item, index) =>
      this.toSearchResult(item.registry, item.entry, scored[index])
    );

    const deduplicated = FederatedSearchService.deduplicate(normalized, registries);
    const results = RankingEngine.rank(deduplicated, criteria);
    const durationMs = Date.now() - started;

    this.bus?.publish('skill:search:completed', 'search.service', {
      queryId,
      resultCount: results.length,
      durationMs,
      failedRegistries: failures.map((failure) => failure.registryId),
    });

    return {
      queryId,
      results,
      failures,
      durationMs,
      refinements: intent.ambiguous ? intent.refinements : [],
    };
  }

  /**
   * Compose la liste des registres à interroger : uniquement les sources
   * actives configurées. Aucun registre implicite n'est ajouté : la
   * description saisie ne part que vers des serveurs choisis explicitement.
   */
  public collectRegistries(types: DiscoveryResourceType[]): CustomSearchUrlConfig[] {
    return this.registryConfig.getActiveRegistries(types);
  }

  /**
   * Interroge un registre unique et normalise sa réponse. Le délai d'attente
   * propre au registre prévaut sur le délai global.
   */
  private async queryRegistry(
    registry: CustomSearchUrlConfig,
    criteria: SearchCriteria,
    normalizedQuery: string
  ): Promise<RawRegistryEntry[]> {
    const headers = await this.registryConfig.buildAuthHeaders(registry);
    const timeoutMs = registry.timeoutMs || this.registryConfig.getGlobalTimeoutMs();
    const url = buildSearchUrl(registry, criteria, normalizedQuery);

    const response = await this.http.get(url, { headers, timeoutMs });

    if (response.statusCode === 401 || response.statusCode === 403) {
      throw new Error(`Identifiants refusés par « ${registry.name} » (code ${response.statusCode}).`);
    }
    if (response.statusCode < 200 || response.statusCode >= 400) {
      throw new Error(`« ${registry.name} » a répondu avec le code ${response.statusCode}.`);
    }

    return parseRegistryResponse(response.body);
  }

  /**
   * Transforme une entrée brute en résultat normalisé, prêt pour l'affichage.
   */
  private toSearchResult(
    registry: CustomSearchUrlConfig,
    entry: RawRegistryEntry,
    scored?: { semanticScore: number; matchRationale: string }
  ): SkillSearchResult {
    const entryId = String(entry.id ?? entry.name ?? randomUUID());
    const type = normalizeResourceType(String(entry.type ?? 'skills')) ?? 'skills';

    return {
      id: `${registry.id}:${entryId}`,
      name: String(entry.name ?? entryId),
      description: String(entry.description ?? ''),
      type,
      registryId: registry.id,
      registryName: registry.name,
      url: String(entry.url ?? ''),
      version: typeof entry.version === 'string' ? entry.version : undefined,
      author: typeof entry.author === 'string' ? entry.author : undefined,
      tags: Array.isArray(entry.tags) ? entry.tags.map((tag) => String(tag)) : [],
      metrics: {
        downloads: toFiniteNumber(entry.downloads),
        stars: toFiniteNumber(entry.stars),
        comments: toFiniteNumber(entry.comments),
        rating: clampRating(entry.rating),
        verified: entry.verified === true,
      },
      semanticScore: scored?.semanticScore ?? 0,
      hybridScore: 0,
      matchRationale: scored?.matchRationale ?? '',
      manifest: typeof entry.content === 'string' ? entry.content : undefined,
    };
  }

  /**
   * Fusionne les résultats équivalents provenant de sources différentes. La
   * copie conservée est celle du registre de plus haute priorité ; les autres
   * sources sont mémorisées pour alimenter les badges d'origine.
   */
  public static deduplicate(
    results: SkillSearchResult[],
    registries: CustomSearchUrlConfig[]
  ): SkillSearchResult[] {
    const priorityById = new Map(registries.map((registry) => [registry.id, registry.priority]));
    const byKey = new Map<string, SkillSearchResult>();

    for (const result of results) {
      const key = buildDedupKey(result);
      const existing = byKey.get(key);

      if (!existing) {
        byKey.set(key, { ...result, alsoFoundIn: [] });
        continue;
      }

      const existingPriority = priorityById.get(existing.registryId) ?? Number.MAX_SAFE_INTEGER;
      const candidatePriority = priorityById.get(result.registryId) ?? Number.MAX_SAFE_INTEGER;

      if (candidatePriority < existingPriority) {
        // Le nouveau registre prime : il devient la source principale et
        // l'ancienne rejoint la liste des sources secondaires.
        byKey.set(key, {
          ...result,
          alsoFoundIn: dedupeStrings([...(existing.alsoFoundIn ?? []), existing.registryName]),
        });
      } else if (result.registryName !== existing.registryName) {
        existing.alsoFoundIn = dedupeStrings([...(existing.alsoFoundIn ?? []), result.registryName]);
      }
    }

    return [...byKey.values()];
  }
}

/**
 * Construit l'URL de recherche d'un registre en préservant les paramètres
 * déjà présents dans l'URL configurée.
 */
export function buildSearchUrl(
  registry: CustomSearchUrlConfig,
  criteria: SearchCriteria,
  normalizedQuery: string
): string {
  try {
    const url = new URL(registry.url);
    url.searchParams.set('q', normalizedQuery || criteria.query);
    const types = criteria.types.filter((type) => registry.supportedTypes.includes(type));
    if (types.length > 0) {
      url.searchParams.set('types', types.join(','));
    }
    if (criteria.limit && criteria.limit > 0) {
      url.searchParams.set('limit', String(criteria.limit));
    }
    return url.toString();
  } catch {
    // URL non analysable : la validation l'aura déjà signalée, on renvoie la
    // valeur brute pour que l'erreur de transport soit explicite.
    return registry.url;
  }
}

/**
 * Lit une réponse de registre, qu'elle soit un tableau direct ou un objet
 * enveloppant une clé `results`.
 */
export function parseRegistryResponse(body: string): RawRegistryEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("La réponse du registre n'est pas un document JSON valide.");
  }

  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { results?: unknown[] }).results)
      ? (parsed as { results: unknown[] }).results
      : null;

  if (!entries) {
    throw new Error("La réponse du registre ne respecte pas le schéma attendu (tableau d'entrées).");
  }

  return entries.filter(
    (entry): entry is RawRegistryEntry => Boolean(entry) && typeof entry === 'object'
  );
}

/**
 * Exécute une série de tâches asynchrones sous plafond de concurrence, afin
 * de ne pas saturer la pile réseau lorsque de nombreux registres sont actifs.
 */
export async function runWithConcurrencyLimit(
  tasks: Array<() => Promise<void>>,
  limit: number
): Promise<void> {
  const effectiveLimit = Math.max(1, Math.min(limit, tasks.length || 1));
  let cursor = 0;

  const workers = Array.from({ length: effectiveLimit }, async () => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      await tasks[index]();
    }
  });

  await Promise.all(workers);
}

/**
 * Clé de dédoublonnage : une même ressource publiée sur plusieurs registres
 * porte rarement le même identifiant, mais presque toujours le même nom
 * canonique pour un type donné.
 */
export function buildDedupKey(result: SkillSearchResult): string {
  const canonicalName = result.name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${result.type}::${canonicalName}`;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value && value.length > 0))];
}

function toFiniteNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clampRating(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(5, Math.max(0, parsed));
}
