// Génère la fixture r-tronque.md de la suite antigravity-injection-contexte.
// La règle permanente dépasse 24 000 octets pour vérifier la troncature d'Antigravity.
// Le résultat est déterministe : relancer le script réécrit un fichier identique.
const fs = require('fs');
const path = require('path');

const TARGET = path.resolve(__dirname, '..', 'antigravity-injection-contexte', '.agents', 'rules', 'r-tronque.md');
const TARGET_BYTES = 30000;
const LIMIT_BYTES = 24000;

function buildRTronque() {
  const head = '---\ntrigger: always_on\ndescription: Test troncature 24 Ko\n---\nCANARI-TRONQUE-DEBUT\n';
  const tail = 'CANARI-TRONQUE-FIN\n';
  let filler = '';
  for (let i = 1; Buffer.byteLength(head + filler + tail, 'utf8') < TARGET_BYTES; i++) {
    filler += `Ligne de remplissage ${String(i).padStart(4, '0')}.\n`;
  }
  return head + filler + tail;
}

function run() {
  const content = buildRTronque();
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes <= LIMIT_BYTES) {
    throw new Error(`r-tronque.md ne dépasse pas ${LIMIT_BYTES} octets (${bytes}).`);
  }
  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, content, 'utf8');
  console.log(`[r-tronque] ${TARGET} écrit (${bytes} octets).`);
}

module.exports = { buildRTronque, TARGET };

if (require.main === module) {
  try {
    run();
  } catch (err) {
    console.error('[r-tronque] Erreur :', err.message);
    process.exit(1);
  }
}
