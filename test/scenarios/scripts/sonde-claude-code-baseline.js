/**
 * Construction d'une baseline de la suite d'injection Claude Code à partir d'un rapport « context »
 * valide (lot E1). Module pur : aucune lecture ni écriture de fichier, aucun lancement.
 *
 * Décision du 2026-11-09 : la baseline ne compare que ce qui ne dépend pas du compte :
 *   - la présence, le type (ou la source) et les tokens de chaque fixture ;
 *   - l'écart de chaque combinaison à la base de même jeu d'outils, dans la même série (delta_base).
 * Jamais les totaux absolus, ni les éléments hors fixtures (skills, plugins et outils du compte), qui
 * changent avec la synchronisation du compte et d'un poste à l'autre.
 * Anomalie A2 : les tokens des outils MCP ne sont comparés qu'en présence, et l'écart d'une combinaison
 * avec MCP est pris sans la catégorie « MCP tools ».
 * Décision du 2026-11-10 : une baseline existante ne change jamais, sauf par ajoutVersionCompatible(),
 * qui ne touche qu'à versions_compatibles, et seulement après une comparaison complète sans écart.
 * Décisions du 2026-11-10 (étape A, baseline 2.1.319) : baselineDepuisRapports() tire les entrées
 * « context » d'un rapport « context », et les entrées « usage » et « canari » des rapports « payant »
 * d'un même lot, tous valides et de la même version. L'usage n'est comparé qu'en différences à la base
 * de sa série ; les différences d'un tour à l'autre (série 5) et les valeurs de décomposition vont dans
 * une section non comparée ; les canaris sont comparés strictement (vu reste vu, non vu reste non vu).
 */
'use strict';

/** Le scénario de toute la combinaison, quand ses éléments ne sont pas rattachés un par un (null). */
const SCENARIO_COMBINAISON = {
  niveaux: null,
  'agents-seul': 'CC22',
  'agents-avec-claude': 'CC22',
  skills: null,
  'skills-sans-outil': 'CC29',
  'skill-long-1500': 'CC27',
  declencheurs: null,
  'hook-sortie': 'CC33',
  'hook-muet': 'CC34',
  'mcp-canari': 'CC30',
  'mcp-long': 'CC32',
  'cout-f-quatre-chemins': 'CC13',
  'cout-f2-projet': 'CC37',
  'cout-h15-anglais': 'CC37',
  'cout-h15-code': 'CC37',
  'cout-regles': null,
  'cout-skills': 'CC24',
  'cout-skill-x2': 'CC24',
  'cout-mcp-a1': 'CC31',
  'cout-mcp-a2': 'CC30',
  'cout-mcp-b1': 'CC30',
  'jeu-complet': null,
};

/** Le scénario de l'écart à la base, pour les combinaisons dont les éléments sont rattachés un par un. */
const SCENARIO_DELTA = { niveaux: 'CC12', skills: 'CC24', declencheurs: 'CC28', 'cout-regles': 'CC15', 'jeu-complet': 'CC35' };

/** Le scénario de chaque élément (chemin normalisé en minuscules, ou nom de skill). */
const SCENARIO_ELEMENT = {
  '<global>/claude.md': 'CC02',
  '<global>/rules/g-perm.md': 'CC15',
  '<global>/rules/g-paths.md': 'CC17',
  '<global>/projects/<memoire>/memory/memory.md': 'CC23',
  '<parent>/claude.md': 'CC05',
  '<parent>/.claude/claude.md': 'CC06',
  '<parent>/.claude/rules/par-regle.md': 'CC20',
  '<projet>/claude.md': 'CC03',
  '<projet>/.claude/claude.md': 'CC03',
  '<projet>/claude.local.md': 'CC04',
  '<projet>/import-1.md': 'CC09',
  '<projet>/import-2.md': 'CC09',
  '<projet>/import-3.md': 'CC09',
  '<projet>/import-4.md': 'CC09',
  '<projet>/import-5.md': 'CC09',
  '<projet>/.claude/rules/p-perm.md': 'CC15',
  '<projet>/.claude/rules/p-paths.md': 'CC17',
  '<projet>/.claude/rules/p-yaml-invalide.md': 'CC21',
  '<projet>/.claude/rules/sous/p-sous.md': 'CC19',
  '<projet>/.claude/rules/d-paths.md': 'CC18',
  '<projet>/sous/claude.md': 'CC08',
  '<projet>/.claude/rules/r.md': 'CC15',
  '<projet>/.claude/rules/regle-au-nom-volontairement-tres-long-pour-mesurer-le-cout-du-chemin.md': 'CC15',
  '<projet>/.claude/rules/r-paths.md': 'CC17',
  'skill canari-g1': 'CC24',
  'skill canari-p1': 'CC24',
  'skill canari-parent': 'CC24',
  'skill canari-homo': 'CC25',
  'skill canari-plugin:canari-plug': 'CC26',
  'skill canari-cache': 'CC26',
  'skill canari-long': 'CC27',
  'skill canari-paths': 'CC28',
  'mcp mcp__canari-mcp__canari_outil': 'CC30',
};

