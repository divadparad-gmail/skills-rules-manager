/**
 * Lot E3 de la suite d'injection Claude Code : H14, le panneau Claude Code de VS Code. Fonctions sans
 * lancement de claude.
 *
 * Ce module n'importe pas child_process : le seul point de lancement reste lancerClaude() dans
 * sonde-claude-code.js. On y trouve :
 *   - la recherche de la copie de Claude Code embarquée dans l'extension VS Code (P5b), calculée à
 *     chaque exécution, jamais écrite dans un fichier ;
 *   - le contrôle de extensions.autoUpdate dans la VS Code principale (décision Q1) et les réglages du
 *     dossier utilisateur temporaire de l'instance séparée (décision D-b) ;
 *   - la lecture de la transcription du panneau, sans jamais en recopier le texte (P2, décision Q5) ;
 *   - les canaris attendus, déduits de l'appel 4a de la baseline (décision Q2) ;
 *   - le classement des écarts du profil isolé : fixtures déployées, transcription attendue, écarts
 *     signalés (P3) ;
 *   - le déplacement de la transcription dans brut/ (P4, décision Q3).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const commun = require('./sonde-claude-code-commun');
const payant = require('./sonde-claude-code-payant');

const { Refus } = commun;

/** Le lot du compteur de /context de H14 (décision Q2 : plafond de 12). */
const LOT_H14 = 'E3';
/** Les /context prévus : 2 bases × 2 exécutables + 2 H14 à la préparation, 2 bases × 2 à la clôture. */
const PREVUS_PREPARATION = 6;
const PREVUS_CLOTURE = 4;
const PREVUS_TOTAL = PREVUS_PREPARATION + PREVUS_CLOTURE;
/** L'état de l'essai en cours, dans brut/ ; son dossier : brut/h14-<horodatage>/. */
const FICHIER_ETAT = 'h14-en-cours.json';
const SOUS_DOSSIER_TRANSCRIPTION = 'transcription';
const FICHIER_PROFIL_AVANT = 'profil-avant.txt';
/** Le dossier utilisateur temporaire de l'instance séparée de VS Code, sous le dossier temporaire. */
const DOSSIER_INSTANCE = 'vscode-canari';
/**
 * Les réglages de l'instance séparée (décision D-b) : ni mise à jour des extensions ni de VS Code, et
 * ni fichier ouvert ni sélection joints au message du panneau.
 */
const REGLAGES_INSTANCE = Object.freeze({
  'extensions.autoUpdate': false,
  'extensions.autoCheckUpdates': false,
  'update.mode': 'none',
  'claudeCode.attachOpenFile': false,
  'claudeCode.attachSelection': false,
});
const ID_EXTENSION = 'anthropic.claude-code';
const NOM_DOSSIER_EXTENSION = /^anthropic\.claude-code-(\d+\.\d+\.\d+)(?:-[a-z0-9-]+)?$/i;
const UUID_NOM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANARI = /CANARI-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g;
/** Un message d'utilisateur qui n'est qu'une commande locale du panneau (/status, /context). */
const COMMANDE_LOCALE = /^\s*<(?:command-|local-command)/;

const mod = (plateforme) => (plateforme === 'win32' ? path.win32 : path.posix);

/** Lecture d'une variable, sans tenir compte de la casse sous Windows. */
function lireVar(env, nom, plateforme) {
  if (env[nom] !== undefined) return env[nom];
  if (plateforme !== 'win32') return undefined;
  const cle = Object.keys(env).find((k) => k.toLowerCase() === nom.toLowerCase());
  return cle === undefined ? undefined : env[cle];
}

// --- Copie embarquée (P5b) ---------------------------------------------------------------------------

