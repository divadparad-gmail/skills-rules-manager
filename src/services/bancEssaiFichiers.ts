/**
 * Outils de bas niveau du banc d'essai : empreintes, écriture sûre, noms de la sauvegarde,
 * lecture validée du manifeste et de l'index. Aucune décision n'est prise ici : c'est
 * ScenarioManager qui choisit ce qui est sauvegardé, copié, supprimé ou restauré.
 *
 * N'importe pas `vscode` : runner.js charge la compilation out-test hors de l'hôte.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const DOSSIER_SAUVEGARDE = '.banc-essai-sauvegarde';
export const DOSSIER_TEMP = '.tmp';
export const FICHIER_INDEX = 'index.json';
export const SOUS_DOSSIER_RACINE = 'racine';
export const SOUS_DOSSIER_PROFIL = 'profil-global';
export const SUFFIXE_SAUVEGARDE = '.sauvegarde';
export const SUFFIXE_TEMP = '.banc-essai.tmp';
/** Préfixe des chemins du profil global : jamais de chemin absolu dans le manifeste ni dans l'index. */
export const PREFIXE_PERSONNEL = '~/';

export type EtatJournal = 'deploiement-en-cours' | 'deploye' | 'restauration-en-cours';
const ETATS: EtatJournal[] = ['deploiement-en-cours', 'deploye', 'restauration-en-cours'];

export interface Empreinte {
  sha256: string;
  taille: number;
}

export function empreinte(octets: Buffer): Empreinte {
  return { sha256: crypto.createHash('sha256').update(octets).digest('hex'), taille: octets.length };
}

export function memeEmpreinte(a: Empreinte, b: Empreinte): boolean {
  return a.sha256 === b.sha256 && a.taille === b.taille;
}

/** Comparaison fins de ligne normalisées, comme le garde-fou (scripts/garde-fou-fixtures.js). */
export function memeContenuNormalise(a: Buffer, b: Buffer): boolean {
  if (a.equals(b)) return true;
  const normaliser = (octets: Buffer) => octets.toString('utf8').replace(/\r\n/g, '\n');
  return normaliser(a) === normaliser(b);
}

