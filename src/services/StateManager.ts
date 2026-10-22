import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ManagerFullState, ManagerStats, ResourceItem, ResourceScope, ResourceType } from '../types';
import { WorkspaceDetector } from './WorkspaceDetector';
import { NasScanner } from './NasScanner';
import { GlobalScanner } from './GlobalScanner';
import { LocalScanner } from './LocalScanner';
import { McpScanner } from './McpScanner';
import { ToggleManager } from './ToggleManager';
import { ImportService } from './ImportService';
import { IntegrityService } from './IntegrityService';
import { DeleteService } from './DeleteService';
import { DuplicateService } from './DuplicateService';
import { DashboardPanel } from '../providers/DashboardPanel';
import { CheatSheetPanel } from '../providers/CheatSheetPanel';
import { getUserHome } from '../utils/paths';
import { resetTokenizerMetrics, getTokenizerMetrics } from '../utils/tokenizer';
import { debounce } from '../utils/debounce';
import { ANTIGRAVITY_TESTED_ON, ANTIGRAVITY_TESTED_VERSION } from '../antigravity/behavior';

export class StateManager {
  private static cachedState: ManagerFullState | null = null;
  private static listeners: Array<(state: ManagerFullState) => void> = [];
  private static _isDashboardOpen = false;
  private static _isCheatSheetOpen = false;

  public static isDashboardOpen(): boolean {
    return this._isDashboardOpen;
  }

  public static setDashboardOpen(isOpen: boolean): void {
    if (this._isDashboardOpen !== isOpen) {
      this._isDashboardOpen = isOpen;
      if (this.cachedState) {
        this.cachedState.isDashboardOpen = isOpen;
        this.broadcastState(this.cachedState);
      }
    }
  }