/**
 * Les observations manuelles, par version : elles vont dans les remarques, jamais dans les entrées,
 * puisque le comparateur ne peut pas les vérifier.
 */
const OBSERVATIONS_MANUELLES = {
  '2.1.318': [
    'CC07 (H16b), observation manuelle du 2026-11-09 en 2.1.318, dans une session interactive (/context, aucun appel au modèle) : le CLAUDE.md global est chargé une seule fois pour un projet situé sous le dossier personnel. Aucune entrée : le comparateur ne peut pas le vérifier.',
  ],
};

const REMARQUES_FIXES = [
  'Entrées « context » seulement (lot E1) : les entrées « usage » et « canari » viendront au lot E2.',
  'Ne sont comparés que la présence, le type (ou la source) et les tokens de chaque fixture, et l\'écart de chaque combinaison à la base de même jeu d\'outils de la même série (delta_base). Les totaux absolus et les éléments hors fixtures (skills, plugins et outils du compte) ne sont jamais comparés : ils changent avec la synchronisation du compte et d\'un poste à l\'autre.',
  'Anomalie A2 : les tokens des outils MCP sont instables et non additifs. Ils ne sont comparés qu\'en présence, et l\'écart des combinaisons avec MCP est pris sans la catégorie « MCP tools » (sans_outils_mcp).',
];

const NOM_RAPPORT_CONTEXT = /^context-(\d{4}-\d{2}-\d{2})-\d{4}\.json$/;
const JEUX_OUTILS = { vide: [], avec_skill: ['Skill'] };
const jeuOutils = (outils) => (outils === 'vide' ? 'vide' : outils === 'Skill' ? 'avec_skill' : null);
const tokensCategorie = (combo, nom) => ((combo.categories || []).find((c) => c.nom === nom) || {}).tokens || 0;

function scenarioDe(combinaison, cle) {
  if (!Object.prototype.hasOwnProperty.call(SCENARIO_COMBINAISON, combinaison)) throw new Error(`combinaison sans scénario : ${combinaison}`);
  if (SCENARIO_COMBINAISON[combinaison]) return SCENARIO_COMBINAISON[combinaison];
  const s = SCENARIO_ELEMENT[cle.toLowerCase()];
  if (!s) throw new Error(`élément sans scénario dans ${combinaison} : ${cle}`);
  return s;
}

/**
 * La baseline (section 5 de la conception) d'après un rapport « context » valide. Lève une erreur pour
 * un rapport d'un autre type, une série non valide, une version qui change, une combinaison ou un
 * élément sans scénario, ou un écart à la base absent.
 */
function baselineDepuisRapport(rapport, { source }) {
  if (!rapport || rapport.rapport !== 'claude-code-context') throw new Error('rapport « claude-code-context » attendu (les entrées usage et canari viendront au lot E2)');
  const env = verifierRapportContext(rapport, source);
  return {
    baseline: env.date_mesure,
    environnement: {
      outil: env.outil, entree: env.entree, os: env.os,
      version: env.version_avant, versions_compatibles: [env.version_avant],
      modele: env.modele, effort: env.effort, sonde: env.sonde, date_mesure: env.date_mesure,
    },
    source: { rapport: source, local: true },
    jeux_outils: JEUX_OUTILS,
    decomposition: null,
    entrees: entreesContext(rapport),
    remarques: [...REMARQUES_FIXES, ...(OBSERVATIONS_MANUELLES[env.version_avant] || [])],
  };
}

