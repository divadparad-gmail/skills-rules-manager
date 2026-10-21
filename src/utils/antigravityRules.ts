/**
 * Analyse des fichiers de règles Antigravity selon la documentation officielle
 * (https://antigravity.google/docs/rules/) : frontmatter, inclusions et limite de taille.
 */
import * as fs from 'fs';
import * as path from 'path';
import { AntigravityRuleIssue, AntigravityRuleTrigger, checkAntigravityRuleFrontmatter, extractFrontmatter } from './frontmatter';
import { getUserHome } from './paths';
import { countTokens } from './tokenizer';

/** Antigravity tronque tout fichier de règles qui dépasse 24 000 octets, inclusions développées. */
export const ANTIGRAVITY_RULE_MAX_BYTES = 24000;

/** Au-delà de cette taille, un fichier inclus n'est pas lu : seule sa taille sur disque est comptée. */
const MAX_INCLUDE_READ_BYTES = 1024 * 1024;

const INCLUDE_PATTERN = /@\[([^\]]*)\]\(([^)\s]+)\)/g;

export interface ExpandedRuleContent {
  /** Contenu avec chaque `@[label](path)` remplacé par le corps du fichier cible. */
  content: string;
  /** Taille en octets UTF-8 du contenu développé. */
  byteSize: number;
  /** Chemins absolus des inclusions résolues. */
  includes: string[];
  /** Chemins des inclusions introuvables (laissées telles quelles). */
  missing: string[];
}

function resolveIncludePath(target: string, ruleFilePath: string): string {
  if (target === '~' || target.startsWith('~/')) {
    return path.join(getUserHome(), target.slice(1));
  }
  return path.isAbsolute(target) ? target : path.resolve(path.dirname(ruleFilePath), target);
}

/**
 * Développe les inclusions `@[label](path)` d'un fichier de règles.
 * Les chemins relatifs partent du dossier du fichier de règles, `~/` désigne le dossier personnel,
 * et le frontmatter YAML des fichiers inclus est retiré. Les références `@filename` ne sont pas
 * développées : Antigravity les réécrit seulement en chemin absolu.
 * La documentation ne dit pas si les inclusions sont récursives : un seul niveau est développé.
 */
export async function expandRuleIncludes(content: string, ruleFilePath: string): Promise<ExpandedRuleContent> {
  const includes: string[] = [];
  const missing: string[] = [];
  const replacements = new Map<string, string>();
  let oversizedBytes = 0;

  for (const match of content.matchAll(INCLUDE_PATTERN)) {
    const [fullMatch, , target] = match;
    if (replacements.has(fullMatch)) continue;

    const resolved = resolveIncludePath(target, ruleFilePath);
    try {
      const stat = await fs.promises.stat(resolved);
      if (!stat.isFile()) throw new Error('not a file');

      if (stat.size > MAX_INCLUDE_READ_BYTES) {
        oversizedBytes += stat.size * content.split(fullMatch).slice(1).length;
        replacements.set(fullMatch, '');
      } else {
        const included = await fs.promises.readFile(resolved, 'utf8');
        replacements.set(fullMatch, extractFrontmatter(included).body);
      }
      includes.push(resolved);
    } catch {
      missing.push(target);
    }
  }

  const expanded = replacements.size === 0
    ? content
    : content.replace(INCLUDE_PATTERN, (fullMatch) => replacements.get(fullMatch) ?? fullMatch);

  return {
    content: expanded,
    byteSize: Buffer.byteLength(expanded, 'utf8') + oversizedBytes,
    includes,
    missing,
  };
}

export interface AntigravityRuleInspection {
  trigger: AntigravityRuleTrigger | null;
  ignored: boolean;
  isConditional: boolean;
  issues: AntigravityRuleIssue[];
  byteSize: number;
  warningSizeExceeded: boolean;
  /** Description absente du frontmatter (recommandée pour toutes les règles). */
  warningNoDescription: boolean;
  /** Tokens du contenu développé, ou undefined si le fichier n'a aucune inclusion. */
  expandedTokenCount?: number;
}

/**
 * Inspecte un fichier `rules/*.md` d'Antigravity : validité du frontmatter, mode d'activation,
 * taille en octets après inclusions.
 */
