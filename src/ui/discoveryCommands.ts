/**
 * Enregistrement des accélérateurs de flux de travail : palette de recherche
 * rapide, déploiement express d'un favori, bascule d'environnement et saisie
 * de la clé Gemini (§3.6 et §3.7 du PRD).
 *
 * Ces commandes offrent les mêmes actions que le panneau, sans quitter le
 * clavier ni ouvrir la vue : la palette suffit pour trouver une compétence et
 * l'injecter dans le projet courant.
 */

import * as vscode from 'vscode';
import { DiscoveryContainer } from '../common/container';
import { DeployTarget } from '../common/eventTypes';
import { SkillSearchResult } from '../common/discoveryTypes';
import { DiscoveryViewProvider } from './DiscoveryViewProvider';
import { EnvironmentStatusBar } from './EnvironmentStatusBar';
import { GEMINI_API_KEY_SECRET } from '../search/GeminiClient';
import { ReviewableResource, reviewAndDeploy } from '../deploy/deployReview';
import { createVsCodeDeployReview, currentDeployEnvironment } from './vscodeDeployReview';

const TARGET_LABELS: Array<{ target: DeployTarget; label: string; detail: string }> = [
  {
    target: 'local',
    label: '$(folder) Intégrer au projet local',
    detail: "Déploie la ressource dans l'espace de travail ouvert",
  },
  {
    target: 'nas',
    label: '$(server) Intégrer au NAS',
    detail: 'Synchronise la ressource vers le partage réseau centralisé',
  },
  {
    target: 'global',
    label: '$(globe) Intégrer au projet global',
    detail: 'Installe la ressource dans le profil de la machine',
  },
];

export function registerDiscoveryCommands(
  context: vscode.ExtensionContext,
  container: DiscoveryContainer,
  provider: DiscoveryViewProvider,
  statusBar: EnvironmentStatusBar
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.discovery.focusSearch', async () => {
      await provider.focusSearchInput();
    }),

    vscode.commands.registerCommand('antigravity.discovery.quickSearch', async () => {
      await runQuickSearch(container);
    }),

    vscode.commands.registerCommand('antigravity.discovery.quickDeploy', async () => {
      await runQuickDeploy(container);
    }),

    vscode.commands.registerCommand('antigravity.environment.override', async () => {
      await statusBar.promptOverride();
      await provider.pushState();
    }),

    vscode.commands.registerCommand('antigravity.environment.diagnostics', async () => {
      await statusBar.showDiagnostics();
    }),

    vscode.commands.registerCommand('antigravity.skills.setGeminiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Clé d'API Gemini utilisée pour la recherche sémantique",
        password: true,
        ignoreFocusOut: true,
      });
      if (key === undefined) return;

      if (key.length === 0) {
        await container.secrets.delete(GEMINI_API_KEY_SECRET);
        vscode.window.showInformationMessage(
          "La clé Gemini a été supprimée : la recherche s'appuie désormais sur l'analyse lexicale locale."
        );
      } else {
        await container.secrets.store(GEMINI_API_KEY_SECRET, key);
        vscode.window.showInformationMessage(
          'La clé Gemini a été enregistrée dans le coffre chiffré du système.'
        );
      }
      await provider.pushState();
    })
  );

  void refreshFavoritesContextKey(container);
}

/**
 * Tient à jour la clé de contexte conditionnant le raccourci de déploiement
 * express, afin qu'il ne se déclenche jamais sans favori enregistré.
 */
export async function refreshFavoritesContextKey(container: DiscoveryContainer): Promise<void> {
  const hasFavorites = container.favorites.listAll({}).length > 0;
  await vscode.commands.executeCommand('setContext', 'antigravityHasFavorites', hasFavorites);
}

/**
 * Palette de recherche légère : saisie, exécution fédérée, choix du résultat
 * puis de la cible d'intégration, sans ouvrir la vue complète.
 */
