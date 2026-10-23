// Génère la fixture 05-rule-claude-warn-lines.md du banc d'essai Claude Code.
// La règle permanente dépasse 200 lignes pour déclencher l'alerte de longueur de l'extension.
// Le résultat est déterministe (UTF-8 sans BOM, fins de ligne LF) : relancer le script réécrit un fichier identique.
const fs = require('fs');
const path = require('path');

const TARGET = path.resolve(__dirname, '..', 'claude-code', '.claude', 'rules', '05-rule-claude-warn-lines.md');
const STEP_COUNT = 215;
const LIMIT_LINES = 200;

function build05WarnLines() {
  const head = [
    '---',
    'description: Règle volumineuse de démonstration Claude Code dépassant 200 lignes',
    '---',
    '',
    '# Règle Exhaustive de Tests (Claude Code - Dépassement 200 Lignes)',
    '',
    "Cette règle sert à illustrer le déclenchement de l'alerte proactive Claude Code (> 200 lignes).",
    'En dépassant 200 lignes, le risque de "Lost in the Middle" augmente considérablement selon les recommandations d\'Anthropic.',
    '',
    '## Section 1 : Introduction',
    'Consignes détaillées sur la gouvernance des projets complexes.',
    '',
    '## Section 2 : Déploiement et Intégration Continue',
  ];
  const steps = Array.from(
    { length: STEP_COUNT },
    (_, i) => `- Étape de vérification et d'assurance qualité ${i + 1} : validation stricte des prérequis.`
  );
  return [...head, ...steps].join('\n') + '\n';
}

function run() {
  const content = build05WarnLines();
  // Même décompte que LocalScanner pour une règle Claude Code (fichier entier, frontmatter compris)
  const lines = content.split(/\r\n|\r|\n/).length;
  if (lines <= LIMIT_LINES) {
    throw new Error(`05-rule-claude-warn-lines.md ne dépasse pas ${LIMIT_LINES} lignes (${lines}).`);
  }
  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, content, 'utf8');
  console.log(`[05-warn-lines] ${TARGET} écrit (${lines} lignes, ${Buffer.byteLength(content, 'utf8')} octets).`);
}

module.exports = { build05WarnLines, TARGET };

if (require.main === module) {
  try {
    run();
  } catch (err) {
    console.error('[05-warn-lines] Erreur :', err.message);
    process.exit(1);
  }
}