/**
 * La copie de Claude Code embarquée dans l'extension VS Code. Ordre : CANARI_CLAUDE_EMBARQUEE (chemin
 * absolu d'un .exe sous Windows), puis l'entrée anthropic.claude-code de extensions.json du dossier des
 * extensions (VSCODE_EXTENSIONS, sinon <home>/.vscode/extensions), puis l'unique dossier
 * anthropic.claude-code-<version>. Le binaire est resources/native-binary/claude(.exe). Le chemin
 * n'est jamais écrit : seule la version l'est. Plusieurs candidats sans extensions.json : refus.
 */
function trouverCopieEmbarquee({ env = process.env, plateforme = process.platform, home, existe = fs.existsSync, lireTexte = (f) => fs.readFileSync(f, 'utf8'), lister = fs.readdirSync }) {
  const p = mod(plateforme);
  const binaire = plateforme === 'win32' ? 'claude.exe' : 'claude';
  const force = lireVar(env, 'CANARI_CLAUDE_EMBARQUEE', plateforme);
  if (force) {
    if (!p.isAbsolute(force)) throw new Refus('CANARI_CLAUDE_EMBARQUEE doit être un chemin absolu');
    if (plateforme === 'win32' && !/\.exe$/i.test(force)) throw new Refus('CANARI_CLAUDE_EMBARQUEE doit désigner un .exe (jamais un .cmd ni un .bat)');
    if (!existe(force)) throw new Refus('CANARI_CLAUDE_EMBARQUEE ne désigne aucun fichier');
    return { exe: force, version: null, source: 'variable' };
  }
  const dossier = lireVar(env, 'VSCODE_EXTENSIONS', plateforme) || p.join(home, '.vscode', 'extensions');
  if (!p.isAbsolute(dossier) || !existe(dossier)) throw new Refus('dossier des extensions de VS Code introuvable : définir CANARI_CLAUDE_EMBARQUEE');
  let nom = null;
  let source;
  const index = p.join(dossier, 'extensions.json');
  if (existe(index)) {
    let liste;
    try {
      liste = JSON.parse(lireTexte(index));
    } catch {
      throw new Refus('extensions.json illisible : définir CANARI_CLAUDE_EMBARQUEE');
    }
    const entrees = (Array.isArray(liste) ? liste : []).filter((e) => e && e.identifier && String(e.identifier.id).toLowerCase() === ID_EXTENSION);
    if (entrees.length > 1) throw new Refus(`extensions.json cite ${entrees.length} copies de ${ID_EXTENSION} : définir CANARI_CLAUDE_EMBARQUEE`);
    if (entrees.length === 1) {
      const e = entrees[0];
      nom = e.relativeLocation || (e.location && (e.location.fsPath || e.location.path) ? p.basename(e.location.fsPath || e.location.path) : null);
      source = 'extensions.json';
    }
  }
  if (!nom) {
    const candidats = lister(dossier).filter((n) => NOM_DOSSIER_EXTENSION.test(n));
    if (candidats.length === 0) throw new Refus(`extension ${ID_EXTENSION} introuvable dans le dossier des extensions`);
    if (candidats.length > 1) throw new Refus(`${candidats.length} copies de ${ID_EXTENSION} sans extensions.json : définir CANARI_CLAUDE_EMBARQUEE`);
    [nom] = candidats;
    source = 'dossier';
  }
  const m = NOM_DOSSIER_EXTENSION.exec(String(nom));
  if (!m) throw new Refus(`nom de dossier de l'extension inattendu : définir CANARI_CLAUDE_EMBARQUEE`);
  const exe = p.join(dossier, nom, 'resources', 'native-binary', binaire);
  if (!existe(exe)) throw new Refus(`copie embarquée absente de l'extension ${m[1]} (resources/native-binary/${binaire})`);
  return { exe, version: m[1], source };
}

// --- VS Code principale et instance séparée (Q1, D-b) ------------------------------------------------

/** Les paramètres utilisateur de la VS Code principale (chemin calculé, jamais écrit). */
function cheminReglagesPrincipaux({ env = process.env, plateforme = process.platform, home }) {
  const p = mod(plateforme);
  if (plateforme === 'win32') return p.join(lireVar(env, 'APPDATA', plateforme) || p.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'settings.json');
  if (plateforme === 'darwin') return p.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
  return p.join(home, '.config', 'Code', 'User', 'settings.json');
}

