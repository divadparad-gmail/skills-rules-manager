import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe, before, after } from 'node:test';

// Simulation de l'environnement VS Code pour l'exécution des tests unitaires hors VS Code
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'vscode') {
    return 'vscode';
  }
  return origResolve.call(this, request, ...args);
};
if (!require.cache['vscode']) {
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
        getConfiguration: () => ({ get: (_key: string, def: any) => def }),
      },
      env: { appName: 'Antigravity IDE' },
      Uri: { file: (f: string) => ({ fsPath: f, scheme: 'file' }) },
      commands: { executeCommand: () => Promise.resolve() },
    },
  } as any;
}

import { ANTIGRAVITY_PROFILES, ANTIGRAVITY_TESTED_ON, ANTIGRAVITY_TESTED_VERSION } from '../src/antigravity/behavior';
import {
  ANTIGRAVITY_PROFILE_SETTING,
  ANTIGRAVITY_PROFILE_SETTING_DEFAULT,
  collectProfileSignals,
  geminiRootFromGlobalPath,
  ProfileSignals,
  readAntigravityProfileSetting,
  resolveAntigravityProfile,
  resolveConfiguredAntigravityProfile,
} from '../src/antigravity/behaviorProfile';
import { getDefaultGlobalAntigravityPath } from '../src/utils/paths';
import { GlobalScanner } from '../src/services/GlobalScanner';
import { LocalScanner } from '../src/services/LocalScanner';
import { McpScanner } from '../src/services/McpScanner';
import { StateManager } from '../src/services/StateManager';
import { WorkspaceContext } from '../src/types';

const ROOT = path.resolve(__dirname, '..', '..');
const PROFIL_255 = ANTIGRAVITY_PROFILES['2.5.5'];
const PROFIL_260 = ANTIGRAVITY_PROFILES['2.6.0'];

/** Les huit arborescences de la conception (phase-3-L3-conception.md, Q2), relatives à <gemini>. */
const CAS_DETECTION: Array<{
  nom: string;
  dossiers: string[];
  fichiers: string[];
  indices: ProfileSignals;
  profil: '2.5.5' | '2.6.0';
  source: 'detected' | 'fallback';
}> = [
  {
    nom: 'seulement l\'ancienne structure', dossiers: ['antigravity-ide/mcp'], fichiers: [],
    indices: { newStructure: false, migrationMarker: false, oldStructure: true }, profil: '2.5.5', source: 'detected',
  },
  {
    nom: 'seulement la nouvelle', dossiers: ['antigravity/builtin/skills'], fichiers: [],
    indices: { newStructure: true, migrationMarker: false, oldStructure: false }, profil: '2.6.0', source: 'detected',
  },
  {
    nom: 'les deux, après migration', dossiers: ['antigravity-ide', 'antigravity/builtin'], fichiers: ['antigravity-ide/.ide_migration'],
    indices: { newStructure: true, migrationMarker: true, oldStructure: true }, profil: '2.6.0', source: 'detected',
  },
  {
    nom: 'aucune', dossiers: ['config/rules'], fichiers: [],
    indices: { newStructure: false, migrationMarker: false, oldStructure: false }, profil: '2.6.0', source: 'fallback',
  },
  {
    nom: 'marqueur sans nouvelle structure', dossiers: ['antigravity-ide'], fichiers: ['antigravity-ide/.ide_migration'],
    indices: { newStructure: false, migrationMarker: true, oldStructure: true }, profil: '2.6.0', source: 'detected',
  },
  {
    nom: 'nouvelle structure sans marqueur, avec l\'ancienne', dossiers: ['antigravity-ide', 'antigravity/builtin'], fichiers: [],
    indices: { newStructure: true, migrationMarker: false, oldStructure: true }, profil: '2.6.0', source: 'detected',
  },
  {
    nom: 'antigravity/ sans builtin/, avec l\'ancienne', dossiers: ['antigravity-ide', 'antigravity/skills/ancien'], fichiers: [],
    indices: { newStructure: false, migrationMarker: false, oldStructure: true }, profil: '2.5.5', source: 'detected',
  },
  {
    nom: 'builtin est un fichier', dossiers: ['antigravity'], fichiers: ['antigravity/builtin'],
    indices: { newStructure: false, migrationMarker: false, oldStructure: false }, profil: '2.6.0', source: 'fallback',
  },
];

/** Espion de fs.statSync : compte les accès au disque. */
const espionStat = () => {
  const appels: string[] = [];
  const stat = (cible: string) => {
    appels.push(cible);
    return fs.statSync(cible);
  };
  return { appels, stat };
};

