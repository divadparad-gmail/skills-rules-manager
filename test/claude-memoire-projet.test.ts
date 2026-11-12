import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';

// Les fichiers de mémoire du projet pour Claude Code : <projet>/CLAUDE.md, <projet>/.claude/CLAUDE.md
// et <projet>/CLAUDE.local.md, chargés tous les trois (mesuré, CC03 et CC04).
//
// Tous les fichiers vivent dans un dossier temporaire au nom fixe, protégé par un fichier témoin : un
// dossier de ce nom sans le témoin n'est ni vidé ni supprimé. Pendant chaque scan, un espion note toute
// lecture du système de fichiers hors de ce dossier (hors code et données de l'extension) : la liste
// doit rester vide.

const DOSSIER = path.join(os.tmpdir(), 'claude-memoire-projet-a3');
const TEMOIN = '.temoin-claude-memoire-projet';
const TEXTE_TEMOIN = 'Dossier temporaire du test test/claude-memoire-projet.test.ts.\n';
const PROJET = path.join(DOSSIER, 'projet');
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
import { claudeInjectedText } from '../src/claude/injectedText';
import { countTokens } from '../src/utils/tokenizer';
import { ResourceItem, WorkspaceContext } from '../src/types';

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

/** Repart d'un projet et d'un profil vides, puis écrit les fichiers donnés (chemin relatif au dossier temporaire). */
function arborescence(fichiers: Record<string, string>): void {
  viderSaufTemoin();
  fs.mkdirSync(PROJET, { recursive: true });
  fs.mkdirSync(CLAUDE_GLOBAL, { recursive: true });
  fs.mkdirSync(AG_GLOBAL, { recursive: true });
  for (const [rel, contenu] of Object.entries(fichiers)) {
    const dest = path.join(DOSSIER, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, contenu, 'utf8');
  }
}

// --- Espion des lectures hors du dossier temporaire ---
const FONCTIONS_SYNC = ['existsSync', 'statSync', 'lstatSync', 'readFileSync', 'readdirSync', 'realpathSync', 'accessSync', 'openSync'] as const;
const FONCTIONS_PROMESSES = ['stat', 'lstat', 'readFile', 'readdir', 'realpath', 'access', 'open'] as const;

function estAutorise(p: unknown): boolean {
  if (typeof p !== 'string' && !(p instanceof URL) && !Buffer.isBuffer(p)) return true; // descripteur de fichier
  const chemin = path.resolve(String(p instanceof URL ? p.pathname : p));
  const dans = (racine: string) => chemin === racine || chemin.startsWith(racine + path.sep);
  // Le dossier temporaire du test, et le code et les données de l'extension (modules, tokenizer)
  return dans(DOSSIER) || dans(path.join(RACINE_EXTENSION, 'out-test')) || dans(path.join(RACINE_EXTENSION, 'node_modules'));
}

