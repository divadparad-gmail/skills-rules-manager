#!/usr/bin/env node
/**
 * Lanceur de la suite d'injection Claude Code — lots I2 (partie gratuite) et I3 (partie payante).
 *
 * Usage (depuis la racine du dépôt) :
 *   npm run sonde:claude-etat                       version, auth status et préconditions ; aucun /context
 *   npm run sonde:claude-context -- --lot <E1|E2>   déploiement, /context par combinaison, retrait, rapport
 *   npm run sonde:claude-context -- --preparer-h14  déploie le jeu de H14 et affiche les gestes (aucun /context)
 *   npm run sonde:claude -- --a-sec                 affiche les 38 appels prévus, sans rien lancer ni écrire
 *   npm run sonde:claude -- --confirmer --plafond <n> [--series 1,3] [--resultats]   partie payante
 *   node test/scenarios/scripts/sonde-claude-code.js retirer   retrait d'un déploiement (interrompu, ou H14)
 *   npm run sonde:claude-baseline -- --depuis <context-…json>   écrit attendu/baseline-<date>.json d'après un
 *                           rapport valide de resultats/, après la garde ; aucun lancement de claude
 * Options de « context » :
 *   --lot <E1|E2>           lot du compteur de /context (obligatoire) ; au changement de lot, l'ancien
 *                           compteur est archivé dans brut/, et un lot archivé ne peut pas être rouvert
 *   --combinaisons <id,id>  ne mesure que ces combinaisons (les quatre bases sont toujours mesurées)
 *   --resultats             écrit le rapport normalisé dans resultats/ au lieu de brut/
 *
 * Chemins par défaut calculés (aucun chemin local en dur), remplaçables par CANARI_CLAUDE_CONFIG_DIR,
 * CANARI_CLAUDE_ESPACE et CANARI_CLAUDE_EXE.
 *
 * Protections, par construction :
 *   - seuls « claude --version », « claude auth status --json », « claude -p /context » (ou
 *     « /context all ») et, pour la partie payante, « claude -p <invite de SONDE.md vérifiée par son
 *     empreinte> » peuvent être lancés : verifierArgv() refuse tout le reste, sans shell ;
 *   - environnement en liste blanche : seules les variables système nécessaires au démarrage de claude
 *     et du shell des hooks sont transmises (ni jeton, ni clé, ni proxy, ni certificat), puis
 *     CLAUDE_CONFIG_DIR et DISABLE_AUTOUPDATER=1 sont posées ; tout autre nom est refusé avant chaque
 *     lancement ;
 *   - profil connecté par claude.ai, sur un abonnement, avec le bon configDirectory, avant chaque série ;
 *   - après chaque /context : apiKeySource=none, usage nul, num_turns=0, coût nul ; après chaque appel
 *     au modèle : apiKeySource=none (aussi dès l'initialisation, avant la première requête) ; sinon le
 *     fichier brut/ARRET.txt est écrit et bloque tout lancement suivant de claude ;
 *   - deux compteurs persistants et distincts, liés au lot, incrémentés avant chaque lancement :
 *     /context (60 en E1, relevé de 50 le 2026-11-09 ; 40 en E2) et appels au modèle (40 en E2, ou moins avec --plafond) ;
 *   - garde de flux pendant chaque appel au modèle : tours, outils, chemins et commande Bash ;
 *   - empreintes SHA-256 (en LF) de chaque fixture comparées à inventaire.json avant tout déploiement :
 *     un écart refuse le déploiement et nomme le fichier ;
 *   - rapport normalisé écrit seulement après la garde de confidentialité ; sorties brutes dans brut/.
 *
 * Codes de sortie : 0 succès, 1 erreur, 2 préconditions non remplies ou refus, 3 série rejetée,
 * 4 arrêt définitif (ARRET.txt).
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const commun = require('./sonde-claude-code-commun');
const payant = require('./sonde-claude-code-payant');
const constructionBaseline = require('./sonde-claude-code-baseline');

const RACINE_DEPOT = path.resolve(__dirname, '..', '..', '..');
const SUITE = path.join(RACINE_DEPOT, 'test', 'scenarios', 'claude-code-injection-contexte');
const FIXTURES = path.join(SUITE, 'fixtures');
const SERVEUR = path.join(SUITE, 'mcp', 'serveur-fixture.js');
const INVENTAIRE = path.join(SUITE, 'inventaire.json');
const SONDE = path.join(SUITE, 'SONDE.md');
const BRUT = path.join(SUITE, 'brut');
const RESULTATS = path.join(SUITE, 'resultats');
const ATTENDU = path.join(SUITE, 'attendu');

const LOTS_CONTEXT = Object.keys(payant.COMPTEURS.context.plafonds);
const MODELE = 'claude-opus-5';
const EFFORT = 'high';
const PROMPTS = ['/context', '/context all'];
const ABONNEMENTS = ['pro', 'max', 'team', 'enterprise'];
const OUTILS_CONNUS = new Set(['Skill', 'ToolSearch', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash']);
const OUTILS_FICHIERS = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash']);
const OPTIONS_SEULES = new Set(['--verbose', '--no-session-persistence', '--strict-mcp-config', '--include-hook-events']);
const OPTIONS_FIXES = {
  '--model': MODELE, '--effort': EFFORT, '--output-format': 'stream-json', '--permission-prompts': 'none', '--permission-mode': 'dontAsk',
};
const OPTIONS_CHEMINS = new Set(['--mcp-config', '--plugin-dir', '--settings']);
const TOURS_PERMIS = new Set(['1', '3']);
const AUTORISATIONS_PERMISES = new Set(Object.values(payant.AUTORISATIONS));
const OPTIONS_OBLIGATOIRES = ['--model', '--effort', '--output-format', '--verbose', '--tools', '--no-session-persistence', '--strict-mcp-config'];
const OPTIONS_OBLIGATOIRES_MODELE = [...OPTIONS_OBLIGATOIRES, '--permission-prompts', '--max-turns'];
const DELAI_MS = 120000;
const DELAI_MODELE_MS = 300000;
const FICHIER_ARRET = 'ARRET.txt';
const FICHIER_COMPTEUR = payant.COMPTEURS.context.fichier;
const FICHIER_JOURNAL = 'journal-deploiement.json';
/** Catégories intégrées de /context : toute autre est réduite à un total. */
const CATEGORIES_CONNUES = new Set([
  'System prompt', 'System tools', 'System tools (deferred)', 'MCP tools', 'MCP tools (deferred)',
  'MCP server instructions', 'Custom agents', 'Memory files', 'Skills', 'Messages', 'Free space', 'Autocompact buffer',
]);
const TYPES_MEMOIRE = new Set(['User', 'Project', 'Local', 'AutoMem', 'Managed']);

/** Les bases, mesurées au début et à la fin de chaque série. */
const BASES = [
  { id: 'base-vide', cle: 'vide', jeux: [], outils: '' },
  { id: 'base-skill', cle: 'avec_skill', jeux: [], outils: 'Skill' },
];
/** Les combinaisons de la partie gratuite (plan du lot I2, section 3). */
const COMBINAISONS = [
  { id: 'niveaux', jeux: ['niveaux'], outils: '' },
  { id: 'agents-seul', jeux: ['agents-seul'], outils: '' },
  { id: 'agents-avec-claude', jeux: ['agents-avec-claude'], outils: '' },
  { id: 'skills', jeux: ['skills'], outils: 'Skill' },
  { id: 'skills-sans-outil', jeux: ['skills'], outils: '' },
  { id: 'skill-long-1500', jeux: ['skill-long-1500'], outils: 'Skill' },
  { id: 'declencheurs', jeux: ['declencheurs'], outils: 'Skill' },
  { id: 'hook-sortie', jeux: ['hook-sortie'], outils: '', hookEvents: true },
  { id: 'hook-muet', jeux: ['hook-muet'], outils: '', hookEvents: true },
  { id: 'mcp-canari', jeux: ['mcp-canari'], outils: '' },
  { id: 'mcp-long', jeux: ['mcp-long'], outils: '' },
  { id: 'cout-f-quatre-chemins', jeux: ['cout-f-projet', 'cout-f-parent', 'cout-f-projet-claude', 'cout-f-global'], outils: '' },
  { id: 'cout-f2-projet', jeux: ['cout-f2-projet'], outils: '' },
  { id: 'cout-h15-anglais', jeux: ['cout-h15-anglais'], outils: '' },
  { id: 'cout-h15-code', jeux: ['cout-h15-code'], outils: '' },
  { id: 'cout-regles', jeux: ['cout-regle-court', 'cout-regle-long', 'cout-regle-paths'], outils: '' },
  { id: 'cout-skills', jeux: ['cout-skill-projet', 'cout-skill-global'], outils: 'Skill' },
  { id: 'cout-skill-x2', jeux: ['cout-skill-x2'], outils: 'Skill' },
  { id: 'cout-mcp-a1', jeux: ['cout-mcp-a1'], outils: '' },
  { id: 'cout-mcp-a2', jeux: ['cout-mcp-a2'], outils: '' },
  { id: 'cout-mcp-b1', jeux: ['cout-mcp-b1'], outils: '' },
  { id: 'jeu-complet', jeux: ['niveaux', 'skills', 'hook-sortie', 'mcp-canari'], outils: 'Skill', hookEvents: true },
];

const { Refus, RefusArgv, Arret, SerieRejetee, estSousOuEgal, estSousStrict, memeChemin } = commun;

const mod = commun.modChemin;

/** Lecture d'une variable, sans tenir compte de la casse sous Windows. */
function lireVar(env, nom, plateforme = process.platform) {
  if (env[nom] !== undefined) return env[nom];
  if (plateforme !== 'win32') return undefined;
  const cle = Object.keys(env).find((k) => k.toLowerCase() === nom.toLowerCase());
  return cle === undefined ? undefined : env[cle];
}

// --- Chemins, exécutable, environnement ----------------------------------------------------------

/** Chemins par défaut du profil isolé et de l'espace, remplaçables par les variables CANARI_CLAUDE_*. */
function cheminsParDefaut({ env = process.env, plateforme = process.platform, home = os.homedir() } = {}) {
  const p = mod(plateforme);
  let configDir;
  let espace;
  if (plateforme === 'win32') {
    const local = lireVar(env, 'LOCALAPPDATA', plateforme) || p.join(home, 'AppData', 'Local');
    configDir = p.join(local, 'canari-claude-code', 'config');
    espace = p.join(`${lireVar(env, 'SystemDrive', plateforme) || 'C:'}\\`, 'canari-claude-code', 'espace');
  } else {
    configDir = p.join(home, '.local', 'share', 'canari-claude-code', 'config');
    espace = '/tmp/canari-claude-code/espace';
  }
  const configForce = lireVar(env, 'CANARI_CLAUDE_CONFIG_DIR', plateforme);
  const espaceForce = lireVar(env, 'CANARI_CLAUDE_ESPACE', plateforme);
  if (configForce) configDir = configForce;
  if (espaceForce) espace = espaceForce;
  for (const [nom, valeur] of [['profil', configDir], ['espace', espace]]) {
    if (!p.isAbsolute(valeur)) throw new Refus(`chemin du ${nom} non absolu`);
  }
  return { configDir: p.normalize(configDir).replace(/[\\/]+$/, '') || p.normalize(configDir), espace: p.normalize(espace).replace(/[\\/]+$/, '') || p.normalize(espace) };
}

/**
 * L'exécutable de claude, jamais un .cmd ni un .bat (Node refuse de les lancer sans shell, et un
 * shell réinterpréterait les arguments). Sous Windows, un claude.cmd de npm donne le claude.exe voisin.
 */
