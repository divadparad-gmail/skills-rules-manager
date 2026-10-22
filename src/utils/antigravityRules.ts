/**
 * Analyse des fichiers de règles Antigravity selon la documentation officielle
 * (https://antigravity.google/docs/rules/) : frontmatter, inclusions et limite de taille.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  AntigravityRuleIssue,
  AntigravityRuleTrigger,
  checkAntigravityRuleFrontmatter,
  extractFrontmatter,
  extractMarkdownTitleAndSummary,
  ParsedMetadata,
} from './frontmatter';
import { getUserHome } from './paths';
import { countTokens } from './tokenizer';
import { AntigravityRuleStatus, convertClaudePaths, validateGlobs } from '../antigravity/behavior';

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
  /** Statut vis-à-vis de l'agent (R3, R4, R6) ; R1 et R2 dépendent de l'emplacement, fixé par l'appelant. */
  status: AntigravityRuleStatus;
  /** Motifs `globs` qui contiennent un dossier et ne se déclencheront jamais (R3). */
  deadGlobs: string[];
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
  const verdict = check.trigger === 'glob' && !check.issues.includes('missing-globs')
    ? validateGlobs(globsOf(extractFrontmatter(rawContent).metadata))
    : null;

  return {
    trigger: check.trigger,
    ignored: check.ignored,
    isConditional: check.trigger === 'glob' || check.trigger === 'model_decision' || check.trigger === 'manual',
    status: check.ignored ? 'ignored'
      : verdict?.status === 'yaml-list' ? 'ignored-yaml-list'
      : verdict?.status === 'never-triggers' ? 'never-triggers'
      : verdict?.status === 'partial' ? 'partial'
      : 'active',
    deadGlobs: verdict?.deadPatterns ?? [],
    issues: check.issues,
    byteSize: expanded.byteSize,
    warningSizeExceeded: expanded.byteSize > ANTIGRAVITY_RULE_MAX_BYTES,
    // Pour model_decision, l'absence de description est déjà signalée comme champ obligatoire manquant ;
    // pour une règle ignorée, le défaut de trigger prime.
    warningNoDescription: !check.ignored && !check.hasDescription && check.trigger !== 'model_decision',
    expandedTokenCount: expanded.includes.length > 0 ? countTokens(expanded.content) : undefined,
  };
}

/** `globs` d'un frontmatter (`glob:` au singulier est aussi accepté, non vérifié). */
function globsOf(metadata: ParsedMetadata): unknown {
  return metadata.globs ?? metadata.glob;
}

/**
 * Avertissements sur les `globs` d'une règle déjà valide (R3, R4). La règle n'est pas
 * réécrite : c'est le contenu de l'utilisateur, il le corrige lui-même.
 */
export function describeGlobsProblems(content: string): string[] {
  const check = checkAntigravityRuleFrontmatter(content);
  if (check.trigger !== 'glob' || check.issues.includes('missing-globs')) return [];
  const verdict = validateGlobs(globsOf(extractFrontmatter(content).metadata));
  const listed = verdict.deadPatterns.join(', ');
  switch (verdict.status) {
    case 'yaml-list':
      return ['« globs » est écrit en liste YAML : Antigravity ignore la règle. Écrivez globs: "*.ts, *.js" (une chaîne).'];
    case 'never-triggers':
      return [`Cette règle ne se déclenchera jamais : Antigravity compare le motif au nom de fichier seul (${listed}). Utilisez *.ts au lieu de src/**/*.ts.`];
    case 'partial':
      return [`Ces motifs ne se déclencheront jamais, car Antigravity compare le motif au nom de fichier seul : ${listed}.`];
    default:
      return [];
  }
}

