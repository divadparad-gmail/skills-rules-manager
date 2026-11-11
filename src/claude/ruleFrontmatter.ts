/**
 * Claude Code : le statut d'une règle de `.claude/rules/` d'après son frontmatter.
 *
 * - Une règle sans `paths` est permanente ; une règle avec `paths` est conditionnelle et absente au
 *   démarrage : testé (CC15, CC17 ; U7 − U1 = 0).
 * - Une règle dont le YAML du frontmatter ne s'analyse pas est chargée « as if it had no `paths` »
 *   (documentation, https://code.claude.com/docs/en/memory.md) : la fixture p-yaml-invalide est
 *   présente au démarrage (mesuré et testé, CC21).
 * - Un motif qui contient `[` sans `]` qui le suive « matches nothing » (documentation, memory.md) ;
 *   la mesure montre seulement la règle absente au démarrage (phase 2, `paths: [src/**`), comme toute
 *   règle conditionnelle.
 *
 * Le critère de « YAML invalide » est celui de l'extension, déduit de deux mesures :
 * - p-yaml-invalide (CC21), chargée au démarrage, contient une tabulation dans l'indentation, un
 *   élément `- [non fermé` et une ligne `: : :` ; on ne sait pas lequel des trois fait rejeter le
 *   frontmatter (non vérifié) ;
 * - `paths: [src/**`, sans guillemets (phase 2), est absente au démarrage : Claude Code l'a lue comme
 *   un YAML valide (déduit). Le critère ne s'appuie donc pas sur un `[` non fermé.
 * Il retient une tabulation dans l'indentation, ou une ligne de premier niveau qui n'est ni un
 * commentaire, ni `clé: …` (clé simple ou citée), ni `- …`, hors d'un scalaire de bloc `|` ou `>`. Les
 * lignes indentées sont tolérées. Essayé à l'inspection du lot C1 sur 114 frontmatters réels : seule
 * p-yaml-invalide est signalée.
 *
 * `isRuleConditional` (src/utils/frontmatter.ts) reste la règle des `paths` d'un YAML valide ; elle
 * sert aussi au côté Antigravity et ne change pas.
 */
import { isRuleConditional } from '../utils/frontmatter';
import { splitClaudeFrontmatter } from './injectedText';

const KEY_LINE = /^(?:[A-Za-z0-9_.-]+|"[^"]*"|'[^']*')\s*:(?:[ \t]|$)/;
const LIST_ITEM = /^-(?:[ \t]|$)/;

/**
 * Vrai si le texte d'un frontmatter (entre les deux lignes `---`) est jugé invalide par le critère de
 * l'extension. Le contenu d'un scalaire de bloc (`|` ou `>`) est indenté : il fait partie des suites
 * indentées tolérées, et une ligne de premier niveau le termine, comme en YAML.
 */
export function isClaudeFrontmatterYamlInvalid(frontmatter: string | null): boolean {
  if (frontmatter === null) return false;
  for (const line of frontmatter.split(/\r?\n/)) {
    if (/^[ \t]*$/.test(line)) continue;
    const indent = (line.match(/^[ \t]*/) as RegExpMatchArray)[0];
    if (indent.includes('\t')) return true;
    if (indent.length > 0) continue; // suite indentée (liste, scalaire de bloc, valeur sur plusieurs lignes)
    if (line.startsWith('#') || KEY_LINE.test(line) || LIST_ITEM.test(line)) continue;
    return true;
  }
  return false;
}

/** Les motifs de `paths` qui contiennent un `[` sans `]` qui le suive. */
export function claudeUnmatchablePatterns(paths: unknown): string[] {
  const patterns = Array.isArray(paths) ? paths : typeof paths === 'string' ? [paths] : [];
  return patterns
    .filter((p): p is string => typeof p === 'string')
    .filter((p) => p.lastIndexOf('[') > p.lastIndexOf(']'));
}

export interface ClaudeRuleStatus {
  /** Règle conditionnelle (`paths` lus dans un YAML valide) : absente au démarrage. */
  isConditional: boolean;
  /** Frontmatter jugé invalide : la règle est permanente, ses `paths` sont ignorés. */
  yamlInvalid: boolean;
  /** Motifs qui ne correspondent à rien (règle conditionnelle seulement). */
  unmatchablePatterns: string[];
}

/** Le statut d'une règle Claude Code, d'après son contenu brut et les métadonnées lues par extractFrontmatter. */
export function claudeRuleStatus(raw: string, metadata: Record<string, any>): ClaudeRuleStatus {
  const { frontmatter } = splitClaudeFrontmatter(raw);
  if (isClaudeFrontmatterYamlInvalid(frontmatter)) {
    return { isConditional: false, yamlInvalid: true, unmatchablePatterns: [] };
  }
  const isConditional = isRuleConditional(metadata, 'claude-code');
  return {
    isConditional,
    yamlInvalid: false,
    unmatchablePatterns: isConditional ? claudeUnmatchablePatterns(metadata.paths) : [],
  };
}
