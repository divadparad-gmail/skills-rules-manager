/**
 * Pipeline de déploiement multi-cible (§3.2, §3.5 et jalon 4 du PRD).
 *
 * Un même manifeste peut être injecté dans trois destinations : le dépôt
 * ouvert, le partage NAS centralisé ou le profil global de la machine. Le
 * service choisit la destination réelle en fonction de l'agent détecté,
 * applique la politique de conflit demandée, contrôle la forme du contenu
 * avant écriture et replie le déploiement NAS sur le projet local lorsque le
 * partage est injoignable.
 *
 * Le fichier déployé sera lu comme instruction par un agent : aucun filtre ne
 * peut garantir qu'il est inoffensif. La décision appartient à l'utilisateur,
 * à qui le parcours de `deployReview` montre le contenu avant l'écriture.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ConflictPolicy,
  DeploymentRequest,
  DeploymentResult,
  ManifestProvenance,
} from '../common/discoveryTypes';
import { AgentRuntime, DeployTarget, DiscoveryResourceType } from '../common/eventTypes';
import { ExtensionEventBus } from '../common/ExtensionEventBus';
import { SkillProtocolAdapter } from '../environment/SkillProtocolAdapter';
import { NasPathService } from '../settings/NasPathService';

/** Taille maximale admise pour un manifeste, garde-fou anti-charge utile. */
export const MAX_MANIFEST_BYTES = 512 * 1024;

/**
 * Antigravity ne lit pas un hook écrit dans `hooks/<id>.md` : un hook se déclare dans
 * `.agents/hooks.json` et lance des commandes shell. Le déploiement d'un hook vers Antigravity est
 * donc refusé, plutôt que de fusionner du JSON exécutable sans test du format réel (lot A3).
 * Retourne le message de refus, ou null si le déploiement est permis.
 */
export function antigravityHookRefusal(runtime: AgentRuntime, type: DiscoveryResourceType, name: string): string | null {
  if (runtime !== 'antigravity' || type !== 'hooks') return null;
  return `Le hook « ${name} » n'a pas été installé : Antigravity ne lit pas les hooks sous forme de fichier .md. Un hook se déclare dans .agents/hooks.json et lance des commandes shell : ajoutez-le vous-même après avoir relu la commande.`;
}

export interface DeployContext {
  runtime: AgentRuntime;
  workspaceRoot: string | null;
  agentsDirName: string | null;
}

/**
 * Verdict du contrôle de manifeste. `issues` bloque l'écriture ; `warnings`
 * ne bloque rien et sert à alerter l'utilisateur dans la fenêtre de
 * confirmation.
 */
export interface ManifestVerdict {
  safe: boolean;
  issues: string[];
  warnings: string[];
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

    // Défense en profondeur : le parcours deployReview refuse déjà un hook avant l'aperçu
    const hookRefusal = antigravityHookRefusal(context.runtime, request.type, request.name);
    if (hookRefusal) {
      return this.finish(request, { success: false, target: request.target, error: hookRefusal });
    }

    const verdict = MultiTargetDeployService.validateManifest(request.manifest);
    if (!verdict.safe) {
      return this.finish(request, {
        success: false,
        target: request.target,
        error: `Le manifeste a été refusé : ${verdict.issues.join(' ')}`,
      });
    }

    const content = request.provenance
      ? withProvenance(request.manifest, request.provenance)
      : request.manifest;

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
      await this.fileSystem.writeFile(resolution.file, content);

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
   * Contrôle de forme du manifeste avant écriture : présence de contenu,
   * taille bornée et absence de balisage exécutable. Ce contrôle ne dit rien
   * de ce que le texte demande à l'agent ; les tournures suspectes sont
   * seulement signalées en avertissement, sans bloquer.
   */
  public static validateManifest(manifest: string): ManifestVerdict {
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

    return { safe: issues.length === 0, issues, warnings: detectAgentDirectives(manifest ?? '') };
  }
}

/**
 * Tournures typiques d'une instruction détournée : lecture de fichiers du
 * poste, envoi vers l'extérieur, dissimulation à l'utilisateur, consigne
 * prioritaire ou commande système. Les motifs portent sur un texte mis en
 * minuscules et privé de ses accents.
 */
