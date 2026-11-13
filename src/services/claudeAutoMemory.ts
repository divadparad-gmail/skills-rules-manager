import * as fs from 'fs';
import * as path from 'path';
import { ClaudeAutoMemoryStat, ClaudeSettingsScope, ResourceItem } from '../types';
import { countTokensForFile } from '../utils/tokenizer';
import { claudeAncestorDirs } from '../claude/memorySources';
import { CLAUDE_MEMORY_MAX_BYTES, parseClaudeImports } from '../claude/memoryImports';
import {
  claudeAutoMemoryCut,
  claudeAutoMemoryDirName,
  claudeAutoMemoryDisabledByEnv,
  claudeAutoMemorySettings,
  CLAUDE_AUTO_MEMORY_MAX_CHARS,
} from '../claude/autoMemory';

/**
 * Claude Code : la ligne « Mémoire automatique, écrite par Claude » de la jauge et la carte de MEMORY.md
 * (règles et sources : src/claude/autoMemory.ts). Rien ici ne sert à Antigravity.
 *
 * Ce qui est lu, et rien d'autre :
 * - dans l'environnement donné : CLAUDE_CODE_DISABLE_AUTO_MEMORY (si elle coupe la mémoire, plus rien n'est
 *   lu), CLAUDE_CODE_PROJECT_DIR_NAME et CLAUDE_CONFIG_DIR (leur présence seule) ;
 * - les clés `autoMemoryEnabled` et `autoMemoryDirectory` des trois fichiers de réglages ;
 * - la présence d'un `.git` en remontant depuis le dossier de travail (jusqu'à `stopAt` dans les tests) ;
 * - MEMORY.md lui-même, en entier jusqu'à 4 Mio, sinon son début seulement (assez pour la coupe).
 * Les autres fichiers du dossier memory/ ne sont ni listés ni lus (documentation : « Claude Code doesn't load
 * topic files […] at startup ») ; une ligne « @ » de MEMORY.md n'est jamais développée (non mesuré).
 *
 * Choix déduits : un MEMORY.md de plus de 4 Mio est coupé comme les autres, car la note de la documentation
 * réserve la limite de 4 Mio aux CLAUDE.md (« This limit applies only to MEMORY.md. Claude gets the whole of
 * each CLAUDE.md file […] as long as the file is 4 MiB or smaller ») ; son effet sur MEMORY.md n'est pas
 * vérifié. Le texte est compté tel quel, frontmatter et commentaires compris (non vérifié).
 */

/** Le variant du cache des tokens : le texte gardé après la coupe. */
const CLAUDE_AUTO_MEMORY_VARIANT = 'claude-memoire-auto';
/** Assez d'octets pour 25 000 points de code (4 octets au plus chacun), et un de plus. */
const CLAUDE_AUTO_MEMORY_PARTIAL_BYTES = CLAUDE_AUTO_MEMORY_MAX_CHARS * 4 + 4;

export interface ClaudeAutoMemoryScanOptions {
  /** Le dossier de travail (premier dossier de l'espace). */
  cwd: string;
  /** Le profil de Claude Code (getEffectiveGlobalClaudePath). */
  globalPath: string;
  /** Réservé aux tests : le dernier dossier examiné en cherchant la racine Git. */
  stopAt?: string;
  /** L'environnement de l'hôte de l'extension (process.env), injectable pour les tests. */
  env: Record<string, string | undefined>;
  budgetTotal?: number;
}

export interface ClaudeAutoMemoryScan {
  stat: ClaudeAutoMemoryStat;
  item: ResourceItem | null;
}

function readTextOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** La racine Git trouvée en remontant (un `.git` dossier), le cas du worktree (un `.git` fichier), ou aucune. */
function findGitRoot(cwd: string, stopAt: string | undefined): { kind: 'dossier' | 'fichier'; root: string } | null {
  const start = path.resolve(cwd);
  for (const dir of [start, ...claudeAncestorDirs(start, { stopAt }).reverse()]) {
    try {
      const stat = fs.statSync(path.join(dir, '.git'));
      if (stat.isDirectory()) return { kind: 'dossier', root: dir };
      if (stat.isFile()) return { kind: 'fichier', root: dir };
    } catch {
      // Pas de .git ici
    }
  }
  return null;
}

/** Les premiers octets d'un fichier, sans le dernier caractère s'il est incomplet. */
function readStart(file: string, bytes: number): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buffer, 0, bytes, 0);
    let end = read;
    // Recule jusqu'au début du dernier caractère UTF-8, puis le garde seulement s'il est complet
    let start = end - 1;
    while (start > 0 && (buffer[start] & 0xc0) === 0x80) start--;
    const lead = buffer[start];
    const length = lead < 0x80 ? 1 : lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
    if (start + length > end) end = start;
    return buffer.subarray(0, end).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