function resoudreExe({ env = process.env, plateforme = process.platform, existe = fs.existsSync } = {}) {
  const p = mod(plateforme);
  const force = lireVar(env, 'CANARI_CLAUDE_EXE', plateforme);
  if (force) {
    if (!p.isAbsolute(force)) throw new Refus('CANARI_CLAUDE_EXE doit être un chemin absolu');
    if (plateforme === 'win32' && !/\.exe$/i.test(force)) throw new Refus('CANARI_CLAUDE_EXE doit désigner un .exe (jamais un .cmd ni un .bat)');
    if (!existe(force)) throw new Refus('CANARI_CLAUDE_EXE ne désigne aucun fichier');
    return force;
  }
  const dossiers = (lireVar(env, 'PATH', plateforme) || '')
    .split(plateforme === 'win32' ? ';' : ':')
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter((d) => d && p.isAbsolute(d));
  for (const d of dossiers) {
    if (plateforme === 'win32') {
      const exe = p.join(d, 'claude.exe');
      if (existe(exe)) return exe;
      if (existe(p.join(d, 'claude.cmd'))) {
        const voisin = p.join(d, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
        if (existe(voisin)) return voisin;
      }
    } else {
      const exe = p.join(d, 'claude');
      if (existe(exe)) return exe;
    }
  }
  throw new Refus('claude introuvable dans le PATH (ou seulement sous forme de .cmd sans claude.exe) : définir CANARI_CLAUDE_EXE');
}

/**
 * Liste blanche de l'environnement du processus enfant : les seules variables système nécessaires au
 * démarrage de claude et du shell des hooks. Tout le reste est retiré, en particulier les jetons et
 * clés d'autres services, et les variables de proxy et de certificats (exclues à dessein). Sous
 * Windows, la casse des noms est ignorée.
 */
const LISTE_BLANCHE = {
  win32: {
    noms: ['SystemRoot', 'windir', 'ComSpec', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
      'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'SystemDrive', 'OS', 'NUMBER_OF_PROCESSORS'],
    prefixes: ['PROCESSOR_'],
  },
  posix: { noms: ['HOME', 'PATH', 'LANG', 'TERM', 'TMPDIR', 'USER', 'SHELL'], prefixes: ['LC_'] },
};
const VARIABLES_POSEES = ['CLAUDE_CONFIG_DIR', 'DISABLE_AUTOUPDATER'];

/** Vrai si le nom figure dans la liste blanche de la plateforme (les deux variables posées exclues). */
function nomPermis(nom, plateforme = process.platform) {
  const l = LISTE_BLANCHE[plateforme === 'win32' ? 'win32' : 'posix'];
  if (plateforme === 'win32') {
    const n = nom.toUpperCase();
    return l.noms.some((x) => x.toUpperCase() === n) || l.prefixes.some((p) => n.startsWith(p.toUpperCase()));
  }
  return l.noms.includes(nom) || l.prefixes.some((p) => nom.startsWith(p));
}

/** L'environnement du processus enfant : la liste blanche du système, puis deux variables posées. */
function environnementNettoye(env, configDir, plateforme = process.platform) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || !nomPermis(k, plateforme)) continue;
    out[k] = v;
  }
  out.CLAUDE_CONFIG_DIR = configDir;
  out.DISABLE_AUTOUPDATER = '1';
  return out;
}

/**
 * Contrôle de l'environnement de l'enfant, refait juste avant chaque lancement : tout nom hors de la
 * liste blanche est refusé. Les messages ne citent aucun nom de variable hors de la liste.
 */
function problemesEnvironnement(env, configDir, plateforme = process.platform) {
  const out = [];
  const hors = Object.keys(env).filter((k) => !VARIABLES_POSEES.includes(k) && !nomPermis(k, plateforme));
  if (hors.length > 0) out.push(`${hors.length} variable(s) hors de la liste blanche`);
  if (env.CLAUDE_CONFIG_DIR !== configDir) out.push('CLAUDE_CONFIG_DIR ne désigne pas le profil isolé');
  if (env.DISABLE_AUTOUPDATER !== '1') out.push('DISABLE_AUTOUPDATER différent de 1');
  return out;
}

// --- Préconditions --------------------------------------------------------------------------------

const NOMS_PARENTS_INTERDITS = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude'];

/**
 * Préconditions de l'espace : hors du dossier personnel, du dépôt et du profil ; aucun fichier
 * d'instructions dans ses dossiers parents ; absent, vide, ou seulement un projet/ vide.
 */
function problemesEspace(espace, { home, depot, configDir, plateforme = process.platform, existe = fs.existsSync, lister = fs.readdirSync }) {
  const p = mod(plateforme);
  const out = [];
  if (estSousOuEgal(espace, home, plateforme) || estSousOuEgal(home, espace, plateforme)) out.push("l'espace est dans le dossier personnel (ou le contient)");
  if (estSousOuEgal(espace, depot, plateforme) || estSousOuEgal(depot, espace, plateforme)) out.push("l'espace est dans le dépôt (ou le contient)");
  if (estSousOuEgal(espace, configDir, plateforme) || estSousOuEgal(configDir, espace, plateforme)) out.push("l'espace et le profil isolé se recouvrent");
  let dossier = p.dirname(p.resolve(espace));
  for (let niveau = 1; ; niveau++) {
    for (const nom of NOMS_PARENTS_INTERDITS) {
      if (existe(p.join(dossier, nom))) out.push(`${nom} présent dans un dossier parent de l'espace (${niveau} niveau${niveau > 1 ? 'x' : ''} au-dessus)`);
    }
    const parent = p.dirname(dossier);
    if (parent === dossier) break;
    dossier = parent;
  }
  if (existe(espace)) {
    const contenu = lister(espace);
    const seulProjetVide = contenu.length === 1 && contenu[0] === 'projet' && lister(p.join(espace, 'projet')).length === 0;
    if (contenu.length > 0 && !seulProjetVide) out.push(`l'espace n'est pas vide (${contenu.length} élément(s)) : déploiement interrompu ? lancer « retirer »`);
  }
  return out;
}

/** Contrôle de « claude auth status --json » ; `sensibles` reste en mémoire pour la liste noire. */
function problemesAuth(etat, configDir, plateforme = process.platform) {
  const sensibles = [];
  if (etat === null || typeof etat !== 'object' || Array.isArray(etat)) return { problemes: ['état de connexion illisible'], sensibles };
  const neutres = new Set(['loggedin', 'authmethod', 'apiprovider', 'subscriptiontype']);
  const collecter = (v, cle) => {
    if (typeof v === 'string' && v.length >= 3 && !neutres.has(cle)) sensibles.push(v);
    else if (Array.isArray(v)) v.forEach((x) => collecter(x, cle));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) collecter(x, k.toLowerCase());
  };
  collecter(etat, '');
  const out = [];
  if (etat.loggedIn !== true) out.push('profil non connecté');
  if (etat.authMethod !== 'claude.ai') out.push(`méthode de connexion « ${String(etat.authMethod)} » (claude.ai attendu)`);
  if (etat.apiProvider !== 'firstParty') out.push(`fournisseur « ${String(etat.apiProvider)} » (firstParty attendu)`);
  if (!ABONNEMENTS.includes(etat.subscriptionType)) out.push(`abonnement « ${String(etat.subscriptionType)} » (${ABONNEMENTS.join(', ')} attendu)`);
  if (typeof etat.configDirectory !== 'string' || !memeChemin(etat.configDirectory, configDir, plateforme)) out.push("configDirectory n'est pas le profil isolé");
  for (const [k, v] of Object.entries(etat)) {
    if (/api.?key/i.test(k) && v && v !== 'none') out.push(`clé « ${k} » renseignée`);
  }
  return { problemes: out, sensibles };
}

// --- Arguments de claude ----------------------------------------------------------------------------

/** La seule invite permise dans ce lot : « /context » ou « /context all », exactement. */
function verifierPrompt(prompt) {
  if (typeof prompt !== 'string' || !PROMPTS.includes(prompt)) {
    throw new RefusArgv(`invite refusée : seules ${PROMPTS.map((x) => `« ${x} »`).join(' et ')} sont permises dans ce lot`);
  }
  return prompt;
}

const outilsValides = (v) => typeof v === 'string' && (v === '' || v.split(',').every((t) => OUTILS_CONNUS.has(t)));

/** Les arguments d'un /context (mêmes options qu'en phase 2). */
function argumentsContext({ prompt = '/context', outils = '', mcpConfig, pluginDir, hookEvents = false }) {
  verifierPrompt(prompt);
  if (!outilsValides(outils)) throw new RefusArgv('jeu d\'outils inconnu');
  const argv = ['-p', prompt, '--model', MODELE, '--effort', EFFORT, '--output-format', 'stream-json', '--verbose',
    '--tools', outils, '--no-session-persistence', '--strict-mcp-config'];
  if (mcpConfig) argv.push('--mcp-config', mcpConfig);
  if (pluginDir) argv.push('--plugin-dir', pluginDir);
  if (hookEvents) argv.push('--include-hook-events');
  return argv;
}

/**
 * Les arguments d'une étape de la partie payante (appel au modèle, ou /context avec les mêmes options) :
 * --permission-prompts none et --max-turns toujours ; pour un déclencheur, --permission-mode dontAsk et
 * --settings (un fichier de l'espace, jamais du JSON dans l'argv) ; --allowedTools seulement s'il le faut.
 */
function argumentsAppel({ prompt, outils = '', toursMax, declencheur = false, settings, autorisation, mcpConfig, pluginDir, hookEvents = false }) {
  if (typeof prompt !== 'string' || prompt === '') throw new RefusArgv('invite absente');
  if (!outilsValides(outils)) throw new RefusArgv('jeu d\'outils inconnu');
  const argv = ['-p', prompt, '--model', MODELE, '--effort', EFFORT, '--output-format', 'stream-json', '--verbose',
    '--tools', outils, '--no-session-persistence', '--strict-mcp-config', '--permission-prompts', 'none', '--max-turns', String(toursMax)];
  if (declencheur) {
    if (!settings) throw new RefusArgv('déclencheur sans fichier de réglages');
    argv.push('--permission-mode', 'dontAsk', '--settings', settings);
  }
  if (autorisation) argv.push('--allowedTools', autorisation);
  if (mcpConfig) argv.push('--mcp-config', mcpConfig);
  if (pluginDir) argv.push('--plugin-dir', pluginDir);
  if (hookEvents) argv.push('--include-hook-events');
  return argv;
}

/** L'autorisation exigée pour un jeu d'outils de déclencheur : Edit(./**) pour Write ou Edit, Bash(cat *) pour Bash. */
function autorisationAttendue(outils) {
  const liste = outils.split(',');
  if (liste.includes('Write') || liste.includes('Edit')) return payant.AUTORISATIONS.edit;
  if (liste.includes('Bash')) return payant.AUTORISATIONS.cat;
  return null;
}

/**
 * Seconde barrière, appliquée à l'argv final dans lancerClaude : « --version », « auth status --json »,
 * « -p /context », ou « -p <invite> » si `invites` (texte → identifiant, vérifiées par leur empreinte)
 * la contient. --mcp-config, --plugin-dir et --settings doivent désigner un chemin absolu sous
 * l'espace. Un appel au modèle doit avoir des options cohérentes avec son jeu d'outils.
 * Renvoie la forme reconnue : version, auth, context ou modele.
 */
function verifierArgv(argv, { espace, plateforme = process.platform, invites = null }) {
  if (!Array.isArray(argv) || argv.some((a) => typeof a !== 'string')) throw new RefusArgv('arguments invalides');
  if (argv.length === 1 && argv[0] === '--version') return 'version';
  if (argv.length === 3 && argv[0] === 'auth' && argv[1] === 'status' && argv[2] === '--json') return 'auth';
  if (argv[0] !== '-p') throw new RefusArgv('seuls « --version », « auth status --json », « -p /context » et « -p <invite de SONDE.md> » sont permis');
  let forme;
  if (PROMPTS.includes(argv[1])) forme = 'context';
  else if (invites instanceof Map && invites.has(argv[1])) forme = 'modele';
  else if (invites instanceof Map) throw new RefusArgv('invite refusée : elle ne figure pas dans SONDE.md avec une empreinte vérifiée');
  else verifierPrompt(argv[1]);
  const p = mod(plateforme);
  const vus = new Set();
  const valeurs = new Map();
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (vus.has(a)) throw new RefusArgv(`option répétée : ${a}`);
    vus.add(a);
    if (a in OPTIONS_FIXES) {
      if (argv[++i] !== OPTIONS_FIXES[a]) throw new RefusArgv(`${a} : valeur refusée`);
    } else if (a === '--tools') {
      if (!outilsValides(argv[++i])) throw new RefusArgv('--tools : jeu d\'outils refusé');
    } else if (OPTIONS_CHEMINS.has(a)) {
      const v = argv[++i];
      if (typeof v !== 'string' || !p.isAbsolute(v) || !estSousStrict(v, espace, plateforme)) throw new RefusArgv(`${a} : le chemin doit être sous l'espace`);
    } else if (a === '--max-turns') {
      if (!TOURS_PERMIS.has(argv[++i])) throw new RefusArgv('--max-turns : valeur refusée (1 ou 3)');
    } else if (a === '--allowedTools') {
      if (!AUTORISATIONS_PERMISES.has(argv[++i])) throw new RefusArgv('--allowedTools : autorisation refusée');
    } else if (!OPTIONS_SEULES.has(a)) {
      throw new RefusArgv(`option refusée : ${a}`);
    }
    if (!OPTIONS_SEULES.has(a)) valeurs.set(a, argv[i]);
  }
  const obligatoires = forme === 'modele' ? OPTIONS_OBLIGATOIRES_MODELE : OPTIONS_OBLIGATOIRES;
  const manquantes = obligatoires.filter((o) => !vus.has(o));
  if (manquantes.length > 0) throw new RefusArgv(`option obligatoire absente : ${manquantes.join(', ')}`);
  if (valeurs.has('--allowedTools') && !valeurs.has('--permission-mode')) throw new RefusArgv('--allowedTools sans --permission-mode dontAsk');
  if (forme === 'modele') {
    const outils = valeurs.get('--tools');
    const fichiers = outils !== '' && outils.split(',').some((t) => OUTILS_FICHIERS.has(t));
    if (fichiers) {
      if (!payant.OUTILS_DECLENCHEURS.has(outils)) throw new RefusArgv('déclencheur : un seul outil par appel (Read et Edit pour Edit)');
      if (valeurs.get('--max-turns') !== '3') throw new RefusArgv('déclencheur : --max-turns 3 attendu');
      if (!valeurs.has('--permission-mode') || !valeurs.has('--settings')) throw new RefusArgv('déclencheur : --permission-mode dontAsk et --settings obligatoires');
      if ((valeurs.get('--allowedTools') ?? null) !== autorisationAttendue(outils)) throw new RefusArgv('déclencheur : autorisation incohérente avec le jeu d\'outils');
    } else {
      if (valeurs.get('--max-turns') !== '1') throw new RefusArgv('appel sans outil de fichier : --max-turns 1 attendu');
      if (['--permission-mode', '--settings', '--allowedTools'].some((o) => valeurs.has(o))) throw new RefusArgv('options de déclencheur refusées hors de la série 5');
    }
  }
  return forme;
}

