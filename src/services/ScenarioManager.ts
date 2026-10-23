import * as fs from 'fs';
import * as path from 'path';
import { ResourceItem } from '../types';
import { getEffectiveGlobalAntigravityPath, getUserHome } from '../utils/paths';
import {
  DOSSIER_SAUVEGARDE,
  DOSSIER_TEMP,
  Empreinte,
  EntreeIndex,
  EtatJournal,
  FICHIER_INDEX,
  IndexSauvegarde,
  LectureManifeste,
  ManifesteBanc,
  PREFIXE_PERSONNEL,
  SOUS_DOSSIER_PROFIL,
  SOUS_DOSSIER_RACINE,
  SUFFIXE_TEMP,
  cheminDepuisSauvegarde,
  ecrireSur,
  empreinte,
  lireIndex,
  lireManifeste,
  lireSiPresent,
  listerFichiers,
  memeContenuNormalise,
  memeEmpreinte,
  nomDeSauvegarde,
  nomReel,
  relatifSous,
  resoudreChemin,
  varianteDeBascule,
} from './bancEssaiFichiers';

export type ScenarioTarget = 'antigravity' | 'claude-code' | 'all';
export type EtapeBanc = 'sauvegarde' | 'index' | 'journal' | 'copie' | 'restauration' | 'suppression' | 'nettoyage';
export type MotifRefus = 'banc-actif' | 'fixtures-modifiees' | 'sauvegarde-invalide' | 'destination-invalide';

export interface OptionsBanc {
  /** Vidage : écrase les fixtures modifiées pendant le test (après accord explicite). */
  ecraser?: boolean;
  /** Déploiement : vide et restaure un banc actif avant de redéployer, jamais si une fixture a été modifiée. */
  remplacer?: boolean;
  /** Profil global d'Antigravity (par défaut : réglage skillsManager.globalPath, sinon ~/.gemini/config). */
  profilGlobal?: string;
  /** Dossier personnel, base des chemins « ~/… » (par défaut : celui de l'utilisateur). */
  dossierPersonnel?: string;
  /** Point d'injection de pannes, réservé aux tests. */
  panne?: (etape: EtapeBanc, chemin: string) => void;
}

/** Refus motivé : rien n'a été modifié, et `chemins` liste les fichiers en cause. */
export class BancEssaiRefus extends Error {
  constructor(
    public readonly motif: MotifRefus,
    message: string,
    public readonly chemins: string[] = []
  ) {
    super(message);
    this.name = 'BancEssaiRefus';
  }
}

export interface EtatBanc {
  /** aucun : rien de déployé ; actif : banc déployé ; interrompu : opération inachevée ou journal incohérent. */
  niveau: 'aucun' | 'actif' | 'interrompu';
  etat: EtatJournal | null;
  manifeste: LectureManifeste['type'];
  sauvegarde: boolean;
  cible: string | null;
  deployeLe: string | null;
  nbOriginaux: number;
  nbFixtures: number;
}

/** Reconnaissance des fixtures par leur contenu, préparée une fois par scan. */
export interface ReconnaissanceFixtures {
  fichier: (absolu: string) => boolean;
  dossier: (absolu: string) => boolean;
}

export interface PlanDeploiement {
  cible: ScenarioTarget;
  /** Vrais fichiers qui seront sauvegardés, puis restaurés au vidage. */
  aSauvegarder: string[];
  /** Fichiers déjà identiques à leur fixture : non sauvegardés, ils seront supprimés au vidage. */
  identiques: string[];
  nbFixtures: number;
  avertissements: string[];
}

export interface RapportDeploiement extends PlanDeploiement {
  copies: number;
  /** Vidage du banc précédent, quand `remplacer` l'a demandé. */
  vidage?: RapportVidage;
}

export interface PlanVidage {
  aSupprimer: string[];
  aRestaurer: string[];
  /** Fixtures modifiées pendant le test : le vidage les écraserait, il exige `ecraser`. */
  modifiees: string[];
  /** Fichiers présents à un chemin de fixture mais différents d'elle : conservés. */
  signales: string[];
}

export interface RapportVidage {
  supprimes: string[];
  restaures: string[];
  /** Fixtures modifiées écrasées (supprimées ou remplacées par l'original) avec l'accord de l'utilisateur. */
  ecrases: string[];
  signales: string[];
}

interface Contexte {
  racine: string;
  personnel: string;
  /** Profil global noté « ~/… », ou null s'il est hors du dossier personnel. */
  profilNote: string | null;
  sauvegarde: string;
  temp: string;
  index: string;
  manifeste: string;
}

interface ElementDeploiement {
  chemin: string;
  absolu: string;
  octets: Buffer;
  statut: 'absent' | 'identique' | 'original';
  original?: { octets: Buffer; empreinte: Empreinte; date: string; chemin: string };
}

interface Attendu {
  chemin: string;
  /** Empreinte exacte de la fixture déployée (manifeste). */
  exact?: Empreinte;
  /** Contenu de la source sous test/scenarios/, comparé fins de ligne normalisées. */
  source?: Buffer;
  deploye: boolean;
  original: boolean;
}

interface ActionVidage {
  type: 'restaurer' | 'supprimer';
  chemin: string;
  absolu: string;
  modifiee: boolean;
  entree?: EntreeIndex;
  copie?: string;
}

interface PlanVidageInterne extends PlanVidage {
  actions: ActionVidage[];
  verifications: EntreeIndex[];
  dossiers: string[];
  temporairesGlobaux: string[];
  journal: LectureManifeste;
  sauvegardePresente: boolean;
}