/**
 * Vrai si extensions.autoUpdate vaut false dans le texte des paramètres (JSON avec commentaires) :
 * au moins une occurrence, et toutes à false. Une ligne commentée ne compte pas.
 */
function autoUpdateCoupe(texte) {
  const lignes = String(texte).split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l));
  const valeurs = [...lignes.join('\n').matchAll(/"extensions\.autoUpdate"\s*:\s*([^,}\s]+)/g)].map((m) => m[1]);
  return valeurs.length > 0 && valeurs.every((v) => v === 'false');
}

const texteReglagesInstance = () => `${JSON.stringify(REGLAGES_INSTANCE, null, 2)}\n`;

/**
 * Refuse un dossier utilisateur temporaire existant et non vide (précision 3 du 2026-11-10) : il
 * porterait l'état d'une instance précédente. Le lanceur ne le supprime jamais ; le message dit
 * comment le retirer. Un dossier absent ou vide est accepté.
 */
function verifierInstanceLibre(dossierInstance, { existe = fs.existsSync, lister = fs.readdirSync } = {}) {
  if (existe(dossierInstance) && lister(dossierInstance).length > 0) {
    throw new Refus(`le dossier utilisateur temporaire de l'instance séparée existe et n'est pas vide (${dossierInstance}) : le lanceur ne le supprime pas. Ferme l'instance qui l'utiliserait, puis retire-le toi-même, par exemple : Remove-Item -Recurse -Force "$env:TEMP\\${DOSSIER_INSTANCE}"`);
  }
}

/** Écrit User/settings.json du dossier utilisateur temporaire (jamais d'écrasement). */
function ecrireInstance(dossierInstance, { ecrire = (f, t) => fs.writeFileSync(f, t, { encoding: 'utf8', flag: 'wx' }), creer = (d) => fs.mkdirSync(d, { recursive: true }) } = {}) {
  verifierInstanceLibre(dossierInstance);
  const fichier = path.join(dossierInstance, 'User', 'settings.json');
  creer(path.dirname(fichier));
  ecrire(fichier, texteReglagesInstance());
  return fichier;
}

// --- Transcription du panneau (P2, P4) -----------------------------------------------------------------

/**
 * Vrai si un chemin du profil (relatif, séparateur « / ») appartient à une transcription de session :
 * projects/<memoire>/<uuid>.jsonl, ou tout ce qui est sous projects/<memoire>/<uuid>/.
 */
function estTranscription(rel, nomMemoire) {
  const s = String(rel).split('/');
  if (s.length < 3 || s[0] !== 'projects' || s[1].toLowerCase() !== String(nomMemoire).toLowerCase()) return false;
  if (s.length === 3 && /\.jsonl$/i.test(s[2])) return UUID_NOM.test(s[2].slice(0, -'.jsonl'.length));
  return UUID_NOM.test(s[2]);
}

/**
 * Lit une transcription (JSONL) sans jamais renvoyer le texte des messages de l'utilisateur. Le texte
 * des réponses n'est gardé que dans `textes`, pour en extraire les canaris : il ne doit jamais être
 * écrit ni affiché.
 */
