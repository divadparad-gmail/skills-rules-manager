import * as fs from 'fs';
import { ResourceItem, ResourceScope } from '../types';
import { extractFrontmatter, extractMarkdownTitleAndSummary } from '../utils/frontmatter';
import { AntigravityRuleInspection, inspectAntigravityRule, measureAntigravitySoul } from '../utils/antigravityRules';
import { countTokensForFile } from '../utils/tokenizer';

export interface AntigravityRuleItemOptions {
  id: string;
  scope: ResourceScope;
  fallbackDescription: string;
  /** Suffixe ajouté au titre (ex: « [Plugin: x] »). */
  nameSuffix?: string;
  pluginName?: string;
  directoryScope?: string;
  fromRulesJson?: boolean;
  /** Recopie les clés du frontmatter dans les métadonnées de la carte. */
  spreadFrontmatter?: boolean;
  /** AGENTS.md / GEMINI.md : pas de frontmatter, toujours actif dans sa portée. */
  standalone?: boolean;
}

/**
 * Construit la carte d'un fichier `rules/*.md` (ou `.md.disabled`) d'Antigravity.
 */
export async function buildAntigravityRuleItem(filePath: string, options: AntigravityRuleItemOptions): Promise<ResourceItem> {
  const isDisabled = filePath.endsWith('.md.disabled');
  let rawContent = '';
  let fileStat: fs.Stats | null = null;
  try {
    fileStat = await fs.promises.stat(filePath);
    rawContent = await fs.promises.readFile(filePath, 'utf8');
  } catch {
    // Lecture fallback : carte vide
  }

  const { metadata: frontmatter } = extractFrontmatter(rawContent);
  const parsed = extractMarkdownTitleAndSummary(rawContent);
  const inspection: AntigravityRuleInspection = options.standalone
    ? {
        ...(await measureAntigravitySoul(rawContent, filePath)),
        trigger: 'always_on',
        ignored: false,
        isConditional: false,
        issues: [],
        warningNoDescription: false,
      }
    : await inspectAntigravityRule(rawContent, filePath);
  const frontmatterDescription = typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '';
  const title = parsed.title || options.id;

  return {
    id: options.id,
    name: options.nameSuffix ? `${title} ${options.nameSuffix}` : title,
    description: frontmatterDescription || parsed.summary || options.fallbackDescription,
    type: 'rule',
    scope: options.scope,
    enabled: !isDisabled,
    path: filePath,
    targetTool: 'antigravity',
    isFolder: false,
    charCount: rawContent.length,
    tokenCount: inspection.expandedTokenCount
      ?? countTokensForFile(filePath, fileStat?.size, fileStat?.mtimeMs, rawContent),
    lineCount: rawContent ? rawContent.split(/\r\n|\r|\n/).length : 0,
    metadata: {
      ...(options.spreadFrontmatter ? frontmatter : {}),
      ...(options.pluginName ? { pluginName: options.pluginName } : {}),
      ...(options.directoryScope !== undefined ? { directoryScope: options.directoryScope } : {}),
      ...(options.fromRulesJson ? { fromRulesJson: true } : {}),
      hasDisabledSuffix: isDisabled,
      isConditional: inspection.isConditional,
      ignoredByAgent: inspection.ignored,
      ruleIssues: inspection.issues,
      ...(inspection.trigger ? { trigger: inspection.trigger } : {}),
      byteSize: inspection.byteSize,
      warningSizeExceeded: inspection.warningSizeExceeded,
      warningNoDescription: inspection.warningNoDescription,
    },
  };
}

/** Une règle compte dans le budget au démarrage si elle est active, lue par l'agent et non limitée à un dossier. */
export function countsAtBoot(item: ResourceItem): boolean {
  return item.enabled && !item.metadata?.ignoredByAgent && item.metadata?.directoryScope === undefined;
}

/** Vrai si la carte porte un avertissement à remonter dans les compteurs. */
export function hasResourceWarning(item: ResourceItem): boolean {
  return Boolean(
    item.metadata?.warningSizeExceeded ||
    item.metadata?.warningLinesExceeded ||
    item.metadata?.warningMcpExceeded ||
    item.metadata?.warningNoDescription ||
    item.metadata?.ignoredByAgent ||
    (item.metadata?.ruleIssues && item.metadata.ruleIssues.length > 0)
  );
}
