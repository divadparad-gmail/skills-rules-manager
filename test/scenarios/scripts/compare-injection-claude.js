#!/usr/bin/env node
/**
 * Comparateur de la suite d'injection Claude Code (lot I3).
 *
 * Module : fonctions pures pour choisir la baseline, trouver le dernier rapport et le comparer.
 * Script (npm run test:injection-claude) : lance le test compilé claude-injection-comparaison avec
 * INJECTION_CLAUDE_COMPARE=1, comme compare-injection-contexte.js pour Antigravity. Sans cette
 * variable, la comparaison réelle est ignorée dans npm test.
 *
 * Variables :
 *   SONDE_RAPPORT_CLAUDE   l'ensemble de rapports à comparer, au lieu de l'ensemble par défaut : un nom de
 *                          fichier de resultats/, ou plusieurs séparés par des virgules (au plus un
 *                          « context » et des « payant » de la même version, sans série en double) ;
 *   SONDE_BASELINE_CLAUDE  impose une baseline (version, date ou nom de fichier), au lieu de celle de
 *                          la version du rapport (environnement.version, ou versions_compatibles) ; si
 *                          leurs versions diffèrent, la comparaison est annoncée « inter-versions ».
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SUITE = path.resolve(__dirname, '..', 'claude-code-injection-contexte');
const ATTENDU = path.join(SUITE, 'attendu');
const RESULTATS = path.join(SUITE, 'resultats');
const NOM_BASELINE = /^baseline-(\d{4}-\d{2}-\d{2})\.json$/;
const NOM_RAPPORT = /^(context|payant)-(\d{4}-\d{2}-\d{2}-\d{4})\.json$/;
const INSTRUMENTS = new Set(['context', 'usage', 'canari']);
const README_HINT = 'voir le README de la suite, section « Lire les résultats »';

/** Les baselines de attendu/, de la plus ancienne à la plus récente. */
function listerBaselines(dossier = ATTENDU) {
  if (!fs.existsSync(dossier)) return [];
  return fs.readdirSync(dossier)
    .filter((f) => NOM_BASELINE.test(f))
    .sort()
    .map((fichier) => ({ fichier, date: NOM_BASELINE.exec(fichier)[1], contenu: JSON.parse(fs.readFileSync(path.join(dossier, fichier), 'utf8')) }));
}

/** Le dernier rapport de resultats/ (par horodatage ; à égalité, payant après context), ou celui demandé. */
function dernierRapport(dossier = RESULTATS, demande = '') {
  if (!fs.existsSync(dossier)) return null;
  const noms = fs.readdirSync(dossier).filter((f) => NOM_RAPPORT.test(f));
  let nom;
  if (demande && demande.trim()) {
    nom = noms.find((f) => f === demande.trim());
    if (!nom) throw new Error(`SONDE_RAPPORT_CLAUDE=${demande.trim()} ne désigne aucun rapport de resultats/`);
  } else {
    const cle = (f) => {
      const [, type, stamp] = NOM_RAPPORT.exec(f);
      return `${stamp}-${type === 'payant' ? 1 : 0}`;
    };
    nom = noms.sort((a, b) => (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0)).pop();
  }
  return nom ? { fichier: nom, contenu: JSON.parse(fs.readFileSync(path.join(dossier, nom), 'utf8')) } : null;
}

const versionRapport = (r) => (r && r.environnement && typeof r.environnement.version_avant === 'string' ? r.environnement.version_avant.trim() : null);
const versionBaseline = (b) => (b.contenu.environnement && b.contenu.environnement.version) || null;

/** Vrai si la version du rapport est celle de la baseline ou l'une de ses versions compatibles. */
const versionCouverte = (v, b) => Boolean(v) && (versionBaseline(b) === v || ((b.contenu.environnement || {}).versions_compatibles || []).includes(v));

/**
 * La baseline à comparer : celle que désigne SONDE_BASELINE_CLAUDE (version, date ou nom de fichier),
 * sinon la plus récente dont la version, ou une version compatible, est celle du rapport. Jamais devinée.
 * Une baseline imposée est acceptée même si sa version diffère de celle du rapport (vérification d'une
 * nouvelle version, lot V1) : le choix porte alors interVersions, que l'affichage doit annoncer.
 */
