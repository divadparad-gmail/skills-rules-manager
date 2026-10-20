/**
 * Pipeline de déploiement multi-cible (§3.2, §3.5 et jalon 4 du PRD).
 *
 * Un même manifeste peut être injecté dans trois destinations : le dépôt
 * ouvert, le partage NAS centralisé ou le profil global de la machine. Le
 * service choisit la destination réelle en fonction de l'agent détecté,
 * applique la politique de conflit demandée, vérifie le contenu avant écriture
 * et replie le déploiement NAS sur le projet local lorsque le partage est
 * injoignable.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ConflictPolicy,
  DeploymentRequest,
  DeploymentResult,
} from '../common/discoveryTypes';
import { AgentRuntime, DeployTarget } from '../common/eventTypes';
import { ExtensionEventBus } from '../common/ExtensionEventBus';
import { SkillProtocolAdapter } from '../environment/SkillProtocolAdapter';
import { NasPathService } from '../settings/NasPathService';

/** Taille maximale admise pour un manifeste, garde-fou anti-charge utile. */
export const MAX_MANIFEST_BYTES = 512 * 1024;

export interface DeployContext {
  runtime: AgentRuntime;
  workspaceRoot: string | null;
  agentsDirName: string | null;
}

export interface SecurityVerdict {
  safe: boolean;
  issues: string[];
}

/** Opérations de fichiers injectables, pour tester sans toucher au disque. */
export interface DeployFileSystemPort {
  exists(targetPath: string): boolean;
  mkdir(directory: string): Promise<void>;
  writeFile(targetPath: string, content: string): Promise<void>;
}

export const nodeDeployFileSystem: DeployFileSystemPort = {
  exists: (targetPath: string) => fs.existsSync(targetPath),
  mkdir: async (directory: string) => {
    await fs.promises.mkdir(directory, { recursive: true });
  },
  writeFile: async (targetPath: string, content: string) => {
    await fs.promises.writeFile(targetPath, content, 'utf8');
  },
};

export class MultiTargetDeployService {
  constructor(
    private readonly nasPaths: NasPathService,
    private readonly fileSystem: DeployFileSystemPort = nodeDeployFileSystem,
    private readonly bus?: ExtensionEventBus
  ) {}

