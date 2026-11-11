import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe } from 'node:test';

// Lanceur de la suite d'injection Claude Code (lot I2) : fonctions pures et entrées-sorties sur un
// dossier temporaire. Aucun lancement de claude. Toutes les données sont synthétiques : aucune sortie
// brute de sonde n'est reprise ici, car elles contiennent des données locales.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('node:fs') as typeof import('node:fs');
const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'test', 'scenarios', 'scripts');
const FICHIER_LANCEUR = path.join(SCRIPTS, 'sonde-claude-code.js');
const S = require(FICHIER_LANCEUR);
const C = require(path.join(SCRIPTS, 'sonde-claude-code-commun.js'));

const W = path.win32;
const HOME_W = 'C:\\Users\\exemple-compte';
const ESPACE_W = 'C:\\canari-claude-code\\espace';
const CONFIG_W = 'C:\\Users\\exemple-compte\\AppData\\Local\\canari-claude-code\\config';
const DEPOT_W = 'C:\\Users\\exemple-compte\\Documents\\depot';
const MEMOIRE_W = 'C--canari-claude-code-espace-projet';
const POSTE = { home: HOME_W, compte: 'exemple-compte', hote: 'POSTE-EXEMPLE' };
const SENSIBLES = ['quelqu-un@exemple.org', 'Organisation Exemple', 'org-exemple-123'];

const tmp = (prefixe: string) => fs.mkdtempSync(path.join(os.tmpdir(), `canari-i2-${prefixe}-`));
const supprimer = (d: string) => fs.rmSync(d, { recursive: true, force: true });
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/** Un flux stream-json synthétique de /context (forme relevée en phase 2, valeurs inventées). */
const fluxSynthetique = () => {
  const init = {
    type: 'system', subtype: 'init', cwd: `${ESPACE_W}\\projet`, session_id: 'session-exemple', apiKeySource: 'none',
    claude_code_version: '9.9.9', tools: [], skills: ['canari-p1', 'skill-du-compte'],
    plugins: [{ name: 'canari-plugin', path: `${ESPACE_W}\\plugin\\canari-plugin`, source: 's', version: '1' }, { name: 'plugin-du-compte', path: 'x', source: 's', version: '1' }],
    mcp_servers: [{ name: 'canari-mcp', status: 'connected', source: 'dynamic' }, { name: 'serveur-reel', status: 'connected', source: 'dynamic' }],
    memory_paths: { auto: `${CONFIG_W}\\projects\\${MEMOIRE_W}\\memory` },
  };
  const contextUsage = {
    model: 'claude-opus-5', total_tokens: 3311, raw_max_tokens: 200000, percentage: 1.7,
    categories: [
      { name: 'System prompt', tokens: 3086, kind: 'used' },
      { name: 'Memory files', tokens: 147, kind: 'used' },
      { name: 'Messages', tokens: 8, kind: 'used' },
      { name: 'Free space', tokens: 1000, kind: 'free' },
      { name: 'Catégorie inconnue', tokens: 5, kind: 'used' },
    ],
    memory_files: [
      { path: 'c:/canari-claude-code/ESPACE/projet/CLAUDE.md', type: 'Project', tokens: 42 },
      { path: `${CONFIG_W}\\CLAUDE.md`, type: 'User', tokens: 52 },
      { path: `${CONFIG_W}\\projects\\${MEMOIRE_W}\\memory\\MEMORY.md`, type: 'AutoMem', tokens: 41 },
      { path: 'C:\\ailleurs\\CLAUDE.md', type: 'Project', tokens: 12 },
    ],
    skills: [
      { name: 'canari-p1', source: 'projectSettings', tokens: 29 },
      { name: 'canari-plugin:canari-plug', source: 'plugin', plugin_name: 'canari-plugin', tokens: 35 },
      { name: 'skill-du-compte', source: 'syncedSkills', tokens: 40 },
    ],
    mcp_tools: [
      { name: 'mcp__canari-mcp__canari_outil', server_name: 'canari-mcp', tokens: 0 },
      { name: 'mcp__serveur-reel__outil', server_name: 'serveur-reel', tokens: 7 },
    ],
    agents: [{ name: 'agent-du-compte', tokens: 3 }],
  };
  const zero = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
  const assistant = { type: 'assistant', session_id: 'session-exemple', message: { usage: { ...zero } }, context_usage: contextUsage };
  const result = { type: 'result', subtype: 'success', is_error: false, num_turns: 0, total_cost_usd: 0, session_id: 'session-exemple', usage: { ...zero } };
  return { init, contextUsage, assistant, result };
};
const texteFlux = (parties: object[]) => ['avertissement hors JSON', ...parties.map((p) => JSON.stringify(p)), '{ ligne cassée', ''].join('\r\n');

/** Les fixtures synthétiques de la normalisation. */
const RELS_N = [
  'jeu/projet/CLAUDE.md.fixture',
  'jeu/global/CLAUDE.md.fixture',
  'jeu/global/projects/__projet__/memory/MEMORY.md.fixture',
  'jeu/projet/_claude/rules/p-paths.md.fixture',
  'jeu/projet/_claude/skills/canari-p1/SKILL.md.fixture',
  'jeu/projet/_claude/skills/canari-cache/SKILL.md.fixture',
  'jeu/plugin/canari-plugin/skills/canari-plug/SKILL.md.fixture',
];
const planW = (rels: string[], jeux: string[]) => C.planDeploiement(rels, jeux, { configDir: CONFIG_W, espace: ESPACE_W, fixturesDir: 'C:\\depot\\fixtures' }, W);

