import * as vscode from 'vscode';
import { SidebarViewProvider } from './providers/SidebarViewProvider';
import { DashboardPanel } from './providers/DashboardPanel';
import { CheatSheetPanel } from './providers/CheatSheetPanel';
import { StateManager } from './services/StateManager';
import { WorkspaceDetector } from './services/WorkspaceDetector';
import { NasScanner } from './services/NasScanner';
import { warmupTokenizer } from './utils/tokenizer';
import { createDiscoveryContainer } from './common/container';
import { extensionEventBus } from './common/ExtensionEventBus';
import { DiscoveryViewProvider } from './ui/DiscoveryViewProvider';
import { EnvironmentStatusBar } from './ui/EnvironmentStatusBar';
import { registerDiscoveryCommands, refreshFavoritesContextKey } from './ui/discoveryCommands';
import { registerManifestPreview } from './ui/vscodeDeployReview';
import { HostEnvironmentDetector } from './environment/HostEnvironmentDetector';
import { AgentRuntimeDetector } from './environment/AgentRuntimeDetector';

export const WATCHER_PATTERNS = {
  configFolders: '**/{.agents,.agent,.claude}/**',
  soulFiles: '**/{CLAUDE.md,GEMINI.md,AGENTS.md}',
};

export function activate(context: vscode.ExtensionContext): void {
  // 0. Sondage d'environnement avant tout enregistrement lourd : le verdict
  // conditionne le routage des déploiements et l'affichage de la barre d'état.
  HostEnvironmentDetector.detect();
  AgentRuntimeDetector.detect(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null);

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

  // 7. Module « Découverte & Intégration » : conteneur d'injection de
  // dépendances, vue dédiée, badge d'environnement et accélérateurs clavier.
  const container = createDiscoveryContainer(context, extensionEventBus);

  const discoveryProvider = new DiscoveryViewProvider(context.extensionUri, {
    registryConfig: container.registryConfig,
    nasPaths: container.nasPaths,
    search: container.search,
    favorites: container.favorites,
    recentSearches: container.recentSearches,
    deploy: container.deploy,
    secrets: container.secrets,
    bus: container.bus,
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DiscoveryViewProvider.viewType,
      discoveryProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  const environmentStatusBar = new EnvironmentStatusBar(container.bus);
  environmentStatusBar.activate();
  context.subscriptions.push(environmentStatusBar);

  registerDiscoveryCommands(context, container, discoveryProvider, environmentStatusBar);
  // Aperçu en lecture seule des manifestes, montré avant toute installation.
  registerManifestPreview(context);

  // La clé de contexte des favoris pilote l'activation du raccourci de
  // déploiement express : elle suit chaque bascule d'étoile.
  context.subscriptions.push(
    container.bus.subscribe('skill:favorite:toggled', () => {
      void refreshFavoritesContextKey(container);
    })
  );

  // Le verdict d'environnement est réévalué quand le contexte change :
  // ajout ou retrait d'un dossier, retour du focus sur la fenêtre.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      environmentStatusBar.refresh();
      void discoveryProvider.pushState();
    }),
    vscode.window.onDidChangeWindowState((windowState) => {
      if (windowState.focused) {
        environmentStatusBar.refresh();
      }
    })
  );

  // 8. Préchauffage discret du tokenizer en arrière-plan
  setTimeout(() => {
    warmupTokenizer();
  }, 100);

  // 9. Préchargement initial en arrière-plan
  StateManager.loadFullState(true).catch(() => {
    // Échec silencieux au démarrage si réseau NAS indisponible
  });
}

export function deactivate(): void {
  // Nettoyage lors de la désactivation
}
