import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe } from 'node:test';

// Comparateur de la suite d'injection Claude Code (lots I3, E1, V1 et étape A de la baseline 2.1.319). Les
// tests 1 à 4 et 6 à 14 portent sur des données synthétiques. Le test 5 compare l'ensemble de rapports locaux
// de resultats/ (un « context » et les « payant » de sa version) à sa baseline : il n'est joué que par
// npm run test:injection-claude (INJECTION_CLAUDE_COMPARE=1), et ignoré dans npm test.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('node:fs') as typeof import('node:fs');
const ROOT = path.resolve(__dirname, '..', '..');
const K = require(path.join(ROOT, 'test', 'scenarios', 'scripts', 'compare-injection-claude.js'));
const B = require(path.join(ROOT, 'test', 'scenarios', 'scripts', 'sonde-claude-code-baseline.js'));
const S = require(path.join(ROOT, 'test', 'scenarios', 'scripts', 'sonde-claude-code.js'));
const COMPARE = process.env.INJECTION_CLAUDE_COMPARE === '1';
/** Les abonnements acceptés par le lanceur, lus dans sa liste : aucun n'est écrit ici en dur. */
const ABONNEMENTS: string[] = S.ABONNEMENTS;
/** L'abonnement fictif des rapports d'exemple. */
const ABONNEMENT_EXEMPLE = 'abonnement-exemple';
/** Les textes d'abonnement interdits dans une baseline : chaque valeur acceptée, et la valeur fictive. */
const ABONNEMENTS_INTERDITS = [...ABONNEMENTS, ABONNEMENT_EXEMPLE].map((v) => `"${v}"`);
/** Un rapport dont le champ abonnement porte la valeur donnée. */
const avecAbonnement = (rapport: any, abonnement: string): any => ({ ...rapport, environnement: { ...rapport.environnement, abonnement } });

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
/** Un rapport « context » valide synthétique (valeurs de la série du 2026-11-09, aucune donnée locale). */
const rapportContext = (): any => {
  const base = (id: string, total: number) => ({ id, total, categories: [{ nom: 'System prompt', tokens: 3086 }] });
  const hors = () => ({ categories_hors: { nombre: 0, tokens: 0 }, memoire_hors: { nombre: 0, tokens: 0 }, skills_hors: { nombre: 29, tokens: 5563 }, outils_mcp_hors: { nombre: 0, tokens: 0 }, agents_hors: { nombre: 0, tokens: 0 } });
  return {
    rapport: 'claude-code-context',
    format: 1,
    lot: 'E1',
    environnement: { outil: 'Claude Code', entree: 'cli -p', os: 'Windows', version_avant: '2.1.318', version_apres: '2.1.318', modele: 'claude-opus-5', effort: 'high', methode: 'claude.ai', fournisseur: 'firstParty', abonnement: ABONNEMENT_EXEMPLE, sonde: 'v1', date_mesure: '2026-11-09' },
    serie: { valide: true, raisons_rejet: [], context_utilises: 26, compteur_lot: 52, plafond: 60 },
    bases: { vide: { debut: base('base-vide', 3094), fin: base('base-vide', 3094), identiques: true }, avec_skill: { debut: base('base-skill', 8721), fin: base('base-skill', 8721), identiques: true } },
    combinaisons: [
      { id: 'niveaux', jeux: ['niveaux'], outils: 'vide', mcp: [], total: 3776, delta_base: 682, categories: [{ nom: 'System prompt', tokens: 3086 }, { nom: 'Memory files', tokens: 682 }], memory_files: [{ chemin: '<parent>/CLAUDE.md', type: 'Project', tokens: 38 }], skills: [], mcp_tools: [], hors_fixtures: hors(), init: { nombre_skills: 41 }, fixtures_absentes: ['<projet>/import-5.md'] },
      { id: 'skills', jeux: ['skills'], outils: 'Skill', mcp: [], total: 9393, delta_base: 672, categories: [{ nom: 'System prompt', tokens: 3150 }, { nom: 'Skills', tokens: 6235 }], memory_files: [], skills: [{ name: 'canari-p1', source: 'projectSettings', tokens: 29 }], mcp_tools: [], hors_fixtures: hors(), init: { nombre_skills: 41 }, fixtures_absentes: ['skill canari-cache'] },
      { id: 'mcp-long', jeux: ['mcp-long'], outils: 'vide', mcp: ['mcp-long'], total: 6078, delta_base: 2984, categories: [{ nom: 'System prompt', tokens: 3086 }, { nom: 'MCP tools', tokens: 1411 }, { nom: 'MCP server instructions', tokens: 1573 }], memory_files: [], skills: [], mcp_tools: [{ name: 'mcp__canari-mcp-long__canari_outil_long', server: 'canari-mcp-long', tokens: 1411 }], hors_fixtures: hors(), init: { nombre_skills: 41 }, fixtures_absentes: [] },
    ],
    profil: { zones_sonde: { ecarts: 0, en_cause: [] }, hors_zones: [] },
  };
};
const baselineConnue =(contenu: object, fichier = 'baseline-2026-11-05.json') => ({ fichier, date: fichier.slice(9, 19), contenu });

const P = require(path.join(ROOT, 'test', 'scenarios', 'scripts', 'sonde-claude-code-payant.js'));
const INVENTAIRE = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'scenarios', 'claude-code-injection-contexte', 'inventaire.json'), 'utf8'));
const NOMS_PAYANT = [1, 2, 3, 4, 5].map((n) => `payant-2026-11-09-100${n - 1}.json`);
/** Les canaris rapportés dans l'ensemble synthétique (série 4 et 5) ; tous les autres sont « non vus ». */
const CANARIS_VUS: Record<string, any> = {
  '4a': ['CANARI-CC-GLOB-XJ6U', 'CANARI-CC-PROJ-QQV9', 'CANARI-CC-HOOK-C2QM'],
  '4b': ['CANARI-CC-GLOB-XJ6U', 'CANARI-CC-IMP1-JK6J'],
  '4c': ['CANARI-CC-SKP1-PDW6'],
  ER: { avant_outil: [], apres_outil: ['CANARI-CC-DPATHS-9C2L'] },
};
/**
 * Un ensemble synthétique valide : le rapport « context » synthétique et un rapport « payant » par série,
 * selon le plan du lanceur (38 appels). Usage : base de série + 10 par rang d'appel ; aucune donnée locale.
 */
