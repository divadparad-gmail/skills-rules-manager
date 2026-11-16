import * as path from 'path';
import { CLAUDE_CODE_FENCE, claudeInjectedText } from './injectedText';

/**
 * Claude Code : les imports « @chemin » des fichiers de mémoire (CLAUDE.md global, fichiers du projet et
 * des dossiers parents), leur analyse, leur résolution et leur développement, de proche en proche.
 *
 * Sources (suite test/scenarios/claude-code-injection-contexte/, grille SCENARIOS-CLAUDE-CODE.md, et
 * https://code.claude.com/docs/en/memory.md, « Import additional files ») :
 * - les blocs de code clôturés et les segments de code ne sont pas analysés, et un chemin entre
 *   guillemets n'est pas un import : mesuré (CC42), et documentation ;
 * - quatre sauts au plus ; le fichier du cinquième n'est pas chargé : mesuré (CC09) ;
 * - un fichier importé deux fois est compté une fois, au premier rencontré : mesuré (CC40) ; un cycle
 *   s'arrête là, chaque fichier compté une fois : mesuré (CC43) ;
 * - le frontmatter et les commentaires de bloc d'un fichier importé sont retirés : mesuré (CC45) ;
 * - un import est extérieur quand son chemin résolu sort du dossier de travail et que le fichier qui
 *   importe est du niveau projet (projet, CLAUDE.local.md, dossiers parents), y compris l'import d'un
 *   CLAUDE.md parent vers son propre dossier ; en -p, il n'est pas chargé tant qu'il n'est pas approuvé :
 *   mesuré (CC46, CC54). Les imports du CLAUDE.md global ne sont jamais extérieurs : documentation ;
 * - « \ » suivi d'une espace donne une espace, « ~/ » donne le dossier personnel, un chemin absolu est
 *   pris tel quel, un chemin relatif se résout depuis le fichier qui importe : documentation ;
 * - un fichier de plus de 4 Mio (4 194 304 octets, strictement plus) est ignoré : documentation
 *   (« Claude Code skips a file over 4 MiB and loads none of it »), non mesuré.
 *
 * Choix de l'extension (déduits, non vérifiés) :
 * - les imports sont cherchés dans le texte injecté (sans frontmatter ni commentaires de bloc) ;
 * - un « @ » n'ouvre un import qu'en début de ligne ou après une espace, et le chemin va jusqu'à la
 *   première espace non échappée (une ponctuation collée au chemin en fait partie) ;
 * - un segment de code se ferme sur sa ligne ; un segment qui court sur plusieurs lignes n'est pas vu ;
 * - l'ordre est celui de la lecture : chaque import est développé à sa place, avant le suivant ;
 * - un fichier vu d'abord au cinquième saut, puis atteint plus tôt par un autre chemin, est chargé ;
 * - sous Windows, un import extérieur dont le chemin résolu commence par « \\ » ou « // » (\\?\ et \\.\
 *   compris) n'est ni consulté ni lu : son accès ouvrirait une connexion vers l'hôte nommé par le dépôt, que
 *   Claude Code ne fait qu'après approbation. Il a une entrée « chemin-reseau » à 0, sans développement. Les
 *   imports du CLAUDE.md global, et ceux d'un espace ouvert sur un partage, restent lus.
 *
 * Ce module est pur : il ne lit aucun fichier. Le développement passe par un port (taille, texte, clé de
 * chemin résolu) que le scanner fournit, et que les tests remplacent.
 */

/** Le nombre de sauts développés : un import du cinquième n'est pas chargé (mesuré, CC09). */
export const CLAUDE_IMPORT_MAX_HOPS = 4;

/** 4 Mio : un fichier de mémoire ou un import strictement plus grand est ignoré (documentation). */
export const CLAUDE_MEMORY_MAX_BYTES = 4 * 1024 * 1024;

/** Les fonctions de chemin utilisées (path, path.posix ou path.win32), pour tester les deux plateformes. */
export type ClaudePathApi = Pick<typeof path, 'join' | 'resolve' | 'normalize' | 'isAbsolute' | 'relative' | 'dirname' | 'sep'>;

/** Remplace les segments de code d'une ligne (`…`, ``…``) par des espaces ; un accent grave sans fermeture reste. */
function blankCodeSpans(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      out += line[i];
      i++;
      continue;
    }
    let j = i;
    while (j < line.length && line[j] === '`') j++;
    const run = j - i;
    // La fermeture est une suite d'accents graves de même longueur exactement
    let close = -1;
    let k = j;
    while (k < line.length) {
      if (line[k] !== '`') {
        k++;
        continue;
      }
      let m = k;
      while (m < line.length && line[m] === '`') m++;
      if (m - k === run) {
        close = k;
        break;
      }
      k = m;
    }
    if (close < 0) {
      out += line.slice(i, j);
      i = j;
      continue;
    }
    out += ' '.repeat(close + run - i);
    i = close + run;
  }
  return out;
}