function lireTranscription(texte) {
  const appels = new Set();
  const modeles = new Set();
  const versions = new Set();
  const outils = [];
  const textes = [];
  let lignes = 0;
  let illisibles = 0;
  let invites = 0;
  let sansIdentifiant = 0;
  for (const brute of String(texte).split(/\r?\n/)) {
    const l = brute.trim();
    if (!l) continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      illisibles++;
      continue;
    }
    lignes++;
    if (!o || typeof o !== 'object') continue;
    if (typeof o.version === 'string') versions.add(o.version);
    const m = o.message;
    if (o.type === 'assistant' && m && typeof m === 'object') {
      if (typeof m.model === 'string' && m.model !== '<synthetic>') {
        const id = o.requestId || m.id;
        if (id) appels.add(String(id));
        else sansIdentifiant++;
        modeles.add(m.model);
      }
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b && b.type === 'text' && typeof b.text === 'string') textes.push(b.text);
        else if (b && (b.type === 'tool_use' || b.type === 'server_tool_use')) outils.push(String(b.name));
      }
    } else if (o.type === 'user' && !o.isMeta && m && typeof m === 'object') {
      const c = m.content;
      if (typeof c === 'string') {
        if (!COMMANDE_LOCALE.test(c)) invites++;
      } else if (Array.isArray(c) && !c.some((b) => b && b.type === 'tool_result')
        && c.some((b) => b && b.type === 'text' && typeof b.text === 'string' && !COMMANDE_LOCALE.test(b.text))) {
        invites++;
      }
    }
  }
  return { lignes, illisibles, appels: appels.size + sansIdentifiant, modeles: [...modeles], versions: [...versions], outils, textes, invites };
}

/** Les canaris de l'inventaire et leur fixture (chemin sous fixtures/). */
function canarisDeLInventaire(inventaire) {
  const out = new Map();
  for (const [rel, v] of inventaire) for (const c of v.canaris || []) out.set(c, rel);
  return out;
}

/**
 * Les canaris attendus dans le panneau, déduits de l'appel 4a d'une baseline (décision Q2) : ceux des
 * fixtures des jeux de H14, hors plugin (le panneau n'a pas de --plugin-dir) ; les canaris MCP de 4a
 * sont écartés, car ce jeu n'a pas de MCP. `non_couverts` : canaris de ces fixtures absents de 4a.
 */
function attendusH14({ baseline, nomBaseline, inventaire, jeux }) {
  const proprietaires = canarisDeLInventaire(inventaire);
  const dansJeu = (canari) => {
    const rel = proprietaires.get(canari);
    if (!rel) return false;
    const [jeu, cible] = rel.split('/');
    return jeux.includes(jeu) && cible !== 'plugin';
  };
  const entrees = ((baseline && baseline.entrees) || []).filter((e) => e && e.instrument === 'canari' && e.appel === '4a');
  if (entrees.length === 0) throw new Refus(`${nomBaseline} : aucune entrée « canari » de l'appel 4a`);
  const vus = [];
  const nonVus = [];
  for (const e of entrees) {
    if (!dansJeu(e.canari)) continue;
    (e.attendu === true ? vus : nonVus).push(e.canari);
  }
  const couverts = new Set([...vus, ...nonVus]);
  const nonCouverts = [...proprietaires.keys()].filter((c) => dansJeu(c) && !couverts.has(c));
  return { source: `${nomBaseline}, appel 4a`, confiance: 'deduit', vus, non_vus: nonVus, non_couverts: nonCouverts };
}

/** Compare les canaris rapportés par le panneau aux attendus déduits de 4a. */
function comparerCanaris(rapportes, attendus) {
  const r = new Set(rapportes);
  const vus = new Set(attendus.vus);
  const nonVus = new Set(attendus.non_vus);
  return {
    conformes: attendus.vus.filter((c) => r.has(c)),
    manquants: attendus.vus.filter((c) => !r.has(c)),
    inattendus: attendus.non_vus.filter((c) => r.has(c)),
    hors_jeu: [...r].filter((c) => !vus.has(c) && !nonVus.has(c)),
  };
}

/**
 * La vérification des transcriptions du panneau (P2). Le relevé des canaris est invalide si un outil a
 * été appelé (décision Q5), si le nombre d'appels au modèle n'est pas 1 (décision D-c), si la réponse
 * est illisible ou si aucune transcription n'a été trouvée. Aucun texte de message n'est renvoyé.
 */
