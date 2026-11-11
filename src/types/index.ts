/**
 * Types stricts pour l'extension "Skills & Rules Manager"
 * Aucune utilisation de 'any' n'est autorisée.
 */

import type { PresentationBanc } from '../ui/bancEssaiPresentation';

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
  /**
   * Antigravity : l'une des copies actives est une règle `glob` ou `manual`. Elle ne coûte rien au
   * démarrage, mais les deux copies sont injectées quand elles s'appliquent.
   */
  dynamicCost?: boolean;
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
    /** Règle Claude Code au frontmatter jugé invalide (src/claude/ruleFrontmatter.ts) : permanente, `paths` ignorés. */
    claudeYamlInvalid?: boolean;
    /** Règle Claude Code : motifs de `paths` avec un `[` sans `]` qui le suive, qui ne correspondent à rien. */
    claudeUnmatchablePatterns?: string[];
    /** Skill Claude Code : longueur de `description` et `when_to_use` réunis, quand elle dépasse 1 536 caractères et que la ligne est coupée. */
    claudeDescriptionOriginalLength?: number;
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
    /**
     * Coupe à la fin de ligne (profil 2.6.0) appliquée à un corps coupé : `line-end`, observé sur deux
     * fichiers, ou `byte-fallback` sans fin de ligne avant la limite (non vérifié). Absent en coupe à l'octet.
     */
    truncationRule?: 'line-end' | 'byte-fallback';
    /** Skill intégré d'Antigravity (F7), toujours présent et impossible à retirer. */
    builtin?: boolean;
    /** Skill d'un ancien emplacement, documenté mais dont le chargement n'a pas été vérifié. */
    legacyLocation?: boolean;
    /** Profil d'Antigravity IDE (ex. « 2.6.0 ») qui ne lit pas l'emplacement de ce skill (statut `not-read`). */
    notReadBy?: string;
    /** Profil d'Antigravity IDE (ex. « 2.5.5 ») qui n'a pas vérifié le chargement de cette âme globale, comptée par prudence. */
    unverifiedIn?: string;
    /** Règle d'un plugin (global ou du projet) : comptée par prudence, chargement non vérifié dans aucune version (D-19). */
    unverifiedPluginRule?: boolean;
    /**
     * Règle d'une variante (`.agent`, `_agent`, `_agents`) en profil 2.6.0 dont le cas n'a pas été
     * vérifié par la sonde (phase 2c) : `cohabitation` quand `.agents/` existe aussi, `non-always-on`
     * quand son trigger n'est pas `always_on`, ou `both` quand les deux s'appliquent. Comptée par prudence.
     */
    unverifiedVariantRule?: 'cohabitation' | 'non-always-on' | 'both';
    /** Skill de plugin listé une seule fois, sans section de plugin (profil 2.6.0). Absent en 2.5.5 (deux fois). */
    pluginListedOnce?: boolean;
    /**
     * Workflow Markdown d'Antigravity (`<nom>.md`, profil 2.6.0), à distinguer des skills `wf-*` de type
     * `workflow`. Lecture seule : ni bascule ni suppression depuis le tableau de bord.
     */
    markdownWorkflow?: boolean;
    /**
     * Emplacement d'un workflow Markdown : `workspace` (`.agents/workflows/`, injection à l'invocation
     * observée), `global` (`~/.gemini/config/global_workflows/`, injection déduite), `workspace-variant`
     * (`.agent`, `_agent` ou `_agents`, non vérifié) ou `ignored` (emplacement que l'IDE ne lit pas).
     */
    markdownWorkflowSource?: 'workspace' | 'global' | 'workspace-variant' | 'ignored';
    /** Tokens comptés dans le budget « Other Customizations » (nom et description d'un workflow Markdown). */
    personalizationTokenCount?: number;
    /** Nom brut d'un skill (sans préfixe de plugin), utilisé pour détecter les doublons. */
    rawId?: string;
    /** Sous-dossier (relatif au projet) d'une règle imbriquée, jamais chargée par Antigravity (R1). */
    directoryScope?: string;
    /**
     * Statut d'une ressource Antigravity vis-à-vis de l'agent (voir src/antigravity/behavior.ts).
     * `not-read` : skill d'un emplacement que la version du profil ne lit pas (ancien emplacement
     * global en 2.6.0). `glob-no-effect` : règle glob que la version du profil n'injecte jamais (2.6.0).
     */
    antigravityStatus?: 'active' | 'partial' | 'never-loaded' | 'never-triggers' | 'ignored-yaml-list' | 'ignored' | 'not-read' | 'glob-no-effect';
    /** Profil d'Antigravity IDE (ex. « 2.6.0 ») qui n'injecte jamais cette règle glob (statut `glob-no-effect`). */
    noEffectIn?: string;
    /** Motifs `globs` qui contiennent un dossier et ne se déclencheront jamais (R3). */
    deadGlobs?: string[];
    /** Motifs `globs` qui se déclenchent (R3), tels qu'écrits dans le frontmatter. */
    globPatterns?: string[];
    /** Antigravity : dépassement de la taille recommandée pour ce type de fichier (lot A3). */
    sizeAdvice?: AntigravitySizeAdvice;
    /** Antigravity : fichiers annexes d'un skill longs ou sans table des matières (information). */
    annexNotes?: SkillAnnexNote[];
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

