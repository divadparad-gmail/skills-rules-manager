/**
 * Conteneur d'injection de dépendances des modules découplés (§2.D du PRD).
 *
 * Il assemble en un seul endroit les ports concrets (configuration, coffre de
 * secrets, transport HTTP, persistance) et les services de domaine. Les
 * modules restent ainsi ignorants les uns des autres : seule cette fabrique
 * connaît l'arbre complet des dépendances.
 */

import * as vscode from 'vscode';
import { ExtensionEventBus, extensionEventBus } from './ExtensionEventBus';
import { RegistryConfigService, SecretStoragePort } from '../settings/RegistryConfigService';
import { NasPathService } from '../settings/NasPathService';
import {
  MementoAdapter,
  VsCodeConfigurationAdapter,
  VsCodeSecretStorageAdapter,
} from '../settings/vscodeAdapters';
import { FederatedSearchService } from '../search/FederatedSearchService';
import { SemanticSearchEngine } from '../search/SemanticSearchEngine';
import { GeminiClient } from '../search/GeminiClient';
import { httpHealthProbePort, httpSearchPort } from '../search/httpClient';
import { RecentSearchesStore } from '../search/RecentSearchesStore';
import { FavoritesService } from '../search/FavoritesService';
import { MultiTargetDeployService } from '../deploy/MultiTargetDeployService';

export interface DiscoveryContainer {
  bus: ExtensionEventBus;
  registryConfig: RegistryConfigService;
  nasPaths: NasPathService;
  search: FederatedSearchService;
  favorites: FavoritesService;
  recentSearches: RecentSearchesStore;
  deploy: MultiTargetDeployService;
  secrets: SecretStoragePort;
}

/**
 * Construit l'arbre de dépendances complet du domaine « Découverte &
 * Intégration » à partir du contexte d'extension.
 */
export function createDiscoveryContainer(
  context: vscode.ExtensionContext,
  bus: ExtensionEventBus = extensionEventBus
): DiscoveryContainer {
  const configuration = new VsCodeConfigurationAdapter();
  const secrets = new VsCodeSecretStorageAdapter(context.secrets);

  const registryConfig = new RegistryConfigService(configuration, secrets, httpHealthProbePort);
  const nasPaths = new NasPathService(configuration);

  // Le client Gemini est toujours instancié : il décide lui-même, à chaque
  // appel, s'il dispose d'une clé. Sans clé, le moteur sémantique bascule sur
  // son analyse lexicale locale sans que l'appelant ait à s'en préoccuper.
  const semantic = new SemanticSearchEngine(new GeminiClient(secrets));
  const search = new FederatedSearchService(registryConfig, httpSearchPort, semantic, bus);

  const globalState = new MementoAdapter(context.globalState);
  const workspaceState = new MementoAdapter(context.workspaceState);

  const recentSearches = new RecentSearchesStore(globalState, workspaceState, () =>
    configuration.get<number>('antigravity.search.recentSearchesLimit', 10)
  );
  const favorites = new FavoritesService(globalState, workspaceState, bus);
  const deploy = new MultiTargetDeployService(nasPaths, undefined, bus);

  return {
    bus,
    registryConfig,
    nasPaths,
    search,
    favorites,
    recentSearches,
    deploy,
    secrets,
  };
}
