/**
 * Utilitaires d'extraction de métadonnées pour les Skills et Rules Markdown.
 * Ne nécessite aucune dépendance externe lourde.
 */
import { ANTIGRAVITY_RULE_TRIGGERS, AntigravityRuleTrigger } from '../antigravity/behavior';

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

/** Valeurs de `trigger` reconnues par Antigravity, à la casse près (fait R6 du module central). */
export { ANTIGRAVITY_RULE_TRIGGERS };
export type { AntigravityRuleTrigger };

/**
 * Défauts de frontmatter d'une règle Antigravity (`rules/*.md`) :
 * - missing-frontmatter, missing-trigger, invalid-trigger : Antigravity ignore la règle en silence ;
 * - missing-description (model_decision), missing-globs (glob) : champ obligatoire absent ;
 * - globs-not-string : `globs` écrit en liste YAML, rejeté silencieusement par Antigravity (R4).
 */
export type AntigravityRuleIssue =
  | 'missing-frontmatter'
  | 'missing-trigger'
  | 'invalid-trigger'
  | 'missing-description'
  | 'missing-globs'
  | 'globs-not-string';

export interface AntigravityRuleCheck {
  trigger: AntigravityRuleTrigger | null;
  /** Vrai quand Antigravity écarte la règle (frontmatter absent ou trigger non reconnu). */
  ignored: boolean;
  hasDescription: boolean;
  issues: AntigravityRuleIssue[];
}

/**
 * Vérifie le frontmatter d'un fichier `rules/*.md` selon la documentation d'Antigravity.
 */
export function checkAntigravityRuleFrontmatter(content: string): AntigravityRuleCheck {
  const { metadata, body } = extractFrontmatter(content);
  const hasFrontmatter = body !== content;
  const description = metadata.description;
  const hasDescription = typeof description === 'string' && description.trim().length > 0;

  if (!hasFrontmatter) {
    return { trigger: null, ignored: true, hasDescription, issues: ['missing-frontmatter'] };
  }

  const rawTrigger = metadata.trigger;
  if (rawTrigger === undefined || (typeof rawTrigger === 'string' && rawTrigger.trim() === '')) {
    return { trigger: null, ignored: true, hasDescription, issues: ['missing-trigger'] };
  }

  const trigger = typeof rawTrigger === 'string' ? rawTrigger.trim() : '';
  if (!(ANTIGRAVITY_RULE_TRIGGERS as readonly string[]).includes(trigger)) {
    return { trigger: null, ignored: true, hasDescription, issues: ['invalid-trigger'] };
  }

  const issues: AntigravityRuleIssue[] = [];
  if (trigger === 'model_decision' && !hasDescription) {
    issues.push('missing-description');
  }
  if (trigger === 'glob') {
    const globs = metadata.globs ?? metadata.glob;
    const isEmptyString = typeof globs === 'string' && globs.trim().length === 0;
    if (globs === undefined || isEmptyString || (Array.isArray(globs) && globs.length === 0)) {
      issues.push('missing-globs');
    } else if (typeof globs !== 'string') {
      issues.push('globs-not-string');
    }
  }

  return { trigger: trigger as AntigravityRuleTrigger, ignored: false, hasDescription, issues };
}

/**
 * Détermine si une règle Markdown est conditionnelle (chargée à la demande)
 * ou permanente (chargée au boot en intégralité).
 *
 * Pour Antigravity, seules les valeurs exactes `glob`, `model_decision` et `manual`
 * rendent une règle conditionnelle. Une règle sans trigger valide n'est ni permanente
 * ni conditionnelle : Antigravity l'ignore (voir checkAntigravityRuleFrontmatter).
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
  const trigger = typeof metadata.trigger === 'string' ? metadata.trigger.trim() : '';
  return trigger === 'glob' || trigger === 'model_decision' || trigger === 'manual';
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
