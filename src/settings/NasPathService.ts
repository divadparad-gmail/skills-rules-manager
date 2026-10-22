/**
 * Configuration et validation du répertoire NAS d'intégration (§3.5 du PRD).
 *
 * Le service résout la valeur du réglage `antigravity.skills.nasDirectoryPath`
 * en tenant compte des deux portées, normalise les syntaxes de chemins propres
 * à chaque plateforme (UNC Windows, lecteurs réseau mappés, points de montage
 * SMB/NFS) et développe les variables d'environnement. Il vérifie enfin que le
 * partage est réellement joignable et inscriptible avant tout déploiement.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NasPathValidation } from '../common/discoveryTypes';
import { ConfigurationPort } from './RegistryConfigService';

export const NAS_DIRECTORY_SETTING = 'antigravity.skills.nasDirectoryPath';

/** Système de fichiers injectable, afin de tester sans partage réseau réel. */
export interface FileSystemPort {
  stat(targetPath: string): Promise<{ isDirectory: boolean }>;
  access(targetPath: string, mode: 'read' | 'write'): Promise<void>;
  writeFile(targetPath: string, content: string): Promise<void>;
  unlink(targetPath: string): Promise<void>;
}

/** Implémentation réelle appuyée sur le module `fs` de Node. */
export const nodeFileSystemPort: FileSystemPort = {
  async stat(targetPath: string) {
    const stats = await fs.promises.stat(targetPath);
    return { isDirectory: stats.isDirectory() };
  },
  async access(targetPath: string, mode: 'read' | 'write') {
    await fs.promises.access(
      targetPath,
      mode === 'write' ? fs.constants.W_OK : fs.constants.R_OK
    );
  },
  async writeFile(targetPath: string, content: string) {
    await fs.promises.writeFile(targetPath, content, 'utf8');
  },
  async unlink(targetPath: string) {
    await fs.promises.unlink(targetPath);
  },
};

export class NasPathService {
  constructor(
    private readonly config: ConfigurationPort,
    private readonly fileSystem: FileSystemPort = nodeFileSystemPort,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  /**
   * Retourne le chemin NAS effectif, déjà normalisé et développé. La portée
   * espace de travail l'emporte sur la portée utilisateur.
   */
  public getEffectivePath(): string {
    const inspected = this.config.inspect<string>(NAS_DIRECTORY_SETTING);
    const raw =
      firstNonEmpty(inspected?.workspaceValue, inspected?.userValue) ??
      this.config.get<string>(NAS_DIRECTORY_SETTING, '');
    return this.resolvePath(raw);
  }

  public isConfigured(): boolean {
    return this.getEffectivePath().length > 0;
  }

  public async setPath(value: string, scope: 'user' | 'workspace' = 'user'): Promise<void> {
    await this.config.update(NAS_DIRECTORY_SETTING, value, scope);
  }

  /**
   * Normalise un chemin brut : développement des variables d'environnement,
   * unification des séparateurs selon la plateforme et retrait du séparateur
   * final. Les préfixes UNC (`\\serveur\partage`) sont préservés.
   */
  public resolvePath(rawPath: string | undefined | null): string {
    if (!rawPath || typeof rawPath !== 'string') return '';
    const expanded = this.expandEnvironmentVariables(rawPath.trim());
    if (expanded.length === 0) return '';
    return normalizeNetworkPath(expanded);
  }

  /**
   * Développe les formes `${env:NOM}`, `$NOM` et `%NOM%` ainsi que le tilde
   * initial. Une variable absente est remplacée par une chaîne vide, ce qui
   * rend le chemin invalide plutôt que silencieusement erroné.
   */
  public expandEnvironmentVariables(value: string): string {
    let result = value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
      return this.env[name] ?? '';
    });

