/**
 * Banc d'essai en ligne de commande (npm run test:deploy-* et test:clean).
 *
 * Délègue à ScenarioManager, comme le bouton « Banc d'Essai » de l'extension : seuls les
 * fichiers listés dans .scenario-manifest.json ou présents dans test/scenarios/ sont
 * supprimés. Les dossiers .agents/ et .claude/, ainsi que GEMINI.md, AGENTS.md et CLAUDE.md
 * quand ce ne sont pas des fixtures, ne sont jamais effacés.
 *
 * Utilise la version compilée de ScenarioManager : les scripts npm lancent d'abord
 * « tsc -p tsconfig.test.json ».
 */
const path = require('path');
const { ScenarioManager } = require('../../../out-test/src/services/ScenarioManager');

const TARGETS = ['antigravity', 'claude-code', 'all', 'clean'];
const target = process.argv[2] || 'all';
// Racine de l'espace de travail : le dépôt par défaut, un dossier temporaire pour les tests
const rootPath = path.resolve(process.argv[3] || path.join(__dirname, '../../..'));

async function run() {
  if (!TARGETS.includes(target)) {
    throw new Error(`Cible inconnue « ${target} » (attendu : ${TARGETS.join(', ')}).`);
  }
  console.log(`[Scenarios Runner] Action: ${target} sur ${rootPath}`);

  if (target === 'clean') {
    const result = await ScenarioManager.clean(rootPath, 'all');
    console.log(`[Scenarios Runner] Nettoyage terminé : ${result.deletedCount} fixture(s) supprimée(s).`);
    return;
  }

  const total = await ScenarioManager.deploy(rootPath, target);
  console.log(`[Scenarios Runner] Total fichiers déployés : ${total}`);
}

run().catch((err) => {
  console.error('[Scenarios Runner] Erreur :', err);
  process.exit(1);
});
