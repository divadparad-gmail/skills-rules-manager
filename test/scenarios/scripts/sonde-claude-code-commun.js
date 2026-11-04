/**
 * Contrat partagé de la suite d'injection Claude Code (lots I1 à I3).
 *
 * Utilisé par le lanceur (sonde-claude-code.js) et par les tests claude-injection-contexte et
 * claude-sonde-claude-code. Fonctions pures, modules intégrés de Node seulement, aucune écriture.
 *
 * - Conversion des noms inertes : fixtures/<jeu>/<cible>/<miroir>, suffixe .fixture retiré,
 *   _claude → .claude, _claude-plugin → .claude-plugin, __projet__ → nom du dossier de mémoire.
 * - Nom du dossier de mémoire automatique d'après le dossier de travail (mesuré en phase 2).
 * - Plan de déploiement d'un ou plusieurs jeux, avec refus des collisions.
 * - Garde de confidentialité des rapports : motifs fixes, données du poste et liste noire de
 *   l'exécution (jamais écrite), liste blanche « canari* » pour les noms.
 */
'use strict';

const crypto = require('crypto');
const os = require('os');
const path = require('path');

// --- Erreurs partagées par le lanceur et la partie payante ---------------------------------------

/** Refus avant tout lancement (préconditions, options, budget) : code de sortie 2. */
class Refus extends Error {}
/** Arguments de claude refusés par la liste blanche. */
class RefusArgv extends Refus {}
/** Arrêt définitif : le fichier ARRET.txt est écrit ou présent ; code de sortie 4. */
class Arret extends Error {}
/** Série rejetée (base différente, contrôle échoué, retrait incomplet) : code de sortie 3. */
class SerieRejetee extends Error {}

// --- Comparaison de chemins (casse ignorée sous Windows, via path.win32) --------------------------

const modChemin = (plateforme) => (plateforme === 'win32' ? path.win32 : path.posix);

/** Vrai si `enfant` est `parent` ou se trouve dessous. */
function estSousOuEgal(enfant, parent, plateforme = process.platform) {
  const p = modChemin(plateforme);
  const rel = p.relative(p.resolve(parent), p.resolve(enfant));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel));
}
const estSousStrict = (enfant, parent, plateforme = process.platform) =>
  estSousOuEgal(enfant, parent, plateforme) && !estSousOuEgal(parent, enfant, plateforme);
const memeChemin = (a, b, plateforme = process.platform) => estSousOuEgal(a, b, plateforme) && estSousOuEgal(b, a, plateforme);

// --- Inventaire figé (source unique : inventaire.json de la suite) --------------------------------

/** Empreinte SHA-256 d'un contenu ramené en LF (comme le test d'I1 et le déploiement). */
const sha256Lf = (texte) => crypto.createHash('sha256').update(String(texte).replace(/\r\n?/g, '\n'), 'utf8').digest('hex');

/**
 * Lit le texte d'inventaire.json : { format: 1, fixtures: [{ chemin, sha256, canaris }] }.
 * Renvoie une Map chemin → { sha256, canaris } ; lève une erreur si le format est invalide.
 */
function lireInventaire(texte) {
  let json;
  try {
    json = JSON.parse(texte);
  } catch {
    throw new Error('inventaire illisible');
  }
  if (!json || json.format !== 1 || !Array.isArray(json.fixtures) || json.fixtures.length === 0) throw new Error('inventaire : format 1 et liste « fixtures » attendus');
  const inventaire = new Map();
  for (const f of json.fixtures) {
    const valide = f && typeof f.chemin === 'string' && /^[0-9a-f]{64}$/.test(f.sha256) && Array.isArray(f.canaris) && f.canaris.every((c) => typeof c === 'string');
    if (!valide) throw new Error(`inventaire : entrée invalide (${f && typeof f.chemin === 'string' ? f.chemin : '?'})`);
    if (inventaire.has(f.chemin)) throw new Error(`inventaire : ${f.chemin} figure deux fois`);
    inventaire.set(f.chemin, { sha256: f.sha256, canaris: [...f.canaris] });
  }
  return inventaire;
}

/**
 * Écarts entre les fixtures lues pour des jeux (Map chemin → texte) et l'inventaire : empreinte
 * différente, fixture absente de l'inventaire, fixture de l'inventaire manquante. Chaque écart nomme le fichier.
 */
