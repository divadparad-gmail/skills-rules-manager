import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';

// La mémoire automatique de Claude Code (MEMORY.md) : emplacement <profil>/projects/<nom>/memory/MEMORY.md,
// le nom venant de la racine Git trouvée en remontant, sinon du dossier de travail (documentation,
// https://code.claude.com/docs/en/memory.md, « Storage location ») ; chaque caractère non alphanumérique
// devient « - » (mesuré en phase 2, fonction de la sonde) ; coupe à 200 lignes ou à 25 000 caractères, la
// première limite atteinte (CC41 mesuré ; 25 000 caractères déduit après coup, D-7.1 bis) ; activation par
// autoMemoryEnabled (réglages local, projet, profil) et par CLAUDE_CODE_DISABLE_AUTO_MEMORY (documentation).
//
// Tous les fichiers vivent dans un dossier temporaire au nom fixe, protégé par un fichier témoin : un
// dossier de ce nom sans le témoin n'est ni vidé ni supprimé. Le profil est simulé dans `claude/`, la
// remontée vers la racine Git s'arrête à `racine/` (stopAt), l'environnement est injecté, et un espion note
// toute lecture hors du dossier temporaire, les contenus lus et les chemins touchés.

const DOSSIER = path.join(os.tmpdir(), 'claude-memoire-auto-a7');
const TEMOIN = '.temoin-claude-memoire-auto';
const TEXTE_TEMOIN = 'Dossier temporaire du test test/claude-memoire-auto.test.ts.\n';
const RACINE = path.join(DOSSIER, 'racine');
const MILIEU = path.join(RACINE, 'milieu');
const PROJET = path.join(MILIEU, 'projet');
const CLAUDE_GLOBAL = path.join(DOSSIER, 'claude');
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
      getConfiguration: () => ({ get: (_key: string, def: any) => def }),
    },
    env: { appName: 'Visual Studio Code' },
    Uri: { file: (f: string) => ({ fsPath: f, scheme: 'file' }) },
    commands: { executeCommand: () => Promise.resolve() },
  },
} as any;

import { DeleteService } from '../src/services/DeleteService';
import { getProtectedResourceRefusal, isBulkToggleable, ToggleManager } from '../src/services/ToggleManager';
import { countTokens } from '../src/utils/tokenizer';
import { ResourceItem } from '../src/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const main = require(path.resolve(__dirname, '../../src/webview/main.js'));
// La fonction de la sonde, qui reste la référence du nom (comme l'oracle)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sonde = require(path.join(RACINE_EXTENSION, 'test', 'scenarios', 'scripts', 'sonde-claude-code-commun.js')) as { nomDossierMemoire: (p: string) => string };

/** Les modules d'a7, chargés à l'exécution : leur absence fait échouer chaque test, pas tout le fichier. */
function modulePur(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../src/claude/autoMemory');
  } catch {
    throw new Error('le module src/claude/autoMemory.ts est absent');
  }
}
function service(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../src/services/claudeAutoMemory');
  } catch {
    throw new Error('le module src/services/claudeAutoMemory.ts est absent');
  }
}

