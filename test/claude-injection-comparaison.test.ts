import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe } from 'node:test';

// Comparateur de la suite d'injection Claude Code (lots I3 et E1). Les tests 1 à 4, 6 et 7 portent sur des
// données synthétiques. Le test 5 compare le dernier rapport local de resultats/ à sa baseline : il n'est
// joué que par npm run test:injection-claude (INJECTION_CLAUDE_COMPARE=1), et ignoré dans npm test.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('node:fs') as typeof import('node:fs');
const ROOT = path.resolve(__dirname, '..', '..');
const K = require(path.join(ROOT, 'test', 'scenarios', 'scripts', 'compare-injection-claude.js'));
const B = require(path.join(ROOT, 'test', 'scenarios', 'scripts', 'sonde-claude-code-baseline.js'));
const S = require(path.join(ROOT, 'test', 'scenarios', 'scripts', 'sonde-claude-code.js'));
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
/** Un rapport « context » valide synthétique (valeurs de la série du 2026-11-09, aucune donnée locale). */
const rapportContext = (): any => {
  const base = (id: string, total: number) => ({ id, total, categories: [{ nom: 'System prompt', tokens: 3086 }] });
  const hors = () => ({ categories_hors: { nombre: 0, tokens: 0 }, memoire_hors: { nombre: 0, tokens: 0 }, skills_hors: { nombre: 29, tokens: 5563 }, outils_mcp_hors: { nombre: 0, tokens: 0 }, agents_hors: { nombre: 0, tokens: 0 } });
  return {
    rapport: 'claude-code-context',
    format: 1,
    lot: 'E1',
    environnement: { outil: 'Claude Code', entree: 'cli -p', os: 'Windows', version_avant: '2.1.318', version_apres: '2.1.318', modele: 'claude-opus-5', effort: 'high', methode: 'claude.ai', fournisseur: 'firstParty', abonnement: 'pro', sonde: 'v1', date_mesure: '2026-11-09' },
    serie: { valide: true, raisons_rejet: [], context_utilises: 26, compteur_lot: 52, plafond: 60 },
    bases: { vide: { debut: base('base-vide', 3094), fin: base('base-vide', 3094), identiques: true }, avec_skill: { debut: base('base-skill', 8721), fin: base('base-skill', 8721), identiques: true } },
    combinaisons: [
      { id: 'niveaux', jeux: ['niveaux'], outils: 'vide', mcp: [], total: 3776, delta_base: 682, categories: [{ nom: 'System prompt', tokens: 3086 }, { nom: 'Memory files', tokens: 682 }], memory_files: [{ chemin: '<parent>/CLAUDE.md', type: 'Project', tokens: 38 }], skills: [], mcp_tools: [], hors_fixtures: hors(), init: { nombre_skills: 41 }, fixtures_absentes: ['<projet>/import-5.md'] },
      { id: 'skills', jeux: ['skills'], outils: 'Skill', mcp: [], total: 9393, delta_base: 672, categories: [{ nom: 'System prompt', tokens: 3150 }, { nom: 'Skills', tokens: 6235 }], memory_files: [], skills: [{ name: 'canari-p1', source: 'projectSettings', tokens: 29 }], mcp_tools: [], hors_fixtures: hors(), init: { nombre_skills: 41 }, fixtures_absentes: ['skill canari-cache'] },
      { id: 'mcp-long', jeux: ['mcp-long'], outils: 'vide', mcp: ['mcp-long'], total: 6078, delta_base: 2984, categories: [{ nom: 'System prompt', tokens: 3086 }, { nom: 'MCP tools', tokens: 1411 }, { nom: 'MCP server instructions', tokens: 1573 }], memory_files: [], skills: [], mcp_tools: [{ name: 'mcp__canari-mcp-long__canari_outil_long', server: 'canari-mcp-long', tokens: 1411 }], hors_fixtures: hors(), init: { nombre_skills: 41 }, fixtures_absentes: [] },
    ],
    profil: { ecarts_connus: [], ecarts_inconnus: 0 },
  };
};
const baselineConnue =(contenu: object, fichier = 'baseline-2026-11-05.json') => ({ fichier, date: fichier.slice(9, 19), contenu });

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
    for (const interdit of ['"total"', 'hors_fixtures', 'skills_hors', '"init"', 'categories', 'abonnement', '"pro"', 'methode', 'fournisseur', 'firstParty']) {
      assert.ok(!texte.includes(interdit), `aucun ${interdit} dans la baseline`);
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
