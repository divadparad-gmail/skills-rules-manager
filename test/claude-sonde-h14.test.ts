import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe } from 'node:test';

// Lot E3 de la suite Claude Code (H14, panneau VS Code) : fonctions sans lancement, sur des données
// synthétiques et des dossiers temporaires. Aucun lancement de claude, ni de la copie embarquée, ni de
// VS Code ; aucune transcription réelle n'est lue.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('node:fs') as typeof import('node:fs');
const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'test', 'scenarios', 'scripts');
const SUITE = path.join(ROOT, 'test', 'scenarios', 'claude-code-injection-contexte');
const S = require(path.join(SCRIPTS, 'sonde-claude-code.js'));
const P = require(path.join(SCRIPTS, 'sonde-claude-code-payant.js'));
const C = require(path.join(SCRIPTS, 'sonde-claude-code-commun.js'));
const H = require(path.join(SCRIPTS, 'sonde-claude-code-h14.js'));

const INVENTAIRE = C.lireInventaire(fs.readFileSync(path.join(SUITE, 'inventaire.json'), 'utf8'));
const CONNUS = new Set<string>(H.canarisDeLInventaire(INVENTAIRE).keys());
const ATTENDUS = S.attendusDeLaBaseline(INVENTAIRE);
const MEMOIRE = 'C--canari-claude-code-espace-projet';
const U1 = '11111111-2222-4333-8444-555555555555';
const U2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SECRET_INVITE = 'TEXTE-DE-L-INVITE-A-NE-JAMAIS-RECOPIER';
const SECRET_REPONSE = 'Phrase de la reponse a ne jamais recopier';

const tmp = (prefixe: string) => fs.mkdtempSync(path.join(os.tmpdir(), `canari-e3-${prefixe}-`));
const supprimer = (d: string) => fs.rmSync(d, { recursive: true, force: true });
const ligne = (o: object) => JSON.stringify(o);
const ecrire = (f: string, contenu: string) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, contenu);
};

/** Une transcription synthétique du panneau : /status, /context, l'invite, puis une réponse. */
function transcription({ canaris = ['CANARI-CC-GLOB-XJ6U'], outils = [] as string[], requetes = ['req-1'], version = '2.1.322', reponse = undefined as string | undefined } = {}) {
  const lignes = [
    ligne({ type: 'user', version, message: { role: 'user', content: '<command-name>/status</command-name>' } }),
    ligne({ type: 'user', version, message: { role: 'user', content: '<local-command-stdout>sortie</local-command-stdout>' } }),
    ligne({ type: 'user', version, message: { role: 'user', content: [{ type: 'text', text: SECRET_INVITE }] } }),
  ];
  for (const nom of outils) {
    lignes.push(ligne({ type: 'assistant', version, requestId: requetes[0], message: { id: 'm-outil', model: 'claude-opus-5', content: [{ type: 'tool_use', name: nom, input: {} }] } }));
    lignes.push(ligne({ type: 'user', version, message: { role: 'user', content: [{ type: 'tool_result', content: 'contenu lu' }] } }));
  }
  const texte = reponse ?? `${SECRET_REPONSE} ${JSON.stringify({ canaris })}`;
  for (const r of requetes) lignes.push(ligne({ type: 'assistant', version, requestId: r, message: { id: `m-${r}`, model: 'claude-opus-5', content: [{ type: 'text', text: texte }] } }));
  return `${lignes.join('\n')}\nligne illisible\n`;
}

