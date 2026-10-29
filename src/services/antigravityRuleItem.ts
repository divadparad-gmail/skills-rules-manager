import * as fs from 'fs';
import { ResourceItem, ResourceScope } from '../types';
import { extractFrontmatter, extractMarkdownTitleAndSummary } from '../utils/frontmatter';
import { AntigravityRuleInspection, inspectAntigravityRule, measureAntigravitySoul } from '../utils/antigravityRules';
import {
  countBodyLines,
  countLines,
  ANTIGRAVITY_PROFILES,
  AntigravityBehaviorProfile,
  isAppliedStatus,
  SizeAdvice,
  SizeAdviceKind,
  sizeAdviceFor,
  SUBFOLDER_RULES_LOADED,
} from '../antigravity/behavior';

export interface AntigravityRuleItemOptions {
  id: string;
  scope: ResourceScope;
  fallbackDescription: string;
  /** Suffixe ajouté au titre (ex: « [Plugin: x] »). */
  nameSuffix?: string;
  pluginName?: string;
  /** Règle d'un plugin : comptée par prudence, chargement non vérifié dans aucune version (D-19). */
  unverifiedPluginRule?: boolean;
  /**
   * Règle issue d'une variante (`.agent`, `_agent`, `_agents`) : en profil 2.6.0, pose
   * `unverifiedVariantRule` si `.agents/` existe aussi (`cohabitation`) et/ou si le trigger reconnu
   * n'est pas `always_on` (`non-always-on`). Sans `.agents/`, une règle `always_on` est observée (phase 2c).
   */
  variantRule?: { hasPrimaryAgentsDir: boolean };
  /** Valeur explicite de `unverifiedVariantRule` (tests unitaires). */
  unverifiedVariantRule?: 'cohabitation' | 'non-always-on' | 'both';
  directoryScope?: string;
  /** Dossier parent d'où la règle est héritée (R2) : la carte est verrouillée. */
  inheritedFrom?: string;
  fromRulesJson?: boolean;
  /** Recopie les clés du frontmatter dans les métadonnées de la carte. */
  spreadFrontmatter?: boolean;
  /** AGENTS.md / GEMINI.md : pas de frontmatter, toujours actif dans sa portée. */
  standalone?: boolean;
  /** Profil de comportement : coupe d'un corps trop long, injection des règles glob (2.5.5 par défaut). */
  profile?: AntigravityBehaviorProfile;
}

/**
 * Construit la carte d'un fichier `rules/*.md` (ou `.md.disabled`) d'Antigravity.
 */
export async function buildAntigravityRuleItem(filePath: string, options: AntigravityRuleItemOptions): Promise<ResourceItem> {
  const profile = options.profile ?? ANTIGRAVITY_PROFILES['2.5.5'];
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
        ...(await measureAntigravitySoul(rawContent, filePath, fileStat, { truncation: profile.truncation })),
        trigger: 'always_on',
        ignored: false,
        isConditional: false,
        status: 'active',
        deadGlobs: [],
        globPatterns: [],
        issues: [],
        warningNoDescription: false,
      }
    : await inspectAntigravityRule(rawContent, filePath, fileStat, {
        truncation: profile.truncation,
        globInjected: profile.globInjected,
      });
  // R1 : une règle de sous-dossier n'est jamais chargée, quel que soit son frontmatter
  const status = options.directoryScope !== undefined && !SUBFOLDER_RULES_LOADED ? 'never-loaded' : inspection.status;
  const frontmatterDescription = typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '';
  const title = parsed.title || options.id;
  const sizeAdvice = ruleSizeAdvice(rawContent, inspection, isAppliedStatus(status), options.standalone === true);
  // Lot L8 : en profil 2.6.0, une règle issue d'une variante (.agent, _agent, _agents) est marquée
  // « ❔ Non vérifié » quand .agents/ existe aussi (cohabitation) et/ou quand son trigger reconnu
  // n'est pas always_on. Sans .agents/, une règle always_on de variante est observée (phase 2c).
  const unverifiedVariantRule = options.unverifiedVariantRule ?? (() => {
    if (!options.variantRule || profile.id !== '2.6.0' || inspection.ignored) return undefined;
    const cohabitation = options.variantRule.hasPrimaryAgentsDir;
    const nonAlwaysOn = inspection.trigger !== 'always_on';
    if (cohabitation && nonAlwaysOn) return 'both';
    if (cohabitation) return 'cohabitation';
    if (nonAlwaysOn) return 'non-always-on';
    return undefined;
  })();

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
    // Règle permanente : ce qui est injecté au démarrage (F1, tronqué) ; règle conditionnelle ou
    // ⛔ : le corps entier, lu quand elle s'applique (son coût au démarrage est bootTokenCount)
    tokenCount: inspection.trigger === 'always_on' && !inspection.ignored ? inspection.bootTokenCount : inspection.bodyTokenCount,
    lineCount: rawContent ? rawContent.split(/\r\n|\r|\n/).length : 0,
    metadata: {
      ...(options.spreadFrontmatter ? frontmatter : {}),
      ...(options.pluginName ? { pluginName: options.pluginName } : {}),
      ...(options.unverifiedPluginRule ? { unverifiedPluginRule: true } : {}),
      ...(unverifiedVariantRule ? { unverifiedVariantRule } : {}),
      ...(options.directoryScope !== undefined ? { directoryScope: options.directoryScope } : {}),
      ...(options.inheritedFrom !== undefined ? { inheritedFrom: options.inheritedFrom, locked: true } : {}),
      ...(options.fromRulesJson ? { fromRulesJson: true } : {}),
      hasDisabledSuffix: isDisabled,
      isConditional: inspection.isConditional,
      ignoredByAgent: inspection.ignored,
      antigravityStatus: status,
      ...(status === 'glob-no-effect' ? { noEffectIn: profile.id } : {}),
      ...(inspection.deadGlobs.length > 0 ? { deadGlobs: inspection.deadGlobs } : {}),
      ...(inspection.globPatterns.length > 0 ? { globPatterns: inspection.globPatterns } : {}),
      ruleIssues: inspection.issues,
      ...(inspection.trigger ? { trigger: inspection.trigger } : {}),
      byteSize: inspection.byteSize,
      bootTokenCount: inspection.bootTokenCount,
      bootCharCount: inspection.bootCharCount,
      ...(inspection.truncatedBytes > 0 ? { truncatedBytes: inspection.truncatedBytes, lostTokens: inspection.lostTokens } : {}),
      ...(inspection.truncatedBytes > 0 && inspection.truncationRule ? { truncationRule: inspection.truncationRule } : {}),
      warningSizeExceeded: inspection.warningSizeExceeded,
      ...(sizeAdvice ? { sizeAdvice, warningLinesExceeded: true } : {}),
      warningNoDescription: inspection.warningNoDescription,
    },
  };
}

