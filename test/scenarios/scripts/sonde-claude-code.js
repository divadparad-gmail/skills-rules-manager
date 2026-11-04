#!/usr/bin/env node
/**
 * Lanceur de la suite d'injection Claude Code — lot I2 : partie gratuite (/context seulement).
 *
 * Usage (depuis la racine du dépôt) :
 *   npm run sonde:claude-etat                 version, auth status et préconditions ; aucun /context
 *   npm run sonde:claude-context [-- options] déploiement, /context par combinaison, retrait, rapport
 *   node test/scenarios/scripts/sonde-claude-code.js retirer   retrait d'un déploiement interrompu
 * Options de « context » :
 *   --combinaisons <id,id>  ne mesure que ces combinaisons (les quatre bases sont toujours mesurées)
 *   --resultats             écrit le rapport normalisé dans resultats/ (lot E1) au lieu de brut/
 *
 * Chemins par défaut calculés (aucun chemin local en dur), remplaçables par CANARI_CLAUDE_CONFIG_DIR,
 * CANARI_CLAUDE_ESPACE et CANARI_CLAUDE_EXE.
 *
 * Protections, par construction :
 *   - seuls « claude --version », « claude auth status --json » et « claude -p /context » (ou
 *     « /context all ») peuvent être lancés : verifierArgv() refuse tout le reste, sans shell ;
 *   - environnement nettoyé : toutes les variables CLAUDE* et ANTHROPIC* sont retirées, seules
 *     CLAUDE_CONFIG_DIR et DISABLE_AUTOUPDATER=1 sont posées ;
 *   - profil connecté par claude.ai, sur un abonnement, avec le bon configDirectory, avant la série ;
 *   - après chaque /context : apiKeySource=none, usage nul, num_turns=0, coût nul, sinon le fichier
 *     brut/ARRET.txt est écrit et bloque tout lancement suivant de claude ;
 *   - empreintes SHA-256 (en LF) de chaque fixture comparées à inventaire.json avant tout déploiement :
 *     un écart refuse le déploiement et nomme le fichier ;
 *   - plafond de 50 /context pour le lot, compteur persistant dans brut/ ;
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

const RACINE_DEPOT = path.resolve(__dirname, '..', '..', '..');
const SUITE = path.join(RACINE_DEPOT, 'test', 'scenarios', 'claude-code-injection-contexte');
const FIXTURES = path.join(SUITE, 'fixtures');
const SERVEUR = path.join(SUITE, 'mcp', 'serveur-fixture.js');
const INVENTAIRE = path.join(SUITE, 'inventaire.json');
const BRUT = path.join(SUITE, 'brut');
const RESULTATS = path.join(SUITE, 'resultats');

const LOT = 'I2';
const PLAFOND = 50;
const MODELE = 'claude-opus-5';
const EFFORT = 'high';
const PROMPTS = ['/context', '/context all'];
const ABONNEMENTS = ['pro', 'max', 'team', 'enterprise'];
const OUTILS_CONNUS = new Set(['Skill', 'ToolSearch', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash']);
const OPTIONS_SEULES = new Set(['--verbose', '--no-session-persistence', '--strict-mcp-config', '--include-hook-events']);
const OPTIONS_FIXES = { '--model': MODELE, '--effort': EFFORT, '--output-format': 'stream-json' };
const OPTIONS_OBLIGATOIRES = ['--model', '--effort', '--output-format', '--verbose', '--tools', '--no-session-persistence', '--strict-mcp-config'];
const DELAI_MS = 120000;
const FICHIER_ARRET = 'ARRET.txt';
const FICHIER_COMPTEUR = 'compteur-context.json';
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

class Refus extends Error {}
class RefusArgv extends Refus {}
class Arret extends Error {}
class SerieRejetee extends Error {}

const mod = (plateforme) => (plateforme === 'win32' ? path.win32 : path.posix);

/** Lecture d'une variable, sans tenir compte de la casse sous Windows. */
function lireVar(env, nom, plateforme = process.platform) {
  if (env[nom] !== undefined) return env[nom];
  if (plateforme !== 'win32') return undefined;
  const cle = Object.keys(env).find((k) => k.toLowerCase() === nom.toLowerCase());
  return cle === undefined ? undefined : env[cle];
}

