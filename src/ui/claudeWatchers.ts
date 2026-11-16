import * as path from 'path';
import * as vscode from 'vscode';
import { StateManager } from '../services/StateManager';
import { claudeGitEntryFs } from '../services/claudeAutoMemory';
import { getEffectiveGlobalClaudePath } from '../utils/paths';
import { claudeWatchTargets, ClaudeGitEntry } from '../claude/claudeWatchTargets';
import type { ManagerFullState } from '../types';

/**
 * Claude Code : les observateurs des fichiers de mémoire non couverts par les motifs communs
 * (src/claude/claudeWatchTargets.ts) : dans l'espace de travail (CLAUDE.local.md, imports hors de .claude/),
 * puis hors de l'espace (parents, imports extérieurs, CLAUDE.md global et ses imports, MEMORY.md, settings.json
 * du profil). Ils s'ajoutent à WATCHER_PATTERNS, qui ne change pas (décision Q11), et ne servent qu'à Claude Code.
 *
 * Un observateur par fichier visé, sur un motif relatif (dossier du fichier, nom du fichier) : aucun motif
 * récursif, ni sur le profil ni sur projects/<nom>/. À chaque état diffusé, la liste des cibles est recalculée :
 * un observateur sans cible est libéré, une cible neuve reçoit le sien, et une cible inchangée garde le sien.
 * Sous Antigravity, il n'y en a aucun. À l'arrêt de l'extension (context.subscriptions), tous sont libérés et
 * l'abonnement à l'état est retiré.
 */

/** Le rafraîchissement différé des observateurs existants (src/extension.ts) : le même délai. */
export const CLAUDE_WATCH_RELOAD_DELAY_MS = 350;

/** L'accès réel au `.git` d'un dossier, par stat seulement : celui de la mémoire automatique, sans copie. */
export const claudeGitEntry: ClaudeGitEntry = claudeGitEntryFs;

export interface ClaudeWatchersOptions {
  /** Réservé aux tests : le dernier dossier examiné en cherchant la racine Git de la mémoire automatique. */
  stopAt?: string;
}

function targetKey(file: string): string {
  return process.platform === 'win32' ? file.toLowerCase() : file;
}

export class ClaudeWorkspaceWatchers implements vscode.Disposable {
  private readonly watchers = new Map<string, vscode.FileSystemWatcher>();

  constructor(private readonly options: ClaudeWatchersOptions = {}) {}

  /** Recalcule les cibles d'après l'état, libère les observateurs sans cible et crée ceux qui manquent. */
  update(state: ManagerFullState | null | undefined): void {
    const targets = claudeWatchTargets(state, {
      globalPath: getEffectiveGlobalClaudePath(),
      gitEntry: claudeGitEntry,
      ...(this.options.stopAt !== undefined ? { stopAt: this.options.stopAt } : {}),
    });
    const wanted = new Map(targets.map((file) => [targetKey(file), file]));
    for (const [key, watcher] of this.watchers) {
      if (!wanted.has(key)) {
        watcher.dispose();
        this.watchers.delete(key);
      }
    }
    for (const [key, file] of wanted) {
      if (this.watchers.has(key)) continue;
      // Un motif relatif au dossier du fichier, sur son seul nom : seul ce fichier est observé
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file))
      );
      const reload = () => StateManager.requestDebouncedReload(CLAUDE_WATCH_RELOAD_DELAY_MS);
      watcher.onDidChange(reload);
      watcher.onDidCreate(reload);
      watcher.onDidDelete(reload);
      this.watchers.set(key, watcher);
    }
  }

  get size(): number {
    return this.watchers.size;
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) watcher.dispose();
    this.watchers.clear();
  }
}

/** Enregistre les observateurs propres à Claude Code : ils suivent chaque état diffusé par StateManager. */
export function registerClaudeWatchers(
  context: { subscriptions: Array<{ dispose(): unknown }> },
  options: ClaudeWatchersOptions = {}
): ClaudeWorkspaceWatchers {
  const watchers = new ClaudeWorkspaceWatchers(options);
  // L'abonnement est retiré avant la libération des observateurs : aucun ne peut être recréé après l'arrêt
  context.subscriptions.push(StateManager.subscribe((state) => watchers.update(state)), watchers);
  return watchers;
}
