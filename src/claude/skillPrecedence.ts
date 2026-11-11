/**
 * Claude Code : la priorité entre skills homonymes, et la copie « masquée ».
 *
 * Claude Code ne liste qu'une copie d'un skill de même nom :
 * - entre la copie personnelle (`~/.claude/skills/`) et celle du projet, la copie personnelle est
 *   listée et celle du projet ne l'est pas : mesuré et testé (CC25) ; l'ordre « entreprise,
 *   personnel, projet » : documentation (https://code.claude.com/docs/en/skills.md) ;
 * - entre deux copies du niveau projet, la plus proche du dossier de travail l'emporte : la copie du
 *   projet est listée et celle du dossier parent ne l'est pas (CC39, déduit des tokens) ;
 * - un skill de plugin homonyme est listé à part, sous son préfixe `plugin:skill` (documentation, CC26).
 *
 * Choix de l'extension :
 * - la clé d'homonymie est le `name` du frontmatter, sinon le nom du dossier, sans tenir compte de
 *   la casse (non vérifié pour Claude Code) ;
 * - seules les copies listées au démarrage entrent en concurrence : actives dans l'extension, sans
 *   `disable-model-invocation: true` ni `paths`. Une copie personnelle désactivée laisse donc la
 *   copie du projet comptée (déduit). Une copie personnelle manuelle ou avec `paths` ne masque pas la
 *   copie du projet, qui reste comptée (décision du 2026-11-11, non vérifié) ;
 * - la copie masquée coûte 0 au démarrage et n'est pas active ; il n'y a ni doublon ni gaspillage ;
 * - deux copies de même origine et de même distance (deux skills personnels de même name, par exemple)
 *   ne se masquent pas : elles restent comptées toutes les deux, par prudence, et chacune est signalée
 *   par `claudeSkillSameScopeHomonym` (non vérifié ; cas présent sur un profil réel).
 *
 * Prêt pour les sources lues plus tard, sans les lire ici : la distance au dossier de travail vient de
 * `metadata.inheritedFrom` (un skill d'un dossier parent), et l'espace de noms de `metadata.pluginName`.
 */
import { ResourceItem, TokenCategoryStat } from '../types';

export type ClaudeSkillOrigin = 'enterprise' | 'personal' | 'project';

const ORIGIN_RANK: Record<ClaudeSkillOrigin, number> = { enterprise: 0, personal: 1, project: 2 };

const isClaudeSkill = (item: ResourceItem) => item.type === 'skill' && item.targetTool === 'claude-code';

/** Vrai si le skill est listé au démarrage par Claude Code (actif, ni manuel ni limité par paths). */
const isListed = (item: ResourceItem) =>
  item.enabled && !item.metadata?.claudeSkillManualOnly && !item.metadata?.claudeSkillPathsTriggered;

/** Clé d'homonymie : espace de noms du plugin, puis le nom (name du frontmatter, sinon dossier), sans la casse. */
export function claudeSkillHomonymKey(item: ResourceItem): string {
  const name = (item.name ?? '').trim() || item.id;
  const namespace = item.metadata?.pluginName ? `${item.metadata.pluginName}:` : '';
  return `${namespace}${name}`.toLowerCase();
}

/** Origine d'une copie : personnelle pour le profil global, projet sinon (l'entreprise n'est pas lue). */
export function claudeSkillOrigin(item: ResourceItem): ClaudeSkillOrigin {
  return item.scope === 'global' ? 'personal' : 'project';
}

/** Distance au dossier de travail : 0 pour le projet, le nombre de niveaux remontés pour un dossier parent. */
export function claudeSkillDistance(item: ResourceItem): number {
  const inherited = item.metadata?.inheritedFrom;
  if (typeof inherited !== 'string' || inherited === '') return 0;
  return inherited.split(/[\\/]/).filter((segment) => segment === '..').length || 1;
}

export interface ClaudeSkillPrecedenceResult {
  globalItems: ResourceItem[];
  localItems: ResourceItem[];
  /** Les copies masquées, telles qu'elles étaient avant d'être mises à 0 (pour corriger les statistiques). */
  masked: ResourceItem[];
}

/**
 * Applique la priorité entre skills homonymes de Claude Code. Rend des copies des éléments modifiés ;
 * les autres éléments sont rendus tels quels.
 */