async function runQuickSearch(container: DiscoveryContainer): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: 'Décrivez la compétence, la règle, le workflow ou le hook recherché',
    placeHolder: 'extraire des tableaux dynamiques derrière une authentification',
    ignoreFocusOut: true,
  });
  if (!query || query.trim().length === 0) return;

  const outcome = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Recherche fédérée en cours…' },
    () =>
      container.search.search({
        query,
        types: ['skills', 'rules', 'workflows', 'hooks'],
        sortBy: 'relevance',
        limit: 25,
      })
  );

  await container.recentSearches.record({
    query,
    types: ['skills', 'rules', 'workflows', 'hooks'],
    sortBy: 'relevance',
    resultCount: outcome.results.length,
  });

  if (outcome.results.length === 0) {
    const detail =
      outcome.failures.length > 0
        ? ` ${outcome.failures.length} registre(s) n'ont pas répondu.`
        : '';
    vscode.window.showInformationMessage(`Aucune ressource ne correspond à cette description.${detail}`);
    return;
  }

  const picks = outcome.results.map((result) => ({
    label: `$(package) ${result.name}`,
    description: `${result.registryName} · ${Math.round(result.hybridScore * 100)} %`,
    detail: result.matchRationale || result.description,
    result,
  }));

  const chosen = await vscode.window.showQuickPick(picks, {
    title: `${outcome.results.length} résultat(s) en ${outcome.durationMs} ms`,
    placeHolder: 'Choisissez une ressource à intégrer',
    matchOnDetail: true,
  });
  if (!chosen) return;

  await promptAndDeploy(container, chosen.result);
}

/** Déploiement express depuis la collection de favoris. */
async function runQuickDeploy(container: DiscoveryContainer): Promise<void> {
  const favorites = container.favorites.listAll({});
  if (favorites.length === 0) {
    vscode.window.showInformationMessage(
      "Aucun favori n'est enregistré : ajoutez-en depuis la vue Découverte."
    );
    return;
  }

  const chosen = await vscode.window.showQuickPick(
    favorites.map((favorite) => ({
      label: `$(star-full) ${favorite.name}`,
      description: favorite.registryName,
      detail: favorite.description,
      favorite,
    })),
    { title: 'Déployer une compétence favorite', matchOnDetail: true }
  );
  if (!chosen) return;

  const manifest =
    chosen.favorite.manifest ?? container.favorites.readCachedManifest(chosen.favorite.id);
  if (!manifest) {
    vscode.window.showErrorMessage(
      "Le manifeste de ce favori est absent du cache hors ligne : relancez une recherche pour le récupérer."
    );
    return;
  }

  await deployResource(container, {
    id: chosen.favorite.id,
    name: chosen.favorite.name,
    type: chosen.favorite.type,
    manifest,
    registryId: chosen.favorite.registryId,
    registryName: chosen.favorite.registryName,
    url: chosen.favorite.url,
  });
}

async function promptAndDeploy(
  container: DiscoveryContainer,
  result: SkillSearchResult
): Promise<void> {
  const manifest = result.manifest ?? container.favorites.readCachedManifest(result.id);
  if (!manifest) {
    vscode.window.showErrorMessage(
      `Le registre « ${result.registryName} » n'a pas fourni le manifeste de « ${result.name} ».`
    );
    return;
  }

  await deployResource(container, {
    id: result.id,
    name: result.name,
    type: result.type,
    manifest,
    registryId: result.registryId,
    registryName: result.registryName,
    url: result.url,
  });
}

/**
 * Demande la cible puis confie l'aperçu, la confirmation et le déploiement au
 * parcours partagé avec la vue Découverte.
 */
async function deployResource(container: DiscoveryContainer, resource: ReviewableResource): Promise<void> {
  const targetChoice = await vscode.window.showQuickPick(TARGET_LABELS, {
    title: `Où intégrer « ${resource.name} » ?`,
  });
  if (!targetChoice) return;

  await reviewAndDeploy(
    container.deploy,
    resource,
    { target: targetChoice.target, ...currentDeployEnvironment() },
    createVsCodeDeployReview((level, message) => {
      if (level === 'error') {
        void vscode.window.showErrorMessage(message);
      } else {
        void vscode.window.showInformationMessage(message);
      }
    })
  );
}
