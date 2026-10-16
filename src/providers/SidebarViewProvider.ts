import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WebviewMessage } from '../types';
import { StateManager } from '../services/StateManager';
import { WorkspaceDetector } from '../services/WorkspaceDetector';
import { NasScanner } from '../services/NasScanner';
import { CheatSheetPanel } from './CheatSheetPanel';
import { ScenarioManager, ScenarioTarget } from '../services/ScenarioManager';

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'skillsRulesManagerView';
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Écouter les mises à jour de stateManager
    const disposable = StateManager.subscribe((state) => {
      webviewView.webview.postMessage({
        type: 'stateUpdate',
        payload: state,
      });
    });

    webviewView.onDidDispose(() => {
      disposable.dispose();
    });

    // Écoute des messages venant de la Webview
    webviewView.webview.onDidReceiveMessage(async (data: unknown) => {
      const message = data as WebviewMessage;
      switch (message.type) {
        case 'ready': {
          const state = await StateManager.loadFullState();
          webviewView.webview.postMessage({
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
          webviewView.webview.postMessage({
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
          webviewView.webview.postMessage({
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

        case 'openDashboard':
        case 'toggleDashboard': {
          StateManager.toggleDashboard(this._extensionUri);
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

        case 'openInExplorer': {
          await StateManager.openInExplorer(message.payload.path);
          break;
        }

        case 'allowUncHost': {
          const config = vscode.workspace.getConfiguration('skillsManager');
          const targetPath = message.payload?.path || config.get<string>('nasPath', '\\\\Nas1\\DD2\\IA\\Antigravity-Templates');
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

        case 'switchTool': {
          const current = WorkspaceDetector.detectWorkspace().tool;
          const target = message.payload?.tool || (current === 'antigravity' ? 'claude-code' : 'antigravity');
          WorkspaceDetector.setOverriddenTool(target);
          await StateManager.loadFullState(true);
          break;
        }

        case 'deployScenario': {
          const target = (message.payload?.target as ScenarioTarget) || 'all';
          const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (rootPath) {
            try {
              const count = await ScenarioManager.deploy(rootPath, target);
              vscode.window.showInformationMessage(`🧪 Scénarios "${target}" injectés avec succès (${count} fichiers).`);
              if (target === 'antigravity') {
                WorkspaceDetector.setOverriddenTool('antigravity');
              } else if (target === 'claude-code') {
                WorkspaceDetector.setOverriddenTool('claude-code');
              }
              await StateManager.loadFullState(true);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              vscode.window.showErrorMessage(`Erreur de déploiement : ${msg}`);
            }
          } else {
            vscode.window.showWarningMessage("Veuillez ouvrir un dossier d'espace de travail.");
          }
          break;
        }

        case 'cleanScenarios': {
          const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (rootPath) {
            try {
              const state = await StateManager.loadFullState(false);
              const result = await ScenarioManager.clean(rootPath, 'all', state.localResources);

              if (result.preservedCount > 0) {
                vscode.window.showWarningMessage(
                  `🧹 Nettoyage terminé : ${result.deletedCount} élément(s) synchronisé(s) supprimé(s).\n` +
                  `🛡️ ${result.preservedCount} élément(s) non synchronisé(s) protégé(s) (${result.preservedNames.join(', ')}).`
                );
              } else {
                vscode.window.showInformationMessage(`🧹 Espace de travail réinitialisé (${result.deletedCount} éléments supprimés).`);
              }
              await StateManager.loadFullState(true);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              vscode.window.showErrorMessage(`Erreur de nettoyage : ${msg}`);
            }
          }
          break;
        }

        case 'browseNasPath': {
          const config = vscode.workspace.getConfiguration('skillsManager');
          const currentPath = config.get<string>('nasPath', '\\\\Nas1\\DD2\\IA\\Antigravity-Templates');
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
          const currentPath = config.get<string>('nasPath', '\\\\Nas1\\DD2\\IA\\Antigravity-Templates');
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
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
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

    const templatePath = path.join(this._extensionUri.fsPath, 'src', 'webview', 'sidebar.html');
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
      htmlContent = `<!DOCTYPE html><html><body><h3>Erreur chargement template sidebar</h3></body></html>`;
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
