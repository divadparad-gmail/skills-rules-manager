/**
 * Claude Code : la ligne qu'il ajoute pour un skill à la liste des skills, au démarrage.
 *
 * - La ligne a la forme « - <nom>: <texte> » ; son coût est celui de la ligne entière, sans constante
 *   ajoutée, et le chemin du skill n'y entre pas : mesuré (CC24, même coût de +49 pour un skill du
 *   projet et un skill global au chemin plus long) ; forme de la ligne : observé (inspection).
 * - <nom> est le `name` du frontmatter, sinon le nom du dossier : c'est aussi la clé d'homonymie de
 *   l'extension (décision du 2026-11-11), non vérifiée pour Claude Code (les fixtures ont le même
 *   dossier et le même `name`).
 * - <texte> réunit `description` et `when_to_use`, coupés ensemble à 1 536 caractères : documentation
 *   (https://code.claude.com/docs/en/skills.md) ; la fin d'une description longue n'est pas vue : testé
 *   (CC27). Le séparateur entre les deux champs (un saut de ligne) n'est pas vérifié ; l'unité de la
 *   coupe (la longueur JavaScript, en unités UTF-16) est déduite, non vérifiée.
 *
 * Ces fonctions sont pures et ne servent qu'au côté Claude Code. Le catalogue NAS garde sa propre
 * signature (src/services/NasScanner.ts).
 */

/** Longueur maximale de `description` et `when_to_use` réunis (documentation, skills.md). */
export const CLAUDE_SKILL_DESCRIPTION_MAX_CHARS = 1536;

/** Variante de la clé du cache de countTokensForFile pour la ligne d'un skill. */
export const CLAUDE_SKILL_LINE_VARIANT = 'claude-skill-ligne';

/** Séparateur entre `description` et `when_to_use` (non vérifié). */
const WHEN_TO_USE_SEPARATOR = '\n';

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Le nom d'un skill dans la liste : le `name` du frontmatter, sinon le nom du dossier. */
export function claudeSkillName(metadata: Record<string, any>, folderName: string): string {
  return nonEmptyString(metadata.name) ? metadata.name : folderName;
}

export interface ClaudeSkillListing {
  /** Nom affiché dans la ligne. */
  name: string;
  /** La ligne comptée : « - <nom>: <texte> », texte coupé. */
  line: string;
  /** Longueur de `description` et `when_to_use` réunis, avant la coupe. */
  originalLength: number;
  /** Vrai si le texte dépasse la longueur maximale et a été coupé. */
  truncated: boolean;
}

/**
 * Les skills que Claude Code ne liste pas au démarrage, alors qu'ils restent actifs et utilisables :
 * - `disable-model-invocation: true` : absent de la liste destinée au modèle, testé (CC26) et documenté
 *   (skills.md, « Description not in context ») ; seul l'utilisateur peut l'appeler. La valeur doit être
 *   le booléen YAML `true` ; une chaîne citée « "true" » n'est pas reconnue (non vérifié).
 *   `user-invocable: false` ne change pas ce coût (documentation).
 * - un skill avec `paths` : absent au démarrage, mesuré (CC28, écart 0) ; il devient disponible comme
 *   commande après Read, Write ou Edit d'un fichier correspondant, pas après Glob, Grep ni cat (testé
 *   par les sorties brutes de la série 5) ; son entrée dans le contexte du modèle n'est pas mesurée.
 * Leur coût au démarrage est 0. Leur coût à l'invocation ou au déclenchement n'est pas mesuré.
 */
export interface ClaudeSkillBootStatus {
  manualOnly: boolean;
  pathsTriggered: boolean;
}

export function claudeSkillBootStatus(metadata: Record<string, any>): ClaudeSkillBootStatus {
  const paths = metadata.paths;
  const pathsTriggered = (Array.isArray(paths) && paths.some(nonEmptyString)) || nonEmptyString(paths);
  return { manualOnly: metadata['disable-model-invocation'] === true, pathsTriggered };
}

/** La ligne d'un skill dans la liste de Claude Code, d'après les métadonnées de son SKILL.md. */
export function claudeSkillListing(metadata: Record<string, any>, folderName: string): ClaudeSkillListing {
  const name = claudeSkillName(metadata, folderName);
  const text = [metadata.description, metadata.when_to_use].filter(nonEmptyString).join(WHEN_TO_USE_SEPARATOR);
  const truncated = text.length > CLAUDE_SKILL_DESCRIPTION_MAX_CHARS;
  return {
    name,
    line: `- ${name}: ${truncated ? text.slice(0, CLAUDE_SKILL_DESCRIPTION_MAX_CHARS) : text}`,
    originalLength: text.length,
    truncated,
  };
}
