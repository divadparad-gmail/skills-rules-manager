/**
 * Types stricts pour l'extension "Skills & Rules Manager"
 * Aucune utilisation de 'any' n'est autorisée.
 */

export type ResourceType = 'soul' | 'skill' | 'workflow' | 'rule';

export type ResourceScope = 'nas' | 'global' | 'local';

export type TargetTool = 'antigravity' | 'claude-code';

export type SyncStatus = 'synced' | 'modified' | 'local_only' | 'nas_offline';

export interface DuplicateInfo {
  hasDuplicate: boolean;
  duplicateScope: 'global' | 'local';
  duplicatePath: string;
  isTwinEnabled: boolean;
  bothEnabled: boolean;
  isIdentical: boolean;
  wastedTokens: number;
  twinCharCount?: number;
  twinTokenCount?: number;
  twinLineCount?: number;
  twinMtimeMs?: number;
  twinSyncStatus?: SyncStatus;
}

export interface DuplicateStats {
  totalDuplicates: number;
  activeDuplicates: number;
  totalWastedTokens: number;
}

export interface ResourceItem {
  id: string;
  name: string;
  description: string;
  type: ResourceType;
  scope: ResourceScope;
  enabled: boolean;
  path: string;
  targetTool: TargetTool;
  isFolder: boolean;
  charCount?: number;
  tokenCount?: number;
  lineCount?: number;
  syncStatus?: SyncStatus;
  mtimeMs?: number;
  metadata?: {
    tags?: string[];
    version?: string;
    hasDisabledSuffix?: boolean;
    excludedInJson?: boolean;
    isSoul?: boolean;
    locked?: boolean;
    isConditional?: boolean;
    /** Règle Antigravity écartée par l'agent (frontmatter absent ou trigger non reconnu). */
    ignoredByAgent?: boolean;
    /** Défauts de frontmatter d'une règle Antigravity (voir AntigravityRuleIssue). */
    ruleIssues?: string[];
    /** Valeur de trigger reconnue d'une règle Antigravity. */
    trigger?: string;
    /** Taille en octets UTF-8 du corps sans frontmatter, inclusions @[label](path) développées (Antigravity). */
    byteSize?: number;
    /** Tokens injectés au démarrage par Antigravity (formats F1 à F4 de src/antigravity/behavior.ts). */
    bootTokenCount?: number;
    /** Caractères injectés au démarrage par Antigravity. */
    bootCharCount?: number;
    /** Octets coupés par Antigravity au-delà de 24 000 octets de corps (absent sans troncature). */
    truncatedBytes?: number;
    /** Tokens de la partie coupée, jamais lue par l'agent. */
    lostTokens?: number;
    /** Skill intégré d'Antigravity (F7), toujours présent et impossible à retirer. */
    builtin?: boolean;
    /** Skill d'un ancien emplacement, documenté mais dont le chargement n'a pas été vérifié. */
    legacyLocation?: boolean;
    /** Nom brut d'un skill (sans préfixe de plugin), utilisé pour détecter les doublons. */
    rawId?: string;
    /** Sous-dossier (relatif au projet) d'une règle imbriquée, jamais chargée par Antigravity (R1). */
    directoryScope?: string;
    /** Statut d'une règle Antigravity vis-à-vis de l'agent (voir src/antigravity/behavior.ts). */
    antigravityStatus?: 'active' | 'partial' | 'never-loaded' | 'never-triggers' | 'ignored-yaml-list' | 'ignored';
    /** Motifs `globs` qui contiennent un dossier et ne se déclencheront jamais (R3). */
    deadGlobs?: string[];
    /** Dossier parent (relatif au projet, ex. « ../.. ») d'où la règle est héritée (R2). */
    inheritedFrom?: string;
    /** Règle déclarée par .agents/rules.json plutôt que trouvée dans .agents/rules/. */
    fromRulesJson?: boolean;
    pluginName?: string;
    warningSizeExceeded?: boolean;
    warningLinesExceeded?: boolean;
    warningMcpExceeded?: boolean;
    warningNoDescription?: boolean;
    duplicateInfo?: DuplicateInfo;
    isScenarioFixture?: boolean;
    scenario_fixture?: boolean;
  };
}

export interface WorkspaceContext {
  hasWorkspace: boolean;
  workspacePath: string | null;
  tool: TargetTool;
  agentsDir: string | null;
  claudeDir: string | null;
  hasClaudeMd: boolean;
  isAntigravityHost?: boolean;
}

export interface TokenCategoryStat {
  type: 'soul' | 'rule' | 'skill' | 'mcp';
  scope: 'global' | 'local';
  activeCount: number;
  totalCount: number;
  charCount: number;
  tokenCount: number;
  percentage: number;
  directoryPath: string;
  permanentCount?: number;
  conditionalCount?: number;
  conditionalTokenCount?: number;
  warningCount?: number;
  /** Éléments actifs hérités des dossiers parents (Antigravity, R2), compris dans activeCount. */
  inheritedCount?: number;
  /**
   * Antigravity : tokens des en-têtes injectés qui n'appartiennent à aucune carte (index des
   * règles conditionnelles, index des skills, sections de plugin), compris dans tokenCount.
   */
  overheadTokens?: number;
  /** Antigravity : règles `model_decision` chargées, qui imposent l'en-tête F2 de l'index. */
  conditionalIndexCount?: number;
  /** Antigravity : éléments tronqués à 24 000 octets et tokens perdus. */
  truncatedCount?: number;
  lostTokens?: number;
  /** Antigravity : détail par serveur MCP (infobulle de la jauge). */
  mcpServers?: McpServerStat[];
}

