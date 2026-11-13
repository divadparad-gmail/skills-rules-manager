import type { ClaudeSettingsScope } from '../types';

/**
 * Claude Code : la mémoire automatique (MEMORY.md), sans accès aux fichiers. Le module de service
 * src/services/claudeAutoMemory.ts lit les fichiers et construit la ligne de la jauge et la carte.
 *
 * Sources :
 * - l'emplacement `<profil>/projects/<projet>/memory/MEMORY.md`, « derived from the git repository […].
 *   Outside a git repo, the project root is used instead » : documentation
 *   (https://code.claude.com/docs/en/memory.md, « Storage location ») ; chargé au démarrage, type AutoMem :
 *   mesuré (CC23) ;
 * - le nom du dossier : chaque caractère non alphanumérique devient « - » : mesuré en phase 2, hors dépôt Git
 *   (fonction `nomDossierMemoire` de la sonde, qui reste la référence et refuse un nom de plus de 200
 *   caractères) ; au-delà de 200 caractères, le comportement de Claude Code n'est pas vérifié : le nom est
 *   alors « non déterminé », sans aucune recherche (décision Q2) ;
 * - la coupe : « The first 200 lines of MEMORY.md, or the first 25KB, whichever comes first » (documentation,
 *   « How it works ») ; 200 lignes mesuré (CC41) ; 25 000 caractères déduit après coup de CC41, CC50 et CC23
 *   (décision D-7.1 bis) ; comptés en points de code, coupe sur un caractère complet (non vérifié) ;
 * - l'activation : `autoMemoryEnabled` est lu depuis n'importe quel fichier de réglages (settings-reference,
 *   « Any file ») ; « Claude Code uses the value from the highest level that sets it » : réglages locaux du
 *   projet, puis projet partagé, puis profil (https://code.claude.com/docs/en/settings.md, « Settings
 *   precedence ») ; la désactivation par le projet est mesurée (CC53) ;
 * - `CLAUDE_CODE_DISABLE_AUTO_MEMORY` : « Set to 1 to disable auto memory » ; les valeurs « 1, true, yes, on,
 *   in any casing » allument un réglage booléen (https://code.claude.com/docs/en/env-vars.md) ; non mesuré ;
 * - `autoMemoryDirectory` est lu « from any settings scope » (memory.md) : sa présence seule est constatée,
 *   et sa valeur n'est jamais utilisée comme chemin (décision Q3).
 */

/** Les limites de la coupe de MEMORY.md (décision D-7.1 bis). */
export const CLAUDE_AUTO_MEMORY_MAX_LINES = 200;
export const CLAUDE_AUTO_MEMORY_MAX_CHARS = 25000;
/** La longueur au-delà de laquelle le nom du dossier n'est plus prévisible (la sonde refuse au-delà). */
export const CLAUDE_AUTO_MEMORY_DIR_NAME_MAX = 200;

/** Le nom du dossier de mémoire d'une racine de projet, ou `null` au-delà de 200 caractères. */
export function claudeAutoMemoryDirName(projectRoot: string): string | null {
  const name = projectRoot.replace(/[^A-Za-z0-9]/g, '-');
  return name.length > CLAUDE_AUTO_MEMORY_DIR_NAME_MAX ? null : name;
}

/** Le nombre de lignes d'un texte : un saut final ne commence pas de ligne neuve. */
export function claudeLineCount(text: string): number {
  if (text === '') return 0;
  const breaks = (text.match(/\r\n|\r|\n/g) ?? []).length;
  return /[\r\n]$/.test(text) ? breaks : breaks + 1;
}

export interface ClaudeAutoMemoryCut {
  text: string;
  coupe: 'lignes' | 'caracteres' | null;
  lignesOrigine: number;
  lignesGardees: number;
}

/**
 * La coupe de MEMORY.md : les 200 premières lignes (sans le saut de la 200ᵉ) ou les 25 000 premiers points de
 * code, la première limite atteinte en lisant le texte ; une fin de ligne CRLF compte pour un saut et pour deux
 * caractères. Un texte qui s'arrête juste à la limite n'est pas coupé.
 */
export function claudeAutoMemoryCut(text: string): ClaudeAutoMemoryCut {
  let codePoints = 0;
  let lineBreaks = 0;
  let cutAt = -1;
  let coupe: ClaudeAutoMemoryCut['coupe'] = null;
  let i = 0;
  while (i < text.length) {
    if (codePoints === CLAUDE_AUTO_MEMORY_MAX_CHARS) {
      cutAt = i;
      coupe = 'caracteres';
      break;
    }
    const code = text.codePointAt(i)!;
    if (code === 0x0d || code === 0x0a) {
      const breakLength = code === 0x0d && text.charCodeAt(i + 1) === 0x0a ? 2 : 1;
      lineBreaks++;
      if (lineBreaks === CLAUDE_AUTO_MEMORY_MAX_LINES && i + breakLength < text.length) {
        cutAt = i;
        coupe = 'lignes';
        break;
      }
      // Le second caractère d'un CRLF peut tomber au-delà de la limite des caractères
      if (breakLength === 2 && codePoints + 1 === CLAUDE_AUTO_MEMORY_MAX_CHARS) {
        cutAt = i + 1;
        coupe = 'caracteres';
        break;
      }
      i += breakLength;
      codePoints += breakLength;
      continue;
    }
    i += code > 0xffff ? 2 : 1;
    codePoints++;
  }
  const kept = cutAt < 0 ? text : text.slice(0, cutAt);
  return { text: kept, coupe, lignesOrigine: claudeLineCount(text), lignesGardees: claudeLineCount(kept) };
}

/** Vrai si la valeur de CLAUDE_CODE_DISABLE_AUTO_MEMORY coupe la mémoire automatique (1, true, yes, on). */
export function claudeAutoMemoryDisabledByEnv(value: string | undefined): boolean {
  return value !== undefined && /^(1|true|yes|on)$/i.test(value.trim());
}

export interface ClaudeAutoMemorySettings {
  active: boolean;
  /** La portée dont la valeur `false` l'emporte, ou null. */
  coupeePar: ClaudeSettingsScope | null;
  /** Les portées qui posent `autoMemoryDirectory` (présence seulement), dans l'ordre profil, projet, local. */
  dossierPose: ClaudeSettingsScope[];
}

/**
 * Les seules clés `autoMemoryEnabled` (un booléen) et `autoMemoryDirectory` (sa présence) des trois fichiers de
 * réglages ; un fichier absent ou au JSON invalide ne compte pas. Aucune autre valeur n'est gardée.
 */
export function claudeAutoMemorySettings(texts: Record<ClaudeSettingsScope, string | null>): ClaudeAutoMemorySettings {
  const parsed: Record<ClaudeSettingsScope, Record<string, unknown> | null> = {
    utilisateur: parseObject(texts.utilisateur),
    projet: parseObject(texts.projet),
    local: parseObject(texts.local),
  };
  let active = true;
  let coupeePar: ClaudeSettingsScope | null = null;
  for (const scope of ['local', 'projet', 'utilisateur'] as const) {
    const value = parsed[scope]?.autoMemoryEnabled;
    if (typeof value === 'boolean') {
      active = value;
      coupeePar = value ? null : scope;
      break;
    }
  }
  const dossierPose = (['utilisateur', 'projet', 'local'] as const).filter((scope) => {
    const value = parsed[scope]?.autoMemoryDirectory;
    return value !== undefined && value !== null;
  });
  return { active, coupeePar, dossierPose };
}

function parseObject(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
