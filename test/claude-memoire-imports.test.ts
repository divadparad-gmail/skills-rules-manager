import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';

// Les imports « @chemin » des fichiers de mémoire de Claude Code (lot C2a, commit a5) : le CLAUDE.md
// global, les trois fichiers du projet et ceux des dossiers parents. Les imports d'AGENTS.md, des règles
// et de MEMORY.md ne sont pas développés ici.
//
// Sources (grille SCENARIOS-CLAUDE-CODE.md de la suite d'injection) :
// - blocs clôturés, segments de code et chemins entre guillemets ignorés : mesuré (CC42) ;
// - quatre sauts au plus : mesuré (CC09) ; un même fichier compté une fois : mesuré (CC40) ;
// - un cycle coupé, chaque fichier compté une fois : mesuré (CC43) ;
// - frontmatter et commentaire de bloc d'un fichier importé retirés : mesuré (CC45) ;
// - import extérieur non chargé en -p tant qu'il n'est pas approuvé, y compris depuis un CLAUDE.md
//   parent vers son propre dossier : mesuré (CC46, CC54) ;
// - « \ » suivi d'une espace, « ~/ », chemin absolu ou relatif au fichier qui importe, et la limite de
//   4 Mio : documentation (https://code.claude.com/docs/en/memory.md).
//
// Les fichiers vivent dans un dossier temporaire au nom fixe, protégé par un fichier témoin : un dossier
// de ce nom sans le témoin n'est ni vidé ni supprimé. La remontée s'arrête à un dossier de ce dossier
// temporaire (stopAt), et un espion note toute lecture du système de fichiers hors du dossier d'arrêt et
// des profils simulés : la liste doit rester vide.

const DOSSIER = path.join(os.tmpdir(), 'claude-memoire-imports-a5');
const TEMOIN = '.temoin-claude-memoire-imports';
const TEXTE_TEMOIN = 'Dossier temporaire du test test/claude-memoire-imports.test.ts.\n';
/** Le dossier d'arrêt de la remontée, qui est aussi le dossier parent du projet. */
const RACINE = path.join(DOSSIER, 'racine');
const PROJET = path.join(RACINE, 'projet');
const CLAUDE_GLOBAL = path.join(DOSSIER, 'claude');
const AG_GLOBAL = path.join(DOSSIER, 'gemini', 'config');
const RACINE_EXTENSION = path.resolve(__dirname, '..', '..');
const QUATRE_MIO = 4 * 1024 * 1024;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'vscode') {
    return 'vscode';
  }
  return origResolve.call(this, request, ...args);
};
const REGLAGES: Record<string, string> = { globalPath: AG_GLOBAL, claudeGlobalPath: CLAUDE_GLOBAL };
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
      workspaceFolders: [{ uri: { fsPath: PROJET } }],
      getConfiguration: (section?: string) => ({
        get: (key: string, def: any) => (section === 'skillsManager' && key in REGLAGES ? REGLAGES[key] : def),
        // Les chemins ne sont lus que dans les réglages utilisateur (inspect().globalValue)
        inspect: (key: string) => (section === 'skillsManager' && key in REGLAGES ? { key, globalValue: REGLAGES[key] } : undefined),
      }),
    },
    env: { appName: 'Visual Studio Code' },
    Uri: { file: (f: string) => ({ fsPath: f, scheme: 'file' }) },
    commands: { executeCommand: () => Promise.resolve() },
  },
} as any;

import { LocalScanner } from '../src/services/LocalScanner';
import { GlobalScanner } from '../src/services/GlobalScanner';
import { DuplicateService } from '../src/services/DuplicateService';
import { DeleteService } from '../src/services/DeleteService';
import { getProtectedResourceRefusal, isBulkToggleable, ToggleManager } from '../src/services/ToggleManager';
import { claudeInjectedText } from '../src/claude/injectedText';
import { claudeWatchTargets } from '../src/claude/claudeWatchTargets';
import { buildClaudeImportItems, isClaudeMemoryNotLoaded } from '../src/services/claudeMemoryItems';
import { countTokens } from '../src/utils/tokenizer';
import { ManagerFullState, ResourceItem, WorkspaceContext } from '../src/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const main = require(path.resolve(__dirname, '../../src/webview/main.js'));

/**
 * Le module des imports, chargé à l'exécution : avant le commit a5, il n'existe pas, et chaque test qui
 * en dépend échoue avec ce message au lieu de faire échouer tout le fichier.
 */
function imports(): any {
  const fichier = path.resolve(__dirname, '../src/claude/memoryImports.js');
  assert.ok(fs.existsSync(fichier), 'le module src/claude/memoryImports.ts est absent');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(fichier);
}

// --- Rendu d'une carte et du bandeau (faux DOM, sans dépendance, comme test/claude-memoire-sources.test.ts) ---
interface MockEl {
  tagName: string;
  id: string;
  className: string;
  innerHTML: string;
  textContent: string;
  title: string;
  children: MockEl[];
  style: Record<string, string>;
  parentNode: MockEl | null;
  appendChild: (child: MockEl) => MockEl;
  insertBefore: (child: MockEl, ref: MockEl | null) => MockEl;
  removeChild: (child: MockEl) => MockEl;
  readonly nextSibling: MockEl | null;
  addEventListener: () => void;
  setAttribute: (nom: string, valeur: string) => void;
  classList: { add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean };
}

const createElement = (tag: string): MockEl => {
  const classes = new Set<string>();
  const el: MockEl = {
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    innerHTML: '',
    textContent: '',
    title: '',
    children: [],
    style: {},
    parentNode: null,
    appendChild(c: MockEl) {
      c.parentNode = this;
      this.children.push(c);
      return c;
    },
    insertBefore(c: MockEl, ref: MockEl | null) {
      c.parentNode = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(c);
      else this.children.splice(i, 0, c);
      return c;
    },
    removeChild(c: MockEl) {
      this.children = this.children.filter((x) => x !== c);
      c.parentNode = null;
      return c;
    },
    get nextSibling() {
      if (!this.parentNode) return null;
      const freres = this.parentNode.children;
      return freres[freres.indexOf(this) + 1] ?? null;
    },
    addEventListener() {},
    setAttribute() {},
    classList: {
      add: (c: string) => { classes.add(c); el.className = [...classes].join(' '); },
      remove: (c: string) => { classes.delete(c); el.className = [...classes].join(' '); },
      contains: (c: string) => classes.has(c),
    },
  };
  return el;
};
const descendants = (el: MockEl): MockEl[] => [el, ...el.children.flatMap(descendants)];
const rendu = (item: ResourceItem): MockEl[] => descendants(main.createItemCard(item, true, { createElement }));
const pastilles = (tous: MockEl[]) => tous.filter((el) => el.className.includes('item-badge-pill')).map((el) => el.textContent);

/** Un document minimal : un conteneur qui porte le bandeau du banc d'essai, comme dashboard.html et sidebar.html. */
function documentMinimal(): { doc: any; conteneur: MockEl } {
  const conteneur = createElement('div');
  const banc = createElement('div');
  banc.id = 'bancEssaiBanner';
  conteneur.appendChild(banc);
  conteneur.appendChild(createElement('header'));
  const doc = {
    createElement,
    getElementById: (id: string) => descendants(conteneur).find((el) => el.id === id) ?? null,
  };
  return { doc, conteneur };
}

// --- Dossier temporaire au nom fixe, protégé par un témoin ---
function viderSaufTemoin(): void {
  for (const e of fs.readdirSync(DOSSIER)) {
    if (e !== TEMOIN) fs.rmSync(path.join(DOSSIER, e), { recursive: true, force: true });
  }
}

function preparerDossier(): void {
  if (fs.existsSync(DOSSIER)) {
    const temoin = path.join(DOSSIER, TEMOIN);
    if (!fs.existsSync(temoin) || fs.readFileSync(temoin, 'utf8') !== TEXTE_TEMOIN) {
      throw new Error(`Le dossier temporaire « ${path.basename(DOSSIER)} » existe sans le fichier témoin du test : arrêt, rien n'est supprimé.`);
    }
    viderSaufTemoin();
  } else {
    fs.mkdirSync(DOSSIER);
    fs.writeFileSync(path.join(DOSSIER, TEMOIN), TEXTE_TEMOIN, 'utf8');
  }
}

/** Repart d'une arborescence vide, puis écrit les fichiers donnés (chemin relatif au dossier temporaire). */
function arborescence(fichiers: Record<string, string>): void {
  viderSaufTemoin();
  REGLAGES.claudeGlobalPath = CLAUDE_GLOBAL;
  fs.mkdirSync(PROJET, { recursive: true });
  fs.mkdirSync(CLAUDE_GLOBAL, { recursive: true });
  fs.mkdirSync(AG_GLOBAL, { recursive: true });
  for (const [rel, contenu] of Object.entries(fichiers)) {
    const dest = path.join(DOSSIER, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, contenu, 'utf8');
  }
}

/**
 * Un fichier creux : son début est écrit, puis sa taille est portée à `taille` octets par troncature,
 * sans écrire le reste (des octets nuls).
 */
