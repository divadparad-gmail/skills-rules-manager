/**
 * Sondage du contexte d'exécution de l'agent : Anti-Gravity ou Claude Code
 * (§3.6 du PRD).
 *
 * À la différence de la détection d'hôte, qui identifie l'IDE, cette sonde
 * identifie l'agent avec lequel les compétences devront dialoguer. Elle
 * combine les variables d'environnement du processus et les signatures de
 * fichiers présentes à la racine de l'espace de travail, et bascule en temps
 * réel lorsque ces signaux changent.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentRuntime } from '../common/eventTypes';

let vscodeModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscodeModule = require('vscode');
} catch {
  // Hors hôte VS Code (tests unitaires ou exécution Node autonome).
}

export type RuntimeOverride = 'auto' | AgentRuntime;

export interface RuntimeSignal {
  kind: 'environment' | 'workspace-file';
  runtime: AgentRuntime;
  evidence: string;
}

export interface AgentRuntimeContext {
  runtime: AgentRuntime;
  signals: RuntimeSignal[];
  override: RuntimeOverride;
  overridden: boolean;
  /** Vrai lorsque les deux agents laissent des traces dans l'espace de travail. */
  mixedWorkspace: boolean;
  detectedAt: number;
}

/** Signatures de fichiers propres à chaque agent, cherchées à la racine. */
const ANTIGRAVITY_MARKERS = ['.antigravity', 'antigravity.json', '.agents', '.agent', 'GEMINI.md'];
const CLAUDE_MARKERS = ['.claude', 'CLAUDE.md', '.mcp.json', path.join('.mcp', 'config.json')];

export class AgentRuntimeDetector {
  private static cached: AgentRuntimeContext | null = null;

  public static getContext(workspaceRoot?: string | null): AgentRuntimeContext {
    if (!this.cached) {
      this.cached = this.detect(workspaceRoot);
    }
    return this.cached;
  }

  public static invalidate(): void {
    this.cached = null;
  }

  /**
   * Analyse l'environnement et l'espace de travail pour déterminer l'agent
   * actif. Les variables d'environnement priment sur les fichiers : un
   * processus lancé par un agent donné le signale explicitement.
   */
  public static detect(
    workspaceRoot?: string | null,
    options: {
      env?: NodeJS.ProcessEnv;
      existsSync?: (filePath: string) => boolean;
      override?: RuntimeOverride;
    } = {}
  ): AgentRuntimeContext {
    const env = options.env ?? process.env;
    const exists = options.existsSync ?? ((p: string) => fs.existsSync(p));
    const override = options.override ?? this.readOverrideSetting();
    const root = workspaceRoot ?? this.resolveWorkspaceRoot();

    const signals: RuntimeSignal[] = [];

    // --- Variables d'environnement ---
    if (this.hasValue(env.CLAUDE_CODE) || this.hasValue(env.CLAUDE_CODE_ENTRYPOINT)) {
      signals.push({
        kind: 'environment',
        runtime: 'claude-code',
        evidence: 'Variables CLAUDE_CODE / CLAUDE_CODE_ENTRYPOINT présentes.',
      });
    }
    if (
      this.hasValue(env.ANTIGRAVITY_ENV) ||
      this.hasValue(env.ANTIGRAVITY_IDE) ||
      this.hasValue(env.AGY_IDE_VERSION)
    ) {
      signals.push({
        kind: 'environment',
        runtime: 'antigravity',
        evidence: 'Variables ANTIGRAVITY_ENV / ANTIGRAVITY_IDE / AGY_IDE_VERSION présentes.',
      });
    }

    // --- Signatures de fichiers de l'espace de travail ---
    if (root) {
      for (const marker of ANTIGRAVITY_MARKERS) {
        if (this.safeExists(exists, path.join(root, marker))) {
          signals.push({
            kind: 'workspace-file',
            runtime: 'antigravity',
            evidence: `Marqueur Anti-Gravity trouvé : ${marker}`,
          });
        }
      }
      for (const marker of CLAUDE_MARKERS) {
        if (this.safeExists(exists, path.join(root, marker))) {
          signals.push({
            kind: 'workspace-file',
            runtime: 'claude-code',
            evidence: `Marqueur Claude Code trouvé : ${marker}`,
          });
        }
      }
    }

    const antigravityCount = signals.filter((s) => s.runtime === 'antigravity').length;
    const claudeCount = signals.filter((s) => s.runtime === 'claude-code').length;
    const mixedWorkspace = antigravityCount > 0 && claudeCount > 0;

    let runtime: AgentRuntime;
    const envAntigravity = signals.some((s) => s.kind === 'environment' && s.runtime === 'antigravity');
    const envClaude = signals.some((s) => s.kind === 'environment' && s.runtime === 'claude-code');

    if (override !== 'auto') {
      runtime = override;
    } else if (envClaude && !envAntigravity) {
      runtime = 'claude-code';
    } else if (envAntigravity && !envClaude) {
      runtime = 'antigravity';
    } else if (antigravityCount !== claudeCount) {
      runtime = antigravityCount > claudeCount ? 'antigravity' : 'claude-code';
    } else {
      // En l'absence de signal départageant les deux agents, l'IDE Anti-Gravity
      // reste la cible par défaut du gestionnaire.
      runtime = 'antigravity';
    }

    const context: AgentRuntimeContext = {
      runtime,
      signals,
      override,
      overridden: override !== 'auto',
      mixedWorkspace,
      detectedAt: Date.now(),
    };

    this.cached = context;
    return context;
  }

  private static hasValue(value: string | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private static safeExists(exists: (p: string) => boolean, candidate: string): boolean {
    try {
      return exists(candidate);
    } catch {
      return false;
    }
  }

  private static resolveWorkspaceRoot(): string | null {
    try {
      const folders = vscodeModule?.workspace?.workspaceFolders;
      if (Array.isArray(folders) && folders.length > 0) {
        return folders[0].uri.fsPath as string;
      }
    } catch {
      // Hors hôte VS Code : aucun espace de travail à inspecter.
    }
    return null;
  }

  private static readOverrideSetting(): RuntimeOverride {
    try {
      if (!vscodeModule?.workspace?.getConfiguration) return 'auto';
      const config = vscodeModule.workspace.getConfiguration('antigravity');
      const value = config.get('environment.overrideMode', 'auto');
      if (value === 'antigravity' || value === 'claude-code') {
        return value;
      }
      return 'auto';
    } catch {
      return 'auto';
    }
  }
}
