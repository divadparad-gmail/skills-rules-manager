import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';

// Les fichiers de mémoire des dossiers parents pour Claude Code : à chaque niveau, CLAUDE.md et
// .claude/CLAUDE.md (mesuré sur un niveau, CC05 et CC06) et CLAUDE.local.md (documentation), de la
// racine vers le projet, sans arrêt à la racine Git (documentation). Un fichier déjà compté, le
// CLAUDE.md global compris, n'est compté qu'une fois (chemin résolu ; observé en 2.1.318, CC07).
//
// Tous les fichiers vivent dans un dossier temporaire au nom fixe, protégé par un fichier témoin : un
// dossier de ce nom sans le témoin n'est ni vidé ni supprimé. La remontée s'arrête à un dossier de ce
// dossier temporaire (réglage de test stopAt), et un espion note toute lecture du système de fichiers
// hors du dossier d'arrêt et des profils simulés : la liste doit rester vide.

const DOSSIER = path.join(os.tmpdir(), 'claude-memoire-sources-a4');
const TEMOIN = '.temoin-claude-memoire-sources';
const TEXTE_TEMOIN = 'Dossier temporaire du test test/claude-memoire-sources.test.ts.\n';
/** Le dossier d'arrêt de la remontée (niveau ../..), son enfant (niveau ..) et le projet. */
const RACINE = path.join(DOSSIER, 'racine');
const MILIEU = path.join(RACINE, 'milieu');
const PROJET = path.join(MILIEU, 'projet');
const CLAUDE_GLOBAL = path.join(DOSSIER, 'claude');
const AG_GLOBAL = path.join(DOSSIER, 'gemini', 'config');
const RACINE_EXTENSION = path.resolve(__dirname, '..', '..');

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
import { countTokens } from '../src/utils/tokenizer';
import { ResourceItem, WorkspaceContext } from '../src/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const main = require(path.resolve(__dirname, '../../src/webview/main.js'));

// --- Rendu d'une carte (faux DOM, sans dépendance, comme test/claude-lecture-seule.test.ts) ---
interface MockEl {
  tagName: string;
  className: string;
  innerHTML: string;
  textContent: string;
  title: string;
  children: MockEl[];
  style: Record<string, string>;
  appendChild: (child: MockEl) => MockEl;
  addEventListener: () => void;
  classList: { add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean };
}