function choisirBaseline(rapport, baselines, forcee) {
  const connues = baselines.length > 0 ? baselines.map((b) => `${versionBaseline(b)} (${b.fichier})`).join(', ') : 'aucune';
  const voulue = typeof forcee === 'string' ? forcee.trim() : '';
  if (voulue) {
    const b = baselines.find((x) => [x.fichier, x.date, versionBaseline(x)].includes(voulue));
    if (!b) return { erreur: `SONDE_BASELINE_CLAUDE=${voulue} ne désigne aucune baseline connue (${connues}).` };
    const v = versionRapport(rapport);
    return versionCouverte(v, b) ? { baseline: b } : { baseline: b, interVersions: { rapport: v, baseline: versionBaseline(b) } };
  }
  if (baselines.length === 0) return { erreur: `Aucune baseline dans attendu/ : la première est créée au lot E1 (${README_HINT}).` };
  const v = versionRapport(rapport);
  if (!v) return { erreur: `Le rapport ne porte pas de version (environnement.version_avant). Pour comparer quand même, utilise SONDE_BASELINE_CLAUDE (${README_HINT}).` };
  const candidates = baselines.filter((b) => versionCouverte(v, b));
  if (candidates.length === 0) {
    return { erreur: `Aucune baseline pour Claude Code ${v} (connues : ${connues}). Pour comparer quand même, désigne-en une avec SONDE_BASELINE_CLAUDE ; pour figer cette version, suis la règle de création d'une baseline (${README_HINT}).` };
  }
  return { baseline: candidates[candidates.length - 1] };
}

/** Problèmes de format d'une baseline (section 5 de la conception, complétée au lot I3). */
function problemesBaseline(contenu) {
  const out = [];
  if (!contenu || typeof contenu !== 'object') return ['baseline illisible'];
  if (!contenu.environnement || typeof contenu.environnement.version !== 'string') out.push('environnement.version absent');
  if (!Array.isArray(contenu.entrees)) return [...out, 'entrees absent'];
  const ids = new Set();
  for (const e of contenu.entrees) {
    if (!e || typeof e.id !== 'string') {
      out.push('entrée sans id');
      continue;
    }
    if (ids.has(e.id)) out.push(`${e.id} : id en double`);
    ids.add(e.id);
    if (!INSTRUMENTS.has(e.instrument)) out.push(`${e.id} : instrument inconnu`);
    if (e.instrument === 'context') {
      // Décision du 2026-11-09 : jamais de total absolu, seulement des fixtures et des écarts à la base.
      if (e.mesure === 'total') out.push(`${e.id} : total absolu refusé (il dépend du compte)`);
      else if (typeof e.combinaison !== 'string' || (!e.element && !e.skill && !e.outil_mcp && e.mesure !== 'delta')) out.push(`${e.id} : combinaison et élément attendus`);
      else if (e.mesure === 'delta' && (!e.attendu || typeof e.attendu.delta !== 'number')) out.push(`${e.id} : attendu.delta attendu`);
      else if (e.outil_mcp && e.attendu && e.attendu.tokens !== undefined) out.push(`${e.id} : outil MCP comparé en présence seulement (A2)`);
    }
    if (e.instrument === 'usage' && e.mesure === 'delta_tour') out.push(`${e.id} : différence d'un tour à l'autre refusée (elle contient le texte du modèle : décomposition seulement)`);
    else if (e.instrument === 'usage' && (typeof e.appel !== 'string' || typeof e.reference !== 'string' || !e.attendu || typeof e.attendu.delta !== 'number')) out.push(`${e.id} : appel, reference et attendu.delta attendus`);
    if (e.instrument === 'canari' && (typeof e.appel !== 'string' || typeof e.canari !== 'string' || typeof e.attendu !== 'boolean')) out.push(`${e.id} : appel, canari et attendu booléen attendus`);
  }
  // Décision du 2026-11-10 : la décomposition est une information, jamais comparée.
  if (contenu.decomposition !== undefined && contenu.decomposition !== null && (typeof contenu.decomposition !== 'object' || contenu.decomposition.comparee !== false)) out.push('decomposition : comparee: false attendu (section non comparée)');
  return out;
}

