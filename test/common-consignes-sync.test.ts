import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, describe } from 'node:test';
import { extractFrontmatter } from '../src/utils/frontmatter';
import { ScenarioManager } from '../src/services/ScenarioManager';

// Les vraies consignes du projet existent en deux exemplaires, un par outil.
// Seul le frontmatter peut différer : le corps doit rester identique.
const repoRoot = path.resolve(__dirname, '../..');
const CLAUDE_RULE = '.claude/rules/projet-consignes.md';
const ANTIGRAVITY_RULE = '.agents/rules/projet-consignes.md';

/** Lit un fichier du dépôt en retirant le BOM et en ramenant les fins de ligne à LF. */
function readNormalized(relPath: string): string {
  const raw = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
  return raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

/** Sépare le frontmatter avec l'analyseur du scanner, et retire les blancs de fin du corps. */
function parse(relPath: string): { metadata: Record<string, any>; body: string } {
  const { metadata, body } = extractFrontmatter(readNormalized(relPath));
  return { metadata, body: body.trimEnd() };
}

describe('Consignes du projet (Claude Code et Antigravity)', () => {
  test('1. Les deux fichiers de consignes existent', () => {
    for (const rel of [CLAUDE_RULE, ANTIGRAVITY_RULE]) {
      assert.ok(
        fs.existsSync(path.join(repoRoot, rel)),
        `Fichier manquant : ${rel}. Les consignes doivent exister pour Claude Code et pour Antigravity.`
      );
    }
  });

  test('2. Le frontmatter charge les deux règles au démarrage', () => {
    const claude = parse(CLAUDE_RULE).metadata;
    assert.strictEqual(
      claude.paths,
      undefined,
      `${CLAUDE_RULE} ne doit pas avoir de champ « paths » : la règle ne serait plus chargée au démarrage de Claude Code.`
    );

    const antigravity = parse(ANTIGRAVITY_RULE).metadata;
    assert.strictEqual(
      antigravity.trigger,
      'always_on',
      `${ANTIGRAVITY_RULE} doit déclarer « trigger: always_on » (valeur lue : ${JSON.stringify(antigravity.trigger)}).`
    );
  });

  test('3. Les deux règles ont le même corps', () => {
    const claudeLines = parse(CLAUDE_RULE).body.split('\n');
    const antigravityLines = parse(ANTIGRAVITY_RULE).body.split('\n');
    const total = Math.max(claudeLines.length, antigravityLines.length);
    const index = Array.from({ length: total }, (_, i) => i).find((i) => claudeLines[i] !== antigravityLines[i]);
    if (index === undefined) return;

    const show = (line: string | undefined) => (line === undefined ? '(fin du fichier)' : `« ${line} »`);
    assert.fail(
      `Les corps de ${CLAUDE_RULE} et ${ANTIGRAVITY_RULE} divergent à la ligne ${index + 1} du corps :\n` +
        `  Claude Code : ${show(claudeLines[index])}\n` +
        `  Antigravity : ${show(antigravityLines[index])}\n` +
        'Modifiez les deux fichiers ensemble : seul le frontmatter peut différer.'
    );
  });

  test('4. Le banc d\'essai ne prend pas les consignes pour des fixtures', () => {
    const scenarioFiles = ScenarioManager.getScenarioFiles(repoRoot);
    for (const rel of [CLAUDE_RULE, ANTIGRAVITY_RULE]) {
      assert.ok(
        !scenarioFiles.has(rel),
        `${rel} porte le nom d'une fixture du banc d'essai : test:clean le supprimerait. Renommez la fixture ou les consignes.`
      );
      const { metadata } = parse(rel);
      assert.ok(
        metadata.scenario_fixture === undefined && metadata.isScenarioFixture === undefined,
        `${rel} porte un marqueur de fixture (scenario_fixture ou isScenarioFixture) : un vrai fichier ne doit jamais le porter.`
      );
    }
  });
});