function verifierTranscriptions(textesFichiers, { canarisConnus, attendus }) {
  const lues = textesFichiers.map(lireTranscription);
  const somme = (cle) => lues.reduce((s, t) => s + t[cle], 0);
  const outils = new Map();
  for (const t of lues) for (const n of t.outils) outils.set(n, (outils.get(n) || 0) + 1);
  const textes = lues.flatMap((t) => t.textes);
  const reponse = textes.length > 0 ? textes[textes.length - 1] : null;
  const json = payant.extraireJson(reponse);
  const liste = json && Array.isArray(json.canaris) ? json.canaris.filter((x) => typeof x === 'string') : null;
  const rapportes = liste ? [...new Set(liste.filter((x) => canarisConnus.has(x)))] : [];
  // Les canaris cités hors du JSON, comptés seulement (signe d'une réponse mal formée).
  const cites = new Set(textes.flatMap((t) => t.match(CANARI) || []));
  const raisons = [];
  if (lues.length === 0) raisons.push('aucune transcription du panneau trouvée');
  if (outils.size > 0) raisons.push(`appel d'outil dans le panneau (${[...outils.keys()].join(', ')}) : relevé des canaris invalide, sans relance`);
  if (lues.length > 0 && somme('appels') !== 1) raisons.push(`${somme('appels')} appel(s) au modèle dans la transcription (1 attendu)`);
  if (lues.length > 0 && !liste) raisons.push('réponse illisible (objet JSON avec une liste canaris attendu)');
  return {
    transcriptions: lues.length,
    lignes: somme('lignes'),
    lignes_illisibles: somme('illisibles'),
    appels_modele: somme('appels'),
    invites: somme('invites'),
    modeles: [...new Set(lues.flatMap((t) => t.modeles))],
    versions: [...new Set(lues.flatMap((t) => t.versions))],
    outils: [...outils].map(([nom, nombre]) => ({ nom, nombre })),
    reponse: {
      lisible: Boolean(liste),
      canaris: rapportes,
      chaines_inconnues: liste ? liste.filter((x) => !canarisConnus.has(x)).length : 0,
      canaris_hors_json: [...cites].filter((c) => !rapportes.includes(c)).length,
    },
    comparaison: comparerCanaris(rapportes, attendus),
    releve_canaris: { valide: raisons.length === 0, raisons },
  };
}

// --- Profil isolé (P3) ----------------------------------------------------------------------------------

/** Le texte d'une liste du profil (une ligne « type taille chemin » par entrée), et sa relecture. */
const texteProfil = (liste) => `${[...liste].map(([r, e]) => `${e.type} ${e.taille} ${r}`).join('\n')}\n`;
function lireProfilTexte(texte) {
  const out = new Map();
  for (const l of String(texte).split(/\r?\n/)) {
    if (!l) continue;
    const m = /^([dfl]) (\d+) (.+)$/.exec(l);
    if (!m) throw new Refus('liste du profil illisible');
    out.set(m[3], { type: m[1], taille: Number(m[2]) });
  }
  return out;
}

/**
 * Le classement des écarts du profil depuis l'image prise avant le déploiement (P3). Les entrées
 * ajoutées qui sont des destinations du journal (fichiers ou dossiers créés) sont « déployées » ; celles
 * d'une transcription de session sont « transcription attendue ». Tout le reste est rendu dans
 * `apresFiltre`, à passer à ecartsProfil : un écart restant dans une zone de la sonde est un « écart
 * signalé ».
 */
function classerEcartsH14({ avant, apres, nomMemoire, deployes = new Set() }) {
  const apresFiltre = new Map();
  let deployesVus = 0;
  const transcription = { fichiers: 0, dossiers: 0 };
  for (const [rel, e] of apres) {
    if (avant.has(rel)) {
      apresFiltre.set(rel, e);
      continue;
    }
    if (deployes.has(rel.toLowerCase())) deployesVus++;
    else if (estTranscription(rel, nomMemoire)) transcription[e.type === 'd' ? 'dossiers' : 'fichiers']++;
    else apresFiltre.set(rel, e);
  }
  return { apresFiltre, deployes: deployesVus, transcription };
}

