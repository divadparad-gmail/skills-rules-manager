/**
 * Comportement mesuré d'Antigravity IDE : ce que l'agent charge réellement, et non ce
 * qu'annonce sa documentation (les deux divergent).
 *
 * Source unique des faits R1 à R6, vérifiés par la suite de régression
 * test/scenarios/antigravity-injection-contexte/ (voir SCENARIOS.md dans ce dossier), des
 * formats F1 à F8 injectés au démarrage, qui fondent le comptage des tokens, et des
 * recommandations de taille et coûts dynamiques du lot A3 (en fin de module).
 * Si la suite montre un changement de comportement, c'est ce module qu'il faut mettre à jour :
 * le scanner, l'import et le déploiement Discovery s'appuient tous sur lui.
 */
import * as fs from 'fs';
import * as path from 'path';

export const ANTIGRAVITY_TESTED_VERSION = 'Antigravity IDE 2.5.5';
export const ANTIGRAVITY_TESTED_ON = '2026-10-21';

/**
 * R6 (SC07) : dans `rules/`, un fichier sans frontmatter, ou dont le `trigger` n'est pas
 * l'une de ces valeurs exactes, est ignoré silencieusement.
 */
export const ANTIGRAVITY_RULE_TRIGGERS = ['always_on', 'model_decision', 'glob', 'manual'] as const;
export type AntigravityRuleTrigger = (typeof ANTIGRAVITY_RULE_TRIGGERS)[number];

/**
 * Statut d'une règle vis-à-vis de l'agent :
 * - active / partial : la règle s'applique (partial : certains motifs `globs` sont morts, R3) ;
 * - never-loaded : règle d'un sous-dossier du dossier ouvert, jamais chargée (R1) ;
 * - never-triggers : tous les motifs `globs` contiennent un dossier (R3) ;
 * - ignored-yaml-list : `globs` écrit en liste YAML (R4) ;
 * - ignored : frontmatter absent ou `trigger` invalide (R6).
 */
export type AntigravityRuleStatus =
  | 'active'
  | 'partial'
  | 'never-loaded'
  | 'never-triggers'
  | 'ignored-yaml-list'
  | 'ignored';

/** Vrai si une règle de ce statut est réellement lue par l'agent. */
export function isAppliedStatus(status: AntigravityRuleStatus | undefined): boolean {
  return status === undefined || status === 'active' || status === 'partial';
}

/**
 * R1 (SC08) : les règles des sous-dossiers du dossier ouvert ne sont jamais chargées,
 * ni à la lecture, ni à la modification, ni au listing.
 */
export const SUBFOLDER_RULES_LOADED = false;

/**
 * R2 (étalonnage du 2026-10-21) : les règles des dossiers parents, jusqu'à la racine du
 * dépôt Git, sont chargées avec leur trigger habituel. Seuls ces emplacements ont été vus
 * chargés. Non testés chez les parents, donc non lus : `.agents/AGENTS.md`,
 * `.agents/GEMINI.md` et l'ancien `.agent/rules/`.
 */
export const PARENT_SOUL_FILES = ['AGENTS.md', 'GEMINI.md'] as const;
export const PARENT_RULES_DIR = path.join('.agents', 'rules');

/** Garde-fou contre une arborescence anormalement profonde. */
const MAX_PARENT_LEVELS = 64;

export interface ParentRuleScan {
  /** Racine du dépôt Git, ou null si aucun dossier `.git` n'a été trouvé. */
  gitRoot: string | null;
  /** Dossiers parents à lire, du plus proche au plus lointain (racine Git comprise). */
  parentDirs: string[];
}

/**
 * Remonte depuis le dossier ouvert jusqu'à la racine du dépôt Git (dossier qui contient
 * `.git`, dossier ou fichier pour un worktree). Sans dépôt, on ne sait pas jusqu'où
 * Antigravity remonte (hypothèse non testée) : aucun parent n'est alors retenu.
 */
export function findParentRuleDirs(workspaceRoot: string): ParentRuleScan {
  const hasGit = (dir: string) => fs.existsSync(path.join(dir, '.git'));
  let current = path.resolve(workspaceRoot);
  if (hasGit(current)) return { gitRoot: current, parentDirs: [] };

  const parentDirs: string[] = [];
  for (let level = 0; level < MAX_PARENT_LEVELS; level++) {
    const parent = path.dirname(current);
    if (parent === current) break;
    parentDirs.push(parent);
    if (hasGit(parent)) return { gitRoot: parent, parentDirs };
    current = parent;
  }
  return { gitRoot: null, parentDirs: [] };
}