/** Coût au démarrage d'un serveur MCP sous Antigravity (format F8). */
export interface McpServerStat {
  name: string;
  /** `unsupported` : serveur distant sans `serverUrl` (url ou httpUrl), ignoré par Antigravity. */
  status: 'active' | 'disabled' | 'unsupported';
  /** Nombre d'outils listés, ou null si la liste est inconnue (pas de cache d'Antigravity). */
  toolCount: number | null;
  tokenCount: number;
}

/** Résultat de la remontée vers les dossiers parents (Antigravity, R2). */
export interface AntigravityParentsInfo {
  /** Faux sans dépôt Git : l'héritage des dossiers parents n'est alors pas vérifié. */
  gitRootFound: boolean;
  parentDirs: string[];
}

export interface ManagerStats {
  budgetTotal: number; // Ex: 20000 tokens
  /**
   * Vrai sous Antigravity : le budget de 20 000 tokens ne couvre que l'âme et les règles,
   * les skills et les MCP relevant d'un budget de personnalisation distinct.
   */
  budgetExcludesPersonalization?: boolean;
  usedTokensTotal: number;
  availablePercentage: number;
  soulGlobal: TokenCategoryStat;
  soulLocal: TokenCategoryStat;
  rulesGlobal: TokenCategoryStat;
  rulesLocal: TokenCategoryStat;
  skillsGlobal: TokenCategoryStat;
  skillsLocal: TokenCategoryStat;
  mcpGlobal: TokenCategoryStat;
  mcpLocal: TokenCategoryStat;
  duplicateStats?: DuplicateStats;
}

export interface NasStatus {
  online: boolean;
  path: string;
  checkedAt: number;
  error?: string;
}

export interface ManagerFullState {
  nasStatus: NasStatus;
  nasResources: ResourceItem[];
  globalResources: ResourceItem[];
  localResources: ResourceItem[];
  workspace: WorkspaceContext;
  stats: ManagerStats;
  isDashboardOpen: boolean;
  isCheatSheetOpen?: boolean;
  /** Remontée vers les dossiers parents (mode Antigravity seulement). */
  antigravityParents?: AntigravityParentsInfo;
  /** Version d'Antigravity et date des tests qui fondent les badges (src/antigravity/behavior.ts). */
  antigravityBehavior?: { version: string; testedOn: string };
  userHome?: string;
  isDebugTiming?: boolean;
  lastTimingLog?: string | null;
  timingHistory?: string[];
}

// --------------------------------------------------------------------------
// Messages Webview <--> Extension (Discriminated Unions)
// --------------------------------------------------------------------------

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | {
      type: 'toggle';
      payload: {
        id: string;
        scope: ResourceScope;
        targetState: boolean;
        type: ResourceType;
        path: string;
      };
    }
  | {
      type: 'import';
      payload: {
        item: ResourceItem;
        destinationScope: 'global' | 'local';
      };
    }
  | {
      type: 'disableAllWorkflows';
      payload: {
        scope: ResourceScope;
      };
    }
  | {
      type: 'enableAllSkills';
      payload: {
        scope: ResourceScope;
      };
    }
  | {
      type: 'bulkToggle';
      payload: {
        targetType: 'workflow' | 'skill' | 'rule';
        scope: ResourceScope;
        targetState?: boolean;
      };
    }
  | { type: 'openDashboard' }
  | { type: 'toggleDashboard' }
  | {
      type: 'openFile';
      payload: {
        path: string;
      };
    }
  | {
      type: 'compareDuplicate';
      payload: {
        globalPath: string;
        localPath: string;
        title?: string;
      };
    }
  | {
      type: 'openInExplorer';
      payload: {
        path: string;
      };
    }
  | {
      type: 'allowUncHost';
      payload?: {
        path?: string;
      };
    }
  | {
      type: 'delete';
      payload: {
        item: ResourceItem;
      };
    }
  | {
      type: 'switchTool';
      payload?: {
        tool?: TargetTool;
      };
    }
  | { type: 'browseNasPath' }
  | { type: 'editNasPath' }
  | {
      type: 'openCheatSheet';
      payload?: {
        defaultTab?: TargetTool;
      };
    }
  | {
      type: 'toggleCheatSheet';
      payload?: {
        defaultTab?: TargetTool;
      };
    }
  | { type: 'closeCheatSheet' }
  | {
      type: 'deployScenario';
      payload?: {
        target?: 'antigravity' | 'claude-code' | 'all';
      };
    }
  | { type: 'cleanScenarios' }
  | {
      type: 'toggleDebugTiming';
      payload?: {
        enabled?: boolean;
      };
    }
  | { type: 'clearTimingLogs' };

export type ExtensionMessage =
  | {
      type: 'stateUpdate';
      payload: ManagerFullState;
    }
  | {
      type: 'notification';
      payload: {
        level: 'info' | 'warning' | 'error';
        message: string;
      };
    }
  | {
      type: 'toggleResult';
      payload: {
        success: boolean;
        id: string;
        newState: boolean;
        error?: string;
      };
    }
  | {
      type: 'importResult';
      payload: {
        success: boolean;
        id: string;
        destinationScope: ResourceScope;
        error?: string;
      };
    };
