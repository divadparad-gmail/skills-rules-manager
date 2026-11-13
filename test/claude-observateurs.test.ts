import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';

// Les observateurs propres à Claude Code pour les fichiers de mémoire situés DANS l'espace de travail et
// non couverts par les motifs communs (WATCHER_PATTERNS, inchangés, décision Q11) : le CLAUDE.local.md de la
// racine, et les fichiers importés par la mémoire du niveau projet hors de .claude/. Les cibles hors de
// l'espace (parents, imports du CLAUDE.md global ou extérieurs, MEMORY.md) relèvent d'un commit suivant.
//
// Le scan se fait dans un dossier temporaire au nom fixe, protégé par un fichier témoin, remontée arrêtée
// à la racine du dossier temporaire. vscode.workspace.createFileSystemWatcher est un faux qui note chaque
// observateur, ses motifs et sa libération.

const DOSSIER = path.join(os.tmpdir(), 'claude-observateurs-a8');
const TEMOIN = '.temoin-claude-observateurs';
const TEXTE_TEMOIN = 'Dossier temporaire du test test/claude-observateurs.test.ts.\n';
const RACINE = path.join(DOSSIER, 'racine');
const PROJET = path.join(RACINE, 'projet');
const CLAUDE_GLOBAL = path.join(DOSSIER, 'claude');
const RACINE_EXTENSION = path.resolve(__dirname, '..', '..');

// --- Faux module vscode : observateurs notés ---
interface FauxObservateur {
  motif: { base: string; pattern: string };
  rappels: { change: Array<() => void>; create: Array<() => void>; delete: Array<() => void> };
  libere: boolean;
}
const observateurs: FauxObservateur[] = [];
const vivants = () => observateurs.filter((o) => !o.libere);

class FauxRelativePattern {
  base: string;
  constructor(base: { fsPath: string } | string, public pattern: string) {
    this.base = typeof base === 'string' ? base : base.fsPath;
  }
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'vscode') {
    return 'vscode';
  }
  return origResolve.call(this, request, ...args);
};
const REGLAGES: Record<string, string> = { claudeGlobalPath: CLAUDE_GLOBAL };
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
      getConfiguration: () => ({ get: (key: string, def: any) => (key in REGLAGES ? REGLAGES[key] : def) }),
      createFileSystemWatcher: (motif: FauxRelativePattern) => {
        const o: FauxObservateur = { motif: { base: motif.base, pattern: motif.pattern }, rappels: { change: [], create: [], delete: [] }, libere: false };
        observateurs.push(o);
        return {
          onDidChange: (f: () => void) => { o.rappels.change.push(f); return { dispose: () => {} }; },
          onDidCreate: (f: () => void) => { o.rappels.create.push(f); return { dispose: () => {} }; },
          onDidDelete: (f: () => void) => { o.rappels.delete.push(f); return { dispose: () => {} }; },
          dispose: () => { o.libere = true; },
        };
      },
    },
    RelativePattern: FauxRelativePattern,
    env: { appName: 'Visual Studio Code' },
    Uri: { file: (f: string) => ({ fsPath: f, scheme: 'file' }) },
    commands: { executeCommand: () => Promise.resolve() },
  },
} as any;

import { LocalScanner } from '../src/services/LocalScanner';
import { StateManager } from '../src/services/StateManager';
import { ManagerFullState, ResourceItem, WorkspaceContext } from '../src/types';

/** Les modules d'a8.1, chargés à l'exécution : leur absence fait échouer chaque test, pas tout le fichier. */
function cibles(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../src/claude/claudeWatchTargets');
  } catch {
    throw new Error('le module src/claude/claudeWatchTargets.ts est absent');
  }
}
function enregistrement(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../src/ui/claudeWatchers');
  } catch {
    throw new Error('le module src/ui/claudeWatchers.ts est absent');
  }
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

const espace = (tool: 'claude-code' | 'antigravity' = 'claude-code'): WorkspaceContext => ({
  hasWorkspace: true,
  workspacePath: PROJET,
  tool,
  agentsDir: tool === 'antigravity' ? '.agents' : null,
  claudeDir: tool === 'claude-code' ? path.join(PROJET, '.claude') : null,
  hasClaudeMd: fs.existsSync(path.join(PROJET, 'CLAUDE.md')),
});

/** Un état minimal, formé des cartes d'un vrai scan local de Claude Code (remontée arrêtée à la racine). */
async function etatScanne(tool: 'claude-code' | 'antigravity' = 'claude-code', global: ResourceItem[] = []): Promise<ManagerFullState> {
  const local = await LocalScanner.scan(espace(tool), undefined, { claudeMemoryStopAt: RACINE });
  return { workspace: espace(tool), localResources: local.items, globalResources: global, nasResources: [] } as unknown as ManagerFullState;
}

const relatifs = (liste: string[]) => liste.map((p) => path.relative(DOSSIER, p).split(path.sep).join('/'));

