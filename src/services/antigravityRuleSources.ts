/**
 * Découverte des fichiers de règles Antigravity d'un espace de travail, selon
 * https://antigravity.google/docs/rules/ :
 * - `.agents/rules/*.md` et l'ancien `.agent/rules/*.md` (analyse plate, sans sous-dossiers) ;
 * - `.agents/rules.json` (entrées et héritage) pour les règles partagées ou imbriquées ;
 * - règles limitées à un sous-dossier : `<dir>/AGENTS.md`, `<dir>/GEMINI.md`,
 *   `<dir>/.agents/AGENTS.md`, `<dir>/.agents/GEMINI.md` et `<dir>/.agents/rules/*.md`.
 */
import * as fs from 'fs';
import * as path from 'path';

export const ANTIGRAVITY_AGENT_DIRS = ['.agents', '.agent'] as const;
export const ANTIGRAVITY_STANDALONE_FILES = ['AGENTS.md', 'GEMINI.md'] as const;

/** Dossiers jamais parcourus lors de la recherche de règles imbriquées. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'out-test', 'build', 'coverage', 'vendor', 'target']);
const MAX_NESTED_DEPTH = 8;
const MAX_VISITED_DIRS = 5000;
const MAX_RULES_JSON_DEPTH = 10;

export function isRuleFileName(name: string): boolean {
  return name.endsWith('.md') || name.endsWith('.md.disabled');
}

/** Fichiers de règles présents directement dans un dossier `rules/` (sans sous-dossiers). */
export async function listFlatRuleFiles(rulesDir: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(rulesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && isRuleFileName(entry.name))
      .map((entry) => path.join(rulesDir, entry.name));
  } catch {
    return [];
  }
}

async function listRuleFilesRecursive(dir: string, base: string = dir): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRuleFilesRecursive(full, base)));
    } else if (entry.isFile() && isRuleFileName(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

/** Un motif finissant par « / » vise un dossier ; sinon un fichier, par chemin relatif ou par nom. */
function matchesRulesJsonPattern(relativeFile: string, pattern: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalizedPattern.endsWith('/')) {
    return relativeFile.startsWith(normalizedPattern) || relativeFile.includes(`/${normalizedPattern}`);
  }
  const withoutSuffix = relativeFile.replace(/\.disabled$/, '');
  return withoutSuffix === normalizedPattern || withoutSuffix.endsWith(`/${normalizedPattern}`);
}

export interface RulesJsonFile {
  path: string;
  /** Chemin relatif à la racine de l'entrée qui l'a déclaré, en barres obliques. */
  relativePath: string;
}

/**
 * Lit un `rules.json` : chaque entrée `{ path, exclude?, include_only? }` désigne un dossier
 * (parcouru récursivement) ou un fichier, relatif au dossier du `rules.json` ; `inherits`
 * charge d'autres `rules.json`. Les cycles d'héritage sont ignorés.
 */
export async function collectRulesJsonFiles(rulesJsonPath: string, visited: Set<string> = new Set()): Promise<RulesJsonFile[]> {
  const resolvedJson = path.resolve(rulesJsonPath);
  if (visited.has(resolvedJson) || visited.size >= MAX_RULES_JSON_DEPTH) return [];
  visited.add(resolvedJson);

  let config: any;
  try {
    config = JSON.parse(await fs.promises.readFile(resolvedJson, 'utf8'));
  } catch {
    return [];
  }

  const baseDir = path.dirname(resolvedJson);
  const results: RulesJsonFile[] = [];

  if (Array.isArray(config?.inherits)) {
    for (const parent of config.inherits) {
      if (typeof parent?.path === 'string') {
        results.push(...(await collectRulesJsonFiles(path.resolve(baseDir, parent.path), visited)));
      }
    }
  }

  if (Array.isArray(config?.entries)) {
    for (const entry of config.entries) {
      if (typeof entry?.path !== 'string') continue;
      const target = path.resolve(baseDir, entry.path);
      const exclude: string[] = Array.isArray(entry.exclude) ? entry.exclude.filter((p: unknown) => typeof p === 'string') : [];
      const includeOnly: string[] = Array.isArray(entry.include_only) ? entry.include_only.filter((p: unknown) => typeof p === 'string') : [];

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(target);
      } catch {
        continue;
      }

      const candidates = stat.isDirectory()
        ? (await listRuleFilesRecursive(target)).map((file) => ({ path: file, relativePath: toPosix(path.relative(target, file)) }))
        : isRuleFileName(target) ? [{ path: target, relativePath: path.basename(target) }] : [];

      for (const candidate of candidates) {
        if (includeOnly.length > 0 && !includeOnly.some((p) => matchesRulesJsonPattern(candidate.relativePath, p))) continue;
        if (exclude.some((p) => matchesRulesJsonPattern(candidate.relativePath, p))) continue;
        results.push(candidate);
      }
    }
  }

  return results;
}

export interface NestedRuleSource {
  /** Chemin absolu du fichier. */
  path: string;
  /** Dossier du projet auquel la règle est limitée, relatif à la racine, en barres obliques. */
  directoryScope: string;
  /** `standalone` : AGENTS.md / GEMINI.md sans frontmatter ; `rule` : fichier de `rules/` avec frontmatter. */
  kind: 'standalone' | 'rule';
}

/**
 * Recherche les règles limitées à un sous-dossier du projet (la racine est exclue :
 * ses règles sont lues par le scan principal). Le parcours ignore les dossiers cachés,
 * les dépendances et les sorties de compilation, et reste borné en profondeur et en nombre.
 */
export async function findNestedRuleSources(rootPath: string): Promise<NestedRuleSource[]> {
  const sources: NestedRuleSource[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootPath, depth: 0 }];
  let visited = 0;

  while (queue.length > 0 && visited < MAX_VISITED_DIRS) {
    const { dir, depth } = queue.shift()!;
    visited++;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    if (depth > 0) {
      const directoryScope = toPosix(path.relative(rootPath, dir));
      const names = new Set(entries.map((entry) => entry.name));

      for (const file of ANTIGRAVITY_STANDALONE_FILES) {
        if (names.has(file)) sources.push({ path: path.join(dir, file), directoryScope, kind: 'standalone' });
      }
      for (const agentsDir of ANTIGRAVITY_AGENT_DIRS) {
        if (!names.has(agentsDir)) continue;
        const agentsPath = path.join(dir, agentsDir);
        for (const file of ANTIGRAVITY_STANDALONE_FILES) {
          if (fs.existsSync(path.join(agentsPath, file))) {
            sources.push({ path: path.join(agentsPath, file), directoryScope, kind: 'standalone' });
          }
        }
        for (const rulePath of await listFlatRuleFiles(path.join(agentsPath, 'rules'))) {
          sources.push({ path: rulePath, directoryScope, kind: 'rule' });
        }
      }
    }

    if (depth >= MAX_NESTED_DEPTH) continue;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue;
      queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }

  return sources;
}
