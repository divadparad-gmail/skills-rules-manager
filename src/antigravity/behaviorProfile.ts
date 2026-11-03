/**
 * Choix du profil de comportement d'Antigravity (src/antigravity/behavior.ts) : le réglage
 * skillsManager.antigravityProfile, puis, en « auto », la structure des données du dossier
 * `<gemini>` (~/.gemini). Cette structure indique une génération d'Antigravity, et non sa version
 * exacte : un retour à la 2.5.5 après une 2.6.0 laisserait la structure 2.6.0 en place (déduit, non
 * vérifié ; l'infobulle du profil ne l'affirme pas).
 *
 * Indices observés le 2026-10-28 sous Windows (chantier « Antigravity 2.6.0 », phase 1) :
 * - `antigravity/builtin/` : la 2.6.0 y écrit ses skills intégrés à chaque lancement ;
 * - `antigravity-ide/.ide_migration` : verrou de la migration des données par l'IDE 2.6.0 ;
 * - `antigravity-ide/` : racine des données de la 2.5.5.
 * `antigravity/` seul ne compte pas : c'est aussi l'ancien emplacement des skills globaux de la 2.5.5.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ANTIGRAVITY_PROFILES, AntigravityBehaviorProfile, AntigravityProfileId } from './behavior';
import { getEffectiveGlobalAntigravityPath } from '../utils/paths';

let vscodeModule: any = null;
try {
  vscodeModule = require('vscode');
} catch {
  // Hors hôte VS Code (ex: tests unitaires ou runner Node indépendant)
}

export type AntigravityProfileSetting = 'auto' | AntigravityProfileId;

/** Réglage de portée `machine` : un dépôt ne peut pas le fixer, et Settings Sync ne le recopie pas. */
export const ANTIGRAVITY_PROFILE_SETTING = 'skillsManager.antigravityProfile';
/**
 * « auto » (décisions D-1 et D-2, lot L10) : le profil est déduit de la structure des données, avec
 * un repli sur la 2.6.0. Une valeur absente ou invalide mène donc à la détection.
 */
export const ANTIGRAVITY_PROFILE_SETTING_DEFAULT: AntigravityProfileSetting = 'auto';
const PROFILE_SETTINGS: readonly AntigravityProfileSetting[] = ['auto', '2.5.5', '2.6.0'];

export type ProfileSource = 'forced' | 'detected' | 'fallback';

export interface ResolvedAntigravityProfile {
  profile: AntigravityBehaviorProfile;
  source: ProfileSource;
  /** Explication en une phrase, sans chemin absolu. */
  reason: string;
}

/** Indices cherchés dans `<gemini>`, en chemins relatifs. */
export const PROFILE_SIGNAL_PATHS = {
  newStructure: path.join('antigravity', 'builtin'),
  migrationMarker: path.join('antigravity-ide', '.ide_migration'),
  oldStructure: 'antigravity-ide',
} as const;

export interface ProfileSignals {
  /** `antigravity/builtin/` est un dossier. */
  newStructure: boolean;
  /** `antigravity-ide/.ide_migration` est un fichier. */
  migrationMarker: boolean;
  /** `antigravity-ide/` est un dossier. */
  oldStructure: boolean;
}

export const NO_PROFILE_SIGNALS: Readonly<ProfileSignals> = Object.freeze({
  newStructure: false,
  migrationMarker: false,
  oldStructure: false,
});

/**
 * `<gemini>` : le parent du dossier global, qui désigne `~/.gemini/config` (skills/, rules/,
 * mcp_config.json). C'est la même dérivation que pour les skills intégrés et le cache MCP. Chaîne
 * vide si le dossier global est inconnu, par exemple sans dossier personnel.
 */
export function geminiRootFromGlobalPath(globalPath: string): string {
  const trimmed = globalPath.trim();
  return trimmed ? path.dirname(trimmed) : '';
}

type StatFn = (target: string) => { isDirectory(): boolean; isFile(): boolean };

/**
 * Relève les indices dans `<gemini>`, sans réseau. Un chemin vide ou relatif ne touche jamais au
 * disque : il ne doit pas désigner le dossier courant de l'hôte. Une erreur d'accès vaut « absent ».
 */
