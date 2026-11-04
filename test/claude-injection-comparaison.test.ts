import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe } from 'node:test';

// Comparateur de la suite d'injection Claude Code (lot I3). Les quatre premiers tests portent sur des
// données synthétiques. Le cinquième compare le dernier rapport de resultats/ à sa baseline : il n'est
// joué que par npm run test:injection-claude (INJECTION_CLAUDE_COMPARE=1), et ignoré dans npm test.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('node:fs') as typeof import('node:fs');
const ROOT = path.resolve(__dirname, '..', '..');
const K = require(path.join(ROOT, 'test', 'scenarios', 'scripts', 'compare-injection-claude.js'));
const COMPARE = process.env.INJECTION_CLAUDE_COMPARE === '1';

const tmp = (prefixe: string) => fs.mkdtempSync(path.join(os.tmpdir(), `canari-cmp-${prefixe}-`));
const supprimer = (d: string) => fs.rmSync(d, { recursive: true, force: true });

/** Une baseline synthétique : une entrée de chaque instrument. */
const baselineSynthetique = (version = '2.1.318', compatibles: string[] = [version]) => ({
  baseline: '2026-11-05',
  environnement: { outil: 'Claude Code', version, versions_compatibles: compatibles, modele: 'claude-opus-5' },
  entrees: [
    { id: 'CC05:presence', scenario: 'CC05', instrument: 'context', combinaison: 'niveaux', element: '<parent>/CLAUDE.md', attendu: { present: true, type: 'Project', tokens: 37 } },
    { id: 'CC26:cache', scenario: 'CC26', instrument: 'context', combinaison: 'skills', skill: 'canari-cache', attendu: { present: false } },
    { id: 'CC17:cout', scenario: 'CC17', instrument: 'usage', appel: 'U7', reference: 'U1', attendu: { delta: 0, tolerance: 0 } },
    { id: 'CC18:ER', scenario: 'CC18', instrument: 'canari', appel: 'ER', etape: 'apres', canari: 'CANARI-CC-X-AAAA', attendu: true },
  ],
});
const rapportSynthetique = () => ({
  rapport: 'claude-code-payant',
  environnement: { version_avant: '2.1.318' },
  series: [{ numero: 1, valide: true }, { numero: 5, valide: true }],
  combinaisons: [
    { id: 'niveaux', total: 3555, memory_files: [{ chemin: '<parent>/CLAUDE.md', type: 'Project', tokens: 37 }], skills: [] },
    { id: 'skills', total: 8874, memory_files: [], skills: [{ name: 'canari-p1', source: 'projectSettings', tokens: 29 }] },
  ],
  appels: [
    { id: 'U1', serie: 1, usage: { entree: 5114 } },
    { id: 'U7', serie: 1, usage: { entree: 5114 } },
    { id: 'ER', serie: 5, usage: { entree: 9000 }, reponse: { lisible: true, avant_outil: [], apres_outil: ['CANARI-CC-X-AAAA'] } },
  ],
});
const baselineConnue = (contenu: object, fichier = 'baseline-2026-11-05.json') => ({ fichier, date: fichier.slice(9, 19), contenu });

