import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';

// La bascule d'un skill de Claude Code ne doit écrire que dans le dossier du skill, jamais dans le
// skills.json d'Antigravity ; celle d'un skill d'Antigravity continue d'écrire son skills.json.
//
// Les deux profils globaux sont simulés dans un dossier temporaire au nom fixe, protégé par un fichier
// témoin : un dossier de ce nom sans le témoin n'est ni vidé ni supprimé. Avant chaque bascule, un
// garde-fou vérifie que les chemins résolus par l'extension sont bien ceux du dossier temporaire, pour
// qu'aucune bascule n'atteigne le vrai profil.

const DOSSIER = path.join(os.tmpdir(), 'claude-bascule-skill-a1');
const TEMOIN = '.temoin-claude-bascule-skill';
const TEXTE_TEMOIN = 'Dossier temporaire du test test/claude-bascule-skill.test.ts.\n';
const AG_GLOBAL = path.join(DOSSIER, 'gemini', 'config');
const CLAUDE_GLOBAL = path.join(DOSSIER, 'claude');

// Simulation de l'environnement VS Code : les deux réglages de chemin pointent vers le dossier temporaire
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
      workspaceFolders: [],
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

import { ToggleManager } from '../src/services/ToggleManager';
import { GlobalScanner } from '../src/services/GlobalScanner';
import { getEffectiveGlobalAntigravityPath, getEffectiveGlobalClaudePath } from '../src/utils/paths';
import { ResourceItem } from '../src/types';

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
  fs.mkdirSync(AG_GLOBAL, { recursive: true });
  fs.mkdirSync(CLAUDE_GLOBAL, { recursive: true });
}

/** Refuse toute bascule si l'extension ne résout pas les deux profils dans le dossier temporaire. */
function exigerProfilsTemporaires(): void {
  assert.strictEqual(getEffectiveGlobalAntigravityPath(), AG_GLOBAL, 'garde-fou : le profil Antigravity doit être le dossier temporaire');
  assert.strictEqual(getEffectiveGlobalClaudePath(), CLAUDE_GLOBAL, 'garde-fou : le profil Claude Code doit être le dossier temporaire');
}

function ecrireSkill(dossierSkills: string, nom: string): string {
  const dossier = path.join(dossierSkills, nom);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'SKILL.md'), `---\nname: ${nom}\ndescription: Skill du test de bascule.\n---\n\nCorps.\n`, 'utf8');
  return dossier;
}

async function skillGlobal(targetTool: 'antigravity' | 'claude-code', id: string): Promise<ResourceItem> {
  const { items } = await GlobalScanner.scan(AG_GLOBAL, targetTool);
  const item = items.find((i) => i.type === 'skill' && i.id === id);
  assert.ok(item, `le skill global « ${id} » doit être lu par le scanner (${targetTool})`);
  assert.strictEqual(item.scope, 'global');
  assert.strictEqual(item.targetTool, targetTool);
  return item;
}

const SKILLS_JSON = path.join(AG_GLOBAL, 'skills.json');
// Contenu d'un skills.json d'Antigravity déjà présent, avec une clé inconnue et sans saut de ligne final
const SKILLS_JSON_INITIAL = '{\n    "exclude": ["skill-ag-existant"],\n    "autreCle": true\n}';

