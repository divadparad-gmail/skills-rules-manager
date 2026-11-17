// Catalogue NAS : seul le réglage utilisateur skillsManager.nasPath est retenu.
//
// Un dépôt ouvert peut poser des réglages dans .vscode/settings.json. Une valeur de nasPath venue de
// l'espace de travail ne doit ni désigner le dossier consulté, ni faire écrire la configuration de
// l'utilisateur. L'ajout d'un hôte à security.allowedUNCHosts ne se fait qu'au clic, après une
// confirmation qui nomme l'hôte.
//
// Aucun test n'ouvre de connexion : un espion de fs note chaque appel et refuse tout chemin qui
// commence par \\ ou //, sans appeler la fonction réelle (modèle : claude-memoire-imports, test 24).
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe, before, after } from 'node:test';

// --- Faux module vscode ---
type Valeurs = { globalValue?: unknown; workspaceValue?: unknown };
const reglages: Record<string, Record<string, Valeurs>> = {};
const ecritures: Array<{ section: string; cle: string; valeur: unknown; cible: unknown }> = [];
const avertissements: Array<{ message: string; options: any; boutons: string[] }> = [];
const saisies: Array<{ value?: string }> = [];
const dialogues: Array<{ defaultUri?: unknown }> = [];
const erreurs: string[] = [];
let reponseConfirmation: 'accepter' | 'refuser' = 'refuser';
let gestionnaireMessages: ((m: unknown) => Promise<void>) | null = null;
const evenements: string[] = [];

const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
const uriFile = (f: string) => ({ fsPath: f, scheme: 'file', toString: () => `file:${f}` });
const fauxWebview = () => ({
  options: {},
  html: '',
  cspSource: 'csp',
  asWebviewUri: (u: unknown) => u,
  postMessage: () => Promise.resolve(true),
  onDidReceiveMessage: (cb: (m: unknown) => Promise<void>) => { gestionnaireMessages = cb; return { dispose() {} }; },
});

const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'vscode') return 'vscode';
  return origResolve.call(this, request, ...args);
};
require.cache['vscode'] = {
  id: 'vscode',
  filename: 'vscode',
  loaded: true,
  exports: {
    ConfigurationTarget,
    ViewColumn: { One: 1 },
    window: {
      activeTextEditor: undefined,
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
      showInformationMessage: () => Promise.resolve(undefined),
      showErrorMessage: (m: string) => { erreurs.push(m); return Promise.resolve(undefined); },
      showWarningMessage: (message: string, options: any, ...boutons: string[]) => {
        evenements.push('confirmation');
        avertissements.push({ message, options, boutons });
        return Promise.resolve(reponseConfirmation === 'accepter' ? boutons[0] : undefined);
      },
      showInputBox: (o: { value?: string }) => { saisies.push(o); return Promise.resolve(undefined); },
      showOpenDialog: (o: { defaultUri?: unknown }) => { dialogues.push(o); return Promise.resolve(undefined); },
      createWebviewPanel: () => ({
        webview: fauxWebview(),
        onDidDispose: () => ({ dispose() {} }),
        reveal() {},
        dispose() {},
      }),
    },
    workspace: {
      workspaceFolders: [],
      getConfiguration: (section: string) => {
        const valeurs = () => (reglages[section] = reglages[section] || {});
        return {
          // Valeur fusionnée, comme VS Code : l'espace de travail l'emporte sur l'utilisateur
          get: (cle: string, def?: unknown) => {
            const v = valeurs()[cle];
            return v?.workspaceValue ?? v?.globalValue ?? def;
          },
          inspect: (cle: string) => ({ key: `${section}.${cle}`, defaultValue: undefined, ...valeurs()[cle] }),
          update: (cle: string, valeur: unknown, cible: unknown) => {
            evenements.push(`ecriture ${section}.${cle}`);
            ecritures.push({ section, cle, valeur, cible });
            valeurs()[cle] = { ...valeurs()[cle], globalValue: valeur };
            return Promise.resolve();
          },
        };
      },
    },
    env: { appName: 'Visual Studio Code' },
    Uri: {
      file: uriFile,
      joinPath: (base: { fsPath: string }, ...parts: string[]) => uriFile(path.join(base.fsPath, ...parts)),
    },
    commands: { executeCommand: () => Promise.resolve() },
  },
} as any;