/** Vérifie un rapport « context » : série valide, version stable, nom conforme à date_mesure. */
function verifierRapportContext(rapport, source) {
  if (!rapport || rapport.rapport !== 'claude-code-context') throw new Error('rapport « claude-code-context » attendu');
  if (!rapport.serie || rapport.serie.valide !== true) throw new Error('série non valide : aucune baseline ne peut en être tirée');
  const env = rapport.environnement || {};
  if (typeof env.version_avant !== 'string' || env.version_avant !== env.version_apres) throw new Error('version absente, ou différente avant et après la série');
  const m = NOM_RAPPORT_CONTEXT.exec(String(source));
  if (!m) throw new Error('nom du rapport source refusé');
  if (m[1] !== env.date_mesure) throw new Error('la date du nom du rapport et date_mesure diffèrent');
  return env;
}

/** Les entrées « context » d'un rapport : fixtures (présence, type ou source, tokens) et écarts à la base. */
function entreesContext(rapport) {
  const entrees = [];
  const ajouter = (scenario, combinaison, cle, champs, attendu) => {
    entrees.push({ id: `${scenario}:${combinaison}:${cle}`, scenario, instrument: 'context', etape: 'E0', combinaison, ...champs, attendu, confiance: 'observe' });
  };
  for (const c of rapport.combinaisons || []) {
    for (const f of c.memory_files || []) {
      ajouter(scenarioDe(c.id, f.chemin), c.id, f.chemin, { element: f.chemin }, { present: true, type: f.type, tokens: f.tokens });
    }
    for (const s of c.skills || []) {
      ajouter(scenarioDe(c.id, `skill ${s.name}`), c.id, `skill ${s.name}`, { skill: s.name }, { present: true, source: s.source, tokens: s.tokens });
    }
    for (const t of c.mcp_tools || []) {
      ajouter(scenarioDe(c.id, `mcp ${t.name}`), c.id, `mcp ${t.name}`, { outil_mcp: t.name }, { present: true });
    }
    for (const a of c.fixtures_absentes || []) {
      const skill = a.startsWith('skill ') ? a.slice('skill '.length) : null;
      ajouter(scenarioDe(c.id, a), c.id, a, skill ? { skill } : { element: a }, { present: false });
    }
    const jeu = jeuOutils(c.outils);
    if (!jeu) throw new Error(`${c.id} : jeu d'outils inconnu`);
    if (typeof c.delta_base !== 'number') throw new Error(`${c.id} : écart à la base absent`);
    const sansMcp = Array.isArray(c.mcp) && c.mcp.length > 0;
    const delta = c.delta_base - (sansMcp ? tokensCategorie(c, 'MCP tools') : 0);
    ajouter(SCENARIO_DELTA[c.id] || scenarioDe(c.id, 'delta'), c.id, 'delta', { mesure: 'delta', jeu_outils: jeu, ...(sansMcp ? { sans_outils_mcp: true } : {}) }, { delta, tolerance: 0 });
  }
  if (entrees.length === 0) throw new Error('aucune combinaison dans le rapport');
  verifierIdsUniques(entrees);
  return entrees;
}

function verifierIdsUniques(entrees) {
  const ids = new Set();
  for (const e of entrees) {
    if (ids.has(e.id)) throw new Error(`entrée en double : ${e.id}`);
    ids.add(e.id);
  }
}

// --- Baseline tirée d'un ensemble de rapports (étape A, décisions du 2026-11-10) -------------------

const NOM_RAPPORT_PAYANT = /^payant-(\d{4}-\d{2}-\d{2})-\d{4}\.json$/;

/** Le scénario de chaque appel « usage » (différence à la base de sa série). */
const SCENARIO_APPEL = {
  U1: 'CC12', U2: 'CC05', U3: 'CC13', 'U-global': 'CC02', U4: 'CC14', U5: 'CC15', U6: 'CC15', U7: 'CC17',
  H1: 'CC33', H2: 'CC34', M1: 'CC31', M2: 'CC30', M3: 'CC30', 'H15-en': 'CC37', 'H15-code': 'CC37', U0b: 'CC01',
  S1: 'CC24', S2: 'CC24', S3: 'CC24', 'S-long': 'CC27', S0b: 'CC01',
  T1: 'CC31', 'T-long': 'CC32', T0b: 'CC01',
};

