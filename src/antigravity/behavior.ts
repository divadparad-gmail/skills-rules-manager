/**
 * Comportement mesuré d'Antigravity IDE : ce que l'agent charge réellement, et non ce
 * qu'annonce sa documentation (les deux divergent).
 *
 * Source unique des faits R1 à R6, vérifiés par la suite de régression
 * test/scenarios/antigravity-injection-contexte/ (voir SCENARIOS.md dans ce dossier).
 * Si la suite montre un changement de comportement, c'est ce module qu'il faut mettre à jour :
 * le scanner, l'import et le déploiement Discovery s'appuient tous sur lui.
 */
import * as fs from 'fs';
import * as path from 'path';

export const ANTIGRAVITY_TESTED_VERSION = 'Antigravity IDE 2.5.5';
export const ANTIGRAVITY_TESTED_ON = '2026-10-21';

/**
 * R6 (SC07) : dans `rules/`, un fichier sans frontmatter, ou dont le `trigger` n'est pas
 * l'une de ces valeurs exactes, est ignoré silencieusement.
 */
export const ANTIGRAVITY_RULE_TRIGGERS = ['always_on', 'model_decision', 'glob', 'manual'] as const;
export type AntigravityRuleTrigger = (typeof ANTIGRAVITY_RULE_TRIGGERS)[number];

/**
 * Statut d'une règle vis-à-vis de l'agent :
 * - active / partial : la règle s'applique (partial : certains motifs `globs` sont morts, R3) ;
 * - never-loaded : règle d'un sous-dossier du dossier ouvert, jamais chargée (R1) ;
 * - never-triggers : tous les motifs `globs` contiennent un dossier (R3) ;
 * - ignored-yaml-list : `globs` écrit en liste YAML (R4) ;
 * - ignored : frontmatter absent ou `trigger` invalide (R6).
 */
export type AntigravityRuleStatus =
  | 'active'
  | 'partial'
  | 'never-loaded'
  | 'never-triggers'
  | 'ignored-yaml-list'
  | 'ignored';

/** Vrai si une règle de ce statut est réellement lue par l'agent. */
export function isAppliedStatus(status: AntigravityRuleStatus | undefined): boolean {
  return status === undefined || status === 'active' || status === 'partial';
}

/**
 * R1 (SC08) : les règles des sous-dossiers du dossier ouvert ne sont jamais chargées,
 * ni à la lecture, ni à la modification, ni au listing.
 */
export const SUBFOLDER_RULES_LOADED = false;

/**
 * R2 (étalonnage du 2026-10-21) : les règles des dossiers parents, jusqu'à la racine du
 * dépôt Git, sont chargées avec leur trigger habituel. Seuls ces emplacements ont été vus
 * chargés. Non testés chez les parents, donc non lus : `.agents/AGENTS.md`,
 * `.agents/GEMINI.md` et l'ancien `.agent/rules/`.
 */
export const PARENT_SOUL_FILES = ['AGENTS.md', 'GEMINI.md'] as const;
export const PARENT_RULES_DIR = path.join('.agents', 'rules');

/** Garde-fou contre une arborescence anormalement profonde. */
const MAX_PARENT_LEVELS = 64;

export interface ParentRuleScan {
  /** Racine du dépôt Git, ou null si aucun dossier `.git` n'a été trouvé. */
  gitRoot: string | null;
  /** Dossiers parents à lire, du plus proche au plus lointain (racine Git comprise). */
  parentDirs: string[];
}

/**
 * Remonte depuis le dossier ouvert jusqu'à la racine du dépôt Git (dossier qui contient
 * `.git`, dossier ou fichier pour un worktree). Sans dépôt, on ne sait pas jusqu'où
 * Antigravity remonte (hypothèse non testée) : aucun parent n'est alors retenu.
 */
export function findParentRuleDirs(workspaceRoot: string): ParentRuleScan {
  const hasGit = (dir: string) => fs.existsSync(path.join(dir, '.git'));
  let current = path.resolve(workspaceRoot);
  if (hasGit(current)) return { gitRoot: current, parentDirs: [] };

  const parentDirs: string[] = [];
  for (let level = 0; level < MAX_PARENT_LEVELS; level++) {
    const parent = path.dirname(current);
    if (parent === current) break;
    parentDirs.push(parent);
    if (hasGit(parent)) return { gitRoot: parent, parentDirs };
    current = parent;
  }
  return { gitRoot: null, parentDirs: [] };
}

export interface GlobsVerdict {
  status: 'active' | 'partial' | 'never-triggers' | 'yaml-list';
  patterns: string[];
  /** Motifs qui contiennent un dossier : ils ne se déclencheront jamais (R3). */
  deadPatterns: string[];
}

