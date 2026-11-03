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

import {
  ANTIGRAVITY_PROFILES,
  ANTIGRAVITY_TESTED_ON,
  ANTIGRAVITY_TESTED_VERSION,
  BUILTIN_SKILLS_DIR,
  MCP_TOOL_CACHE_DIR,
  PERSONALIZATION_BUDGET_EXCLUSION_TESTED,
  PERSONALIZATION_BUDGET_TOKENS,
} from '../src/antigravity/behavior';
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

  test('1. Profils : version, date et chemins de chaque version ; les constantes historiques gardent leurs valeurs', () => {
    assert.deepStrictEqual(Object.keys(ANTIGRAVITY_PROFILES).sort(), ['2.5.5', '2.6.0']);
    assert.deepStrictEqual(PROFIL_255, {
      id: '2.5.5',
      testedVersion: 'Antigravity IDE 2.5.5',
      testedOn: '2026-10-21',
      builtinSkillsDir: path.join('antigravity-ide', 'builtin', 'skills'),
      mcpToolCacheDir: path.join('antigravity-ide', 'mcp'),
      legacyGlobalSkills: 'unverified',
      verifiedGlobalSouls: ['GEMINI.md'],
      pluginSkillIndexCopies: 2,
      pluginSectionHeader: true,
      truncation: 'byte',
      globInjected: true,
      workspaceAgentRuleDirs: ['.agents', '.agent'],
      personalizationBudgetTokens: null,
      markdownWorkflows: null,
    });
    assert.deepStrictEqual(PROFIL_260, {
      id: '2.6.0',
      testedVersion: 'Antigravity IDE 2.6.0',
      testedOn: '2026-10-28',
      builtinSkillsDir: path.join('antigravity', 'builtin', 'skills'),
      mcpToolCacheDir: path.join('antigravity', 'mcp'),
      legacyGlobalSkills: 'not-read',
      verifiedGlobalSouls: ['AGENTS.md', 'GEMINI.md', 'config/AGENTS.md', 'config/GEMINI.md'],
      pluginSkillIndexCopies: 1,
      pluginSectionHeader: false,
      truncation: 'line-end',
      globInjected: false,
      workspaceAgentRuleDirs: ['.agents', '.agent', '_agent', '_agents'],
      personalizationBudgetTokens: 20000,
      markdownWorkflows: {
        workspaceDir: path.join('.agents', 'workflows'),
        workspaceVariantDirs: [path.join('.agent', 'workflows'), path.join('_agent', 'workflows'), path.join('_agents', 'workflows')],
        globalDir: 'global_workflows',
        ignoredConfigDirs: ['workflows'],
        ignoredGeminiDirs: [path.join('antigravity-ide', 'global_workflows'), path.join('antigravity', 'global_workflows')],
      },
    });
    assert.strictEqual(PERSONALIZATION_BUDGET_TOKENS, 20000);
    assert.strictEqual(PERSONALIZATION_BUDGET_EXCLUSION_TESTED, false);
    assert.strictEqual(ANTIGRAVITY_TESTED_VERSION, 'Antigravity IDE 2.5.5');
    assert.strictEqual(ANTIGRAVITY_TESTED_ON, '2026-10-21');
    assert.strictEqual(BUILTIN_SKILLS_DIR, PROFIL_255.builtinSkillsDir);
    assert.strictEqual(MCP_TOOL_CACHE_DIR, PROFIL_255.mcpToolCacheDir);
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

  test('4. Réglage forcé : il l\'emporte sur les indices ; une valeur invalide reprend le défaut « auto » (détection)', () => {
    const tous: ProfileSignals = { newStructure: true, migrationMarker: true, oldStructure: true };
    const aucun: ProfileSignals = { newStructure: false, migrationMarker: false, oldStructure: false };
    const ancienne: ProfileSignals = { newStructure: false, migrationMarker: false, oldStructure: true };
    assert.strictEqual(ANTIGRAVITY_PROFILE_SETTING_DEFAULT, 'auto');
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
    // Une valeur absente ou invalide vaut « auto » : la structure des données décide, avec repli sur 2.6.0
    for (const invalide of ['2.6', '2.5', 'AUTO', '', ' 2.6.0', 42, null, undefined, {}]) {
      const avecTous = resolveAntigravityProfile(invalide, tous);
      assert.deepStrictEqual([avecTous.profile.id, avecTous.source], ['2.6.0', 'detected'], `valeur ${JSON.stringify(invalide)}, indices 2.6.0`);
      const avecAncienne = resolveAntigravityProfile(invalide, ancienne);
      assert.deepStrictEqual([avecAncienne.profile.id, avecAncienne.source], ['2.5.5', 'detected'], `valeur ${JSON.stringify(invalide)}, ancienne racine`);
      const avecAucun = resolveAntigravityProfile(invalide, aucun);
      assert.deepStrictEqual([avecAucun.profile.id, avecAucun.source], ['2.6.0', 'fallback'], `valeur ${JSON.stringify(invalide)}, aucun indice`);
      assert.doesNotMatch(avecAucun.reason, /valeur par défaut/);
    }
    assert.match(resolveAntigravityProfile('2.6.0', aucun).reason, /imposé par le réglage skillsManager\.antigravityProfile/);
    // La raison de détection ne dit plus « sans effet » de l'ancienne racine
    const raison = resolveAntigravityProfile('auto', tous).reason;
    assert.strictEqual(
      raison,
      'Données de la génération 2.6.0 trouvées dans .gemini (antigravity/builtin/ et antigravity-ide/.ide_migration). L\'ancienne racine antigravity-ide/ est encore présente (ancienne génération).'
    );
    assert.doesNotMatch(raison, /sans effet/);
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

  test('6. Lecture du réglage : défaut « auto » hors de VS Code ; la structure n\'est lue qu\'en « auto »', () => {
    assert.strictEqual(readAntigravityProfileSetting(), 'auto');
    const globalPath = path.join(tempBaseDir, 'lecture', '.gemini', 'config');

    // Sans réglage (défaut « auto ») : les trois indices sont sondés, sous <gemini> seulement
    const defaut = espionStat();
    const resoluDefaut = resolveConfiguredAntigravityProfile(globalPath, undefined, defaut.stat);
    assert.strictEqual(defaut.appels.length, 3, 'Défaut « auto » : trois indices sondés');
    assert.ok(defaut.appels.every((cible) => cible.startsWith(path.dirname(globalPath))), 'Seul <gemini> est sondé');
    assert.deepStrictEqual([resoluDefaut.profile.id, resoluDefaut.source], ['2.6.0', 'fallback'], 'Dossier absent : repli sur 2.6.0');

    // Un profil forcé explicitement ne touche jamais au disque
    for (const force of ['2.5.5', '2.6.0'] as const) {
      const espion = espionStat();
      const resolu = resolveConfiguredAntigravityProfile(globalPath, force, espion.stat);
      assert.deepStrictEqual([resolu.profile.id, resolu.source, espion.appels.length], [force, 'forced', 0]);
    }

    const auto = espionStat();
    resolveConfiguredAntigravityProfile(globalPath, 'auto', auto.stat);
    assert.strictEqual(auto.appels.length, 3, 'En « auto », trois indices sont sondés');
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
    assert.strictEqual(reglage.default, 'auto');
    assert.strictEqual(reglage.scope, 'machine', 'Portée machine : un dépôt ne peut pas fixer le profil');
  });

  test('8. Neutralité du défaut : sans profil = profil 2.5.5 ; le profil 2.6.0 ne change que les points des lots L4, L6, L7 et L8', async () => {
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
    await writeFile(path.join(gemini, 'antigravity', 'mcp', 'serveur', 'second-outil.json'), '{}');
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
    // Sans profil, les scanners appliquent le profil 2.5.5 : résultats strictement égaux
    assert.deepStrictEqual(await GlobalScanner.scan(globalDir, 'antigravity', PROFIL_255), reference.global, 'GlobalScanner, profil 2.5.5');
    assert.deepStrictEqual(await LocalScanner.scan(workspace, PROFIL_255), reference.local, 'LocalScanner, profil 2.5.5');
    assert.deepStrictEqual(await McpScanner.scanGlobal(globalDir, 'antigravity', PROFIL_255), reference.mcpGlobal, 'McpScanner global, profil 2.5.5');
    assert.deepStrictEqual(await McpScanner.scanLocal(workspace, PROFIL_255), reference.mcpLocal, 'McpScanner local, profil 2.5.5');

    // Profil 2.6.0 : seuls les skills intégrés, l'ancien emplacement global et le cache MCP (lot L4),
    // le skill de plugin, compté une seule fois (lot L6), la règle glob, sans effet (lot L7), et les
    // règles des variantes comme _agents/rules/ (lot L8) changent
    const global260 = await GlobalScanner.scan(globalDir, 'antigravity', PROFIL_260);
    const sansL4L6 = (items: typeof global260.items) =>
      items.filter((i) => !i.metadata?.builtin && i.metadata?.rawId !== 'ancien-global' && !i.metadata?.pluginName && i.metadata?.trigger !== 'glob');
    assert.deepStrictEqual(sansL4L6(global260.items), sansL4L6(reference.global.items), 'Les autres éléments globaux ne changent pas');
    const greffon = (items: typeof global260.items) => items.find((i) => i.id === 'greffon:greffon-skill')!;
    assert.strictEqual(greffon(reference.global.items).tokenCount, 2 * greffon(global260.items).tokenCount!, 'Skill de plugin : deux copies en 2.5.5, une en 2.6.0');
    assert.deepStrictEqual(global260.items.filter((i) => i.metadata?.builtin).map((i) => i.id), ['integre-nouveau']);
    assert.deepStrictEqual(reference.global.items.filter((i) => i.metadata?.builtin).map((i) => i.id), ['integre-ancien']);
    assert.strictEqual(global260.items.find((i) => i.metadata?.rawId === 'ancien-global')?.metadata?.antigravityStatus, 'not-read');
    assert.strictEqual(global260.items.find((i) => i.id === 'motif')?.metadata?.antigravityStatus, 'glob-no-effect');
    assert.strictEqual(reference.global.items.find((i) => i.id === 'motif')?.metadata?.antigravityStatus, 'active');
    assert.strictEqual(global260.rulesStat.tokenCount, reference.global.rulesStat.tokenCount, 'Le coût des règles au démarrage ne change pas');
    assert.deepStrictEqual(global260.soulStat, reference.global.soulStat, 'Les âmes ne changent pas');
    const local260 = await LocalScanner.scan(workspace, PROFIL_260);
    assert.ok(!reference.local.items.some((i) => i.id === '_agents/variante'), 'Profil 2.5.5 : _agents/ ignoré (D-8)');
    assert.deepStrictEqual(
      local260.items.filter((i) => i.id !== '_agents/variante'),
      reference.local.items,
      'Les autres éléments locaux ne changent pas'
    );
    const variante260 = local260.items.find((i) => i.id === '_agents/variante')!;
    assert.ok(variante260, 'Profil 2.6.0 : _agents/rules/ lu (lot L8)');
    assert.strictEqual(variante260.metadata?.unverifiedVariantRule, 'cohabitation');
    const mcp260 = await McpScanner.scanGlobal(globalDir, 'antigravity', PROFIL_260);
    assert.deepStrictEqual(mcp260.mcpServers!.map((s) => s.toolCount), [2], 'Cache antigravity/mcp');
    assert.deepStrictEqual(reference.mcpGlobal.mcpServers!.map((s) => s.toolCount), [1], 'Cache antigravity-ide/mcp');
  });

  test('9. État envoyé au webview : défaut « auto » sur un faux <gemini> (2.6.0 détecté, 2.5.5 détecté, repli), profil forcé, et antigravityBehavior avec source et raison', async () => {
    const sansHorloge = (etat: Record<string, any>) => {
      const copie = JSON.parse(JSON.stringify(etat));
      for (const cle of ['lastTimingLog', 'isDebugTiming', 'timingHistory']) delete copie[cle];
      if (copie.nasStatus) delete copie.nasStatus.checkedAt;
      return copie;
    };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscodeMock = require('vscode');
    const origGetConfig = vscodeMock.workspace.getConfiguration;
    // Chaque cas pointe skillsManager.globalPath vers un faux <gemini>/config : le vrai <home>/.gemini n'est jamais sondé
    const configurer = (globalPath: string, profil?: string) => {
      vscodeMock.workspace.getConfiguration = () => ({
        get: (key: string, def: any) => {
          if (key === 'globalPath') return globalPath;
          if (key === 'nasPath') return '';
          if (key === ANTIGRAVITY_PROFILE_SETTING) return profil;
          return def;
        },
      });
    };
    const cas = [
      { nom: 'nouvelle-structure', dossiers: ['antigravity/builtin', 'antigravity-ide'], fichiers: ['antigravity-ide/.ide_migration'], profil: '2.6.0', source: 'detected' },
      { nom: 'ancienne-structure', dossiers: ['antigravity-ide'], fichiers: [], profil: '2.5.5', source: 'detected' },
      { nom: 'aucune-structure', dossiers: [], fichiers: [], profil: '2.6.0', source: 'fallback' },
    ] as const;

    try {
      StateManager.setAntigravityProfileForTesting(null);
      for (const c of cas) {
        const gemini = path.join(tempBaseDir, `etat-${c.nom}`, '.gemini');
        await construire(gemini, [...c.dossiers, 'config'], [...c.fichiers]);
        configurer(path.join(gemini, 'config'));
        const etat = await StateManager.loadFullState(true);
        const attendu = ANTIGRAVITY_PROFILES[c.profil];
        assert.deepStrictEqual(
          [StateManager.lastAntigravityProfile?.profile.id, StateManager.lastAntigravityProfile?.source],
          [c.profil, c.source],
          `${c.nom} : profil transmis aux scanners`
        );
        assert.deepStrictEqual(Object.keys(etat.antigravityBehavior!).sort(), ['reason', 'source', 'testedOn', 'version']);
        assert.strictEqual(etat.antigravityBehavior?.version, attendu.testedVersion);
        assert.strictEqual(etat.antigravityBehavior?.testedOn, attendu.testedOn);
        assert.strictEqual(etat.antigravityBehavior?.source, c.source);
        assert.strictEqual(etat.antigravityBehavior?.reason, StateManager.lastAntigravityProfile?.reason);
        assert.ok(
          !etat.antigravityBehavior!.reason.includes(tempBaseDir) && !etat.antigravityBehavior!.reason.includes(os.homedir()),
          `${c.nom} : raison sans chemin absolu`
        );
        assert.ok(!Object.keys(etat).some((cle) => /profil|profile/i.test(cle)), 'Aucune clé de profil de premier niveau');
      }

      // Profil forcé par le réglage : aucune lecture de la structure, source « forced »
      const gemini = path.join(tempBaseDir, 'etat-nouvelle-structure', '.gemini');
      configurer(path.join(gemini, 'config'), '2.5.5');
      const force255 = await StateManager.loadFullState(true);
      assert.deepStrictEqual(force255.antigravityBehavior, {
        version: 'Antigravity IDE 2.5.5',
        testedOn: '2026-10-21',
        source: 'forced',
        reason: 'Profil 2.5.5 imposé par le réglage skillsManager.antigravityProfile.',
      });
      // Le même profil imposé par le port de test donne exactement le même état
      configurer(path.join(gemini, 'config'));
      StateManager.setAntigravityProfileForTesting(resolveAntigravityProfile('2.5.5', { newStructure: true, migrationMarker: true, oldStructure: true }));
      const override255 = await StateManager.loadFullState(true);
      assert.deepStrictEqual(sansHorloge(override255), sansHorloge(force255));
    } finally {
      StateManager.setAntigravityProfileForTesting(null);
      vscodeMock.workspace.getConfiguration = origGetConfig;
    }
  });

  // Lot L10, D-1 : pastille « Profil : … » dans le Grand Dashboard et la barre latérale
  test('10. Pastille du profil : détecté, forcé, non détecté (jamais « détecté » sur un repli), masquée en Claude Code et sans état', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const main = require(path.resolve(__dirname, '../../src/webview/main.js'));
    const titreCommun = 'La structure du dossier .gemini indique une génération d\'Antigravity, et non une version exacte.';
    const reglage = 'Réglage : skillsManager.antigravityProfile (auto, 2.5.5 ou 2.6.0).';
    const comportement = (resolu: ReturnType<typeof resolveAntigravityProfile>) => ({
      version: resolu.profile.testedVersion,
      testedOn: resolu.profile.testedOn,
      source: resolu.source,
      reason: resolu.reason,
    });
    const tous: ProfileSignals = { newStructure: true, migrationMarker: true, oldStructure: true };
    const ancienne: ProfileSignals = { newStructure: false, migrationMarker: false, oldStructure: true };
    const aucun: ProfileSignals = { newStructure: false, migrationMarker: false, oldStructure: false };
    const cas = [
      { resolu: resolveAntigravityProfile('auto', tous), texte: 'Profil : Antigravity IDE 2.6.0 (détecté)' },
      { resolu: resolveAntigravityProfile('auto', ancienne), texte: 'Profil : Antigravity IDE 2.5.5 (détecté)' },
      { resolu: resolveAntigravityProfile('auto', aucun), texte: 'Profil : Antigravity IDE 2.6.0 (non détecté)' },
      { resolu: resolveAntigravityProfile('2.5.5', tous), texte: 'Profil : Antigravity IDE 2.5.5 (forcé)' },
      { resolu: resolveAntigravityProfile('2.6.0', aucun), texte: 'Profil : Antigravity IDE 2.6.0 (forcé)' },
    ];
    for (const { resolu, texte } of cas) {
      const label = main.antigravityProfileLabel(comportement(resolu));
      assert.strictEqual(label.text, texte);
      assert.strictEqual(
        label.title,
        [titreCommun, resolu.reason, `Comportement de ${resolu.profile.testedVersion} testé le ${resolu.profile.testedOn}.`, reglage].join('\n')
      );
      assert.doesNotMatch(label.title, /retour à la 2\.5\.5|laisse cette structure/, 'Phrase non vérifiée absente');
    }
    const repli = main.antigravityProfileLabel(comportement(resolveAntigravityProfile('auto', aucun)));
    assert.doesNotMatch(repli.text, /\(détecté\)/, 'Un repli ne dit jamais « (détecté) »');
    assert.strictEqual(main.antigravityProfileLabel(undefined), null);
    assert.strictEqual(main.antigravityProfileLabel({ version: 'Antigravity IDE 2.6.0', testedOn: '2026-10-28' }), null, 'Sans source : pas de pastille');

    // Rendu : textContent et title, dans les deux pages ; masquée en Claude Code et sans état
    const noeuds: Record<string, { style: Record<string, string>; textContent: string; title: string; innerHTML: string }> = {};
    const doc = {
      getElementById: (id: string) => (noeuds[id] = noeuds[id] ?? { style: {}, textContent: '', title: '', innerHTML: '' }),
    };
    const ids = ['antigravityProfilePill', 'antigravityProfilePillSide'];
    const behavior = comportement(resolveAntigravityProfile('auto', tous));
    main.renderAntigravityProfilePill({ workspace: { tool: 'antigravity' }, antigravityBehavior: behavior }, doc);
    for (const id of ids) {
      assert.strictEqual(noeuds[id].style.display, '');
      assert.strictEqual(noeuds[id].textContent, 'Profil : Antigravity IDE 2.6.0 (détecté)');
      assert.ok(noeuds[id].title.startsWith(titreCommun));
      assert.strictEqual(noeuds[id].innerHTML, '', 'Jamais innerHTML');
    }
    for (const etat of [{ workspace: { tool: 'claude-code' }, antigravityBehavior: behavior }, null, { workspace: { tool: 'antigravity' } }]) {
      main.renderAntigravityProfilePill(etat, doc);
      for (const id of ids) {
        assert.deepStrictEqual([noeuds[id].style.display, noeuds[id].textContent, noeuds[id].title], ['none', '', ''], JSON.stringify(etat));
      }
    }
    // Les deux pages déclarent la pastille, masquée par défaut
    for (const [page, id] of [['dashboard.html', 'antigravityProfilePill'], ['sidebar.html', 'antigravityProfilePillSide']]) {
      const html = fs.readFileSync(path.join(ROOT, 'src', 'webview', page), 'utf8');
      assert.match(html, new RegExp(`id="${id}" style="display: none;"`), page);
    }
  });
});
