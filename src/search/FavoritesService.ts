/**
 * Gestion des favoris et des compétences enregistrées (§3.4 du PRD).
 *
 * Les favoris existent dans deux portées : l'espace de travail, pour une
 * collection propre au dépôt, et la portée utilisateur, disponible partout.
 * Chaque mise en favori met également le manifeste complet en cache sur le
 * disque local, ce qui permet de consulter la fiche et de la déployer sans
 * accès réseau au registre d'origine.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  FavoriteSkill,
  PersistenceScope,
  SkillSearchResult,
} from '../common/discoveryTypes';
import { DiscoveryResourceType } from '../common/eventTypes';
import { ExtensionEventBus } from '../common/ExtensionEventBus';
import { MementoPort } from './RecentSearchesStore';
import { getUserHome } from '../utils/paths';

export const FAVORITES_KEY = 'antigravity.skills.favorites';

export type FavoritesSortMode = 'recent' | 'alphabetical' | 'category';

export interface FavoritesFilter {
  keyword?: string;
  types?: DiscoveryResourceType[];
  tags?: string[];
  sortBy?: FavoritesSortMode;
}

/** Paquet d'export, échangeable entre machines ou entre équipiers. */
export interface FavoritesBundle {
  version: 1;
  exportedAt: string;
  favorites: FavoriteSkill[];
}

export class FavoritesService {
  constructor(
    private readonly globalState: MementoPort,
    private readonly workspaceState: MementoPort,
    private readonly bus?: ExtensionEventBus,
    private readonly cacheRoot: string = path.join(getUserHome(), '.antigravity', 'saved-skills')
  ) {}

  /** Liste les favoris d'une portée, filtrés et triés. */
  public list(scope: PersistenceScope, filter: FavoritesFilter = {}): FavoriteSkill[] {
    const raw = this.storeFor(scope).get<unknown>(FAVORITES_KEY, []);
    const favorites = Array.isArray(raw)
      ? raw.map((item) => this.normalize(item)).filter((item): item is FavoriteSkill => item !== null)
      : [];

    return this.sort(this.filter(favorites, filter), filter.sortBy ?? 'recent');
  }

  /** Liste fusionnée des deux portées, sans doublon d'identifiant. */
  public listAll(filter: FavoritesFilter = {}): FavoriteSkill[] {
    const merged = new Map<string, FavoriteSkill>();
    for (const favorite of [...this.list('user', {}), ...this.list('workspace', {})]) {
      const existing = merged.get(favorite.id);
      if (!existing || favorite.savedAt > existing.savedAt) {
        merged.set(favorite.id, favorite);
      }
    }
    return this.sort(this.filter([...merged.values()], filter), filter.sortBy ?? 'recent');
  }

  public isFavorite(id: string, scope: PersistenceScope = 'user'): boolean {
    return this.list(scope, {}).some((favorite) => favorite.id === id);
  }

  /**
   * Bascule l'état de favori d'un résultat de recherche. L'ajout met le
   * manifeste en cache ; le retrait le purge.
   */
  public async toggle(
    result: SkillSearchResult,
    scope: PersistenceScope = 'user'
  ): Promise<boolean> {
    const favorited = this.isFavorite(result.id, scope);
    if (favorited) {
      await this.remove(result.id, scope);
      return false;
    }
    await this.add(result, scope);
    return true;
  }

  /** Ajoute un résultat aux favoris et met son manifeste en cache local. */
  public async add(
    result: SkillSearchResult,
    scope: PersistenceScope = 'user',
    tags: string[] = []
  ): Promise<FavoriteSkill> {
    const favorite: FavoriteSkill = {
      id: result.id,
      name: result.name,
      description: result.description,
      type: result.type,
      registryId: result.registryId,
      registryName: result.registryName,
      url: result.url,
      version: result.version,
      tags: [...new Set([...result.tags, ...tags])],
      savedAt: Date.now(),
      manifest: result.manifest,
    };

    const current = this.list(scope, {}).filter((item) => item.id !== favorite.id);
    await this.storeFor(scope).update(FAVORITES_KEY, [favorite, ...current]);

    if (favorite.manifest) {
      await this.cacheManifest(favorite);
    }

    this.bus?.publish('skill:favorite:toggled', 'discovery.panel', {
      skillId: favorite.id,
      favorited: true,
      scope,
    });

    return favorite;
  }