/** Retire les préfixes `**\/` en tête d'un motif. */
function stripLeadingGlobstars(pattern: string): string {
  return pattern.replace(/^(\*\*[\\/])+/, '');
}

/**
 * R3 (SC02, SC03) : un motif est comparé au nom de fichier seul ; `*.ts`, `**\/*.ts` et
 * `app.ts` fonctionnent, tout motif qui garde un dossier ne se déclenche jamais.
 * R4 (SC04) : `globs` en liste YAML est rejeté silencieusement.
 */
export function validateGlobs(globs: unknown): GlobsVerdict {
  if (Array.isArray(globs)) {
    return { status: 'yaml-list', patterns: globs.map(String), deadPatterns: [] };
  }
  const patterns = String(globs ?? '')
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  const deadPatterns = patterns.filter((pattern) => /[\\/]/.test(stripLeadingGlobstars(pattern)));
  const status = patterns.length > 0 && deadPatterns.length === patterns.length
    ? 'never-triggers'
    : deadPatterns.length > 0 ? 'partial' : 'active';
  return { status, patterns, deadPatterns };
}

/** Développe les accolades d'un motif glob (`src/*.{ts,tsx}` → `src/*.ts`, `src/*.tsx`). */
export function expandBraces(pattern: string): string[] {
  const match = pattern.match(/\{([^{}]*)\}/);
  if (!match || match.index === undefined) return [pattern];
  const before = pattern.slice(0, match.index);
  const after = pattern.slice(match.index + match[0].length);
  return match[1].split(',').flatMap((option) => expandBraces(`${before}${option}${after}`));
}

export interface PathsConversion {
  trigger: 'glob' | 'model_decision' | 'always_on';
  /** Chaîne `globs` (jamais une liste), pour `trigger: glob`. */
  globs?: string;
  /** Dossiers que seul `model_decision` peut désigner (dernière partie `*` ou `**`). */
  folders: string[];
  /** Dernières parties retenues (`*.ts`, `package.json`), sans doublon. */
  fileNames: string[];
  warnings: string[];
}

/** Dossier désigné par un motif dont la dernière partie ne nomme aucun fichier (`docs/**` → `docs/`). */
function folderOf(pattern: string): string {
  const segments = pattern.split(/[\\/]/);
  const firstGlob = segments.findIndex((segment) => segment.includes('*'));
  const kept = segments.slice(0, firstGlob === -1 ? segments.length - 1 : firstGlob).filter(Boolean);
  return kept.length > 0 ? `${kept.join('/')}/` : './';
}

/**
 * Convertit les `paths:` d'une règle Claude Code en déclencheur Antigravity qui se
 * déclenche vraiment (R3, R4) : on garde la dernière partie de chaque motif, en une
 * chaîne ; un motif qui ne nomme aucun fichier (`docs/**`) impose `model_decision`.
 */
export function convertClaudePaths(paths: string[]): PathsConversion {
  const expanded = paths.map((p) => p.trim()).filter(Boolean).flatMap(expandBraces);
  if (expanded.length === 0) return { trigger: 'always_on', folders: [], fileNames: [], warnings: [] };

  const fileNames: string[] = [];
  const folders: string[] = [];
  let widened = false;
  for (const pattern of expanded) {
    const lastPart = pattern.split(/[\\/]/).pop() ?? '';
    if (lastPart === '' || lastPart === '*' || lastPart === '**') {
      const folder = folderOf(pattern);
      if (!folders.includes(folder)) folders.push(folder);
      continue;
    }
    if (/[\\/]/.test(stripLeadingGlobstars(pattern))) widened = true;
    if (!fileNames.includes(lastPart)) fileNames.push(lastPart);
  }

  if (folders.length > 0) {
    const named = [...folders, ...fileNames].map((f) => `\`${f}\``).join(', ');
    return {
      trigger: 'model_decision',
      folders,
      fileNames,
      warnings: [
        `Aucun motif de nom de fichier ne peut cibler ${named} : la règle devient « trigger: model_decision », et l'agent la lira quand la tâche concerne ces fichiers.`,
      ],
    };
  }

  const globs = fileNames.join(', ');
  const listed = fileNames.map((f) => `\`${f}\``).join(', ');
  return {
    trigger: 'glob',
    globs,
    folders: [],
    fileNames,
    warnings: widened
      ? [`Portée élargie : Antigravity ne peut pas cibler un dossier ; la règle s'appliquera à tous les fichiers ${listed} du projet.`]
      : [],
  };
}