// --- Lecture et contrôle d'un /context ---------------------------------------------------------------

/** Lit la sortie stream-json : message d'initialisation, context_usage et résultat. */
function lireFlux(texte) {
  const objets = [];
  let illisibles = 0;
  for (const ligne of String(texte).split(/\r?\n/)) {
    const l = ligne.trim();
    if (!l) continue;
    if (!l.startsWith('{')) {
      illisibles++;
      continue;
    }
    try {
      objets.push(JSON.parse(l));
    } catch {
      illisibles++;
    }
  }
  const init = objets.find((o) => o && o.type === 'system' && o.subtype === 'init') ?? null;
  const assistant = objets.find((o) => o && o.type === 'assistant' && o.context_usage) ?? null;
  const results = objets.filter((o) => o && o.type === 'result');
  return {
    init,
    contextUsage: assistant ? assistant.context_usage : null,
    usageAssistant: assistant?.message?.usage ?? null,
    result: results.length > 0 ? results[results.length - 1] : null,
    nombreResults: results.length,
    illisibles,
  };
}

const CHAMPS_USAGE = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'];
/** Somme des quatre compteurs d'usage ; NaN si l'un manque. */
const sommeUsage = (u) => (u && typeof u === 'object' ? CHAMPS_USAGE.reduce((s, k) => s + (Number.isFinite(u[k]) ? u[k] : NaN), 0) : NaN);

/**
 * Contrôles après un /context. `arret` = un appel aurait pu consommer ou ne passait pas par
 * l'abonnement : arrêt définitif. Les autres problèmes font échouer la série sans arrêt définitif.
 */
function controlerAppel(flux, { versionAttendue } = {}) {
  const arret = [];
  const autres = [];
  if (!flux.init) arret.push("message d'initialisation absent : apiKeySource invérifiable");
  else if (flux.init.apiKeySource !== 'none') arret.push(`apiKeySource=${String(flux.init.apiKeySource)} (none attendu)`);
  if (!flux.result) arret.push('résultat absent : usage invérifiable');
  else {
    const somme = sommeUsage(flux.result.usage);
    if (somme !== 0) arret.push(`usage non nul ou illisible (${Number.isNaN(somme) ? 'illisible' : somme})`);
    if (flux.result.num_turns !== 0) arret.push(`num_turns=${String(flux.result.num_turns)} (0 attendu)`);
    if (flux.result.total_cost_usd !== undefined && flux.result.total_cost_usd !== 0) arret.push(`total_cost_usd=${String(flux.result.total_cost_usd)} (0 attendu pour un /context)`);
    if (flux.result.is_error) autres.push('résultat en erreur');
  }
  if (flux.nombreResults > 1) arret.push(`${flux.nombreResults} résultats (un seul attendu)`);
  if (flux.usageAssistant && sommeUsage(flux.usageAssistant) !== 0) arret.push("usage non nul dans le message de /context");
  if (!flux.contextUsage) autres.push('context_usage absent');
  if (versionAttendue && flux.init && flux.init.claude_code_version !== versionAttendue) autres.push('version différente de celle notée avant la série');
  return { arret, autres, ok: arret.length === 0 && autres.length === 0 };
}

// --- Compteur et fichier ARRET ----------------------------------------------------------------------

function verifierArret(dossier) {
  if (fs.existsSync(path.join(dossier, FICHIER_ARRET))) {
    throw new Arret(`${FICHIER_ARRET} présent dans brut/ : aucun lancement de claude. Examiner la cause, puis retirer le fichier à la main.`);
  }
}

function ecrireArret(dossier, raison) {
  fs.mkdirSync(dossier, { recursive: true });
  fs.appendFileSync(path.join(dossier, FICHIER_ARRET), `${new Date().toISOString()} ${raison}\n`, 'utf8');
}

// Les compteurs (/context et modèle) sont dans sonde-claude-code-payant.js : lireCompteur(dossier,
// type, lot), ouvrirLot, verifierBudget, reserver. Ces raccourcis gardent les noms du lot I2.
const lireCompteur = (dossier, type, lot) => payant.lireCompteur(dossier, type, lot);
const verifierBudget = (dossier, prevus, lot) => payant.verifierBudget(dossier, 'context', lot, prevus);
const reserverContext = (dossier, lot) => payant.reserver(dossier, 'context', lot);

/** Ouvre un lot de compteur ; un archivage est toujours annoncé en console. */
function ouvrirLotAnnonce(dossier, type, lot) {
  const r = payant.ouvrirLot(dossier, type, lot);
  if (r) console.log(`[sonde-claude] Compteur ${type} du lot ${r.ancien.lot} (${r.ancien.utilises} sur ${r.ancien.plafond}) archivé sous brut/${r.archive} ; lot ${lot} ouvert, sans remise à zéro de l'ancien.`);
  const releve = payant.releverPlafond(dossier, type, lot);
  if (releve) {
    const t = releve.historique_plafond[releve.historique_plafond.length - 1];
    console.log(`[sonde-claude] Plafond du compteur ${type} du lot ${lot} relevé de ${t.ancien} à ${t.nouveau} (décision du ${t.date}) ; ${releve.utilises} utilisé(s) conservé(s).`);
  }
  return r;
}

// --- Normalisation ------------------------------------------------------------------------------------

/** Les racines de réécriture, de la plus longue à la plus courte. */
function racinesNormalisation({ configDir, espace }, p = path) {
  const r = commun.racinesCibles({ configDir, espace }, p);
  return ['plugin', 'mcp', 'projet', 'parent', 'global'].map((cible) => ({ etiquette: `<${cible}>`, chemin: r[cible] }));
}

/** Réécrit un chemin absolu en <global>/…, <parent>/…, etc. ; null s'il est hors des racines. */
function reecrireChemin(chemin, racines, nomMemoire, plateforme = process.platform) {
  if (typeof chemin !== 'string' || chemin === '') return null;
  const p = mod(plateforme);
  for (const { etiquette, chemin: racine } of racines) {
    if (!estSousOuEgal(chemin, racine, plateforme)) continue;
    const rel = p.relative(p.resolve(racine), p.resolve(chemin)).split(/[\\/]+/).filter(Boolean);
    if (etiquette === '<global>' && rel[0] === 'projects' && rel[1] && rel[1].toLowerCase() === String(nomMemoire).toLowerCase()) rel[1] = '<memoire>';
    return [etiquette, ...rel].join('/');
  }
  return null;
}

const totalVide = () => ({ nombre: 0, tokens: 0 });
const ajouter = (t, tokens) => {
  t.nombre++;
  t.tokens += Number.isFinite(tokens) ? tokens : 0;
};
const estNomFixture = (v) => typeof v === 'string' && commun.NOM_PERMIS.test(v);

/** Les fixtures attendues dans /context : fichiers de mémoire (.md hors skills et plugin) et skills. */
function fixturesAttendues(plan) {
  const memoire = [];
  const skills = [];
  for (const e of plan) {
    const nom = e.chemin.split('/').pop();
    if (nom === 'SKILL.md') {
      const dossier = e.chemin.split('/').slice(-2)[0];
      skills.push(e.cible === 'plugin' ? `${e.chemin.split('/')[0]}:${dossier}` : dossier);
    } else if (nom.endsWith('.md') && ['global', 'parent', 'projet'].includes(e.cible)) {
      memoire.push(e.normalise);
    }
  }
  return { memoire, skills: [...new Set(skills)] };
}

/**
 * Le compte o200k de chaque fichier de mémoire (fichier entier, en LF) et de chaque skill de fixture
 * (ligne « - nom: description ») d'un plan, pour le rapport r = /context ÷ o200k de H15.
 */
function o200kDuPlan(plan, lireTexte = (f) => fs.readFileSync(f, 'utf8')) {
  const memoire = new Map();
  const skills = new Map();
  for (const e of plan) {
    const nom = e.chemin.split('/').pop();
    if (nom === 'SKILL.md') {
      const ligne = payant.ligneSkill(lireTexte(e.source));
      const dossier = e.chemin.split('/').slice(-2)[0];
      if (ligne) skills.set(e.cible === 'plugin' ? `${e.chemin.split('/')[0]}:${dossier}` : dossier, payant.o200k(ligne));
    } else if (nom.endsWith('.md') && ['global', 'parent', 'projet'].includes(e.cible)) {
      memoire.set(e.normalise.toLowerCase(), payant.o200k(enLf(lireTexte(e.source))));
    }
  }
  return { memoire, skills };
}

/** Une entrée de rapport : fixtures par leur nom, tout le reste en totaux, aucun chemin absolu. */
function normaliserCombinaison(flux, { racines, nomMemoire, plan = [], plateforme = process.platform, o200k = null }) {
  const cu = flux.contextUsage || {};
  const deployes = new Set(plan.map((e) => e.normalise.toLowerCase()));
  const attendues = fixturesAttendues(plan);
  const hors = { categories_hors: totalVide(), memoire_hors: totalVide(), skills_hors: totalVide(), outils_mcp_hors: totalVide(), agents_hors: totalVide() };

  const categories = [];
  for (const c of cu.categories || []) {
    if (CATEGORIES_CONNUES.has(c.name)) categories.push({ nom: c.name, tokens: c.tokens, genre: c.kind });
    else ajouter(hors.categories_hors, c.tokens);
  }
  const memoryFiles = [];
  for (const f of cu.memory_files || []) {
    const chemin = reecrireChemin(f.path, racines, nomMemoire, plateforme);
    if (chemin && deployes.has(chemin.toLowerCase()) && TYPES_MEMOIRE.has(f.type)) {
      const compte = o200k && o200k.memoire ? o200k.memoire.get(chemin.toLowerCase()) : undefined;
      memoryFiles.push({ chemin, type: f.type, tokens: f.tokens, ...(compte !== undefined ? { o200k: compte } : {}) });
    }
    else ajouter(hors.memoire_hors, f.tokens);
  }
  const skills = [];
  for (const s of cu.skills || []) {
    const pluginOk = s.plugin_name === undefined || s.plugin_name === null || estNomFixture(s.plugin_name);
    if (estNomFixture(s.name) && pluginOk) {
      const compte = o200k && o200k.skills ? o200k.skills.get(s.name) : undefined;
      skills.push({ name: s.name, source: s.source, ...(s.plugin_name ? { plugin: s.plugin_name } : {}), tokens: s.tokens, ...(compte !== undefined ? { o200k: compte } : {}) });
    }
    else ajouter(hors.skills_hors, s.tokens);
  }
  const mcpTools = [];
  for (const t of cu.mcp_tools || []) {
    if (estNomFixture(t.name) && estNomFixture(t.server_name)) mcpTools.push({ name: t.name, server: t.server_name, tokens: t.tokens });
    else ajouter(hors.outils_mcp_hors, t.tokens);
  }
  for (const a of cu.agents || []) ajouter(hors.agents_hors, a && a.tokens);

  const init = flux.init || {};
  const listes = {
    skills: (init.skills || []).filter(estNomFixture),
    plugins: (init.plugins || []).filter((x) => estNomFixture(x && x.name)).map((x) => ({ name: x.name })),
    mcp_servers: (init.mcp_servers || []).filter((x) => estNomFixture(x && x.name)).map((x) => ({ name: x.name, statut: x.status })),
  };
  const listes_md = new Set(memoryFiles.map((f) => f.chemin.toLowerCase()));
  const listes_sk = new Set(skills.map((s) => s.name));
  return {
    total: cu.total_tokens,
    categories,
    memory_files: memoryFiles,
    skills,
    mcp_tools: mcpTools,
    hors_fixtures: hors,
    init: {
      nombre_outils: (init.tools || []).length,
      nombre_skills: (init.skills || []).length,
      nombre_plugins: (init.plugins || []).length,
      ...listes,
    },
    fixtures_absentes: [
      ...attendues.memoire.filter((m) => !listes_md.has(m.toLowerCase())),
      ...attendues.skills.filter((s) => !listes_sk.has(s)).map((s) => `skill ${s}`),
    ],
  };
}