/** Lit un fichier ordinaire ; null s'il est absent. Lève une erreur pour un dossier. */
export function lireSiPresent(fichier: string): Buffer | null {
  try {
    return fs.readFileSync(fichier);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// --------------------------------------------------------------------------
// Chemins notés : relatifs à la racine (« .agents/hooks.json ») ou au dossier personnel (« ~/… »)
// --------------------------------------------------------------------------

/** Un chemin noté est relatif, en barres obliques, sans segment vide, « . » ni « .. ». */
export function cheminNoteValide(chemin: unknown): chemin is string {
  if (typeof chemin !== 'string' || chemin.length === 0) return false;
  const rel = chemin.startsWith(PREFIXE_PERSONNEL) ? chemin.slice(PREFIXE_PERSONNEL.length) : chemin;
  if (rel.includes('\\') || rel.includes(':') || rel.startsWith('/')) return false;
  return rel.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export function resoudreChemin(chemin: string, racine: string, dossierPersonnel: string): string {
  if (chemin.startsWith(PREFIXE_PERSONNEL)) {
    return path.join(dossierPersonnel, ...chemin.slice(PREFIXE_PERSONNEL.length).split('/'));
  }
  return path.join(racine, ...chemin.split('/'));
}

/** Chemin relatif en barres obliques si `enfant` est sous `parent`, sinon null (casse ignorée sous Windows). */
export function relatifSous(parent: string, enfant: string): string | null {
  if (!parent) return null;
  const comparer = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const rel = path.relative(comparer(path.resolve(parent)), comparer(path.resolve(enfant)));
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  // Reprend la casse d'origine de l'enfant : seule la longueur du préfixe compte
  return path.resolve(enfant).slice(path.resolve(parent).length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
}

/** Variante de bascule d'un chemin : « x.md » ↔ « x.md.disabled ». */
export function varianteDeBascule(chemin: string): string {
  return chemin.endsWith('.disabled') ? chemin.slice(0, -'.disabled'.length) : `${chemin}.disabled`;
}

/** Nom réel du fichier sur le disque (casse comprise), pour restaurer « claude.md » sous son nom. */
export function nomReel(fichier: string): string {
  try {
    const nom = path.basename(fichier);
    const entrees = fs.readdirSync(path.dirname(fichier));
    return entrees.find((e) => e === nom) ?? entrees.find((e) => e.toLowerCase() === nom.toLowerCase()) ?? nom;
  } catch {
    return path.basename(fichier);
  }
}

// --------------------------------------------------------------------------
// Noms dans la sauvegarde : « .agents » devient « _agents », « .claude » devient « _claude »
// --------------------------------------------------------------------------

const DOSSIERS_MASQUES: Record<string, string> = { '.agents': '_agents', '.claude': '_claude' };

export function nomDeSauvegarde(relatif: string): string {
  const segments = relatif.split('/').map((s) => DOSSIERS_MASQUES[s] ?? s);
  return `${segments.join('/')}${SUFFIXE_SAUVEGARDE}`;
}

export function cheminDepuisSauvegarde(nom: string): string | null {
  if (!nom.endsWith(SUFFIXE_SAUVEGARDE)) return null;
  const inverses = Object.fromEntries(Object.entries(DOSSIERS_MASQUES).map(([a, b]) => [b, a]));
  return nom
    .slice(0, -SUFFIXE_SAUVEGARDE.length)
    .split('/')
    .map((s) => inverses[s] ?? s)
    .join('/');
}

// --------------------------------------------------------------------------
// Écriture sûre : fichier temporaire, fsync, vérification, puis renommage avec reprises
// --------------------------------------------------------------------------

export interface OptionsEcriture {
  /** Dossier du fichier temporaire, sur le même volume que la destination. */
  dossierTemp: string;
  tentatives?: number;
  attenteMs?: number;
  /** Point d'injection pour les tests. */
  renommer?: (de: string, vers: string) => Promise<void>;
}

const CODES_PASSAGERS = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Sous Windows, un renommage échoue avec EPERM, EBUSY ou EACCES tant qu'un autre processus
 * (agent, indexeur, antivirus) garde la destination ouverte : quelques reprises suffisent
 * pour un verrou passager, puis l'échec est remonté avec le nom du fichier.
 */
async function renommerAvecReprises(de: string, vers: string, options: OptionsEcriture): Promise<void> {
  const renommer = options.renommer ?? ((a: string, b: string) => fs.promises.rename(a, b));
  const tentatives = options.tentatives ?? 6;
  const attente = options.attenteMs ?? 50;
  for (let essai = 1; ; essai++) {
    try {
      await renommer(de, vers);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!CODES_PASSAGERS.has(code) || essai >= tentatives) throw err;
      await new Promise((r) => setTimeout(r, attente * 2 ** (essai - 1)));
    }
  }
}

export async function ecrireSur(destination: string, octets: Buffer, options: OptionsEcriture): Promise<void> {
  const attendu = empreinte(octets);
  await fs.promises.mkdir(options.dossierTemp, { recursive: true });
  const temp = path.join(
    options.dossierTemp,
    `.${path.basename(destination)}.${process.pid}-${crypto.randomBytes(4).toString('hex')}${SUFFIXE_TEMP}`
  );
  try {
    const fd = await fs.promises.open(temp, 'wx');
    try {
      await fd.writeFile(octets);
      await fd.sync();
    } finally {
      await fd.close();
    }
    if (!memeEmpreinte(empreinte(await fs.promises.readFile(temp)), attendu)) {
      throw new Error(`La copie temporaire de ${destination} ne correspond pas à l'original.`);
    }
    await renommerAvecReprises(temp, destination, options);
  } catch (err) {
    await fs.promises.rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
  if (!memeEmpreinte(empreinte(await fs.promises.readFile(destination)), attendu)) {
    throw new Error(`Le fichier écrit ne correspond pas à l'original : ${destination}`);
  }
}

// --------------------------------------------------------------------------
// Manifeste (journal du banc) et index de la sauvegarde
// --------------------------------------------------------------------------

export interface FixtureDeployee extends Empreinte {
  chemin: string;
  original: boolean;
}

export interface ManifesteBanc {
  version: 2;
  etat: EtatJournal;
  cible: string;
  debut: string;
  maj: string;
  profilGlobal: string | null;
  fixtures: FixtureDeployee[];
  dossiersCrees: string[];
}

export type LectureManifeste =
  | { type: 'absent' }
  | { type: 'illisible' }
  | { type: 'herite'; fichiers: string[] }
  | { type: 'v2'; manifeste: ManifesteBanc };

const estEmpreinte = (v: Record<string, unknown>): boolean =>
  typeof v.sha256 === 'string' && /^[0-9a-f]{64}$/.test(v.sha256) && Number.isInteger(v.taille) && (v.taille as number) >= 0;

export function lireManifeste(fichier: string): LectureManifeste {
  let brut: Buffer | null;
  try {
    brut = lireSiPresent(fichier);
  } catch {
    return { type: 'illisible' };
  }
  if (brut === null) return { type: 'absent' };
  let donnees: Record<string, unknown>;
  try {
    donnees = JSON.parse(brut.toString('utf8'));
  } catch {
    return { type: 'illisible' };
  }
  if (!donnees || typeof donnees !== 'object') return { type: 'illisible' };

  // Manifeste antérieur à L2b : une simple liste de chemins, sans empreinte
  if (donnees.version === undefined && Array.isArray(donnees.files)) {
    const fichiers = donnees.files
      .filter((f): f is string => typeof f === 'string')
      .map((f) => f.replace(/\\/g, '/'))
      .filter(cheminNoteValide);
    return { type: 'herite', fichiers };
  }

  const fixtures = donnees.fixtures;
  const dossiers = donnees.dossiersCrees;
  if (
    donnees.version !== 2 ||
    !ETATS.includes(donnees.etat as EtatJournal) ||
    !Array.isArray(fixtures) ||
    !Array.isArray(dossiers) ||
    !fixtures.every(
      (f) => f && typeof f === 'object' && cheminNoteValide(f.chemin) && estEmpreinte(f) && typeof f.original === 'boolean'
    ) ||
    !dossiers.every(cheminNoteValide) ||
    !(donnees.profilGlobal === null || cheminNoteValide(donnees.profilGlobal))
  ) {
    return { type: 'illisible' };
  }
  return { type: 'v2', manifeste: donnees as unknown as ManifesteBanc };
}

export interface EntreeIndex extends Empreinte {
  chemin: string;
  copie: string;
  date: string;
}

export interface IndexSauvegarde {
  version: 1;
  creeLe: string;
  fichiers: EntreeIndex[];
}

export type LectureIndex = { type: 'absent' } | { type: 'illisible' } | { type: 'ok'; index: IndexSauvegarde };

export function lireIndex(fichier: string): LectureIndex {
  let brut: Buffer | null;
  try {
    brut = lireSiPresent(fichier);
  } catch {
    return { type: 'illisible' };
  }
  if (brut === null) return { type: 'absent' };
  try {
    const donnees = JSON.parse(brut.toString('utf8'));
    const valide =
      donnees?.version === 1 &&
      Array.isArray(donnees.fichiers) &&
      donnees.fichiers.every(
        (f: Record<string, unknown>) =>
          f &&
          cheminNoteValide(f.chemin) &&
          cheminNoteValide(f.copie) &&
          !(f.copie as string).startsWith(PREFIXE_PERSONNEL) &&
          estEmpreinte(f) &&
          typeof f.date === 'string' &&
          !Number.isNaN(Date.parse(f.date as string))
      );
    return valide ? { type: 'ok', index: donnees as IndexSauvegarde } : { type: 'illisible' };
  } catch {
    return { type: 'illisible' };
  }
}

/** Liste récursive des fichiers d'un dossier, en chemins relatifs à barres obliques. */
export function listerFichiers(dossier: string, base = ''): string[] {
  let entrees: fs.Dirent[];
  try {
    entrees = fs.readdirSync(dossier, { withFileTypes: true });
  } catch {
    return [];
  }
  const resultat: string[] = [];
  for (const entree of entrees) {
    const rel = base ? `${base}/${entree.name}` : entree.name;
    if (entree.isDirectory()) {
      resultat.push(...listerFichiers(path.join(dossier, entree.name), rel));
    } else if (entree.isFile()) {
      resultat.push(rel);
    }
  }
  return resultat;
}