describe('Bascule d\'un skill global : le skills.json d\'Antigravity', () => {
  before(() => {
    preparerDossier();
  });

  after(() => {
    if (fs.existsSync(DOSSIER)) viderSaufTemoin();
  });

  test('la bascule d\'un skill de Claude Code ne modifie pas un skills.json d\'Antigravity existant', async () => {
    viderSaufTemoin();
    fs.mkdirSync(AG_GLOBAL, { recursive: true });
    const dossierSkill = ecrireSkill(path.join(CLAUDE_GLOBAL, 'skills'), 'canari-a1');
    fs.writeFileSync(SKILLS_JSON, SKILLS_JSON_INITIAL, 'utf8');
    exigerProfilsTemporaires();

    const item = await skillGlobal('claude-code', 'canari-a1');
    const off = await ToggleManager.toggleItem(item, false);
    assert.deepStrictEqual(off, { success: true, newState: false });
    assert.ok(fs.existsSync(path.join(dossierSkill, 'SKILL.md.disabled')), 'le skill est désactivé par renommage');
    assert.ok(!fs.existsSync(path.join(dossierSkill, 'SKILL.md')));
    assert.strictEqual(fs.readFileSync(SKILLS_JSON, 'utf8'), SKILLS_JSON_INITIAL, 'skills.json d\'Antigravity inchangé après la désactivation');

    const desactive = await skillGlobal('claude-code', 'canari-a1');
    assert.strictEqual(desactive.enabled, false);
    const on = await ToggleManager.toggleItem(desactive, true);
    assert.deepStrictEqual(on, { success: true, newState: true });
    assert.ok(fs.existsSync(path.join(dossierSkill, 'SKILL.md')), 'le skill est réactivé par renommage');
    assert.strictEqual(fs.readFileSync(SKILLS_JSON, 'utf8'), SKILLS_JSON_INITIAL, 'skills.json d\'Antigravity inchangé après la réactivation');
  });

  test('la bascule d\'un skill de Claude Code ne crée pas de skills.json d\'Antigravity', async () => {
    viderSaufTemoin();
    fs.mkdirSync(AG_GLOBAL, { recursive: true });
    ecrireSkill(path.join(CLAUDE_GLOBAL, 'skills'), 'canari-a1');
    exigerProfilsTemporaires();

    const item = await skillGlobal('claude-code', 'canari-a1');
    assert.deepStrictEqual(await ToggleManager.toggleItem(item, false), { success: true, newState: false });
    assert.ok(!fs.existsSync(SKILLS_JSON), 'aucun skills.json créé dans le profil Antigravity');
    assert.deepStrictEqual(fs.readdirSync(AG_GLOBAL), [], 'le profil Antigravity reste vide');
  });

  test('la bascule en masse des skills globaux de Claude Code ne touche pas skills.json', async () => {
    viderSaufTemoin();
    fs.mkdirSync(AG_GLOBAL, { recursive: true });
    ecrireSkill(path.join(CLAUDE_GLOBAL, 'skills'), 'canari-a1');
    ecrireSkill(path.join(CLAUDE_GLOBAL, 'skills'), 'canari-a1-bis');
    fs.writeFileSync(SKILLS_JSON, SKILLS_JSON_INITIAL, 'utf8');
    exigerProfilsTemporaires();

    const { items } = await GlobalScanner.scan(AG_GLOBAL, 'claude-code');
    const res = await ToggleManager.bulkToggle(items, 'global', 'skill', false);
    assert.strictEqual(res.modifiedCount, 2);
    assert.strictEqual(fs.readFileSync(SKILLS_JSON, 'utf8'), SKILLS_JSON_INITIAL, 'skills.json d\'Antigravity inchangé après la bascule en masse');
  });

  test('non-régression : la bascule d\'un skill d\'Antigravity écrit toujours son skills.json', async () => {
    viderSaufTemoin();
    fs.mkdirSync(AG_GLOBAL, { recursive: true });
    const dossierSkill = ecrireSkill(path.join(AG_GLOBAL, 'skills'), 'canari-a1-ag');
    fs.writeFileSync(SKILLS_JSON, SKILLS_JSON_INITIAL, 'utf8');
    exigerProfilsTemporaires();

    const item = await skillGlobal('antigravity', 'canari-a1-ag');
    assert.deepStrictEqual(await ToggleManager.toggleItem(item, false), { success: true, newState: false });
    assert.ok(fs.existsSync(path.join(dossierSkill, 'SKILL.md.disabled')));
    assert.strictEqual(
      fs.readFileSync(SKILLS_JSON, 'utf8'),
      JSON.stringify({ exclude: ['skill-ag-existant', 'canari-a1-ag'], autreCle: true }, null, 2),
      'le skill d\'Antigravity est ajouté à exclude, les autres clés sont gardées'
    );

    const desactive = await skillGlobal('antigravity', 'canari-a1-ag');
    assert.strictEqual(desactive.enabled, false);
    assert.deepStrictEqual(await ToggleManager.toggleItem(desactive, true), { success: true, newState: true });
    assert.ok(fs.existsSync(path.join(dossierSkill, 'SKILL.md')));
    assert.strictEqual(
      fs.readFileSync(SKILLS_JSON, 'utf8'),
      JSON.stringify({ exclude: ['skill-ag-existant'], autreCle: true }, null, 2),
      'le skill d\'Antigravity est retiré d\'exclude à la réactivation'
    );
  });

  test('non-régression : la bascule d\'un skill d\'Antigravity crée skills.json s\'il manque', async () => {
    viderSaufTemoin();
    fs.mkdirSync(AG_GLOBAL, { recursive: true });
    ecrireSkill(path.join(AG_GLOBAL, 'skills'), 'canari-a1-ag');
    exigerProfilsTemporaires();

    const item = await skillGlobal('antigravity', 'canari-a1-ag');
    assert.deepStrictEqual(await ToggleManager.toggleItem(item, false), { success: true, newState: false });
    assert.strictEqual(fs.readFileSync(SKILLS_JSON, 'utf8'), JSON.stringify({ exclude: ['canari-a1-ag'] }, null, 2));
  });
});