export interface GlobsVerdict {
  status: 'active' | 'partial' | 'never-triggers' | 'yaml-list';
  patterns: string[];
  /** Motifs qui contiennent un dossier : ils ne se déclencheront jamais (R3). */
  deadPatterns: string[];
}

/** Retire les préfixes `**\/` en tête d'un motif. */
function stripLeadingGlobstars(pattern: string): string {
  return pattern.replace(/^(\*\*[\\/])+/, '');
}

/**
 * R3 (SC02, SC03) : un motif est comparé au nom de fichier seul ; `*.ts`, `**\/*.ts` et
 * `app.ts` fonctionnent, tout motif qui garde un dossier ne se déclenche jamais.
 * R4 (SC04) : `globs` en liste YAML est rejeté silencieusement.
 */
export function validateGlobs(globs: unknown): GlobsVerdict {
  if (Array.isArray(globs)) {
    return { status: 'yaml-list', patterns: globs.map(String), deadPatterns: [] };
  }
  const patterns = String(globs ?? '')
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  const deadPatterns = patterns.filter((pattern) => /[\\/]/.test(stripLeadingGlobstars(pattern)));
  const status = patterns.length > 0 && deadPatterns.length === patterns.length
    ? 'never-triggers'
    : deadPatterns.length > 0 ? 'partial' : 'active';
  return { status, patterns, deadPatterns };
}

/** Développe les accolades d'un motif glob (`src/*.{ts,tsx}` → `src/*.ts`, `src/*.tsx`). */
export function expandBraces(pattern: string): string[] {
  const match = pattern.match(/\{([^{}]*)\}/);
  if (!match || match.index === undefined) return [pattern];
  const before = pattern.slice(0, match.index);
  const after = pattern.slice(match.index + match[0].length);
  return match[1].split(',').flatMap((option) => expandBraces(`${before}${option}${after}`));
}

export interface PathsConversion {
  trigger: 'glob' | 'model_decision' | 'always_on';
  /** Chaîne `globs` (jamais une liste), pour `trigger: glob`. */
  globs?: string;
  /** Dossiers que seul `model_decision` peut désigner (dernière partie `*` ou `**`). */
  folders: string[];
  /** Dernières parties retenues (`*.ts`, `package.json`), sans doublon. */
  fileNames: string[];
  warnings: string[];
}

/** Dossier désigné par un motif dont la dernière partie ne nomme aucun fichier (`docs/**` → `docs/`). */
function folderOf(pattern: string): string {
  const segments = pattern.split(/[\\/]/);
  const firstGlob = segments.findIndex((segment) => segment.includes('*'));
  const kept = segments.slice(0, firstGlob === -1 ? segments.length - 1 : firstGlob).filter(Boolean);
  return kept.length > 0 ? `${kept.join('/')}/` : './';
}

/**
 * Convertit les `paths:` d'une règle Claude Code en déclencheur Antigravity qui se
 * déclenche vraiment (R3, R4) : on garde la dernière partie de chaque motif, en une
 * chaîne ; un motif qui ne nomme aucun fichier (`docs/**`) impose `model_decision`.
 */
export function convertClaudePaths(paths: string[]): PathsConversion {
  const expanded = paths.map((p) => p.trim()).filter(Boolean).flatMap(expandBraces);
  if (expanded.length === 0) return { trigger: 'always_on', folders: [], fileNames: [], warnings: [] };

  const fileNames: string[] = [];
  const folders: string[] = [];
  let widened = false;
  for (const pattern of expanded) {
    const lastPart = pattern.split(/[\\/]/).pop() ?? '';
    if (lastPart === '' || lastPart === '*' || lastPart === '**') {
      const folder = folderOf(pattern);
      if (!folders.includes(folder)) folders.push(folder);
      continue;
    }
    if (/[\\/]/.test(stripLeadingGlobstars(pattern))) widened = true;
    if (!fileNames.includes(lastPart)) fileNames.push(lastPart);
  }

  if (folders.length > 0) {
    const named = [...folders, ...fileNames].map((f) => `\`${f}\``).join(', ');
    return {
      trigger: 'model_decision',
      folders,
      fileNames,
      warnings: [
        `Aucun motif de nom de fichier ne peut cibler ${named} : la règle devient « trigger: model_decision », et l'agent la lira quand la tâche concerne ces fichiers.`,
      ],
    };
  }

  const globs = fileNames.join(', ');
  const listed = fileNames.map((f) => `\`${f}\``).join(', ');
  return {
    trigger: 'glob',
    globs,
    folders: [],
    fileNames,
    warnings: widened
      ? [`Portée élargie : Antigravity ne peut pas cibler un dossier ; la règle s'appliquera à tous les fichiers ${listed} du projet.`]
      : [],
  };
}