function ecartsEmpreintes(jeux, contenus, inventaire) {
  const out = [];
  for (const [rel, texte] of contenus) {
    const entree = inventaire.get(rel);
    if (!entree) out.push(`${rel} : absente de l'inventaire`);
    else if (sha256Lf(texte) !== entree.sha256) out.push(`${rel} : empreinte différente de l'inventaire`);
  }
  for (const rel of inventaire.keys()) {
    if (jeux.includes(rel.split('/')[0]) && !contenus.has(rel)) out.push(`${rel} : manquante`);
  }
  return out;
}

const SUFFIXE = '.fixture';
const SEGMENTS_CONVERTIS = { _claude: '.claude', '_claude-plugin': '.claude-plugin' };
const ESPACE_RESERVE_PROJET = '__projet__';
const CIBLES = ['global', 'parent', 'projet', 'plugin', 'mcp'];
/** Au-delà, Claude Code raccourcirait le nom du dossier de mémoire (non vérifié) : refus. */
const LONGUEUR_MAX_MEMOIRE = 200;

/** Convertit un chemin relatif à fixtures/ en { jeu, cible, chemin } actif (séparateur « / »). */
function convertir(rel, nomProjet = '<projet>') {
  const [jeu, cible, ...miroir] = rel.split('/');
  const segments = miroir.map((s, i) => {
    if (i === miroir.length - 1) return s.endsWith(SUFFIXE) ? s.slice(0, -SUFFIXE.length) : s;
    if (s === ESPACE_RESERVE_PROJET) return nomProjet;
    return SEGMENTS_CONVERTIS[s] ?? s;
  });
  return { jeu, cible, chemin: segments.join('/') };
}

/**
 * Nom du dossier de mémoire automatique (<profil>/projects/<nom>/memory) pour un dossier de travail :
 * chaque caractère non alphanumérique devient « - ». MESURÉ en phase 2 : le dossier de travail
 * C:\canari-claude-code\espace\projet a donné projects\C--canari-claude-code-espace-projet\memory\,
 * et le MEMORY.md déposé sous ce nom a été chargé (type AutoMem, essai 16).
 */
function nomDossierMemoire(cheminProjet) {
  if (typeof cheminProjet !== 'string' || cheminProjet === '') throw new Error('dossier de travail vide');
  const nom = cheminProjet.replace(/[^A-Za-z0-9]/g, '-');
  if (nom.length > LONGUEUR_MAX_MEMOIRE) {
    throw new Error(`dossier de travail trop long (${nom.length} caractères) : le nom du dossier de mémoire ne serait plus prévisible`);
  }
  return nom;
}

/** Clé de déploiement : une définition MCP est rangée sous son jeu, les autres cibles sont partagées. */
const cleDeploiement = ({ jeu, cible, chemin }) => (cible === 'mcp' ? `mcp:${jeu}/${chemin}` : `${cible}:${chemin}`);

/** Collisions de chemins déployés quand plusieurs jeux sont réunis (ordre de la liste des fixtures). */
function collisions(rels, jeux) {
  const vus = new Map();
  const out = [];
  for (const rel of rels) {
    const conv = convertir(rel);
    if (!jeux.includes(conv.jeu)) continue;
    const cle = cleDeploiement(conv);
    const cleComparee = cle.toLowerCase();
    if (vus.has(cleComparee)) out.push(`${cle} (${vus.get(cleComparee)} et ${conv.jeu})`);
    else vus.set(cleComparee, conv.jeu);
  }
  return out;
}

/** Les racines de chaque cible dans l'espace isolé et le profil isolé. */
function racinesCibles({ configDir, espace }, p = path) {
  return {
    global: configDir,
    parent: espace,
    projet: p.join(espace, 'projet'),
    plugin: p.join(espace, 'plugin'),
    mcp: p.join(espace, 'mcp'),
  };
}

/**
 * Plan de déploiement : une entrée par fixture des jeux demandés, avec sa source, sa destination
 * absolue et son chemin normalisé (<global>/…, <memoire> pour le dossier de mémoire). Lève une
 * erreur pour un jeu inconnu, une cible inconnue, un segment « .. » ou une collision.
 */