/** Les chemins relatifs au profil (séparateur « / ») des destinations du journal sous le profil. */
function deployesDuJournal(journal, configDir, p = path) {
  const out = new Set();
  const rel = (abs) => p.relative(configDir, abs).split(/[\\/]+/).join('/');
  const sous = (abs) => {
    const r = p.relative(configDir, abs);
    return r !== '' && !r.startsWith('..') && !p.isAbsolute(r);
  };
  for (const f of (journal && journal.fichiers) || []) if (sous(f.destination)) out.add(rel(f.destination).toLowerCase());
  for (const d of (journal && journal.dossiers) || []) if (sous(d)) out.add(rel(d).toLowerCase());
  return out;
}

// --- Déplacement de la transcription (P4) ---------------------------------------------------------------

/** Le dossier projects/<memoire> du profil (casse ignorée), ou null. */
function dossierMemoireProjet(configDir, nomMemoire, lister = fs.readdirSync, existe = fs.existsSync) {
  const projets = path.join(configDir, 'projects');
  if (!existe(projets)) return null;
  const nom = lister(projets).find((n) => n.toLowerCase() === String(nomMemoire).toLowerCase());
  return nom ? path.join(projets, nom) : null;
}

/** L'identifiant de session d'une entrée de projects/<memoire>/ (<uuid>.jsonl ou <uuid>/), ou null. */
function uuidDe(nom) {
  const n = String(nom).replace(/\.jsonl$/i, '');
  return UUID_NOM.test(n) ? n.toLowerCase() : null;
}

/** Les identifiants des sessions présentes sous un dossier (entrées <uuid>.jsonl ou <uuid>/). */
function sessionsDans(dossier, fsx = fs) {
  if (!dossier || !fsx.existsSync(dossier)) return [];
  return [...new Set(fsx.readdirSync(dossier).map(uuidDe).filter(Boolean))].sort();
}

/** Les sessions de projects/<memoire>/ du profil (liste notée par --preparer-h14 après ses mesures). */
const sessionsDuProfil = (configDir, nomMemoire, fsx = fs) => sessionsDans(dossierMemoireProjet(configDir, nomMemoire, (d) => fsx.readdirSync(d), (d) => fsx.existsSync(d)), fsx);

/**
 * Les nouvelles sessions (précision 1 du 2026-11-10) : celles du profil absentes de la liste notée à
 * la préparation, plus celles déjà déplacées dans brut/. --verifier-h14 en exige exactement une.
 */
function nouvellesSessions({ profil, notees, deplacees }) {
  const n = new Set(notees);
  return [...new Set([...profil.filter((u) => !n.has(u)), ...deplacees])].sort();
}

/**
 * Déplace dans `destination` les transcriptions des sessions absentes de la liste `notees` (fichiers
 * <uuid>.jsonl et dossiers <uuid>/ de projects/<memoire>/), sans les ouvrir ni les nommer en console.
 * N'écrase jamais rien. Renvoie le nombre de fichiers et de dossiers déplacés.
 */
function deplacerTranscriptions({ configDir, nomMemoire, notees, destination, fsx = fs }) {
  const source = dossierMemoireProjet(configDir, nomMemoire, (d) => fsx.readdirSync(d), (d) => fsx.existsSync(d));
  const resultat = { fichiers: 0, dossiers: 0 };
  if (!source) return resultat;
  const n = new Set(notees);
  const aDeplacer = fsx.readdirSync(source).filter((nom) => uuidDe(nom) && !n.has(uuidDe(nom)));
  if (aDeplacer.length === 0) return resultat;
  fsx.mkdirSync(destination, { recursive: true });
  const deja = aDeplacer.filter((n) => fsx.existsSync(path.join(destination, n)));
  if (deja.length > 0) throw new Refus(`${deja.length} transcription(s) déjà présente(s) dans brut/ : rien n'est déplacé`);
  for (const n of aDeplacer) {
    const de = path.join(source, n);
    const vers = path.join(destination, n);
    const dossier = fsx.lstatSync(de).isDirectory();
    try {
      fsx.renameSync(de, vers);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      fsx.cpSync(de, vers, { recursive: true, errorOnExist: true, force: false });
      fsx.rmSync(de, { recursive: true });
    }
    resultat[dossier ? 'dossiers' : 'fichiers']++;
  }
  return resultat;
}

