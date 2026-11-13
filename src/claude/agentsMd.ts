import * as path from 'path';
import type { ClaudeMemoryType } from '../types';
import { CLAUDE_MEMORY_FILES } from './memorySources';

/**
 * Claude Code : quand lire AGENTS.md, et le réglage Project instructions.
 *
 * Sources (https://code.claude.com/docs/en/memory.md, « When Claude Code reads AGENTS.md » et « Choose
 * which instruction files load ») :
 * - « By default, Claude reads AGENTS.md only when you have no CLAUDE.md in your working directory or above
 *   it » ; comptent : « a CLAUDE.md, .claude/CLAUDE.md, or CLAUDE.local.md in your working directory or any
 *   directory above it » ; ne comptent pas : « your ~/.claude/CLAUDE.md, your organization's managed
 *   CLAUDE.md, and .claude/rules/ files » (documentation) ; mesuré pour les deux cas du projet (CC22) ;
 * - lus au démarrage : « every AGENTS.md and .claude/AGENTS.md in your working directory and the
 *   directories above it », avec leurs imports « @ » (documentation) ; mesuré sur un niveau de parent
 *   (CC47 : AGENTS.md du projet, .claude/AGENTS.md du projet, AGENTS.md du parent, tous Project) ;
 * - jamais lus : « AGENTS.local.md, AGENTS.override.md, or anything under a .agents/ directory » ;
 * - le réglage Project instructions : clé `pluginConfigs` → `cc-plugin-agents-md@builtin` →
 *   `options.instructionFiles`, lue par Claude Code dans ~/.claude/settings.json, un fichier --settings ou
 *   les réglages managés, et ignorée dans les réglages du projet ; valeur par défaut
 *   `claude-md-or-agents-md` (« This is the default »). Non mesuré.
 *
 * Choix (déduits, décision Q14) : l'extension lit cette seule clé dans le settings.json du profil, et
 * seulement pour constater une valeur autre que la valeur par défaut, qui ajoute une mention « ❔ » aux
 * cartes AGENTS.md ; la règle de lecture d'AGENTS.md n'en tient pas compte. L'ancien identifiant
 * `agents-md@builtin` (avant la v2.1.285) n'est pas lu. Un fichier de mémoire présent exclut AGENTS.md
 * quelle que soit sa taille (un fichier de plus de 4 Mio, ignoré par Claude Code, exclut aussi : non vérifié).
 */

/** Les AGENTS.md d'un dossier, dans l'ordre de chargement, après les fichiers de mémoire du même dossier (déduit). */
export const CLAUDE_AGENTS_FILES: ReadonlyArray<{ file: string; claudeMemoryType: ClaudeMemoryType }> = [
  { file: 'AGENTS.md', claudeMemoryType: 'Project' },
  { file: '.claude/AGENTS.md', claudeMemoryType: 'Project' },
];

/** Vrai pour un chemin relatif d'AGENTS.md ou de .claude/AGENTS.md (séparateurs « / »). */
export function isClaudeAgentsFile(file: string): boolean {
  return CLAUDE_AGENTS_FILES.some((f) => f.file === file);
}

/** L'identifiant du plugin intégré qui lit AGENTS.md, et la valeur par défaut du réglage (documentation). */
export const CLAUDE_AGENTS_MD_PLUGIN_ID = 'cc-plugin-agents-md@builtin';
export const CLAUDE_PROJECT_INSTRUCTIONS_DEFAULT = 'claude-md-or-agents-md';

/**
 * Vrai si le texte du settings.json du profil pose une valeur du réglage Project instructions autre que la
 * valeur par défaut. Une entrée sans valeur, un fichier absent ou un JSON invalide : faux. Aucune autre
 * valeur du fichier n'est gardée ni rendue.
 */
export function claudeProjectInstructionsIsNonDefault(settingsText: string | null): boolean {
  if (settingsText === null) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsText);
  } catch {
    return false;
  }
  const pluginConfigs = isObject(parsed) ? parsed.pluginConfigs : undefined;
  const entry = isObject(pluginConfigs) ? pluginConfigs[CLAUDE_AGENTS_MD_PLUGIN_ID] : undefined;
  const options = isObject(entry) ? entry.options : undefined;
  const value = isObject(options) ? options.instructionFiles : undefined;
  return value !== undefined && value !== CLAUDE_PROJECT_INSTRUCTIONS_DEFAULT;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** L'accès aux fichiers, fourni par l'appelant. */
export interface ClaudeAgentsPort {
  isFile(file: string): boolean;
  /** La clé de chemin résolu (src/claude/memorySources.ts, claudeResolvedPathKey). */
  key(file: string): string;
}

/**
 * Le fichier de mémoire qui exclut AGENTS.md, en chemin relatif au dossier de travail (séparateurs « / »),
 * ou `null` si aucun n'existe : le premier dans l'ordre de chargement, des dossiers parents (de la racine
 * vers le plus proche) au dossier de travail. Le CLAUDE.md du profil, même atteint comme .claude/CLAUDE.md
 * d'un dossier (dossier personnel), ne compte pas.
 */
export function claudeAgentsMdExcluder(
  context: { cwd: string; ancestors: string[]; globalClaudeMdKey: string },
  port: ClaudeAgentsPort
): string | null {
  const cwd = path.resolve(context.cwd);
  for (const dir of [...context.ancestors, cwd]) {
    for (const { file } of CLAUDE_MEMORY_FILES) {
      const candidate = path.join(dir, ...file.split('/'));
      if (!port.isFile(candidate)) continue;
      if (port.key(candidate) === context.globalClaudeMdKey) continue;
      return path.relative(cwd, candidate).split(path.sep).join('/');
    }
  }
  return null;
}
