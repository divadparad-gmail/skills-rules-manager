import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';
import { EtatBanc, OptionsBanc, ScenarioManager } from '../src/services/ScenarioManager';
import { empreinte, listerFichiers } from '../src/services/bancEssaiFichiers';
import { messageDemarrage, presenterBanc } from '../src/ui/bancEssaiPresentation';
import {
  BOUTON_DEPLOYER,
  BOUTON_ECRASER,
  BOUTON_REDEPLOYER,
  BOUTON_VIDER,
  InterfaceBanc,
  deployerBancEssai,
  viderBancEssai,
} from '../src/ui/bancEssaiParcours';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const main = require(path.resolve(__dirname, '../../src/webview/main.js'));

// Lot L2b, C3 : avertissements et fenêtres du banc d'essai dans l'extension. Les parcours sont
// rejoués avec un port d'interface simulé, qui note chaque fenêtre et y répond.
describe('Suite de Tests : interface du banc d\'essai (L2b)', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  let tempBaseDir: string;
  let compteur = 0;

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'banc-essai-interface-'));
  });

  after(async () => {
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  async function creerEspace(): Promise<{ ws: string; opts: OptionsBanc }> {
    const base = path.join(tempBaseDir, `cas-${++compteur}`);
    const ws = path.join(base, 'projet');
    const home = path.join(base, 'home');
    await fs.promises.mkdir(home, { recursive: true });
    for (const outil of ['antigravity', 'claude-code']) {
      await fs.promises.cp(path.join(repoRoot, 'test', 'scenarios', outil), path.join(ws, 'test', 'scenarios', outil), {
        recursive: true,
      });
    }
    return { ws, opts: { dossierPersonnel: home, profilGlobal: path.join(home, '.gemini', 'config') } };
  }

  const source = (outil: string, rel: string) => fs.readFileSync(path.join(repoRoot, 'test', 'scenarios', outil, ...rel.split('/')));
  const ecrire = (fichier: string, contenu: string | Buffer) => {
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.writeFileSync(fichier, contenu);
  };

  /**
   * Empreinte de chaque fichier de l'espace (hors sources).
   * Exception unique : sous node --test, un pilote de filtrage d'un antivirus du poste crée et
   * supprime aussitôt ce fichier à la racine quand le manifeste change (cause déduite, notre code
   * ne crée jamais ce nom). Tout autre fichier qui disparaît entre le listage et la lecture fait
   * échouer le test.
   */
  const PASSAGER_ANTIVIRUS = '.SCENARIO-MANIFEST.JSON.tmp';
  const instantane = (ws: string) =>
    Object.fromEntries(
      listerFichiers(ws)
        .filter((r) => !r.startsWith('test/') && r !== PASSAGER_ANTIVIRUS)
        .map((r) => [r, empreinte(fs.readFileSync(path.join(ws, r))).sha256])
    );

  /** Port simulé : `reponses` associe un bouton attendu à la réponse donnée (undefined = Annuler). */
  function interfaceSimulee(reponses: Record<string, string | undefined>, avantReponse?: (bouton: string) => void) {
    const fenetres: Array<{ message: string; boutons: string[] }> = [];
    const messages: Array<{ niveau: string; message: string }> = [];
    const ui: InterfaceBanc = {
      demander: async (message, ...boutons) => {
        fenetres.push({ message, boutons });
        avantReponse?.(boutons[0]);
        return reponses[boutons[0]];
      },
      informer: (message) => messages.push({ niveau: 'info', message }),
      avertir: (message) => messages.push({ niveau: 'avertissement', message }),
      signalerErreur: (message) => messages.push({ niveau: 'erreur', message }),
    };
    return { ui, fenetres, messages };
  }

  const etat = (partiel: Partial<EtatBanc>): EtatBanc => ({
    niveau: 'actif',
    etat: 'deploye',
    manifeste: 'v2',
    sauvegarde: true,
    cible: 'all',
    deployeLe: '2026-10-23T14:02:11.000Z',
    nbOriginaux: 2,
    nbFixtures: 31,
    ...partiel,
  });

  test('1. Présentation : invisible sans banc, « actif » ou « interrompu » sinon', () => {
    assert.deepStrictEqual(presenterBanc(etat({ niveau: 'aucun' })).visible, false);
    assert.strictEqual(messageDemarrage(etat({ niveau: 'aucun' })), null);

    const actif = presenterBanc(etat({}));
    assert.strictEqual(actif.titre, '⚠️ Banc d\'essai actif');
    assert.match(actif.detail, /« all »/);
    assert.match(actif.detail, /2 vrais fichiers sauvegardés/);
    assert.match(actif.infobulle, /Fixtures : 31 · originaux sauvegardés : 2/);
    assert.match(messageDemarrage(etat({})) ?? '', /encore déployé/);

    const interrompu = presenterBanc(etat({ niveau: 'interrompu', etat: 'restauration-en-cours', nbOriginaux: 1 }));
    assert.strictEqual(interrompu.titre, '⛔ Banc d\'essai interrompu');
    assert.match(interrompu.detail, /1 vrai fichier sauvegardé\)/);
    assert.match(interrompu.infobulle, /restauration-en-cours/);
    assert.match(messageDemarrage(etat({ niveau: 'interrompu' })) ?? '', /interrompue/);
    assert.match(presenterBanc(etat({ niveau: 'interrompu', etat: null, manifeste: 'illisible' })).infobulle, /manifeste illisible/);
  });

  test('2. Vider : refus de la confirmation, puis fixture modifiée annulée, puis écrasée avec accord', async () => {
    const { ws, opts } = await creerEspace();
    ecrire(path.join(ws, 'CLAUDE.md'), '# Vrai CLAUDE.md\n');
    await ScenarioManager.deploy(ws, 'claude-code', opts);

    const refus = interfaceSimulee({});
    assert.strictEqual(await viderBancEssai(ws, refus.ui, { confirmer: true, options: opts }), false);
    assert.deepStrictEqual(refus.fenetres.map((f) => f.boutons), [[BOUTON_VIDER]]);
    assert.strictEqual(ScenarioManager.lireEtat(ws, opts).niveau, 'actif');

    fs.appendFileSync(path.join(ws, 'CLAUDE.md'), '\nModifié.\n');
    const avant = instantane(ws);
    const annule = interfaceSimulee({ [BOUTON_VIDER]: BOUTON_VIDER });
    assert.strictEqual(await viderBancEssai(ws, annule.ui, { confirmer: true, options: opts }), false);
    assert.deepStrictEqual(annule.fenetres.map((f) => f.boutons), [[BOUTON_VIDER], [BOUTON_ECRASER]]);
    assert.match(annule.fenetres[1].message, /• CLAUDE\.md/);
    assert.deepStrictEqual(instantane(ws), avant, 'Annuler la seconde fenêtre ne modifie rien');

    const accord = interfaceSimulee({ [BOUTON_ECRASER]: BOUTON_ECRASER });
    assert.strictEqual(await viderBancEssai(ws, accord.ui, { confirmer: false, options: opts }), true);
    assert.strictEqual(fs.readFileSync(path.join(ws, 'CLAUDE.md'), 'utf8'), '# Vrai CLAUDE.md\n');
    assert.strictEqual(ScenarioManager.lireEtat(ws, opts).niveau, 'aucun');
  });

  test('3. Vider : une fixture modifiée après la fenêtre n\'est pas couverte par l\'accord', async () => {
    const { ws, opts } = await creerEspace();
    await ScenarioManager.deploy(ws, 'claude-code', opts);
    fs.appendFileSync(path.join(ws, 'CLAUDE.md'), '\nModifié.\n');
    const autre = path.join(ws, '.claude', 'rules', '01-rule-claude-perm-standard.md');
    const { ui, messages } = interfaceSimulee({ [BOUTON_ECRASER]: BOUTON_ECRASER }, () => fs.appendFileSync(autre, '\nAussi.\n'));
    const avant = instantane(ws);
    assert.strictEqual(await viderBancEssai(ws, ui, { options: opts }), false);
    assert.match(messages[0].message, /modifiées entre-temps \(\.claude\/rules\/01-rule-claude-perm-standard\.md\)/);
    const { [path.posix.join('.claude', 'rules', '01-rule-claude-perm-standard.md')]: _modifie, ...attendu } = avant;
    const { [path.posix.join('.claude', 'rules', '01-rule-claude-perm-standard.md')]: _apres, ...apres } = instantane(ws);
    assert.deepStrictEqual(apres, attendu, 'Rien d\'autre n\'a été modifié');
    await ScenarioManager.clean(ws, { ...opts, ecraser: true });
  });

  test('4. Déployer : la fenêtre liste les vrais fichiers sauvegardés et les fichiers identiques à leur fixture', async () => {
    const { ws, opts } = await creerEspace();
    ecrire(path.join(ws, 'CLAUDE.md'), '# Vrai CLAUDE.md\n');
    const identique = '.claude/rules/03-rule-claude-cond-paths-list.md';
    ecrire(path.join(ws, ...identique.split('/')), source('claude-code', identique));
    const avant = instantane(ws);

    const annule = interfaceSimulee({});
    assert.strictEqual(await deployerBancEssai(ws, 'claude-code', annule.ui, opts), false);
    assert.strictEqual(annule.fenetres.length, 1);
    assert.match(annule.fenetres[0].message, /1 vrai\(s\) fichier\(s\) seront remplacés[\s\S]*• CLAUDE\.md/);
    assert.match(annule.fenetres[0].message, /déjà identique\(s\) à leur fixture[\s\S]*• \.claude\/rules\/03-rule-claude-cond-paths-list\.md/);
    assert.deepStrictEqual(instantane(ws), avant, 'Annuler ne déploie rien');

    const accord = interfaceSimulee({ [BOUTON_DEPLOYER]: BOUTON_DEPLOYER });
    assert.strictEqual(await deployerBancEssai(ws, 'claude-code', accord.ui, opts), true);
    assert.strictEqual(ScenarioManager.lireEtat(ws, opts).nbOriginaux, 1);
    assert.match(accord.messages[0].message, /Déjà identiques à leur fixture, supprimés au vidage/);
    await ScenarioManager.clean(ws, opts);
  });

  test('5. Déployer sans vrai fichier à remplacer : aucune fenêtre', async () => {
    const { ws, opts } = await creerEspace();
    const { ui, fenetres } = interfaceSimulee({});
    assert.strictEqual(await deployerBancEssai(ws, 'antigravity', ui, opts), true);
    assert.strictEqual(fenetres.length, 0);
    await ScenarioManager.clean(ws, opts);
  });

  test('6. Redéployer un banc actif dont une fixture est modifiée exige la fenêtre « Écraser et restaurer »', async () => {
    const { ws, opts } = await creerEspace();
    ecrire(path.join(ws, 'CLAUDE.md'), '# Vrai CLAUDE.md\n');
    await ScenarioManager.deploy(ws, 'claude-code', opts);
    fs.appendFileSync(path.join(ws, 'CLAUDE.md'), '\nModifié.\n');
    const avant = instantane(ws);

    // « Vider et redéployer » accepté, mais la seconde fenêtre est annulée : rien n'est écrasé
    const annule = interfaceSimulee({ [BOUTON_REDEPLOYER]: BOUTON_REDEPLOYER });
    assert.strictEqual(await deployerBancEssai(ws, 'all', annule.ui, opts), false);
    assert.deepStrictEqual(annule.fenetres.map((f) => f.boutons), [[BOUTON_REDEPLOYER], [BOUTON_ECRASER]]);
    assert.match(annule.fenetres[1].message, /• CLAUDE\.md/);
    assert.deepStrictEqual(instantane(ws), avant, 'La fixture modifiée et la sauvegarde sont intactes');

    // Avec les deux accords : vidé, restauré, puis redéployé ; la sauvegarde garde le vrai original
    const accord = interfaceSimulee({
      [BOUTON_REDEPLOYER]: BOUTON_REDEPLOYER,
      [BOUTON_ECRASER]: BOUTON_ECRASER,
      [BOUTON_DEPLOYER]: BOUTON_DEPLOYER,
    });
    assert.strictEqual(await deployerBancEssai(ws, 'all', accord.ui, opts), true);
    assert.deepStrictEqual(accord.fenetres.map((f) => f.boutons), [[BOUTON_REDEPLOYER], [BOUTON_ECRASER], [BOUTON_DEPLOYER]]);
    assert.strictEqual(
      fs.readFileSync(path.join(ws, '.banc-essai-sauvegarde', 'racine', 'CLAUDE.md.sauvegarde'), 'utf8'),
      '# Vrai CLAUDE.md\n'
    );
    await ScenarioManager.clean(ws, opts);
    assert.strictEqual(fs.readFileSync(path.join(ws, 'CLAUDE.md'), 'utf8'), '# Vrai CLAUDE.md\n');
  });

  test('7. Le bandeau du webview suit l\'état calculé par l\'extension', () => {
    const noeuds: Record<string, { style: Record<string, string>; className: string; title: string; textContent: string }> = {};
    for (const id of ['bancEssaiBanner', 'bancEssaiBannerTitre', 'bancEssaiBannerDetail']) {
      noeuds[id] = { style: {}, className: '', title: '', textContent: '' };
    }
    const doc = { getElementById: (id: string) => noeuds[id] ?? null };

    main.renderBancEssaiBanner({}, doc);
    assert.strictEqual(noeuds.bancEssaiBanner.style.display, 'none');

    main.renderBancEssaiBanner({ bancEssai: presenterBanc(etat({})) }, doc);
    assert.strictEqual(noeuds.bancEssaiBanner.style.display, 'flex');
    assert.match(noeuds.bancEssaiBanner.className, /status-warning/);
    assert.strictEqual(noeuds.bancEssaiBannerTitre.textContent, '⚠️ Banc d\'essai actif');

    main.renderBancEssaiBanner({ bancEssai: presenterBanc(etat({ niveau: 'interrompu' })) }, doc);
    assert.match(noeuds.bancEssaiBanner.className, /status-danger/);

    main.renderBancEssaiBanner({ bancEssai: presenterBanc(etat({ niveau: 'aucun' })) }, doc);
    assert.strictEqual(noeuds.bancEssaiBanner.style.display, 'none');
  });

  test('8. Câblage : bandeaux dans les deux vues, commande déclarée et seul point d\'entrée du vidage', () => {
    const lire = (rel: string) => fs.readFileSync(path.join(repoRoot, ...rel.split('/')), 'utf8');
    for (const vue of ['src/webview/sidebar.html', 'src/webview/dashboard.html']) {
      const html = lire(vue);
      for (const id of ['bancEssaiBanner', 'bancEssaiBannerTitre', 'bancEssaiBannerDetail', 'btnBancEssaiVider']) {
        assert.ok(html.includes(`id="${id}"`), `${vue} doit contenir ${id}`);
      }
    }

    const commande = JSON.parse(lire('package.json')).contributes.commands.find(
      (c: { command: string }) => c.command === 'skillsRulesManager.viderBancEssai'
    );
    assert.ok(commande, 'La commande suit le préfixe skillsRulesManager.');
    assert.strictEqual(commande.category, 'Skills & Rules Manager');

    assert.match(lire('src/ui/bancEssaiVsCode.ts'), /COMMANDE_VIDER_BANC = 'skillsRulesManager\.viderBancEssai'/);
    assert.match(lire('src/ui/bancEssaiCommandes.ts'), /registerCommand\(COMMANDE_VIDER_BANC/);
    assert.match(lire('src/extension.ts'), /registerBancEssai\(context\)/);
    for (const fournisseur of ['src/providers/SidebarViewProvider.ts', 'src/providers/DashboardPanel.ts']) {
      const code = lire(fournisseur);
      assert.ok(!code.includes('ScenarioManager.clean('), `${fournisseur} passe par la commande de vidage`);
      assert.ok(!code.includes('ScenarioManager.deploy('), `${fournisseur} passe par le parcours de déploiement`);
      assert.match(code, /executeCommand\(COMMANDE_VIDER_BANC\)/);
    }
  });
});