// --- Rendu (faux DOM, sans dépendance) ---
interface MockEl {
  tagName: string;
  id: string;
  className: string;
  innerHTML: string;
  textContent: string;
  title: string;
  children: MockEl[];
  parentNode: MockEl | null;
  style: Record<string, string>;
  appendChild: (child: MockEl) => MockEl;
  insertBefore: (child: MockEl, ref: MockEl | null) => MockEl;
  removeChild: (child: MockEl) => MockEl;
  readonly nextSibling: MockEl | null;
  addEventListener: () => void;
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
    parentNode: null,
    style: {},
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
      this.children.splice(this.children.indexOf(c), 1);
      c.parentNode = null;
      return c;
    },
    get nextSibling() {
      const p = this.parentNode;
      if (!p) return null;
      return p.children[p.children.indexOf(this) + 1] ?? null;
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

/** Un document de jauge minimal : la barre (segments) et la légende du tableau de bord ou de la barre latérale. */
function documentJauge(vue: 'dashboard' | 'sidebar') {
  const racine = createElement('div');
  const barre = racine.appendChild(createElement('div'));
  barre.className = 'stacked-progress-track';
  for (const id of ['barSoulGlobal', 'barSoulLocal', 'barMcpLocal']) {
    const s = barre.appendChild(createElement('div'));
    s.id = id;
    s.className = 'segment';
  }
  const liste = racine.appendChild(createElement('div'));
  if (vue === 'dashboard') {
    for (const id of ['rowSoulTotal', 'rowMcpTotal']) liste.appendChild(createElement('div')).id = id;
  } else {
    liste.id = 'tokenBreakdownList';
    liste.appendChild(createElement('div')).id = 'rowMcpLocal';
  }
  const doc = {
    createElement,
    getElementById: (id: string) => descendants(racine).find((e) => e.id === id) ?? null,
  };
  return { racine, doc, barre };
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
  fs.mkdirSync(PROJET, { recursive: true });
  fs.mkdirSync(CLAUDE_GLOBAL, { recursive: true });
  for (const [rel, contenu] of Object.entries(fichiers)) {
    const dest = path.join(DOSSIER, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, contenu, 'utf8');
  }
}

/** Le chemin relatif (au dossier temporaire) du MEMORY.md calculé pour une racine. */
const memoire = (racine: string, fichier = 'MEMORY.md') => `claude/projects/${sonde.nomDossierMemoire(racine)}/memory/${fichier}`;

// --- Espion du module fs ---
const FONCTIONS_SYNC = ['existsSync', 'statSync', 'lstatSync', 'readFileSync', 'readdirSync', 'realpathSync', 'accessSync', 'openSync', 'createReadStream'] as const;
const FONCTIONS_PROMESSES = ['stat', 'lstat', 'readFile', 'readdir', 'realpath', 'access', 'open'] as const;
const LECTURES_DE_CONTENU = new Set(['readFileSync', 'openSync', 'createReadStream', 'readFile', 'open']);

function sousOuEgal(chemin: string, racine: string): boolean {
  const rel = path.relative(path.resolve(racine), path.resolve(chemin));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

interface Espion { horsDossier: string[]; contenusLus: string[]; touches: string[]; lecturesEntieres: string[] }

function sousEspion<T>(action: () => T): { resultat: T } & Espion;
function sousEspion<T>(action: () => Promise<T>): Promise<{ resultat: T } & Espion>;
function sousEspion<T>(action: () => T | Promise<T>): any {
  const espion: Espion = { horsDossier: [], contenusLus: [], touches: [], lecturesEntieres: [] };
  const racines = [DOSSIER, path.join(RACINE_EXTENSION, 'out-test'), path.join(RACINE_EXTENSION, 'node_modules')];
  const noter = (nom: string, p: unknown) => {
    if (typeof p !== 'string' && !(p instanceof URL) && !Buffer.isBuffer(p)) return;
    const chemin = path.resolve(String(p instanceof URL ? p.pathname : p));
    espion.touches.push(chemin);
    if (!racines.some((r) => sousOuEgal(chemin, r))) espion.horsDossier.push(`${nom} ${chemin}`);
    if (LECTURES_DE_CONTENU.has(nom)) espion.contenusLus.push(chemin);
    if (nom === 'readFileSync' || nom === 'readFile') espion.lecturesEntieres.push(chemin);
  };
  const origines: Array<() => void> = [];
  const espionner = (cible: any, nom: string) => {
    const orig = cible[nom];
    if (typeof orig !== 'function') return;
    const fn = function (this: unknown, p: unknown, ...reste: unknown[]) {
      noter(nom, p);
      return orig.call(this, p, ...reste);
    };
    if (typeof orig.native === 'function') {
      const origNative = orig.native;
      (fn as any).native = function (this: unknown, p: unknown, ...reste: unknown[]) {
        noter(`${nom}.native`, p);
        return origNative.call(this, p, ...reste);
      };
    }
    cible[nom] = fn;
    origines.push(() => { cible[nom] = orig; });
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsReel = require('fs');
  FONCTIONS_SYNC.forEach((n) => espionner(fsReel, n));
  FONCTIONS_PROMESSES.forEach((n) => espionner(fsReel.promises, n));
  const retablir = () => origines.forEach((r) => r());
  let resultat: T | Promise<T>;
  try {
    resultat = action();
  } catch (err) {
    retablir();
    throw err;
  }
  if (resultat instanceof Promise) {
    // L'espion reste en place jusqu'à la fin de l'action asynchrone
    return resultat.then((v) => ({ resultat: v, ...espion }), (e) => { throw e; }).finally(retablir);
  }
  retablir();
  return { resultat, ...espion };
}

const memeChemin = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** La mémoire automatique du projet, profil simulé, remontée arrêtée à la racine, environnement donné. */
function scanner(env: Record<string, string> = {}, cwd = PROJET): { resultat: { stat: any; item: ResourceItem | null } } & Espion {
  const r = sousEspion(() => service().scanClaudeAutoMemory({ cwd, globalPath: CLAUDE_GLOBAL, stopAt: RACINE, env }));
  assert.deepStrictEqual(r.horsDossier, [], 'aucune lecture hors du dossier temporaire');
  return r;
}

const LIGNE = '- Une entrée de la mémoire automatique, écrite par Claude.';
const lignes = (n: number, ligne = LIGNE, fin = '\n') => Array.from({ length: n }, () => ligne).join(fin) + fin;
const COURT = '# Mémoire\n\n- Préférence de l\'utilisateur.\n';

describe('Mémoire automatique de Claude Code (MEMORY.md) : emplacement, coupe, activation, carte et ligne de la jauge', () => {
  before(() => {
    preparerDossier();
  });

  after(() => {
    if (fs.existsSync(DOSSIER)) viderSaufTemoin();
  });

  test('1. Le nom du dossier concorde avec la fonction de la sonde ; au-delà de 200 caractères, la sonde refuse et src/ rend null', () => {
    const { claudeAutoMemoryDirName } = modulePur();
    for (const chemin of ['C:\\canari-claude-code\\espace\\projet', 'c:\\Utilisateurs\\x\\Mes projets\\dépôt', '/home/x/mon projet/é_x.y', 'D:\\a b\\é_x.y', '/tmp/a']) {
      assert.strictEqual(claudeAutoMemoryDirName(chemin), sonde.nomDossierMemoire(chemin), chemin);
    }
    assert.strictEqual(claudeAutoMemoryDirName('D:\\a b\\é_x.y'), 'D--a-b---x-y');
    const exact = `/${'a'.repeat(199)}`;
    assert.strictEqual(claudeAutoMemoryDirName(exact), sonde.nomDossierMemoire(exact), '200 caractères : accepté');
    const long = `/${'a'.repeat(200)}`;
    assert.throws(() => sonde.nomDossierMemoire(long));
    assert.strictEqual(claudeAutoMemoryDirName(long), null, '201 caractères : null');
  });

  test('2. La coupe : 200 lignes ou 25 000 caractères (points de code), la première atteinte, sur un caractère complet', () => {
    const { claudeAutoMemoryCut } = modulePur();
    // Non coupé : 200 lignes exactement, saut final compris
    const deuxCents = lignes(200);
    assert.deepStrictEqual(claudeAutoMemoryCut(deuxCents), { text: deuxCents, coupe: null, lignesOrigine: 200, lignesGardees: 200 });
    // 250 lignes courtes : coupe à 200 lignes, sans le saut de la 200ᵉ
    const r250 = claudeAutoMemoryCut(lignes(250));
    assert.strictEqual(r250.coupe, 'lignes');
    assert.strictEqual(r250.text, lignes(200).slice(0, -1));
    assert.deepStrictEqual([r250.lignesOrigine, r250.lignesGardees], [250, 200]);
    // Fins de ligne CRLF : même coupe
    const crlf = claudeAutoMemoryCut(lignes(250, LIGNE, '\r\n'));
    assert.strictEqual(crlf.coupe, 'lignes');
    assert.strictEqual(crlf.text, lignes(200, LIGNE, '\r\n').slice(0, -2));
    // 180 lignes longues (161 points de code avec le saut) : coupe à 25 000 points de code, en milieu de ligne
    const longue = 'é'.repeat(160);
    const r180 = claudeAutoMemoryCut(lignes(180, longue));
    assert.strictEqual(r180.coupe, 'caracteres');
    assert.strictEqual([...r180.text].length, 25000);
    assert.strictEqual(r180.lignesGardees, 156, '155 lignes entières et le début de la 156ᵉ');
    assert.strictEqual(r180.lignesOrigine, 180);
    // Points de code, et non unités UTF-16 : un émoji compte pour un, et n'est jamais coupé en deux
    const emojis = '😀'.repeat(25001);
    const re = claudeAutoMemoryCut(emojis);
    assert.strictEqual(re.coupe, 'caracteres');
    assert.strictEqual(re.text, '😀'.repeat(25000), '25 000 émojis entiers (50 000 unités UTF-16)');
    // 25 000 caractères exactement : non coupé
    assert.strictEqual(claudeAutoMemoryCut('x'.repeat(25000)).coupe, null);
    // Les deux limites : la plus courte gagne (200 lignes de 200 caractères dépassent 25 000 avant la 200ᵉ)
    assert.strictEqual(claudeAutoMemoryCut(lignes(300, 'y'.repeat(200))).coupe, 'caracteres');
  });

  test('3. Les réglages : autoMemoryEnabled, du local au profil ; autoMemoryDirectory seulement constaté ; la variable', () => {
    const { claudeAutoMemorySettings, claudeAutoMemoryDisabledByEnv } = modulePur();
    const j = (o: unknown) => JSON.stringify(o);
    const lire = (utilisateur: unknown, projet: unknown, local: unknown) => claudeAutoMemorySettings({
      utilisateur: utilisateur === undefined ? null : j(utilisateur),
      projet: projet === undefined ? null : j(projet),
      local: local === undefined ? null : j(local),
    });
    assert.deepStrictEqual(lire(undefined, undefined, undefined), { active: true, coupeePar: null, dossierPose: [] });
    assert.deepStrictEqual(lire({ autoMemoryEnabled: false }, undefined, undefined), { active: false, coupeePar: 'utilisateur', dossierPose: [] });
    assert.deepStrictEqual(lire(undefined, { autoMemoryEnabled: false }, undefined), { active: false, coupeePar: 'projet', dossierPose: [] });
    assert.deepStrictEqual(lire(undefined, undefined, { autoMemoryEnabled: false }), { active: false, coupeePar: 'local', dossierPose: [] });
    // Priorité : local, puis projet, puis profil (documentation des réglages)
    assert.strictEqual(lire({ autoMemoryEnabled: false }, { autoMemoryEnabled: true }, undefined).active, true);
    assert.strictEqual(lire({ autoMemoryEnabled: true }, { autoMemoryEnabled: false }, { autoMemoryEnabled: true }).active, true);
    assert.deepStrictEqual(lire({ autoMemoryEnabled: true }, { autoMemoryEnabled: true }, { autoMemoryEnabled: false }).coupeePar, 'local');
    // Une valeur qui n'est pas un booléen, ou un JSON invalide, est ignorée
    assert.strictEqual(lire(undefined, { autoMemoryEnabled: 'false' }, undefined).active, true);
    assert.deepStrictEqual(claudeAutoMemorySettings({ utilisateur: '{ "autoMemoryEnabled": ', projet: null, local: null }).active, true);
    // autoMemoryDirectory : sa présence seule, dans chaque portée
    assert.deepStrictEqual(lire({ autoMemoryDirectory: '~/a' }, undefined, { autoMemoryDirectory: '/b' }).dossierPose, ['utilisateur', 'local']);
    // La variable : 1, true, yes, on (toute casse) coupent ; 0, vide ou absente, non
    for (const v of ['1', 'true', 'YES', 'On']) assert.strictEqual(claudeAutoMemoryDisabledByEnv(v), true, v);
    for (const v of [undefined, '', '0', 'false', 'off', 'no']) assert.strictEqual(claudeAutoMemoryDisabledByEnv(v), false, String(v));
  });

  test('4. L\'emplacement vient de la racine Git trouvée en remontant, sinon du dossier de travail', () => {
    arborescence({
      'racine/milieu/.git/HEAD': 'ref: refs/heads/main\n',
      [memoire(MILIEU)]: COURT,
      // Piège : le MEMORY.md calculé d'après le dossier de travail n'est pas celui du dépôt
      [memoire(PROJET)]: '# Piège\n',
    });
    const avecGit = scanner();
    assert.strictEqual(avecGit.resultat.stat.etat, 'present');
    assert.ok(memeChemin(avecGit.resultat.item!.path, path.join(DOSSIER, memoire(MILIEU))), 'MEMORY.md de la racine Git');
    assert.ok(!avecGit.contenusLus.some((p) => memeChemin(p, path.join(DOSSIER, memoire(PROJET)))), 'le piège n\'est pas lu');
    assert.strictEqual(avecGit.resultat.stat.tokenCount, countTokens(COURT));

    arborescence({ [memoire(PROJET)]: COURT });
    const sansGit = scanner();
    assert.strictEqual(sansGit.resultat.stat.etat, 'present');
    assert.ok(memeChemin(sansGit.resultat.item!.path, path.join(DOSSIER, memoire(PROJET))), 'sans dépôt : le dossier de travail');

    arborescence({});
    const absent = scanner();
    assert.strictEqual(absent.resultat.stat.etat, 'absent');
    assert.strictEqual(absent.resultat.stat.tokenCount, 0);
    assert.strictEqual(absent.resultat.item, null);
  });

  test('5. Un .git fichier (worktree) et un chemin de plus de 200 caractères : emplacement non déterminé, rien lu sous projects/', () => {
    arborescence({ 'racine/milieu/.git': 'gitdir: ../ailleurs/.git/worktrees/x\n', [memoire(MILIEU)]: COURT, [memoire(PROJET)]: COURT });
    const worktree = scanner();
    assert.strictEqual(worktree.resultat.stat.etat, 'non-determine');
    assert.deepStrictEqual(worktree.resultat.stat.cause, { type: 'worktree' });
    assert.strictEqual(worktree.resultat.stat.tokenCount, 0);
    assert.strictEqual(worktree.resultat.item, null);
    assert.ok(!worktree.touches.some((p) => p.toLowerCase().includes(`${path.sep}projects${path.sep}`)), 'aucun accès sous projects/');

    const long = path.join(DOSSIER, 'x'.repeat(180), 'projet');
    fs.mkdirSync(long, { recursive: true });
    assert.ok(long.replace(/[^A-Za-z0-9]/g, '-').length > 200, 'précondition : nom de plus de 200 caractères');
    const r = sousEspion(() => service().scanClaudeAutoMemory({ cwd: long, globalPath: CLAUDE_GLOBAL, stopAt: DOSSIER, env: {} }));
    assert.strictEqual(r.resultat.stat.etat, 'non-determine');
    assert.deepStrictEqual(r.resultat.stat.cause, { type: 'longueur' });
    assert.ok(!r.touches.some((p) => p.toLowerCase().includes(`${path.sep}projects${path.sep}`)), 'aucune recherche par préfixe sous projects/');
  });

  test('6. La coupe dans le scanner : 200 lignes, puis 25 000 caractères ; carte et ligne aux tokens du texte gardé', () => {
    arborescence({ [memoire(PROJET)]: lignes(250) });
    const r250 = scanner().resultat;
    assert.strictEqual(r250.stat.etat, 'present');
    assert.strictEqual(r250.stat.tokenCount, countTokens(lignes(200).slice(0, -1)));
    assert.strictEqual(r250.item!.tokenCount, r250.stat.tokenCount, 'la carte montre le même compte');
    assert.deepStrictEqual(
      { coupe: r250.stat.coupe, lignesOrigine: r250.stat.lignesOrigine, lignesGardees: r250.stat.lignesGardees },
      { coupe: 'lignes', lignesOrigine: 250, lignesGardees: 200 });
    const badge = rendu(r250.item!).find((el) => el.textContent === '✂️ Coupé à 200 lignes');
    assert.ok(badge, 'badge « ✂️ Coupé à 200 lignes »');
    assert.ok(badge!.title.includes('250 lignes'), 'le nombre de lignes d\'origine');
    assert.ok(badge!.title.includes('120 tokens'), 'le texte ajouté à la coupe, non compté');

    arborescence({ [memoire(PROJET)]: lignes(180, 'é'.repeat(160)) });
    const r180 = scanner().resultat;
    assert.strictEqual(r180.stat.coupe, 'caracteres');
    assert.strictEqual(r180.stat.charCount, 25000);
    const badge2 = rendu(r180.item!).find((el) => el.textContent === '✂️ Coupé à 25 000 caractères');
    assert.ok(badge2, 'badge « ✂️ Coupé à 25 000 caractères »');
    assert.ok(badge2!.title.includes('points de code') && badge2!.title.includes('non vérifié'), 'l\'unité, non vérifiée');
  });

  test('7. L\'activation : autoMemoryEnabled dans chacune des trois portées, priorité du local au profil, et la variable', () => {
    const fichierMemoire = path.join(DOSSIER, memoire(PROJET));
    const cas: Array<{ nom: string; fichiers: Record<string, string>; env?: Record<string, string>; etat: string; cause?: unknown }> = [
      { nom: 'profil', fichiers: { 'claude/settings.json': '{ "autoMemoryEnabled": false }' }, etat: 'desactivee', cause: { type: 'reglage', portee: 'utilisateur' } },
      { nom: 'projet', fichiers: { 'racine/milieu/projet/.claude/settings.json': '{ "autoMemoryEnabled": false }' }, etat: 'desactivee', cause: { type: 'reglage', portee: 'projet' } },
      { nom: 'local', fichiers: { 'racine/milieu/projet/.claude/settings.local.json': '{ "autoMemoryEnabled": false }' }, etat: 'desactivee', cause: { type: 'reglage', portee: 'local' } },
      { nom: 'local l\'emporte', fichiers: { 'racine/milieu/projet/.claude/settings.json': '{ "autoMemoryEnabled": false }', 'racine/milieu/projet/.claude/settings.local.json': '{ "autoMemoryEnabled": true }' }, etat: 'present' },
      { nom: 'variable', fichiers: { 'claude/settings.json': '{ "autoMemoryEnabled": true }' }, env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }, etat: 'desactivee', cause: { type: 'variable', nom: 'CLAUDE_CODE_DISABLE_AUTO_MEMORY' } },
      { nom: 'variable à 0', fichiers: {}, env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' }, etat: 'present' },
    ];
    for (const c of cas) {
      arborescence({ ...c.fichiers, [memoire(PROJET)]: COURT });
      const r = scanner(c.env);
      assert.strictEqual(r.resultat.stat.etat, c.etat, `${c.nom} : état`);
      if (c.etat === 'desactivee') {
        assert.deepStrictEqual(r.resultat.stat.cause, c.cause, `${c.nom} : cause`);
        assert.strictEqual(r.resultat.stat.tokenCount, 0);
        assert.strictEqual(r.resultat.item, null, `${c.nom} : aucune carte`);
        assert.ok(!r.touches.some((p) => memeChemin(p, fichierMemoire)), `${c.nom} : MEMORY.md jamais touché`);
      }
      if (c.nom === 'variable') {
        assert.ok(!r.touches.some((p) => /settings(\.local)?\.json$/i.test(p)), 'variable : aucun réglage lu');
      }
    }
  });

  test('8. autoMemoryDirectory ou CLAUDE_CODE_PROJECT_DIR_NAME : non déterminé, sans lire le chemin ; CLAUDE_CONFIG_DIR : mention seule', () => {
    const piege = path.join(DOSSIER, 'ailleurs');
    for (const [portee, fichier] of [['utilisateur', 'claude/settings.json'], ['projet', 'racine/milieu/projet/.claude/settings.json'], ['local', 'racine/milieu/projet/.claude/settings.local.json']]) {
      arborescence({ [fichier]: JSON.stringify({ autoMemoryDirectory: piege }), 'ailleurs/MEMORY.md': '# Piège\n', [memoire(PROJET)]: COURT });
      const r = scanner();
      assert.strictEqual(r.resultat.stat.etat, 'non-determine', `${portee} : non déterminé`);
      assert.deepStrictEqual(r.resultat.stat.cause, { type: 'reglage-dossier', portees: [portee] });
      assert.strictEqual(r.resultat.item, null);
      assert.ok(!r.touches.some((p) => sousOuEgal(p, piege)), `${portee} : le chemin du réglage n'est jamais lu`);
      assert.ok(!JSON.stringify(r.resultat).includes('ailleurs'), `${portee} : la valeur n'est pas reprise`);
    }
    arborescence({ 'nomme/memory/MEMORY.md': '# Piège\n', [memoire(PROJET)]: COURT });
    const v = scanner({ CLAUDE_CODE_PROJECT_DIR_NAME: 'nomme' });
    assert.strictEqual(v.resultat.stat.etat, 'non-determine');
    assert.deepStrictEqual(v.resultat.stat.cause, { type: 'variable', nom: 'CLAUDE_CODE_PROJECT_DIR_NAME' });
    assert.ok(!v.touches.some((p) => p.toLowerCase().includes('nomme')), 'le dossier nommé n\'est jamais lu');

    arborescence({ [memoire(PROJET)]: COURT });
    const c = scanner({ CLAUDE_CONFIG_DIR: path.join(DOSSIER, 'autre-profil') });
    assert.strictEqual(c.resultat.stat.etat, 'present', 'le profil de l\'extension reste la source');
    assert.deepStrictEqual(c.resultat.stat.mentions, ['CLAUDE_CONFIG_DIR']);
    assert.ok(!c.touches.some((p) => p.toLowerCase().includes('autre-profil')), 'le profil de la variable n\'est pas lu');
  });

  test('9. Plus de 4 Mio : seul le début est lu, puis coupé à 200 lignes ; badge et mention', () => {
    const fichier = path.join(DOSSIER, memoire(PROJET));
    arborescence({});
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    const ligne = `${'z'.repeat(99)}\n`;
    fs.writeFileSync(fichier, ligne.repeat(Math.ceil((4 * 1024 * 1024 + 1) / ligne.length)), 'utf8');
    assert.ok(fs.statSync(fichier).size > 4 * 1024 * 1024, 'précondition : plus de 4 Mio');
    const r = scanner();
    assert.strictEqual(r.resultat.stat.etat, 'present');
    assert.strictEqual(r.resultat.stat.coupe, 'lignes');
    assert.strictEqual(r.resultat.stat.tokenCount, countTokens(ligne.repeat(200).slice(0, -1)));
    assert.strictEqual(r.resultat.stat.plusDe4Mio, true);
    assert.ok(!r.lecturesEntieres.some((p) => memeChemin(p, fichier)), 'le fichier n\'est pas lu en entier');
    const badge = rendu(r.resultat.item!).find((el) => el.textContent === '✂️ Coupé à 200 lignes');
    assert.ok(badge && badge.title.includes('4 Mio'), 'la taille est dite dans l\'infobulle');
  });

  test('10. La carte : lecture seule « Écrit par Claude », type AutoMem, portée globale ; une ligne @ n\'est pas développée ; les autres fichiers de memory/ ni lus ni montrés', async () => {
    const texte = `${COURT}- Voir @notes.md pour le détail.\n`;
    arborescence({
      [memoire(PROJET)]: texte,
      [memoire(PROJET, 'notes.md')]: '# Notes\n',
      [memoire(PROJET, 'user_role.md')]: '---\ntype: user\n---\nRôle.\n',
    });
    const r = scanner();
    const carte = r.resultat.item!;
    assert.strictEqual(carte.type, 'soul');
    assert.strictEqual(carte.scope, 'global');
    assert.strictEqual(carte.targetTool, 'claude-code');
    assert.strictEqual((carte.metadata as any).claudeMemoryType, 'AutoMem');
    assert.deepStrictEqual((carte.metadata as any).claudeReadOnly, { raison: 'Écrit par Claude' });
    assert.strictEqual(carte.tokenCount, countTokens(texte), 'la ligne @ compte comme du texte, sans import');
    assert.strictEqual(r.resultat.stat.importsNonDeveloppes, true);
    assert.ok(!r.touches.some((p) => /notes\.md$|user_role\.md$/i.test(p)), 'ni l\'import ni les autres fichiers ne sont touchés');
    assert.ok(!r.touches.some((p) => memeChemin(p, path.dirname(path.join(DOSSIER, memoire(PROJET))))), 'le dossier memory/ n\'est pas listé');
    // Refus côté serveur
    const refus = getProtectedResourceRefusal(carte);
    assert.ok(refus && refus.startsWith('Écrit par Claude'), 'refus qui cite la raison');
    assert.strictEqual(isBulkToggleable(carte), false);
    assert.strictEqual((await ToggleManager.toggleItem(carte, false)).success, false);
    assert.strictEqual((await DeleteService.deleteResource(carte)).success, false);
    assert.strictEqual(fs.readFileSync(carte.path, 'utf8'), texte, 'fichier inchangé');
    // Rendu : cadenas « Lecture seule », badge « ❔ Import non développé »
    const tous = rendu(carte);
    const verrou = tous.find((el) => el.className === 'soul-locked-badge');
    assert.ok(verrou && verrou.title.startsWith('Écrit par Claude'), 'cadenas et raison');
    assert.ok(!tous.some((el) => el.tagName === 'INPUT'), 'aucun interrupteur');
    const badge = tous.find((el) => el.textContent === '❔ Import non développé');
    assert.ok(badge && badge.title.includes('non mesuré'), 'badge de la ligne @');
  });

  test('11. La ligne « Mémoire automatique » de la jauge : créée par le JavaScript pour Claude Code seulement, avec son segment', () => {
    const stat = (etat: string, extra: Record<string, unknown> = {}) => ({ etat, tokenCount: 0, charCount: 0, percentage: 0, mentions: [], ...extra });
    const etat = (s: unknown, tool = 'claude-code') => ({ workspace: { tool }, stats: { budgetTotal: 20000, claudeAutoMemory: s } });
    for (const vue of ['dashboard', 'sidebar'] as const) {
      const { doc, barre } = documentJauge(vue);
      main.renderClaudeAutoMemoryLine(etat(stat('present', { tokenCount: 1234, percentage: 6.2, coupe: 'lignes', lignesOrigine: 250, lignesGardees: 200, mentions: ['CLAUDE_CONFIG_DIR'] })), doc);
      const ligne = doc.getElementById('rowClaudeAutoMemory');
      assert.ok(ligne, `${vue} : ligne créée`);
      const textes = descendants(ligne!).map((e) => e.textContent);
      assert.ok(textes.includes('🧠 Mémoire automatique, écrite par Claude'), `${vue} : titre`);
      assert.ok(textes.some((t) => t.includes('1') && t.includes('234') && t.includes('6.2%')), `${vue} : valeur`);
      const bulle = descendants(ligne!).find((e) => e.className === 'tooltip-box')!;
      assert.ok(bulle.textContent.includes('700') && bulle.textContent.includes('mesuré une fois par /context'), `${vue} : invite système, hors jauge`);
      assert.ok(bulle.textContent.includes('CLAUDE_CONFIG_DIR'), `${vue} : mention de la variable`);
      assert.ok(bulle.textContent.includes('250'), `${vue} : lignes d'origine`);
      assert.ok(descendants(ligne!).every((e) => e.innerHTML === ''), `${vue} : rien par innerHTML`);
      const segment = doc.getElementById('barClaudeAutoMemory');
      assert.ok(segment && segment.parentNode === barre && segment.style.width === '6.2%', `${vue} : segment de la barre`);
      // Un second rendu ne duplique rien
      main.renderClaudeAutoMemoryLine(etat(stat('absent')), doc);
      assert.strictEqual(descendants(barre).filter((e) => e.id === 'barClaudeAutoMemory').length, 1);
      assert.ok(descendants(doc.getElementById('rowClaudeAutoMemory')!).some((e) => e.textContent.includes('absent')), `${vue} : absent`);
      main.renderClaudeAutoMemoryLine(etat(stat('desactivee', { cause: { type: 'reglage', portee: 'projet' } })), doc);
      assert.ok(descendants(doc.getElementById('rowClaudeAutoMemory')!).some((e) => e.textContent.includes('désactivée')), `${vue} : désactivée`);
      main.renderClaudeAutoMemoryLine(etat(stat('non-determine', { cause: { type: 'longueur' } })), doc);
      assert.ok(descendants(doc.getElementById('rowClaudeAutoMemory')!).some((e) => e.textContent === '🧠 Mémoire automatique : emplacement non déterminé ❔'), `${vue} : non déterminé`);
      // Antigravity : la ligne et le segment sont retirés
      main.renderClaudeAutoMemoryLine(etat(undefined, 'antigravity'), doc);
      assert.strictEqual(doc.getElementById('rowClaudeAutoMemory'), null, `${vue} : ligne retirée sous Antigravity`);
      assert.strictEqual(doc.getElementById('barClaudeAutoMemory'), null, `${vue} : segment retiré sous Antigravity`);
    }
  });

  test('12. Antigravity n\'appelle jamais la mémoire automatique : aucun accès sous projects/ ni à MEMORY.md', async () => {
    arborescence({ [memoire(PROJET)]: COURT, 'racine/milieu/projet/AGENTS.md': '# Âme\n', 'racine/.git/HEAD': 'ref: refs/heads/main\n' });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LocalScanner } = require('../src/services/LocalScanner');
    const espace = { hasWorkspace: true, workspacePath: PROJET, tool: 'antigravity', agentsDir: '.agents', claudeDir: null, hasClaudeMd: false };
    // Action asynchrone : l'espion rend une promesse et reste en place jusqu'à la fin du scan
    const r = await (sousEspion(() => LocalScanner.scan(espace)) as unknown as Promise<{ resultat: any } & Espion>);
    const resultat = r.resultat;
    assert.ok(!r.touches.some((p) => /MEMORY\.md$/i.test(p) || sousOuEgal(p, path.join(CLAUDE_GLOBAL, 'projects'))), 'ni MEMORY.md ni projects/ touchés');
    assert.ok(!resultat.items.some((i: ResourceItem) => (i.metadata as any)?.claudeMemoryType === 'AutoMem'), 'aucune carte AutoMem');
  });
});