/** La valeur observée pour une entrée, ou { couverte: false } si le rapport ne la mesure pas. */
function observer(entree, rapport) {
  const series = new Map((rapport.series || []).map((s) => [s.numero, s.valide]));
  const valide = (x) => x && (x.serie === undefined || series.get(x.serie) !== false);
  if (entree.instrument === 'context') {
    const combo = (rapport.combinaisons || []).find((c) => c.id === entree.combinaison);
    if (!valide(combo)) return { couverte: false };
    if (entree.mesure === 'delta') {
      if (typeof combo.delta_base !== 'number') return { couverte: false };
      const outilsMcp = entree.sans_outils_mcp ? ((combo.categories || []).find((c) => c.nom === 'MCP tools') || {}).tokens || 0 : 0;
      return { couverte: true, valeur: combo.delta_base - outilsMcp };
    }
    if (entree.outil_mcp) {
      const t = (combo.mcp_tools || []).find((x) => x.name === entree.outil_mcp);
      return { couverte: true, valeur: { present: Boolean(t) } };
    }
    if (entree.element) {
      const m = (combo.memory_files || []).find((f) => f.chemin.toLowerCase() === entree.element.toLowerCase());
      return { couverte: true, valeur: { present: Boolean(m), type: m ? m.type : null, tokens: m ? m.tokens : null } };
    }
    const s = (combo.skills || []).find((x) => x.name === entree.skill);
    return { couverte: true, valeur: { present: Boolean(s), source: s ? s.source : null, tokens: s ? s.tokens : null } };
  }
  const appel = (id) => (rapport.appels || []).find((a) => a.id === id);
  if (entree.instrument === 'usage') {
    const a = appel(entree.appel);
    const r = appel(entree.reference);
    if (!valide(a) || !valide(r) || typeof a.usage.entree !== 'number' || typeof r.usage.entree !== 'number') return { couverte: false };
    return { couverte: true, valeur: a.usage.entree - r.usage.entree };
  }
  const a = appel(entree.appel);
  if (!valide(a) || !a.reponse || !a.reponse.lisible) return { couverte: false };
  const liste = entree.etape === 'avant' ? a.reponse.avant_outil : entree.etape === 'apres' ? a.reponse.apres_outil : a.reponse.canaris;
  return { couverte: true, valeur: Array.isArray(liste) && liste.includes(entree.canari) };
}

/** Vrai si la valeur observée correspond à l'attendu (tolérance 0 par défaut). */
function conforme(entree, valeur) {
  if (entree.instrument === 'usage') return Math.abs(valeur - entree.attendu.delta) <= (entree.attendu.tolerance ?? 0);
  if (entree.instrument === 'canari') return valeur === entree.attendu;
  if (entree.mesure === 'delta') return Math.abs(valeur - entree.attendu.delta) <= (entree.attendu.tolerance ?? 0);
  const tolerance = entree.attendu.tolerance ?? 0;
  return Object.entries(entree.attendu).every(([k, v]) => {
    if (k === 'tolerance') return true;
    if (k === 'tokens' && typeof v === 'number' && typeof valeur.tokens === 'number') return Math.abs(valeur.tokens - v) <= tolerance;
    return valeur[k] === v;
  });
}

/**
 * Une ligne par entrée de la baseline : couverte ou non par le rapport, et écart éventuel. Seules les
 * entrées de la baseline sont comparées : les totaux absolus et les éléments hors fixtures du rapport
 * ne le sont jamais.
 */
function comparer(baseline, rapport) {
  return baseline.entrees.map((entree) => {
    const o = observer(entree, rapport);
    if (!o.couverte) return { id: entree.id, instrument: entree.instrument, couverte: false, ecart: false };
    return { id: entree.id, instrument: entree.instrument, couverte: true, attendu: entree.attendu, observe: o.valeur, ecart: !conforme(entree, o.valeur) };
  });
}

const NOM_PAYANT = /^payant-/;
const horodatage = (f) => NOM_RAPPORT.exec(f)[2];

/**
 * Fusionne un ensemble de rapports ({ fichier, contenu }) en un rapport virtuel que comparer() sait lire :
 * les combinaisons du rapport « context » (si sa série est valide), les séries et les appels des rapports
 * « payant ». Refuse deux rapports « context », un mélange de versions, une série ou un appel en double.
 */
function fusionnerRapports(rapports) {
  if (!Array.isArray(rapports) || rapports.length === 0) throw new Error('ensemble de rapports vide');
  const contexts = rapports.filter((r) => !NOM_PAYANT.test(r.fichier));
  if (contexts.length > 1) throw new Error(`un seul rapport « context » par ensemble (${contexts.map((r) => r.fichier).join(', ')})`);
  const versions = [...new Set(rapports.map((r) => versionRapport(r.contenu)))];
  if (versions.length !== 1 || !versions[0]) throw new Error(`mélange de versions refusé (${rapports.map((r) => `${r.fichier} : ${versionRapport(r.contenu) || 'version inconnue'}`).join(', ')})`);
  const series = [];
  const appels = [];
  for (const r of rapports.filter((x) => NOM_PAYANT.test(x.fichier))) {
    for (const s of r.contenu.series || []) {
      if (series.some((x) => x.numero === s.numero)) throw new Error(`série ${s.numero} en double dans l'ensemble`);
      series.push(s);
    }
    for (const a of r.contenu.appels || []) {
      if (appels.some((x) => x.id === a.id)) throw new Error(`appel ${a.id} en double dans l'ensemble`);
      appels.push(a);
    }
  }
  const ctx = contexts[0] && contexts[0].contenu;
  const combinaisons = ctx && (!ctx.serie || ctx.serie.valide !== false) ? ctx.combinaisons || [] : [];
  return { rapport: 'ensemble', environnement: { version_avant: versions[0] }, combinaisons, series, appels };
}

