/**
 * Banc d'essai en ligne de commande (npm run test:deploy-* et test:clean).
 *
 * Délègue à ScenarioManager, comme les boutons « Banc d'Essai » de l'extension : un seul
 * module décide de ce qui est sauvegardé, copié, supprimé ou restauré.
 *
 * - Déploiement : chaque vrai fichier qu'une fixture remplacerait est d'abord copié dans
 *   .banc-essai-sauvegarde/ et vérifié. Un banc déjà actif est refusé ; avec --ecraser, il
 *   est vidé et restauré avant le redéploiement, sauf si une fixture a été modifiée.
 * - Vidage : seuls les fichiers identiques à leur fixture sont supprimés, puis les originaux
 *   sont restaurés. Une fixture modifiée pendant le test n'est écrasée qu'avec --ecraser.
 *
 * Usage : node runner.js <antigravity|claude-code|all|clean> [racine] [--ecraser]
 * Avec npm : npm run test:clean -- --ecraser
 * Codes de sortie : 0 succès, 1 erreur (dont un argument invalide, signalé sans pile d'appels),
 * 2 refus (rien n'a été modifié).
 *
 * Utilise la version compilée de ScenarioManager : les scripts npm lancent d'abord
 * « tsc -p tsconfig.test.json ».
 */
const fs = require('fs');
const path = require('path');
const { ScenarioManager, BancEssaiRefus } = require('../../../out-test/src/services/ScenarioManager');

const TARGETS = ['antigravity', 'claude-code', 'all', 'clean'];
const OPTIONS = ['--ecraser'];
const USAGE =
  `Usage : node test/scenarios/scripts/runner.js <${TARGETS.join('|')}> [racine] [--ecraser] ` +
  '(avec npm : npm run test:deploy-all, npm run test:clean -- --ecraser)';

/** Erreur d'usage : chaque problème est affiché sans pile d'appels, avec la ligne d'usage (code de sortie 1). */
class ErreurUsage extends Error {
  constructor(problemes) {
    super(problemes.join(' '));
    this.problemes = problemes;
  }
}

/**
 * Lit les arguments avant toute action. Chaque problème est nommé : option inconnue, argument en
 * trop (un argument ignoré cacherait une ligne de commande mal formée), cible ou racine invalide.
 */
function lireArguments(argv) {
  const options = argv.filter((a) => a.startsWith('--'));
  const positionnels = argv.filter((a) => !a.startsWith('--'));
  const problemes = [];

  const inconnues = options.filter((o) => !OPTIONS.includes(o));
  if (inconnues.length > 0) {
    problemes.push(`Option inconnue : ${inconnues.map((o) => `« ${o} »`).join(', ')}. Seule l'option --ecraser est reconnue.`);
  }
  if (positionnels.length > 2) {
    problemes.push(`Argument(s) en trop : ${positionnels.slice(2).map((a) => `« ${a} »`).join(', ')}.`);
  }
  const target = positionnels[0] || 'all';
  if (!TARGETS.includes(target)) {
    problemes.push(`Cible inconnue : « ${target} » (attendu : ${TARGETS.join(', ')}).`);
  }
  // Racine de l'espace de travail : le dépôt par défaut, un dossier temporaire pour les tests
  const rootPath = path.resolve(positionnels[1] || path.join(__dirname, '../../..'));
  if (positionnels[1] !== undefined) {
    let estDossier = false;
    try {
      estDossier = fs.statSync(rootPath).isDirectory();
    } catch {
      // Absent : signalé ci-dessous
    }
    const resolution = rootPath === positionnels[1] ? '' : ` (résolue en ${rootPath})`;
    if (!estDossier) {
      problemes.push(`Racine introuvable : « ${positionnels[1]} » n'est pas un dossier existant${resolution}.`);
    } else if (!fs.existsSync(path.join(rootPath, 'test', 'scenarios'))) {
      problemes.push(`« ${positionnels[1]} » ne contient pas test/scenarios/ : ce n'est pas la racine du dépôt${resolution}.`);
    }
  }
  if (problemes.length > 0) throw new ErreurUsage(problemes);
  return { target, rootPath, ecraser: options.includes('--ecraser') };
}