  /**
   * Déploie une ressource vers la cible demandée. Toute erreur est convertie
   * en compte rendu : l'appelant n'a jamais à intercepter d'exception.
   */
  public async deploy(
    request: DeploymentRequest,
    context: DeployContext
  ): Promise<DeploymentResult> {
    this.bus?.publish('skill:deploy:started', 'deploy.service', {
      skillId: request.skillId,
      target: request.target,
    });

    const verdict = MultiTargetDeployService.validateManifest(request.manifest);
    if (!verdict.safe) {
      return this.finish(request, {
        success: false,
        target: request.target,
        error: `Le manifeste a été refusé par la validation de sécurité : ${verdict.issues.join(' ')}`,
      });
    }

    let effectiveTarget: DeployTarget = request.target;
    let fellBackToLocal = false;
    let nasRoot: string | null = null;

    if (request.target === 'nas') {
      const preflight = await this.nasPaths.preflight();
      if (preflight.status !== 'connected') {
        // Le partage est absent ou refusé : plutôt que d'échouer, on bascule
        // sur le projet ouvert lorsque c'est possible, en le signalant.
        if (!context.workspaceRoot) {
          return this.finish(request, {
            success: false,
            target: 'nas',
            error: `${preflight.message} Aucun projet n'est ouvert pour un repli local.`,
          });
        }
        effectiveTarget = 'local';
        fellBackToLocal = true;
      } else {
        nasRoot = preflight.resolvedPath;
      }
    }

    let paths: { directory: string; file: string; isFolder: boolean };
    try {
      paths = SkillProtocolAdapter.resolveDeploymentPaths({
        runtime: context.runtime,
        target: effectiveTarget,
        type: request.type,
        resourceId: request.skillId,
        workspaceRoot: context.workspaceRoot,
        agentsDirName: context.agentsDirName,
        nasRoot,
      });
    } catch (err) {
      return this.finish(request, {
        success: false,
        target: effectiveTarget,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const resolution = this.applyConflictPolicy(paths, request.conflictPolicy);
    if (resolution.blocked) {
      return this.finish(request, {
        success: false,
        target: effectiveTarget,
        targetPath: paths.file,
        fellBackToLocal,
        error: resolution.message,
      });
    }

    try {
      await this.fileSystem.mkdir(resolution.directory);
      await this.fileSystem.writeFile(resolution.file, request.manifest);

      // Les annexes (scripts, références) accompagnent les compétences et les
      // workflows ; elles sont écrites sous le dossier de la ressource.
      for (const asset of request.assets ?? []) {
        const assetIssue = validateRelativePath(asset.relativePath);
        if (assetIssue) {
          return this.finish(request, {
            success: false,
            target: effectiveTarget,
            targetPath: resolution.file,
            fellBackToLocal,
            error: assetIssue,
          });
        }
        const assetPath = path.join(resolution.directory, asset.relativePath);
        await this.fileSystem.mkdir(path.dirname(assetPath));
        await this.fileSystem.writeFile(assetPath, asset.content);
      }

      return this.finish(request, {
        success: true,
        target: effectiveTarget,
        targetPath: resolution.file,
        fellBackToLocal,
        versioned: resolution.versioned,
      });
    } catch (err) {
      return this.finish(request, {
        success: false,
        target: effectiveTarget,
        targetPath: resolution.file,
        fellBackToLocal,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Déploie successivement vers plusieurs cibles, par exemple pour diffuser
   * une compétence à la fois en local et sur le partage d'équipe.
   */
  public async deployToTargets(
    request: Omit<DeploymentRequest, 'target'>,
    targets: DeployTarget[],
    context: DeployContext
  ): Promise<DeploymentResult[]> {
    const results: DeploymentResult[] = [];
    for (const target of targets) {
      results.push(await this.deploy({ ...request, target }, context));
    }
    return results;
  }

  /**
   * Applique la politique de conflit retenue lorsqu'une ressource de même nom
   * existe déjà à destination.
   */
  private applyConflictPolicy(
    paths: { directory: string; file: string; isFolder: boolean },
    policy: ConflictPolicy
  ): { directory: string; file: string; versioned: boolean; blocked: boolean; message: string } {
    const exists = this.fileSystem.exists(paths.file);
    if (!exists) {
      return { ...paths, versioned: false, blocked: false, message: '' };
    }

    switch (policy) {
      case 'overwrite':
        return { ...paths, versioned: false, blocked: false, message: '' };

      case 'increment': {
        const versioned = this.nextAvailablePath(paths);
        return { ...versioned, versioned: true, blocked: false, message: '' };
      }

      case 'prompt':
      default:
        // En mode « demander », le service ne tranche pas : il rend la main à
        // la couche d'interface, seule habilitée à interroger l'utilisateur.
        return {
          ...paths,
          versioned: false,
          blocked: true,
          message: `La ressource existe déjà à l'emplacement « ${paths.file} ». Choisissez d'écraser la version en place ou d'en créer une nouvelle.`,
        };
    }
  }

  /**
   * Cherche le premier suffixe de version libre, en s'arrêtant à un plafond
   * raisonnable pour ne pas boucler sur un système de fichiers défaillant.
   */
  private nextAvailablePath(paths: { directory: string; file: string; isFolder: boolean }): {
    directory: string;
    file: string;
    isFolder: boolean;
  } {
    for (let version = 2; version <= 100; version += 1) {
      if (paths.isFolder) {
        const directory = `${paths.directory}-v${version}`;
        const file = path.join(directory, path.basename(paths.file));
        if (!this.fileSystem.exists(file)) {
          return { directory, file, isFolder: true };
        }
      } else {
        const extension = path.extname(paths.file);
        const base = paths.file.slice(0, paths.file.length - extension.length);
        const file = `${base}-v${version}${extension}`;
        if (!this.fileSystem.exists(file)) {
          return { directory: paths.directory, file, isFolder: false };
        }
      }
    }
    return paths;
  }

  /** Publie le compte rendu sur le bus et le restitue à l'appelant. */
  private finish(request: DeploymentRequest, result: DeploymentResult): DeploymentResult {
    this.bus?.publish('skill:deploy:completed', 'deploy.service', {
      skillId: request.skillId,
      target: result.target,
      success: result.success,
      targetPath: result.targetPath,
      error: result.error,
    });
    return result;
  }

  /**
   * Vérification du manifeste avant écriture : présence de contenu, taille
   * bornée et absence de constructions manifestement hostiles.
   */
  public static validateManifest(manifest: string): SecurityVerdict {
    const issues: string[] = [];

    if (typeof manifest !== 'string' || manifest.trim().length === 0) {
      issues.push('le contenu est vide ;');
    }

    if (Buffer.byteLength(manifest ?? '', 'utf8') > MAX_MANIFEST_BYTES) {
      issues.push(`le contenu dépasse la taille maximale de ${MAX_MANIFEST_BYTES / 1024} Kio ;`);
    }

    // Un manifeste est un document Markdown : il ne doit contenir ni balise de
    // script ni protocole exécutable déguisé en lien.
    if (/<script[\s>]/i.test(manifest ?? '')) {
      issues.push('le contenu embarque une balise de script ;');
    }
    if (/javascript:\s*[^\s)]/i.test(manifest ?? '')) {
      issues.push('le contenu embarque un lien à protocole javascript ;');
    }

    return { safe: issues.length === 0, issues };
  }
}

/**
 * Refuse tout chemin d'annexe absolu ou remontant hors du dossier de la
 * ressource, afin qu'un paquet distant ne puisse pas écrire ailleurs.
 */
export function validateRelativePath(relativePath: string): string | null {
  if (!relativePath || relativePath.trim().length === 0) {
    return "Le chemin d'une annexe ne peut pas être vide.";
  }
  if (path.isAbsolute(relativePath) || /^[A-Za-z]:[\\/]/.test(relativePath)) {
    return `Le chemin d'annexe « ${relativePath} » doit être relatif à la ressource.`;
  }
  const normalized = path.normalize(relativePath);
  if (normalized.split(/[\\/]/).includes('..')) {
    return `Le chemin d'annexe « ${relativePath} » tente de sortir du dossier de la ressource.`;
  }
  return null;
}
