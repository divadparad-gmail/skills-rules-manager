import * as vscode from 'vscode';
import { SidebarViewProvider } from './providers/SidebarViewProvider';
import { DashboardPanel } from './providers/DashboardPanel';
import { CheatSheetPanel } from './providers/CheatSheetPanel';
import { StateManager } from './services/StateManager';
import { WorkspaceDetector } from './services/WorkspaceDetector';
import { NasScanner } from './services/NasScanner';
import { warmupTokenizer } from './utils/tokenizer';

export const WATCHER_PATTERNS = {
  configFolders: '**/{.agents,.agent,.claude}/**',
  soulFiles: '**/{CLAUDE.md,GEMINI.md,AGENTS.md}',
};

export function activate(context: vscode.ExtensionContext): void {
  // 1. Enregistrement du WebviewViewProvider pour l'Activity Bar
  const sidebarProvider = new SidebarViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarViewProvider.viewType,
      sidebarProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
  );

  // 2. Commande d'ouverture / fermeture du Grand Dashboard plein écran (Toggle)
  context.subscriptions.push(
    vscode.commands.registerCommand('skillsRulesManager.openDashboard', () => {
      StateManager.toggleDashboard(context.extensionUri);
    })
  );

  // 2b. Commande d'ouverture du Guide & Bonnes Pratiques IA (Cheat Sheet)
  context.subscriptions.push(
    vscode.commands.registerCommand('skillsRulesManager.openCheatSheet', () => {
      const currentTool = WorkspaceDetector.detectWorkspace().tool;
      StateManager.toggleCheatSheet(context.extensionUri, currentTool);
    })
  );

  // 3. Commande de rafraîchissement manuel
  context.subscriptions.push(
    vscode.commands.registerCommand('skillsRulesManager.refresh', async () => {
      await StateManager.loadFullState(true);
      vscode.window.showInformationMessage('Skills & Rules Manager : Actualisation effectuée.');
    })
  );

  // 4. Commande pour désactiver tous les workflows globaux (économie tokens)
  context.subscriptions.push(
    vscode.commands.registerCommand('skillsRulesManager.disableAllWorkflows', async () => {
      await StateManager.disableAllWorkflows('global');
    })
  );

  // 5. Commande pour activer tous les skills globaux
  context.subscriptions.push(
    vscode.commands.registerCommand('skillsRulesManager.enableAllSkills', async () => {
      await StateManager.enableAllSkills('global');
    })
  );

  // 6. Commande pour autoriser l'hôte NAS dans la sécurité VS Code
  context.subscriptions.push(
    vscode.commands.registerCommand('skillsRulesManager.allowNasUncHost', async () => {
      const config = vscode.workspace.getConfiguration('skillsManager');
      const nasPath = config.get<string>('nasPath', '\\\\Nas1\\DD2\\IA\\Antigravity-Templates');
      await NasScanner.ensureAllowedUNCHost(nasPath);
      await StateManager.loadFullState(true);
      vscode.window.showInformationMessage('Hôte UNC autorisé dans les paramètres de sécurité VS Code.');
    })
  );

  // 6. Surveillance des modifications de fichiers dans le projet actif avec debounce (~350 ms)
  // Deux watchers distincts pour couvrir à la fois les dossiers et les fichiers âme isolés
  const configWatcher = vscode.workspace.createFileSystemWatcher(WATCHER_PATTERNS.configFolders);
  configWatcher.onDidChange(() => StateManager.requestDebouncedReload(350));
  configWatcher.onDidCreate(() => StateManager.requestDebouncedReload(350));
  configWatcher.onDidDelete(() => StateManager.requestDebouncedReload(350));
  context.subscriptions.push(configWatcher);

  const soulWatcher = vscode.workspace.createFileSystemWatcher(WATCHER_PATTERNS.soulFiles);
  soulWatcher.onDidChange(() => StateManager.requestDebouncedReload(350));
  soulWatcher.onDidCreate(() => StateManager.requestDebouncedReload(350));
  soulWatcher.onDidDelete(() => StateManager.requestDebouncedReload(350));
  context.subscriptions.push(soulWatcher);

  // 7. Préchauffage discret du tokenizer en arrière-plan
  setTimeout(() => {
    warmupTokenizer();
  }, 100);

  // 8. Préchargement initial en arrière-plan
  StateManager.loadFullState(true).catch(() => {
    // Échec silencieux au démarrage si réseau NAS indisponible
  });
}

export function deactivate(): void {
  // Nettoyage lors de la désactivation
}