  /** Retire un favori et supprime son manifeste du cache hors ligne. */
  public async remove(id: string, scope: PersistenceScope = 'user'): Promise<void> {
    const current = this.list(scope, {});
    const next = current.filter((favorite) => favorite.id !== id);
    await this.storeFor(scope).update(FAVORITES_KEY, next);

    await this.purgeManifest(id);

    this.bus?.publish('skill:favorite:toggled', 'discovery.panel', {
      skillId: id,
      favorited: false,
      scope,
    });
  }

  /** Remplace les étiquettes personnelles d'un favori. */
  public async setTags(id: string, tags: string[], scope: PersistenceScope = 'user'): Promise<void> {
    const current = this.list(scope, {});
    const next = current.map((favorite) =>
      favorite.id === id ? { ...favorite, tags: [...new Set(tags)] } : favorite
    );
    await this.storeFor(scope).update(FAVORITES_KEY, next);
  }

  /** Horodate la dernière utilisation, pour le tri « récemment utilisés ». */
  public async markUsed(id: string, scope: PersistenceScope = 'user'): Promise<void> {
    const current = this.list(scope, {});
    const next = current.map((favorite) =>
      favorite.id === id ? { ...favorite, lastUsedAt: Date.now() } : favorite
    );
    await this.storeFor(scope).update(FAVORITES_KEY, next);
  }

  /**
   * Lit le manifeste d'un favori : d'abord depuis l'état persistant, puis
   * depuis le cache disque, ce qui garantit une consultation sans réseau.
   */
  public readCachedManifest(id: string): string | null {
    const favorite = this.listAll({}).find((item) => item.id === id);
    if (favorite?.manifest) return favorite.manifest;

    const cachePath = this.manifestPath(id);
    try {
      if (fs.existsSync(cachePath)) {
        return fs.readFileSync(cachePath, 'utf8');
      }
    } catch {
      // Cache illisible : la fiche reste consultable sans son manifeste.
    }
    return null;
  }

