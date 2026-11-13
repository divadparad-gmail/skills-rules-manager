import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';

// Simulation de l'environnement VS Code pour l'exécution des tests unitaires hors VS Code ; le profil
// global de Claude Code est le dossier « global » du jeu déployé (réglage skillsManager.claudeGlobalPath)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'vscode') {
    return 'vscode';
  }
  return origResolve.call(this, request, ...args);
};
let claudeGlobalPath = '';
require.cache['vscode'] = {
  id: 'vscode',
  filename: 'vscode',
  loaded: true,
  exports: {
    window: {
      createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
      showInformationMessage: () => Promise.resolve(),
      showErrorMessage: () => Promise.resolve(),
      showWarningMessage: () => Promise.resolve(),
    },
    workspace: {
      workspaceFolders: [] as any[],
      getConfiguration: () => ({
        get: (key: string, def: any) => (key === 'claudeGlobalPath' && claudeGlobalPath ? claudeGlobalPath : def),
      }),
    },
    env: { appName: 'Visual Studio Code' },
    Uri: { file: (f: string) => ({ fsPath: f, scheme: 'file' }) },
    commands: { executeCommand: () => Promise.resolve() },
  },
} as any;

import { StateManager } from '../src/services/StateManager';
import { WorkspaceDetector } from '../src/services/WorkspaceDetector';
import { ManagerFullState, ResourceItem } from '../src/types';

/**
 * L'oracle du comptage de Claude Code (lot C1) : les fixtures inertes de la suite d'injection
 * (test/scenarios/claude-code-injection-contexte/fixtures/) sont déployées dans un dossier temporaire,
 * puis lues par l'extension (StateManager, comme dans l'extension). On compare :
 * - la présence au démarrage, la portée et le statut de chaque élément aux entrées « context » de
 *   attendu/baseline-2026-11-10.json (jeux niveaux, skills, skill-long-1500, declencheurs, et
 *   cout-regle-paths dans la combinaison cout-regles) ;
 * - pour le jeu doublons-d6, absent de toute baseline publiée, aux mesures de la grille commitée
 *   SCENARIOS-CLAUDE-CODE.md (lignes CC38 à CC40, lot E4, 2.1.319) ;
 * - les tokens o200k de chaque élément lu, en valeurs exactes figées au lot C1, puis à chaque commit du
 *   lot C2a qui ajoute une source (le .claude/CLAUDE.md et le CLAUDE.local.md du projet au commit a3, la
 *   mémoire des dossiers parents au commit a4, les imports « @ » des fichiers de mémoire au commit a5,
 *   AGENTS.md au commit a6 : agents-seul et agents-avec-claude dans la baseline, CC22 ; MEMORY.md au commit a7,
 *   sur sa ligne à part : CC23 dans la baseline, CC41, CC50 et CC53 dans la grille).
 * Pour les jeux cout-calibrage, e5-imports, e5-agents et e5-coupe-octets, absents de toute baseline publiée, la
 * référence est la grille commitée (CC09 au lot E4 ; CC41 à CC43, CC45 à CC47, CC50, CC53 et CC54 au lot E5).
 * La remontée vers les dossiers parents s'arrête au dossier du jeu (réglage de test de StateManager) :
 * sans cet arrêt, l'oracle lirait les fichiers de mémoire réels au-dessus du dossier temporaire.
 * Les tokens de Claude (champ `tokens` de la baseline, en /context) ne sont pas comparés : ils le seront
 * avec le facteur de la jauge, à un lot ultérieur. Les éléments que Claude Code charge et que l'extension
 * ne lit pas encore sont listés à part (ATTENDUS_PLUS_TARD), et le test vérifie qu'ils sont absents.
 */
const ROOT = path.resolve(__dirname, '..', '..');
const SUITE = path.join(ROOT, 'test', 'scenarios', 'claude-code-injection-contexte');
const FIXTURES = path.join(SUITE, 'fixtures');
interface Commun {
  convertir: (rel: string, nomProjet?: string) => { jeu: string; cible: string; chemin: string };
  racinesCibles: (r: { configDir: string; espace: string }) => Record<string, string>;
  nomDossierMemoire: (cheminProjet: string) => string;
  lireInventaire: (texte: string) => Map<string, { sha256: string; canaris: string[] }>;
  ecartsEmpreintes: (jeux: string[], contenus: Map<string, string>, inventaire: Map<string, unknown>) => string[];
}
// Le module partagé de la suite (lot I2), sans copie de ses fonctions
// eslint-disable-next-line @typescript-eslint/no-var-requires
const commun = require(path.join(ROOT, 'test', 'scenarios', 'scripts', 'sonde-claude-code-commun.js')) as Commun;

