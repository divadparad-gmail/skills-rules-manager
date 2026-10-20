/**
 * Suite de tests des favoris hors ligne (§3.4) et du pipeline de déploiement
 * multi-cible (§3.5 et jalon 4 du PRD).
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe, before, after } from 'node:test';
import { FavoritesService, compareVersions } from '../src/search/FavoritesService';
import { MementoPort } from '../src/search/RecentSearchesStore';
import {
  DeployFileSystemPort,
  MAX_MANIFEST_BYTES,
  MultiTargetDeployService,
  validateRelativePath,
} from '../src/deploy/MultiTargetDeployService';
import { NasPathService, FileSystemPort } from '../src/settings/NasPathService';
import { ConfigurationPort, ScopedSettingValue } from '../src/settings/RegistryConfigService';
import { SkillSearchResult } from '../src/common/discoveryTypes';
import { ExtensionEventBus } from '../src/common/ExtensionEventBus';

class FakeMemento implements MementoPort {
  private readonly store = new Map<string, unknown>();
  public get<T>(key: string, defaultValue: T): T {
    return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
  }
  public async update(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }
}

class FakeConfiguration implements ConfigurationPort {
  public user = new Map<string, unknown>();
  public workspace = new Map<string, unknown>();
  public inspect<T>(section: string): ScopedSettingValue<T> | undefined {
    return {
      userValue: this.user.get(section) as T | undefined,
      workspaceValue: this.workspace.get(section) as T | undefined,
    };
  }
  public get<T>(section: string, defaultValue: T): T {
    return this.user.has(section) ? (this.user.get(section) as T) : defaultValue;
  }
  public async update(section: string, value: unknown, scope: 'user' | 'workspace'): Promise<void> {
    (scope === 'user' ? this.user : this.workspace).set(section, value);
  }
}

/** Système de fichiers en mémoire : aucun test n'écrit sur le disque réel. */
class MemoryFileSystem implements DeployFileSystemPort {
  public files = new Map<string, string>();
  public directories = new Set<string>();

  public exists(targetPath: string): boolean {
    return this.files.has(targetPath) || this.directories.has(targetPath);
  }
  public async mkdir(directory: string): Promise<void> {
    this.directories.add(directory);
  }
  public async writeFile(targetPath: string, content: string): Promise<void> {
    this.files.set(targetPath, content);
  }
}

const CONNECTED_NAS: FileSystemPort = {
  stat: async () => ({ isDirectory: true }),
  access: async () => undefined,
  writeFile: async () => undefined,
  unlink: async () => undefined,
};

const OFFLINE_NAS: FileSystemPort = {
  stat: async () => {
    throw new Error('Le partage réseau est hors ligne.');
  },
  access: async () => undefined,
  writeFile: async () => undefined,
  unlink: async () => undefined,
};

function buildResult(overrides: Partial<SkillSearchResult> = {}): SkillSearchResult {
  return {
    id: 'hub:extracteur',
    name: 'Extracteur de tableaux',
    description: 'Extrait des tableaux dynamiques protégés par authentification',
    type: 'skills',
    registryId: 'hub',
    registryName: 'Hub interne',
    url: 'https://hub.exemple.com/extracteur',
    version: '1.0.0',
    tags: ['scraping'],
    metrics: { downloads: 10, stars: 2, comments: 1, rating: 4.5, verified: true },
    semanticScore: 0.8,
    hybridScore: 0.8,
    matchRationale: 'Correspond à la demande.',
    manifest: '---\nname: Extracteur\ndescription: Extraction de tableaux\n---\n\nInstructions.',
    ...overrides,
  };
}

const MANIFEST = '---\nname: Extracteur\ndescription: Extraction de tableaux\n---\n\nInstructions.';
let cacheRoot = '';