// ---------------------------------------------------------------------------------------------
// Ce qu'Antigravity injecte au démarrage (lot A2). Formats cités par les rapports bruts de
// l'enquête : test/scenarios/antigravity-injection-contexte/historique/2026-10-21/.
// Le coût affiché par la jauge est le nombre de tokens o200k de ces chaînes reconstruites.
// ---------------------------------------------------------------------------------------------

/**
 * Plafond d'une règle permanente ou d'une âme, en octets UTF-8 du corps sans frontmatter,
 * inclusions développées. Mesuré (phase 1 et suite de régression) : 14 978 octets coupés sur
 * `06-rule-warn-size-exceeded-24kb.md`, 5 957 sur `r-tronque.md`, soit exactement le corps moins
 * 24 000 octets. Le corps commence juste après le `---` fermant : sa fin de ligne en fait partie.
 */
export const RULE_BODY_MAX_BYTES = 24000;

/** Découpe une règle en frontmatter (jusqu'au `---` fermant, sans sa fin de ligne) et corps. */
export function splitRuleBody(content: string): { frontmatter: string; body: string } {
  const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/.exec(content);
  return match ? { frontmatter: match[0], body: content.slice(match[0].length) } : { frontmatter: '', body: content };
}

export interface TruncatedBody {
  /** Partie gardée par Antigravity. */
  kept: string;
  /** Partie coupée (vide si le corps tient dans le plafond). */
  lost: string;
  /** Octets coupés, tels qu'annoncés par le marqueur `<truncated N bytes>`. */
  truncatedBytes: number;
}

/**
 * Coupe un corps à RULE_BODY_MAX_BYTES octets sans couper un caractère UTF-8. Ce que fait
 * Antigravity au milieu d'un caractère n'a pas été observé : on recule au caractère précédent.
 */
export function truncateRuleBody(body: string): TruncatedBody {
  const bytes = Buffer.from(body, 'utf8');
  if (bytes.length <= RULE_BODY_MAX_BYTES) return { kept: body, lost: '', truncatedBytes: 0 };
  let end = RULE_BODY_MAX_BYTES;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  const kept = bytes.subarray(0, end).toString('utf8');
  return { kept, lost: body.slice(kept.length), truncatedBytes: bytes.length - end };
}

/**
 * Chemin sous la forme URI qu'Antigravity affiche dans l'index des règles conditionnelles et
 * l'en-tête des plugins (phase 3b) : `file:///`, lettre de lecteur en minuscule, barres obliques,
 * espaces encodés en `%20`. L'encodage des autres caractères n'a pas été observé.
 */
export function toAntigravityUri(filePath: string): string {
  const absolute = path.resolve(filePath).replace(/\\/g, '/');
  const encode = (rest: string) => rest.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  const drive = /^([A-Za-z]):(\/.*)?$/.exec(absolute);
  return drive ? `file:///${drive[1].toLowerCase()}:${encode(drive[2] ?? '/')}` : `file://${encode(absolute)}`;
}

/**
 * F1 (phase 1) : règle permanente, âme ou règle héritée, injectée entre deux balises qui portent
 * le chemin absolu (Windows, avec `\`) : le chemin apparaît deux fois. Le corps est injecté sans
 * frontmatter et, au-delà du plafond, se termine par `<truncated N bytes>`. Les sauts de ligne
 * exacts autour du corps n'ont pas été observés.
 */
export function formatPermanentRule(filePath: string, body: string): { text: string; truncation: TruncatedBody } {
  const truncation = truncateRuleBody(body);
  const marker = truncation.truncatedBytes > 0 ? `<truncated ${truncation.truncatedBytes} bytes>` : '';
  const shown = truncation.kept.replace(/^(?:\r?\n)+/, '');
  return { text: `<RULE[${filePath}]>\n${shown}${marker}\n</RULE[${filePath}]>\n`, truncation };
}

/**
 * F2 (phase 1) : en-tête de l'index des règles conditionnelles. Un seul index a été observé,
 * règles globales et locales confondues : l'en-tête compte une seule fois en tout, dès qu'une
 * règle `model_decision` est chargée.
 */
export const CONDITIONAL_RULES_HEADER =
  'The following are conditional rules, formatted as: - [absolute path]: [description].\n' +
  'The description provides conditions under which the rule applies. If you believe a rule should apply, view the file for further instructions.\n';

/** F3 (phases 1 et 2) : entrée de l'index pour une règle `model_decision`. */
export function formatConditionalIndexEntry(filePath: string, description: string): string {
  return `- ${toAntigravityUri(filePath)}: ${description}\n`;
}

