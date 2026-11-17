import * as assert from 'node:assert';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';

// Les cartes de Claude Code en lecture seule (métadonnée claudeReadOnly, posée avec locked: true) :
// ni bascule, ni suppression, côté serveur comme dans le webview. Aucun scanner ne pose encore la
// métadonnée : les éléments sont construits par le test. Un élément d'Antigravity de même forme se
// comporte comme avant.
//
// Tous les fichiers touchés vivent dans un dossier temporaire au nom fixe, protégé par un fichier
// témoin : un dossier de ce nom sans le témoin n'est ni vidé ni supprimé. Les réglages de chemin de la
// simulation de VS Code pointent vers ce dossier, et un garde-fou le vérifie avant toute bascule.

const DOSSIER = path.join(os.tmpdir(), 'claude-lecture-seule-a2');
const TEMOIN = '.temoin-claude-lecture-seule';
const TEXTE_TEMOIN = 'Dossier temporaire du test test/claude-lecture-seule.test.ts.\n';
const AG_GLOBAL = path.join(DOSSIER, 'gemini', 'config');
const CLAUDE_GLOBAL = path.join(DOSSIER, 'claude');
const PARENT = path.join(DOSSIER, 'parent');
const PROJET = path.join(PARENT, 'projet');

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
const messagesErreur: string[] = [];
require.cache['vscode'] = {
  id: 'vscode',
  filename: 'vscode',
  loaded: true,
  exports: {
    window: {
      createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
      showInformationMessage: () => Promise.resolve(),
      showErrorMessage: (m: string) => { messagesErreur.push(m); return Promise.resolve(); },
      // Une suppression qui irait jusqu'à la confirmation serait annulée : le test échouerait sur le message
      showWarningMessage: () => Promise.resolve(undefined),
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

import { getProtectedResourceRefusal, isBulkToggleable, ToggleManager } from '../src/services/ToggleManager';
import { DeleteService } from '../src/services/DeleteService';
import { StateManager } from '../src/services/StateManager';
import { getEffectiveGlobalAntigravityPath, getEffectiveGlobalClaudePath } from '../src/utils/paths';
import { ResourceItem } from '../src/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const main = require(path.resolve(__dirname, '../../src/webview/main.js'));

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

function exigerDossierTemporaire(...chemins: string[]): void {
  assert.strictEqual(getEffectiveGlobalAntigravityPath(), AG_GLOBAL, 'garde-fou : profil Antigravity dans le dossier temporaire');
  assert.strictEqual(getEffectiveGlobalClaudePath(), CLAUDE_GLOBAL, 'garde-fou : profil Claude Code dans le dossier temporaire');
  for (const c of chemins) {
    assert.ok(path.resolve(c).startsWith(DOSSIER + path.sep), `garde-fou : ${path.basename(c)} est dans le dossier temporaire`);
  }
}

function ecrire(fichier: string, contenu: string): string {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, contenu, 'utf8');
  return fichier;
}

// --- Éléments construits par le test ---
type Raison = 'Fichier hors du projet' | 'Écrit par Claude';

interface Forme {
  id: string;
  type: 'skill' | 'rule' | 'soul';
  scope: 'global' | 'local';
  path: string;
  isFolder?: boolean;
  targetTool: 'claude-code' | 'antigravity';
  metadata?: Record<string, unknown>;
}

function element(f: Forme): ResourceItem {
  return {
    id: f.id,
    name: f.id,
    description: `Élément ${f.id} construit par le test.`,
    type: f.type,
    scope: f.scope,
    enabled: true,
    path: f.path,
    targetTool: f.targetTool,
    isFolder: !!f.isFolder,
    charCount: 40,
    tokenCount: 10,
    lineCount: 3,
    syncStatus: 'synced',
    // La métadonnée claudeReadOnly n'existe pas encore dans le type à 1351781 : `as any` garde le test compilable
    metadata: (f.metadata ?? {}) as any,
  };
}

function lectureSeule(f: Omit<Forme, 'metadata'>, raison: Raison, autres: Record<string, unknown> = {}): ResourceItem {
  return element({ ...f, metadata: { ...autres, locked: true, claudeReadOnly: { raison } } });
}

const SKILL_MD = '---\nname: canari\ndescription: Skill du test de lecture seule.\n---\n\nCorps.\n';

let skillParent: string;
let regleParent: string;
let ameParent: string;
let memoire: string;
let skillLibre: string;
let skillAg: string;

/** Contenu octet pour octet de chaque fichier du dossier temporaire (hors témoin), chemin relatif → base64. */
function instantane(): Record<string, string> {
  const res: Record<string, string> = {};
  const parcourir = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) parcourir(p);
      else if (e.name !== TEMOIN) res[path.relative(DOSSIER, p).split(path.sep).join('/')] = fs.readFileSync(p).toString('base64');
    }
  };
  parcourir(DOSSIER);
  return res;
}

