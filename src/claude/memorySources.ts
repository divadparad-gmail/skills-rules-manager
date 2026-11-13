import * as fs from 'fs';
import * as path from 'path';
import type { ClaudeMemoryType } from '../types';

/**
 * Claude Code : les fichiers de mémoire des dossiers parents du dossier de travail, et la clé de chemin
 * résolu qui sert à ne compter qu'une fois un fichier atteint par plusieurs chemins.
 *
 * Sources (suite test/scenarios/claude-code-injection-contexte/, grille SCENARIOS-CLAUDE-CODE.md) :
 * - le CLAUDE.md et le .claude/CLAUDE.md d'un dossier parent sont chargés, type Project : mesuré sur un
 *   seul niveau de parent (CC05, CC06) ;
 * - le CLAUDE.local.md des dossiers parents : documentation (https://code.claude.com/docs/en/memory.md,
 *   « How CLAUDE.md files load » : « from your current working directory and every directory above
 *   it »), non mesuré pour un parent ;
 * - la remontée jusqu'à la racine du disque, sans arrêt à la racine d'un dépôt Git, et l'ordre de la
 *   racine vers le dossier de travail (« content is ordered from the filesystem root down to your
 *   working directory ») : documentation, non mesurée au-delà d'un niveau ;
 * - dans un même dossier, CLAUDE.local.md après CLAUDE.md : documentation (« Within each directory,
 *   CLAUDE.local.md is appended after CLAUDE.md ») ;
 * - un fichier atteint par deux chemins (le CLAUDE.md global atteint comme .claude/CLAUDE.md du dossier
 *   personnel) chargé une seule fois : observé en 2.1.318 (CC07), non vérifié en 2.1.319.
 *
 * Le module ne lit rien, sauf `claudeResolvedPathKey`, qui résout les liens du chemin donné.
 */

/** Les fichiers de mémoire d'un dossier, dans l'ordre de chargement (CLAUDE.local.md en dernier). */
export const CLAUDE_MEMORY_FILES: ReadonlyArray<{ file: string; claudeMemoryType: ClaudeMemoryType }> = [
  { file: 'CLAUDE.md', claudeMemoryType: 'Project' },
  { file: '.claude/CLAUDE.md', claudeMemoryType: 'Project' },
  { file: 'CLAUDE.local.md', claudeMemoryType: 'Local' },
];

export interface ClaudeMemoryOptions {
  /**
   * Le dernier dossier lu en remontant, compris. Réservé aux tests : sans lui, la remontée va jusqu'à la
   * racine du disque, comme Claude Code. S'il n'est pas un dossier parent du dossier de travail, aucun
   * parent n'est lu.
   */
  stopAt?: string;
}

export interface ClaudeParentMemoryCandidate {
  /** Le chemin relatif au dossier du parent, en séparateurs « / ». */
  file: string;
  absolutePath: string;
  /** Le chemin du parent relatif au dossier de travail, en séparateurs « / » : « .. », « ../.. »… */
  inheritedFrom: string;
  claudeMemoryType: ClaudeMemoryType;
}

/** Vrai si `enfant` est `parent` lui-même ou se trouve dessous (path.relative suit la casse de la plateforme). */
function isSameOrInside(enfant: string, parent: string): boolean {
  const rel = path.relative(parent, enfant);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Les dossiers parents du dossier de travail, de la racine du disque (ou de `stopAt`) vers le plus
 * proche, sans le dossier de travail lui-même et sans arrêt à la racine Git.
 */
export function claudeAncestorDirs(cwd: string, options: ClaudeMemoryOptions = {}): string[] {
  const start = path.resolve(cwd);
  const stopAt = options.stopAt !== undefined ? path.resolve(options.stopAt) : undefined;
  if (stopAt !== undefined && (!isSameOrInside(start, stopAt) || isSameOrInside(stopAt, start))) {
    return [];
  }
  const dirs: string[] = [];
  let previous = start;
  let current = path.dirname(start);
  while (current !== previous) {
    dirs.push(current);
    if (stopAt !== undefined && isSameOrInside(stopAt, current)) break;
    previous = current;
    current = path.dirname(current);
  }
  return dirs.reverse();
}

/**
 * Les fichiers de mémoire candidats des dossiers parents, dans l'ordre de chargement : de la racine
 * vers le dossier de travail, et, dans chaque dossier, CLAUDE.md, .claude/CLAUDE.md puis CLAUDE.local.md
 * (ou les fichiers donnés par `files`, dans leur ordre : AGENTS.md s'y ajoute, src/claude/agentsMd.ts).
 * L'existence des fichiers n'est pas vérifiée ici.
 */
export function claudeParentMemoryCandidates(
  cwd: string,
  options: ClaudeMemoryOptions = {},
  files: ReadonlyArray<{ file: string; claudeMemoryType: ClaudeMemoryType }> = CLAUDE_MEMORY_FILES
): ClaudeParentMemoryCandidate[] {
  const start = path.resolve(cwd);
  return claudeAncestorDirs(start, options).flatMap((dir) => {
    const inheritedFrom = path.relative(start, dir).split(path.sep).join('/');
    return files.map(({ file, claudeMemoryType }) => ({
      file,
      absolutePath: path.join(dir, ...file.split('/')),
      inheritedFrom,
      claudeMemoryType,
    }));
  });
}

/**
 * La clé d'un fichier pour le dédoublonnage par chemin résolu : le chemin réel (liens suivis, casse du
 * disque), en minuscules sous Windows (NTFS ignore la casse, et VS Code écrit « c: » quand le disque
 * rend « C: »). Si le chemin ne se résout pas (fichier absent), le chemin absolu sert de clé. Sous
 * macOS, la casse est gardée : deux chemins qui ne diffèrent que par elle ne seraient pas dédoublonnés
 * (non vérifié).
 */
export function claudeResolvedPathKey(filePath: string, platform: NodeJS.Platform = process.platform): string {
  let resolved: string;
  try {
    const realpath = fs.realpathSync.native ?? fs.realpathSync;
    resolved = realpath(filePath);
  } catch {
    resolved = path.resolve(filePath);
  }
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}