const OUTILS = ['antigravity', 'claude-code'] as const;
/** Sous Windows, un antivirus ou un indexeur verrouille un instant les fichiers tout juste écrits. */
const SUPPRESSION_RECURSIVE = { recursive: true, force: true, maxRetries: 6, retryDelay: 50 };
const DOUBLON_GLOBAL = 'rules/rule-test-doublon.md';
/** Profil global par défaut d'Antigravity (getDefaultGlobalAntigravityPath), noté depuis le dossier personnel. */
const PROFIL_PAR_DEFAUT = `${PREFIXE_PERSONNEL}.gemini/config`;
const cle = (chemin: string) => (process.platform === 'win32' ? chemin.toLowerCase() : chemin);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Le module unique du banc d'essai : déploiement, vidage et état, pour les boutons de
 * l'extension comme pour les scripts npm (test/scenarios/scripts/runner.js).
 *
 * Avant un déploiement, chaque vrai fichier qui serait écrasé est copié dans
 * .banc-essai-sauvegarde/ et vérifié (SHA-256 et taille). Le vidage ne supprime que les
 * fichiers identiques à la fixture déployée, restaure les originaux, puis retire la
 * sauvegarde. Le manifeste sert de journal : une opération interrompue est reprise au
 * vidage suivant.
 */
export class ScenarioManager {
  public static readonly MANIFEST_FILE = '.scenario-manifest.json';
  public static readonly BACKUP_DIR = DOSSIER_SAUVEGARDE;

  /**
   * Retourne l'ensemble de tous les chemins relatifs des fichiers appartenant aux scénarios de test.
   * Combine :
   * 1. Les fichiers listés dans .scenario-manifest.json (s'il existe).
   * 2. Les fichiers sources connus dans test/scenarios/antigravity et test/scenarios/claude-code.
   */
  public static getScenarioFiles(rootPath: string): Set<string> {
    const filesSet = new Set<string>();
    if (!rootPath || !fs.existsSync(rootPath)) return filesSet;

    // 1. Lecture du manifeste de déploiement (hors profil global)
    const lecture = lireManifeste(path.join(rootPath, this.MANIFEST_FILE));
    if (lecture.type === 'herite') {
      lecture.fichiers.forEach((f) => filesSet.add(f));
    } else if (lecture.type === 'v2') {
      lecture.manifeste.fixtures
        .filter((f) => !f.chemin.startsWith(PREFIXE_PERSONNEL))
        .forEach((f) => filesSet.add(f.chemin));
    }

    // 2. Scan direct des fixtures disponibles dans test/scenarios
    const scenariosBaseDir = path.join(rootPath, 'test', 'scenarios');
    const scanDir = (srcDir: string) => {
      if (!fs.existsSync(srcDir)) return;
      const walk = (currentDir: string, relBase: string) => {
        try {
          const entries = fs.readdirSync(currentDir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            const relPath = path.join(relBase, entry.name).replace(/\\/g, '/');
            filesSet.add(relPath);
            if (entry.isDirectory()) {
              walk(fullPath, relPath);
            }
          }
        } catch {
          // Ignorer
        }
      };
      walk(srcDir, '');
    };

    scanDir(path.join(scenariosBaseDir, 'antigravity'));
    scanDir(path.join(scenariosBaseDir, 'claude-code'));

    return filesSet;
  }

  /**
   * Prépare la reconnaissance des fixtures du banc d'essai, à réutiliser pour tous les éléments
   * d'un même scan : les sources et le manifeste ne sont lus qu'une fois.
   */
  public static reconnaitreFixtures(rootPath: string, options: OptionsBanc = {}): ReconnaissanceFixtures {
    if (!rootPath || !fs.existsSync(rootPath)) return { fichier: () => false, dossier: () => false };
    const ctx = this.contexte(rootPath, options);
    const { attendus } = this.fixturesAttendues(ctx, lireManifeste(ctx.manifeste));
    const parAbsolu = new Map([...attendus.values()].map((a) => [cle(path.resolve(this.resoudre(a.chemin, ctx))), a]));

    // Un fichier est une fixture s'il est identique à la fixture attendue à son chemin ou à sa
    // variante de bascule (.md ↔ .md.disabled), et seulement dans ce cas
    const fichier = (absolu: string): boolean => {
      const candidats = [absolu, varianteDeBascule(absolu)]
        .map((p) => parAbsolu.get(cle(path.resolve(p))))
        .filter((a): a is Attendu => !!a);
      if (candidats.length === 0) return false;
      let octets: Buffer | null;
      try {
        octets = lireSiPresent(absolu);
      } catch {
        return false;
      }
      if (!octets) return false;
      const contenu = octets;
      return candidats.some((a) =>
        a.exact ? memeEmpreinte(empreinte(contenu), a.exact) : !!a.source && memeContenuNormalise(contenu, a.source)
      );
    };
    // Un dossier (skill) est une fixture si tous ses fichiers en sont : un fichier ajouté le protège
    const dossier = (absolu: string): boolean => {
      const fichiers = listerFichiers(absolu);
      return fichiers.length > 0 && fichiers.every((rel) => fichier(path.join(absolu, ...rel.split('/'))));
    };
    return { fichier, dossier };
  }

  /**
   * Vérifie si un élément est une fixture du banc d'essai : son contenu doit être identique à la
   * fixture déployée (manifeste) ou, sans manifeste, à sa source sous test/scenarios/. Ni un
   * marqueur porté par le fichier lui-même, ni son nom, ni son seul chemin ne suffisent.
   */
  public static isScenarioFixture(
    rootPath: string,
    item: ResourceItem,
    reconnaissance?: ReconnaissanceFixtures
  ): boolean {
    if (!rootPath || !item.path) return false;
    const fixtures = reconnaissance ?? this.reconnaitreFixtures(rootPath);
    return item.isFolder ? fixtures.dossier(item.path) : fixtures.fichier(item.path);
  }

