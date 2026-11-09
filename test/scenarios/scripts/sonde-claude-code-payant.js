/**
 * Partie payante de la suite d'injection Claude Code (lot I3) : fonctions sans lancement.
 *
 * Ce module ne lance jamais claude et n'importe pas child_process : le seul point de lancement reste
 * lancerClaude() dans sonde-claude-code.js. On y trouve :
 *   - les compteurs persistants par lot (/context et appels au modèle), avec l'archivage au changement
 *     de lot, sans remise à zéro et sans réouverture d'un lot archivé ;
 *   - la lecture de SONDE.md et la vérification des invites par leur empreinte ;
 *   - le plan des séries 1 à 5 (38 appels au modèle, 33 /context) ;
 *   - la garde de flux (pendant l'appel) et les contrôles après l'appel ;
 *   - la lecture de l'usage, par appel et par tour ;
 *   - la décomposition des coûts (sections 3 et 4 de la conception) ;
 *   - les gestes de la préparation H14.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const commun = require('./sonde-claude-code-commun');

const { Refus, Arret } = commun;

const LOT_PAYANT = 'E2';
const PLAFOND_MODELE = 40;
const MAX_SERIES_REJETEES = 2;

// --- Compteurs par lot ----------------------------------------------------------------------------

/** Les deux compteurs, distincts : un fichier et des plafonds par lot chacun. */
const COMPTEURS = {
  context: { fichier: 'compteur-context.json', plafonds: { E1: 60, E2: 40 }, unite: '/context' },
  modele: { fichier: 'compteur-modele.json', plafonds: { E2: PLAFOND_MODELE }, unite: 'appel(s) au modèle' },
};

/**
 * Les relèvements de plafond, décidés explicitement, un au plus par compteur et par lot. Un compteur
 * existant du lot, au plafond « ancien », passe au plafond « nouveau » (égal au plafond du lot) en
 * gardant ses utilisés, avec cette trace. Aucune option ne relève un plafond : --plafond ne fait
 * qu'abaisser la limite d'une exécution.
 */
const RELEVEMENTS_PLAFOND = {
  context: {
    E1: { ancien: 50, nouveau: 60, date: '2026-11-09', motif: 'série E1 du 2026-11-09 rejetée pour des écarts de synchronisation du profil : relance décidée explicitement' },
  },
};
for (const [type, lots] of Object.entries(RELEVEMENTS_PLAFOND)) {
  for (const [lot, r] of Object.entries(lots)) {
    if (COMPTEURS[type].plafonds[lot] !== r.nouveau || !(r.nouveau > r.ancien)) throw new Error(`relèvement incohérent : ${type} ${lot}`);
  }
}
const traceRelevement = (type, lot) => {
  const r = (RELEVEMENTS_PLAFOND[type] || {})[lot];
  return r ? [{ ancien: r.ancien, nouveau: r.nouveau, date: r.date, motif: r.motif }] : undefined;
};
const nomArchive = (type, lot) => `compteur-${type}-${lot}.json`;

function definitionCompteur(type, lot) {
  const d = COMPTEURS[type];
  if (!d) throw new Refus(`compteur inconnu : ${type}`);
  if (!Object.prototype.hasOwnProperty.call(d.plafonds, lot)) {
    throw new Refus(`lot « ${String(lot)} » refusé pour le compteur ${type} (${Object.keys(d.plafonds).join(' ou ')} attendu)`);
  }
  return d;
}

function lireJsonCompteur(f, type) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    throw new Arret(`compteur ${type} illisible : arrêt`);
  }
}

/**
 * Lit un compteur. Absent : un compteur vide, sauf si le lot est archivé (lot fermé). Un compteur d'un
 * autre lot, ou modifié à la main, provoque un arrêt : on ne change de lot que par ouvrirLot().
 */
function lireCompteur(dossier, type, lot) {
  const d = definitionCompteur(type, lot);
  const f = path.join(dossier, d.fichier);
  if (!fs.existsSync(f)) {
    if (fs.existsSync(path.join(dossier, nomArchive(type, lot)))) {
      throw new Arret(`le lot ${lot} est archivé (${nomArchive(type, lot)}) : il ne peut pas être rouvert`);
    }
    return { lot, plafond: d.plafonds[lot], utilises: 0, ...(type === 'modele' ? { series_rejetees: 0 } : {}) };
  }
  const c = lireJsonCompteur(f, type);
  const valide = c && c.lot === lot && c.plafond === d.plafonds[lot] && Number.isInteger(c.utilises) && c.utilises >= 0
    && (type !== 'modele' || (Number.isInteger(c.series_rejetees) && c.series_rejetees >= 0))
    && (c.historique_plafond === undefined || JSON.stringify(c.historique_plafond) === JSON.stringify(traceRelevement(type, lot)));
  if (!valide) {
    throw new Arret(`compteur ${type} d'un autre lot ou invalide : arrêt (un changement de lot passe par l'archivage, jamais par une remise à zéro)`);
  }
  return c;
}

function ecrireCompteur(dossier, type, c) {
  const f = path.join(dossier, COMPTEURS[type].fichier);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(`${f}.tmp`, `${JSON.stringify(c)}\n`, 'utf8');
  fs.renameSync(`${f}.tmp`, f);
}

/**
 * Ouvre un lot : si le compteur présent appartient à un autre lot, il est archivé sous
 * compteur-<type>-<ancien lot>.json (jamais écrasé). Un lot déjà archivé ne peut pas être rouvert.
 * Renvoie { ancien, archive } si un compteur a été archivé, sinon null.
 */
function ouvrirLot(dossier, type, lot) {
  const d = definitionCompteur(type, lot);
  if (fs.existsSync(path.join(dossier, nomArchive(type, lot)))) {
    throw new Arret(`le lot ${lot} est archivé (${nomArchive(type, lot)}) : il ne peut pas être rouvert`);
  }
  const f = path.join(dossier, d.fichier);
  if (!fs.existsSync(f)) return null;
  const c = lireJsonCompteur(f, type);
  if (!c || typeof c.lot !== 'string' || !/^[A-Z][0-9]$/.test(c.lot) || !Number.isInteger(c.utilises)) {
    throw new Arret(`compteur ${type} invalide : rien n'est archivé, examiner le fichier`);
  }
  if (c.lot === lot) return null;
  const archive = nomArchive(type, c.lot);
  if (fs.existsSync(path.join(dossier, archive))) throw new Arret(`l'archive ${archive} existe déjà : rien n'est écrasé`);
  fs.renameSync(f, path.join(dossier, archive));
  return { ancien: c, archive };
}

