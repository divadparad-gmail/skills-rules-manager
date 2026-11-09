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
        profil: { ecarts_connus: [{ motif: '.claude.json', nombre: 1 }], ecarts_inconnus: 0 },
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

  test('13. Profil isolé : liste sans jamais ouvrir .credentials.json, écarts connus nommés, écarts inconnus signalés', () => {
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

    const m = 'C--exemple-projet';
    const avant = new Map<string, { type: string; taille: number }>([
      ['.claude.json', { type: 'f', taille: 100 }], ['.credentials.json', { type: 'f', taille: 400 }], ['backups', { type: 'd', taille: 0 }],
      ['backups/.claude.json.backup.1', { type: 'f', taille: 90 }], ['policy-limits.json.signature.json', { type: 'f', taille: 3005 }],
      ['skills', { type: 'd', taille: 0 }],
    ]);
    const apres = new Map(avant);
    apres.set('.claude.json', { type: 'f', taille: 120 });
    apres.delete('backups/.claude.json.backup.1');
    apres.set('backups/.claude.json.backup.2', { type: 'f', taille: 100 });
    apres.set('policy-limits.json.signature.json', { type: 'f', taille: 3000 });
    for (const d of ['projects', `projects/${m}`, `projects/${m}/memory`, 'session-env', 'session-env/id-exemple', 'statsig']) apres.set(d, { type: 'd', taille: 0 });
    apres.set(`projects/${m}/memory/MEMORY.md`, { type: 'f', taille: 10 });
    apres.set('statsig/x', { type: 'f', taille: 1 });
    apres.set('.credentials.json', { type: 'f', taille: 410 });
    apres.delete('skills');
    const ecarts = S.ecartsProfil(avant, apres, m);
    assert.deepStrictEqual(ecarts.connus, [
      { motif: '.claude.json', nombre: 1, ajoutes: 0, modifies: 1, retires: 0 },
      { motif: 'policy-limits.json.signature.json', nombre: 1, ajoutes: 0, modifies: 1, retires: 0 },
      { motif: 'backups/.claude.json.backup.*', nombre: 2, ajoutes: 1, modifies: 0, retires: 1 },
      { motif: 'projects/<memoire>/memory/ (vide)', nombre: 3, ajoutes: 3, modifies: 0, retires: 0 },
      { motif: 'session-env/<id>/ (vide)', nombre: 2, ajoutes: 2, modifies: 0, retires: 0 },
    ]);
    assert.deepStrictEqual(ecarts.inconnus.map((e: any) => `${e.nature} ${e.chemin}`).sort(), [
      'ajouté projects/C--exemple-projet/memory/MEMORY.md', 'ajouté statsig', 'ajouté statsig/x', 'modifié .credentials.json', 'retiré skills',
    ]);
    assert.deepStrictEqual(S.ecartsProfil(avant, new Map(avant), m), { connus: [], inconnus: [] });
  });

  test('13b. Synchronisation du compte : skills/synced/ et policy-limits.json tolérés et comptés sans nom, voisins inconnus, cibles refusées', () => {
    const m = 'C--exemple-projet';
    const avant = new Map<string, { type: string; taille: number }>([
      ['skills', { type: 'd', taille: 0 }], ['skills/synced', { type: 'd', taille: 0 }],
      ['skills/synced/skill-a', { type: 'd', taille: 0 }], ['skills/synced/skill-a/SKILL.md', { type: 'f', taille: 10 }],
      ['skills/synced/skill-b', { type: 'd', taille: 0 }], ['skills/synced/skill-b/SKILL.md', { type: 'f', taille: 20 }],
      ['policy-limits.json', { type: 'f', taille: 50 }], ['policy-limits.json.bak', { type: 'f', taille: 50 }],
    ]);
    const apres = new Map(avant);
    apres.set('skills/synced/skill-a/SKILL.md', { type: 'f', taille: 11 });
    apres.delete('skills/synced/skill-b/SKILL.md');
    apres.delete('skills/synced/skill-b');
    apres.set('skills/synced/skill-c', { type: 'd', taille: 0 });
    apres.set('skills/synced/skill-c/SKILL.md', { type: 'f', taille: 30 });
    apres.set('policy-limits.json', { type: 'f', taille: 60 });
    // Les voisins restent des écarts inconnus
    apres.set('skills/syncedX', { type: 'f', taille: 1 });
    apres.set('skills/canari-x', { type: 'd', taille: 0 });
    apres.set('skills/canari-x/SKILL.md', { type: 'f', taille: 1 });
    apres.set('policy-limits.json.bak', { type: 'f', taille: 51 });
    apres.set('synced/policy-limits.json', { type: 'f', taille: 1 });
    const ecarts = S.ecartsProfil(avant, apres, m);
    assert.deepStrictEqual(ecarts.connus, [
      { motif: 'skills/synced/**', nombre: 5, ajoutes: 2, modifies: 1, retires: 2 },
      { motif: 'policy-limits.json', nombre: 1, ajoutes: 0, modifies: 1, retires: 0 },
    ]);
    assert.ok(!JSON.stringify(ecarts.connus).includes('skill-'), 'aucun nom de fichier dans les écarts connus');
    assert.deepStrictEqual(ecarts.inconnus.map((e: any) => `${e.nature} ${e.chemin}`).sort(), [
      'ajouté skills/canari-x', 'ajouté skills/canari-x/SKILL.md', 'ajouté skills/syncedX', 'ajouté synced/policy-limits.json', 'modifié policy-limits.json.bak',
    ]);
    // policy-limits.json : ajout toléré, retrait inconnu ; skills/synced créé pendant la série : toléré
    assert.deepStrictEqual(S.ecartsProfil(new Map(), new Map([['policy-limits.json', { type: 'f', taille: 1 }], ['skills/synced', { type: 'd', taille: 0 }]]), m).connus, [
      { motif: 'policy-limits.json', nombre: 1, ajoutes: 1, modifies: 0, retires: 0 },
      { motif: 'skills/synced/**', nombre: 1, ajoutes: 1, modifies: 0, retires: 0 },
    ]);
    assert.deepStrictEqual(S.ecartsProfil(new Map([['policy-limits.json', { type: 'f', taille: 1 }]]), new Map(), m).inconnus, [{ chemin: 'policy-limits.json', nature: 'retiré' }]);

    // Le plan de déploiement refuse toute cible du profil sous skills/synced/ ou égale à policy-limits.json
    for (const rel of ['j/global/skills/synced/canari-s/SKILL.md.fixture', 'j/global/skills/Synced/x.md.fixture', 'j/global/policy-limits.json.fixture']) {
      assert.throws(() => planW([rel], ['j']), /réservée à la synchronisation du compte/, rel);
    }
    for (const rel of ['j/global/skills/syncedX/a.md.fixture', 'j/global/policy-limits.json.bak.fixture', 'j/projet/policy-limits.json.fixture']) {
      assert.strictEqual(planW([rel], ['j']).length, 1, rel);
    }
    // Aucune fixture, ni de l'inventaire ni du dossier, ne vise ces chemins
    const inventaire = C.lireInventaire(fs.readFileSync(path.join(ROOT, 'test', 'scenarios', 'claude-code-injection-contexte', 'inventaire.json'), 'utf8'));
    const rels = [...new Set([...inventaire.keys(), ...S.listerFixtures()])] as string[];
    assert.ok(rels.length > 0);
    const visees = rels.map((rel) => C.convertir(rel)).filter((c: any) => c.cible === 'global' && C.cheminSynchronise(c.chemin));
    assert.deepStrictEqual(visees, []);
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
      for (const c of [...S.BASES, ...S.COMBINAISONS]) {
        const p = c.jeux.length > 0 ? C.planDeploiement(rels, c.jeux, { configDir: config, espace, fixturesDir: path.join(suite, 'fixtures') }) : [];
        S.fichiersADeployer(p, { espace, inventaire: reel, jeux: c.jeux });
      }
      assert.strictEqual(S.COMBINAISONS.length, 22);
      assert.ok(!fs.existsSync(espace));
    } finally {
      supprimer(racine);
    }
  });
});
