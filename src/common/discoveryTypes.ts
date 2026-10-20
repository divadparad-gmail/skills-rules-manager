/**
 * Contrats de données du domaine « Découverte & Intégration » décrits aux
 * chapitres 3.2, 3.3, 3.4 et 3.5 du PRD. Ces interfaces sont partagées par les
 * modules de recherche, de réglages et de déploiement ; elles ne dépendent
 * d'aucune API VS Code afin de rester testables hors de l'hôte.
 */

import { DeployTarget, DiscoveryResourceType } from './eventTypes';

export type RegistryAuthType = 'none' | 'bearer' | 'apiKey' | 'basic' | 'customHeader';

/**
 * Point de terminaison de registre déclaré par l'utilisateur dans le réglage
 * `antigravity.skills.searchUrls` (§3.3 du PRD).
 */
export interface CustomSearchUrlConfig {
  /** Identifiant unique ou slug, par exemple « corp-internal-registry ». */
  id: string;
  /** Libellé lisible affiché sur les badges de résultats et les filtres. */
  name: string;
  /** URL du point de terminaison de recherche et d'indexation. */
  url: string;
  /** Drapeau d'activation contrôlant l'inclusion dans la diffusion parallèle. */
  enabled: boolean;
  /** Ordre de précédence (1 à 100) lors de l'agrégation multi-registres. */
  priority: number;
  /** Schéma d'authentification employé par le registre. */
  authType: RegistryAuthType;
  /** Clé de récupération du secret dans le coffre VS Code SecretStorage. */
  secretKeyRef?: string;
  /** En-têtes HTTP additionnels exigés par le registre. */
  customHeaders?: Record<string, string>;
  /** Délai d'attente par point de terminaison, exprimé en millisecondes. */
  timeoutMs: number;
  /** Catégories de ressources prises en charge par ce registre. */
  supportedTypes: DiscoveryResourceType[];
  /**
   * Portée de configuration d'où provient l'entrée. Ce champ est calculé à la
   * lecture par `getEffectiveRegistries` : il n'est jamais lu depuis la
   * configuration ni persisté, sans quoi un dépôt pourrait se déclarer
   * « utilisateur » dans son propre `.vscode/settings.json`.
   */
  origin?: RegistryOrigin;
}

/** Portée de configuration d'où provient un registre. */
export type RegistryOrigin = 'user' | 'workspace';

export type RegistryProbeStatus = 'connected' | 'unreachable' | 'unauthorized' | 'invalid_schema';

/**
 * Résultat d'une sonde de santé « Tester la connexion » sur un registre.
 */
export interface RegistryProbeResult {
  registryId: string;
  status: RegistryProbeStatus;
  latencyMs: number;
  supportedTypes: DiscoveryResourceType[];
  message: string;
}

/**
 * Métriques communautaires agrégées servant au classement hybride.
 */
export interface CommunityMetrics {
  downloads: number;
  stars: number;
  comments: number;
  rating: number;
  verified: boolean;
}

/**
 * Entrée brute telle que renvoyée par un registre distant avant normalisation.
 */
export interface RawRegistryEntry {
  id?: string;
  name?: string;
  description?: string;
  type?: string;
  url?: string;
  version?: string;
  author?: string;
  tags?: string[];
  downloads?: number;
  stars?: number;
  comments?: number;
  rating?: number;
  verified?: boolean;
  content?: string;
  [key: string]: unknown;
}

/**
 * Résultat de recherche normalisé, immuable du point de vue de la couche de
 * présentation : la vue n'en dérive que des modèles d'affichage.
 */
export interface SkillSearchResult {
  /** Identifiant canonique « <registryId>:<entryId> », stable entre deux recherches. */
  id: string;
  name: string;
  description: string;
  type: DiscoveryResourceType;
  /** Registre d'origine, affiché sous forme de badge de source. */
  registryId: string;
  registryName: string;
  url: string;
  version?: string;
  author?: string;
  tags: string[];
  metrics: CommunityMetrics;
  /** Score de pertinence sémantique normalisé entre 0 et 1. */
  semanticScore: number;
  /** Score hybride final combinant pertinence et signaux communautaires. */
  hybridScore: number;
  /** Explication générée expliquant en quoi la ressource correspond à la demande. */
  matchRationale: string;
  /** Contenu du manifeste mis en cache pour la consultation hors ligne. */
  manifest?: string;
  /** Registres supplémentaires ayant proposé la même ressource (après dédoublonnage). */
  alsoFoundIn?: string[];
}

