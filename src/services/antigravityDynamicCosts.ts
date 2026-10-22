import { AntigravityDynamicCosts, BudgetOverflow, GlobStack, GlobStackRule, ResourceItem } from '../types';
import { countTokens } from '../utils/tokenizer';
import { expandBraces, GLOB_REINJECTION_HEADER, ORDINARY_SESSION, RULES_BUDGET_TOKENS } from '../antigravity/behavior';
import { bootTokensOf, countsAtBoot } from './antigravityRuleItem';

/**
 * Coûts qu'Antigravity ajoute en cours de session (lot A3). Ils ne modifient pas la jauge, qui
 * compte ce qui est injecté au démarrage : ils sont affichés à côté.
 */
export function computeAntigravityDynamicCosts(items: ResourceItem[]): AntigravityDynamicCosts {
  return {
    globStacks: computeGlobStacks(items),
    budgetOverflow: computeBudgetOverflow(items),
    ordinarySession: { ...ORDINARY_SESSION },
  };
}

/** R3 : `**\/*.ts` et `*.ts` désignent les mêmes fichiers, car seul le nom de fichier compte. */
function normalizePattern(pattern: string): string {
  return pattern.replace(/^(\*\*[\\/])+/, '');
}

function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split('')
    .map((char) => (char === '*' ? '[^\\\\/]*' : char === '?' ? '[^\\\\/]' : char.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${source}$`, 'i');
}

/**
 * Vrai si tout fichier qui correspond à `narrow` correspond aussi à `wide` (`app.ts` et `*.ts`).
 * Approximation : on teste un nom d'exemple tiré de `narrow`, où chaque joker devient une lettre.
 */
function isCoveredBy(narrow: string, wide: string): boolean {
  if (narrow === wide) return false;
  const wideExpansions = expandBraces(wide).map(patternToRegExp);
  return expandBraces(narrow).every((option) => {
    const sample = option.replace(/[*?]/g, 'x');
    return wideExpansions.some((regex) => regex.test(sample));
  });
}

/**
 * Règles `glob` actives regroupées par motif de nom de fichier : toutes les règles qui
 * correspondent à un même fichier s'empilent dans le résultat de l'outil, sous un seul en-tête
 * (🧪 phase 3b). Les règles héritées des dossiers parents en font partie ; les motifs morts (R3)
 * et les règles ⛔ en sont exclus.
 */
export function computeGlobStacks(items: ResourceItem[]): GlobStack[] {
  const byPattern = new Map<string, GlobStackRule[]>();
  for (const item of items) {
    if (item.type !== 'rule' || item.metadata?.trigger !== 'glob' || !countsAtBoot(item)) continue;
    const rule: GlobStackRule = {
      id: item.id,
      name: item.name,
      scope: item.scope,
      ...(item.metadata.inheritedFrom !== undefined ? { inheritedFrom: item.metadata.inheritedFrom } : {}),
      tokensPerFile: item.tokenCount ?? 0,
    };
    const patterns = new Set((item.metadata.globPatterns ?? []).map(normalizePattern));
    for (const pattern of patterns) {
      const rules = byPattern.get(pattern) ?? [];
      rules.push(rule);
      byPattern.set(pattern, rules);
    }
  }

  const headerTokens = byPattern.size > 0 ? countTokens(GLOB_REINJECTION_HEADER) : 0;
  const patterns = [...byPattern.keys()];
  return patterns
    .map((pattern) => {
      const rules = byPattern.get(pattern)!.sort((a, b) => b.tokensPerFile - a.tokensPerFile);
      return {
        pattern,
        rules,
        tokensPerFile: rules.reduce((sum, rule) => sum + rule.tokensPerFile, 0),
        headerTokens,
        alsoMatchedBy: patterns.filter((other) => isCoveredBy(pattern, other)),
      };
    })
    .sort((a, b) => b.tokensPerFile - a.tokensPerFile || a.pattern.localeCompare(b.pattern));
}

/**
 * 📄 Non testé : au-delà de 20 000 tokens d'âme et de règles permanentes, la documentation annonce
 * que les plus gros fichiers deviennent des pointeurs. On liste ceux qui seraient concernés, du plus
 * gros au plus petit, jusqu'à repasser sous le budget, sans modifier les totaux.
 */
export function computeBudgetOverflow(items: ResourceItem[], budget = RULES_BUDGET_TOKENS): BudgetOverflow | null {
  const permanent = items.filter((item) =>
    countsAtBoot(item) && (item.type === 'soul' || (item.type === 'rule' && item.metadata?.trigger === 'always_on'))
  );
  const totalTokens = permanent.reduce((sum, item) => sum + bootTokensOf(item), 0);
  if (totalTokens <= budget) return null;

  const pointerCandidates: BudgetOverflow['pointerCandidates'] = [];
  let remaining = totalTokens;
  for (const item of [...permanent].sort((a, b) => bootTokensOf(b) - bootTokensOf(a))) {
    if (remaining <= budget) break;
    const tokens = bootTokensOf(item);
    pointerCandidates.push({ id: item.id, name: item.name, scope: item.scope, tokens });
    remaining -= tokens;
  }
  return { totalTokens, budget, pointerCandidates };
}