const CONSEILS = {
  'banc-actif': 'Lancez « npm run test:clean », ou relancez avec « -- --ecraser » pour vider, restaurer puis redéployer.',
  'fixtures-modifiees':
    'Copiez ailleurs les modifications à garder, puis lancez « npm run test:clean -- --ecraser » pour les écraser et restaurer les originaux.',
  'sauvegarde-invalide':
    'La sauvegarde est conservée dans .banc-essai-sauvegarde/ : ne la supprimez pas, examinez son index.json.',
  'destination-invalide': 'Corrigez ces chemins, puis relancez le déploiement.',
};

const liste = (titre, chemins) => {
  if (chemins.length === 0) return;
  console.log(`[Scenarios Runner] ${titre} :`);
  chemins.forEach((c) => console.log(`  - ${c}`));
};

/** Encadré affiché tant que le banc est déployé ou qu'une opération est inachevée. */
function avertirSiActif(rootPath) {
  const etat = ScenarioManager.lireEtat(rootPath);
  if (etat.niveau === 'aucun') return;
  const titre = etat.niveau === 'interrompu' ? '⛔ Banc d\'essai interrompu' : '⚠️  Banc d\'essai actif';
  const lignes = [
    titre,
    `${etat.nbOriginaux} vrai(s) fichier(s) sauvegardé(s) dans ${ScenarioManager.BACKUP_DIR}/`,
    'Ne commitez pas, et terminez par : npm run test:clean',
  ];
  const largeur = Math.max(...lignes.map((l) => l.length));
  console.log(`┌${'─'.repeat(largeur + 2)}┐`);
  lignes.forEach((l) => console.log(`│ ${l.padEnd(largeur)} │`));
  console.log(`└${'─'.repeat(largeur + 2)}┘`);
}

function afficherVidage(rapport) {
  liste('Originaux restaurés', rapport.restaures);
  liste('Fixtures modifiées écrasées', rapport.ecrases);
  liste('Conservés (différents de leur fixture)', rapport.signales);
  console.log(
    `[Scenarios Runner] Vidage terminé : ${rapport.supprimes.length} fixture(s) supprimée(s), ` +
      `${rapport.restaures.length} original(aux) restauré(s).`
  );
}

async function run() {
  const { target, rootPath, ecraser } = lireArguments(process.argv.slice(2));
  console.log(`[Scenarios Runner] Action: ${target} sur ${rootPath}`);
  avertirSiActif(rootPath);

  if (target === 'clean') {
    afficherVidage(await ScenarioManager.clean(rootPath, { ecraser }));
    avertirSiActif(rootPath);
    return;
  }

  const rapport = await ScenarioManager.deploy(rootPath, target, { remplacer: ecraser });
  if (rapport.vidage) afficherVidage(rapport.vidage);
  liste('Vrais fichiers sauvegardés, restaurés au vidage', rapport.aSauvegarder);
  liste('Déjà identiques à leur fixture : non sauvegardés, supprimés au vidage', rapport.identiques);
  rapport.avertissements.forEach((a) => console.log(`[Scenarios Runner] Avertissement : ${a}`));
  console.log(`[Scenarios Runner] Total fichiers déployés : ${rapport.copies}`);
  avertirSiActif(rootPath);
}

run().catch((err) => {
  if (err instanceof ErreurUsage) {
    err.problemes.forEach((probleme) => console.error(`[Scenarios Runner] Erreur : ${probleme}`));
    console.error(`[Scenarios Runner] ${USAGE}`);
    process.exit(1);
  }
  if (err instanceof BancEssaiRefus) {
    console.error(`[Scenarios Runner] Refus : ${err.message}`);
    err.chemins.forEach((c) => console.error(`  - ${c}`));
    console.error(`[Scenarios Runner] ${CONSEILS[err.motif]}`);
    process.exit(2);
  }
  // Erreur inattendue : la pile d'appels aide au diagnostic
  console.error('[Scenarios Runner] Erreur :', err);
  process.exit(1);
});
