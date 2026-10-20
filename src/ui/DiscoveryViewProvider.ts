/**
 * Vue « Découverte & Intégration » : panneau de recherche, favoris et
 * réglages de registres (§3.2, §3.3, §3.4 et §3.5 du PRD).
 *
 * Le fournisseur est un composant autonome : il possède son propre cycle de
 * vie, ne détient aucune référence vers les autres vues et ne dialogue avec le
 * reste de l'extension que par le médiateur d'événements. Lorsqu'il est replié,
 * les messages qui lui sont destinés sont mis en file puis rejoués à sa
 * réapparition, ce qui élimine les états d'affichage périmés.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  DiscoveryExtensionMessage,
  DiscoveryViewState,
  DiscoveryWebviewMessage,
} from '../common/discoveryMessages';
import { SearchCriteria, SkillSearchResult } from '../common/discoveryTypes';
import { DeployTarget } from '../common/eventTypes';
import { ExtensionEventBus } from '../common/ExtensionEventBus';
import { FederatedSearchService } from '../search/FederatedSearchService';
import { FavoritesService } from '../search/FavoritesService';
import { RecentSearchesStore } from '../search/RecentSearchesStore';
import { RegistryConfigService } from '../settings/RegistryConfigService';
import { NasPathService } from '../settings/NasPathService';
import { MultiTargetDeployService } from '../deploy/MultiTargetDeployService';
import { reviewAndDeploy } from '../deploy/deployReview';
import { createVsCodeDeployReview, currentDeployEnvironment } from './vscodeDeployReview';
import { HostEnvironmentDetector } from '../environment/HostEnvironmentDetector';
import { AgentRuntimeDetector } from '../environment/AgentRuntimeDetector';
import { GEMINI_API_KEY_SECRET } from '../search/GeminiClient';
import { SecretStoragePort } from '../settings/RegistryConfigService';

export interface DiscoveryDependencies {
  registryConfig: RegistryConfigService;
  nasPaths: NasPathService;
  search: FederatedSearchService;
  favorites: FavoritesService;
  recentSearches: RecentSearchesStore;
  deploy: MultiTargetDeployService;
  secrets: SecretStoragePort;
  bus: ExtensionEventBus;
}

export class DiscoveryViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'antigravityDiscoveryView';
  public static readonly viewId = 'discovery.panel';

  private view?: vscode.WebviewView;

  /** Derniers résultats servis, pour retrouver une fiche lors d'un déploiement. */
  private lastResults = new Map<string, SkillSearchResult>();

  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly deps: DiscoveryDependencies
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((raw: unknown) => {
      void this.handleMessage(raw as DiscoveryWebviewMessage);
    });

    // La visibilité pilote la mise en file : une vue repliée ne reçoit rien,
    // ses messages sont rejoués dès qu'elle revient à l'écran.
    this.subscriptions.push(
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          this.deps.bus.mountView(DiscoveryViewProvider.viewId);
          void this.pushState();
        } else {
          this.deps.bus.unmountView(DiscoveryViewProvider.viewId);
        }
      })
    );

    webviewView.onDidDispose(() => {
      this.deps.bus.unmountView(DiscoveryViewProvider.viewId);
      this.subscriptions.forEach((subscription) => subscription.dispose());
      this.subscriptions.length = 0;
      this.view = undefined;
    });
  }

  /** Donne le focus au champ de recherche depuis un raccourci clavier. */
  public async focusSearchInput(): Promise<void> {
    await vscode.commands.executeCommand(`${DiscoveryViewProvider.viewType}.focus`);
    this.post({ type: 'discovery:focusSearch' });
  }

  // ------------------------------------------------------------------
  // Traitement des intentions de la vue
  // ------------------------------------------------------------------

  private async handleMessage(message: DiscoveryWebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'discovery:ready':
          this.deps.bus.hydrateView(DiscoveryViewProvider.viewId, () => {
            void this.pushState();
          });
          break;

        case 'discovery:search':
          await this.runSearch(message.payload);
          break;

        case 'discovery:suggest':
          this.post({
            type: 'discovery:suggestions',
            payload: { entries: this.deps.recentSearches.suggest(message.payload.prefix) },
          });
          break;

        case 'discovery:history:remove':
          await this.deps.recentSearches.remove(message.payload.query);
          this.post({
            type: 'discovery:history',
            payload: { entries: this.deps.recentSearches.listMerged() },
          });
          break;

        case 'discovery:history:clear':
          await this.deps.recentSearches.clear();
          this.post({ type: 'discovery:history', payload: { entries: [] } });
          break;

        case 'discovery:favorite:toggle': {
          const favorited = await this.deps.favorites.toggle(message.payload.result);
          this.notify(
            'info',
            favorited
              ? `« ${message.payload.result.name} » a été ajoutée aux favoris.`
              : `« ${message.payload.result.name} » a été retirée des favoris.`
          );
          this.pushFavorites();
          break;
        }

        case 'discovery:favorite:remove':
          await this.deps.favorites.remove(message.payload.id);
          this.pushFavorites();
          break;

        case 'discovery:favorites:export':
          await this.exportFavorites();
          break;

        case 'discovery:favorites:import':
          await this.importFavorites();
          break;

        case 'discovery:deploy':
          await this.deployResource(message.payload.id, message.payload.target);
          break;

        case 'discovery:registry:add':
          await this.deps.registryConfig.addRegistry(message.payload.registry);
          this.pushRegistries();
          this.notify('info', 'Le registre a été ajouté.');
          break;

        case 'discovery:registry:update':
          await this.deps.registryConfig.updateRegistry(message.payload.id, message.payload.changes);
          this.pushRegistries();
          break;

        case 'discovery:registry:remove':
          await this.confirmAndRemoveRegistry(message.payload.id);
          break;

        case 'discovery:registry:toggle':
          await this.deps.registryConfig.toggleRegistry(message.payload.id, message.payload.enabled);
          this.pushRegistries();
          break;

        case 'discovery:registry:reorder':
          await this.deps.registryConfig.reorderRegistries(message.payload.orderedIds);
          this.pushRegistries();
          break;

        case 'discovery:registry:test':
          await this.testRegistry(message.payload.id);
          break;

        case 'discovery:registry:setSecret':
          await this.captureRegistrySecret(message.payload.id);
          break;

        case 'discovery:nas:browse':
          await this.browseNasDirectory();
          break;

        case 'discovery:nas:validate': {
          const status = await this.deps.nasPaths.validatePath();
          this.post({ type: 'discovery:nas:status', payload: status });
          break;
        }

        case 'discovery:gemini:setKey':
          await this.captureGeminiKey();
          break;

        case 'discovery:env:override':
          await vscode.commands.executeCommand('antigravity.environment.override');
          break;

        case 'discovery:env:diagnostics':
          await vscode.commands.executeCommand('antigravity.environment.diagnostics');
          break;

        default:
          break;
      }
    } catch (err) {
      this.notify('error', err instanceof Error ? err.message : String(err));
    }
  }

  /** Lance une recherche fédérée et renvoie les résultats classés à la vue. */
  private async runSearch(payload: {
    query: string;
    types: SearchCriteria['types'];
    sortBy: SearchCriteria['sortBy'];
    minRating?: number;
    verifiedOnly?: boolean;
  }): Promise<void> {
    const query = payload.query.trim();
    if (query.length === 0) {
      this.notify('warning', 'Saisissez une description avant de lancer la recherche.');
      return;
    }

    this.post({ type: 'discovery:searching', payload: { query } });

    const criteria: SearchCriteria = {
      query,
      types: payload.types.length > 0 ? payload.types : ['skills'],
      sortBy: payload.sortBy,
      minRating: payload.minRating,
      verifiedOnly: payload.verifiedOnly,
      limit: 50,
    };

    const outcome = await this.deps.search.search(criteria);

    this.lastResults = new Map(outcome.results.map((result) => [result.id, result]));

    await this.deps.recentSearches.record({
      query: criteria.query,
      types: criteria.types,
      sortBy: criteria.sortBy,
      resultCount: outcome.results.length,
    });

    this.post({
      type: 'discovery:results',
      payload: {
        queryId: outcome.queryId,
        results: outcome.results,
        failures: outcome.failures,
        durationMs: outcome.durationMs,
        refinements: outcome.refinements,
      },
    });
    this.post({
      type: 'discovery:history',
      payload: { entries: this.deps.recentSearches.listMerged() },
    });
  }

  /**
   * Déploie une ressource vers l'une des trois cibles, après aperçu et
   * confirmation. Le manifeste provient des derniers résultats ou du cache
   * hors ligne des favoris.
   */
  private async deployResource(id: string, target: DeployTarget): Promise<void> {
    const fromResults = this.lastResults.get(id);
    const favorite = this.deps.favorites.listAll({}).find((item) => item.id === id);
    const manifest =
      fromResults?.manifest ?? this.deps.favorites.readCachedManifest(id) ?? favorite?.manifest;
    const source = fromResults ?? favorite;

    if (!manifest || !source) {
      this.notify(
        'error',
        "Le manifeste de cette ressource est introuvable : relancez la recherche pour le récupérer."
      );
      return;
    }

    const environment = currentDeployEnvironment();
    const result = await reviewAndDeploy(
      this.deps.deploy,
      {
        id,
        name: source.name,
        type: source.type,
        manifest,
        registryId: source.registryId,
        registryName: source.registryName,
        url: source.url,
      },
      { target, ...environment },
      createVsCodeDeployReview((level, message) => this.notify(level, message))
    );

    if (result?.success) {
      await this.deps.favorites.markUsed(id);
    }
  }

  private async confirmAndRemoveRegistry(id: string): Promise<void> {
    const registry = this.deps.registryConfig
      .getEffectiveRegistries()
      .find((entry) => entry.id === id);
    const label = registry ? registry.name : id;

    const confirmation = await vscode.window.showWarningMessage(
      `Supprimer le registre « ${label} » ?`,
      { modal: true },
      'Supprimer'
    );
    if (confirmation !== 'Supprimer') return;

    await this.deps.registryConfig.removeRegistry(id);
    this.pushRegistries();
    this.notify('info', `Le registre « ${label} » a été supprimé.`);
  }

  private async testRegistry(id: string): Promise<void> {
    const registry = this.deps.registryConfig
      .getEffectiveRegistries()
      .find((entry) => entry.id === id);
    if (!registry) {
      this.notify('error', `Aucun registre portant l'identifiant « ${id} » n'a été trouvé.`);
      return;
    }
    const probe = await this.deps.registryConfig.testConnection(registry);
    this.post({ type: 'discovery:registry:probe', payload: probe });
  }

  private async captureRegistrySecret(id: string): Promise<void> {
    const registry = this.deps.registryConfig
      .getEffectiveRegistries()
      .find((entry) => entry.id === id);
    if (!registry) return;
    if (registry.origin === 'workspace') {
      this.notify(
        'warning',
        `« ${registry.name} » est défini par le dépôt ouvert : il ne peut pas recevoir d'identifiant.`
      );
      return;
    }

    const secret = await vscode.window.showInputBox({
      prompt: `Identifiant d'accès pour « ${registry.name} »`,
      password: true,
      ignoreFocusOut: true,
    });
    if (secret === undefined || secret.length === 0) return;

    const key = await this.deps.registryConfig.storeCredential(registry, secret);
    if (registry.secretKeyRef !== key) {
      await this.deps.registryConfig.updateRegistry(registry.id, { secretKeyRef: key });
    }
    this.pushRegistries();
    this.notify('info', "L'identifiant a été enregistré dans le coffre chiffré du système.");
  }

  private async captureGeminiKey(): Promise<void> {
    const key = await vscode.window.showInputBox({
      prompt: "Clé d'API Gemini utilisée pour la recherche sémantique",
      password: true,
      ignoreFocusOut: true,
    });
    if (key === undefined) return;

    if (key.length === 0) {
      await this.deps.secrets.delete(GEMINI_API_KEY_SECRET);
      this.notify('info', "La clé Gemini a été supprimée : la recherche reste lexicale et locale.");
    } else {
      await this.deps.secrets.store(GEMINI_API_KEY_SECRET, key);
      this.notify('info', 'La clé Gemini a été enregistrée dans le coffre chiffré.');
    }
    await this.pushState();
  }

  private async browseNasDirectory(): Promise<void> {
    const selection = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Choisir le répertoire NAS',
    });
    if (!selection || selection.length === 0) return;

    await this.deps.nasPaths.setPath(selection[0].fsPath);
    const status = await this.deps.nasPaths.validatePath();
    this.post({ type: 'discovery:nas:status', payload: status });
    await this.pushState();
  }

  private async exportFavorites(): Promise<void> {
    const bundle = this.deps.favorites.exportBundle();
    const destination = await vscode.window.showSaveDialog({
      filters: { JSON: ['json'] },
      saveLabel: 'Exporter les favoris',
      defaultUri: vscode.Uri.file('antigravity-favoris.json'),
    });
    if (!destination) return;

    await fs.promises.writeFile(destination.fsPath, JSON.stringify(bundle, null, 2), 'utf8');
    this.notify('info', `${bundle.favorites.length} favori(s) exporté(s) vers ${destination.fsPath}.`);
  }

  private async importFavorites(): Promise<void> {
    const selection = await vscode.window.showOpenDialog({
      filters: { JSON: ['json'] },
      canSelectMany: false,
      openLabel: 'Importer des favoris',
    });
    if (!selection || selection.length === 0) return;

    const raw = await fs.promises.readFile(selection[0].fsPath, 'utf8');
    const outcome = await this.deps.favorites.importBundle(JSON.parse(raw));
    this.pushFavorites();
    this.notify(
      'info',
      `${outcome.imported} favori(s) importé(s), ${outcome.skipped} ignoré(s) car déjà à jour.`
    );
  }

  // ------------------------------------------------------------------
  // Émission vers la vue
  // ------------------------------------------------------------------

  public async pushState(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const hostContext = HostEnvironmentDetector.getContext();
    const runtimeContext = AgentRuntimeDetector.getContext(workspaceFolder?.uri.fsPath ?? null);
    const geminiKey = await this.deps.secrets.get(GEMINI_API_KEY_SECRET);

    const state: DiscoveryViewState = {
      host: hostContext.host,
      hostScore: hostContext.score,
      hostOverridden: hostContext.overridden,
      runtime: runtimeContext.runtime,
      registries: this.deps.registryConfig.getEffectiveRegistries(),
      favorites: this.deps.favorites.listAll({}),
      recentSearches: this.deps.recentSearches.listMerged(),
      nasPath: this.deps.nasPaths.getEffectivePath(),
      nasConfigured: this.deps.nasPaths.isConfigured(),
      geminiConfigured: typeof geminiKey === 'string' && geminiKey.length > 0,
    };

    this.post({ type: 'discovery:state', payload: state });
  }

  private pushFavorites(): void {
    this.post({
      type: 'discovery:favorites',
      payload: { favorites: this.deps.favorites.listAll({}) },
    });
  }

  private pushRegistries(): void {
    this.post({
      type: 'discovery:registries',
      payload: { registries: this.deps.registryConfig.getEffectiveRegistries() },
    });
  }

  private notify(level: 'info' | 'warning' | 'error', message: string): void {
    this.post({ type: 'discovery:notification', payload: { level, message } });
  }

  private post(message: DiscoveryExtensionMessage): void {
    void this.view?.webview.postMessage(message);
  }

  // ------------------------------------------------------------------
  // Utilitaires
  // ------------------------------------------------------------------

  private renderHtml(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'discovery.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'discovery.js')
    );
    const nonce = createNonce();
    const templatePath = path.join(this.extensionUri.fsPath, 'src', 'webview', 'discovery.html');

    try {
      return fs
        .readFileSync(templatePath, 'utf8')
        .replace(/{{cspSource}}/g, webview.cspSource)
        .replace(/{{nonce}}/g, nonce)
        .replace(/{{styleUri}}/g, styleUri.toString())
        .replace(/{{scriptUri}}/g, scriptUri.toString());
    } catch {
      return '<!DOCTYPE html><html lang="fr"><body><p>Le gabarit de la vue Découverte est introuvable.</p></body></html>';
    }
  }
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}
