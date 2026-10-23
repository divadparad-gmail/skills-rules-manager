/**
 * Script npm « test:compile » : vide out-test/ avant la compilation des tests.
 *
 * Sans ce vidage, un test renommé ou supprimé laisserait son ancien .js dans out-test/,
 * et le motif de « npm test » l'exécuterait encore. Le dossier est ignoré par Git.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const cible = path.resolve(__dirname, '..', 'out-test');

fs.rmSync(cible, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
