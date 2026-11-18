// Guide de Claude Code (point 53 d'a-reporter) : un skill ne coûte pas toujours sa ligne au
// démarrage, et le guide n'affirme pas qu'un skill avec paths est injecté (non mesuré).
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, describe } from 'node:test';

const RACINE = path.resolve(__dirname, '../..');
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8');

describe('Guide de Claude Code : coût des skills au démarrage', () => {
  test('1. Guide Claude Code : un skill ne coûte pas toujours sa ligne, et l\'injection par paths n\'est pas affirmée', () => {
    const guide = lire('src/webview/cheatsheet.html');
    assert.doesNotMatch(guide, /Chaque skill coûte sa ligne/);
    assert.match(guide, /invocation manuelle[^<]*<code>paths<\/code>[^<]*masqué[^<]*0 au démarrage/);
    assert.doesNotMatch(guide, /le corps complet du skill est injecté automatiquement/);
  });
});
