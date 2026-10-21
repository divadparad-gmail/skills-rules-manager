// Remet la suite antigravity-injection-contexte dans l'état d'avant la sonde.
// Ne touche jamais à resultats/ ni à historique/.
const fs = require('fs');
const path = require('path');

const suiteDir = path.resolve(__dirname, '..', 'antigravity-injection-contexte');
const moduleTs = path.join(suiteDir, 'sandbox-enquete', 'sous', 'module.ts');
const nouveauTs = path.join(suiteDir, 'sandbox-enquete', 'nouveau.ts');
const MODULE_TS_ORIGINAL = 'export const b = 2;\n';

function run() {
  if (!fs.existsSync(suiteDir)) {
    throw new Error(`Dossier de la suite introuvable : ${suiteDir}`);
  }

  const current = fs.existsSync(moduleTs) ? fs.readFileSync(moduleTs, 'utf8') : null;
  if (current === MODULE_TS_ORIGINAL) {
    console.log('[Reset injection-contexte] module.ts déjà dans son état d\'origine.');
  } else {
    fs.writeFileSync(moduleTs, MODULE_TS_ORIGINAL, 'utf8');
    console.log('[Reset injection-contexte] module.ts restauré.');
  }

  if (fs.existsSync(nouveauTs)) {
    fs.rmSync(nouveauTs, { force: true });
    console.log('[Reset injection-contexte] nouveau.ts supprimé.');
  } else {
    console.log('[Reset injection-contexte] nouveau.ts absent, rien à supprimer.');
  }
}

try {
  run();
} catch (err) {
  console.error('[Reset injection-contexte] Erreur :', err.message);
  process.exit(1);
}