describe('Suite de Tests : Comparateur de la suite d\'injection Claude Code (lot I3)', () => {
  test('1. Choix de la baseline : version du rapport, versions compatibles, SONDE_BASELINE_CLAUDE, jamais devinée', () => {
    const b1 = baselineConnue(baselineSynthetique('2.1.318', ['2.1.318', '2.1.320']));
    const b2 = baselineConnue(baselineSynthetique('2.2.0'), 'baseline-2026-12-01.json');
    const avec = (v: string | undefined) => ({ environnement: { version_avant: v } });
    const choisie = (r: object, forcee?: string, liste = [b1, b2]) => {
      const c = K.choisirBaseline(r, liste, forcee);
      return 'baseline' in c ? c.baseline.fichier : c.erreur;
    };
    assert.strictEqual(choisie(avec('2.1.318')), 'baseline-2026-11-05.json');
    assert.strictEqual(choisie(avec(' 2.1.320 ')), 'baseline-2026-11-05.json', 'version compatible');
    assert.strictEqual(choisie(avec('2.2.0')), 'baseline-2026-12-01.json');
    assert.match(choisie(avec('9.9.9')), /Aucune baseline pour Claude Code 9\.9\.9/);
    assert.match(choisie(avec(undefined)), /ne porte pas de version/);
    assert.strictEqual(choisie(avec('2.2.0'), '2.1.318'), 'baseline-2026-11-05.json', 'SONDE_BASELINE_CLAUDE prime');
    assert.strictEqual(choisie(avec('2.1.318'), '2026-12-01'), 'baseline-2026-12-01.json');
    assert.strictEqual(choisie(avec('2.1.318'), 'baseline-2026-12-01.json'), 'baseline-2026-12-01.json');
    assert.strictEqual(choisie(avec('2.1.318'), '  '), 'baseline-2026-11-05.json', 'une variable vide ne force rien');
    assert.match(choisie(avec('2.1.318'), 'zz'), /SONDE_BASELINE_CLAUDE=zz ne désigne aucune baseline connue/);
    assert.match(choisie(avec('2.1.318'), undefined, []), /Aucune baseline dans attendu\//);
  });

  test('2. Dernier rapport de resultats/ : par horodatage, payant après context à égalité, ou celui que désigne SONDE_RAPPORT_CLAUDE', () => {
    const dossier = tmp('resultats');
    try {
      for (const nom of ['context-2026-11-05-0930.json', 'payant-2026-11-05-0930.json', 'context-2026-11-04-2359.json', 'brouillon.json', '.gitkeep']) {
        fs.writeFileSync(path.join(dossier, nom), JSON.stringify({ nom }));
      }
      assert.strictEqual(K.dernierRapport(dossier).fichier, 'payant-2026-11-05-0930.json');
      assert.strictEqual(K.dernierRapport(dossier, 'context-2026-11-04-2359.json').contenu.nom, 'context-2026-11-04-2359.json');
      assert.throws(() => K.dernierRapport(dossier, 'brouillon.json'), /ne désigne aucun rapport/);
      assert.strictEqual(K.dernierRapport(path.join(dossier, 'absent')), null);
      fs.mkdirSync(path.join(dossier, 'vide'));
      assert.strictEqual(K.dernierRapport(path.join(dossier, 'vide')), null);
      const attendu = path.join(dossier, 'attendu');
      fs.mkdirSync(attendu);
      fs.writeFileSync(path.join(attendu, 'baseline-2026-11-05.json'), JSON.stringify(baselineSynthetique()));
      fs.writeFileSync(path.join(attendu, 'notes.json'), '{}');
      assert.deepStrictEqual(K.listerBaselines(attendu).map((b: any) => [b.fichier, b.date]), [['baseline-2026-11-05.json', '2026-11-05']]);
    } finally {
      supprimer(dossier);
    }
  });

  test('3. Comparaison : entrées context, usage (différences) et canari, tolérance 0, séries rejetées non couvertes', () => {
    const baseline = baselineSynthetique();
    assert.deepStrictEqual(K.problemesBaseline(baseline), []);
    const conforme = K.comparer(baseline, rapportSynthetique());
    assert.deepStrictEqual(conforme.map((l: any) => [l.id, l.couverte, l.ecart]), [
      ['CC05:presence', true, false], ['CC26:cache', true, false], ['CC17:cout', true, false], ['CC18:ER', true, false],
    ]);
    const ecarts = (modifier: (r: any) => void) => {
      const r: any = rapportSynthetique();
      modifier(r);
      return K.comparer(baseline, r).filter((l: any) => l.ecart).map((l: any) => l.id);
    };
    assert.deepStrictEqual(ecarts((r) => (r.combinaisons[0].memory_files[0].tokens = 38)), ['CC05:presence'], 'tolérance 0 sur les tokens');
    assert.deepStrictEqual(ecarts((r) => (r.combinaisons[0].memory_files = [])), ['CC05:presence'], 'fichier absent');
    assert.deepStrictEqual(ecarts((r) => r.combinaisons[1].skills.push({ name: 'canari-cache', source: 'projectSettings', tokens: 30 })), ['CC26:cache']);
    assert.deepStrictEqual(ecarts((r) => (r.appels[1].usage.entree = 5115)), ['CC17:cout'], 'différence d\'usage');
    assert.deepStrictEqual(ecarts((r) => (r.appels[2].reponse.apres_outil = [])), ['CC18:ER']);
    assert.deepStrictEqual(ecarts((r) => (r.appels[2].reponse.avant_outil = ['CANARI-CC-X-AAAA'])), [], 'l\'étape « apres » seule compte');
    // Non couvertes : combinaison ou appel absents, série rejetée, réponse illisible ; jamais un écart
    const nonCouvertes = (modifier: (r: any) => void) => {
      const r: any = rapportSynthetique();
      modifier(r);
      return K.comparer(baseline, r).filter((l: any) => !l.couverte).map((l: any) => l.id);
    };
    assert.deepStrictEqual(nonCouvertes((r) => (r.combinaisons = [])), ['CC05:presence', 'CC26:cache']);
    assert.deepStrictEqual(nonCouvertes((r) => (r.series[0].valide = false)), ['CC17:cout']);
    assert.deepStrictEqual(nonCouvertes((r) => (r.appels[2].reponse = { lisible: false })), ['CC18:ER']);
    assert.deepStrictEqual(nonCouvertes((r) => (r.appels = [])), ['CC17:cout', 'CC18:ER']);
  });

  test('4. Format des baselines : entrées valides, ids uniques ; celles de attendu/ sont conformes', () => {
    const b: any = baselineSynthetique();
    b.entrees.push({ id: 'CC05:presence', instrument: 'context', combinaison: 'x', element: 'y', attendu: {} });
    b.entrees.push({ id: 'x1', instrument: 'autre' });
    b.entrees.push({ id: 'x2', instrument: 'usage', appel: 'U1' });
    b.entrees.push({ id: 'x3', instrument: 'canari', appel: 'ER', canari: 'C', attendu: 'oui' });
    assert.deepStrictEqual(K.problemesBaseline(b), [
      'CC05:presence : id en double', 'x1 : instrument inconnu', 'x2 : appel, reference et attendu.delta attendus', 'x3 : appel, canari et attendu booléen attendus',
    ]);
    assert.deepStrictEqual(K.problemesBaseline({ entrees: [] }), ['environnement.version absent']);
    for (const connue of K.listerBaselines()) assert.deepStrictEqual(K.problemesBaseline(connue.contenu), [], connue.fichier);
  });

  test('5. Comparaison réelle : le dernier rapport de resultats/ et sa baseline (npm run test:injection-claude)', (t) => {
    if (!COMPARE) {
      t.skip('Ignoré par défaut : lancer npm run test:injection-claude après une sonde (README de la suite).');
      return;
    }
    const rapport = K.dernierRapport(K.RESULTATS, process.env.SONDE_RAPPORT_CLAUDE);
    assert.ok(rapport, 'Aucun rapport dans resultats/ : lancer la sonde avec --resultats (README de la suite).');
    const choix = K.choisirBaseline(rapport.contenu, K.listerBaselines(), process.env.SONDE_BASELINE_CLAUDE);
    assert.ok('baseline' in choix, choix.erreur);
    const lignes = K.comparer(choix.baseline.contenu, rapport.contenu);
    const ecarts = lignes.filter((l: any) => l.ecart);
    console.log(`[Comparaison Claude Code] ${rapport.fichier} contre ${choix.baseline.fichier} : ${lignes.filter((l: any) => l.couverte).length} entrées couvertes, ${lignes.filter((l: any) => !l.couverte).length} non couvertes, ${ecarts.length} écart(s).`);
    for (const l of ecarts) console.log(`  ÉCART ${l.id} : attendu ${JSON.stringify(l.attendu)}, observé ${JSON.stringify(l.observe)}`);
    assert.deepStrictEqual(ecarts.map((l: any) => l.id), [], 'Écarts avec la baseline : voir SCENARIOS-CLAUDE-CODE.md, colonne « Si ça change ».');
  });
});