function planDeploiement(rels, jeux, { configDir, espace, fixturesDir }, p = path) {
  if (!Array.isArray(jeux) || jeux.length === 0) throw new Error('aucun jeu demandé');
  const connus = new Set(rels.map((rel) => rel.split('/')[0]));
  const inconnus = jeux.filter((j) => !connus.has(j));
  if (inconnus.length > 0) throw new Error(`jeu inconnu : ${inconnus.join(', ')}`);
  if (new Set(jeux).size !== jeux.length) throw new Error('jeu demandé deux fois');
  const heurts = collisions(rels, jeux);
  if (heurts.length > 0) throw new Error(`collision de chemins : ${heurts.join(' ; ')}`);
  const racines = racinesCibles({ configDir, espace }, p);
  const nomMemoire = nomDossierMemoire(racines.projet);
  const plan = [];
  for (const rel of rels) {
    const { jeu, cible, chemin } = convertir(rel, nomMemoire);
    if (!jeux.includes(jeu)) continue;
    if (!CIBLES.includes(cible)) throw new Error(`${rel} : cible inconnue`);
    const segments = chemin.split('/');
    if (segments.some((s) => s === '' || s === '.' || s === '..')) throw new Error(`${rel} : segment de chemin refusé`);
    const sousRacine = cible === 'mcp' ? [jeu, ...segments] : segments;
    const normalise = `<${cible}>/${cible === 'mcp' ? `${jeu}/` : ''}${convertir(rel, '<memoire>').chemin}`;
    plan.push({
      rel,
      jeu,
      cible,
      chemin,
      source: p.join(fixturesDir, ...rel.split('/')),
      destination: p.join(racines[cible], ...sousRacine),
      normalise,
    });
  }
  return plan;
}

