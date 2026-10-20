/**
 * Détection de l'hôte d'exécution : IDE Anti-Gravity natif ou VS Code standard
 * (§3.6 du PRD).
 *
 * La sonde s'exécute pendant la phase d'amorçage, avant l'enregistrement des
 * fournisseurs de vues et du pont de démon. Elle respecte un budget strict et
 * non bloquant, puis met son verdict en cache dans un contexte global
 * réévalué lors des changements de dossiers de travail ou de focus de fenêtre.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HostMode } from '../common/eventTypes';

let vscodeModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscodeModule = require('vscode');
} catch {
  // Hors hôte VS Code (tests unitaires ou exécution Node autonome).
}

/** Budget d'exécution non bloquant imposé à la sonde complète. */
export const HOST_PROBE_BUDGET_MS = 50;

/** Seuil de bascule entre le mode natif et le mode autonome. */
export const NATIVE_HOST_THRESHOLD = 60;

/** Score maximal atteignable en cumulant les cinq signaux. */
export const MAX_HOST_SCORE = 120;

export type HostOverride = 'auto' | 'antigravity-native' | 'vscode-standalone';

/** Poids de chacun des cinq signaux de la matrice heuristique. */
export const SIGNAL_WEIGHTS = {
  appMetadata: 40,
  productMetadata: 25,
  processPath: 20,
  environmentVariables: 15,
  ipcSocket: 20,
} as const;

export type HostSignalName = keyof typeof SIGNAL_WEIGHTS;

export interface HostSignalResult {
  name: HostSignalName;
  matched: boolean;
  points: number;
  evidence: string;
}

/**
 * Contexte d'hôte mis en cache, exposé à la barre d'état, à l'inspecteur de
 * diagnostics et au routage du pont de démon.
 */
export interface HostEnvironmentContext {
  host: HostMode;
  score: number;
  maxScore: number;
  threshold: number;
  signals: HostSignalResult[];
  override: HostOverride;
  overridden: boolean;
  probeDurationMs: number;
  detectedAt: number;
}

/**
 * Sources de signaux injectables. En production elles lisent l'API VS Code et
 * le processus courant ; les tests fournissent des valeurs déterministes.
 */
export interface HostProbeInputs {
  appName: string;
  appHost: string;
  execPath: string;
  env: NodeJS.ProcessEnv;
  /** Chemins candidats du fichier product.json de l'hôte. */
  productJsonPaths: string[];
  /** Chemins candidats de la socket de domaine ou du tube nommé. */
  ipcSocketPaths: string[];
  /** Lecture de fichier injectable, pour éviter tout accès disque en test. */
  readFileSync: (filePath: string) => string;
  /** Test d'existence injectable. */
  existsSync: (filePath: string) => boolean;
}

export class HostEnvironmentDetector {
  private static cached: HostEnvironmentContext | null = null;

  /**
   * Retourne le contexte d'hôte en cache, ou lance une détection si aucune
   * n'a encore eu lieu.
   */
  public static getContext(): HostEnvironmentContext {
    if (!this.cached) {
      this.cached = this.detect();
    }
    return this.cached;
  }

  /** Invalide le cache : à appeler sur ajout de dossier ou reprise de focus. */
  public static invalidate(): void {
    this.cached = null;
  }