    result = result.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (match, name: string) => {
      const replacement = this.env[name];
      return replacement === undefined ? match : replacement;
    });

    result = result.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, name: string) => {
      const replacement = this.env[name];
      return replacement === undefined ? match : replacement;
    });

    if (result.startsWith('~')) {
      const home = os.homedir() || this.env.USERPROFILE || this.env.HOME || '';
      if (home) {
        result = path.join(home, result.slice(1));
      }
    }

    return result;
  }

  /**
   * Vérifie l'existence du partage, la connectivité réseau et les droits de
   * lecture, d'écriture puis de suppression, en inscrivant un fichier témoin
   * éphémère. Le diagnostic retourné alimente directement l'indicateur visuel
   * de la vue des réglages.
   */
  public async validatePath(candidate?: string): Promise<NasPathValidation> {
    const resolvedPath = candidate ? this.resolvePath(candidate) : this.getEffectivePath();

    if (!resolvedPath) {
      return {
        status: 'not_configured',
        resolvedPath: '',
        writable: false,
        message: "Le répertoire NAS n'est pas configuré.",
      };
    }

    try {
      const stats = await this.fileSystem.stat(resolvedPath);
      if (!stats.isDirectory) {
        return {
          status: 'unreachable',
          resolvedPath,
          writable: false,
          message: "Le chemin existe mais ne désigne pas un dossier.",
        };
      }
    } catch (err) {
      return {
        status: 'unreachable',
        resolvedPath,
        writable: false,
        message: `Le partage est injoignable : ${describeError(err)}`,
      };
    }

    try {
      await this.fileSystem.access(resolvedPath, 'read');
    } catch (err) {
      return {
        status: 'permission_denied',
        resolvedPath,
        writable: false,
        message: `La lecture du partage est refusée : ${describeError(err)}`,
      };
    }

    // Écriture puis suppression d'un témoin : seul moyen fiable de vérifier
    // les droits réels sur un partage réseau, les métadonnées POSIX y étant
    // fréquemment trompeuses.
    const probeFile = path.join(resolvedPath, `.antigravity-write-probe-${Date.now()}`);
    try {
      await this.fileSystem.writeFile(probeFile, 'probe');
      await this.fileSystem.unlink(probeFile);
    } catch (err) {
      return {
        status: 'permission_denied',
        resolvedPath,
        writable: false,
        message: `L'écriture sur le partage est refusée : ${describeError(err)}`,
      };
    }

    return {
      status: 'connected',
      resolvedPath,
      writable: true,
      message: 'Le partage NAS est joignable et inscriptible.',
    };
  }

  /**
   * Contrôle préalable à une action « Intégrer au NAS » : le partage doit être
   * configuré, joignable et inscriptible pour que le déploiement démarre.
   */
  public async preflight(): Promise<NasPathValidation> {
    return this.validatePath();
  }

  /** Extrait le nom d'hôte d'un chemin UNC, par exemple `\\serveur\partage` → `serveur`. */
  public static getUncHost(targetPath: string): string | null {
    if (!targetPath) return null;
    const normalized = targetPath.replace(/\//g, '\\');
    const match = normalized.match(/^\\\\([^\\]+)/);
    return match ? match[1].toLowerCase() : null;
  }
}

/**
 * Unifie les séparateurs d'un chemin réseau sans détruire le double
 * antislash initial des chemins UNC, et retire le séparateur final.
 */
export function normalizeNetworkPath(input: string): string {
  const isUnc = /^[\\/]{2}[^\\/]/.test(input);

  if (isUnc) {
    const body = input.slice(2).replace(/\//g, '\\').replace(/\\{2,}/g, '\\');
    return `\\\\${body.replace(/\\+$/, '')}`;
  }

  // Lecteur mappé Windows (« Z:\skills ») : on conserve l'antislash.
  if (/^[A-Za-z]:[\\/]/.test(input)) {
    return input.replace(/\//g, '\\').replace(/\\{2,}/g, '\\').replace(/\\+$/, '');
  }

  // Point de montage POSIX (« /Volumes/nas/skills », « /mnt/nas/skills »).
  return input.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