/**
 * Les textes .jsonl d'une session (son <uuid>.jsonl et tout .jsonl sous <uuid>/), cherchés dans les
 * dossiers donnés, dans l'ordre ; jamais affichés.
 */
function lireTextesSession(uuid, dossiers, fsx = fs) {
  const out = [];
  const parcourir = (d) => {
    for (const n of fsx.readdirSync(d).sort()) {
      const abs = path.join(d, n);
      if (fsx.lstatSync(abs).isDirectory()) parcourir(abs);
      else if (/\.jsonl$/i.test(n)) out.push(fsx.readFileSync(abs, 'utf8'));
    }
  };
  for (const d of dossiers) {
    if (!d || !fsx.existsSync(d)) continue;
    for (const n of fsx.readdirSync(d).sort()) {
      if (uuidDe(n) !== uuid) continue;
      const abs = path.join(d, n);
      if (fsx.lstatSync(abs).isDirectory()) parcourir(abs);
      else if (/\.jsonl$/i.test(n)) out.push(fsx.readFileSync(abs, 'utf8'));
    }
  }
  return out;
}

/**
 * L'écart de version entre le panneau (versions lues dans sa transcription) et la copie embarquée
 * mesurée par P5b (précision 2) : à mettre en tête du rapport.
 */
function ecartVersion(versionsPanneau, versionEmbarquee) {
  const panneau = [...new Set(versionsPanneau)].sort();
  const ecart = panneau.length !== 1 || panneau[0] !== versionEmbarquee;
  return {
    ecart,
    panneau,
    copie_embarquee: versionEmbarquee,
    message: ecart
      ? `ÉCART DE VERSION : panneau ${panneau.length > 0 ? panneau.join(', ') : 'version absente de la transcription'}, copie embarquée mesurée par P5b ${versionEmbarquee}`
      : `version du panneau identique à la copie embarquée mesurée par P5b (${versionEmbarquee})`,
  };
}

// --- Gestes de fin (P1) -----------------------------------------------------------------------------------

/** Les gestes affichés par --cloturer-h14. */
function gestesFinH14({ dossierInstance }) {
  return [
    '1. Rétablis extensions.autoUpdate dans les paramètres utilisateur de la VS Code principale (coupé pendant tout E3, décision Q1).',
    `2. Le dossier utilisateur temporaire de l'instance séparée reste en place (${dossierInstance}) : il ne contient que l'état de cette instance ; supprime-le quand tu veux.`,
    '3. Ne recopie rien de brut/ (relevé manuel, transcription, sorties brutes) dans un fichier suivi par Git.',
  ];
}

module.exports = {
  LOT_H14, PREVUS_PREPARATION, PREVUS_CLOTURE, PREVUS_TOTAL, FICHIER_ETAT, SOUS_DOSSIER_TRANSCRIPTION, FICHIER_PROFIL_AVANT,
  DOSSIER_INSTANCE, REGLAGES_INSTANCE, UUID_NOM,
  trouverCopieEmbarquee, cheminReglagesPrincipaux, autoUpdateCoupe, texteReglagesInstance, verifierInstanceLibre, ecrireInstance,
  estTranscription, lireTranscription, canarisDeLInventaire, attendusH14, comparerCanaris, verifierTranscriptions,
  texteProfil, lireProfilTexte, classerEcartsH14, deployesDuJournal, dossierMemoireProjet,
  uuidDe, sessionsDans, sessionsDuProfil, nouvellesSessions, deplacerTranscriptions, lireTextesSession, ecartVersion, gestesFinH14,
};