async function sousEspion<T>(action: () => Promise<T>): Promise<{ resultat: T; horsDossier: string[] }> {
  const horsDossier: string[] = [];
  const origines: Array<() => void> = [];
  const espionner = (cible: any, nom: string) => {
    const orig = cible[nom];
    if (typeof orig !== 'function') return;
    cible[nom] = function (p: unknown, ...reste: unknown[]) {
      if (!estAutorise(p)) horsDossier.push(`${nom} ${String(p)}`);
      return orig.call(this, p, ...reste);
    };
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

const espace = (): WorkspaceContext => ({
  hasWorkspace: true,
  workspacePath: PROJET,
  tool: 'claude-code',
  agentsDir: null,
  claudeDir: path.join(PROJET, '.claude'),
  hasClaudeMd: fs.existsSync(path.join(PROJET, 'CLAUDE.md')),
});

async function scanner(): Promise<{ local: Awaited<ReturnType<typeof LocalScanner.scan>>; global: Awaited<ReturnType<typeof GlobalScanner.scan>> }> {
  const { resultat, horsDossier } = await sousEspion(async () => ({
    local: await LocalScanner.scan(espace()),
    global: await GlobalScanner.scan(AG_GLOBAL, 'claude-code'),
  }));
  assert.deepStrictEqual(horsDossier, [], 'aucune lecture hors du dossier temporaire');
  return resultat;
}

const ames = (items: ResourceItem[]) => items.filter((i) => i.type === 'soul');

const MEMOIRE_PROJET = '# Mémoire du projet\n\nConsigne du CLAUDE.md du projet.\n';
const MEMOIRE_CLAUDE = '# Mémoire partagée\n\nConsigne identique au CLAUDE.md global.\n';
const MEMOIRE_LOCALE = '# Mémoire locale\n\nConsigne personnelle du CLAUDE.local.md.\n';

describe('Fichiers de mémoire du projet de Claude Code : CLAUDE.md, .claude/CLAUDE.md et CLAUDE.local.md', () => {
  before(() => {
    preparerDossier();
  });

  after(() => {
    if (fs.existsSync(DOSSIER)) viderSaufTemoin();
  });

  test('1. Les trois fichiers présents donnent trois cartes d\'âme, dans l\'ordre CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md', async () => {
    arborescence({
      'projet/CLAUDE.md': MEMOIRE_PROJET,
      'projet/.claude/CLAUDE.md': MEMOIRE_CLAUDE,
      'projet/CLAUDE.local.md': MEMOIRE_LOCALE,
    });
    const { local } = await scanner();
    const cartes = ames(local.items);
    assert.deepStrictEqual(cartes.map((c) => c.id), ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']);
    assert.deepStrictEqual(cartes.map((c) => c.path), [
      path.join(PROJET, 'CLAUDE.md'), path.join(PROJET, '.claude', 'CLAUDE.md'), path.join(PROJET, 'CLAUDE.local.md'),
    ]);
    assert.deepStrictEqual(cartes.map((c) => (c.metadata as any)?.claudeMemoryType), ['Project', 'Project', 'Local']);
    for (const c of cartes) {
      // Même comportement que le CLAUDE.md du projet : carte d'âme locale, active, verrouillée « Always-On », pas en lecture seule
      assert.strictEqual(c.targetTool, 'claude-code');
      assert.strictEqual(c.scope, 'local');
      assert.strictEqual(c.enabled, true);
      assert.strictEqual(c.metadata?.isSoul, true);
      assert.strictEqual(c.metadata?.locked, true);
      assert.strictEqual((c.metadata as any)?.claudeReadOnly, undefined, `${c.id} : pas en lecture seule`);
      assert.strictEqual(c.metadata?.inheritedFrom, undefined);
      const texte = claudeInjectedText(fs.readFileSync(c.path, 'utf8'));
      assert.strictEqual(c.charCount, texte.length, `${c.id} : caractères du texte injecté`);
      assert.strictEqual(c.tokenCount, countTokens(texte), `${c.id} : tokens o200k du texte injecté`);
    }
    assert.strictEqual(new Set(cartes.map((c) => c.id)).size, 3, 'identifiants uniques');
    assert.strictEqual(local.soulStat.activeCount, 3);
    assert.strictEqual(local.soulStat.totalCount, 3);
    assert.strictEqual(local.soulStat.tokenCount, cartes.reduce((s, c) => s + (c.tokenCount ?? 0), 0), 'Âme L : somme des trois cartes');
  });

  test('2. Aucun doublon entre les trois cartes, ni des deux nouvelles avec le CLAUDE.md global ; la paire des deux CLAUDE.md reste', async () => {
    // Le CLAUDE.md global a le même contenu que le .claude/CLAUDE.md et le même nom que le CLAUDE.md du projet
    arborescence({
      'claude/CLAUDE.md': MEMOIRE_CLAUDE,
      'projet/CLAUDE.md': MEMOIRE_PROJET,
      'projet/.claude/CLAUDE.md': MEMOIRE_CLAUDE,
      'projet/CLAUDE.local.md': MEMOIRE_CLAUDE,
    });
    const { local, global } = await scanner();
    assert.deepStrictEqual(ames(global.items).map((c) => c.id), ['CLAUDE.md']);
    const { enrichedLocal, stats } = await sousEspion(async () => DuplicateService.detectDuplicates(global.items, local.items)).then((r) => {
      assert.deepStrictEqual(r.horsDossier, [], 'aucune lecture hors du dossier temporaire');
      return r.resultat;
    });
    const avecDoublon = ames(enrichedLocal).filter((c) => c.metadata?.duplicateInfo?.hasDuplicate).map((c) => c.id);
    // Comportement inchangé : le CLAUDE.md global et celui du projet forment une paire de nom ; les deux nouvelles cartes, aucune
    assert.deepStrictEqual(avecDoublon, ['CLAUDE.md']);
    assert.strictEqual(stats.totalDuplicates, 1);
  });

  test('3. Chaque fichier seul donne sa seule carte, et aucun fichier ne donne aucune carte', async () => {
    const cas: Array<[string, string, string]> = [
      ['projet/CLAUDE.md', 'CLAUDE.md', 'Project'],
      ['projet/.claude/CLAUDE.md', '.claude/CLAUDE.md', 'Project'],
      ['projet/CLAUDE.local.md', 'CLAUDE.local.md', 'Local'],
    ];
    for (const [rel, id, type] of cas) {
      arborescence({ [rel]: MEMOIRE_LOCALE });
      const { local } = await scanner();
      const cartes = ames(local.items);
      assert.deepStrictEqual(cartes.map((c) => c.id), [id], `${rel} seul`);
      assert.strictEqual((cartes[0].metadata as any)?.claudeMemoryType, type);
      assert.strictEqual(local.soulStat.activeCount, 1);
      assert.strictEqual(local.soulStat.tokenCount, countTokens(claudeInjectedText(MEMOIRE_LOCALE)));
    }

    arborescence({});
    const { local } = await scanner();
    assert.deepStrictEqual(ames(local.items), []);
    assert.strictEqual(local.soulStat.activeCount, 0);
    assert.strictEqual(local.soulStat.tokenCount, 0);
  });

  test('4. Un CLAUDE.local.md avec frontmatter et commentaire HTML est compté sans eux', async () => {
    const corps = '# Mémoire locale\n\nConsigne gardée.\n';
    const brut = `---\ndescription: frontmatter retiré\n---\n\n<!-- commentaire HTML retiré -->\n${corps}`;
    assert.strictEqual(claudeInjectedText(brut), corps, 'précondition : texte injecté attendu');
    arborescence({ 'projet/CLAUDE.local.md': brut });
    const { local } = await scanner();
    const [carte] = ames(local.items);
    assert.strictEqual(carte.id, 'CLAUDE.local.md');
    assert.strictEqual(carte.charCount, corps.length);
    assert.strictEqual(carte.tokenCount, countTokens(corps));
    assert.ok(carte.tokenCount! < countTokens(brut), 'moins de tokens que le fichier brut');
  });

  test('5. Antigravity ne lit ni .claude/CLAUDE.md ni CLAUDE.local.md', async () => {
    // Le .git du projet arrête la remontée d'Antigravity vers les dossiers parents (racine Git) dans le dossier temporaire
    arborescence({
      'projet/.git/HEAD': 'ref: refs/heads/main\n',
      'projet/GEMINI.md': '# Âme Antigravity\n',
      'projet/.claude/CLAUDE.md': MEMOIRE_CLAUDE,
      'projet/CLAUDE.local.md': MEMOIRE_LOCALE,
    });
    const { resultat, horsDossier } = await sousEspion(async () => LocalScanner.scan({ ...espace(), tool: 'antigravity', agentsDir: '.agents', claudeDir: null }));
    assert.deepStrictEqual(horsDossier, [], 'aucune lecture hors du dossier temporaire');
    assert.deepStrictEqual(ames(resultat.items).map((c) => c.id), ['GEMINI.md']);
  });
});
