import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';

// AGENTS.md pour Claude Code (documentation, https://code.claude.com/docs/en/memory.md, « When Claude Code
// reads AGENTS.md ») : chaque AGENTS.md et .claude/AGENTS.md du dossier de travail et des dossiers
// au-dessus est lu, seulement si aucun CLAUDE.md, .claude/CLAUDE.md ni CLAUDE.local.md n'existe dans le
// dossier de travail ni au-dessus (« Count, so Claude reads them instead of AGENTS.md: a CLAUDE.md,
// .claude/CLAUDE.md, or CLAUDE.local.md in your working directory or any directory above it ») ; le
// CLAUDE.md du profil (~/.claude/CLAUDE.md) ne compte pas (« Don't count »). Mesuré : CC22 (le projet,
// seul ou avec un CLAUDE.md) et CC47 (projet, .claude/AGENTS.md et un niveau de parent). Les fichiers
// sous .agents/ ne sont jamais lus par Claude Code (documentation). Le réglage Project instructions est
// détecté seulement, dans le settings.json du profil (décision Q14).
//
// Tous les fichiers vivent dans un dossier temporaire au nom fixe, protégé par un fichier témoin : un
// dossier de ce nom sans le témoin n'est ni vidé ni supprimé. La remontée s'arrête à un dossier de ce
// dossier temporaire (réglage de test stopAt), et un espion note toute lecture du système de fichiers
// hors du dossier d'arrêt et des profils simulés : la liste doit rester vide.

const DOSSIER = path.join(os.tmpdir(), 'claude-memoire-agents-a6');
const TEMOIN = '.temoin-claude-memoire-agents';
const TEXTE_TEMOIN = 'Dossier temporaire du test test/claude-memoire-agents.test.ts.\n';
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
const cadenas = (item: ResourceItem): MockEl | undefined => rendu(item).find((el) => el.className === 'soul-locked-badge');

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

// --- Espion du module fs : lectures hors du dossier d'arrêt et des profils, contenus lus, chemins touchés ---
const FONCTIONS_SYNC = ['existsSync', 'statSync', 'lstatSync', 'readFileSync', 'readdirSync', 'realpathSync', 'accessSync', 'openSync', 'createReadStream'] as const;
const FONCTIONS_PROMESSES = ['stat', 'lstat', 'readFile', 'readdir', 'realpath', 'access', 'open'] as const;
const LECTURES_DE_CONTENU = new Set(['readFileSync', 'openSync', 'createReadStream', 'readFile', 'open']);

