import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WebviewMessage } from '../types';
import { StateManager } from '../services/StateManager';
import { WorkspaceDetector } from '../services/WorkspaceDetector';
import { NasScanner } from '../services/NasScanner';
import { ScenarioManager } from '../services/ScenarioManager';
import { CheatSheetPanel } from './CheatSheetPanel';

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  public static readonly viewType = 'skillsRulesManagerDashboard';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static close(): void {
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.dispose();
    }
  }

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel._panel.reveal(column);
      StateManager.setDashboardOpen(true);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'Skills & Rules Manager - Dashboard',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri);
    StateManager.setDashboardOpen(true);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Écouter les mises à jour d'état
    const stateSub = StateManager.subscribe((state) => {
      this._panel.webview.postMessage({
        type: 'stateUpdate',
        payload: state,
      });
    });
    this._disposables.push(stateSub);

    // Écouter les messages émis par la Webview
    this._panel.webview.onDidReceiveMessage(
      async (data: unknown) => {
        const message = data as WebviewMessage;
        switch (message.type) {
          case 'ready': {
            const state = await StateManager.loadFullState();
            this._panel.webview.postMessage({
              type: 'stateUpdate',
              payload: state,
            });
            break;
          }

          case 'refresh': {
            await StateManager.loadFullState(true);
            break;
          }

          case 'toggle': {
            const res = await StateManager.toggle(
              message.payload.id,
              message.payload.scope,
              message.payload.targetState,
              message.payload.type,
              message.payload.path
            );
            this._panel.webview.postMessage({
              type: 'toggleResult',
              payload: res,
            });
            break;
          }

          case 'import': {
            const res = await StateManager.importResource(
              message.payload.item,
              message.payload.destinationScope
            );
            this._panel.webview.postMessage({
              type: 'importResult',
              payload: {
                success: res.success,
                id: message.payload.item.id,
                destinationScope: message.payload.destinationScope,
                error: res.error,
              },
            });
            break;
          }

          case 'bulkToggle': {
            await StateManager.bulkToggle(
              message.payload.targetType,
              message.payload.scope,
              message.payload.targetState
            );
            break;
          }

          case 'disableAllWorkflows': {
            await StateManager.bulkToggle('workflow', message.payload.scope, false);
            break;
          }

          case 'enableAllSkills': {
            await StateManager.bulkToggle('skill', message.payload.scope, true);
            break;
          }

          case 'openCheatSheet':
          case 'toggleCheatSheet': {
            const currentTool = message.payload?.defaultTab || WorkspaceDetector.detectWorkspace().tool;
            StateManager.toggleCheatSheet(this._extensionUri, currentTool);
            break;
          }

          case 'closeCheatSheet': {
            CheatSheetPanel.close();
            break;
          }

          case 'openFile': {
            await StateManager.openFile(message.payload.path);
            break;
          }

          case 'compareDuplicate': {
            await StateManager.compareDuplicate(
              message.payload.globalPath,
              message.payload.localPath,
              message.payload.title
            );
            break;
          }

          case 'openInExplorer': {
            await StateManager.openInExplorer(message.payload.path);
            break;
          }

          case 'allowUncHost': {
            const config = vscode.workspace.getConfiguration('skillsManager');
            const targetPath = message.payload?.path || config.get<string>('nasPath', '');
            const host = NasScanner.getUncHost(targetPath);
            await NasScanner.ensureAllowedUNCHost(targetPath);
            vscode.window.showInformationMessage(`Hôte UNC "${host || targetPath}" autorisé dans VS Code.`);
            await StateManager.loadFullState(true);
            break;
          }

          case 'delete': {
            await StateManager.deleteResource(message.payload.item);
            break;
          }

          case 'cleanScenarios': {
            const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (rootPath) {
              try {
                const choice = await vscode.window.showWarningMessage(
                  "Êtes-vous sûr de vouloir réinitialiser les scénarios d'essai du Banc d'Essai ? Vos règles et compétences personnelles seront préservées.",
                  { modal: true },
                  'Nettoyer'
                );
                if (choice !== 'Nettoyer') {
                  break;
                }

                const state = await StateManager.loadFullState(false);
                const result = await ScenarioManager.clean(rootPath, 'all', state.localResources);

                if (result.preservedCount > 0) {
                  vscode.window.showWarningMessage(
                    `🧹 Nettoyage terminé : ${result.deletedCount} élément(s) de test supprimé(s).\n` +
                    `🛡️ ${result.preservedCount} élément(s) de projet protégé(s) (${result.preservedNames.join(', ')}).`
                  );
                } else {
                  vscode.window.showInformationMessage(`🧹 Espace de travail réinitialisé (${result.deletedCount} éléments de scénario supprimés).`);
                }
                await StateManager.loadFullState(true);
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Erreur de nettoyage : ${msg}`);
              }
            }
            break;
          }

          case 'switchTool': {
            const current = WorkspaceDetector.detectWorkspace().tool;
            const target = message.payload?.tool || (current === 'antigravity' ? 'claude-code' : 'antigravity');
            WorkspaceDetector.setOverriddenTool(target);
            await StateManager.loadFullState(true);
            break;
          }

          case 'browseNasPath': {
            const config = vscode.workspace.getConfiguration('skillsManager');
            const currentPath = config.get<string>('nasPath', '');
            const defaultUri = fs.existsSync(currentPath) ? vscode.Uri.file(currentPath) : undefined;
            const uris = await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
              defaultUri,
              title: 'Sélectionner le répertoire du Catalogue Source (NAS / Templates)',
              openLabel: 'Sélectionner ce dossier',
            });

            if (uris && uris.length > 0) {
              const selectedPath = uris[0].fsPath;
              await config.update('nasPath', selectedPath, vscode.ConfigurationTarget.Global);
              vscode.window.showInformationMessage(`Catalogue Source configuré : ${selectedPath}`);
              await StateManager.loadFullState(true);
            }
            break;
          }

          case 'editNasPath': {
            const config = vscode.workspace.getConfiguration('skillsManager');
            const currentPath = config.get<string>('nasPath', '');
            const input = await vscode.window.showInputBox({
              prompt: 'Entrez le chemin réseau (UNC) ou local du Catalogue Source (NAS / Templates)',
              value: currentPath,
              ignoreFocusOut: true,
            });

            if (input !== undefined && input.trim().length > 0) {
              const newPath = input.trim();
              await config.update('nasPath', newPath, vscode.ConfigurationTarget.Global);
              vscode.window.showInformationMessage(`Catalogue Source mis à jour : ${newPath}`);
              await StateManager.loadFullState(true);
            }
            break;
          }
        }
      },
      null,
      this._disposables
    );
  }

  public dispose(): void {
    DashboardPanel.currentPanel = undefined;
    StateManager.setDashboardOpen(false);

    this._panel.dispose();

    while (this._disposables.length) {
      const item = this._disposables.pop();
      if (item) {
        item.dispose();
      }
    }
  }

  private _update(): void {
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'styles.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.js')
    );

    const nonce = this.getNonce();

    const pkgPath = path.join(this._extensionUri.fsPath, 'package.json');
    let version = '0.2.6';
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.version) version = pkg.version;
    } catch {
      // Ignorer
    }

    const templatePath = path.join(this._extensionUri.fsPath, 'src', 'webview', 'dashboard.html');
    let htmlContent = '';

    try {
      htmlContent = fs.readFileSync(templatePath, 'utf8');
      htmlContent = htmlContent
        .replace(/{{cspSource}}/g, webview.cspSource)
        .replace(/{{nonce}}/g, nonce)
        .replace(/{{styleUri}}/g, styleUri.toString())
        .replace(/{{scriptUri}}/g, scriptUri.toString())
        .replace(/{{version}}/g, 'v' + version);
    } catch {
      htmlContent = `<!DOCTYPE html><html><body><h3>Erreur chargement template dashboard</h3></body></html>`;
    }

    return htmlContent;
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
