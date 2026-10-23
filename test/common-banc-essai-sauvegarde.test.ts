import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';
import { BancEssaiRefus, OptionsBanc, ScenarioManager } from '../src/services/ScenarioManager';
import { ecrireSur, empreinte, listerFichiers } from '../src/services/bancEssaiFichiers';

// Lot L2b : le banc d'essai sauvegarde les vrais fichiers qu'il remplace, puis les restaure.
// Chaque test travaille dans un espace et un profil personnel temporaires : jamais le vrai ~/.gemini.
describe('Suite de Tests : sauvegarde et restauration du banc d\'essai (L2b)', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const DATE = new Date('2026-01-02T03:04:05.000Z');
  const DOUBLON = '~/.gemini/config/rules/rule-test-doublon.md';
  let tempBaseDir: string;
  let compteur = 0;

  interface Espace {
    ws: string;
    home: string;
    opts: OptionsBanc;
  }

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'banc-essai-l2b-'));
  });

  after(async () => {
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  async function creerEspace(): Promise<Espace> {
    const base = path.join(tempBaseDir, `cas-${++compteur}`);
    const ws = path.join(base, 'projet');
    const home = path.join(base, 'home');
    await fs.promises.mkdir(home, { recursive: true });
    for (const outil of ['antigravity', 'claude-code']) {
      await fs.promises.cp(path.join(repoRoot, 'test', 'scenarios', outil), path.join(ws, 'test', 'scenarios', outil), {
        recursive: true,
      });
    }
    return { ws, home, opts: { dossierPersonnel: home, profilGlobal: path.join(home, '.gemini', 'config') } };
  }

  /** Écrit un vrai fichier (racine, ou « ~/… » dans le profil) avec une date fixe. */
  function ecrire(espace: Espace, chemin: string, contenu: string | Buffer): string {
    const absolu = chemin.startsWith('~/')
      ? path.join(espace.home, ...chemin.slice(2).split('/'))
      : path.join(espace.ws, ...chemin.split('/'));
    fs.mkdirSync(path.dirname(absolu), { recursive: true });
    fs.writeFileSync(absolu, contenu);
    fs.utimesSync(absolu, DATE, DATE);
    return absolu;
  }

  const source = (outil: string, rel: string) => fs.readFileSync(path.join(repoRoot, 'test', 'scenarios', outil, ...rel.split('/')));

  /**
   * Empreinte de chaque fichier de l'espace (hors sources) et du profil personnel.
   * Exception unique : sous node --test, un pilote de filtrage d'un antivirus du poste crée et
   * supprime aussitôt ce fichier à la racine quand le manifeste change (cause déduite, notre code
   * ne crée jamais ce nom). Tout autre fichier qui disparaît entre le listage et la lecture fait
   * échouer le test.
   */
  const PASSAGER_ANTIVIRUS = '.SCENARIO-MANIFEST.JSON.tmp';
  function instantane(espace: Espace): Record<string, string> {
    const resultat: Record<string, string> = {};
    for (const rel of listerFichiers(espace.ws).filter((r) => !r.startsWith('test/') && r !== PASSAGER_ANTIVIRUS)) {
      resultat[rel] = empreinte(fs.readFileSync(path.join(espace.ws, rel))).sha256;
    }
    for (const rel of listerFichiers(espace.home)) {
      resultat[`~/${rel}`] = empreinte(fs.readFileSync(path.join(espace.home, rel))).sha256;
    }
    return resultat;
  }

  /**
   * Formes refusées pour un chemin de l'index ou du manifeste : remontée, segment « . » ou vide,
   * chemin absolu, lettre de lecteur, UNC, flux NTFS, et variantes que Windows ramènerait à une
   * fixture (point ou espace final). Seule l'appartenance exacte à l'ensemble des fixtures compte.
   */
  const FORMES_INTERDITES = (espace: Espace) => [
    '',
    '../CLAUDE.md',
    '.agents/../CLAUDE.md',
    '.agents/../../CLAUDE.md',
    './CLAUDE.md',
    '.agents//hooks.json',
    '/CLAUDE.md',
    'C:/CLAUDE.md',
    'C:\\CLAUDE.md',
    'C:CLAUDE.md',
    '\\\\serveur\\partage\\CLAUDE.md',
    '//serveur/partage/CLAUDE.md',
    '.agents\\hooks.json',
    'CLAUDE.md:flux',
    'CLAUDE.md.',
    'CLAUDE.md ',
    '~/../CLAUDE.md',
    '~/.gemini/config/rules/../../../CLAUDE.md',
    path.join(espace.ws, 'CLAUDE.md'),
    path.join(espace.ws, 'CLAUDE.md').replace(/\\/g, '/'),
  ];

  const lireJson = (fichier: string) => JSON.parse(fs.readFileSync(fichier, 'utf8'));
  const sauvegarde = (espace: Espace, ...rel: string[]) => path.join(espace.ws, '.banc-essai-sauvegarde', ...rel);
  const refus = (motif: string) => (err: unknown) => err instanceof BancEssaiRefus && err.motif === motif;

  // Sept vrais fichiers aux chemins de fixture, dont les cinq canoniques et la règle du profil global
  const ORIGINAUX: Record<string, string> = {
    'CLAUDE.md': '# Vrai CLAUDE.md\r\nÉté, façade, cœur.\r\n',
    '.mcp.json': '{ "mcpServers": {} }\n',
    '.agents/hooks.json': '{ "hooks": [] }\n',
    '.agents/mcp_config.json': '{ "mcpServers": { "vrai": {} } }\n',
    'GEMINI.md': '# Vrai GEMINI.md sans marqueur\n',
    '.agents/rules/02-rule-perm-standard-always-on.md': '---\ntrigger: always_on\n---\n# Vraie règle 02\n',
    [DOUBLON]: '# Vraie règle globale du même nom\n',
  };
  const poserOriginaux = (espace: Espace) => Object.entries(ORIGINAUX).forEach(([chemin, contenu]) => ecrire(espace, chemin, contenu));

  test('1. Une sauvegarde puis une restauration redonnent les fichiers à l\'identique', async () => {
    const espace = await creerEspace();
    poserOriginaux(espace);
    const identique = '.claude/rules/03-rule-claude-cond-paths-list.md';
    ecrire(espace, identique, source('claude-code', identique));
    const avant = instantane(espace);

    const rapport = await ScenarioManager.deploy(espace.ws, 'all', espace.opts);
    assert.deepStrictEqual([...rapport.aSauvegarder].sort(), Object.keys(ORIGINAUX).sort());
    assert.deepStrictEqual(rapport.identiques, [identique], 'Le fichier identique à sa fixture est listé, sans sauvegarde');

    // Noms de la sauvegarde : ni .agents ni .claude, suffixe .sauvegarde
    for (const copie of ['racine/CLAUDE.md.sauvegarde', 'racine/_agents/hooks.json.sauvegarde', 'racine/_agents/rules/02-rule-perm-standard-always-on.md.sauvegarde', 'profil-global/rules/rule-test-doublon.md.sauvegarde']) {
      assert.ok(fs.existsSync(sauvegarde(espace, ...copie.split('/'))), copie);
    }
    assert.ok(listerFichiers(sauvegarde(espace)).every((rel) => !/(^|\/)\.(agents|claude)\//.test(rel)));

    // Index : chemins relatifs ou « ~/… », empreinte, taille et date ; aucun chemin absolu
    const indexBrut = fs.readFileSync(sauvegarde(espace, 'index.json'), 'utf8');
    const manifesteBrut = fs.readFileSync(path.join(espace.ws, ScenarioManager.MANIFEST_FILE), 'utf8');
    for (const brut of [indexBrut, manifesteBrut]) {
      assert.ok(!brut.includes(path.basename(tempBaseDir)), 'Aucun chemin absolu dans l\'index ni dans le manifeste');
      assert.ok(!brut.includes(JSON.stringify(os.homedir()).slice(1, -1)));
    }
    const index = JSON.parse(indexBrut);
    assert.strictEqual(index.fichiers.length, 7);
    for (const entree of index.fichiers) {
      const attendu = Buffer.from(ORIGINAUX[entree.chemin], 'utf8');
      assert.deepStrictEqual({ sha256: entree.sha256, taille: entree.taille }, empreinte(attendu), entree.chemin);
      assert.strictEqual(entree.date, DATE.toISOString());
    }
    const manifeste = JSON.parse(manifesteBrut);
    assert.strictEqual(manifeste.etat, 'deploye');
    assert.strictEqual(manifeste.profilGlobal, '~/.gemini/config');
    assert.ok(fs.readFileSync(path.join(espace.ws, 'CLAUDE.md')).equals(source('claude-code', 'CLAUDE.md')), 'La fixture est en place');
    assert.strictEqual(ScenarioManager.lireEtat(espace.ws, espace.opts).niveau, 'actif');

    const vidage = await ScenarioManager.clean(espace.ws, espace.opts);
    assert.deepStrictEqual([...vidage.restaures].sort(), Object.keys(ORIGINAUX).sort());
    const { [identique]: _supprime, ...attendu } = avant;
    assert.deepStrictEqual(instantane(espace), attendu, 'Originaux à l\'identique ; le fichier identique à sa fixture est parti');
    for (const chemin of Object.keys(ORIGINAUX).filter((c) => !c.startsWith('~/'))) {
      assert.strictEqual(Math.floor(fs.statSync(path.join(espace.ws, chemin)).mtimeMs), DATE.getTime(), `Date de ${chemin}`);
    }
    assert.ok(!fs.existsSync(sauvegarde(espace)));
    assert.ok(!fs.existsSync(path.join(espace.ws, ScenarioManager.MANIFEST_FILE)));
    assert.strictEqual(ScenarioManager.lireEtat(espace.ws, espace.opts).niveau, 'aucun');
  });

  test('2a. Interruption pendant la copie, puis pendant le retour arrière : un vidage reprend', async () => {
    const espace = await creerEspace();
    poserOriginaux(espace);
    const avant = instantane(espace);

    await assert.rejects(
      ScenarioManager.deploy(espace.ws, 'all', {
        ...espace.opts,
        panne: (etape, chemin) => {
          if (etape === 'copie' && chemin === 'CLAUDE.md') throw new Error('panne simulée de la copie');
          if (etape === 'restauration') throw new Error('panne simulée du retour arrière');
        },
      }),
      /Le retour arrière a échoué/
    );
    assert.strictEqual(ScenarioManager.lireEtat(espace.ws, espace.opts).niveau, 'interrompu');

    await ScenarioManager.clean(espace.ws, espace.opts);
    assert.deepStrictEqual(instantane(espace), avant);
    assert.strictEqual(ScenarioManager.lireEtat(espace.ws, espace.opts).niveau, 'aucun');
  });

  test('2b. Un échec de la copie seul est annulé aussitôt', async () => {
    const espace = await creerEspace();
    poserOriginaux(espace);
    const avant = instantane(espace);
    await assert.rejects(
      ScenarioManager.deploy(espace.ws, 'all', {
        ...espace.opts,
        panne: (etape, chemin) => {
          if (etape === 'copie' && chemin === 'CLAUDE.md') throw new Error('panne simulée');
        },
      }),
      /annulé/
    );
    assert.deepStrictEqual(instantane(espace), avant);
    assert.strictEqual(ScenarioManager.lireEtat(espace.ws, espace.opts).niveau, 'aucun');
  });

  test('2c. Interruption pendant la restauration, puis reprise ; un nouveau vidage ne fait plus rien', async () => {
    for (const etapeEnPanne of ['restauration', 'suppression', 'nettoyage'] as const) {
      const espace = await creerEspace();
      poserOriginaux(espace);
      const avant = instantane(espace);
      await ScenarioManager.deploy(espace.ws, 'all', espace.opts);

      let appels = 0;
      await assert.rejects(
        ScenarioManager.clean(espace.ws, {
          ...espace.opts,
          panne: (etape) => {
            if (etape === etapeEnPanne && ++appels === 2) throw new Error('panne simulée');
            if (etape === 'nettoyage' && etapeEnPanne === 'nettoyage') throw new Error('panne simulée');
          },
        }),
        /panne simulée/,
        etapeEnPanne
      );
      const etat = ScenarioManager.lireEtat(espace.ws, espace.opts);
      assert.strictEqual(etat.niveau, 'interrompu', etapeEnPanne);
      assert.strictEqual(etat.etat, 'restauration-en-cours');

      await ScenarioManager.clean(espace.ws, espace.opts);
      assert.deepStrictEqual(instantane(espace), avant, etapeEnPanne);
      // Idempotent : plus rien à supprimer ni à restaurer ; les originaux sont seulement signalés
      const encore = await ScenarioManager.clean(espace.ws, espace.opts);
      assert.deepStrictEqual([encore.supprimes, encore.restaures, encore.ecrases], [[], [], []], 'Le vidage est idempotent');
      assert.deepStrictEqual([...encore.signales].sort(), Object.keys(ORIGINAUX).sort());
    }
  });

  test('3. Une fixture modifiée pendant le test, avec et sans original, n\'est écrasée qu\'avec « ecraser »', async () => {
    const espace = await creerEspace();
    ecrire(espace, 'CLAUDE.md', ORIGINAUX['CLAUDE.md']);
    await ScenarioManager.deploy(espace.ws, 'claude-code', espace.opts);
    const sansOriginal = '.claude/rules/01-rule-claude-perm-standard.md';
    fs.appendFileSync(path.join(espace.ws, 'CLAUDE.md'), '\nModifié.\n');
    fs.appendFileSync(path.join(espace.ws, sansOriginal), '\nModifié.\n');
    const pendant = instantane(espace);

    assert.deepStrictEqual(ScenarioManager.planifierVidage(espace.ws, espace.opts).modifiees.sort(), [sansOriginal, 'CLAUDE.md'].sort());
    await assert.rejects(ScenarioManager.clean(espace.ws, espace.opts), (err: unknown) => {
      assert.ok(refus('fixtures-modifiees')(err));
      assert.deepStrictEqual([...(err as BancEssaiRefus).chemins].sort(), [sansOriginal, 'CLAUDE.md'].sort());
      return true;
    });
    assert.deepStrictEqual(instantane(espace), pendant, 'Le refus ne modifie rien');

    const vidage = await ScenarioManager.clean(espace.ws, { ...espace.opts, ecraser: true });
    assert.deepStrictEqual(vidage.ecrases.sort(), [sansOriginal, 'CLAUDE.md'].sort());
    assert.strictEqual(fs.readFileSync(path.join(espace.ws, 'CLAUDE.md'), 'utf8'), ORIGINAUX['CLAUDE.md']);
    assert.ok(!fs.existsSync(path.join(espace.ws, sansOriginal)));
    assert.strictEqual(ScenarioManager.lireEtat(espace.ws, espace.opts).niveau, 'aucun');
  });

  test('3b. « remplacer » ne vaut jamais accord pour écraser une fixture modifiée', async () => {
    const espace = await creerEspace();
    ecrire(espace, 'CLAUDE.md', ORIGINAUX['CLAUDE.md']);
    await ScenarioManager.deploy(espace.ws, 'claude-code', espace.opts);
    fs.appendFileSync(path.join(espace.ws, 'CLAUDE.md'), '\nModifié.\n');
    const pendant = instantane(espace);

    await assert.rejects(ScenarioManager.deploy(espace.ws, 'all', { ...espace.opts, remplacer: true }), (err: unknown) => {
      assert.ok(refus('fixtures-modifiees')(err));
      assert.deepStrictEqual((err as BancEssaiRefus).chemins, ['CLAUDE.md']);
      return true;
    });
    assert.deepStrictEqual(instantane(espace), pendant, 'Rien n\'a été vidé ni redéployé');
    await ScenarioManager.clean(espace.ws, { ...espace.opts, ecraser: true });
  });

  test('4. Un échec de la sauvegarde, de l\'index ou du journal ne modifie rien', async () => {
    for (const etapeEnPanne of ['sauvegarde', 'index', 'journal'] as const) {
      const espace = await creerEspace();
      poserOriginaux(espace);
      const avant = instantane(espace);
      let appels = 0;
      await assert.rejects(
        ScenarioManager.deploy(espace.ws, 'all', {
          ...espace.opts,
          panne: (etape) => {
            if (etape === etapeEnPanne && ++appels === (etapeEnPanne === 'sauvegarde' ? 2 : 1)) throw new Error('panne simulée');
          },
        }),
        /panne simulée/
      );
      assert.deepStrictEqual(instantane(espace), avant, etapeEnPanne);
      assert.ok(!fs.existsSync(sauvegarde(espace)), `Pas de sauvegarde après une panne de ${etapeEnPanne}`);
      assert.ok(!fs.existsSync(path.join(espace.ws, ScenarioManager.MANIFEST_FILE)));
    }
  });

  test('5. Les fichiers non concernés ne subissent aucune régression', async () => {
    const espace = await creerEspace();
    const nonConcernes: Record<string, string> = {
      '.agents/rules/projet-consignes.md': '---\ntrigger: always_on\n---\n# Consignes\n',
      '.agents/skills.json': '{ "exclude": ["skill-x"] }\n',
      '.agents/hooks.json.bak': '{}\n',
      '.claude/skills/security-audit/SKILL.md': '# Audit\n',
      // Un vrai fichier sur une variante de bascule, différent de la fixture
      '.agents/rules/03-rule-cond-trigger-glob.md.disabled': '# Vraie règle désactivée\n',
      'AGENTS.md': '---\nscenario_fixture: true\n---\n# Marqueur sans fixture\n',
    };
    Object.entries(nonConcernes).forEach(([chemin, contenu]) => ecrire(espace, chemin, contenu));
    fs.mkdirSync(path.join(espace.ws, '.agents', 'dossier-vide-utilisateur'), { recursive: true });
    const avant = instantane(espace);

    await ScenarioManager.deploy(espace.ws, 'all', espace.opts);
    await ScenarioManager.clean(espace.ws, espace.opts);
    assert.deepStrictEqual(instantane(espace), avant);
    assert.ok(fs.existsSync(path.join(espace.ws, '.agents', 'dossier-vide-utilisateur')), 'Un dossier vide de l\'utilisateur est conservé');
    assert.ok(!fs.existsSync(path.join(espace.ws, '.agents', 'plugins')), 'Les dossiers créés par le déploiement sont retirés');
  });

  test('6. Sans manifeste : seules les copies identiques aux sources partent (fins de ligne normalisées)', async () => {
    const espace = await creerEspace();
    ecrire(espace, 'GEMINI.md', source('antigravity', 'GEMINI.md').toString('utf8').replace(/\n/g, '\r\n'));
    ecrire(espace, 'CLAUDE.md', ORIGINAUX['CLAUDE.md']);
    ecrire(espace, '.mcp.json', ORIGINAUX['.mcp.json']);

    const rapport = await ScenarioManager.clean(espace.ws, espace.opts);
    assert.deepStrictEqual(rapport.supprimes, ['GEMINI.md']);
    assert.deepStrictEqual([...rapport.signales].sort(), ['.mcp.json', 'CLAUDE.md']);
    assert.ok(fs.existsSync(path.join(espace.ws, 'CLAUDE.md')), 'Un vrai CLAUDE.md n\'est plus supprimé par test:clean');
  });

  test('7. Manifeste absent mais sauvegarde présente, et sauvegarde sans index', async () => {
    const espace = await creerEspace();
    ecrire(espace, 'CLAUDE.md', ORIGINAUX['CLAUDE.md']);
    await ScenarioManager.deploy(espace.ws, 'claude-code', espace.opts);
    fs.rmSync(path.join(espace.ws, ScenarioManager.MANIFEST_FILE));
    assert.strictEqual(ScenarioManager.lireEtat(espace.ws, espace.opts).niveau, 'interrompu');
    const vidage = await ScenarioManager.clean(espace.ws, espace.opts);
    assert.deepStrictEqual(vidage.restaures, ['CLAUDE.md']);
    assert.strictEqual(fs.readFileSync(path.join(espace.ws, 'CLAUDE.md'), 'utf8'), ORIGINAUX['CLAUDE.md']);

    // Sauvegarde sans index (arrêt pendant la copie des originaux) : retirée si les originaux sont intacts
    ecrire(espace, '.banc-essai-sauvegarde/racine/CLAUDE.md.sauvegarde', ORIGINAUX['CLAUDE.md']);
    await ScenarioManager.clean(espace.ws, espace.opts);
    assert.ok(!fs.existsSync(sauvegarde(espace)));

    // Sinon : refus, et rien n'est modifié
    ecrire(espace, '.banc-essai-sauvegarde/racine/CLAUDE.md.sauvegarde', '# Autre contenu\n');
    const avant = instantane(espace);
    await assert.rejects(ScenarioManager.clean(espace.ws, espace.opts), refus('sauvegarde-invalide'));
    assert.deepStrictEqual(instantane(espace), avant);
  });

  test('8. Un banc actif est refusé ; « remplacer » restaure avant de redéployer, sans jamais sauvegarder une fixture', async () => {
    const espace = await creerEspace();
    ecrire(espace, 'CLAUDE.md', ORIGINAUX['CLAUDE.md']);
    await ScenarioManager.deploy(espace.ws, 'antigravity', espace.opts);
    await ScenarioManager.deploy(espace.ws, 'claude-code', { ...espace.opts, remplacer: true });

    const avant = instantane(espace);
    assert.throws(() => ScenarioManager.planifierDeploiement(espace.ws, 'all', espace.opts), refus('banc-actif'));
    await assert.rejects(ScenarioManager.deploy(espace.ws, 'all', espace.opts), refus('banc-actif'));
    assert.deepStrictEqual(instantane(espace), avant);

    const rapport = await ScenarioManager.deploy(espace.ws, 'all', { ...espace.opts, remplacer: true });
    assert.deepStrictEqual(rapport.vidage?.restaures, ['CLAUDE.md']);
    assert.strictEqual(fs.readFileSync(sauvegarde(espace, 'racine', 'CLAUDE.md.sauvegarde'), 'utf8'), ORIGINAUX['CLAUDE.md'], 'La sauvegarde garde le vrai original');
    await ScenarioManager.clean(espace.ws, espace.opts);
    assert.strictEqual(fs.readFileSync(path.join(espace.ws, 'CLAUDE.md'), 'utf8'), ORIGINAUX['CLAUDE.md']);
  });

  test('9. Une fixture basculée en .disabled pendant le test est retirée', async () => {
    const espace = await creerEspace();
    await ScenarioManager.deploy(espace.ws, 'antigravity', espace.opts);
    const fixture = path.join(espace.ws, '.agents', 'rules', '02-rule-perm-standard-always-on.md');
    fs.renameSync(fixture, `${fixture}.disabled`);
    const skill = path.join(espace.ws, '.agents', 'skills', 'skill-standard', 'SKILL.md');
    fs.renameSync(skill, `${skill}.disabled`);

    const vidage = await ScenarioManager.clean(espace.ws, espace.opts);
    assert.ok(vidage.supprimes.includes('.agents/rules/02-rule-perm-standard-always-on.md.disabled'));
    assert.ok(!fs.existsSync(`${fixture}.disabled`));
    assert.ok(!fs.existsSync(`${skill}.disabled`));
  });

  test('10. Une copie corrompue ou absente de la sauvegarde provoque un refus sans aucune modification', async () => {
    for (const alteration of ['corrompue', 'absente'] as const) {
      const espace = await creerEspace();
      ecrire(espace, 'CLAUDE.md', ORIGINAUX['CLAUDE.md']);
      await ScenarioManager.deploy(espace.ws, 'claude-code', espace.opts);
      const copie = sauvegarde(espace, 'racine', 'CLAUDE.md.sauvegarde');
      if (alteration === 'corrompue') fs.appendFileSync(copie, 'x');
      else fs.rmSync(copie);
      const avant = instantane(espace);
      await assert.rejects(ScenarioManager.clean(espace.ws, espace.opts), refus('sauvegarde-invalide'));
      assert.deepStrictEqual(instantane(espace), avant, alteration);
    }
  });

  test('11. Une destination en lecture seule ou en lien symbolique est refusée avant toute écriture', async (t) => {
    const espace = await creerEspace();
    const claudeMd = ecrire(espace, 'CLAUDE.md', ORIGINAUX['CLAUDE.md']);
    fs.chmodSync(claudeMd, 0o444);
    try {
      const avant = instantane(espace);
      await assert.rejects(ScenarioManager.deploy(espace.ws, 'claude-code', espace.opts), (err: unknown) => {
        assert.ok(refus('destination-invalide')(err));
        assert.deepStrictEqual((err as BancEssaiRefus).chemins, ['CLAUDE.md (lecture seule)']);
        return true;
      });
      assert.deepStrictEqual(instantane(espace), avant);
      assert.ok(!fs.existsSync(sauvegarde(espace)));
    } finally {
      fs.chmodSync(claudeMd, 0o644);
    }

    const cible = ecrire(espace, 'ailleurs.md', '# Cible du lien\n');
    try {
      fs.symlinkSync(cible, path.join(espace.ws, 'GEMINI.md'), 'file');
    } catch {
      t.skip('Création de lien symbolique refusée par le système');
      return;
    }
    await assert.rejects(ScenarioManager.deploy(espace.ws, 'antigravity', espace.opts), refus('destination-invalide'));
  });

  test('12. Un profil global hors du dossier personnel : le doublon global n\'est pas déployé', async () => {
    const espace = await creerEspace();
    const ailleurs = path.join(path.dirname(espace.ws), 'profil-ailleurs');
    const rapport = await ScenarioManager.deploy(espace.ws, 'all', { ...espace.opts, profilGlobal: ailleurs });
    assert.strictEqual(rapport.avertissements.length, 1);
    assert.match(rapport.avertissements[0], /n'y est pas déployée/);
    assert.ok(!fs.existsSync(path.join(ailleurs, 'rules')));
    assert.strictEqual(lireJson(path.join(espace.ws, ScenarioManager.MANIFEST_FILE)).profilGlobal, null);
    await ScenarioManager.clean(espace.ws, { ...espace.opts, profilGlobal: ailleurs });
  });

  test('13. Écriture sûre : reprise après un verrou passager, échec propre sans fichier temporaire', async () => {
    const dossier = path.join(tempBaseDir, 'ecriture-sure');
    const temp = path.join(dossier, '.tmp');
    const destination = path.join(dossier, 'fichier.txt');
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(destination, 'avant');
    const occupe = () => Object.assign(new Error('EBUSY simulé'), { code: 'EBUSY' });

    let echecs = 0;
    await ecrireSur(destination, Buffer.from('après'), {
      dossierTemp: temp,
      attenteMs: 1,
      renommer: async (de, vers) => {
        if (++echecs <= 2) throw occupe();
        await fs.promises.rename(de, vers);
      },
    });
    assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'après');

    await assert.rejects(
      ecrireSur(destination, Buffer.from('jamais'), {
        dossierTemp: temp,
        attenteMs: 1,
        tentatives: 3,
        renommer: async () => {
          throw occupe();
        },
      }),
      /EBUSY/
    );
    assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'après', 'La destination est intacte');
    assert.deepStrictEqual(fs.readdirSync(temp), [], 'Aucun fichier temporaire ne reste');
  });

  test('14. lireEtat distingue un banc absent, actif et interrompu', async () => {
    const espace = await creerEspace();
    const manifeste = path.join(espace.ws, ScenarioManager.MANIFEST_FILE);
    assert.strictEqual(ScenarioManager.lireEtat(espace.ws, espace.opts).niveau, 'aucun');

    await ScenarioManager.deploy(espace.ws, 'antigravity', espace.opts);
    const etat = ScenarioManager.lireEtat(espace.ws, espace.opts);
    assert.deepStrictEqual([etat.niveau, etat.etat, etat.cible, etat.nbOriginaux], ['actif', 'deploye', 'antigravity', 0]);

    for (const etatJournal of ['deploiement-en-cours', 'restauration-en-cours']) {
      fs.writeFileSync(manifeste, JSON.stringify({ ...lireJson(manifeste), etat: etatJournal }));
      assert.strictEqual(ScenarioManager.lireEtat(espace.ws, espace.opts).niveau, 'interrompu', etatJournal);
    }
    fs.writeFileSync(manifeste, '{ illisible');
    assert.deepStrictEqual(
      [ScenarioManager.lireEtat(espace.ws, espace.opts).niveau, ScenarioManager.lireEtat(espace.ws, espace.opts).manifeste],
      ['interrompu', 'illisible']
    );
    fs.rmSync(manifeste);
    assert.strictEqual(ScenarioManager.lireEtat(espace.ws, espace.opts).niveau, 'interrompu', 'Sauvegarde sans manifeste');
  });

  test('15. Un manifeste antérieur à L2b (liste de chemins) est lu sans empreintes', async () => {
    const espace = await creerEspace();
    const regle = '.agents/rules/02-rule-perm-standard-always-on.md';
    ecrire(espace, regle, source('antigravity', regle));
    ecrire(espace, '.agents/rules/inconnue.md', '# Listée par l\'ancien manifeste, sans fixture\n');
    ecrire(espace, ScenarioManager.MANIFEST_FILE, JSON.stringify({ target: 'antigravity', files: [regle, '.agents/rules/inconnue.md'] }));
    assert.deepStrictEqual(
      [ScenarioManager.lireEtat(espace.ws, espace.opts).niveau, ScenarioManager.lireEtat(espace.ws, espace.opts).manifeste],
      ['actif', 'herite']
    );
    const vidage = await ScenarioManager.clean(espace.ws, espace.opts);
    assert.deepStrictEqual(vidage.supprimes, [regle]);
    assert.deepStrictEqual(vidage.signales, ['.agents/rules/inconnue.md']);
    assert.ok(fs.existsSync(path.join(espace.ws, '.agents', 'rules', 'inconnue.md')));
  });

  test('16. Une sauvegarde fournie par le dépôt n\'écrit rien dans le profil global sans accord', async () => {
    const espace = await creerEspace();
    const contenu = Buffer.from('# Consigne injectée par le dépôt\n', 'utf8');
    ecrire(espace, '.banc-essai-sauvegarde/profil-global/rules/rule-test-doublon.md.sauvegarde', contenu);
    const index = (chemin: string, copie: string) =>
      JSON.stringify({ version: 1, creeLe: DATE.toISOString(), fichiers: [{ chemin, copie, ...empreinte(contenu), date: DATE.toISOString() }] });
    const regleGlobale = path.join(espace.home, '.gemini', 'config', 'rules', 'rule-test-doublon.md');

    // Fichier absent du profil : la restauration exige l'accord explicite (« Écraser et restaurer »)
    ecrire(espace, '.banc-essai-sauvegarde/index.json', index(DOUBLON, 'profil-global/rules/rule-test-doublon.md.sauvegarde'));
    await assert.rejects(ScenarioManager.clean(espace.ws, espace.opts), (err: unknown) => {
      assert.ok(refus('fixtures-modifiees')(err));
      assert.deepStrictEqual((err as BancEssaiRefus).chemins, [DOUBLON]);
      return true;
    });
    assert.ok(!fs.existsSync(regleGlobale));

    // Un index qui vise un autre fichier qu'une fixture est refusé
    for (const cible of ['~/.claude/CLAUDE.md', '.agents/rules/injectee.md']) {
      ecrire(espace, '.banc-essai-sauvegarde/index.json', index(cible, 'profil-global/rules/rule-test-doublon.md.sauvegarde'));
      await assert.rejects(ScenarioManager.clean(espace.ws, espace.opts), refus('sauvegarde-invalide'), cible);
      assert.ok(!fs.existsSync(path.join(espace.home, '.claude')));
      assert.ok(!fs.existsSync(path.join(espace.ws, '.agents', 'rules', 'injectee.md')));
    }

    // Appartenance exacte : toute autre forme d'un chemin, même résolue vers une fixture, est refusée
    const parent = path.dirname(espace.ws);
    for (const forme of FORMES_INTERDITES(espace)) {
      ecrire(espace, '.banc-essai-sauvegarde/index.json', index(forme, 'profil-global/rules/rule-test-doublon.md.sauvegarde'));
      await assert.rejects(ScenarioManager.clean(espace.ws, espace.opts), refus('sauvegarde-invalide'), `chemin ${JSON.stringify(forme)}`);
    }
    for (const copie of ['../../../CLAUDE.md.sauvegarde', 'racine/../../CLAUDE.md.sauvegarde', path.join(parent, 'CLAUDE.md.sauvegarde'), '_agents/hooks.json.sauvegarde']) {
      ecrire(espace, '.banc-essai-sauvegarde/index.json', index('CLAUDE.md', copie));
      await assert.rejects(ScenarioManager.clean(espace.ws, espace.opts), refus('sauvegarde-invalide'), `copie ${JSON.stringify(copie)}`);
    }
    assert.ok(!fs.existsSync(path.join(espace.ws, 'CLAUDE.md')), 'Rien n\'est écrit à la racine');
    assert.ok(!fs.existsSync(path.join(parent, 'CLAUDE.md')), 'Rien n\'est écrit hors de la racine');
    assert.ok(!fs.existsSync(regleGlobale), 'Rien n\'est écrit dans le profil global');
  });

  test('17. Un manifeste qui cite un fichier hors des fixtures ne le fait pas supprimer', async () => {
    const espace = await creerEspace();
    const vrai = ecrire(espace, 'src/precieux.ts', 'export const x = 1;\n');
    ecrire(
      espace,
      ScenarioManager.MANIFEST_FILE,
      JSON.stringify({
        version: 2,
        etat: 'deploye',
        cible: 'all',
        debut: DATE.toISOString(),
        maj: DATE.toISOString(),
        profilGlobal: null,
        fixtures: [{ chemin: 'src/precieux.ts', ...empreinte(fs.readFileSync(vrai)), original: false }],
        dossiersCrees: [],
      })
    );
    const vidage = await ScenarioManager.clean(espace.ws, espace.opts);
    assert.ok(fs.existsSync(vrai));
    assert.deepStrictEqual(vidage.signales, ['src/precieux.ts']);

    // Formes interdites : le manifeste entier est illisible ; « CLAUDE.md. » et « CLAUDE.md », de forme
    // valide, sont écartés par l'appartenance exacte. Aucun des fichiers visés n'est supprimé.
    const horsRacine = path.join(path.dirname(espace.ws), 'CLAUDE.md');
    const contenuVise = '# Visé par un faux manifeste\n';
    fs.writeFileSync(horsRacine, contenuVise);
    const dansRacine = ecrire(espace, 'CLAUDE.md', contenuVise);
    const manifeste = (fixtures: object[], extra: object = {}) =>
      JSON.stringify({ version: 2, etat: 'deploye', cible: 'all', debut: DATE.toISOString(), maj: DATE.toISOString(), profilGlobal: null, fixtures, dossiersCrees: [], ...extra });
    for (const forme of FORMES_INTERDITES(espace)) {
      ecrire(espace, ScenarioManager.MANIFEST_FILE, manifeste([{ chemin: forme, ...empreinte(Buffer.from(contenuVise)), original: false }]));
      const attendu = ['CLAUDE.md.', 'CLAUDE.md '].includes(forme) ? 'v2' : 'illisible';
      assert.strictEqual(ScenarioManager.lireEtat(espace.ws, espace.opts).manifeste, attendu, `chemin ${JSON.stringify(forme)}`);
      const rapportForme = await ScenarioManager.clean(espace.ws, espace.opts);
      assert.deepStrictEqual(rapportForme.supprimes, [], `chemin ${JSON.stringify(forme)}`);
      assert.ok(fs.existsSync(horsRacine) && fs.existsSync(dansRacine), `chemin ${JSON.stringify(forme)}`);
    }
    fs.rmSync(dansRacine);
    for (const dossier of ['../projet', 'src/../..', path.dirname(espace.ws)]) {
      ecrire(espace, ScenarioManager.MANIFEST_FILE, manifeste([], { dossiersCrees: [dossier] }));
      assert.strictEqual(ScenarioManager.lireEtat(espace.ws, espace.opts).manifeste, 'illisible', `dossier ${JSON.stringify(dossier)}`);
    }

    // Un profil global autre que le profil courant ou par défaut n'est pas pris du manifeste
    const autreProfil = ecrire(espace, '~/.claude/rules/rule-test-doublon.md', source('antigravity', '.agents/rules/rule-test-doublon.md'));
    ecrire(
      espace,
      ScenarioManager.MANIFEST_FILE,
      manifeste([{ chemin: '~/.claude/rules/rule-test-doublon.md', ...empreinte(fs.readFileSync(autreProfil)), original: false }], { profilGlobal: '~/.claude' })
    );
    const profil = await ScenarioManager.clean(espace.ws, espace.opts);
    assert.ok(fs.existsSync(autreProfil), 'Rien n\'est supprimé hors du profil admis');
    assert.deepStrictEqual(profil.signales, ['~/.claude/rules/rule-test-doublon.md']);

    // Seuls les dossiers qui contiennent un chemin de fixture sont retirés, et seulement s'ils sont vides
    fs.mkdirSync(path.join(espace.ws, 'src', 'vide'), { recursive: true });
    fs.mkdirSync(path.join(espace.ws, '.agents', 'plugins', 'pack-audit-pro'), { recursive: true });
    ecrire(espace, ScenarioManager.MANIFEST_FILE, manifeste([], { dossiersCrees: ['src/vide', '.agents/plugins/pack-audit-pro', '.agents/plugins'] }));
    await ScenarioManager.clean(espace.ws, espace.opts);
    assert.ok(fs.existsSync(path.join(espace.ws, 'src', 'vide')), 'Un dossier vide hors des fixtures est conservé');
    assert.ok(!fs.existsSync(path.join(espace.ws, '.agents', 'plugins')), 'Un dossier de fixture vide est retiré');
  });

  test('18. Sous Windows, un vrai « claude.md » revient sous son nom', { skip: process.platform !== 'win32' }, async () => {
    const espace = await creerEspace();
    ecrire(espace, 'claude.md', ORIGINAUX['CLAUDE.md']);
    const rapport = await ScenarioManager.deploy(espace.ws, 'claude-code', espace.opts);
    assert.deepStrictEqual(rapport.aSauvegarder, ['CLAUDE.md']);
    assert.strictEqual(lireJson(sauvegarde(espace, 'index.json')).fichiers[0].chemin, 'claude.md');
    await ScenarioManager.clean(espace.ws, espace.opts);
    assert.ok(fs.readdirSync(espace.ws).includes('claude.md'));
    assert.ok(!fs.readdirSync(espace.ws).includes('CLAUDE.md'));
  });
});