/** Dépassement de la taille recommandée (voir SIZE_RECOMMENDATIONS dans src/antigravity/behavior.ts). */
export interface AntigravitySizeAdvice {
  kind: 'permanent' | 'glob' | 'model_decision' | 'skill';
  /** Lignes du corps, frontmatter exclu. */
  lines: number;
  maxLines: number;
  tokens?: number;
  maxTokens?: number;
}

/** Fichier annexe d'un skill à signaler, à titre d'information. */
export interface SkillAnnexNote {
  /** Chemin relatif au dossier du skill, avec des `/`. */
  file: string;
  lines: number;
  /** Plus de 300 lignes. */
  tooLong: boolean;
  /** Plus de 100 lignes sans table des matières (heuristique). */
  missingToc: boolean;
}

/** Règle `glob` réinjectée avec les autres règles d'un même motif. */
export interface GlobStackRule {
  id: string;
  name: string;
  scope: ResourceScope;
  inheritedFrom?: string;
  /** Tokens du corps, injectés à chaque fichier correspondant. */
  tokensPerFile: number;
}

/** Règles `glob` actives qui s'empilent sur un même motif de nom de fichier. */
export interface GlobStack {
  /**
   * Motifs sans préfixe `**\/` (`**\/*.ts` et `*.ts` désignent les mêmes fichiers, R3), triés.
   * Plusieurs motifs quand ils déclenchent exactement les mêmes règles.
   */
  patterns: string[];
  rules: GlobStackRule[];
  /** Somme des corps des règles du motif. */
  tokensPerFile: number;
  /** En-tête de réinjection, ajouté une fois par opération. */
  headerTokens: number;
  /** Motifs plus larges qui correspondent aussi à ces fichiers (`app.ts` : `*.ts`). */
  alsoMatchedBy: string[];
}

/** Dépassement du budget de l'âme et des règles permanentes (documentation, non testé). */
export interface BudgetOverflow {
  totalTokens: number;
  budget: number;
  /** Fichiers permanents, du plus gros au plus petit, jusqu'à repasser sous le budget. */
  pointerCandidates: Array<{ id: string; name: string; scope: ResourceScope; tokens: number }>;
}

/** Hook déclaré dans un `hooks.json` (format documenté, voir parseHooksConfig). */
export interface AntigravityHook {
  name: string;
  enabled: boolean;
  events: string[];
  unknownKeys: string[];
  handlerCount: number;
  /** Événements à coût dynamique : SessionStart, PreInvocation, PostInvocation. */
  dynamicEvents: string[];
}

