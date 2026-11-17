import * as path from 'path';
import type { ManagerFullState, ResourceItem } from '../types';
import { claudeAutoMemoryLocation, ClaudeGitEntry } from '../services/claudeAutoMemory';
import { CLAUDE_IMPORT_NOT_CONSULTED, isClaudePathInside } from './memoryImports';

export type { ClaudeGitEntry };

/**
 * Claude Code : les fichiers de mémoire que les motifs communs des observateurs (WATCHER_PATTERNS,
 * src/extension.ts, inchangés : décision Q11) ne couvrent pas. La liste vient de l'état scanné ; le seul
 * accès aux fichiers, la recherche du `.git` pour l'emplacement de MEMORY.md, passe par un port. Cet
 * emplacement est calculé par la fonction de la mémoire automatique (claudeAutoMemoryLocation), sans copie.
 *
 * Les cibles DANS l'espace de travail :
 * - le CLAUDE.local.md du dossier de travail, observé même absent (sa création change le compte, et exclut
 *   AGENTS.md) ;
 * - les fichiers importés par la mémoire du niveau projet (projet, CLAUDE.local.md, parents, AGENTS.md),
 *   situés dans le dossier de travail, chargés ou non (cinquième saut, plus de 4 Mio), sauf un import non
 *   consulté.
 * Ce que les motifs communs couvrent déjà n'en est pas (CLAUDE.md, AGENTS.md, GEMINI.md et tout ce qui est
 * sous .claude/, .agents/ ou .agent/, réglages du projet compris).
 *
 * Les cibles HORS de l'espace de travail :
 * - les fichiers de mémoire des dossiers parents (CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md, AGENTS.md,
 *   .claude/AGENTS.md), seulement s'ils existent (une carte), AGENTS.md ignoré compris ;
 * - les fichiers importés situés hors de l'espace, d'un parent ou du projet, chargés ou non, s'ils existent,
 *   sauf un import non consulté (cartes « chemin-reseau » et « hors-perimetre ») ;
 * - le CLAUDE.md global et ses imports, s'ils existent ;
 * - MEMORY.md, à l'emplacement calculé comme la mémoire automatique (racine Git trouvée en remontant, sinon
 *   le dossier de travail), même absent ; aucune cible quand l'emplacement n'est pas déterminé ou que la
 *   mémoire automatique est désactivée ;
 * - le settings.json du profil (autoMemoryEnabled, Project instructions), même absent.
 * MEMORY.md et settings.json ne sont des cibles que si l'état porte la ligne de la mémoire automatique : c'est
 * la marque d'un profil lu pour cet espace (StateManager la calcule pour tout espace de Claude Code).
 *
 * Un seul plafond pour toutes : les cibles de l'espace d'abord, puis celles du dehors, chacune dans l'ordre
 * alphabétique. Sous Antigravity, aucune.
 * Limite connue : un fichier importé qui n'existe pas encore n'a pas de carte, donc pas d'observateur ; sa
 * création n'est vue qu'au rafraîchissement suivant (le fichier qui l'importe, lui, est observé).
 */

/** Le plafond du nombre d'observateurs propres à Claude Code (risque R2 de l'inspection), toutes cibles comprises. */
export const CLAUDE_WATCH_MAX_TARGETS = 100;

/** Ce que demandent les cibles du dehors, en plus de l'état. */
export interface ClaudeWatchContext {
  /** Le profil de Claude Code (getEffectiveGlobalClaudePath) : settings.json et projects/<nom>/memory/. */
  globalPath: string;
  /** L'accès au `.git` des dossiers, pour la racine Git de la mémoire automatique. */
  gitEntry: ClaudeGitEntry;
  /** Réservé aux tests : le dernier dossier examiné en cherchant la racine Git. */
  stopAt?: string;
}

const COMMON_DIRS = new Set(['.agents', '.agent', '.claude']);
const COMMON_FILES = new Set(['CLAUDE.md', 'GEMINI.md', 'AGENTS.md']);

/**
 * Vrai si un chemin relatif au dossier de travail est couvert par WATCHER_PATTERNS : un fichier sous un dossier
 * .agents, .agent ou .claude (« ** /{.agents,.agent,.claude}/** »), ou nommé CLAUDE.md, GEMINI.md ou AGENTS.md
 * (« ** /{CLAUDE.md,GEMINI.md,AGENTS.md} »).
 */
export function isCoveredByCommonWatchers(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]/).filter((s) => s !== '');
  if (segments.length === 0) return false;
  if (segments.slice(0, -1).some((s) => COMMON_DIRS.has(s))) return true;
  return COMMON_FILES.has(segments[segments.length - 1]);
}