/**
 * Critères de recherche abstraits soumis au moteur fédéré. Ils ne portent
 * aucune information de rendu.
 */
export interface SearchCriteria {
  query: string;
  types: DiscoveryResourceType[];
  sortBy: SearchSortMode;
  minRating?: number;
  verifiedOnly?: boolean;
  limit?: number;
}

export type SearchSortMode = 'relevance' | 'downloads' | 'comments' | 'rating';

/**
 * Intention extraite d'une requête en langage naturel par le moteur sémantique.
 */
export interface QueryIntent {
  /** Reformulation canonique de la demande de l'utilisateur. */
  normalizedQuery: string;
  /** Mots-clés porteurs de sens retenus pour l'appariement lexical. */
  keywords: string[];
  /** Pile technique ou cadriciel visé, lorsqu'il est identifiable. */
  techStack: string[];
  /** Contraintes opérationnelles exprimées ou déduites. */
  constraints: string[];
  /** Vrai lorsque la requête est trop ambiguë pour être traitée telle quelle. */
  ambiguous: boolean;
  /** Questions de clarification proposées lorsque la requête est ambiguë. */
  refinements: string[];
}

/**
 * Entrée de l'historique des recherches récentes (§3.7 du PRD).
 */
export interface RecentSearchEntry {
  query: string;
  types: DiscoveryResourceType[];
  sortBy: SearchSortMode;
  /** Horodatage epoch en millisecondes de la dernière exécution. */
  timestamp: number;
  resultCount: number;
}

/**
 * Compétence enregistrée dans les favoris, avec son manifeste mis en cache.
 */
export interface FavoriteSkill {
  id: string;
  name: string;
  description: string;
  type: DiscoveryResourceType;
  registryId: string;
  registryName: string;
  url: string;
  version?: string;
  /** Étiquettes personnelles ajoutées par le développeur. */
  tags: string[];
  /** Horodatage epoch de la mise en favori. */
  savedAt: number;
  /** Horodatage epoch de la dernière utilisation, pour le tri « récemment utilisés ». */
  lastUsedAt?: number;
  /** Manifeste complet mis en cache pour la consultation sans réseau. */
  manifest?: string;
}

/** Portée de persistance des favoris et de l'historique. */
export type PersistenceScope = 'user' | 'workspace';

/** Politique appliquée lorsqu'une ressource existe déjà sur la cible. */
export type ConflictPolicy = 'prompt' | 'overwrite' | 'increment';

/**
 * Demande de déploiement vers l'une des trois cibles d'intégration.
 */
export interface DeploymentRequest {
  skillId: string;
  name: string;
  type: DiscoveryResourceType;
  /** Contenu du manifeste à écrire (SKILL.md ou fichier de règle). */
  manifest: string;
  target: DeployTarget;
  conflictPolicy: ConflictPolicy;
  /** Fichiers annexes du paquet, chemins relatifs à la racine de la ressource. */
  assets?: Array<{ relativePath: string; content: string }>;
}

/**
 * Compte rendu d'un déploiement, consommé par la vue et par le bus.
 */
export interface DeploymentResult {
  success: boolean;
  target: DeployTarget;
  targetPath?: string;
  /** Vrai lorsque la cible NAS était injoignable et que le repli local a joué. */
  fellBackToLocal?: boolean;
  /** Vrai lorsqu'une version incrémentée a été créée pour éviter l'écrasement. */
  versioned?: boolean;
  error?: string;
}

/** Diagnostic de validation d'un chemin NAS (§3.5 du PRD). */
export type NasPathStatus = 'connected' | 'unreachable' | 'permission_denied' | 'not_configured';

export interface NasPathValidation {
  status: NasPathStatus;
  resolvedPath: string;
  writable: boolean;
  message: string;
}

export { DeployTarget, DiscoveryResourceType };