  // ==========================================================================
  // État
  // ==========================================================================

  /** État du banc, lu sans rien modifier : sert aux avertissements de l'interface et du terminal. */
  public static lireEtat(rootPath: string, options: OptionsBanc = {}): EtatBanc {
    const ctx = this.contexte(rootPath, options);
    const journal = lireManifeste(ctx.manifeste);
    const sauvegarde = fs.existsSync(ctx.sauvegarde);
    const lectureIndex = sauvegarde ? lireIndex(ctx.index) : null;
    const v2 = journal.type === 'v2' ? journal.manifeste : null;

    let niveau: EtatBanc['niveau'] = 'actif';
    if (!sauvegarde && journal.type === 'absent') {
      niveau = 'aucun';
    } else if (
      journal.type === 'illisible' ||
      (journal.type === 'absent' && sauvegarde) ||
      (v2 && (v2.etat !== 'deploye' || !sauvegarde))
    ) {
      niveau = 'interrompu';
    }

    return {
      niveau,
      etat: v2?.etat ?? null,
      manifeste: journal.type,
      sauvegarde,
      cible: v2?.cible ?? null,
      deployeLe: v2?.debut ?? null,
      nbOriginaux: lectureIndex?.type === 'ok' ? lectureIndex.index.fichiers.length : 0,
      nbFixtures: v2 ? v2.fixtures.length : journal.type === 'herite' ? journal.fichiers.length : 0,
    };
  }

  // ==========================================================================
  // Déploiement
  // ==========================================================================

  /** Plan du déploiement, en lecture seule. Refuse si un banc est déjà actif ou si une destination est invalide. */
  public static planifierDeploiement(rootPath: string, target: ScenarioTarget, options: OptionsBanc = {}): PlanDeploiement {
    this.verifierRacine(rootPath);
    const etat = this.lireEtat(rootPath, options);
    if (etat.niveau !== 'aucun') throw this.refusBancActif(etat);
    return this.resumer(target, this.planifierCopies(this.contexte(rootPath, options), target));
  }

  /**
   * Déploie un scénario d'essai depuis test/scenarios vers la racine de l'espace de travail.
   * Ordre : sauvegarder et vérifier les originaux, écrire l'index puis le journal, copier les
   * fixtures, puis passer le journal à « deploye ». Un échec avant la copie ne modifie rien ;
   * un échec pendant la copie déclenche un retour arrière (vidage).
   */
  public static async deploy(rootPath: string, target: ScenarioTarget, options: OptionsBanc = {}): Promise<RapportDeploiement> {
    this.verifierRacine(rootPath);
    const ctx = this.contexte(rootPath, options);

    let vidage: RapportVidage | undefined;
    const etat = this.lireEtat(rootPath, options);
    if (etat.niveau !== 'aucun') {
      if (!options.remplacer) throw this.refusBancActif(etat);
      // Le redéploiement n'écrase jamais une fixture modifiée : il faut un vidage explicite
      const planVidage = this.planifierVidage(rootPath, { ...options, ecraser: false });
      if (planVidage.modifiees.length > 0) {
        throw new BancEssaiRefus(
          'fixtures-modifiees',
          `${planVidage.modifiees.length} fixture(s) ont été modifiées pendant le test. ` +
            'Le redéploiement ne les écrase jamais : videz d\'abord le banc en acceptant de les écraser.',
          planVidage.modifiees
        );
      }
      vidage = await this.clean(rootPath, { ...options, ecraser: false });
    }

    const { elements, dossiersACreer, avertissements } = this.planifierCopies(ctx, target);
    const resume = this.resumer(target, { elements, avertissements });

    // 1. Le dossier de sauvegarde, créé sans récursivité, sert de verrou
    try {
      await fs.promises.mkdir(ctx.sauvegarde);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw this.refusBancActif(this.lireEtat(rootPath, options));
      throw err;
    }

    const debut = new Date().toISOString();
    const manifeste = (etatJournal: EtatJournal): ManifesteBanc => ({
      version: 2,
      etat: etatJournal,
      cible: target,
      debut,
      maj: new Date().toISOString(),
      profilGlobal: ctx.profilNote,
      fixtures: elements.map((e) => ({ chemin: e.chemin, ...empreinte(e.octets), original: e.statut === 'original' })),
      dossiersCrees: dossiersACreer,
    });

    // 2 à 4. Sauvegarde vérifiée, index, journal : un échec ici ne modifie rien
    try {
      await fs.promises.mkdir(ctx.temp);
      const entrees: EntreeIndex[] = [];
      for (const element of elements) {
        if (element.statut !== 'original' || !element.original) continue;
        options.panne?.('sauvegarde', element.chemin);
        const actuel = lireSiPresent(element.absolu);
        if (!actuel || !memeEmpreinte(empreinte(actuel), element.original.empreinte)) {
          throw new Error(`${element.chemin} a changé pendant la préparation du déploiement.`);
        }
        const copie = this.nomCopie(element.chemin, ctx);
        const copieAbsolue = path.join(ctx.sauvegarde, ...copie.split('/'));
        await fs.promises.mkdir(path.dirname(copieAbsolue), { recursive: true });
        await ecrireSur(copieAbsolue, actuel, { dossierTemp: ctx.temp });
        entrees.push({ chemin: element.original.chemin, copie, ...element.original.empreinte, date: element.original.date });
      }

      options.panne?.('index', FICHIER_INDEX);
      const index: IndexSauvegarde = { version: 1, creeLe: debut, fichiers: entrees };
      await ecrireSur(ctx.index, Buffer.from(JSON.stringify(index, null, 2), 'utf8'), { dossierTemp: ctx.temp });
      if (lireIndex(ctx.index).type !== 'ok') throw new Error('L\'index de la sauvegarde est illisible après écriture.');

      options.panne?.('journal', this.MANIFEST_FILE);
      await this.ecrireJournal(ctx, manifeste('deploiement-en-cours'));
    } catch (err) {
      // Rien n'a été copié : seuls la sauvegarde et le journal tout juste créés sont retirés
      await fs.promises.rm(ctx.sauvegarde, SUPPRESSION_RECURSIVE).catch(() => undefined);
      await fs.promises.rm(ctx.manifeste, { force: true }).catch(() => undefined);
      throw err;
    }

    // 5 et 6. Copie des fixtures, puis état final
    let copies = 0;
    try {
      for (const element of elements) {
        options.panne?.('copie', element.chemin);
        if (element.statut === 'original' && element.original) {
          const actuel = lireSiPresent(element.absolu);
          if (!actuel || !memeEmpreinte(empreinte(actuel), element.original.empreinte)) {
            throw new Error(`${element.chemin} a changé depuis sa sauvegarde.`);
          }
        }
        await fs.promises.mkdir(path.dirname(element.absolu), { recursive: true });
        await ecrireSur(element.absolu, element.octets, { dossierTemp: this.dossierTempPour(element.chemin, element.absolu, ctx) });
        copies++;
      }
      options.panne?.('journal', this.MANIFEST_FILE);
      await this.ecrireJournal(ctx, manifeste('deploye'));
    } catch (err) {
      try {
        await this.clean(rootPath, { ...options, ecraser: false });
      } catch (errRetour) {
        throw new Error(
          `Échec du déploiement : ${message(err)} Le retour arrière a échoué : ${message(errRetour)} ` +
            'Le banc reste inachevé : videz-le et restaurez les originaux.'
        );
      }
      throw new Error(`Échec du déploiement, annulé : ${message(err)}`);
    }

    await fs.promises.rm(ctx.temp, SUPPRESSION_RECURSIVE).catch(() => undefined);
    return { ...resume, copies, ...(vidage ? { vidage } : {}) };
  }

