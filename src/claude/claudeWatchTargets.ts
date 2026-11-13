import * as path from 'path';
import type { ManagerFullState } from '../types';

/**
 * Claude Code : les fichiers de mémoire situés DANS l'espace de travail que les motifs communs des
 * observateurs (WATCHER_PATTERNS, src/extension.ts, inchangés : décision Q11) ne couvrent pas. Sans accès
 * aux fichiers : la liste vient de l'état scanné.
 *
 * Les cibles :
 * - le CLAUDE.local.md du dossier de travail, observé même absent (sa création change le compte, et exclut
 *   AGENTS.md) ;
 * - les fichiers importés par la mémoire du niveau projet (projet, CLAUDE.local.md, parents, AGENTS.md),
 *   situés dans le dossier de travail, chargés ou non (cinquième saut, plus de 4 Mio).
 * Ne sont pas des cibles ici : ce que les motifs communs couvrent déjà (CLAUDE.md, AGENTS.md, GEMINI.md et
 * tout ce qui est sous .claude/, .agents/ ou .agent/, réglages du projet compris), et tout ce qui est hors
 * de l'espace (fichiers des parents, imports extérieurs et imports du CLAUDE.md global, MEMORY.md, réglages
 * du profil), laissé à un commit suivant.
 * Limite connue : un fichier importé qui n'existe pas encore n'a pas de carte, donc pas d'observateur ; sa
 * création n'est vue qu'au rafraîchissement suivant (le fichier qui l'importe, lui, est observé).
 */

/** Le plafond du nombre d'observateurs propres à Claude Code (risque R2 de l'inspection). */
export const CLAUDE_WATCH_MAX_TARGETS = 100;

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
      .filter((item) => item.targetTool === 'claude-code' && item.scope === 'local' && item.metadata?.claudeImport)
      .map((item) => path.resolve(item.path)),
  ];
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const file of candidates) {
    const rel = path.relative(cwd, file);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    if (isCoveredByCommonWatchers(rel)) continue;
    const key = process.platform === 'win32' ? file.toLowerCase() : file;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(file);
  }
  return targets.sort().slice(0, CLAUDE_WATCH_MAX_TARGETS);
}