describe('Suite de Tests : Lanceur de la sonde Claude Code (lot I2, sans lancer claude)', () => {
  test('1. Conversion des noms et dossier de mémoire (Windows et POSIX, refus au-delà de 200 caractères)', () => {
    assert.strictEqual(C.nomDossierMemoire('C:\\canari-claude-code\\espace\\projet'), MEMOIRE_W);
    assert.strictEqual(C.nomDossierMemoire('/tmp/canari-claude-code/espace/projet'), '-tmp-canari-claude-code-espace-projet');
    assert.strictEqual(C.nomDossierMemoire('D:\\a b\\é_x.y'), 'D--a-b---x-y');
    assert.throws(() => C.nomDossierMemoire(`C:\\${'a'.repeat(250)}`), /trop long/);
    assert.throws(() => C.nomDossierMemoire(''), /vide/);
    assert.deepStrictEqual(C.convertir('niveaux/global/projects/__projet__/memory/MEMORY.md.fixture', MEMOIRE_W), {
      jeu: 'niveaux', cible: 'global', chemin: `projects/${MEMOIRE_W}/memory/MEMORY.md`,
    });
    assert.deepStrictEqual(C.convertir('skills/plugin/canari-plugin/_claude-plugin/plugin.json.fixture'), {
      jeu: 'skills', cible: 'plugin', chemin: 'canari-plugin/.claude-plugin/plugin.json',
    });
  });

  test('2. Plan de déploiement : cibles, collisions, jeux inconnus, MCP rangé par jeu, fichiers générés', () => {
    const rels = [
      'j1/projet/CLAUDE.md.fixture',
      'j1/global/projects/__projet__/memory/MEMORY.md.fixture',
      'j1/parent/_claude/rules/r.md.fixture',
      'j2/projet/CLAUDE.md.fixture',
      'm1/mcp/serveur.json.fixture',
      'm2/mcp/serveur.json.fixture',
      'p1/plugin/canari-plugin/_claude-plugin/plugin.json.fixture',
    ];
    const plan = planW(rels, ['j1', 'p1']);
    assert.deepStrictEqual(plan.map((e: any) => [e.destination, e.normalise]), [
      [`${ESPACE_W}\\projet\\CLAUDE.md`, '<projet>/CLAUDE.md'],
      [`${CONFIG_W}\\projects\\${MEMOIRE_W}\\memory\\MEMORY.md`, '<global>/projects/<memoire>/memory/MEMORY.md'],
      [`${ESPACE_W}\\.claude\\rules\\r.md`, '<parent>/.claude/rules/r.md'],
      [`${ESPACE_W}\\plugin\\canari-plugin\\.claude-plugin\\plugin.json`, '<plugin>/canari-plugin/.claude-plugin/plugin.json'],
    ]);
    assert.strictEqual(plan[0].source, 'C:\\depot\\fixtures\\j1\\projet\\CLAUDE.md.fixture');
    assert.throws(() => planW(rels, ['j1', 'j2']), /collision de chemins : projet:CLAUDE\.md \(j1 et j2\)/);
    assert.throws(() => planW(['a/projet/CLAUDE.md.fixture', 'b/projet/claude.md.fixture'], ['a', 'b']), /collision/, 'collision sans tenir compte de la casse');
    assert.deepStrictEqual(planW(rels, ['m1', 'm2']).map((e: any) => e.destination), [`${ESPACE_W}\\mcp\\m1\\serveur.json`, `${ESPACE_W}\\mcp\\m2\\serveur.json`]);
    assert.throws(() => planW(rels, ['inconnu']), /jeu inconnu/);
    assert.throws(() => planW(rels, ['j1', 'j1']), /deux fois/);
    assert.throws(() => planW(rels, []), /aucun jeu/);
    assert.throws(() => planW(['x/ailleurs/a.md.fixture'], ['x']), /cible inconnue/);

    // Fichiers générés pour le MCP : copie du serveur, définitions, configuration ; contenus en LF
    const espace = path.join(os.tmpdir(), 'canari-i2-espace-fictif');
    const defs: Record<string, object> = {
      m1: { nom: 'canari-a', version: '1', outils: [{ nom: 'canari_o', description: 'd', schema: { type: 'object' } }], env: { CANARI_ENV: 'v' } },
      m2: { nom: 'canari-b', version: '1', outils: [{ nom: 'canari_o', description: 'd', schema: { type: 'object' } }] },
    };
    const planMcp = C.planDeploiement(rels, ['m1', 'm2'], { configDir: path.join(espace, '..', 'config'), espace, fixturesDir: 'F' });
    const lire = (table: Record<string, object>) => (f: string) => (f === 'SERVEUR' ? '// serveur\r\n' : JSON.stringify(table[f.includes('m1') ? 'm1' : 'm2']).replace(/,/g, ',\r\n'));
    /** Inventaire synthétique conforme aux contenus lus (empreintes en LF). */
    const inventaireDe = (table: Record<string, object>) =>
      new Map(planMcp.map((e: any) => [e.rel, { sha256: C.sha256Lf(lire(table)(e.source)), canaris: [] }]));
    const { fichiers, mcpConfig, pluginDir } = S.fichiersADeployer(planMcp, { espace, inventaire: inventaireDe(defs), serveurSource: 'SERVEUR', node: 'NODE', lireTexte: lire(defs) });
    assert.strictEqual(pluginDir, null);
    assert.strictEqual(mcpConfig, path.join(espace, 'mcp', 'mcp-config.json'));
    assert.ok(fichiers.every((f: any) => !f.contenu.includes('\r')), 'contenus en LF');
    const config = JSON.parse(fichiers.find((f: any) => f.destination === mcpConfig).contenu);
    const copie = path.join(espace, 'mcp', 'serveur-fixture.js');
    assert.deepStrictEqual(config, {
      mcpServers: {
        'canari-a': { type: 'stdio', command: 'NODE', args: [copie, planMcp[0].destination], env: { CANARI_ENV: 'v' } },
        'canari-b': { type: 'stdio', command: 'NODE', args: [copie, planMcp[1].destination] },
      },
    });
    assert.ok(fichiers.some((f: any) => f.destination === copie && f.contenu === '// serveur\n'));
    const doublon = { m1: defs.m1, m2: defs.m1 };
    assert.throws(() => S.fichiersADeployer(planMcp, { espace, inventaire: inventaireDe(doublon), serveurSource: 'SERVEUR', lireTexte: lire(doublon) }), /en double/);
    const invalide = { m1: { ...defs.m1, nom: 'vrai-serveur' }, m2: defs.m2 };
    assert.throws(() => S.fichiersADeployer(planMcp, { espace, inventaire: inventaireDe(invalide), serveurSource: 'SERVEUR', lireTexte: lire(invalide) }), /définition MCP invalide/);
    assert.throws(() => S.fichiersADeployer(planMcp, { espace, serveurSource: 'SERVEUR', lireTexte: lire(defs) }), /inventaire absent/);
  });

  test('3. Chemins par défaut, variables CANARI_CLAUDE_* et résolution de l\'exécutable (jamais un .cmd)', () => {
    const win = S.cheminsParDefaut({ env: { localappdata: `${HOME_W}\\AppData\\Local`, SystemDrive: 'D:' }, plateforme: 'win32', home: HOME_W });
    assert.deepStrictEqual(win, { configDir: CONFIG_W, espace: 'D:\\canari-claude-code\\espace' });
    assert.deepStrictEqual(S.cheminsParDefaut({ env: {}, plateforme: 'win32', home: HOME_W }), { configDir: CONFIG_W, espace: ESPACE_W });
    assert.deepStrictEqual(
      S.cheminsParDefaut({ env: { CANARI_CLAUDE_CONFIG_DIR: 'E:\\profil\\', CANARI_CLAUDE_ESPACE: 'E:\\esp' }, plateforme: 'win32', home: HOME_W }),
      { configDir: 'E:\\profil', espace: 'E:\\esp' },
    );
    assert.throws(() => S.cheminsParDefaut({ env: { CANARI_CLAUDE_ESPACE: 'relatif\\esp' }, plateforme: 'win32', home: HOME_W }), S.Refus);
    assert.deepStrictEqual(S.cheminsParDefaut({ env: {}, plateforme: 'linux', home: '/home/exemple' }), {
      configDir: '/home/exemple/.local/share/canari-claude-code/config', espace: '/tmp/canari-claude-code/espace',
    });

    const voisin = 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
    const existe = (liste: string[]) => (f: string) => liste.includes(f);
    assert.strictEqual(S.resoudreExe({ env: { Path: 'C:\\a;"C:\\npm"' }, plateforme: 'win32', existe: existe(['C:\\npm\\claude.cmd', voisin]) }), voisin);
    assert.strictEqual(S.resoudreExe({ env: { PATH: 'C:\\a;C:\\npm' }, plateforme: 'win32', existe: existe(['C:\\a\\claude.exe', voisin]) }), 'C:\\a\\claude.exe');
    assert.throws(() => S.resoudreExe({ env: { PATH: 'C:\\npm' }, plateforme: 'win32', existe: existe(['C:\\npm\\claude.cmd']) }), S.Refus);
    assert.throws(() => S.resoudreExe({ env: { CANARI_CLAUDE_EXE: 'C:\\x\\claude.cmd', PATH: '' }, plateforme: 'win32', existe: () => true }), /\.exe/);
    assert.throws(() => S.resoudreExe({ env: { CANARI_CLAUDE_EXE: 'claude.exe' }, plateforme: 'win32', existe: () => true }), /absolu/);
    assert.strictEqual(S.resoudreExe({ env: { CANARI_CLAUDE_EXE: 'C:\\x\\claude.exe' }, plateforme: 'win32', existe: () => true }), 'C:\\x\\claude.exe');
    assert.strictEqual(S.resoudreExe({ env: { PATH: '/usr/bin:/opt/c' }, plateforme: 'linux', existe: existe(['/opt/c/claude']) }), '/opt/c/claude');
  });

  test('4. Environnement nettoyé : liste blanche du système, aucune variable CLAUDE* ni ANTHROPIC*, deux variables posées', () => {
    const parent = {
      PATH: 'p', HOME: 'h', SystemRoot: 's', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', claude_pid: '3', CLAUDE_CODE_USE_BEDROCK: '1',
      ANTHROPIC_API_KEY: 'k', Anthropic_Base_Url: 'u', CLAUDE_CONFIG_DIR: 'autre', DISABLE_AUTOUPDATER: '0', disable_autoupdater: '0',
    };
    const avant = clone(parent);
    for (const [plateforme, attendus] of [['win32', ['CLAUDE_CONFIG_DIR', 'DISABLE_AUTOUPDATER', 'PATH', 'SystemRoot']], ['linux', ['CLAUDE_CONFIG_DIR', 'DISABLE_AUTOUPDATER', 'HOME', 'PATH']]] as [string, string[]][]) {
      const env = S.environnementNettoye(parent, CONFIG_W, plateforme);
      assert.deepStrictEqual(Object.keys(env).sort(), attendus, plateforme);
      assert.strictEqual(env.CLAUDE_CONFIG_DIR, CONFIG_W);
      assert.strictEqual(env.DISABLE_AUTOUPDATER, '1');
      assert.deepStrictEqual(S.problemesEnvironnement(env, CONFIG_W, plateforme), [], plateforme);
    }
    assert.deepStrictEqual(parent, avant, "l'environnement du parent n'est pas modifié");
    const env = S.environnementNettoye(parent, CONFIG_W, 'win32');
    for (const ajout of [{ ANTHROPIC_AUTH_TOKEN: 'x' }, { anthropic_api_key: 'x' }, { CLAUDE_CODE_USE_VERTEX: '1' }, { CLAUDE_CONFIG_DIR: HOME_W }, { DISABLE_AUTOUPDATER: '0' }]) {
      assert.ok(S.problemesEnvironnement({ ...env, ...ajout }, CONFIG_W, 'win32').length > 0, JSON.stringify(Object.keys(ajout)));
    }
  });

  test('5. Préconditions de l\'espace : dossier personnel, dépôt, profil, fichiers d\'instructions parents, espace non vide', () => {
    const base = { home: HOME_W, depot: DEPOT_W, configDir: CONFIG_W, plateforme: 'win32', existe: () => false, lister: () => [] };
    assert.deepStrictEqual(S.problemesEspace(ESPACE_W, base), []);
    assert.match(S.problemesEspace('c:\\users\\EXEMPLE-COMPTE\\canari\\espace', base).join(), /dossier personnel/);
    assert.match(S.problemesEspace('C:\\Users', base).join(), /dossier personnel/, "l'espace ne doit pas contenir le dossier personnel");
    assert.match(S.problemesEspace(`${CONFIG_W}\\espace`, { ...base, home: 'D:\\autre' }).join(), /se recouvrent/);
    assert.match(S.problemesEspace(`${DEPOT_W}\\espace`, { ...base, home: 'D:\\autre' }).join(), /dépôt/);
    const parents = S.problemesEspace(ESPACE_W, { ...base, existe: (f: string) => ['C:\\canari-claude-code\\AGENTS.md', 'C:\\.claude'].includes(f) });
    assert.deepStrictEqual(parents, [
      "AGENTS.md présent dans un dossier parent de l'espace (1 niveau au-dessus)",
      ".claude présent dans un dossier parent de l'espace (2 niveaux au-dessus)",
    ]);
    for (const nom of ['CLAUDE.md', 'CLAUDE.local.md']) {
      assert.strictEqual(S.problemesEspace(ESPACE_W, { ...base, existe: (f: string) => f === `C:\\${nom}` }).length, 1, nom);
    }
    const contenu = (table: Record<string, string[]>) => ({ ...base, existe: (f: string) => f === ESPACE_W, lister: (d: string) => table[d] ?? [] });
    assert.deepStrictEqual(S.problemesEspace(ESPACE_W, contenu({ [ESPACE_W]: [] })), []);
    assert.deepStrictEqual(S.problemesEspace(ESPACE_W, contenu({ [ESPACE_W]: ['projet'] })), []);
    assert.match(S.problemesEspace(ESPACE_W, contenu({ [ESPACE_W]: ['projet', 'CLAUDE.md'] })).join(), /pas vide/);
    assert.match(S.problemesEspace(ESPACE_W, contenu({ [ESPACE_W]: ['projet'], [`${ESPACE_W}\\projet`]: ['x'] })).join(), /pas vide/);
  });

  test('5b. Préconditions du profil isolé : settings.json et settings.local.json refusés à sa racine, jamais ouverts (point 25)', () => {
    const vus: string[] = [];
    const existe = (liste: string[]) => (f: string) => {
      vus.push(f);
      return liste.includes(f);
    };
    assert.deepStrictEqual(S.REGLAGES_PROFIL_INTERDITS, ['settings.json', 'settings.local.json']);
    assert.deepStrictEqual(S.problemesProfil(CONFIG_W, { plateforme: 'win32', existe: existe([]) }), []);
    assert.deepStrictEqual(vus, [`${CONFIG_W}\\settings.json`, `${CONFIG_W}\\settings.local.json`], 'seule la présence est contrôlée, à la racine');
    for (const nom of ['settings.json', 'settings.local.json']) {
      const pb = S.problemesProfil(CONFIG_W, { plateforme: 'win32', existe: existe([`${CONFIG_W}\\${nom}`]) });
      assert.strictEqual(pb.length, 1, nom);
      assert.match(pb[0], new RegExp(`^${nom.replace(/\./g, '\\.')} présent à la racine du profil isolé`));
      assert.ok(!pb[0].includes(CONFIG_W), 'le message ne contient pas le chemin du profil');
    }
    assert.strictEqual(S.problemesProfil(CONFIG_W, { plateforme: 'win32', existe: existe([`${CONFIG_W}\\settings.json`, `${CONFIG_W}\\settings.local.json`]) }).length, 2);
    // Un réglage ailleurs que la racine (par exemple dans projects/) n'est pas visé
    assert.deepStrictEqual(S.problemesProfil(CONFIG_W, { plateforme: 'win32', existe: existe([`${CONFIG_W}\\projects\\settings.json`]) }), []);
    assert.deepStrictEqual(S.problemesProfil('/home/exemple/profil', { plateforme: 'linux', existe: existe(['/home/exemple/profil/settings.local.json']) }).length, 1);

    // Le contrôle est appelé avant toute série (etat, context, payant, préparation de H14), pas à la vérification ni à la clôture de H14
    const source = fs.readFileSync(FICHIER_LANCEUR, 'utf8');
    const corps = (nom: string) => {
      const debut = source.indexOf(`async function ${nom}(`);
      assert.ok(debut >= 0, nom);
      const fin = source.indexOf('\nasync function ', debut + 1);
      return source.slice(debut, fin < 0 ? undefined : fin);
    };
    assert.match(source, /const pbProfil = problemesProfil\(configDir/);
    assert.match(corps('commandeEtat'), /\.\.\.ctx\.pbProfil/);
    for (const nom of ['commandeContext', 'commandePayant', 'commandePreparerH14']) assert.match(corps(nom), /if \(ctx\.pbProfil\.length > 0\) throw new Refus/, nom);
    for (const nom of ['commandeVerifierH14', 'commandeCloturerH14']) assert.doesNotMatch(corps(nom), /pbProfil/, nom);
  });

  test('6. État d\'authentification : claude.ai, firstParty, abonnement et profil isolé ; valeurs sensibles extraites', () => {
    const ok = {
      loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'team',
      email: SENSIBLES[0], orgName: SENSIBLES[1], orgId: SENSIBLES[2],
      configDirectory: 'c:/users/exemple-compte/appdata/local/canari-claude-code/config',
    };
    const { problemes, sensibles } = S.problemesAuth(ok, CONFIG_W, 'win32');
    assert.deepStrictEqual(problemes, []);
    for (const v of [...SENSIBLES, ok.configDirectory]) assert.ok(sensibles.includes(v), 'valeur sensible extraite');
    for (const v of ['claude.ai', 'firstParty', 'team']) assert.ok(!sensibles.includes(v), `${v} n'est pas sensible`);
    for (const abonnement of ['pro', 'max', 'enterprise']) assert.deepStrictEqual(S.problemesAuth({ ...ok, subscriptionType: abonnement }, CONFIG_W, 'win32').problemes, []);
    const refus: object[] = [
      { authMethod: 'console' }, { authMethod: 'none' }, { apiProvider: 'bedrock' }, { loggedIn: false }, { loggedIn: 'true' },
      { subscriptionType: null }, { subscriptionType: 'free' }, { configDirectory: `${HOME_W}\\.claude` }, { configDirectory: undefined },
      { apiKeySource: 'ANTHROPIC_API_KEY' },
    ];
    for (const r of refus) assert.ok(S.problemesAuth({ ...ok, ...r }, CONFIG_W, 'win32').problemes.length > 0, JSON.stringify(r));
    assert.deepStrictEqual(S.problemesAuth(null, CONFIG_W, 'win32').problemes, ['état de connexion illisible']);
  });

  test('7. Refus de tout -p autre que /context, liste blanche des arguments, chemins MCP et plugin sous l\'espace', () => {
    assert.strictEqual(S.verifierPrompt('/context'), '/context');
    assert.strictEqual(S.verifierPrompt('/context all'), '/context all');
    for (const p of ['/context ', ' /context', '/contexts', '/context; echo x', '/context all x', '/CONTEXT', '/compact', 'Réponds seulement : OK', '', null, 42]) {
      assert.throws(() => S.verifierPrompt(p), S.RefusArgv, String(p));
    }
    const attendu = ['-p', '/context', '--model', 'claude-opus-5', '--effort', 'high', '--output-format', 'stream-json', '--verbose',
      '--tools', '', '--no-session-persistence', '--strict-mcp-config'];
    assert.deepStrictEqual(S.argumentsContext({ outils: '' }), attendu);
    assert.throws(() => S.argumentsContext({ prompt: 'Réponds seulement : OK' }), S.RefusArgv);
    assert.throws(() => S.argumentsContext({ outils: 'Bash;rm' }), S.RefusArgv);

    const opts = { espace: ESPACE_W, plateforme: 'win32' };
    assert.strictEqual(S.verifierArgv(['--version'], opts), 'version');
    assert.strictEqual(S.verifierArgv(['auth', 'status', '--json'], opts), 'auth');
    assert.strictEqual(S.verifierArgv(attendu, opts), 'context');
    const complet = S.argumentsContext({ prompt: '/context all', outils: 'Skill', mcpConfig: `${ESPACE_W}\\mcp\\mcp-config.json`, pluginDir: 'c:/CANARI-CLAUDE-CODE/espace/plugin/canari-plugin', hookEvents: true });
    assert.strictEqual(S.verifierArgv(complet, opts), 'context', 'casse et séparateurs différents, sous l\'espace');

    const refuses: string[][] = [
      ['-p', 'Réponds seulement : OK', ...attendu.slice(2)],
      ['--print', '/context', ...attendu.slice(2)],
      [...attendu, 'bonjour'],
      [...attendu, '--resume', 'x'],
      [...attendu, '-c'],
      [...attendu, '--input-format', 'stream-json'],
      [...attendu, '--tools', 'Skill'],
      attendu.map((a) => (a === 'claude-opus-5' ? 'autre-modele' : a)),
      attendu.map((a) => (a === 'stream-json' ? 'json' : a)),
      attendu.filter((a) => a !== '--strict-mcp-config'),
      ['auth', 'login'],
      ['auth', 'status'],
      [],
    ];
    for (const argv of refuses) assert.throws(() => S.verifierArgv(argv, opts), S.RefusArgv, argv.join(' '));
    const horsEspace = [
      `${HOME_W}\\mcp.json`,
      'mcp\\mcp-config.json',
      ESPACE_W,
      `${ESPACE_W}\\..\\autre\\mcp.json`,
      'C:\\canari-claude-code\\espace-bis\\mcp.json',
      'D:\\canari-claude-code\\espace\\mcp.json',
    ];
    for (const option of ['--mcp-config', '--plugin-dir']) {
      for (const chemin of horsEspace) {
        assert.throws(() => S.verifierArgv([...attendu, option, chemin], opts), /doit être sous l'espace/, `${option} ${chemin}`);
      }
      assert.throws(() => S.verifierArgv([...attendu, option], opts), S.RefusArgv, `${option} sans valeur`);
    }

    // Par construction : un seul spawn, après verifierArgv, sans shell ; aucun chemin du poste
    const source = fs.readFileSync(FICHIER_LANCEUR, 'utf8');
    assert.doesNotMatch(source, /shell:\s*true/);
    assert.doesNotMatch(source, /\bexec(?:Sync|File|FileSync)?\(/);
    assert.strictEqual(source.match(/\bspawn\(/g)?.length, 1);
    const lancer = source.slice(source.indexOf('function lancerClaude('));
    assert.ok(lancer.indexOf('verifierArgv(argv') < lancer.indexOf('spawn(exe'), 'verifierArgv avant spawn');
    assert.ok(lancer.indexOf('verifierArret(') < lancer.indexOf('spawn(exe'), 'fichier ARRET vérifié avant spawn');
    assert.deepStrictEqual([...source.matchAll(/spawnSync\(\s*'([^']+)'/g)].map((m) => m[1]).sort(), ['powershell.exe', 'ps', 'taskkill']);
    assert.doesNotMatch(source, /[A-Za-z]:\\\\[A-Za-z]/, 'aucun chemin de lecteur en dur');
    const poste = C.lirePoste();
    assert.deepStrictEqual(C.problemesTexte(source, { ...poste, home: poste.home }).filter((p: string) => !/chemin personnel/.test(p)), []);
  });

  test('8. Lecture du flux stream-json : initialisation, context_usage, résultat, lignes illisibles', () => {
    const f = fluxSynthetique();
    const flux = S.lireFlux(texteFlux([f.init, f.assistant, f.result]));
    assert.strictEqual(flux.init.apiKeySource, 'none');
    assert.deepStrictEqual(flux.contextUsage, f.contextUsage);
    assert.strictEqual(flux.result.num_turns, 0);
    assert.strictEqual(flux.nombreResults, 1);
    assert.strictEqual(flux.illisibles, 2);
    const sans = S.lireFlux(texteFlux([f.init, f.result]));
    assert.strictEqual(sans.contextUsage, null);
    assert.strictEqual(S.lireFlux('').init, null);
  });

  test('9. Contrôles après un /context : usage nul accepté, chaque cause d\'arrêt définitif détectée', () => {
    const f = fluxSynthetique();
    const lire = (modifier: (p: any) => void) => {
      const p: any = clone(f);
      modifier(p);
      return S.lireFlux(texteFlux([p.init, p.assistant, p.result, ...(p.second ? [p.result] : [])].filter(Boolean)));
    };
    assert.deepStrictEqual(S.controlerAppel(lire(() => undefined), { versionAttendue: '9.9.9' }), { arret: [], autres: [], ok: true });
    const arrets: [string, (p: any) => void][] = [
      ['input_tokens', (p) => (p.result.usage.input_tokens = 1)],
      ['cache_creation_input_tokens', (p) => (p.result.usage.cache_creation_input_tokens = 1)],
      ['cache_read_input_tokens', (p) => (p.result.usage.cache_read_input_tokens = 3648)],
      ['output_tokens', (p) => (p.result.usage.output_tokens = 2)],
      ['usage absent', (p) => delete p.result.usage],
      ['num_turns', (p) => (p.result.num_turns = 1)],
      ['apiKeySource', (p) => (p.init.apiKeySource = 'ANTHROPIC_API_KEY')],
      ['init absent', (p) => (p.init = null)],
      ['résultat absent', (p) => (p.result = null)],
      ['coût', (p) => (p.result.total_cost_usd = 0.03)],
      ['deux résultats', (p) => (p.second = true)],
      ['usage du message', (p) => (p.assistant.message.usage.output_tokens = 3)],
    ];
    for (const [nom, modifier] of arrets) assert.ok(S.controlerAppel(lire(modifier), { versionAttendue: '9.9.9' }).arret.length > 0, nom);
    const autres: [string, (p: any) => void][] = [
      ['context_usage absent', (p) => delete p.assistant.context_usage],
      ['erreur', (p) => (p.result.is_error = true)],
    ];
    for (const [nom, modifier] of autres) {
      const c = S.controlerAppel(lire(modifier), { versionAttendue: '9.9.9' });
      assert.ok(c.arret.length === 0 && c.autres.length > 0 && !c.ok, nom);
    }
    const version = S.controlerAppel(lire(() => undefined), { versionAttendue: '1.0.0' });
    assert.deepStrictEqual([version.arret, version.autres.length], [[], 1]);
  });

  test('10. Fichier ARRET et compteur persistant : refus au plafond, série trop longue refusée avant tout appel', () => {
    const brut = tmp('brut');
    try {
      assert.deepStrictEqual(S.lireCompteur(brut, 'context', 'E1'), { lot: 'E1', plafond: 60, utilises: 0 });
      S.verifierBudget(brut, 60, 'E1');
      assert.throws(() => S.verifierBudget(brut, 61, 'E1'), S.Refus);
      assert.strictEqual(S.reserverContext(brut, 'E1'), 1);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(brut, S.FICHIER_COMPTEUR), 'utf8')), { lot: 'E1', plafond: 60, utilises: 1 });
      fs.writeFileSync(path.join(brut, S.FICHIER_COMPTEUR), JSON.stringify({ lot: 'E1', plafond: 60, utilises: 59 }));
      assert.strictEqual(S.reserverContext(brut, 'E1'), 60);
      assert.throws(() => S.reserverContext(brut, 'E1'), S.Arret);
      assert.throws(() => S.verifierBudget(brut, 1, 'E1'), S.Refus);
      fs.writeFileSync(path.join(brut, S.FICHIER_COMPTEUR), JSON.stringify({ lot: 'I2', plafond: 50, utilises: 0 }));
      assert.throws(() => S.lireCompteur(brut, 'context', 'E1'), S.Arret, 'compteur d\'un autre lot');
      fs.writeFileSync(path.join(brut, S.FICHIER_COMPTEUR), JSON.stringify({ lot: 'E1', plafond: 500, utilises: 0 }));
      assert.throws(() => S.lireCompteur(brut, 'context', 'E1'), S.Arret, 'plafond modifié');
      assert.throws(() => S.lireCompteur(brut, 'context', 'I2'), S.Refus, 'lot inconnu');
      fs.writeFileSync(path.join(brut, S.FICHIER_COMPTEUR), JSON.stringify({ lot: 'E1', plafond: 60, utilises: 3 }));

      // lancerClaude refuse avant tout lancement, sans toucher au compteur
      const env = S.environnementNettoye({ PATH: 'p' }, CONFIG_W);
      const appel = (argv: string[], e = env) => () => S.lancerClaude({ exe: path.join(brut, 'inexistant.exe'), argv, env: e, cwd: brut, espace: ESPACE_W, configDir: CONFIG_W, dossierBrut: brut, plateforme: 'win32' });
      assert.throws(appel(['-p', 'Réponds seulement : OK', '--tools', '']), S.RefusArgv);
      assert.throws(appel(S.argumentsContext({}), { ...env, ANTHROPIC_API_KEY: 'k' }), /environnement non conforme/);
      S.ecrireArret(brut, 'essai');
      assert.ok(fs.existsSync(path.join(brut, S.FICHIER_ARRET)));
      assert.throws(() => S.verifierArret(brut), S.Arret);
      assert.throws(appel(['--version']), S.Arret, 'ARRET bloque même --version');
      assert.throws(appel(S.argumentsContext({})), S.Arret);
      assert.strictEqual(S.lireCompteur(brut, 'context', 'E1').utilises, 3, 'aucun appel compté');
    } finally {
      supprimer(brut);
    }
  });

  test('11. Normalisation : chemins réécrits, fixtures par leur nom, le reste en totaux, fixtures absentes', () => {
    const f = fluxSynthetique();
    const flux = S.lireFlux(texteFlux([f.init, f.assistant, f.result]));
    const racines = S.racinesNormalisation({ configDir: CONFIG_W, espace: ESPACE_W }, W);
    const entree = S.normaliserCombinaison(flux, { racines, nomMemoire: MEMOIRE_W, plan: planW(RELS_N, ['jeu']), plateforme: 'win32' });
    assert.deepStrictEqual(entree.memory_files, [
      { chemin: '<projet>/CLAUDE.md', type: 'Project', tokens: 42 },
      { chemin: '<global>/CLAUDE.md', type: 'User', tokens: 52 },
      { chemin: '<global>/projects/<memoire>/memory/MEMORY.md', type: 'AutoMem', tokens: 41 },
    ]);
    assert.deepStrictEqual(entree.skills, [
      { name: 'canari-p1', source: 'projectSettings', tokens: 29 },
      { name: 'canari-plugin:canari-plug', source: 'plugin', plugin: 'canari-plugin', tokens: 35 },
    ]);
    assert.deepStrictEqual(entree.mcp_tools, [{ name: 'mcp__canari-mcp__canari_outil', server: 'canari-mcp', tokens: 0 }]);
    assert.deepStrictEqual(entree.hors_fixtures, {
      categories_hors: { nombre: 1, tokens: 5 }, memoire_hors: { nombre: 1, tokens: 12 }, skills_hors: { nombre: 1, tokens: 40 },
      outils_mcp_hors: { nombre: 1, tokens: 7 }, agents_hors: { nombre: 1, tokens: 3 },
    });
    assert.deepStrictEqual(entree.categories.map((c: any) => c.nom), ['System prompt', 'Memory files', 'Messages', 'Free space']);
    assert.deepStrictEqual(entree.fixtures_absentes, ['<projet>/.claude/rules/p-paths.md', 'skill canari-cache']);
    assert.deepStrictEqual(entree.init, {
      nombre_outils: 0, nombre_skills: 2, nombre_plugins: 2,
      skills: ['canari-p1'], plugins: [{ name: 'canari-plugin' }], mcp_servers: [{ name: 'canari-mcp', statut: 'connected' }],
    });
    const texte = JSON.stringify(entree);
    for (const interdit of ['session', 'cwd', 'memory_paths', 'du-compte', 'serveur-reel', 'ailleurs', ':\\', 'C--']) assert.ok(!texte.includes(interdit), interdit);

    assert.strictEqual(S.reecrireChemin('C:\\canari-claude-code\\espace-bis\\CLAUDE.md', racines, MEMOIRE_W, 'win32'), null);
    assert.strictEqual(S.reecrireChemin(`${ESPACE_W}\\plugin\\canari-plugin\\x.md`, racines, MEMOIRE_W, 'win32'), '<plugin>/canari-plugin/x.md');
    assert.strictEqual(S.reecrireChemin(`${ESPACE_W}\\CLAUDE.md`, racines, MEMOIRE_W, 'win32'), '<parent>/CLAUDE.md');
    const posix = S.racinesNormalisation({ configDir: '/home/exemple/cfg', espace: '/tmp/e' }, path.posix);
    assert.strictEqual(S.reecrireChemin('/tmp/e/projet/CLAUDE.md', posix, 'n', 'linux'), '<projet>/CLAUDE.md');
    assert.strictEqual(S.reecrireChemin('/tmp/E/projet/CLAUDE.md', posix, 'n', 'linux'), null, 'casse respectée hors Windows');
  });

  test('12. Garde avant l\'écriture : rapport exemple écrit, fuite ou nom hors liste refusés sans rien écrire', () => {
    const brut = tmp('rapport-brut');
    const resultats = tmp('rapport-resultats');
    const dossiers = { brut, resultats };
    const interdits = [...SENSIBLES, ESPACE_W, CONFIG_W, MEMOIRE_W];
    try {
      const f = fluxSynthetique();
      const entree = S.normaliserCombinaison(S.lireFlux(texteFlux([f.init, f.assistant, f.result])), {
        racines: S.racinesNormalisation({ configDir: CONFIG_W, espace: ESPACE_W }, W), nomMemoire: MEMOIRE_W, plan: planW(RELS_N, ['jeu']), plateforme: 'win32',
      });
      const rapport = {
        rapport: 'claude-code-context', format: 1, lot: 'I2',
        environnement: { outil: 'Claude Code', version_avant: '9.9.9', methode: 'claude.ai', abonnement: 'team', date_mesure: '2026-01-01' },
        serie: { valide: true, raisons_rejet: [] },
        bases: { vide: { debut: entree, fin: entree, identiques: true } },
        combinaisons: [{ id: 'jeu', jeux: ['jeu'], outils: 'vide', ...entree }],
        profil: { zones_sonde: { ecarts: 1, en_cause: [{ zone: 'segment « canari »', nombre: 1, ajoutes: 1, modifies: 0, retires: 0, chemins: ['skills/canari-x/SKILL.md'] }] }, hors_zones: [{ groupe: 'cache', nombre: 1, ajoutes: 0, modifies: 1, retires: 0 }] },
      };
      const ecrit = S.ecrireRapport(rapport, { destination: 'brut', nom: 'context-2026-01-01-0000.json', poste: POSTE, interdits, dossiers });
      assert.strictEqual(path.dirname(ecrit), brut);
      assert.deepStrictEqual(C.garder('resultats/context.json', fs.readFileSync(ecrit, 'utf8'), POSTE, interdits), [], 'le rapport passe aussi la garde d\'I1');
      assert.throws(() => S.ecrireRapport(rapport, { destination: 'brut', nom: 'context-2026-01-01-0000.json', poste: POSTE, interdits, dossiers }), /EEXIST/);

      const fuites: object[] = [
        { ...rapport, note: 'organisation exemple' },
        { ...rapport, note: SENSIBLES[0] },
        { ...rapport, note: 'org-exemple-123' },
        { ...rapport, note: `${HOME_W}\\x` },
        { ...rapport, note: 'c:/users/exemple-compte/x' },
        { ...rapport, note: 'POSTE-EXEMPLE' },
        { ...rapport, note: `projects/${MEMOIRE_W}` },
        { ...rapport, skills: [{ name: 'vrai-skill', tokens: 1 }] },
        { ...rapport, mcp_servers: [{ name: 'serveur-reel' }] },
        { ...rapport, session_id: 'x' },
      ];
      for (const r of fuites) {
        assert.throws(() => S.ecrireRapport(r, { destination: 'resultats', nom: 'context-2026-01-01-0001.json', poste: POSTE, interdits, dossiers }), /garde de confidentialité/);
      }
      assert.deepStrictEqual(fs.readdirSync(resultats), [], 'rien n\'est écrit');
      assert.throws(() => S.ecrireRapport(rapport, { destination: 'attendu', nom: 'context-2026-01-01-0002.json', poste: POSTE, interdits, dossiers }), /destination/);
      assert.throws(() => S.ecrireRapport(rapport, { destination: 'brut', nom: '../context-2026-01-01-0002.json', poste: POSTE, interdits, dossiers }), /nom de rapport/);
      // Une valeur sensible est reconnue avec les antislashs doublés d'un JSON
      assert.ok(C.problemesTexte('"C:\\\\canari-claude-code\\\\espace"', { home: 'D:\\x', compte: 'zz', hote: 'yy' }, [ESPACE_W]).some((p: string) => /valeur sensible/.test(p)));
    } finally {
      supprimer(brut);
      supprimer(resultats);
    }
  });

  test('13. Profil isolé : liste sans jamais ouvrir .credentials.json ; hors des zones de la sonde, écarts comptés par premier segment, sans nom ni rejet', () => {
    const profil = tmp('profil');
    const ouverts: string[] = [];
    const originaux = { readFileSync: fs.readFileSync, openSync: fs.openSync, readFile: fs.readFile, createReadStream: fs.createReadStream };
    try {
      fs.writeFileSync(path.join(profil, '.claude.json'), '{}');
      fs.writeFileSync(path.join(profil, '.credentials.json'), 'secret-synthetique');
      fs.mkdirSync(path.join(profil, 'skills', 'synced'), { recursive: true });
      fs.writeFileSync(path.join(profil, 'skills', 'synced', 'a.md'), 'x');
      const espion = (nom: keyof typeof originaux) => (...args: any[]) => {
        if (String(args[0]).includes(profil)) ouverts.push(`${nom} ${path.basename(String(args[0]))}`);
        return (originaux[nom] as any)(...args);
      };
      for (const nom of Object.keys(originaux) as (keyof typeof originaux)[]) (fs as any)[nom] = espion(nom);
      const liste = S.listerProfil(profil);
      for (const nom of Object.keys(originaux) as (keyof typeof originaux)[]) (fs as any)[nom] = originaux[nom];
      assert.deepStrictEqual(ouverts, [], 'aucun fichier du profil n\'est ouvert');
      assert.deepStrictEqual([...liste.keys()], ['.claude.json', '.credentials.json', 'skills', 'skills/synced', 'skills/synced/a.md']);
      assert.deepStrictEqual(liste.get('.credentials.json'), { type: 'f', taille: 18 });
    } finally {
      for (const nom of Object.keys(originaux) as (keyof typeof originaux)[]) (fs as any)[nom] = originaux[nom];
      supprimer(profil);
    }

    // Le contrôle par zones (décision du 2026-11-10) : un écart hors zones est compté sans nom ni rejet
    const m = 'C--exemple-projet';
    const zones = C.zonesSonde([...C.lireInventaire(fs.readFileSync(path.join(ROOT, 'test', 'scenarios', 'claude-code-injection-contexte', 'inventaire.json'), 'utf8')).keys()]);
    const avant = new Map<string, { type: string; taille: number }>([
      ['.claude.json', { type: 'f', taille: 100 }], ['.credentials.json', { type: 'f', taille: 400 }], ['backups', { type: 'd', taille: 0 }],
      ['backups/.claude.json.backup.1', { type: 'f', taille: 90 }], ['policy-limits.json', { type: 'f', taille: 50 }],
      ['cache', { type: 'd', taille: 0 }], ['cache/model-catalog', { type: 'd', taille: 0 }], ['cache/model-catalog/x', { type: 'f', taille: 10 }],
      ['skills', { type: 'd', taille: 0 }], ['skills/synced', { type: 'd', taille: 0 }], ['skills/synced/x', { type: 'f', taille: 5 }],
    ]);
    const apres = new Map(avant);
    apres.set('.claude.json', { type: 'f', taille: 120 });
    apres.delete('backups/.claude.json.backup.1');
    apres.set('backups/.claude.json.backup.2', { type: 'f', taille: 100 });
    apres.set('cache/model-catalog/x', { type: 'f', taille: 11 });
    apres.set('policy-limits.json', { type: 'f', taille: 60 });
    apres.set('skills/synced/x', { type: 'f', taille: 6 });
    apres.set('session-env', { type: 'd', taille: 0 });
    apres.set('session-env/id-exemple', { type: 'd', taille: 0 });
    apres.set('.credentials.json', { type: 'f', taille: 410 });
    const ecarts = S.ecartsProfil(avant, apres, m, zones);
    assert.deepStrictEqual(ecarts.zones, [], 'aucun écart hors zones ne rejette');
    assert.deepStrictEqual(ecarts.hors_zones, [
      { groupe: '.claude.json', nombre: 1, ajoutes: 0, modifies: 1, retires: 0 },
      { groupe: '.credentials.json', nombre: 1, ajoutes: 0, modifies: 1, retires: 0 },
      { groupe: 'backups', nombre: 2, ajoutes: 1, modifies: 0, retires: 1 },
      { groupe: 'cache', nombre: 1, ajoutes: 0, modifies: 1, retires: 0 },
      { groupe: 'policy-limits.json', nombre: 1, ajoutes: 0, modifies: 1, retires: 0 },
      { groupe: 'session-env', nombre: 2, ajoutes: 2, modifies: 0, retires: 0 },
      { groupe: 'skills/synced', nombre: 1, ajoutes: 0, modifies: 1, retires: 0 },
    ]);
    const resume = S.resumeProfil(ecarts, m);
    assert.deepStrictEqual(resume.zones_sonde, { ecarts: 0, en_cause: [] });
    const texte = JSON.stringify(resume);
    for (const nom of ['model-catalog', 'backup.2', 'id-exemple', '/x']) assert.ok(!texte.includes(nom), `aucun nom de fichier hors zones (${nom})`);
    assert.deepStrictEqual(S.lignesProfil(resume), [
      'zones de la sonde : 0 écart(s)',
      'hors zones (sans rejet) : .claude.json : 0 ajouté(s), 1 modifié(s), 0 retiré(s) ; .credentials.json : 0 ajouté(s), 1 modifié(s), 0 retiré(s) ; backups : 1 ajouté(s), 0 modifié(s), 1 retiré(s) ; cache : 0 ajouté(s), 1 modifié(s), 0 retiré(s) ; policy-limits.json : 0 ajouté(s), 1 modifié(s), 0 retiré(s) ; session-env : 2 ajouté(s), 0 modifié(s), 0 retiré(s) ; skills/synced : 0 ajouté(s), 1 modifié(s), 0 retiré(s)',
    ]);
    assert.deepStrictEqual(S.ecartsProfil(avant, new Map(avant), m, zones), { zones: [], hors_zones: [] });
    // Sans liste explicite, les zones sont celles de l'inventaire du dépôt
    assert.deepStrictEqual(S.ecartsProfil(avant, apres, m), ecarts);
  });

  test('13b. Zones de la sonde : dérivées des cibles « global » de l\'inventaire ; un écart dans chaque zone rejette, nommé seulement dans brut/', () => {
    const m = 'C--exemple-projet';
    const inventaire = C.lireInventaire(fs.readFileSync(path.join(ROOT, 'test', 'scenarios', 'claude-code-injection-contexte', 'inventaire.json'), 'utf8'));
    const rels = [...new Set([...inventaire.keys(), ...S.listerFixtures()])] as string[];
    const zones = C.zonesSonde([...inventaire.keys()]);
    // La dérivation donne exactement les zones décidées le 2026-11-10
    assert.deepStrictEqual(zones, [
      { type: 'fichier', chemin: 'CLAUDE.md' },
      { type: 'dossier', chemin: 'projects/<memoire>' },
      { type: 'dossier', chemin: 'rules' },
      { type: 'dossier', chemin: 'skills' },
    ]);
    // Chaque cible « global » de l'inventaire et du dossier des fixtures tombe dans une zone
    const globales = rels.map((rel) => C.convertir(rel, m)).filter((c: any) => c.cible === 'global');
    assert.ok(globales.length >= 5);
    for (const c of globales) assert.ok(C.zoneDe(c.chemin, zones, m), `cible hors zones : ${c.chemin}`);
    // Une règle de dérivation par forme de cible (fixtures synthétiques)
    assert.deepStrictEqual(C.zonesSonde(['j/global/AGENTS.md.fixture', 'j/global/_claude/agents/a.md.fixture', 'j/global/projects/__projet__/x.md.fixture', 'j/projet/CLAUDE.md.fixture']), [
      { type: 'dossier', chemin: '.claude' }, { type: 'fichier', chemin: 'AGENTS.md' }, { type: 'dossier', chemin: 'projects/<memoire>' },
    ]);

    // Un écart de fichier dans chaque zone rejette (ajout, modification, retrait)
    const base = new Map<string, { type: string; taille: number }>([
      ['CLAUDE.md', { type: 'f', taille: 10 }], ['rules', { type: 'd', taille: 0 }], ['rules/x.md', { type: 'f', taille: 5 }],
      ['skills', { type: 'd', taille: 0 }], ['projects', { type: 'd', taille: 0 }], [`projects/${m}`, { type: 'd', taille: 0 }],
      [`projects/${m}/memory`, { type: 'd', taille: 0 }], [`projects/${m}/memory/MEMORY.md`, { type: 'f', taille: 4 }], ['cache', { type: 'd', taille: 0 }],
    ]);
    const cas: [string, (a: Map<string, any>) => void, string, string][] = [
      ['CLAUDE.md modifié', (a) => a.set('CLAUDE.md', { type: 'f', taille: 11 }), 'CLAUDE.md', 'modifié'],
      ['claude.md (casse)', (a) => a.set('claude.md', { type: 'f', taille: 1 }), 'CLAUDE.md', 'ajouté'],
      ['rules/x retiré', (a) => a.delete('rules/x.md'), 'rules/', 'retiré'],
      ['skills/autre ajouté', (a) => a.set('skills/autre.md', { type: 'f', taille: 1 }), 'skills/', 'ajouté'],
      ['skills/canari-x ajouté', (a) => a.set('skills/canari-x', { type: 'f', taille: 1 }), C.ZONE_CANARI, 'ajouté'],
      ['mémoire ajoutée', (a) => a.set(`projects/${m}/memory/x.md`, { type: 'f', taille: 3 }), 'projects/<memoire>/', 'ajouté'],
      ['MEMORY.md retiré', (a) => a.delete(`projects/${m}/memory/MEMORY.md`), 'projects/<memoire>/', 'retiré'],
      ['fichier canari ailleurs', (a) => a.set('cache/Mon-CANARI.txt', { type: 'f', taille: 1 }), C.ZONE_CANARI, 'ajouté'],
      ['canari sous skills/synced', (a) => a.set('skills/synced/canari-s', { type: 'f', taille: 1 }), C.ZONE_CANARI, 'ajouté'],
      ['lien dans une zone', (a) => a.set('rules/lien', { type: 'l', taille: 0 }), 'rules/', 'ajouté'],
    ];
    for (const [nom, modifier, zone, nature] of cas) {
      const apresCas = new Map(base);
      modifier(apresCas);
      const e: any = S.ecartsProfil(base, apresCas, m, zones);
      assert.deepStrictEqual(e.zones.map((z: any) => [z.zone, z.nature]), [[zone, nature]], nom);
      assert.deepStrictEqual(e.hors_zones, [], nom);
    }
    // Dans une zone, un dossier seul ne rejette pas : il est compté hors rejet, par premier segment
    const dossiers = new Map(base);
    dossiers.set('skills/canari-vide', { type: 'd', taille: 0 });
    dossiers.set('rules/sous', { type: 'd', taille: 0 });
    dossiers.delete('cache');
    const ed: any = S.ecartsProfil(base, dossiers, m, zones);
    assert.deepStrictEqual(ed.zones, []);
    assert.deepStrictEqual(ed.hors_zones.map((g: any) => [g.groupe, g.ajoutes, g.retires]), [['cache', 0, 1], ['rules', 1, 0], ['skills', 1, 0]]);
    // Hors zones : un autre dossier de projets, des voisins de rules et de CLAUDE.md, un cache
    const voisins = new Map(base);
    for (const [rel, type] of [['projects/autre-projet', 'd'], ['projects/autre-projet/memory', 'd'], ['rules-bak', 'f'], ['CLAUDE.md.bak', 'f'], ['statsig', 'd'], ['statsig/x', 'f']]) voisins.set(rel, { type, taille: 1 });
    const ev = S.ecartsProfil(base, voisins, m, zones);
    assert.deepStrictEqual(ev.zones, []);
    assert.deepStrictEqual(ev.hors_zones.map((g: any) => [g.groupe, g.nombre]), [['CLAUDE.md.bak', 1], ['projects', 2], ['rules-bak', 1], ['statsig', 2]]);
    // Le résumé du rapport : la zone en cause, comptée par nature ; seul un chemin canari est cité, mémoire masquée
    const apres = new Map(base);
    apres.set('rules/secret-reel.md', { type: 'f', taille: 1 });
    apres.set(`projects/${m}/memory/canari-m.md`, { type: 'f', taille: 1 });
    apres.set('cache/model-catalog', { type: 'd', taille: 0 });
    const e: any = S.ecartsProfil(base, apres, m, zones);
    const resume = S.resumeProfil(e, m);
    assert.deepStrictEqual(resume.zones_sonde, {
      ecarts: 2,
      en_cause: [
        { zone: 'rules/', nombre: 1, ajoutes: 1, modifies: 0, retires: 0 },
        { zone: C.ZONE_CANARI, nombre: 1, ajoutes: 1, modifies: 0, retires: 0, chemins: ['projects/<memoire>/memory/canari-m.md'] },
      ],
    });
    assert.deepStrictEqual(resume.hors_zones, [{ groupe: 'cache', nombre: 1, ajoutes: 1, modifies: 0, retires: 0 }]);
    assert.ok(!JSON.stringify(resume).includes('secret-reel') && !JSON.stringify(resume).includes(m), 'aucun nom réel hors canari, dossier de mémoire masqué');
    assert.match(S.lignesProfil(resume)[0], /^zones de la sonde : 2 écart\(s\) ; rules\/ : 1 ajouté/);
    assert.ok(e.zones.some((z: any) => z.chemin === 'rules/secret-reel.md'), 'le détail nommé reste dans ecarts-profil.json (brut/)');

    // Le plan de déploiement refuse toujours toute cible du profil sous skills/synced/ ou égale à policy-limits.json
    for (const rel of ['j/global/skills/synced/canari-s/SKILL.md.fixture', 'j/global/skills/Synced/x.md.fixture', 'j/global/policy-limits.json.fixture']) {
      assert.throws(() => planW([rel], ['j']), /réservée à la synchronisation du compte/, rel);
    }
    const visees = rels.map((rel) => C.convertir(rel)).filter((c: any) => c.cible === 'global' && C.cheminSynchronise(c.chemin));
    assert.deepStrictEqual(visees, []);
  });

  test('13c. Profil neuf (portabilité) : projects/<memoire>/memory/ créé vide par Claude Code → série non rejetée ; un fichier ajouté dedans → série rejetée', () => {
    const profil = tmp('profil-neuf');
    const m = 'C--exemple-projet';
    const zones = C.zonesSonde([...C.lireInventaire(fs.readFileSync(path.join(ROOT, 'test', 'scenarios', 'claude-code-injection-contexte', 'inventaire.json'), 'utf8')).keys()]);
    try {
      fs.writeFileSync(path.join(profil, '.claude.json'), '{}');
      const avant = S.listerProfil(profil);
      // Claude Code crée le dossier de mémoire, vide, pendant la série
      fs.mkdirSync(path.join(profil, 'projects', m, 'memory'), { recursive: true });
      const vide: any = S.ecartsProfil(avant, S.listerProfil(profil), m, zones);
      assert.deepStrictEqual(vide.zones, [], 'aucun écart dans les zones : la série n\'est pas rejetée');
      assert.deepStrictEqual(vide.hors_zones, [{ groupe: 'projects', nombre: 3, ajoutes: 3, modifies: 0, retires: 0 }]);
      assert.deepStrictEqual(S.resumeProfil(vide, m).zones_sonde, { ecarts: 0, en_cause: [] });
      // Un fichier ajouté dans ce dossier rejette la série
      fs.writeFileSync(path.join(profil, 'projects', m, 'memory', 'notes.md'), 'x');
      const fichier: any = S.ecartsProfil(avant, S.listerProfil(profil), m, zones);
      assert.deepStrictEqual(fichier.zones, [{ zone: 'projects/<memoire>/', chemin: `projects/${m}/memory/notes.md`, nature: 'ajouté' }]);
      assert.deepStrictEqual(S.resumeProfil(fichier, m).zones_sonde, { ecarts: 1, en_cause: [{ zone: 'projects/<memoire>/', nombre: 1, ajoutes: 1, modifies: 0, retires: 0 }] });
    } finally {
      supprimer(profil);
    }
  });

  test('14. Bases : identiques au début et à la fin, sinon la série est rejetée', () => {
    const debut = { total: 3094, categories: [{ nom: 'System prompt', tokens: 3086 }, { nom: 'Messages', tokens: 8 }] };
    assert.deepStrictEqual(S.comparerBases(debut, clone(debut)), []);
    assert.deepStrictEqual(S.comparerBases(debut, { total: 3095, categories: [{ nom: 'System prompt', tokens: 3087 }, { nom: 'Messages', tokens: 8 }] }), ['total 3094 → 3095', 'System prompt 3086 → 3087']);
    assert.deepStrictEqual(S.comparerBases(debut, { total: 3094, categories: [{ nom: 'System prompt', tokens: 3086 }] }), ['Messages 8 → undefined']);
    assert.deepStrictEqual(S.comparerBases(debut, undefined), ['base manquante']);
  });

  test('15. Déploiement et retrait réels dans un dossier temporaire : journal, refus d\'écrasement, retrait complet', () => {
    const racine = tmp('deploiement');
    try {
      const espace = path.join(racine, 'espace');
      const config = path.join(racine, 'config');
      const journal = path.join(racine, 'brut', 'journal.json');
      fs.mkdirSync(path.join(espace, 'projet'), { recursive: true });
      fs.mkdirSync(config);
      fs.writeFileSync(path.join(config, '.claude.json'), '{}');
      const fichiers = [
        { destination: path.join(espace, 'projet', '.claude', 'rules', 'r.md'), contenu: 'a\n' },
        { destination: path.join(config, 'rules', 'g.md'), contenu: 'b\n' },
        { destination: path.join(espace, 'CLAUDE.md'), contenu: 'c\n' },
      ];
      const j = S.deployer(fichiers, journal, [espace, config]);
      assert.strictEqual(j.etat, 'deploye');
      assert.deepStrictEqual(j.dossiers, [path.join(espace, 'projet', '.claude'), path.join(espace, 'projet', '.claude', 'rules'), path.join(config, 'rules')]);
      assert.ok(fichiers.every((f) => fs.readFileSync(f.destination, 'utf8') === f.contenu));
      assert.throws(() => S.deployer(fichiers, journal, [espace, config]), /journal/);
      assert.deepStrictEqual(S.retirer(journal), { problemes: [], attendus: [] });
      assert.ok(!fs.existsSync(journal));
      assert.deepStrictEqual(fs.readdirSync(espace), ['projet']);
      assert.deepStrictEqual(fs.readdirSync(path.join(espace, 'projet')), []);
      assert.deepStrictEqual(fs.readdirSync(config), ['.claude.json']);

      // Refus d'écrasement : rien n'est écrit, pas même le journal
      fs.writeFileSync(path.join(espace, 'CLAUDE.md'), 'vrai fichier');
      assert.throws(() => S.deployer(fichiers, journal, [espace, config]), /refus d'écrasement/);
      assert.ok(!fs.existsSync(journal) && !fs.existsSync(path.join(config, 'rules')));
      assert.strictEqual(fs.readFileSync(path.join(espace, 'CLAUDE.md'), 'utf8'), 'vrai fichier');
      fs.unlinkSync(path.join(espace, 'CLAUDE.md'));
      assert.throws(() => S.deployer([{ destination: path.join(racine, 'ailleurs', 'x.md'), contenu: 'x' }], journal, [espace, config]), /hors des racines/);
      assert.throws(() => S.deployer([fichiers[2], { ...fichiers[2] }], journal, [espace, config]), /même destination/);

      // Un fichier modifié pendant la mesure est conservé, et le journal le signale
      S.deployer(fichiers, journal, [espace, config]);
      fs.writeFileSync(fichiers[0].destination, 'modifié');
      const { problemes } = S.retirer(journal);
      assert.strictEqual(problemes.length, 3, problemes.join(' | '));
      assert.ok(fs.existsSync(fichiers[0].destination) && !fs.existsSync(fichiers[1].destination));
      assert.strictEqual(JSON.parse(fs.readFileSync(journal, 'utf8')).etat, 'retrait-incomplet');
    } finally {
      supprimer(racine);
    }
  });

  test('17. Liste blanche : un parent avec jetons, clés, proxy et certificats n\'en transmet aucun, et lancerClaude refuse tout nom ajouté', () => {
    const systemeW: Record<string, string> = {
      Path: 'p', SystemRoot: 's', windir: 'w', ComSpec: 'c', PATHEXT: '.EXE', TEMP: 't', TMP: 't', USERPROFILE: 'u', HOMEDRIVE: 'h', HOMEPATH: 'h',
      APPDATA: 'a', LOCALAPPDATA: 'l', ProgramFiles: 'pf', 'ProgramFiles(x86)': 'pf', ProgramW6432: 'pf', ProgramData: 'pd', SystemDrive: 'C:',
      OS: 'Windows_NT', NUMBER_OF_PROCESSORS: '8', PROCESSOR_ARCHITECTURE: 'AMD64', processor_level: '6',
    };
    const systemeP: Record<string, string> = { HOME: 'h', PATH: 'p', LANG: 'fr_CA.UTF-8', LC_ALL: 'fr', LC_CTYPE: 'fr', TERM: 'xterm', TMPDIR: 't', USER: 'u', SHELL: '/bin/sh' };
    const arbitraires: Record<string, string> = {
      EXEMPLE_ACCESS_TOKEN: 'secret-1', SERVICE_API_KEY: 'secret-2', GITHUB_TOKEN: 'secret-3', AWS_SECRET_ACCESS_KEY: 'secret-4', OPENAI_API_KEY: 'secret-5',
      MOT_DE_PASSE_EXEMPLE: 'secret-6', HTTP_PROXY: 'secret-7', HTTPS_PROXY: 'secret-8', https_proxy: 'secret-9', NO_PROXY: 'secret-10', ALL_PROXY: 'secret-11',
      NODE_EXTRA_CA_CERTS: 'secret-12', SSL_CERT_FILE: 'secret-13', REQUESTS_CA_BUNDLE: 'secret-14', CURL_CA_BUNDLE: 'secret-15', NODE_OPTIONS: 'secret-16',
      ANTHROPIC_API_KEY: 'secret-17', CLAUDECODE: 'secret-18', SSH_AUTH_SOCK: 'secret-19', PROCESSORX: 'secret-20', LCX: 'secret-21',
    };
    for (const [plateforme, systeme, posees] of [['win32', systemeW, ['CLAUDE_CONFIG_DIR', 'DISABLE_AUTOUPDATER']], ['linux', systemeP, ['CLAUDE_CONFIG_DIR', 'DISABLE_AUTOUPDATER']]] as [string, Record<string, string>, string[]][]) {
      const env = S.environnementNettoye({ ...systeme, ...arbitraires }, CONFIG_W, plateforme);
      assert.deepStrictEqual(Object.keys(env).sort(), [...Object.keys(systeme), ...posees].sort(), plateforme);
      assert.doesNotMatch(JSON.stringify(env), /secret-/, `${plateforme} : aucune valeur arbitraire transmise`);
      assert.deepStrictEqual(S.problemesEnvironnement(env, CONFIG_W, plateforme), [], plateforme);
      for (const [nom, valeur] of Object.entries(arbitraires)) {
        const pb = S.problemesEnvironnement({ ...env, [nom]: valeur }, CONFIG_W, plateforme);
        assert.ok(pb.length > 0, `${plateforme} ${nom}`);
        assert.ok(!pb.join(' ').includes(nom), 'le message ne cite pas le nom');
      }
    }
    // Les noms système d'une plateforme ne passent pas sur l'autre
    assert.ok(!('HOME' in S.environnementNettoye({ HOME: 'h' }, CONFIG_W, 'win32')));
    assert.ok(!('SystemRoot' in S.environnementNettoye({ SystemRoot: 's' }, CONFIG_W, 'linux')));
    // lancerClaude refuse un environnement augmenté, avant tout lancement et sans rien compter
    const brut = tmp('liste-blanche');
    try {
      const env = { ...S.environnementNettoye(systemeW, CONFIG_W, 'win32'), GITHUB_TOKEN: 'secret' };
      assert.throws(() => S.lancerClaude({ exe: 'x', argv: ['--version'], env, cwd: brut, espace: ESPACE_W, configDir: CONFIG_W, dossierBrut: brut, plateforme: 'win32' }), /environnement non conforme : 1 variable\(s\) hors de la liste blanche/);
      assert.deepStrictEqual(fs.readdirSync(brut), []);
    } finally {
      supprimer(brut);
    }
  });

  test('16. Empreintes : une fixture modifiée, absente de l\'inventaire ou manquante fait refuser le déploiement, fichier nommé', () => {
    const racine = tmp('empreintes');
    try {
      const fixtures = path.join(racine, 'fixtures');
      const espace = path.join(racine, 'espace');
      const config = path.join(racine, 'config');
      const ecrire = (rel: string, texte: string) => {
        fs.mkdirSync(path.dirname(path.join(fixtures, rel)), { recursive: true });
        fs.writeFileSync(path.join(fixtures, rel), texte);
      };
      ecrire('jeu/projet/CLAUDE.md.fixture', 'Contenu de fixture.\r\n');
      ecrire('jeu/projet/_claude/rules/r.md.fixture', 'Règle de fixture.\n');
      const inventaireTexte = JSON.stringify({
        format: 1,
        fixtures: [
          { chemin: 'jeu/projet/CLAUDE.md.fixture', sha256: C.sha256Lf('Contenu de fixture.\n'), canaris: [] },
          { chemin: 'jeu/projet/_claude/rules/r.md.fixture', sha256: C.sha256Lf('Règle de fixture.\n'), canaris: [] },
        ],
      });
      const inventaire = C.lireInventaire(inventaireTexte);
      const plan = () => C.planDeploiement(S.listerFixtures(fixtures), ['jeu'], { configDir: config, espace, fixturesDir: fixtures });
      const preparer = () => S.fichiersADeployer(plan(), { espace, inventaire, jeux: ['jeu'] });

      // Conforme : l'empreinte est calculée en LF, un CRLF de la copie de travail ne change rien
      assert.strictEqual(preparer().fichiers.length, 2);

      // Fixture modifiée : refus qui nomme le fichier, et rien n'est écrit dans l'espace
      ecrire('jeu/projet/_claude/rules/r.md.fixture', 'Règle modifiée.\n');
      assert.throws(preparer, (err: Error) => err instanceof S.Refus && /jeu\/projet\/_claude\/rules\/r\.md\.fixture : empreinte différente/.test(err.message));
      assert.ok(!fs.existsSync(espace), "l'espace n'a pas été créé");
      ecrire('jeu/projet/_claude/rules/r.md.fixture', 'Règle de fixture.\n');

      // Fixture ajoutée hors de l'inventaire, puis fixture de l'inventaire manquante
      ecrire('jeu/projet/AGENTS.md.fixture', 'Ajout.\n');
      assert.throws(preparer, /jeu\/projet\/AGENTS\.md\.fixture : absente de l'inventaire/);
      fs.unlinkSync(path.join(fixtures, 'jeu', 'projet', 'AGENTS.md.fixture'));
      fs.unlinkSync(path.join(fixtures, 'jeu', 'projet', 'CLAUDE.md.fixture'));
      assert.throws(preparer, /jeu\/projet\/CLAUDE\.md\.fixture : manquante/);

      // Inventaire invalide
      for (const texte of ['{', '{"format":2,"fixtures":[]}', '{"format":1,"fixtures":[{"chemin":"a","sha256":"x","canaris":[]}]}',
        JSON.stringify({ format: 1, fixtures: [JSON.parse(inventaireTexte).fixtures[0], JSON.parse(inventaireTexte).fixtures[0]] })]) {
        assert.throws(() => C.lireInventaire(texte), /inventaire/, texte.slice(0, 40));
      }

      // Les combinaisons réelles du lanceur passent le plan et les empreintes de l'inventaire réel (sans rien écrire)
      const suite = path.join(ROOT, 'test', 'scenarios', 'claude-code-injection-contexte');
      const reel = C.lireInventaire(fs.readFileSync(path.join(suite, 'inventaire.json'), 'utf8'));
      const rels = S.listerFixtures(path.join(suite, 'fixtures'));
      assert.deepStrictEqual(rels, [...reel.keys()].sort());
      for (const c of [...S.BASES, ...S.COMBINAISONS, ...S.COMBINAISONS_E4]) {
        const p = c.jeux.length > 0 ? C.planDeploiement(rels, c.jeux, { configDir: config, espace, fixturesDir: path.join(suite, 'fixtures') }) : [];
        S.fichiersADeployer(p, { espace, inventaire: reel, jeux: c.jeux });
      }
      assert.strictEqual(S.COMBINAISONS.length, 22);
      assert.ok(!fs.existsSync(espace));
    } finally {
      supprimer(racine);
    }
  });

  test('18. Lot E4 : plafond de 10 sans compteur du modèle, E3 archivé, combinaisons et base vide propres, deux modèles pour /context, version 2.1.319 exigée, rapport e4-', async () => {
    const P = require(path.join(SCRIPTS, 'sonde-claude-code-payant.js'));
    const K = require(path.join(SCRIPTS, 'compare-injection-claude.js'));

    // Compteur : plafond de 10, /context seulement, aucun compteur du modèle (budget du chantier inchangé)
    assert.strictEqual(S.LOT_E4, 'E4');
    assert.strictEqual(P.COMPTEURS.context.plafonds.E4, 10);
    assert.ok(P.LOTS_CONTEXT_SEUL.includes('E4') && !Object.prototype.hasOwnProperty.call(P.COMPTEURS.modele.plafonds, 'E4'));
    const brut = tmp('e4');
    const journal: string[] = [];
    const log = console.log;
    try {
      assert.throws(() => P.lireCompteur(brut, 'modele', 'E4'), /le lot E4 \(calibrage et vérifications gratuites\) n'accepte que \/context/);
      // Le compteur E3 (10 sur 12) est archivé à l'ouverture de E4, sans remise à zéro, et E3 ne se rouvre plus
      const e3 = { lot: 'E3', plafond: 12, utilises: 10 };
      fs.writeFileSync(path.join(brut, 'compteur-context.json'), JSON.stringify(e3));
      console.log = (m: string) => journal.push(m);
      const r = S.ouvrirLotAnnonce(brut, 'context', 'E4');
      console.log = log;
      assert.deepStrictEqual([r.archive, r.ancien.utilises], ['compteur-context-E3.json', 10]);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(brut, 'compteur-context-E3.json'), 'utf8')), e3);
      assert.ok(journal.some((m) => /Compteur context du lot E3 \(10 sur 12\) archivé sous brut\/compteur-context-E3\.json ; lot E4 ouvert/.test(m)), journal.join('\n'));
      assert.throws(() => P.ouvrirLot(brut, 'context', 'E3'), /archivé/);
      // Une série E4 : la base vide au début et à la fin, plus trois combinaisons = 5 ; une relance complète tient
      const serie = S.BASES_E4.length * 2 + S.COMBINAISONS_E4.length;
      assert.strictEqual(serie, 5);
      S.verifierBudget(brut, serie, 'E4');
      for (let i = 1; i <= serie; i++) S.reserverContext(brut, 'E4');
      S.verifierBudget(brut, serie, 'E4');
      for (let i = 1; i <= serie; i++) S.reserverContext(brut, 'E4');
      assert.throws(() => S.verifierBudget(brut, 1, 'E4'), /10 \/context déjà utilisé\(s\), 1 prévu\(s\), limite de 10 pour le lot E4/);
    } finally {
      console.log = log;
      supprimer(brut);
    }

    // Combinaisons et bases propres au lot
    assert.deepStrictEqual(S.BASES_E4.map((b: any) => b.id), ['base-vide']);
    assert.deepStrictEqual(S.COMBINAISONS_E4.map((c: any) => [c.id, c.jeux.join('+'), c.outils, c.modele ?? S.MODELE]), [
      ['cout-calibrage', 'cout-calibrage', '', 'claude-opus-5'],
      ['cout-calibrage-o55', 'cout-calibrage', '', 'claude-opus-5-5'],
      ['doublons-d6', 'doublons-d6', 'Skill', 'claude-opus-5'],
    ]);
    assert.strictEqual(S.combinaisonsDuLot('E4'), S.COMBINAISONS_E4);
    assert.strictEqual(S.combinaisonsDuLot('V1'), S.COMBINAISONS);
    assert.strictEqual(S.basesDuLot('E4'), S.BASES_E4);
    assert.strictEqual(S.basesDuLot('E1'), S.BASES);
    assert.ok(!S.COMBINAISONS.some((c: any) => S.COMBINAISONS_E4.some((e: any) => e.id === c.id)), 'aucun identifiant partagé');
    assert.strictEqual(S.lireOptions(['--lot', 'E4', '--resultats']).lot, 'E4');
    assert.deepStrictEqual(S.lireOptions(['--lot', 'E4', '--combinaisons', 'doublons-d6']).combinaisons, ['doublons-d6']);
    assert.throws(() => S.lireOptions(['--lot', 'E4', '--combinaisons', 'niveaux']), /combinaison inconnue pour le lot E4 : niveaux/);
    assert.throws(() => S.lireOptions(['--lot', 'V1', '--combinaisons', 'cout-calibrage']), /combinaison inconnue pour le lot V1 : cout-calibrage/);
    assert.throws(() => S.lireOptions(['--lot', 'E4', '--preparer-h14']), /exige --lot E3/);

    // Modèle : claude-opus-5-5 permis pour /context seulement, jamais pour un appel au modèle
    assert.deepStrictEqual(S.MODELES_CONTEXT, ['claude-opus-5', 'claude-opus-5-5']);
    const opts = { espace: ESPACE_W, plateforme: 'win32' };
    const o55 = S.argumentsContext({ outils: '', modele: 'claude-opus-5-5' });
    assert.strictEqual(o55[o55.indexOf('--model') + 1], 'claude-opus-5-5');
    assert.strictEqual(S.verifierArgv(o55, opts), 'context');
    assert.deepStrictEqual(S.argumentsContext({ outils: '' }), S.argumentsContext({ outils: '', modele: 'claude-opus-5' }), 'claude-opus-5 par défaut');
    for (const m of ['claude-opus-5-1', 'claude-sonnet-5-5', '', 'CLAUDE-OPUS-5-5']) {
      assert.throws(() => S.argumentsContext({ outils: '', modele: m }), S.RefusArgv, m);
      assert.throws(() => S.verifierArgv(o55.map((a: string) => (a === 'claude-opus-5-5' ? m : a)), opts), S.RefusArgv, m);
    }
    const invite = 'Invite de test';
    const invites = new Map([[invite, 'test']]);
    const appel = S.argumentsAppel({ prompt: invite, outils: '', toursMax: 1 });
    assert.strictEqual(S.verifierArgv(appel, { ...opts, invites }), 'modele');
    assert.throws(() => S.verifierArgv(appel.map((a: string) => (a === 'claude-opus-5' ? 'claude-opus-5-5' : a)), { ...opts, invites }), /--model : valeur refusée/);

    // Le modèle lu dans le flux : init.model et context_usage.model, null s'ils manquent
    const f = fluxSynthetique();
    const lu = S.lireFlux(texteFlux([{ ...f.init, model: 'claude-opus-5-5' }, f.assistant, f.result]));
    assert.deepStrictEqual(S.modelesLus(lu, 'claude-opus-5-5'), { demande: 'claude-opus-5-5', init: 'claude-opus-5-5', context: 'claude-opus-5' });
    assert.deepStrictEqual(S.modelesLus(S.lireFlux(''), 'claude-opus-5'), { demande: 'claude-opus-5', init: null, context: null });

    // Version exigée : seul --version est lancé, sans lot (aucun /context compté) ; une autre version refuse
    assert.deepStrictEqual(S.VERSIONS_EXIGEES, { E4: '2.1.319' });
    const appels: any[] = [];
    const lancer = (reponse: object) => async (a: any) => {
      appels.push(a);
      return reponse;
    };
    const ctx = { exe: 'C:\\x\\claude.exe', env: {}, espace: path.join(os.tmpdir(), 'canari-e4-espace-absent'), configDir: CONFIG_W, plateforme: 'win32' };
    assert.strictEqual(await S.verifierVersionDuLot(ctx, 'E4', { lancer: lancer({ code: 0, stdout: '2.1.319 (Claude Code)\n' }) }), '2.1.319');
    assert.deepStrictEqual(appels[0].argv, ['--version']);
    assert.strictEqual(appels[0].lot, undefined, 'aucun compteur réservé');
    assert.strictEqual(appels[0].cwd, os.tmpdir(), 'espace absent : dossier temporaire');
    await assert.rejects(S.verifierVersionDuLot(ctx, 'E4', { lancer: lancer({ code: 0, stdout: '2.1.322 (Claude Code)\n' }) }),
      (e: Error) => e instanceof S.Refus && /le lot E4 exige Claude Code 2\.1\.319, et le claude du poste répond 2\.1\.322 : rien n'est lancé, aucun \/context n'est consommé/.test(e.message));
    await assert.rejects(S.verifierVersionDuLot(ctx, 'E4', { lancer: lancer({ code: 1, stdout: '' }) }), /claude --version a échoué : le lot E4 exige la version 2\.1\.319/);
    const avant = appels.length;
    assert.strictEqual(await S.verifierVersionDuLot(ctx, 'V1', { lancer: lancer({ code: 0, stdout: '9.9.9' }) }), null);
    assert.strictEqual(appels.length, avant, 'aucune version exigée hors E4 : rien n\'est lancé');
    // Dans commandeContext, la version est contrôlée avant l'ouverture du lot et avant tout /context
    const source = fs.readFileSync(FICHIER_LANCEUR, 'utf8');
    const commande = source.slice(source.indexOf('async function commandeContext('), source.indexOf('// --- Partie payante'));
    assert.ok(commande.indexOf('await verifierVersionDuLot(ctx, opts.lot)') > 0 && commande.indexOf('await verifierVersionDuLot(ctx, opts.lot)') < commande.indexOf('ouvrirLotAnnonce('));

    // Rapport : préfixe e4-, accepté par l'écriture, ignoré par le comparateur et par la baseline
    assert.strictEqual(S.prefixeRapport('E4'), 'e4');
    assert.strictEqual(S.prefixeRapport('V1'), 'context');
    assert.ok(!K.NOM_RAPPORT.test('e4-2026-11-11-1000.json'));
    const resultats = tmp('e4-resultats');
    try {
      const dossiers = { brut: resultats, resultats };
      const rapport = { rapport: 'claude-code-context', format: 1, lot: 'E4', combinaisons: [] };
      assert.ok(fs.existsSync(S.ecrireRapport(rapport, { destination: 'resultats', nom: 'e4-2026-11-11-1000.json', poste: POSTE, interdits: [], dossiers })));
      assert.throws(() => S.ecrireRapport(rapport, { destination: 'resultats', nom: 'e5-2026-11-11-1000.json', poste: POSTE, interdits: [], dossiers }), /nom de rapport refusé/);
      assert.throws(() => S.commandeBaseline(['--depuis', 'e4-2026-11-11-1000.json'], { resultats, attendu: resultats, poste: POSTE }), S.Refus);
    } finally {
      supprimer(resultats);
    }
  });
});
