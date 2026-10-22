/**
 * Indicateur d'environnement dans la barre d'état et inspecteur de
 * diagnostics associé (§3.6 du PRD).
 *
 * Le badge expose en permanence l'hôte détecté et l'agent actif ; un clic
 * ouvre le sélecteur de bascule manuelle. L'inspecteur détaille les signaux
 * sondés, leurs scores bruts et l'état de l'éventuelle dérogation.
 */

import * as vscode from 'vscode';
import { AgentRuntime, HostMode } from '../common/eventTypes';
import { ExtensionEventBus } from '../common/ExtensionEventBus';
import {
  HostEnvironmentDetector,
  HostOverride,
  MAX_HOST_SCORE,
  NATIVE_HOST_THRESHOLD,
} from '../environment/HostEnvironmentDetector';
import { AgentRuntimeDetector, RuntimeOverride } from '../environment/AgentRuntimeDetector';

const HOST_LABELS: Record<HostMode, string> = {
  'antigravity-native': 'Anti-Gravity IDE : Natif',
  'vscode-standalone': 'VS Code : Autonome',
};

const RUNTIME_LABELS: Record<AgentRuntime, string> = {
  antigravity: 'Anti-Gravity',
  'claude-code': 'Claude Code',
};

export class EnvironmentStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private lastRuntime: AgentRuntime | null = null;

  constructor(private readonly bus: ExtensionEventBus) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'antigravity.environment.override';
  }

  /** Publie le verdict initial sur le bus, puis affiche le badge s'il doit être visible. */
  public activate(visible = true): void {
    this.refresh();
    this.setVisible(visible);
  }

  /** Affiche ou masque le badge, qui suit le réglage expérimental de la vue Découverte. */
  public setVisible(visible: boolean): void {
    if (visible) {
      this.item.show();
    } else {
      this.item.hide();
    }
  }

  /**
   * Réévalue l'hôte et l'agent puis met le badge à jour. Appelée à
   * l'amorçage, sur changement de dossiers et sur reprise de focus.
   */
  public refresh(): void {
    HostEnvironmentDetector.invalidate();
    AgentRuntimeDetector.invalidate();

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
    const host = HostEnvironmentDetector.getContext();
    const runtime = AgentRuntimeDetector.getContext(workspaceRoot);

    this.item.text = `$(circuit-board) ${HOST_LABELS[host.host]} · ${RUNTIME_LABELS[runtime.runtime]}`;
    this.item.tooltip = new vscode.MarkdownString(
      [
        `**Hôte détecté** : ${HOST_LABELS[host.host]}`,
        `**Score heuristique** : ${host.score} / ${MAX_HOST_SCORE} (seuil : ${NATIVE_HOST_THRESHOLD})`,
        `**Agent actif** : ${RUNTIME_LABELS[runtime.runtime]}`,
        host.overridden ? '**Dérogation manuelle active**' : '_Détection automatique_',
        '',
        'Cliquez pour forcer un mode de fonctionnement.',
      ].join('\n\n')
    );
    this.item.backgroundColor = host.overridden
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;

    this.bus.publish('env:host:detected', 'environment.detector', {
      host: host.host,
      score: host.score,
      overridden: host.overridden,
    });

    if (this.lastRuntime !== runtime.runtime) {
      this.bus.publish('env:runtime:switched', 'environment.detector', {
        previous: this.lastRuntime,
        current: runtime.runtime,
      });
      this.lastRuntime = runtime.runtime;
    }
  }

  /**
   * Sélecteur de bascule manuelle : l'utilisateur force l'hôte, l'agent, ou
   * rend la main à la détection automatique.
   */
  public async promptOverride(): Promise<void> {
    const host = HostEnvironmentDetector.getContext();
    const runtime = AgentRuntimeDetector.getContext(
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null
    );

    const picks: Array<vscode.QuickPickItem & { apply: () => Promise<void> }> = [
      {
        label: '$(sync) Détection automatique',
        description: 'Rendre la main aux sondes heuristiques',
        picked: host.override === 'auto' && runtime.override === 'auto',
        apply: async () => {
          await this.writeHostOverride('auto');
          await this.writeRuntimeOverride('auto');
        },
      },
      {
        label: '$(rocket) Forcer Anti-Gravity IDE (natif)',
        description: 'Pont IPC interne, intégration aux panneaux natifs',
        picked: host.override === 'antigravity-native',
        apply: () => this.writeHostOverride('antigravity-native'),
      },
      {
        label: '$(vscode) Forcer VS Code (autonome)',
        description: 'Démon externe, vues contribuées par l’extension',
        picked: host.override === 'vscode-standalone',
        apply: () => this.writeHostOverride('vscode-standalone'),
      },
      {
        label: '$(robot) Forcer l’agent Anti-Gravity',
        description: 'Déploiements vers .agents/ et le profil Anti-Gravity',
        picked: runtime.override === 'antigravity',
        apply: () => this.writeRuntimeOverride('antigravity'),
      },
      {
        label: '$(comment-discussion) Forcer l’agent Claude Code',
        description: 'Déploiements vers .claude/ et la configuration MCP',
        picked: runtime.override === 'claude-code',
        apply: () => this.writeRuntimeOverride('claude-code'),
      },
    ];

    const choice = await vscode.window.showQuickPick(picks, {
      title: "Mode de fonctionnement de l'extension",
      placeHolder: `Détection actuelle : ${HOST_LABELS[host.host]} · ${RUNTIME_LABELS[runtime.runtime]}`,
    });
    if (!choice) return;

    await choice.apply();
    this.refresh();
  }

  /**
   * Ouvre l'inspecteur : un document détaillant chaque signal, son poids et
   * la décision qui en découle.
   */
  public async showDiagnostics(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
    const host = HostEnvironmentDetector.detect();
    const runtime = AgentRuntimeDetector.detect(workspaceRoot);

    const lines: string[] = [
      "# Diagnostics d'environnement Anti-Gravity",
      '',
      `Sondage effectué en ${host.probeDurationMs} ms.`,
      '',
      '## Hôte détecté',
      '',
      `- **Verdict** : ${HOST_LABELS[host.host]}`,
      `- **Score cumulé** : ${host.score} / ${host.maxScore} (seuil de bascule : ${host.threshold})`,
      `- **Dérogation** : ${host.overridden ? `active (${host.override})` : 'aucune'}`,
      '',
      '### Détail des signaux',
      '',
      '| Signal | Résultat | Points | Indices relevés |',
      '| --- | --- | ---: | --- |',
    ];

    for (const signal of host.signals) {
      lines.push(
        `| ${signal.name} | ${signal.matched ? 'détecté' : 'absent'} | ${signal.points} | ${escapeTableCell(signal.evidence)} |`
      );
    }

    lines.push(
      '',
      "## Agent d'exécution",
      '',
      `- **Verdict** : ${RUNTIME_LABELS[runtime.runtime]}`,
      `- **Dérogation** : ${runtime.overridden ? `active (${runtime.override})` : 'aucune'}`,
      `- **Espace de travail mixte** : ${runtime.mixedWorkspace ? 'oui, les deux agents laissent des traces' : 'non'}`,
      ''
    );

    if (runtime.signals.length === 0) {
      lines.push("Aucun signal d'agent n'a été relevé dans cet espace de travail.");
    } else {
      lines.push('| Origine | Agent | Indice |', '| --- | --- | --- |');
      for (const signal of runtime.signals) {
        lines.push(
          `| ${signal.kind === 'environment' ? 'environnement' : 'fichier'} | ${RUNTIME_LABELS[signal.runtime]} | ${escapeTableCell(signal.evidence)} |`
        );
      }
    }

    const document = await vscode.workspace.openTextDocument({
      content: lines.join('\n'),
      language: 'markdown',
    });
    await vscode.window.showTextDocument(document, { preview: true });
  }

  public dispose(): void {
    this.item.dispose();
  }

  private async writeHostOverride(value: HostOverride): Promise<void> {
    await vscode.workspace
      .getConfiguration()
      .update('antigravity.environment.hostOverride', value, vscode.ConfigurationTarget.Global);
  }

  private async writeRuntimeOverride(value: RuntimeOverride): Promise<void> {
    await vscode.workspace
      .getConfiguration()
      .update('antigravity.environment.overrideMode', value, vscode.ConfigurationTarget.Global);
  }
}

/** Neutralise les barres verticales qui casseraient le tableau Markdown. */
function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