describe('Observateurs de Claude Code dans l\'espace de travail : cibles, enregistrement et libération', () => {
  const rechargements: number[] = [];
  const origReload = StateManager.requestDebouncedReload;

  before(() => {
    preparerDossier();
    // Le rafraîchissement noté au lieu d'être lancé
    (StateManager as any).requestDebouncedReload = (delai: number) => { rechargements.push(delai); };
  });

  after(() => {
    (StateManager as any).requestDebouncedReload = origReload;
    if (fs.existsSync(DOSSIER)) viderSaufTemoin();
  });

  test('1. Les cibles, calculées d\'un état scanné : CLAUDE.local.md de la racine et imports de l\'espace hors des motifs communs', async () => {
    const { claudeWorkspaceWatchTargets } = cibles();
    arborescence({
      'racine/CLAUDE.md': '# Parent\n\n@cible-parent.md\n@projet/docs/du-parent.md\n',
      'racine/cible-parent.md': '# Hors de l\'espace\n',
      'racine/projet/docs/du-parent.md': '# Importé par le parent, dans l\'espace\n',
      'racine/projet/CLAUDE.md': '# Projet\n\n@docs/regles.md\n@.claude/notes.md\n@docs/AGENTS.md\n@../exterieur.md\n@docs/n1.md\n',
      'racine/projet/docs/regles.md': '# Règles\n',
      'racine/projet/.claude/notes.md': '# Sous .claude : déjà couvert\n',
      'racine/projet/docs/AGENTS.md': '# Nommé AGENTS.md : déjà couvert\n',
      'racine/exterieur.md': '# Extérieur\n',
      // Une chaîne de cinq sauts : le fichier du cinquième, non chargé, reste observé (sa création compte)
      'racine/projet/docs/n1.md': '@n2.md\n',
      'racine/projet/docs/n2.md': '@n3.md\n',
      'racine/projet/docs/n3.md': '@n4.md\n',
      'racine/projet/docs/n4.md': '@n5.md\n',
      'racine/projet/docs/n5.md': '# Cinquième saut\n',
    });
    const etat = await etatScanne('claude-code', [
      // Une carte globale (import du CLAUDE.md global, MEMORY.md) n'est jamais une cible ici
      { id: 'x', name: 'x', description: '', type: 'soul', scope: 'global', enabled: true, path: path.join(PROJET, 'docs', 'du-global.md'), targetTool: 'claude-code', isFolder: false, metadata: { claudeImport: { par: '~/.claude/CLAUDE.md', niveau: 1, externe: false } } } as ResourceItem,
    ]);
    assert.deepStrictEqual(relatifs(claudeWorkspaceWatchTargets(etat)), [
      'racine/projet/CLAUDE.local.md',
      'racine/projet/docs/du-parent.md',
      'racine/projet/docs/n1.md',
      'racine/projet/docs/n2.md',
      'racine/projet/docs/n3.md',
      'racine/projet/docs/n4.md',
      'racine/projet/docs/n5.md',
      'racine/projet/docs/regles.md',
    ]);
    // Antigravity, ou aucun dossier de travail : aucune cible
    assert.deepStrictEqual(claudeWorkspaceWatchTargets(await etatScanne('antigravity')), []);
    assert.deepStrictEqual(claudeWorkspaceWatchTargets({ ...etat, workspace: { ...etat.workspace, workspacePath: null, hasWorkspace: false } }), []);
  });

  test('2. Un chemin déjà couvert par les motifs communs n\'est pas une cible : même règle que WATCHER_PATTERNS', () => {
    const { isCoveredByCommonWatchers } = cibles();
    const couverts = ['CLAUDE.md', 'a/b/CLAUDE.md', 'AGENTS.md', 'x/GEMINI.md', '.claude/CLAUDE.md', '.claude/x/y.md', 'a/.agents/z.md', '.agent/k.md'];
    const libres = ['CLAUDE.local.md', 'docs/regles.md', 'claude/x.md', '.claude', 'a/.claudex/y.md', 'AGENTS.local.md'];
    for (const rel of couverts) assert.strictEqual(isCoveredByCommonWatchers(rel), true, rel);
    for (const rel of libres) assert.strictEqual(isCoveredByCommonWatchers(rel), false, rel);
  });

  test('3. Les cibles sont bornées à 100 observateurs', () => {
    const { claudeWorkspaceWatchTargets, CLAUDE_WATCH_MAX_TARGETS } = cibles();
    assert.strictEqual(CLAUDE_WATCH_MAX_TARGETS, 100);
    const imports = Array.from({ length: 150 }, (_, i): ResourceItem => ({
      id: `d${i}.md`, name: `d${i}.md`, description: '', type: 'soul', scope: 'local', enabled: true,
      path: path.join(PROJET, 'docs', `d${String(i).padStart(3, '0')}.md`), targetTool: 'claude-code', isFolder: false,
      metadata: { claudeImport: { par: 'CLAUDE.md', niveau: 1, externe: false } },
    }));
    const etat = { workspace: espace(), localResources: imports, globalResources: [], nasResources: [] } as unknown as ManagerFullState;
    assert.strictEqual(claudeWorkspaceWatchTargets(etat).length, 100);
  });

  test('4. L\'enregistrement : un observateur par cible, par motif relatif ; une modification lance le même rafraîchissement que les observateurs existants', async () => {
    const { registerClaudeWatchers, CLAUDE_WATCH_RELOAD_DELAY_MS } = enregistrement();
    // Le délai des observateurs existants, lu dans extension.ts : le même pour les deux
    const source = fs.readFileSync(path.join(RACINE_EXTENSION, 'src', 'extension.ts'), 'utf8');
    assert.ok(source.includes('soulWatcher.onDidChange(() => StateManager.requestDebouncedReload(350));'), 'observateur existant : 350 ms');
    assert.strictEqual(CLAUDE_WATCH_RELOAD_DELAY_MS, 350);

    arborescence({ 'racine/projet/CLAUDE.md': '# Projet\n\n@docs/regles.md\n', 'racine/projet/docs/regles.md': '# Règles\n' });
    const contexte = { subscriptions: [] as Array<{ dispose: () => void }> };
    observateurs.length = 0;
    registerClaudeWatchers(contexte);
    StateManager.broadcastState(await etatScanne());
    assert.deepStrictEqual(vivants().map((o) => [path.relative(DOSSIER, o.motif.base).split(path.sep).join('/'), o.motif.pattern]), [
      ['racine/projet', 'CLAUDE.local.md'],
      ['racine/projet/docs', 'regles.md'],
    ]);
    rechargements.length = 0;
    for (const o of vivants()) {
      o.rappels.change.forEach((f) => f());
      o.rappels.create.forEach((f) => f());
      o.rappels.delete.forEach((f) => f());
    }
    assert.deepStrictEqual(rechargements, [350, 350, 350, 350, 350, 350], 'changement, création et suppression : rafraîchissement différé de 350 ms');
    contexte.subscriptions.forEach((d) => d.dispose());
  });

  test('5. La libération : à chaque changement d\'état, les observateurs sans cible sont libérés ; aucun pour Antigravity ; tous à l\'arrêt, sans fuite', async () => {
    const { registerClaudeWatchers } = enregistrement();
    const contexte = { subscriptions: [] as Array<{ dispose: () => void }> };
    observateurs.length = 0;
    registerClaudeWatchers(contexte);

    arborescence({ 'racine/projet/CLAUDE.md': '@docs/a.md\n@docs/b.md\n', 'racine/projet/docs/a.md': 'A\n', 'racine/projet/docs/b.md': 'B\n' });
    StateManager.broadcastState(await etatScanne());
    assert.deepStrictEqual(vivants().map((o) => o.motif.pattern).sort(), ['CLAUDE.local.md', 'a.md', 'b.md']);
    const creesAvant = observateurs.length;

    // Le même état : rien n'est recréé
    StateManager.broadcastState(await etatScanne());
    assert.strictEqual(observateurs.length, creesAvant, 'aucun observateur recréé pour les mêmes cibles');

    // Une cible disparaît, une autre apparaît : l'ancienne est libérée, la nouvelle créée
    arborescence({ 'racine/projet/CLAUDE.md': '@docs/a.md\n@docs/c.md\n', 'racine/projet/docs/a.md': 'A\n', 'racine/projet/docs/c.md': 'C\n' });
    StateManager.broadcastState(await etatScanne());
    assert.deepStrictEqual(vivants().map((o) => o.motif.pattern).sort(), ['CLAUDE.local.md', 'a.md', 'c.md']);
    assert.ok(observateurs.find((o) => o.motif.pattern === 'b.md')!.libere, 'b.md libéré');

    // Antigravity : tout est libéré, rien n'est créé
    StateManager.broadcastState(await etatScanne('antigravity'));
    assert.strictEqual(vivants().length, 0, 'aucun observateur pour Antigravity');
    const creesAntigravity = observateurs.length;

    // Retour à Claude Code, puis arrêt de l'extension : tout est libéré, et l'abonnement retiré
    StateManager.broadcastState(await etatScanne());
    assert.strictEqual(vivants().length, 3);
    assert.strictEqual(observateurs.length, creesAntigravity + 3);
    contexte.subscriptions.forEach((d) => d.dispose());
    assert.strictEqual(vivants().length, 0, 'tous libérés à l\'arrêt');
    StateManager.broadcastState(await etatScanne());
    assert.strictEqual(vivants().length, 0, 'plus aucun abonnement après l\'arrêt');
    assert.strictEqual(observateurs.filter((o) => !o.libere).length, 0, 'aucune fuite');
  });

  test('6. WATCHER_PATTERNS est inchangé', async () => {
    const { WATCHER_PATTERNS } = await import('../src/extension');
    assert.deepStrictEqual(WATCHER_PATTERNS, {
      configFolders: '**/{.agents,.agent,.claude}/**',
      soulFiles: '**/{CLAUDE.md,GEMINI.md,AGENTS.md}',
    });
  });
});