/** Le scénario de chaque canari, par son code (CANARI-CC-<code>-XXXX). Les canaris de 4a relèvent de CC35. */
const SCENARIO_CANARI = {
  AGAVEC: 'CC22', AGCLAUDE: 'CC22', AGSEUL: 'CC22',
  DPATHS: 'CC18', DSKPATHS: 'CC28', DSKCORPS: 'CC28', DSOUS: 'CC08',
  HOOK: 'CC33',
  MCPINSTR: 'CC30', MCPOUTIL: 'CC30', MCPENV: 'CC30',
  MCPLONGDEBUT: 'CC32', MCPLONGFIN: 'CC32', MCPOUTLONGDEBUT: 'CC32', MCPOUTLONGFIN: 'CC32',
  GLOB: 'CC02', MEMORY: 'CC23', GPATHS: 'CC17', GRULE: 'CC15',
  PAR: 'CC05', PARDOT: 'CC06', PARRULE: 'CC20', LOCAL: 'CC04',
  PROJFM: 'CC11', PROJ: 'CC03', COMM: 'CC10', PROJDOT: 'CC03',
  RPATHS: 'CC17', RFM: 'CC16', RULE: 'CC15', RYAML: 'CC21', RSOUS: 'CC19',
  IMP1: 'CC09', IMP2: 'CC09', IMP3: 'CC09', IMP4: 'CC09', IMP5: 'CC09',
  SKL15DEBUT: 'CC27', SKL15FIN: 'CC27',
  SKG1: 'CC24', SKCORPSG1: 'CC24', SKPAR: 'CC24', SKP1: 'CC24', SKCORPSP1: 'CC24',
  HOMOGL: 'CC25', HOMOPR: 'CC25',
  PLUGDESC: 'CC26', SKPLUG: 'CC26', SKCORPSPLUG: 'CC26', SKCACHE: 'CC26',
  SKLONGDEBUT: 'CC27', SKLONGFIN: 'CC27',
};
const CODE_CANARI = /^CANARI-CC-([A-Z0-9]+)-[A-Z0-9]{4}$/;
const APPEL_ENVELOPPES = '4a';