  // ==========================================================================
  // Vidage et restauration
  // ==========================================================================

  /** Plan du vidage, en lecture seule. Refuse si une copie nécessaire de la sauvegarde est absente ou corrompue. */
  public static planifierVidage(rootPath: string, options: OptionsBanc = {}): PlanVidage {
    const plan = this.planifierVidageInterne(this.contexte(rootPath, options));
    return {
      aSupprimer: plan.aSupprimer,
      aRestaurer: plan.aRestaurer,
      modifiees: plan.modifiees,
      signales: plan.signales,
    };
  }

  /**
   * Vide le banc d'essai : restaure les originaux, supprime les fixtures intactes, puis retire la
   * sauvegarde et le journal. Idempotent : relancé après une interruption, il reprend.
   * Une fixture modifiée pendant le test n'est écrasée qu'avec `ecraser`.
   */
  public static async clean(rootPath: string, options: OptionsBanc = {}): Promise<RapportVidage> {
    const rapport: RapportVidage = { supprimes: [], restaures: [], ecrases: [], signales: [] };
    if (!rootPath || !fs.existsSync(rootPath)) return rapport;

    const ctx = this.contexte(rootPath, options);
    const plan = this.planifierVidageInterne(ctx);
    rapport.signales = plan.signales;

    if (plan.modifiees.length > 0 && !options.ecraser) {
      throw new BancEssaiRefus(
        'fixtures-modifiees',
        `${plan.modifiees.length} fixture(s) ont été modifiées pendant le test. ` +
          'Le vidage les écraserait : rien n\'a été modifié.',
        plan.modifiees
      );
    }

    // Journal : « restauration-en-cours » tant que la sauvegarde existe
    if (plan.sauvegardePresente) {
      await fs.promises.mkdir(ctx.temp, { recursive: true });
      options.panne?.('journal', this.MANIFEST_FILE);
      const v2 = plan.journal.type === 'v2' ? plan.journal.manifeste : null;
      const maintenant = new Date().toISOString();
      await this.ecrireJournal(ctx, {
        version: 2,
        etat: 'restauration-en-cours',
        cible: v2?.cible ?? 'inconnue',
        debut: v2?.debut ?? maintenant,
        maj: maintenant,
        profilGlobal: v2 ? v2.profilGlobal : ctx.profilNote,
        fixtures: v2?.fixtures ?? [],
        dossiersCrees: v2?.dossiersCrees ?? [],
      });
    }

    for (const action of plan.actions.filter((a) => a.type === 'restaurer')) {
      options.panne?.('restauration', action.chemin);
      const entree = action.entree as EntreeIndex;
      const octets = lireSiPresent(action.copie as string);
      if (!octets || !memeEmpreinte(empreinte(octets), entree)) {
        throw new BancEssaiRefus('sauvegarde-invalide', `La copie de ${action.chemin} est absente ou corrompue.`, [action.chemin]);
      }
      await fs.promises.mkdir(path.dirname(action.absolu), { recursive: true });
      await ecrireSur(action.absolu, octets, { dossierTemp: this.dossierTempPour(action.chemin, action.absolu, ctx) });
      const date = new Date(entree.date);
      await fs.promises.utimes(action.absolu, date, date).catch(() => undefined);
      rapport.restaures.push(action.chemin);
      if (action.modifiee) rapport.ecrases.push(action.chemin);
    }

    for (const action of plan.actions.filter((a) => a.type === 'supprimer')) {
      options.panne?.('suppression', action.chemin);
      await fs.promises.rm(action.absolu, { force: true });
      rapport.supprimes.push(action.chemin);
      if (action.modifiee) rapport.ecrases.push(action.chemin);
    }

    for (const temporaire of plan.temporairesGlobaux) {
      await fs.promises.rm(temporaire, { force: true }).catch(() => undefined);
    }

    // Seuls les dossiers créés par le déploiement, et seulement s'ils sont vides
    for (const dossier of plan.dossiers) {
      try {
        fs.rmdirSync(dossier);
      } catch {
        // Non vide, absent ou verrouillé : conservé
      }
    }

    // Vérification finale : chaque original indexé est à l'identique avant de retirer sa copie
    const nonConformes = plan.verifications.filter((entree) => {
      const actuel = lireSiPresent(this.resoudre(entree.chemin, ctx));
      return !actuel || !memeEmpreinte(empreinte(actuel), entree);
    });
    if (nonConformes.length > 0) {
      throw new Error(
        `Restauration incomplète : ${nonConformes.map((e) => e.chemin).join(', ')}. La sauvegarde est conservée.`
      );
    }

    options.panne?.('nettoyage', DOSSIER_SAUVEGARDE);
    if (plan.sauvegardePresente) {
      for (const sousDossier of [SOUS_DOSSIER_RACINE, SOUS_DOSSIER_PROFIL, DOSSIER_TEMP]) {
        await fs.promises.rm(path.join(ctx.sauvegarde, sousDossier), SUPPRESSION_RECURSIVE);
      }
      await fs.promises.rm(ctx.index, { force: true });
      await fs.promises.rm(ctx.sauvegarde, SUPPRESSION_RECURSIVE);
    }
    await fs.promises.rm(ctx.manifeste, { force: true });
    return rapport;
  }