import { NasScanner } from '../src/services/NasScanner';
import { StateManager } from '../src/services/StateManager';
import { DeleteService } from '../src/services/DeleteService';
import { SidebarViewProvider } from '../src/providers/SidebarViewProvider';
import { DashboardPanel } from '../src/providers/DashboardPanel';
import { ResourceItem } from '../src/types';

const RACINE_EXTENSION = path.resolve(__dirname, '../..');
const CATALOGUE_ESPACE = '\\\\hote\\partage\\catalogue';
const CATALOGUE_UTILISATEUR_RESEAU = '\\\\hote\\partage\\catalogue';
const AUTRE_HOTE = '\\\\autre\\partage';

// --- Espion de fs ---
const FONCTIONS_SYNC = ['existsSync', 'statSync', 'lstatSync', 'readFileSync', 'readdirSync', 'realpathSync', 'accessSync', 'openSync', 'createReadStream', 'mkdirSync', 'writeFileSync'] as const;
const FONCTIONS_PROMESSES = ['stat', 'lstat', 'readFile', 'readdir', 'realpath', 'access', 'open', 'mkdir', 'writeFile'] as const;

function estCheminReseau(p: unknown): boolean {
  if (typeof p !== 'string' && !(p instanceof URL) && !Buffer.isBuffer(p)) return false;
  const chemin = String(p instanceof URL ? p.pathname : p);
  return /^[\\/]{2}/.test(chemin);
}

/** Lance `action` sous l'espion ; rend les appels de fs faits sur un chemin réseau (tous refusés). */
async function sousEspion<T>(action: () => Promise<T>): Promise<{ resultat: T; reseau: string[] }> {
  const reseau: string[] = [];
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
    return { resultat: await action(), reseau };
  } finally {
    origines.forEach((r) => r());
  }
}

function poser(nasPath: Valeurs, hotesAutorises: string[] = []): void {
  for (const k of Object.keys(reglages)) delete reglages[k];
  reglages.skillsManager = { nasPath };
  reglages.security = { allowedUNCHosts: { globalValue: hotesAutorises } };
  ecritures.length = 0;
  avertissements.length = 0;
  saisies.length = 0;
  dialogues.length = 0;
  erreurs.length = 0;
  evenements.length = 0;
  reponseConfirmation = 'refuser';
}

// Le clic recharge l'état : le rechargement est neutralisé, seul le traitement du clic est testé
const loadFullStateOrigine = StateManager.loadFullState;
before(() => { (StateManager as any).loadFullState = async () => ({}); });
after(() => { (StateManager as any).loadFullState = loadFullStateOrigine; });

async function ouvrirBarreLaterale(): Promise<(m: unknown) => Promise<void>> {
  gestionnaireMessages = null;
  const vue = { webview: fauxWebview(), onDidDispose: () => ({ dispose() {} }) };
  new SidebarViewProvider(uriFile(RACINE_EXTENSION) as any).resolveWebviewView(vue as any, {} as any, {} as any);
  assert.ok(gestionnaireMessages, 'la barre latérale écoute ses messages');
  return gestionnaireMessages!;
}

async function ouvrirTableauDeBord(): Promise<(m: unknown) => Promise<void>> {
  gestionnaireMessages = null;
  DashboardPanel.currentPanel = undefined;
  DashboardPanel.createOrShow(uriFile(RACINE_EXTENSION) as any);
  assert.ok(gestionnaireMessages, 'le tableau de bord écoute ses messages');
  return gestionnaireMessages!;
}