const ADVICE_KIND_BY_TRIGGER: Partial<Record<string, SizeAdviceKind>> = {
  always_on: 'permanent',
  glob: 'glob',
  model_decision: 'model_decision',
};

/**
 * Avertissement de taille d'une règle lue par l'agent (lot A3). Une règle tronquée porte déjà
 * le badge ✂️ : un seul avertissement de taille par carte. `manual` n'a pas de recommandation.
 */
function ruleSizeAdvice(
  rawContent: string,
  inspection: AntigravityRuleInspection,
  applied: boolean,
  standalone: boolean
): SizeAdvice | null {
  if (!applied || inspection.truncatedBytes > 0 || !inspection.trigger) return null;
  const kind = ADVICE_KIND_BY_TRIGGER[inspection.trigger];
  if (!kind) return null;
  // Une âme n'a pas de frontmatter : le fichier entier est son corps
  const lines = standalone ? countLines(rawContent) : countBodyLines(rawContent);
  return sizeAdviceFor(kind, lines, kind === 'glob' ? inspection.bodyTokenCount : undefined);
}

/** Avertissement de taille d'une âme Antigravity (fichier entier, sans frontmatter), sauf si elle est tronquée. */
export function soulSizeAdvice(rawContent: string, truncatedBytes: number): SizeAdvice | null {
  return truncatedBytes > 0 ? null : sizeAdviceFor('permanent', countLines(rawContent));
}

/** Coût au démarrage d'une carte de règle ou d'âme Antigravity (formats F1 à F4). */
export function bootTokensOf(item: ResourceItem): number {
  return item.metadata?.bootTokenCount ?? 0;
}

/**
 * Vrai si l'agent lit réellement cette ressource. Les règles ⛔ (jamais chargées, ignorées,
 * ne se déclenchant jamais) restent affichées mais sortent de la jauge, des compteurs
 * « actives » et des doublons actifs. Les ressources Claude Code n'ont pas de statut.
 */
export function appliesInAntigravity(item: ResourceItem): boolean {
  return isAppliedStatus(item.metadata?.antigravityStatus);
}

/** Une règle compte dans le budget au démarrage si elle est active et réellement lue par l'agent. */
export function countsAtBoot(item: ResourceItem): boolean {
  return item.enabled && appliesInAntigravity(item);
}

/** Vrai si la carte porte un avertissement à remonter dans les compteurs (règles ⛔ comprises). */
export function hasResourceWarning(item: ResourceItem): boolean {
  return Boolean(
    item.metadata?.warningSizeExceeded ||
    item.metadata?.warningLinesExceeded ||
    item.metadata?.warningMcpExceeded ||
    item.metadata?.warningNoDescription ||
    item.metadata?.ignoredByAgent ||
    (item.metadata?.antigravityStatus && item.metadata.antigravityStatus !== 'active') ||
    (item.metadata?.ruleIssues && item.metadata.ruleIssues.length > 0)
  );
}
