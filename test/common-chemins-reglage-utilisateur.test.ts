// Profils globaux : seuls les réglages utilisateur skillsManager.globalPath et
// skillsManager.claudeGlobalPath sont retenus.
//
// Une valeur posée par l'espace de travail (.vscode/settings.json d'un dépôt) ne doit désigner ni le
// profil d'Antigravity ni celui de Claude Code : sans valeur utilisateur, le chemin par défaut est
// utilisé.
//
// Aucun test n'ouvre de connexion : un espion de fs note chaque appel et refuse tout chemin qui
// commence par \\ ou //, sans appeler la fonction réelle (modèle : claude-memoire-imports, test 24).
// Le dossier personnel est redirigé vers un dossier temporaire : aucun profil réel n'est lu.
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe, before, after } from 'node:test';

// --- Faux module vscode ---
type Valeurs = { globalValue?: unknown; workspaceValue?: unknown };
const reglages: Record<string, Valeurs> = {};

const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'vscode') return 'vscode';
  return origResolve.call(this, request, ...args);
};
const vscodeMock = {
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  window: {
    createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
    showInformationMessage: () => Promise.resolve(undefined),
    showErrorMessage: () => Promise.resolve(undefined),
    showWarningMessage: () => Promise.resolve(undefined),
  },
  workspace: {
    workspaceFolders: [] as Array<{ uri: { fsPath: string } }>,
    getConfiguration: (section?: string) => {
      const cle = (k: string) => (section ? `${section}.${k}` : k);
      return {
        // Valeur fusionnée, comme VS Code : l'espace de travail l'emporte sur l'utilisateur
        get: (k: string, def?: unknown) => reglages[cle(k)]?.workspaceValue ?? reglages[cle(k)]?.globalValue ?? def,
        inspect: (k: string) => ({ key: cle(k), defaultValue: undefined, ...reglages[cle(k)] }),
        update: () => Promise.reject(new Error('aucune écriture de configuration attendue')),
      };
    },
  },
  env: { appName: 'Visual Studio Code' },
  Uri: { file: (f: string) => ({ fsPath: f, scheme: 'file' }) },
  commands: { executeCommand: () => Promise.resolve() },
};
require.cache['vscode'] = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscodeMock } as any;

import { getEffectiveGlobalAntigravityPath, getEffectiveGlobalClaudePath } from '../src/utils/paths';
import { resolveConfiguredAntigravityProfile } from '../src/antigravity/behaviorProfile';
import { StateManager } from '../src/services/StateManager';
import { WorkspaceDetector } from '../src/services/WorkspaceDetector';

const RACINE_EXTENSION = path.resolve(__dirname, '../..');
const PROFIL_AG_ESPACE = '\\\\hote\\partage\\config';
const PROFIL_CLAUDE_ESPACE = '\\\\hote\\partage\\claude';

// --- Espion de fs ---
const FONCTIONS_SYNC = ['existsSync', 'statSync', 'lstatSync', 'readFileSync', 'readdirSync', 'realpathSync', 'accessSync', 'openSync', 'createReadStream', 'mkdirSync', 'writeFileSync'] as const;
const FONCTIONS_PROMESSES = ['stat', 'lstat', 'readFile', 'readdir', 'realpath', 'access', 'open', 'mkdir', 'writeFile'] as const;

function estCheminReseau(p: unknown): boolean {
  if (typeof p !== 'string' && !(p instanceof URL) && !Buffer.isBuffer(p)) return false;
  const chemin = String(p instanceof URL ? p.pathname : p);
  return /^[\\/]{2}/.test(chemin);
}

