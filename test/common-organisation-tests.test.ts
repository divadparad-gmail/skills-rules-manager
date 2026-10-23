import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, describe } from 'node:test';

const repoRoot = path.resolve(__dirname, '../..');
const GROUPES = ['antigravity', 'claude', 'common'];

describe('Suite de Tests : organisation des tests par outil', () => {
  test('1. Chaque fichier test/*.test.ts porte un préfixe de groupe, et chaque groupe a son script et au moins un fichier', () => {
    const fichiers = fs.readdirSync(path.join(repoRoot, 'test')).filter((nom) => nom.endsWith('.test.ts'));
    const sansPrefixe = fichiers.filter((nom) => !GROUPES.some((groupe) => nom.startsWith(`${groupe}-`)));
    assert.deepStrictEqual(sansPrefixe, [], `Préfixe attendu : ${GROUPES.map((g) => `${g}-`).join(', ')}`);

    // Un motif sans fichier donne « tests 0 » avec le code de sortie 0 : un groupe vide passerait en silence
    const scripts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts;
    for (const groupe of GROUPES) {
      assert.ok(fichiers.some((nom) => nom.startsWith(`${groupe}-`)), `Le groupe ${groupe} n'a aucun fichier de test`);
      assert.strictEqual(
        scripts[`test:${groupe}`],
        `npm run test:compile && node --test "out-test/test/${groupe}-*.test.js"`,
        `Script test:${groupe}`
      );
    }
  });
});