  // ==========================================================================
  // Messages communs aux boutons de l'extension
  // ==========================================================================

  public static resumerDeploiement(rapport: RapportDeploiement): string {
    const parties = [`🧪 Scénarios « ${rapport.cible} » injectés (${rapport.copies} fichiers).`];
    if (rapport.aSauvegarder.length > 0) {
      parties.push(`💾 ${rapport.aSauvegarder.length} vrai(s) fichier(s) sauvegardé(s), restauré(s) au vidage : ${rapport.aSauvegarder.join(', ')}.`);
    }
    if (rapport.identiques.length > 0) {
      parties.push(`Déjà identiques à leur fixture, supprimés au vidage : ${rapport.identiques.join(', ')}.`);
    }
    return [...parties, ...rapport.avertissements].join('\n');
  }

  public static resumerVidage(rapport: RapportVidage): string {
    const parties = [
      `🧹 Banc d'essai vidé : ${rapport.supprimes.length} fixture(s) supprimée(s), ${rapport.restaures.length} original(aux) restauré(s).`,
    ];
    if (rapport.ecrases.length > 0) parties.push(`Fixtures modifiées écrasées : ${rapport.ecrases.join(', ')}.`);
    if (rapport.signales.length > 0) {
      parties.push(`🛡️ Conservés, car différents de leur fixture : ${rapport.signales.join(', ')}.`);
    }
    return parties.join('\n');
  }

  public static decrireErreur(err: unknown): string {
    if (err instanceof BancEssaiRefus && err.chemins.length > 0) {
      return `${err.message} (${err.chemins.join(', ')})`;
    }
    return message(err);
  }

  // ==========================================================================
  // Mécanique interne
  // ==========================================================================

  private static verifierRacine(rootPath: string): void {
    if (!rootPath || !fs.existsSync(rootPath)) {
      throw new Error("L'espace de travail local n'est pas accessible.");
    }
    const scenariosBaseDir = path.join(rootPath, 'test', 'scenarios');
    if (!fs.existsSync(scenariosBaseDir)) {
      throw new Error(`Le dossier de scénarios est introuvable : ${scenariosBaseDir}`);
    }
  }

  private static contexte(rootPath: string, options: OptionsBanc): Contexte {
    const personnel = options.dossierPersonnel ?? getUserHome();
    const profil = options.profilGlobal ?? getEffectiveGlobalAntigravityPath();
    const relProfil = profil ? relatifSous(personnel, profil) : null;
    const sauvegarde = path.join(rootPath, DOSSIER_SAUVEGARDE);
    return {
      racine: rootPath,
      personnel,
      profilNote: relProfil ? `${PREFIXE_PERSONNEL}${relProfil}` : null,
      sauvegarde,
      temp: path.join(sauvegarde, DOSSIER_TEMP),
      index: path.join(sauvegarde, FICHIER_INDEX),
      manifeste: path.join(rootPath, this.MANIFEST_FILE),
    };
  }

  private static refusBancActif(etat: EtatBanc): BancEssaiRefus {
    const detail = etat.niveau === 'interrompu' ? 'une opération a été interrompue' : `état : ${etat.etat ?? 'inconnu'}`;
    return new BancEssaiRefus(
      'banc-actif',
      `Un banc d'essai est déjà déployé (${detail}, ${etat.nbOriginaux} original(aux) sauvegardé(s)). ` +
        'Videz-le et restaurez les originaux avant de redéployer.'
    );
  }

  private static resoudre(chemin: string, ctx: Contexte): string {
    return resoudreChemin(chemin, ctx.racine, ctx.personnel);
  }