export function collectProfileSignals(geminiRoot: string, stat: StatFn = fs.statSync): ProfileSignals {
  if (!geminiRoot.trim() || !path.isAbsolute(geminiRoot)) return { ...NO_PROFILE_SIGNALS };
  const probe = (relative: string, kind: 'directory' | 'file'): boolean => {
    try {
      const found = stat(path.join(geminiRoot, relative));
      return kind === 'directory' ? found.isDirectory() : found.isFile();
    } catch {
      return false;
    }
  };
  return {
    newStructure: probe(PROFILE_SIGNAL_PATHS.newStructure, 'directory'),
    migrationMarker: probe(PROFILE_SIGNAL_PATHS.migrationMarker, 'file'),
    oldStructure: probe(PROFILE_SIGNAL_PATHS.oldStructure, 'directory'),
  };
}

/** Valeur du réglage, ou sa valeur par défaut si elle est absente ou invalide. */
export function normalizeProfileSetting(value: unknown): AntigravityProfileSetting {
  return typeof value === 'string' && (PROFILE_SETTINGS as readonly string[]).includes(value)
    ? (value as AntigravityProfileSetting)
    : ANTIGRAVITY_PROFILE_SETTING_DEFAULT;
}

/**
 * Profil retenu (fonction pure) : un profil forcé par le réglage l'emporte ; en « auto », la
 * structure 2.6.0 ou le marqueur de migration désignent la 2.6.0, l'ancienne racine seule la 2.5.5,
 * et rien de reconnu mène au repli sur la 2.6.0, version actuelle.
 */
export function resolveAntigravityProfile(setting: unknown, signals: ProfileSignals): ResolvedAntigravityProfile {
  // Le défaut étant « auto », un profil n'est forcé que par une valeur explicite et valide du réglage
  const choice = normalizeProfileSetting(setting);
  if (choice !== 'auto') {
    return {
      profile: ANTIGRAVITY_PROFILES[choice],
      source: 'forced',
      reason: `Profil ${choice} imposé par le réglage ${ANTIGRAVITY_PROFILE_SETTING}.`,
    };
  }
  if (signals.newStructure || signals.migrationMarker) {
    const found = [
      signals.newStructure ? 'antigravity/builtin/' : '',
      signals.migrationMarker ? 'antigravity-ide/.ide_migration' : '',
    ].filter(Boolean).join(' et ');
    const leftover = signals.oldStructure ? ' L\'ancienne racine antigravity-ide/ est encore présente (ancienne génération).' : '';
    return {
      profile: ANTIGRAVITY_PROFILES['2.6.0'],
      source: 'detected',
      reason: `Données de la génération 2.6.0 trouvées dans .gemini (${found}).${leftover}`,
    };
  }
  if (signals.oldStructure) {
    return {
      profile: ANTIGRAVITY_PROFILES['2.5.5'],
      source: 'detected',
      reason: 'Seule l\'ancienne racine antigravity-ide/ est présente dans .gemini : aucune trace de la génération 2.6.0.',
    };
  }
  return {
    profile: ANTIGRAVITY_PROFILES['2.6.0'],
    source: 'fallback',
    reason: 'Aucune donnée d\'Antigravity reconnue dans .gemini : repli sur la version actuelle, 2.6.0.',
  };
}

/** Réglage lu dans VS Code ; hors de VS Code, la valeur par défaut. */
export function readAntigravityProfileSetting(): AntigravityProfileSetting {
  try {
    return normalizeProfileSetting(vscodeModule?.workspace?.getConfiguration?.()?.get?.(ANTIGRAVITY_PROFILE_SETTING));
  } catch {
    return ANTIGRAVITY_PROFILE_SETTING_DEFAULT;
  }
}

/** Profil du réglage ; la structure des données n'est lue qu'en « auto ». */
export function resolveConfiguredAntigravityProfile(
  globalPath: string,
  setting: unknown = readAntigravityProfileSetting(),
  stat?: StatFn
): ResolvedAntigravityProfile {
  const signals = normalizeProfileSetting(setting) === 'auto'
    ? collectProfileSignals(geminiRootFromGlobalPath(globalPath), stat)
    : NO_PROFILE_SIGNALS;
  return resolveAntigravityProfile(setting, signals);
}

/**
 * Profil actif pour les opérations qui ne passent pas par le scan (import, déploiement) : même
 * résolution que StateManager.loadFullState, avec le dossier global effectif.
 */
export function resolveActiveAntigravityProfile(): ResolvedAntigravityProfile {
  return resolveConfiguredAntigravityProfile(getEffectiveGlobalAntigravityPath());
}
