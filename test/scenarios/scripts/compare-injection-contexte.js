// Lance la comparaison du dernier rapport de sonde à la baseline (INJECTION_COMPARE=1).
// Lanceur Node pour définir la variable d'environnement de façon portable, sans cross-env.
// Le test doit avoir été compilé au préalable (tsc -p tsconfig.test.json).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testFile = path.resolve(__dirname, '../../../out-test/test/antigravity-injection-contexte.test.js');
if (!fs.existsSync(testFile)) {
  console.error(`[Comparaison injection-contexte] Test compilé introuvable : ${testFile}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', testFile], {
  stdio: 'inherit',
  env: { ...process.env, INJECTION_COMPARE: '1' },
});
process.exit(result.status ?? 1);
