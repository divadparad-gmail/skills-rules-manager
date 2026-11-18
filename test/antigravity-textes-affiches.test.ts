// Textes affichés d'Antigravity : aucun jargon interne (« phase 2b », « phase 2c ») dans un texte
// vu par l'utilisateur (point F5) ; les commentaires du code peuvent le garder.
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, describe } from 'node:test';

const RACINE = path.resolve(__dirname, '../..');
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8');

/** Lignes de code hors commentaires (// … et blocs /* … *\/ ligne à ligne). */
function lignesHorsCommentaires(source: string): string[] {
  return source.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l));
}

describe('Textes affichés d\'Antigravity : jargon interne', () => {
  test('1. F5 : aucun « phase 2b » ni « phase 2c » dans un texte de main.js ou d\'antigravityRules.ts', () => {
    for (const rel of ['src/webview/main.js', 'src/utils/antigravityRules.ts']) {
      const fautives = lignesHorsCommentaires(lire(rel)).filter((l) => /phase[ -]?2[bc]/i.test(l));
      assert.deepStrictEqual(fautives, [], `${rel} : jargon interne visible`);
    }
  });
});
