import * as fs from 'fs';
import { ClaudeMemoryType, ResourceItem } from '../types';
import { extractMarkdownTitleAndSummary } from '../utils/frontmatter';
import { countTokensForFile } from '../utils/tokenizer';
import { claudeInjectedText, CLAUDE_INJECTED_TEXT_VARIANT } from '../claude/injectedText';
import { claudeResolvedPathKey } from '../claude/memorySources';
import {
  CLAUDE_IMPORT_NOT_CONSULTED,
  CLAUDE_MEMORY_MAX_BYTES,
  ClaudeImportEntry,
  ClaudeImportPort,
  claudeImportCardId,
  claudeImportLabel,
  isClaudePathInside,
} from '../claude/memoryImports';

/**
 * Claude Code : les cartes des fichiers importés par la mémoire (src/claude/memoryImports.ts), et l'accès
 * aux fichiers qu'utilise leur développement. Partagé par LocalScanner (projet et parents) et GlobalScanner
 * (CLAUDE.md global). Rien ici ne sert à Antigravity.
 */

/** L'accès réel aux fichiers : taille par stat, texte lu seulement à la demande, clé de chemin résolu. */
export function claudeImportFsPort(): ClaudeImportPort {
  return {
    fileSize: (file) => {
      try {
        const stat = fs.statSync(file);
        return stat.isFile() ? stat.size : null;
      } catch {
        return null;
      }
    },
    readText: (file) => {
      try {
        return fs.readFileSync(file, 'utf8');
      } catch {
        return null;
      }
    },
    key: (file) => claudeResolvedPathKey(file),
  };
}

/**
 * Le texte injecté d'un fichier de mémoire dont on développe les imports ; `null` s'il n'est pas un
 * fichier, s'il est illisible, ou s'il dépasse 4 Mio (il n'est alors pas lu).
 */
export function claudeMemoryRootText(file: string, port: ClaudeImportPort): string | null {
  const size = port.fileSize(file);
  if (size === null || size > CLAUDE_MEMORY_MAX_BYTES) return null;
  const raw = port.readText(file);
  return raw === null ? null : claudeInjectedText(raw);
}

/**
 * Les cartes des fichiers importés, une par entrée, dans l'ordre du développement. Toutes en lecture seule.
 * Une carte non consultée (chemin réseau, hors des dossiers admis) a pour libellé son chemin résolu absolu, en
 * barres obliques.
 */
export function buildClaudeImportItems(
  entries: ClaudeImportEntry[],
  options: {
    scope: 'global' | 'local';
    claudeMemoryType: ClaudeMemoryType;
    /** Libellés relatifs au dossier de travail (niveau projet), ou « ~/… » (niveau utilisateur). */
    labelBase: { cwd: string } | { home: string };
    /** Clé du dossier de travail : un import du niveau projet situé dedans a la raison « Fichier importé ». */
    cwdKey: string | null;
  }
): ResourceItem[] {
  return entries.map((entry): ResourceItem => {
    const label = CLAUDE_IMPORT_NOT_CONSULTED.has(entry.etat)
      ? entry.path.replace(/\\/g, '/')
      : claudeImportLabel(entry.path, options.labelBase);
    const id = 'cwd' in options.labelBase ? claudeImportCardId(label) : label;
    const par = claudeImportLabel(entry.importer, options.labelBase);
    const loaded = entry.etat === 'charge' && entry.raw !== null && entry.text !== null;
    const inProject = options.cwdKey !== null && isClaudePathInside(entry.key, options.cwdKey);
    let tokenCount = 0;
    let lineCount = 0;
    let summary = '';
    if (loaded) {
      let mtimeMs: number | undefined;
      try {
        mtimeMs = fs.statSync(entry.path).mtimeMs;
      } catch {
        mtimeMs = undefined;
      }
      tokenCount = countTokensForFile(entry.path, entry.size, mtimeMs, entry.text, CLAUDE_INJECTED_TEXT_VARIANT);
      lineCount = entry.raw!.split(/\r\n|\r|\n/).length;
      summary = extractMarkdownTitleAndSummary(entry.raw!).summary ?? '';
    }
    return {
      id,
      name: id,
      description: summary || `Fichier importé par ${par}`,
      type: 'soul',
      scope: options.scope,
      enabled: true,
      path: entry.path,
      targetTool: 'claude-code',
      isFolder: false,
      charCount: loaded ? entry.text!.length : 0,
      tokenCount,
      lineCount,
      metadata: {
        isSoul: true,
        locked: true,
        claudeMemoryType: options.claudeMemoryType,
        claudeReadOnly: { raison: inProject ? 'Fichier importé' : 'Fichier hors du projet' },
        claudeImport: { par, niveau: entry.niveau, externe: entry.externe },
        ...(entry.etat !== 'charge' ? { claudeMemoryNotLoaded: entry.etat } : {}),
        ...(entry.etat === 'plus-de-4-mio' ? { claudeByteSize: entry.size } : {}),
        warningLinesExceeded: lineCount > 200,
        warningSizeExceeded: false,
      },
    };
  });
}

/** Vrai pour une carte de Claude Code présente mais non chargée (cinquième saut, plus de 4 Mio, chemin réseau…). */
export function isClaudeMemoryNotLoaded(item: ResourceItem): boolean {
  return item.targetTool === 'claude-code' && !!item.metadata?.claudeMemoryNotLoaded;
}

/** Les cartes de plus de 4 Mio : chacune compte pour un avertissement, bien qu'elle ne soit pas active. */
export function claudeOversizedWarningCount(items: ResourceItem[]): number {
  return items.filter((i) => i.targetTool === 'claude-code' && i.metadata?.claudeMemoryNotLoaded === 'plus-de-4-mio').length;
}
