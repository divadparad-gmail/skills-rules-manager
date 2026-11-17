// Garde de VsCodeConfigurationAdapter : la valeur utilisateur du port (userValue) vient toujours de
// globalValue, le seul champ du vrai WorkspaceConfiguration.inspect() qui porte la valeur des
// réglages utilisateur. Les services (NasPathService, RegistryConfigService) sont testés avec des faux
// du port : sans ce test, un adaptateur qui recopierait un autre champ passerait inaperçu.
//
// Le faux vscode ne rend que des champs du vrai inspect() (key, defaultValue, globalValue,
// workspaceValue, workspaceFolderValue).
import * as assert from 'node:assert';
import { test, describe } from 'node:test';

type Inspection = { key: string; defaultValue?: unknown; globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown };
let inspection: Inspection | undefined;
const sections: string[] = [];

const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'vscode') return 'vscode';
  return origResolve.call(this, request, ...args);
};
require.cache['vscode'] = {
  id: 'vscode',
  filename: 'vscode',
  loaded: true,
  exports: {
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    workspace: {
      getConfiguration: () => ({
        inspect: (section: string) => {
          sections.push(section);
          return inspection;
        },
      }),
    },
  },
} as any;

import { VsCodeConfigurationAdapter } from '../src/settings/vscodeAdapters';

const CLE = 'antigravity.skills.nasDirectoryPath';
const inspecter = (champs: Omit<Inspection, 'key'>) => {
  inspection = { key: CLE, defaultValue: '', ...champs };
  return new VsCodeConfigurationAdapter().inspect<string>(CLE);
};

describe("Suite de Tests : adaptateur de configuration, valeur utilisateur = globalValue", () => {
  test('1. globalValue seul : userValue reçoit la valeur globale', () => {
    const lu = inspecter({ globalValue: 'C:\\utilisateur' });
    assert.strictEqual(lu?.userValue, 'C:\\utilisateur');
    assert.strictEqual(lu?.workspaceValue, undefined);
    assert.strictEqual(sections.at(-1), CLE, 'la clé complète est transmise au vrai inspect()');
  });

  test('2. workspaceValue (ou workspaceFolderValue) seul : userValue reste vide', () => {
    let lu = inspecter({ workspaceValue: '\\\\hote\\partage' });
    assert.strictEqual(lu?.userValue, undefined, 'une valeur d\'espace ne devient jamais userValue');
    assert.strictEqual(lu?.workspaceValue, '\\\\hote\\partage');

    lu = inspecter({ workspaceFolderValue: '\\\\hote\\dossier' });
    assert.strictEqual(lu?.userValue, undefined, 'une valeur de dossier ne devient jamais userValue');
    assert.strictEqual(lu?.workspaceValue, '\\\\hote\\dossier');
  });

  test('3. Les deux portées données : userValue reste la valeur globale', () => {
    const lu = inspecter({ globalValue: 'C:\\utilisateur', workspaceValue: '\\\\hote\\partage' });
    assert.strictEqual(lu?.userValue, 'C:\\utilisateur');
    assert.strictEqual(lu?.workspaceValue, '\\\\hote\\partage');
  });

  test('4. Réglage inconnu de VS Code : aucune valeur', () => {
    inspection = undefined;
    assert.strictEqual(new VsCodeConfigurationAdapter().inspect<string>(CLE), undefined);
  });
});
