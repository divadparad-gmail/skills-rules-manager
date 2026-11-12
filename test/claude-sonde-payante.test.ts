import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe } from 'node:test';

// Partie payante de la sonde Claude Code (lot I3) : fonctions pures, compteurs et retrait sur un dossier
// temporaire, et le mode --a-sec dans un processus Node dont child_process est espionné. Aucun lancement
// de claude. Toutes les données de flux sont synthétiques.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('node:fs') as typeof import('node:fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'test', 'scenarios', 'scripts');
const SUITE = path.join(ROOT, 'test', 'scenarios', 'claude-code-injection-contexte');
const LANCEUR = path.join(SCRIPTS, 'sonde-claude-code.js');
const S = require(LANCEUR);
const P = require(path.join(SCRIPTS, 'sonde-claude-code-payant.js'));
const C = require(path.join(SCRIPTS, 'sonde-claude-code-commun.js'));

const ESPACE_W = 'C:\\canari-claude-code\\espace';
const PROJET_W = `${ESPACE_W}\\projet`;
const CONFIG_W = 'C:\\Users\\exemple-compte\\AppData\\Local\\canari-claude-code\\config';
const HOME_W = 'C:\\Users\\exemple-compte';
const REGLAGES_W = `${ESPACE_W}\\sonde\\reglages-declencheurs.json`;
const OPTS_W = { espace: ESPACE_W, plateforme: 'win32' };

const tmp = (prefixe: string) => fs.mkdtempSync(path.join(os.tmpdir(), `canari-i3-${prefixe}-`));
const supprimer = (d: string) => fs.rmSync(d, { recursive: true, force: true });
const TEXTE_SONDE = fs.readFileSync(path.join(SUITE, 'SONDE.md'), 'utf8');
const INVITES: Map<string, string> = P.verifierInvites(TEXTE_SONDE);
const ENVOYABLES: Map<string, string> = P.invitesEnvoyables(INVITES);
const CANARIS: string[] = [...C.lireInventaire(fs.readFileSync(path.join(SUITE, 'inventaire.json'), 'utf8')).values()].flatMap((v: any) => v.canaris);
const etape = (id: string) => P.planPayant().find((e: any) => e.id === id && e.type === 'modele');
const argvDe = (e: any, extra: Record<string, unknown> = {}) => S.argumentsAppel({
  prompt: INVITES.get(e.invite), outils: e.outils, toursMax: e.toursMax, declencheur: e.declencheur,
  settings: e.declencheur ? REGLAGES_W : undefined, autorisation: e.autorisation, ...extra,
});
const remplacer = (argv: string[], option: string, valeur: string) => argv.map((a, i) => (argv[i - 1] === option ? valeur : a));
const ligne = (o: object) => JSON.stringify(o);

