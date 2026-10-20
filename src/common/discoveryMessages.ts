/**
 * Contrat de messages entre l'hôte d'extension et la vue Découverte.
 *
 * La vue n'accède jamais au réseau ni au système de fichiers : elle émet des
 * intentions et reçoit des modèles d'affichage déjà calculés. Les deux
 * directions sont des unions discriminées, ce qui rend tout message non prévu
 * détectable à la compilation.
 */

import {
  CustomSearchUrlConfig,
  FavoriteSkill,
  NasPathValidation,
  RecentSearchEntry,
  RegistryProbeResult,
  SearchSortMode,
  SkillSearchResult,
} from './discoveryTypes';
import { AgentRuntime, DeployTarget, DiscoveryResourceType, HostMode } from './eventTypes';

/** État complet servi à la vue lors de son hydratation. */
export interface DiscoveryViewState {
  host: HostMode;
  hostScore: number;
  hostOverridden: boolean;
  runtime: AgentRuntime;
  registries: CustomSearchUrlConfig[];
  defaultRegistryEnabled: boolean;
  favorites: FavoriteSkill[];
  recentSearches: RecentSearchEntry[];
  nasPath: string;
  nasConfigured: boolean;
  geminiConfigured: boolean;
}

/** Messages émis par la vue vers l'hôte d'extension. */
export type DiscoveryWebviewMessage =
  | { type: 'discovery:ready' }
  | {
      type: 'discovery:search';
      payload: {
        query: string;
        types: DiscoveryResourceType[];
        sortBy: SearchSortMode;
        minRating?: number;
        verifiedOnly?: boolean;
      };
    }
  | { type: 'discovery:suggest'; payload: { prefix: string } }
  | { type: 'discovery:history:remove'; payload: { query: string } }
  | { type: 'discovery:history:clear' }
  | { type: 'discovery:favorite:toggle'; payload: { result: SkillSearchResult } }
  | { type: 'discovery:favorite:remove'; payload: { id: string } }
  | { type: 'discovery:favorites:export' }
  | { type: 'discovery:favorites:import' }
  | {
      type: 'discovery:deploy';
      payload: { id: string; target: DeployTarget; fromFavorites?: boolean };
    }
  | { type: 'discovery:registry:add'; payload: { registry: Partial<CustomSearchUrlConfig> } }
  | {
      type: 'discovery:registry:update';
      payload: { id: string; changes: Partial<CustomSearchUrlConfig> };
    }
  | { type: 'discovery:registry:remove'; payload: { id: string } }
  | { type: 'discovery:registry:toggle'; payload: { id: string; enabled: boolean } }
  | { type: 'discovery:registry:reorder'; payload: { orderedIds: string[] } }
  | { type: 'discovery:registry:test'; payload: { id: string } }
  | { type: 'discovery:registry:setSecret'; payload: { id: string } }
  | { type: 'discovery:nas:browse' }
  | { type: 'discovery:nas:validate' }
  | { type: 'discovery:gemini:setKey' }
  | { type: 'discovery:env:override' }
  | { type: 'discovery:env:diagnostics' };

/** Messages émis par l'hôte d'extension vers la vue. */
export type DiscoveryExtensionMessage =
  | { type: 'discovery:state'; payload: DiscoveryViewState }
  | { type: 'discovery:searching'; payload: { query: string } }
  | {
      type: 'discovery:results';
      payload: {
        queryId: string;
        results: SkillSearchResult[];
        failures: Array<{ registryId: string; registryName: string; reason: string }>;
        durationMs: number;
        refinements: string[];
      };
    }
  | { type: 'discovery:suggestions'; payload: { entries: RecentSearchEntry[] } }
  | { type: 'discovery:favorites'; payload: { favorites: FavoriteSkill[] } }
  | { type: 'discovery:history'; payload: { entries: RecentSearchEntry[] } }
  | { type: 'discovery:registries'; payload: { registries: CustomSearchUrlConfig[] } }
  | { type: 'discovery:registry:probe'; payload: RegistryProbeResult }
  | { type: 'discovery:nas:status'; payload: NasPathValidation }
  | {
      type: 'discovery:notification';
      payload: { level: 'info' | 'warning' | 'error'; message: string };
    }
  | { type: 'discovery:focusSearch' };
