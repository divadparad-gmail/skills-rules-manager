/**
 * Suite de tests de la détection d'environnement et de l'adaptation de
 * protocole (chapitre 3.6 du PRD).
 *
 * Elle vérifie la matrice heuristique à cinq signaux, le seuil de bascule, les
 * dérogations manuelles, la distinction entre agents, puis la traduction des
 * manifestes et la résolution des chemins de déploiement.
 */

import * as assert from 'node:assert';
import * as path from 'node:path';
import { test, describe } from 'node:test';
import {
  HostEnvironmentDetector,
  HOST_PROBE_BUDGET_MS,
  MAX_HOST_SCORE,
  NATIVE_HOST_THRESHOLD,
  SIGNAL_WEIGHTS,
} from '../src/environment/HostEnvironmentDetector';
import { AgentRuntimeDetector } from '../src/environment/AgentRuntimeDetector';
import { SkillProtocolAdapter } from '../src/environment/SkillProtocolAdapter';

/** Entrées de sonde neutres : aucun signal Anti-Gravity n'est présent. */
function neutralInputs(overrides: Record<string, unknown> = {}) {
  return {
    appName: 'Visual Studio Code',
    appHost: 'desktop',
    execPath: 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    env: {} as NodeJS.ProcessEnv,
    productJsonPaths: [],
    ipcSocketPaths: [],
    readFileSync: () => '',
    existsSync: () => false,
    ...overrides,
  };
}

