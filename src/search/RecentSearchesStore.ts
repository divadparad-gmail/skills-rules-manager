/**
 * Historique local des recherches récentes (§3.7 du PRD).
 *
 * L'historique est conservé dans deux portées distinctes : l'espace de travail
 * retient les requêtes propres à la pile technique du dépôt courant, tandis
 * que la portée globale sert de mémoire transversale entre projets. Rien ne
 * quitte la machine : aucune télémétrie, aucun envoi distant.
 *
 * L'éviction suit une stratégie du moins récemment utilisé, et la ré-exécution
 * d'une requête déjà connue la replace en tête au lieu de la dupliquer.
 */

import { DiscoveryResourceType } from '../common/eventTypes';
import { RecentSearchEntry, SearchSortMode, PersistenceScope } from '../common/discoveryTypes';

export const RECENT_SEARCHES_KEY = 'antigravity.search.recent';
export const DEFAULT_RECENT_LIMIT = 10;
export const MAX_RECENT_LIMIT = 50;

/** Stockage clé-valeur persistant, calqué sur l'API Memento de VS Code. */
export interface MementoPort {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Promise<void>;
}

export class RecentSearchesStore {
  constructor(
    private readonly globalState: MementoPort,
    private readonly workspaceState: MementoPort,
    private readonly getLimit: () => number = () => DEFAULT_RECENT_LIMIT
  ) {}

  /**
   * Enregistre une requête exécutée dans les deux portées. La portée globale
   * assure le rappel entre projets, la portée espace de travail la pertinence
   * locale.
   */
  public async record(entry: Omit<RecentSearchEntry, 'timestamp'> & { timestamp?: number }): Promise<void> {
    const normalized: RecentSearchEntry = {
      query: entry.query.trim(),
      types: [...entry.types],
      sortBy: entry.sortBy,
      resultCount: entry.resultCount,
      timestamp: entry.timestamp ?? Date.now(),
    };

    if (normalized.query.length === 0) return;

    await Promise.all([
      this.writeScope('user', this.insert(this.list('user'), normalized)),
      this.writeScope('workspace', this.insert(this.list('workspace'), normalized)),
    ]);
  }

  /** Liste l'historique d'une portée, du plus récent au plus ancien. */
  public list(scope: PersistenceScope): RecentSearchEntry[] {
    const store = this.storeFor(scope);
    const raw = store.get<unknown>(RECENT_SEARCHES_KEY, []);
    if (!Array.isArray(raw)) return [];

    return raw
      .map((item) => this.normalizeEntry(item))
      .filter((item): item is RecentSearchEntry => item !== null)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, this.effectiveLimit());
  }

  /**
   * Historique fusionné des deux portées, utilisé par les pastilles de rappel
   * rapide affichées sous le champ de recherche.
   */
  public listMerged(): RecentSearchEntry[] {
    const merged = new Map<string, RecentSearchEntry>();
    for (const entry of [...this.list('workspace'), ...this.list('user')]) {
      const key = this.entryKey(entry);
      const existing = merged.get(key);
      if (!existing || entry.timestamp > existing.timestamp) {
        merged.set(key, entry);
      }
    }
    return [...merged.values()]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, this.effectiveLimit());
  }

  /**
   * Suggestions de saisie semi-automatique : les requêtes passées dont le
   * texte contient la frappe en cours, les correspondances par préfixe en
   * tête.
   */
  public suggest(prefix: string, max = 5): RecentSearchEntry[] {
    const needle = prefix.trim().toLowerCase();
    if (needle.length === 0) return this.listMerged().slice(0, max);

    const candidates = this.listMerged().filter((entry) =>
      entry.query.toLowerCase().includes(needle)
    );

    candidates.sort((a, b) => {
      const aStarts = a.query.toLowerCase().startsWith(needle) ? 0 : 1;
      const bStarts = b.query.toLowerCase().startsWith(needle) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return b.timestamp - a.timestamp;
    });

    return candidates.slice(0, max);
  }

  /** Supprime une requête de l'historique, dans les deux portées. */
  public async remove(query: string): Promise<void> {
    const needle = query.trim().toLowerCase();
    await Promise.all(
      (['user', 'workspace'] as PersistenceScope[]).map((scope) =>
        this.writeScope(
          scope,
          this.list(scope).filter((entry) => entry.query.toLowerCase() !== needle)
        )
      )
    );
  }

  /** Vide l'historique : une portée précise, ou les deux par défaut. */
  public async clear(scope?: PersistenceScope): Promise<void> {
    const scopes: PersistenceScope[] = scope ? [scope] : ['user', 'workspace'];
    await Promise.all(scopes.map((target) => this.writeScope(target, [])));
  }

  // ------------------------------------------------------------------
  // Mécanique interne
  // ------------------------------------------------------------------

  /**
   * Insère une requête en tête : une entrée équivalente déjà présente est
   * retirée au préalable, ce qui réalise la promotion propre au cache LRU.
   */
  private insert(existing: RecentSearchEntry[], entry: RecentSearchEntry): RecentSearchEntry[] {
    const key = this.entryKey(entry);
    const withoutDuplicate = existing.filter((item) => this.entryKey(item) !== key);
    return [entry, ...withoutDuplicate].slice(0, this.effectiveLimit());
  }

  /**
   * Deux recherches ne se confondent que si le texte, les catégories et le
   * mode de tri coïncident.
   */
  private entryKey(entry: RecentSearchEntry): string {
    return `${entry.query.toLowerCase()}::${[...entry.types].sort().join(',')}::${entry.sortBy}`;
  }

  private effectiveLimit(): number {
    const raw = this.getLimit();
    if (!Number.isFinite(raw)) return DEFAULT_RECENT_LIMIT;
    return Math.min(MAX_RECENT_LIMIT, Math.max(1, Math.trunc(raw)));
  }

  private storeFor(scope: PersistenceScope): MementoPort {
    return scope === 'user' ? this.globalState : this.workspaceState;
  }

  private async writeScope(scope: PersistenceScope, entries: RecentSearchEntry[]): Promise<void> {
    await this.storeFor(scope).update(RECENT_SEARCHES_KEY, entries.slice(0, this.effectiveLimit()));
  }

  private normalizeEntry(raw: unknown): RecentSearchEntry | null {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const query = typeof record.query === 'string' ? record.query.trim() : '';
    if (query.length === 0) return null;

    const types = Array.isArray(record.types)
      ? record.types.filter((type): type is DiscoveryResourceType =>
          type === 'skills' || type === 'rules' || type === 'workflows' || type === 'hooks'
        )
      : [];

    const sortBy = record.sortBy;
    const validSort: SearchSortMode =
      sortBy === 'downloads' || sortBy === 'comments' || sortBy === 'rating' ? sortBy : 'relevance';

    return {
      query,
      types: types.length > 0 ? types : ['skills'],
      sortBy: validSort,
      timestamp: typeof record.timestamp === 'number' ? record.timestamp : 0,
      resultCount: typeof record.resultCount === 'number' ? record.resultCount : 0,
    };
  }
}