const ensemble = (): any => {
  const bases: Record<number, number> = { 1: 5000, 2: 12000, 3: 5000 };
  const decompositions: Record<number, any> = {
    1: { bases: { decalage_vide: 615, vide_identiques: true }, memoire: { preambule: 80.73 }, o200k: { F: 33 } },
    2: { bases: { decalage_skill: 1774 }, skills: { ligne: 49 }, h15: { r_context: { skill: 1.3 } }, o200k: { F: 33 } },
  };
  const payants = P.SERIES.map((s: any, i: number) => ({
    nom: NOMS_PAYANT[i],
    contenu: {
      rapport: 'claude-code-payant',
      format: 1,
      lot: 'E2',
      environnement: { outil: 'Claude Code', entree: 'cli -p', os: 'Windows', version_avant: '2.1.318', modele: 'claude-opus-5', effort: 'high', methode: 'claude.ai', fournisseur: 'firstParty', abonnement: ABONNEMENT_EXEMPLE, sonde: 'v1', date_mesure: '2026-11-09' },
      execution: { series_demandees: [s.numero], arret: null },
      series: [{ numero: s.numero, titre: s.titre, valide: true, raisons_rejet: [] }],
      appels: s.appels.map((a: any, k: number) => {
        const declencheur = s.mode === 'declencheurs';
        const entree = s.mode === 'usage' ? bases[s.numero] + (a.base ? 0 : 10 * k) : 9000 + k;
        const vus = CANARIS_VUS[a.id];
        return {
          id: a.id,
          serie: s.numero,
          jeux: a.jeux ?? (declencheur ? ['declencheurs'] : []),
          usage: {
            entree,
            par_tour: declencheur
              ? [{ entree: 5000, sortie: 8, somme4: 5008, delta_entree: null }, { entree: 5100 + k, sortie: 8, somme4: 5108 + k, delta_entree: 100 + k }]
              : [{ entree, sortie: 9, somme4: entree + 9, delta_entree: null }],
          },
          reponse: s.mode === 'usage' ? { lisible: true, ok: true }
            : declencheur ? { lisible: true, avant_outil: [...((vus && vus.avant_outil) || [])], apres_outil: [...((vus && vus.apres_outil) || [])], chaines_inconnues: 0 }
              : { lisible: true, canaris: [...vus], chaines_inconnues: 0, ...(a.id === '4a' ? { enveloppes: { nombre: 3, empreinte: 'f'.repeat(64) } } : {}) },
        };
      }),
      combinaisons: [{ id: `ctx:serie-${s.numero}`, serie: s.numero, total: 3094 }],
      decomposition: decompositions[s.numero] || { o200k: { F: 33 } },
    },
  }));
  return { context: { nom: 'context-2026-11-09-0856.json', contenu: rapportContext() }, payants };
};

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
    // Décision du 2026-11-10 : la différence d'un tour à l'autre n'est jamais comparée (décomposition seulement)
    b.entrees.push({ id: 'x4', instrument: 'usage', appel: 'ER', mesure: 'delta_tour', tour: 2, attendu: { delta: 209, tolerance: 0 } });
    assert.deepStrictEqual(K.problemesBaseline(b), [
      'CC05:presence : id en double', 'x1 : instrument inconnu', 'x2 : appel, reference et attendu.delta attendus', 'x3 : appel, canari et attendu booléen attendus',
      'x4 : différence d\'un tour à l\'autre refusée (elle contient le texte du modèle : décomposition seulement)',
    ]);
    assert.deepStrictEqual(K.problemesBaseline({ entrees: [] }), ['environnement.version absent']);
    // La décomposition : absente, nulle, ou marquée non comparée
    const v = { environnement: { version: '2.1.319' }, entrees: [] };
    assert.deepStrictEqual(K.problemesBaseline({ ...v, decomposition: null }), []);
    assert.deepStrictEqual(K.problemesBaseline({ ...v, decomposition: { comparee: false, memoire: {} } }), []);
    assert.deepStrictEqual(K.problemesBaseline({ ...v, decomposition: { memoire: {} } }), ['decomposition : comparee: false attendu (section non comparée)']);
    assert.deepStrictEqual(K.problemesBaseline({ ...v, decomposition: { comparee: true } }), ['decomposition : comparee: false attendu (section non comparée)']);
    for (const connue of K.listerBaselines()) assert.deepStrictEqual(K.problemesBaseline(connue.contenu), [], connue.fichier);
  });

  test('6. Baseline tirée d\'un rapport : fixtures et écarts seulement, A2 et observations manuelles en remarques, refus d\'une série non valide', () => {
    const baseline = B.baselineDepuisRapport(rapportContext(), { source: 'context-2026-11-09-0856.json' });
    assert.deepStrictEqual(K.problemesBaseline(baseline), []);
    assert.deepStrictEqual(baseline.environnement, {
      outil: 'Claude Code', entree: 'cli -p', os: 'Windows', version: '2.1.318', versions_compatibles: ['2.1.318'],
      modele: 'claude-opus-5', effort: 'high', sonde: 'v1', date_mesure: '2026-11-09',
    });
    assert.deepStrictEqual(baseline.entrees.map((e: any) => [e.id, JSON.stringify(e.attendu)]), [
      ['CC05:niveaux:<parent>/CLAUDE.md', '{"present":true,"type":"Project","tokens":38}'],
      ['CC09:niveaux:<projet>/import-5.md', '{"present":false}'],
      ['CC12:niveaux:delta', '{"delta":682,"tolerance":0}'],
      ['CC24:skills:skill canari-p1', '{"present":true,"source":"projectSettings","tokens":29}'],
      ['CC26:skills:skill canari-cache', '{"present":false}'],
      ['CC24:skills:delta', '{"delta":672,"tolerance":0}'],
      ['CC32:mcp-long:mcp mcp__canari-mcp-long__canari_outil_long', '{"present":true}'],
      ['CC32:mcp-long:delta', '{"delta":1573,"tolerance":0}'],
    ]);
    assert.strictEqual(baseline.entrees.find((e: any) => e.id === 'CC32:mcp-long:delta').sans_outils_mcp, true);
    const texte = JSON.stringify(baseline);
    for (const interdit of ['"total"', 'hors_fixtures', 'skills_hors', '"init"', 'categories', 'abonnement', ...ABONNEMENTS_INTERDITS, 'methode', 'fournisseur', 'firstParty']) {
      assert.ok(!texte.includes(interdit), `aucun ${interdit} dans la baseline`);
    }
    // Chaque abonnement accepté, porté à son tour par le rapport, reste hors de la baseline.
    assert.strictEqual(ABONNEMENTS.length, 4, 'quatre abonnements acceptés');
    for (const abonnement of ABONNEMENTS) {
      const t = JSON.stringify(B.baselineDepuisRapport(avecAbonnement(rapportContext(), abonnement), { source: 'context-2026-11-09-0856.json' }));
      assert.ok(!t.includes(`"${abonnement}"`) && !t.includes('abonnement'), `abonnement n° ${ABONNEMENTS.indexOf(abonnement) + 1} hors de la baseline`);
    }
    assert.ok(baseline.remarques.some((r: string) => /Anomalie A2/.test(r)));
    assert.ok(baseline.remarques.some((r: string) => /^CC07 \(H16b\), observation manuelle/.test(r)));
    assert.ok(!B.baselineDepuisRapport({ ...rapportContext(), environnement: { ...rapportContext().environnement, version_avant: '9.9.9', version_apres: '9.9.9' } }, { source: 'context-2026-11-09-0856.json' }).remarques.some((r: string) => /CC07/.test(r)), 'observation liée à sa version');

    // Refus
    const refus = (modifier: (r: any) => void, source = 'context-2026-11-09-0856.json') => () => {
      const r: any = rapportContext();
      modifier(r);
      B.baselineDepuisRapport(r, { source });
    };
    assert.throws(refus((r) => (r.serie.valide = false)), /série non valide/);
    assert.throws(refus((r) => (r.rapport = 'claude-code-payant')), /claude-code-context/);
    assert.throws(refus((r) => (r.environnement.version_apres = '2.1.319')), /version/);
    assert.throws(refus((r) => r.combinaisons[0].memory_files.push({ chemin: '<projet>/inconnu.md', type: 'Project', tokens: 1 })), /élément sans scénario/);
    assert.throws(refus((r) => (r.combinaisons[0].id = 'inconnue')), /combinaison sans scénario/);
    assert.throws(refus((r) => (r.combinaisons[0].delta_base = null)), /écart à la base absent/);
    assert.throws(refus(() => undefined, 'context-2026-11-08-0856.json'), /date/);
    assert.throws(refus(() => undefined, '../context-2026-11-09-0856.json'), /nom du rapport/);
    // Chaque combinaison du lanceur a un scénario
    for (const c of S.COMBINAISONS) assert.ok(Object.prototype.hasOwnProperty.call(B.SCENARIO_COMBINAISON, c.id), c.id);
    assert.deepStrictEqual(Object.keys(B.SCENARIO_COMBINAISON).sort(), S.COMBINAISONS.map((c: any) => c.id).sort());

    // La commande : resultats/ seulement, garde, jamais d'écrasement
    const d = tmp('baseline');
    const log = console.log;
    try {
      const resultats = path.join(d, 'resultats');
      const attendu = path.join(d, 'attendu');
      fs.mkdirSync(resultats);
      fs.writeFileSync(path.join(resultats, 'context-2026-11-09-0856.json'), JSON.stringify(rapportContext()));
      const poste = { home: 'C:\\Users\\exemple-compte', compte: 'exemple-compte', hote: 'POSTE-EXEMPLE' };
      const lancer = (reste: string[], p = poste) => S.commandeBaseline(reste, { resultats, attendu, poste: p });
      console.log = () => undefined;
      assert.throws(() => lancer(['--depuis']), /Usage/);
      assert.throws(() => lancer(['--depuis', '../x/context-2026-11-09-0856.json']), /rapport refusé/);
      assert.throws(() => lancer(['--depuis', 'context-2026-11-09-0857.json']), /introuvable/);
      assert.throws(() => lancer(['--depuis', 'context-2026-11-09-0856.json'], { ...poste, compte: 'Windows' }), /garde de confidentialité/);
      assert.ok(!fs.existsSync(path.join(attendu, 'baseline-2026-11-09.json')), 'rien n\'est écrit si la garde échoue');
      assert.strictEqual(lancer(['--depuis', 'context-2026-11-09-0856.json']), 0);
      const ecrite = JSON.parse(fs.readFileSync(path.join(attendu, 'baseline-2026-11-09.json'), 'utf8'));
      assert.strictEqual(ecrite.entrees.length, 8);
      assert.throws(() => lancer(['--depuis', 'context-2026-11-09-0856.json']), /existe déjà/);
      const invalide: any = rapportContext();
      invalide.serie.valide = false;
      fs.writeFileSync(path.join(resultats, 'context-2026-11-09-0900.json'), JSON.stringify(invalide));
      fs.rmSync(path.join(attendu, 'baseline-2026-11-09.json'));
      assert.throws(() => lancer(['--depuis', 'context-2026-11-09-0900.json']), /série non valide/);
    } finally {
      console.log = log;
      supprimer(d);
    }
  });

  test('7. Indépendance du compte : seuls les totaux du compte changent → conforme ; une fixture ou un écart changent → écart', () => {
    const baseline = B.baselineDepuisRapport(rapportContext(), { source: 'context-2026-11-09-0856.json' });
    const ecarts = (modifier: (r: any) => void) => {
      const r: any = rapportContext();
      modifier(r);
      const lignes = K.comparer(baseline, r);
      assert.ok(lignes.every((l: any) => l.couverte));
      return lignes.filter((l: any) => l.ecart).map((l: any) => l.id);
    };
    assert.deepStrictEqual(ecarts(() => undefined), []);
    // Un autre compte : plus de skills synchronisés, d'autres bases absolues, d'autres totaux ; les écarts à la base ne bougent pas
    assert.deepStrictEqual(ecarts((r) => {
      for (const b of [r.bases.vide, r.bases.avec_skill]) for (const m of ['debut', 'fin']) b[m].total += 1234;
      for (const c of r.combinaisons) {
        c.total += 1234;
        c.hors_fixtures.skills_hors = { nombre: 60, tokens: 9000 };
        c.init.nombre_skills = 99;
        c.categories.find((x: any) => x.nom === 'System prompt').tokens += 1234;
      }
      r.environnement.abonnement = 'autre';
    }), []);
    assert.deepStrictEqual(ecarts((r) => (r.combinaisons[0].memory_files[0].tokens = 39)), ['CC05:niveaux:<parent>/CLAUDE.md']);
    assert.deepStrictEqual(ecarts((r) => (r.combinaisons[0].memory_files[0].type = 'User')), ['CC05:niveaux:<parent>/CLAUDE.md']);
    assert.deepStrictEqual(ecarts((r) => (r.combinaisons[1].skills[0].tokens = 30)), ['CC24:skills:skill canari-p1']);
    assert.deepStrictEqual(ecarts((r) => (r.combinaisons[0].delta_base = 683)), ['CC12:niveaux:delta']);
    assert.deepStrictEqual(ecarts((r) => (r.combinaisons[1].skills.push({ name: 'canari-cache', source: 'projectSettings', tokens: 30 }))), ['CC26:skills:skill canari-cache']);
    // A2 : les tokens d'un outil MCP et la catégorie « MCP tools » ne comptent pas ; sa présence, si
    assert.deepStrictEqual(ecarts((r) => {
      const c = r.combinaisons[2];
      c.mcp_tools[0].tokens = 0;
      c.categories.find((x: any) => x.nom === 'MCP tools').tokens = 0;
      c.delta_base -= 1411;
    }), []);
    assert.deepStrictEqual(ecarts((r) => (r.combinaisons[2].mcp_tools = [])), ['CC32:mcp-long:mcp mcp__canari-mcp-long__canari_outil_long']);
    // Un total absolu est refusé dans une baseline
    assert.deepStrictEqual(K.problemesBaseline({ ...baseline, entrees: [{ id: 't', instrument: 'context', combinaison: 'niveaux', mesure: 'total', attendu: 3776 }] }), ['t : total absolu refusé (il dépend du compte)']);
    assert.deepStrictEqual(K.problemesBaseline({ ...baseline, entrees: [{ id: 'm', instrument: 'context', combinaison: 'mcp-long', outil_mcp: 'x', attendu: { present: true, tokens: 1 } }] }), ['m : outil MCP comparé en présence seulement (A2)']);
  });

  test('8. Comparaison inter-versions : une baseline imposée d\'une autre version est acceptée et annoncée comme telle', () => {
    const b: any = baselineConnue(B.baselineDepuisRapport(rapportContext(), { source: 'context-2026-11-09-0856.json' }), 'baseline-2026-11-09.json');
    const r322: any = rapportContext();
    r322.lot = 'V1';
    r322.environnement.version_avant = r322.environnement.version_apres = '2.1.322';
    // Sans baseline imposée : refus, jamais devinée
    assert.match(K.choisirBaseline(r322, [b]).erreur, /Aucune baseline pour Claude Code 2\.1\.322/);
    // Imposée par date, version ou nom de fichier : acceptée, marquée inter-versions
    for (const forcee of ['2026-11-09', '2.1.318', 'baseline-2026-11-09.json']) {
      const c = K.choisirBaseline(r322, [b], forcee);
      assert.strictEqual(c.baseline.fichier, 'baseline-2026-11-09.json', forcee);
      assert.deepStrictEqual(c.interVersions, { rapport: '2.1.322', baseline: '2.1.318' }, forcee);
    }
    const choix = K.choisirBaseline(r322, [b], '2026-11-09');
    assert.strictEqual(
      K.enteteComparaison('context-2026-11-10-1000.json', choix),
      'comparaison inter-versions : rapport 2.1.322 contre baseline 2.1.318 (context-2026-11-10-1000.json contre baseline-2026-11-09.json, baseline imposée par SONDE_BASELINE_CLAUDE)',
    );
    assert.deepStrictEqual(K.comparer(choix.baseline.contenu, r322).filter((l: any) => l.ecart || !l.couverte), [], 'la comparaison elle-même est inchangée');
    // Même version, ou version déjà compatible : pas d'inter-versions
    const meme = K.choisirBaseline(rapportContext(), [b], '2026-11-09');
    assert.strictEqual(meme.interVersions, undefined);
    assert.strictEqual(K.enteteComparaison('context-2026-11-09-0856.json', meme), 'context-2026-11-09-0856.json contre baseline-2026-11-09.json');
    const compatible = baselineConnue({ ...b.contenu, environnement: { ...b.contenu.environnement, versions_compatibles: ['2.1.318', '2.1.322'] } }, 'baseline-2026-11-09.json');
    assert.strictEqual(K.choisirBaseline(r322, [compatible], '2026-11-09').interVersions, undefined);
    assert.strictEqual(K.choisirBaseline(r322, [compatible]).baseline.fichier, 'baseline-2026-11-09.json');
    // Rapport sans version et baseline imposée : inter-versions, version inconnue
    assert.match(K.enteteComparaison('context-x.json', K.choisirBaseline({ environnement: {} }, [b], '2026-11-09')), /^comparaison inter-versions : rapport \(version inconnue\) contre baseline 2\.1\.318 /);
  });

  test('9. Ajout à versions_compatibles : refusé en cas d\'écart, d\'entrée non couverte ou de série non valide ; accepté avec 0 écart, rien d\'autre ne change', () => {
    const baseline = B.baselineDepuisRapport(rapportContext(), { source: 'context-2026-11-09-0856.json' });
    const r322 = (modifier: (r: any) => void = () => undefined) => {
      const r: any = rapportContext();
      r.lot = 'V1';
      r.environnement.version_avant = r.environnement.version_apres = '2.1.322';
      r.environnement.date_mesure = '2026-11-10';
      modifier(r);
      return r;
    };
    // La fonction pure
    const ajout = B.ajoutVersionCompatible(baseline, r322());
    assert.deepStrictEqual(ajout.contenu.environnement.versions_compatibles, ['2.1.318', '2.1.322']);
    assert.deepStrictEqual(baseline.environnement.versions_compatibles, ['2.1.318'], 'la baseline reçue n\'est pas modifiée');
    const refus = (r: any, motif: RegExp, b: any = baseline) => assert.throws(() => B.ajoutVersionCompatible(b, r), motif);
    refus(r322((r) => (r.combinaisons[0].memory_files[0].tokens = 39)), /1 écart\(s\) avec la baseline/);
    refus(r322((r) => (r.combinaisons[0].delta_base = 683)), /1 écart\(s\)/);
    refus(r322((r) => (r.serie.valide = false)), /série non valide/);
    refus(r322((r) => (r.combinaisons = r.combinaisons.slice(0, 2))), /2 entrée\(s\) non couverte\(s\)/);
    refus(r322((r) => (r.environnement.version_apres = '2.1.323')), /différente avant et après/);
    refus(r322((r) => (r.environnement.version_avant = r.environnement.version_apres = '2.1.322-beta')), /mal formée/);
    refus(r322((r) => (r.rapport = 'claude-code-payant')), /claude-code-context/);
    refus(rapportContext(), /déjà couverte/);
    refus(r322(), /baseline mal formée/, { ...baseline, entrees: [{ id: 't', instrument: 'context', combinaison: 'niveaux', mesure: 'total', attendu: 1 }] });

    // La commande, sur des dossiers temporaires : baseline désignée, rien d'écrit en cas de refus
    const d = tmp('compatible');
    const log = console.log;
    const journal: string[] = [];
    try {
      const resultats = path.join(d, 'resultats');
      const attendu = path.join(d, 'attendu');
      fs.mkdirSync(resultats);
      fs.mkdirSync(attendu);
      const cible = path.join(attendu, 'baseline-2026-11-09.json');
      const texte = `${JSON.stringify(baseline, null, 2)}\n`;
      fs.writeFileSync(cible, texte);
      const ecrire = (nom: string, r: any) => fs.writeFileSync(path.join(resultats, nom), JSON.stringify(r));
      ecrire('context-2026-11-10-1000.json', r322());
      ecrire('context-2026-11-10-1001.json', r322((r) => (r.combinaisons[1].skills[0].tokens = 30)));
      ecrire('context-2026-11-10-1002.json', r322((r) => (r.serie.valide = false)));
      const poste = { home: 'C:\\Users\\exemple-compte', compte: 'exemple-compte', hote: 'POSTE-EXEMPLE' };
      const lancer = (reste: string[], p = poste) => S.commandeCompatible(reste, { resultats, attendu, poste: p });
      const valide = ['--rapport', 'context-2026-11-10-1000.json', '--baseline', '2026-11-09'];
      console.log = (m: string) => journal.push(m);
      assert.throws(() => lancer(['--rapport', 'context-2026-11-10-1000.json']), /Usage/);
      assert.throws(() => lancer([...valide, '--force', 'x']), /Usage/);
      assert.throws(() => lancer(['--rapport', '../context-2026-11-10-1000.json', '--baseline', '2026-11-09']), /rapport refusé/);
      assert.throws(() => lancer(['--rapport', 'context-2026-11-10-1000.json', '--baseline', '2026-12-01']), /--baseline=2026-12-01 ne désigne aucune baseline/);
      assert.throws(() => lancer(['--rapport', 'context-2026-11-10-1001.json', '--baseline', '2026-11-09']), (e: Error) => e instanceof S.Refus && /ajout refusé : 1 écart\(s\)/.test(e.message));
      assert.throws(() => lancer(['--rapport', 'context-2026-11-10-1002.json', '--baseline', '2026-11-09']), (e: Error) => e instanceof S.Refus && /ajout refusé : série non valide/.test(e.message));
      assert.throws(() => lancer(valide, { ...poste, compte: 'Windows' }), /garde de confidentialité/);
      assert.strictEqual(fs.readFileSync(cible, 'utf8'), texte, 'baseline intacte après les refus');
      assert.deepStrictEqual(journal, [], 'aucun message de succès');

      // Accepté avec 0 écart : seul le tableau versions_compatibles change, d'une version
      assert.strictEqual(lancer(valide), 0);
      const apres = fs.readFileSync(cible, 'utf8');
      assert.strictEqual(apres, texte.replace('      "2.1.318"\n    ],', '      "2.1.318",\n      "2.1.322"\n    ],'));
      assert.notStrictEqual(apres, texte);
      assert.ok(journal.some((m) => /comparaison inter-versions : rapport 2\.1\.322 contre baseline 2\.1\.318 .*baseline imposée par --baseline\) : 8 entrées couvertes, 0 écart/.test(m)), journal.join('\n'));
      assert.ok(journal.some((m) => /Version 2\.1\.322 ajoutée à versions_compatibles de baseline-2026-11-09\.json \(désormais : 2\.1\.318, 2\.1\.322\)/.test(m)), journal.join('\n'));
      assert.deepStrictEqual(fs.readdirSync(attendu), ['baseline-2026-11-09.json'], 'aucun fichier temporaire laissé');
      // Une seconde fois : déjà couverte, rien ne change ; le comparateur la choisit désormais sans variable
      assert.throws(() => lancer(valide), /déjà couverte/);
      assert.strictEqual(fs.readFileSync(cible, 'utf8'), apres);
      assert.strictEqual(K.choisirBaseline(r322(), K.listerBaselines(attendu)).baseline.fichier, 'baseline-2026-11-09.json');
      // Un fichier qui n'est pas au format écrit par la sonde n'est jamais réécrit
      fs.writeFileSync(cible, JSON.stringify(baseline));
      assert.throws(() => lancer(valide), /pas au format écrit par la sonde/);
      assert.strictEqual(fs.readFileSync(cible, 'utf8'), JSON.stringify(baseline));
    } finally {
      console.log = log;
      supprimer(d);
    }
  });

  test('10. Baseline tirée d\'un ensemble : context, usage en différences à la base de la série, canaris vus et non vus, décomposition non comparée', () => {
    const b = B.baselineDepuisRapports(ensemble(), { inventaire: INVENTAIRE });
    assert.deepStrictEqual(K.problemesBaseline(b), []);
    const par = (i: string) => b.entrees.filter((e: any) => e.instrument === i).length;
    assert.deepStrictEqual([par('context'), par('usage'), par('canari'), b.entrees.length], [8, 24, 149, 181]);
    assert.deepStrictEqual(b.environnement, {
      outil: 'Claude Code', entree: 'cli -p', os: 'Windows', version: '2.1.318', versions_compatibles: ['2.1.318'],
      modele: 'claude-opus-5', effort: 'high', sonde: 'v1', date_mesure: '2026-11-09',
    });
    assert.deepStrictEqual(b.source, { context: 'context-2026-11-09-0856.json', payant: NOMS_PAYANT, local: true });
    const entree = (id: string) => b.entrees.find((e: any) => e.id === id);
    // Usage : différence à la base de la série, jamais une valeur absolue ; aucune entrée pour la série 4 ni par tour
    assert.deepStrictEqual(entree('CC12:U1:usage').attendu, { delta: 10, tolerance: 0 });
    assert.strictEqual(entree('CC12:U1:usage').reference, 'U0a');
    assert.deepStrictEqual(entree('CC01:U0b:usage').attendu, { delta: 0, tolerance: 0 });
    assert.strictEqual(entree('CC24:S1:usage').reference, 'S0a');
    assert.strictEqual(entree('CC32:T-long:usage').reference, 'T0a');
    assert.ok(!b.entrees.some((e: any) => e.instrument === 'usage' && (e.serie === 4 || e.serie === 5 || e.mesure === 'delta_tour')));
    // Canaris : univers des jeux de l'appel (inventaire), vus et non vus ; 4a en CC35 ; série 5 avant et après l'outil
    assert.strictEqual(entree('CC35:4a:CANARI-CC-GLOB-XJ6U').attendu, true);
    assert.strictEqual(entree('CC09:4b:CANARI-CC-IMP5-569U').attendu, false);
    assert.strictEqual(entree('CC18:ER:apres:CANARI-CC-DPATHS-9C2L').attendu, true);
    assert.strictEqual(entree('CC18:ER:avant:CANARI-CC-DPATHS-9C2L').attendu, false);
    assert.strictEqual(entree('CC08:ER-sous:apres:CANARI-CC-DSOUS-7VJB').attendu, false);
    // Décomposition : fusionnée, non comparée, sans les décalages des bases ni l'empreinte de 4a ; différences par tour rangées ici
    assert.strictEqual(b.decomposition.comparee, false);
    assert.strictEqual(b.decomposition.memoire.preambule, 80.73);
    assert.strictEqual(b.decomposition.skills.ligne, 49);
    assert.strictEqual(b.decomposition.h15.r_context.skill, 1.3);
    assert.strictEqual(b.decomposition.o200k.F, 33);
    assert.strictEqual(b.decomposition.mcp.serveur_a, null);
    assert.strictEqual(b.decomposition.bases, undefined);
    assert.deepStrictEqual(b.decomposition.enveloppes_4a, { nombre: 3 });
    assert.strictEqual(b.decomposition.declencheurs_delta_tour.ER, 100);
    const texte = JSON.stringify(b);
    for (const interdit of ['decalage', '"empreinte"', 'abonnement', ...ABONNEMENTS_INTERDITS, 'methode', 'fournisseur', 'hors_fixtures', '"total"', '"par_tour"', '5000', '12000']) {
      assert.ok(!texte.includes(interdit), `aucun ${interdit} dans la baseline`);
    }
    // Chaque abonnement accepté, porté à son tour par tous les rapports de l'ensemble, reste hors de la baseline.
    for (const abonnement of ABONNEMENTS) {
      const e = ensemble();
      const ens = {
        context: { ...e.context, contenu: avecAbonnement(e.context.contenu, abonnement) },
        payants: e.payants.map((p: any) => ({ ...p, contenu: avecAbonnement(p.contenu, abonnement) })),
      };
      const t = JSON.stringify(B.baselineDepuisRapports(ens, { inventaire: INVENTAIRE }));
      assert.ok(!t.includes(`"${abonnement}"`) && !t.includes('abonnement'), `abonnement n° ${ABONNEMENTS.indexOf(abonnement) + 1} hors de la baseline de l'ensemble`);
    }
    assert.ok(b.remarques.some((r: string) => /^Sources : .*context-2026-11-09-0856\.json \(lot E1\).*lot E2, séries 1 à 5, 38 appels/.test(r)));
    assert.ok(b.remarques.some((r: string) => /signal d'enquête, pas une conclusion/.test(r)));
    assert.ok(b.remarques.some((r: string) => /budget limité \(non vérifié\)/.test(r)));
    assert.ok(b.remarques.some((r: string) => /mesuré qu'en 2\.1\.318/.test(r)));
    // Chaque canari de l'inventaire et chaque appel « usage » du plan ont un scénario
    for (const f of INVENTAIRE.fixtures) for (const c of f.canaris) assert.match(B.scenarioCanari(c), /^CC\d\d$/, c);
    for (const s of P.SERIES.filter((x: any) => x.mode === 'usage')) for (const a of s.appels.filter((x: any) => x.base !== 'debut')) assert.ok(B.SCENARIO_APPEL[a.id], a.id);
  });

  test('11. Baseline tirée d\'un ensemble : refus (rapport non valide, versions, séries, appels, valeur absolue, hors fixtures)', () => {
    const refus = (modifier: (e: any) => void, motif: RegExp) => {
      const e: any = ensemble();
      modifier(e);
      assert.throws(() => B.baselineDepuisRapports(e, { inventaire: INVENTAIRE }), motif);
    };
    const p = (e: any, serie: number) => e.payants.find((x: any) => x.contenu.series[0].numero === serie).contenu;
    // Rapport non valide
    refus((e) => (e.context.contenu.serie.valide = false), /série non valide/);
    refus((e) => (p(e, 2).series[0].valide = false), /rapport non valide \(série 2 rejetée\)/);
    refus((e) => (p(e, 3).execution.arret = 'deux séries rejetées'), /rapport non valide \(exécution arrêtée\)/);
    refus((e) => (p(e, 4).appels[1].reponse = { lisible: false }), /4b : réponse illisible/);
    refus((e) => (e.payants[0].nom = '../payant-2026-11-09-1000.json'), /nom de rapport « payant » refusé/);
    refus((e) => (e.payants = []), /au moins un rapport « payant »/);
    // Versions, modèle, lot
    refus((e) => (p(e, 5).environnement.version_avant = '2.1.319'), /mélange de versions refusé/);
    refus((e) => (e.context.contenu.environnement.version_apres = '2.1.319'), /différente avant et après/);
    refus((e) => (p(e, 1).environnement.modele = 'autre'), /modèle ou effort différent/);
    refus((e) => (p(e, 1).lot = 'E3'), /même lot/);
    // Séries et appels
    refus((e) => (e.payants = e.payants.filter((x: any) => x.contenu.series[0].numero !== 3)), /série 3 manquante/);
    refus((e) => e.payants.push({ nom: 'payant-2026-11-09-1100.json', contenu: JSON.parse(JSON.stringify(p(e, 2))) }), /série 2 en double/);
    refus((e) => p(e, 1).appels.push({ ...p(e, 1).appels[1] }), /appel U1 en double/);
    refus((e) => (p(e, 2).appels = p(e, 2).appels.filter((a: any) => a.id !== 'S3')), /appel S3 manquant/);
    refus((e) => p(e, 1).appels.push({ ...p(e, 1).appels[1], id: 'U9' }), /appel U9 hors du plan/);
    // Valeur absolue
    refus((e) => (p(e, 1).appels[0].usage = {}), /valeur absolue refusée : la différence de U1 à U0a est incalculable/);
    refus((e) => (p(e, 1).decomposition.bases_usage = { vide: 5000 }), /hors de la liste blanche \(bases_usage\)/);
    refus((e) => (p(e, 2).decomposition.skills.total = 12000), /hors de la liste blanche \(skills\.total\)/);
    refus((e) => (p(e, 2).decomposition.o200k = { F: 34 }), /décomposition contradictoire entre les rapports \(o200k\.F\)/);
    // Hors fixtures
    refus((e) => p(e, 4).appels[1].reponse.canaris.push('CANARI-CC-INCONNU-ZZZZ'), /élément hors fixtures : canari rapporté par 4b/);
    refus((e) => p(e, 5).appels[0].reponse.apres_outil.push('CANARI-CC-GLOB-XJ6U'), /élément hors fixtures : canari rapporté par ER/);
    refus((e) => (p(e, 4).appels[2].jeux = ['skills', 'jeu-inconnu']), /jeux de fixtures différents du plan/);
    refus((e) => e.context.contenu.combinaisons[0].memory_files.push({ chemin: '<projet>/inconnu.md', type: 'Project', tokens: 1 }), /élément sans scénario/);
    assert.throws(() => B.baselineDepuisRapports(ensemble(), { inventaire: { fixtures: [] } }), /jeu niveaux absent de l'inventaire/);
  });

  test('12. Indépendance du compte d\'un ensemble : les valeurs absolues changent seules → conforme ; une différence ou un canari change → écart', () => {
    const b = B.baselineDepuisRapports(ensemble(), { inventaire: INVENTAIRE });
    const ecarts = (modifier: (e: any) => void) => {
      const e: any = ensemble();
      modifier(e);
      const lignes = K.comparer(b, K.fusionnerRapports([{ fichier: e.context.nom, contenu: e.context.contenu }, ...e.payants.map((x: any) => ({ fichier: x.nom, contenu: x.contenu }))]));
      assert.ok(lignes.every((l: any) => l.couverte), 'toutes les entrées couvertes');
      return lignes.filter((l: any) => l.ecart).map((l: any) => l.id);
    };
    assert.deepStrictEqual(ecarts(() => undefined), []);
    // Un autre compte : chaque série décalée d'un montant différent (adresse, date, skills de l'organisation), totaux et abonnement changés
    assert.deepStrictEqual(ecarts((e) => {
      e.payants.forEach((x: any, i: number) => {
        x.contenu.environnement.abonnement = 'autre';
        for (const a of x.contenu.appels) {
          a.usage.entree += 1000 * (i + 1);
          for (const t of a.usage.par_tour || []) t.entree += 1000 * (i + 1);
        }
        for (const c of x.contenu.combinaisons) c.total += 777;
      });
      for (const c of e.context.contenu.combinaisons) c.total += 1234;
    }), []);
    // Les différences d'un tour à l'autre (série 5) ne sont pas comparées
    assert.deepStrictEqual(ecarts((e) => (e.payants[4].contenu.appels[0].usage.par_tour[1].delta_entree = 999)), []);
    // Une différence change → écart
    assert.deepStrictEqual(ecarts((e) => (e.payants[0].contenu.appels[1].usage.entree += 1)), ['CC12:U1:usage']);
    assert.deepStrictEqual(ecarts((e) => (e.payants[1].contenu.appels[0].usage.entree += 1)), ['CC24:S1:usage', 'CC24:S2:usage', 'CC24:S3:usage', 'CC27:S-long:usage', 'CC01:S0b:usage'], 'la base S0a bouge seule');
    // Un canari change → écart (vu → non vu, non vu → vu)
    assert.deepStrictEqual(ecarts((e) => (e.payants[4].contenu.appels[0].reponse.apres_outil = [])), ['CC18:ER:apres:CANARI-CC-DPATHS-9C2L']);
    assert.deepStrictEqual(ecarts((e) => e.payants[3].contenu.appels[1].reponse.canaris.push('CANARI-CC-IMP5-569U')), ['CC09:4b:CANARI-CC-IMP5-569U']);
    // Une fixture « context » change → écart
    assert.deepStrictEqual(ecarts((e) => (e.context.contenu.combinaisons[0].memory_files[0].tokens = 39)), ['CC05:niveaux:<parent>/CLAUDE.md']);
  });

  test('13. Ensemble à comparer : par défaut (context le plus récent, payants de sa version, le plus récent par série) ou désigné par SONDE_RAPPORT_CLAUDE', () => {
    const d = tmp('ensemble');
    try {
      const e: any = ensemble();
      const ecrire = (nom: string, r: any) => fs.writeFileSync(path.join(d, nom), JSON.stringify(r));
      ecrire(e.context.nom, e.context.contenu);
      for (const x of e.payants) ecrire(x.nom, x.contenu);
      // Une série 1 plus ancienne (remplacée), et un rapport d'une autre version, plus récent (écarté)
      ecrire('payant-2026-11-09-0900.json', { ...e.payants[0].contenu, appels: e.payants[0].contenu.appels.map((a: any) => ({ ...a, usage: { ...a.usage, entree: 1 } })) });
      ecrire('payant-2026-11-09-2300.json', { ...e.payants[1].contenu, environnement: { ...e.payants[1].contenu.environnement, version_avant: '2.1.317' } });
      ecrire('context-2026-11-08-0800.json', { ...e.context.contenu, environnement: { ...e.context.contenu.environnement, version_avant: '2.1.317', version_apres: '2.1.317' } });
      const defaut = K.choisirEnsemble(d);
      assert.deepStrictEqual(defaut.fichiers, ['context-2026-11-09-0856.json', ...NOMS_PAYANT]);
      assert.strictEqual(defaut.ecartes, 1);
      assert.strictEqual(defaut.contenu.appels.length, 38);
      assert.strictEqual(defaut.contenu.environnement.version_avant, '2.1.318');
      const b = B.baselineDepuisRapports(ensemble(), { inventaire: INVENTAIRE });
      assert.deepStrictEqual(K.comparer(b, defaut.contenu).filter((l: any) => l.ecart || !l.couverte), []);
      // Un rapport plus récent pour la série 2 seulement : il remplace la série 2 de l'ancien, qui garde ses autres séries
      const double = { ...e.payants[0].contenu, series: [...e.payants[0].contenu.series, ...e.payants[1].contenu.series], appels: [...e.payants[0].contenu.appels, ...e.payants[1].contenu.appels] };
      ecrire('payant-2026-11-09-1000.json', double);
      fs.rmSync(path.join(d, 'payant-2026-11-09-1001.json'));
      ecrire('payant-2026-11-09-1200.json', e.payants[1].contenu);
      const remplace = K.choisirEnsemble(d);
      assert.deepStrictEqual(remplace.fichiers, ['context-2026-11-09-0856.json', 'payant-2026-11-09-1000.json', 'payant-2026-11-09-1002.json', 'payant-2026-11-09-1003.json', 'payant-2026-11-09-1004.json', 'payant-2026-11-09-1200.json']);
      assert.strictEqual(remplace.contenu.appels.length, 38);
      // Désigné : un nom seul, ou une liste ; refus d'un mélange de versions, d'une série en double, de deux « context », d'un nom inconnu
      assert.deepStrictEqual(K.choisirEnsemble(d, 'context-2026-11-08-0800.json').fichiers, ['context-2026-11-08-0800.json']);
      assert.deepStrictEqual(K.choisirEnsemble(d, ' context-2026-11-09-0856.json , payant-2026-11-09-1200.json ').fichiers, ['context-2026-11-09-0856.json', 'payant-2026-11-09-1200.json']);
      assert.throws(() => K.choisirEnsemble(d, 'context-2026-11-09-0856.json,payant-2026-11-09-2300.json'), /mélange de versions refusé/);
      assert.throws(() => K.choisirEnsemble(d, 'payant-2026-11-09-1000.json,payant-2026-11-09-1200.json'), /série 2 en double/);
      assert.throws(() => K.choisirEnsemble(d, 'context-2026-11-09-0856.json,context-2026-11-08-0800.json'), /un seul rapport « context »/);
      assert.throws(() => K.choisirEnsemble(d, 'context-2026-11-09-0856.json,payant-x.json'), /payant-x\.json ne désigne aucun rapport/);
      assert.throws(() => K.choisirEnsemble(d, 'payant-2026-11-09-1200.json,payant-2026-11-09-1200.json'), /figure deux fois/);
      assert.strictEqual(K.choisirEnsemble(path.join(d, 'absent')), null);
      // L'en-tête nomme tout l'ensemble
      const choix = K.choisirBaseline(defaut.contenu, [baselineConnue(b, 'baseline-2026-11-09.json')]);
      assert.match(K.enteteComparaison(defaut.fichiers.join(', '), choix), /^context-2026-11-09-0856\.json, payant-2026-11-09-1000\.json, .* contre baseline-2026-11-09\.json$/);
    } finally {
      supprimer(d);
    }
  });

  test('14. Commande baseline --payant : écrit la baseline de l\'ensemble après la garde, n\'écrase jamais, refuse un mélange de versions', () => {
    const d = tmp('baseline-ensemble');
    const log = console.log;
    try {
      const resultats = path.join(d, 'resultats');
      const attendu = path.join(d, 'attendu');
      fs.mkdirSync(resultats);
      const e: any = ensemble();
      fs.writeFileSync(path.join(resultats, e.context.nom), JSON.stringify(e.context.contenu));
      for (const x of e.payants) fs.writeFileSync(path.join(resultats, x.nom), JSON.stringify(x.contenu));
      fs.writeFileSync(path.join(resultats, 'payant-2026-11-09-2300.json'), JSON.stringify({ ...e.payants[1].contenu, environnement: { ...e.payants[1].contenu.environnement, version_avant: '2.1.319' } }));
      const poste = { home: 'C:\\Users\\exemple-compte', compte: 'exemple-compte', hote: 'POSTE-EXEMPLE' };
      const lancer = (reste: string[]) => S.commandeBaseline(reste, { resultats, attendu, poste });
      const liste = NOMS_PAYANT.join(',');
      console.log = () => undefined;
      assert.throws(() => lancer(['--depuis', e.context.nom, '--payant']), /Usage/);
      assert.throws(() => lancer(['--depuis', e.context.nom, '--autre', 'x']), /Usage/);
      assert.throws(() => lancer(['--payant', liste]), /Usage/);
      assert.throws(() => lancer(['--depuis', e.context.nom, '--payant', `${liste},../payant-2026-11-09-1000.json`]), /rapport refusé/);
      assert.throws(() => lancer(['--depuis', e.context.nom, '--payant', `${liste},payant-2026-11-09-1000.json`]), /figure deux fois/);
      assert.throws(() => lancer(['--depuis', e.context.nom, '--payant', 'payant-2026-11-09-0000.json']), /introuvable/);
      assert.throws(() => lancer(['--depuis', e.context.nom, '--payant', liste.replace('payant-2026-11-09-1001.json', 'payant-2026-11-09-2300.json')]), /baseline refusée : mélange de versions refusé/);
      assert.ok(!fs.existsSync(attendu), 'rien n\'est écrit après un refus');
      assert.strictEqual(lancer(['--depuis', e.context.nom, '--payant', liste]), 0);
      const ecrite = JSON.parse(fs.readFileSync(path.join(attendu, 'baseline-2026-11-09.json'), 'utf8'));
      assert.strictEqual(ecrite.entrees.length, 181);
      assert.deepStrictEqual(K.problemesBaseline(ecrite), []);
      assert.throws(() => lancer(['--depuis', e.context.nom, '--payant', liste]), /existe déjà/);
    } finally {
      console.log = log;
      supprimer(d);
    }
  });

  test('5. Comparaison réelle : l\'ensemble de rapports de resultats/ et sa baseline (npm run test:injection-claude)', (t) => {
    if (!COMPARE) {
      t.skip('Ignoré par défaut : lancer npm run test:injection-claude après une sonde (README de la suite).');
      return;
    }
    const ensembleReel = K.choisirEnsemble(K.RESULTATS, process.env.SONDE_RAPPORT_CLAUDE);
    assert.ok(ensembleReel, 'Aucun rapport dans resultats/ : lancer la sonde avec --resultats (README de la suite).');
    const choix = K.choisirBaseline(ensembleReel.contenu, K.listerBaselines(), process.env.SONDE_BASELINE_CLAUDE);
    assert.ok('baseline' in choix, choix.erreur);
    const lignes = K.comparer(choix.baseline.contenu, ensembleReel.contenu);
    const ecarts = lignes.filter((l: any) => l.ecart);
    if (ensembleReel.ecartes > 0) console.log(`[Comparaison Claude Code] ${ensembleReel.ecartes} rapport(s) « payant » d'une autre version écarté(s).`);
    const parInstrument = ['context', 'usage', 'canari'].map((i) => `${i} ${lignes.filter((l: any) => l.instrument === i && l.couverte).length}/${lignes.filter((l: any) => l.instrument === i).length}`).join(', ');
    console.log(`[Comparaison Claude Code] ${K.enteteComparaison(ensembleReel.fichiers.join(', '), choix)} : ${lignes.filter((l: any) => l.couverte).length} entrées couvertes (${parInstrument}), ${lignes.filter((l: any) => !l.couverte).length} non couvertes, ${ecarts.length} écart(s).`);
    for (const l of ecarts) console.log(`  ÉCART ${l.id} : attendu ${JSON.stringify(l.attendu)}, observé ${JSON.stringify(l.observe)}`);
    assert.deepStrictEqual(ecarts.map((l: any) => l.id), [], 'Écarts avec la baseline : voir SCENARIOS-CLAUDE-CODE.md, colonne « Si ça change ».');
  });
});
