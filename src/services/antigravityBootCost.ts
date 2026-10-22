import { ResourceItem, TokenCategoryStat } from '../types';
import { countTokens } from '../utils/tokenizer';
import { CONDITIONAL_RULES_HEADER, SKILLS_INDEX_HEADER } from '../antigravity/behavior';
import { bootTokensOf } from './antigravityRuleItem';

/**
 * Coût au démarrage des règles Antigravity chargées : F1 pour les permanentes (déjà dans leur
 * tokenCount), F3 pour `model_decision`, 0 pour `glob` et `manual` (F4). L'en-tête F2 n'est pas
 * compris : il est ajouté une seule fois pour toute la jauge (applyAntigravityIndexHeaders).
 */
export function antigravityRulesBootStat(bootRules: ResourceItem[]): Pick<TokenCategoryStat, 'tokenCount' | 'conditionalIndexCount'> {
  const tokenCount = bootRules.reduce((sum, item) => sum + bootTokensOf(item), 0);
  const conditionalIndexCount = bootRules.filter((item) => item.metadata?.trigger === 'model_decision').length;
  return { tokenCount, conditionalIndexCount };
}

/** Éléments chargés tronqués à 24 000 octets, et tokens perdus. */
export function truncationSummary(items: ResourceItem[]): Pick<TokenCategoryStat, 'truncatedCount' | 'lostTokens'> {
  const truncated = items.filter((item) => (item.metadata?.truncatedBytes ?? 0) > 0);
  return {
    truncatedCount: truncated.length,
    lostTokens: truncated.reduce((sum, item) => sum + (item.metadata?.lostTokens ?? 0), 0),
  };
}

function addOverhead(stat: TokenCategoryStat, tokens: number, budget: number): void {
  stat.overheadTokens = (stat.overheadTokens ?? 0) + tokens;
  stat.tokenCount += tokens;
  stat.percentage = Number(((stat.tokenCount / budget) * 100).toFixed(1));
}

/**
 * Ajoute à la jauge les en-têtes injectés une seule fois en tout, quelle que soit la portée :
 * - F2, l'en-tête de l'index des règles conditionnelles, dès qu'une règle `model_decision` est
 *   chargée ; rangé dans les règles locales s'il en existe une, sinon dans les règles globales ;
 * - F5, l'en-tête de l'index des skills, rangé dans les skills globaux (les skills intégrés y sont
 *   toujours), dès qu'un skill est actif.
 */
export function applyAntigravityIndexHeaders(
  stats: { rulesGlobal: TokenCategoryStat; rulesLocal: TokenCategoryStat; skillsGlobal: TokenCategoryStat; skillsLocal: TokenCategoryStat },
  budget: number
): void {
  if ((stats.rulesLocal.conditionalIndexCount ?? 0) > 0) {
    addOverhead(stats.rulesLocal, countTokens(CONDITIONAL_RULES_HEADER), budget);
  } else if ((stats.rulesGlobal.conditionalIndexCount ?? 0) > 0) {
    addOverhead(stats.rulesGlobal, countTokens(CONDITIONAL_RULES_HEADER), budget);
  }
  if (stats.skillsGlobal.activeCount + stats.skillsLocal.activeCount > 0) {
    addOverhead(stats.skillsGlobal, countTokens(SKILLS_INDEX_HEADER), budget);
  }
}
