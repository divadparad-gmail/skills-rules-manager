import * as fs from 'fs';
import * as path from 'path';
import { ResourceItem, ResourceScope, ResourceType } from '../types';
import { extractFrontmatter } from '../utils/frontmatter';
import { countTokens, countTokensForFile } from '../utils/tokenizer';
import { formatPluginSectionHeader, formatSkillIndexLine, PLUGIN_SKILL_INDEX_COPIES } from '../antigravity/behavior';

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
    metadata.warningLinesExceeded = lineCount > 500;
    metadata.warningSizeExceeded = rawContent.length > 24000;
    metadata.warningNoDescription = !description || description.trim().length === 0;
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
