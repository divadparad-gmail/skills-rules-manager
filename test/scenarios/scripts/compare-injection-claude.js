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
 *   SONDE_RAPPORT_CLAUDE   un rapport précis de resultats/ (nom de fichier), au lieu du dernier ;
 *   SONDE_BASELINE_CLAUDE  impose une baseline (version, date ou nom de fichier), au lieu de celle de
 *                          la version du rapport (environnement.version, ou versions_compatibles).
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

/**
 * La baseline à comparer : celle que désigne SONDE_BASELINE_CLAUDE (version, date ou nom de fichier),
 * sinon la plus récente dont la version, ou une version compatible, est celle du rapport. Jamais devinée.
 */
function choisirBaseline(rapport, baselines, forcee) {
  const connues = baselines.length > 0 ? baselines.map((b) => `${versionBaseline(b)} (${b.fichier})`).join(', ') : 'aucune';
  const voulue = typeof forcee === 'string' ? forcee.trim() : '';
  if (voulue) {
    const b = baselines.find((x) => [x.fichier, x.date, versionBaseline(x)].includes(voulue));
    return b ? { baseline: b } : { erreur: `SONDE_BASELINE_CLAUDE=${voulue} ne désigne aucune baseline connue (${connues}).` };
  }
  if (baselines.length === 0) return { erreur: `Aucune baseline dans attendu/ : la première est créée au lot E1 (${README_HINT}).` };
  const v = versionRapport(rapport);
  if (!v) return { erreur: `Le rapport ne porte pas de version (environnement.version_avant). Pour comparer quand même, utilise SONDE_BASELINE_CLAUDE (${README_HINT}).` };
  const candidates = baselines.filter((b) => versionBaseline(b) === v || ((b.contenu.environnement || {}).versions_compatibles || []).includes(v));
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
    if (e.instrument === 'context' && (typeof e.combinaison !== 'string' || (!e.element && !e.skill && e.mesure !== 'total'))) out.push(`${e.id} : combinaison et élément attendus`);
    if (e.instrument === 'usage' && (typeof e.appel !== 'string' || typeof e.reference !== 'string' || !e.attendu || typeof e.attendu.delta !== 'number')) out.push(`${e.id} : appel, reference et attendu.delta attendus`);
    if (e.instrument === 'canari' && (typeof e.appel !== 'string' || typeof e.canari !== 'string' || typeof e.attendu !== 'boolean')) out.push(`${e.id} : appel, canari et attendu booléen attendus`);
  }
  return out;
}

/** La valeur observée pour une entrée, ou { couverte: false } si le rapport ne la mesure pas. */
function observer(entree, rapport) {
  const series = new Map((rapport.series || []).map((s) => [s.numero, s.valide]));
  const valide = (x) => x && (x.serie === undefined || series.get(x.serie) !== false);
  if (entree.instrument === 'context') {
    const combo = (rapport.combinaisons || []).find((c) => c.id === entree.combinaison);
    if (!valide(combo)) return { couverte: false };
    if (entree.mesure === 'total') return { couverte: true, valeur: combo.total };
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
  if (entree.mesure === 'total') return valeur === entree.attendu;
  const tolerance = entree.attendu.tolerance ?? 0;
  return Object.entries(entree.attendu).every(([k, v]) => {
    if (k === 'tolerance') return true;
    if (k === 'tokens' && typeof v === 'number' && typeof valeur.tokens === 'number') return Math.abs(valeur.tokens - v) <= tolerance;
    return valeur[k] === v;
  });
}

/** Une ligne par entrée de la baseline : couverte ou non par le rapport, et écart éventuel. */
function comparer(baseline, rapport) {
  return baseline.entrees.map((entree) => {
    const o = observer(entree, rapport);
    if (!o.couverte) return { id: entree.id, instrument: entree.instrument, couverte: false, ecart: false };
    return { id: entree.id, instrument: entree.instrument, couverte: true, attendu: entree.attendu, observe: o.valeur, ecart: !conforme(entree, o.valeur) };
  });
}

module.exports = {
  ATTENDU, RESULTATS, NOM_BASELINE, NOM_RAPPORT,
  listerBaselines, dernierRapport, versionRapport, choisirBaseline, problemesBaseline, observer, conforme, comparer,
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
