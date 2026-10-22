import * as fs from 'fs';
import * as path from 'path';
import { ResourceItem, ResourceScope, ResourceType, SkillAnnexNote } from '../types';
import { extractFrontmatter } from '../utils/frontmatter';
import { countTokens, countTokensForFile } from '../utils/tokenizer';
import {
  countBodyLines,
  formatPluginSectionHeader,
  formatSkillIndexLine,
  hasTableOfContents,
  PLUGIN_SKILL_INDEX_COPIES,
  SKILL_ANNEX_MAX_LINES,
  SKILL_ANNEX_TOC_FROM_LINES,
  sizeAdviceFor,
} from '../antigravity/behavior';

/** Annexes lues : textes du dossier du skill, sur quelques niveaux, dans une limite raisonnable. */
const ANNEX_EXTENSIONS = new Set(['.md', '.txt']);
const ANNEX_MAX_DEPTH = 3;
const ANNEX_MAX_FILES = 200;
const ANNEX_MAX_READ_BYTES = 1024 * 1024;

/**
 * Fichiers annexes d'un skill à signaler, à titre d'information : plus de 300 lignes, ou plus
 * de 100 lignes sans table des matières. Ils ne coûtent rien au démarrage, et Antigravity ne
 * les lit que si SKILL.md y renvoie (phase 2 de l'enquête).
 */
export async function collectAnnexNotes(skillFolder: string): Promise<SkillAnnexNote[]> {
  const notes: SkillAnnexNote[] = [];
  let visited = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited >= ANNEX_MAX_FILES) return;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < ANNEX_MAX_DEPTH) await walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !ANNEX_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      if (depth === 0 && /^SKILL\.md(\.disabled)?$/.test(entry.name)) continue;
      visited++;
      try {
        if ((await fs.promises.stat(fullPath)).size > ANNEX_MAX_READ_BYTES) continue;
        const content = await fs.promises.readFile(fullPath, 'utf8');
        const lines = countBodyLines(content);
        const tooLong = lines > SKILL_ANNEX_MAX_LINES;
        const missingToc = lines > SKILL_ANNEX_TOC_FROM_LINES && !hasTableOfContents(content);
        if (tooLong || missingToc) {
          notes.push({ file: path.relative(skillFolder, fullPath).split(path.sep).join('/'), lines, tooLong, missingToc });
        }
      } catch {
        // Fichier illisible : ignoré
      }
    }
  };
  await walk(skillFolder, 0);
  return notes.sort((a, b) => a.file.localeCompare(b.file));
}

export interface AntigravitySkillItemOptions {
  scope: ResourceScope;
  /** Description affichée quand le frontmatter n'en donne pas. */
  fallbackDescription: (isWorkflow: boolean) => string;
  /** Préfixe de l'identifiant (ex. « .agent/ » pour un ancien emplacement). */
  idPrefix?: string;
  pluginName?: string;
  /** Exclu par skills.json : la carte reste affichée, désactivée. */
  excluded?: boolean;
  /** Skill intégré d'Antigravity (F7) : verrouillé, toujours actif. */
  builtin?: boolean;
  /** Ancien emplacement : compté, chargement non vérifié. */
  legacyLocation?: boolean;
}

/** Dossiers de skills (contenant SKILL.md ou SKILL.md.disabled) directement sous `skillsDir`. */
export async function listSkillFolders(skillsDir: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(skillsDir, entry.name))
      .filter((folder) => fs.existsSync(path.join(folder, 'SKILL.md')) || fs.existsSync(path.join(folder, 'SKILL.md.disabled')));
  } catch {
    return [];
  }
}

/**
 * Construit la carte d'un skill Antigravity. Son coût au démarrage est sa ligne dans l'index des
 * skills (F5) ; un skill de plugin y figure aussi dans la section du plugin (F6), donc deux fois.
 */