export function applyClaudeSkillPrecedence(globalItems: ResourceItem[], localItems: ResourceItem[]): ClaudeSkillPrecedenceResult {
  const candidates = [...globalItems, ...localItems].filter(isClaudeSkill);
  const groups = new Map<string, ResourceItem[]>();
  for (const item of candidates) {
    const key = claudeSkillHomonymKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const replacements = new Map<ResourceItem, ResourceItem>();
  const masked: ResourceItem[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const listed = group
      .filter(isListed)
      .sort((a, b) => ORIGIN_RANK[claudeSkillOrigin(a)] - ORIGIN_RANK[claudeSkillOrigin(b)] || claudeSkillDistance(a) - claudeSkillDistance(b));

    // Seule une copie strictement moins prioritaire est masquée. Deux copies de même origine et de même
    // distance (par exemple deux skills personnels de même name dans deux dossiers) restent comptées toutes
    // les deux : le choix de Claude Code entre elles n'est pas connu (non vérifié)
    const winner = listed[0];
    const losers = listed.filter((item) =>
      ORIGIN_RANK[claudeSkillOrigin(item)] > ORIGIN_RANK[claudeSkillOrigin(winner)]
      || (ORIGIN_RANK[claudeSkillOrigin(item)] === ORIGIN_RANK[claudeSkillOrigin(winner)] && claudeSkillDistance(item) > claudeSkillDistance(winner)));
    // Les copies de même origine et de même distance que la première sont toutes signalées
    const ties = listed.filter((item) => !losers.includes(item));
    if (ties.length >= 2) {
      for (const tie of ties) {
        replacements.set(tie, { ...tie, metadata: { ...tie.metadata, claudeSkillSameScopeHomonym: true } });
      }
    }
    if (losers.length > 0) {
      const currentWinner = replacements.get(winner) ?? winner;
      replacements.set(winner, {
        ...currentWinner,
        metadata: { ...currentWinner.metadata, claudeSkillMasks: losers.map((l) => ({ scope: l.scope, path: l.path })) },
      });
      for (const loser of losers) {
        masked.push(loser);
        replacements.set(loser, {
          ...loser,
          charCount: 0,
          tokenCount: 0,
          metadata: { ...loser.metadata, claudeSkillMaskedBy: { scope: winner.scope, path: winner.path } },
        });
      }
    }

    // Copie personnelle manuelle ou avec paths : la copie du projet reste comptée (non vérifié)
    const unlistedPersonal = group.some((i) => i.enabled && !isListed(i) && claudeSkillOrigin(i) === 'personal');
    if (unlistedPersonal) {
      for (const item of group) {
        if (claudeSkillOrigin(item) !== 'project' || !isListed(item) || replacements.get(item)?.metadata?.claudeSkillMaskedBy) continue;
        const current = replacements.get(item) ?? item;
        replacements.set(item, { ...current, metadata: { ...current.metadata, claudeSkillHomonymNotMasked: true } });
      }
    }
  }

  const replace = (items: ResourceItem[]) => items.map((item) => replacements.get(item) ?? item);
  return { globalItems: replace(globalItems), localItems: replace(localItems), masked };
}

const hasSkillWarning = (item: ResourceItem) => Boolean(
  item.metadata?.warningSizeExceeded ||
  item.metadata?.warningLinesExceeded ||
  item.metadata?.warningMcpExceeded ||
  item.metadata?.warningNoDescription
);

/** Retire d'une statistique de skills les copies masquées de sa portée : tokens, caractères, actifs et avertissements. */
export function withoutMaskedSkills(stat: TokenCategoryStat, masked: ResourceItem[]): TokenCategoryStat {
  const mine = masked.filter((item) => item.scope === stat.scope);
  if (mine.length === 0) return stat;
  const tokenCount = stat.tokenCount - mine.reduce((sum, i) => sum + (i.tokenCount || 0), 0);
  return {
    ...stat,
    tokenCount,
    charCount: stat.charCount - mine.reduce((sum, i) => sum + (i.charCount || 0), 0),
    activeCount: stat.activeCount - mine.length,
    ...(stat.warningCount !== undefined ? { warningCount: stat.warningCount - mine.filter(hasSkillWarning).length } : {}),
    percentage: Number(((tokenCount / 20000) * 100).toFixed(1)),
  };
}
