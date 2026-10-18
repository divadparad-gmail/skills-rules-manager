/**
 * Utilitaires d'extraction de métadonnées pour les Skills et Rules Markdown.
 * Ne nécessite aucune dépendance externe lourde.
 */

export interface ParsedMetadata {
  name?: string;
  description?: string;
  tags?: string[];
  [key: string]: any;
}

/**
 * Extrait le frontmatter YAML (entre --- et ---) d'un contenu Markdown.
 */
export function extractFrontmatter(content: string): { metadata: ParsedMetadata; body: string } {
  const metadata: ParsedMetadata = {};
  const trimmed = content.trimStart();

  const startMatch = trimmed.match(/^---[ \t]*\r?\n/);
  if (!startMatch) {
    return { metadata, body: content };
  }

  const startIndex = startMatch[0].length;
  const rest = trimmed.slice(startIndex);
  const endMatch = rest.match(/\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!endMatch || endMatch.index === undefined) {
    return { metadata, body: content };
  }

  const frontmatterRaw = rest.substring(0, endMatch.index).trim();
  const body = rest.substring(endMatch.index + endMatch[0].length).trimStart();

  // Parsing ligne par ligne du YAML basique
  const lines = frontmatterRaw.split(/\r?\n/);
  let currentKey: string | null = null;
  let multilineValue = '';
  let listItems: string[] = [];

  for (const line of lines) {
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentKey) {
      listItems.push(cleanYamlValue(listMatch[1]));
      continue;
    }

    const match = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (match) {
      if (currentKey) {
        if (listItems.length > 0) {
          metadata[currentKey] = listItems;
          listItems = [];
        } else if (multilineValue) {
          metadata[currentKey] = cleanYamlValue(multilineValue);
          multilineValue = '';
        }
      }
      currentKey = match[1].trim();
      const val = match[2].trim();
      if (val === '|' || val === '>') {
        multilineValue = '';
      } else if (val.startsWith('[') && val.endsWith(']')) {
        // Liste inline [a, b]
        const rawItems = val.substring(1, val.length - 1).split(',');
        metadata[currentKey] = rawItems.map((item) => cleanYamlValue(item.trim())).filter(Boolean);
        currentKey = null;
      } else if (val) {
        metadata[currentKey] = cleanYamlValue(val);
        currentKey = null;
      } else {
        // Clé sans valeur immédiate (potentielle liste YAML sur les lignes suivantes)
        multilineValue = '';
        listItems = [];
      }
    } else if (currentKey) {
      multilineValue += (multilineValue ? ' ' : '') + line.trim();
    }
  }

  if (currentKey) {
    if (listItems.length > 0) {
      metadata[currentKey] = listItems;
    } else if (multilineValue) {
      metadata[currentKey] = cleanYamlValue(multilineValue);
    }
  }

  return { metadata, body };
}

function cleanYamlValue(val: string): any {
  let cleaned = val.trim();
  const isQuoted =
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"));

  if (isQuoted) {
    return cleaned.substring(1, cleaned.length - 1);
  }
  if (cleaned.toLowerCase() === 'true') return true;
  if (cleaned.toLowerCase() === 'false') return false;
  return cleaned;
}

/**
 * Détermine si une règle Markdown est conditionnelle (chargée à la demande)
 * ou permanente (chargée au boot en intégralité).
 */
export function isRuleConditional(
  metadata: Record<string, any>,
  targetTool: 'antigravity' | 'claude-code'
): boolean {
  if (targetTool === 'claude-code') {
    const paths = metadata.paths;
    if (Array.isArray(paths) && paths.length > 0) return true;
    if (typeof paths === 'string' && paths.trim().length > 0) return true;
    return false;
  }

  // Antigravity
  const trigger = typeof metadata.trigger === 'string' ? metadata.trigger.toLowerCase().trim() : '';
  if (trigger === 'glob' || trigger === 'globs' || trigger === 'model_decision' || trigger === 'manual') {
    return true;
  }
  const globs = metadata.globs || metadata.glob;
  if (Array.isArray(globs) && globs.length > 0) return true;
  if (typeof globs === 'string' && globs.trim().length > 0) return true;

  return false;
}

/**
 * Extrait le premier titre (# Titre) ou premier paragraphe d'un fichier Markdown
 * lorsque le frontmatter n'est pas présent.
 */
export function extractMarkdownTitleAndSummary(content: string): { title?: string; summary?: string } {
  const { body } = extractFrontmatter(content);
  const lines = body.split(/\r?\n/);
  let title: string | undefined;
  let summary: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!title && line.startsWith('#')) {
      title = line.replace(/^#+\s*/, '').trim();
      continue;
    }

    if (!summary && !line.startsWith('#') && !line.startsWith('---') && !line.startsWith('>')) {
      summary = line.substring(0, 160).trim();
      break;
    }
  }

  return { title, summary };
}