/** Un import : « @ » en début de ligne ou après une espace, puis le chemin jusqu'à une espace non échappée. */
const IMPORT = /(^|\s)@((?:\\ |\S)+)/g;

/**
 * Les chemins importés d'un texte, dans l'ordre, tels qu'écrits (« \ » suivi d'une espace donne une
 * espace). Les blocs clôturés, les segments de code et les chemins entre guillemets sont ignorés.
 */
export function parseClaudeImports(text: string): string[] {
  const found: string[] = [];
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (fence !== null) {
      const close = line.match(CLAUDE_CODE_FENCE);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length && line.trim() === close[1]) fence = null;
      continue;
    }
    const open = line.match(CLAUDE_CODE_FENCE);
    if (open) {
      fence = open[1];
      continue;
    }
    for (const match of blankCodeSpans(line).matchAll(IMPORT)) {
      const raw = match[2];
      if (raw.startsWith('"') || raw.startsWith('\'')) continue;
      found.push(raw.replace(/\\ /g, ' '));
    }
  }
  return found;
}

/**
 * Le chemin absolu d'un import : « ~/ » sous le dossier personnel, un chemin absolu tel quel, un chemin
 * relatif depuis le dossier du fichier qui importe. `null` pour une forme non prise en charge (« ~user »).
 */
export function resolveClaudeImport(raw: string, importerDir: string, home: string, pathApi: ClaudePathApi = path): string | null {
  if (raw === '') return null;
  if (raw.startsWith('~/') || (pathApi.sep === '\\' && raw.startsWith('~\\'))) return pathApi.join(home, raw.slice(2));
  if (raw.startsWith('~')) return null;
  if (pathApi.isAbsolute(raw)) return pathApi.normalize(raw);
  return pathApi.resolve(importerDir, raw);
}

/**
 * Vrai sous Windows pour un chemin réseau, ou qui en a la forme : « \\ » ou « // » en tête, ce qui couvre
 * \\hôte\partage, \\?\UNC\… et \\.\… Toujours faux ailleurs.
 */
export function isClaudeNetworkPath(file: string, pathApi: ClaudePathApi = path): boolean {
  return pathApi.sep === '\\' && /^[\\/]{2}/.test(file);
}

/** Vrai si `target` est `dir` lui-même ou se trouve dessous. */
export function isClaudePathInside(target: string, dir: string, pathApi: ClaudePathApi = path): boolean {
  const rel = pathApi.relative(dir, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(rel));
}

/**
 * Vrai si un import est extérieur : son chemin résolu (clé) sort du dossier de travail (clé), et le
 * fichier qui importe est du niveau projet. Jamais pour un import du CLAUDE.md global.
 */
export function isClaudeImportExternal(resolvedKey: string, cwdKey: string, projectLevel: boolean, pathApi: ClaudePathApi = path): boolean {
  return projectLevel && !isClaudePathInside(resolvedKey, cwdKey, pathApi);
}

/**
 * Le libellé d'un fichier de mémoire ou d'un import, qui sert aussi d'identifiant de sa carte : relatif au
 * dossier de travail pour le niveau projet (« commun.md », « ../ext.md »), « ~/… » sous le dossier
 * personnel pour le niveau utilisateur, sinon le chemin absolu ; séparateurs « / ».
 */
export function claudeImportLabel(file: string, base: { cwd: string } | { home: string }, pathApi: ClaudePathApi = path): string {
  const slash = (p: string) => p.split(pathApi.sep).join('/');
  if ('cwd' in base) return slash(pathApi.relative(base.cwd, file));
  return isClaudePathInside(file, base.home, pathApi) ? `~/${slash(pathApi.relative(base.home, file))}` : slash(file);
}

/**
 * L'identifiant de la carte d'un import du niveau projet : son libellé, avec « ./ » devant s'il commence
 * par « ~ » ou s'il vaut « claude.md » (un fichier distinct du CLAUDE.md du projet sur un disque sensible à
 * la casse). Il ne forme ainsi jamais une paire de nom avec une carte du profil global (le CLAUDE.md
 * global, ou un import « ~/… »), puisque les doublons se cherchent par nom, sans la casse.
 */
export function claudeImportCardId(label: string): string {
  return label.startsWith('~') || label.toLowerCase() === 'claude.md' ? `./${label}` : label;
}

/** L'accès aux fichiers, fourni par l'appelant : taille (null si absent ou si ce n'est pas un fichier), texte et clé. */
export interface ClaudeImportPort {
  fileSize(file: string): number | null;
  readText(file: string): string | null;
  /** La clé de chemin résolu (liens suivis), partagée avec le dédoublonnage des fichiers de mémoire. */
  key(file: string): string;
}