const vide = (etat: ClaudeAutoMemoryStat['etat'], cause: ClaudeAutoMemoryStat['cause'], mentions: string[]): ClaudeAutoMemoryScan => ({
  stat: { etat, ...(cause ? { cause } : {}), tokenCount: 0, charCount: 0, percentage: 0, mentions },
  item: null,
});

/** La mémoire automatique du dossier de travail : la ligne de la jauge et, si MEMORY.md est présent, sa carte. */
export function scanClaudeAutoMemory(options: ClaudeAutoMemoryScanOptions): ClaudeAutoMemoryScan {
  const env = options.env;
  const mentions = env.CLAUDE_CONFIG_DIR ? ['CLAUDE_CONFIG_DIR'] : [];

  // La variable coupe la mémoire : rien d'autre n'est lu
  if (claudeAutoMemoryDisabledByEnv(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY)) {
    return vide('desactivee', { type: 'variable', nom: 'CLAUDE_CODE_DISABLE_AUTO_MEMORY' }, mentions);
  }

  const cwd = path.resolve(options.cwd);
  const settings = claudeAutoMemorySettings({
    utilisateur: readTextOrNull(path.join(options.globalPath, 'settings.json')),
    projet: readTextOrNull(path.join(cwd, '.claude', 'settings.json')),
    local: readTextOrNull(path.join(cwd, '.claude', 'settings.local.json')),
  });
  if (!settings.active) {
    return vide('desactivee', { type: 'reglage', portee: settings.coupeePar as ClaudeSettingsScope }, mentions);
  }
  if (env.CLAUDE_CODE_PROJECT_DIR_NAME) {
    return vide('non-determine', { type: 'variable', nom: 'CLAUDE_CODE_PROJECT_DIR_NAME' }, mentions);
  }
  if (settings.dossierPose.length > 0) {
    return vide('non-determine', { type: 'reglage-dossier', portees: settings.dossierPose }, mentions);
  }

  const git = findGitRoot(cwd, options.stopAt);
  if (git?.kind === 'fichier') return vide('non-determine', { type: 'worktree' }, mentions);
  const name = claudeAutoMemoryDirName(git ? git.root : cwd);
  if (name === null) return vide('non-determine', { type: 'longueur' }, mentions);

  const file = path.join(options.globalPath, 'projects', name, 'memory', 'MEMORY.md');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return vide('absent', undefined, mentions);
  }
  if (!stat.isFile()) return vide('absent', undefined, mentions);

  const plusDe4Mio = stat.size > CLAUDE_MEMORY_MAX_BYTES;
  let raw: string;
  try {
    raw = plusDe4Mio ? readStart(file, CLAUDE_AUTO_MEMORY_PARTIAL_BYTES) : fs.readFileSync(file, 'utf8');
  } catch {
    return vide('absent', undefined, mentions);
  }
  const cut = claudeAutoMemoryCut(raw);
  const tokenCount = countTokensForFile(file, stat.size, stat.mtimeMs, cut.text, CLAUDE_AUTO_MEMORY_VARIANT);
  const charCount = [...cut.text].length;
  const detail = {
    coupe: cut.coupe,
    lignesOrigine: plusDe4Mio ? null : cut.lignesOrigine,
    lignesGardees: cut.lignesGardees,
    plusDe4Mio,
    importsNonDeveloppes: parseClaudeImports(cut.text).length > 0,
    octets: stat.size,
  };
  const budgetTotal = options.budgetTotal ?? 20000;
  const item: ResourceItem = {
    id: 'MEMORY.md',
    name: 'MEMORY.md',
    description: 'Mémoire automatique, écrite par Claude : index chargé au démarrage',
    type: 'soul',
    scope: 'global',
    enabled: true,
    path: file,
    targetTool: 'claude-code',
    isFolder: false,
    charCount,
    tokenCount,
    lineCount: cut.lignesGardees,
    metadata: {
      isSoul: true,
      locked: true,
      claudeMemoryType: 'AutoMem',
      claudeReadOnly: { raison: 'Écrit par Claude' },
      claudeAutoMemory: detail,
      warningLinesExceeded: false,
      warningSizeExceeded: false,
    },
  };
  return {
    stat: {
      etat: 'present',
      tokenCount,
      charCount,
      percentage: Number(((tokenCount / budgetTotal) * 100).toFixed(1)),
      mentions,
      ...detail,
    },
    item,
  };
}