/** F4 (phases 1, 2 et 3b) : une règle `glob` ou `manual` n'injecte rien au démarrage. */
export const TRIGGERS_WITHOUT_BOOT_COST: readonly AntigravityRuleTrigger[] = ['glob', 'manual'];

/** F5 (phase 1) : en-tête de l'index des skills, injecté une seule fois. */
export const SKILLS_INDEX_HEADER = 'Available skills:\n';

/** F5 (phases 1 et 2) : une ligne par skill, chemin absolu Windows de SKILL.md, nom sans préfixe de plugin. */
export function formatSkillIndexLine(name: string, skillMdPath: string, description: string): string {
  return `- ${name} (${skillMdPath}): ${description}\n`;
}

/**
 * F6 (phase 2) : en-tête de la section d'un plugin. Ses skills y sont relistés au format F5, en
 * plus de l'index des skills : chaque skill de plugin est donc injecté deux fois.
 */
export function formatPluginSectionHeader(pluginName: string, pluginRoot: string): string {
  return `# ${pluginName} (${toAntigravityUri(pluginRoot)})\nSkills:\n`;
}
export const PLUGIN_SKILL_INDEX_COPIES = 2;

/**
 * F7 (phase 1) : skills intégrés, listés dans l'index F5 et impossibles à retirer. Chemin relatif
 * au dossier `~/.gemini`. Il y en avait 3 sur le poste de test en 2.5.5.
 */
export const BUILTIN_SKILLS_DIR = path.join('antigravity-ide', 'builtin', 'skills');

/**
 * 📄 Anciens emplacements de skills, documentés comme supportés mais non testés : `.agent/skills/`
 * dans le projet, `~/.gemini/antigravity/skills/` (relatif au dossier `~/.gemini`). Ils sont
 * comptés, avec un badge « chargement non vérifié ».
 */
export const LEGACY_WORKSPACE_SKILLS_DIR = path.join('.agent', 'skills');
export const LEGACY_GLOBAL_SKILLS_DIR = path.join('antigravity', 'skills');

/**
 * F8 (phase 1) : un titre par serveur MCP, puis `Eager:` et/ou `Lazy:` suivis des seuls noms
 * d'outils, un par ligne. Aucune description, aucun schéma. Le critère qui sépare Eager et Lazy
 * est inconnu ; seul `Lazy:` a été observé.
 */
export function formatMcpServer(serverName: string, toolNames: string[] | null): string {
  const tools = toolNames && toolNames.length > 0 ? `Lazy:\n${toolNames.join('\n')}\n` : '';
  return `# ${serverName}\n${tools}`;
}

/**
 * 🧪 Observé, non documenté (phase 1) : Antigravity garde un fichier de schéma par outil dans
 * `~/.gemini/antigravity-ide/mcp/<serveur>/<outil>.json` (chemin relatif au dossier `~/.gemini`).
 * Ce cache, moins `disabledTools`, redonnait exactement les outils listés au démarrage. Un
 * serveur qui ne se connecte pas n'affiche pas ses outils : le cache peut alors surestimer.
 */
export const MCP_TOOL_CACHE_DIR = path.join('antigravity-ide', 'mcp');

/** Fourchette affichée par outil quand la liste des outils d'un serveur est inconnue. */
export const MCP_TOKENS_PER_TOOL_RANGE = [3, 8] as const;

/**
 * Les serveurs `disabled: true` sont exclus de la jauge. Le fichier global lu reste
 * `~/.gemini/config/mcp_config.json` : le recoupement de la phase 1 ne désigne aucun des deux
 * fichiers globaux du poste (voir docs/chantier-A-ecarts-algorithme.md), non testé directement.
 */
export const MCP_DISABLED_SERVERS_COUNTED = false;

/**
 * 📄 Documentation, non testé : un serveur distant doit être déclaré avec `serverUrl` ;
 * `url` et `httpUrl` ne sont pas supportés par Antigravity.
 */
export function isUnsupportedRemoteMcpServer(config: unknown): boolean {
  if (!config || typeof config !== 'object') return false;
  const server = config as Record<string, unknown>;
  return server.serverUrl === undefined && (server.url !== undefined || server.httpUrl !== undefined);
}

// ---------------------------------------------------------------------------------------------
// Recommandations de taille et coûts dynamiques (lot A3), reprises de l'onglet Antigravity du
// guide. Sources : 📰 recommandation Google, 📘 recommandation Anthropic, 🧪 testé,
// 📄 documentation Antigravity, 🧮 calculé à partir des mesures, ❔ non vérifié.
// Une « ligne » est une ligne du corps : frontmatter exclu, lignes vides comprises.
// ---------------------------------------------------------------------------------------------