/** Les fichiers à observer pour Claude Code, triés, sans doublon, bornés à 100 ; aucun pour Antigravity. */
export function claudeWorkspaceWatchTargets(state: ManagerFullState | null | undefined): string[] {
  const workspace = state?.workspace;
  if (!workspace || workspace.tool !== 'claude-code' || !workspace.workspacePath) return [];
  const cwd = path.resolve(workspace.workspacePath);
  const candidates = [
    path.join(cwd, 'CLAUDE.local.md'),
    ...(state.localResources ?? [])
      .filter((item) => item.targetTool === 'claude-code' && item.scope === 'local' && item.metadata?.claudeImport
        && !isNotConsultedCard(item))
      .map((item) => path.resolve(item.path)),
  ];
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const file of candidates) {
    const rel = path.relative(cwd, file);
    // Le dossier de travail lui-même n'est pas une cible ; un fichier hors de lui non plus
    if (rel === '' || !isClaudePathInside(file, cwd)) continue;
    if (isCoveredByCommonWatchers(rel)) continue;
    const key = process.platform === 'win32' ? file.toLowerCase() : file;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(file);
  }
  return targets.sort().slice(0, CLAUDE_WATCH_MAX_TARGETS);
}

/** Une carte d'import non consultée (chemin réseau, hors des dossiers admis) : jamais observée, où qu'elle soit. */
function isNotConsultedCard(item: ResourceItem): boolean {
  const etat = item.metadata?.claudeMemoryNotLoaded;
  return etat !== undefined && CLAUDE_IMPORT_NOT_CONSULTED.has(etat);
}

/** Vrai si le chemin est hors du dossier de travail (autre lecteur compris). */
function isOutside(cwd: string, file: string): boolean {
  return !isClaudePathInside(file, cwd);
}

/** L'emplacement de MEMORY.md à observer, ou null (non déterminé, désactivée, ou état sans mémoire automatique). */
function autoMemoryTarget(state: ManagerFullState, cwd: string, globalPath: string, context: ClaudeWatchContext): string | null {
  const stat = state.stats?.claudeAutoMemory;
  if (!stat || (stat.etat !== 'present' && stat.etat !== 'absent')) return null;
  const card = (state.globalResources ?? []).find(
    (item) => item.targetTool === 'claude-code' && item.metadata?.claudeMemoryType === 'AutoMem'
  );
  if (stat.etat === 'present' && card) return path.resolve(card.path);
  // La même règle que la mémoire automatique (src/services/claudeAutoMemory.ts), avec l'accès au .git du contexte
  const location = claudeAutoMemoryLocation({ cwd, globalPath, stopAt: context.stopAt, gitEntry: context.gitEntry });
  return 'file' in location ? location.file : null;
}

/**
 * Une carte de fichier de mémoire de Claude Code qui vise un fichier existant hors de l'espace (famille 1 à 3).
 * Un import non consulté (chemin réseau, hors des dossiers admis) n'en est pas : il n'est jamais observé.
 */
function isOutsideMemoryCard(item: ResourceItem): boolean {
  if (item.targetTool !== 'claude-code' || item.type !== 'soul' || item.isFolder || !item.path) return false;
  const meta = item.metadata ?? {};
  if (isNotConsultedCard(item)) return false;
  if (meta.claudeImport) return true; // imports du projet, d'un parent ou du CLAUDE.md global
  if (item.scope === 'local') return meta.inheritedFrom !== undefined; // fichiers de mémoire des parents
  return meta.claudeMemoryType !== 'AutoMem'; // le CLAUDE.md global (MEMORY.md a sa propre règle)
}

/** Les fichiers à observer hors de l'espace de travail, triés, sans doublon ; aucun pour Antigravity. */
export function claudeOutsideWatchTargets(state: ManagerFullState | null | undefined, context: ClaudeWatchContext): string[] {
  const workspace = state?.workspace;
  if (!state || !workspace || workspace.tool !== 'claude-code' || !workspace.workspacePath) return [];
  const cwd = path.resolve(workspace.workspacePath);
  const candidates = [...(state.localResources ?? []), ...(state.globalResources ?? [])]
    .filter(isOutsideMemoryCard)
    .map((item) => path.resolve(item.path));
  if (state.stats?.claudeAutoMemory && context.globalPath) {
    const globalPath = path.resolve(context.globalPath);
    const memory = autoMemoryTarget(state, cwd, globalPath, context);
    if (memory) candidates.push(memory);
    candidates.push(path.join(globalPath, 'settings.json'));
  }
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const file of candidates) {
    if (!isOutside(cwd, file)) continue;
    const key = process.platform === 'win32' ? file.toLowerCase() : file;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(file);
  }
  return targets.sort();
}

/** Toutes les cibles de Claude Code sous un seul plafond : celles de l'espace d'abord, puis celles du dehors. */
export function claudeWatchTargets(state: ManagerFullState | null | undefined, context: ClaudeWatchContext): string[] {
  return [...claudeWorkspaceWatchTargets(state), ...claudeOutsideWatchTargets(state, context)].slice(0, CLAUDE_WATCH_MAX_TARGETS);
}