export async function inspectAntigravityRule(rawContent: string, filePath: string): Promise<AntigravityRuleInspection> {
  const check = checkAntigravityRuleFrontmatter(rawContent);
  const expanded = await expandRuleIncludes(rawContent, filePath);

  return {
    trigger: check.trigger,
    ignored: check.ignored,
    isConditional: check.trigger === 'glob' || check.trigger === 'model_decision' || check.trigger === 'manual',
    issues: check.issues,
    byteSize: expanded.byteSize,
    warningSizeExceeded: expanded.byteSize > ANTIGRAVITY_RULE_MAX_BYTES,
    // Pour model_decision, l'absence de description est déjà signalée comme champ obligatoire manquant ;
    // pour une règle ignorée, le défaut de trigger prime.
    warningNoDescription: !check.ignored && !check.hasDescription && check.trigger !== 'model_decision',
    expandedTokenCount: expanded.includes.length > 0 ? countTokens(expanded.content) : undefined,
  };
}

/** Développe les accolades d'un motif glob (`src/*.{ts,tsx}` → `src/*.ts`, `src/*.tsx`). */
function expandBraces(pattern: string): string[] {
  const match = pattern.match(/\{([^{}]*)\}/);
  if (!match || match.index === undefined) return [pattern];
  const before = pattern.slice(0, match.index);
  const after = pattern.slice(match.index + match[0].length);
  return match[1].split(',').flatMap((option) => expandBraces(`${before}${option}${after}`));
}

/**
 * Garantit qu'une règle copiée vers Antigravity déclare un `trigger` valide, sans quoi
 * l'agent l'ignorerait. Une règle Claude Code avec `paths` devient `trigger: glob`
 * (accolades développées, `globs` étant séparé par des virgules) ; une règle sans
 * frontmatter ni trigger devient `trigger: always_on`, l'équivalent d'une règle permanente.
 * Un trigger présent mais non reconnu n'est pas deviné : l'import est refusé.
 */
export function ensureAntigravityTrigger(content: string): { content: string; addedTrigger: AntigravityRuleTrigger | null } {
  const check = checkAntigravityRuleFrontmatter(content);
  if (!check.ignored) return { content, addedTrigger: null };

  if (check.issues.includes('invalid-trigger')) {
    throw new Error(
      'Le trigger de cette règle n\'est pas reconnu par Antigravity (valeurs exactes : always_on, model_decision, glob, manual). Corrigez-le avant l\'import.'
    );
  }

  const { metadata } = extractFrontmatter(content);
  const rawPaths = metadata.paths;
  const patterns = (Array.isArray(rawPaths) ? rawPaths : typeof rawPaths === 'string' ? rawPaths.split(',') : [])
    .map((pattern) => String(pattern).trim())
    .filter(Boolean)
    .flatMap(expandBraces);

  const trigger: AntigravityRuleTrigger = patterns.length > 0 ? 'glob' : 'always_on';
  const frontmatterLines = patterns.length > 0
    ? ['trigger: glob', `globs: "${patterns.join(', ')}"`]
    : ['trigger: always_on'];
  const eol = content.includes('\r\n') ? '\r\n' : '\n';

  if (check.issues.includes('missing-frontmatter')) {
    return { content: `---${eol}${frontmatterLines.join(eol)}${eol}---${eol}${eol}${content}`, addedTrigger: trigger };
  }

  const opening = content.match(/^\s*---[ \t]*\r?\n/);
  const insertAt = opening ? opening[0].length : 0;
  return {
    content: content.slice(0, insertAt) + frontmatterLines.join(eol) + eol + content.slice(insertAt),
    addedTrigger: trigger,
  };
}

/**
 * Taille en octets d'un fichier AGENTS.md ou GEMINI.md, inclusions développées.
 */
export async function measureAntigravitySoul(rawContent: string, filePath: string): Promise<{
  byteSize: number;
  warningSizeExceeded: boolean;
  expandedTokenCount?: number;
}> {
  const expanded = await expandRuleIncludes(rawContent, filePath);
  return {
    byteSize: expanded.byteSize,
    warningSizeExceeded: expanded.byteSize > ANTIGRAVITY_RULE_MAX_BYTES,
    expandedTokenCount: expanded.includes.length > 0 ? countTokens(expanded.content) : undefined,
  };
}
