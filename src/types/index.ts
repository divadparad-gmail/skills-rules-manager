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
}

export interface ManagerStats {
  budgetTotal: number; // Ex: 20000 tokens
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