function fichierCreux(rel: string, debut: string, taille: number): string {
  const dest = path.join(DOSSIER, ...rel.split('/'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, debut, 'utf8');
  fs.truncateSync(dest, taille);
  return dest;
}

// --- Espion des lectures hors du dossier d'arrêt et des profils simulés ---
const FONCTIONS_SYNC = [
  'existsSync', 'statSync', 'lstatSync', 'readFileSync', 'readdirSync', 'realpathSync', 'accessSync', 'openSync', 'createReadStream',
  'statfsSync', 'opendirSync', 'watch',
] as const;
const FONCTIONS_PROMESSES = ['stat', 'lstat', 'readFile', 'readdir', 'realpath', 'access', 'open', 'statfs', 'opendir'] as const;
/** Les fonctions qui lisent le contenu d'un fichier (et non ses seules métadonnées). */
const LECTURES_DE_CONTENU = new Set(['readFileSync', 'openSync', 'createReadStream', 'readFile', 'open']);

/** Vrai si `chemin` est `racine` ou se trouve dessous (sans la casse sous Windows, comme NTFS). */
function sousOuEgal(chemin: string, racine: string): boolean {
  const rel = path.relative(path.resolve(racine), path.resolve(chemin));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Une forme refusée sous Windows, sans aucun accès : « \\ » ou « // » en tête (\\?\ et \\.\ compris), le préfixe
 * NT (« \??\ », toutes barres), ou une lettre de lecteur autre que `lettre`. Fonction pure, pour les chemins
 * écrits en path.win32 sur toute plateforme.
 */
function estFormeInterditeWin32(chemin: string, lettre: string): boolean {
  return /^[\\/]{2}/.test(chemin)
    || /^[\\/]\?\?[\\/]/.test(chemin)
    || (/^[A-Za-z]:/.test(chemin) && chemin[0].toLowerCase() !== lettre.toLowerCase());
}

/** Les lettres de lecteur admises par l'espion sous Windows : celle du dossier temporaire, et celle du dépôt. */
const LETTRES_ADMISES = new Set([os.tmpdir(), RACINE_EXTENSION].map((p) => path.resolve(p)[0].toLowerCase()));

/**
 * Vrai pour un chemin que l'espion refuse sans appeler la vraie fonction. Sous Windows : les formes de
 * estFormeInterditeWin32, avec les lettres admises. Ailleurs : « // » en tête, et tout chemin hors du dossier
 * temporaire et du dépôt.
 */
function estCheminInterdit(p: unknown): boolean {
  if (typeof p !== 'string' && !(p instanceof URL) && !Buffer.isBuffer(p)) return false;
  const chemin = String(p instanceof URL ? p.pathname : p);
  if (process.platform === 'win32') {
    if (/^[A-Za-z]:/.test(chemin)) return !LETTRES_ADMISES.has(chemin[0].toLowerCase());
    return estFormeInterditeWin32(chemin, 'a');
  }
  return /^[\\/]{2}/.test(chemin) || ![os.tmpdir(), RACINE_EXTENSION].some((r) => sousOuEgal(chemin, r));
}

async function sousEspion<T>(autorises: string[], action: () => Promise<T>): Promise<{ resultat: T; horsDossier: string[]; contenusLus: string[] }> {
  const horsDossier: string[] = [];
  const contenusLus: string[] = [];
  const racines = [...autorises, path.join(RACINE_EXTENSION, 'out-test'), path.join(RACINE_EXTENSION, 'node_modules')];
  const noter = (nom: string, p: unknown) => {
    if (typeof p !== 'string' && !(p instanceof URL) && !Buffer.isBuffer(p)) return; // descripteur de fichier
    const chemin = String(p instanceof URL ? p.pathname : p);
    if (!racines.some((r) => sousOuEgal(chemin, r))) horsDossier.push(`${nom} ${chemin}`);
    if (LECTURES_DE_CONTENU.has(nom)) contenusLus.push(path.resolve(chemin));
  };
  const origines: Array<() => void> = [];
  // Un chemin interdit est noté, puis refusé par une erreur ENOENT, sans appel réel : aucun test n'accède à un
  // hôte ni à un autre lecteur, même quand le code testé tente d'y accéder
  const refusReseau = (p: unknown) => {
    const err: NodeJS.ErrnoException = new Error(`ENOENT: chemin refusé par l'espion du test, '${String(p)}'`);
    err.code = 'ENOENT';
    return err;
  };
  const espionner = (cible: any, nom: string, promesse: boolean) => {
    const orig = cible[nom];
    if (typeof orig !== 'function') return;
    const appeler = (fn: any, libelle: string, self: unknown, p: unknown, reste: unknown[]) => {
      noter(libelle, p);
      if (estCheminInterdit(p)) {
        if (promesse) return Promise.reject(refusReseau(p));
        throw refusReseau(p);
      }
      return fn.call(self, p, ...reste);
    };
    const espion = function (this: unknown, p: unknown, ...reste: unknown[]) {
      return appeler(orig, nom, this, p, reste);
    };
    if (typeof orig.native === 'function') {
      const origNative = orig.native;
      (espion as any).native = function (this: unknown, p: unknown, ...reste: unknown[]) {
        return appeler(origNative, `${nom}.native`, this, p, reste);
      };
    }
    cible[nom] = espion;
    origines.push(() => { cible[nom] = orig; });
  };
  // Le module réel : les modules de src/ lisent le module réel
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsReel = require('fs');
  FONCTIONS_SYNC.forEach((n) => espionner(fsReel, n, false));
  FONCTIONS_PROMESSES.forEach((n) => espionner(fsReel.promises, n, true));
  try {
    return { resultat: await action(), horsDossier, contenusLus };
  } finally {
    origines.forEach((r) => r());
  }
}

const espace = (tool: 'claude-code' | 'antigravity' = 'claude-code'): WorkspaceContext => ({
  hasWorkspace: true,
  workspacePath: PROJET,
  tool,
  agentsDir: tool === 'antigravity' ? '.agents' : null,
  claudeDir: tool === 'claude-code' ? path.join(PROJET, '.claude') : null,
  hasClaudeMd: fs.existsSync(path.join(PROJET, 'CLAUDE.md')),
});

type Scan = Awaited<ReturnType<typeof LocalScanner.scan>>;
type ScanGlobal = Awaited<ReturnType<typeof GlobalScanner.scan>>;

/** Scan local et global de Claude Code, remontée arrêtée à RACINE ; aucune lecture hors de RACINE et des profils. */
async function scanner(): Promise<{ local: Scan; global: ScanGlobal; contenusLus: string[] }> {
  const { resultat, horsDossier, contenusLus } = await sousEspion([RACINE, REGLAGES.claudeGlobalPath, AG_GLOBAL], async () => ({
    local: await LocalScanner.scan(espace(), undefined, { claudeMemoryStopAt: RACINE }),
    global: await GlobalScanner.scan(AG_GLOBAL, 'claude-code'),
  }));
  assert.deepStrictEqual(horsDossier, [], 'aucune lecture hors du dossier d\'arrêt et des profils simulés');
  return { ...resultat, contenusLus };
}

const ames = (items: ResourceItem[]) => items.filter((i) => i.type === 'soul');
const meta = (c: ResourceItem) => (c.metadata ?? {}) as any;
const tokensInjectes = (texte: string) => countTokens(claudeInjectedText(texte));
const somme = (cartes: ResourceItem[]) => cartes.reduce((s, c) => s + (c.tokenCount ?? 0), 0);
const posix = (p: string) => p.split(path.sep).join('/');
/** L'identifiant attendu d'un import du CLAUDE.md global : « ~/… » sous le dossier personnel, sinon le chemin absolu. */
const idGlobal = (fichier: string) => {
  const rel = path.relative(os.homedir(), fichier);
  return !rel.startsWith('..') && !path.isAbsolute(rel) ? `~/${posix(rel)}` : posix(fichier);
};

const TEXTE_COMMUN = '# Fichier commun\n\nCe fichier est importé par deux fichiers de mémoire.\n';

// ====================================================================================================
// 1. Analyse et résolution (fonctions pures, sans système de fichiers)
// ====================================================================================================

describe('Imports de la mémoire de Claude Code : analyse et résolution (fonctions pures)', () => {
  test('1. Les blocs clôturés et les segments de code sont ignorés (mesuré, CC42)', () => {
    const { parseClaudeImports } = imports();
    const texte = [
      '# Titre',
      '```text',
      '@bloc-accents.md',
      '```',
      '~~~',
      '@bloc-tildes.md',
      '~~~',
      'Le chemin `@segment.md` est cité, comme ``@segment-double.md``.',
      '````',
      '```',
      '@bloc-imbrique.md',
      '````',
      '@temoin.md',
      'Texte puis @apres-texte.md sur la même ligne.',
    ].join('\n');
    assert.deepStrictEqual(parseClaudeImports(texte), ['temoin.md', 'apres-texte.md']);
  });

  test('2. Un chemin entre guillemets n\'est pas un import (mesuré, CC42) ; une adresse électronique non plus', () => {
    const { parseClaudeImports } = imports();
    assert.deepStrictEqual(parseClaudeImports('"@guillemets.md"\n\'@apostrophes.md\'\n@"cite.md"\nnom@domaine.md\n@vrai.md\n'), ['vrai.md']);
  });

  test('3. « \\ » suivi d\'une espace donne une espace (documentation)', () => {
    const { parseClaudeImports } = imports();
    assert.deepStrictEqual(parseClaudeImports('@Design\\ Docs/plan\\ final.md suite\n'), ['Design Docs/plan final.md']);
  });

  test('4. « ~/ » donne le dossier personnel ; un chemin absolu est pris tel quel (documentation)', () => {
    const { resolveClaudeImport } = imports();
    assert.strictEqual(resolveClaudeImport('~/.claude/consignes.md', '/espace/projet', '/maison/moi', path.posix), '/maison/moi/.claude/consignes.md');
    assert.strictEqual(resolveClaudeImport('/ailleurs/absolu.md', '/espace/projet', '/maison/moi', path.posix), '/ailleurs/absolu.md');
    assert.strictEqual(resolveClaudeImport('~/x.md', 'C:\\espace\\projet', 'C:\\Users\\moi', path.win32), 'C:\\Users\\moi\\x.md');
    assert.strictEqual(resolveClaudeImport('D:\\ailleurs\\absolu.md', 'C:\\espace\\projet', 'C:\\Users\\moi', path.win32), 'D:\\ailleurs\\absolu.md');
  });

  test('5. Un chemin relatif est résolu depuis le dossier du fichier qui importe, et non depuis le dossier de travail (documentation)', () => {
    const { resolveClaudeImport } = imports();
    assert.strictEqual(resolveClaudeImport('voisin.md', '/espace/projet/docs', '/maison/moi', path.posix), '/espace/projet/docs/voisin.md');
    assert.strictEqual(resolveClaudeImport('../haut.md', '/espace/projet/docs', '/maison/moi', path.posix), '/espace/projet/haut.md');
    assert.strictEqual(resolveClaudeImport('sous/bas.md', 'C:\\espace\\parent', 'C:\\Users\\moi', path.win32), 'C:\\espace\\parent\\sous\\bas.md');
  });

  /** Un système de fichiers en mémoire (chemins POSIX), qui note les fichiers dont le contenu est lu. */
  const port = (fichiers: Record<string, string>, tailles: Record<string, number> = {}) => {
    const lus: string[] = [];
    return {
      lus,
      port: {
        fileSize: (p: string) => (p in tailles ? tailles[p] : p in fichiers ? Buffer.byteLength(fichiers[p]) : null),
        readText: (p: string) => { lus.push(p); return p in fichiers ? fichiers[p] : null; },
        key: (p: string) => p,
      },
    };
  };
  const contexte = (seen: string[]) => ({ cwd: '/t/parent/projet', home: '/maison/moi', seen: new Set(seen), pathApi: path.posix });

  test('6. Un cycle à deux fichiers est coupé : chaque fichier est compté une fois (mesuré, CC43)', () => {
    const { expandClaudeImports } = imports();
    const racine = '/t/parent/projet/CLAUDE.md';
    const { port: p } = port({
      [racine]: '@cycle-1.md\n',
      '/t/parent/projet/cycle-1.md': 'Premier.\n\n@cycle-2.md\n',
      '/t/parent/projet/cycle-2.md': 'Second.\n\n@cycle-1.md\n@CLAUDE.md\n',
    });
    const entrees = expandClaudeImports([{ path: racine, text: '@cycle-1.md\n', projectLevel: true }], contexte([racine]), p);
    assert.deepStrictEqual(entrees.map((e: any) => [e.path, e.importer, e.niveau, e.etat]), [
      ['/t/parent/projet/cycle-1.md', racine, 1, 'charge'],
      ['/t/parent/projet/cycle-2.md', '/t/parent/projet/cycle-1.md', 2, 'charge'],
    ]);
    assert.strictEqual(entrees[0].text, 'Premier.\n\n@cycle-2.md\n');
  });

  test('7. Le cinquième saut n\'est pas chargé ; son fichier n\'est pas lu (mesuré, CC09)', () => {
    const { expandClaudeImports } = imports();
    const racine = '/t/parent/projet/CLAUDE.md';
    const fichiers: Record<string, string> = {};
    for (let n = 1; n <= 6; n++) fichiers[`/t/parent/projet/import-${n}.md`] = `Niveau ${n}.\n\n@import-${n + 1}.md\n`;
    const { port: p, lus } = port(fichiers);
    const entrees = expandClaudeImports([{ path: racine, text: '@import-1.md\n', projectLevel: true }], contexte([racine]), p);
    assert.deepStrictEqual(entrees.map((e: any) => [path.posix.basename(e.path), e.niveau, e.etat]), [
      ['import-1.md', 1, 'charge'], ['import-2.md', 2, 'charge'], ['import-3.md', 3, 'charge'], ['import-4.md', 4, 'charge'],
      ['import-5.md', 5, 'niveau-5'],
    ]);
    assert.strictEqual(entrees[4].text, null, 'le fichier du cinquième saut n\'a pas de texte');
    assert.ok(!lus.includes('/t/parent/projet/import-5.md'), 'le fichier du cinquième saut n\'est pas lu');
    assert.ok(!lus.includes('/t/parent/projet/import-6.md'), 'le sixième saut n\'est jamais atteint');
  });

  test('8. Import extérieur : vrai pour le projet et pour un parent vers son dossier, faux pour le global (mesuré, CC46 et CC54)', () => {
    const { expandClaudeImports, isClaudeImportExternal } = imports();
    // La fonction seule
    assert.strictEqual(isClaudeImportExternal('/t/parent/ext.md', '/t/parent/projet', true, path.posix), true);
    assert.strictEqual(isClaudeImportExternal('/t/parent/projet/docs/a.md', '/t/parent/projet', true, path.posix), false);
    assert.strictEqual(isClaudeImportExternal('/t/parent/projetbis/a.md', '/t/parent/projet', true, path.posix), true, 'un dossier voisin au nom proche est dehors');
    assert.strictEqual(isClaudeImportExternal('/maison/moi/x.md', '/t/parent/projet', false, path.posix), false, 'jamais pour le global');

    // L'expansion : le projet vers le parent, le parent vers son dossier, le parent vers le projet, le global vers l'extérieur
    const global = '/maison/moi/.claude/CLAUDE.md';
    const parent = '/t/parent/CLAUDE.md';
    const projet = '/t/parent/projet/CLAUDE.md';
    const { port: p } = port({
      '/maison/moi/.claude/perso.md': 'Perso.\n',
      '/t/parent/cible.md': 'Cible du parent.\n',
      '/t/parent/projet/vers-projet.md': 'Du parent vers le projet.\n',
      '/t/parent/ext.md': 'Extérieur.\n',
    });
    const entrees = expandClaudeImports([
      { path: global, text: '@perso.md\n', projectLevel: false },
      { path: parent, text: '@cible.md\n@projet/vers-projet.md\n', projectLevel: true },
      { path: projet, text: '@../ext.md\n', projectLevel: true },
    ], contexte([global, parent, projet]), p);
    assert.deepStrictEqual(entrees.map((e: any) => [e.path, e.externe]), [
      ['/maison/moi/.claude/perso.md', false],
      ['/t/parent/cible.md', true],
      ['/t/parent/projet/vers-projet.md', false],
      ['/t/parent/ext.md', true],
    ]);
  });

  test('9. Un import déjà vu (fichier de mémoire ou autre import) n\'a pas de seconde entrée ; un fichier absent est ignoré', () => {
    const { expandClaudeImports } = imports();
    const projet = '/t/parent/projet/CLAUDE.md';
    const local = '/t/parent/projet/CLAUDE.local.md';
    const { port: p } = port({ '/t/parent/projet/commun.md': 'Commun.\n' });
    const entrees = expandClaudeImports([
      { path: projet, text: '@commun.md\n@CLAUDE.local.md\n@absent.md\n', projectLevel: true },
      { path: local, text: '@commun.md\n', projectLevel: true },
    ], contexte([projet, local]), p);
    assert.deepStrictEqual(entrees.map((e: any) => [e.path, e.importer]), [['/t/parent/projet/commun.md', projet]]);
  });

  test('10. Plus de 4 Mio (strictement) : entrée à part, ni lue ni développée (documentation)', () => {
    const { expandClaudeImports, CLAUDE_MEMORY_MAX_BYTES } = imports();
    assert.strictEqual(CLAUDE_MEMORY_MAX_BYTES, 4194304);
    const projet = '/t/parent/projet/CLAUDE.md';
    const { port: p, lus } = port(
      { '/t/parent/projet/gros.md': '@enfant.md\n', '/t/parent/projet/limite.md': '@enfant-limite.md\n', '/t/parent/projet/enfant.md': 'E.\n', '/t/parent/projet/enfant-limite.md': 'L.\n' },
      { '/t/parent/projet/gros.md': 4194305, '/t/parent/projet/limite.md': 4194304 },
    );
    const entrees = expandClaudeImports([{ path: projet, text: '@gros.md\n@limite.md\n', projectLevel: true }], contexte([projet]), p);
    assert.deepStrictEqual(entrees.map((e: any) => [path.posix.basename(e.path), e.etat, e.size]), [
      ['gros.md', 'plus-de-4-mio', 4194305],
      ['limite.md', 'charge', 4194304],
      ['enfant-limite.md', 'charge', 3],
    ]);
    assert.ok(!lus.includes('/t/parent/projet/gros.md'), 'le fichier de plus de 4 Mio n\'est pas lu');
  });
});

// ====================================================================================================
// 2. Le scanner : cartes, colonnes, lecture seule, bandeau, plus de 4 Mio
// ====================================================================================================

describe('Imports de la mémoire de Claude Code : cartes, jauge et lecture seule', () => {
  before(() => {
    preparerDossier();
  });

  after(() => {
    REGLAGES.claudeGlobalPath = CLAUDE_GLOBAL;
    if (fs.existsSync(DOSSIER)) viderSaufTemoin();
  });

  test('11. Un fichier importé par CLAUDE.md et CLAUDE.local.md a une seule carte, au premier rencontré (mesuré, CC40)', async () => {
    const projet = '# Projet\n\n@commun.md\n';
    const local = '# Local\n\n@commun.md\n';
    arborescence({
      'racine/projet/CLAUDE.md': projet,
      'racine/projet/CLAUDE.local.md': local,
      'racine/projet/commun.md': TEXTE_COMMUN,
      'claude/CLAUDE.md': '# Global\n',
    });
    const { local: scan, global } = await scanner();
    const cartes = ames(scan.items);
    assert.deepStrictEqual(cartes.map((c) => c.id), ['CLAUDE.md', 'CLAUDE.local.md', 'commun.md']);
    const commun = cartes[2];
    assert.strictEqual(commun.path, path.join(PROJET, 'commun.md'));
    assert.deepStrictEqual(meta(commun).claudeImport, { par: 'CLAUDE.md', niveau: 1, externe: false });
    assert.strictEqual(meta(commun).claudeMemoryType, 'Project', 'type Project (mesuré, CC40)');
    assert.strictEqual(commun.scope, 'local');
    assert.strictEqual(commun.tokenCount, tokensInjectes(TEXTE_COMMUN));
    // Les lignes @ restent comptées dans le fichier qui importe
    assert.strictEqual(cartes[0].tokenCount, tokensInjectes(projet));
    assert.strictEqual(scan.soulStat.tokenCount, somme(cartes), 'Âme L : les trois cartes');
    assert.strictEqual(scan.soulStat.activeCount, 3);
    assert.strictEqual(scan.soulStat.inheritedCount, 0, 'un import n\'est pas un fichier hérité');
    // Aucune paire de doublons ne touche la carte de l'import
    const { enrichedLocal } = DuplicateService.detectDuplicates(global.items, scan.items);
    assert.ok(!enrichedLocal.find((c) => c.id === 'commun.md')!.metadata?.duplicateInfo, 'aucun doublon pour l\'import');
  });

  test('12. L\'ordre de chargement : l\'import d\'un parent passe avant celui du projet, et garde la carte', async () => {
    arborescence({
      'racine/CLAUDE.md': '# Parent\n\n@projet/commun.md\n',
      'racine/projet/CLAUDE.md': '# Projet\n\n@commun.md\n',
      'racine/projet/commun.md': TEXTE_COMMUN,
    });
    const { local } = await scanner();
    const cartes = ames(local.items);
    assert.deepStrictEqual(cartes.map((c) => c.id), ['../CLAUDE.md', 'CLAUDE.md', 'commun.md']);
    assert.deepStrictEqual(meta(cartes[2]).claudeImport, { par: '../CLAUDE.md', niveau: 1, externe: false }, 'le parent vers le projet : un import ordinaire (mesuré, CC54)');
    assert.strictEqual(meta(cartes[2]).inheritedFrom, undefined);
  });

  test('13. Type et colonne : l\'import du global est User, dans l\'Âme G ; celui du CLAUDE.local.md est Project, dans l\'Âme L', async () => {
    const texteGlobal = '# Global\n\n@g-import.md\n';
    const texteImportGlobal = '# Import du global\n\nConsigne importée par le CLAUDE.md global.\n';
    const texteImportLocal = '# Import du local\n\nConsigne importée par le CLAUDE.local.md.\n';
    arborescence({
      'claude/CLAUDE.md': texteGlobal,
      'claude/g-import.md': texteImportGlobal,
      // Le projet importe aussi le fichier du global : il garde sa carte globale (le global se charge en premier)
      'racine/projet/CLAUDE.md': '# Projet\n\n@../../claude/g-import.md\n',
      'racine/projet/CLAUDE.local.md': '# Local\n\n@docs/l-import.md\n',
      'racine/projet/docs/l-import.md': texteImportLocal,
    });
    const { local, global } = await scanner();
    const globales = ames(global.items);
    const fichierGlobal = path.join(CLAUDE_GLOBAL, 'g-import.md');
    assert.deepStrictEqual(globales.map((c) => c.id), ['CLAUDE.md', idGlobal(fichierGlobal)]);
    const g = globales[1];
    assert.strictEqual(g.scope, 'global');
    assert.strictEqual(meta(g).claudeMemoryType, 'User');
    assert.deepStrictEqual(meta(g).claudeImport, { par: idGlobal(path.join(CLAUDE_GLOBAL, 'CLAUDE.md')), niveau: 1, externe: false }, 'jamais extérieur depuis le global');
    assert.deepStrictEqual(meta(g).claudeReadOnly, { raison: 'Fichier hors du projet' });
    assert.strictEqual(g.tokenCount, tokensInjectes(texteImportGlobal));
    assert.strictEqual(global.soulStat.tokenCount, tokensInjectes(texteGlobal) + tokensInjectes(texteImportGlobal), 'Âme G : le global et son import');
    assert.strictEqual(global.soulStat.activeCount, 2);

    const locales = ames(local.items);
    assert.deepStrictEqual(locales.map((c) => c.id), ['CLAUDE.md', 'CLAUDE.local.md', 'docs/l-import.md'], 'le fichier du global n\'a pas de carte locale');
    const l = locales[2];
    assert.strictEqual(l.scope, 'local');
    assert.strictEqual(meta(l).claudeMemoryType, 'Project', 'un import du CLAUDE.local.md est Project (mesuré, CC40)');
    assert.deepStrictEqual(meta(l).claudeImport, { par: 'CLAUDE.local.md', niveau: 1, externe: false });
    assert.deepStrictEqual(meta(l).claudeReadOnly, { raison: 'Fichier importé' });
    assert.strictEqual(local.soulStat.activeCount, 3);
    assert.strictEqual(local.soulStat.tokenCount, somme(locales));

    // Les identifiants ne forment aucune paire de doublons avec une carte de l'autre colonne
    const { stats } = DuplicateService.detectDuplicates(global.items, local.items);
    assert.strictEqual(stats.totalDuplicates, 1, 'seule reste la paire de nom des deux CLAUDE.md');
  });

  test('14. Imports extérieurs : du projet vers le parent, et du parent vers son dossier ; le parent vers le projet est ordinaire', async () => {
    arborescence({
      'racine/CLAUDE.md': '# Parent\n\n@cible.md\n@projet/vers-projet.md\n',
      'racine/cible.md': 'Cible du parent.\n',
      'racine/ext.md': 'Fichier extérieur.\n',
      'racine/projet/vers-projet.md': 'Du parent vers le projet.\n',
      'racine/projet/CLAUDE.md': '# Projet\n\n@../ext.md\n',
    });
    const { local } = await scanner();
    const cartes = ames(local.items);
    assert.deepStrictEqual(cartes.map((c) => [c.id, meta(c).claudeImport?.externe ?? null, meta(c).claudeReadOnly?.raison ?? null]), [
      ['../CLAUDE.md', null, 'Fichier hors du projet'],
      ['CLAUDE.md', null, null],
      ['../cible.md', true, 'Fichier hors du projet'],
      ['vers-projet.md', false, 'Fichier importé'],
      ['../ext.md', true, 'Fichier hors du projet'],
    ]);
    // Les imports extérieurs sont comptés (D-7.3), et actifs
    assert.strictEqual(local.soulStat.activeCount, 5);
    assert.strictEqual(local.soulStat.tokenCount, somme(cartes));
  });

  test('15. Lecture seule : la bascule et la suppression d\'une carte d\'import sont refusées avec la bonne raison', async () => {
    arborescence({
      'racine/projet/CLAUDE.md': '# Projet\n\n@commun.md\n@../ext.md\n',
      'racine/projet/commun.md': TEXTE_COMMUN,
      'racine/ext.md': TEXTE_COMMUN,
    });
    const { local } = await scanner();
    const imp = ames(local.items).filter((c) => meta(c).claudeImport);
    assert.deepStrictEqual(imp.map((c) => [c.id, meta(c).claudeReadOnly.raison]), [['commun.md', 'Fichier importé'], ['../ext.md', 'Fichier hors du projet']]);
    for (const carte of imp) {
      assert.strictEqual(meta(carte).locked, true);
      const refus = getProtectedResourceRefusal(carte);
      assert.ok(refus && refus.startsWith(`${meta(carte).claudeReadOnly.raison} :`), `${carte.id} : refus qui cite la raison`);
      assert.strictEqual(isBulkToggleable(carte), false, `${carte.id} : hors des bascules en masse`);
      for (const etat of [false, true]) {
        const res = await ToggleManager.toggleItem(carte, etat);
        assert.strictEqual(res.success, false, `${carte.id} → ${etat} : bascule refusée`);
        assert.strictEqual(res.error, refus);
      }
      const suppression = await DeleteService.deleteResource(carte);
      assert.strictEqual(suppression.success, false, `${carte.id} : suppression refusée`);
      assert.strictEqual(suppression.error, refus);
      assert.strictEqual(fs.readFileSync(carte.path, 'utf8'), TEXTE_COMMUN, `${carte.id} : fichier inchangé`);
    }
    assert.deepStrictEqual(fs.readdirSync(PROJET).sort(), ['CLAUDE.md', 'commun.md'], 'aucun fichier renommé ni créé');
  });

  test('16. Le cinquième saut : carte « non chargé » à 0, présente mais non active', async () => {
    const fichiers: Record<string, string> = { 'racine/projet/CLAUDE.md': '# Projet\n\n@import-1.md\n' };
    for (let n = 1; n <= 5; n++) fichiers[`racine/projet/import-${n}.md`] = `Import de niveau ${n}.\n\n@import-${n + 1}.md\n`;
    arborescence(fichiers);
    const { local, contenusLus } = await scanner();
    const cartes = ames(local.items);
    assert.deepStrictEqual(cartes.map((c) => [c.id, meta(c).claudeImport?.niveau ?? 0, meta(c).claudeMemoryNotLoaded ?? null]), [
      ['CLAUDE.md', 0, null],
      ['import-1.md', 1, null], ['import-2.md', 2, null], ['import-3.md', 3, null], ['import-4.md', 4, null],
      ['import-5.md', 5, 'niveau-5'],
    ]);
    const cinq = cartes[5];
    assert.strictEqual(cinq.tokenCount, 0);
    assert.deepStrictEqual(meta(cinq).claudeImport, { par: 'import-4.md', niveau: 5, externe: false });
    assert.ok(!contenusLus.includes(path.join(PROJET, 'import-5.md')), 'le fichier du cinquième saut n\'est pas lu');
    assert.strictEqual(local.soulStat.activeCount, 5, 'la carte « non chargé » n\'est pas active');
    assert.strictEqual(local.soulStat.totalCount, 6);
    assert.strictEqual(local.soulStat.tokenCount, somme(cartes.slice(0, 5)));
  });

  test('17. Le rendu : cadenas qui nomme le fichier qui importe et le niveau ; aucun badge pour un import ordinaire, un badge pour l\'import extérieur et le cinquième saut', async () => {
    arborescence({
      'racine/projet/CLAUDE.md': '# Projet\n\n@commun.md\n@../ext.md\n@import-1.md\n',
      'racine/projet/commun.md': TEXTE_COMMUN,
      'racine/ext.md': TEXTE_COMMUN,
      'racine/projet/import-1.md': '@import-2.md\n',
      'racine/projet/import-2.md': '@import-3.md\n',
      'racine/projet/import-3.md': '@import-4.md\n',
      'racine/projet/import-4.md': '@import-5.md\n',
      'racine/projet/import-5.md': 'Niveau 5.\n',
    });
    const { local } = await scanner();
    const parId = new Map(ames(local.items).map((c) => [c.id, c]));

    // Un import ordinaire : aucun badge (ni « Importé par »), un cadenas qui nomme le fichier qui importe et le niveau
    const ordinaire = rendu(parId.get('commun.md')!);
    assert.deepStrictEqual(pastilles(ordinaire), [], 'aucun badge pour un import ordinaire');
    const cadenas = ordinaire.find((el) => el.className === 'soul-locked-badge')!;
    assert.ok(cadenas, 'cadenas');
    assert.strictEqual(cadenas.innerHTML, '', 'cadenas construit sans innerHTML');
    assert.deepStrictEqual(cadenas.children.map((c) => c.textContent), ['🔒', 'Lecture seule']);
    assert.ok(cadenas.title.startsWith('Fichier importé : carte en lecture seule.'), 'la raison en tête de l\'infobulle');
    assert.ok(cadenas.title.includes('Importé par CLAUDE.md (niveau 1)'), `fichier qui importe et niveau : ${cadenas.title}`);
    assert.ok(!ordinaire.some((el) => el.tagName === 'INPUT'), 'aucun interrupteur');
    assert.ok(!ordinaire.some((el) => el.tagName === 'BUTTON' && el.innerHTML === '🗑️'), 'aucune corbeille');

    // L'import extérieur : le badge de l'approbation, et son infobulle
    const exterieur = rendu(parId.get('../ext.md')!);
    assert.deepStrictEqual(pastilles(exterieur), ['🔐 Chargé seulement après approbation']);
    const badgeExt = exterieur.find((el) => el.textContent === '🔐 Chargé seulement après approbation')!;
    assert.ok(badgeExt.title.includes('en -p, non chargé tant qu\'il n\'est pas approuvé (mesuré)'), 'infobulle de l\'approbation');
    assert.ok(exterieur.find((el) => el.className === 'soul-locked-badge')!.title.startsWith('Fichier hors du projet : carte en lecture seule.'));

    // Le cinquième saut : son badge, et 0 au démarrage
    const cinq = rendu(parId.get('import-5.md')!);
    assert.deepStrictEqual(pastilles(cinq), ['🚫 Non chargé (5ᵉ niveau)']);
    assert.ok(cinq.find((el) => el.className === 'soul-locked-badge')!.title.includes('Importé par import-4.md (niveau 5)'));
    assert.ok(cinq.some((el) => el.innerHTML.includes('0 tok au boot')), 'métrique à 0 au démarrage');
  });

  test('18. Le bandeau, pour Claude Code seulement : « 🔐 N imports hors du projet »', async () => {
    arborescence({
      'racine/CLAUDE.md': '# Parent\n\n@cible.md\n',
      'racine/cible.md': 'Cible du parent.\n',
      'racine/ext.md': 'Fichier extérieur.\n',
      'racine/projet/CLAUDE.md': '# Projet\n\n@../ext.md\n@commun.md\n',
      'racine/projet/commun.md': TEXTE_COMMUN,
    });
    const { local, global } = await scanner();
    const etat = { workspace: { tool: 'claude-code' }, globalResources: global.items, localResources: local.items };
    const { doc, conteneur } = documentMinimal();
    main.renderClaudeImportsBanner(etat, doc);
    const bandeau = doc.getElementById('claudeImportsBanner');
    assert.ok(bandeau, 'bandeau créé');
    assert.strictEqual(bandeau.textContent, '🔐 2 imports hors du projet : chargés seulement après approbation dans Claude Code');
    assert.strictEqual(bandeau.innerHTML, '', 'texte posé sans innerHTML');
    assert.strictEqual(conteneur.children[1], bandeau, 'placé juste après le bandeau du banc d\'essai');
    // Un second rendu ne crée pas de second bandeau
    main.renderClaudeImportsBanner(etat, doc);
    assert.strictEqual(descendants(conteneur).filter((el) => el.id === 'claudeImportsBanner').length, 1);
    // Sans import extérieur, ou sous Antigravity, le bandeau disparaît
    main.renderClaudeImportsBanner({ ...etat, localResources: local.items.filter((i) => !meta(i).claudeImport?.externe) }, doc);
    assert.strictEqual(doc.getElementById('claudeImportsBanner'), null, 'aucun bandeau sans import extérieur');
    main.renderClaudeImportsBanner(etat, doc);
    main.renderClaudeImportsBanner({ ...etat, workspace: { tool: 'antigravity' } }, doc);
    assert.strictEqual(doc.getElementById('claudeImportsBanner'), null, 'aucun bandeau sous Antigravity');
    assert.deepStrictEqual(conteneur.children.map((c) => c.id || c.tagName), ['bancEssaiBanner', 'HEADER'], 'le document d\'Antigravity est intact');
    // Un seul import : accord au singulier
    main.renderClaudeImportsBanner({ ...etat, localResources: local.items.filter((i) => i.id !== '../cible.md') }, doc);
    assert.strictEqual(doc.getElementById('claudeImportsBanner').textContent, '🔐 1 import hors du projet : chargé seulement après approbation dans Claude Code');
  });

  test('19. Plus de 4 Mio : un fichier creux de 4 194 305 octets est ignoré sans être lu ; un de 4 194 304 octets est compté', async () => {
    arborescence({
      'racine/projet/CLAUDE.md': '# Projet\n\n@gros.md\n@limite.md\n',
      'racine/projet/enfant-gros.md': 'Enfant du gros fichier.\n',
      'racine/projet/enfant-limite.md': 'Enfant du fichier à la limite.\n',
    });
    const gros = fichierCreux('racine/projet/gros.md', '@enfant-gros.md\n', QUATRE_MIO + 1);
    const limite = fichierCreux('racine/projet/limite.md', '@enfant-limite.md\n', QUATRE_MIO);
    const { local, contenusLus } = await scanner();
    const cartes = ames(local.items);
    assert.deepStrictEqual(cartes.map((c) => [c.id, meta(c).claudeMemoryNotLoaded ?? null]), [
      ['CLAUDE.md', null],
      ['gros.md', 'plus-de-4-mio'],
      ['limite.md', null],
      ['enfant-limite.md', null],
    ], 'les imports du fichier de plus de 4 Mio ne sont pas développés');
    assert.ok(!contenusLus.includes(path.resolve(gros)), 'le fichier de plus de 4 Mio n\'est jamais lu (stat seulement)');
    assert.ok(contenusLus.includes(path.resolve(limite)), 'le fichier de 4 Mio est lu');
    const carteGros = cartes[1];
    assert.strictEqual(carteGros.tokenCount, 0);
    assert.strictEqual(local.soulStat.activeCount, 3, 'la carte de plus de 4 Mio n\'est pas active');
    assert.strictEqual(local.soulStat.warningCount, 1, 'un avertissement compté');
    assert.strictEqual(cartes[2].tokenCount, tokensInjectes(fs.readFileSync(limite, 'utf8')));
    assert.strictEqual(local.soulStat.tokenCount, somme(cartes));
    const badges = pastilles(rendu(carteGros));
    assert.deepStrictEqual(badges, ['⚠️ Plus de 4 Mio : ignoré par Claude Code (documentation)']);
  });

  test('20. Plus de 4 Mio : la règle vaut aussi pour un fichier de mémoire chargé (le CLAUDE.md du projet et le global)', async () => {
    arborescence({ 'racine/projet/enfant.md': 'Enfant.\n', 'claude/enfant-global.md': 'Enfant du global.\n' });
    const projet = fichierCreux('racine/projet/CLAUDE.md', '@enfant.md\n', QUATRE_MIO + 1);
    const globalMd = fichierCreux('claude/CLAUDE.md', '@enfant-global.md\n', QUATRE_MIO + 1);
    const { local, global, contenusLus } = await scanner();
    assert.deepStrictEqual(ames(local.items).map((c) => [c.id, c.tokenCount, meta(c).claudeMemoryNotLoaded ?? null]), [['CLAUDE.md', 0, 'plus-de-4-mio']]);
    assert.deepStrictEqual(ames(global.items).map((c) => [c.id, c.tokenCount, meta(c).claudeMemoryNotLoaded ?? null]), [['CLAUDE.md', 0, 'plus-de-4-mio']]);
    assert.ok(!contenusLus.includes(path.resolve(projet)) && !contenusLus.includes(path.resolve(globalMd)), 'aucun des deux n\'est lu');
    assert.strictEqual(local.soulStat.activeCount, 0);
    assert.strictEqual(local.soulStat.warningCount, 1);
    assert.strictEqual(global.soulStat.activeCount, 0);
    assert.strictEqual(global.soulStat.warningCount, 1);
    assert.strictEqual(local.soulStat.tokenCount + global.soulStat.tokenCount, 0);
  });

  test('21. Antigravity est inchangé : ses âmes n\'ont ni import développé ni marque de Claude Code', async () => {
    arborescence({
      // Racine Git à la racine : Antigravity remonte jusqu'à elle, et pas au-delà
      'racine/.git/HEAD': 'ref: refs/heads/main\n',
      'racine/projet/GEMINI.md': '# Âme Antigravity\n\n@commun.md\n',
      'racine/projet/commun.md': TEXTE_COMMUN,
      'racine/projet/CLAUDE.md': '# Projet\n\n@commun.md\n',
    });
    const { resultat, horsDossier } = await sousEspion([RACINE, AG_GLOBAL], async () => LocalScanner.scan(espace('antigravity')));
    assert.deepStrictEqual(horsDossier, []);
    const cartes = ames(resultat.items);
    assert.deepStrictEqual(cartes.map((c) => c.id), ['GEMINI.md']);
    assert.strictEqual(meta(cartes[0]).claudeImport, undefined);
    assert.strictEqual(meta(cartes[0]).claudeMemoryNotLoaded, undefined);
  });
});

// ====================================================================================================
// 3. Les imports vers un chemin réseau (revue d'avant le push) : ni stat ni lecture, carte à 0
// ====================================================================================================
//
// Un fichier de mémoire du niveau projet est choisi par le dépôt, qui n'est pas fiable : un import
// « @\\hôte\partage\x.md » ou « @//hôte/partage/x.md » ferait, au premier stat, une connexion vers l'hôte
// nommé (SMB ou WebDAV, avec une authentification automatique du compte : déduit, non vérifié), alors que
// Claude Code ne charge un import extérieur qu'après approbation (documentation ; non chargé en -p, mesuré).
// Sous Windows, un import extérieur dont le chemin résolu commence par « \\ » ou « // » (\\?\ et \\.\
// compris), ou par le préfixe « \??\ » (toutes barres), a donc une carte « chemin réseau » à 0, sans aucun accès. Les imports du CLAUDE.md global, choisis
// par l'utilisateur, ne sont pas concernés, ni un import situé dans un espace ouvert sur un partage.

/** Les trois formes de l'attaque, telles qu'écrites dans un CLAUDE.md. */
const IMPORTS_RESEAU = [String.raw`@\\hote\partage\a.md`, '@//hote/partage/b.md', String.raw`@\\?\UNC\hote\partage\c.md`];

describe('Imports de la mémoire de Claude Code : chemins réseau', () => {
  /** Un port qui note chaque appel, avec son chemin ; aucun accès au disque ni au réseau. */
  const portEspion = (fichiers: Record<string, string>) => {
    const appels: string[] = [];
    return {
      appels,
      port: {
        fileSize: (p: string) => { appels.push(`fileSize ${p}`); return p in fichiers ? Buffer.byteLength(fichiers[p]) : null; },
        readText: (p: string) => { appels.push(`readText ${p}`); return p in fichiers ? fichiers[p] : null; },
        key: (p: string) => { appels.push(`key ${p}`); return p.toLowerCase(); },
      },
    };
  };
  /** Les appels du port (ou de fs) sur une forme interdite ; l'espace des tests purs est sur la lettre C:. */
  const reseau = (appels: string[]) => appels.filter((a) => estFormeInterditeWin32(a.slice(a.indexOf(' ') + 1), 'c'));

  test('22. Sous Windows, un import extérieur vers un chemin réseau n\'est ni stat ni lu : entrée « chemin-reseau » à 0', () => {
    const { expandClaudeImports } = imports();
    const w = path.win32;
    const global = String.raw`C:\Users\moi\.claude\CLAUDE.md`;
    const projet = String.raw`C:\espace\projet\CLAUDE.md`;
    const importGlobal = String.raw`\\hote\global\g.md`;
    const { port: p, appels } = portEspion({
      [importGlobal]: 'Choisi par l\'utilisateur.\n',
      [String.raw`C:\espace\projet\commun.md`]: 'Commun.\n',
    });
    const entrees = expandClaudeImports([
      { path: global, text: `@${importGlobal}\n`, projectLevel: false },
      { path: projet, text: [...IMPORTS_RESEAU, String.raw`@\\hote\partage\a.md`, '@commun.md', ''].join('\n'), projectLevel: true },
    ], { cwd: String.raw`C:\espace\projet`, home: String.raw`C:\Users\moi`, seen: new Set([global.toLowerCase(), projet.toLowerCase()]), pathApi: w }, p);

    assert.deepStrictEqual(entrees.map((e: any) => [e.path, e.etat, e.externe, e.niveau, e.size, e.raw === null, e.text === null]), [
      [importGlobal, 'charge', false, 1, Buffer.byteLength('Choisi par l\'utilisateur.\n'), false, false],
      [String.raw`\\hote\partage\a.md`, 'chemin-reseau', true, 1, 0, true, true],
      [String.raw`\\hote\partage\b.md`, 'chemin-reseau', true, 1, 0, true, true],
      [String.raw`\\?\UNC\hote\partage\c.md`, 'chemin-reseau', true, 1, 0, true, true],
      [String.raw`C:\espace\projet\commun.md`, 'charge', false, 1, Buffer.byteLength('Commun.\n'), false, false],
    ], 'une seule entrée par chemin réseau, au premier rencontré');
    assert.deepStrictEqual(reseau(appels), [`fileSize ${importGlobal}`, `key ${importGlobal}`, `readText ${importGlobal}`],
      'seul l\'import du CLAUDE.md global, choisi par l\'utilisateur, est consulté');

    // Un espace ouvert sur un partage réseau : ses imports internes restent lus ; un autre hôte, non
    const cwdReseau = String.raw`\\serveur\equipe\projet`;
    const racineReseau = String.raw`\\serveur\equipe\projet\CLAUDE.md`;
    const notes = String.raw`\\serveur\equipe\projet\notes.md`;
    const espion2 = portEspion({ [notes]: 'Notes.\n' });
    const entrees2 = expandClaudeImports(
      [{ path: racineReseau, text: '@notes.md\n@//hote/partage/b.md\n', projectLevel: true }],
      { cwd: cwdReseau, home: String.raw`C:\Users\moi`, seen: new Set([racineReseau.toLowerCase()]), pathApi: w },
      espion2.port,
    );
    assert.deepStrictEqual(entrees2.map((e: any) => [e.path, e.etat, e.externe]), [
      [notes, 'charge', false],
      [String.raw`\\hote\partage\b.md`, 'chemin-reseau', true],
    ]);
    assert.ok(!espion2.appels.some((a) => a.toLowerCase().includes(String.raw`\\hote\partage`)), 'l\'autre hôte n\'est pas consulté');
  });

  test('23. La carte « 🌐 Chemin réseau : non lu » : 0 token, lecture seule, non active, avec la mention de l\'approbation', async () => {
    const entree = {
      path: String.raw`\\hote\partage\a.md`, key: String.raw`\\hote\partage\a.md`, importer: path.join(PROJET, 'CLAUDE.md'),
      niveau: 1, externe: true, etat: 'chemin-reseau', size: 0, raw: null, text: null,
    };
    const { resultat: cartes, horsDossier } = await sousEspion([], async () =>
      buildClaudeImportItems([entree as any], { scope: 'local', claudeMemoryType: 'Project', labelBase: { cwd: PROJET }, cwdKey: PROJET.toLowerCase() }));
    assert.deepStrictEqual(horsDossier, [], 'la carte est construite sans aucun accès');
    const carte = cartes[0];
    assert.deepStrictEqual([carte.tokenCount, carte.charCount, carte.lineCount], [0, 0, 0]);
    assert.strictEqual(meta(carte).claudeMemoryNotLoaded, 'chemin-reseau');
    assert.strictEqual(meta(carte).locked, true);
    assert.deepStrictEqual(meta(carte).claudeReadOnly, { raison: 'Fichier hors du projet' });
    assert.deepStrictEqual(meta(carte).claudeImport, { par: 'CLAUDE.md', niveau: 1, externe: true });
    assert.strictEqual(isClaudeMemoryNotLoaded(carte), true, 'non active : hors du total de l\'Âme');

    const tous = rendu(carte);
    assert.deepStrictEqual(pastilles(tous), ['🌐 Chemin réseau : non lu']);
    const badge = tous.find((el) => el.textContent === '🌐 Chemin réseau : non lu')!;
    assert.ok(badge.title.includes('chargé par Claude Code seulement après approbation'), `infobulle : ${badge.title}`);
    assert.ok(tous.some((el) => el.innerHTML.includes('0 tok au boot')), 'métrique à 0 au démarrage');
    assert.ok(tous.some((el) => el.title.includes('chemin réseau')), 'l\'infobulle de la métrique nomme le chemin réseau');

    // Le bandeau compte la carte réseau, chargée par Claude Code après approbation ; les cartes extérieures
    // du cinquième saut et de plus de 4 Mio restent hors du compte
    const autres = buildClaudeImportItems([
      { ...entree, path: path.join(DOSSIER, 'cinq.md'), key: 'cinq', niveau: 5, etat: 'niveau-5' },
      { ...entree, path: path.join(DOSSIER, 'gros.md'), key: 'gros', etat: 'plus-de-4-mio', size: 4194305 },
    ] as any[], { scope: 'local', claudeMemoryType: 'Project', labelBase: { cwd: PROJET }, cwdKey: PROJET.toLowerCase() });
    const etat = { workspace: { tool: 'claude-code' }, globalResources: [], localResources: [carte, ...autres] };
    const { doc } = documentMinimal();
    main.renderClaudeImportsBanner(etat, doc);
    const bandeau = doc.getElementById('claudeImportsBanner');
    assert.ok(bandeau, 'bandeau créé pour la seule carte réseau');
    assert.strictEqual(bandeau.textContent, '🔐 1 import hors du projet : chargé seulement après approbation dans Claude Code');
    main.renderClaudeImportsBanner({ ...etat, localResources: autres }, doc);
    assert.strictEqual(doc.getElementById('claudeImportsBanner'), null, 'cinquième saut et plus de 4 Mio hors du compte');
  });

  test('24. Le scan d\'un CLAUDE.md du projet qui importe trois chemins réseau : aucun accès, trois cartes à 0, aucun observateur', {
    skip: process.platform !== 'win32' ? 'la règle des chemins réseau ne vaut que sous Windows (les tests 22 et 23 la couvrent ailleurs)' : false,
  }, async () => {
    preparerDossier();
    try {
      arborescence({
        'racine/projet/CLAUDE.md': ['# Projet', '', ...IMPORTS_RESEAU, '@commun.md', ''].join('\n'),
        'racine/projet/commun.md': TEXTE_COMMUN,
      });
      const { resultat, horsDossier } = await sousEspion([RACINE, CLAUDE_GLOBAL, AG_GLOBAL], async () => ({
        local: await LocalScanner.scan(espace(), undefined, { claudeMemoryStopAt: RACINE }),
        global: await GlobalScanner.scan(AG_GLOBAL, 'claude-code'),
      }));
      assert.deepStrictEqual(reseau(horsDossier), [], 'aucun appel de fs sur un chemin qui commence par \\\\ ou //');
      assert.deepStrictEqual(horsDossier, [], 'aucune lecture hors du dossier d\'arrêt et des profils simulés');

      const cartes = ames(resultat.local.items);
      const cartesReseau = cartes.filter((c) => meta(c).claudeMemoryNotLoaded === 'chemin-reseau');
      assert.deepStrictEqual(cartesReseau.map((c) => [c.id, c.tokenCount, meta(c).claudeImport?.externe]), [
        ['//hote/partage/a.md', 0, true],
        ['//hote/partage/b.md', 0, true],
        ['//?/UNC/hote/partage/c.md', 0, true],
      ]);
      assert.strictEqual(resultat.local.soulStat.activeCount, 2, 'CLAUDE.md et commun.md seulement');
      assert.strictEqual(resultat.local.soulStat.tokenCount, somme(cartes.filter((c) => !isClaudeMemoryNotLoaded(c))));

      const etat = {
        workspace: espace(), localResources: resultat.local.items, globalResources: resultat.global.items, nasResources: [], stats: {},
      } as unknown as ManagerFullState;
      const cibles = claudeWatchTargets(etat, { globalPath: CLAUDE_GLOBAL, gitEntry: () => null, stopAt: RACINE });
      assert.deepStrictEqual(cibles.filter((c) => estCheminInterdit(c)), [], 'aucun observateur pour un chemin réseau');
      assert.ok(cibles.includes(path.join(PROJET, 'commun.md')), 'l\'import ordinaire reste observé');
    } finally {
      if (fs.existsSync(DOSSIER)) viderSaufTemoin();
    }
  });

  test('25. Sous Windows, un import extérieur à préfixe NT, toutes barres, n\'est ni consulté ni lu : entrée « chemin-reseau » à 0', () => {
    const { expandClaudeImports, isClaudeNetworkPath } = imports();
    const w = path.win32;
    const cwd = String.raw`C:\espace\projet`;
    const projet = w.join(cwd, 'CLAUDE.md');
    const commun = w.join(cwd, 'commun.md');
    const { port: p, appels } = portEspion({ [commun]: 'Commun.\n' });
    const texte = [
      String.raw`@\??\UNC\hote\partage\t.md`, '@/??/UNC/hote/t2.md', String.raw`@\??/UNC/hote/t3.md`,
      String.raw`@\??\Z:\v.md`, String.raw`@\??\C:\espace\projet\w.md`, '@commun.md', '',
    ].join('\n');
    const entrees = expandClaudeImports([{ path: projet, text: texte, projectLevel: true }],
      { cwd, home: String.raw`C:\Users\moi`, seen: new Set([projet.toLowerCase()]), pathApi: w }, p);

    assert.deepStrictEqual(reseau(appels), [], 'aucune fonction du port n\'est appelée sur un chemin à préfixe NT');
    assert.deepStrictEqual(entrees.map((e: any) => [e.path, e.etat, e.externe, e.niveau, e.size, e.raw === null, e.text === null]), [
      [String.raw`\??\UNC\hote\partage\t.md`, 'chemin-reseau', true, 1, 0, true, true],
      [String.raw`\??\UNC\hote\t2.md`, 'chemin-reseau', true, 1, 0, true, true],
      [String.raw`\??\UNC\hote\t3.md`, 'chemin-reseau', true, 1, 0, true, true],
      [String.raw`\??\Z:\v.md`, 'chemin-reseau', true, 1, 0, true, true],
      [String.raw`\??\C:\espace\projet\w.md`, 'chemin-reseau', true, 1, 0, true, true],
      [commun, 'charge', false, 1, Buffer.byteLength('Commun.\n'), false, false],
    ], 'les barres sont unifiées ; le préfixe devant une lettre locale reçoit la même carte');
    assert.strictEqual(isClaudeNetworkPath(String.raw`\??\UNC\hote\t.md`, w), true);
    assert.strictEqual(isClaudeNetworkPath('/??/UNC/hote/t.md', path.posix), false, 'toujours faux hors de Windows');
  });

  test('26. Le scan d\'un CLAUDE.md du projet qui importe un chemin à préfixe NT : aucun accès, carte réseau à 0, aucun observateur', {
    skip: process.platform !== 'win32' ? 'la règle des chemins réseau ne vaut que sous Windows (le test 25 la couvre ailleurs)' : false,
  }, async () => {
    preparerDossier();
    try {
      arborescence({
        'racine/projet/CLAUDE.md': ['# Projet', '', String.raw`@\??\UNC\hote\partage\t.md`, '@/??/UNC/hote/t2.md', '@commun.md', ''].join('\n'),
        'racine/projet/commun.md': TEXTE_COMMUN,
      });
      const { resultat, horsDossier } = await sousEspion([RACINE, CLAUDE_GLOBAL, AG_GLOBAL], async () => ({
        local: await LocalScanner.scan(espace(), undefined, { claudeMemoryStopAt: RACINE }),
        global: await GlobalScanner.scan(AG_GLOBAL, 'claude-code'),
      }));
      assert.deepStrictEqual(horsDossier.filter((a) => estCheminInterdit(a.slice(a.indexOf(' ') + 1))), [],
        'aucun appel de fs sur un chemin à préfixe NT');
      assert.deepStrictEqual(horsDossier, [], 'aucune lecture hors du dossier d\'arrêt et des profils simulés');

      const cartes = ames(resultat.local.items);
      const cartesReseau = cartes.filter((c) => meta(c).claudeMemoryNotLoaded === 'chemin-reseau');
      assert.deepStrictEqual(cartesReseau.map((c) => [c.path, c.tokenCount, meta(c).claudeImport?.externe]), [
        [String.raw`\??\UNC\hote\partage\t.md`, 0, true],
        [String.raw`\??\UNC\hote\t2.md`, 0, true],
      ]);
      assert.strictEqual(resultat.local.soulStat.activeCount, 2, 'CLAUDE.md et commun.md seulement');
      assert.strictEqual(resultat.local.soulStat.tokenCount, somme(cartes.filter((c) => !isClaudeMemoryNotLoaded(c))));

      const etat = {
        workspace: espace(), localResources: resultat.local.items, globalResources: resultat.global.items, nasResources: [], stats: {},
      } as unknown as ManagerFullState;
      const cibles = claudeWatchTargets(etat, { globalPath: CLAUDE_GLOBAL, gitEntry: () => null, stopAt: RACINE });
      assert.deepStrictEqual(cibles.filter((c) => c.includes('??')), [], 'aucun observateur pour un chemin à préfixe NT');
      assert.ok(cibles.includes(path.join(PROJET, 'commun.md')), 'l\'import ordinaire reste observé');
    } finally {
      if (fs.existsSync(DOSSIER)) viderSaufTemoin();
    }
  });
});

// ====================================================================================================
// 4. Les imports hors des dossiers admis : ni stat ni lecture, carte « non lu » à 0
// ====================================================================================================
//
// Un import extérieur d'un fichier de mémoire du projet ou d'un dossier parent n'est consulté que s'il est
// dans le dossier de travail, sous le dossier personnel, ou dans un dossier admis : sous Windows, sur le même
// lecteur que le dossier de travail ; ailleurs, sous un dossier parent du dossier de travail autre que « / ».
// Sinon, il a une entrée « hors-perimetre » à 0, sans aucun accès ni développement. Un chemin enraciné sans
// lettre de lecteur se résout sur la lettre du fichier qui importe. Les imports du CLAUDE.md global ne sont pas
// concernés.

describe('Imports de la mémoire de Claude Code : imports hors des dossiers admis', () => {
  /** Un port qui note chaque appel, avec son chemin ; aucun accès au disque ni au réseau. */
  const portEspion = (fichiers: Record<string, string>) => {
    const appels: string[] = [];
    return {
      appels,
      port: {
        fileSize: (p: string) => { appels.push(`fileSize ${p}`); return p in fichiers ? Buffer.byteLength(fichiers[p]) : null; },
        readText: (p: string) => { appels.push(`readText ${p}`); return p in fichiers ? fichiers[p] : null; },
        key: (p: string) => { appels.push(`key ${p}`); return p.toLowerCase(); },
      },
    };
  };
  const chemins = (appels: string[]) => appels.map((a) => a.slice(a.indexOf(' ') + 1));
  const w = path.win32;
  const MOI = String.raw`C:\Users\moi`;
  const ESPACE = String.raw`C:\espace\projet`;
  const lignes = (...liste: string[]) => [...liste, ''].join('\n');
  const resume = (entrees: any[]) => entrees.map((e) => [e.path, e.etat, e.externe, e.niveau, e.size]);

  test('27. Sous Windows, un import extérieur vers un autre lecteur, hors du dossier personnel, n\'est ni consulté ni lu : entrée « hors-perimetre » à 0', () => {
    const { expandClaudeImports } = imports();
    const projet = w.join(ESPACE, 'CLAUDE.md');
    const { port: p, appels } = portEspion({
      [String.raw`C:\Users\moi\i.md`]: 'Personnel.\n',
      [String.raw`C:\espace\p.md`]: 'Parent.\n',
      [String.raw`C:\l.md`]: 'Racine du lecteur.\n',
      [String.raw`c:\ESPACE\Projet\interne.md`]: 'Interne.\n',
      [String.raw`C:\espace\projet\commun.md`]: 'Commun.\n',
    });
    const entrees = expandClaudeImports([{
      path: projet, projectLevel: true,
      text: lignes(String.raw`@Z:\f.md`, '@Z:/g.md', '@z:h.md', '@Z:', '@~/i.md', '@../p.md', '@../../l.md', String.raw`@c:\ESPACE\Projet\interne.md`, '@commun.md'),
    }], { cwd: ESPACE, home: MOI, seen: new Set([projet.toLowerCase()]), pathApi: w }, p);

    assert.deepStrictEqual(chemins(appels).filter((c) => estFormeInterditeWin32(c, 'c')), [], 'aucune fonction du port n\'est appelée sur un autre lecteur');
    assert.deepStrictEqual(resume(entrees), [
      [String.raw`Z:\f.md`, 'hors-perimetre', true, 1, 0],
      [String.raw`Z:\g.md`, 'hors-perimetre', true, 1, 0],
      [String.raw`z:\h.md`, 'hors-perimetre', true, 1, 0],
      ['Z:\\', 'hors-perimetre', true, 1, 0],
      [String.raw`C:\Users\moi\i.md`, 'charge', true, 1, Buffer.byteLength('Personnel.\n')],
      [String.raw`C:\espace\p.md`, 'charge', true, 1, Buffer.byteLength('Parent.\n')],
      [String.raw`C:\l.md`, 'charge', true, 1, Buffer.byteLength('Racine du lecteur.\n')],
      [String.raw`c:\ESPACE\Projet\interne.md`, 'charge', false, 1, Buffer.byteLength('Interne.\n')],
      [String.raw`C:\espace\projet\commun.md`, 'charge', false, 1, Buffer.byteLength('Commun.\n')],
    ], 'le dossier personnel, un parent et la racine du même lecteur restent lus, sans tenir compte de la casse');
    assert.ok(entrees.filter((e: any) => e.etat === 'hors-perimetre').every((e: any) => e.raw === null && e.text === null), 'rien n\'est lu');
  });

  test('28. La règle vaut à chaque saut : un fichier lu sous le dossier personnel n\'en fait consulter aucun autre hors des dossiers admis', () => {
    const { expandClaudeImports } = imports();
    const projet = w.join(ESPACE, 'CLAUDE.md');
    const admis = String.raw`C:\Users\moi\admis.md`;
    const { port: p, appels } = portEspion({
      [admis]: lignes(String.raw`@Z:\f3.md`, String.raw`@\??\UNC\hote\t3.md`, '@../../../racine.md'),
      [String.raw`C:\racine.md`]: 'Racine.\n',
    });
    const entrees = expandClaudeImports([{ path: projet, text: lignes('@~/admis.md'), projectLevel: true }],
      { cwd: ESPACE, home: MOI, seen: new Set([projet.toLowerCase()]), pathApi: w }, p);
    assert.deepStrictEqual(chemins(appels).filter((c) => estFormeInterditeWin32(c, 'c')), []);
    assert.deepStrictEqual(entrees.map((e: any) => [e.path, e.niveau, e.etat, e.externe]), [
      [admis, 1, 'charge', true],
      [String.raw`Z:\f3.md`, 2, 'hors-perimetre', true],
      [String.raw`\??\UNC\hote\t3.md`, 2, 'chemin-reseau', true],
      [String.raw`C:\racine.md`, 2, 'charge', true],
    ]);
  });

  test('29. Un espace sur un autre lecteur ou sur un partage : le dossier personnel reste lu ; un autre lecteur ne l\'est pas', () => {
    const { expandClaudeImports } = imports();
    // Espace sur D:, dossier personnel sur C:
    const cwdD = String.raw`D:\espace\projet`;
    const projetD = w.join(cwdD, 'CLAUDE.md');
    const espionD = portEspion({
      [String.raw`C:\Users\moi\i.md`]: 'Personnel.\n',
      [String.raw`D:\l.md`]: 'Racine de D.\n',
    });
    const entreesD = expandClaudeImports([{
      path: projetD, projectLevel: true,
      text: lignes('@~/i.md', String.raw`@C:\autre\y.md`, '@../../l.md', String.raw`@Z:\f.md`, String.raw`@C:\espace\projet\interne.md`),
    }], { cwd: cwdD, home: MOI, seen: new Set([projetD.toLowerCase()]), pathApi: w }, espionD.port);
    assert.deepStrictEqual(chemins(espionD.appels).filter((c) => estFormeInterditeWin32(c, 'd') && !c.toLowerCase().startsWith(MOI.toLowerCase())), [],
      'seuls D: et le dossier personnel sont consultés');
    assert.deepStrictEqual(entreesD.map((e: any) => [e.path, e.etat]), [
      [String.raw`C:\Users\moi\i.md`, 'charge'],
      [String.raw`C:\autre\y.md`, 'hors-perimetre'],
      [String.raw`D:\l.md`, 'charge'],
      [String.raw`Z:\f.md`, 'hors-perimetre'],
      [String.raw`C:\espace\projet\interne.md`, 'hors-perimetre'],
    ]);

    // Espace sur un partage : ses imports internes restent lus, le dossier personnel aussi ; un lecteur, non
    const cwdP = String.raw`\\serveur\equipe\projet`;
    const projetP = w.join(cwdP, 'CLAUDE.md');
    const espionP = portEspion({
      [String.raw`\\serveur\equipe\projet\notes.md`]: 'Notes.\n',
      [String.raw`C:\Users\moi\i.md`]: 'Personnel.\n',
    });
    const entreesP = expandClaudeImports([{
      path: projetP, projectLevel: true, text: lignes('@notes.md', '@~/i.md', String.raw`@C:\autre\y.md`, '@../p.md'),
    }], { cwd: cwdP, home: MOI, seen: new Set([projetP.toLowerCase()]), pathApi: w }, espionP.port);
    assert.deepStrictEqual(entreesP.map((e: any) => [e.path, e.etat]), [
      [String.raw`\\serveur\equipe\projet\notes.md`, 'charge'],
      [String.raw`C:\Users\moi\i.md`, 'charge'],
      [String.raw`C:\autre\y.md`, 'hors-perimetre'],
      [String.raw`\\serveur\equipe\p.md`, 'chemin-reseau'],
    ]);
    assert.ok(!chemins(espionP.appels).some((c) => /^c:\\autre/i.test(c) || /^\\\\serveur\\equipe\\p\.md$/i.test(c)),
      'ni l\'autre lecteur ni le chemin réseau extérieur ne sont consultés');
  });

  test('30. Les imports du CLAUDE.md global restent lus, sur tout lecteur et sous toute forme', () => {
    const { expandClaudeImports } = imports();
    const globalMd = String.raw`C:\Users\moi\.claude\CLAUDE.md`;
    const { port: p, appels } = portEspion({ [String.raw`Z:\g.md`]: 'Global.\n', [String.raw`\??\UNC\hote\g2.md`]: 'Global 2.\n' });
    const entrees = expandClaudeImports([{ path: globalMd, text: lignes(String.raw`@Z:\g.md`, String.raw`@\??\UNC\hote\g2.md`), projectLevel: false }],
      { cwd: ESPACE, home: MOI, seen: new Set([globalMd.toLowerCase()]), pathApi: w }, p);
    assert.deepStrictEqual(entrees.map((e: any) => [e.path, e.etat, e.externe]), [
      [String.raw`Z:\g.md`, 'charge', false],
      [String.raw`\??\UNC\hote\g2.md`, 'charge', false],
    ]);
    assert.ok(appels.includes(String.raw`fileSize Z:\g.md`), 'le fichier choisi par l\'utilisateur est consulté');
  });

  test('31. La carte « 💽 Hors des dossiers admis : non lu » : 0 token, lecture seule, non active, libellé absolu, sans observateur, comptée au bandeau', async () => {
    const importeur = path.join(PROJET, 'CLAUDE.md');
    const base = { importer: importeur, niveau: 1, externe: true, size: 0, raw: null, text: null };
    const entrees = [
      { ...base, path: String.raw`Z:\f.md`, key: String.raw`z:\f.md`, etat: 'hors-perimetre' },
      { ...base, path: String.raw`\??\UNC\hote\partage\t.md`, key: String.raw`\??\unc\hote\partage\t.md`, etat: 'chemin-reseau' },
      { ...base, path: path.join(DOSSIER, 'cinq.md'), key: 'cinq', niveau: 5, externe: false, etat: 'niveau-5' },
    ];
    const { resultat: cartes, horsDossier } = await sousEspion([], async () =>
      buildClaudeImportItems(entrees as any[], { scope: 'local', claudeMemoryType: 'Project', labelBase: { cwd: PROJET }, cwdKey: PROJET.toLowerCase() }));
    assert.deepStrictEqual(horsDossier, [], 'les cartes sont construites sans aucun accès');
    const [hors, reseauNt] = cartes;
    assert.deepStrictEqual([hors.id, hors.name, reseauNt.id], ['Z:/f.md', 'Z:/f.md', '/??/UNC/hote/partage/t.md'],
      'le libellé d\'une carte non consultée est son chemin absolu, en barres obliques, quel que soit le dossier de travail');
    assert.deepStrictEqual([hors.tokenCount, hors.charCount, hors.lineCount], [0, 0, 0]);
    assert.strictEqual(meta(hors).claudeMemoryNotLoaded, 'hors-perimetre');
    assert.strictEqual(meta(hors).locked, true);
    assert.deepStrictEqual(meta(hors).claudeReadOnly, { raison: 'Fichier hors du projet' });
    assert.deepStrictEqual(meta(hors).claudeImport, { par: 'CLAUDE.md', niveau: 1, externe: true });
    assert.strictEqual(isClaudeMemoryNotLoaded(hors), true, 'non active : hors du total de l\'Âme');

    const tous = rendu(hors);
    assert.deepStrictEqual(pastilles(tous), ['💽 Hors des dossiers admis : non lu']);
    const badge = tous.find((el) => el.textContent === '💽 Hors des dossiers admis : non lu')!;
    assert.strictEqual(badge.title,
      'L\'extension ne lit pas ce fichier : il est hors du dossier de travail, du dossier personnel et de leurs dossiers admis. ' +
      'Claude Code le charge seulement après approbation (en -p, non chargé tant qu\'il n\'est pas approuvé, mesuré). ' +
      'Compté 0 ; ses imports ne sont pas développés.');
    assert.ok(tous.some((el) => el.innerHTML.includes('0 tok au boot')), 'métrique à 0 au démarrage');
    assert.ok(tous.some((el) => el.title.startsWith('Coût au démarrage : 0 token') && el.title.includes('hors des dossiers admis')), 'infobulle de la métrique');

    // Le bandeau compte la carte « non lu » et la carte réseau ; le cinquième saut reste hors du compte
    const etat = { workspace: { tool: 'claude-code', workspacePath: PROJET }, globalResources: [], localResources: cartes, stats: {} };
    const { doc } = documentMinimal();
    main.renderClaudeImportsBanner(etat, doc);
    assert.strictEqual(doc.getElementById('claudeImportsBanner').textContent, '🔐 2 imports hors du projet : chargés seulement après approbation dans Claude Code');

    // Aucune des deux n'a d'observateur
    const cibles = claudeWatchTargets(etat as unknown as ManagerFullState, { globalPath: CLAUDE_GLOBAL, gitEntry: () => null });
    assert.deepStrictEqual(cibles.filter((c) => c.includes('f.md') || c.includes('??')), [], 'aucun observateur pour une carte non consultée');
  });

  test('32. Le scan d\'un CLAUDE.md du projet qui importe un autre lecteur et un chemin à préfixe NT : aucun accès, deux cartes à 0, aucun observateur', {
    skip: process.platform !== 'win32' ? 'la règle des lecteurs ne vaut que sous Windows (les tests 27 à 31 la couvrent ailleurs)' : false,
  }, async () => {
    const lettre = [...'QRSTUVWXY'].find((l) => !LETTRES_ADMISES.has(l.toLowerCase()))!;
    const autre = `${lettre}:\\f.md`;
    preparerDossier();
    try {
      arborescence({
        'racine/projet/CLAUDE.md': ['# Projet', '', `@${autre}`, String.raw`@\??\UNC\hote\t.md`, '@commun.md', ''].join('\n'),
        'racine/projet/commun.md': TEXTE_COMMUN,
      });
      const { resultat, horsDossier } = await sousEspion([RACINE, CLAUDE_GLOBAL, AG_GLOBAL], async () => ({
        local: await LocalScanner.scan(espace(), undefined, { claudeMemoryStopAt: RACINE }),
        global: await GlobalScanner.scan(AG_GLOBAL, 'claude-code'),
      }));
      assert.deepStrictEqual(horsDossier, [], 'aucun appel de fs hors du dossier d\'arrêt et des profils simulés');

      const cartes = ames(resultat.local.items);
      const nonLues = cartes.filter((c) => isClaudeMemoryNotLoaded(c));
      assert.deepStrictEqual(nonLues.map((c) => [c.id, c.path, c.tokenCount, meta(c).claudeMemoryNotLoaded, meta(c).claudeImport?.externe]), [
        [`${lettre}:/f.md`, autre, 0, 'hors-perimetre', true],
        ['/??/UNC/hote/t.md', String.raw`\??\UNC\hote\t.md`, 0, 'chemin-reseau', true],
      ]);
      assert.strictEqual(resultat.local.soulStat.activeCount, 2, 'CLAUDE.md et commun.md seulement');
      assert.strictEqual(resultat.local.soulStat.tokenCount, somme(cartes.filter((c) => !isClaudeMemoryNotLoaded(c))));

      const etat = {
        workspace: espace(), localResources: resultat.local.items, globalResources: resultat.global.items, nasResources: [], stats: {},
      } as unknown as ManagerFullState;
      const cibles = claudeWatchTargets(etat, { globalPath: CLAUDE_GLOBAL, gitEntry: () => null, stopAt: RACINE });
      assert.deepStrictEqual(cibles.filter((c) => c.includes('f.md') || c.includes('??')), [], 'aucun observateur pour une carte non consultée');
      assert.ok(cibles.includes(path.join(PROJET, 'commun.md')), 'l\'import ordinaire reste observé');
      const { doc } = documentMinimal();
      main.renderClaudeImportsBanner(etat, doc);
      assert.strictEqual(doc.getElementById('claudeImportsBanner').textContent, '🔐 2 imports hors du projet : chargés seulement après approbation dans Claude Code');
    } finally {
      if (fs.existsSync(DOSSIER)) viderSaufTemoin();
    }
  });

  test('33. Hors de Windows, un import extérieur n\'est consulté que dans l\'espace, sous le dossier personnel ou sous un parent autre que « / »', () => {
    const { expandClaudeImports } = imports();
    const x = path.posix;
    const cwd = '/srv/espace/projet';
    const projet = x.join(cwd, 'CLAUDE.md');
    const { port: p, appels } = portEspion({
      '/home/moi/i.md': 'Personnel.\n',
      '/srv/espace/p.md': 'Parent.\n',
      '/srv/q.md': 'Parent le plus haut.\n',
      '/srv/espace/projet/commun.md': 'Commun.\n',
    });
    const entrees = expandClaudeImports([{
      path: projet, projectLevel: true,
      text: lignes('@/net/hote/x.md', '@/Volumes/NAS/x.md', '@/mnt/nas/x.md', '@//hote/y.md', '@~/i.md', '@../p.md', '@../../q.md', '@../../../r.md', '@commun.md'),
    }], { cwd, home: '/home/moi', seen: new Set([projet.toLowerCase()]), pathApi: x }, p);
    const nonLus = ['/net/hote/x.md', '/Volumes/NAS/x.md', '/mnt/nas/x.md', '/hote/y.md', '/r.md'];
    assert.deepStrictEqual(chemins(appels).filter((c) => nonLus.includes(c)), [], 'aucune fonction du port n\'est appelée sur eux');
    assert.deepStrictEqual(resume(entrees), [
      ['/net/hote/x.md', 'hors-perimetre', true, 1, 0],
      ['/Volumes/NAS/x.md', 'hors-perimetre', true, 1, 0],
      ['/mnt/nas/x.md', 'hors-perimetre', true, 1, 0],
      ['/hote/y.md', 'hors-perimetre', true, 1, 0],
      ['/home/moi/i.md', 'charge', true, 1, Buffer.byteLength('Personnel.\n')],
      ['/srv/espace/p.md', 'charge', true, 1, Buffer.byteLength('Parent.\n')],
      ['/srv/q.md', 'charge', true, 1, Buffer.byteLength('Parent le plus haut.\n')],
      ['/r.md', 'hors-perimetre', true, 1, 0],
      ['/srv/espace/projet/commun.md', 'charge', false, 1, Buffer.byteLength('Commun.\n')],
    ], '« / » seul n\'admet rien');
  });

  test('34. Sous Windows, un chemin enraciné sans lettre se résout sur la lettre du fichier qui importe', () => {
    const { resolveClaudeImport, expandClaudeImports } = imports();
    const d = String.raw`D:\espace\projet`;
    assert.strictEqual(resolveClaudeImport(String.raw`\n.md`, d, MOI, w), String.raw`D:\n.md`);
    assert.strictEqual(resolveClaudeImport('/o.md', d, MOI, w), String.raw`D:\o.md`);
    assert.strictEqual(resolveClaudeImport(String.raw`\??\UNC\hote\t.md`, d, MOI, w), String.raw`\??\UNC\hote\t.md`, 'le préfixe NT reste tel quel');
    assert.strictEqual(resolveClaudeImport('//hote/partage/x.md', d, MOI, w), String.raw`\\hote\partage\x.md`, 'un chemin réseau reste tel quel');
    assert.strictEqual(resolveClaudeImport('/n.md', '/srv/espace', '/home/moi', path.posix), '/n.md', 'inchangé hors de Windows');

    // Depuis un fichier de mémoire parent : la racine de son lecteur, qui est celui de l'espace
    const parent = String.raw`D:\espace\CLAUDE.md`;
    const { port: p } = portEspion({ [String.raw`D:\r.md`]: 'Racine.\n' });
    const entrees = expandClaudeImports([{ path: parent, text: lignes(String.raw`@\r.md`), projectLevel: true }],
      { cwd: d, home: MOI, seen: new Set([parent.toLowerCase()]), pathApi: w }, p);
    assert.deepStrictEqual(entrees.map((e: any) => [e.path, e.etat, e.externe]), [[String.raw`D:\r.md`, 'charge', true]]);
  });
});