/** Écarts entre deux bases : total et chaque catégorie, tolérance 0. */
function comparerBases(debut, fin) {
  const out = [];
  if (!debut || !fin) return ['base manquante'];
  if (debut.total !== fin.total) out.push(`total ${debut.total} → ${fin.total}`);
  const enTable = (b) => new Map((b.categories || []).map((c) => [c.nom, c.tokens]));
  const a = enTable(debut);
  const b = enTable(fin);
  for (const nom of new Set([...a.keys(), ...b.keys()])) if (a.get(nom) !== b.get(nom)) out.push(`${nom} ${a.get(nom)} → ${b.get(nom)}`);
  return out;
}

// --- Profil isolé ---------------------------------------------------------------------------------------

/** Liste du profil : noms, types et tailles par lstat seulement ; aucun fichier n'est ouvert. */
function listerProfil(configDir) {
  const out = new Map();
  const parcourir = (dossier, base) => {
    for (const nom of fs.readdirSync(dossier).sort()) {
      const abs = path.join(dossier, nom);
      const rel = base ? `${base}/${nom}` : nom;
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) out.set(rel, { type: 'l', taille: 0 });
      else if (st.isDirectory()) {
        out.set(rel, { type: 'd', taille: 0 });
        parcourir(abs, rel);
      } else out.set(rel, { type: 'f', taille: st.size });
    }
  };
  parcourir(configDir, '');
  return out;
}

/** Les écarts de cache créés par Claude Code lui-même (point 0 de la phase 2), nommés. */
function motifConnu(rel, nature, type, nomMemoire) {
  const m = String(nomMemoire).toLowerCase();
  const r = rel.toLowerCase();
  if (r === '.claude.json' && nature === 'modifié') return '.claude.json';
  if (/^backups\/\.claude\.json\.backup\.[^/]+$/.test(r) && nature !== 'modifié') return 'backups/.claude.json.backup.*';
  if (r === 'backups' && type === 'd' && nature === 'ajouté') return 'backups/';
  if (r === 'policy-limits.json.signature.json' && nature === 'modifié') return 'policy-limits.json.signature.json';
  if (type === 'd' && nature === 'ajouté' && (r === 'projects' || r === `projects/${m}` || r === `projects/${m}/memory`)) return 'projects/<memoire>/memory/ (vide)';
  if (type === 'd' && nature === 'ajouté' && (r === 'session-env' || /^session-env\/[^/]+$/.test(r))) return 'session-env/<id>/ (vide)';
  // La synchronisation du compte pendant une série (mesuré le 2026-11-09) : skills/synced/ dans tous
  // les sens, policy-limits.json ajouté ou modifié seulement.
  const synchronise = commun.cheminSynchronise(rel);
  if (synchronise === commun.MOTIF_SKILLS_SYNCHRONISES) return synchronise;
  if (synchronise === commun.MOTIF_LIMITES && type === 'f' && nature !== 'retiré') return synchronise;
  return null;
}

/**
 * Les écarts du profil entre deux listes. Les écarts connus ne sont donnés que par motif, avec leur
 * nombre par nature, jamais par nom de fichier ; les inconnus sont nommés (ils restent dans brut/).
 */
function ecartsProfil(avant, apres, nomMemoire) {
  const connus = new Map();
  const inconnus = [];
  const champ = { 'ajouté': 'ajoutes', 'modifié': 'modifies', 'retiré': 'retires' };
  const noter = (rel, nature, type) => {
    const motif = motifConnu(rel, nature, type, nomMemoire);
    if (!motif) {
      inconnus.push({ chemin: rel, nature });
      return;
    }
    const c = connus.get(motif) || { motif, nombre: 0, ajoutes: 0, modifies: 0, retires: 0 };
    c.nombre += 1;
    c[champ[nature]] += 1;
    connus.set(motif, c);
  };
  for (const [rel, e] of apres) {
    const a = avant.get(rel);
    if (!a) noter(rel, 'ajouté', e.type);
    else if (a.type !== e.type || a.taille !== e.taille) noter(rel, 'modifié', e.type);
  }
  for (const [rel, e] of avant) if (!apres.has(rel)) noter(rel, 'retiré', e.type);
  return { connus: [...connus.values()], inconnus };
}

// --- Déploiement et retrait ---------------------------------------------------------------------------------

const sha256 = (texte) => crypto.createHash('sha256').update(texte, 'utf8').digest('hex');
const enLf = (texte) => texte.replace(/\r\n?/g, '\n');
const attendre = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Réessaie une opération qu'un antivirus peut bloquer un instant (EBUSY, EPERM). */
function avecReprise(operation) {
  for (let essai = 1; ; essai++) {
    try {
      return operation();
    } catch (err) {
      if (essai >= 5 || !['EBUSY', 'EPERM'].includes(err.code)) throw err;
      attendre(200 * essai);
    }
  }
}

/** Liste les fixtures (chemins relatifs à fixtures/, séparateur « / »). */
function listerFixtures(dossier = FIXTURES) {
  const out = [];
  const parcourir = (abs, base) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) parcourir(path.join(abs, e.name), rel);
      else out.push(rel);
    }
  };
  parcourir(dossier, '');
  const invalides = out.filter((rel) => rel.split('/').length < 3 || !rel.endsWith(commun.SUFFIXE));
  if (invalides.length > 0) throw new Refus(`fixtures invalides : ${invalides.join(', ')}`);
  return out.sort();
}

/**
 * Les fichiers à écrire pour une combinaison : fixtures converties, et pour le MCP la copie du
 * serveur, chaque définition sous son jeu et la configuration générée. Contenus en LF.
 */
function fichiersADeployer(plan, { espace, inventaire, jeux = [...new Set(plan.map((e) => e.jeu))], serveurSource = SERVEUR, node = process.execPath, lireTexte = (f) => fs.readFileSync(f, 'utf8') }) {
  if (!(inventaire instanceof Map)) throw new Refus('inventaire absent : aucun déploiement sans contrôle des empreintes');
  const textes = plan.map((e) => lireTexte(e.source));
  // Empreintes contrôlées sur le contenu même qui sera écrit : tout écart refuse le déploiement entier.
  const ecarts = commun.ecartsEmpreintes(jeux, new Map(plan.map((e, i) => [e.rel, textes[i]])), inventaire);
  if (ecarts.length > 0) throw new Refus(`empreintes : déploiement refusé (${ecarts.join(' ; ')})`);
  const fichiers = plan.map((e, i) => ({ destination: e.destination, contenu: enLf(textes[i]) }));
  const mcp = plan.filter((e) => e.cible === 'mcp');
  let mcpConfig = null;
  if (mcp.length > 0) {
    const { problemesDefinition } = require(SERVEUR);
    const racine = commun.racinesCibles({ configDir: '', espace }).mcp;
    const serveurCopie = path.join(racine, 'serveur-fixture.js');
    const mcpServers = {};
    for (const e of mcp) {
      const def = JSON.parse(fichiers[plan.indexOf(e)].contenu);
      const pb = problemesDefinition(def);
      if (pb.length > 0) throw new Refus(`${e.rel} : définition MCP invalide (${pb.join(' ; ')})`);
      if (mcpServers[def.nom]) throw new Refus(`serveur MCP en double : ${def.nom}`);
      mcpServers[def.nom] = { type: 'stdio', command: node, args: [serveurCopie, e.destination], ...(def.env ? { env: { ...def.env } } : {}) };
    }
    mcpConfig = path.join(racine, 'mcp-config.json');
    fichiers.push({ destination: serveurCopie, contenu: enLf(lireTexte(serveurSource)) });
    fichiers.push({ destination: mcpConfig, contenu: `${JSON.stringify({ mcpServers }, null, 2)}\n` });
  }
  const plugin = plan.find((e) => e.cible === 'plugin');
  const pluginDir = plugin ? path.join(commun.racinesCibles({ configDir: '', espace }).plugin, plugin.chemin.split('/')[0]) : null;
  return { fichiers, mcpConfig, pluginDir };
}

const ecrireJournal = (journalPath, journal) => {
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  fs.writeFileSync(`${journalPath}.tmp`, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  fs.renameSync(`${journalPath}.tmp`, journalPath);
};

/**
 * Déploie des fichiers : refus de toute cible déjà présente (rien n'est écrit), journal écrit avant
 * chaque création, dossiers créés notés, fichiers écrits en « wx » (jamais d'écrasement).
 */
function deployer(fichiers, journalPath, racinesPermises) {
  if (fs.existsSync(journalPath)) throw new Refus('un journal de déploiement existe déjà : lancer « retirer »');
  const horsRacines = fichiers.filter((f) => !racinesPermises.some((r) => estSousStrict(f.destination, r)));
  if (horsRacines.length > 0) throw new Refus(`${horsRacines.length} destination(s) hors des racines permises`);
  const doublons = fichiers.filter((f, i) => fichiers.findIndex((g) => memeChemin(g.destination, f.destination)) !== i);
  if (doublons.length > 0) throw new Refus('deux fichiers visent la même destination');
  const presents = fichiers.filter((f) => fs.existsSync(f.destination));
  if (presents.length > 0) throw new Refus(`refus d'écrasement : ${presents.length} destination(s) déjà présente(s)`);
  const journal = { etat: 'deploiement-en-cours', fichiers: fichiers.map((f) => ({ destination: f.destination, sha256: sha256(f.contenu) })), dossiers: [] };
  ecrireJournal(journalPath, journal);
  for (const f of fichiers) {
    const manquants = [];
    for (let d = path.dirname(f.destination); !fs.existsSync(d); d = path.dirname(d)) manquants.unshift(d);
    for (const d of manquants) {
      journal.dossiers.push(d);
      ecrireJournal(journalPath, journal);
      fs.mkdirSync(d);
    }
    fs.writeFileSync(f.destination, f.contenu, { encoding: 'utf8', flag: 'wx' });
  }
  journal.etat = 'deploye';
  ecrireJournal(journalPath, journal);
  return journal;
}

/**
 * Retire un déploiement d'après son journal : seuls les fichiers identiques à ce qui a été écrit
 * sont supprimés, puis les dossiers créés, s'ils sont vides. Un fichier modifié est conservé, sauf
 * s'il figure dans `modifsPermises` (effet attendu d'un déclencheur). Les fichiers de `creesPermis`
 * (créés par un déclencheur, chemins exacts) sont supprimés d'abord ; rien d'autre ne l'est.
 */
function retirer(journalPath, { modifsPermises = [], creesPermis = [] } = {}) {
  if (!fs.existsSync(journalPath)) return { problemes: [], attendus: [] };
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  const problemes = [];
  const attendus = [];
  for (const c of creesPermis) {
    if (journal.fichiers.some((f) => memeChemin(f.destination, c))) continue;
    if (fs.existsSync(c) && fs.lstatSync(c).isFile()) {
      avecReprise(() => fs.unlinkSync(c));
      attendus.push(c);
    }
  }
  for (const f of [...journal.fichiers].reverse()) {
    if (!fs.existsSync(f.destination)) continue;
    if (sha256(fs.readFileSync(f.destination, 'utf8')) !== f.sha256) {
      if (!modifsPermises.some((m) => memeChemin(m, f.destination))) {
        problemes.push(`fichier modifié conservé : ${f.destination}`);
        continue;
      }
      attendus.push(f.destination);
    }
    avecReprise(() => fs.unlinkSync(f.destination));
  }
  for (const d of [...journal.dossiers].reverse()) {
    if (!fs.existsSync(d)) continue;
    if (fs.readdirSync(d).length > 0) problemes.push(`dossier non vide conservé : ${d}`);
    else avecReprise(() => fs.rmdirSync(d));
  }
  if (problemes.length === 0) fs.unlinkSync(journalPath);
  else ecrireJournal(journalPath, { ...journal, etat: 'retrait-incomplet' });
  return { problemes, attendus };
}

// --- Lancement de claude ---------------------------------------------------------------------------------

function arreterArbre(enfant, plateforme = process.platform) {
  if (plateforme === 'win32' && enfant.pid) spawnSync('taskkill', ['/T', '/F', '/PID', String(enfant.pid)], { windowsHide: true, stdio: 'ignore' });
  else enfant.kill('SIGKILL');
}

/**
 * Le seul point de lancement de claude : fichier ARRET, liste blanche des arguments (invites de
 * SONDE.md comprises si `invites` est fourni), environnement contrôlé, réservation du compteur du
 * lot (/context ou modèle) AVANT le lancement, aucun shell, entrée standard fermée. Pour un appel au
 * modèle, la garde de flux examine chaque ligne du stream-json et tue l'arbre de processus au
 * premier écart.
 */
function lancerClaude({ exe, argv, env, cwd, espace, configDir, dossierBrut, plateforme = process.platform, delaiMs = DELAI_MS, lot = null, invites = null, garde = null }) {
  verifierArret(dossierBrut);
  const forme = verifierArgv(argv, { espace, plateforme, invites });
  const pb = problemesEnvironnement(env, configDir, plateforme);
  if (pb.length > 0) throw new Refus(`environnement non conforme : ${pb.join(' ; ')}`);
  if (forme === 'modele' && typeof garde !== 'function') throw new Refus('appel au modèle sans garde de flux');
  if ((forme === 'context' || forme === 'modele') && !lot) throw new Refus('lot du compteur absent');
  let numero = null;
  if (forme === 'context') numero = reserverContext(dossierBrut, lot);
  else if (forme === 'modele') numero = payant.reserver(dossierBrut, 'modele', lot);
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let reste = '';
    let expire = false;
    let violation = null;
    const enfant = spawn(exe, argv, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    enfant.stdout.setEncoding('utf8');
    enfant.stderr.setEncoding('utf8');
    enfant.stdout.on('data', (d) => {
      stdout += d;
      if (!garde || violation) return;
      reste += d;
      const lignes = reste.split(/\r?\n/);
      reste = lignes.pop();
      for (const ligne of lignes) {
        let obj = null;
        try {
          obj = JSON.parse(ligne);
        } catch {
          continue;
        }
        const v = garde(obj);
        if (v) {
          violation = v;
          arreterArbre(enfant, plateforme);
          break;
        }
      }
    });
    enfant.stderr.on('data', (d) => (stderr += d));
    const minuteur = setTimeout(() => {
      expire = true;
      arreterArbre(enfant, plateforme);
    }, delaiMs);
    enfant.on('error', (err) => {
      clearTimeout(minuteur);
      resolve({ forme, numero, code: null, stdout, stderr: `${stderr}${err.message}`, expire, violation });
    });
    enfant.on('close', (code) => {
      clearTimeout(minuteur);
      resolve({ forme, numero, code, stdout, stderr, expire, violation });
    });
  });
}

