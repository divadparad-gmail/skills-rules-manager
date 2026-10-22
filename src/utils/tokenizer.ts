/**
 * src/utils/tokenizer.ts
 *
 * Utilitaire centralisé de décompte et d'estimation des tokens pour l'extension
 * Skills & Rules Manager (Antigravity IDE et Claude Code).
 *
 * Optimisations de performance (Anti-Lag) :
 * 1. Chargement paresseux (lazy require) et préchauffage discret en arrière-plan.
 * 2. Repli résilient permanent sur l'heuristique standard Math.ceil(length / 4) en cas d'échec.
 * 3. Cache mémoire indexé par (chemin + mtimeMs + taille) avec invalidation automatique.
 * 4. Métriques de chronométrie et d'efficacité de cache pour le journal de scan.
 */

export type EncodeFunction = (text: string) => number[] | Uint32Array | { length: number };

let cachedEncoder: EncodeFunction | null = null;
let encoderFailedPermanently = false;

/**
 * Récupère ou initialise l'encodeur de façon paresseuse (lazy require).
 * En cas d'erreur de chargement, bascule définitivement sur le repli heuristique sans planter.
 */
function getEncoder(): EncodeFunction | null {
  if (encoderFailedPermanently) {
    return null;
  }
  if (cachedEncoder) {
    return cachedEncoder;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const gptTokenizer = require('gpt-tokenizer');
    if (gptTokenizer && typeof gptTokenizer.encode === 'function') {
      cachedEncoder = gptTokenizer.encode;
      return cachedEncoder;
    }
    encoderFailedPermanently = true;
    return null;
  } catch {
    encoderFailedPermanently = true;
    return null;
  }
}

/**
 * Préchauffage discret déclenché après l'activation de l'extension
 * pour charger le vocabulaire BPE o200k en tâche de fond.
 */
export function warmupTokenizer(): void {
  try {
    const encoder = getEncoder();
    if (encoder) {
      encoder('warmup');
    }
  } catch {
    // Échec silencieux, retombe sur l'heuristique
  }
}

/**
 * Structure des métriques de tokenisation cumulées pendant un scan.
 */
export interface TokenizerTimingStats {
  totalFiles: number;
  encodedCount: number;
  cachedCount: number;
  cumulativeEncodingTimeMs: number;
}

const scanMetrics = {
  encodedCount: 0,
  cachedCount: 0,
  cumulativeEncodingTimeMs: 0,
};

/**
 * Réinitialise les compteurs de mesure de performance avant un nouveau scan.
 */
export function resetTokenizerMetrics(): void {
  scanMetrics.encodedCount = 0;
  scanMetrics.cachedCount = 0;
  scanMetrics.cumulativeEncodingTimeMs = 0;
}

/**
 * Récupère les métriques actuelles de performance de tokenisation.
 */
export function getTokenizerMetrics(): TokenizerTimingStats {
  return {
    totalFiles: scanMetrics.encodedCount + scanMetrics.cachedCount,
    encodedCount: scanMetrics.encodedCount,
    cachedCount: scanMetrics.cachedCount,
    cumulativeEncodingTimeMs: Math.round(scanMetrics.cumulativeEncodingTimeMs),
  };
}

/**
 * Cache mémoire pour les fichiers déjà encodés
 * (Clé = `${filePath}#${variant}:${mtimeMs}:${size}:${empreinte du texte}`).
 */
const tokenCache = new Map<string, number>();
/** Dernière clé connue par (fichier, variante), pour purger l'ancienne entrée. */
const fileToKeyMap = new Map<string, string>();

/**
 * Empreinte FNV-1a 32 bits du texte compté : un même fichier peut être compté sous plusieurs
 * formes (corps, enveloppe injectée, ligne d'index), et une inclusion peut changer sans que le
 * fichier qui l'inclut change.
 */
function textFingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}.${(hash >>> 0).toString(36)}`;
}

/**
 * Vide intégralement le cache de décompte de tokens (utile pour les tests unitaires).
 */
export function clearTokenCache(): void {
  tokenCache.clear();
  fileToKeyMap.clear();
  resetTokenizerMetrics();
}

/**
 * Retourne le nombre d'entrées actuellement mémorisées dans le cache.
 */
export function getTokenCacheSize(): number {
  return tokenCache.size;
}

/**
 * Encode une chaîne brute et chronomètre son temps d'exécution.
 */
function encodeAndTrack(text: string): number {
  const encoder = getEncoder();
  if (encoder) {
    const start = performance.now();
    try {
      const result = encoder(text);
      const elapsed = performance.now() - start;
      scanMetrics.cumulativeEncodingTimeMs += elapsed;
      scanMetrics.encodedCount++;
      return result.length;
    } catch {
      const elapsed = performance.now() - start;
      scanMetrics.cumulativeEncodingTimeMs += elapsed;
      scanMetrics.encodedCount++;
      return Math.ceil(text.length / 4);
    }
  } else {
    // Repli immédiat si l'encodeur est indisponible
    scanMetrics.encodedCount++;
    return Math.ceil(text.length / 4);
  }
}

/**
 * Calcule le nombre de tokens pour une chaîne de texte donnée via BPE o200k_base.
 * En cas d'erreur ou d'absence de l'encodeur, bascule de manière transparente sur Math.ceil(length / 4).
 *
 * @param text Le contenu brut
 * @returns Le nombre de tokens (minimum 0)
 */
export function countTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return encodeAndTrack(text);
}

/**
 * Calcule le nombre de tokens d'un fichier en utilisant un cache indexé par (chemin + date de modification + taille).
 * - Sur cache hit : retourne instantanément la valeur sans appeler l'encodeur.
 * - Sur cache miss : encode le texte, enregistre le temps cumulé et mémorise l'entrée.
 * Invalidation automatique dès que mtimeMs ou la taille change.
 *
 * @param filePath Chemin absolu du fichier
 * @param size Taille en octets du fichier (optionnel, calculé si omis)
 * @param mtimeMs Timestamp de dernière modification en millisecondes (optionnel, calculé si omis)
 * @param text Contenu textuel à tokenizer
 * @param variant Forme comptée pour ce fichier (ex. `f1`, `f5`), quand un fichier en a plusieurs
 * @returns Nombre de tokens calculé ou servi du cache
 */
export function countTokensForFile(
  filePath: string,
  size?: number,
  mtimeMs?: number,
  text?: string | null | undefined,
  variant = ''
): number {
  if (!text) return 0;

  let finalSize = size;
  let finalMtime = mtimeMs;
  if (finalSize === undefined || finalMtime === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      const stat = fs.statSync(filePath);
      finalSize = stat.size;
      finalMtime = stat.mtimeMs;
    } catch {
      return countTokens(text);
    }
  }

  const entry = `${filePath}#${variant}`;
  const key = `${entry}:${finalMtime}:${finalSize}:${textFingerprint(text)}`;
  if (tokenCache.has(key)) {
    scanMetrics.cachedCount++;
    return tokenCache.get(key)!;
  }

  // Cache miss -> encodage complet et mémorisation
  const tokens = countTokens(text);

  // Nettoyage de l'ancienne clé pour ce fichier et cette variante s'ils ont été modifiés
  const prevKey = fileToKeyMap.get(entry);
  if (prevKey && prevKey !== key) {
    tokenCache.delete(prevKey);
  }
  fileToKeyMap.set(entry, key);
  tokenCache.set(key, tokens);

  return tokens;
}

/**
 * Fonctions internes réservées aux tests unitaires pour tester les replis et états d'erreur.
 */
export function _setEncoderForTesting(fn: EncodeFunction | null, failedPermanently = false): void {
  cachedEncoder = fn;
  encoderFailedPermanently = failedPermanently;
}

export function _resetEncoderStateForTesting(): void {
  cachedEncoder = null;
  encoderFailedPermanently = false;
}