const createElement = (tag: string): MockEl => {
  const classes = new Set<string>();
  const el: MockEl = {
    tagName: tag.toUpperCase(),
    className: '',
    innerHTML: '',
    textContent: '',
    title: '',
    children: [],
    style: {},
    appendChild(c: MockEl) {
      this.children.push(c);
      return c;
    },
    addEventListener() {},
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

// --- Espion des lectures hors du dossier d'arrêt et des profils simulés ---
const FONCTIONS_SYNC = ['existsSync', 'statSync', 'lstatSync', 'readFileSync', 'readdirSync', 'realpathSync', 'accessSync', 'openSync'] as const;
const FONCTIONS_PROMESSES = ['stat', 'lstat', 'readFile', 'readdir', 'realpath', 'access', 'open'] as const;

/** Vrai si `chemin` est `racine` ou se trouve dessous (sans la casse sous Windows, comme NTFS). */
function sousOuEgal(chemin: string, racine: string): boolean {
  const rel = path.relative(path.resolve(racine), path.resolve(chemin));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function sousEspion<T>(autorises: string[], action: () => Promise<T>): Promise<{ resultat: T; horsDossier: string[] }> {
  const horsDossier: string[] = [];
  const racines = [...autorises, path.join(RACINE_EXTENSION, 'out-test'), path.join(RACINE_EXTENSION, 'node_modules')];
  const estAutorise = (p: unknown) => {
    if (typeof p !== 'string' && !(p instanceof URL) && !Buffer.isBuffer(p)) return true; // descripteur de fichier
    const chemin = String(p instanceof URL ? p.pathname : p);
    return racines.some((r) => sousOuEgal(chemin, r));
  };
  const origines: Array<() => void> = [];
  const espionner = (cible: any, nom: string) => {
    const orig = cible[nom];
    if (typeof orig !== 'function') return;
    const espion = function (this: unknown, p: unknown, ...reste: unknown[]) {
      if (!estAutorise(p)) horsDossier.push(`${nom} ${String(p)}`);
      return orig.call(this, p, ...reste);
    };
    // fs.realpathSync.native : la variante native reste espionnée sous le même nom
    if (typeof orig.native === 'function') {
      const origNative = orig.native;
      (espion as any).native = function (this: unknown, p: unknown, ...reste: unknown[]) {
        if (!estAutorise(p)) horsDossier.push(`${nom}.native ${String(p)}`);
        return origNative.call(this, p, ...reste);
      };
    }
    cible[nom] = espion;
    origines.push(() => { cible[nom] = orig; });
  };
  // Le module réel : l'objet de `import * as fs` n'a que des accesseurs, et les modules de src/ lisent le module réel
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsReel = require('fs');
  FONCTIONS_SYNC.forEach((n) => espionner(fsReel, n));
  FONCTIONS_PROMESSES.forEach((n) => espionner(fsReel.promises, n));
  try {
    return { resultat: await action(), horsDossier };
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

/** Scan local et global de Claude Code, remontée arrêtée à `stopAt` ; aucune lecture hors de `stopAt` et des profils. */
async function scanner(stopAt = RACINE): Promise<{ local: Scan; global: Awaited<ReturnType<typeof GlobalScanner.scan>> }> {
  const { resultat, horsDossier } = await sousEspion([stopAt, REGLAGES.claudeGlobalPath, AG_GLOBAL], async () => ({
    local: await LocalScanner.scan(espace(), undefined, { claudeMemoryStopAt: stopAt }),
    global: await GlobalScanner.scan(AG_GLOBAL, 'claude-code'),
  }));
  assert.deepStrictEqual(horsDossier, [], `aucune lecture hors de ${path.relative(DOSSIER, stopAt)} et des profils simulés`);
  return resultat;
}

const ames = (items: ResourceItem[]) => items.filter((i) => i.type === 'soul');
const meta = (c: ResourceItem) => (c.metadata ?? {}) as any;
const tokensInjectes = (texte: string) => countTokens(claudeInjectedText(texte));

const TEXTE_RACINE = '# Mémoire de la racine\n\nConsigne du CLAUDE.md de la racine.\n';
const TEXTE_RACINE_CLAUDE = '# Mémoire de la racine (.claude)\n\nConsigne du .claude/CLAUDE.md de la racine.\n';
const TEXTE_MILIEU = '# Mémoire du milieu\n\nConsigne du CLAUDE.md du dossier parent.\n';
const TEXTE_MILIEU_CLAUDE = '# Mémoire du milieu (.claude)\n\nConsigne du .claude/CLAUDE.md du dossier parent.\n';
const TEXTE_PROJET = '# Mémoire du projet\n\nConsigne du CLAUDE.md du projet.\n';
const TEXTE_GLOBAL = '# Mémoire globale\n\nConsigne du CLAUDE.md global.\n';

describe('Fichiers de mémoire des dossiers parents de Claude Code : remontée, lecture seule et chemin résolu', () => {
  before(() => {
    preparerDossier();
  });

  after(() => {
    REGLAGES.claudeGlobalPath = CLAUDE_GLOBAL;
    if (fs.existsSync(DOSSIER)) viderSaufTemoin();
  });

  test('1. Deux niveaux de parents : cartes en lecture seule, de la racine vers le projet, sans arrêt à la racine Git', async () => {
    arborescence({
      'racine/CLAUDE.md': TEXTE_RACINE,
      'racine/.claude/CLAUDE.md': TEXTE_RACINE_CLAUDE,
      // Le dossier milieu est la racine d'un dépôt Git : la remontée de Claude Code ne s'y arrête pas
      'racine/milieu/.git/HEAD': 'ref: refs/heads/main\n',
      'racine/milieu/CLAUDE.md': TEXTE_MILIEU,
      'racine/milieu/.claude/CLAUDE.md': TEXTE_MILIEU_CLAUDE,
      'racine/milieu/projet/CLAUDE.md': TEXTE_PROJET,
      // Le CLAUDE.md global porte le même nom : aucune carte d'un parent ne forme une paire avec lui
      'claude/CLAUDE.md': TEXTE_GLOBAL,
    });
    const { local, global } = await scanner();
    const cartes = ames(local.items);
    assert.deepStrictEqual(cartes.map((c) => c.id), ['../../CLAUDE.md', '../../.claude/CLAUDE.md', '../CLAUDE.md', '../.claude/CLAUDE.md', 'CLAUDE.md']);
    assert.deepStrictEqual(cartes.map((c) => c.path), [
      path.join(RACINE, 'CLAUDE.md'), path.join(RACINE, '.claude', 'CLAUDE.md'),
      path.join(MILIEU, 'CLAUDE.md'), path.join(MILIEU, '.claude', 'CLAUDE.md'),
      path.join(PROJET, 'CLAUDE.md'),
    ]);
    const textes = [TEXTE_RACINE, TEXTE_RACINE_CLAUDE, TEXTE_MILIEU, TEXTE_MILIEU_CLAUDE, TEXTE_PROJET];
    cartes.forEach((c, i) => {
      assert.strictEqual(c.targetTool, 'claude-code');
      assert.strictEqual(c.scope, 'local');
      assert.strictEqual(c.enabled, true);
      assert.strictEqual(meta(c).claudeMemoryType, 'Project', `${c.id} : type Project`);
      assert.strictEqual(c.tokenCount, tokensInjectes(textes[i]), `${c.id} : tokens o200k du texte injecté`);
    });
    for (const c of cartes.slice(0, 4)) {
      assert.deepStrictEqual(meta(c).claudeReadOnly, { raison: 'Fichier hors du projet' }, `${c.id} : lecture seule`);
      assert.strictEqual(meta(c).locked, true);
      assert.strictEqual(meta(c).inheritedFrom, c.id.startsWith('../../') ? '../..' : '..');
    }
    // La carte du projet ne change pas
    assert.strictEqual(meta(cartes[4]).claudeReadOnly, undefined);
    assert.strictEqual(meta(cartes[4]).inheritedFrom, undefined);

    // Âme L, nombre de fichiers actifs et part héritée
    assert.strictEqual(local.soulStat.activeCount, 5);
    assert.strictEqual(local.soulStat.inheritedCount, 4);
    assert.strictEqual(local.soulStat.tokenCount, cartes.reduce((s, c) => s + (c.tokenCount ?? 0), 0), 'Âme L : somme des cinq cartes');
    assert.strictEqual(local.soulStat.directoryPath, path.join(PROJET, 'CLAUDE.md'), 'le chemin de l\'Âme L reste celui du projet');

    // Aucune paire de doublons ne touche une carte de parent : seule reste la paire de nom des deux CLAUDE.md
    const { enrichedLocal, stats } = DuplicateService.detectDuplicates(global.items, local.items);
    assert.deepStrictEqual(ames(enrichedLocal).filter((c) => c.metadata?.duplicateInfo?.hasDuplicate).map((c) => c.id), ['CLAUDE.md']);
    assert.strictEqual(stats.totalDuplicates, 1);
  });

  test('2. Le CLAUDE.local.md d\'un parent est lu (documentation), type Local, après le CLAUDE.md de son dossier', async () => {
    const local = '# Mémoire locale du parent\n\nConsigne personnelle du dossier parent.\n';
    arborescence({
      'racine/milieu/CLAUDE.local.md': local,
      'racine/milieu/CLAUDE.md': TEXTE_MILIEU,
      'racine/milieu/.claude/CLAUDE.md': TEXTE_MILIEU_CLAUDE,
    });
    const { local: resultat } = await scanner();
    const cartes = ames(resultat.items);
    assert.deepStrictEqual(cartes.map((c) => c.id), ['../CLAUDE.md', '../.claude/CLAUDE.md', '../CLAUDE.local.md']);
    assert.deepStrictEqual(cartes.map((c) => meta(c).claudeMemoryType), ['Project', 'Project', 'Local']);
    const carte = cartes[2];
    assert.strictEqual(carte.path, path.join(MILIEU, 'CLAUDE.local.md'));
    assert.deepStrictEqual(meta(carte).claudeReadOnly, { raison: 'Fichier hors du projet' });
    assert.strictEqual(meta(carte).inheritedFrom, '..');
    assert.strictEqual(carte.tokenCount, tokensInjectes(local));
    assert.strictEqual(resultat.soulStat.activeCount, 3);
    assert.strictEqual(resultat.soulStat.inheritedCount, 3);
  });

  test('3. Un parent dont le .claude/CLAUDE.md est le CLAUDE.md global : compté une fois, sur sa carte globale', async () => {
    arborescence({
      'racine/milieu/CLAUDE.md': TEXTE_MILIEU,
      'racine/milieu/.claude/CLAUDE.md': TEXTE_GLOBAL,
      'racine/milieu/projet/CLAUDE.md': TEXTE_PROJET,
    });
    // Comme sur un poste où le projet est sous le dossier personnel : le profil global est le .claude du parent
    const variantes = [path.join(MILIEU, '.claude')];
    // Sous Windows, le même dossier écrit dans une autre casse est le même fichier (NTFS)
    if (process.platform === 'win32') variantes.push(path.join(MILIEU, '.claude').toUpperCase());
    for (const profil of variantes) {
      REGLAGES.claudeGlobalPath = profil;
      const { local, global } = await scanner();
      const globales = ames(global.items);
      assert.deepStrictEqual(globales.map((c) => c.id), ['CLAUDE.md'], 'la carte globale reste');
      assert.strictEqual(globales[0].tokenCount, tokensInjectes(TEXTE_GLOBAL));
      const locales = ames(local.items);
      assert.deepStrictEqual(locales.map((c) => c.id), ['../CLAUDE.md', 'CLAUDE.md'], `${profil === variantes[0] ? 'même casse' : 'autre casse'} : le fichier global n'a pas de carte de parent`);
      assert.strictEqual(local.soulStat.inheritedCount, 1);
      // Le fichier n'est compté qu'une fois dans les deux colonnes de l'Âme
      const total = globales[0].tokenCount! + local.soulStat.tokenCount;
      assert.strictEqual(total, tokensInjectes(TEXTE_GLOBAL) + tokensInjectes(TEXTE_MILIEU) + tokensInjectes(TEXTE_PROJET));
    }
  });

  test('3 bis. Le dossier personnel ouvert comme dossier de travail : son .claude/CLAUDE.md, le global, n\'a pas de carte de projet', async () => {
    // Le projet joue le dossier personnel : son .claude est le profil global simulé
    arborescence({ 'racine/milieu/projet/.claude/CLAUDE.md': TEXTE_GLOBAL });
    const variantes = [path.join(PROJET, '.claude')];
    // Sous Windows, le même dossier écrit dans une autre casse est le même fichier (NTFS)
    if (process.platform === 'win32') variantes.push(path.join(PROJET, '.claude').toUpperCase());
    for (const profil of variantes) {
      REGLAGES.claudeGlobalPath = profil;
      const { local, global } = await scanner();
      const globales = ames(global.items);
      assert.deepStrictEqual(globales.map((c) => c.id), ['CLAUDE.md'], 'la carte globale reste');
      assert.strictEqual(globales[0].tokenCount, tokensInjectes(TEXTE_GLOBAL));
      assert.deepStrictEqual(ames(local.items).map((c) => c.id), [], `${profil === variantes[0] ? 'même casse' : 'autre casse'} : aucune carte de projet pour le CLAUDE.md global`);
      assert.strictEqual(local.soulStat.activeCount, 0);
      assert.strictEqual(local.soulStat.tokenCount, 0, 'compté une fois, sur la carte globale seulement');
    }
  });

  test('4. Aucune lecture au-dessus du dossier d\'arrêt de la remontée', async () => {
    arborescence({
      // Pièges au-dessus du dossier d'arrêt : ni lus ni comptés
      'CLAUDE.md': '# Piège\n',
      '.claude/CLAUDE.md': '# Piège\n',
      'CLAUDE.local.md': '# Piège\n',
      'racine/CLAUDE.md': TEXTE_RACINE,
      'racine/milieu/CLAUDE.md': TEXTE_MILIEU,
    });
    // Arrêt à la racine : l'espion de scanner() refuse toute lecture du dossier temporaire au-dessus d'elle
    const { local } = await scanner(RACINE);
    assert.deepStrictEqual(ames(local.items).map((c) => c.id), ['../../CLAUDE.md', '../CLAUDE.md']);
    // Arrêt au dossier milieu : la racine n'est plus lue
    const { local: court } = await scanner(MILIEU);
    assert.deepStrictEqual(ames(court.items).map((c) => c.id), ['../CLAUDE.md']);
    // Arrêt au projet : aucun parent
    const { local: aucun } = await scanner(PROJET);
    assert.deepStrictEqual(ames(aucun.items).map((c) => c.id), []);
  });

  test('5. Une même cible atteinte par deux chemins (lien de dossier) est comptée une fois', async (t) => {
    arborescence({ 'racine/.claude/CLAUDE.md': TEXTE_RACINE_CLAUDE });
    const lien = path.join(MILIEU, '.claude');
    try {
      // Une jonction ne demande aucun droit particulier sous Windows ; ailleurs, c'est un lien symbolique
      fs.symlinkSync(path.join(RACINE, '.claude'), lien, 'junction');
    } catch (err) {
      t.skip(`la plateforme ne permet pas de créer un lien de dossier ici (${(err as NodeJS.ErrnoException).code ?? 'erreur'})`);
      return;
    }
    try {
      assert.ok(fs.existsSync(path.join(lien, 'CLAUDE.md')), 'précondition : le fichier est atteint par le lien');
      const { local } = await scanner();
      const cartes = ames(local.items);
      // Le premier chemin rencontré, de la racine vers le projet, garde la carte
      assert.deepStrictEqual(cartes.map((c) => c.id), ['../../.claude/CLAUDE.md']);
      assert.strictEqual(local.soulStat.tokenCount, tokensInjectes(TEXTE_RACINE_CLAUDE));
      assert.strictEqual(local.soulStat.inheritedCount, 1);
    } finally {
      fs.unlinkSync(lien);
    }
  });

  test('6. La bascule et la suppression d\'une carte de parent sont refusées, et le fichier ne change pas', async () => {
    arborescence({
      'racine/milieu/CLAUDE.md': TEXTE_MILIEU,
      'racine/milieu/CLAUDE.local.md': TEXTE_MILIEU,
    });
    const { local } = await scanner();
    const parents = ames(local.items).filter((c) => meta(c).inheritedFrom !== undefined);
    assert.deepStrictEqual(parents.map((c) => c.id), ['../CLAUDE.md', '../CLAUDE.local.md']);
    for (const carte of parents) {
      const refus = getProtectedResourceRefusal(carte);
      assert.ok(refus && refus.startsWith('Fichier hors du projet'), `${carte.id} : refus qui cite la raison`);
      assert.strictEqual(isBulkToggleable(carte), false, `${carte.id} : hors des bascules en masse`);
      for (const etat of [false, true]) {
        const res = await ToggleManager.toggleItem(carte, etat);
        assert.strictEqual(res.success, false, `${carte.id} → ${etat} : bascule refusée`);
        assert.strictEqual(res.error, refus);
      }
      const suppression = await DeleteService.deleteResource(carte);
      assert.strictEqual(suppression.success, false, `${carte.id} : suppression refusée`);
      assert.strictEqual(suppression.error, refus);
      assert.strictEqual(fs.readFileSync(carte.path, 'utf8'), TEXTE_MILIEU, `${carte.id} : fichier inchangé`);
    }
    assert.deepStrictEqual(fs.readdirSync(MILIEU).sort(), ['CLAUDE.local.md', 'CLAUDE.md', 'projet'], 'aucun fichier renommé ni créé');
  });

  test('7. Antigravity est inchangé sur la même arborescence', async () => {
    arborescence({
      // Racine Git à la racine : Antigravity remonte jusqu'à elle, et pas au-delà
      'racine/.git/HEAD': 'ref: refs/heads/main\n',
      'racine/GEMINI.md': '# Âme Antigravity de la racine\n',
      'racine/CLAUDE.md': TEXTE_RACINE,
      'racine/.claude/CLAUDE.md': TEXTE_RACINE_CLAUDE,
      'racine/milieu/CLAUDE.md': TEXTE_MILIEU,
      'racine/milieu/CLAUDE.local.md': TEXTE_MILIEU,
      'racine/milieu/projet/GEMINI.md': '# Âme Antigravity du projet\n',
      'racine/milieu/projet/CLAUDE.md': TEXTE_PROJET,
    });
    const { resultat, horsDossier } = await sousEspion([RACINE, AG_GLOBAL], async () => LocalScanner.scan(espace('antigravity')));
    assert.deepStrictEqual(horsDossier, [], 'aucune lecture hors de la racine Git');
    const cartes = ames(resultat.items);
    assert.deepStrictEqual(cartes.map((c) => c.id), ['GEMINI.md', '../../GEMINI.md']);
    for (const c of cartes) {
      assert.strictEqual(c.targetTool, 'antigravity');
      assert.strictEqual(meta(c).claudeReadOnly, undefined, `${c.id} : aucune marque de Claude Code`);
      assert.strictEqual(meta(c).claudeMemoryType, undefined);
    }
    assert.strictEqual(meta(cartes[1]).inheritedFrom, '../..');
    assert.ok(!resultat.items.some((i) => /CLAUDE(\.local)?\.md$/.test(i.path)), 'aucun fichier de mémoire de Claude Code');
    assert.strictEqual(resultat.soulStat.inheritedCount, 1);

    // La carte héritée d'Antigravity garde son badge « ⬆️ Héritée » et son cadenas « Héritée »
    const tous = rendu(cartes[1]);
    assert.ok(tous.some((el) => el.textContent === '⬆️ Héritée' || el.innerHTML.includes('⬆️ Héritée')), 'badge « ⬆️ Héritée » d\'Antigravity');
    assert.ok(tous.some((el) => el.className === 'soul-locked-badge' && el.innerHTML.includes('Héritée')), 'cadenas « Héritée » d\'Antigravity');
  });

  test('8. La carte d\'un parent : cadenas « Lecture seule », raison et chemin relatif en infobulle, aucun badge neuf', async () => {
    arborescence({
      'racine/CLAUDE.md': TEXTE_RACINE,
      'racine/milieu/CLAUDE.local.md': TEXTE_MILIEU,
    });
    const { local } = await scanner();
    const cartes = ames(local.items);
    assert.deepStrictEqual(cartes.map((c) => c.id), ['../../CLAUDE.md', '../CLAUDE.local.md']);
    const titres: string[] = [];
    for (const carte of cartes) {
      const tous = rendu(carte);
      const badge = tous.find((el) => el.className === 'soul-locked-badge');
      assert.ok(badge, `${carte.id} : cadenas`);
      assert.strictEqual(badge!.innerHTML, '', `${carte.id} : cadenas construit sans innerHTML`);
      assert.deepStrictEqual(badge!.children.map((c) => c.textContent), ['🔒', 'Lecture seule']);
      assert.ok(badge!.title.startsWith('Fichier hors du projet : carte en lecture seule.'), `${carte.id} : la raison en tête de l'infobulle`);
      assert.ok(badge!.title.includes(`Fichier du dossier parent ${meta(carte).inheritedFrom}`), `${carte.id} : le chemin relatif dans l'infobulle`);
      assert.ok(!tous.some((el) => el.tagName === 'INPUT'), `${carte.id} : aucun interrupteur`);
      assert.ok(!tous.some((el) => el.tagName === 'BUTTON' && el.innerHTML === '🗑️'), `${carte.id} : aucune corbeille`);
      // Aucun badge neuf, et pas le badge « ⬆️ Héritée » d'Antigravity (qui parle de la racine Git)
      assert.ok(!tous.some((el) => el.textContent.includes('Héritée') || el.innerHTML.includes('Héritée')), `${carte.id} : aucun badge « Héritée »`);
      titres.push(badge!.title);
    }
    assert.ok(!titres[0].includes('documentation'), 'CLAUDE.md d\'un parent : mesuré sur un niveau, sans mention');
    assert.ok(titres[1].includes('documentation, non mesuré'), 'CLAUDE.local.md d\'un parent : « documentation, non mesuré »');
  });
});