function elementsLectureSeule(): ResourceItem[] {
  return [
    lectureSeule({ id: 'canari-a2-skill-parent', type: 'skill', scope: 'local', path: skillParent, isFolder: true, targetTool: 'claude-code' }, 'Fichier hors du projet', { inheritedFrom: '..' }),
    lectureSeule({ id: 'canari-a2-regle-parent.md', type: 'rule', scope: 'local', path: regleParent, targetTool: 'claude-code' }, 'Fichier hors du projet'),
    lectureSeule({ id: 'canari-a2-ame-parent', type: 'soul', scope: 'local', path: ameParent, targetTool: 'claude-code' }, 'Fichier hors du projet', { isSoul: true }),
    lectureSeule({ id: 'canari-a2-memoire', type: 'soul', scope: 'global', path: memoire, targetTool: 'claude-code' }, 'Écrit par Claude', { isSoul: true }),
  ];
}

// --- Rendu sérialisé d'une carte (faux DOM, sans dépendance) ---
interface MockEl {
  tagName: string;
  className: string;
  innerHTML: string;
  textContent: string;
  title: string;
  disabled?: boolean;
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
// La corbeille est le bouton 🗑️ (le faux DOM réécrit className à chaque classList.add)
const estCorbeille = (el: MockEl): boolean => el.tagName === 'BUTTON' && el.innerHTML === '🗑️';

function serialiser(el: MockEl): unknown {
  return {
    t: el.tagName, c: el.className, h: el.innerHTML, x: el.textContent, ti: el.title, d: el.disabled ?? null,
    s: el.style, k: el.children.map(serialiser),
  };
}

function rendu(item: ResourceItem): MockEl {
  return main.createItemCard(item, true, { createElement });
}

describe('Cartes de Claude Code en lecture seule', () => {
  before(() => {
    preparerDossier();
    skillParent = path.dirname(ecrire(path.join(PARENT, '.claude', 'skills', 'canari-a2-skill-parent', 'SKILL.md'), SKILL_MD));
    regleParent = ecrire(path.join(PARENT, '.claude', 'rules', 'canari-a2-regle-parent.md'), '# Règle du parent\n');
    ameParent = ecrire(path.join(PARENT, 'CLAUDE.md'), '# Mémoire du parent\n');
    memoire = ecrire(path.join(CLAUDE_GLOBAL, 'projects', 'canari-a2', 'memory', 'MEMORY.md'), '- note écrite par Claude\n');
    skillLibre = path.dirname(ecrire(path.join(CLAUDE_GLOBAL, 'skills', 'canari-a2-libre', 'SKILL.md'), SKILL_MD));
    skillAg = path.dirname(ecrire(path.join(AG_GLOBAL, 'skills', 'canari-a2-ag', 'SKILL.md'), SKILL_MD));
    fs.mkdirSync(PROJET, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(DOSSIER)) viderSaufTemoin();
  });

  test('1. La métadonnée claudeReadOnly donne un refus qui cite la raison, et sort l\'élément des bascules en masse', () => {
    for (const item of elementsLectureSeule()) {
      const refus = getProtectedResourceRefusal(item);
      assert.ok(refus, `${item.id} : refus attendu`);
      assert.match(refus!, /lecture seule/i, `${item.id} : le refus dit « lecture seule »`);
      assert.ok(refus!.includes((item.metadata as any).claudeReadOnly.raison), `${item.id} : le refus cite la raison`);
      assert.strictEqual(isBulkToggleable(item), false, `${item.id} : hors des bascules en masse`);
    }
    // Sans locked : la métadonnée suffit à exclure l'élément des bascules en masse
    const sansVerrou = element({ id: 'canari-a2-sans-verrou', type: 'skill', scope: 'global', path: skillLibre, isFolder: true, targetTool: 'claude-code', metadata: { claudeReadOnly: { raison: 'Écrit par Claude' } } });
    assert.ok(getProtectedResourceRefusal(sansVerrou));
    assert.strictEqual(isBulkToggleable(sansVerrou), false);
  });

  test('2. La bascule d\'un élément en lecture seule est refusée, et aucun fichier ne change', async () => {
    exigerDossierTemporaire(skillParent, regleParent, ameParent, memoire);
    const avant = instantane();
    for (const item of elementsLectureSeule()) {
      for (const etat of [false, true]) {
        const res = await ToggleManager.toggleItem(item, etat);
        assert.strictEqual(res.success, false, `${item.id} → ${etat} : refusé`);
        assert.strictEqual(res.newState, item.enabled);
        assert.strictEqual(res.error, getProtectedResourceRefusal(item));
      }
    }
    assert.deepStrictEqual(instantane(), avant, 'aucun fichier renommé, créé ni modifié');
  });

  test('3. La suppression d\'un élément en lecture seule est refusée, même synchronisé et marqué fixture', async () => {
    exigerDossierTemporaire(skillParent, regleParent, ameParent, memoire);
    const avant = instantane();
    for (const base of elementsLectureSeule()) {
      const item = { ...base, syncStatus: 'synced' as const, metadata: { ...base.metadata, isScenarioFixture: true } };
      messagesErreur.length = 0;
      const res = await DeleteService.deleteResource(item);
      assert.strictEqual(res.success, false, `${item.id} : refusé`);
      assert.strictEqual(res.error, getProtectedResourceRefusal(base));
      assert.ok(messagesErreur.some((m) => m.startsWith('Suppression impossible')), `${item.id} : message d'erreur affiché`);
    }
    assert.deepStrictEqual(instantane(), avant, 'aucun fichier supprimé ni modifié');
  });

  test('4. La bascule en masse ignore les éléments en lecture seule', async () => {
    exigerDossierTemporaire(skillParent, regleParent, ameParent, memoire, skillLibre);
    const libre = element({ id: 'canari-a2-libre', type: 'skill', scope: 'local', path: skillLibre, isFolder: true, targetTool: 'claude-code' });
    const sansVerrou = element({ id: 'canari-a2-skill-parent', type: 'skill', scope: 'local', path: skillParent, isFolder: true, targetTool: 'claude-code', metadata: { claudeReadOnly: { raison: 'Fichier hors du projet' } } });
    const items = [...elementsLectureSeule(), sansVerrou, libre];
    const avantParent = instantane();

    const res = await ToggleManager.bulkToggle(items, 'local', 'skill', false);
    assert.deepStrictEqual(res, { modifiedCount: 1, targetState: false, totalItems: 1 });
    assert.ok(fs.existsSync(path.join(skillLibre, 'SKILL.md.disabled')), 'le skill libre est désactivé');
    for (const [rel, contenu] of Object.entries(avantParent)) {
      if (!rel.includes('canari-a2-libre')) assert.strictEqual(instantane()[rel], contenu, `${rel} inchangé`);
    }
    fs.renameSync(path.join(skillLibre, 'SKILL.md.disabled'), path.join(skillLibre, 'SKILL.md'));

    // Le compteur du webview suit la même règle
    const nodes: Record<string, MockEl> = {};
    const doc = { createElement, getElementById: (id: string) => (id.startsWith('count') ? (nodes[id] = nodes[id] ?? createElement('span')) : null) };
    main.updateBulkControl('local', 'skill', items, doc);
    assert.strictEqual(nodes.countSkillLocal.textContent, '1/1');
  });

  test('5. Une demande du webview qui porte un élément modifié reste refusée (élément repris de l\'état chargé)', async () => {
    exigerDossierTemporaire(skillParent, regleParent, ameParent, memoire);
    const charges = elementsLectureSeule();
    const etat = { globalResources: charges.filter((i) => i.scope === 'global'), localResources: charges.filter((i) => i.scope === 'local') };
    // Aucun scan réel : l'état chargé est celui du test, et le rechargement le rend tel quel
    const origLoad = StateManager.loadFullState;
    (StateManager as any).loadFullState = async () => etat;
    const avant = instantane();
    try {
      for (const charge of charges) {
        // Le webview renvoie l'élément sans la métadonnée, sans verrou, et comme fixture synchronisée
        const modifie = { ...charge, syncStatus: 'synced' as const, metadata: { isScenarioFixture: true } } as ResourceItem;
        const bascule = await StateManager.toggle(modifie.id, modifie.scope, false, modifie.type, modifie.path);
        assert.strictEqual(bascule.success, false, `${charge.id} : bascule refusée`);
        assert.strictEqual(bascule.error, getProtectedResourceRefusal(charge));
        const suppression = await StateManager.deleteResource(modifie);
        assert.strictEqual(suppression.success, false, `${charge.id} : suppression refusée`);
        assert.strictEqual(suppression.error, getProtectedResourceRefusal(charge));
      }
    } finally {
      (StateManager as any).loadFullState = origLoad;
    }
    assert.deepStrictEqual(instantane(), avant, 'aucun fichier touché');
  });

  test('6. La carte affiche « 🔒 Lecture seule » avec la raison en infobulle, sans interrupteur ni corbeille', () => {
    for (const item of elementsLectureSeule()) {
      const raison: Raison = (item.metadata as any).claudeReadOnly.raison;
      const tous = descendants(rendu(item));
      const badge = tous.find((el) => el.className === 'soul-locked-badge');
      assert.ok(badge, `${item.id} : badge de verrou`);
      assert.strictEqual(badge!.innerHTML, '', `${item.id} : badge construit sans innerHTML`);
      assert.deepStrictEqual(badge!.children.map((c) => c.textContent), ['🔒', 'Lecture seule'], `${item.id} : cadenas et libellé`);
      assert.ok(badge!.children.every((c) => c.innerHTML === ''), `${item.id} : libellés construits sans innerHTML`);
      assert.ok(badge!.title.startsWith(`${raison} :`), `${item.id} : l'infobulle commence par la raison`);
      assert.ok(!tous.some((el) => el.tagName === 'INPUT'), `${item.id} : aucun interrupteur`);
      assert.ok(!tous.some(estCorbeille), `${item.id} : aucune corbeille`);
    }
  });

  test('7. Un élément d\'Antigravity de même forme, sans la métadonnée, se comporte comme avant', async () => {
    exigerDossierTemporaire(skillAg);
    const ag = element({ id: 'canari-a2-ag', type: 'skill', scope: 'global', path: skillAg, isFolder: true, targetTool: 'antigravity' });
    assert.strictEqual(getProtectedResourceRefusal(ag), null);
    assert.strictEqual(isBulkToggleable(ag), true);
    assert.deepStrictEqual(await ToggleManager.toggleItem(ag, false), { success: true, newState: false });
    assert.ok(fs.existsSync(path.join(skillAg, 'SKILL.md.disabled')));
    assert.deepStrictEqual(await ToggleManager.toggleItem({ ...ag, enabled: false }, true), { success: true, newState: true });
    assert.ok(fs.existsSync(path.join(skillAg, 'SKILL.md')));

    const tous = descendants(rendu(ag));
    assert.ok(tous.some((el) => el.tagName === 'INPUT'), 'interrupteur présent');
    assert.ok(tous.some(estCorbeille), 'corbeille présente');
    assert.ok(!tous.some((el) => el.className === 'soul-locked-badge'), 'aucun badge de verrou');
  });

  test('8. Le rendu des cartes sans la métadonnée est identique à celui de 1351781 (empreinte)', () => {
    // Formes d'Antigravity (skill global, règle locale, âme, règle héritée verrouillée) et formes de Claude Code
    // sans la métadonnée : leur rendu sérialisé est comparé à l'empreinte calculée à 1351781
    const formes: ResourceItem[] = [
      element({ id: 'ag-skill', type: 'skill', scope: 'global', path: skillAg, isFolder: true, targetTool: 'antigravity' }),
      element({ id: 'ag-regle.md', type: 'rule', scope: 'local', path: regleParent, targetTool: 'antigravity' }),
      element({ id: 'ag-ame', type: 'soul', scope: 'local', path: ameParent, targetTool: 'antigravity', metadata: { isSoul: true } }),
      element({ id: 'ag-heritee.md', type: 'rule', scope: 'local', path: regleParent, targetTool: 'antigravity', metadata: { locked: true, inheritedFrom: '..' } }),
      element({ id: 'cc-skill', type: 'skill', scope: 'global', path: skillLibre, isFolder: true, targetTool: 'claude-code' }),
      element({ id: 'cc-regle.md', type: 'rule', scope: 'local', path: regleParent, targetTool: 'claude-code' }),
      element({ id: 'cc-ame', type: 'soul', scope: 'local', path: ameParent, targetTool: 'claude-code', metadata: { isSoul: true } }),
    ];
    // Les chemins du dossier temporaire sont remplacés par un nom fixe, pour une empreinte indépendante du poste
    const texte = JSON.stringify(formes.map((f) => serialiser(rendu(f)))).split(JSON.stringify(DOSSIER).slice(1, -1)).join('<tmp>');
    const empreinte = crypto.createHash('sha256').update(texte).digest('hex');
    assert.strictEqual(empreinte, 'e8ab0385489c65a6f4a6f92197148675160ad1f43beccb0e067c03ec6f3ef3c5', 'rendu identique à celui de 1351781');

    // Une métadonnée claudeReadOnly sur un élément d'Antigravity est ignorée : rendu identique
    const avecMeta = formes.slice(0, 4).map((f) => ({ ...f, metadata: { ...f.metadata, claudeReadOnly: { raison: 'Écrit par Claude' } } as any }));
    assert.deepStrictEqual(avecMeta.map((f) => serialiser(rendu(f))), formes.slice(0, 4).map((f) => serialiser(rendu(f))));
    for (const f of avecMeta) {
      assert.strictEqual(getProtectedResourceRefusal(f), getProtectedResourceRefusal(formes[avecMeta.indexOf(f)]));
      assert.strictEqual(isBulkToggleable(f), isBulkToggleable(formes[avecMeta.indexOf(f)]));
    }
  });
});