  /** Nom de la copie dans la sauvegarde : racine/… ou profil-global/…, relatif au profil. */
  private static nomCopie(chemin: string, ctx: Contexte): string {
    if (chemin.startsWith(PREFIXE_PERSONNEL)) {
      const relProfil = chemin.slice((ctx.profilNote as string).length + 1);
      return `${SOUS_DOSSIER_PROFIL}/${nomDeSauvegarde(relProfil)}`;
    }
    return `${SOUS_DOSSIER_RACINE}/${nomDeSauvegarde(chemin)}`;
  }

  /** Le fichier temporaire doit être sur le volume de sa destination : à côté d'elle pour le profil global. */
  private static dossierTempPour(chemin: string, absolu: string, ctx: Contexte): string {
    return chemin.startsWith(PREFIXE_PERSONNEL) ? path.dirname(absolu) : ctx.temp;
  }

  private static async ecrireJournal(ctx: Contexte, manifeste: ManifesteBanc): Promise<void> {
    await ecrireSur(ctx.manifeste, Buffer.from(JSON.stringify(manifeste, null, 2), 'utf8'), { dossierTemp: ctx.temp });
  }

  private static sources(rootPath: string, outils: readonly string[]): Map<string, string> {
    const sources = new Map<string, string>();
    for (const outil of outils) {
      const base = path.join(rootPath, 'test', 'scenarios', outil);
      for (const rel of listerFichiers(base)) {
        sources.set(rel, path.join(base, ...rel.split('/')));
      }
    }
    return sources;
  }

  private static sourceDoublon(rootPath: string): string {
    return path.join(rootPath, 'test', 'scenarios', 'antigravity', '.agents', ...DOUBLON_GLOBAL.split('/'));
  }