export async function buildAntigravitySkillItem(itemFolder: string, options: AntigravitySkillItemOptions): Promise<ResourceItem> {
  const entryName = path.basename(itemFolder);
  const skillMd = path.join(itemFolder, 'SKILL.md');
  const hasEnabledFile = fs.existsSync(skillMd);
  const activeFile = hasEnabledFile ? skillMd : path.join(itemFolder, 'SKILL.md.disabled');

  let name = entryName;
  let description = '';
  let tags: string[] = [];
  let rawContent = '';
  let fileStat: fs.Stats | null = null;
  try {
    fileStat = await fs.promises.stat(activeFile);
    rawContent = await fs.promises.readFile(activeFile, 'utf8');
    const { metadata } = extractFrontmatter(rawContent);
    if (metadata.name && typeof metadata.name === 'string') name = metadata.name;
    if (metadata.description && typeof metadata.description === 'string') description = metadata.description;
    if (Array.isArray(metadata.tags)) tags = metadata.tags;
  } catch {
    // Lecture fallback
  }

  const lineCount = rawContent ? rawContent.split(/\r\n|\r|\n/).length : 0;
  const isWorkflow = entryName.startsWith('wf-') || name.startsWith('wf-');
  const type: ResourceType = isWorkflow ? 'workflow' : 'skill';

  // F5 : la ligne porte le chemin de SKILL.md, même quand la carte est désactivée
  const indexLine = formatSkillIndexLine(name, skillMd, description);
  const copies = options.pluginName ? PLUGIN_SKILL_INDEX_COPIES : 1;
  const lineTokens = countTokensForFile(activeFile, fileStat?.size, fileStat?.mtimeMs, indexLine, 'f5');

  const metadata: NonNullable<ResourceItem['metadata']> = {
    tags,
    hasDisabledSuffix: !hasEnabledFile,
    ...(options.pluginName ? { pluginName: options.pluginName } : {}),
    ...(options.pluginName || options.idPrefix ? { rawId: entryName } : {}),
    ...(options.excluded !== undefined ? { excludedInJson: options.excluded } : {}),
    ...(options.builtin ? { builtin: true, locked: true } : {}),
    ...(options.legacyLocation ? { legacyLocation: true } : {}),
  };
  if (!options.builtin) {
    // Corps de SKILL.md, frontmatter exclu ; aucun plafond de taille n'est documenté pour un
    // skill, d'où l'absence d'alerte de 24 Ko (lot A3)
    const sizeAdvice = sizeAdviceFor('skill', countBodyLines(rawContent));
    if (sizeAdvice) metadata.sizeAdvice = sizeAdvice;
    metadata.warningLinesExceeded = sizeAdvice !== null;
    metadata.warningNoDescription = !description || description.trim().length === 0;
    const annexNotes = await collectAnnexNotes(itemFolder);
    if (annexNotes.length > 0) metadata.annexNotes = annexNotes;
  }

  return {
    id: options.pluginName ? `${options.pluginName}:${entryName}` : `${options.idPrefix ?? ''}${entryName}`,
    name: options.pluginName ? `${name} [Plugin: ${options.pluginName}]` : name,
    description: description || options.fallbackDescription(isWorkflow),
    type,
    scope: options.scope,
    enabled: options.builtin ? true : hasEnabledFile && !options.excluded,
    path: itemFolder,
    targetTool: 'antigravity',
    isFolder: true,
    charCount: indexLine.length * copies,
    tokenCount: lineTokens * copies,
    lineCount,
    metadata,
  };
}

/**
 * Tokens des en-têtes de section F6 des plugins qui ont au moins un skill actif. Les lignes de
 * leurs skills sont déjà comptées (deux fois) sur les cartes.
 */
export function pluginSectionHeadersTokens(items: ResourceItem[], pluginRoots: Map<string, string>): number {
  const plugins = new Set(
    items
      .filter((item) => (item.type === 'skill' || item.type === 'workflow') && item.enabled && item.metadata?.pluginName)
      .map((item) => item.metadata!.pluginName!)
  );
  let tokens = 0;
  for (const plugin of plugins) {
    const root = pluginRoots.get(plugin);
    if (root) tokens += countTokens(formatPluginSectionHeader(plugin, root));
  }
  return tokens;
}