describe("Suite de Tests : Détection d'environnement et adaptation de protocole", () => {
  test('1. Matrice heuristique : les cinq signaux cumulent exactement 120 points', () => {
    const total = Object.values(SIGNAL_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    assert.strictEqual(total, MAX_HOST_SCORE, 'Le score maximal du PRD est de 120 points.');
    assert.strictEqual(SIGNAL_WEIGHTS.appMetadata, 40);
    assert.strictEqual(SIGNAL_WEIGHTS.productMetadata, 25);
    assert.strictEqual(SIGNAL_WEIGHTS.processPath, 20);
    assert.strictEqual(SIGNAL_WEIGHTS.environmentVariables, 15);
    assert.strictEqual(SIGNAL_WEIGHTS.ipcSocket, 20);
  });

  test('2. VS Code standard : aucun signal ne se déclenche, le mode autonome est retenu', () => {
    const context = HostEnvironmentDetector.detect(neutralInputs(), 'auto');

    assert.strictEqual(context.score, 0);
    assert.strictEqual(context.host, 'vscode-standalone');
    assert.strictEqual(context.overridden, false);
    assert.ok(
      context.signals.every((signal) => !signal.matched),
      'Aucun signal ne doit être détecté dans un hôte VS Code nu.'
    );
  });

  test("3. Nom d'application Anti-Gravity : 40 points, sous le seuil, donc encore autonome", () => {
    const context = HostEnvironmentDetector.detect(
      neutralInputs({ appName: 'Anti-Gravity IDE' }),
      'auto'
    );

    assert.strictEqual(context.score, 40);
    assert.strictEqual(
      context.host,
      'vscode-standalone',
      'Un score de 40 reste sous le seuil de bascule de 60.'
    );
  });

  test('4. Seuil de bascule : 40 + 25 points franchissent les 60 points et activent le mode natif', () => {
    const context = HostEnvironmentDetector.detect(
      neutralInputs({
        appName: 'Antigravity',
        productJsonPaths: ['/opt/antigravity/resources/app/product.json'],
        existsSync: () => true,
        readFileSync: () =>
          JSON.stringify({ applicationName: 'antigravity', dataFolderName: '.antigravity' }),
      }),
      'auto'
    );

    assert.strictEqual(context.score, 65);
    assert.ok(context.score >= NATIVE_HOST_THRESHOLD);
    assert.strictEqual(context.host, 'antigravity-native');
  });

  test('5. Cumul complet : les cinq signaux réunis atteignent le score maximal', () => {
    const context = HostEnvironmentDetector.detect(
      neutralInputs({
        appName: 'Anti-Gravity IDE',
        appHost: 'antigravity-desktop',
        execPath: '/Applications/Anti-Gravity.app/Contents/MacOS/antigravity',
        env: { ANTIGRAVITY_IDE: '1', AGY_IDE_VERSION: '2.1.0' } as NodeJS.ProcessEnv,
        productJsonPaths: ['/opt/antigravity/product.json'],
        ipcSocketPaths: ['/var/run/antigravity.sock'],
        existsSync: () => true,
        readFileSync: () => JSON.stringify({ applicationName: 'antigravity' }),
      }),
      'auto'
    );

    assert.strictEqual(context.score, MAX_HOST_SCORE);
    assert.strictEqual(context.host, 'antigravity-native');
    assert.ok(
      context.signals.every((signal) => signal.matched),
      'Les cinq signaux doivent être actifs.'
    );
  });

  test("6. Budget d'exécution : la sonde complète reste sous les 50 ms imposées à l'amorçage", () => {
    const context = HostEnvironmentDetector.detect(neutralInputs(), 'auto');
    assert.ok(
      context.probeDurationMs < HOST_PROBE_BUDGET_MS,
      `La sonde a duré ${context.probeDurationMs} ms, au-delà du budget de ${HOST_PROBE_BUDGET_MS} ms.`
    );
  });

  test('7. Dérogation manuelle : le mode forcé prévaut sur le verdict heuristique', () => {
    const forcedNative = HostEnvironmentDetector.detect(neutralInputs(), 'antigravity-native');
    assert.strictEqual(forcedNative.host, 'antigravity-native');
    assert.strictEqual(forcedNative.overridden, true);
    assert.strictEqual(forcedNative.score, 0, 'Le score brut reste consultable malgré la dérogation.');

    const forcedStandalone = HostEnvironmentDetector.detect(
      neutralInputs({
        appName: 'Anti-Gravity IDE',
        execPath: '/opt/antigravity/antigravity',
        env: { ANTIGRAVITY_IDE: '1' } as NodeJS.ProcessEnv,
      }),
      'vscode-standalone'
    );
    assert.strictEqual(forcedStandalone.host, 'vscode-standalone');
    assert.ok(forcedStandalone.score >= NATIVE_HOST_THRESHOLD);
  });

  test("8. Robustesse : un product.json illisible neutralise le signal sans interrompre la sonde", () => {
    const context = HostEnvironmentDetector.detect(
      neutralInputs({
        productJsonPaths: ['/chemin/corrompu/product.json'],
        existsSync: () => true,
        readFileSync: () => '{ ceci n\u2019est pas du JSON',
      }),
      'auto'
    );

    const signal = context.signals.find((entry) => entry.name === 'productMetadata');
    assert.ok(signal);
    assert.strictEqual(signal.matched, false);
    assert.strictEqual(context.score, 0);
  });

  test('9. Cache : getContext mémorise le verdict et invalidate le réinitialise', () => {
    HostEnvironmentDetector.detect(neutralInputs(), 'antigravity-native');
    const cached = HostEnvironmentDetector.getContext();
    assert.strictEqual(cached.host, 'antigravity-native');

    HostEnvironmentDetector.invalidate();
    const fresh = HostEnvironmentDetector.getContext();
    assert.ok(fresh.detectedAt >= cached.detectedAt, 'Une nouvelle sonde doit être exécutée.');
  });

  test("10. Agent Claude Code : les variables d'environnement l'emportent sur les marqueurs de fichiers", () => {
    const context = AgentRuntimeDetector.detect('/projet', {
      env: { CLAUDE_CODE_ENTRYPOINT: 'cli' } as NodeJS.ProcessEnv,
      existsSync: (candidate: string) => candidate.endsWith('.agents'),
      override: 'auto',
    });

    assert.strictEqual(context.runtime, 'claude-code');
    assert.ok(context.signals.some((signal) => signal.kind === 'environment'));
  });

  test("11. Agent Anti-Gravity : les marqueurs de l'espace de travail départagent à défaut de variables", () => {
    const context = AgentRuntimeDetector.detect('/projet', {
      env: {} as NodeJS.ProcessEnv,
      existsSync: (candidate: string) =>
        candidate.endsWith('.agents') || candidate.endsWith('GEMINI.md'),
      override: 'auto',
    });

    assert.strictEqual(context.runtime, 'antigravity');
    assert.strictEqual(context.mixedWorkspace, false);
  });

  test('12. Espace de travail mixte : la cohabitation des deux agents est signalée', () => {
    const context = AgentRuntimeDetector.detect('/projet', {
      env: {} as NodeJS.ProcessEnv,
      existsSync: (candidate: string) =>
        candidate.endsWith('.agents') || candidate.endsWith('.claude') || candidate.endsWith('CLAUDE.md'),
      override: 'auto',
    });

    assert.strictEqual(context.mixedWorkspace, true);
    assert.strictEqual(
      context.runtime,
      'claude-code',
      'La majorité des marqueurs désigne Claude Code dans ce scénario.'
    );
  });

  test("13. Dérogation d'agent : le mode forcé court-circuite tous les signaux", () => {
    const context = AgentRuntimeDetector.detect('/projet', {
      env: { CLAUDE_CODE: '1' } as NodeJS.ProcessEnv,
      existsSync: () => true,
      override: 'antigravity',
    });

    assert.strictEqual(context.runtime, 'antigravity');
    assert.strictEqual(context.overridden, true);
  });

  test('14. Analyse de manifeste : frontmatter, étiquettes et paramètres sont extraits', () => {
    const markdown = [
      '---',
      'name: Extracteur de tableaux',
      'description: Extrait des tableaux dynamiques protégés par authentification',
      'version: 1.2.0',
      'tags: [scraping, playwright]',
      '---',
      '',
      'Instructions détaillées de la compétence.',
    ].join('\n');

    const manifest = SkillProtocolAdapter.parseManifest(markdown, {
      id: 'table-extractor',
      type: 'skills',
    });

    assert.strictEqual(manifest.name, 'Extracteur de tableaux');
    assert.strictEqual(manifest.version, '1.2.0');
    assert.deepStrictEqual(manifest.tags, ['scraping', 'playwright']);
    assert.match(manifest.body, /Instructions détaillées/);
  });

  test("15. Traduction Anti-Gravity vers Claude Code : le frontmatter s'adapte à l'agent ciblé", () => {
    const manifest = SkillProtocolAdapter.parseManifest(
      '---\nname: Analyseur\ndescription: Analyse de rendu React\n---\n\nCorps.',
      { id: 'analyseur', type: 'skills' }
    );
    manifest.parameters = [
      { name: 'composant', type: 'string', description: 'Composant ciblé', required: true },
      { name: 'profondeur', type: 'number', description: 'Profondeur d\u2019analyse', required: false },
    ];

    const antigravity = SkillProtocolAdapter.toManifest(manifest, 'antigravity');
    const claude = SkillProtocolAdapter.toManifest(manifest, 'claude-code');

    assert.match(antigravity, /^---\n/, 'Le manifeste commence par son frontmatter.');
    assert.match(antigravity, /type: skills/, 'Anti-Gravity déclare le type de ressource.');
    assert.ok(!antigravity.includes('argument-hint'), 'Anti-Gravity ne déclare pas de commande slash.');
    assert.match(
      claude,
      /argument-hint: <composant> \[profondeur\]/,
      "Claude Code expose la compétence comme commande, avec ses arguments."
    );
  });

  test('16. Déclaration MCP : le schéma d\u2019entrée reflète les paramètres et leur obligation', () => {
    const manifest = SkillProtocolAdapter.parseManifest(
      '---\nname: Analyseur\ndescription: Analyse de rendu\n---\n\nCorps.',
      { id: 'analyseur-react', type: 'skills' }
    );
    manifest.parameters = [
      { name: 'composant', type: 'string', description: 'Composant ciblé', required: true },
      { name: 'verbeux', type: 'boolean', description: 'Trace détaillée', required: false },
    ];

    const declaration = SkillProtocolAdapter.toMcpToolDeclaration(manifest);

    assert.strictEqual(declaration.name, 'analyseur-react');
    assert.strictEqual(declaration.inputSchema.type, 'object');
    assert.deepStrictEqual(declaration.inputSchema.required, ['composant']);
    assert.strictEqual(declaration.inputSchema.properties.verbeux.type, 'boolean');
    assert.strictEqual(SkillProtocolAdapter.toSlashCommand(manifest), '/analyseur-react');
  });

  test('17. Traduction inverse : une déclaration MCP redevient un manifeste neutre', () => {
    const manifest = SkillProtocolAdapter.fromMcpToolDeclaration(
      {
        name: 'fixtures-openapi',
        description: 'Génère des jeux de données OpenAPI',
        inputSchema: {
          type: 'object',
          properties: {
            schema: { type: 'string', description: 'Schéma source' },
            count: { type: 'integer', description: 'Nombre de fixtures' },
          },
          required: ['schema'],
        },
      },
      'Corps des instructions.'
    );

    assert.strictEqual(manifest.id, 'fixtures-openapi');
    assert.strictEqual(manifest.parameters.length, 2);
    const count = manifest.parameters.find((parameter) => parameter.name === 'count');
    assert.strictEqual(count?.type, 'number', 'Le type entier est ramené au type numérique neutre.');
    assert.strictEqual(count?.required, false);
  });

  test('18. Chemins de déploiement local : chaque agent vise son propre dossier', () => {
    const antigravity = SkillProtocolAdapter.resolveDeploymentPaths({
      runtime: 'antigravity',
      target: 'local',
      type: 'skills',
      resourceId: 'extracteur',
      workspaceRoot: path.join('/projet'),
      agentsDirName: '.agents',
    });
    const claude = SkillProtocolAdapter.resolveDeploymentPaths({
      runtime: 'claude-code',
      target: 'local',
      type: 'skills',
      resourceId: 'extracteur',
      workspaceRoot: path.join('/projet'),
      agentsDirName: '.agents',
    });

    assert.ok(antigravity.file.includes(path.join('.agents', 'skills', 'extracteur', 'SKILL.md')));
    assert.ok(claude.file.includes(path.join('.claude', 'skills', 'extracteur', 'SKILL.md')));
    assert.strictEqual(antigravity.isFolder, true);
  });

  test('19. Règles et hooks : ces ressources sont des fichiers isolés, pas des dossiers', () => {
    const rule = SkillProtocolAdapter.resolveDeploymentPaths({
      runtime: 'antigravity',
      target: 'local',
      type: 'rules',
      resourceId: '01-conventions.md',
      workspaceRoot: path.join('/projet'),
      agentsDirName: '.agents',
    });

    assert.strictEqual(rule.isFolder, false);
    assert.ok(rule.file.endsWith(path.join('rules', '01-conventions.md')));
  });

  test("20. Déploiement NAS : l'absence de chemin configuré lève une erreur explicite", () => {
    assert.throws(
      () =>
        SkillProtocolAdapter.resolveDeploymentPaths({
          runtime: 'antigravity',
          target: 'nas',
          type: 'skills',
          resourceId: 'extracteur',
          nasRoot: null,
        }),
      /NAS/
    );

    const deployed = SkillProtocolAdapter.resolveDeploymentPaths({
      runtime: 'antigravity',
      target: 'nas',
      type: 'skills',
      resourceId: 'extracteur',
      nasRoot: path.join('/mnt', 'nas', 'skills'),
    });
    assert.ok(deployed.file.includes(path.join('skills', 'extracteur', 'SKILL.md')));
  });

  test("21. Assainissement d'identifiant : les caractères hostiles ne franchissent pas le chemin", () => {
    const paths = SkillProtocolAdapter.resolveDeploymentPaths({
      runtime: 'antigravity',
      target: 'local',
      type: 'skills',
      resourceId: '../../evasion/skill',
      workspaceRoot: path.join('/projet'),
      agentsDirName: '.agents',
    });

    assert.ok(
      !paths.directory.includes('..'),
      "Aucun segment de remontée ne doit subsister dans le chemin résolu."
    );
  });
});