/** Lance `action` sous l'espion ; rend les appels sur un chemin réseau (tous refusés) et tous les chemins vus. */
async function sousEspion<T>(action: () => Promise<T>): Promise<{ resultat: T; reseau: string[]; chemins: string[] }> {
  const reseau: string[] = [];
  const chemins: string[] = [];
  const origines: Array<() => void> = [];
  const refus = (p: unknown) => {
    const err: NodeJS.ErrnoException = new Error(`ENOENT: chemin réseau refusé par l'espion du test, '${String(p)}'`);
    err.code = 'ENOENT';
    return err;
  };
  const espionner = (cible: any, nom: string, promesse: boolean) => {
    const orig = cible[nom];
    if (typeof orig !== 'function') return;
    const espion = function (this: unknown, p: unknown, ...reste: unknown[]) {
      if (typeof p === 'string') chemins.push(p);
      if (estCheminReseau(p)) {
        reseau.push(`${nom} ${String(p)}`);
        if (promesse) return Promise.reject(refus(p));
        if (nom === 'existsSync') return false;
        throw refus(p);
      }
      return orig.call(this, p, ...reste);
    };
    cible[nom] = espion;
    origines.push(() => { cible[nom] = orig; });
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsReel = require('fs');
  FONCTIONS_SYNC.forEach((n) => espionner(fsReel, n, false));
  FONCTIONS_PROMESSES.forEach((n) => espionner(fsReel.promises, n, true));
  try {
    return { resultat: await action(), reseau, chemins };
  } finally {
    origines.forEach((r) => r());
  }
}

function poser(valeurs: Record<string, Valeurs>): void {
  for (const k of Object.keys(reglages)) delete reglages[k];
  Object.assign(reglages, valeurs);
}

const ESPACE_SEUL = {
  'skillsManager.globalPath': { workspaceValue: PROFIL_AG_ESPACE },
  'skillsManager.claudeGlobalPath': { workspaceValue: PROFIL_CLAUDE_ESPACE },
};

describe('Suite de Tests : profils globaux, réglages utilisateur seulement', () => {
  let tmp = '';
  let maison = '';
  let projet = '';
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osReel = require('os');
  const homedirOrigine = osReel.homedir;
  const envOrigine = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chemins-reglage-utilisateur-'));
    maison = path.join(tmp, 'maison');
    projet = path.join(tmp, 'projet');
    fs.mkdirSync(path.join(maison, '.gemini', 'config'), { recursive: true });
    fs.mkdirSync(path.join(maison, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(projet, '.agents', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(projet, '.agents', 'rules', 'regle.md'), '# Règle\n', 'utf8');
    // Dossier personnel redirigé : les chemins par défaut tombent dans le dossier temporaire
    osReel.homedir = () => maison;
    process.env.USERPROFILE = maison;
    process.env.HOME = maison;
    vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: projet } }];
    StateManager.setAntigravityProfileForTesting(null);
  });
  after(() => {
    osReel.homedir = homedirOrigine;
    for (const [k, v] of Object.entries(envOrigine)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    WorkspaceDetector.setOverriddenTool(null);
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('1. Valeur d\'espace en \\\\hote, sans valeur utilisateur : les deux fonctions rendent le chemin par défaut', () => {
    poser(ESPACE_SEUL);
    assert.strictEqual(getEffectiveGlobalAntigravityPath(), path.join(maison, '.gemini', 'config'));
    assert.strictEqual(getEffectiveGlobalClaudePath(), path.join(maison, '.claude'));
  });

  test('2. Valeur utilisateur : elle est retenue, même si l\'espace pose une autre valeur ; le paramètre explicite reste prioritaire', () => {
    const ag = path.join(tmp, 'profil-ag');
    const claude = path.join(tmp, 'profil-claude');
    poser({
      'skillsManager.globalPath': { globalValue: ` ${ag} `, workspaceValue: PROFIL_AG_ESPACE },
      'skillsManager.claudeGlobalPath': { globalValue: claude, workspaceValue: PROFIL_CLAUDE_ESPACE },
    });
    assert.strictEqual(getEffectiveGlobalAntigravityPath(), ag);
    assert.strictEqual(getEffectiveGlobalClaudePath(), claude);
    assert.strictEqual(getEffectiveGlobalAntigravityPath('C:\\explicite'), 'C:\\explicite');
    assert.strictEqual(getEffectiveGlobalClaudePath('C:\\explicite'), 'C:\\explicite');
  });

  test('3. Détection du profil (réglage « auto ») : aucun stat sur \\\\hote', () => {
    poser(ESPACE_SEUL);
    const vus: string[] = [];
    const statEspion = (p: string) => {
      vus.push(p);
      if (estCheminReseau(p)) throw Object.assign(new Error('ENOENT: refusé par le test'), { code: 'ENOENT' });
      return fs.statSync(p);
    };
    resolveConfiguredAntigravityProfile(getEffectiveGlobalAntigravityPath(), 'auto', statEspion as any);
    assert.ok(vus.length > 0, 'la détection consulte bien le profil par défaut');
    assert.deepStrictEqual(vus.filter(estCheminReseau), [], 'aucun stat sur \\\\hote');
  });

  for (const outil of ['claude-code', 'antigravity'] as const) {
    test(`4. Scan complet en mode ${outil} : aucun appel de fs sur \\\\hote, aucun fichier d'identifiants hors du dossier temporaire`, async () => {
      poser(ESPACE_SEUL);
      WorkspaceDetector.setOverriddenTool(outil);
      const { resultat, reseau, chemins } = await sousEspion(() => StateManager.loadFullState(true));
      assert.strictEqual(resultat.workspace.tool, outil);
      assert.deepStrictEqual(reseau, [], 'aucun appel de fs sur \\\\hote');
      const sensibles = chemins.filter((c) => ['.claude.json', '.credentials.json'].includes(path.basename(c)) && !path.resolve(c).startsWith(tmp));
      assert.deepStrictEqual(sensibles, [], 'aucun fichier d\'identifiants réel n\'est consulté');
    });
  }

  test('5. package.json déclare la portée « machine » pour globalPath et claudeGlobalPath', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(RACINE_EXTENSION, 'package.json'), 'utf8'));
    const conf = pkg.contributes.configuration;
    const proprietes = (Array.isArray(conf) ? conf : [conf]).reduce((a: any, c: any) => Object.assign(a, c.properties), {});
    assert.strictEqual(proprietes['skillsManager.globalPath'].scope, 'machine');
    assert.strictEqual(proprietes['skillsManager.claudeGlobalPath'].scope, 'machine');
  });
});
