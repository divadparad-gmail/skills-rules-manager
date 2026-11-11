/**
 * Claude Code : le texte qu'il injecte pour une règle (`.claude/rules/*.md`) ou un fichier de mémoire
 * (`CLAUDE.md`), c'est-à-dire le fichier sans son frontmatter et sans ses commentaires HTML de bloc.
 * C'est ce texte que l'extension compte, en o200k, depuis le lot C1.
 *
 * Sources (suite test/scenarios/claude-code-injection-contexte/, grille SCENARIOS-CLAUDE-CODE.md) :
 * - frontmatter d'une règle retiré : testé (CC16, canari du frontmatter non vu) et documenté
 *   (https://code.claude.com/docs/en/memory.md : « Claude Code removes the frontmatter before loading
 *   the rule into context ») ;
 * - frontmatter d'un CLAUDE.md retiré : testé (CC11), non documenté ;
 * - frontmatter retiré même quand son YAML est invalide : déduit (CC21 vaut 40 en /context, contre
 *   environ 80 si son frontmatter de 20 tokens o200k était gardé) ;
 * - commentaire HTML de bloc retiré : testé (CC10) et documenté (memory.md) ; un commentaire placé
 *   dans un bloc de code est gardé : documenté (memory.md), non testé.
 *
 * Non vérifié, et traité par prudence (en cas de doute, le texte est gardé, ce qui surestime plutôt
 * que sous-estimer) :
 * - un commentaire dans une ligne de texte, ou suivi de texte sur sa ligne de fermeture, est gardé ;
 * - un commentaire jamais fermé est gardé ;
 * - un frontmatter sans ligne `---` de fermeture n'est pas retiré ;
 * - les lignes vides qui suivent le frontmatter sont retirées, comme le fait extractFrontmatter.
 *
 * Ces fonctions sont pures : elles ne lisent aucun fichier et ne servent qu'au côté Claude Code.
 * Le côté Antigravity garde ses propres règles (src/antigravity/behavior.ts).
 */

/** Variante de la clé du cache de countTokensForFile pour le texte injecté par Claude Code. */
export const CLAUDE_INJECTED_TEXT_VARIANT = 'claude-injecte';

/** Ouverture du frontmatter : une ligne `---` en tête du fichier, après d'éventuels blancs (comme extractFrontmatter). */
const FRONTMATTER_OPEN = /^---[ \t]*\r?\n/;
/** Fermeture : une ligne `---`, éventuellement suivie d'espaces. */
const FRONTMATTER_CLOSE = /(^|\r?\n)---[ \t]*(?:\r?\n|$)/;

/**
 * Sépare le frontmatter du reste : le bloc qui ouvre le fichier par une ligne `---` et se ferme par
 * une ligne `---`, que son YAML soit valide ou non. Sans frontmatter fermé, `frontmatter` vaut `null`
 * et `body` est le texte tel quel.
 */
export function splitClaudeFrontmatter(raw: string): { frontmatter: string | null; body: string } {
  const withoutBom = raw.replace(/^﻿/, '');
  const trimmed = withoutBom.trimStart();
  const open = trimmed.match(FRONTMATTER_OPEN);
  if (!open) return { frontmatter: null, body: raw };
  const rest = trimmed.slice(open[0].length);
  const close = rest.match(FRONTMATTER_CLOSE);
  if (!close || close.index === undefined) return { frontmatter: null, body: raw };
  return {
    frontmatter: rest.slice(0, close.index),
    body: rest.slice(close.index + close[0].length).replace(/^(?:[ \t]*\r?\n)+/, ''),
  };
}

/** Retire le frontmatter (voir splitClaudeFrontmatter). Sans ligne de fermeture, le texte est rendu tel quel. */
export function stripClaudeFrontmatter(raw: string): string {
  return splitClaudeFrontmatter(raw).body;
}

/** Début d'une clôture de bloc de code : trois accents graves ou tildes au moins, indentés de trois espaces au plus. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** Début d'un commentaire HTML de bloc : `<!--` en début de ligne, indenté de trois espaces au plus. */
const COMMENT_OPEN = /^ {0,3}<!--/;
/** Fin d'un commentaire de bloc : `-->` suivi seulement d'espaces jusqu'à la fin de la ligne. */
const COMMENT_CLOSE_AT_END = /-->[ \t]*$/;

/** Découpe un texte en lignes, chacune avec sa fin de ligne d'origine (LF ou CRLF). */
function splitKeepingEnds(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

const withoutEnd = (line: string) => line.replace(/\r?\n$/, '');

/**
 * Retire les commentaires HTML de bloc placés hors des blocs de code clôturés. Un commentaire de
 * bloc commence en début de ligne et se ferme en fin de ligne ; il peut couvrir plusieurs lignes,
 * qui sont retirées avec lui. Tout autre commentaire est gardé.
 */
export function stripClaudeHtmlBlockComments(text: string): string {
  const lines = splitKeepingEnds(text);
  const out: string[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = withoutEnd(lines[i]);

    if (fence !== null) {
      const close = line.match(FENCE);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length && line.trim() === close[1]) {
        fence = null;
      }
      out.push(lines[i]);
      continue;
    }

    const open = line.match(FENCE);
    if (open) {
      fence = open[1];
      out.push(lines[i]);
      continue;
    }

    if (COMMENT_OPEN.test(line)) {
      // Cherche la ligne qui ferme le commentaire ; s'il n'est jamais fermé en fin de ligne, il est gardé
      let end = -1;
      for (let j = i; j < lines.length; j++) {
        const candidate = withoutEnd(lines[j]);
        const searchFrom = j === i ? candidate.indexOf('<!--') + 4 : 0;
        const closeIndex = candidate.indexOf('-->', searchFrom);
        if (closeIndex >= 0) {
          if (COMMENT_CLOSE_AT_END.test(candidate.slice(closeIndex))) end = j;
          break;
        }
      }
      if (end >= 0) {
        i = end;
        continue;
      }
    }

    out.push(lines[i]);
  }

  return out.join('');
}

/** Le texte que Claude Code injecte pour une règle ou un fichier de mémoire : sans frontmatter ni commentaires de bloc. */
export function claudeInjectedText(raw: string): string {
  return stripClaudeHtmlBlockComments(stripClaudeFrontmatter(raw));
}
