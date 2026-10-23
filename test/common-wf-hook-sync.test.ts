import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, describe } from 'node:test';

// Le skill wf-hook existe en deux exemplaires, un par outil, sans synchronisation automatique.
// Les tests de wf-hook n'exercent que la copie .agents : la copie .claude doit lui rester identique.
const repoRoot = path.resolve(__dirname, '../..');
const COPIES = ['.agents/skills/wf-hook', '.claude/skills/wf-hook'];

/** Chemins relatifs (avec /) de tous les fichiers d'un dossier du dépôt, triés. */
function lister(dossier: string): string[] {
  const racine = path.join(repoRoot, dossier);
  const fichiers: string[] = [];
  const parcourir = (courant: string) => {
    for (const entree of fs.readdirSync(courant, { withFileTypes: true })) {
      const complet = path.join(courant, entree.name);
      if (entree.isDirectory()) parcourir(complet);
      else fichiers.push(path.relative(racine, complet).replace(/\\/g, '/'));
    }
  };
  parcourir(racine);
  return fichiers.sort();
}

/** Contenu d'un fichier du dépôt, BOM retiré et fins de ligne ramenées à LF. */
function lireNormalise(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

describe('Skill wf-hook : copies Antigravity et Claude Code synchronisées', () => {
  test('1. Les deux copies contiennent les mêmes fichiers, tous suivis par Git', (t) => {
    const [agents, claude] = COPIES.map(lister);
    assert.ok(agents.length > 0, `${COPIES[0]} est vide ou absent`);
    assert.deepStrictEqual(
      claude,
      agents,
      `Les listes de fichiers de ${COPIES[0]} et ${COPIES[1]} divergent : ajoutez, renommez ou supprimez dans les deux copies.`
    );

    const suivis = spawnSync('git', ['ls-files', '--', ...COPIES], { cwd: repoRoot, encoding: 'utf8' });
    if (suivis.status !== 0) {
      t.skip('Hors d\'un dépôt Git : le suivi des copies ne peut pas être vérifié.');
      return;
    }
    const indexes = new Set(suivis.stdout.split('\n').filter(Boolean));
    const nonSuivis = COPIES.flatMap((copie, i) => [agents, claude][i].map((rel) => `${copie}/${rel}`)).filter((rel) => !indexes.has(rel));
    assert.deepStrictEqual(nonSuivis, [], 'Fichiers de wf-hook non suivis par Git');
  });

  test('2. Chaque fichier est identique dans les deux copies (fins de ligne normalisées)', () => {
    const differents = lister(COPIES[0]).filter(
      (rel) => !fs.existsSync(path.join(repoRoot, COPIES[1], rel)) || lireNormalise(`${COPIES[0]}/${rel}`) !== lireNormalise(`${COPIES[1]}/${rel}`)
    );
    assert.deepStrictEqual(
      differents,
      [],
      `Ces fichiers diffèrent entre ${COPIES[0]} et ${COPIES[1]} : modifiez les deux copies ensemble.`
    );
  });
});