// --- Garde de confidentialité -------------------------------------------------------------------

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Mêmes motifs que la garde de la suite Antigravity (test 8) : lecteur, réseau, /home ou /Users, ~ hors liste. */
const CHEMINS_UTILISATEUR = [
  /(?:^|[^A-Za-z0-9])[A-Za-z]:(?:\\|\/)/,
  /(?:^|[\s"'`(])(?:\\\\){1,2}[A-Za-z0-9][\w.-]*\\{1,2}\S/,
  /\/(home|Users)\/[^\/<\s]+/,
  /(?:~|<HOME>|%USERPROFILE%|\$HOME|\$\{HOME\}|\$env:USERPROFILE)(?:\\{1,2}|\/)(?!\.(?:gemini|claude)(?:[\\/"'\s`]|$))[^\s"'`]/i,
];
/** Clés interdites dans un JSON de rapport, quelle que soit leur valeur. */
const CLES_INTERDITES = new Set(['session_id', 'sessionid', 'uuid', 'orgid', 'organizationid', 'organizationuuid', 'accountuuid', 'email', 'emailaddress', 'useremail', 'orgname', 'organizationname']);
/** Clés qui désignent des skills, plugins, serveurs ou outils : leurs noms doivent être des noms de fixture. */
const CLES_DE_NOMS = new Set(['skill', 'skills', 'plugin', 'plugins', 'serveur', 'serveurs', 'server', 'servers', 'mcp_server', 'mcp_servers', 'mcp_tools', 'outil_mcp', 'outils_mcp', 'tool', 'tools']);
const CHAMPS_DE_NOM = new Set(['name', 'nom', 'plugin', 'server', 'serveur']);
const NOM_PERMIS = /^(?:mcp__)?canari/i;

/** Données du poste lues à l'exécution, jamais écrites. */
function lirePoste() {
  let compte = '';
  try {
    compte = os.userInfo().username;
  } catch {
    compte = process.env.USERNAME ?? process.env.USER ?? '';
  }
  return { home: os.homedir(), compte, hote: os.hostname() };
}

const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Mot entier ou segment de chemin, sans tenir compte de la casse ; ignoré sous 3 caractères (faux positifs). */
const motEntier = (mot) => (mot && mot.length >= 3 ? new RegExp(`(?<![A-Za-z0-9_])${echapper(mot)}(?![A-Za-z0-9_])`, 'i') : null);
/** Le dossier personnel avec les deux séparateurs, et avec les antislashs doublés d'un JSON. */
function variantesHome(home) {
  const parties = home.split(/[\\/]+/).filter(Boolean);
  const prefixe = /^[\\/]/.test(home) ? '/' : '';
  return [...new Set(['\\', '/', '\\\\'].map((sep) => (sep === '/' ? prefixe : prefixe.replace('/', sep)) + parties.join(sep)))]
    .filter((v) => v.length >= 3)
    .map((v) => v.toLowerCase());
}
/** Une valeur sensible, telle quelle, avec les antislashs doublés d'un JSON et avec des « / ». */
const variantesValeur = (v) =>
  [...new Set([v, v.replace(/\\/g, '\\\\'), v.replace(/\\/g, '/')])].filter((x) => x.length >= 3).map((x) => x.toLowerCase());

/**
 * Problèmes de texte : adresse, chemins, identifiants, données du poste et valeurs sensibles de
 * l'exécution (`interdits`). Les messages ne recopient jamais la valeur trouvée.
 */
function problemesTexte(texte, poste, interdits = []) {
  const out = [];
  const homes = variantesHome(poste.home);
  const compte = motEntier(poste.compte);
  const hote = motEntier(poste.hote);
  const sensibles = interdits.filter((v) => typeof v === 'string').flatMap(variantesValeur);
  texte.split(/\r?\n/).forEach((ligne, i) => {
    const n = i + 1;
    const basse = ligne.toLowerCase();
    if (EMAIL.test(ligne)) out.push(`${n}: adresse électronique`);
    if (UUID.test(ligne)) out.push(`${n}: identifiant (uuid)`);
    if (CHEMINS_UTILISATEUR.some((motif) => motif.test(ligne))) out.push(`${n}: chemin personnel, de lecteur ou réseau`);
    if (homes.some((h) => basse.includes(h))) out.push(`${n}: dossier personnel du poste`);
    if (compte?.test(ligne)) out.push(`${n}: nom du compte du poste`);
    if (hote?.test(ligne)) out.push(`${n}: nom d'hôte du poste`);
    if (sensibles.some((s) => basse.includes(s))) out.push(`${n}: valeur sensible de l'exécution`);
  });
  return out;
}

/** Problèmes d'un JSON de rapport : clés interdites et noms hors de la liste blanche « canari* ». */
function problemesJson(texte) {
  let racine;
  try {
    racine = JSON.parse(texte);
  } catch {
    return ['JSON invalide'];
  }
  const out = [];
  const parcourir = (valeur, chemin, cle, dansNoms) => {
    if (Array.isArray(valeur)) {
      valeur.forEach((v, i) => parcourir(v, `${chemin}[${i}]`, cle, dansNoms));
    } else if (valeur !== null && typeof valeur === 'object') {
      for (const [k, v] of Object.entries(valeur)) {
        const kb = k.toLowerCase();
        if (CLES_INTERDITES.has(kb)) out.push(`${chemin}.${k}: clé interdite`);
        parcourir(v, `${chemin}.${k}`, kb, dansNoms || CLES_DE_NOMS.has(kb));
      }
    } else if (typeof valeur === 'string' && dansNoms && (CLES_DE_NOMS.has(cle) || CHAMPS_DE_NOM.has(cle)) && !NOM_PERMIS.test(valeur)) {
      out.push(`${chemin}: nom hors de la liste blanche (${valeur.length} caractères, non recopié)`);
    }
  };
  parcourir(racine, '$', '', false);
  return out;
}

/** Garde complète d'un fichier : texte pour tous, et JSON pour les rapports de attendu/ et resultats/. */
function garder(rel, texte, poste, interdits = []) {
  const rapport = /^(attendu|resultats)\//.test(rel) && rel.endsWith('.json');
  return [...problemesTexte(texte, poste, interdits), ...(rapport ? problemesJson(texte) : [])].map((p) => `${rel}:${p}`);
}

module.exports = {
  Refus,
  RefusArgv,
  Arret,
  SerieRejetee,
  modChemin,
  estSousOuEgal,
  estSousStrict,
  memeChemin,
  SUFFIXE,
  SEGMENTS_CONVERTIS,
  ESPACE_RESERVE_PROJET,
  CIBLES,
  NOM_PERMIS,
  sha256Lf,
  lireInventaire,
  ecartsEmpreintes,
  convertir,
  nomDossierMemoire,
  cleDeploiement,
  collisions,
  racinesCibles,
  planDeploiement,
  lirePoste,
  variantesHome,
  problemesTexte,
  problemesJson,
  garder,
};