describe('Suite de Tests : catalogue NAS, réglage utilisateur seulement', () => {
  let tmp = '';
  let catalogue = '';

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-reglage-utilisateur-'));
    catalogue = path.join(tmp, 'catalogue');
    fs.mkdirSync(path.join(catalogue, 'skills', 'demo'), { recursive: true });
    fs.mkdirSync(path.join(catalogue, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(catalogue, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: Skill de démonstration\n---\n\n# Demo\n', 'utf8');
    fs.writeFileSync(path.join(catalogue, 'rules', 'regle.md'), '# Règle\n\nUne règle du catalogue.\n', 'utf8');
  });
  after(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('1. Valeur d\'espace en \\\\hote, sans valeur utilisateur : le scan n\'écrit aucune configuration et ne touche pas l\'hôte', async () => {
    poser({ workspaceValue: CATALOGUE_ESPACE });
    const { resultat, reseau } = await sousEspion(() => NasScanner.scan());
    assert.deepStrictEqual(ecritures, [], 'aucune écriture de configuration');
    assert.deepStrictEqual(reseau, [], 'aucun appel de fs sur \\\\hote');
    assert.strictEqual(resultat.status.configured, false, 'la valeur d\'espace vaut « aucun catalogue »');
    assert.strictEqual(resultat.status.path, '');
    assert.deepStrictEqual(resultat.items, []);
  });

  test('2. Valeur utilisateur locale : le catalogue est lu comme avant, même si l\'espace pose une autre valeur', async () => {
    const attendu = await NasScanner.scan(catalogue, 'antigravity');
    assert.ok(attendu.status.online, 'catalogue de référence en ligne');
    assert.ok(attendu.items.length >= 2, 'le skill et la règle sont lus');

    poser({ globalValue: catalogue });
    const seul = await sousEspion(() => NasScanner.scan());
    assert.strictEqual(seul.resultat.status.path, catalogue);
    assert.deepStrictEqual(seul.resultat.items, attendu.items, 'valeur utilisateur seule : mêmes éléments');

    poser({ globalValue: catalogue, workspaceValue: CATALOGUE_ESPACE });
    const avecEspace = await sousEspion(() => NasScanner.scan());
    assert.deepStrictEqual(avecEspace.reseau, [], 'la valeur d\'espace n\'est pas consultée');
    assert.deepStrictEqual(ecritures, [], 'aucune écriture de configuration');
    assert.strictEqual(avecEspace.resultat.status.path, catalogue, 'la valeur utilisateur l\'emporte');
    assert.deepStrictEqual(avecEspace.resultat.items, attendu.items);
  });

  test('3. Le scan n\'écrit jamais security.allowedUNCHosts, même pour un catalogue utilisateur sur un hôte non autorisé', async () => {
    poser({ globalValue: CATALOGUE_UTILISATEUR_RESEAU });
    const { resultat, reseau } = await sousEspion(() => NasScanner.scan());
    assert.deepStrictEqual(ecritures, [], 'aucune écriture de configuration pendant le scan');
    assert.strictEqual(resultat.status.online, false);
    assert.ok(reseau.length > 0, 'le catalogue choisi par l\'utilisateur est bien tenté (et refusé par l\'espion)');
  });

  for (const [nom, ouvrir] of [['barre latérale', ouvrirBarreLaterale], ['tableau de bord', ouvrirTableauDeBord]] as const) {
    test(`4. Clic « Débloquer » (${nom}) : confirmation modale qui nomme l'hôte, écriture seulement après acceptation`, async () => {
      const recevoir = await ouvrir();

      // Refus : aucune écriture. Le chemin envoyé par la vue est ignoré : seul le réglage utilisateur compte
      poser({ globalValue: CATALOGUE_UTILISATEUR_RESEAU });
      await sousEspion(() => recevoir({ type: 'allowUncHost', payload: { path: AUTRE_HOTE } }));
      assert.strictEqual(avertissements.length, 1, 'une confirmation est demandée');
      assert.strictEqual(avertissements[0].options?.modal, true, 'la confirmation est modale');
      assert.match(avertissements[0].message + ' ' + (avertissements[0].options?.detail || ''), /hote/, 'la confirmation nomme l\'hôte');
      assert.doesNotMatch(JSON.stringify(avertissements), /autre/, 'le chemin envoyé par la vue n\'est pas utilisé');
      assert.deepStrictEqual(ecritures, [], 'refus : aucune écriture');

      // Acceptation : une seule écriture, dans les réglages utilisateur, après la confirmation
      poser({ globalValue: CATALOGUE_UTILISATEUR_RESEAU }, ['deja']);
      reponseConfirmation = 'accepter';
      await sousEspion(() => recevoir({ type: 'allowUncHost', payload: { path: AUTRE_HOTE } }));
      assert.deepStrictEqual(evenements, ['confirmation', 'ecriture security.allowedUNCHosts']);
      assert.deepStrictEqual(ecritures, [{ section: 'security', cle: 'allowedUNCHosts', valeur: ['deja', 'hote'], cible: ConfigurationTarget.Global }]);

      // Valeur d'espace seulement : rien à autoriser, aucune écriture même si l'utilisateur accepterait
      poser({ workspaceValue: CATALOGUE_ESPACE });
      reponseConfirmation = 'accepter';
      await sousEspion(() => recevoir({ type: 'allowUncHost', payload: { path: CATALOGUE_ESPACE } }));
      assert.deepStrictEqual(ecritures, [], 'valeur d\'espace : aucune écriture');
    });

    test(`5. « Parcourir » et « Modifier » (${nom}) ne proposent ni ne touchent une valeur d'espace`, async () => {
      const recevoir = await ouvrir();
      poser({ workspaceValue: CATALOGUE_ESPACE });
      const parcourir = await sousEspion(() => recevoir({ type: 'browseNasPath' }));
      assert.deepStrictEqual(parcourir.reseau, [], 'aucun appel de fs sur \\\\hote');
      assert.strictEqual(dialogues.length, 1);
      assert.strictEqual(dialogues[0].defaultUri, undefined, 'la boîte de sélection ne part pas de la valeur d\'espace');

      await sousEspion(() => recevoir({ type: 'editNasPath' }));
      assert.strictEqual(saisies.length, 1);
      assert.strictEqual(saisies[0].value, '', 'la saisie ne propose pas la valeur d\'espace');
      assert.deepStrictEqual(ecritures, []);
    });
  }

  test('6. Suppression d\'une ressource : une valeur d\'espace ne compte pas comme catalogue configuré', async () => {
    poser({ workspaceValue: CATALOGUE_ESPACE });
    const item = { id: 'regle', name: 'regle.md', description: '', type: 'rule', scope: 'local', path: path.join(tmp, 'regle.md'), enabled: true, syncStatus: 'nas_offline' } as ResourceItem;
    const { resultat, reseau } = await sousEspion(() => DeleteService.deleteResource(item));
    assert.strictEqual(resultat.success, false);
    assert.match(resultat.error || '', /Aucun catalogue NAS n'est configuré/);
    assert.deepStrictEqual(reseau, []);
  });

  test('7. Une seule lecture du réglage et une seule écriture de la liste des hôtes dans src/', () => {
    const fichiers: string[] = [];
    const parcourir = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) parcourir(p);
        else if (/\.(ts|js)$/.test(e.name)) fichiers.push(p);
      }
    };
    parcourir(path.join(RACINE_EXTENSION, 'src'));
    const rel = (p: string) => path.relative(RACINE_EXTENSION, p).split(path.sep).join('/');
    const lecturesFusionnees = fichiers.filter((f) => /\.get(<[^>]*>)?\(\s*['"]nasPath['"]/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    assert.deepStrictEqual(lecturesFusionnees, [], 'aucune lecture de nasPath par get() (valeur fusionnée)');
    const appelsEcriture = fichiers
      .filter((f) => /ensureAllowedUNCHost\(/.test(fs.readFileSync(f, 'utf8').replace(/static async ensureAllowedUNCHost\(/, '')))
      .map(rel);
    assert.deepStrictEqual(appelsEcriture, ['src/ui/nasHostAuthorization.ts'], 'l\'hôte n\'est autorisé que par le parcours de confirmation');
  });

  test('8. package.json déclare la portée « machine » pour skillsManager.nasPath', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(RACINE_EXTENSION, 'package.json'), 'utf8'));
    const conf = pkg.contributes.configuration;
    const proprietes = (Array.isArray(conf) ? conf : [conf]).reduce((a: any, c: any) => Object.assign(a, c.properties), {});
    assert.strictEqual(proprietes['skillsManager.nasPath'].scope, 'machine');
  });
});
