import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';

// Les observateurs propres à Claude Code pour les fichiers de mémoire situés DANS l'espace de travail et
// non couverts par les motifs communs (WATCHER_PATTERNS, inchangés, décision Q11) : le CLAUDE.local.md de la
// racine, et les fichiers importés par la mémoire du niveau projet hors de .claude/. Puis (second bloc) les
// cibles HORS de l'espace : fichiers de mémoire des parents, imports extérieurs, CLAUDE.md global et ses
// imports, MEMORY.md à l'emplacement calculé et settings.json du profil, sous le même plafond.
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
/** Les écouteurs passés au faux onDidChangeConfiguration, retirés à leur libération. */
type EvenementReglages = { affectsConfiguration: (section: string) => boolean };
const ecouteursReglages: Array<(e: EvenementReglages) => void> = [];
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
      onDidChangeConfiguration: (f: (e: EvenementReglages) => void) => {
        ecouteursReglages.push(f);
        return { dispose: () => { const i = ecouteursReglages.indexOf(f); if (i >= 0) ecouteursReglages.splice(i, 1); } };
      },
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
import { GlobalScanner } from '../src/services/GlobalScanner';
import { scanClaudeAutoMemory } from '../src/services/claudeAutoMemory';
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

// --- a8.2 : les cibles hors de l'espace de travail ---
//
// Le profil est le faux profil du dossier temporaire (réglage claudeGlobalPath du faux vscode) ; la racine Git
// est cherchée en remontant jusqu'à RACINE seulement (stopAt) ; l'environnement de la mémoire automatique est
// vide. Aucun fichier du vrai profil n'est lu.

/** Le nom du dossier de mémoire d'une racine (même transformation que src/claude/autoMemory.ts). */
const nomMemoire = (racine: string) => racine.replace(/[^A-Za-z0-9]/g, '-');
const MEMOIRE_PROJET = `claude/projects/${nomMemoire(PROJET)}/memory/MEMORY.md`;

/** L'arbre complet : un parent (trois fichiers de mémoire, un import), un projet, un import extérieur et un faux profil. */
const ARBRE_COMPLET: Record<string, string> = {
  'racine/CLAUDE.md': '# Parent\n\n@cible-parent.md\n',
  'racine/.claude/CLAUDE.md': '# Parent, sous .claude\n',
  'racine/AGENTS.md': '# AGENTS.md du parent, ignoré : un CLAUDE.md est présent\n',
  'racine/cible-parent.md': '# Importé par le parent, hors de l\'espace\n',
  'racine/exterieur.md': '# Import extérieur\n',
  'racine/projet/CLAUDE.md': '# Projet\n\n@docs/regles.md\n@../exterieur.md\n',
  'racine/projet/CLAUDE.local.md': '# Local\n',
  'racine/projet/docs/regles.md': '# Règles\n',
  'claude/CLAUDE.md': '# Global\n\n@regles-globales.md\n',
  'claude/regles-globales.md': '# Importé par le CLAUDE.md global\n',
  [MEMOIRE_PROJET]: '# Mémoire\n',
};

/** Un état complet de Claude Code : scan local, scan global du faux profil, mémoire automatique. */
async function etatComplet(env: Record<string, string | undefined> = {}): Promise<ManagerFullState> {
  const local = await LocalScanner.scan(espace(), undefined, { claudeMemoryStopAt: RACINE });
  const global = await GlobalScanner.scan(path.join(DOSSIER, 'gemini'), 'claude-code');
  const memoire = scanClaudeAutoMemory({ cwd: PROJET, globalPath: CLAUDE_GLOBAL, stopAt: RACINE, env });
  return {
    workspace: espace(),
    localResources: local.items,
    globalResources: [...global.items, ...(memoire.item ? [memoire.item] : [])],
    nasResources: [],
    stats: { claudeAutoMemory: memoire.stat },
  } as unknown as ManagerFullState;
}

/** Le contexte du calcul des cibles : faux profil, accès réel au .git, remontée arrêtée à RACINE. */
function contexteCibles(): any {
  const { claudeGitEntry } = enregistrement();
  if (typeof claudeGitEntry !== 'function') throw new Error('claudeGitEntry est absent de src/ui/claudeWatchers.ts');
  return { globalPath: CLAUDE_GLOBAL, gitEntry: claudeGitEntry, stopAt: RACINE };
}