/** Le jeu d'outils (clé de jeux_outils) de chaque série « usage ». */
const JEU_SERIE = { 1: 'vide', 2: 'avec_skill', 3: 'toolsearch' };
const JEUX_OUTILS_ENSEMBLE = { vide: [], avec_skill: ['Skill'], toolsearch: ['ToolSearch'], declencheurs: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'] };

/**
 * La liste blanche de la décomposition, d'après decomposer() : toute autre clé est refusée. Les décalages
 * entre l'usage et /context des bases (`bases`) sont exclus : ils portent sur des totaux qui dépendent du compte.
 */
const MODELE_DECOMPOSITION = {
  memoire: {
    contenu_F: null, element_projet: null, element_parent: null, element_projet_claude: null, element_global: null,
    entete_parent: null, entete_projet_claude: null, entete_par_caractere_de_chemin: null, entete_fixe_project: null,
    entete_projet: null, preambule: null, entete_global_user: null, entete_fixe_user: null, constante_context: null,
    contenu_context: null, ecart_contenu_usage_context: null,
    enveloppe_hors_context: { U1: null, U4: null, parent: null, projet_claude: null }, context_valide: null,
  },
  regles: { element_court: null, element_long: null, enveloppe_hors_context_court: null, entete_par_caractere_de_chemin: null, regle_paths: null, regle_paths_nulle: null },
  skills: {
    ligne: null, ligne_global: null, chemin_compte: null, contenu_description: null, contenu_context: null,
    constante_context: null, constante_usage: null, enveloppe_hors_context: { S1: null, S3: null, long: null },
    description_longue: null, context_valide: null,
  },
  mcp: {
    serveur_a: null, serveur_a2: null, serveur_b_sans_instructions: null, instructions: null, instructions_doubles: null,
    constante_instructions: null, differe_serveur_a: null, differe_textes_longs: null,
  },
  hooks: { sortie: null, muet: null, muet_nul: null },
  h15: { r_usage: { francais: null, anglais: null, code: null }, r_context: { francais: null, anglais: null, code: null, skill: null } },
  o200k: { F: null, F2: null, anglais: null, code: null, skill_s1: null, skill_x2: null, instructions_a1: null, instructions_a2: null },
};
const DECOMPOSITION_EXCLUE = new Set(['bases']);

const estObjet = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Fusionne les décompositions des rapports « payant » selon MODELE_DECOMPOSITION : pour chaque valeur, la
 * valeur non nulle ; deux valeurs non nulles différentes, ou une clé hors de la liste blanche, sont refusées.
 */
function fusionnerDecompositions(decompositions) {
  const verifier = (d, modele, chemin) => {
    for (const [k, v] of Object.entries(d)) {
      if (chemin === '' && DECOMPOSITION_EXCLUE.has(k)) continue;
      if (!Object.prototype.hasOwnProperty.call(modele, k)) throw new Error(`valeur absolue possible : clé de décomposition hors de la liste blanche (${chemin}${k})`);
      if (v !== null && estObjet(modele[k]) !== estObjet(v)) throw new Error(`décomposition mal formée (${chemin}${k})`);
      if (estObjet(v)) verifier(v, modele[k], `${chemin}${k}.`);
    }
  };
  for (const d of decompositions) {
    if (d === null || d === undefined) continue;
    if (!estObjet(d)) throw new Error('décomposition mal formée');
    verifier(d, MODELE_DECOMPOSITION, '');
  }
  const remplir = (modele, sources, chemin) => Object.fromEntries(Object.entries(modele).map(([k, m]) => {
    const sous = sources.map((d) => (estObjet(d) ? d[k] : undefined));
    if (estObjet(m)) return [k, remplir(m, sous, `${chemin}${k}.`)];
    const valeurs = [...new Set(sous.filter((v) => v !== null && v !== undefined).map((v) => JSON.stringify(v)))];
    if (valeurs.length > 1) throw new Error(`décomposition contradictoire entre les rapports (${chemin}${k})`);
    return [k, valeurs.length === 1 ? JSON.parse(valeurs[0]) : null];
  }));
  return remplir(MODELE_DECOMPOSITION, decompositions, '');
}

/** Les canaris de l'inventaire, par jeu de fixtures (premier segment du chemin). */
function canarisParJeu(inventaire) {
  if (!inventaire || !Array.isArray(inventaire.fixtures)) throw new Error('inventaire illisible');
  const parJeu = new Map();
  for (const f of inventaire.fixtures) {
    const jeu = String(f.chemin).split('/')[0];
    if (!parJeu.has(jeu)) parJeu.set(jeu, []);
    parJeu.get(jeu).push(...(f.canaris || []));
  }
  return parJeu;
}

function scenarioCanari(canari) {
  const m = CODE_CANARI.exec(canari);
  const s = m && SCENARIO_CANARI[m[1]];
  if (!s) throw new Error(`élément hors fixtures : canari sans scénario (${canari})`);
  return s;
}

/**
 * Les remarques d'une baseline tirée d'un ensemble : sources, indépendance du compte, A2, usage, budget
 * des skills, rigueur des canaris, décomposition, puis les observations manuelles de la version.
 */
function remarquesEnsemble({ version, context, lotContext, lotPayant, payants, appels }) {
  return [
    `Sources : les entrées « context » viennent du rapport local ${context} (lot ${lotContext}) ; les entrées « usage » et « canari » viennent des rapports locaux ${payants.join(', ')} (lot ${lotPayant}, séries 1 à 5, ${appels} appels au modèle). Ces rapports ne sont pas commités.`,
    REMARQUES_FIXES[1],
    REMARQUES_FIXES[2],
    'Les entrées « usage » sont des différences d\'entrée entre un appel et la base de sa série (U0a, S0a ou T0a), jamais des valeurs absolues : celles-ci dépendent du compte (adresse, date, skills de l\'organisation). La série 4 n\'a pas de base d\'usage : elle n\'a que des entrées « canari ».',
    `L'usage n'a été mesuré qu'en ${version}, une seule fois par appel : la tolérance de 0 n'a pas encore été éprouvée par une seconde mesure.`,
    'Les différences d\'usage des skills (série 2) pourraient dépendre du nombre de skills du compte, si leur liste a un budget limité (non vérifié) : un poste avec beaucoup de skills pourrait observer d\'autres valeurs.',
    'Les entrées « canari » reposent sur ce que rapporte le modèle. Elles sont comparées strictement : un canari vu doit rester vu, un canari non vu doit rester non vu. Un échec du comparateur sur ces entrées est un signal d\'enquête, pas une conclusion.',
    'La section « decomposition » est une information, non comparée (comparee: false) : préambule, en-têtes par type, pente par caractère de chemin, constantes, rapports H15, enveloppes, nombre d\'enveloppes de 4a, et différences d\'entrée d\'un tour à l\'autre des déclencheurs (série 5), qui contiennent le texte écrit par le modèle au tour 1 et varient avec sa formulation. Elle ne contient ni les décalages entre l\'usage et /context des bases ni l\'empreinte des enveloppes de 4a, qui dépendent du compte.',
    ...(OBSERVATIONS_MANUELLES[version] || []),
  ];
}

/**
 * La baseline d'après un rapport « context » et les rapports « payant » d'un même lot ({ nom, contenu }
 * chacun), avec l'inventaire des fixtures. Module pur : aucune lecture ni écriture de fichier. Lève une
 * erreur pour un rapport non valide, des versions (ou un modèle, un effort) différentes, une série manquante
 * ou en double, un appel en double, manquant ou hors du plan, une valeur absolue (base absente, clé de
 * décomposition inconnue), un élément hors fixtures (jeu ou canari inconnu, canari sans scénario).
 */
function baselineDepuisRapports({ context, payants }, { inventaire }) {
  // eslint-disable-next-line global-require
  const { SERIES } = require('./sonde-claude-code-payant');
  if (!context || !context.contenu) throw new Error('rapport « context » attendu');
  const env = verifierRapportContext(context.contenu, context.nom);
  const version = env.version_avant;
  if (!Array.isArray(payants) || payants.length === 0) throw new Error('au moins un rapport « payant » attendu');

  // Rapports « payant » : valides, de la même version, du même modèle et du même effort, d'un même lot.
  const lots = new Set();
  const dates = [env.date_mesure];
  const series = new Map();
  const appels = new Map();
  for (const { nom, contenu: r } of payants) {
    const m = NOM_RAPPORT_PAYANT.exec(String(nom));
    if (!m) throw new Error(`nom de rapport « payant » refusé : ${String(nom)}`);
    if (!r || r.rapport !== 'claude-code-payant') throw new Error(`${nom} : rapport « claude-code-payant » attendu`);
    const e = r.environnement || {};
    if (m[1] !== e.date_mesure) throw new Error(`${nom} : la date du nom du rapport et date_mesure diffèrent`);
    if (e.version_avant !== version) throw new Error(`mélange de versions refusé : ${nom} est en ${String(e.version_avant)}, le rapport « context » en ${version}`);
    if (e.modele !== env.modele || e.effort !== env.effort) throw new Error(`${nom} : modèle ou effort différent de ceux du rapport « context »`);
    if (r.execution && r.execution.arret) throw new Error(`${nom} : rapport non valide (exécution arrêtée)`);
    if (!Array.isArray(r.series) || r.series.length === 0) throw new Error(`${nom} : rapport non valide (aucune série)`);
    lots.add(r.lot);
    dates.push(e.date_mesure);
    for (const s of r.series) {
      if (s.valide !== true) throw new Error(`${nom} : rapport non valide (série ${s.numero} rejetée)`);
      if (series.has(s.numero)) throw new Error(`série ${s.numero} en double (${series.get(s.numero)} et ${nom})`);
      series.set(s.numero, nom);
    }
    for (const a of r.appels || []) {
      if (appels.has(a.id)) throw new Error(`appel ${a.id} en double`);
      if (!r.series.some((s) => s.numero === a.serie)) throw new Error(`${nom} : appel ${a.id} d'une série absente du rapport`);
      appels.set(a.id, a);
    }
  }
  if (lots.size !== 1) throw new Error(`les rapports « payant » doivent venir d'un même lot (${[...lots].join(', ')})`);
  for (const s of SERIES) if (!series.has(s.numero)) throw new Error(`série ${s.numero} manquante`);
  const prevus = new Map(SERIES.flatMap((s) => s.appels.map((a) => [a.id, s.numero])));
  for (const id of appels.keys()) if (!prevus.has(id)) throw new Error(`appel ${id} hors du plan des séries`);
  for (const [id, numero] of prevus) {
    if (!appels.has(id)) throw new Error(`appel ${id} manquant`);
    if (appels.get(id).serie !== numero) throw new Error(`appel ${id} rangé dans la série ${appels.get(id).serie} (série ${numero} prévue)`);
  }

  const entrees = entreesContext(context.contenu);
  const parJeu = canarisParJeu(inventaire);
  const deltasTour = {};
  let enveloppes = null;
  for (const s of SERIES) {
    if (s.mode === 'usage') {
      const base = s.appels.find((a) => a.base === 'debut');
      const ub = (appels.get(base.id).usage || {}).entree;
      for (const p of s.appels.filter((a) => a !== base)) {
        const u = (appels.get(p.id).usage || {}).entree;
        if (!Number.isInteger(u) || !Number.isInteger(ub)) throw new Error(`valeur absolue refusée : la différence de ${p.id} à ${base.id} est incalculable`);
        const scenario = SCENARIO_APPEL[p.id];
        if (!scenario) throw new Error(`appel sans scénario : ${p.id}`);
        entrees.push({
          id: `${scenario}:${p.id}:usage`, scenario, instrument: 'usage', etape: 'E0', serie: s.numero, appel: p.id, reference: base.id,
          jeu_outils: JEU_SERIE[s.numero], attendu: { delta: u - ub, tolerance: 0 }, confiance: 'observe',
        });
      }
      continue;
    }
    for (const p of s.appels) {
      const a = appels.get(p.id);
      const jeux = p.jeux ?? (s.mode === 'declencheurs' ? ['declencheurs'] : []);
      if (JSON.stringify(a.jeux) !== JSON.stringify(jeux)) throw new Error(`appel ${p.id} : jeux de fixtures différents du plan`);
      const univers = [];
      for (const j of jeux) {
        if (!parJeu.has(j)) throw new Error(`élément hors fixtures : jeu ${j} absent de l'inventaire`);
        univers.push(...parJeu.get(j));
      }
      const rep = a.reponse || {};
      if (rep.lisible !== true) throw new Error(`appel ${p.id} : réponse illisible`);
      const etapes = s.mode === 'declencheurs' ? [['avant', rep.avant_outil], ['apres', rep.apres_outil]] : [['E0', rep.canaris]];
      for (const [etape, vus] of etapes) {
        if (!Array.isArray(vus)) throw new Error(`appel ${p.id} : liste de canaris absente (${etape})`);
        for (const c of vus) if (!univers.includes(c)) throw new Error(`élément hors fixtures : canari rapporté par ${p.id} hors des jeux de l'appel`);
        for (const canari of univers) {
          const scenario = p.id === APPEL_ENVELOPPES ? 'CC35' : scenarioCanari(canari);
          entrees.push({
            id: etape === 'E0' ? `${scenario}:${p.id}:${canari}` : `${scenario}:${p.id}:${etape}:${canari}`, scenario, instrument: 'canari', etape,
            serie: s.numero, appel: p.id, canari, attendu: vus.includes(canari), confiance: 'observe',
          });
        }
      }
      if (s.mode === 'declencheurs') {
        const tours = (a.usage && a.usage.par_tour) || [];
        deltasTour[p.id] = tours.length >= 2 && Number.isInteger(tours[1].delta_entree) ? tours[1].delta_entree : null;
      }
      if (p.id === APPEL_ENVELOPPES) enveloppes = rep.enveloppes && Number.isInteger(rep.enveloppes.nombre) ? rep.enveloppes.nombre : null;
    }
  }
  verifierIdsUniques(entrees);

  const date = [...dates].sort()[dates.length - 1];
  const baseline = {
    baseline: date,
    environnement: {
      outil: env.outil, entree: env.entree, os: env.os,
      version, versions_compatibles: [version],
      modele: env.modele, effort: env.effort, sonde: env.sonde, date_mesure: date,
    },
    source: { context: context.nom, payant: payants.map((p) => p.nom), local: true },
    jeux_outils: JEUX_OUTILS_ENSEMBLE,
    decomposition: {
      comparee: false,
      ...fusionnerDecompositions(payants.map((p) => p.contenu.decomposition)),
      enveloppes_4a: { nombre: enveloppes },
      declencheurs_delta_tour: deltasTour,
    },
    entrees,
    remarques: remarquesEnsemble({ version, context: context.nom, lotContext: context.contenu.lot, lotPayant: [...lots][0], payants: payants.map((p) => p.nom), appels: appels.size }),
  };
  // eslint-disable-next-line global-require
  const problemes = require('./compare-injection-claude').problemesBaseline(baseline);
  if (problemes.length > 0) throw new Error(`baseline mal formée : ${problemes.join(' ; ')}`);
  return baseline;
}

const VERSION_CLAUDE = /^\d+\.\d+\.\d+$/;

/**
 * Décision du 2026-11-10 : ajoute la version d'un rapport « context » à versions_compatibles d'une
 * baseline existante, sans rien changer d'autre. Refuse (erreur) une série non valide, une version
 * absente, mal formée, différente avant et après ou déjà couverte, une baseline mal formée, une entrée
 * non couverte (une série partielle ne prouve rien) et au moins un écart. Renvoie la baseline complétée
 * et les lignes de la comparaison.
 */
function ajoutVersionCompatible(contenu, rapport) {
  // eslint-disable-next-line global-require
  const comparateur = require('./compare-injection-claude');
  if (!rapport || rapport.rapport !== 'claude-code-context') throw new Error('rapport « claude-code-context » attendu');
  if (!rapport.serie || rapport.serie.valide !== true) throw new Error('série non valide : aucune version ne peut être déclarée compatible');
  const env = rapport.environnement || {};
  const v = env.version_avant;
  if (typeof v !== 'string' || v !== env.version_apres) throw new Error('version absente, ou différente avant et après la série');
  if (!VERSION_CLAUDE.test(v)) throw new Error(`version mal formée : ${v}`);
  const problemes = comparateur.problemesBaseline(contenu);
  if (problemes.length > 0) throw new Error(`baseline mal formée : ${problemes.join(' ; ')}`);
  if (!Array.isArray(contenu.environnement.versions_compatibles)) throw new Error('versions_compatibles absent de la baseline');
  if (comparateur.versionCouverte(v, { contenu })) throw new Error(`la version ${v} est déjà couverte par cette baseline : rien à ajouter`);
  const lignes = comparateur.comparer(contenu, rapport);
  const nonCouvertes = lignes.filter((l) => !l.couverte).length;
  const ecarts = lignes.filter((l) => l.ecart).length;
  if (ecarts > 0) throw new Error(`${ecarts} écart(s) avec la baseline : la version ${v} n'est pas compatible`);
  if (nonCouvertes > 0) throw new Error(`${nonCouvertes} entrée(s) non couverte(s) par le rapport : une série partielle ne prouve pas la compatibilité`);
  const suivant = JSON.parse(JSON.stringify(contenu));
  suivant.environnement.versions_compatibles.push(v);
  return { contenu: suivant, version: v, lignes };
}

module.exports = {
  SCENARIO_COMBINAISON, SCENARIO_DELTA, SCENARIO_ELEMENT, OBSERVATIONS_MANUELLES, REMARQUES_FIXES, NOM_RAPPORT_CONTEXT,
  VERSION_CLAUDE, scenarioDe, baselineDepuisRapport, ajoutVersionCompatible,
  NOM_RAPPORT_PAYANT, SCENARIO_APPEL, SCENARIO_CANARI, MODELE_DECOMPOSITION, entreesContext, fusionnerDecompositions,
  canarisParJeu, scenarioCanari, baselineDepuisRapports,
};
