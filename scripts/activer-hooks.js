/**
 * Script npm « prepare » : active les hooks Git du dépôt (core.hooksPath = .githooks).
 *
 * Il ne fait rien, sans jamais échouer, si le hook est absent, hors d'un dépôt Git (archive,
 * paquet installé) ou si le dossier n'est que le sous-dossier d'un dépôt parent.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isRepoRoot } = require('./garde-fou-fixtures');

const root = path.resolve(__dirname, '..');

if (!fs.existsSync(path.join(root, '.githooks', 'pre-commit'))) {
  process.exit(0);
}
if (!isRepoRoot(root)) {
  console.log('[hooks] Hors d\'un dépôt Git : hook pre-commit non activé.');
  process.exit(0);
}

const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, encoding: 'utf8' });
if (result.status === 0) {
  console.log('[hooks] Hook pre-commit activé (core.hooksPath = .githooks).');
} else {
  console.warn(`[hooks] Impossible d'activer le hook pre-commit : ${(result.stderr || '').trim()}`);
}