  /**
   * Exécute la matrice heuristique complète et classe l'hôte. La fonction est
   * synchrone et bornée : chaque sonde intercepte ses propres erreurs afin que
   * l'absence d'un signal ne compromette jamais l'amorçage.
   */
  public static detect(inputs?: Partial<HostProbeInputs>, override?: HostOverride): HostEnvironmentContext {
    const started = Date.now();
    const resolved = this.resolveInputs(inputs);
    const effectiveOverride = override ?? this.readOverrideSetting();

    const signals: HostSignalResult[] = [
      this.probeAppMetadata(resolved),
      this.probeProductMetadata(resolved),
      this.probeProcessPath(resolved),
      this.probeEnvironmentVariables(resolved),
      this.probeIpcSocket(resolved),
    ];

    const score = signals.reduce((total, signal) => total + signal.points, 0);
    const heuristicHost: HostMode =
      score >= NATIVE_HOST_THRESHOLD ? 'antigravity-native' : 'vscode-standalone';

    const overridden = effectiveOverride !== 'auto';
    const host: HostMode = overridden ? (effectiveOverride as HostMode) : heuristicHost;

    const context: HostEnvironmentContext = {
      host,
      score,
      maxScore: MAX_HOST_SCORE,
      threshold: NATIVE_HOST_THRESHOLD,
      signals,
      override: effectiveOverride,
      overridden,
      probeDurationMs: Date.now() - started,
      detectedAt: Date.now(),
    };

    this.cached = context;
    return context;
  }

  /**
   * Signal 1 — Métadonnées applicatives et API hôte (+40 points).
   */
  private static probeAppMetadata(inputs: HostProbeInputs): HostSignalResult {
    const appName = (inputs.appName || '').toLowerCase();
    const appHost = (inputs.appHost || '').toLowerCase();
    const matched =
      appName.includes('anti-gravity') ||
      appName.includes('antigravity') ||
      appHost.includes('antigravity');

    return {
      name: 'appMetadata',
      matched,
      points: matched ? SIGNAL_WEIGHTS.appMetadata : 0,
      evidence: `appName="${inputs.appName || ''}", appHost="${inputs.appHost || ''}"`,
    };
  }

  /**
   * Signal 2 — Métadonnées produit de l'hôte (+25 points).
   */
  private static probeProductMetadata(inputs: HostProbeInputs): HostSignalResult {
    for (const candidate of inputs.productJsonPaths) {
      try {
        if (!inputs.existsSync(candidate)) continue;
        const raw = inputs.readFileSync(candidate);
        const parsed = JSON.parse(raw) as { applicationName?: string; dataFolderName?: string };
        const applicationName = (parsed.applicationName || '').toLowerCase();
        const dataFolderName = (parsed.dataFolderName || '').toLowerCase();
        if (applicationName.includes('antigravity') || dataFolderName.includes('antigravity')) {
          return {
            name: 'productMetadata',
            matched: true,
            points: SIGNAL_WEIGHTS.productMetadata,
            evidence: `product.json: applicationName="${parsed.applicationName}", dataFolderName="${parsed.dataFolderName}"`,
          };
        }
      } catch {
        // Fichier illisible ou JSON invalide : le signal reste simplement inactif.
      }
    }
    return {
      name: 'productMetadata',
      matched: false,
      points: 0,
      evidence: 'Aucun product.json portant la signature Antigravity n’a été trouvé.',
    };
  }

  /**
   * Signal 3 — Analyse du chemin du binaire exécuté (+20 points).
   */
  private static probeProcessPath(inputs: HostProbeInputs): HostSignalResult {
    const execPath = (inputs.execPath || '').toLowerCase();
    const matched = execPath.includes('antigravity') || execPath.includes('anti-gravity');
    return {
      name: 'processPath',
      matched,
      points: matched ? SIGNAL_WEIGHTS.processPath : 0,
      evidence: `execPath="${inputs.execPath || ''}"`,
    };
  }

  /**
   * Signal 4 — Variables d'environnement d'exécution (+15 points).
   */
  private static probeEnvironmentVariables(inputs: HostProbeInputs): HostSignalResult {
    const watched = [
      'ANTIGRAVITY_IDE',
      'AGY_IDE_VERSION',
      'ANTIGRAVITY_SOCKET_PATH',
      'ANTIGRAVITY_APP_DIR',
    ];
    const present = watched.filter((key) => {
      const value = inputs.env[key];
      return typeof value === 'string' && value.length > 0;
    });

    return {
      name: 'environmentVariables',
      matched: present.length > 0,
      points: present.length > 0 ? SIGNAL_WEIGHTS.environmentVariables : 0,
      evidence:
        present.length > 0
          ? `Variables détectées : ${present.join(', ')}`
          : 'Aucune variable d’environnement Antigravity n’est définie.',
    };
  }

