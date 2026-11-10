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
  if (!rapport.serie || rapport.serie.valide !== true) throw new Error('série non valide : aucune baseline ne peut en être tirée');
  const env = rapport.environnement || {};
  if (typeof env.version_avant !== 'string' || env.version_avant !== env.version_apres) throw new Error('version absente, ou différente avant et après la série');
  const m = NOM_RAPPORT_CONTEXT.exec(String(source));
  if (!m) throw new Error('nom du rapport source refusé');
  if (m[1] !== env.date_mesure) throw new Error('la date du nom du rapport et date_mesure diffèrent');

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
  const ids = new Set();
  for (const e of entrees) {
    if (ids.has(e.id)) throw new Error(`entrée en double : ${e.id}`);
    ids.add(e.id);
  }

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
    entrees,
    remarques: [...REMARQUES_FIXES, ...(OBSERVATIONS_MANUELLES[env.version_avant] || [])],
  };
}

module.exports = {
  SCENARIO_COMBINAISON, SCENARIO_DELTA, SCENARIO_ELEMENT, OBSERVATIONS_MANUELLES, REMARQUES_FIXES, NOM_RAPPORT_CONTEXT,
  scenarioDe, baselineDepuisRapport,
};
