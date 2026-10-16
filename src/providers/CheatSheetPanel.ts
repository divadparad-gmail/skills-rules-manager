import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TargetTool } from '../types';
import { WorkspaceDetector } from '../services/WorkspaceDetector';
import { StateManager } from '../services/StateManager';

export class CheatSheetPanel {
  public static currentPanel: CheatSheetPanel | undefined;
  public static readonly viewType = 'skillsRulesManagerCheatSheet';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _currentTool: TargetTool;
  private _disposables: vscode.Disposable[] = [];

  public static close(): void {
    if (CheatSheetPanel.currentPanel) {
      CheatSheetPanel.currentPanel.dispose();
    }
  }

  public static createOrShow(extensionUri: vscode.Uri, defaultTool?: TargetTool): void {
    const activeTool = defaultTool || WorkspaceDetector.detectWorkspace().tool;

    // Ouvrir dans la colonne active de l'éditeur (à droite de la barre latérale)
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    if (CheatSheetPanel.currentPanel) {
      CheatSheetPanel.currentPanel._panel.reveal(column);
      CheatSheetPanel.currentPanel.setTool(activeTool);
      StateManager.setCheatSheetOpen(true);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      CheatSheetPanel.viewType,
      'Guide & Bonnes Pratiques IA',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    CheatSheetPanel.currentPanel = new CheatSheetPanel(panel, extensionUri, activeTool);
    StateManager.setCheatSheetOpen(true);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, initialTool: TargetTool) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._currentTool = initialTool;

    // Définir l'icône de l'onglet
    const iconPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'icons', 'activity-bar-icon.svg');
    if (fs.existsSync(iconPath.fsPath)) {
      this._panel.iconPath = iconPath;
    }

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Écouter les messages de la Webview
    this._panel.webview.onDidReceiveMessage(
      (message: { type: string; payload?: unknown }) => {
        switch (message.type) {
          case 'ready': {
            this._panel.webview.postMessage({
              type: 'setTool',
              payload: { tool: this._currentTool },
            });
            break;
          }
        }
      },
      null,
      this._disposables
    );
  }

  public setTool(tool: TargetTool): void {
    this._currentTool = tool;
    this._panel.webview.postMessage({
      type: 'setTool',
      payload: { tool },
    });
  }

  public dispose(): void {
    CheatSheetPanel.currentPanel = undefined;
    StateManager.setCheatSheetOpen(false);

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
      vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'cheatsheet.js')
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

    const templatePath = path.join(this._extensionUri.fsPath, 'src', 'webview', 'cheatsheet.html');
    let htmlContent = '';

    try {
      htmlContent = fs.readFileSync(templatePath, 'utf8');
      htmlContent = htmlContent
        .replace(/{{cspSource}}/g, webview.cspSource)
        .replace(/{{nonce}}/g, nonce)
        .replace(/{{styleUri}}/g, styleUri.toString())
        .replace(/{{scriptUri}}/g, scriptUri.toString())
        .replace(/{{version}}/g, 'v' + version);
    } catch (e) {
      htmlContent = `<!DOCTYPE html><html><body><h3>Erreur de chargement du Guide IA</h3><pre>${e}</pre></body></html>`;
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
