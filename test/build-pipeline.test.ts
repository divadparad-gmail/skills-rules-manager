/**
 * Suite de tests de la chaîne de construction et des contributions déclarées
 * au manifeste (§2.E, §3.3, §3.5, §3.6 et §3.7 du PRD).
 *
 * Ces vérifications portent sur le contrat que l'extension expose à VS Code :
 * point d'entrée produit par esbuild, réglages contribués avec leurs bornes,
 * raccourcis clavier et contenu réellement embarqué dans le paquet.
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, describe } from 'node:test';

const ROOT = path.resolve(__dirname, '..', '..');

function readPackageJson(): any {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
}

describe('Suite de Tests : Chaîne de construction et contributions du manifeste', () => {
  test("1. Point d'entrée : le manifeste désigne le paquet produit par esbuild", () => {
    const pkg = readPackageJson();
    assert.strictEqual(pkg.main, './dist/extension.js');
    assert.strictEqual(pkg.scripts.bundle, 'node esbuild.js --production');
    assert.match(pkg.scripts['vscode:prepublish'], /type-check/);
    assert.match(pkg.scripts['vscode:prepublish'], /bundle/);
  });

  test('2. Configuration esbuild : le module vscode reste externe et le code mort est éliminé', () => {
    const script = fs.readFileSync(path.join(ROOT, 'esbuild.js'), 'utf8');

    assert.match(script, /entryPoints:\s*\['src\/extension\.ts'\]/);
    assert.match(script, /outfile:\s*'dist\/extension\.js'/);
    assert.match(script, /external:\s*\['vscode'\]/, "Le module vscode est fourni par l'éditeur.");
    assert.match(script, /format:\s*'cjs'/);
    assert.match(script, /treeShaking:\s*true/);
    assert.match(script, /minify:\s*production/);
  });

  test('3. Paquet construit : seules les dépendances natives de Node restent externes', (t) => {
    const bundlePath = path.join(ROOT, 'dist', 'extension.js');
    if (!fs.existsSync(bundlePath)) {
      t.skip("Le paquet n'a pas encore été construit (npm run bundle).");
      return;
    }

    const bundle = fs.readFileSync(bundlePath, 'utf8');
    const externals = [...bundle.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
    const allowed = new Set(['vscode', 'crypto', 'fs', 'http', 'https', 'os', 'path', 'url', 'util', 'stream', 'zlib', 'events', 'buffer', 'child_process', 'net', 'dns']);

    const unexpected = [...new Set(externals)].filter((name) => !allowed.has(name));
    assert.deepStrictEqual(
      unexpected,
      [],
      `Ces dépendances devraient être intégrées au paquet : ${unexpected.join(', ')}`
    );
  });

  test('4. Vue Découverte : elle est contribuée dans le conteneur de la barre d’activité', () => {
    const pkg = readPackageJson();
    const views = pkg.contributes.views['skills-rules-manager-sidebar'];
    const discovery = views.find((view: any) => view.id === 'antigravityDiscoveryView');

    assert.ok(discovery, 'La vue Découverte doit être déclarée, même désactivée.');
    assert.strictEqual(discovery.type, 'webview');
    assert.ok(
      views.some((view: any) => view.id === 'skillsRulesManagerView'),
      'La vue historique du gestionnaire reste en place.'
    );
  });

  test('5. Réglage des registres : le schéma reprend les dix propriétés du PRD', () => {
    const pkg = readPackageJson();
    const setting = pkg.contributes.configuration.properties['antigravity.skills.searchUrls'];

    assert.strictEqual(setting.type, 'array');
    assert.strictEqual(setting.scope, 'resource');
    assert.deepStrictEqual(setting.default, []);

    const properties = setting.items.properties;
    [
      'id',
      'name',
      'url',
      'enabled',
      'priority',
      'authType',
      'secretKeyRef',
      'customHeaders',
      'timeoutMs',
      'supportedTypes',
    ].forEach((field) => {
      assert.ok(properties[field], `La propriété « ${field} » doit figurer au schéma.`);
    });

    assert.deepStrictEqual(setting.items.required, ['id', 'name', 'url']);
    assert.deepStrictEqual(properties.authType.enum, ['none', 'bearer', 'apiKey', 'basic', 'customHeader']);
    assert.strictEqual(properties.priority.minimum, 1);
    assert.strictEqual(properties.priority.maximum, 100);
    assert.strictEqual(properties.timeoutMs.minimum, 1000);
    assert.strictEqual(properties.timeoutMs.maximum, 30000);
    assert.strictEqual(properties.timeoutMs.default, 5000);
    assert.deepStrictEqual(properties.supportedTypes.items.enum, [
      'skills',
      'rules',
      'workflows',
      'hooks',
    ]);
  });

  test('6. Réglages auxiliaires : clés, valeurs par défaut et bornes conformes au PRD', () => {
    const properties = readPackageJson().contributes.configuration.properties;

    assert.strictEqual(
      properties['antigravity.skills.enableDefaultRegistry'],
      undefined,
      "Aucun registre implicite n'est proposé : le réglage d'activation a disparu."
    );
    assert.strictEqual(properties['antigravity.skills.requestTimeoutMs'].default, 5000);
    assert.strictEqual(properties['antigravity.skills.maxParallelRegistryQueries'].default, 5);
    assert.strictEqual(properties['antigravity.skills.nasDirectoryPath'].default, '');
    assert.strictEqual(properties['antigravity.skills.nasDirectoryPath'].scope, 'resource');

    const recent = properties['antigravity.search.recentSearchesLimit'];
    assert.strictEqual(recent.default, 10);
    assert.strictEqual(recent.maximum, 50);

    assert.deepStrictEqual(properties['antigravity.environment.hostOverride'].enum, [
      'auto',
      'antigravity-native',
      'vscode-standalone',
    ]);
    assert.deepStrictEqual(properties['antigravity.environment.overrideMode'].enum, [
      'auto',
      'antigravity',
      'claude-code',
    ]);
    assert.deepStrictEqual(properties['antigravity.skills.conflictPolicy'].enum, [
      'prompt',
      'overwrite',
      'increment',
    ]);
  });

  test('7. Commandes : les six commandes du module Découverte sont déclarées', () => {
    const commands = readPackageJson().contributes.commands.map((entry: any) => entry.command);

    [
      'antigravity.discovery.focusSearch',
      'antigravity.discovery.quickSearch',
      'antigravity.discovery.quickDeploy',
      'antigravity.environment.override',
      'antigravity.environment.diagnostics',
      'antigravity.skills.setGeminiKey',
    ].forEach((command) => {
      assert.ok(commands.includes(command), `La commande « ${command} » doit être contribuée.`);
    });
  });

  test('8. Raccourcis clavier : trois combinaisons avec leur variante macOS, aucune en conflit avec VS Code', () => {
    const keybindings = readPackageJson().contributes.keybindings;
    const byCommand = new Map(keybindings.map((entry: any) => [entry.command, entry]));

    const expected: Array<[string, string, string]> = [
      ['antigravity.discovery.focusSearch', 'ctrl+alt+s', 'cmd+alt+s'],
      ['antigravity.discovery.quickSearch', 'ctrl+alt+k', 'cmd+alt+k'],
      ['antigravity.environment.override', 'ctrl+alt+e', 'cmd+alt+e'],
    ];

    expected.forEach(([command, key, mac]) => {
      const binding = byCommand.get(command) as any;
      assert.ok(binding, `Le raccourci de « ${command} » doit être déclaré.`);
      assert.strictEqual(binding.key, key);
      assert.strictEqual(binding.mac, mac, 'Chaque raccourci doit porter sa variante macOS.');
    });
    assert.strictEqual(keybindings.length, expected.length);

    // Ctrl+Shift+G ouvre le contrôle de code source et Ctrl+Alt+I la vue Chat de VS Code
    const keys = keybindings.map((entry: any) => entry.key);
    ['ctrl+shift+g', 'ctrl+alt+i'].forEach((key) => {
      assert.ok(!keys.includes(key), `Le raccourci « ${key} » est réservé par VS Code.`);
    });
  });

  test("9. Contenu du paquet : les gabarits de vue sont embarqués, les sources et dépendances exclues", () => {
    const ignore = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8');

    assert.match(ignore, /^src\/\*\*\/\*\.ts$/m, 'Les sources TypeScript ne sont pas distribuées.');
    assert.match(ignore, /^!src\/webview\/\*\*$/m, 'Les gabarits de vue restent embarqués.');
    assert.match(ignore, /^node_modules\/\*\*$/m, 'Les dépendances sont intégrées au paquet par esbuild.');
    assert.match(ignore, /^out\/\*\*$/m, "La sortie tsc n'est plus distribuée.");
    assert.match(ignore, /^test\/\*\*$/m);
  });

  test('10. Ressources de la vue Découverte : gabarit, styles et script sont présents', () => {
    ['discovery.html', 'discovery.css', 'discovery.js'].forEach((file) => {
      const filePath = path.join(ROOT, 'src', 'webview', file);
      assert.ok(fs.existsSync(filePath), `Le fichier « ${file} » doit exister.`);
    });

    const html = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'discovery.html'), 'utf8');
    assert.match(html, /Content-Security-Policy/, 'Le gabarit doit déclarer sa politique de sécurité.');
    assert.match(html, /script-src 'nonce-\{\{nonce\}\}'/, 'Seul le script porteur du nonce est exécuté.');
    assert.match(html, /\{\{styleUri\}\}/);
    assert.match(html, /\{\{scriptUri\}\}/);
  });

  test("11. Script de la vue : il n'insère jamais de balisage distant via innerHTML", () => {
    const script = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'discovery.js'), 'utf8');

    assert.ok(
      !/\.innerHTML\s*=/.test(script),
      "Le contenu distant doit être inséré par textContent, jamais par innerHTML."
    );
    assert.match(script, /acquireVsCodeApi/);
    assert.match(script, /discovery:ready/);
  });

  test('12. Suite de tests : le contrôle syntaxique couvre les trois scripts de vue', () => {
    const testScript = readPackageJson().scripts.test;

    assert.match(testScript, /node -c src\/webview\/main\.js/);
    assert.match(testScript, /node -c src\/webview\/cheatsheet\.js/);
    assert.match(testScript, /node -c src\/webview\/discovery\.js/);
  });

  test("13. Espace de travail non approuvé : les réglages qu'un dépôt pourrait détourner sont restreints", () => {
    const capability = readPackageJson().capabilities?.untrustedWorkspaces;

    assert.ok(capability, 'La capacité untrustedWorkspaces doit être déclarée.');
    assert.strictEqual(capability.supported, 'limited');
    assert.deepStrictEqual([...capability.restrictedConfigurations].sort(), [
      'antigravity.skills.nasDirectoryPath',
      'antigravity.skills.searchUrls',
    ]);
  });

  test("14. Vue Découverte : l'origine « dépôt » d'un registre est signalée par un badge", () => {
    const script = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'discovery.js'), 'utf8');

    assert.match(script, /registry\.origin === 'workspace'/);
    assert.match(script, /défini par ce dépôt/);
  });

  test("15. Registre par défaut : aucun domaine non vérifié n'est codé en dur dans les sources", () => {
    const sources = [
      'src/search/FederatedSearchService.ts',
      'src/settings/RegistryConfigService.ts',
      'src/webview/discovery.js',
    ];
    for (const file of sources) {
      const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
      assert.ok(!content.includes('antigravity.dev'), `${file} ne doit plus viser registry.antigravity.dev.`);
      assert.ok(!content.includes('DEFAULT_REGISTRY'), `${file} ne doit plus déclarer de registre implicite.`);
    }
  });

  test('16. Vue Découverte expérimentale : désactivée par défaut, avec sa vue, ses commandes et ses raccourcis', () => {
    const pkg = readPackageJson();
    const condition = 'config.antigravity.discovery.enabled';

    const setting = pkg.contributes.configuration.properties['antigravity.discovery.enabled'];
    assert.ok(setting, 'Le réglage antigravity.discovery.enabled doit être déclaré.');
    assert.strictEqual(setting.type, 'boolean');
    assert.strictEqual(setting.default, false, 'La vue Découverte est désactivée par défaut.');
    assert.deepStrictEqual(setting.tags, ['experimental']);
    assert.match(setting.markdownDescription, /Expérimental/);

    const view = pkg.contributes.views['skills-rules-manager-sidebar'].find(
      (entry: any) => entry.id === 'antigravityDiscoveryView'
    );
    assert.strictEqual(view.when, condition, 'La vue ne doit apparaître que si le réglage est activé.');

    const discoveryCommands = [
      'antigravity.discovery.focusSearch',
      'antigravity.discovery.quickSearch',
      'antigravity.discovery.quickDeploy',
      'antigravity.environment.override',
      'antigravity.environment.diagnostics',
      'antigravity.skills.setGeminiKey',
    ];
    const palette = new Map(pkg.contributes.menus.commandPalette.map((entry: any) => [entry.command, entry.when]));
    discoveryCommands.forEach((command) => {
      assert.strictEqual(palette.get(command), condition, `« ${command} » doit être masquée de la palette.`);
    });

    pkg.contributes.keybindings
      .filter((entry: any) => discoveryCommands.includes(entry.command))
      .forEach((entry: any) => {
        assert.strictEqual(entry.when, condition, `Le raccourci de « ${entry.command} » doit être inactif.`);
      });

    // Le badge d'environnement de la barre d'état suit le même réglage
    const extensionSource = fs.readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8');
    assert.match(extensionSource, /environmentStatusBar\.activate\(isDiscoveryEnabled\(\)\)/);
    assert.match(extensionSource, /affectsConfiguration\(DISCOVERY_ENABLED_SETTING\)/);
  });
});
