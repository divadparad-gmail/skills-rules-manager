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

  public static async loadFullState(forceFresh = false): Promise<ManagerFullState> {
    if (!forceFresh && this.cachedState) {
      return this.cachedState;
    }

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

    const usedTokensTotal =
      soulGlobal.tokenCount +
      soulLocal.tokenCount +
      rulesGlobal.tokenCount +
      rulesLocal.tokenCount +
      skillsGlobal.tokenCount +
      skillsLocal.tokenCount +
      mcpGlobal.tokenCount +
      mcpLocal.tokenCount;

    const availablePercentage = Number(Math.max(0, 100 - (usedTokensTotal / budgetTotal) * 100).toFixed(1));

    const stats: ManagerStats = {
      budgetTotal,
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
      userHome: getUserHome(),
    };

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

    if (result.success) {
      vscode.window.showInformationMessage(
        `${type.toUpperCase()} "${id}" : ${targetState ? 'activé' : 'désactivé'} avec succès.`
      );
    } else {
      vscode.window.showErrorMessage(
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
      vscode.window.showInformationMessage(
        `Import réussi ! "${item.name || item.id}" a été copié vers ${destLabel}.`
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

      const stat = await fs.promises.stat(targetPath);
      if (process.platform === 'win32') {
        const { exec } = require('child_process');
        const normalized = path.normalize(targetPath);
        if (stat.isDirectory()) {
          exec(`explorer "${normalized}"`);
        } else {
          exec(`explorer /select,"${normalized}"`);
        }
      } else {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(targetPath));
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Impossible d'ouvrir l'explorateur : ${err}`);
    }
  }
}