/**
 * Applique le relèvement déclaré du lot (RELEVEMENTS_PLAFOND) au compteur présent, une seule fois :
 * seulement si le compteur est de ce lot, au plafond « ancien », sans trace, avec des utilisés valides.
 * Les utilisés sont gardés tels quels. Renvoie le compteur relevé, sinon null (rien n'est écrit).
 */
function releverPlafond(dossier, type, lot) {
  const d = definitionCompteur(type, lot);
  const r = (RELEVEMENTS_PLAFOND[type] || {})[lot];
  const f = path.join(dossier, d.fichier);
  if (!r || !fs.existsSync(f)) return null;
  const c = lireJsonCompteur(f, type);
  const relevable = c && c.lot === lot && c.plafond === r.ancien && c.historique_plafond === undefined
    && Number.isInteger(c.utilises) && c.utilises >= 0 && c.utilises <= r.ancien;
  if (!relevable) return null;
  const suivant = { ...c, plafond: r.nouveau, historique_plafond: traceRelevement(type, lot) };
  ecrireCompteur(dossier, type, suivant);
  return suivant;
}

/** Refuse une exécution qui dépasserait le plafond (celui du lot, ou un plafond demandé plus bas). */
function verifierBudget(dossier, type, lot, prevus, plafondDemande = Infinity) {
  const c = lireCompteur(dossier, type, lot);
  const limite = Math.min(c.plafond, plafondDemande);
  if (c.utilises + prevus > limite) {
    throw new Refus(`plafond : ${c.utilises} ${COMPTEURS[type].unite} déjà utilisé(s), ${prevus} prévu(s), limite de ${limite} pour le lot ${lot}`);
  }
  return c;
}

/** Réserve un lancement : le compteur est incrémenté AVANT le lancement, et un lancement tué compte. */
function reserver(dossier, type, lot) {
  const c = lireCompteur(dossier, type, lot);
  if (c.utilises >= c.plafond) throw new Arret(`plafond de ${c.plafond} ${COMPTEURS[type].unite} atteint pour le lot ${lot}`);
  const suivant = { ...c, utilises: c.utilises + 1 };
  ecrireCompteur(dossier, type, suivant);
  return suivant.utilises;
}

/** Note une série rejetée dans le compteur du modèle ; renvoie le nombre de séries rejetées du lot. */
function noterSerieRejetee(dossier) {
  const c = lireCompteur(dossier, 'modele', LOT_PAYANT);
  const suivant = { ...c, series_rejetees: c.series_rejetees + 1 };
  ecrireCompteur(dossier, 'modele', suivant);
  return suivant.series_rejetees;
}

// --- SONDE.md -------------------------------------------------------------------------------------

/** Empreinte SHA-256 du texte exact de chaque invite de SONDE.md. Toute autre invite est refusée. */
const EMPREINTES_INVITES = {
  'usage-ok': '358aeceee4042c3e6ac7fb2316fb295dc5ea72cc945e0d8e245839e711abe5da',
  enveloppes: '628decf1c4e113cd15d872d86d0d6d3492ed323409ee4ba3a29212b7503b1e1a',
  'inventaire-canaris': '74e59bd09757462aaa459f47eedc64271fadb58852cafe6dbca6578b2e27555d',
  'd-read': '0ba9ab78ffc8d81fc2f9f26a1b8140dfa73845a381fe7d1fd2b52cc19ff102de',
  'd-write': 'b8653700d4eaf08b1e6fd85e670880014a998bec5074cd6f08455726fc8fffa1',
  'd-edit': '8ef65e425e1c6a8a66b62aee48c9e6c5c086479f26c135467a7ab5ba95ac28b7',
  'd-glob': 'b499b2965cd4d73244342373e70f46d0314d16c52fa69bdf11ef7f6829e6c7ba',
  'd-grep': '326d6f9ec53ab43ee6c7954931a9904fefc7d1c1655d679ef1cf7d738ceafa5b',
  'd-cat': 'e56f2fcac3b931e369efa69ae5eeb5b672b103e2dc5abc41d5adf97a7453ad40',
  'd-read-sous': 'de5563ff3ee944976cef284a8a88976bdda97461e430f7f4cea5d60a927a8831',
  'd-read-temoin': '88d4e2979a04c6f18307a0cb2e7400baba7cd3a4f1ca99684f6b2418b78addbc',
  'h14-panneau': '717b469aa6abfdd689882923c09935e14e3d74b18b375aa077f34da81a07a453',
};
/** Invites que le lanceur n'envoie jamais (tapées à la main). */
const INVITES_MANUELLES = new Set(['h14-panneau']);

const sha256 = (texte) => crypto.createHash('sha256').update(String(texte), 'utf8').digest('hex');

/**
 * Lit SONDE.md : chaque section « ### <id> » porte exactement un bloc ```text```. Renvoie une Map
 * id → texte (sans le saut de ligne final). Lève une erreur sur une structure invalide.
 */
function lireSonde(texte) {
  const lignes = String(texte).replace(/\r\n?/g, '\n').split('\n');
  const invites = new Map();
  const sections = [];
  let id = null;
  let blocs = 0;
  let tampon = null;
  for (const l of lignes) {
    if (tampon !== null) {
      if (l === '```') {
        invites.set(id, tampon.join('\n'));
        tampon = null;
      } else tampon.push(l);
      continue;
    }
    const titre = /^### (.*)$/.exec(l);
    if (titre) {
      id = titre[1].trim();
      if (!/^[a-z0-9-]+$/.test(id)) throw new Refus(`SONDE.md : identifiant invalide (${id})`);
      if (sections.includes(id)) throw new Refus(`SONDE.md : ${id} figure deux fois`);
      sections.push(id);
      blocs = 0;
    } else if (l === '```text') {
      if (id === null) throw new Refus('SONDE.md : bloc text hors de toute section');
      if (++blocs > 1) throw new Refus(`SONDE.md : ${id} a plus d'un bloc text`);
      tampon = [];
    }
  }
  if (tampon !== null) throw new Refus(`SONDE.md : bloc de ${id} non fermé`);
  const sansBloc = sections.filter((s) => !invites.has(s));
  if (sansBloc.length > 0) throw new Refus(`SONDE.md : section sans bloc text (${sansBloc.join(', ')})`);
  return invites;
}

