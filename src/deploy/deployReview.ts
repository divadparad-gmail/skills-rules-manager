/**
 * Parcours d'installation d'une ressource venue d'un registre, partagé par la
 * vue Découverte et par les commandes de la palette.
 *
 * Le manifeste sera lu comme instruction par un agent : avant toute écriture,
 * son contenu est montré à l'utilisateur, puis une confirmation explicite lui
 * est demandée, avec le registre d'origine et les éventuels avertissements de
 * l'heuristique. Les interactions passent par un port injectable, ce qui garde
 * le parcours testable hors de VS Code.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConflictPolicy, DeploymentResult } from '../common/discoveryTypes';
import { DeployTarget, DiscoveryResourceType } from '../common/eventTypes';
import { DeployContext, MultiTargetDeployService } from './MultiTargetDeployService';

/** Ressource proposée à l'installation, avec son registre d'origine. */
export interface ReviewableResource {
  /** Identifiant composite « <registryId>:<entryId> ». */
  id: string;
  name: string;
  type: DiscoveryResourceType;
  manifest: string;
  registryId: string;
  registryName: string;
  url?: string;
}

/** Interactions avec l'utilisateur, injectables pour les tests. */
export interface DeployReviewPort {
  /** Affiche le manifeste dans un document en lecture seule. */
  showManifest(resource: ReviewableResource): Promise<void>;
  /** Fenêtre modale « Installer / Annuler » ; vrai si l'utilisateur installe. */
  confirmInstall(message: string, detail: string): Promise<boolean>;
  /** Choix offert lorsqu'une ressource de même nom existe déjà à destination. */
  resolveConflict(message: string): Promise<'overwrite' | 'increment' | undefined>;
  report(level: 'info' | 'error', message: string): void;
}

export interface DeployReviewOptions {
  target: DeployTarget;
  context: DeployContext;
  conflictPolicy: ConflictPolicy;
  /** Horloge injectable, pour un horodatage de provenance déterministe. */
  now?: () => Date;
}

const TARGET_DESCRIPTIONS: Record<DeployTarget, string> = {
  local: 'le projet ouvert',
  nas: 'le partage NAS',
  global: 'le profil global de la machine',
};

/**
 * Montre le manifeste, demande confirmation puis déploie. Retourne le compte
 * rendu du déploiement, ou `undefined` si l'utilisateur a renoncé.
 */
export async function reviewAndDeploy(
  deploy: MultiTargetDeployService,
  resource: ReviewableResource,
  options: DeployReviewOptions,
  ui: DeployReviewPort
): Promise<DeploymentResult | undefined> {
  const verdict = MultiTargetDeployService.validateManifest(resource.manifest);
  if (!verdict.safe) {
    const error = `Le manifeste de « ${resource.name} » a été refusé : ${verdict.issues.join(' ')}`;
    ui.report('error', error);
    return { success: false, target: options.target, error };
  }

  await ui.showManifest(resource);

  const detail = [
    `Registre d'origine : ${resource.registryName} (${resource.registryId})`,
    `Destination : ${TARGET_DESCRIPTIONS[options.target]}`,
    '',
    "Ce fichier sera lu comme instruction par votre agent. Relisez le contenu affiché dans l'éditeur avant de l'installer.",
    ...(verdict.warnings.length > 0
      ? ['', 'Points à vérifier :', ...verdict.warnings.map((warning) => `• ${warning}`)]
      : []),
  ].join('\n');

  const confirmed = await ui.confirmInstall(
    `Installer « ${resource.name} » depuis le registre « ${resource.registryName} » ?`,
    detail
  );
  if (!confirmed) return undefined;

  const request = {
    skillId: resourceIdFromComposite(resource.id, resource.name),
    name: resource.name,
    type: resource.type,
    manifest: resource.manifest,
    target: options.target,
    conflictPolicy: options.conflictPolicy,
    provenance: {
      registryId: resource.registryId,
      registryName: resource.registryName,
      ...(resource.url ? { url: resource.url } : {}),
      installedAt: (options.now ?? (() => new Date()))().toISOString(),
    },
  };

  const result = await deploy.deploy(request, options.context);

  if (result.success) {
    const suffix = result.fellBackToLocal
      ? ' (repli sur le projet local : le partage NAS était injoignable)'
      : result.versioned
        ? ' (une version incrémentée a été créée)'
        : '';
    ui.report('info', `« ${resource.name} » a été déployée vers ${result.targetPath}${suffix}.`);
    return result;
  }

  // En politique « demander », le service rend la main : on propose ici les
  // deux issues possibles plutôt que d'échouer silencieusement.
  if (options.conflictPolicy === 'prompt' && result.error?.includes('existe déjà')) {
    const choice = await ui.resolveConflict(result.error);
    if (!choice) return undefined;

    const retry = await deploy.deploy({ ...request, conflictPolicy: choice }, options.context);
    ui.report(
      retry.success ? 'info' : 'error',
      retry.success
        ? `« ${resource.name} » a été déployée vers ${retry.targetPath}.`
        : retry.error ?? 'Le déploiement a échoué.'
    );
    return retry;
  }

  ui.report('error', result.error ?? 'Le déploiement a échoué.');
  return result;
}

/**
 * Convertit l'identifiant composite « registre:entrée » en identifiant de
 * ressource utilisable comme nom de dossier.
 */
export function resourceIdFromComposite(compositeId: string, fallbackName: string): string {
  const separatorIndex = compositeId.indexOf(':');
  const raw = separatorIndex >= 0 ? compositeId.slice(separatorIndex + 1) : compositeId;
  return raw.trim().length > 0 ? raw : fallbackName;
}

/** Dossier d'agent du projet : `.agents`, `.agent`, ou `.agents` par défaut. */
export function detectAgentsDirName(workspaceRoot: string | null): string | null {
  if (!workspaceRoot) return null;
  for (const candidate of ['.agents', '.agent']) {
    if (fs.existsSync(path.join(workspaceRoot, candidate))) {
      return candidate;
    }
  }
  return '.agents';
}