export type SizeAdviceKind = 'permanent' | 'glob' | 'model_decision' | 'skill';

/**
 * Seuils recommandés par type de fichier ; l'avertissement se déclenche au-delà.
 * - permanent : âme, règle permanente, règle d'un dossier parent, < 200 lignes 📰📘 ;
 * - glob : < 30 lignes et ≤ ~420 tokens de corps, car réinjectée à chaque fichier correspondant 🧪🧮 ;
 * - model_decision : < 200 lignes 📘 ;
 * - skill : corps de SKILL.md < 500 lignes 📘. Aucun plafond n'est documenté pour un skill 📄 :
 *   le plafond de 24 000 octets ne vaut que pour les règles et les âmes.
 * `manual` n'a pas de recommandation dans le guide.
 */
export const SIZE_RECOMMENDATIONS: Record<SizeAdviceKind, { maxLines: number; maxTokens?: number }> = {
  permanent: { maxLines: 200 },
  glob: { maxLines: 30, maxTokens: 420 },
  model_decision: { maxLines: 200 },
  skill: { maxLines: 500 },
};

/** Fichier annexe d'un skill : recommandé sous 300 lignes 🧮, table des matières au-delà de 100 lignes 📘. */
export const SKILL_ANNEX_MAX_LINES = 300;
export const SKILL_ANNEX_TOC_FROM_LINES = 100;

/** Nombre de lignes d'un texte ; la fin de ligne finale n'ouvre pas une ligne de plus. */
export function countLines(text: string): number {
  if (text === '') return 0;
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

/** Lignes du corps d'une règle ou d'un SKILL.md, sans le frontmatter ni la fin de ligne du `---` fermant. */
export function countBodyLines(content: string): number {
  return countLines(splitRuleBody(content).body.replace(/^\r?\n/, ''));
}

export interface SizeAdvice {
  kind: SizeAdviceKind;
  lines: number;
  maxLines: number;
  /** Tokens du corps, comparés au seuil des règles `glob` seulement. */
  tokens?: number;
  maxTokens?: number;
}

/** Avertissement de taille, ou null si le fichier respecte la recommandation de son type. */
export function sizeAdviceFor(kind: SizeAdviceKind, lines: number, tokens?: number): SizeAdvice | null {
  const { maxLines, maxTokens } = SIZE_RECOMMENDATIONS[kind];
  const tooManyLines = lines > maxLines;
  const tooManyTokens = maxTokens !== undefined && tokens !== undefined && tokens > maxTokens;
  if (!tooManyLines && !tooManyTokens) return null;
  return {
    kind,
    lines,
    maxLines,
    ...(maxTokens !== undefined && tokens !== undefined ? { tokens, maxTokens } : {}),
  };
}

/**
 * Heuristique : une table des matières est un titre « Table des matières », « Sommaire »
 * ou « Contents », ou au moins 3 liens vers des ancres internes `](#…)`.
 */
export function hasTableOfContents(content: string): boolean {
  if (/^#{1,6}\s*(table des mati[eè]res|sommaire|contents|table of contents)\b/im.test(content)) return true;
  return (content.match(/\]\(#[^)\s]+\)/g) ?? []).length >= 3;
}

/**
 * 🧪 (phase 3b) : une règle `glob` est ajoutée à la fin du résultat de l'outil qui lit, modifie ou
 * crée un fichier dont le nom correspond, sous cet en-tête, avec toutes les règles qui correspondent
 * au même fichier. L'enveloppe de chaque règle n'a pas été observée : seul son corps est compté.
 */
export const GLOB_REINJECTION_HEADER =
  'The following text is not part of the file, it is a list of user-defined rules that you MUST follow:\n';

/** ❔ Chaque copie réinjectée reste dans l'historique de la conversation : déduit, non mesuré. */
export const GLOB_COPIES_PERSISTENCE_MEASURED = false;

/** 🧮 Session ordinaire retenue par le guide pour chiffrer le coût d'une règle `glob`. */
export const ORDINARY_SESSION = { reads: 15, writes: 5 } as const;

/**
 * 📄 Budget de l'âme et des règles permanentes. Au-delà, la documentation annonce que les plus
 * gros fichiers deviennent des pointeurs `- <chemin>: <description>`. Non testé : les totaux ne
 * sont pas modifiés, seul un avertissement est affiché.
 */
export const RULES_BUDGET_TOKENS = 20000;
export const RULES_BUDGET_POINTERS_TESTED = false;