function fonction(nom: string): (...args: any[]) => any {
  const f = cibles()[nom];
  if (typeof f !== 'function') throw new Error(`${nom} est absent de src/claude/claudeWatchTargets.ts`);
  return f;
}

const CIBLES_ESPACE = ['racine/projet/CLAUDE.local.md', 'racine/projet/docs/regles.md'];
const CIBLES_DEHORS = [
  'claude/CLAUDE.md',
  MEMOIRE_PROJET,
  'claude/regles-globales.md',
  'claude/settings.json',
  'racine/.claude/CLAUDE.md',
  'racine/AGENTS.md',
  'racine/CLAUDE.md',
  'racine/cible-parent.md',
  'racine/exterieur.md',
];

describe('Observateurs de Claude Code hors de l\'espace de travail : cibles, plafond partagé, enregistrement et libération', () => {
  const rechargements: number[] = [];
  const origReload = StateManager.requestDebouncedReload;

  before(() => {
    preparerDossier();
    (StateManager as any).requestDebouncedReload = (delai: number) => { rechargements.push(delai); };
  });

  after(() => {
    (StateManager as any).requestDebouncedReload = origReload;
    if (fs.existsSync(DOSSIER)) viderSaufTemoin();
  });

  test('7. Les cibles du dehors, calculées d\'un état scanné : parents, imports extérieurs, CLAUDE.md global et ses imports, MEMORY.md, settings.json du profil ; l\'espace d\'abord', async () => {
    const claudeOutsideWatchTargets = fonction('claudeOutsideWatchTargets');
    const claudeWatchTargets = fonction('claudeWatchTargets');
    arborescence(ARBRE_COMPLET);
    const etat = await etatComplet();
    assert.strictEqual(etat.stats.claudeAutoMemory?.etat, 'present');
    assert.deepStrictEqual(relatifs(claudeOutsideWatchTargets(etat, contexteCibles())), CIBLES_DEHORS);
    assert.deepStrictEqual([...CIBLES_DEHORS].sort(), CIBLES_DEHORS, 'ordre alphabétique');
    // L'ensemble : les cibles de l'espace d'abord (a8.1, inchangées), puis celles du dehors
    assert.deepStrictEqual(relatifs(claudeWatchTargets(etat, contexteCibles())), [...CIBLES_ESPACE, ...CIBLES_DEHORS]);

    // MEMORY.md absent : observé quand même, à l'emplacement calculé
    fs.rmSync(path.join(DOSSIER, ...MEMOIRE_PROJET.split('/')));
    const sansMemoire = await etatComplet();
    assert.strictEqual(sansMemoire.stats.claudeAutoMemory?.etat, 'absent');
    assert.ok(relatifs(claudeOutsideWatchTargets(sansMemoire, contexteCibles())).includes(MEMOIRE_PROJET), 'MEMORY.md absent, observé');

    // Une racine Git au-dessus du projet : l'emplacement suit la racine Git, comme la mémoire automatique
    fs.mkdirSync(path.join(RACINE, '.git'));
    const avecGit = await etatComplet();
    assert.strictEqual(avecGit.stats.claudeAutoMemory?.etat, 'absent');
    const dehorsGit = relatifs(claudeOutsideWatchTargets(avecGit, contexteCibles()));
    assert.ok(dehorsGit.includes(`claude/projects/${nomMemoire(RACINE)}/memory/MEMORY.md`), 'emplacement de la racine Git');
    assert.ok(!dehorsGit.includes(MEMOIRE_PROJET), 'plus celui du dossier de travail');
  });

  test('8. Les exclusions : parent absent, emplacement non déterminé, mémoire désactivée, état sans mémoire automatique', async () => {
    const claudeOutsideWatchTargets = fonction('claudeOutsideWatchTargets');
    // Aucun fichier dans les parents, aucun CLAUDE.md global : seuls MEMORY.md (absent) et settings.json restent
    arborescence({ 'racine/projet/CLAUDE.md': '# Projet\n' });
    assert.deepStrictEqual(relatifs(claudeOutsideWatchTargets(await etatComplet(), contexteCibles())), [MEMOIRE_PROJET, 'claude/settings.json']);

    // Emplacement non déterminé (variable qui déplace la mémoire) : aucune cible MEMORY.md
    arborescence(ARBRE_COMPLET);
    const nonDetermine = await etatComplet({ CLAUDE_CODE_PROJECT_DIR_NAME: 'ailleurs' });
    assert.strictEqual(nonDetermine.stats.claudeAutoMemory?.etat, 'non-determine');
    assert.deepStrictEqual(relatifs(claudeOutsideWatchTargets(nonDetermine, contexteCibles())), CIBLES_DEHORS.filter((c) => c !== MEMOIRE_PROJET));

    // Un .git qui est un fichier (worktree) : non déterminé, aucune cible MEMORY.md
    fs.writeFileSync(path.join(PROJET, '.git'), 'gitdir: ailleurs\n', 'utf8');
    const worktree = await etatComplet();
    assert.strictEqual(worktree.stats.claudeAutoMemory?.etat, 'non-determine');
    assert.ok(!relatifs(claudeOutsideWatchTargets(worktree, contexteCibles())).some((c) => c.endsWith('MEMORY.md')), 'worktree : aucun MEMORY.md');
    fs.rmSync(path.join(PROJET, '.git'));

    // Mémoire désactivée par le settings.json du profil : aucune cible MEMORY.md, mais settings.json reste observé
    fs.writeFileSync(path.join(CLAUDE_GLOBAL, 'settings.json'), '{ "autoMemoryEnabled": false }\n', 'utf8');
    const desactivee = await etatComplet();
    assert.strictEqual(desactivee.stats.claudeAutoMemory?.etat, 'desactivee');
    assert.deepStrictEqual(relatifs(claudeOutsideWatchTargets(desactivee, contexteCibles())), CIBLES_DEHORS.filter((c) => c !== MEMOIRE_PROJET));

    // Mémoire désactivée par la variable : de même
    fs.rmSync(path.join(CLAUDE_GLOBAL, 'settings.json'));
    const parVariable = await etatComplet({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
    assert.strictEqual(parVariable.stats.claudeAutoMemory?.etat, 'desactivee');
    assert.ok(!relatifs(claudeOutsideWatchTargets(parVariable, contexteCibles())).includes(MEMOIRE_PROJET));

    // Un état sans ligne de mémoire automatique (le profil n'a pas été lu pour cet espace) : ni MEMORY.md ni settings.json
    const sansStat = { ...(await etatComplet()), stats: {} } as unknown as ManagerFullState;
    assert.deepStrictEqual(relatifs(claudeOutsideWatchTargets(sansStat, contexteCibles())), CIBLES_DEHORS.filter((c) => c !== MEMOIRE_PROJET && c !== 'claude/settings.json'));
  });

  test('9. Un seul plafond de 100 pour toutes les cibles : l\'espace d\'abord, puis le dehors, chacun dans l\'ordre alphabétique', () => {
    const claudeWatchTargets = fonction('claudeWatchTargets');
    const carte = (fichier: string): ResourceItem => ({
      id: path.basename(fichier), name: path.basename(fichier), description: '', type: 'soul', scope: 'local', enabled: true,
      path: fichier, targetTool: 'claude-code', isFolder: false,
      metadata: { claudeImport: { par: 'CLAUDE.md', niveau: 1, externe: !fichier.startsWith(PROJET) } },
    });
    const dedans = (n: number) => Array.from({ length: n }, (_, i) => carte(path.join(PROJET, 'docs', `d${String(i).padStart(3, '0')}.md`)));
    const dehors = (n: number) => Array.from({ length: n }, (_, i) => carte(path.join(RACINE, 'ext', `e${String(i).padStart(3, '0')}.md`)));
    const etat = (cartes: ResourceItem[]) => ({ workspace: espace(), localResources: cartes.reverse(), globalResources: [], nasResources: [], stats: {} }) as unknown as ManagerFullState;

    // 70 dans l'espace (CLAUDE.local.md, toujours visé, et 69 imports), 70 au dehors (mélangés) : les 70 de
    // l'espace, puis les 30 premières du dehors
    const liste = relatifs(claudeWatchTargets(etat([...dehors(70), ...dedans(69)]), contexteCibles()));
    assert.strictEqual(liste.length, 100);
    const espaceAttendu = [path.join(PROJET, 'CLAUDE.local.md'), ...dedans(69).map((c) => c.path)].sort();
    assert.deepStrictEqual(liste.slice(0, 70), relatifs(espaceAttendu), 'l\'espace d\'abord, trié');
    assert.deepStrictEqual(liste.slice(70), relatifs(dehors(70).map((c) => c.path)).sort().slice(0, 30), 'puis les premières du dehors');

    // 120 dans l'espace : aucune place pour le dehors
    const plein = relatifs(claudeWatchTargets(etat([...dehors(10), ...dedans(120)]), contexteCibles()));
    assert.strictEqual(plein.length, 100);
    assert.ok(plein.every((c) => c.startsWith('racine/projet/')), 'aucune cible du dehors au-delà du plafond');
  });

  test('10. L\'enregistrement : un observateur par fichier visé, motif relatif (dossier, nom), aucun motif récursif sur le profil', async () => {
    const { registerClaudeWatchers } = enregistrement();
    arborescence(ARBRE_COMPLET);
    const contexte = { subscriptions: [] as Array<{ dispose: () => void }> };
    observateurs.length = 0;
    registerClaudeWatchers(contexte, { stopAt: RACINE });
    StateManager.broadcastState(await etatComplet());
    const paires = vivants().map((o) => [path.relative(DOSSIER, o.motif.base).split(path.sep).join('/'), o.motif.pattern]);
    assert.deepStrictEqual(paires, [...CIBLES_ESPACE, ...CIBLES_DEHORS].map((c) => [path.posix.dirname(c), path.posix.basename(c)]));
    for (const o of vivants()) {
      assert.ok(typeof o.motif.base === 'string' && path.isAbsolute(o.motif.base), 'motif relatif, base absolue');
      assert.ok(!/[*?{}[\]\\/]/.test(o.motif.pattern), `nom seul, sans joker ni sous-dossier : ${o.motif.pattern}`);
    }
    const profil = vivants().filter((o) => o.motif.base === CLAUDE_GLOBAL || o.motif.base.startsWith(CLAUDE_GLOBAL + path.sep));
    assert.ok(profil.length > 0);
    assert.ok(!profil.some((o) => o.motif.base === path.join(CLAUDE_GLOBAL, 'projects', nomMemoire(PROJET))), 'projects/<nom>/ n\'est pas une base');

    // Une modification d'un fichier du dehors lance le même rafraîchissement de 350 ms
    rechargements.length = 0;
    for (const o of vivants().filter((v) => !v.motif.base.startsWith(PROJET))) {
      o.rappels.change.forEach((f) => f());
      o.rappels.create.forEach((f) => f());
      o.rappels.delete.forEach((f) => f());
    }
    assert.strictEqual(rechargements.length, CIBLES_DEHORS.length * 3);
    assert.ok(rechargements.every((d) => d === 350));
    contexte.subscriptions.forEach((d) => d.dispose());
    assert.strictEqual(vivants().length, 0, 'tous libérés à l\'arrêt');
  });

  test('11. La libération : une cible du dehors qui disparaît libère son observateur ; les autres gardent le leur', async () => {
    const { registerClaudeWatchers } = enregistrement();
    arborescence(ARBRE_COMPLET);
    const contexte = { subscriptions: [] as Array<{ dispose: () => void }> };
    observateurs.length = 0;
    registerClaudeWatchers(contexte, { stopAt: RACINE });
    StateManager.broadcastState(await etatComplet());
    const trouver = (rel: string) => observateurs.find((o) => path.join(o.motif.base, o.motif.pattern) === path.join(DOSSIER, ...rel.split('/')))!;
    const reglages = trouver('claude/settings.json');
    const memoire = trouver(MEMOIRE_PROJET);
    assert.ok(reglages && memoire, 'settings.json et MEMORY.md observés');
    const crees = observateurs.length;

    // Le CLAUDE.md du parent disparaît : son observateur et celui de son import sont libérés
    fs.rmSync(path.join(RACINE, 'CLAUDE.md'));
    StateManager.broadcastState(await etatComplet());
    assert.ok(trouver('racine/CLAUDE.md').libere, 'parent libéré');
    assert.ok(trouver('racine/cible-parent.md').libere, 'son import libéré');
    assert.ok(!reglages.libere && !memoire.libere, 'les autres gardent le leur');
    assert.strictEqual(observateurs.length, crees, 'rien de recréé');

    // La mémoire automatique est désactivée : l'observateur de MEMORY.md est libéré, celui de settings.json reste
    fs.writeFileSync(path.join(CLAUDE_GLOBAL, 'settings.json'), '{ "autoMemoryEnabled": false }\n', 'utf8');
    StateManager.broadcastState(await etatComplet());
    assert.ok(memoire.libere, 'MEMORY.md libéré');
    assert.ok(!reglages.libere, 'settings.json toujours observé');

    contexte.subscriptions.forEach((d) => d.dispose());
    assert.strictEqual(vivants().length, 0, 'aucune fuite');
  });

  test('12. Aucun observateur sous Antigravity, et aucun accès au .git', async () => {
    const claudeWatchTargets = fonction('claudeWatchTargets');
    const claudeOutsideWatchTargets = fonction('claudeOutsideWatchTargets');
    const { registerClaudeWatchers } = enregistrement();
    arborescence(ARBRE_COMPLET);
    const etat = { ...(await etatComplet()), workspace: espace('antigravity') } as ManagerFullState;
    let acces = 0;
    const contexteEspion = { ...contexteCibles(), gitEntry: () => { acces++; return null; } };
    assert.deepStrictEqual(claudeOutsideWatchTargets(etat, contexteEspion), []);
    assert.deepStrictEqual(claudeWatchTargets(etat, contexteEspion), []);
    assert.strictEqual(acces, 0, 'aucun accès au .git sous Antigravity');

    const contexte = { subscriptions: [] as Array<{ dispose: () => void }> };
    observateurs.length = 0;
    registerClaudeWatchers(contexte, { stopAt: RACINE });
    StateManager.broadcastState(etat);
    assert.strictEqual(observateurs.length, 0, 'aucun observateur créé sous Antigravity');
    contexte.subscriptions.forEach((d) => d.dispose());
  });
});

// --- Le rechargement sur les réglages du scan (revue d'avant le push) ---
//
// Depuis a8.2, des observateurs visent des fichiers du profil de Claude Code : un changement de
// skillsManager.claudeGlobalPath doit relancer le scan, comme le dossier global et le profil d'Antigravity.

describe('Rechargement sur les réglages qui changent le scan', () => {
  /** Un faux événement : comme VS Code, une section est touchée si c'est le réglage ou l'un de ses parents. */
  const evenement = (reglage: string): EvenementReglages => ({
    affectsConfiguration: (section: string) => reglage === section || reglage.startsWith(`${section}.`),
  });

  test('13. Un changement de skillsManager.claudeGlobalPath demande le rechargement différé, comme globalPath et le profil d\'Antigravity', async () => {
    const extension: any = await import('../src/extension');
    assert.strictEqual(typeof extension.registerScanSettingsReload, 'function', 'registerScanSettingsReload est absent de src/extension.ts');
    const contexte = { subscriptions: [] as Array<{ dispose: () => void }> };
    const avant = ecouteursReglages.length;
    extension.registerScanSettingsReload(contexte);
    assert.strictEqual(ecouteursReglages.length, avant + 1, 'un écouteur, par le faux onDidChangeConfiguration');
    const ecouteur = ecouteursReglages[ecouteursReglages.length - 1];

    const demandes: Array<number | undefined> = [];
    const origine = StateManager.requestDebouncedReload;
    (StateManager as any).requestDebouncedReload = (delai?: number) => { demandes.push(delai); };
    try {
      for (const reglage of ['skillsManager.claudeGlobalPath', 'skillsManager.globalPath', 'skillsManager.antigravityProfile']) {
        demandes.length = 0;
        ecouteur(evenement(reglage));
        assert.deepStrictEqual(demandes, [350], `${reglage} demande un rechargement différé de 350 ms`);
      }
      for (const reglage of ['antigravity.discovery.enabled', 'editor.fontSize']) {
        demandes.length = 0;
        ecouteur(evenement(reglage));
        assert.deepStrictEqual(demandes, [], `${reglage} ne relance pas le scan`);
      }
    } finally {
      (StateManager as any).requestDebouncedReload = origine;
      contexte.subscriptions.forEach((d) => d.dispose());
    }
    assert.strictEqual(ecouteursReglages.length, avant, 'l\'écouteur est retiré à l\'arrêt');
  });
});