describe('Suite de Tests : Favoris hors ligne et déploiement multi-cible', () => {
  before(() => {
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-favoris-'));
  });

  after(() => {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });

  test("1. Mise en favori : la fiche est enregistrée et son manifeste mis en cache sur disque", async () => {
    const service = new FavoritesService(new FakeMemento(), new FakeMemento(), undefined, cacheRoot);
    const result = buildResult();

    const favorited = await service.toggle(result);

    assert.strictEqual(favorited, true);
    assert.strictEqual(service.isFavorite(result.id), true);
    assert.strictEqual(service.readCachedManifest(result.id), result.manifest);
    assert.ok(
      fs.readdirSync(cacheRoot).length > 0,
      'Le manifeste doit être consultable sans accès réseau.'
    );
  });

  test('2. Retrait : la fiche disparaît et son manifeste est purgé du cache', async () => {
    const service = new FavoritesService(new FakeMemento(), new FakeMemento(), undefined, cacheRoot);
    const result = buildResult({ id: 'hub:temporaire' });

    await service.add(result);
    assert.strictEqual(service.isFavorite(result.id), true);

    const stillFavorited = await service.toggle(result);

    assert.strictEqual(stillFavorited, false);
    assert.strictEqual(service.isFavorite(result.id), false);
    assert.strictEqual(service.readCachedManifest(result.id), null);
  });

  test('3. Événement : chaque bascule publie son sujet sur le médiateur', async () => {
    const bus = new ExtensionEventBus();
    const events: Array<{ skillId: string; favorited: boolean }> = [];
    bus.subscribe('skill:favorite:toggled', (envelope) => {
      events.push({ skillId: envelope.payload.skillId, favorited: envelope.payload.favorited });
    });

    const service = new FavoritesService(new FakeMemento(), new FakeMemento(), bus, cacheRoot);
    const result = buildResult({ id: 'hub:evenement' });
    await service.add(result);
    await service.remove(result.id);

    assert.deepStrictEqual(events, [
      { skillId: 'hub:evenement', favorited: true },
      { skillId: 'hub:evenement', favorited: false },
    ]);
    bus.dispose();
  });

  test('4. Filtrage et tri : mot-clé, catégorie et ordre alphabétique', async () => {
    const service = new FavoritesService(new FakeMemento(), new FakeMemento(), undefined, cacheRoot);
    await service.add(buildResult({ id: 'a', name: 'Zèbre analytique', type: 'skills', tags: ['analyse'] }));
    await service.add(buildResult({ id: 'b', name: 'Alpha règles', type: 'rules', tags: ['qualité'] }));

    assert.deepStrictEqual(
      service.list('user', { sortBy: 'alphabetical' }).map((f) => f.name),
      ['Alpha règles', 'Zèbre analytique']
    );
    assert.deepStrictEqual(
      service.list('user', { keyword: 'analyse' }).map((f) => f.id),
      ['a'],
      "Le filtre couvre aussi les étiquettes."
    );
    assert.deepStrictEqual(service.list('user', { types: ['rules'] }).map((f) => f.id), ['b']);
  });

  test("5. Tri « récemment utilisés » : le marquage d'usage remonte la fiche", async () => {
    const service = new FavoritesService(new FakeMemento(), new FakeMemento(), undefined, cacheRoot);
    await service.add(buildResult({ id: 'ancien', name: 'Ancien' }));
    await service.add(buildResult({ id: 'recent', name: 'Récent' }));
    await service.markUsed('ancien');

    assert.strictEqual(service.list('user', { sortBy: 'recent' })[0].id, 'ancien');
  });

  test("6. Étiquettes personnelles : elles remplacent celles d'origine", async () => {
    const service = new FavoritesService(new FakeMemento(), new FakeMemento(), undefined, cacheRoot);
    await service.add(buildResult({ id: 'etiquete' }));

    await service.setTags('etiquete', ['équipe-données', 'prioritaire', 'équipe-données']);

    const favorite = service.list('user', {})[0];
    assert.deepStrictEqual(favorite.tags, ['équipe-données', 'prioritaire'], 'Les doublons sont écartés.');
  });

  test('7. Export et import : un paquet circule entre deux collections', async () => {
    const source = new FavoritesService(new FakeMemento(), new FakeMemento(), undefined, cacheRoot);
    await source.add(buildResult({ id: 'partage', name: 'Compétence partagée' }));

    const bundle = source.exportBundle();
    assert.strictEqual(bundle.version, 1);
    assert.strictEqual(bundle.favorites.length, 1);

    const destination = new FavoritesService(new FakeMemento(), new FakeMemento(), undefined, cacheRoot);
    const outcome = await destination.importBundle(bundle);

    assert.deepStrictEqual(outcome, { imported: 1, skipped: 0 });
    assert.strictEqual(destination.isFavorite('partage'), true);
  });

  test("8. Import : une entrée déjà plus récente localement n'est pas écrasée", async () => {
    const service = new FavoritesService(new FakeMemento(), new FakeMemento(), undefined, cacheRoot);
    await service.add(buildResult({ id: 'conflit', name: 'Version locale' }));

    const outcome = await service.importBundle({
      version: 1,
      exportedAt: new Date().toISOString(),
      favorites: [
        {
          id: 'conflit',
          name: 'Version importée',
          description: '',
          type: 'skills',
          registryId: 'hub',
          registryName: 'Hub',
          url: '',
          tags: [],
          savedAt: 1,
        },
        { name: 'sans identifiant' },
      ],
    });

    assert.deepStrictEqual(outcome, { imported: 0, skipped: 2 });
    assert.strictEqual(service.list('user', {})[0].name, 'Version locale');
  });

  test('9. Paquet illisible : un message explicite est levé', async () => {
    const service = new FavoritesService(new FakeMemento(), new FakeMemento(), undefined, cacheRoot);
    await assert.rejects(() => service.importBundle('texte'), /illisible/);
    await assert.rejects(() => service.importBundle({ version: 1 }), /favorites/);
  });

  test('10. Mises à jour disponibles : seules les versions réellement postérieures sont signalées', async () => {
    const service = new FavoritesService(new FakeMemento(), new FakeMemento(), undefined, cacheRoot);
    await service.add(buildResult({ id: 'a', version: '1.0.0' }));
    await service.add(buildResult({ id: 'b', version: '2.3.1' }));

    const outdated = service.findOutdated(
      new Map([
        ['a', '1.2.0'],
        ['b', '2.3.1'],
      ])
    );

    assert.strictEqual(outdated.length, 1);
    assert.strictEqual(outdated[0].favorite.id, 'a');
    assert.strictEqual(outdated[0].remoteVersion, '1.2.0');
  });

  test('11. Comparaison de versions : les numéros composés sont ordonnés correctement', () => {
    assert.ok(compareVersions('1.2.0', '1.1.9') > 0);
    assert.ok(compareVersions('v2.0.0', '10.0.0') < 0);
    assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0);
    assert.ok(compareVersions('1.0.1', '1.0') > 0);
  });

  test('12. Déploiement local : le manifeste atteint le dossier propre à l\u2019agent', async () => {
    const files = new MemoryFileSystem();
    const service = new MultiTargetDeployService(
      new NasPathService(new FakeConfiguration(), CONNECTED_NAS, {} as NodeJS.ProcessEnv),
      files
    );

    const result = await service.deploy(
      {
        skillId: 'extracteur',
        name: 'Extracteur',
        type: 'skills',
        manifest: MANIFEST,
        target: 'local',
        conflictPolicy: 'prompt',
      },
      { runtime: 'antigravity', workspaceRoot: path.join('/projet'), agentsDirName: '.agents' }
    );

    assert.strictEqual(result.success, true);
    assert.ok(result.targetPath?.includes(path.join('.agents', 'skills', 'extracteur', 'SKILL.md')));
    assert.strictEqual(files.files.get(result.targetPath ?? ''), MANIFEST);
  });

  test("13. Politique « demander » : un conflit suspend le déploiement sans rien écraser", async () => {
    const files = new MemoryFileSystem();
    const existing = path.join('/projet', '.agents', 'skills', 'extracteur', 'SKILL.md');
    files.files.set(existing, 'contenu existant');

    const service = new MultiTargetDeployService(
      new NasPathService(new FakeConfiguration(), CONNECTED_NAS, {} as NodeJS.ProcessEnv),
      files
    );

    const result = await service.deploy(
      {
        skillId: 'extracteur',
        name: 'Extracteur',
        type: 'skills',
        manifest: MANIFEST,
        target: 'local',
        conflictPolicy: 'prompt',
      },
      { runtime: 'antigravity', workspaceRoot: path.join('/projet'), agentsDirName: '.agents' }
    );

    assert.strictEqual(result.success, false);
    assert.match(result.error ?? '', /existe déjà/);
    assert.strictEqual(files.files.get(existing), 'contenu existant', "Le fichier en place est intact.");
  });

  test('14. Politique « écraser » : la version en place est remplacée', async () => {
    const files = new MemoryFileSystem();
    const existing = path.join('/projet', '.agents', 'skills', 'extracteur', 'SKILL.md');
    files.files.set(existing, 'contenu existant');

    const service = new MultiTargetDeployService(
      new NasPathService(new FakeConfiguration(), CONNECTED_NAS, {} as NodeJS.ProcessEnv),
      files
    );

    const result = await service.deploy(
      {
        skillId: 'extracteur',
        name: 'Extracteur',
        type: 'skills',
        manifest: MANIFEST,
        target: 'local',
        conflictPolicy: 'overwrite',
      },
      { runtime: 'antigravity', workspaceRoot: path.join('/projet'), agentsDirName: '.agents' }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(files.files.get(existing), MANIFEST);
  });

  test("15. Politique « incrémenter » : une version voisine est créée sans toucher à l'existant", async () => {
    const files = new MemoryFileSystem();
    const existing = path.join('/projet', '.agents', 'skills', 'extracteur', 'SKILL.md');
    files.files.set(existing, 'contenu existant');

    const service = new MultiTargetDeployService(
      new NasPathService(new FakeConfiguration(), CONNECTED_NAS, {} as NodeJS.ProcessEnv),
      files
    );

    const result = await service.deploy(
      {
        skillId: 'extracteur',
        name: 'Extracteur',
        type: 'skills',
        manifest: MANIFEST,
        target: 'local',
        conflictPolicy: 'increment',
      },
      { runtime: 'antigravity', workspaceRoot: path.join('/projet'), agentsDirName: '.agents' }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.versioned, true);
    assert.ok(result.targetPath?.includes('extracteur-v2'));
    assert.strictEqual(files.files.get(existing), 'contenu existant');
  });

  test("16. Déploiement NAS : le partage joignable reçoit la ressource", async () => {
    const files = new MemoryFileSystem();
    const config = new FakeConfiguration();
    config.user.set('antigravity.skills.nasDirectoryPath', '/mnt/nas/equipe');

    const service = new MultiTargetDeployService(
      new NasPathService(config, CONNECTED_NAS, {} as NodeJS.ProcessEnv),
      files
    );

    const result = await service.deploy(
      {
        skillId: 'extracteur',
        name: 'Extracteur',
        type: 'skills',
        manifest: MANIFEST,
        target: 'nas',
        conflictPolicy: 'overwrite',
      },
      { runtime: 'antigravity', workspaceRoot: path.join('/projet'), agentsDirName: '.agents' }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.target, 'nas');
    assert.strictEqual(result.fellBackToLocal, false, 'Aucun repli ne doit être signalé.');
    assert.ok(result.targetPath?.includes(path.join('skills', 'extracteur')));
  });

  test('17. Partage hors ligne : le déploiement se replie sur le projet local et le signale', async () => {
    const files = new MemoryFileSystem();
    const config = new FakeConfiguration();
    config.user.set('antigravity.skills.nasDirectoryPath', '/mnt/nas/equipe');

    const service = new MultiTargetDeployService(
      new NasPathService(config, OFFLINE_NAS, {} as NodeJS.ProcessEnv),
      files
    );

    const result = await service.deploy(
      {
        skillId: 'extracteur',
        name: 'Extracteur',
        type: 'skills',
        manifest: MANIFEST,
        target: 'nas',
        conflictPolicy: 'overwrite',
      },
      { runtime: 'antigravity', workspaceRoot: path.join('/projet'), agentsDirName: '.agents' }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.fellBackToLocal, true);
    assert.strictEqual(result.target, 'local');
    assert.ok(result.targetPath?.includes('.agents'));
  });

  test("18. Partage hors ligne sans projet ouvert : l'échec est explicite", async () => {
    const config = new FakeConfiguration();
    config.user.set('antigravity.skills.nasDirectoryPath', '/mnt/nas/equipe');

    const service = new MultiTargetDeployService(
      new NasPathService(config, OFFLINE_NAS, {} as NodeJS.ProcessEnv),
      new MemoryFileSystem()
    );

    const result = await service.deploy(
      {
        skillId: 'extracteur',
        name: 'Extracteur',
        type: 'skills',
        manifest: MANIFEST,
        target: 'nas',
        conflictPolicy: 'overwrite',
      },
      { runtime: 'antigravity', workspaceRoot: null, agentsDirName: null }
    );

    assert.strictEqual(result.success, false);
    assert.match(result.error ?? '', /repli local/);
  });

  test("19. Déploiement vers Claude Code : la destination suit l'agent détecté", async () => {
    const files = new MemoryFileSystem();
    const service = new MultiTargetDeployService(
      new NasPathService(new FakeConfiguration(), CONNECTED_NAS, {} as NodeJS.ProcessEnv),
      files
    );

    const result = await service.deploy(
      {
        skillId: 'convention-tests',
        name: 'Convention de tests',
        type: 'rules',
        manifest: MANIFEST,
        target: 'local',
        conflictPolicy: 'overwrite',
      },
      { runtime: 'claude-code', workspaceRoot: path.join('/projet'), agentsDirName: '.agents' }
    );

    assert.strictEqual(result.success, true);
    assert.ok(result.targetPath?.includes(path.join('.claude', 'rules', 'convention-tests.md')));
  });

  test('20. Validation de sécurité : un manifeste hostile ou démesuré est refusé', async () => {
    const files = new MemoryFileSystem();
    const service = new MultiTargetDeployService(
      new NasPathService(new FakeConfiguration(), CONNECTED_NAS, {} as NodeJS.ProcessEnv),
      files
    );

    const hostile = await service.deploy(
      {
        skillId: 'piege',
        name: 'Piège',
        type: 'skills',
        manifest: '# Titre\n<script src="https://exemple.com/charge.js"></script>',
        target: 'local',
        conflictPolicy: 'overwrite',
      },
      { runtime: 'antigravity', workspaceRoot: path.join('/projet'), agentsDirName: '.agents' }
    );

    assert.strictEqual(hostile.success, false);
    assert.match(hostile.error ?? '', /sécurité/);
    assert.strictEqual(files.files.size, 0, 'Rien ne doit être écrit avant validation.');

    const verdict = MultiTargetDeployService.validateManifest('a'.repeat(MAX_MANIFEST_BYTES + 1));
    assert.strictEqual(verdict.safe, false);
    assert.ok(verdict.issues.some((issue) => /taille maximale/.test(issue)));

    assert.strictEqual(MultiTargetDeployService.validateManifest('').safe, false);
    assert.strictEqual(MultiTargetDeployService.validateManifest(MANIFEST).safe, true);
  });

  test("21. Annexes : les chemins relatifs sont écrits, les chemins d'évasion refusés", async () => {
    const files = new MemoryFileSystem();
    const service = new MultiTargetDeployService(
      new NasPathService(new FakeConfiguration(), CONNECTED_NAS, {} as NodeJS.ProcessEnv),
      files
    );

    const valid = await service.deploy(
      {
        skillId: 'avec-annexes',
        name: 'Avec annexes',
        type: 'skills',
        manifest: MANIFEST,
        target: 'local',
        conflictPolicy: 'overwrite',
        assets: [{ relativePath: path.join('references', 'api.md'), content: '# API' }],
      },
      { runtime: 'antigravity', workspaceRoot: path.join('/projet'), agentsDirName: '.agents' }
    );
    assert.strictEqual(valid.success, true);
    assert.strictEqual(files.files.size, 2, 'Le manifeste et son annexe sont écrits.');

    const hostile = await service.deploy(
      {
        skillId: 'evasion',
        name: 'Évasion',
        type: 'skills',
        manifest: MANIFEST,
        target: 'local',
        conflictPolicy: 'overwrite',
        assets: [{ relativePath: '../../.ssh/authorized_keys', content: 'clé' }],
      },
      { runtime: 'antigravity', workspaceRoot: path.join('/projet'), agentsDirName: '.agents' }
    );
    assert.strictEqual(hostile.success, false);
    assert.match(hostile.error ?? '', /sortir du dossier/);
  });

  test("22. Chemins d'annexe : les formes absolues et les remontées sont rejetées", () => {
    assert.strictEqual(validateRelativePath(path.join('scripts', 'build.ps1')), null);
    assert.match(validateRelativePath('') ?? '', /vide/);
    assert.match(validateRelativePath('/etc/passwd') ?? '', /relatif/);
    assert.match(validateRelativePath('C:\\Windows\\system32') ?? '', /relatif/);
    assert.match(validateRelativePath('../ailleurs/fichier.md') ?? '', /sortir du dossier/);
  });

  test('23. Déploiement multiple : chaque cible produit son propre compte rendu', async () => {
    const files = new MemoryFileSystem();
    const config = new FakeConfiguration();
    config.user.set('antigravity.skills.nasDirectoryPath', '/mnt/nas/equipe');

    const service = new MultiTargetDeployService(
      new NasPathService(config, CONNECTED_NAS, {} as NodeJS.ProcessEnv),
      files
    );

    const results = await service.deployToTargets(
      {
        skillId: 'diffusee',
        name: 'Diffusée',
        type: 'skills',
        manifest: MANIFEST,
        conflictPolicy: 'overwrite',
      },
      ['local', 'nas'],
      { runtime: 'antigravity', workspaceRoot: path.join('/projet'), agentsDirName: '.agents' }
    );

    assert.strictEqual(results.length, 2);
    assert.ok(results.every((result) => result.success));
    assert.deepStrictEqual(results.map((result) => result.target), ['local', 'nas']);
  });

  test('24. Événements de déploiement : le début et la fin sont publiés sur le médiateur', async () => {
    const bus = new ExtensionEventBus();
    const topics: string[] = [];
    bus.subscribe('skill:deploy:started', (envelope) => { topics.push(envelope.topic); });
    bus.subscribe('skill:deploy:completed', (envelope) => {
      topics.push(`${envelope.topic}:${envelope.payload.success}`);
    });

    const service = new MultiTargetDeployService(
      new NasPathService(new FakeConfiguration(), CONNECTED_NAS, {} as NodeJS.ProcessEnv),
      new MemoryFileSystem(),
      bus
    );

    await service.deploy(
      {
        skillId: 'suivie',
        name: 'Suivie',
        type: 'skills',
        manifest: MANIFEST,
        target: 'local',
        conflictPolicy: 'overwrite',
      },
      { runtime: 'antigravity', workspaceRoot: path.join('/projet'), agentsDirName: '.agents' }
    );

    assert.deepStrictEqual(topics, ['skill:deploy:started', 'skill:deploy:completed:true']);
    bus.dispose();
  });

  test("25. Projet absent : un déploiement local échoue avec un message compréhensible", async () => {
    const service = new MultiTargetDeployService(
      new NasPathService(new FakeConfiguration(), CONNECTED_NAS, {} as NodeJS.ProcessEnv),
      new MemoryFileSystem()
    );

    const result = await service.deploy(
      {
        skillId: 'orpheline',
        name: 'Orpheline',
        type: 'skills',
        manifest: MANIFEST,
        target: 'local',
        conflictPolicy: 'overwrite',
      },
      { runtime: 'antigravity', workspaceRoot: null, agentsDirName: null }
    );

    assert.strictEqual(result.success, false);
    assert.match(result.error ?? '', /espace de travail/);
  });
});