  public static toggleDashboard(extensionUri: vscode.Uri): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DashboardPanel } = require('../providers/DashboardPanel');
    if (this._isDashboardOpen) {
      DashboardPanel.close();
    } else {
      DashboardPanel.createOrShow(extensionUri);
    }
  }

  public static isCheatSheetOpen(): boolean {
    return this._isCheatSheetOpen;
  }

  public static setCheatSheetOpen(isOpen: boolean): void {
    if (this._isCheatSheetOpen !== isOpen) {
      this._isCheatSheetOpen = isOpen;
      if (this.cachedState) {
        this.cachedState.isCheatSheetOpen = isOpen;
        this.broadcastState(this.cachedState);
      }
    }
  }

  public static toggleCheatSheet(extensionUri: vscode.Uri, defaultTool?: import('../types').TargetTool): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CheatSheetPanel } = require('../providers/CheatSheetPanel');
    if (this._isCheatSheetOpen || CheatSheetPanel.currentPanel) {
      CheatSheetPanel.close();
    } else {
      CheatSheetPanel.createOrShow(extensionUri, defaultTool);
    }
  }

  public static subscribe(listener: (state: ManagerFullState) => void): vscode.Disposable {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  }

  private static debouncedReloadHandler: ReturnType<typeof debounce> | null = null;
  private static outputChannel: vscode.OutputChannel | null = null;
  public static lastTimingLog: string | null = null;
  private static timingHistory: string[] = [];
  private static _debugTimingOverride: boolean | null = null;

  public static setDebugTimingForTesting(enabled: boolean | null): void {
    this._debugTimingOverride = enabled;
  }

  public static isDebugTimingActive(): boolean {
    if (this._debugTimingOverride !== null) {
      return this._debugTimingOverride;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const vscodeModule = require('vscode');
      const config = vscodeModule?.workspace?.getConfiguration?.('skillsManager');
      return config?.get?.('debugTiming', false) ?? false;
    } catch {
      return false;
    }
  }

  public static async setDebugTiming(enabled: boolean): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const vscodeModule = require('vscode');
      const config = vscodeModule?.workspace?.getConfiguration?.('skillsManager');
      if (config && typeof config.update === 'function') {
        await config.update('debugTiming', enabled, vscodeModule.ConfigurationTarget?.Global ?? 1);
      } else {
        this._debugTimingOverride = enabled;
      }
    } catch {
      this._debugTimingOverride = enabled;
    }
    await this.loadFullState(true);
  }

  public static clearTimingLogs(): void {
    this.timingHistory = [];
    this.lastTimingLog = null;
    if (this.cachedState) {
      this.cachedState.timingHistory = [];
      this.cachedState.lastTimingLog = null;
      this.broadcastState(this.cachedState);
    }
  }

  public static getTimingHistory(): string[] {
    return [...this.timingHistory];
  }

  public static requestDebouncedReload(delayMs = 350): void {
    if (!this.debouncedReloadHandler) {
      this.debouncedReloadHandler = debounce(() => {
        this.loadFullState(true).catch(() => {});
      }, delayMs);
    }
    this.debouncedReloadHandler();
  }

  private static logTiming(message: string): void {
    this.lastTimingLog = message;
    this.timingHistory.push(message);
    if (this.timingHistory.length > 30) {
      this.timingHistory.shift();
    }

    try {
      const isDebugTiming = this.isDebugTimingActive();
      if (!isDebugTiming) {
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const vscodeModule = require('vscode');
      if (vscodeModule && vscodeModule.window && typeof vscodeModule.window.createOutputChannel === 'function') {
        if (!this.outputChannel) {
          this.outputChannel = vscodeModule.window.createOutputChannel('Skills & Rules Manager');
        }
        this.outputChannel?.appendLine(message);
      }
    } catch {
      // Ignorer silencieusement
    }
  }

  public static async loadFullState(forceFresh = false): Promise<ManagerFullState> {
    if (!forceFresh && this.cachedState) {
      return this.cachedState;
    }

    resetTokenizerMetrics();
    const scanStartTime = performance.now();

    const workspace = WorkspaceDetector.detectWorkspace();

    const [nasResult, globalResult, localResult, mcpGlobalStat, mcpLocalStat] = await Promise.all([
      NasScanner.scan(undefined, workspace.tool),
      GlobalScanner.scan(undefined, workspace.tool),
      LocalScanner.scan(workspace),
      McpScanner.scanGlobal(undefined, workspace.tool),
      McpScanner.scanLocal(workspace),
    ]);

    // Enrichissement du statut d'intégrité vis-à-vis du Catalogue NAS pour Global et Local
    const enrichedGlobal = await IntegrityService.enrichResourcesWithSyncStatus(
      globalResult.items,
      nasResult.items,
      nasResult.status.online
    );
    const enrichedLocal = await IntegrityService.enrichResourcesWithSyncStatus(
      localResult.items,
      nasResult.items,
      nasResult.status.online
    );

    // Détection des doublons Global vs Local et calcul des tokens gaspillés
    const {
      enrichedGlobal: finalGlobal,
      enrichedLocal: finalLocal,
      stats: duplicateStats,
    } = DuplicateService.detectDuplicates(enrichedGlobal, enrichedLocal);

    const budgetTotal = 20000;
    const soulGlobal = globalResult.soulStat;
    const soulLocal = localResult.soulStat;
    const rulesGlobal = globalResult.rulesStat;
    const rulesLocal = localResult.rulesStat;
    const skillsGlobal = globalResult.skillsStat;
    const skillsLocal = localResult.skillsStat;
    const mcpGlobal = mcpGlobalStat;
    const mcpLocal = mcpLocalStat;

    // Antigravity : le budget de 20 000 tokens est réservé aux règles (âmes comprises) ; les skills
    // et les MCP relèvent d'un budget de personnalisation distinct (https://antigravity.google/docs/rules/)
    const budgetExcludesPersonalization = workspace.tool === 'antigravity';
    const rulesAndSoulTokens =
      soulGlobal.tokenCount +
      soulLocal.tokenCount +
      rulesGlobal.tokenCount +
      rulesLocal.tokenCount;
    const usedTokensTotal = budgetExcludesPersonalization
      ? rulesAndSoulTokens
      : rulesAndSoulTokens +
        skillsGlobal.tokenCount +
        skillsLocal.tokenCount +
        mcpGlobal.tokenCount +
        mcpLocal.tokenCount;

    const availablePercentage = Number(Math.max(0, 100 - (usedTokensTotal / budgetTotal) * 100).toFixed(1));

    const stats: ManagerStats = {
      budgetTotal,
      budgetExcludesPersonalization,
      usedTokensTotal,
      availablePercentage,
      soulGlobal,
      soulLocal,
      rulesGlobal,
      rulesLocal,
      skillsGlobal,
      skillsLocal,
      mcpGlobal,
      mcpLocal,
      duplicateStats,
    };

    const state: ManagerFullState = {
      nasStatus: nasResult.status,
      nasResources: nasResult.items,
      globalResources: finalGlobal,
      localResources: finalLocal,
      workspace,
      stats,
      isDashboardOpen: this._isDashboardOpen,
      isCheatSheetOpen: this._isCheatSheetOpen,
      ...(localResult.antigravityParents ? { antigravityParents: localResult.antigravityParents } : {}),
      antigravityBehavior: { version: ANTIGRAVITY_TESTED_VERSION, testedOn: ANTIGRAVITY_TESTED_ON },
      userHome: getUserHome(),
    };

    const scanTotalMs = Math.round(performance.now() - scanStartTime);
    const timingMetrics = getTokenizerMetrics();
    const timingLogMessage = `Scan terminé en ${scanTotalMs} ms — ${timingMetrics.totalFiles} fichiers, ${timingMetrics.encodedCount} encodés, ${timingMetrics.cachedCount} servis du cache, encodage cumulé ${timingMetrics.cumulativeEncodingTimeMs} ms.`;
    this.logTiming(timingLogMessage);

    state.isDebugTiming = this.isDebugTimingActive();
    state.lastTimingLog = this.lastTimingLog;
    state.timingHistory = [...this.timingHistory];

    this.cachedState = state;
    this.broadcastState(state);

    return state;
  }

  public static async deleteResource(
    item: ResourceItem
  ): Promise<{ success: boolean; error?: string }> {
    return await DeleteService.deleteResource(item);
  }

  public static broadcastState(state: ManagerFullState): void {
    this.cachedState = state;
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // Ignorer les erreurs des écouteurs détruits
      }
    }
  }

  public static async toggle(
    id: string,
    scope: ResourceScope,
    targetState: boolean,
    type: ResourceType,
    itemPath: string
  ): Promise<{ success: boolean; newState: boolean; error?: string }> {
    const result = await ToggleManager.toggle(itemPath, targetState, type, scope, id);

    let vscodeModule: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      vscodeModule = require('vscode');
    } catch {}

    if (result.success) {
      vscodeModule?.window?.showInformationMessage?.(
        `${type.toUpperCase()} "${id}" : ${targetState ? 'activé' : 'désactivé'} avec succès.`
      );
    } else {
      vscodeModule?.window?.showErrorMessage?.(
        `Erreur lors du basculement de "${id}" : ${result.error || 'inconnue'}`
      );
    }

    // Recharger l'état frais et notifier
    await this.loadFullState(true);
    return result;
  }

  public static async importResource(
    item: ResourceItem,
    destinationScope: 'global' | 'local'
  ): Promise<{ success: boolean; targetPath?: string; error?: string }> {
    const workspace = WorkspaceDetector.detectWorkspace();
    const result = await ImportService.importResource(item, destinationScope, workspace);

    if (result.success) {
      const destLabel = destinationScope === 'global' ? 'Global PC' : 'Projet Local';
      // Une portée élargie ou des motifs morts doivent rester visibles : avertissement plutôt qu'information
      const show = result.notice?.includes('⚠️') ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
      show(
        `Import réussi ! "${item.name || item.id}" a été copié vers ${destLabel}.` +
          (result.notice ? ` ${result.notice}` : '')
      );
    } else {
      vscode.window.showErrorMessage(
        `Échec de l'import de "${item.name || item.id}" : ${result.error || 'Erreur inconnue'}`
      );
    }

    await this.loadFullState(true);
    return result;
  }

  public static async bulkToggle(
    targetType: 'workflow' | 'skill' | 'rule',
    scope: ResourceScope,
    targetState?: boolean
  ): Promise<{ modifiedCount: number; targetState: boolean; totalItems: number }> {
    const state = await this.loadFullState();
    const targetItems = scope === 'global' ? state.globalResources : state.localResources;
    const res = await ToggleManager.bulkToggle(targetItems, scope, targetType, targetState);

    const typeLabels: Record<string, { singular: string; plural: string }> = {
      workflow: { singular: 'workflow', plural: 'workflow(s)' },
      skill: { singular: 'compétence', plural: 'compétence(s)' },
      rule: { singular: 'règle', plural: 'règle(s)' },
    };
    const label = typeLabels[targetType] || { singular: targetType, plural: targetType };
    const scopeLabel = scope === 'global' ? 'Global' : 'Local';

    if (res.totalItems === 0) {
      vscode.window.showInformationMessage(`Aucun ${label.singular} dans ${scopeLabel}.`);
    } else if (res.modifiedCount === 0) {
      vscode.window.showInformationMessage(
        `Tous les ${label.plural} dans ${scopeLabel} sont déjà ${res.targetState ? 'activés' : 'désactivés'}.`
      );
    } else {
      if (res.targetState) {
        vscode.window.showInformationMessage(
          `✅ ${res.modifiedCount} ${label.plural} activé(s) dans ${scopeLabel}.`
        );
      } else {
        vscode.window.showInformationMessage(
          `⏸️ ${res.modifiedCount} ${label.plural} désactivé(s) dans ${scopeLabel}. Tokens économisés !`
        );
      }
    }

    await this.loadFullState(true);
    return res;
  }

  public static async disableAllWorkflows(scope: ResourceScope): Promise<void> {
    await this.bulkToggle('workflow', scope, false);
  }

  public static async enableAllWorkflows(scope: ResourceScope): Promise<void> {
    await this.bulkToggle('workflow', scope, true);
  }

  public static async toggleAllWorkflows(scope: ResourceScope): Promise<void> {
    await this.bulkToggle('workflow', scope);
  }

  public static async enableAllSkills(scope: ResourceScope): Promise<void> {
    await this.bulkToggle('skill', scope, true);
  }

  public static async disableAllSkills(scope: ResourceScope): Promise<void> {
    await this.bulkToggle('skill', scope, false);
  }

  public static async toggleAllSkills(scope: ResourceScope): Promise<void> {
    await this.bulkToggle('skill', scope);
  }

  public static async enableAllRules(scope: ResourceScope): Promise<void> {
    await this.bulkToggle('rule', scope, true);
  }

  public static async disableAllRules(scope: ResourceScope): Promise<void> {
    await this.bulkToggle('rule', scope, false);
  }

  public static async toggleAllRules(scope: ResourceScope): Promise<void> {
    await this.bulkToggle('rule', scope);
  }

  public static async openFile(filePath: string): Promise<void> {
    try {
      const uri = vscode.Uri.file(filePath);
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.Directory) {
        const skillMd = vscode.Uri.joinPath(uri, 'SKILL.md');
        const skillMdDisabled = vscode.Uri.joinPath(uri, 'SKILL.md.disabled');
        try {
          await vscode.workspace.fs.stat(skillMd);
          const doc = await vscode.workspace.openTextDocument(skillMd);
          await vscode.window.showTextDocument(doc);
          return;
        } catch {
          const doc = await vscode.workspace.openTextDocument(skillMdDisabled);
          await vscode.window.showTextDocument(doc);
          return;
        }
      } else {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Impossible d'ouvrir le fichier : ${err}`);
    }
  }

  /**
   * Ouvre la vue de comparaison côte-à-côte native de VS Code pour un doublon Global vs Local.
   * Pour une règle ou une âme (fichier unique) : compare les deux fichiers.
   * Pour un skill ou un workflow (dossier) : compare les deux SKILL.md (ou SKILL.md.disabled).
   */
  public static async compareDuplicate(globalPath: string, localPath: string, title?: string): Promise<void> {
    try {
      const resolveTargetUri = async (targetPath: string): Promise<vscode.Uri> => {
        const uri = vscode.Uri.file(targetPath);
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.type === vscode.FileType.Directory) {
            const skillMd = vscode.Uri.joinPath(uri, 'SKILL.md');
            const skillMdDisabled = vscode.Uri.joinPath(uri, 'SKILL.md.disabled');
            try {
              await vscode.workspace.fs.stat(skillMd);
              return skillMd;
            } catch {
              try {
                await vscode.workspace.fs.stat(skillMdDisabled);
                return skillMdDisabled;
              } catch {
                return skillMd;
              }
            }
          }
        } catch {
          // Si stat échoue, renvoyer l'uri direct
        }
        return uri;
      };

      const uriGlobal = await resolveTargetUri(globalPath);
      const uriLocal = await resolveTargetUri(localPath);
      const baseName = path.basename(globalPath);
      const diffTitle = title || `${baseName} (Global ↔ Local)`;

      await vscode.commands.executeCommand('vscode.diff', uriGlobal, uriLocal, diffTitle);
    } catch (err) {
      vscode.window.showErrorMessage(`Impossible d'ouvrir la comparaison diff : ${err}`);
    }
  }

  public static async openInExplorer(targetPath: string): Promise<void> {
    try {
      if (!targetPath) return;

      // Créer le dossier s'il s'agit d'un répertoire attendu mais pas encore créé sur disque
      if (!fs.existsSync(targetPath)) {
        if (!path.extname(targetPath)) {
          try {
            await fs.promises.mkdir(targetPath, { recursive: true });
          } catch {
            // Ignorer si échec (ex: permissions réseau NAS)
          }
        } else {
          // Si c'est un fichier inexistant (ex: GEMINI.md dans un nouveau projet),
          // on essaie d'ouvrir le dossier parent
          const parentDir = path.dirname(targetPath);
          if (fs.existsSync(parentDir)) {
            targetPath = parentDir;
          }
        }
      }

      if (!fs.existsSync(targetPath)) {
        vscode.window.showWarningMessage(`Le chemin est introuvable : ${targetPath}`);
        return;
      }

      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(targetPath));
    } catch (err) {
      vscode.window.showErrorMessage(`Impossible d'ouvrir l'explorateur : ${err}`);
    }
  }
}
