/**
 * Taxonomie d'événements et enveloppe de message normalisée du médiateur
 * typé central (ExtensionEventBus) décrit au chapitre 3.1 du PRD.
 *
 * Aucun composant ne détient de référence directe vers un autre : toute
 * interaction transite par un sujet (topic) publié sur le bus.
 */

export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'paused' | 'error';

export type AgentMode = 'agent' | 'architect' | 'code' | 'debug';

export type HostMode = 'antigravity-native' | 'vscode-standalone';

export type AgentRuntime = 'antigravity' | 'claude-code';

export type DeployTarget = 'local' | 'nas' | 'global';

export type DiscoveryResourceType = 'skills' | 'rules' | 'workflows' | 'hooks';

/**
 * Identifiant du composant émetteur, utilisé pour le traçage et pour éviter
 * qu'un composant ne réagisse à ses propres publications.
 */
export type EventSource =
  | 'agent.sidepanel'
  | 'artifact.renderer'
  | 'diff.reviewer'
  | 'discovery.panel'
  | 'settings.view'
  | 'statusbar'
  | 'daemon.bridge'
  | 'environment.detector'
  | 'deploy.service'
  | 'search.service'
  | 'extension.host';

/**
 * Carte exhaustive des sujets du bus associés à leur charge utile typée.
 * Toute nouvelle fonctionnalité déclare ici son contrat de message.
 */
export interface EventTopicMap {
  // --- Cycle de vie et flux d'exécution de l'agent ---
  'agent:status': { status: AgentStatus; detail?: string };
  'agent:step:progress': { stepId: string; label: string; progress: number; done: boolean };
  'agent:mode:switched': { previous: AgentMode | null; current: AgentMode };
  'agent:token:budget': { usedTokens: number; budgetTotal: number; availablePercentage: number };

  // --- Plans et artefacts ---
  'plan:created': { planId: string; title: string; stepCount: number };
  'plan:step:selected': { planId: string; stepId: string };
  'artifact:render:ready': { artifactId: string; kind: string };
  'artifact:inspection:requested': { artifactId: string };

  // --- Révision et négociation de diff ---
  'diff:stage:requested': { filePath: string; hunkCount: number };
  'diff:hunk:accepted': { filePath: string; hunkId: string };
  'diff:hunk:rejected': { filePath: string; hunkId: string; reason?: string };
  'diff:batch:applied': { filePaths: string[]; acceptedHunks: number };

  // --- Découverte et intégration de compétences ---
  'skill:search:initiated': {
    queryId: string;
    query: string;
    types: DiscoveryResourceType[];
    registryCount: number;
  };
  'skill:search:completed': {
    queryId: string;
    resultCount: number;
    durationMs: number;
    failedRegistries: string[];
  };
  'skill:favorite:toggled': { skillId: string; favorited: boolean; scope: 'user' | 'workspace' };
  'skill:deploy:started': { skillId: string; target: DeployTarget };
  'skill:deploy:completed': {
    skillId: string;
    target: DeployTarget;
    success: boolean;
    targetPath?: string;
    error?: string;
  };

  // --- Interception de privilèges et sécurité ---
  'permission:intercept:triggered': { operation: string; resource: string; requestId: string };
  'permission:user:granted': { requestId: string };
  'permission:user:denied': { requestId: string; reason?: string };

  // --- Détection d'hôte et d'environnement d'exécution ---
  'env:host:detected': { host: HostMode; score: number; overridden: boolean };
  'env:runtime:switched': { previous: AgentRuntime | null; current: AgentRuntime };
  'daemon:health:ping': { alive: boolean; latencyMs: number };
}

export type EventTopic = keyof EventTopicMap;

/**
 * Enveloppe standardisée imposée à chaque publication (§3.1 du PRD).
 */
export interface EventEnvelope<T extends EventTopic = EventTopic> {
  /** Identifiant unique de l'événement, utilisé pour le traçage et l'idempotence. */
  id: string;
  /** Date de génération de l'événement au format ISO 8601. */
  timestamp: string;
  /** Sujet granulaire de l'événement. */
  topic: T;
  /** Composant émetteur à l'origine de la publication. */
  source: EventSource;
  /** Identifiant de corrélation facultatif reliant une réponse à sa requête. */
  correlationId?: string;
  /** Charge utile fortement typée, spécifique au sujet publié. */
  payload: EventTopicMap[T];
}

export type EventHandler<T extends EventTopic> = (
  envelope: EventEnvelope<T>
) => void | Promise<void>;

/**
 * Événement rejeté en file de lettres mortes : soit la charge utile était
 * malformée, soit l'abonné a levé une exception non interceptée.
 */
export interface DeadLetterEntry {
  envelope: EventEnvelope | { topic: string; [key: string]: unknown };
  reason: string;
  occurredAt: string;
}

/** Ensemble des sujets déclarés, utilisé pour valider une enveloppe entrante. */
export const KNOWN_TOPICS: readonly EventTopic[] = [
  'agent:status',
  'agent:step:progress',
  'agent:mode:switched',
  'agent:token:budget',
  'plan:created',
  'plan:step:selected',
  'artifact:render:ready',
  'artifact:inspection:requested',
  'diff:stage:requested',
  'diff:hunk:accepted',
  'diff:hunk:rejected',
  'diff:batch:applied',
  'skill:search:initiated',
  'skill:search:completed',
  'skill:favorite:toggled',
  'skill:deploy:started',
  'skill:deploy:completed',
  'permission:intercept:triggered',
  'permission:user:granted',
  'permission:user:denied',
  'env:host:detected',
  'env:runtime:switched',
  'daemon:health:ping',
] as const;