/**
 * Vérifie les invites de SONDE.md contre EMPREINTES_INVITES : mêmes identifiants, mêmes empreintes,
 * textes distincts, une seule ligne, aucun guillemet double. Renvoie la Map id → texte.
 */
function verifierInvites(texteSonde, empreintes = EMPREINTES_INVITES) {
  const invites = lireSonde(texteSonde);
  const problemes = [];
  for (const id of Object.keys(empreintes)) {
    if (!invites.has(id)) problemes.push(`${id} : absente de SONDE.md`);
    else if (sha256(invites.get(id)) !== empreintes[id]) problemes.push(`${id} : empreinte différente de EMPREINTES_INVITES`);
  }
  for (const [id, texte] of invites) {
    if (!Object.prototype.hasOwnProperty.call(empreintes, id)) problemes.push(`${id} : invite inconnue de EMPREINTES_INVITES`);
    if (/[\r\n"]/.test(texte) || texte.trim() !== texte || texte === '') problemes.push(`${id} : une seule ligne, sans guillemet double ni espace de bord`);
  }
  const textes = [...invites.values()];
  if (new Set(textes).size !== textes.length) problemes.push('deux invites ont le même texte');
  if (problemes.length > 0) throw new Refus(`invites refusées : ${problemes.join(' ; ')}`);
  return invites;
}

/** La table texte → identifiant des invites que le lanceur peut envoyer (sans les invites manuelles). */
const invitesEnvoyables = (invites) => new Map([...invites].filter(([id]) => !INVITES_MANUELLES.has(id)).map(([id, t]) => [t, id]));

// --- Plan des séries ------------------------------------------------------------------------------

const D_TOUS = 'Read,Write,Edit,Glob,Grep,Bash';
/** Jeux d'outils permis pour un appel de déclencheur : un seul outil, sauf Edit (Read et Edit). */
const OUTILS_DECLENCHEURS = new Set(['Read', 'Write', 'Read,Edit', 'Glob', 'Grep', 'Bash']);
const AUTORISATIONS = { edit: 'Edit(./**)', cat: 'Bash(cat *)' };
/** Réglage des déclencheurs, écrit dans un fichier de l'espace et passé par --settings (jamais en JSON dans l'argv). */
const REGLAGES_DECLENCHEURS = `${JSON.stringify({ permissions: { blockReadsOutsideWorkingDirectories: true } }, null, 2)}\n`;
const CHEMIN_REGLAGES = ['sonde', 'reglages-declencheurs.json'];

/** Les cinq séries de la variante complète (conception, section 9 ; décisions du lot I3). */
const SERIES = [
  {
    numero: 1, titre: 'usage : mémoire, règles, hooks, MCP, H15', mode: 'usage', outils: '',
    appels: [
      { id: 'U0a', jeux: [], base: 'debut' },
      { id: 'U1', jeux: ['cout-f-projet'] },
      { id: 'U2', jeux: ['cout-f-projet', 'cout-f-parent'] },
      { id: 'U3', jeux: ['cout-f-projet', 'cout-f-parent', 'cout-f-projet-claude'] },
      { id: 'U-global', jeux: ['cout-f-global'] },
      { id: 'U4', jeux: ['cout-f2-projet'] },
      { id: 'U5', jeux: ['cout-f-projet', 'cout-regle-court'] },
      { id: 'U6', jeux: ['cout-f-projet', 'cout-regle-court', 'cout-regle-long'] },
      { id: 'U7', jeux: ['cout-f-projet', 'cout-regle-paths'] },
      { id: 'H1', jeux: ['hook-sortie'], hookEvents: true },
      { id: 'H2', jeux: ['hook-muet'], hookEvents: true },
      { id: 'M1', jeux: ['cout-mcp-a1'] },
      { id: 'M2', jeux: ['cout-mcp-a2'] },
      { id: 'M3', jeux: ['cout-mcp-b1'] },
      { id: 'H15-en', jeux: ['cout-h15-anglais'] },
      { id: 'H15-code', jeux: ['cout-h15-code'] },
      { id: 'U0b', jeux: [], base: 'fin' },
    ],
  },
  {
    numero: 2, titre: 'usage : skills', mode: 'usage', outils: 'Skill',
    appels: [
      { id: 'S0a', jeux: [], base: 'debut' },
      { id: 'S1', jeux: ['cout-skill-projet'] },
      { id: 'S2', jeux: ['cout-skill-projet', 'cout-skill-global'] },
      { id: 'S3', jeux: ['cout-skill-x2'] },
      { id: 'S-long', jeux: ['skill-long-1500'] },
      { id: 'S0b', jeux: [], base: 'fin' },
    ],
  },
  {
    numero: 3, titre: 'usage : MCP différé', mode: 'usage', outils: 'ToolSearch',
    appels: [
      { id: 'T0a', jeux: [], base: 'debut' },
      { id: 'T1', jeux: ['cout-mcp-a1'] },
      { id: 'T-long', jeux: ['mcp-long'] },
      { id: 'T0b', jeux: [], base: 'fin' },
    ],
  },
  {
    numero: 4, titre: 'canaris de contenu et enveloppes', mode: 'canaris',
    bornes: [{ cle: 'vide', outils: '' }, { cle: 'skill', outils: 'Skill' }],
    appels: [
      { id: '4a', invite: 'enveloppes', jeux: ['niveaux', 'skills', 'hook-sortie', 'mcp-canari'], outils: 'Skill', hookEvents: true },
      { id: '4b', invite: 'inventaire-canaris', jeux: ['niveaux', 'mcp-canari', 'mcp-long'], outils: '' },
      { id: '4c', invite: 'inventaire-canaris', jeux: ['skills', 'declencheurs'], outils: 'Skill' },
    ],
  },
  {
    numero: 5, titre: 'déclencheurs, un outil par appel', mode: 'declencheurs',
    bornes: [{ cle: 'declencheurs', outils: D_TOUS, declencheur: true }],
    appels: [
      { id: 'ER', invite: 'd-read', outils: 'Read', cibles: { Read: ['src/a.ts'] } },
      { id: 'EW', invite: 'd-write', outils: 'Write', autorisation: 'edit', cibles: { Write: ['src/c.ts'] }, effet: { type: 'cree', chemin: 'src/c.ts', contenu: 'export const c = 3;' } },
      { id: 'EE', invite: 'd-edit', outils: 'Read,Edit', autorisation: 'edit', cibles: { Read: ['src/a.ts'], Edit: ['src/a.ts'] }, effet: { type: 'modifie', chemin: 'src/a.ts', contenu: 'export const a = 2;' } },
      { id: 'EG', invite: 'd-glob', outils: 'Glob', cibles: { Glob: ['.', 'src'] } },
      { id: 'EGr', invite: 'd-grep', outils: 'Grep', cibles: { Grep: ['.', 'src'] } },
      { id: 'EB', invite: 'd-cat', outils: 'Bash', autorisation: 'cat', cibles: { Bash: ['src/a.ts'] } },
      { id: 'ER-sous', invite: 'd-read-sous', outils: 'Read', cibles: { Read: ['sous/note.txt'] } },
      { id: 'temoin', invite: 'd-read-temoin', outils: 'Read', cibles: { Read: ['b.txt'] } },
    ],
  },
];

/**
 * Le plan d'exécution, dans l'ordre : chaque étape est un /context (gratuit) ou un appel au modèle.
 * Séries 1 à 3 : un /context avec les mêmes fixtures et options juste avant chaque appel (protocole 4).
 * Séries 4 et 5 : des /context de bornes au début et à la fin, avec les options de la série.
 */
function planPayant(numeros = null) {
  const series = numeros ? SERIES.filter((s) => numeros.includes(s.numero)) : SERIES;
  const etapes = [];
  for (const s of series) {
    const bornes = (moment) => (s.bornes || []).map((b) => ({
      type: 'context', serie: s.numero, mode: s.mode, id: `ctx:${moment}-${b.cle}`, borne: moment, cle: b.cle,
      jeux: [], outils: b.outils, hookEvents: false, declencheur: Boolean(b.declencheur), toursMax: b.declencheur ? 3 : 1, autorisation: null,
    }));
    etapes.push(...bornes('debut'));
    for (const a of s.appels) {
      const declencheur = s.mode === 'declencheurs';
      const base = {
        serie: s.numero, mode: s.mode, jeux: a.jeux ?? (declencheur ? ['declencheurs'] : []), outils: a.outils ?? s.outils,
        hookEvents: Boolean(a.hookEvents), declencheur, toursMax: declencheur ? 3 : 1,
        autorisation: a.autorisation ? AUTORISATIONS[a.autorisation] : null,
      };
      if (s.mode === 'usage') etapes.push({ type: 'context', id: `ctx:${a.id}`, appel: a.id, ...base });
      etapes.push({
        type: 'modele', id: a.id, invite: a.invite ?? 'usage-ok', base: a.base ?? null, toursMin: declencheur ? 2 : 1,
        cibles: a.cibles ?? {}, effet: a.effet ?? null, ...base,
      });
    }
    etapes.push(...bornes('fin'));
  }
  return etapes;
}

const compterPlan = (etapes) => ({
  modele: etapes.filter((e) => e.type === 'modele').length,
  context: etapes.filter((e) => e.type === 'context').length,
  parSerie: Object.fromEntries([...new Set(etapes.map((e) => e.serie))].map((n) => [n, etapes.filter((e) => e.serie === n && e.type === 'modele').length])),
});

/** Les options de la partie payante : refus avant tout autre geste. */
function lireOptionsPayant(args) {
  const o = { confirmer: false, aSec: false, resultats: false, plafond: null, series: null };
  const vus = new Set();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (vus.has(a)) throw new Refus(`option répétée : ${a}`);
    vus.add(a);
    if (a === '--confirmer') o.confirmer = true;
    else if (a === '--a-sec') o.aSec = true;
    else if (a === '--resultats') o.resultats = true;
    else if (a === '--plafond') {
      const v = args[++i];
      if (typeof v !== 'string' || !/^\d+$/.test(v)) throw new Refus('--plafond attend un nombre entier');
      o.plafond = Number(v);
    } else if (a === '--series') {
      const v = args[++i];
      if (typeof v !== 'string' || !/^[1-5](,[1-5])*$/.test(v)) throw new Refus('--series attend une liste comme 1,3 (séries 1 à 5)');
      o.series = [...new Set(v.split(',').map(Number))].sort();
    } else throw new Refus(`option inconnue : ${a}`);
  }
  if (o.aSec && (o.confirmer || o.resultats)) throw new Refus('--a-sec ne lance rien : il refuse --confirmer et --resultats');
  if (!o.aSec) {
    if (!o.confirmer) throw new Refus('la partie payante refuse de partir sans --confirmer (essayer d\'abord --a-sec)');
    if (o.plafond === null) throw new Refus('--plafond <n> est obligatoire (40 au plus)');
  }
  if (o.plafond !== null && (o.plafond < 1 || o.plafond > PLAFOND_MODELE)) throw new Refus(`plafond refusé : ${o.plafond} (de 1 à ${PLAFOND_MODELE})`);
  return o;
}

// --- Flux, usage et contrôles ---------------------------------------------------------------------

/** Lit le stream-json : tous les objets, l'initialisation et le dernier résultat. */
function lireFluxPayant(texte) {
  const objets = [];
  let illisibles = 0;
  for (const ligne of String(texte).split(/\r?\n/)) {
    const l = ligne.trim();
    if (!l) continue;
    try {
      objets.push(JSON.parse(l));
    } catch {
      illisibles++;
    }
  }
  const results = objets.filter((o) => o && o.type === 'result');
  return {
    objets,
    init: objets.find((o) => o && o.type === 'system' && o.subtype === 'init') ?? null,
    result: results.length > 0 ? results[results.length - 1] : null,
    nombreResults: results.length,
    illisibles,
  };
}

const CHAMPS_ENTREE = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
/** Les tokens d'entrée (trois compteurs) ; null si l'un manque. */
const entreeUsage = (u) => (u && typeof u === 'object' && CHAMPS_ENTREE.every((k) => Number.isFinite(u[k])) ? CHAMPS_ENTREE.reduce((s, k) => s + u[k], 0) : null);
const sortieUsage = (u) => (u && Number.isFinite(u.output_tokens) ? u.output_tokens : null);
const somme4Usage = (u) => (entreeUsage(u) !== null && sortieUsage(u) !== null ? entreeUsage(u) + sortieUsage(u) : null);
const resumeUsage = (u) => ({ entree: entreeUsage(u), sortie: sortieUsage(u), somme4: somme4Usage(u) });

/**
 * L'usage d'un appel : le total du résultat, et un relevé par tour (une requête d'API = un
 * message.id distinct ; les événements d'un même message sont dédoublonnés, le dernier l'emporte).
 */
function lireUsage(flux) {
  const tours = new Map();
  for (const o of flux.objets || []) {
    if (o && o.type === 'assistant' && o.message && typeof o.message.id === 'string') tours.set(o.message.id, o.message.usage ?? null);
  }
  const parTour = [...tours.values()].map(resumeUsage);
  parTour.forEach((t, i) => {
    t.delta_entree = i === 0 || t.entree === null || parTour[i - 1].entree === null ? null : t.entree - parTour[i - 1].entree;
  });
  const r = flux.result || {};
  return {
    total: resumeUsage(r.usage),
    par_tour: parTour,
    num_turns: Number.isInteger(r.num_turns) ? r.num_turns : null,
    cout_liste_usd: typeof r.total_cost_usd === 'number' ? r.total_cost_usd : null,
    modeles: r.modelUsage && typeof r.modelUsage === 'object' ? Object.keys(r.modelUsage).sort() : [],
  };
}

/**
 * La garde de flux d'un appel au modèle, appliquée à chaque objet du stream-json pendant l'appel.
 * Renvoie null, ou { gravite: 'arret' | 'rejet', raison } : le lanceur tue alors l'arbre de processus.
 * Les raisons ne recopient jamais une valeur venue du flux (chemins, commandes).
 */
function creerGardeFlux(etape, { modele, projet, plateforme = process.platform }) {
  const p = commun.modChemin(plateforme);
  const ids = new Set();
  const permis = new Set(etape.outils ? etape.outils.split(',') : []);
  const cibleOk = (outil, valeur, absentPermis) => {
    if (valeur === undefined || valeur === null || valeur === '') return absentPermis;
    if (typeof valeur !== 'string') return false;
    const abs = p.resolve(projet, valeur);
    return ((etape.cibles && etape.cibles[outil]) || []).some((c) => commun.memeChemin(abs, p.resolve(projet, c), plateforme));
  };
  const verifierOutil = (b) => {
    if (!etape.declencheur) return `outil ${b.name} appelé alors qu'aucun outil n'est prévu`;
    if (!permis.has(b.name)) return `outil ${b.name} non prévu pour ${etape.id}`;
    const input = b.input && typeof b.input === 'object' ? b.input : {};
    if (['Read', 'Write', 'Edit'].includes(b.name)) return cibleOk(b.name, input.file_path, false) ? null : `${b.name} hors de la cible prévue`;
    if (['Glob', 'Grep'].includes(b.name)) return cibleOk(b.name, input.path, true) ? null : `${b.name} hors du dossier prévu`;
    if (b.name === 'Bash') {
      const m = /^cat\s+(['"]?)([^\s'"`;&|<>$()]+)\1$/.exec(String(input.command ?? '').trim());
      return m && cibleOk('Bash', m[2], false) ? null : 'commande Bash autre que cat de la cible prévue';
    }
    return `outil ${b.name} non contrôlé`;
  };
  return (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.type === 'system' && obj.subtype === 'init') {
      if (obj.apiKeySource !== 'none') return { gravite: 'arret', raison: `apiKeySource=${String(obj.apiKeySource)} dans l'initialisation (none attendu)` };
      if (obj.model !== modele) return { gravite: 'rejet', raison: `modèle différent de ${modele} dans l'initialisation` };
      if (etape.declencheur && obj.permissionMode !== 'dontAsk') return { gravite: 'rejet', raison: 'mode d\'autorisation différent de dontAsk' };
      return null;
    }
    if (obj.type === 'assistant' && obj.message) {
      if (typeof obj.message.id === 'string') ids.add(obj.message.id);
      if (ids.size > etape.toursMax) return { gravite: 'rejet', raison: `${ids.size} tours (au plus ${etape.toursMax})` };
      for (const b of Array.isArray(obj.message.content) ? obj.message.content : []) {
        if (!b || b.type !== 'tool_use') continue;
        const raison = verifierOutil(b);
        if (raison) return { gravite: 'rejet', raison };
      }
    }
    return null;
  };
}

/**
 * Contrôles après un appel au modèle. `arret` : l'appel ne passait pas par l'abonnement, ou son usage
 * est invérifiable. `total_cost_usd` est relevé sans être un critère (costBasis « list », phase 1).
 */
function controlerAppelPayant(flux, usage, etape, { versionAttendue } = {}) {
  const arret = [];
  const autres = [];
  if (!flux.init) arret.push("message d'initialisation absent : apiKeySource invérifiable");
  else if (flux.init.apiKeySource !== 'none') arret.push(`apiKeySource=${String(flux.init.apiKeySource)} (none attendu)`);
  if (!flux.result) arret.push('résultat absent : usage invérifiable');
  else {
    if (flux.nombreResults !== 1) autres.push(`${flux.nombreResults} résultats (un seul attendu)`);
    const n = usage.num_turns;
    if (n === null || n < etape.toursMin || n > etape.toursMax) autres.push(`num_turns=${String(n)} (de ${etape.toursMin} à ${etape.toursMax} attendu)`);
    if (flux.result.is_error || flux.result.subtype !== 'success') autres.push(`résultat en erreur (${String(flux.result.subtype)})`);
    if (usage.total.entree === null) autres.push('usage illisible');
  }
  if (versionAttendue && flux.init && flux.init.claude_code_version !== versionAttendue) autres.push('version différente de celle notée avant la série');
  return { arret, autres, ok: arret.length === 0 && autres.length === 0 };
}

/** Le premier objet JSON d'une réponse (bloc de code toléré), ou null. */
function extraireJson(texte) {
  if (typeof texte !== 'string') return null;
  const t = texte.replace(/```(?:json)?/gi, '');
  const debut = t.indexOf('{');
  const fin = t.lastIndexOf('}');
  if (debut < 0 || fin <= debut) return null;
  try {
    const v = JSON.parse(t.slice(debut, fin + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Lit la réponse : seuls les canaris de l'inventaire sont recopiés ; les autres chaînes sont
 * seulement comptées. Les enveloppes (4a) ne sont gardées que par leur nombre et leur empreinte :
 * leur texte reste dans brut/.
 */
function lireReponse(texte, etape, canarisConnus) {
  const json = extraireJson(texte);
  if (!json) return { lisible: false };
  const filtrer = (liste) => {
    const l = Array.isArray(liste) ? liste.filter((x) => typeof x === 'string') : [];
    return { canaris: [...new Set(l.filter((x) => canarisConnus.has(x)))], autres: l.filter((x) => !canarisConnus.has(x)).length };
  };
  if (etape.invite === 'usage-ok') return { lisible: true, ok: json.ok === true };
  if (etape.declencheur) {
    const avant = filtrer(json.avant_outil);
    const apres = filtrer(json.apres_outil);
    return { lisible: Array.isArray(json.avant_outil) && Array.isArray(json.apres_outil), avant_outil: avant.canaris, apres_outil: apres.canaris, chaines_inconnues: avant.autres + apres.autres };
  }
  if (etape.invite === 'enveloppes') {
    const items = Array.isArray(json.canaris) ? json.canaris : [];
    const chaines = filtrer(items.map((i) => (i && typeof i === 'object' ? i.chaine : null)));
    return { lisible: Array.isArray(json.canaris), canaris: chaines.canaris, chaines_inconnues: chaines.autres, enveloppes: { nombre: items.length, empreinte: sha256(JSON.stringify(items)) } };
  }
  const c = filtrer(json.canaris);
  return { lisible: Array.isArray(json.canaris), canaris: c.canaris, chaines_inconnues: c.autres };
}

/** Les outils effectivement appelés (noms seulement), dans l'ordre. */
const outilsAppeles = (flux) => (flux.objets || [])
  .filter((o) => o && o.type === 'assistant' && o.message && Array.isArray(o.message.content))
  .flatMap((o) => o.message.content.filter((b) => b && b.type === 'tool_use').map((b) => b.name));

// --- Décomposition --------------------------------------------------------------------------------

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);
/** Calcule fn(...valeurs) si toutes les valeurs sont des nombres, sinon null. */
const calc = (fn, ...v) => (v.every(estNombre) ? fn(...v) : null);
const arrondi = (x, n = 4) => (estNombre(x) ? Math.round(x * 10 ** n) / 10 ** n : null);

/** o200k d'un texte (gpt-tokenizer, déjà une dépendance) ; null si le tokenizer est indisponible. */
function o200k(texte) {
  try {
    // eslint-disable-next-line global-require
    return require('gpt-tokenizer').encode(String(texte)).length;
  } catch {
    return null;
  }
}

/** La ligne d'un skill telle que la liste la présente (« - nom: description »), d'après son frontmatter. */
function ligneSkill(texte) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(String(texte).replace(/\r\n?/g, '\n'));
  if (!fm) return null;
  const champ = (nom) => (new RegExp(`^${nom}:\\s*(.*)$`, 'm').exec(fm[1]) || [])[1];
  const nom = champ('name');
  const description = champ('description');
  return nom && description ? `- ${nom}: ${description}` : null;
}

/** Les éléments de /context utilisés par la décomposition, lus dans les combinaisons normalisées. */
function elementsContext(combinaisons) {
  const parId = new Map((combinaisons || []).map((c) => [c.id, c]));
  const memoire = (id, chemin) => {
    const f = ((parId.get(id) || {}).memory_files || []).find((m) => m.chemin.toLowerCase() === chemin.toLowerCase());
    return f ? f.tokens : null;
  };
  const skill = (id, nom) => {
    const s = ((parId.get(id) || {}).skills || []).find((x) => x.name === nom);
    return s ? s.tokens : null;
  };
  const total = (id) => {
    const c = parId.get(id);
    return c && estNombre(c.total) ? c.total : null;
  };
  return {
    total,
    el: {
      F: memoire('ctx:U1', '<projet>/CLAUDE.md'),
      F2: memoire('ctx:U4', '<projet>/CLAUDE.md'),
      parent: memoire('ctx:U2', '<parent>/CLAUDE.md'),
      projet_claude: memoire('ctx:U3', '<projet>/.claude/CLAUDE.md'),
      global: memoire('ctx:U-global', '<global>/CLAUDE.md'),
      regle_court: memoire('ctx:U5', '<projet>/.claude/rules/r.md'),
      anglais: memoire('ctx:H15-en', '<projet>/CLAUDE.md'),
      code: memoire('ctx:H15-code', '<projet>/CLAUDE.md'),
      S1: skill('ctx:S1', 'canari-s1'),
      S2: skill('ctx:S2', 'canari-s2'),
      S3: skill('ctx:S3', 'canari-s1'),
      Slong: skill('ctx:S-long', 'canari-long'),
    },
  };
}

/** Longueurs (en caractères) des chemins absolus des fichiers de mesure : des nombres seulement. */
function longueursChemins(rels, { configDir, espace, fixturesDir }) {
  const dest = (jeu, fin) => {
    const e = commun.planDeploiement(rels, [jeu], { configDir, espace, fixturesDir }).find((x) => x.chemin.endsWith(fin));
    return e ? e.destination.length : null;
  };
  return {
    projet: dest('cout-f-projet', 'CLAUDE.md'),
    parent: dest('cout-f-parent', 'CLAUDE.md'),
    projet_claude: dest('cout-f-projet-claude', 'CLAUDE.md'),
    global: dest('cout-f-global', 'CLAUDE.md'),
    regle_court: dest('cout-regle-court', '.md'),
    regle_long: dest('cout-regle-long', '.md'),
  };
}

/** Les comptes o200k des contenus de mesure (H15 et constantes), d'après les fixtures. */
function o200kMesures(lire) {
  const t = (rel) => {
    try {
      return lire(rel);
    } catch {
      return null;
    }
  };
  const compter = (texte) => (texte === null ? null : o200k(texte.replace(/\r\n?/g, '\n')));
  const instructions = (rel) => {
    const texte = t(rel);
    try {
      return texte === null ? null : o200k(JSON.parse(texte).instructions ?? '');
    } catch {
      return null;
    }
  };
  const skill = (rel) => {
    const texte = t(rel);
    const l = texte === null ? null : ligneSkill(texte);
    return l === null ? null : o200k(l);
  };
  return {
    F: compter(t('cout-f-projet/projet/CLAUDE.md.fixture')),
    F2: compter(t('cout-f2-projet/projet/CLAUDE.md.fixture')),
    anglais: compter(t('cout-h15-anglais/projet/CLAUDE.md.fixture')),
    code: compter(t('cout-h15-code/projet/CLAUDE.md.fixture')),
    skill_s1: skill('cout-skill-projet/projet/_claude/skills/canari-s1/SKILL.md.fixture'),
    skill_x2: skill('cout-skill-x2/projet/_claude/skills/canari-s1/SKILL.md.fixture'),
    instructions_a1: instructions('cout-mcp-a1/mcp/serveur.json.fixture'),
    instructions_a2: instructions('cout-mcp-a2/mcp/serveur.json.fixture'),
  };
}

/**
 * La décomposition des coûts (sections 3 et 4), sur l'entrée de chaque appel.
 *   U : appel → tokens d'entrée ; ctx : appel → total de son /context ; el : éléments de /context ;
 *   L : longueurs des chemins ; o : comptes o200k. Une valeur dont une mesure manque vaut null.
 */
function decomposer({ U = {}, ctx = {}, el = {}, L = {}, o = {} }) {
  const d = (a, b) => calc((x, y) => x - y, a, b);
  const U0 = U.U0a;
  const S0 = U.S0a;
  const T0 = U.T0a;
  const enveloppe = (id, base, baseCtx) => calc((u, ub, c, cb) => (u - ub) - (c - cb), U[id], U[base], ctx[id], ctx[baseCtx]);

  // Mémoire : F en Pr (U1), + Pa (U2), + Pr/.claude (U3), F′ = 2F (U4), global seul (U-global).
  const C = d(U.U4, U.U1);
  const eParent = d(U.U2, U.U1);
  const eProjetClaude = d(U.U3, U.U2);
  const hParent = d(eParent, C);
  const hProjetClaude = d(eProjetClaude, C);
  const pente = calc((a, b, la, lb) => (lb === la ? null : (b - a) / (lb - la)), hParent, hProjetClaude, L.parent, L.projet_claude);
  const h0Projet = calc((h, p, l) => h - p * l, hParent, pente, L.parent);
  const hProjet = calc((h0, p, l) => h0 + p * l, h0Projet, pente, L.projet);
  const preambule = calc((u1, u0, c, h) => (u1 - u0) - c - h, U.U1, U0, C, hProjet);
  const hGlobal = calc((ug, u0, p, c) => (ug - u0) - p - c, U['U-global'], U0, preambule, C);
  const h0User = calc((h, p, l) => h - p * l, hGlobal, pente, L.global);
  const E1 = enveloppe('U1', 'U0a', 'U0a');
  const E4 = enveloppe('U4', 'U0a', 'U0a');
  const memoire = {
    contenu_F: C,
    element_projet: d(U.U1, U0),
    element_parent: eParent,
    element_projet_claude: eProjetClaude,
    element_global: d(U['U-global'], U0),
    entete_parent: hParent,
    entete_projet_claude: hProjetClaude,
    entete_par_caractere_de_chemin: arrondi(pente),
    entete_fixe_project: arrondi(h0Projet, 2),
    entete_projet: arrondi(hProjet, 2),
    preambule: arrondi(preambule, 2),
    entete_global_user: arrondi(hGlobal, 2),
    entete_fixe_user: arrondi(h0User, 2),
    constante_context: calc((f, f2) => 2 * f - f2, el.F, el.F2),
    contenu_context: d(el.F2, el.F),
    ecart_contenu_usage_context: calc((c, f, f2) => c - (f2 - f), C, el.F, el.F2),
    enveloppe_hors_context: { U1: E1, U4: E4, parent: d(eParent, el.parent), projet_claude: d(eProjetClaude, el.projet_claude) },
    context_valide: calc((a, b) => Math.abs(b - a) <= 2, E1, E4),
  };

  // Règles : une règle courte (U5), la même sous un nom long (U6), une règle paths (U7, Δ = 0 attendu).
  const eCourt = d(U.U5, U.U1);
  const eLong = d(U.U6, U.U5);
  const regles = {
    element_court: eCourt,
    element_long: eLong,
    enveloppe_hors_context_court: d(eCourt, el.regle_court),
    entete_par_caractere_de_chemin: arrondi(calc((a, b, la, lb) => (lb === la ? null : (b - a) / (lb - la)), eCourt, eLong, L.regle_court, L.regle_long)),
    regle_paths: d(U.U7, U.U1),
    regle_paths_nulle: calc((x) => x === 0, d(U.U7, U.U1)),
  };

  // Skills : une ligne (S1), la même dans le profil (S2), une description double (S3), une longue.
  const ligne = d(U.S1, S0);
  const ligneGlobal = d(U.S2, U.S1);
  const E1s = enveloppe('S1', 'S0a', 'S0a');
  const E3s = enveloppe('S3', 'S0a', 'S0a');
  const skills = {
    ligne,
    ligne_global: ligneGlobal,
    chemin_compte: calc((a, b) => a !== b, ligne, ligneGlobal),
    contenu_description: d(U.S3, U.S1),
    contenu_context: d(el.S3, el.S1),
    constante_context: calc((s1, s3) => 2 * s1 - s3, el.S1, el.S3),
    constante_usage: calc((l, l3) => 2 * l - l3, ligne, d(U.S3, S0)),
    enveloppe_hors_context: { S1: E1s, S3: E3s, long: enveloppe('S-long', 'S0a', 'S0a') },
    description_longue: d(U['S-long'], S0),
    context_valide: calc((a, b) => Math.abs(b - a) <= 2, E1s, E3s),
  };

  // MCP : serveur A (instructions I), A′ (2I), B (sans instructions) ; différé (ToolSearch).
  const instructions = d(U.M1, U.M3);
  const instructions2 = d(U.M2, U.M3);
  const mcp = {
    serveur_a: d(U.M1, U0),
    serveur_a2: d(U.M2, U0),
    serveur_b_sans_instructions: d(U.M3, U0),
    instructions,
    instructions_doubles: instructions2,
    constante_instructions: calc((a, b) => 2 * a - b, instructions, instructions2),
    differe_serveur_a: d(U.T1, T0),
    differe_textes_longs: d(U['T-long'], T0),
  };

  const hooks = { sortie: d(U.H1, U0), muet: d(U.H2, U0), muet_nul: calc((x) => x === 0, d(U.H2, U0)) };

  // H15 : coût réel d'un contenu de CLAUDE.md en Pr, rapporté à son o200k.
  const contenu = (id) => calc((u, u0, p, h) => (u - u0) - p - h, U[id], U0, preambule, hProjet);
  const h15 = {
    r_usage: {
      francais: arrondi(calc((c, x) => (x === 0 ? null : c / x), C, o.F)),
      anglais: arrondi(calc((c, x) => (x === 0 ? null : c / x), contenu('H15-en'), o.anglais)),
      code: arrondi(calc((c, x) => (x === 0 ? null : c / x), contenu('H15-code'), o.code)),
    },
    r_context: {
      francais: arrondi(calc((c, x) => (x === 0 ? null : c / x), el.F, o.F)),
      anglais: arrondi(calc((c, x) => (x === 0 ? null : c / x), el.anglais, o.anglais)),
      code: arrondi(calc((c, x) => (x === 0 ? null : c / x), el.code, o.code)),
      skill: arrondi(calc((c, x) => (x === 0 ? null : c / x), el.S1, o.skill_s1)),
    },
  };

  const bases = {
    decalage_vide: d(U0, ctx.U0a),
    decalage_skill: d(S0, ctx.S0a),
    decalage_toolsearch: d(T0, ctx.T0a),
    vide_identiques: calc((a, b) => a === b, U.U0a, U.U0b),
    skill_identiques: calc((a, b) => a === b, U.S0a, U.S0b),
    toolsearch_identiques: calc((a, b) => a === b, U.T0a, U.T0b),
  };
  return { bases, memoire, regles, skills, mcp, hooks, h15, o200k: { ...o } };
}

// --- Préparation H14 ------------------------------------------------------------------------------

const JEUX_H14 = ['niveaux', 'skills', 'hook-sortie'];

/** Les gestes de H14, affichés par --preparer-h14 (PowerShell ordinaire). */
function gestesH14({ configDir, projet, invite, dossierBrut = 'test/scenarios/claude-code-injection-contexte/brut' }) {
  return [
    '1. Ouvre un terminal PowerShell ordinaire (pas un terminal de VS Code ni de Claude Code). Inutile de fermer tes autres fenêtres de VS Code : --user-data-dir distinct démarre une instance séparée, qui hérite des variables de ce terminal. C\'est le /status du panneau qui tranche.',
    '2. Retire les variables CLAUDE* et ANTHROPIC* de ce terminal, puis pose celles du profil isolé :',
    '   Get-ChildItem Env: | Where-Object { $_.Name -match \'^(CLAUDE|ANTHROPIC)\' } | ForEach-Object { Remove-Item "Env:$($_.Name)" }',
    `   $env:CLAUDE_CONFIG_DIR = "${configDir}"`,
    '   $env:DISABLE_AUTOUPDATER = "1"',
    '3. Lance l\'instance séparée sur le projet de l\'espace :',
    `   code --user-data-dir "$env:TEMP\\vscode-canari" "${projet}"`,
    '4. Dans le panneau Claude Code de cette instance, ferme tous les éditeurs, puis tape /status. Il tranche : le dossier de configuration doit être le profil isolé, la connexion claude.ai sur un abonnement, sans clé API. Sinon, ne tape rien d\'autre : ferme l\'instance et passe au point 8.',
    `5. Tape /context (gratuit), puis copie les sections des fichiers de mémoire et des skills dans ${dossierBrut}/h14-panneau.txt. Le skill de plugin n'y figurera pas : le panneau n'a pas de --plugin-dir, et ce jeu n'a pas de MCP.`,
    '6. Un seul appel au modèle : colle cette invite (SONDE.md, section h14-panneau), puis copie la réponse à la suite du même fichier :',
    `   ${invite}`,
    '7. Note la version de Claude Code affichée par le panneau, puis ferme cette instance.',
    '8. Retire les fixtures : node test/scenarios/scripts/sonde-claude-code.js retirer',
  ];
}

module.exports = {
  LOT_PAYANT, PLAFOND_MODELE, MAX_SERIES_REJETEES, COMPTEURS, EMPREINTES_INVITES, INVITES_MANUELLES,
  SERIES, D_TOUS, OUTILS_DECLENCHEURS, AUTORISATIONS, REGLAGES_DECLENCHEURS, CHEMIN_REGLAGES, JEUX_H14,
  RELEVEMENTS_PLAFOND, nomArchive, lireCompteur, ouvrirLot, releverPlafond, verifierBudget, reserver, noterSerieRejetee,
  sha256, lireSonde, verifierInvites, invitesEnvoyables,
  planPayant, compterPlan, lireOptionsPayant,
  lireFluxPayant, entreeUsage, lireUsage, creerGardeFlux, controlerAppelPayant, extraireJson, lireReponse, outilsAppeles,
  o200k, ligneSkill, elementsContext, longueursChemins, o200kMesures, decomposer,
  gestesH14,
};