describe('Suite de Tests : profil de comportement d\'Antigravity (chantier 2.6.0, lot L3)', () => {
  let tempBaseDir: string;

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-profil-'));
  });

  after(async () => {
    StateManager.setAntigravityProfileForTesting(null);
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  const writeFile = async (file: string, content: string) => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, content, 'utf8');
  };

  const construire = async (gemini: string, dossiers: string[], fichiers: string[]) => {
    for (const dossier of dossiers) await fs.promises.mkdir(path.join(gemini, dossier), { recursive: true });
    for (const fichier of fichiers) await writeFile(path.join(gemini, fichier), '');
  };

  test('1. Profils : version et date de chaque baseline ; les constantes historiques gardent leurs valeurs', () => {
    assert.deepStrictEqual(Object.keys(ANTIGRAVITY_PROFILES).sort(), ['2.5.5', '2.6.0']);
    assert.deepStrictEqual(PROFIL_255, { id: '2.5.5', testedVersion: 'Antigravity IDE 2.5.5', testedOn: '2026-10-21' });
    assert.deepStrictEqual(PROFIL_260, { id: '2.6.0', testedVersion: 'Antigravity IDE 2.6.0', testedOn: '2026-10-28' });
    assert.strictEqual(ANTIGRAVITY_TESTED_VERSION, 'Antigravity IDE 2.5.5');
    assert.strictEqual(ANTIGRAVITY_TESTED_ON, '2026-10-21');
    assert.ok(Object.isFrozen(ANTIGRAVITY_PROFILES) && Object.isFrozen(PROFIL_255), 'Un profil ne se modifie pas à l\'exécution');
  });

  test('2. <gemini> : le parent du dossier global, avec la valeur par défaut comme avec une valeur personnalisée', async () => {
    // Valeur par défaut : ~/.gemini/config, dont le parent est ~/.gemini
    assert.strictEqual(getDefaultGlobalAntigravityPath(), path.join(os.homedir(), '.gemini', 'config'));
    assert.strictEqual(geminiRootFromGlobalPath(getDefaultGlobalAntigravityPath()), path.join(os.homedir(), '.gemini'));

    // Valeur personnalisée réaliste : un profil .gemini déplacé, saisi avec un séparateur final
    const gemini = path.join(tempBaseDir, 'profil-deplace', '.gemini');
    await construire(gemini, ['config/skills', 'antigravity/builtin', 'antigravity-ide'], ['antigravity-ide/.ide_migration']);
    for (const saisie of [path.join(gemini, 'config'), `${path.join(gemini, 'config')}${path.sep}`, `  ${path.join(gemini, 'config')}  `]) {
      assert.strictEqual(geminiRootFromGlobalPath(saisie), gemini, JSON.stringify(saisie));
      assert.deepStrictEqual(
        collectProfileSignals(geminiRootFromGlobalPath(saisie)),
        { newStructure: true, migrationMarker: true, oldStructure: true },
        '<gemini> doit contenir antigravity/ et antigravity-ide/'
      );
    }
  });

  test('3. Détection : les huit cas, sur un faux dossier personnel', async () => {
    for (const [i, cas] of CAS_DETECTION.entries()) {
      const gemini = path.join(tempBaseDir, `cas-${i}`, '.gemini');
      await construire(gemini, cas.dossiers, cas.fichiers);
      const indices = collectProfileSignals(gemini);
      assert.deepStrictEqual(indices, cas.indices, `Indices : ${cas.nom}`);
      const resolu = resolveAntigravityProfile('auto', indices);
      assert.strictEqual(resolu.profile.id, cas.profil, `Profil : ${cas.nom}`);
      assert.strictEqual(resolu.source, cas.source, `Source : ${cas.nom}`);
      assert.ok(resolu.reason.length > 0 && !resolu.reason.includes(tempBaseDir), `Raison sans chemin absolu : ${cas.nom}`);
    }
  });

  test('4. Réglage forcé : il l\'emporte sur les indices ; une valeur invalide reprend le défaut 2.5.5', () => {
    const tous: ProfileSignals = { newStructure: true, migrationMarker: true, oldStructure: true };
    const aucun: ProfileSignals = { newStructure: false, migrationMarker: false, oldStructure: false };
    assert.strictEqual(ANTIGRAVITY_PROFILE_SETTING_DEFAULT, '2.5.5');
    for (const indices of [tous, aucun]) {
      assert.deepStrictEqual(
        [resolveAntigravityProfile('2.5.5', indices).profile.id, resolveAntigravityProfile('2.5.5', indices).source],
        ['2.5.5', 'forced']
      );
      assert.deepStrictEqual(
        [resolveAntigravityProfile('2.6.0', indices).profile.id, resolveAntigravityProfile('2.6.0', indices).source],
        ['2.6.0', 'forced']
      );
    }
    for (const invalide of ['2.6', '2.5', 'AUTO', '', ' 2.6.0', 42, null, undefined, {}]) {
      const resolu = resolveAntigravityProfile(invalide, tous);
      assert.strictEqual(resolu.profile.id, '2.5.5', `valeur ${JSON.stringify(invalide)}`);
      assert.strictEqual(resolu.source, 'forced');
      assert.match(resolu.reason, /valeur par défaut/);
    }
    assert.match(resolveAntigravityProfile('2.6.0', aucun).reason, /imposé par le réglage skillsManager\.antigravityProfile/);
  });

  test('5. Garde : un dossier global vide ou un chemin relatif ne touche jamais au disque', () => {
    assert.strictEqual(geminiRootFromGlobalPath(''), '');
    assert.strictEqual(geminiRootFromGlobalPath('   '), '');
    for (const racine of ['', '   ', '.', path.join('relatif', '.gemini')]) {
      const { appels, stat } = espionStat();
      assert.deepStrictEqual(collectProfileSignals(racine, stat), { newStructure: false, migrationMarker: false, oldStructure: false });
      assert.deepStrictEqual(appels, [], `Aucun accès au disque pour ${JSON.stringify(racine)}`);
    }
    // Sans dossier personnel, la résolution en « auto » se replie sur 2.6.0, toujours sans accès au disque
    const { appels, stat } = espionStat();
    const resolu = resolveConfiguredAntigravityProfile('', 'auto', stat);
    assert.deepStrictEqual([resolu.profile.id, resolu.source, appels], ['2.6.0', 'fallback', []]);
  });

  test('6. Lecture du réglage : défaut 2.5.5 hors de VS Code ; la structure n\'est lue qu\'en « auto »', () => {
    assert.strictEqual(readAntigravityProfileSetting(), '2.5.5');
    const globalPath = path.join(tempBaseDir, 'lecture', '.gemini', 'config');

    const force = espionStat();
    const resoluForce = resolveConfiguredAntigravityProfile(globalPath, undefined, force.stat);
    assert.deepStrictEqual([resoluForce.profile.id, resoluForce.source, force.appels.length], ['2.5.5', 'forced', 0]);

    const auto = espionStat();
    resolveConfiguredAntigravityProfile(globalPath, 'auto', auto.stat);
    assert.strictEqual(auto.appels.length, 3, 'En « auto », trois indices sont sondés');
    assert.ok(auto.appels.every((cible) => cible.startsWith(path.dirname(globalPath))), 'Seul <gemini> est sondé');
  });

  test('7. package.json : skillsManager.antigravityProfile, ses trois valeurs, son défaut et sa portée', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const reglage = pkg.contributes.configuration.properties[ANTIGRAVITY_PROFILE_SETTING];
    assert.ok(reglage, `${ANTIGRAVITY_PROFILE_SETTING} doit être déclaré`);
    assert.strictEqual(ANTIGRAVITY_PROFILE_SETTING, 'skillsManager.antigravityProfile');
    assert.strictEqual(reglage.type, 'string');
    assert.deepStrictEqual(reglage.enum, ['auto', '2.5.5', '2.6.0']);
    assert.strictEqual(reglage.enumDescriptions.length, 3);
    assert.match(reglage.enumDescriptions[0], /génération/, 'La description de « auto » doit parler de génération, pas de version exacte');
    assert.strictEqual(reglage.default, ANTIGRAVITY_PROFILE_SETTING_DEFAULT);
    assert.strictEqual(reglage.default, '2.5.5');
    assert.strictEqual(reglage.scope, 'machine', 'Portée machine : un dépôt ne peut pas fixer le profil');
  });

  test('8. Neutralité : un scan sans profil, avec le profil 2.5.5 ou avec le profil 2.6.0 donne le même résultat', async () => {
    const gemini = path.join(tempBaseDir, 'neutralite', '.gemini');
    const globalDir = path.join(gemini, 'config');
    const skill = (nom: string) => `---\nname: ${nom}\ndescription: Skill ${nom}.\n---\n# ${nom}\n`;
    await writeFile(path.join(globalDir, 'skills', 'global-un', 'SKILL.md'), skill('global-un'));
    await writeFile(path.join(globalDir, 'rules', 'permanente.md'), '---\ntrigger: always_on\ndescription: P.\n---\n# Permanente\n');
    await writeFile(path.join(globalDir, 'rules', 'motif.md'), '---\ntrigger: glob\nglobs: "*.ts"\ndescription: G.\n---\n# Glob\n');
    await writeFile(path.join(globalDir, 'plugins', 'greffon', 'plugin.json'), '{ "name": "greffon" }\n');
    await writeFile(path.join(globalDir, 'plugins', 'greffon', 'skills', 'greffon-skill', 'SKILL.md'), skill('greffon-skill'));
    await writeFile(path.join(globalDir, 'mcp_config.json'), JSON.stringify({ mcpServers: { serveur: { command: 'x' } } }));
    await writeFile(path.join(gemini, 'GEMINI.md'), '# Âme globale\n');
    await writeFile(path.join(gemini, 'antigravity-ide', 'builtin', 'skills', 'integre-ancien', 'SKILL.md'), skill('integre-ancien'));
    await writeFile(path.join(gemini, 'antigravity', 'builtin', 'skills', 'integre-nouveau', 'SKILL.md'), skill('integre-nouveau'));
    await writeFile(path.join(gemini, 'antigravity', 'skills', 'ancien-global', 'SKILL.md'), skill('ancien-global'));
    await writeFile(path.join(gemini, 'antigravity-ide', 'mcp', 'serveur', 'ancien-outil.json'), '{}');
    await writeFile(path.join(gemini, 'antigravity', 'mcp', 'serveur', 'nouvel-outil.json'), '{}');
    await writeFile(path.join(gemini, 'antigravity-ide', '.ide_migration'), '');

    const projet = path.join(tempBaseDir, 'neutralite', 'projet');
    await writeFile(path.join(projet, '.agents', 'rules', 'locale.md'), '---\ntrigger: always_on\ndescription: L.\n---\n# Locale\n');
    await writeFile(path.join(projet, '.agents', 'skills', 'local-un', 'SKILL.md'), skill('local-un'));
    await writeFile(path.join(projet, '_agents', 'rules', 'variante.md'), '---\ntrigger: always_on\ndescription: V.\n---\n# Variante\n');
    await writeFile(path.join(projet, '.agents', 'mcp_config.json'), JSON.stringify({ mcpServers: { local: { command: 'y' } } }));
    const workspace: WorkspaceContext = {
      hasWorkspace: true, workspacePath: projet, tool: 'antigravity', agentsDir: '.agents', claudeDir: null, hasClaudeMd: false,
    };

    const reference = {
      global: await GlobalScanner.scan(globalDir, 'antigravity'),
      local: await LocalScanner.scan(workspace),
      mcpGlobal: await McpScanner.scanGlobal(globalDir, 'antigravity'),
      mcpLocal: await McpScanner.scanLocal(workspace),
    };
    assert.ok(reference.global.items.some((i) => i.metadata?.builtin), 'L\'arborescence doit couvrir les skills intégrés');
    // En L3, aucun scanner ne lit le profil : le profil 2.6.0 ne change encore rien (le lot L4 inversera ce constat)
    for (const profil of [PROFIL_255, PROFIL_260]) {
      assert.deepStrictEqual(await GlobalScanner.scan(globalDir, 'antigravity', profil), reference.global, `GlobalScanner, profil ${profil.id}`);
      assert.deepStrictEqual(await LocalScanner.scan(workspace, profil), reference.local, `LocalScanner, profil ${profil.id}`);
      assert.deepStrictEqual(await McpScanner.scanGlobal(globalDir, 'antigravity', profil), reference.mcpGlobal, `McpScanner global, profil ${profil.id}`);
      assert.deepStrictEqual(await McpScanner.scanLocal(workspace, profil), reference.mcpLocal, `McpScanner local, profil ${profil.id}`);
    }
  });

  test('9. État envoyé au webview : le réglage par défaut transmet le profil 2.5.5 et ne change ni antigravityBehavior ni les clés', async () => {
    const sansHorloge = (etat: Record<string, any>) => {
      const copie = JSON.parse(JSON.stringify(etat));
      for (const cle of ['lastTimingLog', 'isDebugTiming', 'timingHistory']) delete copie[cle];
      if (copie.nasStatus) delete copie.nasStatus.checkedAt;
      return copie;
    };

    StateManager.setAntigravityProfileForTesting(null);
    const parDefaut = await StateManager.loadFullState(true);
    assert.deepStrictEqual(
      [StateManager.lastAntigravityProfile?.profile.id, StateManager.lastAntigravityProfile?.source],
      ['2.5.5', 'forced'],
      'Sans réglage, le profil 2.5.5 est transmis aux scanners'
    );
    assert.deepStrictEqual(parDefaut.antigravityBehavior, { version: 'Antigravity IDE 2.5.5', testedOn: '2026-10-21' });
    assert.ok(!Object.keys(parDefaut).some((cle) => /profil|profile/i.test(cle)), 'Aucune clé de profil n\'est envoyée au webview en L3');

    StateManager.setAntigravityProfileForTesting(resolveAntigravityProfile('2.5.5', { newStructure: false, migrationMarker: false, oldStructure: false }));
    const force255 = await StateManager.loadFullState(true);
    assert.deepStrictEqual(sansHorloge(force255), sansHorloge(parDefaut));
    StateManager.setAntigravityProfileForTesting(null);
  });
});
