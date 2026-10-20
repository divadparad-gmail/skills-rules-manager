/**
 * Classement hybride des résultats de recherche (§3.2 du PRD).
 *
 * Le score final combine la pertinence sémantique issue du moteur d'intention
 * et les signaux communautaires — téléchargements, étoiles, volume de
 * commentaires et badge de vérification. Les métriques brutes sont d'abord
 * normalisées à l'échelle du lot : un registre interne comptant quelques
 * dizaines de téléchargements ne doit pas être écrasé par un hub public.
 */

import {
  CommunityMetrics,
  SearchCriteria,
  SearchSortMode,
  SkillSearchResult,
} from '../common/discoveryTypes';

/** Pondérations du score hybride, par mode de tri. */
const WEIGHTS: Record<SearchSortMode, { semantic: number; downloads: number; comments: number; rating: number }> = {
  relevance: { semantic: 0.65, downloads: 0.15, comments: 0.08, rating: 0.12 },
  downloads: { semantic: 0.25, downloads: 0.55, comments: 0.08, rating: 0.12 },
  comments: { semantic: 0.25, downloads: 0.1, comments: 0.53, rating: 0.12 },
  rating: { semantic: 0.25, downloads: 0.1, comments: 0.08, rating: 0.57 },
};

/** Bonification appliquée aux ressources portant un badge de vérification. */
const VERIFIED_BONUS = 0.05;

export class RankingEngine {
  /**
   * Calcule le score hybride de chaque résultat, applique les filtres de
   * qualité puis trie la liste. La liste retournée est une nouvelle instance :
   * les modèles de vue restent immuables du point de vue de l'appelant.
   */
  public static rank(results: SkillSearchResult[], criteria: SearchCriteria): SkillSearchResult[] {
    if (results.length === 0) return [];

    const filtered = results.filter((result) => this.passesFilters(result, criteria));
    if (filtered.length === 0) return [];

    const maxDownloads = Math.max(...filtered.map((r) => r.metrics.downloads), 0);
    const maxComments = Math.max(...filtered.map((r) => r.metrics.comments), 0);
    const weights = WEIGHTS[criteria.sortBy] ?? WEIGHTS.relevance;

    const scored = filtered.map((result) => {
      const normalized = this.normalizeMetrics(result.metrics, maxDownloads, maxComments);
      const base =
        weights.semantic * clamp01(result.semanticScore) +
        weights.downloads * normalized.downloads +
        weights.comments * normalized.comments +
        weights.rating * normalized.rating;
      const hybridScore = clamp01(base + (result.metrics.verified ? VERIFIED_BONUS : 0));
      return { ...result, hybridScore };
    });

    scored.sort((a, b) => {
      // Un mode de tri explicite prime sur le score hybride pour le critère
      // qu'il désigne : l'utilisateur qui demande « le plus téléchargé »
      // attend cet ordre, non une pondération.
      switch (criteria.sortBy) {
        case 'downloads':
          if (b.metrics.downloads !== a.metrics.downloads) {
            return b.metrics.downloads - a.metrics.downloads;
          }
          break;
        case 'comments':
          if (b.metrics.comments !== a.metrics.comments) {
            return b.metrics.comments - a.metrics.comments;
          }
          break;
        case 'rating':
          if (b.metrics.rating !== a.metrics.rating) {
            return b.metrics.rating - a.metrics.rating;
          }
          break;
        default:
          break;
      }

      if (b.hybridScore !== a.hybridScore) return b.hybridScore - a.hybridScore;
      return a.name.localeCompare(b.name, 'fr');
    });

    const limit = criteria.limit && criteria.limit > 0 ? criteria.limit : scored.length;
    return scored.slice(0, limit);
  }

  /**
   * Applique les filtres de qualité : catégorie demandée, note minimale et
   * restriction aux ressources vérifiées.
   */
  private static passesFilters(result: SkillSearchResult, criteria: SearchCriteria): boolean {
    if (criteria.types.length > 0 && !criteria.types.includes(result.type)) {
      return false;
    }
    if (typeof criteria.minRating === 'number' && result.metrics.rating < criteria.minRating) {
      return false;
    }
    if (criteria.verifiedOnly === true && !result.metrics.verified) {
      return false;
    }
    return true;
  }

  /**
   * Normalise les métriques communautaires. Les volumes suivent une échelle
   * logarithmique : l'écart entre 10 et 100 téléchargements est plus
   * significatif que celui entre 10 000 et 10 090.
   */
  private static normalizeMetrics(
    metrics: CommunityMetrics,
    maxDownloads: number,
    maxComments: number
  ): { downloads: number; comments: number; rating: number } {
    return {
      downloads: logNormalize(metrics.downloads, maxDownloads),
      comments: logNormalize(metrics.comments, maxComments),
      // Les notes sont exprimées sur cinq étoiles.
      rating: clamp01(metrics.rating / 5),
    };
  }
}

/** Normalisation logarithmique bornée entre 0 et 1. */
export function logNormalize(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(max) || max <= 0) return 0;
  return clamp01(Math.log10(1 + value) / Math.log10(1 + max));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
