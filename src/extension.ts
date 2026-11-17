import * as vscode from 'vscode';
import { SidebarViewProvider } from './providers/SidebarViewProvider';
import { DashboardPanel } from './providers/DashboardPanel';
import { CheatSheetPanel } from './providers/CheatSheetPanel';
import { StateManager } from './services/StateManager';
import { WorkspaceDetector } from './services/WorkspaceDetector';
import { confirmAndAllowNasHost } from './ui/nasHostAuthorization';
import { warmupTokenizer } from './utils/tokenizer';
import { ANTIGRAVITY_PROFILE_SETTING } from './antigravity/behaviorProfile';
import { createDiscoveryContainer } from './common/container';
import { extensionEventBus } from './common/ExtensionEventBus';
import { DiscoveryViewProvider } from './ui/DiscoveryViewProvider';
import { EnvironmentStatusBar } from './ui/EnvironmentStatusBar';
import { registerBancEssai } from './ui/bancEssaiCommandes';
import { registerClaudeWatchers } from './ui/claudeWatchers';
import {
  DISCOVERY_ENABLED_SETTING,
  isDiscoveryEnabled,
  registerDiscoveryCommands,
  refreshFavoritesContextKey,
} from './ui/discoveryCommands';
import { registerManifestPreview } from './ui/vscodeDeployReview';
import { HostEnvironmentDetector } from './environment/HostEnvironmentDetector';
import { AgentRuntimeDetector } from './environment/AgentRuntimeDetector';

export const WATCHER_PATTERNS = {
  configFolders: '**/{.agents,.agent,.claude}/**',
  soulFiles: '**/{CLAUDE.md,GEMINI.md,AGENTS.md}',
};

/** Relance le scan, après le délai des observateurs, quand change un réglage qui modifie ce qu'il compte. */
export function registerScanSettingsReload(context: Pick<vscode.ExtensionContext, 'subscriptions'>): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      // Le profil de comportement d'Antigravity, le dossier global et le profil de Claude Code (lu et observé
      // par les observateurs du dehors) changent ce que compte le scan
      if (
        event.affectsConfiguration(ANTIGRAVITY_PROFILE_SETTING)
        || event.affectsConfiguration('skillsManager.globalPath')
        || event.affectsConfiguration('skillsManager.claudeGlobalPath')
      ) {
        StateManager.requestDebouncedReload(350);
      }
    })
  );
}

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

  // 6. Commande pour autoriser l'hôte NAS dans la sécurité VS Code (après confirmation, même parcours que le bouton)
  context.subscriptions.push(
    vscode.commands.registerCommand('skillsRulesManager.allowNasUncHost', async () => {
      if (await confirmAndAllowNasHost()) {
        await StateManager.loadFullState(true);
      }
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

  // 6a. Claude Code : observateurs des fichiers de mémoire que ces deux motifs ne couvrent pas, dans l'espace
  // (CLAUDE.local.md, fichiers importés hors de .claude/) et hors de l'espace (fichiers des parents, imports
  // extérieurs, CLAUDE.md global et ses imports, MEMORY.md, settings.json du profil) ; un par fichier, sous
  // un seul plafond, recalculés à chaque état, aucun pour Antigravity
  registerClaudeWatchers(context);

  // 6b. Banc d'essai : commande « Vider et restaurer », barre d'état, observateur du manifeste et
  // de la sauvegarde, avertissement au démarrage tant qu'un banc est déployé ou inachevé
  registerBancEssai(context);

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

  // Le module est expérimental et désactivé par défaut : son badge d'environnement suit le réglage
  const environmentStatusBar = new EnvironmentStatusBar(container.bus);
  environmentStatusBar.activate(isDiscoveryEnabled());
  context.subscriptions.push(
    environmentStatusBar,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(DISCOVERY_ENABLED_SETTING)) {
        environmentStatusBar.setVisible(isDiscoveryEnabled());
      }
    })
  );
  registerScanSettingsReload(context);

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