/** Vrai si `enfant` est `parent` ou se trouve dessous (casse ignorée sous Windows, via path.win32). */
function estSousOuEgal(enfant, parent, plateforme = process.platform) {
  const p = mod(plateforme);
  const rel = p.relative(p.resolve(parent), p.resolve(enfant));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel));
}
const estSousStrict = (enfant, parent, plateforme = process.platform) =>
  estSousOuEgal(enfant, parent, plateforme) && !estSousOuEgal(parent, enfant, plateforme);
const memeChemin = (a, b, plateforme = process.platform) => estSousOuEgal(a, b, plateforme) && estSousOuEgal(b, a, plateforme);

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

const MOTIF_RETIRE = /^(CLAUDE|ANTHROPIC)/i;
/** L'environnement du processus enfant : rien de CLAUDE* ni d'ANTHROPIC*, puis deux variables posées. */
function environnementNettoye(env, configDir) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || MOTIF_RETIRE.test(k) || /^DISABLE_AUTOUPDATER$/i.test(k)) continue;
    out[k] = v;
  }
  out.CLAUDE_CONFIG_DIR = configDir;
  out.DISABLE_AUTOUPDATER = '1';
  return out;
}

/** Contrôle de l'environnement de l'enfant, refait juste avant chaque lancement. */
function problemesEnvironnement(env, configDir) {
  const out = [];
  for (const k of Object.keys(env)) {
    if (/^ANTHROPIC/i.test(k)) out.push(`variable ${k} présente après le nettoyage`);
    else if (/^CLAUDE/i.test(k) && k !== 'CLAUDE_CONFIG_DIR') out.push(`variable ${k} présente après le nettoyage`);
  }
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
 * Seconde barrière, appliquée à l'argv final dans lancerClaude : « --version », « auth status --json »,
 * ou « -p /context » avec ses options connues. --mcp-config et --plugin-dir doivent désigner un
 * chemin absolu sous l'espace. Renvoie la forme reconnue.
 */
function verifierArgv(argv, { espace, plateforme = process.platform }) {
  if (!Array.isArray(argv) || argv.some((a) => typeof a !== 'string')) throw new RefusArgv('arguments invalides');
  if (argv.length === 1 && argv[0] === '--version') return 'version';
  if (argv.length === 3 && argv[0] === 'auth' && argv[1] === 'status' && argv[2] === '--json') return 'auth';
  if (argv[0] !== '-p') throw new RefusArgv('seuls « --version », « auth status --json » et « -p /context » sont permis');
  verifierPrompt(argv[1]);
  const p = mod(plateforme);
  const vus = new Set();
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (vus.has(a)) throw new RefusArgv(`option répétée : ${a}`);
    vus.add(a);
    if (a in OPTIONS_FIXES) {
      if (argv[++i] !== OPTIONS_FIXES[a]) throw new RefusArgv(`${a} : valeur refusée`);
    } else if (a === '--tools') {
      if (!outilsValides(argv[++i])) throw new RefusArgv('--tools : jeu d\'outils refusé');
    } else if (a === '--mcp-config' || a === '--plugin-dir') {
      const v = argv[++i];
      if (typeof v !== 'string' || !p.isAbsolute(v) || !estSousStrict(v, espace, plateforme)) throw new RefusArgv(`${a} : le chemin doit être sous l'espace`);
    } else if (!OPTIONS_SEULES.has(a)) {
      throw new RefusArgv(`option refusée : ${a}`);
    }
  }
  const manquantes = OPTIONS_OBLIGATOIRES.filter((o) => !vus.has(o));
  if (manquantes.length > 0) throw new RefusArgv(`option obligatoire absente : ${manquantes.join(', ')}`);
  return 'context';
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

function lireCompteur(dossier) {
  const f = path.join(dossier, FICHIER_COMPTEUR);
  if (!fs.existsSync(f)) return { lot: LOT, plafond: PLAFOND, utilises: 0 };
  let c;
  try {
    c = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    throw new Arret('compteur illisible : arrêt');
  }
  if (!c || c.lot !== LOT || c.plafond !== PLAFOND || !Number.isInteger(c.utilises) || c.utilises < 0) throw new Arret("compteur d'un autre lot ou invalide : arrêt");
  return c;
}

/** Refuse une série qui dépasserait le plafond, avant son premier appel. */
function verifierBudget(dossier, prevus) {
  const c = lireCompteur(dossier);
  if (c.utilises + prevus > c.plafond) {
    throw new Refus(`plafond : ${c.utilises} /context utilisés, ${prevus} prévus, plafond de ${c.plafond} pour le lot ${LOT}`);
  }
  return c;
}

/** Réserve un /context : le compteur est incrémenté AVANT le lancement. */
function reserverContext(dossier) {
  const c = lireCompteur(dossier);
  if (c.utilises >= c.plafond) throw new Arret(`plafond de ${c.plafond} /context atteint`);
  const suivant = { ...c, utilises: c.utilises + 1 };
  fs.mkdirSync(dossier, { recursive: true });
  const f = path.join(dossier, FICHIER_COMPTEUR);
  fs.writeFileSync(`${f}.tmp`, `${JSON.stringify(suivant)}\n`, 'utf8');
  fs.renameSync(`${f}.tmp`, f);
  return suivant.utilises;
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

/** Une entrée de rapport : fixtures par leur nom, tout le reste en totaux, aucun chemin absolu. */
function normaliserCombinaison(flux, { racines, nomMemoire, plan = [], plateforme = process.platform }) {
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
    if (chemin && deployes.has(chemin.toLowerCase()) && TYPES_MEMOIRE.has(f.type)) memoryFiles.push({ chemin, type: f.type, tokens: f.tokens });
    else ajouter(hors.memoire_hors, f.tokens);
  }
  const skills = [];
  for (const s of cu.skills || []) {
    const pluginOk = s.plugin_name === undefined || s.plugin_name === null || estNomFixture(s.plugin_name);
    if (estNomFixture(s.name) && pluginOk) skills.push({ name: s.name, source: s.source, ...(s.plugin_name ? { plugin: s.plugin_name } : {}), tokens: s.tokens });
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
  return null;
}

function ecartsProfil(avant, apres, nomMemoire) {
  const connus = new Map();
  const inconnus = [];
  const noter = (rel, nature, type) => {
    const motif = motifConnu(rel, nature, type, nomMemoire);
    if (motif) connus.set(motif, (connus.get(motif) || 0) + 1);
    else inconnus.push({ chemin: rel, nature });
  };
  for (const [rel, e] of apres) {
    const a = avant.get(rel);
    if (!a) noter(rel, 'ajouté', e.type);
    else if (a.type !== e.type || a.taille !== e.taille) noter(rel, 'modifié', e.type);
  }
  for (const [rel, e] of avant) if (!apres.has(rel)) noter(rel, 'retiré', e.type);
  return { connus: [...connus].map(([motif, nombre]) => ({ motif, nombre })), inconnus };
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
 * sont supprimés, puis les dossiers créés, s'ils sont vides. Un fichier modifié est conservé.
 */
function retirer(journalPath) {
  if (!fs.existsSync(journalPath)) return { problemes: [] };
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  const problemes = [];
  for (const f of [...journal.fichiers].reverse()) {
    if (!fs.existsSync(f.destination)) continue;
    if (sha256(fs.readFileSync(f.destination, 'utf8')) !== f.sha256) {
      problemes.push(`fichier modifié conservé : ${f.destination}`);
      continue;
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
  return { problemes };
}

// --- Lancement de claude ---------------------------------------------------------------------------------

function arreterArbre(enfant, plateforme = process.platform) {
  if (plateforme === 'win32' && enfant.pid) spawnSync('taskkill', ['/T', '/F', '/PID', String(enfant.pid)], { windowsHide: true, stdio: 'ignore' });
  else enfant.kill('SIGKILL');
}

/**
 * Le seul point de lancement de claude : fichier ARRET, liste blanche des arguments, environnement
 * contrôlé, réservation du compteur pour un /context, aucun shell, entrée standard fermée.
 */
function lancerClaude({ exe, argv, env, cwd, espace, configDir, dossierBrut, plateforme = process.platform, delaiMs = DELAI_MS }) {
  verifierArret(dossierBrut);
  const forme = verifierArgv(argv, { espace, plateforme });
  const pb = problemesEnvironnement(env, configDir);
  if (pb.length > 0) throw new Refus(`environnement non conforme : ${pb.join(' ; ')}`);
  const numero = forme === 'context' ? reserverContext(dossierBrut) : null;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let expire = false;
    const enfant = spawn(exe, argv, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    enfant.stdout.setEncoding('utf8');
    enfant.stderr.setEncoding('utf8');
    enfant.stdout.on('data', (d) => (stdout += d));
    enfant.stderr.on('data', (d) => (stderr += d));
    const minuteur = setTimeout(() => {
      expire = true;
      arreterArbre(enfant, plateforme);
    }, delaiMs);
    enfant.on('error', (err) => {
      clearTimeout(minuteur);
      resolve({ forme, numero, code: null, stdout, stderr: `${stderr}${err.message}`, expire });
    });
    enfant.on('close', (code) => {
      clearTimeout(minuteur);
      resolve({ forme, numero, code, stdout, stderr, expire });
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
  if (!/^context-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(nom)) throw new Refus('nom de rapport refusé');
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

function preparer() {
  const plateforme = process.platform;
  const { configDir, espace } = cheminsParDefaut();
  const exe = resoudreExe();
  const env = environnementNettoye(process.env, configDir);
  const pbEnv = problemesEnvironnement(env, configDir);
  if (pbEnv.length > 0) throw new Refus(pbEnv.join(' ; '));
  if (!fs.existsSync(configDir)) throw new Refus("le profil isolé n'existe pas : le connecter d'abord (README de la suite)");
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
  const compteur = lireCompteur(BRUT);
  console.log(`[sonde-claude] version : ${etat.version}`);
  console.log(`[sonde-claude] connexion : ${JSON.stringify(etat.resume)}`);
  console.log(`[sonde-claude] configDirectory : ${etat.problemes.some((p) => p.startsWith('configDirectory')) ? 'NON CONFORME' : 'le profil isolé'}`);
  console.log(`[sonde-claude] /context du lot ${LOT} : ${compteur.utilises} sur ${compteur.plafond}`);
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
  const opts = { combinaisons: null, resultats: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--resultats') opts.resultats = true;
    else if (args[i] === '--combinaisons' && args[i + 1]) opts.combinaisons = args[++i].split(',').filter(Boolean);
    else throw new Refus(`option inconnue : ${args[i]}`);
  }
  if (opts.combinaisons) {
    const inconnues = opts.combinaisons.filter((id) => !COMBINAISONS.some((c) => c.id === id));
    if (inconnues.length > 0) throw new Refus(`combinaison inconnue : ${inconnues.join(', ')}`);
  }
  return opts;
}

async function commandeContext(args) {
  const opts = lireOptions(args);
  const combinaisons = opts.combinaisons ? COMBINAISONS.filter((c) => opts.combinaisons.includes(c.id)) : COMBINAISONS;
  const ctx = preparer();
  verifierArret(BRUT);
  if (ctx.pbEspace.length > 0) throw new Refus(ctx.pbEspace.join(' ; '));
  if (fs.existsSync(ctx.journal)) throw new Refus('un journal de déploiement existe : lancer « retirer »');
  const prevus = BASES.length * 2 + combinaisons.length;
  verifierBudget(BRUT, prevus);
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
      const r = await lancerClaude({ exe: ctx.exe, argv, env: ctx.env, cwd: ctx.projet, espace: ctx.espace, configDir: ctx.configDir, dossierBrut: BRUT, plateforme: ctx.plateforme });
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
      ...normaliserCombinaison(flux, { racines, nomMemoire, plan, plateforme: ctx.plateforme }),
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

  const compteur = lireCompteur(BRUT);
  const rapport = {
    rapport: 'claude-code-context',
    format: 1,
    lot: LOT,
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

async function principal(argv) {
  const [commande, ...reste] = argv;
  try {
    if (commande === 'etat' && reste.length === 0) return await commandeEtat();
    if (commande === 'context') return await commandeContext(reste);
    if (commande === 'retirer' && reste.length === 0) return await commandeRetirer();
    throw new Refus('Usage : node test/scenarios/scripts/sonde-claude-code.js <etat|context|retirer> [--combinaisons a,b] [--resultats]');
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
  LOT, PLAFOND, PROMPTS, ABONNEMENTS, BASES, COMBINAISONS, FICHIER_ARRET, FICHIER_COMPTEUR,
  Refus, RefusArgv, Arret, SerieRejetee,
  estSousOuEgal, estSousStrict, cheminsParDefaut, resoudreExe, environnementNettoye, problemesEnvironnement,
  problemesEspace, problemesAuth, verifierPrompt, argumentsContext, verifierArgv, lireFlux, sommeUsage,
  controlerAppel, verifierArret, ecrireArret, lireCompteur, verifierBudget, reserverContext,
  racinesNormalisation, reecrireChemin, fixturesAttendues, normaliserCombinaison, comparerBases,
  listerProfil, ecartsProfil, listerFixtures, fichiersADeployer, deployer, retirer, lancerClaude, ecrireRapport,
};

if (require.main === module) {
  principal(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