const AGENT_DIRECTIVE_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern:
      /\b(lis|lire|lisez|ouvre|ouvrir|parcours|parcourir|collecte|collecter|recupere|recuperer|extrais|extraire|copie|copier|read|open|scan|collect|gather|extract|dump|cat)\b[^.\n]{0,80}(fichiers? de (configuration|config)|configuration files?|config files?|du poste|de la machine|de l'ordinateur|on (the|this) (machine|computer)|home directory|repertoire (personnel|utilisateur)|\.env\b|\.ssh|id_rsa|\.aws|credentials?|identifiants?|secrets?|tokens?|jetons?|mots? de passe|passwords?|cles? (d'api|privees?)|api keys?|private keys?|variables d'environnement|environment variables)/,
    message: 'Le texte demande de lire des fichiers ou des secrets du poste.',
  },
  {
    pattern:
      /\b(envoie|envoyer|transmets|transmettre|televerse|televerser|publie|publier|send|post|upload|transmit|exfiltrat\w*|exfiltr\w*)\b[^.\n]{0,80}(https?:\/\/|\burl\b|serveur|server|webhook|endpoint|adresse)/,
    message: 'Le texte demande de transmettre des données vers une adresse extérieure.',
  },
  {
    pattern:
      /(ne (le |les |rien )?(dis|dites|mentionne|mentionnez|signale|signalez|revele|revelez) (pas|rien)|sans (le )?(dire|signaler|mentionner|prevenir|informer)|(do not|don't|never) (tell|mention|reveal|inform|show)|without (telling|informing|notifying))/,
    message: "Le texte demande de cacher une action à l'utilisateur.",
  },
  {
    pattern:
      /(ignore[rz]? (toutes |les )?(les )?(instructions|consignes|regles) (precedentes|anterieures|ci-dessus)|ignore (all |any )?(previous|prior|above|earlier) (instructions|rules)|avant (toute|chaque) reponse|before (any|every|each) (response|answer|reply)|(priorite|priority) (absolue|maximale|over all))/,
    message: "Le texte tente d'imposer une consigne prioritaire à l'agent.",
  },
  {
    pattern:
      /(\bcurl\s|\bwget\s|invoke-webrequest|invoke-restmethod|\biwr\s|\brm\s+-rf\b|remove-item\b[^\n]*-recurse|\bbase64\b|powershell\s+-e(nc)?\b|\/etc\/passwd|%appdata%|\$env:)/,
    message: 'Le texte contient une commande système ou un chemin sensible.',
  },
  {
    pattern:
      /\b(desactive|desactiver|contourne|contourner|disable|bypass|skip)\b[^.\n]{0,60}(securite|confirmation|verification|security|safety|hooks?|permissions?|sandbox|bac a sable)/,
    message: 'Le texte demande de désactiver une protection ou une confirmation.',
  },
];

/**
 * Détection heuristique de tournures d'instruction destinées à un agent.
 * Elle produit des avertissements à montrer à l'utilisateur, jamais un
 * blocage : un manifeste légitime peut employer ces tournures, et un
 * manifeste hostile peut les éviter.
 */
export function detectAgentDirectives(manifest: string): string[] {
  const normalized = manifest
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .toLowerCase();
  return AGENT_DIRECTIVE_PATTERNS.filter(({ pattern }) => pattern.test(normalized)).map(
    ({ message }) => message
  );
}

/**
 * Consigne la provenance dans le manifeste sans déplacer son frontmatter.
 *
 * Lorsque le fichier commence par un frontmatter YAML, une clé `source` y est
 * ajoutée juste avant le délimiteur de fin, après retrait de toute clé
 * `source` fournie par le registre lui-même (elle pourrait se prétendre
 * d'une autre origine). Sans frontmatter, la provenance est ajoutée en
 * commentaire HTML à la fin du fichier, pour ne pas créer un frontmatter qui
 * changerait la façon dont l'agent charge une règle.
 */
export function withProvenance(manifest: string, provenance: ManifestProvenance): string {
  const parts = [`registre « ${provenance.registryName} » (${provenance.registryId})`];
  if (provenance.url) parts.push(provenance.url);
  parts.push(`installé le ${provenance.installedAt}`);
  const summary = parts.join(', ');

  const frontmatter = /^(﻿?---[ \t]*(\r?\n))([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/.exec(manifest);
  if (frontmatter) {
    const [whole, opening, newline, body, closing] = frontmatter;
    const kept = stripYamlKey(body, 'source', newline);
    // JSON est un sous-ensemble de YAML : la valeur est échappée sans ambiguïté.
    const line = `source: ${JSON.stringify(summary)}`;
    const merged = kept.length > 0 ? `${kept}${newline}${line}` : line;
    return `${opening}${merged}${closing}${manifest.slice(whole.length)}`;
  }

  const newline = manifest.includes('\r\n') ? '\r\n' : '\n';
  const safeSummary = summary.replace(/--/g, '—');
  const separator = manifest.endsWith('\n') ? '' : newline;
  return `${manifest}${separator}${newline}<!-- source : ${safeSummary} -->${newline}`;
}

/** Retire une clé de premier niveau et ses lignes de continuation indentées. */
function stripYamlKey(yaml: string, key: string, newline: string): string {
  const lines = yaml.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (new RegExp(`^${key}\\s*:`).test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && /^[ \t]+\S|^[ \t]*-\s/.test(line)) continue;
    skipping = false;
    kept.push(line);
  }
  return kept.join(newline);
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
