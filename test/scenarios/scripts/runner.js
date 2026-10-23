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
 * Codes de sortie : 0 succès, 1 erreur, 2 refus (rien n'a été modifié).
 *
 * Utilise la version compilée de ScenarioManager : les scripts npm lancent d'abord
 * « tsc -p tsconfig.test.json ».
 */
const path = require('path');
const { ScenarioManager, BancEssaiRefus } = require('../../../out-test/src/services/ScenarioManager');

const TARGETS = ['antigravity', 'claude-code', 'all', 'clean'];
const OPTIONS = ['--ecraser'];

const args = process.argv.slice(2);
const options = args.filter((a) => a.startsWith('--'));
const positionnels = args.filter((a) => !a.startsWith('--'));
const target = positionnels[0] || 'all';
// Racine de l'espace de travail : le dépôt par défaut, un dossier temporaire pour les tests
const rootPath = path.resolve(positionnels[1] || path.join(__dirname, '../../..'));
const ecraser = options.includes('--ecraser');

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
function avertirSiActif() {
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
  if (!TARGETS.includes(target)) {
    throw new Error(`Cible inconnue « ${target} » (attendu : ${TARGETS.join(', ')}).`);
  }
  const inconnues = options.filter((o) => !OPTIONS.includes(o));
  if (inconnues.length > 0) {
    throw new Error(`Option inconnue « ${inconnues.join(' ')} » (attendu : ${OPTIONS.join(', ')}).`);
  }
  console.log(`[Scenarios Runner] Action: ${target} sur ${rootPath}`);
  avertirSiActif();

  if (target === 'clean') {
    afficherVidage(await ScenarioManager.clean(rootPath, { ecraser }));
    avertirSiActif();
    return;
  }

  const rapport = await ScenarioManager.deploy(rootPath, target, { remplacer: ecraser });
  if (rapport.vidage) afficherVidage(rapport.vidage);
  liste('Vrais fichiers sauvegardés, restaurés au vidage', rapport.aSauvegarder);
  liste('Déjà identiques à leur fixture : non sauvegardés, supprimés au vidage', rapport.identiques);
  rapport.avertissements.forEach((a) => console.log(`[Scenarios Runner] Avertissement : ${a}`));
  console.log(`[Scenarios Runner] Total fichiers déployés : ${rapport.copies}`);
  avertirSiActif();
}

run().catch((err) => {
  if (err instanceof BancEssaiRefus) {
    console.error(`[Scenarios Runner] Refus : ${err.message}`);
    err.chemins.forEach((c) => console.error(`  - ${c}`));
    console.error(`[Scenarios Runner] ${CONSEILS[err.motif]}`);
    process.exit(2);
  }
  console.error('[Scenarios Runner] Erreur :', err);
  process.exit(1);
});