/** Processus node du serveur MCP de fixture encore actifs sous l'espace ; null si invérifiable. */
function processusFixtureRestants(espace, plateforme = process.platform) {
  const r = plateforme === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { $_.CommandLine }"], { encoding: 'utf8', windowsHide: true })
    : spawnSync('ps', ['-eo', 'args'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  const e = espace.toLowerCase();
  return r.stdout.split(/\r?\n/).filter((l) => l.toLowerCase().includes('serveur-fixture.js') && l.toLowerCase().includes(e)).length;
}

// --- Rapport ---------------------------------------------------------------------------------------------

/** Écrit le rapport normalisé après la garde ; rien n'est écrit au moindre problème. */
function ecrireRapport(rapport, { destination, nom, poste, interdits, dossiers = { brut: BRUT, resultats: RESULTATS } }) {
  if (!['brut', 'resultats'].includes(destination)) throw new Refus('destination du rapport refusée (brut ou resultats seulement)');
  if (!/^(context|payant)-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(nom)) throw new Refus('nom de rapport refusé');
  const texte = `${JSON.stringify(rapport, null, 2)}\n`;
  const problemes = [...commun.problemesTexte(texte, poste, interdits), ...commun.problemesJson(texte)];
  if (problemes.length > 0) throw new Refus(`garde de confidentialité : rapport non écrit (${problemes.join(' ; ')})`);
  const cible = path.join(dossiers[destination], nom);
  fs.mkdirSync(dossiers[destination], { recursive: true });
  fs.writeFileSync(cible, texte, { encoding: 'utf8', flag: 'wx' });
  return cible;
}

/** Remplace le dossier personnel par <home> dans un message de console. */
const masquer = (texte) => {
  const home = os.homedir();
  return home.length >= 3 ? String(texte).split(home).join('<home>') : String(texte);
};

// --- Commandes ----------------------------------------------------------------------------------------------

function horodatage(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
}

/** Résumé d'un compteur pour l'affichage, sans le valider (lot, utilisés, plafond, archives). */
function resumeCompteur(dossier, type) {
  const f = path.join(dossier, payant.COMPTEURS[type].fichier);
  const archives = fs.existsSync(dossier) ? fs.readdirSync(dossier).filter((n) => n.startsWith(`compteur-${type}-`)).sort() : [];
  let texte = 'aucun';
  if (fs.existsSync(f)) {
    try {
      const c = JSON.parse(fs.readFileSync(f, 'utf8'));
      texte = `lot ${c.lot}, ${c.utilises} sur ${c.plafond}${c.series_rejetees !== undefined ? `, ${c.series_rejetees} série(s) rejetée(s)` : ''}`;
    } catch {
      texte = 'illisible';
    }
  }
  return `${texte}${archives.length > 0 ? ` ; archives : ${archives.join(', ')}` : ''}`;
}

function preparer({ aSec = false } = {}) {
  const plateforme = process.platform;
  const { configDir, espace } = cheminsParDefaut();
  let exe;
  try {
    exe = resoudreExe();
  } catch (err) {
    if (!aSec) throw err;
    exe = '<claude introuvable : CANARI_CLAUDE_EXE à définir>';
  }
  const env = environnementNettoye(process.env, configDir, plateforme);
  const pbEnv = problemesEnvironnement(env, configDir, plateforme);
  if (pbEnv.length > 0) throw new Refus(pbEnv.join(' ; '));
  if (!aSec && !fs.existsSync(configDir)) throw new Refus("le profil isolé n'existe pas : le connecter d'abord (README de la suite)");
  const pbEspace = problemesEspace(espace, { home: os.homedir(), depot: RACINE_DEPOT, configDir, plateforme });
  return { plateforme, configDir, espace, projet: path.join(espace, 'projet'), exe, env, pbEspace, journal: path.join(BRUT, FICHIER_JOURNAL) };
}

/** Version et état de connexion, contrôlés ; renvoie aussi les valeurs sensibles (mémoire seulement). */
async function lireEtat(ctx, cwd) {
  const commun_ = { exe: ctx.exe, env: ctx.env, cwd, espace: ctx.espace, configDir: ctx.configDir, dossierBrut: BRUT, plateforme: ctx.plateforme };
  const v = await lancerClaude({ ...commun_, argv: ['--version'] });
  const version = (v.stdout.trim().match(/^(\S+)/) || [])[1];
  if (v.code !== 0 || !version) throw new Refus('claude --version a échoué');
  const a = await lancerClaude({ ...commun_, argv: ['auth', 'status', '--json'] });
  let etat = null;
  try {
    etat = JSON.parse(a.stdout);
  } catch {
    etat = null;
  }
  const { problemes, sensibles } = problemesAuth(etat, ctx.configDir, ctx.plateforme);
  return {
    version,
    problemes,
    sensibles,
    resume: etat ? { loggedIn: etat.loggedIn, authMethod: etat.authMethod, apiProvider: etat.apiProvider, subscriptionType: etat.subscriptionType } : null,
  };
}

async function commandeEtat() {
  const ctx = preparer();
  verifierArret(BRUT);
  const cwd = fs.existsSync(ctx.projet) ? ctx.projet : fs.existsSync(ctx.espace) ? ctx.espace : os.tmpdir();
  const etat = await lireEtat(ctx, cwd);
  console.log(`[sonde-claude] version : ${etat.version}`);
  console.log(`[sonde-claude] connexion : ${JSON.stringify(etat.resume)}`);
  console.log(`[sonde-claude] configDirectory : ${etat.problemes.some((p) => p.startsWith('configDirectory')) ? 'NON CONFORME' : 'le profil isolé'}`);
  for (const type of ['context', 'modele']) console.log(`[sonde-claude] compteur ${type} : ${resumeCompteur(BRUT, type)}`);
  console.log(`[sonde-claude] journal de déploiement en attente : ${fs.existsSync(ctx.journal) ? 'oui' : 'non'}`);
  const problemes = [...etat.problemes, ...ctx.pbEspace];
  if (problemes.length > 0) {
    console.error(`[sonde-claude] Préconditions non remplies :\n  - ${problemes.map(masquer).join('\n  - ')}`);
    return 2;
  }
  console.log('[sonde-claude] Préconditions remplies.');
  return 0;
}

async function commandeRetirer() {
  const journal = path.join(BRUT, FICHIER_JOURNAL);
  const { problemes } = retirer(journal);
  if (problemes.length > 0) {
    console.error(`[sonde-claude] Retrait incomplet :\n  - ${problemes.map(masquer).join('\n  - ')}`);
    return 2;
  }
  console.log('[sonde-claude] Aucun déploiement en attente.');
  return 0;
}

function lireOptions(args) {
  const opts = { combinaisons: null, resultats: false, lot: null, preparerH14: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--resultats') opts.resultats = true;
    else if (args[i] === '--preparer-h14') opts.preparerH14 = true;
    else if (args[i] === '--combinaisons' && args[i + 1]) opts.combinaisons = args[++i].split(',').filter(Boolean);
    else if (args[i] === '--lot' && args[i + 1]) opts.lot = args[++i];
    else throw new Refus(`option inconnue : ${args[i]}`);
  }
  if (opts.preparerH14) {
    if (opts.combinaisons || opts.resultats || opts.lot) throw new Refus('--preparer-h14 ne lance aucun /context : il refuse --lot, --combinaisons et --resultats');
    return opts;
  }
  if (!LOTS_CONTEXT.includes(opts.lot)) throw new Refus(`--lot <${LOTS_CONTEXT.join('|')}> est obligatoire`);
  if (opts.combinaisons) {
    const inconnues = opts.combinaisons.filter((id) => !COMBINAISONS.some((c) => c.id === id));
    if (inconnues.length > 0) throw new Refus(`combinaison inconnue : ${inconnues.join(', ')}`);
  }
  return opts;
}

/**
 * Préparation de H14 (conception, section 8) : auth status seulement, puis déploiement du jeu complet
 * sans MCP, laissé en place avec son journal ; les gestes sont affichés. Retrait par « retirer ».
 */
async function commandePreparerH14() {
  const ctx = preparer();
  verifierArret(BRUT);
  if (ctx.pbEspace.length > 0) throw new Refus(ctx.pbEspace.join(' ; '));
  if (fs.existsSync(ctx.journal)) throw new Refus('un journal de déploiement existe : lancer « retirer »');
  const invites = payant.verifierInvites(fs.readFileSync(SONDE, 'utf8'));
  const rels = listerFixtures();
  const inventaire = commun.lireInventaire(fs.readFileSync(INVENTAIRE, 'utf8'));
  const plan = commun.planDeploiement(rels, payant.JEUX_H14, { configDir: ctx.configDir, espace: ctx.espace, fixturesDir: FIXTURES });
  const { fichiers } = fichiersADeployer(plan, { espace: ctx.espace, inventaire, jeux: payant.JEUX_H14 });
  fs.mkdirSync(ctx.projet, { recursive: true });
  const etat = await lireEtat(ctx, ctx.projet);
  if (etat.problemes.length > 0) throw new Refus(`connexion non conforme : ${etat.problemes.join(' ; ')}`);
  deployer(fichiers, ctx.journal, [ctx.espace, ctx.configDir]);
  console.log(`[sonde-claude] H14 : ${fichiers.length} fichiers déployés (jeux ${payant.JEUX_H14.join(', ')}, sans MCP), laissés en place. CLI ${etat.version}.`);
  console.log('[sonde-claude] Gestes à faire (les chemins ci-dessous sont ceux de ce poste ; ne les recopie dans aucun fichier du dépôt) :');
  for (const l of payant.gestesH14({ configDir: ctx.configDir, projet: ctx.projet, invite: invites.get('h14-panneau') })) console.log(l);
  return 0;
}

async function commandeContext(args) {
  const opts = lireOptions(args);
  if (opts.preparerH14) return commandePreparerH14();
  const combinaisons = opts.combinaisons ? COMBINAISONS.filter((c) => opts.combinaisons.includes(c.id)) : COMBINAISONS;
  const ctx = preparer();
  verifierArret(BRUT);
  if (ctx.pbEspace.length > 0) throw new Refus(ctx.pbEspace.join(' ; '));
  if (fs.existsSync(ctx.journal)) throw new Refus('un journal de déploiement existe : lancer « retirer »');
  ouvrirLotAnnonce(BRUT, 'context', opts.lot);
  const prevus = BASES.length * 2 + combinaisons.length;
  verifierBudget(BRUT, prevus, opts.lot);
  const rels = listerFixtures();
  const inventaire = commun.lireInventaire(fs.readFileSync(INVENTAIRE, 'utf8'));
  // Contrôle préalable de toutes les combinaisons (plans et empreintes), avant le premier appel.
  for (const c of combinaisons) {
    const plan = commun.planDeploiement(rels, c.jeux, { configDir: ctx.configDir, espace: ctx.espace, fixturesDir: FIXTURES });
    fichiersADeployer(plan, { espace: ctx.espace, inventaire, jeux: c.jeux });
  }

  const stamp = horodatage();
  const dossierSerie = path.join(BRUT, `serie-${stamp}`);
  fs.mkdirSync(dossierSerie, { recursive: true });
  const nomMemoire = commun.nomDossierMemoire(ctx.projet);
  const racines = racinesNormalisation(ctx);
  const raisonsRejet = [];

  fs.mkdirSync(ctx.projet, { recursive: true });
  const avant = await lireEtat(ctx, ctx.projet);
  if (avant.problemes.length > 0) throw new Refus(`connexion non conforme : ${avant.problemes.join(' ; ')}`);
  const profilAvant = listerProfil(ctx.configDir);
  fs.writeFileSync(path.join(dossierSerie, 'profil-avant.txt'), [...profilAvant].map(([r, e]) => `${e.type} ${e.taille} ${r}`).join('\n') + '\n');
  console.log(`[sonde-claude] Série ${stamp} : version ${avant.version}, abonnement ${avant.resume.subscriptionType}, ${prevus} /context prévus.`);

  let numero = 0;
  const mesurer = async (c) => {
    const plan = c.jeux.length > 0 ? commun.planDeploiement(rels, c.jeux, { configDir: ctx.configDir, espace: ctx.espace, fixturesDir: FIXTURES }) : [];
    const { fichiers, mcpConfig, pluginDir } = fichiersADeployer(plan, { espace: ctx.espace, inventaire, jeux: c.jeux });
    let flux;
    try {
      if (fichiers.length > 0) deployer(fichiers, ctx.journal, [ctx.espace, ctx.configDir]);
      const argv = argumentsContext({ outils: c.outils, mcpConfig, pluginDir, hookEvents: c.hookEvents });
      const r = await lancerClaude({ exe: ctx.exe, argv, env: ctx.env, cwd: ctx.projet, espace: ctx.espace, configDir: ctx.configDir, dossierBrut: BRUT, plateforme: ctx.plateforme, lot: opts.lot });
      numero++;
      const base = path.join(dossierSerie, `${String(numero).padStart(2, '0')}-${c.id}`);
      fs.writeFileSync(`${base}.jsonl`, r.stdout, 'utf8');
      if (r.stderr.trim()) fs.writeFileSync(`${base}.stderr.txt`, r.stderr, 'utf8');
      flux = lireFlux(r.stdout);
      const controle = controlerAppel(flux, { versionAttendue: avant.version });
      if (controle.arret.length > 0) {
        ecrireArret(BRUT, `${c.id} : ${controle.arret.join(' ; ')}`);
        throw new Arret(`${c.id} : ${controle.arret.join(' ; ')}`);
      }
      if (r.expire) throw new SerieRejetee(`${c.id} : délai dépassé`);
      if (controle.autres.length > 0) throw new SerieRejetee(`${c.id} : ${controle.autres.join(' ; ')}`);
    } finally {
      const { problemes } = retirer(ctx.journal);
      if (problemes.length > 0) throw new SerieRejetee(`${c.id} : retrait incomplet (${problemes.map(masquer).join(' ; ')})`);
    }
    const contenu = fs.readdirSync(ctx.espace);
    if (contenu.length !== 1 || contenu[0] !== 'projet' || fs.readdirSync(ctx.projet).length > 0) throw new SerieRejetee(`${c.id} : l'espace n'est pas revenu à son état initial`);
    if (plan.some((e) => e.cible === 'mcp')) {
      // Le serveur de fixture peut mettre un instant à se terminer après claude : cinq essais espacés.
      let restants = processusFixtureRestants(ctx.espace, ctx.plateforme);
      for (let essai = 1; essai < 5 && restants > 0; essai++) {
        attendre(500);
        restants = processusFixtureRestants(ctx.espace, ctx.plateforme);
      }
      if (restants === null) raisonsRejet.push(`${c.id} : processus MCP invérifiables`);
      else if (restants > 0) throw new SerieRejetee(`${c.id} : ${restants} serveur(s) MCP de fixture encore actif(s)`);
    }
    const entree = {
      id: c.id,
      jeux: c.jeux,
      outils: c.outils === '' ? 'vide' : c.outils,
      plugin: Boolean(pluginDir),
      mcp: plan.filter((e) => e.cible === 'mcp').map((e) => e.jeu),
      hook_events: Boolean(c.hookEvents),
      controle: { apiKeySource: flux.init.apiKeySource, usage: sommeUsage(flux.result.usage), num_turns: flux.result.num_turns },
      ...normaliserCombinaison(flux, { racines, nomMemoire, plan, plateforme: ctx.plateforme, o200k: o200kDuPlan(plan) }),
    };
    return { entree, flux };
  };

  const bases = {};
  for (const b of BASES) {
    const { entree, flux } = await mesurer(b);
    bases[b.cle] = { debut: entree };
    if (b.cle === 'vide') {
      const auto = flux.init && flux.init.memory_paths && flux.init.memory_paths.auto;
      const attendu = path.join(ctx.configDir, 'projects', nomMemoire, 'memory');
      if (typeof auto !== 'string' || !memeChemin(auto, attendu, ctx.plateforme)) {
        throw new SerieRejetee('le dossier de mémoire calculé ne correspond pas à memory_paths.auto : aucun déploiement');
      }
    }
  }
  const resultats = [];
  for (const c of combinaisons) {
    const { entree } = await mesurer(c);
    const base = bases[c.outils === '' ? 'vide' : 'avec_skill'];
    entree.delta_base = base ? entree.total - base.debut.total : null;
    resultats.push(entree);
    console.log(`[sonde-claude] ${c.id} : total ${entree.total} (${entree.delta_base >= 0 ? '+' : ''}${entree.delta_base}), ${entree.memory_files.length} mémoire(s), ${entree.skills.length} skill(s) de fixture, ${entree.fixtures_absentes.length} absente(s).`);
  }
  for (const b of BASES) {
    const { entree } = await mesurer(b);
    bases[b.cle].fin = entree;
    const ecarts = comparerBases(bases[b.cle].debut, entree);
    bases[b.cle].identiques = ecarts.length === 0;
    if (ecarts.length > 0) raisonsRejet.push(`base ${b.cle} différente au début et à la fin : ${ecarts.join(', ')}`);
  }

  if (fs.readdirSync(ctx.projet).length === 0) fs.rmdirSync(ctx.projet);
  if (fs.readdirSync(ctx.espace).length > 0) raisonsRejet.push("l'espace n'est pas vide à la fin");
  const apres = await lireEtat(ctx, ctx.espace);
  if (apres.version !== avant.version) raisonsRejet.push(`version ${avant.version} avant, ${apres.version} après`);
  if (apres.problemes.length > 0) raisonsRejet.push(`connexion non conforme après la série : ${apres.problemes.join(' ; ')}`);
  const profilApres = listerProfil(ctx.configDir);
  fs.writeFileSync(path.join(dossierSerie, 'profil-apres.txt'), [...profilApres].map(([r, e]) => `${e.type} ${e.taille} ${r}`).join('\n') + '\n');
  const ecarts = ecartsProfil(profilAvant, profilApres, nomMemoire);
  fs.writeFileSync(path.join(dossierSerie, 'ecarts-profil.json'), `${JSON.stringify(ecarts, null, 2)}\n`);
  if (ecarts.inconnus.length > 0) raisonsRejet.push(`${ecarts.inconnus.length} écart(s) inconnu(s) du profil (détail dans brut/)`);

  const compteur = lireCompteur(BRUT, 'context', opts.lot);
  const rapport = {
    rapport: 'claude-code-context',
    format: 1,
    lot: opts.lot,
    environnement: {
      outil: 'Claude Code', entree: 'cli -p', os: ctx.plateforme === 'win32' ? 'Windows' : ctx.plateforme,
      version_avant: avant.version, version_apres: apres.version, modele: MODELE, effort: EFFORT,
      methode: avant.resume.authMethod, fournisseur: avant.resume.apiProvider, abonnement: avant.resume.subscriptionType,
      sonde: 'v1', date_mesure: stamp.slice(0, 10),
    },
    serie: { valide: raisonsRejet.length === 0, raisons_rejet: raisonsRejet, context_utilises: numero, compteur_lot: compteur.utilises, plafond: compteur.plafond },
    bases,
    combinaisons: resultats,
    profil: { ecarts_connus: ecarts.connus, ecarts_inconnus: ecarts.inconnus.length },
  };
  const poste = commun.lirePoste();
  const interdits = [...new Set([...avant.sensibles, ...apres.sensibles, ctx.espace, ctx.configDir, ctx.exe, nomMemoire, process.env.LOCALAPPDATA].filter(Boolean))];
  const fichier = ecrireRapport(rapport, { destination: opts.resultats ? 'resultats' : 'brut', nom: `context-${stamp}.json`, poste, interdits });
  console.log(`[sonde-claude] Rapport normalisé : ${path.relative(RACINE_DEPOT, fichier).replace(/\\/g, '/')}`);
  console.log(`[sonde-claude] /context utilisés : ${numero} dans cette série, ${compteur.utilises} sur ${compteur.plafond} pour le lot.`);
  if (raisonsRejet.length > 0) {
    console.error(`[sonde-claude] SÉRIE REJETÉE :\n  - ${raisonsRejet.map(masquer).join('\n  - ')}`);
    return 3;
  }
  console.log('[sonde-claude] Série valide.');
  return 0;
}

// --- Partie payante (lot I3, exécutée au lot E2) -----------------------------------------------------

/** Un message de rejet sans chemin : tout chemin de lecteur ou absolu devient <chemin>. */
const nettoyerRaison = (texte) => String(texte).replace(/(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s;,)]*/g, '<chemin>');

/** Les fichiers d'une étape, avec le réglage des déclencheurs ; la liste normalisée sert à l'affichage. */
function preparerEtape(ctx, etape, { rels, inventaire, invites }) {
  const plan = etape.jeux.length > 0 ? commun.planDeploiement(rels, etape.jeux, { configDir: ctx.configDir, espace: ctx.espace, fixturesDir: FIXTURES }) : [];
  const dep = fichiersADeployer(plan, { espace: ctx.espace, inventaire, jeux: etape.jeux });
  const settings = etape.declencheur ? path.join(ctx.espace, ...payant.CHEMIN_REGLAGES) : null;
  const fichiers = settings ? [...dep.fichiers, { destination: settings, contenu: payant.REGLAGES_DECLENCHEURS }] : dep.fichiers;
  const prompt = etape.type === 'context' ? '/context' : invites.get(etape.invite);
  if (typeof prompt !== 'string') throw new Refus(`${etape.id} : invite ${etape.invite} absente de SONDE.md`);
  const argv = argumentsAppel({
    prompt, outils: etape.outils, toursMax: etape.toursMax, declencheur: etape.declencheur, settings,
    autorisation: etape.autorisation, mcpConfig: dep.mcpConfig, pluginDir: dep.pluginDir, hookEvents: etape.hookEvents,
  });
  const normalises = [
    ...plan.map((e) => e.normalise),
    ...(dep.mcpConfig ? ['<mcp>/serveur-fixture.js', '<mcp>/mcp-config.json'] : []),
    ...(settings ? [`<parent>/${payant.CHEMIN_REGLAGES.join('/')}`] : []),
  ];
  return { plan, fichiers, argv, normalises, mcp: plan.some((e) => e.cible === 'mcp'), pluginDir: dep.pluginDir };
}

/**
 * --a-sec : construit le plan exact de la vraie exécution, vérifie chaque argv avec verifierArgv, et
 * l'affiche avec l'environnement nettoyé (noms seulement) et les fichiers déployés. Aucun processus
 * n'est lancé, aucun fichier n'est écrit, auth status n'est pas lu.
 */
function commandeASec({ etapes, compte, invites, envoyables }) {
  const ctx = preparer({ aSec: true });
  const rels = listerFixtures();
  const inventaire = commun.lireInventaire(fs.readFileSync(INVENTAIRE, 'utf8'));
  const noms = Object.keys(ctx.env).sort();
  const sortie = [];
  sortie.push(`[a-sec] Partie payante à sec : rien n'est lancé ni écrit. Lot ${payant.LOT_PAYANT}, modèle ${MODELE}, effort ${EFFORT}.`);
  sortie.push(`[a-sec] Compteurs actuels : context ${resumeCompteur(BRUT, 'context')} ; modèle ${resumeCompteur(BRUT, 'modele')}.`);
  sortie.push(`[a-sec] Variables transmises à claude (liste blanche, ${noms.length} noms, valeurs non affichées) : ${noms.join(', ')}`);
  if (ctx.pbEspace.length > 0) sortie.push(`[a-sec] Préconditions de l'espace non remplies (bloquantes en vrai) : ${ctx.pbEspace.join(' ; ')}`);
  let m = 0;
  let c = 0;
  for (const etape of etapes) {
    const e = preparerEtape(ctx, etape, { rels, inventaire, invites });
    const forme = verifierArgv(e.argv, { espace: ctx.espace, plateforme: ctx.plateforme, invites: envoyables });
    if (forme !== (etape.type === 'modele' ? 'modele' : 'context')) throw new Refus(`${etape.id} : forme ${forme} inattendue`);
    if (etape.type === 'modele') {
      m++;
      sortie.push(`[a-sec] Appel au modèle ${m}/${compte.modele} · série ${etape.serie} · ${etape.id} · invite ${etape.invite} (${payant.sha256(invites.get(etape.invite)).slice(0, 12)}) · outils « ${etape.outils} » · ${etape.toursMax} tour(s) au plus`);
      sortie.push(`  argv : ${JSON.stringify(e.argv)}`);
      sortie.push(`  environnement nettoyé (${noms.length} noms) : ${noms.join(', ')}`);
    } else {
      c++;
      sortie.push(`[a-sec] /context ${c}/${compte.context} · série ${etape.serie} · ${etape.id} · outils « ${etape.outils} »`);
      sortie.push(`  argv : ${JSON.stringify(e.argv)}`);
      sortie.push('  environnement nettoyé : le même');
    }
    sortie.push(`  déployé : ${e.normalises.length > 0 ? e.normalises.join(', ') : 'rien'}`);
  }
  const parSerie = Object.entries(compte.parSerie).map(([n, v]) => `série ${n} : ${v}`).join(', ');
  sortie.push(`[a-sec] Total : ${compte.modele} appels au modèle (${parSerie}) et ${compte.context} /context. Aucun processus lancé.`);
  console.log(sortie.map(masquer).join('\n'));
  return 0;
}

/**
 * Exécute une étape : déploiement, lancement (garde de flux pour un appel au modèle), contrôles,
 * effet attendu d'un déclencheur, retrait, espace revenu à l'état initial, serveurs MCP arrêtés.
 */
async function executerEtape(ctx, etape, x) {
  const e = preparerEtape(ctx, etape, x);
  const effet = etape.effet ? path.join(ctx.projet, ...etape.effet.chemin.split('/')) : null;
  let fluxCtx = null;
  let fluxP = null;
  let usage = null;
  let effetObserve = null;
  try {
    if (e.fichiers.length > 0) deployer(e.fichiers, ctx.journal, [ctx.espace, ctx.configDir]);
    const garde = etape.type === 'modele' ? payant.creerGardeFlux(etape, { modele: MODELE, projet: ctx.projet, plateforme: ctx.plateforme }) : null;
    const r = await lancerClaude({
      exe: ctx.exe, argv: e.argv, env: ctx.env, cwd: ctx.projet, espace: ctx.espace, configDir: ctx.configDir, dossierBrut: BRUT,
      plateforme: ctx.plateforme, lot: payant.LOT_PAYANT, invites: x.envoyables, garde, delaiMs: etape.type === 'modele' ? DELAI_MODELE_MS : DELAI_MS,
    });
    const base = path.join(x.dossierSerie, `${String(x.suivant()).padStart(2, '0')}-${etape.id.replace(/[^A-Za-z0-9-]/g, '_')}`);
    fs.writeFileSync(`${base}.jsonl`, r.stdout, 'utf8');
    if (r.stderr.trim()) fs.writeFileSync(`${base}.stderr.txt`, r.stderr, 'utf8');
    if (r.violation) {
      if (r.violation.gravite === 'arret') {
        ecrireArret(BRUT, `${etape.id} : ${r.violation.raison}`);
        throw new Arret(`${etape.id} : ${r.violation.raison}`);
      }
      throw new SerieRejetee(`${etape.id} : garde de flux (${r.violation.raison})`);
    }
    const controle = etape.type === 'context'
      ? controlerAppel((fluxCtx = lireFlux(r.stdout)), { versionAttendue: x.version })
      : payant.controlerAppelPayant((fluxP = payant.lireFluxPayant(r.stdout)), (usage = payant.lireUsage(fluxP)), etape, { versionAttendue: x.version });
    if (controle.arret.length > 0) {
      ecrireArret(BRUT, `${etape.id} : ${controle.arret.join(' ; ')}`);
      throw new Arret(`${etape.id} : ${controle.arret.join(' ; ')}`);
    }
    if (r.expire) throw new SerieRejetee(`${etape.id} : délai dépassé`);
    if (controle.autres.length > 0) throw new SerieRejetee(`${etape.id} : ${controle.autres.join(' ; ')}`);
    if (effet) {
      effetObserve = fs.existsSync(effet) && enLf(fs.readFileSync(effet, 'utf8')).trimEnd() === etape.effet.contenu;
      if (!effetObserve) throw new SerieRejetee(`${etape.id} : effet attendu non observé (${etape.effet.chemin})`);
    }
  } finally {
    const { problemes } = retirer(ctx.journal, {
      modifsPermises: etape.effet && etape.effet.type === 'modifie' ? [effet] : [],
      creesPermis: etape.effet && etape.effet.type === 'cree' ? [effet] : [],
    });
    if (problemes.length > 0) throw new SerieRejetee(`${etape.id} : retrait incomplet (${problemes.map(masquer).join(' ; ')})`);
  }
  const contenu = fs.readdirSync(ctx.espace);
  if (contenu.length !== 1 || contenu[0] !== 'projet' || fs.readdirSync(ctx.projet).length > 0) throw new SerieRejetee(`${etape.id} : l'espace n'est pas revenu à son état initial`);
  if (e.mcp) {
    let restants = processusFixtureRestants(ctx.espace, ctx.plateforme);
    for (let essai = 1; essai < 5 && restants > 0; essai++) {
      attendre(500);
      restants = processusFixtureRestants(ctx.espace, ctx.plateforme);
    }
    if (restants === null || restants > 0) throw new SerieRejetee(`${etape.id} : serveur(s) MCP de fixture encore actif(s) ou invérifiable(s)`);
  }
  const commun_ = { id: etape.id, serie: etape.serie, jeux: etape.jeux, outils: etape.outils === '' ? 'vide' : etape.outils };
  if (etape.type === 'context') {
    return {
      flux: fluxCtx,
      combinaison: {
        ...commun_,
        controle: { apiKeySource: fluxCtx.init.apiKeySource, usage: sommeUsage(fluxCtx.result.usage), num_turns: fluxCtx.result.num_turns },
        ...normaliserCombinaison(fluxCtx, { racines: x.racines, nomMemoire: x.nomMemoire, plan: e.plan, plateforme: ctx.plateforme, o200k: o200kDuPlan(e.plan) }),
      },
    };
  }
  const reponse = payant.lireReponse(fluxP.result.result, etape, x.canarisConnus);
  if (etape.mode !== 'usage' && !reponse.lisible) throw new SerieRejetee(`${etape.id} : réponse illisible (JSON attendu)`);
  return {
    flux: fluxP,
    appel: {
      ...commun_,
      invite: etape.invite,
      empreinte_invite: payant.EMPREINTES_INVITES[etape.invite],
      base: etape.base,
      num_turns: usage.num_turns,
      usage: { entree: usage.total.entree, sortie: usage.total.sortie, somme4: usage.total.somme4, par_tour: usage.par_tour },
      cout_liste_usd: usage.cout_liste_usd,
      modeles: usage.modeles,
      outils_appeles: payant.outilsAppeles(fluxP),
      effet_observe: effetObserve,
      reponse,
    },
  };
}

/** Compare les bornes d'une série : entrée d'usage (séries 1 à 3) et /context, tolérance 0. */
function comparerBornesSerie(serie, appels, combinaisons) {
  const ecarts = [];
  const parId = (liste, id) => liste.find((x) => x.id === id);
  if (serie.mode === 'usage') {
    const [a, b] = [serie.appels[0].id, serie.appels[serie.appels.length - 1].id];
    const ua = parId(appels, a);
    const ub = parId(appels, b);
    if (!ua || !ub) ecarts.push('base manquante');
    else if (ua.usage.entree !== ub.usage.entree) ecarts.push(`entrée ${a} ${ua.usage.entree} → ${b} ${ub.usage.entree}`);
    const ca = parId(combinaisons, `ctx:${a}`);
    const cb = parId(combinaisons, `ctx:${b}`);
    ecarts.push(...comparerBases(ca, cb).map((x) => `/context ${x}`));
  } else {
    for (const borne of serie.bornes) {
      ecarts.push(...comparerBases(parId(combinaisons, `ctx:debut-${borne.cle}`), parId(combinaisons, `ctx:fin-${borne.cle}`)).map((x) => `/context ${borne.cle} ${x}`));
    }
  }
  return [...new Set(ecarts)];
}

/** La partie payante : refus sans --confirmer, plafond, séries avec bornes, rapport même après un arrêt. */
async function commandePayant(args) {
  const opts = payant.lireOptionsPayant(args);
  const etapes = payant.planPayant(opts.series);
  const compte = payant.compterPlan(etapes);
  const invites = payant.verifierInvites(fs.readFileSync(SONDE, 'utf8'));
  const envoyables = payant.invitesEnvoyables(invites);
  if (opts.aSec) return commandeASec({ etapes, compte, invites, envoyables });

  const ctx = preparer();
  verifierArret(BRUT);
  if (ctx.pbEspace.length > 0) throw new Refus(ctx.pbEspace.join(' ; '));
  if (fs.existsSync(ctx.journal)) throw new Refus('un journal de déploiement existe : lancer « retirer »');
  const lot = payant.LOT_PAYANT;
  payant.verifierBudget(BRUT, 'modele', lot, compte.modele, opts.plafond);
  ouvrirLotAnnonce(BRUT, 'context', lot);
  payant.verifierBudget(BRUT, 'context', lot, compte.context);
  const rels = listerFixtures();
  const inventaire = commun.lireInventaire(fs.readFileSync(INVENTAIRE, 'utf8'));
  // Contrôle préalable de chaque étape (plans, empreintes, argv), avant le premier lancement.
  for (const etape of etapes) verifierArgv(preparerEtape(ctx, etape, { rels, inventaire, invites }).argv, { espace: ctx.espace, plateforme: ctx.plateforme, invites: envoyables });

  const stamp = horodatage();
  const dossierSerie = path.join(BRUT, `payant-${stamp}`);
  fs.mkdirSync(dossierSerie, { recursive: true });
  let numero = 0;
  const x = {
    rels, inventaire, invites, envoyables, dossierSerie, suivant: () => ++numero,
    racines: racinesNormalisation(ctx), nomMemoire: commun.nomDossierMemoire(ctx.projet),
    canarisConnus: new Set([...inventaire.values()].flatMap((v) => v.canaris)), version: null,
  };
  fs.mkdirSync(ctx.projet, { recursive: true });
  const avant = await lireEtat(ctx, ctx.projet);
  if (avant.problemes.length > 0) throw new Refus(`connexion non conforme : ${avant.problemes.join(' ; ')}`);
  x.version = avant.version;
  const sensibles = new Set(avant.sensibles);
  const profilAvant = listerProfil(ctx.configDir);
  fs.writeFileSync(path.join(dossierSerie, 'profil-avant.txt'), [...profilAvant].map(([r, e]) => `${e.type} ${e.taille} ${r}`).join('\n') + '\n');
  console.log(`[sonde-claude] Partie payante ${stamp} : version ${avant.version}, abonnement ${avant.resume.subscriptionType}, ${compte.modele} appels au modèle et ${compte.context} /context prévus.`);

  const appels = [];
  const combinaisons = [];
  const series = [];
  let arret = null;
  let memoireVerifiee = false;
  try {
    for (const numeroSerie of [...new Set(etapes.map((e) => e.serie))]) {
      const serie = payant.SERIES.find((s) => s.numero === numeroSerie);
      const bilan = { numero: serie.numero, titre: serie.titre, valide: true, raisons_rejet: [] };
      series.push(bilan);
      const etat = await lireEtat(ctx, ctx.projet);
      etat.sensibles.forEach((v) => sensibles.add(v));
      if (etat.problemes.length > 0) {
        ecrireArret(BRUT, `série ${serie.numero} : connexion non conforme avant la série`);
        throw new Arret(`série ${serie.numero} : connexion non conforme (${etat.problemes.join(' ; ')})`);
      }
      try {
        for (const etape of etapes.filter((e) => e.serie === serie.numero)) {
          const r = await executerEtape(ctx, etape, x);
          if (!memoireVerifiee) {
            const auto = r.flux.init && r.flux.init.memory_paths && r.flux.init.memory_paths.auto;
            // La première étape de chaque série est un /context gratuit : ce contrôle précède tout appel au modèle.
            if (typeof auto !== 'string' || !memeChemin(auto, path.join(ctx.configDir, 'projects', x.nomMemoire, 'memory'), ctx.plateforme)) {
              ecrireArret(BRUT, 'dossier de mémoire calculé différent de memory_paths.auto');
              throw new Arret('le dossier de mémoire calculé ne correspond pas à memory_paths.auto : arrêt avant tout appel au modèle');
            }
            memoireVerifiee = true;
          }
          if (r.appel) appels.push(r.appel);
          else combinaisons.push(r.combinaison);
          console.log(`[sonde-claude] ${etape.id} : ${r.appel ? `entrée ${r.appel.usage.entree}, ${r.appel.num_turns} tour(s)` : `/context ${r.combinaison.total}`}.`);
        }
        const ecarts = comparerBornesSerie(serie, appels, combinaisons);
        if (ecarts.length > 0) throw new SerieRejetee(`bornes différentes au début et à la fin : ${ecarts.join(', ')}`);
        const apres = await lireEtat(ctx, ctx.projet);
        apres.sensibles.forEach((v) => sensibles.add(v));
        if (apres.version !== avant.version) throw new SerieRejetee(`version ${avant.version} avant, ${apres.version} après`);
        if (apres.problemes.length > 0) throw new SerieRejetee(`connexion non conforme après la série : ${apres.problemes.join(' ; ')}`);
      } catch (err) {
        if (!(err instanceof SerieRejetee)) throw err;
        bilan.valide = false;
        bilan.raisons_rejet.push(nettoyerRaison(err.message));
        const n = payant.noterSerieRejetee(BRUT);
        console.error(`[sonde-claude] Série ${serie.numero} REJETÉE (${n} sur ${payant.MAX_SERIES_REJETEES} permises pour le lot) : ${masquer(err.message)}`);
        if (n >= payant.MAX_SERIES_REJETEES) {
          ecrireArret(BRUT, `${n} séries rejetées dans le lot ${lot}`);
          throw new Arret(`${n} séries rejetées dans le lot ${lot} : arrêt avec rapport`);
        }
      }
    }
  } catch (err) {
    if (!(err instanceof Arret)) throw err;
    arret = nettoyerRaison(err.message);
    console.error(`[sonde-claude] ARRÊT DÉFINITIF : ${masquer(err.message)}`);
  }

  if (fs.existsSync(ctx.projet) && fs.readdirSync(ctx.projet).length === 0) fs.rmdirSync(ctx.projet);
  const profilApres = listerProfil(ctx.configDir);
  fs.writeFileSync(path.join(dossierSerie, 'profil-apres.txt'), [...profilApres].map(([r, e]) => `${e.type} ${e.taille} ${r}`).join('\n') + '\n');
  const ecartsP = ecartsProfil(profilAvant, profilApres, x.nomMemoire);
  fs.writeFileSync(path.join(dossierSerie, 'ecarts-profil.json'), `${JSON.stringify(ecartsP, null, 2)}\n`);

  const valides = new Set(series.filter((s) => s.valide).map((s) => s.numero));
  const appelsValides = appels.filter((a) => valides.has(a.serie));
  const combosValides = combinaisons.filter((c) => valides.has(c.serie));
  const { total, el } = payant.elementsContext(combosValides);
  const decomposition = payant.decomposer({
    U: Object.fromEntries(appelsValides.map((a) => [a.id, a.usage.entree])),
    ctx: Object.fromEntries(appelsValides.map((a) => [a.id, total(`ctx:${a.id}`)])),
    el,
    L: payant.longueursChemins(rels, { configDir: ctx.configDir, espace: ctx.espace, fixturesDir: FIXTURES }),
    o: payant.o200kMesures((rel) => fs.readFileSync(path.join(FIXTURES, ...rel.split('/')), 'utf8')),
  });
  const rapport = {
    rapport: 'claude-code-payant',
    format: 1,
    lot,
    environnement: {
      outil: 'Claude Code', entree: 'cli -p', os: ctx.plateforme === 'win32' ? 'Windows' : ctx.plateforme,
      version_avant: avant.version, modele: MODELE, effort: EFFORT,
      methode: avant.resume.authMethod, fournisseur: avant.resume.apiProvider, abonnement: avant.resume.subscriptionType,
      sonde: 'v1', date_mesure: stamp.slice(0, 10),
    },
    execution: {
      series_demandees: [...new Set(etapes.map((e) => e.serie))], plafond_demande: opts.plafond,
      appels_modele_prevus: compte.modele, context_prevus: compte.context, appels_modele: appels.length, context: combinaisons.length,
      compteur_modele: lireCompteur(BRUT, 'modele', lot), compteur_context: lireCompteur(BRUT, 'context', lot), arret,
    },
    series,
    appels,
    combinaisons,
    decomposition,
    profil: { ecarts_connus: ecartsP.connus, ecarts_inconnus: ecartsP.inconnus.length },
  };
  const poste = commun.lirePoste();
  const interdits = [...new Set([...sensibles, ctx.espace, ctx.configDir, ctx.exe, x.nomMemoire, process.env.LOCALAPPDATA].filter(Boolean))];
  const fichier = ecrireRapport(rapport, { destination: opts.resultats ? 'resultats' : 'brut', nom: `payant-${stamp}.json`, poste, interdits });
  console.log(`[sonde-claude] Rapport normalisé : ${path.relative(RACINE_DEPOT, fichier).replace(/\\/g, '/')}`);
  console.log(`[sonde-claude] Appels au modèle : ${appels.length} ; /context : ${combinaisons.length} ; compteur modèle : ${resumeCompteur(BRUT, 'modele')}.`);
  if (arret) return 4;
  if (series.some((s) => !s.valide) || ecartsP.inconnus.length > 0) {
    if (ecartsP.inconnus.length > 0) console.error(`[sonde-claude] ${ecartsP.inconnus.length} écart(s) inconnu(s) du profil (détail dans brut/).`);
    return 3;
  }
  console.log('[sonde-claude] Toutes les séries sont valides.');
  return 0;
}

/**
 * Écrit attendu/baseline-<date>.json d'après un rapport « context » de resultats/, après la garde de
 * confidentialité. Ne lance jamais claude, et n'écrase jamais une baseline existante.
 */
function commandeBaseline(reste, { resultats = RESULTATS, attendu = ATTENDU, poste = commun.lirePoste() } = {}) {
  if (reste.length !== 2 || reste[0] !== '--depuis') throw new Refus('Usage : sonde-claude-code.js baseline --depuis <context-AAAA-MM-JJ-HHMM.json>');
  const nom = reste[1];
  if (!constructionBaseline.NOM_RAPPORT_CONTEXT.test(nom)) throw new Refus('rapport refusé : un nom context-AAAA-MM-JJ-HHMM.json de resultats/ est attendu');
  const fichier = path.join(resultats, nom);
  if (!fs.existsSync(fichier)) throw new Refus(`rapport introuvable dans resultats/ : ${nom}`);
  let rapport;
  try {
    rapport = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  } catch {
    throw new Refus(`rapport illisible : ${nom}`);
  }
  let baseline;
  try {
    baseline = constructionBaseline.baselineDepuisRapport(rapport, { source: nom });
  } catch (err) {
    throw new Refus(`baseline refusée : ${err.message}`);
  }
  const texte = `${JSON.stringify(baseline, null, 2)}\n`;
  const problemes = [...commun.problemesTexte(texte, poste, [process.env.LOCALAPPDATA].filter(Boolean)), ...commun.problemesJson(texte)];
  if (problemes.length > 0) throw new Refus(`garde de confidentialité : baseline non écrite (${problemes.join(' ; ')})`);
  const cible = path.join(attendu, `baseline-${baseline.baseline}.json`);
  if (fs.existsSync(cible)) throw new Refus(`une baseline existe déjà pour cette date (${path.basename(cible)}) : une baseline existante n'est jamais modifiée`);
  fs.mkdirSync(attendu, { recursive: true });
  fs.writeFileSync(cible, texte, { encoding: 'utf8', flag: 'wx' });
  console.log(`[sonde-claude] Baseline écrite : ${path.relative(RACINE_DEPOT, cible).replace(/\\/g, '/')} (${baseline.entrees.length} entrées, version ${baseline.environnement.version}).`);
  return 0;
}

async function principal(argv) {
  const [commande, ...reste] = argv;
  try {
    if (commande === 'etat' && reste.length === 0) return await commandeEtat();
    if (commande === 'baseline') return commandeBaseline(reste);
    if (commande === 'context') return await commandeContext(reste);
    if (commande === 'payant') return await commandePayant(reste);
    if (commande === 'retirer' && reste.length === 0) return await commandeRetirer();
    throw new Refus('Usage : node test/scenarios/scripts/sonde-claude-code.js <etat|context|payant|retirer|baseline> (voir l\'en-tête du fichier)');
  } catch (err) {
    const message = masquer(err && err.message ? err.message : String(err));
    if (err instanceof Arret) {
      console.error(`[sonde-claude] ARRÊT DÉFINITIF : ${message}`);
      return 4;
    }
    if (err instanceof SerieRejetee) {
      console.error(`[sonde-claude] SÉRIE REJETÉE : ${message}`);
      return 3;
    }
    if (err instanceof Refus) {
      console.error(`[sonde-claude] Refus : ${message}`);
      return 2;
    }
    console.error(`[sonde-claude] Erreur : ${message}`);
    return 1;
  }
}

module.exports = {
  LOTS_CONTEXT, PROMPTS, ABONNEMENTS, BASES, COMBINAISONS, FICHIER_ARRET, FICHIER_COMPTEUR, FICHIER_JOURNAL,
  Refus, RefusArgv, Arret, SerieRejetee,
  LISTE_BLANCHE, VARIABLES_POSEES, nomPermis,
  estSousOuEgal, estSousStrict, cheminsParDefaut, resoudreExe, environnementNettoye, problemesEnvironnement,
  problemesEspace, problemesAuth, verifierPrompt, argumentsContext, argumentsAppel, verifierArgv, lireFlux, sommeUsage,
  controlerAppel, verifierArret, ecrireArret, lireCompteur, verifierBudget, reserverContext, ouvrirLotAnnonce,
  racinesNormalisation, reecrireChemin, fixturesAttendues, o200kDuPlan, normaliserCombinaison, comparerBases,
  listerProfil, ecartsProfil, listerFixtures, fichiersADeployer, deployer, retirer, lancerClaude, ecrireRapport,
  lireOptions, nettoyerRaison, preparerEtape, comparerBornesSerie, commandeBaseline, principal,
};

if (require.main === module) {
  principal(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