describe('Suite de Tests : Partie payante de la sonde Claude Code (lot I3, sans lancer claude)', () => {
  test('1. Options : refus sans --confirmer, --plafond obligatoire, --a-sec exclusif, options inconnues', async () => {
    for (const [args, motif] of [
      [[], /sans --confirmer/],
      [['--plafond', '38'], /sans --confirmer/],
      [['--confirmer'], /--plafond <n> est obligatoire/],
      [['--a-sec', '--confirmer'], /--a-sec ne lance rien/],
      [['--a-sec', '--resultats'], /--a-sec ne lance rien/],
      [['--confirmer', '--plafond', '38', '--force'], /option inconnue/],
      [['--confirmer', '--confirmer', '--plafond', '3'], /option répétée/],
      [['--confirmer', '--plafond', 'x'], /nombre entier/],
      [['--confirmer', '--plafond', '3', '--series', '6'], /--series/],
      [['--confirmer', '--plafond', '3', '--series', '1;2'], /--series/],
    ] as [string[], RegExp][]) {
      assert.throws(() => P.lireOptionsPayant(args), (e: Error) => e instanceof S.Refus && motif.test(e.message), args.join(' '));
    }
    assert.deepStrictEqual(P.lireOptionsPayant(['--confirmer', '--plafond', '38']), { confirmer: true, aSec: false, resultats: false, plafond: 38, series: null });
    assert.deepStrictEqual(P.lireOptionsPayant(['--a-sec', '--series', '3,1,3']).series, [1, 3]);
    // Par la commande : refus (code 2) avant tout geste, sans lire auth status
    const erreurs = console.error;
    console.error = () => undefined;
    try {
      assert.strictEqual(await S.principal(['payant']), 2);
      assert.strictEqual(await S.principal(['payant', '--confirmer']), 2);
      assert.strictEqual(await S.principal(['payant', '--confirmer', '--plafond', '41']), 2);
    } finally {
      console.error = erreurs;
    }
  });

  test('2. Plafond : 40 au plus, plafond demandé plus bas respecté, compteur persistant entre les exécutions', () => {
    for (const v of ['0', '41', '400']) assert.throws(() => P.lireOptionsPayant(['--confirmer', '--plafond', v]), /plafond refusé/, v);
    assert.strictEqual(P.lireOptionsPayant(['--confirmer', '--plafond', '40']).plafond, 40);
    const brut = tmp('plafond');
    try {
      P.verifierBudget(brut, 'modele', 'E2', 38, 40);
      assert.throws(() => P.verifierBudget(brut, 'modele', 'E2', 38, 37), S.Refus);
      for (let i = 1; i <= 5; i++) assert.strictEqual(P.reserver(brut, 'modele', 'E2'), i);
      assert.throws(() => P.verifierBudget(brut, 'modele', 'E2', 36, 40), /5 appel\(s\) au modèle déjà utilisé\(s\), 36 prévu\(s\), limite de 40/);
      P.verifierBudget(brut, 'modele', 'E2', 35, 40);
      assert.throws(() => P.verifierBudget(brut, 'modele', 'E2', 35, 39), S.Refus, 'le plafond demandé abaisse la limite');
      const f = path.join(brut, P.COMPTEURS.modele.fichier);
      fs.writeFileSync(f, JSON.stringify({ lot: 'E2', plafond: 400, utilises: 0, series_rejetees: 0 }));
      assert.throws(() => P.lireCompteur(brut, 'modele', 'E2'), S.Arret, 'plafond figé dans le fichier');
      fs.writeFileSync(f, JSON.stringify({ lot: 'E2', plafond: 40, utilises: 39, series_rejetees: 0 }));
      assert.strictEqual(P.reserver(brut, 'modele', 'E2'), 40);
      assert.throws(() => P.reserver(brut, 'modele', 'E2'), S.Arret);
      assert.throws(() => P.lireCompteur(brut, 'modele', 'E1'), S.Refus, 'aucun appel au modèle en E1');
    } finally {
      supprimer(brut);
    }
  });

  test('3. Compteur du modèle distinct de celui de /context, ARRET partagé, deuxième série rejetée', () => {
    const brut = tmp('compteurs');
    try {
      assert.strictEqual(P.reserver(brut, 'context', 'E2'), 1);
      assert.strictEqual(P.reserver(brut, 'context', 'E2'), 2);
      assert.strictEqual(P.reserver(brut, 'modele', 'E2'), 1);
      assert.notStrictEqual(P.COMPTEURS.context.fichier, P.COMPTEURS.modele.fichier);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(brut, 'compteur-context.json'), 'utf8')), { lot: 'E2', plafond: 40, utilises: 2 });
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(brut, 'compteur-modele.json'), 'utf8')), { lot: 'E2', plafond: 40, utilises: 1, series_rejetees: 0 });
      assert.strictEqual(P.noterSerieRejetee(brut), 1);
      assert.strictEqual(P.noterSerieRejetee(brut), P.MAX_SERIES_REJETEES);

      // lancerClaude refuse un appel au modèle sans garde de flux ou sans lot, puis tout appel après ARRET
      const env = S.environnementNettoye({ PATH: 'p' }, CONFIG_W);
      const argv = argvDe(etape('U1'));
      const appel = (extra: Record<string, unknown>) => () => S.lancerClaude({ exe: path.join(brut, 'inexistant.exe'), argv, env, cwd: brut, espace: ESPACE_W, configDir: CONFIG_W, dossierBrut: brut, plateforme: 'win32', invites: ENVOYABLES, ...extra });
      assert.throws(appel({ lot: 'E2' }), /sans garde de flux/);
      assert.throws(appel({ garde: () => null }), /lot du compteur absent/);
      S.ecrireArret(brut, 'essai');
      assert.throws(appel({ lot: 'E2', garde: () => null }), S.Arret);
      assert.throws(() => S.lancerClaude({ exe: 'x', argv: ['--version'], env, cwd: brut, espace: ESPACE_W, configDir: CONFIG_W, dossierBrut: brut, plateforme: 'win32' }), S.Arret);
      assert.strictEqual(P.lireCompteur(brut, 'modele', 'E2').utilises, 1, 'aucun appel compté après les refus');
      assert.strictEqual(P.lireCompteur(brut, 'context', 'E2').utilises, 2);
    } finally {
      supprimer(brut);
    }
  });

  test('4. Changement de lot : le compteur est archivé dans brut/, jamais remis à zéro, et un lot archivé ne se rouvre pas', () => {
    const brut = tmp('lots');
    try {
      const f = path.join(brut, 'compteur-context.json');
      fs.writeFileSync(f, JSON.stringify({ lot: 'I2', plafond: 50, utilises: 26 }));
      assert.throws(() => P.lireCompteur(brut, 'context', 'E1'), S.Arret, 'pas de remise à zéro silencieuse');
      const r = P.ouvrirLot(brut, 'context', 'E1');
      assert.deepStrictEqual([r.archive, r.ancien.utilises], ['compteur-context-I2.json', 26]);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(brut, 'compteur-context-I2.json'), 'utf8')), { lot: 'I2', plafond: 50, utilises: 26 });
      assert.ok(!fs.existsSync(f));
      assert.strictEqual(P.reserver(brut, 'context', 'E1'), 1);
      assert.strictEqual(P.ouvrirLot(brut, 'context', 'E1'), null, 'même lot : rien n\'est archivé');
      assert.strictEqual(P.ouvrirLot(brut, 'context', 'E2').archive, 'compteur-context-E1.json');
      assert.throws(() => P.ouvrirLot(brut, 'context', 'E1'), /archivé/);
      assert.throws(() => P.lireCompteur(brut, 'context', 'E1'), /ne peut pas être rouvert/);
      // Une archive existante n'est jamais écrasée
      fs.writeFileSync(path.join(brut, 'compteur-modele.json'), JSON.stringify({ lot: 'E1', plafond: 40, utilises: 3, series_rejetees: 0 }));
      fs.writeFileSync(path.join(brut, 'compteur-modele-E1.json'), 'archive');
      assert.throws(() => P.ouvrirLot(brut, 'modele', 'E2'), /existe déjà/);
      assert.strictEqual(fs.readFileSync(path.join(brut, 'compteur-modele-E1.json'), 'utf8'), 'archive');
      // La commande context exige --lot ; les modes H14 qui lancent /context exigent --lot E3
      assert.throws(() => S.lireOptions([]), /--lot <E1\|E2\|V1\|E3\|E4\|E5> est obligatoire/);
      assert.throws(() => S.lireOptions(['--lot', 'I2']), S.Refus);
      assert.strictEqual(S.lireOptions(['--lot', 'E1']).lot, 'E1');
      assert.throws(() => S.lireOptions(['--preparer-h14', '--lot', 'E1']), /--preparer-h14/);
      assert.throws(() => S.lireOptions(['--preparer-h14']), /--preparer-h14 exige --lot E3/);
      assert.strictEqual(S.lireOptions(['--lot', 'E3', '--preparer-h14']).preparerH14, true);
    } finally {
      supprimer(brut);
    }
  });

  test('4c. Lot V1 (vérification de version) : accepté, plafond de 60, compteur propre, E1 archivé sans réouverture, payant refusé', async () => {
    const brut = tmp('v1');
    const f = path.join(brut, 'compteur-context.json');
    const journal: string[] = [];
    const log = console.log;
    const erreurs = console.error;
    try {
      // Accepté par --lot, plafond de 60 (relevé de 30 le 2026-11-10), aucun compteur du modèle
      assert.deepStrictEqual(S.LOTS_CONTEXT, ['E1', 'E2', 'V1', 'E3', 'E4', 'E5']);
      assert.strictEqual(S.lireOptions(['--lot', 'V1', '--resultats']).lot, 'V1');
      assert.strictEqual(P.COMPTEURS.context.plafonds.V1, 60);
      assert.deepStrictEqual(P.LOTS_CONTEXT_SEUL, ['V1', 'E3', 'E4', 'E5']);
      assert.ok(!Object.prototype.hasOwnProperty.call(P.COMPTEURS.modele.plafonds, 'V1'));

      // Le compteur E1 (52 sur 60, relevé) est archivé à l'ouverture de V1, annoncé, sans remise à zéro
      const e1 = { lot: 'E1', plafond: 60, utilises: 52, historique_plafond: [{ ancien: 50, nouveau: 60, date: '2026-11-09', motif: P.RELEVEMENTS_PLAFOND.context.E1.motif }] };
      fs.writeFileSync(f, JSON.stringify(e1));
      console.log = (m: string) => journal.push(m);
      const r = S.ouvrirLotAnnonce(brut, 'context', 'V1');
      console.log = log;
      assert.deepStrictEqual([r.archive, r.ancien.utilises], ['compteur-context-E1.json', 52]);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(brut, 'compteur-context-E1.json'), 'utf8')), e1, 'archive identique au compteur E1');
      assert.ok(journal.some((m) => /Compteur context du lot E1 \(52 sur 60\) archivé sous brut\/compteur-context-E1\.json ; lot V1 ouvert/.test(m)), journal.join('\n'));
      assert.ok(!fs.existsSync(f), 'aucun compteur V1 avant le premier lancement');
      assert.throws(() => P.ouvrirLot(brut, 'context', 'E1'), /archivé/, 'E1 ne se rouvre pas');
      assert.throws(() => P.lireCompteur(brut, 'context', 'E1'), /ne peut pas être rouvert/);
      assert.strictEqual(S.ouvrirLotAnnonce(brut, 'context', 'V1'), null, 'même lot : rien n\'est archivé');

      // Compteur propre, plafond de 60 : deux séries complètes (26) passent, une troisième est refusée avant tout appel
      assert.deepStrictEqual(P.lireCompteur(brut, 'context', 'V1'), { lot: 'V1', plafond: 60, utilises: 0 });
      const serie = S.BASES.length * 2 + S.COMBINAISONS.length;
      assert.strictEqual(serie, 26);
      S.verifierBudget(brut, serie, 'V1');
      assert.throws(() => S.verifierBudget(brut, 61, 'V1'), /limite de 60 pour le lot V1/);
      for (let i = 1; i <= 2 * serie; i++) assert.strictEqual(S.reserverContext(brut, 'V1'), i);
      assert.throws(() => S.verifierBudget(brut, serie, 'V1'), /52 \/context déjà utilisé\(s\), 26 prévu\(s\), limite de 60 pour le lot V1/);
      S.verifierBudget(brut, 8, 'V1');
      fs.writeFileSync(f, JSON.stringify({ lot: 'V1', plafond: 60, utilises: 59 }));
      assert.strictEqual(S.reserverContext(brut, 'V1'), 60);
      assert.throws(() => S.reserverContext(brut, 'V1'), (e: Error) => e instanceof S.Arret && /plafond de 60/.test(e.message));
      fs.writeFileSync(f, JSON.stringify({ lot: 'V1', plafond: 90, utilises: 0 }));
      assert.throws(() => P.lireCompteur(brut, 'context', 'V1'), S.Arret, 'un plafond V1 modifié à la main est refusé');
      assert.strictEqual(P.releverPlafond(brut, 'context', 'V1'), null);

      // Relèvement de V1 de 30 à 60 (décision du 2026-11-10) : les 26 utilisés sont conservés, une seule fois
      const traceV1 = [{ ancien: 30, nouveau: 60, date: '2026-11-10', motif: P.RELEVEMENTS_PLAFOND.context.V1.motif }];
      assert.match(traceV1[0].motif, /cache de Claude Code hors des zones de la sonde/);
      fs.writeFileSync(f, JSON.stringify({ lot: 'V1', plafond: 30, utilises: 26 }));
      assert.throws(() => P.lireCompteur(brut, 'context', 'V1'), S.Arret, 'le compteur à 30 est refusé tel quel');
      journal.length = 0;
      console.log = (m: string) => journal.push(m);
      assert.strictEqual(S.ouvrirLotAnnonce(brut, 'context', 'V1'), null, 'même lot : rien n\'est archivé');
      console.log = log;
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { lot: 'V1', plafond: 60, utilises: 26, historique_plafond: traceV1 });
      assert.ok(journal.some((m) => /lot V1 relevé de 30 à 60 \(décision du 2026-11-10\) ; 26 utilisé\(s\) conservé\(s\)/.test(m)), journal.join('\n'));
      assert.strictEqual(P.releverPlafond(brut, 'context', 'V1'), null, 'une seule fois');
      S.verifierBudget(brut, serie, 'V1');
      assert.throws(() => S.verifierBudget(brut, 35, 'V1'), /26 \/context déjà utilisé\(s\), 35 prévu\(s\), limite de 60/);
      assert.strictEqual(S.reserverContext(brut, 'V1'), 27);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')).historique_plafond, traceV1, 'la trace survit à une réservation');
      assert.strictEqual(P.releverPlafond(brut, 'context', 'V1'), null);

      // Partie payante refusée sous V1 : options, compteur du modèle et lancement
      fs.writeFileSync(f, JSON.stringify({ lot: 'V1', plafond: 60, utilises: 3 }));
      for (const args of [['--confirmer', '--plafond', '38', '--lot', 'V1'], ['--a-sec', '--lot', 'V1'], ['--lot', 'V1']]) {
        assert.throws(() => P.lireOptionsPayant(args), (e: Error) => e instanceof S.Refus && /le lot V1 \(vérification de version\) n'accepte que \/context : toute commande payante y est refusée/.test(e.message), args.join(' '));
      }
      assert.throws(() => P.lireOptionsPayant(['--confirmer', '--plafond', '38', '--lot', 'E2']), /tourne toujours sous le lot E2/);
      for (const geste of [() => P.lireCompteur(brut, 'modele', 'V1'), () => P.verifierBudget(brut, 'modele', 'V1', 1), () => P.reserver(brut, 'modele', 'V1')]) {
        assert.throws(geste, (e: Error) => e instanceof S.Refus && /n'accepte que \/context/.test(e.message));
      }
      assert.ok(!fs.existsSync(path.join(brut, 'compteur-modele.json')), 'aucun compteur du modèle écrit');
      const env = S.environnementNettoye({ PATH: 'p' }, CONFIG_W);
      const argv = argvDe(etape('U1'));
      assert.throws(
        () => S.lancerClaude({ exe: path.join(brut, 'inexistant.exe'), argv, env, cwd: brut, espace: ESPACE_W, configDir: CONFIG_W, dossierBrut: brut, plateforme: 'win32', lot: 'V1', invites: ENVOYABLES, garde: () => null }),
        (e: Error) => e instanceof S.Refus && /lot V1 .*appel au modèle refusé/.test(e.message),
      );
      assert.strictEqual(P.lireCompteur(brut, 'context', 'V1').utilises, 3, 'aucun lancement compté');
      // Par la commande : code 2, avant tout geste
      console.error = () => undefined;
      assert.strictEqual(await S.principal(['payant', '--confirmer', '--plafond', '38', '--lot', 'V1']), 2);
    } finally {
      console.log = log;
      console.error = erreurs;
      supprimer(brut);
    }
  });

  test('4b. Relèvement du plafond E1 de 50 à 60 : utilisés gardés, trace écrite, une seule fois, aucun autre lot', () => {
    const brut = tmp('releve');
    const f = path.join(brut, 'compteur-context.json');
    const lire = () => JSON.parse(fs.readFileSync(f, 'utf8'));
    const trace = [{ ancien: 50, nouveau: 60, date: '2026-11-09', motif: P.RELEVEMENTS_PLAFOND.context.E1.motif }];
    const journal: string[] = [];
    const log = console.log;
    try {
      assert.deepStrictEqual(Object.keys(P.RELEVEMENTS_PLAFOND), ['context']);
      assert.deepStrictEqual(Object.keys(P.RELEVEMENTS_PLAFOND.context), ['E1', 'V1'], 'un relèvement par lot au plus : E1, puis V1 (2026-11-10)');
      assert.deepStrictEqual([P.COMPTEURS.context.plafonds.E1, P.COMPTEURS.context.plafonds.E2], [60, 40]);

      // Le compteur E1 figé à 50 est refusé tel quel, puis relevé à l'ouverture du lot
      fs.writeFileSync(f, JSON.stringify({ lot: 'E1', plafond: 50, utilises: 26 }));
      assert.throws(() => P.lireCompteur(brut, 'context', 'E1'), S.Arret);
      console.log = (m: string) => journal.push(m);
      assert.strictEqual(S.ouvrirLotAnnonce(brut, 'context', 'E1'), null, 'même lot : rien n\'est archivé');
      console.log = log;
      assert.deepStrictEqual(lire(), { lot: 'E1', plafond: 60, utilises: 26, historique_plafond: trace });
      assert.ok(journal.some((m) => /relevé de 50 à 60 .*26 utilisé\(s\) conservé\(s\)/.test(m)), journal.join('\n'));
      assert.deepStrictEqual(P.lireCompteur(brut, 'context', 'E1'), lire());
      assert.strictEqual(P.reserver(brut, 'context', 'E1'), 27);
      assert.deepStrictEqual(lire().historique_plafond, trace, 'la trace survit à une réservation');
      // Une seule fois : le compteur relevé n'est plus relevable
      assert.strictEqual(P.releverPlafond(brut, 'context', 'E1'), null);
      assert.strictEqual(lire().utilises, 27);
      // --plafond n'abaisse que la limite de l'exécution
      assert.throws(() => P.verifierBudget(brut, 'context', 'E1', 4, 30), /limite de 30/);
      assert.strictEqual(P.verifierBudget(brut, 'context', 'E1', 33, 100).plafond, 60);
      assert.throws(() => P.verifierBudget(brut, 'context', 'E1', 34, 100), /limite de 60/);
      // Une trace forgée ou un autre plafond de départ sont refusés, sans réécriture
      fs.writeFileSync(f, JSON.stringify({ lot: 'E1', plafond: 60, utilises: 26, historique_plafond: [{ ...trace[0], motif: 'autre' }] }));
      assert.throws(() => P.lireCompteur(brut, 'context', 'E1'), S.Arret);
      for (const c of [{ lot: 'E1', plafond: 45, utilises: 3 }, { lot: 'E1', plafond: 50, utilises: 3, historique_plafond: trace }, { lot: 'E1', plafond: 50, utilises: 51 }]) {
        fs.writeFileSync(f, JSON.stringify(c));
        assert.strictEqual(P.releverPlafond(brut, 'context', 'E1'), null, JSON.stringify(c));
        assert.deepStrictEqual(lire(), c);
      }

      // Aucun autre lot ne peut être relevé de la même façon
      for (const c of [{ lot: 'E2', plafond: 30, utilises: 5 }, { lot: 'E2', plafond: 50, utilises: 5 }]) {
        fs.writeFileSync(f, JSON.stringify(c));
        assert.strictEqual(P.releverPlafond(brut, 'context', 'E2'), null);
        assert.throws(() => P.lireCompteur(brut, 'context', 'E2'), S.Arret);
        assert.deepStrictEqual(lire(), c);
      }
      fs.writeFileSync(f, JSON.stringify({ lot: 'I2', plafond: 50, utilises: 26 }));
      assert.strictEqual(P.releverPlafond(brut, 'context', 'E1'), null, 'un compteur d\'un autre lot n\'est pas relevé');
      assert.deepStrictEqual(lire(), { lot: 'I2', plafond: 50, utilises: 26 });
      assert.throws(() => P.releverPlafond(brut, 'context', 'I2'), S.Refus);
      const m = path.join(brut, 'compteur-modele.json');
      fs.writeFileSync(m, JSON.stringify({ lot: 'E2', plafond: 30, utilises: 1, series_rejetees: 0 }));
      assert.strictEqual(P.releverPlafond(brut, 'modele', 'E2'), null);
      assert.throws(() => P.lireCompteur(brut, 'modele', 'E2'), S.Arret);
    } finally {
      console.log = log;
      supprimer(brut);
    }
  });

  test('5. SONDE.md : douze invites, une section et un bloc chacune, empreintes égales à EMPREINTES_INVITES', () => {
    assert.deepStrictEqual([...INVITES.keys()].sort(), Object.keys(P.EMPREINTES_INVITES).sort());
    assert.strictEqual(INVITES.size, 12);
    for (const [id, texte] of INVITES) assert.strictEqual(P.sha256(texte), P.EMPREINTES_INVITES[id], id);
    assert.deepStrictEqual([...ENVOYABLES.values()].sort(), Object.keys(P.EMPREINTES_INVITES).filter((id) => id !== 'h14-panneau').sort());
    const bloc = (id: string, t: string) => `### ${id}\n\n\`\`\`text\n${t}\n\`\`\`\n`;
    assert.deepStrictEqual([...P.lireSonde(`# T\n${bloc('a', 'x')}${bloc('b', 'y')}`)], [['a', 'x'], ['b', 'y']]);
    for (const [texte, motif] of [
      [`${bloc('a', 'x')}${bloc('a', 'y')}`, /deux fois/],
      [`### a\n\`\`\`text\nx\n\`\`\`\n\`\`\`text\ny\n\`\`\`\n`, /plus d'un bloc/],
      ['### a\n```text\nx\n', /non fermé/],
      [`### a\n\n### b\n\`\`\`text\ny\n\`\`\`\n`, /sans bloc/],
      ['```text\nx\n```\n', /hors de toute section/],
      [`### A_maj\n\`\`\`text\nx\n\`\`\`\n`, /identifiant invalide/],
    ] as [string, RegExp][]) {
      assert.throws(() => P.lireSonde(texte), motif, texte);
    }
  });

  test('6. Invite hors de SONDE.md ou à l\'empreinte modifiée : refusée', () => {
    const argv = argvDe(etape('U1'));
    assert.strictEqual(S.verifierArgv(argv, { ...OPTS_W, invites: ENVOYABLES }), 'modele');
    assert.strictEqual(S.verifierArgv(remplacer(argv, '-p', '/context'), { ...OPTS_W, invites: ENVOYABLES }), 'context');
    for (const autre of ['Réponds seulement : OK', `${INVITES.get('usage-ok')} `, INVITES.get('h14-panneau') as string, '']) {
      assert.throws(() => S.verifierArgv(remplacer(argv, '-p', autre), { ...OPTS_W, invites: ENVOYABLES }), S.RefusArgv, autre);
    }
    assert.throws(() => S.verifierArgv(argv, OPTS_W), S.RefusArgv, 'sans table des invites, seul /context passe');
    // Une invite modifiée dans SONDE.md sans mise à jour de la constante : SONDE.md entier refusé
    const modifie = TEXTE_SONDE.replace('de valeur true', 'de valeur vraie');
    assert.notStrictEqual(modifie, TEXTE_SONDE);
    assert.throws(() => P.verifierInvites(modifie), /usage-ok : empreinte différente/);
    assert.throws(() => P.verifierInvites(`${TEXTE_SONDE}\n### nouvelle\n\n\`\`\`text\nBonjour\n\`\`\`\n`), /nouvelle : invite inconnue/);
    assert.throws(() => P.verifierInvites(TEXTE_SONDE, { ...P.EMPREINTES_INVITES, absente: '0'.repeat(64) }), /absente : absente de SONDE.md/);
  });

  test('7. Aucune invite ne contient de canari ; une seule ligne, sans guillemet double', () => {
    for (const [id, texte] of INVITES) {
      for (const c of CANARIS) assert.ok(!texte.includes(c), `${id} contient ${c}`);
      assert.doesNotMatch(texte, /CANARI-[A-Za-z0-9]/, id);
      assert.doesNotMatch(texte, /["\r\n]/, id);
      if (id !== 'usage-ok') assert.match(texte, /commencen?t? par CANARI- /, id);
    }
    assert.doesNotMatch(TEXTE_SONDE, /CANARI-[A-Za-z0-9]/, 'SONDE.md entier');
    assert.ok(CANARIS.length > 0 && CANARIS.every((c) => !TEXTE_SONDE.includes(c)));
    assert.strictEqual(new Set(INVITES.values()).size, INVITES.size, 'textes distincts');
  });

  test('8. Déclencheurs : un outil par appel (Read et Edit pour EE), dontAsk, --settings sous l\'espace, autorisations exactes', () => {
    const attendus: Record<string, [string, string | null]> = {
      ER: ['Read', null], EW: ['Write', 'Edit(./**)'], EE: ['Read,Edit', 'Edit(./**)'], EG: ['Glob', null],
      EGr: ['Grep', null], EB: ['Bash', 'Bash(cat *)'], 'ER-sous': ['Read', null], temoin: ['Read', null],
    };
    const serie5 = P.planPayant([5]).filter((e: any) => e.type === 'modele');
    assert.deepStrictEqual(serie5.map((e: any) => e.id), Object.keys(attendus));
    for (const e of serie5) {
      assert.deepStrictEqual([e.outils, e.autorisation], attendus[e.id], e.id);
      assert.deepStrictEqual([e.toursMin, e.toursMax, e.declencheur], [2, 3, true], e.id);
      assert.strictEqual(S.verifierArgv(argvDe(e), { ...OPTS_W, invites: ENVOYABLES }), 'modele', e.id);
    }
    const ew: string[] = argvDe(etape('EW'));
    assert.deepStrictEqual(ew, ['-p', INVITES.get('d-write') as string,'--model', 'claude-opus-5', '--effort', 'high', '--output-format', 'stream-json', '--verbose',
      '--tools', 'Write', '--no-session-persistence', '--strict-mcp-config', '--permission-prompts', 'none', '--max-turns', '3',
      '--permission-mode', 'dontAsk', '--settings', REGLAGES_W, '--allowedTools', 'Edit(./**)']);
    assert.deepStrictEqual(JSON.parse(P.REGLAGES_DECLENCHEURS), { permissions: { blockReadsOutsideWorkingDirectories: true } });
    const refuse = (argv: string[], motif: RegExp, nom: string) => assert.throws(() => S.verifierArgv(argv, { ...OPTS_W, invites: ENVOYABLES }), (err: Error) => err instanceof S.RefusArgv && motif.test(err.message), nom);
    refuse(remplacer(ew, '--permission-mode', 'bypassPermissions'), /valeur refusée/, 'bypassPermissions');
    refuse(remplacer(ew, '--tools', 'Read,Write'), /un seul outil/, 'deux outils');
    refuse(remplacer(ew, '--tools', 'Agent'), /jeu d'outils refusé/, 'Agent');
    refuse(remplacer(ew, '--tools', 'Read,Write,Edit,Glob,Grep,Bash'), /un seul outil/, 'jeu complet');
    refuse(remplacer(ew, '--max-turns', '5'), /--max-turns/, 'cinq tours');
    refuse(remplacer(ew, '--max-turns', '1'), /--max-turns 3 attendu/, 'un tour');
    refuse(remplacer(ew, '--allowedTools', 'Bash(rm *)'), /autorisation refusée/, 'Bash(rm *)');
    refuse(remplacer(ew, '--allowedTools', 'Bash(cat *)'), /autorisation incohérente/, 'cat pour Write');
    refuse(ew.slice(0, -2), /autorisation incohérente/, 'Write sans autorisation');
    refuse([...argvDe(etape('ER')), '--allowedTools', 'Edit(./**)'], /autorisation incohérente/, 'Edit pour Read');
    refuse(ew.filter((a, i) => a !== '--settings' && ew[i - 1] !== '--settings'), /--settings obligatoires/, 'sans --settings');
    // --settings : jamais de JSON dans l'argv, et un chemin sous l'espace seulement (même règle que --mcp-config)
    for (const v of [P.REGLAGES_DECLENCHEURS.trim(), '{"permissions":{}}', `${HOME_W}\\reglages.json`, 'sonde\\reglages-declencheurs.json', ESPACE_W, 'D:\\canari-claude-code\\espace\\r.json']) {
      refuse(remplacer(ew, '--settings', v), /--settings : le chemin doit être sous l'espace/, v);
    }
    // Hors de la série 5 : aucune option de déclencheur, un seul tour
    const u1: string[] = argvDe(etape('U1'));
    refuse([...u1, '--permission-mode', 'dontAsk'], /options de déclencheur refusées/, 'dontAsk en série 1');
    refuse(remplacer(u1, '--max-turns', '3'), /--max-turns 1 attendu/, 'trois tours en série 1');
    refuse(u1.filter((a, i) => a !== '--max-turns' && u1[i - 1] !== '--max-turns'), /obligatoire absente : --max-turns/, 'sans --max-turns');
  });

  test('9. Plan complet : 38 appels au modèle (17, 6, 4, 3, 8), 33 /context, un /context gratuit en tête de chaque série', () => {
    const plan = P.planPayant();
    assert.deepStrictEqual(P.compterPlan(plan), { modele: 38, context: 33, parSerie: { 1: 17, 2: 6, 3: 4, 4: 3, 5: 8 } });
    assert.strictEqual(new Set(plan.map((e: any) => e.id)).size, plan.length, 'identifiants uniques');
    const global = etape('U-global');
    assert.deepStrictEqual([global.serie, global.jeux, global.outils, global.invite], [1, ['cout-f-global'], '', 'usage-ok']);
    for (const n of [1, 2, 3, 4, 5]) {
      const s = plan.filter((e: any) => e.serie === n);
      assert.strictEqual(s[0].type, 'context', `série ${n} : le contrôle du dossier de mémoire précède tout appel au modèle`);
      assert.strictEqual(s[s.length - 1].type, n <= 3 ? 'modele' : 'context', `série ${n} : borne de fin`);
    }
    plan.forEach((e: any, i: number) => {
      if (e.type !== 'modele') return;
      assert.ok(Object.prototype.hasOwnProperty.call(P.EMPREINTES_INVITES, e.invite) && !P.INVITES_MANUELLES.has(e.invite), e.id);
      if (e.mode === 'usage') assert.deepStrictEqual([plan[i - 1].id, plan[i - 1].jeux, plan[i - 1].outils, plan[i - 1].hookEvents], [`ctx:${e.id}`, e.jeux, e.outils, e.hookEvents], e.id);
    });
    assert.strictEqual(P.compterPlan(P.planPayant([4, 5])).modele, 11);
    // Chaque étape se prépare (plans sans collision, empreintes) et passe verifierArgv
    const racine = tmp('plan');
    try {
      const ctx = { configDir: path.join(racine, 'config'), espace: path.join(racine, 'espace'), projet: path.join(racine, 'espace', 'projet'), plateforme: process.platform };
      const rels = S.listerFixtures();
      const inventaire = C.lireInventaire(fs.readFileSync(path.join(SUITE, 'inventaire.json'), 'utf8'));
      for (const e of plan) {
        const prepare = S.preparerEtape(ctx, e, { rels, inventaire, invites: INVITES });
        assert.strictEqual(S.verifierArgv(prepare.argv, { espace: ctx.espace, plateforme: process.platform, invites: ENVOYABLES }), e.type, e.id);
        assert.strictEqual(prepare.argv.includes('--settings'), e.declencheur, e.id);
      }
      assert.ok(!fs.existsSync(ctx.espace), 'la préparation n\'écrit rien');
    } finally {
      supprimer(racine);
    }
  });

  test('10. Usage : entrée, sortie et somme des quatre compteurs, par appel et par tour (dédoublonné par message.id)', () => {
    const u1 = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 5 };
    const u2 = { input_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 1150, output_tokens: 30 };
    const texte = [
      ligne({ type: 'system', subtype: 'init', apiKeySource: 'none', model: 'claude-opus-5' }),
      ligne({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'a' }], usage: u1 } }),
      ligne({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', name: 'Read', input: {} }], usage: u1 } }),
      ligne({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),
      ligne({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: '{}' }], usage: u2 } }),
      '{ cassé',
      ligne({ type: 'result', subtype: 'success', num_turns: 2, total_cost_usd: 0.04, modelUsage: { 'claude-opus-5': {} }, usage: { input_tokens: 30, cache_creation_input_tokens: 100, cache_read_input_tokens: 2150, output_tokens: 35 } }),
    ].join('\r\n');
    const flux = P.lireFluxPayant(texte);
    assert.strictEqual(flux.illisibles, 1);
    assert.deepStrictEqual(P.lireUsage(flux), {
      total: { entree: 2280, sortie: 35, somme4: 2315 },
      par_tour: [{ entree: 1110, sortie: 5, somme4: 1115, delta_entree: null }, { entree: 1170, sortie: 30, somme4: 1200, delta_entree: 60 }],
      num_turns: 2, cout_liste_usd: 0.04, modeles: ['claude-opus-5'],
    });
    assert.deepStrictEqual(P.outilsAppeles(flux), ['Read']);
    assert.strictEqual(P.entreeUsage({ input_tokens: 1, cache_read_input_tokens: 2, output_tokens: 3 }), null, 'un compteur manque');
    // Réponses : seuls les canaris de l'inventaire sont recopiés ; les autres chaînes sont comptées
    const connus = new Set(['CANARI-CC-X-AAAA', 'CANARI-CC-Y-BBBB']);
    assert.deepStrictEqual(P.lireReponse('```json\n{"avant_outil":["CANARI-CC-X-AAAA"],"apres_outil":["CANARI-CC-Y-BBBB","CANARI-INVENTE"]}\n```', etape('ER'), connus),
      { lisible: true, avant_outil: ['CANARI-CC-X-AAAA'], apres_outil: ['CANARI-CC-Y-BBBB'], chaines_inconnues: 1 });
    assert.deepStrictEqual(P.lireReponse('{"ok":true}', etape('U1'), connus), { lisible: true, ok: true });
    const env = P.lireReponse('{"canaris":[{"chaine":"CANARI-CC-X-AAAA","ouverture":"<chemin local>","fermeture":""}]}', etape('4a'), connus);
    assert.deepStrictEqual([env.canaris, env.enveloppes.nombre, env.enveloppes.empreinte.length], [['CANARI-CC-X-AAAA'], 1, 64]);
    assert.ok(!JSON.stringify(env).includes('chemin local'), 'le texte des enveloppes reste dans brut/');
    assert.deepStrictEqual(P.lireReponse('pas de JSON', etape('4b'), connus), { lisible: false });
  });

  test('11. Garde de flux : abonnement et modèle dès l\'initialisation, tours, outil, cible et commande Bash', () => {
    const garde = (id: string) => P.creerGardeFlux(etape(id), { modele: 'claude-opus-5', projet: PROJET_W, plateforme: 'win32' });
    const init = { type: 'system', subtype: 'init', apiKeySource: 'none', model: 'claude-opus-5', permissionMode: 'dontAsk' };
    const outil = (name: string, input: object, id = 'm1') => ({ type: 'assistant', message: { id, content: [{ type: 'tool_use', name, input }] } });
    const verdict = (id: string, obj: object) => garde(id)(obj);
    assert.strictEqual(verdict('ER', init), null);
    assert.strictEqual(verdict('ER', { ...init, apiKeySource: 'ANTHROPIC_API_KEY' }).gravite, 'arret');
    assert.strictEqual(verdict('ER', { ...init, model: 'claude-sonnet-5' }).gravite, 'rejet');
    assert.strictEqual(verdict('ER', { ...init, permissionMode: 'default' }).gravite, 'rejet');
    assert.strictEqual(verdict('U1', { ...init, permissionMode: 'default' }), null, 'hors déclencheur, le mode n\'est pas imposé');
    const permis: [string, string, object][] = [
      ['ER', 'Read', { file_path: `${PROJET_W}\\src\\a.ts` }],
      ['ER', 'Read', { file_path: 'src/a.ts' }],
      ['ER', 'Read', { file_path: 'c:/CANARI-CLAUDE-CODE/espace/projet/src/a.ts' }],
      ['EW', 'Write', { file_path: 'src/c.ts', content: 'x' }],
      ['EE', 'Read', { file_path: 'src/a.ts' }],
      ['EE', 'Edit', { file_path: 'src/a.ts', old_string: 'a = 1', new_string: 'a = 2' }],
      ['EG', 'Glob', { pattern: 'src/**/*.ts' }],
      ['EG', 'Glob', { pattern: '**/*.ts', path: 'src' }],
      ['EGr', 'Grep', { pattern: 'export', path: PROJET_W }],
      ['EB', 'Bash', { command: 'cat src/a.ts' }],
      ['EB', 'Bash', { command: 'cat "src/a.ts"' }],
      ['ER-sous', 'Read', { file_path: 'sous/note.txt' }],
      ['temoin', 'Read', { file_path: 'b.txt' }],
    ];
    for (const [id, name, input] of permis) assert.strictEqual(verdict(id, outil(name, input)), null, `${id} ${name} ${JSON.stringify(input)}`);
    const refuses: [string, string, object][] = [
      ['ER', 'Read', { file_path: `${HOME_W}\\secret-local.txt` }],
      ['ER', 'Read', { file_path: 'src/b.ts' }],
      ['ER', 'Read', {}],
      ['ER', 'Write', { file_path: 'src/a.ts' }],
      ['EW', 'Write', { file_path: '../hors.ts' }],
      ['EE', 'Edit', { file_path: 'src/c.ts' }],
      ['EG', 'Glob', { pattern: '*', path: 'C:\\' }],
      ['EGr', 'Grep', { pattern: 'x', path: HOME_W }],
      ['EB', 'Bash', { command: 'ls' }],
      ['EB', 'Bash', { command: 'head src/a.ts' }],
      ['EB', 'Bash', { command: 'cat src/a.ts; rm -rf x' }],
      ['EB', 'Bash', { command: 'cat src/a.ts > src/b.ts' }],
      ['EB', 'Bash', { command: 'cat $(echo src/a.ts)' }],
      ['EB', 'Bash', { command: `cat ${HOME_W}\\secret-local.txt` }],
      ['EB', 'PowerShell', { command: 'Get-Content src/a.ts' }],
      ['U1', 'Skill', { skill: 'x' }],
      ['4c', 'Skill', { skill: 'canari-p1' }],
    ];
    for (const [id, name, input] of refuses) {
      const v = verdict(id, outil(name, input));
      assert.ok(v && v.gravite === 'rejet', `${id} ${name} ${JSON.stringify(input)}`);
      assert.doesNotMatch(v.raison, /secret-local|exemple-compte|rm -rf/, 'la raison ne recopie rien du flux');
    }
    // Tours : trois au plus en série 5, un seul ailleurs ; un même message.id ne compte qu'une fois
    const g = garde('ER');
    for (const id of ['m1', 'm1', 'm2', 'm3']) assert.strictEqual(g({ type: 'assistant', message: { id, content: [] } }), null);
    assert.match(g({ type: 'assistant', message: { id: 'm4', content: [] } }).raison, /4 tours/);
    const g1 = garde('U1');
    assert.strictEqual(g1({ type: 'assistant', message: { id: 'm1', content: [] } }), null);
    assert.ok(g1({ type: 'assistant', message: { id: 'm2', content: [] } }));
    // Le lanceur applique la garde à chaque ligne et tue l'arbre de processus au premier écart
    const source = fs.readFileSync(LANCEUR, 'utf8');
    const lancer = source.slice(source.indexOf('function lancerClaude('), source.indexOf('function processusFixtureRestants('));
    assert.match(lancer, /const v = garde\(obj\);\s*if \(v\) \{\s*violation = v;\s*arreterArbre\(enfant, plateforme\);/);
    assert.ok(lancer.indexOf("payant.reserver(dossierBrut, 'modele', lot)") < lancer.indexOf('spawn(exe'), 'compteur du modèle incrémenté avant le lancement');
  });

  test('12. Contrôles après un appel au modèle : apiKeySource, tours, résultat ; total_cost_usd relevé sans être un critère', () => {
    const flux = (o: { init?: object | null; result?: object | null; second?: boolean }) => {
      const init = o.init === undefined ? { type: 'system', subtype: 'init', apiKeySource: 'none', model: 'claude-opus-5', claude_code_version: '9.9.9' } : o.init;
      const result = o.result === undefined ? { type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0.05, usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 5000, output_tokens: 9 } } : o.result;
      const f = P.lireFluxPayant([init, result, o.second ? result : null].filter(Boolean).map((x) => JSON.stringify(x)).join('\n'));
      return f;
    };
    const controler = (f: any, id = 'U1', version = '9.9.9') => P.controlerAppelPayant(f, P.lireUsage(f), etape(id), { versionAttendue: version });
    assert.deepStrictEqual(controler(flux({})), { arret: [], autres: [], ok: true }, 'un coût au prix public supérieur à 0 est accepté');
    const base: any = flux({}).result;
    for (const [nom, f] of [
      ['apiKeySource', flux({ init: { type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY' } })],
      ['init absent', flux({ init: null })],
      ['résultat absent', flux({ result: null })],
    ] as [string, any][]) assert.ok(controler(f).arret.length > 0, nom);
    for (const [nom, f, id] of [
      ['deux tours hors déclencheur', flux({ result: { ...base, num_turns: 2 } }), 'U1'],
      ['aucun tour', flux({ result: { ...base, num_turns: 0 } }), 'U1'],
      ['plafond de tours atteint', flux({ result: { ...base, subtype: 'error_max_turns' } }), 'U1'],
      ['erreur', flux({ result: { ...base, is_error: true } }), 'U1'],
      ['deux résultats', flux({ second: true }), 'U1'],
      ['usage incomplet', flux({ result: { ...base, usage: { output_tokens: 1 } } }), 'U1'],
      ['un seul tour pour un déclencheur', flux({}), 'ER'],
      ['quatre tours pour un déclencheur', flux({ result: { ...base, num_turns: 4 } }), 'ER'],
    ] as [string, any, string][]) {
      const c = controler(f, id);
      assert.ok(c.arret.length === 0 && c.autres.length > 0, nom);
    }
    for (const n of [2, 3]) assert.ok(controler(flux({ result: { ...base, num_turns: n } }), 'EE').ok, `${n} tours pour EE`);
    assert.strictEqual(controler(flux({}), 'U1', '1.0.0').autres.length, 1, 'version différente');
  });

  test('13. Décomposition sur des données synthétiques : en-têtes, pente du chemin, préambule, constantes, protocole 4, H15', () => {
    const U0 = 5000;
    const U: Record<string, number> = {
      U0a: U0, U0b: U0, U1: 5114, U2: 5187, U3: 5262, 'U-global': 5123, U4: 5174, U5: 5144, U6: 5176, U7: 5114,
      H1: U0 + 42, H2: U0, M1: U0 + 300, M2: U0 + 400, M3: U0 + 200, 'H15-en': 5104, 'H15-code': 5144,
      S0a: 9000, S0b: 9000, S1: 9030, S2: 9060, S3: 9058, 'S-long': 9500, T0a: 4000, T0b: 4000, T1: 4050, 'T-long': 4100,
    };
    const ctx = { U0a: 3000, U1: 3065, U4: 3125, S0a: 5000, S1: 5029, S3: 5057, 'S-long': 5400, T0a: 3500 };
    const el = { F: 65, F2: 125, parent: 62, projet_claude: 61, global: 65, regle_court: 28, anglais: 55, code: 95, S1: 29, S3: 57 };
    const L = { projet: 40, parent: 30, projet_claude: 50, global: 80, regle_court: 45, regle_long: 65 };
    const o = { F: 30, anglais: 40, code: 45, skill_s1: 29 };
    const d = P.decomposer({ U, ctx, el, L, o });
    assert.deepStrictEqual(
      [d.memoire.contenu_F, d.memoire.entete_parent, d.memoire.entete_projet_claude, d.memoire.entete_par_caractere_de_chemin, d.memoire.entete_fixe_project, d.memoire.entete_projet, d.memoire.preambule, d.memoire.entete_global_user, d.memoire.entete_fixe_user],
      [60, 13, 15, 0.1, 10, 14, 40, 23, 15],
    );
    assert.deepStrictEqual([d.memoire.constante_context, d.memoire.contenu_context, d.memoire.ecart_contenu_usage_context, d.memoire.context_valide], [5, 60, 0, true]);
    assert.deepStrictEqual(d.memoire.enveloppe_hors_context, { U1: 49, U4: 49, parent: 11, projet_claude: 14 });
    assert.deepStrictEqual([d.regles.element_court, d.regles.element_long, d.regles.entete_par_caractere_de_chemin, d.regles.regle_paths, d.regles.regle_paths_nulle], [30, 32, 0.1, 0, true]);
    assert.deepStrictEqual([d.skills.ligne, d.skills.ligne_global, d.skills.chemin_compte, d.skills.constante_context, d.skills.constante_usage, d.skills.context_valide], [30, 30, false, 1, 2, true]);
    assert.deepStrictEqual([d.mcp.instructions, d.mcp.instructions_doubles, d.mcp.constante_instructions, d.mcp.serveur_b_sans_instructions, d.mcp.differe_serveur_a, d.mcp.differe_textes_longs], [100, 200, 0, 200, 50, 100]);
    assert.deepStrictEqual(d.hooks, { sortie: 42, muet: 0, muet_nul: true });
    assert.deepStrictEqual(d.h15.r_usage, { francais: 2, anglais: 1.25, code: 2 });
    assert.deepStrictEqual([d.bases.decalage_vide, d.bases.vide_identiques, d.bases.skill_identiques], [2000, true, true]);
    // Une mesure absente donne null, jamais une erreur ni un faux zéro
    const vide = P.decomposer({});
    assert.deepStrictEqual([vide.memoire.preambule, vide.skills.chemin_compte, vide.hooks.muet_nul, vide.bases.vide_identiques], [null, null, null, null]);
    assert.strictEqual(P.decomposer({ U: { ...U, U4: undefined } }).memoire.preambule, null);
    // Les éléments de /context viennent des combinaisons normalisées
    const combos = [
      { id: 'ctx:U1', total: 3065, memory_files: [{ chemin: '<projet>/CLAUDE.md', tokens: 65 }], skills: [] },
      { id: 'ctx:S1', total: 5029, memory_files: [], skills: [{ name: 'canari-s1', tokens: 29 }] },
    ];
    const e = P.elementsContext(combos);
    assert.deepStrictEqual([e.el.F, e.el.S1, e.el.F2, e.total('ctx:U1'), e.total('ctx:U9')], [65, 29, null, 3065, null]);
    // Longueurs des chemins et o200k des fixtures de mesure (des nombres seulement)
    const racine = tmp('longueurs');
    try {
      const configDir = path.join(racine, 'config');
      const espace = path.join(racine, 'espace');
      const l = P.longueursChemins(S.listerFixtures(), { configDir, espace, fixturesDir: path.join(SUITE, 'fixtures') });
      assert.deepStrictEqual([l.projet, l.parent, l.global], [path.join(espace, 'projet', 'CLAUDE.md').length, path.join(espace, 'CLAUDE.md').length, path.join(configDir, 'CLAUDE.md').length]);
      assert.ok(l.regle_long > l.regle_court);
    } finally {
      supprimer(racine);
    }
    const m = P.o200kMesures((rel: string) => fs.readFileSync(path.join(SUITE, 'fixtures', ...rel.split('/')), 'utf8'));
    assert.ok(Object.values(m).every((v) => typeof v === 'number' && v > 0), JSON.stringify(m));
    assert.ok(Math.abs(m.F2 - 2 * m.F) <= 2, 'F′ = F + F');
    assert.strictEqual(P.ligneSkill('---\nname: canari-x\ndescription: Une description.\n---\nCorps'), '- canari-x: Une description.');
  });

  test('14. --a-sec : 38 appels annoncés, argv vérifiés, noms des variables seulement, aucun spawn et aucune écriture', () => {
    const racine = tmp('asec');
    try {
      const espion = path.join(racine, 'espion.js');
      const marque = path.join(racine, 'spawn-appele.txt');
      fs.writeFileSync(espion, [
        "const cp = require('child_process');",
        "const fs = require('fs');",
        "for (const n of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {",
        "  cp[n] = () => { fs.appendFileSync(process.env.CANARI_ESPION_SPAWN, n + '\\n'); throw new Error('spawn interdit en --a-sec'); };",
        '}',
      ].join('\n'));
      const brut = path.join(SUITE, 'brut');
      const avant = fs.existsSync(brut) ? fs.readdirSync(brut).sort() : null;
      const r = spawnSync(process.execPath, ['--require', espion, LANCEUR, 'payant', '--a-sec'], {
        encoding: 'utf8',
        env: {
          ...process.env, CANARI_ESPION_SPAWN: marque, CANARI_CLAUDE_CONFIG_DIR: path.join(racine, 'config'), CANARI_CLAUDE_ESPACE: path.join(racine, 'espace'),
          CANARI_VARIABLE_TEMOIN: 'valeur-temoin-a-ne-pas-afficher', ANTHROPIC_API_KEY: 'cle-temoin-a-ne-pas-afficher',
        },
      });
      assert.strictEqual(r.status, 0, r.stderr);
      assert.ok(!fs.existsSync(marque), `child_process appelé : ${fs.existsSync(marque) ? fs.readFileSync(marque, 'utf8') : ''}`);
      const sortie = r.stdout;
      assert.match(sortie, /Total : 38 appels au modèle \(série 1 : 17, série 2 : 6, série 3 : 4, série 4 : 3, série 5 : 8\) et 33 \/context\. Aucun processus lancé\./);
      const appels = sortie.split('\n').filter((l) => l.startsWith('[a-sec] Appel au modèle'));
      assert.strictEqual(appels.length, 38);
      assert.strictEqual(sortie.split('\n').filter((l) => l.startsWith('[a-sec] /context')).length, 33);
      const environnements = sortie.split('\n').filter((l) => l.startsWith('  environnement nettoyé ('));
      assert.strictEqual(environnements.length, 38);
      for (const l of environnements) {
        assert.match(l, /CLAUDE_CONFIG_DIR/);
        assert.match(l, /DISABLE_AUTOUPDATER/);
        assert.match(l, /\bPATH\b|\bPath\b/i);
        assert.doesNotMatch(l, /ANTHROPIC|CANARI_VARIABLE_TEMOIN/, 'liste blanche : aucune variable arbitraire');
      }
      const transmis = sortie.split('\n').find((l) => l.startsWith('[a-sec] Variables transmises à claude (liste blanche'));
      assert.ok(transmis && !/CANARI_VARIABLE_TEMOIN|ANTHROPIC/.test(transmis), 'la liste complète des noms transmis est affichée');
      const noms = (transmis as string).split(' : ').pop()!.split(', ');
      assert.ok(noms.every((n) => S.VARIABLES_POSEES.includes(n) || S.nomPermis(n)), 'seulement des noms de la liste blanche');
      assert.ok(!sortie.includes('a-ne-pas-afficher'), 'aucune valeur de variable');
      assert.strictEqual(sortie.split('\n').filter((l) => l.startsWith('  argv : ')).length, 71);
      assert.ok(!fs.existsSync(path.join(racine, 'espace')) && !fs.existsSync(path.join(racine, 'config')), 'rien n\'est écrit dans l\'espace ni le profil');
      assert.deepStrictEqual(fs.existsSync(brut) ? fs.readdirSync(brut).sort() : null, avant, 'rien n\'est écrit dans brut/');
    } finally {
      supprimer(racine);
    }
  });

  test('15. Préparation H14 : jeu complet sans MCP, instance VS Code séparée sans fermer les autres fenêtres, /status tranche, vérification puis clôture', () => {
    const plan = C.planDeploiement(S.listerFixtures(), P.JEUX_H14, { configDir: 'C:\\profil', espace: ESPACE_W, fixturesDir: 'C:\\depot\\fixtures' }, path.win32);
    assert.ok(plan.length > 0 && plan.every((e: any) => e.cible !== 'mcp'), 'aucun MCP');
    assert.ok(['niveaux', 'skills', 'hook-sortie'].every((j) => P.JEUX_H14.includes(j)));
    const lignes: string[] = P.gestesH14({ configDir: 'X:\\profil-isole', projet: 'X:\\espace\\projet', invite: INVITES.get('h14-panneau'), dossierInstance: 'X:\\tmp\\vscode-canari' });
    const texte = lignes.join('\n');
    assert.match(texte, /code --user-data-dir "X:\\tmp\\vscode-canari" "X:\\espace\\projet"/);
    assert.match(texte, /\$env:CLAUDE_CONFIG_DIR = "X:\\profil-isole"/);
    assert.match(texte, /Inutile de fermer tes autres fenêtres/);
    assert.ok(!lignes.some((l) => /^\s*\d+\.\s*Ferme/.test(l)), 'aucun geste ne ferme les autres fenêtres d\'abord');
    assert.match(texte, /\/status\. Il tranche/);
    assert.ok(texte.includes(INVITES.get('h14-panneau') as string));
    assert.match(texte, /Ne la relance jamais/);
    assert.match(texte, /appel d'outil, note-le : le relevé des canaris est alors invalide, sans relance/);
    assert.ok(texte.indexOf('--verifier-h14') > texte.indexOf(INVITES.get('h14-panneau') as string), 'la vérification suit l\'appel');
    assert.match(lignes[lignes.length - 1], /npm run sonde:claude-context -- --lot E3 --cloturer-h14$/);
    assert.match(P.GESTE_DEBUT_H14, /Disable Auto Update for Extensions/);
    assert.ok(texte.indexOf('/status') < texte.indexOf('/context') && texte.indexOf('/context') < texte.indexOf(INVITES.get('h14-panneau') as string));
  });

  test('16. Retrait des effets attendus des déclencheurs : fichier créé et fichier modifié attendus retirés, rien d\'autre', () => {
    const racine = tmp('effets');
    try {
      const espace = path.join(racine, 'espace');
      const projet = path.join(espace, 'projet');
      const journal = path.join(racine, 'brut', 'journal.json');
      fs.mkdirSync(projet, { recursive: true });
      const a = path.join(projet, 'src', 'a.ts');
      const c = path.join(projet, 'src', 'c.ts');
      const reglages = path.join(espace, ...P.CHEMIN_REGLAGES);
      const fichiers = [{ destination: a, contenu: 'export const a = 1;\n' }, { destination: reglages, contenu: P.REGLAGES_DECLENCHEURS }];
      // Fichier créé et fichier modifié attendus : tout est retiré
      S.deployer(fichiers, journal, [espace]);
      fs.writeFileSync(a, 'export const a = 2;\n');
      fs.writeFileSync(c, 'export const c = 3;\n');
      const r = S.retirer(journal, { modifsPermises: [a], creesPermis: [c] });
      assert.deepStrictEqual(r, { problemes: [], attendus: [c, a] });
      assert.deepStrictEqual(fs.readdirSync(espace), ['projet']);
      assert.deepStrictEqual(fs.readdirSync(projet), []);
      // Un fichier inattendu reste, avec son dossier : le retrait est incomplet (série rejetée)
      S.deployer(fichiers, journal, [espace]);
      fs.writeFileSync(path.join(projet, 'src', 'x.ts'), 'inattendu');
      const r2 = S.retirer(journal, { creesPermis: [c] });
      assert.ok(r2.problemes.some((p: string) => /dossier non vide conservé/.test(p)));
      assert.ok(fs.existsSync(path.join(projet, 'src', 'x.ts')));
      fs.unlinkSync(path.join(projet, 'src', 'x.ts'));
      assert.deepStrictEqual(S.retirer(journal).problemes, []);
      // Une modification non attendue est conservée
      S.deployer(fichiers, journal, [espace]);
      fs.writeFileSync(a, 'modifié');
      assert.ok(S.retirer(journal, { creesPermis: [c] }).problemes.some((p: string) => /fichier modifié conservé/.test(p)));
      assert.ok(fs.existsSync(a));
      // Les raisons de rejet écrites dans le rapport ne portent aucun chemin
      assert.strictEqual(S.nettoyerRaison(`EE : retrait incomplet (fichier modifié conservé : ${a}) ; ${HOME_W}\\x et /tmp/y`), 'EE : retrait incomplet (fichier modifié conservé : <chemin>) ; <chemin> et <chemin>');
    } finally {
      supprimer(racine);
    }
  });
});