  /** Exporte une collection de favoris sous forme de paquet partageable. */
  public exportBundle(scope: PersistenceScope = 'user'): FavoritesBundle {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      favorites: this.list(scope, {}),
    };
  }

  /**
   * Importe un paquet de favoris. Les entrées déjà présentes sont conservées
   * dans leur version la plus récemment enregistrée.
   */
  public async importBundle(
    bundle: unknown,
    scope: PersistenceScope = 'user'
  ): Promise<{ imported: number; skipped: number }> {
    if (!bundle || typeof bundle !== 'object') {
      throw new Error("Le paquet de favoris est illisible : objet JSON attendu.");
    }
    const candidates = (bundle as FavoritesBundle).favorites;
    if (!Array.isArray(candidates)) {
      throw new Error("Le paquet de favoris ne contient aucune liste « favorites ».");
    }

    const current = this.list(scope, {});
    const byId = new Map(current.map((favorite) => [favorite.id, favorite]));
    let imported = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const normalized = this.normalize(candidate);
      if (!normalized) {
        skipped += 1;
        continue;
      }
      const existing = byId.get(normalized.id);
      if (existing && existing.savedAt >= normalized.savedAt) {
        skipped += 1;
        continue;
      }
      byId.set(normalized.id, normalized);
      imported += 1;
    }

    await this.storeFor(scope).update(FAVORITES_KEY, [...byId.values()]);
    return { imported, skipped };
  }

  /**
   * Compare la version enregistrée à celle publiée par le registre et signale
   * les favoris pour lesquels une mise à jour est disponible.
   */
  public findOutdated(
    remoteVersions: Map<string, string>,
    scope: PersistenceScope = 'user'
  ): Array<{ favorite: FavoriteSkill; remoteVersion: string }> {
    const outdated: Array<{ favorite: FavoriteSkill; remoteVersion: string }> = [];
    for (const favorite of this.list(scope, {})) {
      const remoteVersion = remoteVersions.get(favorite.id);
      if (!remoteVersion || !favorite.version) continue;
      if (compareVersions(remoteVersion, favorite.version) > 0) {
        outdated.push({ favorite, remoteVersion });
      }
    }
    return outdated;
  }

  // ------------------------------------------------------------------
  // Mécanique interne
  // ------------------------------------------------------------------

  private storeFor(scope: PersistenceScope): MementoPort {
    return scope === 'user' ? this.globalState : this.workspaceState;
  }

  private filter(favorites: FavoriteSkill[], filter: FavoritesFilter): FavoriteSkill[] {
    let result = favorites;

    if (filter.keyword && filter.keyword.trim().length > 0) {
      const needle = filter.keyword.trim().toLowerCase();
      result = result.filter(
        (favorite) =>
          favorite.name.toLowerCase().includes(needle) ||
          favorite.description.toLowerCase().includes(needle) ||
          favorite.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    }

    if (filter.types && filter.types.length > 0) {
      result = result.filter((favorite) => filter.types!.includes(favorite.type));
    }

    if (filter.tags && filter.tags.length > 0) {
      const wanted = filter.tags.map((tag) => tag.toLowerCase());
      result = result.filter((favorite) =>
        favorite.tags.some((tag) => wanted.includes(tag.toLowerCase()))
      );
    }

    return result;
  }

  private sort(favorites: FavoriteSkill[], mode: FavoritesSortMode): FavoriteSkill[] {
    const sorted = [...favorites];
    switch (mode) {
      case 'alphabetical':
        sorted.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        break;
      case 'category':
        sorted.sort((a, b) => {
          if (a.type !== b.type) return a.type.localeCompare(b.type);
          return a.name.localeCompare(b.name, 'fr');
        });
        break;
      case 'recent':
      default:
        sorted.sort((a, b) => (b.lastUsedAt ?? b.savedAt) - (a.lastUsedAt ?? a.savedAt));
        break;
    }
    return sorted;
  }

  private manifestPath(id: string): string {
    const safeName = id.replace(/[^A-Za-z0-9._-]/g, '_');
    return path.join(this.cacheRoot, `${safeName}.md`);
  }

  private async cacheManifest(favorite: FavoriteSkill): Promise<void> {
    if (!favorite.manifest) return;
    try {
      await fs.promises.mkdir(this.cacheRoot, { recursive: true });
      await fs.promises.writeFile(this.manifestPath(favorite.id), favorite.manifest, 'utf8');
    } catch {
      // L'échec du cache disque ne doit jamais empêcher la mise en favori.
    }
  }

  private async purgeManifest(id: string): Promise<void> {
    try {
      const cachePath = this.manifestPath(id);
      if (fs.existsSync(cachePath)) {
        await fs.promises.unlink(cachePath);
      }
    } catch {
      // Purge opportuniste : un fichier résiduel est sans conséquence.
    }
  }

  private normalize(raw: unknown): FavoriteSkill | null {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    if (id.length === 0) return null;

    const type = record.type;
    const validType: DiscoveryResourceType =
      type === 'rules' || type === 'workflows' || type === 'hooks' ? type : 'skills';

    return {
      id,
      name: typeof record.name === 'string' ? record.name : id,
      description: typeof record.description === 'string' ? record.description : '',
      type: validType,
      registryId: typeof record.registryId === 'string' ? record.registryId : 'inconnu',
      registryName: typeof record.registryName === 'string' ? record.registryName : 'Registre inconnu',
      url: typeof record.url === 'string' ? record.url : '',
      version: typeof record.version === 'string' ? record.version : undefined,
      tags: Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)) : [],
      savedAt: typeof record.savedAt === 'number' ? record.savedAt : 0,
      lastUsedAt: typeof record.lastUsedAt === 'number' ? record.lastUsedAt : undefined,
      manifest: typeof record.manifest === 'string' ? record.manifest : undefined,
    };
  }
}

/**
 * Compare deux numéros de version sémantiques. Retourne un nombre positif si
 * `a` est postérieure à `b`, négatif dans le cas inverse, zéro à égalité.
 */
export function compareVersions(a: string, b: string): number {
  const toParts = (value: string): number[] =>
    value
      .replace(/^v/i, '')
      .split(/[.\-+]/)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));

  const left = toParts(a);
  const right = toParts(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