/**
 * L'ensemble à comparer. Désigné (SONDE_RAPPORT_CLAUDE) : un ou plusieurs noms séparés par des virgules,
 * pris tels quels. Par défaut : le rapport « context » le plus récent (sinon le « payant » le plus récent)
 * fixe la version ; s'y ajoutent, pour chaque série, le rapport « payant » de cette version le plus récent
 * qui la contient. Les rapports d'une autre version sont écartés et comptés. Renvoie null si resultats/
 * n'a aucun rapport.
 */
function choisirEnsemble(dossier = RESULTATS, demande = '') {
  if (!fs.existsSync(dossier)) return null;
  const noms = fs.readdirSync(dossier).filter((f) => NOM_RAPPORT.test(f)).sort((a, b) => (horodatage(a) < horodatage(b) ? -1 : horodatage(a) > horodatage(b) ? 1 : 0));
  const lire = (nom) => ({ fichier: nom, contenu: JSON.parse(fs.readFileSync(path.join(dossier, nom), 'utf8')) });
  const voulu = typeof demande === 'string' ? demande.trim() : '';
  if (voulu) {
    const liste = voulu.split(',').map((x) => x.trim());
    for (const n of liste) {
      if (!noms.includes(n)) throw new Error(`SONDE_RAPPORT_CLAUDE : ${n || '(nom vide)'} ne désigne aucun rapport de resultats/`);
    }
    if (new Set(liste).size !== liste.length) throw new Error('SONDE_RAPPORT_CLAUDE : un rapport figure deux fois');
    const rapports = liste.map(lire);
    return { fichiers: liste, ecartes: 0, rapports, contenu: fusionnerRapports(rapports) };
  }
  if (noms.length === 0) return null;
  const contexts = noms.filter((n) => !NOM_PAYANT.test(n));
  const reference = lire(contexts.length > 0 ? contexts[contexts.length - 1] : noms[noms.length - 1]);
  const version = versionRapport(reference.contenu);
  const payants = noms.filter((n) => NOM_PAYANT.test(n)).map(lire);
  const memes = payants.filter((p) => versionRapport(p.contenu) === version);
  // Pour chaque série, le rapport le plus récent qui la contient ; un rapport plus ancien ne garde que ses autres séries.
  const retenues = new Map();
  for (const p of memes) for (const s of p.contenu.series || []) retenues.set(s.numero, p.fichier);
  const choisis = memes.filter((p) => [...retenues.values()].includes(p.fichier)).map((p) => {
    const garder = new Set([...retenues].filter(([, f]) => f === p.fichier).map(([n]) => n));
    return { fichier: p.fichier, contenu: { ...p.contenu, series: (p.contenu.series || []).filter((s) => garder.has(s.numero)), appels: (p.contenu.appels || []).filter((a) => garder.has(a.serie)) } };
  });
  const rapports = NOM_PAYANT.test(reference.fichier) ? choisis : [reference, ...choisis];
  return { fichiers: rapports.map((r) => r.fichier), ecartes: payants.length - memes.length, rapports, contenu: fusionnerRapports(rapports) };
}

/**
 * L'en-tête affiché avant le bilan : une comparaison inter-versions est toujours annoncée comme telle,
 * avec les deux versions, pour qu'aucun bilan « 0 écart » ne passe pour celui de la même version.
 */
function enteteComparaison(fichierRapport, choix) {
  const fichiers = `${fichierRapport} contre ${choix.baseline.fichier}`;
  if (!choix.interVersions) return fichiers;
  const { rapport, baseline } = choix.interVersions;
  return `comparaison inter-versions : rapport ${rapport || '(version inconnue)'} contre baseline ${baseline} (${fichiers}, baseline imposée par SONDE_BASELINE_CLAUDE)`;
}

module.exports = {
  ATTENDU, RESULTATS, NOM_BASELINE, NOM_RAPPORT,
  listerBaselines, dernierRapport, fusionnerRapports, choisirEnsemble, versionRapport, versionCouverte, choisirBaseline, problemesBaseline, observer, conforme, comparer,
  enteteComparaison,
};

if (require.main === module) {
  // Lanceur Node, pour poser la variable d'environnement de façon portable (sans cross-env).
  // eslint-disable-next-line global-require
  const { spawnSync } = require('child_process');
  const testFile = path.resolve(__dirname, '../../../out-test/test/claude-injection-comparaison.test.js');
  if (!fs.existsSync(testFile)) {
    console.error('[Comparaison Claude Code] Test compilé introuvable : lancer d\'abord tsc -p tsconfig.test.json');
    process.exit(1);
  }
  const r = spawnSync(process.execPath, ['--test', testFile], { stdio: 'inherit', env: { ...process.env, INJECTION_CLAUDE_COMPARE: '1' } });
  process.exit(r.status ?? 1);
}