/** Vrai si `chemin` est `racine` ou se trouve dessous. */
function sousOuEgal(chemin: string, racine: string): boolean {
  const rel = path.relative(path.resolve(racine), path.resolve(chemin));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

interface Espion { horsDossier: string[]; contenusLus: string[]; touches: string[] }

async function sousEspion<T>(autorises: string[], action: () => Promise<T>): Promise<{ resultat: T } & Espion> {
  const espion: Espion = { horsDossier: [], contenusLus: [], touches: [] };
  const racines = [...autorises, path.join(RACINE_EXTENSION, 'out-test'), path.join(RACINE_EXTENSION, 'node_modules')];
  const noter = (nom: string, p: unknown) => {
    if (typeof p !== 'string' && !(p instanceof URL) && !Buffer.isBuffer(p)) return; // descripteur de fichier
    const chemin = String(p instanceof URL ? p.pathname : p);
    espion.touches.push(path.resolve(chemin));
    if (!racines.some((r) => sousOuEgal(chemin, r))) espion.horsDossier.push(`${nom} ${chemin}`);
    if (LECTURES_DE_CONTENU.has(nom)) espion.contenusLus.push(path.resolve(chemin));
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
  try {
    return { resultat: await action(), ...espion };
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

/** Scan local et global de Claude Code, remontée arrêtée à la racine ; aucune lecture hors de la racine et des profils. */
async function scanner(stopAt = RACINE): Promise<{ local: Scan; global: ScanGlobal } & Espion> {
  const { resultat, ...espion } = await sousEspion([stopAt, REGLAGES.claudeGlobalPath, AG_GLOBAL], async () => ({
    local: await LocalScanner.scan(espace(), undefined, { claudeMemoryStopAt: stopAt }),
    global: await GlobalScanner.scan(AG_GLOBAL, 'claude-code'),
  }));
  assert.deepStrictEqual(espion.horsDossier, [], 'aucune lecture hors du dossier d\'arrêt et des profils simulés');
  return { ...resultat, ...espion };
}

const ames = (items: ResourceItem[]) => items.filter((i) => i.type === 'soul');
const meta = (c: ResourceItem) => (c.metadata ?? {}) as any;
const tokensInjectes = (texte: string) => countTokens(claudeInjectedText(texte));
const ignoree = (c: ResourceItem) => meta(c).claudeMemoryNotLoaded === 'agents-ignore';
const MENTION_Q14 = '❔ réglage Project instructions non pris en compte';
const BADGE_IGNORE = '⏭️ Ignoré : un CLAUDE.md est présent';

const AG_RACINE = '# AGENTS de la racine\n\nConsigne de l\'AGENTS.md de la racine.\n';
const AG_MILIEU = '# AGENTS du milieu\n\nConsigne de l\'AGENTS.md du dossier parent.\n';
const AG_MILIEU_CLAUDE = '# AGENTS du milieu (.claude)\n\nConsigne du .claude/AGENTS.md du dossier parent.\n';
const AG_PROJET = '# AGENTS du projet\n\nConsigne de l\'AGENTS.md du projet.\n';
const AG_PROJET_CLAUDE = '# AGENTS du projet (.claude)\n\nConsigne du .claude/AGENTS.md du projet.\n';
const AG_AGENTS_DIR = '# AGENTS de .agents\n\nCe fichier n\'est jamais lu par Claude Code.\n';
const TEXTE_CLAUDE = '# Mémoire\n\nConsigne d\'un fichier de mémoire de Claude Code.\n';
const TEXTE_GLOBAL = '# Mémoire globale\n\nConsigne du CLAUDE.md global.\n';

/** Le settings.json du profil simulé avec la clé du réglage Project instructions. */
const reglage = (entree: unknown, autres: Record<string, unknown> = {}) =>
  JSON.stringify({ ...autres, pluginConfigs: { 'cc-plugin-agents-md@builtin': entree } }, null, 2);

describe('AGENTS.md pour Claude Code : lecture sans CLAUDE.md, carte ignorée, imports et réglage Project instructions', () => {
  before(() => {
    preparerDossier();
  });

  after(() => {
    REGLAGES.claudeGlobalPath = CLAUDE_GLOBAL;
    if (fs.existsSync(DOSSIER)) viderSaufTemoin();
  });

  test('1. Sans CLAUDE.md : AGENTS.md et .claude/AGENTS.md du projet et des parents lus, de la racine vers le projet ; .agents/ jamais lu', async () => {
    arborescence({
      'racine/AGENTS.md': AG_RACINE,
      // Le dossier milieu est la racine d'un dépôt Git : la remontée de Claude Code ne s'y arrête pas
      'racine/milieu/.git/HEAD': 'ref: refs/heads/main\n',
      'racine/milieu/AGENTS.md': AG_MILIEU,
      'racine/milieu/.claude/AGENTS.md': AG_MILIEU_CLAUDE,
      'racine/milieu/projet/AGENTS.md': AG_PROJET,
      'racine/milieu/projet/.claude/AGENTS.md': AG_PROJET_CLAUDE,
      'racine/milieu/projet/.agents/AGENTS.md': AG_AGENTS_DIR,
    });
    const { local, touches } = await scanner();
    const cartes = ames(local.items);
    assert.deepStrictEqual(cartes.map((c) => c.id), ['../../AGENTS.md', '../AGENTS.md', '../.claude/AGENTS.md', 'AGENTS.md', '.claude/AGENTS.md']);
    const textes = [AG_RACINE, AG_MILIEU, AG_MILIEU_CLAUDE, AG_PROJET, AG_PROJET_CLAUDE];
    cartes.forEach((c, i) => {
      assert.strictEqual(c.targetTool, 'claude-code');
      assert.strictEqual(c.scope, 'local');
      assert.strictEqual(c.enabled, true);
      assert.strictEqual(meta(c).claudeMemoryType, 'Project', `${c.id} : type Project`);
      assert.strictEqual(meta(c).claudeMemoryNotLoaded, undefined, `${c.id} : chargé`);
      assert.strictEqual(c.tokenCount, tokensInjectes(textes[i]), `${c.id} : tokens o200k du texte injecté`);
    });
    // Les parents : lecture seule, hors du projet ; leur bascule et leur suppression sont refusées
    for (const c of cartes.slice(0, 3)) {
      assert.deepStrictEqual(meta(c).claudeReadOnly, { raison: 'Fichier hors du projet' }, `${c.id} : lecture seule`);
      assert.strictEqual(meta(c).locked, true);
      assert.strictEqual(meta(c).inheritedFrom, c.id.startsWith('../../') ? '../..' : '..');
      const refus = getProtectedResourceRefusal(c);
      assert.ok(refus && refus.startsWith('Fichier hors du projet'), `${c.id} : refus qui cite la raison`);
      assert.strictEqual(isBulkToggleable(c), false);
      const bascule = await ToggleManager.toggleItem(c, false);
      assert.strictEqual(bascule.success, false, `${c.id} : bascule refusée`);
      const suppression = await DeleteService.deleteResource(c);
      assert.strictEqual(suppression.success, false, `${c.id} : suppression refusée`);
      assert.strictEqual(fs.readFileSync(c.path, 'utf8'), textes[cartes.indexOf(c)], `${c.id} : fichier inchangé`);
    }
    // Le projet : comme son CLAUDE.md (cadenas « Always-On », pas de lecture seule)
    for (const c of cartes.slice(3)) {
      assert.strictEqual(meta(c).claudeReadOnly, undefined, `${c.id} : pas en lecture seule`);
      assert.strictEqual(meta(c).inheritedFrom, undefined);
      assert.strictEqual(getProtectedResourceRefusal(c), null, `${c.id} : aucun refus`);
      const verrou = cadenas(c);
      assert.ok(verrou && verrou.innerHTML.includes('Always-On'), `${c.id} : cadenas « Always-On », comme le CLAUDE.md du projet`);
      assert.ok(!verrou!.title.includes(MENTION_Q14), `${c.id} : aucune mention du réglage sans réglage`);
    }
    // Âme L, nombre de fichiers actifs, part héritée, chemin de l'Âme L
    assert.strictEqual(local.soulStat.activeCount, 5);
    assert.strictEqual(local.soulStat.inheritedCount, 3);
    assert.strictEqual(local.soulStat.tokenCount, cartes.reduce((s, c) => s + (c.tokenCount ?? 0), 0), 'Âme L : somme des cinq cartes');
    assert.strictEqual(local.soulStat.directoryPath, path.join(PROJET, 'AGENTS.md'), 'le chemin de l\'Âme L est celui du projet');
    // .agents/AGENTS.md n'est jamais lu pour Claude Code (documentation : « anything under a .agents/ directory »).
    // Le scan touche par ailleurs des chemins de fixtures du banc d'essai sous .agents/rules/ (reconnaissance des
    // fixtures, antérieure à a6) : seul le fichier .agents/AGENTS.md du projet est vérifié ici
    const agentsDir = path.resolve(PROJET, '.agents', 'AGENTS.md');
    assert.deepStrictEqual(touches.filter((p) => p.toLowerCase() === agentsDir.toLowerCase()), [], 'aucun accès à .agents/AGENTS.md');
    assert.ok(touches.some((p) => p.toLowerCase() === path.resolve(PROJET, 'AGENTS.md').toLowerCase()), 'témoin : l\'espion voit bien AGENTS.md');
  });

  test('2. CLAUDE.local.md seul exclut AGENTS.md : cartes ignorées à 0, non lues, non actives', async () => {
    const local = '# Mémoire locale\n\nConsigne personnelle du projet.\n';
    arborescence({
      'racine/milieu/AGENTS.md': AG_MILIEU,
      'racine/milieu/projet/AGENTS.md': AG_PROJET,
      'racine/milieu/projet/.claude/AGENTS.md': AG_PROJET_CLAUDE,
      'racine/milieu/projet/CLAUDE.local.md': local,
    });
    const { local: resultat, contenusLus } = await scanner();
    const cartes = ames(resultat.items);
    assert.deepStrictEqual(cartes.filter((c) => !ignoree(c)).map((c) => c.id), ['CLAUDE.local.md']);
    assert.deepStrictEqual(cartes.filter(ignoree).map((c) => c.id), ['../AGENTS.md', 'AGENTS.md', '.claude/AGENTS.md']);
    for (const c of cartes.filter(ignoree)) {
      assert.strictEqual(c.tokenCount, 0, `${c.id} : 0`);
      assert.strictEqual(c.charCount, 0);
      assert.strictEqual(meta(c).claudeMemoryType, 'Project');
      assert.deepStrictEqual(meta(c).claudeAgentsMd, { ignorePar: 'CLAUDE.local.md' }, `${c.id} : le fichier qui l'exclut`);
      assert.ok(!contenusLus.includes(path.resolve(c.path)), `${c.id} : jamais lu`);
    }
    assert.strictEqual(resultat.soulStat.activeCount, 1, 'seul CLAUDE.local.md est actif');
    assert.strictEqual(resultat.soulStat.tokenCount, tokensInjectes(local));
    assert.strictEqual(resultat.soulStat.inheritedCount, 0);
  });

  test('3. Le CLAUDE.md global n\'exclut pas AGENTS.md, qu\'il soit à part, atteint comme parent ou depuis le dossier personnel ouvert', async () => {
    const variantes: Array<{ nom: string; fichiers: Record<string, string>; profil: string }> = [
      { nom: 'profil à part', fichiers: { 'claude/CLAUDE.md': TEXTE_GLOBAL }, profil: CLAUDE_GLOBAL },
      // Comme sur un poste où le projet est sous le dossier personnel : le profil est le .claude du parent
      { nom: 'profil = .claude du parent', fichiers: { 'racine/milieu/.claude/CLAUDE.md': TEXTE_GLOBAL }, profil: path.join(MILIEU, '.claude') },
      // Le dossier personnel ouvert comme dossier de travail
      { nom: 'profil = .claude du projet', fichiers: { 'racine/milieu/projet/.claude/CLAUDE.md': TEXTE_GLOBAL }, profil: path.join(PROJET, '.claude') },
    ];
    if (process.platform === 'win32') {
      variantes.push({ nom: 'profil = .claude du parent, autre casse', fichiers: { 'racine/milieu/.claude/CLAUDE.md': TEXTE_GLOBAL }, profil: path.join(MILIEU, '.claude').toUpperCase() });
    }
    for (const v of variantes) {
      arborescence({ ...v.fichiers, 'racine/milieu/projet/AGENTS.md': AG_PROJET });
      REGLAGES.claudeGlobalPath = v.profil;
      const { local, global } = await scanner();
      assert.deepStrictEqual(ames(global.items).map((c) => c.id), ['CLAUDE.md'], `${v.nom} : la carte globale`);
      const cartes = ames(local.items);
      assert.deepStrictEqual(cartes.map((c) => c.id), ['AGENTS.md'], `${v.nom} : AGENTS.md lu, aucune autre carte`);
      assert.strictEqual(meta(cartes[0]).claudeMemoryNotLoaded, undefined, `${v.nom} : chargé`);
      assert.strictEqual(cartes[0].tokenCount, tokensInjectes(AG_PROJET));
      assert.strictEqual(local.soulStat.activeCount, 1);
    }
  });

  test('4. Un fichier de mémoire d\'un parent ou du projet exclut AGENTS.md partout ; la carte ignorée d\'un parent est en lecture seule', async () => {
    const excluants: Array<[string, string]> = [
      ['racine/CLAUDE.md', '../../CLAUDE.md'],
      ['racine/milieu/.claude/CLAUDE.md', '../.claude/CLAUDE.md'],
      ['racine/milieu/CLAUDE.local.md', '../CLAUDE.local.md'],
      ['racine/milieu/projet/CLAUDE.md', 'CLAUDE.md'],
      ['racine/milieu/projet/.claude/CLAUDE.md', '.claude/CLAUDE.md'],
    ];
    for (const [fichier, id] of excluants) {
      arborescence({
        [fichier]: TEXTE_CLAUDE,
        'racine/milieu/AGENTS.md': AG_MILIEU,
        'racine/milieu/projet/AGENTS.md': AG_PROJET,
      });
      const { local, global, contenusLus } = await scanner();
      const cartes = ames(local.items);
      assert.deepStrictEqual(cartes.filter((c) => !ignoree(c)).map((c) => c.id), [id], `${id} : seul fichier chargé`);
      const ignorees = cartes.filter(ignoree);
      assert.deepStrictEqual(ignorees.map((c) => c.id), ['../AGENTS.md', 'AGENTS.md'], `${id} : deux cartes ignorées`);
      for (const c of ignorees) {
        assert.deepStrictEqual(meta(c).claudeAgentsMd, { ignorePar: id });
        assert.strictEqual(c.tokenCount, 0);
        assert.ok(!contenusLus.includes(path.resolve(c.path)), `${c.id} : jamais lu`);
      }
      assert.deepStrictEqual(meta(ignorees[0]).claudeReadOnly, { raison: 'Fichier hors du projet' }, 'parent ignoré : lecture seule');
      assert.strictEqual(meta(ignorees[0]).inheritedFrom, '..');
      assert.strictEqual(meta(ignorees[1]).claudeReadOnly, undefined, 'projet ignoré : comme son CLAUDE.md');
      assert.strictEqual(local.soulStat.activeCount, 1);
      assert.strictEqual(local.soulStat.inheritedCount, id.startsWith('..') ? 1 : 0, 'une carte ignorée n\'est pas héritée active');
      assert.strictEqual(local.soulStat.tokenCount, tokensInjectes(TEXTE_CLAUDE));
      // Aucune paire de doublons ne touche une carte AGENTS.md
      const { enrichedLocal } = DuplicateService.detectDuplicates(global.items, local.items);
      assert.ok(!ames(enrichedLocal).some((c) => /AGENTS\.md$/.test(c.id) && c.metadata?.duplicateInfo), `${id} : aucun doublon d'AGENTS.md`);
    }
  });

  test('5. La carte ignorée : badge « ⏭️ Ignoré », 0 au démarrage, ni interrupteur ni lecture, raison et fichier excluant en infobulle', async () => {
    arborescence({
      'racine/milieu/CLAUDE.md': TEXTE_CLAUDE,
      'racine/milieu/AGENTS.md': AG_MILIEU,
      'racine/milieu/projet/AGENTS.md': AG_PROJET,
    });
    const { local } = await scanner();
    const ignorees = ames(local.items).filter(ignoree);
    assert.deepStrictEqual(ignorees.map((c) => c.id), ['../AGENTS.md', 'AGENTS.md']);
    for (const c of ignorees) {
      const tous = rendu(c);
      const badge = tous.find((el) => el.textContent === BADGE_IGNORE);
      assert.ok(badge, `${c.id} : badge « ${BADGE_IGNORE} »`);
      assert.strictEqual(badge!.innerHTML, '', 'badge posé par textContent');
      assert.ok(badge!.title.includes('../CLAUDE.md'), `${c.id} : le fichier qui l'exclut est nommé`);
      assert.ok(badge!.title.includes('documentation'), `${c.id} : la source est dite`);
      assert.ok(tous.some((el) => el.innerHTML.includes('0 tok au boot')), `${c.id} : 0 au démarrage`);
      assert.ok(!tous.some((el) => el.tagName === 'INPUT'), `${c.id} : aucun interrupteur`);
    }
    const verrouParent = cadenas(ignorees[0]);
    assert.deepStrictEqual(verrouParent!.children.map((e) => e.textContent), ['🔒', 'Lecture seule'], 'parent ignoré : cadenas « Lecture seule »');
    assert.ok(!rendu(ignorees[0]).some((el) => el.tagName === 'BUTTON' && el.innerHTML === '🗑️'), 'parent ignoré : aucune corbeille');
  });

  test('6. Les imports d\'un AGENTS.md lu sont développés et comptés ; un AGENTS.md importé par un CLAUDE.md est compté une fois, sans carte ignorée', async () => {
    arborescence({
      'racine/milieu/AGENTS.md': `${AG_MILIEU}\n@cible-parent.md\n`,
      'racine/milieu/cible-parent.md': '# Cible du parent\n\nImportée par l\'AGENTS.md du parent.\n',
      'racine/milieu/projet/AGENTS.md': `${AG_PROJET}\n@detail.md\n`,
      'racine/milieu/projet/detail.md': '# Détail\n\nImporté par l\'AGENTS.md du projet.\n',
    });
    const { local } = await scanner();
    const cartes = ames(local.items);
    assert.deepStrictEqual(cartes.map((c) => c.id), ['../AGENTS.md', 'AGENTS.md', '../cible-parent.md', 'detail.md']);
    const detail = cartes[3];
    assert.deepStrictEqual(meta(detail).claudeImport, { par: 'AGENTS.md', niveau: 1, externe: false });
    assert.deepStrictEqual(meta(detail).claudeReadOnly, { raison: 'Fichier importé' });
    assert.strictEqual(meta(detail).claudeMemoryType, 'Project');
    assert.strictEqual(detail.tokenCount, tokensInjectes('# Détail\n\nImporté par l\'AGENTS.md du projet.\n'));
    // L'import d'un parent vers son propre dossier sort du dossier de travail : extérieur (comme en a5)
    assert.deepStrictEqual(meta(cartes[2]).claudeImport, { par: '../AGENTS.md', niveau: 1, externe: true });
    assert.strictEqual(local.soulStat.activeCount, 4);
    assert.strictEqual(local.soulStat.tokenCount, cartes.reduce((s, c) => s + (c.tokenCount ?? 0), 0));

    // Un CLAUDE.md qui importe @AGENTS.md (documentation, « Share one file with other coding tools ») :
    // AGENTS.md est compté par l'import, sans carte ignorée ; .claude/AGENTS.md, non importé, est ignoré
    arborescence({
      'racine/milieu/projet/CLAUDE.md': `${TEXTE_CLAUDE}\n@AGENTS.md\n`,
      'racine/milieu/projet/AGENTS.md': AG_PROJET,
      'racine/milieu/projet/.claude/AGENTS.md': AG_PROJET_CLAUDE,
    });
    const { local: importe } = await scanner();
    const ids = ames(importe.items).map((c) => `${c.id}${ignoree(c) ? ' (ignoré)' : meta(c).claudeImport ? ' (importé)' : ''}`);
    assert.deepStrictEqual(ids, ['CLAUDE.md', 'AGENTS.md (importé)', '.claude/AGENTS.md (ignoré)']);
    const agents = ames(importe.items)[1];
    assert.strictEqual(agents.tokenCount, tokensInjectes(AG_PROJET), 'AGENTS.md compté une fois, par l\'import');
    assert.strictEqual(importe.soulStat.activeCount, 2);
  });

  test('7. Le réglage Project instructions (Q14) : une valeur autre que la valeur par défaut ajoute la mention, sans autre effet', async () => {
    const base = {
      'racine/milieu/AGENTS.md': AG_MILIEU,
      'racine/milieu/projet/AGENTS.md': AG_PROJET,
    };
    const avecLocal = { ...base, 'racine/milieu/projet/CLAUDE.local.md': TEXTE_CLAUDE };
    const SECRET = 'valeur-secrete-temoin-a6';
    const cas: Array<{ nom: string; fichiers: Record<string, string>; mention: boolean }> = [
      { nom: 'sans settings.json', fichiers: base, mention: false },
      { nom: 'entrée sans valeur', fichiers: { ...base, 'claude/settings.json': reglage({}) }, mention: false },
      { nom: 'options sans valeur', fichiers: { ...base, 'claude/settings.json': reglage({ options: {} }) }, mention: false },
      { nom: 'valeur par défaut', fichiers: { ...base, 'claude/settings.json': reglage({ options: { instructionFiles: 'claude-md-or-agents-md' } }) }, mention: false },
      { nom: 'claude-md-and-agents-md', fichiers: { ...base, 'claude/settings.json': reglage({ options: { instructionFiles: 'claude-md-and-agents-md' } }, { env: { SECRET_TEMOIN: SECRET } }) }, mention: true },
      { nom: 'managed-only', fichiers: { ...base, 'claude/settings.json': reglage({ options: { instructionFiles: 'managed-only' } }) }, mention: true },
      { nom: 'claude-md, AGENTS.md ignorés', fichiers: { ...avecLocal, 'claude/settings.json': reglage({ options: { instructionFiles: 'claude-md' } }) }, mention: true },
      // Lu seulement dans le profil : Claude Code ignore l'entrée dans les réglages du projet (documentation)
      { nom: 'réglage du projet', fichiers: { ...base, 'racine/milieu/projet/.claude/settings.json': reglage({ options: { instructionFiles: 'claude-md' } }) }, mention: false },
      // Seule la clé cc-plugin-agents-md@builtin est lue (décision Q14)
      { nom: 'ancien identifiant', fichiers: { ...base, 'claude/settings.json': JSON.stringify({ pluginConfigs: { 'agents-md@builtin': { options: { instructionFiles: 'claude-md' } } } }) }, mention: false },
      { nom: 'JSON invalide', fichiers: { ...base, 'claude/settings.json': '{ "pluginConfigs": ' }, mention: false },
    ];
    for (const c of cas) {
      arborescence(c.fichiers);
      const { local } = await scanner();
      const cartes = ames(local.items);
      const agents = cartes.filter((i) => /AGENTS\.md$/.test(i.id));
      const ignores = c.fichiers === avecLocal || 'racine/milieu/projet/CLAUDE.local.md' in c.fichiers;
      // La règle d'AGENTS.md ne change pas avec le réglage
      assert.deepStrictEqual(agents.map((i) => `${i.id}${ignoree(i) ? ' (ignoré)' : ''}`),
        ignores ? ['../AGENTS.md (ignoré)', 'AGENTS.md (ignoré)'] : ['../AGENTS.md', 'AGENTS.md'], `${c.nom} : règle inchangée`);
      assert.strictEqual(local.soulStat.tokenCount,
        ignores ? tokensInjectes(TEXTE_CLAUDE) : tokensInjectes(AG_MILIEU) + tokensInjectes(AG_PROJET), `${c.nom} : compte inchangé`);
      for (const carte of agents) {
        assert.strictEqual(!!meta(carte).claudeAgentsMd?.reglageProjectInstructions, c.mention, `${c.nom} : ${carte.id} marqué`);
        const verrou = cadenas(carte);
        assert.ok(verrou, `${c.nom} : ${carte.id} a un cadenas`);
        assert.strictEqual(verrou!.title.includes(MENTION_Q14), c.mention, `${c.nom} : ${carte.id} infobulle`);
      }
      // Les autres cartes ne portent jamais la mention
      for (const carte of cartes.filter((i) => !/AGENTS\.md$/.test(i.id))) {
        assert.strictEqual(meta(carte).claudeAgentsMd, undefined, `${c.nom} : ${carte.id} sans marque`);
        assert.ok(!cadenas(carte)!.title.includes(MENTION_Q14), `${c.nom} : ${carte.id} sans mention`);
      }
      // Aucune autre valeur du settings.json n'est reprise dans l'état
      assert.ok(!JSON.stringify(local).includes(SECRET), `${c.nom} : aucune autre valeur du settings.json`);
    }
  });

  test('8. Une même cible atteinte par deux chemins (lien de dossier) est comptée une fois', async (t) => {
    arborescence({ 'racine/.claude/AGENTS.md': AG_RACINE });
    const lien = path.join(MILIEU, '.claude');
    try {
      fs.symlinkSync(path.join(RACINE, '.claude'), lien, 'junction');
    } catch (err) {
      t.skip(`la plateforme ne permet pas de créer un lien de dossier ici (${(err as NodeJS.ErrnoException).code ?? 'erreur'})`);
      return;
    }
    try {
      assert.ok(fs.existsSync(path.join(lien, 'AGENTS.md')), 'précondition : le fichier est atteint par le lien');
      const { local } = await scanner();
      assert.deepStrictEqual(ames(local.items).map((c) => c.id), ['../../.claude/AGENTS.md'], 'le premier chemin rencontré garde la carte');
      assert.strictEqual(local.soulStat.tokenCount, tokensInjectes(AG_RACINE));
    } finally {
      fs.unlinkSync(lien);
    }
  });

  test('9. Antigravity est inchangé sur la même arborescence : ses AGENTS.md, .agents/ et parents, sans marque de Claude Code', async () => {
    arborescence({
      // Racine Git à la racine : Antigravity remonte jusqu'à elle, et pas au-delà
      'racine/.git/HEAD': 'ref: refs/heads/main\n',
      'racine/AGENTS.md': AG_RACINE,
      'racine/milieu/AGENTS.md': AG_MILIEU,
      'racine/milieu/.claude/AGENTS.md': AG_MILIEU_CLAUDE,
      'racine/milieu/projet/AGENTS.md': AG_PROJET,
      'racine/milieu/projet/.claude/AGENTS.md': AG_PROJET_CLAUDE,
      'racine/milieu/projet/.agents/AGENTS.md': AG_AGENTS_DIR,
      'racine/milieu/projet/CLAUDE.local.md': TEXTE_CLAUDE,
      'claude/settings.json': reglage({ options: { instructionFiles: 'claude-md-and-agents-md' } }),
    });
    const { resultat, horsDossier } = await sousEspion([RACINE, AG_GLOBAL], async () => LocalScanner.scan(espace('antigravity')));
    assert.deepStrictEqual(horsDossier, [], 'aucune lecture hors de la racine Git');
    const cartes = ames(resultat.items);
    assert.deepStrictEqual(cartes.map((c) => c.id), ['AGENTS.md', '.agents/AGENTS.md', '../AGENTS.md', '../../AGENTS.md']);
    for (const c of cartes) {
      assert.strictEqual(c.targetTool, 'antigravity');
      for (const cle of ['claudeReadOnly', 'claudeMemoryType', 'claudeMemoryNotLoaded', 'claudeAgentsMd', 'claudeImport']) {
        assert.strictEqual(meta(c)[cle], undefined, `${c.id} : aucune marque ${cle}`);
      }
      assert.ok(c.tokenCount! > 0, `${c.id} : compté par Antigravity`);
    }
    assert.deepStrictEqual(cartes.slice(2).map((c) => meta(c).inheritedFrom), ['..', '../..']);
    assert.ok(!resultat.items.some((i) => /\.claude[\\/]AGENTS\.md$/.test(i.path)), 'aucun .claude/AGENTS.md pour Antigravity');
    assert.strictEqual(resultat.soulStat.activeCount, 4);
    assert.strictEqual(resultat.soulStat.inheritedCount, 2);
    // La carte héritée d'Antigravity garde son badge « ⬆️ Héritée »
    assert.ok(rendu(cartes[2]).some((el) => el.textContent === '⬆️ Héritée' || el.innerHTML.includes('⬆️ Héritée')));
  });
});