/** Retire une clé de premier niveau (et ses lignes de continuation) du frontmatter. */
function removeFrontmatterKey(content: string, key: string): string {
  const block = /^(\s*---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/.exec(content);
  if (!block) return content;
  const [whole, opening, body, closing] = block;
  const newline = closing.startsWith('\r\n') ? '\r\n' : '\n';
  const kept: string[] = [];
  let skipping = false;
  for (const line of body.split(/\r?\n/)) {
    if (new RegExp(`^${key}\\s*:`).test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && /^[ \t]+\S|^[ \t]*-\s/.test(line)) continue;
    skipping = false;
    kept.push(line);
  }
  return `${opening}${kept.join(newline)}${closing}${content.slice(whole.length)}`;
}

function quotedList(items: string[]): string {
  const quoted = items.map((item) => `\`${item}\``);
  return quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} et ${quoted[quoted.length - 1]}` : quoted[0];
}

export interface AntigravityRuleConversion {
  content: string;
  addedTrigger: AntigravityRuleTrigger | null;
  /** Points à montrer à l'utilisateur : portée élargie, motifs morts, liste YAML. */
  warnings: string[];
}

/**
 * Garantit qu'une règle copiée vers Antigravity déclare un `trigger` valide et une
 * `description`, sans quoi l'agent l'ignorerait (R6). Les `paths:` d'une règle Claude Code
 * deviennent des motifs de nom de fichier qui se déclenchent vraiment (R3, R4), ou
 * `model_decision` si aucun motif ne peut désigner le dossier ; une règle sans frontmatter
 * ni trigger devient `trigger: always_on`. Un trigger présent mais non reconnu n'est pas
 * deviné : l'import est refusé. Une règle déjà valide est copiée telle quelle, avec ses
 * éventuels avertissements.
 */
export function ensureAntigravityTrigger(content: string): AntigravityRuleConversion {
  const check = checkAntigravityRuleFrontmatter(content);
  if (!check.ignored) return { content, addedTrigger: null, warnings: describeGlobsProblems(content) };

  if (check.issues.includes('invalid-trigger')) {
    throw new Error(
      'Le trigger de cette règle n\'est pas reconnu par Antigravity (valeurs exactes : always_on, model_decision, glob, manual). Corrigez-le avant l\'import.'
    );
  }

  const { metadata } = extractFrontmatter(content);
  const rawPaths = metadata.paths;
  const paths = (Array.isArray(rawPaths) ? rawPaths : typeof rawPaths === 'string' ? rawPaths.split(',') : [])
    .map((pattern) => String(pattern));
  const conversion = convertClaudePaths(paths);

  const existingDescription = typeof metadata.description === 'string' ? metadata.description.trim() : '';
  let description = existingDescription;
  if (conversion.trigger === 'model_decision') {
    const files = conversion.fileNames.length > 0 ? `, et aux fichiers ${quotedList(conversion.fileNames)}` : '';
    const scope = `S'applique aux fichiers de ${quotedList(conversion.folders)}${files}.`;
    const base = existingDescription || extractMarkdownTitleAndSummary(content).title || '';
    description = base ? `${base.replace(/\.$/, '')}. ${scope}` : scope;
  } else if (!description) {
    description = extractMarkdownTitleAndSummary(content).title || 'Règle importée';
  }

  const frontmatterLines = [`trigger: ${conversion.trigger}`];
  if (conversion.globs) frontmatterLines.push(`globs: "${conversion.globs}"`);
  if (description !== existingDescription) frontmatterLines.push(`description: ${JSON.stringify(description)}`);
  const eol = content.includes('\r\n') ? '\r\n' : '\n';

  if (check.issues.includes('missing-frontmatter')) {
    return {
      content: `---${eol}${frontmatterLines.join(eol)}${eol}---${eol}${eol}${content}`,
      addedTrigger: conversion.trigger,
      warnings: conversion.warnings,
    };
  }

  const source = description !== existingDescription && existingDescription
    ? removeFrontmatterKey(content, 'description')
    : content;
  const opening = source.match(/^\s*---[ \t]*\r?\n/);
  const insertAt = opening ? opening[0].length : 0;
  return {
    content: source.slice(0, insertAt) + frontmatterLines.join(eol) + eol + source.slice(insertAt),
    addedTrigger: conversion.trigger,
    warnings: conversion.warnings,
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