/** Lecture d'un fichier de hooks d'Antigravity, sans jamais exécuter ses commandes. */
export interface HooksFileReading {
  scope: 'global' | 'local';
  path: string;
  status: 'absent' | 'invalid-json' | 'unrecognized-format' | 'ok';
  hooks: AntigravityHook[];
}

/** Coûts qu'Antigravity ajoute en cours de session, hors jauge (lot A3). */
export interface AntigravityDynamicCosts {
  globStacks: GlobStack[];
  budgetOverflow: BudgetOverflow | null;
  /** Fichiers de hooks du projet et global : 0 token au démarrage, coût dynamique possible. */
  hooks: HooksFileReading[];
  /** Session ordinaire retenue pour chiffrer le coût d'une règle `glob` sur une session. */
  ordinarySession: { reads: number; writes: number };
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
  /**
   * D-10 (Antigravity IDE 2.6.0) : plafond de 20 000 tokens du budget « Other Customizations »
   * (skills et MCP), observé dans le panneau Settings d'Antigravity IDE 2.6.0 le 2026-10-28 ; les workflows
   * Markdown y figurent aussi (sonde du 2026-11-02, Antigravity IDE 2.6.0).
   * Omis lorsque le profil ne chiffre pas ce budget (profil 2.5.5) ou en mode Claude Code.
   */
  personalizationBudgetTotal?: number;
  /**
   * D-10 (Antigravity IDE 2.6.0) : cumul `skillsGlobal + skillsLocal + mcpGlobal + mcpLocal`,
   * skills intégrés et doublons compris, plus `personalizationWorkflowTokens`. Omis en profil 2.5.5
   * et en mode Claude Code.
   */
  personalizationUsedTokensTotal?: number;
  /**
   * D-10 (Antigravity IDE 2.6.0) : pourcentage disponible sur `personalizationBudgetTotal`.
   * Omis en profil 2.5.5 et en mode Claude Code.
   */
  personalizationAvailablePercentage?: number;
  /**
   * Antigravity IDE 2.6.0 : part des workflows Markdown dans `personalizationUsedTokensTotal` (nom et
   * description de chacun). Omis en profil 2.5.5 et en mode Claude Code.
   */
  personalizationWorkflowTokens?: number;
  soulGlobal: TokenCategoryStat;
  soulLocal: TokenCategoryStat;
  rulesGlobal: TokenCategoryStat;
  rulesLocal: TokenCategoryStat;
  skillsGlobal: TokenCategoryStat;
  skillsLocal: TokenCategoryStat;
  mcpGlobal: TokenCategoryStat;
  mcpLocal: TokenCategoryStat;
  duplicateStats?: DuplicateStats;
  /** Antigravity : empilement des règles `glob` et dépassement du budget, sans effet sur les totaux. */
  dynamicCosts?: AntigravityDynamicCosts;
}

export interface NasStatus {
  online: boolean;
  /** Faux lorsqu'aucun chemin de catalogue n'est renseigné (`skillsManager.nasPath` vide). */
  configured?: boolean;
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
  /**
   * Profil de comportement d'Antigravity (src/antigravity/behavior.ts) : version et date des tests
   * qui fondent les badges ; origine du choix (réglage forcé, structure détectée ou repli sur la
   * version actuelle, src/antigravity/behaviorProfile.ts) et raison en une phrase, sans chemin absolu.
   */
  antigravityBehavior?: { version: string; testedOn: string; source: 'forced' | 'detected' | 'fallback'; reason: string };
  userHome?: string;
  isDebugTiming?: boolean;
  lastTimingLog?: string | null;
  timingHistory?: string[];
  /** Bandeau du banc d'essai, affiché tant que le banc est déployé ou qu'une opération est inachevée. */
  bancEssai?: PresentationBanc;
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