/** Un fichier de mémoire dont les imports sont développés, dans l'ordre de chargement. */
export interface ClaudeImportRoot {
  path: string;
  /** Son texte injecté ; `null` s'il n'est pas lu (plus de 4 Mio) : aucun import n'est alors développé. */
  text: string | null;
  /** Vrai pour un fichier du projet, CLAUDE.local.md ou d'un dossier parent ; faux pour le CLAUDE.md global. */
  projectLevel: boolean;
}

/**
 * L'état d'un fichier importé : chargé, cinquième saut (non chargé), plus de 4 Mio (ignoré, non lu), ou
 * chemin réseau extérieur (non consulté, non lu).
 */
export type ClaudeImportState = 'charge' | 'niveau-5' | 'plus-de-4-mio' | 'chemin-reseau';

export interface ClaudeImportEntry {
  path: string;
  key: string;
  /** Le chemin absolu du fichier qui importe (un fichier de mémoire, ou un autre import). */
  importer: string;
  /** Le saut : 1 pour un import direct d'un fichier de mémoire, jusqu'à 5. */
  niveau: number;
  externe: boolean;
  etat: ClaudeImportState;
  /** Taille en octets. */
  size: number;
  /** Le texte brut, lu seulement pour un fichier chargé. */
  raw: string | null;
  /** Le texte injecté (sans frontmatter ni commentaires de bloc), pour un fichier chargé. */
  text: string | null;
}

/**
 * Développe les imports des fichiers de mémoire, dans l'ordre des racines puis de la lecture. `seen`
 * contient les clés déjà comptées (fichiers de mémoire et imports précédents) ; il reçoit celles des
 * fichiers chargés ou ignorés pour leur taille. Un fichier absent, déjà vu ou illisible n'a pas d'entrée.
 * Le fichier du cinquième saut a une entrée « niveau-5 », sans être lu. Un import extérieur vers un chemin
 * réseau a une entrée « chemin-reseau », sans qu'aucune fonction du port ne soit appelée sur son chemin.
 */
export function expandClaudeImports(
  roots: ClaudeImportRoot[],
  context: { cwd: string; home: string; seen: Set<string>; pathApi?: ClaudePathApi },
  port: ClaudeImportPort
): ClaudeImportEntry[] {
  const pathApi = context.pathApi ?? path;
  const cwdKey = port.key(context.cwd);
  const entries: ClaudeImportEntry[] = [];
  /** Les fichiers vus seulement au cinquième saut : chargés si un autre chemin les atteint plus tôt. */
  const fifthHop = new Map<string, ClaudeImportEntry>();

  const visit = (text: string, importer: string, depth: number, projectLevel: boolean) => {
    for (const raw of parseClaudeImports(text)) {
      const file = resolveClaudeImport(raw, pathApi.dirname(importer), context.home, pathApi);
      if (file === null) continue;
      if (isClaudeNetworkPath(file, pathApi)) {
        // Clé sans résolution des liens (elle consulterait l'hôte), en minuscules comme sous Windows
        const networkKey = file.toLowerCase();
        if (isClaudeImportExternal(networkKey, cwdKey, projectLevel, pathApi)) {
          if (context.seen.has(networkKey)) continue;
          context.seen.add(networkKey);
          entries.push({
            path: file, key: networkKey, importer, niveau: depth + 1, externe: true,
            etat: 'chemin-reseau', size: 0, raw: null, text: null,
          });
          continue;
        }
      }
      const size = port.fileSize(file);
      if (size === null) continue;
      const key = port.key(file);
      if (context.seen.has(key)) continue;
      const niveau = depth + 1;
      const externe = isClaudeImportExternal(key, cwdKey, projectLevel, pathApi);
      const base = { path: file, key, importer, niveau, externe, size };

      if (niveau > CLAUDE_IMPORT_MAX_HOPS) {
        if (!fifthHop.has(key)) {
          const entry: ClaudeImportEntry = { ...base, etat: 'niveau-5', raw: null, text: null };
          fifthHop.set(key, entry);
          entries.push(entry);
        }
        continue;
      }
      const earlier = fifthHop.get(key);
      if (earlier) {
        entries.splice(entries.indexOf(earlier), 1);
        fifthHop.delete(key);
      }

      if (size > CLAUDE_MEMORY_MAX_BYTES) {
        context.seen.add(key);
        entries.push({ ...base, etat: 'plus-de-4-mio', raw: null, text: null });
        continue;
      }
      const content = port.readText(file);
      if (content === null) continue;
      context.seen.add(key);
      const injected = claudeInjectedText(content);
      entries.push({ ...base, etat: 'charge', raw: content, text: injected });
      visit(injected, file, niveau, projectLevel);
    }
  };

  for (const root of roots) {
    if (root.text !== null) visit(root.text, root.path, 0, root.projectLevel);
  }
  return entries;
}