interface EntreeContext {
  id: string;
  combinaison: string;
  element?: string;
  skill?: string;
  /**
   * `exterieur` : un import hors du dossier de travail, absent en -p tant qu'il n'est pas approuvé
   * (mesuré, CC46 et CC54), que l'extension compte avec la marque de l'approbation (décision D-7.3).
   */
  attendu: { present?: boolean; type?: string; source?: string; delta?: number; exterieur?: boolean };
}

/** Ce que l'extension montre d'un élément lu : portée, présence au démarrage, statut et tokens o200k de la carte. */
interface Vu { cle: string; portee: 'global' | 'local'; auDemarrage: boolean; statut: string; o200k: number }

/** Les éléments de chaque jeu que l'extension lit, avec leurs valeurs figées (o200k mesurés au lot C1, puis en C2a). */
const ATTENDUS_C1: Record<string, Vu[]> = {
  niveaux: [
    { cle: '<global>/CLAUDE.md', portee: 'global', auDemarrage: true, statut: 'âme', o200k: 27 },
    // La mémoire automatique (CC23) : sa carte, hors du total de l'Âme, et la ligne à part de la jauge
    { cle: '<global>/projects/<memoire>/memory/MEMORY.md', portee: 'global', auDemarrage: true, statut: 'mémoire automatique', o200k: 22 },
    { cle: '<global>/rules/g-paths.md', portee: 'global', auDemarrage: false, statut: 'règle conditionnelle', o200k: 21 },
    { cle: '<global>/rules/g-perm.md', portee: 'global', auDemarrage: true, statut: 'règle permanente', o200k: 20 },
    { cle: '<parent>/.claude/CLAUDE.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 28 },
    { cle: '<parent>/CLAUDE.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 20 },
    { cle: '<projet>/.claude/CLAUDE.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 24 },
    { cle: '<projet>/.claude/rules/p-paths.md', portee: 'local', auDemarrage: false, statut: 'règle conditionnelle', o200k: 24 },
    { cle: '<projet>/.claude/rules/p-perm.md', portee: 'local', auDemarrage: true, statut: 'règle permanente', o200k: 21 },
    { cle: '<projet>/.claude/rules/p-yaml-invalide.md', portee: 'local', auDemarrage: true, statut: 'règle permanente (YAML invalide)', o200k: 24 },
    { cle: '<projet>/CLAUDE.local.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 17 },
    { cle: '<projet>/CLAUDE.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 26 },
    { cle: '<projet>/import-1.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 27 },
    { cle: '<projet>/import-2.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 26 },
    { cle: '<projet>/import-3.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 27 },
    { cle: '<projet>/import-4.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 26 },
    // Le cinquième saut n'est pas chargé (CC09) : une carte à 0, présente mais non active
    { cle: '<projet>/import-5.md', portee: 'local', auDemarrage: false, statut: 'âme non chargée (5ᵉ niveau)', o200k: 0 },
  ],
  skills: [
    { cle: 'skill canari-cache@<projet>', portee: 'local', auDemarrage: false, statut: 'skill manuel', o200k: 0 },
    { cle: 'skill canari-g1@<global>', portee: 'global', auDemarrage: true, statut: 'skill listé', o200k: 31 },
    { cle: 'skill canari-homo@<global>', portee: 'global', auDemarrage: true, statut: 'skill listé', o200k: 31 },
    { cle: 'skill canari-homo@<projet>', portee: 'local', auDemarrage: false, statut: 'skill masqué', o200k: 0 },
    { cle: 'skill canari-long@<projet>', portee: 'local', auDemarrage: true, statut: 'skill listé (coupé)', o200k: 209 },
    { cle: 'skill canari-p1@<projet>', portee: 'local', auDemarrage: true, statut: 'skill listé', o200k: 31 },
  ],
  'skill-long-1500': [
    { cle: 'skill canari-long@<projet>', portee: 'local', auDemarrage: true, statut: 'skill listé', o200k: 210 },
  ],
  declencheurs: [
    { cle: '<projet>/.claude/rules/d-paths.md', portee: 'local', auDemarrage: false, statut: 'règle conditionnelle', o200k: 29 },
    { cle: 'skill canari-paths@<projet>', portee: 'local', auDemarrage: false, statut: 'skill paths', o200k: 0 },
  ],
  'cout-regle-paths': [
    { cle: '<projet>/.claude/rules/r-paths.md', portee: 'local', auDemarrage: false, statut: 'règle conditionnelle', o200k: 33 },
  ],
  'doublons-d6': [
    { cle: '<global>/rules/d6-meme-nom.md', portee: 'global', auDemarrage: true, statut: 'règle permanente', o200k: 29 },
    { cle: '<projet>/.claude/rules/d6-meme-nom.md', portee: 'local', auDemarrage: true, statut: 'règle permanente', o200k: 61 },
    { cle: '<projet>/CLAUDE.local.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 26 },
    { cle: '<projet>/CLAUDE.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 22 },
    // Importé par le CLAUDE.md et le CLAUDE.local.md : une seule carte (CC40)
    { cle: '<projet>/d6-commun.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 17 },
    { cle: 'skill canari-d6-homo@<projet>', portee: 'local', auDemarrage: true, statut: 'skill listé', o200k: 50 },
  ],
  'cout-f-projet-claude': [
    { cle: '<projet>/.claude/CLAUDE.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 33 },
  ],
  'cout-f-parent': [
    { cle: '<parent>/CLAUDE.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 33 },
  ],
  // Douze imports au même niveau, tous listés (CC09, lot E4)
  'cout-calibrage': [
    { cle: '<projet>/cal-code-js-x2.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 633 },
    { cle: '<projet>/cal-code-js.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 317 },
    { cle: '<projet>/cal-en-mit-x2.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 416 },
    { cle: '<projet>/cal-en-mit.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 208 },
    { cle: '<projet>/cal-fr-original-x2.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 454 },
    { cle: '<projet>/cal-fr-original.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 227 },
    { cle: '<projet>/cal-fr-securite-x2.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 356 },
    { cle: '<projet>/cal-fr-securite.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 178 },
    { cle: '<projet>/cal-mixte-readme-x2.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 418 },
    { cle: '<projet>/cal-mixte-readme.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 209 },
    { cle: '<projet>/cal-mixte-regle-x2.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 564 },
    { cle: '<projet>/cal-mixte-regle.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 282 },
    { cle: '<projet>/CLAUDE.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 107 },
  ],
  // Les cas d'import du lot E5 (les skills du jeu ne sont pas comparés : voir JEUX_SANS_SKILLS). Le code et
  // les guillemets ne sont pas importés (CC42) ; le cycle est compté une fois (CC43) ; le frontmatter et le
  // commentaire d'un fichier importé sont retirés : 42 chacun, comme le même corps sans eux (CC45) ;
  // l'import extérieur du projet (CC46) et celui du parent vers son propre dossier (CC54) sont comptés,
  // marqués extérieurs ; le témoin du parent vers le projet est un import ordinaire (CC54).
  'e5-imports': [
    // 250 lignes : coupé à 200 lignes (CC41)
    { cle: '<global>/projects/<memoire>/memory/MEMORY.md', portee: 'global', auDemarrage: true, statut: 'mémoire automatique (coupée à 200 lignes)', o200k: 5800 },
    { cle: '<parent>/CLAUDE.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 35 },
    { cle: '<parent>/e5-exterieur.md', portee: 'local', auDemarrage: true, statut: 'âme importée (extérieure, approbation)', o200k: 17 },
    { cle: '<parent>/e5-parent-cible.md', portee: 'local', auDemarrage: true, statut: 'âme importée (extérieure, approbation)', o200k: 18 },
    { cle: '<projet>/.claude/rules/e5-ref-lignes.md', portee: 'local', auDemarrage: true, statut: 'règle permanente', o200k: 2900 },
    { cle: '<projet>/.claude/rules/e5-regle-import.md', portee: 'local', auDemarrage: true, statut: 'règle permanente', o200k: 28 },
    { cle: '<projet>/CLAUDE.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 113 },
    { cle: '<projet>/e5-code-temoin.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 12 },
    { cle: '<projet>/e5-comm-avec.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 42 },
    { cle: '<projet>/e5-cycle-1.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 16 },
    { cle: '<projet>/e5-cycle-2.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 16 },
    { cle: '<projet>/e5-fm-avec.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 42 },
    { cle: '<projet>/e5-fm-sans.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 42 },
    { cle: '<projet>/e5-parent-vers-projet.md', portee: 'local', auDemarrage: true, statut: 'âme importée', o200k: 17 },
  ],
  // 180 lignes de 160 caractères : coupé à 25 000 caractères (CC50, déduit après coup) ; la règle de référence
  // de 40 lignes (les skills du jeu ne sont pas comparés : voir JEUX_SANS_SKILLS)
  'e5-coupe-octets': [
    { cle: '<global>/projects/<memoire>/memory/MEMORY.md', portee: 'global', auDemarrage: true, statut: 'mémoire automatique (coupée à 25 000 caractères)', o200k: 10775 },
    { cle: '<projet>/.claude/rules/e5-ref-octets.md', portee: 'local', auDemarrage: true, statut: 'règle permanente', o200k: 2760 },
  ],
  // AGENTS.md seul : lu, Project (CC22)
  'agents-seul': [
    { cle: '<projet>/AGENTS.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 23 },
  ],
  // AGENTS.md avec un CLAUDE.md : AGENTS.md absent (CC22), une carte ignorée à 0
  'agents-avec-claude': [
    { cle: '<projet>/AGENTS.md', portee: 'local', auDemarrage: false, statut: 'âme ignorée (CLAUDE.md présent)', o200k: 0 },
    { cle: '<projet>/CLAUDE.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 30 },
  ],
  // Sans aucun CLAUDE.md : AGENTS.md et .claude/AGENTS.md du projet, AGENTS.md du parent, tous lus,
  // Project (CC47 ; /context : 45, 40 et 51, non comparés ici)
  'e5-agents': [
    { cle: '<parent>/AGENTS.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 26 },
    { cle: '<projet>/.claude/AGENTS.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 23 },
    { cle: '<projet>/AGENTS.md', portee: 'local', auDemarrage: true, statut: 'âme', o200k: 24 },
  ],
};

/**
 * Les jeux dont les skills ne sont pas comparés. e5-imports : ses skills mesurent la clé d'homonymie
 * (CC48 à CC51), corrigée plus tard (lot C2b) ; ils restent « plus tard », hors de cette comparaison.
 * e5-coupe-octets : ses skills mesurent skillOverrides (CC52), lu au lot C2b.
 */
const JEUX_SANS_SKILLS = new Set(['e5-imports', 'e5-coupe-octets']);

/**
 * Les éléments chargés par Claude Code que l'extension ne lit pas encore (mémoire du projet et des
 * dossiers parents, imports, MEMORY.md, règles des sous-dossiers et des parents, skills des parents
 * et des plugins). Le lot qui les lira devra retirer chaque élément de cette liste et l'ajouter à
 * ATTENDUS_C1 : le test échoue dès qu'un de ces éléments apparaît dans l'état.
 */
const ATTENDUS_PLUS_TARD: Record<string, string[]> = {
  niveaux: [
    '<parent>/.claude/rules/par-regle.md',
    '<projet>/.claude/rules/sous/p-sous.md',
  ],
  skills: ['skill canari-parent', 'skill canari-plugin:canari-plug'],
  'skill-long-1500': [],
  declencheurs: [],
  'cout-regle-paths': [],
  // CC39 : la copie du parent n'est pas listée par Claude Code, et l'extension ne lit pas encore les parents
  'doublons-d6': ['skill canari-d6-homo@<parent>'],
  'cout-f-projet-claude': [],
  'cout-f-parent': [],
  'cout-calibrage': [],
  // L'import d'une règle permanente (CC44) attend le lot C2b
  'e5-imports': ['<projet>/e5-regle-cible.md'],
  'e5-coupe-octets': [],
  'agents-seul': [],
  'agents-avec-claude': [],
  // MEMORY.md est absent : la mémoire automatique est désactivée par le settings.json du projet (CC53)
  'e5-agents': [],
};

/**
 * Jeu doublons-d6 : mesures de la grille SCENARIOS-CLAUDE-CODE.md (lot E4, /context, 2.1.319) :
 * - CC38 : les deux règles de même nom sont listées, la globale (User, 50) et celle du projet (Project, 109) ;
 * - CC39 : canari-d6-homo présent une seule fois, projectSettings, 72 : la copie du projet (déduit des tokens) ;
 * - CC40 : d6-commun.md listé une seule fois (Project, 36), à côté du CLAUDE.md (Project, 39) et du
 *   CLAUDE.local.md (Local, 45) qui l'importent.
 */
const GRILLE_DOUBLONS_D6: EntreeContext[] = [
  { id: 'CC38:global', combinaison: 'doublons-d6', element: '<global>/rules/d6-meme-nom.md', attendu: { present: true, type: 'User' } },
  { id: 'CC38:projet', combinaison: 'doublons-d6', element: '<projet>/.claude/rules/d6-meme-nom.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC39', combinaison: 'doublons-d6', skill: 'canari-d6-homo', attendu: { present: true, source: 'projectSettings' } },
  { id: 'CC40:commun', combinaison: 'doublons-d6', element: '<projet>/d6-commun.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC40:claude', combinaison: 'doublons-d6', element: '<projet>/CLAUDE.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC40:local', combinaison: 'doublons-d6', element: '<projet>/CLAUDE.local.md', attendu: { present: true, type: 'Local' } },
];

/** Jeu cout-calibrage : CC09 au lot E4 (/context, 2.1.319) : le CLAUDE.md et ses douze imports au même niveau, tous listés. */
const GRILLE_COUT_CALIBRAGE: EntreeContext[] = [
  { id: 'CC09:E4:claude', combinaison: 'cout-calibrage', element: '<projet>/CLAUDE.md', attendu: { present: true, type: 'Project' } },
  ...['cal-fr-original', 'cal-fr-securite', 'cal-en-mit', 'cal-code-js', 'cal-mixte-regle', 'cal-mixte-readme']
    .flatMap((n) => [n, `${n}-x2`])
    .map((n): EntreeContext => ({ id: `CC09:E4:${n}`, combinaison: 'cout-calibrage', element: `<projet>/${n}.md`, attendu: { present: true, type: 'Project' } })),
];

/** Jeu e5-imports : la grille du lot E5 (/context, série 2026-11-12-0833), pour ses cas d'import. */
const GRILLE_E5_IMPORTS: EntreeContext[] = [
  { id: 'CC42:temoin', combinaison: 'e5-imports', element: '<projet>/e5-code-temoin.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC42:bloc', combinaison: 'e5-imports', element: '<projet>/e5-code-bloc.md', attendu: { present: false } },
  { id: 'CC42:segment', combinaison: 'e5-imports', element: '<projet>/e5-code-segment.md', attendu: { present: false } },
  { id: 'CC42:guillemets', combinaison: 'e5-imports', element: '<projet>/e5-guillemets.md', attendu: { present: false } },
  { id: 'CC43:cycle-1', combinaison: 'e5-imports', element: '<projet>/e5-cycle-1.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC43:cycle-2', combinaison: 'e5-imports', element: '<projet>/e5-cycle-2.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC44:cible', combinaison: 'e5-imports', element: '<projet>/e5-regle-cible.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC44:cible-cwd', combinaison: 'e5-imports', element: '<projet>/e5-regle-cible-cwd.md', attendu: { present: false } },
  { id: 'CC45:sans', combinaison: 'e5-imports', element: '<projet>/e5-fm-sans.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC45:fm', combinaison: 'e5-imports', element: '<projet>/e5-fm-avec.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC45:comm', combinaison: 'e5-imports', element: '<projet>/e5-comm-avec.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC46:claude', combinaison: 'e5-imports', element: '<projet>/CLAUDE.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC46:exterieur', combinaison: 'e5-imports', element: '<parent>/e5-exterieur.md', attendu: { present: false, exterieur: true } },
  { id: 'CC54:parent', combinaison: 'e5-imports', element: '<parent>/CLAUDE.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC54:temoin', combinaison: 'e5-imports', element: '<projet>/e5-parent-vers-projet.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC54:cible', combinaison: 'e5-imports', element: '<parent>/e5-parent-cible.md', attendu: { present: false, exterieur: true } },
  { id: 'CC41', combinaison: 'e5-imports', element: '<global>/projects/<memoire>/memory/MEMORY.md', attendu: { present: true, type: 'AutoMem' } },
];

/**
 * Jeu e5-agents : la grille du lot E5 (/context, série 2026-11-12-0833) : CC47, les trois AGENTS.md
 * présents, Project ; MEMORY.md absent (CC53, autoMemoryEnabled: false dans le projet), attendu au commit a7.
 */
const GRILLE_E5_AGENTS: EntreeContext[] = [
  { id: 'CC47:projet', combinaison: 'e5-agents', element: '<projet>/AGENTS.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC47:projet-claude', combinaison: 'e5-agents', element: '<projet>/.claude/AGENTS.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC47:parent', combinaison: 'e5-agents', element: '<parent>/AGENTS.md', attendu: { present: true, type: 'Project' } },
  { id: 'CC53', combinaison: 'e5-agents', element: '<global>/projects/<memoire>/memory/MEMORY.md', attendu: { present: false } },
];

/** Jeu e5-coupe-octets : la grille du lot E5 (/context, série 2026-11-12-0833) : CC50, MEMORY.md présent, AutoMem, coupé. */
const GRILLE_E5_COUPE_OCTETS: EntreeContext[] = [
  { id: 'CC50', combinaison: 'e5-coupe-octets', element: '<global>/projects/<memoire>/memory/MEMORY.md', attendu: { present: true, type: 'AutoMem' } },
  { id: 'CC50:reference', combinaison: 'e5-coupe-octets', element: '<projet>/.claude/rules/e5-ref-octets.md', attendu: { present: true, type: 'Project' } },
];

/** Les jeux sans entrée dans une baseline publiée : leur référence est la grille. */
const GRILLES: Record<string, EntreeContext[]> = {
  'doublons-d6': GRILLE_DOUBLONS_D6,
  'cout-calibrage': GRILLE_COUT_CALIBRAGE,
  'e5-imports': GRILLE_E5_IMPORTS,
  'e5-agents': GRILLE_E5_AGENTS,
  'e5-coupe-octets': GRILLE_E5_COUPE_OCTETS,
};

const JEUX = ['niveaux', 'skills', 'skill-long-1500', 'declencheurs', 'cout-regle-paths', 'doublons-d6', 'cout-f-projet-claude', 'cout-f-parent', 'cout-calibrage', 'e5-imports', 'agents-seul', 'agents-avec-claude', 'e5-agents', 'e5-coupe-octets'];
/**
 * Combinaison de la baseline qui porte les entrées d'un jeu : le jeu cout-regle-paths est mesuré dans
 * cout-regles, et les jeux cout-f-projet-claude et cout-f-parent dans cout-f-quatre-chemins (CC13).
 */
const COMBINAISON: Record<string, string> = {
  'cout-regle-paths': 'cout-regles',
  'cout-f-projet-claude': 'cout-f-quatre-chemins',
  'cout-f-parent': 'cout-f-quatre-chemins',
};

/**
 * L'état attendu de la ligne « Mémoire automatique » : présent pour les jeux qui déposent un MEMORY.md, désactivé
 * pour e5-agents (autoMemoryEnabled: false dans le projet, CC53), absent ailleurs.
 */
const ETAT_MEMOIRE_AUTO: Record<string, string> = { niveaux: 'present', 'e5-imports': 'present', 'e5-coupe-octets': 'present', 'e5-agents': 'desactivee' };

const lister = (dir: string, base = ''): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? lister(path.join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`]);
const posix = (p: string) => p.split(path.sep).join('/');

describe('Suite de Tests : oracle du comptage de Claude Code sur les fixtures inertes de la suite d\'injection (lot C1)', () => {
  let tempBaseDir: string;
  const vscodeMock = require('vscode');
  const baseline = JSON.parse(fs.readFileSync(path.join(SUITE, 'attendu', 'baseline-2026-11-10.json'), 'utf8')) as { entrees: Array<EntreeContext & { instrument: string }> };
  const inventaire = commun.lireInventaire(fs.readFileSync(path.join(SUITE, 'inventaire.json'), 'utf8'));
  const toutes = lister(FIXTURES);

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'claude-c1-oracle-'));
  });

  after(async () => {
    claudeGlobalPath = '';
    StateManager.setClaudeMemoryStopAtForTesting(null);
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  /** Déploie un jeu dans le dossier temporaire et charge l'état de l'extension, comme dans VS Code. */
  const deployerEtCharger = async (jeu: string) => {
    const racines = commun.racinesCibles({ configDir: path.join(tempBaseDir, jeu, 'global'), espace: path.join(tempBaseDir, jeu, 'espace') });
    fs.mkdirSync(racines.projet, { recursive: true });
    fs.mkdirSync(racines.global, { recursive: true });
    const contenus = new Map<string, string>();
    for (const rel of toutes.filter((r) => r.split('/')[0] === jeu)) {
      const texte = fs.readFileSync(path.join(FIXTURES, ...rel.split('/')), 'utf8');
      contenus.set(rel, texte);
      const { cible, chemin } = commun.convertir(rel, commun.nomDossierMemoire(racines.projet));
      const dest = path.join(racines[cible], ...chemin.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, texte, 'utf8');
    }

    const origFolders = vscodeMock.workspace.workspaceFolders;
    vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: racines.projet } }];
    WorkspaceDetector.setOverriddenTool('claude-code');
    claudeGlobalPath = racines.global;
    // La remontée vers les dossiers parents s'arrête au dossier du jeu (au-dessus de <parent>)
    StateManager.setClaudeMemoryStopAtForTesting(path.join(tempBaseDir, jeu));
    // La mémoire automatique ne voit aucune variable de l'environnement du poste
    StateManager.setClaudeAutoMemoryEnvForTesting({});
    try {
      const state = await StateManager.loadFullState(true);
      return { state, racines, contenus };
    } finally {
      claudeGlobalPath = '';
      StateManager.setClaudeMemoryStopAtForTesting(null);
      StateManager.setClaudeAutoMemoryEnvForTesting(null);
      WorkspaceDetector.setOverriddenTool(null);
      vscodeMock.workspace.workspaceFolders = origFolders;
    }
  };

  /** Le nom masqué d'un chemin réel : <projet>, <parent> ou <global>, en séparateurs « / ». */
  const masquer = (p: string, racines: Record<string, string>) => {
    const memoire = path.join(racines.global, 'projects', commun.nomDossierMemoire(racines.projet));
    const relMemoire = path.relative(memoire, p);
    if (!relMemoire.startsWith('..') && !path.isAbsolute(relMemoire)) return `<global>/projects/<memoire>/${posix(relMemoire)}`;
    for (const [nom, racine] of [['projet', racines.projet], ['parent', racines.parent], ['global', racines.global]] as const) {
      const rel = path.relative(racine, p);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) return `<${nom}>${rel ? `/${posix(rel)}` : ''}`;
    }
    return p;
  };

  /** Ce que l'extension montre des âmes, des règles et des skills de Claude Code. */
  const vus = (state: ManagerFullState, racines: Record<string, string>): Vu[] =>
    [...state.globalResources, ...state.localResources]
      .filter((i: ResourceItem) => i.targetTool === 'claude-code' && ['soul', 'rule', 'skill'].includes(i.type))
      .map((i: ResourceItem): Vu => {
        const portee = i.scope === 'global' ? 'global' : 'local';
        const m = i.metadata ?? {};
        if (i.type === 'skill') {
          const lieu = masquer(i.path, racines).split('/')[0];
          const statut = m.claudeSkillMaskedBy ? 'skill masqué' : m.claudeSkillManualOnly ? 'skill manuel' : m.claudeSkillPathsTriggered ? 'skill paths'
            : m.claudeDescriptionOriginalLength ? 'skill listé (coupé)' : 'skill listé';
          return { cle: `skill ${i.name}@${lieu}`, portee, auDemarrage: statut.startsWith('skill listé') && i.enabled, statut, o200k: i.tokenCount ?? 0 };
        }
        if (i.type === 'soul') {
          // Un fichier importé : chargé, extérieur (marqué « après approbation »), ou non chargé (5ᵉ saut, plus de 4 Mio)
          if (m.claudeMemoryType === 'AutoMem') {
            const coupe = m.claudeAutoMemory?.coupe === 'lignes' ? ' (coupée à 200 lignes)' : m.claudeAutoMemory?.coupe === 'caracteres' ? ' (coupée à 25 000 caractères)' : '';
            return { cle: masquer(i.path, racines), portee, auDemarrage: i.enabled, statut: `mémoire automatique${coupe}`, o200k: i.tokenCount ?? 0 };
          }
          const statut = m.claudeMemoryNotLoaded === 'niveau-5' ? 'âme non chargée (5ᵉ niveau)'
            : m.claudeMemoryNotLoaded === 'plus-de-4-mio' ? 'âme ignorée (plus de 4 Mio)'
            : m.claudeMemoryNotLoaded === 'agents-ignore' ? 'âme ignorée (CLAUDE.md présent)'
            : m.claudeImport?.externe ? 'âme importée (extérieure, approbation)'
            : m.claudeImport ? 'âme importée' : 'âme';
          return { cle: masquer(i.path, racines), portee, auDemarrage: i.enabled && !m.claudeMemoryNotLoaded, statut, o200k: i.tokenCount ?? 0 };
        }
        const statut = m.isConditional ? 'règle conditionnelle' : m.claudeYamlInvalid ? 'règle permanente (YAML invalide)' : 'règle permanente';
        return { cle: masquer(i.path, racines), portee, auDemarrage: i.enabled && !m.isConditional, statut, o200k: i.tokenCount ?? 0 };
      })
      .sort((a, b) => a.cle.localeCompare(b.cle));

  /** Compare une entrée « context » (baseline ou grille) à ce que montre l'extension. */
  const comparer = (entree: EntreeContext, liste: Vu[], plusTard: string[]) => {
    const { present, type, source } = entree.attendu;
    if (entree.skill !== undefined) {
      const nom = entree.skill;
      if (plusTard.includes(`skill ${nom}`)) {
        assert.ok(!liste.some((v) => v.cle.startsWith(`skill ${nom}@`) || v.cle.startsWith(`skill ${nom.split(':').pop()}@`)), `${entree.id} : lu trop tôt`);
        return;
      }
      const listes = liste.filter((v) => v.cle.startsWith(`skill ${nom}@`) && v.auDemarrage);
      if (present) {
        assert.strictEqual(listes.length, 1, `${entree.id} : une seule copie listée au démarrage`);
        assert.strictEqual(listes[0].portee, source === 'userSettings' ? 'global' : 'local', `${entree.id} : portée`);
      } else {
        assert.strictEqual(listes.length, 0, `${entree.id} : absent au démarrage`);
      }
      return;
    }
    const element = entree.element!;
    if (plusTard.includes(element)) {
      assert.ok(!liste.some((v) => v.cle === element), `${entree.id} : ${element} est lu, la liste des éléments attendus plus tard est à mettre à jour`);
      return;
    }
    const vu = liste.find((v) => v.cle === element);
    if (entree.attendu.exterieur) {
      // Absent en -p sans approbation (mesuré) ; compté par l'extension, avec la marque de l'approbation
      assert.ok(vu && vu.auDemarrage, `${entree.id} : ${element} compté`);
      assert.strictEqual(vu!.statut, 'âme importée (extérieure, approbation)', `${entree.id} : marqué extérieur`);
      return;
    }
    if (present) {
      assert.ok(vu && vu.auDemarrage, `${entree.id} : ${element} présent au démarrage`);
      assert.strictEqual(vu!.portee, type === 'User' || type === 'AutoMem' ? 'global' : 'local', `${entree.id} : portée`);
    } else {
      assert.ok(!vu || !vu.auDemarrage, `${entree.id} : ${element} absent au démarrage`);
    }
  };

  const entreesDe = (jeu: string): EntreeContext[] => {
    if (GRILLES[jeu]) return GRILLES[jeu];
    const combinaison = COMBINAISON[jeu] ?? jeu;
    const fichiersDuJeu = new Set(toutes.filter((r) => r.split('/')[0] === jeu).map((r) => {
      const { cible, chemin } = commun.convertir(r, '<memoire>');
      return `<${cible}>/${chemin}`;
    }));
    return baseline.entrees.filter((e) => e.instrument === 'context' && e.combinaison === combinaison && e.attendu.delta === undefined)
      .filter((e) => combinaison === jeu || (e.element !== undefined && fichiersDuJeu.has(e.element)));
  };

  test('1. Les fixtures lues sont celles de l\'inventaire (empreintes)', () => {
    const contenus = new Map(toutes.filter((r) => JEUX.includes(r.split('/')[0]))
      .map((r) => [r, fs.readFileSync(path.join(FIXTURES, ...r.split('/')), 'utf8')] as [string, string]));
    assert.deepStrictEqual(commun.ecartsEmpreintes(JEUX, contenus, inventaire), []);
    assert.ok(contenus.size > 0);
  });

  for (const jeu of JEUX) {
    test(`2. Jeu ${jeu} : présence, portée, statut et tokens o200k`, async () => {
      const { state, racines, contenus } = await deployerEtCharger(jeu);
      assert.strictEqual(state.workspace.tool, 'claude-code');
      assert.deepStrictEqual(commun.ecartsEmpreintes([jeu], contenus, inventaire), [], 'Fixtures conformes à l\'inventaire');

      const liste = vus(state, racines).filter((v) => !(JEUX_SANS_SKILLS.has(jeu) && v.cle.startsWith('skill ')));
      // Ce que l'extension lit au lot C1, ni plus ni moins, avec les tokens o200k exacts
      assert.deepStrictEqual(liste, ATTENDUS_C1[jeu]);

      // Chaque entrée « context » de la baseline (ou de la grille) : présence et portée
      const entrees = entreesDe(jeu);
      assert.ok(entrees.length > 0, `${jeu} : au moins une entrée de référence`);
      for (const entree of entrees) comparer(entree, liste, ATTENDUS_PLUS_TARD[jeu]);

      // Les éléments attendus plus tard sont absents de l'état
      for (const cle of ATTENDUS_PLUS_TARD[jeu]) {
        assert.ok(!liste.some((v) => v.cle === cle || v.cle.startsWith(`${cle}@`)), `${jeu} : ${cle} est lu, à rattacher à l'oracle`);
      }
      // La ligne « Mémoire automatique » : son état ; la carte hors du total de l'Âme ; la ligne comptée une fois
      const s = state.stats;
      const auto = s.claudeAutoMemory!;
      assert.ok(auto, `${jeu} : ligne de la mémoire automatique`);
      assert.strictEqual(auto.etat, ETAT_MEMOIRE_AUTO[jeu] ?? 'absent', `${jeu} : état de la mémoire automatique`);
      const carteAuto = state.globalResources.filter((i) => i.metadata?.claudeMemoryType === 'AutoMem');
      assert.strictEqual(carteAuto.length, auto.etat === 'present' ? 1 : 0, `${jeu} : une carte seulement si présent`);
      assert.strictEqual(auto.tokenCount, carteAuto[0]?.tokenCount ?? 0, `${jeu} : la ligne vaut la carte`);
      const ameG = state.globalResources.filter((i) => i.type === 'soul' && i.enabled && !i.metadata?.claudeMemoryNotLoaded && i.metadata?.claudeMemoryType !== 'AutoMem')
        .reduce((t, i) => t + (i.tokenCount ?? 0), 0);
      assert.strictEqual(s.soulGlobal.tokenCount, ameG, `${jeu} : la carte de MEMORY.md est hors du total de l'Âme`);
      const categories = s.soulGlobal.tokenCount + s.soulLocal.tokenCount + s.rulesGlobal.tokenCount + s.rulesLocal.tokenCount
        + s.skillsGlobal.tokenCount + s.skillsLocal.tokenCount + s.mcpGlobal.tokenCount + s.mcpLocal.tokenCount;
      assert.strictEqual(s.usedTokensTotal, categories + auto.tokenCount, `${jeu} : la ligne est comptée une fois dans le total`);

      // Aucun doublon ni gaspillage parmi les skills
      const doublonsSkills = [...state.globalResources, ...state.localResources].filter((i) => i.type === 'skill' && i.metadata?.duplicateInfo);
      assert.strictEqual(doublonsSkills.length, 0, `${jeu} : aucun skill en doublon`);
    });
  }
});
