import * as fs from 'fs';
import * as path from 'path';
import { ResourceItem, ResourceScope } from '../types';
import { extractFrontmatter } from '../utils/frontmatter';
import { countTokens, countTokensForFile } from '../utils/tokenizer';
import { countLines, splitRuleBody } from '../antigravity/behavior';

/** Emplacement d'un workflow Markdown (voir la métadonnée `markdownWorkflowSource`). */
export type MarkdownWorkflowSource = 'workspace' | 'global' | 'workspace-variant' | 'ignored';

export interface AntigravityWorkflowItemOptions {
  scope: ResourceScope;
  /** Préfixe de l'identifiant, qui nomme l'emplacement (ex. « .agents/workflows/ »). */
  idPrefix: string;
  source: MarkdownWorkflowSource;
  /** Profil d'Antigravity IDE (ex. « 2.6.0 ») qui ne lit pas cet emplacement : statut `not-read`, non compté. */
  notReadBy?: string;
}

/** Workflows Markdown (`<nom>.md`) placés directement dans `dir`, dans l'ordre alphabétique. */
export async function listWorkflowFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => path.join(dir, entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Construit la carte d'un workflow Markdown d'Antigravity IDE 2.6.0 (sonde du 2026-11-02, Antigravity
 * IDE 2.6.0) :
 * - nom : celui du fichier sans `.md` (🧪 la liste « / » affiche le nom du fichier) ;
 * - coût au démarrage nul : ni son nom, ni sa description, ni son corps ne figurent dans le prompt
 *   système (🧪) ;
 * - nom et description comptés dans le budget « Other Customizations », comme dans le panneau Settings
 *   (🧪 ; le panneau compte le nom plus la description, sans le corps). La forme exacte comptée n'étant
 *   pas connue, l'extension compte le nom et la description séparément (o200k) ;
 * - `tokenCount` : le corps sans frontmatter, injecté en entier à l'invocation `/<nom>` seulement
 *   (🧪 pour `.agents/workflows/`, déduit pour `~/.gemini/config/global_workflows/`).
 * La carte est en lecture seule : aucun état désactivé d'un workflow n'est connu.
 */
export async function buildAntigravityWorkflowItem(filePath: string, options: AntigravityWorkflowItemOptions): Promise<ResourceItem> {
  const name = path.basename(filePath).replace(/\.md$/i, '');
  let content = '';
  let fileStat: fs.Stats | null = null;
  try {
    fileStat = await fs.promises.stat(filePath);
    content = await fs.promises.readFile(filePath, 'utf8');
  } catch {
    // Fichier illisible : carte vide
  }
  const metadataDescription = content ? extractFrontmatter(content).metadata.description : undefined;
  const description = typeof metadataDescription === 'string' ? metadataDescription.trim() : '';
  const body = splitRuleBody(content).body;
  const bodyTokens = countTokensForFile(filePath, fileStat?.size, fileStat?.mtimeMs, body, 'workflow-body');

  return {
    id: `${options.idPrefix}${name}`,
    name,
    description: description || 'Workflow Markdown',
    type: 'workflow',
    scope: options.scope,
    enabled: true,
    path: filePath,
    targetTool: 'antigravity',
    isFolder: false,
    charCount: body.length,
    tokenCount: bodyTokens,
    lineCount: countLines(body),
    ...(fileStat ? { mtimeMs: fileStat.mtimeMs } : {}),
    metadata: {
      markdownWorkflow: true,
      markdownWorkflowSource: options.source,
      locked: true,
      bootTokenCount: 0,
      bootCharCount: 0,
      personalizationTokenCount: countTokens(name) + countTokens(description),
      ...(options.notReadBy ? { antigravityStatus: 'not-read' as const, notReadBy: options.notReadBy } : {}),
    },
  };
}

/** Workflows Markdown actifs (emplacement lu par le profil) : nom et description, dans « Other Customizations ». */
export function markdownWorkflowPersonalizationTokens(items: ResourceItem[]): number {
  return items
    .filter((item) => item.metadata?.markdownWorkflow && item.metadata.antigravityStatus !== 'not-read')
    .reduce((sum, item) => sum + (item.metadata?.personalizationTokenCount ?? 0), 0);
}