describe('Suite de Tests : H14, le panneau VS Code (lot E3, sans rien lancer)', () => {
  test('1. Lot E3 : plafond de 12, /context seulement, E2 archivé sans remise à zéro, réservé à H14', () => {
    const brut = tmp('lot');
    const log = console.log;
    const journal: string[] = [];
    try {
      assert.strictEqual(P.COMPTEURS.context.plafonds.E3, 12);
      assert.ok(P.LOTS_CONTEXT_SEUL.includes('E3') && !Object.prototype.hasOwnProperty.call(P.COMPTEURS.modele.plafonds, 'E3'));
      assert.strictEqual(H.LOT_H14, 'E3');
      assert.deepStrictEqual([H.PREVUS_PREPARATION, H.PREVUS_CLOTURE, H.PREVUS_TOTAL], [6, 4, 10]);
      assert.strictEqual(H.PREVUS_PREPARATION, S.COPIES_H14.length * S.BASES.length + S.COPIES_H14.length, '4 bases et 2 H14');
      assert.strictEqual(H.PREVUS_CLOTURE, S.COPIES_H14.length * S.BASES.length, '4 bases de fin');
      // Le compteur E2 (33 sur 40) est archivé à l'ouverture d'E3, annoncé, sans remise à zéro
      const e2 = { lot: 'E2', plafond: 40, utilises: 33 };
      fs.writeFileSync(path.join(brut, 'compteur-context.json'), JSON.stringify(e2));
      console.log = (m: string) => journal.push(m);
      const r = S.ouvrirLotAnnonce(brut, 'context', 'E3');
      console.log = log;
      assert.strictEqual(r.archive, 'compteur-context-E2.json');
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(brut, 'compteur-context-E2.json'), 'utf8')), e2);
      assert.ok(journal.some((m) => /Compteur context du lot E2 \(33 sur 40\) archivé sous brut\/compteur-context-E2\.json ; lot E3 ouvert/.test(m)), journal.join('\n'));
      S.verifierBudget(brut, H.PREVUS_TOTAL, 'E3');
      for (let i = 1; i <= H.PREVUS_TOTAL; i++) assert.strictEqual(S.reserverContext(brut, 'E3'), i);
      S.verifierBudget(brut, 2, 'E3');
      assert.throws(() => S.verifierBudget(brut, 3, 'E3'), /10 \/context déjà utilisé\(s\), 3 prévu\(s\), limite de 12 pour le lot E3/);
      // Aucun appel au modèle sous E3
      for (const geste of [() => P.lireCompteur(brut, 'modele', 'E3'), () => P.lireOptionsPayant(['--confirmer', '--plafond', '1', '--lot', 'E3'])]) {
        assert.throws(geste, (e: Error) => e instanceof S.Refus && /le lot E3 \(H14, panneau VS Code\) n'accepte que \/context/.test(e.message));
      }
      // Options : E3 réservé aux modes H14, modes exclusifs, vérification sans --lot
      assert.throws(() => S.lireOptions(['--lot', 'E3']), /réservé à H14/);
      assert.throws(() => S.lireOptions(['--lot', 'E3', '--preparer-h14', '--cloturer-h14']), /un seul mode H14/);
      assert.throws(() => S.lireOptions(['--lot', 'E1', '--cloturer-h14']), /exige --lot E3/);
      assert.throws(() => S.lireOptions(['--lot', 'E3', '--verifier-h14']), /refuse --lot/);
      assert.throws(() => S.lireOptions(['--lot', 'E3', '--preparer-h14', '--resultats']), /refuse --combinaisons et --resultats/);
      assert.throws(() => S.lireOptions(['--verifier-h14', '--verifier-h14']), /option répétée/);
      assert.strictEqual(S.lireOptions(['--verifier-h14']).verifierH14, true);
      assert.strictEqual(S.lireOptions(['--lot', 'E3', '--cloturer-h14']).cloturerH14, true);
    } finally {
      console.log = log;
      supprimer(brut);
    }
  });

  test('2. Référence H14 (P5, P5b) : jeu complet, outil Skill, évènements du hook, sans plugin ni MCP, un /context permis', () => {
    assert.deepStrictEqual(S.COPIES_H14, ['poste', 'embarquee']);
    assert.deepStrictEqual(S.COMBINAISON_H14.jeux, P.JEUX_H14);
    const argv: string[] = S.argumentsContext({ outils: S.COMBINAISON_H14.outils, hookEvents: S.COMBINAISON_H14.hookEvents });
    assert.strictEqual(S.verifierArgv(argv, { espace: 'C:\\canari-claude-code\\espace', plateforme: 'win32' }), 'context');
    assert.strictEqual(argv[argv.indexOf('--tools') + 1], 'Skill');
    assert.ok(argv.includes('--include-hook-events') && !argv.includes('--plugin-dir') && !argv.includes('--mcp-config'));
    // Précision 4 : chaque mesure est contrôlée contre la version de SA copie
    const flux = (version: string) => S.lireFlux([
      ligne({ type: 'system', subtype: 'init', apiKeySource: 'none', claude_code_version: version }),
      ligne({ type: 'assistant', context_usage: { total_tokens: 1 }, message: { usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } } }),
      ligne({ type: 'result', num_turns: 0, total_cost_usd: 0, usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } }),
    ].join('\n'));
    assert.ok(S.controlerAppel(flux('2.1.319'), { versionAttendue: '2.1.319' }).ok, 'poste à sa version');
    assert.ok(S.controlerAppel(flux('2.1.322'), { versionAttendue: '2.1.322' }).ok, 'copie embarquée à sa version');
    assert.ok(S.controlerAppel(flux('2.1.322'), { versionAttendue: '2.1.319' }).autres.some((a: string) => /version différente/.test(a)), 'la version de l\'autre copie est refusée');
  });

  test('3. Copie embarquée (P5b) : extensions.json, dossier unique, variable ; refus clairs ; le chemin n\'est jamais une constante', () => {
    const home = 'C:\\Users\\exemple-compte';
    const ext = `${home}\\.vscode\\extensions`;
    const nom = 'anthropic.claude-code-2.1.322-win32-x64';
    const exe = `${ext}\\${nom}\\resources\\native-binary\\claude.exe`;
    const fichiers = new Map<string, string>([[ext, ''], [exe, ''], [`${ext}\\extensions.json`, JSON.stringify([{ identifier: { id: 'anthropic.claude-code' }, version: '2.1.322', relativeLocation: nom }, { identifier: { id: 'autre.extension' }, relativeLocation: 'autre' }])]]);
    const deps = (m: Map<string, string>, dossiers: string[] = [nom, 'autre']) => ({ env: {}, plateforme: 'win32', home, existe: (f: string) => m.has(f), lireTexte: (f: string) => m.get(f) as string, lister: () => dossiers });
    assert.deepStrictEqual(H.trouverCopieEmbarquee(deps(fichiers)), { exe, version: '2.1.322', source: 'extensions.json' });
    const sansIndex = new Map(fichiers);
    sansIndex.delete(`${ext}\\extensions.json`);
    assert.deepStrictEqual(H.trouverCopieEmbarquee(deps(sansIndex)), { exe, version: '2.1.322', source: 'dossier' });
    assert.throws(() => H.trouverCopieEmbarquee(deps(sansIndex, [nom, 'anthropic.claude-code-2.1.321-win32-x64'])), /2 copies .* sans extensions\.json : définir CANARI_CLAUDE_EMBARQUEE/);
    assert.throws(() => H.trouverCopieEmbarquee(deps(sansIndex, [])), /introuvable/);
    const sansBinaire = new Map(fichiers);
    sansBinaire.delete(exe);
    assert.throws(() => H.trouverCopieEmbarquee(deps(sansBinaire)), /copie embarquée absente de l'extension 2\.1\.322/);
    const double = new Map(fichiers);
    double.set(`${ext}\\extensions.json`, JSON.stringify([{ identifier: { id: 'anthropic.claude-code' }, relativeLocation: nom }, { identifier: { id: 'Anthropic.Claude-Code' }, relativeLocation: nom }]));
    assert.throws(() => H.trouverCopieEmbarquee(deps(double)), /cite 2 copies/);
    // VSCODE_EXTENSIONS remplace le dossier par défaut ; CANARI_CLAUDE_EMBARQUEE remplace tout
    const autre = 'D:\\extensions';
    const m2 = new Map<string, string>([[autre, ''], [`${autre}\\${nom}\\resources\\native-binary\\claude.exe`, '']]);
    assert.strictEqual(H.trouverCopieEmbarquee({ ...deps(m2, [nom]), env: { vscode_extensions: autre } }).exe, `${autre}\\${nom}\\resources\\native-binary\\claude.exe`);
    assert.deepStrictEqual(H.trouverCopieEmbarquee({ ...deps(fichiers), env: { CANARI_CLAUDE_EMBARQUEE: exe } }), { exe, version: null, source: 'variable' });
    assert.throws(() => H.trouverCopieEmbarquee({ ...deps(fichiers), env: { CANARI_CLAUDE_EMBARQUEE: 'claude.exe' } }), /chemin absolu/);
    assert.throws(() => H.trouverCopieEmbarquee({ ...deps(fichiers), env: { CANARI_CLAUDE_EMBARQUEE: `${ext}\\claude.cmd` } }), /\.exe/);
    // Aucun chemin de copie embarquée en dur dans les scripts
    for (const f of ['sonde-claude-code.js', 'sonde-claude-code-h14.js', 'sonde-claude-code-payant.js']) {
      assert.ok(!/anthropic\.claude-code-\d/.test(fs.readFileSync(path.join(SCRIPTS, f), 'utf8')), `${f} ne cite aucune version de dossier d'extension`);
    }
  });

  test('4. VS Code (Q1, D-b, précision 3) : autoUpdate coupé exigé ("off" ou false) et recopié dans l\'instance séparée ; dossier non vide refusé sans suppression', () => {
    // "off" (écrit par « Extensions: Disable Auto Update for Extensions ») et false sont acceptés
    assert.strictEqual(H.valeurAutoUpdateCoupee('{\n  "extensions.autoUpdate": "off",\n  "editor.fontSize": 14\n}'), 'off');
    assert.strictEqual(H.valeurAutoUpdateCoupee('{\n  "extensions.autoUpdate": false,\n  "editor.fontSize": 14\n}'), false);
    // Toute autre valeur, l'absence, une ligne commentée ou deux valeurs contradictoires sont refusées
    for (const [texte, motif] of [
      ['{ "extensions.autoUpdate": true }', 'true'],
      ['{ "extensions.autoUpdate": "onlyEnabledExtensions" }', 'onlyEnabledExtensions'],
      ['{ "extensions.autoUpdate": "onlySelectedExtensions" }', 'onlySelectedExtensions, refusé à dessein'],
      ['{ "extensions.autoUpdate": "Off" }', 'casse différente'],
      ['{ "extensions.autoUpdate": "off", "extensions.autoUpdate": false }', 'valeurs contradictoires'],
      ['{\n  // "extensions.autoUpdate": "off",\n}', 'ligne commentée'],
      ['{ "editor.fontSize": 14 }', 'absent : la valeur par défaut est active'],
    ]) {
      assert.strictEqual(H.valeurAutoUpdateCoupee(texte), null, motif);
      assert.strictEqual(H.autoUpdateCoupe(texte), false, motif);
    }
    assert.deepStrictEqual(H.VALEURS_AUTO_UPDATE_COUPE, [false, 'off']);
    assert.strictEqual(H.cheminReglagesPrincipaux({ env: { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, plateforme: 'win32', home: 'C:\\Users\\x' }), 'C:\\Users\\x\\AppData\\Roaming\\Code\\User\\settings.json');
    assert.deepStrictEqual(H.REGLAGES_INSTANCE_FIXES, { 'extensions.autoCheckUpdates': false, 'update.mode': 'none', 'claudeCode.attachOpenFile': false, 'claudeCode.attachSelection': false });
    assert.throws(() => H.reglagesInstance(true), S.Refus);
    assert.throws(() => H.reglagesInstance('on'), S.Refus);
    const racine = tmp('instance');
    try {
      for (const valeur of ['off', false]) {
        const dossier = path.join(racine, `${H.DOSSIER_INSTANCE}-${String(valeur)}`);
        H.verifierInstanceLibre(dossier);
        fs.mkdirSync(dossier);
        H.verifierInstanceLibre(dossier);
        const f = H.ecrireInstance(dossier, valeur);
        const ecrit = JSON.parse(fs.readFileSync(f, 'utf8'));
        assert.deepStrictEqual(ecrit, { 'extensions.autoUpdate': valeur, ...H.REGLAGES_INSTANCE_FIXES }, 'même valeur que la VS Code principale');
        assert.throws(() => H.verifierInstanceLibre(dossier), (e: Error) => e instanceof S.Refus && /existe et n'est pas vide/.test(e.message) && /Remove-Item -Recurse -Force "\$env:TEMP\\vscode-canari"/.test(e.message));
        assert.throws(() => H.ecrireInstance(dossier, valeur), S.Refus);
        assert.ok(fs.existsSync(f), 'le lanceur ne supprime jamais le dossier');
      }
      const refuse = path.join(racine, 'refuse');
      assert.throws(() => H.ecrireInstance(refuse, 'on'), S.Refus);
      assert.ok(!fs.existsSync(refuse), 'une valeur refusée n\'écrit rien');
    } finally {
      supprimer(racine);
    }
    const fin: string[] = H.gestesFinH14({ dossierInstance: 'X:\\tmp\\vscode-canari' });
    assert.match(fin[0], /Rétablis la mise à jour automatique des extensions .*« Extensions: Enable Auto Update for Extensions »/);
    assert.ok(fin.some((l) => l.includes('X:\\tmp\\vscode-canari')));
    assert.match(P.GESTE_DEBUT_H14, /« Extensions: Disable Auto Update for Extensions », qui écrit extensions\.autoUpdate sur "off" ; false est aussi accepté/);
  });

  test('5. Attendus de H14 (Q2) : déduits de l\'appel 4a de la baseline, sans MCP ni plugin, marqués « deduit »', () => {
    assert.strictEqual(ATTENDUS.confiance, 'deduit');
    assert.match(ATTENDUS.source, /^baseline-\d{4}-\d{2}-\d{2}\.json, appel 4a$/);
    assert.deepStrictEqual([ATTENDUS.vus.length, ATTENDUS.non_vus.length, ATTENDUS.non_couverts.length], [22, 11, 0]);
    const proprietaires = H.canarisDeLInventaire(INVENTAIRE);
    for (const c of [...ATTENDUS.vus, ...ATTENDUS.non_vus]) {
      const [jeu, cible] = proprietaires.get(c).split('/');
      assert.ok(P.JEUX_H14.includes(jeu) && cible !== 'plugin', c);
    }
    assert.ok(ATTENDUS.vus.includes('CANARI-CC-HOOK-C2QM') && ATTENDUS.non_vus.includes('CANARI-CC-IMP5-569U'));
    assert.ok(![...ATTENDUS.vus, ...ATTENDUS.non_vus].some((c: string) => /MCP|PLUG/.test(c)));
    assert.throws(() => H.attendusH14({ baseline: { entrees: [] }, nomBaseline: 'baseline-x.json', inventaire: INVENTAIRE, jeux: P.JEUX_H14 }), /aucune entrée « canari » de l'appel 4a/);
  });

  test('6. Transcription (P2, Q5) : relevé valide ; tout appel d\'outil, plusieurs appels ou une réponse illisible l\'invalident ; aucun texte recopié', () => {
    const v = H.verifierTranscriptions([transcription({ canaris: ['CANARI-CC-GLOB-XJ6U', 'CANARI-CC-IMP5-569U', 'CANARI-ZZ-INCONNU-0000'] })], { canarisConnus: CONNUS, attendus: ATTENDUS });
    assert.strictEqual(v.releve_canaris.valide, true, v.releve_canaris.raisons.join(' ; '));
    assert.deepStrictEqual([v.transcriptions, v.appels_modele, v.invites, v.lignes_illisibles], [1, 1, 1, 1]);
    assert.deepStrictEqual(v.versions, ['2.1.322']);
    assert.deepStrictEqual(v.reponse.canaris, ['CANARI-CC-GLOB-XJ6U', 'CANARI-CC-IMP5-569U']);
    assert.strictEqual(v.reponse.chaines_inconnues, 1);
    assert.deepStrictEqual(v.comparaison.inattendus, ['CANARI-CC-IMP5-569U']);
    assert.strictEqual(v.comparaison.conformes.length, 1);
    assert.strictEqual(v.comparaison.manquants.length, ATTENDUS.vus.length - 1);
    const texte = JSON.stringify(v);
    assert.ok(!texte.includes(SECRET_INVITE) && !texte.includes(SECRET_REPONSE), 'aucun texte de message dans le résultat');
    // Un appel d'outil invalide le relevé (sans relance)
    const o = H.verifierTranscriptions([transcription({ outils: ['Read'] })], { canarisConnus: CONNUS, attendus: ATTENDUS });
    assert.strictEqual(o.releve_canaris.valide, false);
    assert.ok(o.releve_canaris.raisons.some((r: string) => /appel d'outil dans le panneau \(Read\) : relevé des canaris invalide, sans relance/.test(r)));
    assert.deepStrictEqual(o.outils, [{ nom: 'Read', nombre: 1 }]);
    // Deux appels au modèle, réponse illisible, rien
    assert.ok(H.verifierTranscriptions([transcription({ requetes: ['r1', 'r2'] })], { canarisConnus: CONNUS, attendus: ATTENDUS }).releve_canaris.raisons.some((r: string) => /2 appel\(s\) au modèle/.test(r)));
    assert.ok(H.verifierTranscriptions([transcription({ reponse: 'pas de JSON' })], { canarisConnus: CONNUS, attendus: ATTENDUS }).releve_canaris.raisons.some((r: string) => /réponse illisible/.test(r)));
    assert.strictEqual(H.verifierTranscriptions([], { canarisConnus: CONNUS, attendus: ATTENDUS }).releve_canaris.valide, false);
  });

  test('7. Version (précision 2) : la version du panneau est comparée à la copie embarquée mesurée, écart en tête', () => {
    assert.deepStrictEqual(H.ecartVersion(['2.1.322'], '2.1.322').ecart, false);
    const e = H.ecartVersion(['2.1.323'], '2.1.322');
    assert.strictEqual(e.ecart, true);
    assert.match(e.message, /^ÉCART DE VERSION : panneau 2\.1\.323, copie embarquée mesurée par P5b 2\.1\.322$/);
    assert.strictEqual(H.ecartVersion([], '2.1.322').ecart, true);
    assert.strictEqual(H.ecartVersion(['2.1.322', '2.1.323'], '2.1.322').ecart, true);
  });

  test('8. Sessions (précision 1, P4) : liste notée, nouvelles sessions, déplacement sans écrasement, lecture d\'une seule session', () => {
    const racine = tmp('sessions');
    try {
      const config = path.join(racine, 'config');
      const projet = path.join(config, 'projects', MEMOIRE);
      const dest = path.join(racine, 'brut', 'h14-x', H.SOUS_DOSSIER_TRANSCRIPTION);
      ecrire(path.join(projet, 'memory', 'MEMORY.md'), 'fixture');
      ecrire(path.join(projet, `${U2}.jsonl`), transcription());
      const notees: string[] = H.sessionsDuProfil(config, MEMOIRE);
      assert.deepStrictEqual(notees, [U2]);
      assert.strictEqual(H.uuidDe('memory'), null);
      // Le panneau crée une session : fichier et dossier du même identifiant
      ecrire(path.join(projet, `${U1}.jsonl`), transcription({ canaris: ['CANARI-CC-PAR-7A67'] }));
      ecrire(path.join(projet, U1, 'subagents', 'agent.jsonl'), '');
      assert.deepStrictEqual(H.nouvellesSessions({ profil: H.sessionsDuProfil(config, MEMOIRE), notees, deplacees: [] }), [U1]);
      assert.deepStrictEqual(H.nouvellesSessions({ profil: [U2], notees, deplacees: [] }), [], 'aucune nouvelle');
      assert.deepStrictEqual(H.nouvellesSessions({ profil: [U1, U2, 'cccccccc-dddd-4eee-8fff-000000000000'], notees, deplacees: [] }).length, 2, 'plusieurs');
      const textes = H.lireTextesSession(U1, [projet]);
      assert.strictEqual(textes.length, 2, 'le .jsonl de la session et celui de son dossier, rien d\'autre');
      // Déplacement : seule la nouvelle session part, la mémoire et la session notée restent
      assert.deepStrictEqual(H.deplacerTranscriptions({ configDir: config, nomMemoire: MEMOIRE.toLowerCase(), notees, destination: dest }), { fichiers: 1, dossiers: 1 });
      assert.deepStrictEqual(fs.readdirSync(projet).sort(), [`${U2}.jsonl`, 'memory'].sort());
      assert.deepStrictEqual(fs.readdirSync(dest).sort(), [`${U1}.jsonl`, U1].sort());
      assert.deepStrictEqual(H.nouvellesSessions({ profil: H.sessionsDuProfil(config, MEMOIRE), notees, deplacees: H.sessionsDans(dest) }), [U1], 'retrouvée après le déplacement');
      assert.deepStrictEqual(H.deplacerTranscriptions({ configDir: config, nomMemoire: MEMOIRE, notees, destination: dest }), { fichiers: 0, dossiers: 0 }, 'idempotent');
      // Jamais d'écrasement
      ecrire(path.join(projet, `${U1}.jsonl`), 'nouvelle copie');
      assert.throws(() => H.deplacerTranscriptions({ configDir: config, nomMemoire: MEMOIRE, notees, destination: dest }), /déjà présente/);
      assert.strictEqual(fs.readFileSync(path.join(projet, `${U1}.jsonl`), 'utf8'), 'nouvelle copie');
    } finally {
      supprimer(racine);
    }
  });

  test('9. Vérification (précision 1) : exactement une nouvelle transcription, sinon refus sans texte ; P3 classe fixtures, transcription et écarts', () => {
    const racine = tmp('verif');
    try {
      const espace = path.join(racine, 'espace');
      const projet = path.join(espace, 'projet');
      const config = path.join(racine, 'config');
      const brut = path.join(racine, 'brut');
      const nomMemoire = C.nomDossierMemoire(projet);
      const dossierProjet = path.join(config, 'projects', nomMemoire);
      fs.mkdirSync(path.join(dossierProjet, 'memory'), { recursive: true });
      fs.mkdirSync(path.join(config, 'cache'), { recursive: true });
      fs.mkdirSync(projet, { recursive: true });
      const etat = { dossier: 'h14-essai', versions: { poste: '2.1.319', embarquee: '2.1.322' } };
      const dossierEssai = path.join(brut, etat.dossier);
      fs.mkdirSync(dossierEssai, { recursive: true });
      fs.writeFileSync(path.join(dossierEssai, H.FICHIER_PROFIL_AVANT), H.texteProfil(S.listerProfil(config)));
      fs.writeFileSync(path.join(dossierEssai, S.FICHIER_SESSIONS_NOTEES), '');
      // Déploiement simulé : un fichier global et un fichier de mémoire, par le journal
      const journalPath = path.join(brut, 'journal-deploiement.json');
      S.deployer([
        { destination: path.join(config, 'CLAUDE.md'), contenu: 'global' },
        { destination: path.join(config, 'rules', 'g-perm.md'), contenu: 'règle' },
        { destination: path.join(dossierProjet, 'memory', 'MEMORY.md'), contenu: 'mémoire' },
      ], journalPath, [config]);
      const ctx = { configDir: config, espace, projet, journal: journalPath };
      const verifier = () => S.verifierH14Interne(ctx, etat, { brut });
      // Aucune transcription : refus
      assert.throws(verifier, (e: Error) => e instanceof S.Refus && /0 nouvelle\(s\) transcription\(s\) .*exactement une attendue.*aucun texte affiché/.test(e.message));
      // Une seule : vérification, version en tête
      ecrire(path.join(dossierProjet, `${U1}.jsonl`), transcription({ canaris: ['CANARI-CC-GLOB-XJ6U'], version: '2.1.323' }));
      fs.writeFileSync(path.join(config, 'cache', 'modele.json'), 'cache');
      const v = verifier();
      assert.strictEqual(Object.keys(v)[0], 'version', 'la version vient en tête');
      assert.strictEqual(v.version.ecart, true);
      assert.match(v.version.message, /ÉCART DE VERSION : panneau 2\.1\.323, copie embarquée mesurée par P5b 2\.1\.322/);
      assert.strictEqual(v.releve_canaris.valide, true);
      assert.strictEqual(v.profil.deployes, 4, '3 fichiers et le dossier rules/ créé (memory/ existait déjà)');
      assert.deepStrictEqual(v.profil.transcription_attendue, { fichiers: 1, dossiers: 0 });
      assert.strictEqual(v.profil.zones_sonde.ecarts, 0, 'ni les fixtures ni la transcription ne sont des écarts');
      assert.ok(v.profil.hors_zones.some((g: any) => g.groupe === 'cache'), 'hors zones, compté sans rejet');
      assert.ok(!JSON.stringify(v).includes(U1) && !JSON.stringify(v).includes(SECRET_REPONSE), 'ni identifiant de session ni texte');
      // Un fichier ajouté dans la mémoire par le panneau : écart signalé
      fs.writeFileSync(path.join(dossierProjet, 'memory', 'autre.md'), 'écrit par le panneau');
      assert.strictEqual(verifier().profil.zones_sonde.ecarts, 1);
      fs.unlinkSync(path.join(dossierProjet, 'memory', 'autre.md'));
      // Deux nouvelles sessions : refus
      ecrire(path.join(dossierProjet, `${U2}.jsonl`), transcription());
      assert.throws(verifier, /2 nouvelle\(s\) transcription\(s\)/);
      fs.unlinkSync(path.join(dossierProjet, `${U2}.jsonl`));
      // Après le déplacement dans brut/ (retirer), la session est toujours trouvée
      S.deplacerTranscriptionH14({ configDir: config, espace }, etat, brut);
      assert.strictEqual(verifier().releve_canaris.valide, true);
      assert.strictEqual(S.retirer(journalPath).problemes.length, 0);
    } finally {
      supprimer(racine);
    }
  });

  test('10. Profil et rapport : liste relue à l\'identique, rapport H14 seulement dans brut/ et après la garde', () => {
    const liste = new Map([['projects/a b/memory', { type: 'd', taille: 0 }], ['CLAUDE.md', { type: 'f', taille: 12 }]]);
    assert.deepStrictEqual(H.lireProfilTexte(H.texteProfil(liste)), liste);
    assert.throws(() => H.lireProfilTexte('x y\n'), /illisible/);
    assert.strictEqual(H.estTranscription(`projects/${MEMOIRE}/${U1}.jsonl`, MEMOIRE.toLowerCase()), true);
    assert.strictEqual(H.estTranscription(`projects/${MEMOIRE}/${U1}/subagents/a.jsonl`, MEMOIRE), true);
    assert.strictEqual(H.estTranscription(`projects/${MEMOIRE}/memory/MEMORY.md`, MEMOIRE), false);
    assert.strictEqual(H.estTranscription(`projects/autre/${U1}.jsonl`, MEMOIRE), false);
    const racine = tmp('rapport');
    try {
      const dossiers = { brut: path.join(racine, 'brut'), resultats: path.join(racine, 'resultats') };
      const poste = C.lirePoste();
      const f = S.ecrireRapport({ rapport: 'claude-code-h14' }, { destination: 'brut', nom: 'h14-2026-11-10-1200.json', poste, interdits: [], dossiers });
      assert.ok(fs.existsSync(f));
      assert.throws(() => S.ecrireRapport({ rapport: 'claude-code-h14' }, { destination: 'resultats', nom: 'h14-2026-11-10-1200.json', poste, interdits: [], dossiers }), /ne s'écrit que dans brut/);
      assert.throws(() => S.ecrireRapport({ id: U1 }, { destination: 'brut', nom: 'h14-2026-11-10-1201.json', poste, interdits: [], dossiers }), /garde de confidentialité/);
      assert.throws(() => S.ecrireJsonGarde(path.join(racine, 'etat.json'), { chemin: path.join(racine, 'x') }, { poste, interdits: [racine] }), /garde de confidentialité/);
      assert.ok(!fs.existsSync(path.join(racine, 'etat.json')));
    } finally {
      supprimer(racine);
    }
  });
});