  private static planifierCopies(
    ctx: Contexte,
    target: ScenarioTarget
  ): { elements: ElementDeploiement[]; dossiersACreer: string[]; avertissements: string[] } {
    const outils = target === 'all' ? OUTILS : [target];
    const avertissements: string[] = [];
    const destinations: Array<{ chemin: string; absolu: string; source: string }> = [];
    for (const [rel, source] of this.sources(ctx.racine, outils)) {
      destinations.push({ chemin: rel, absolu: this.resoudre(rel, ctx), source });
    }

    // Scénario doublon global vs local, injecté par « ⚡ Tous »
    if (target === 'all' && fs.existsSync(this.sourceDoublon(ctx.racine))) {
      if (ctx.profilNote) {
        const chemin = `${ctx.profilNote}/${DOUBLON_GLOBAL}`;
        destinations.push({ chemin, absolu: this.resoudre(chemin, ctx), source: this.sourceDoublon(ctx.racine) });
      } else {
        avertissements.push(
          'Le profil global d\'Antigravity n\'est pas dans le dossier personnel : la règle rule-test-doublon n\'y est pas déployée.'
        );
      }
    }

    const problemes: string[] = [];
    const elements: ElementDeploiement[] = [];
    for (const destination of destinations) {
      const octets = fs.readFileSync(destination.source);
      let stat: fs.Stats | null = null;
      try {
        stat = fs.lstatSync(destination.absolu);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      if (!stat) {
        elements.push({ chemin: destination.chemin, absolu: destination.absolu, octets, statut: 'absent' });
        continue;
      }
      if (stat.isSymbolicLink()) {
        problemes.push(`${destination.chemin} (lien symbolique)`);
        continue;
      }
      if (!stat.isFile()) {
        problemes.push(`${destination.chemin} (n'est pas un fichier)`);
        continue;
      }
      if ((stat.mode & 0o200) === 0) {
        problemes.push(`${destination.chemin} (lecture seule)`);
        continue;
      }
      const actuel = fs.readFileSync(destination.absolu);
      if (actuel.equals(octets)) {
        elements.push({ chemin: destination.chemin, absolu: destination.absolu, octets, statut: 'identique' });
        continue;
      }
      // La casse réelle du nom est conservée : un vrai « claude.md » revient sous ce nom
      const dossierNote = destination.chemin.includes('/') ? destination.chemin.slice(0, destination.chemin.lastIndexOf('/') + 1) : '';
      elements.push({
        chemin: destination.chemin,
        absolu: destination.absolu,
        octets,
        statut: 'original',
        original: {
          octets: actuel,
          empreinte: empreinte(actuel),
          date: stat.mtime.toISOString(),
          chemin: `${dossierNote}${nomReel(destination.absolu)}`,
        },
      });
    }
    if (problemes.length > 0) {
      throw new BancEssaiRefus(
        'destination-invalide',
        `${problemes.length} destination(s) ne peuvent pas être sauvegardées puis remplacées sans risque.`,
        problemes
      );
    }

    // Dossiers que le déploiement va créer : seuls ceux-là seront retirés au vidage
    const dossiers = new Set<string>();
    for (const element of elements) {
      const zonePersonnelle = element.chemin.startsWith(PREFIXE_PERSONNEL);
      const borne = zonePersonnelle ? ctx.personnel : ctx.racine;
      let dossier = path.dirname(element.absolu);
      while (!fs.existsSync(dossier)) {
        const rel = relatifSous(borne, dossier);
        if (!rel) break;
        dossiers.add(zonePersonnelle ? `${PREFIXE_PERSONNEL}${rel}` : rel);
        dossier = path.dirname(dossier);
      }
    }

    return { elements, dossiersACreer: [...dossiers].sort((a, b) => b.length - a.length), avertissements };
  }

  private static resumer(
    target: ScenarioTarget,
    plan: { elements: ElementDeploiement[]; avertissements: string[] }
  ): PlanDeploiement {
    return {
      cible: target,
      aSauvegarder: plan.elements.filter((e) => e.statut === 'original').map((e) => e.chemin),
      identiques: plan.elements.filter((e) => e.statut === 'identique').map((e) => e.chemin),
      nbFixtures: plan.elements.length,
      avertissements: plan.avertissements,
    };
  }

  /**
   * Contenu attendu à chaque chemin de fixture : l'empreinte exacte du manifeste pour une fixture
   * déployée, sinon la source sous test/scenarios/. Sert au vidage comme à la reconnaissance.
   */
  private static fixturesAttendues(
    ctx: Contexte,
    journal: LectureManifeste
  ): { attendus: Map<string, Attendu>; profilNote: string | null; signales: string[] } {
    const v2 = journal.type === 'v2' ? journal.manifeste : null;
    const signales: string[] = [];
    // Profil global du déploiement (manifeste), s'il est admis : celui du réglage courant, ou le
    // profil par défaut qu'utilisent les scripts npm. Un autre profil n'est jamais pris du manifeste.
    const profilsAdmis = new Set([ctx.profilNote, PROFIL_PAR_DEFAUT].filter((p): p is string => !!p).map(cle));
    const profilNote = !v2
      ? ctx.profilNote
      : v2.profilGlobal === null
        ? null
        : profilsAdmis.has(cle(v2.profilGlobal))
          ? v2.profilGlobal
          : ctx.profilNote;

    const attendus = new Map<string, Attendu>();
    for (const [rel, source] of this.sources(ctx.racine, OUTILS)) {
      attendus.set(cle(rel), { chemin: rel, source: fs.readFileSync(source), deploye: false, original: false });
    }
    if (profilNote && fs.existsSync(this.sourceDoublon(ctx.racine))) {
      const chemin = `${profilNote}/${DOUBLON_GLOBAL}`;
      attendus.set(cle(chemin), { chemin, source: fs.readFileSync(this.sourceDoublon(ctx.racine)), deploye: false, original: false });
    }
    if (v2) {
      for (const fixture of v2.fixtures) {
        // Seuls les chemins de fixture connus sont pris en compte : un manifeste ne désigne pas un fichier quelconque
        if (!attendus.has(cle(fixture.chemin))) {
          signales.push(fixture.chemin);
          continue;
        }
        attendus.set(cle(fixture.chemin), {
          chemin: fixture.chemin,
          exact: { sha256: fixture.sha256, taille: fixture.taille },
          deploye: true,
          original: fixture.original,
        });
      }
    } else if (journal.type === 'herite') {
      for (const fichier of journal.fichiers) {
        if (!attendus.has(cle(fichier)) && fs.existsSync(this.resoudre(fichier, ctx))) signales.push(fichier);
      }
    }
    return { attendus, profilNote, signales };
  }

  private static planifierVidageInterne(ctx: Contexte): PlanVidageInterne {
    const journal = lireManifeste(ctx.manifeste);
    const v2 = journal.type === 'v2' ? journal.manifeste : null;
    const sauvegardePresente = fs.existsSync(ctx.sauvegarde);
    const lectureIndex = sauvegardePresente ? lireIndex(ctx.index) : ({ type: 'absent' } as const);
    if (lectureIndex.type === 'illisible') {
      throw new BancEssaiRefus('sauvegarde-invalide', 'L\'index de la sauvegarde est illisible : rien n\'a été modifié.', [
        `${DOSSIER_SAUVEGARDE}/${FICHIER_INDEX}`,
      ]);
    }

    // 1. Contenu attendu à chaque chemin de fixture
    const { attendus, profilNote, signales } = this.fixturesAttendues(ctx, journal);

    // 2. Originaux sauvegardés : chaque entrée doit viser un chemin de fixture connu
    const entrees = lectureIndex.type === 'ok' ? lectureIndex.index.fichiers : [];
    const horsFixtures = entrees.filter(
      (e) =>
        !attendus.has(cle(e.chemin)) ||
        !(e.copie.startsWith(`${SOUS_DOSSIER_RACINE}/`) || e.copie.startsWith(`${SOUS_DOSSIER_PROFIL}/`))
    );
    if (horsFixtures.length > 0) {
      throw new BancEssaiRefus(
        'sauvegarde-invalide',
        'L\'index de la sauvegarde cite des chemins qui ne sont pas des fixtures : rien n\'a été modifié.',
        horsFixtures.map((e) => e.chemin)
      );
    }
    if (sauvegardePresente && lectureIndex.type === 'absent') {
      this.verifierSauvegardeOrpheline(ctx, profilNote);
    }
    const parIndex = new Map(entrees.map((e) => [cle(e.chemin), e]));

    // 3. Décision pour chaque chemin
    const actions: ActionVidage[] = [];
    const modifiees: string[] = [];
    const copiesInvalides: string[] = [];
    const lire = (absolu: string): Buffer | null | 'dossier' => {
      try {
        return lireSiPresent(absolu);
      } catch {
        return 'dossier';
      }
    };

    for (const attendu of attendus.values()) {
      const estFixture = (octets: Buffer) =>
        attendu.exact
          ? memeEmpreinte(empreinte(octets), attendu.exact)
          : !!attendu.source && memeContenuNormalise(octets, attendu.source);
      const entree = parIndex.get(cle(attendu.chemin));
      const absolu = this.resoudre(entree ? entree.chemin : attendu.chemin, ctx);
      const actuel = lire(absolu);
      if (actuel === 'dossier') {
        signales.push(attendu.chemin);
        continue;
      }

      if (entree) {
        if (actuel && memeEmpreinte(empreinte(actuel), entree)) {
          // Déjà restauré : rien à faire (reprise après interruption)
        } else {
          // Profil global : sans accord, un original n'y est restauré qu'à la place de la fixture
          // déployée, jamais sur un fichier absent (une sauvegarde peut venir du dépôt ouvert)
          const global = entree.chemin.startsWith(PREFIXE_PERSONNEL);
          const modifiee = actuel ? !estFixture(actuel) : global;
          const copie = path.join(ctx.sauvegarde, ...entree.copie.split('/'));
          const octetsCopie = lireSiPresent(copie);
          if (!octetsCopie || !memeEmpreinte(empreinte(octetsCopie), entree)) copiesInvalides.push(entree.chemin);
          actions.push({ type: 'restaurer', chemin: entree.chemin, absolu, modifiee, entree, copie });
          if (modifiee) modifiees.push(entree.chemin);
        }
      } else if (actuel) {
        if (estFixture(actuel)) {
          actions.push({ type: 'supprimer', chemin: attendu.chemin, absolu, modifiee: false });
        } else if (attendu.deploye && attendu.original) {
          // Original déjà restauré, sauvegarde déjà retirée : reprise de la toute dernière étape
        } else if (attendu.deploye) {
          actions.push({ type: 'supprimer', chemin: attendu.chemin, absolu, modifiee: true });
          modifiees.push(attendu.chemin);
        } else {
          signales.push(attendu.chemin);
        }
      }

      // Variante de bascule (.md ↔ .md.disabled) d'une fixture : supprimée si identique à la fixture
      const variante = varianteDeBascule(attendu.chemin);
      if (!attendus.has(cle(variante)) && !parIndex.has(cle(variante))) {
        const octetsVariante = lire(this.resoudre(variante, ctx));
        if (octetsVariante && octetsVariante !== 'dossier' && estFixture(octetsVariante)) {
          actions.push({ type: 'supprimer', chemin: variante, absolu: this.resoudre(variante, ctx), modifiee: false });
        }
      }
    }

    if (copiesInvalides.length > 0) {
      throw new BancEssaiRefus(
        'sauvegarde-invalide',
        `${copiesInvalides.length} copie(s) de la sauvegarde sont absentes ou corrompues : rien n'a été modifié.`,
        copiesInvalides
      );
    }

    // 4. Dossiers à retirer s'ils sont vides, du plus profond au moins profond. Ceux du manifeste
    // ne sont admis que s'ils contiennent un chemin de fixture connu.
    const ancetres = (chemin: string) => {
      const parents: string[] = [];
      for (let d = path.posix.dirname(chemin); d !== '.' && d !== '~'; d = path.posix.dirname(d)) parents.push(d);
      return parents;
    };
    const ancetresConnus = new Set([...attendus.values()].flatMap((a) => ancetres(a.chemin)).map(cle));
    const dossiersNotes = v2
      ? v2.dossiersCrees.filter((d) => ancetresConnus.has(cle(d)))
      : [...this.sources(ctx.racine, OUTILS).keys()].flatMap((rel) =>
          ancetres(rel).filter((d) => d !== '.agents' && d !== '.claude')
        );
    const dossiers = [...new Set(dossiersNotes)]
      .map((d) => this.resoudre(d, ctx))
      .sort((a, b) => b.length - a.length);

    // 5. Fichiers temporaires laissés dans le profil global par une écriture interrompue
    const temporairesGlobaux: string[] = [];
    for (const attendu of attendus.values()) {
      if (!attendu.chemin.startsWith(PREFIXE_PERSONNEL)) continue;
      const absolu = this.resoudre(attendu.chemin, ctx);
      const prefixe = `.${path.basename(absolu)}.`;
      try {
        for (const nom of fs.readdirSync(path.dirname(absolu))) {
          if (nom.startsWith(prefixe) && nom.endsWith(SUFFIXE_TEMP)) temporairesGlobaux.push(path.join(path.dirname(absolu), nom));
        }
      } catch {
        // Dossier absent
      }
    }

    return {
      aSupprimer: actions.filter((a) => a.type === 'supprimer').map((a) => a.chemin),
      aRestaurer: actions.filter((a) => a.type === 'restaurer').map((a) => a.chemin),
      modifiees,
      signales,
      actions,
      verifications: entrees,
      dossiers,
      temporairesGlobaux,
      journal,
      sauvegardePresente,
    };
  }

  /**
   * Sauvegarde sans index : le déploiement s'est arrêté pendant la copie des originaux, avant
   * toute modification. Elle n'est retirée que si chaque original est encore intact.
   */
  private static verifierSauvegardeOrpheline(ctx: Contexte, profilNote: string | null): void {
    const differents: string[] = [];
    for (const [sousDossier, prefixe] of [
      [SOUS_DOSSIER_RACINE, ''],
      [SOUS_DOSSIER_PROFIL, profilNote ? `${profilNote}/` : null],
    ] as const) {
      for (const rel of listerFichiers(path.join(ctx.sauvegarde, sousDossier))) {
        const chemin = cheminDepuisSauvegarde(rel);
        const copie = lireSiPresent(path.join(ctx.sauvegarde, sousDossier, ...rel.split('/')));
        if (chemin === null || prefixe === null || !copie) {
          differents.push(`${sousDossier}/${rel}`);
          continue;
        }
        const actuel = lireSiPresent(this.resoudre(`${prefixe}${chemin}`, ctx));
        if (!actuel || !actuel.equals(copie)) differents.push(`${prefixe}${chemin}`);
      }
    }
    if (differents.length > 0) {
      throw new BancEssaiRefus(
        'sauvegarde-invalide',
        'La sauvegarde n\'a pas d\'index et ses copies diffèrent des fichiers en place : rien n\'a été modifié.',
        differents
      );
    }
  }
}