  /**
   * Signal 5 — Socket de domaine ou tube nommé interne (+20 points).
   */
  private static probeIpcSocket(inputs: HostProbeInputs): HostSignalResult {
    for (const socketPath of inputs.ipcSocketPaths) {
      try {
        if (inputs.existsSync(socketPath)) {
          return {
            name: 'ipcSocket',
            matched: true,
            points: SIGNAL_WEIGHTS.ipcSocket,
            evidence: `Point de communication local présent : ${socketPath}`,
          };
        }
      } catch {
        // Un chemin inaccessible n'est pas une erreur : le signal reste inactif.
      }
    }
    return {
      name: 'ipcSocket',
      matched: false,
      points: 0,
      evidence: 'Aucune socket ni tube nommé Antigravity n’est joignable.',
    };
  }

  /**
   * Compose les entrées de sonde en complétant les valeurs manquantes par les
   * sources réelles de la machine hôte.
   */
  private static resolveInputs(partial?: Partial<HostProbeInputs>): HostProbeInputs {
    const env = partial?.env ?? process.env;
    return {
      appName: partial?.appName ?? (vscodeModule?.env?.appName || ''),
      appHost: partial?.appHost ?? (vscodeModule?.env?.appHost || ''),
      execPath: partial?.execPath ?? (process.execPath || ''),
      env,
      productJsonPaths: partial?.productJsonPaths ?? this.defaultProductJsonPaths(),
      ipcSocketPaths: partial?.ipcSocketPaths ?? this.defaultIpcSocketPaths(env),
      readFileSync: partial?.readFileSync ?? ((p: string) => fs.readFileSync(p, 'utf8')),
      existsSync: partial?.existsSync ?? ((p: string) => fs.existsSync(p)),
    };
  }

  /**
   * Chemins usuels du fichier product.json, déduits du binaire en cours
   * d'exécution plutôt que codés en dur.
   */
  private static defaultProductJsonPaths(): string[] {
    const execDir = path.dirname(process.execPath || '');
    if (!execDir) return [];
    return [
      path.join(execDir, 'resources', 'app', 'product.json'),
      path.join(execDir, '..', 'resources', 'app', 'product.json'),
      path.join(execDir, '..', 'Resources', 'app', 'product.json'),
    ];
  }

  /**
   * Emplacements de la socket Antigravity selon la plateforme hôte.
   */
  private static defaultIpcSocketPaths(env: NodeJS.ProcessEnv): string[] {
    const candidates: string[] = [];
    const fromEnv = env.ANTIGRAVITY_SOCKET_PATH;
    if (typeof fromEnv === 'string' && fromEnv.length > 0) {
      candidates.push(fromEnv);
    }
    if (os.platform() === 'win32') {
      candidates.push('\\\\.\\pipe\\antigravity-ipc');
    } else {
      candidates.push('/var/run/antigravity.sock');
      candidates.push(path.join(os.tmpdir(), 'antigravity.sock'));
    }
    return candidates;
  }

  /**
   * Lit le réglage `antigravity.environment.hostOverride`, qui permet de
   * forcer manuellement le mode de fonctionnement.
   */
  private static readOverrideSetting(): HostOverride {
    try {
      if (!vscodeModule?.workspace?.getConfiguration) return 'auto';
      const config = vscodeModule.workspace.getConfiguration('antigravity');
      const value = config.get('environment.hostOverride', 'auto');
      if (value === 'antigravity-native' || value === 'vscode-standalone') {
        return value;
      }
      return 'auto';
    } catch {
      return 'auto';
    }
  }
}
