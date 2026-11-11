import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';

// Simulation de l'environnement VS Code pour l'exécution des tests unitaires hors VS Code ; le profil
// global de Claude Code est un dossier temporaire (réglage skillsManager.claudeGlobalPath)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'vscode') {
    return 'vscode';
  }
  return origResolve.call(this, request, ...args);
};
let claudeGlobalPath = '';
require.cache['vscode'] = {
  id: 'vscode',
  filename: 'vscode',
  loaded: true,
  exports: {
    window: {
      createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
      showInformationMessage: () => Promise.resolve(),
      showErrorMessage: () => Promise.resolve(),
      showWarningMessage: () => Promise.resolve(),
    },
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({
        get: (key: string, def: any) => (key === 'claudeGlobalPath' && claudeGlobalPath ? claudeGlobalPath : def),
      }),
    },
    env: { appName: 'Visual Studio Code' },
    Uri: { file: (f: string) => ({ fsPath: f, scheme: 'file' }) },
    commands: { executeCommand: () => Promise.resolve() },
  },
} as any;

import {
  claudeInjectedText,
  stripClaudeFrontmatter,
  stripClaudeHtmlBlockComments,
} from '../src/claude/injectedText';
import { countTokens } from '../src/utils/tokenizer';
import { LocalScanner } from '../src/services/LocalScanner';
import { GlobalScanner } from '../src/services/GlobalScanner';
import { WorkspaceContext } from '../src/types';

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES = path.join(ROOT, 'test', 'scenarios', 'claude-code-injection-contexte', 'fixtures');
const lireFixture = (rel: string) => fs.readFileSync(path.join(FIXTURES, ...rel.split('/')), 'utf8');

// Texte injecté par Claude Code (src/claude/injectedText.ts) : frontmatter retiré (CC11, CC16, testés),
// commentaires HTML de bloc retirés (CC10, testé), commentaire d'un bloc de code gardé (documentation)
describe('Suite de Tests : comptage des règles et des CLAUDE.md de Claude Code sans frontmatter ni commentaires (lot C1)', () => {
  let tempBaseDir: string;

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'claude-c1-regles-'));
  });

  after(async () => {
    claudeGlobalPath = '';
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  const writeFile = async (file: string, content: string) => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, content, 'utf8');
  };

  const workspaceFor = (dir: string): WorkspaceContext => ({
    hasWorkspace: true,
    workspacePath: dir,
    tool: 'claude-code',
    agentsDir: null,
    claudeDir: path.join(dir, '.claude'),
    hasClaudeMd: fs.existsSync(path.join(dir, 'CLAUDE.md')),
  });

  test('1. Le frontmatter fermé par une ligne --- est retiré, avec les lignes vides qui le suivent', () => {
    assert.strictEqual(stripClaudeFrontmatter('---\ndescription: x\n---\n\n# Titre\nCorps.\n'), '# Titre\nCorps.\n');
    assert.strictEqual(stripClaudeFrontmatter('---\n---\n# Titre\n'), '# Titre\n', 'Un frontmatter vide est retiré');
    assert.strictEqual(stripClaudeFrontmatter('﻿---\npaths: "*.ts"\n---   \n# Titre\n'), '# Titre\n', 'BOM et espaces après la fermeture');
    assert.strictEqual(stripClaudeFrontmatter('# Sans frontmatter\n---\nx\n'), '# Sans frontmatter\n---\nx\n', 'Un --- hors de la tête du fichier n\'ouvre rien');
  });

  test('2. Un frontmatter sans ligne de fermeture n\'est pas retiré', () => {
    const sansFermeture = '---\ndescription: x\n# Titre\nCorps.\n';
    assert.strictEqual(stripClaudeFrontmatter(sansFermeture), sansFermeture);
    assert.strictEqual(claudeInjectedText(sansFermeture), sansFermeture);
  });

  test('3. Le frontmatter d\'une règle au YAML invalide est retiré lui aussi (fixture p-yaml-invalide)', () => {
    const brut = lireFixture('niveaux/projet/_claude/rules/p-yaml-invalide.md.fixture');
    const injecte = claudeInjectedText(brut);
    assert.ok(injecte.startsWith('# Règle au YAML invalide'), injecte);
    assert.ok(!injecte.includes('[non fermé') && !injecte.includes(': : :'));
    assert.ok(injecte.includes('CANARI-CC-RYAML-4GQU'), 'Le canari du corps, vu par le modèle (CC21), reste compté');
  });

  test('4. Un commentaire HTML de bloc est retiré, sur une ou plusieurs lignes', () => {
    assert.strictEqual(stripClaudeHtmlBlockComments('Avant\n<!-- une ligne -->\nAprès\n'), 'Avant\nAprès\n');
    assert.strictEqual(stripClaudeHtmlBlockComments('Avant\n<!--\nplusieurs\nlignes\n-->\nAprès\n'), 'Avant\nAprès\n');
    assert.strictEqual(stripClaudeHtmlBlockComments('   <!-- indenté de trois espaces -->  \nAprès'), 'Après', 'Indentation de trois espaces au plus, espaces après la fermeture');
    assert.strictEqual(stripClaudeHtmlBlockComments('<!-- a -->\n<!-- b -->\n'), '', 'Deux commentaires de suite');
  });

  test('5. Un commentaire placé dans un bloc de code clôturé est gardé', () => {
    const backticks = 'Avant\n```html\n<!-- gardé -->\n```\n<!-- retiré -->\nAprès\n';
    assert.strictEqual(stripClaudeHtmlBlockComments(backticks), 'Avant\n```html\n<!-- gardé -->\n```\nAprès\n');
    const tildes = '~~~~\n<!-- gardé -->\n~~~\n<!-- gardé aussi : le bloc n\'est pas fermé par ~~~ -->\n~~~~\n<!-- retiré -->\n';
    assert.strictEqual(stripClaudeHtmlBlockComments(tildes), '~~~~\n<!-- gardé -->\n~~~\n<!-- gardé aussi : le bloc n\'est pas fermé par ~~~ -->\n~~~~\n');
    assert.strictEqual(stripClaudeHtmlBlockComments('```\n<!-- bloc jamais fermé -->\n'), '```\n<!-- bloc jamais fermé -->\n');
  });

  test('6. Un commentaire dans une ligne, ou suivi de texte, est gardé (en cas de doute, le texte est gardé)', () => {
    const dansLigne = 'Texte <!-- dans la ligne --> suite\n';
    assert.strictEqual(stripClaudeHtmlBlockComments(dansLigne), dansLigne);
    const suiviDeTexte = '<!-- commentaire --> puis du texte\n';
    assert.strictEqual(stripClaudeHtmlBlockComments(suiviDeTexte), suiviDeTexte);
    const fermetureSuivie = '<!--\nsur deux lignes\n--> et du texte\nAprès\n';
    assert.strictEqual(stripClaudeHtmlBlockComments(fermetureSuivie), fermetureSuivie);
    const indenteDeQuatre = '    <!-- bloc de code indenté -->\n';
    assert.strictEqual(stripClaudeHtmlBlockComments(indenteDeQuatre), indenteDeQuatre);
  });

  test('7. Un commentaire jamais fermé est gardé, avec tout ce qui le suit', () => {
    const nonFerme = 'Avant\n<!-- jamais fermé\nsuite\nfin\n';
    assert.strictEqual(stripClaudeHtmlBlockComments(nonFerme), nonFerme);
  });

  test('8. Fins de ligne CRLF : même retrait qu\'en LF, et les fins de ligne gardées restent CRLF', () => {
    const lf = '---\ndescription: x\n---\n# Titre\n<!--\ncommentaire\n-->\n```\n<!-- gardé -->\n```\nCorps.\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    const attenduLf = '# Titre\n```\n<!-- gardé -->\n```\nCorps.\n';
    assert.strictEqual(claudeInjectedText(lf), attenduLf);
    assert.strictEqual(claudeInjectedText(crlf), attenduLf.replace(/\n/g, '\r\n'));
  });

  test('9. Un fichier sans frontmatter ni commentaire est compté tel quel', () => {
    const simple = '# Règle\n\nCorps de la règle.\n';
    assert.strictEqual(claudeInjectedText(simple), simple);
  });

  test('10. Fixtures de la suite d\'injection : canaris retirés et gardés, et compte o200k de p-perm', () => {
    const projet = claudeInjectedText(lireFixture('niveaux/projet/CLAUDE.md.fixture'));
    assert.ok(!projet.includes('CANARI-CC-PROJFM-XHPP'), 'Canari du frontmatter non vu (CC11)');
    assert.ok(!projet.includes('CANARI-CC-COMM-5ZDP'), 'Canari du commentaire non vu (CC10)');
    assert.ok(projet.includes('CANARI-CC-PROJ-QQV9'), 'Canari du corps vu');
    assert.ok(projet.includes('@import-1.md'), 'La ligne @chemin reste dans le texte injecté (déduit, lot E4)');

    const pPerm = claudeInjectedText(lireFixture('niveaux/projet/_claude/rules/p-perm.md.fixture'));
    assert.ok(!pPerm.includes('CANARI-CC-RFM-MCUC'), 'Canari du frontmatter de la règle non vu (CC16)');
    // Valeurs o200k mesurées sur la fixture actuelle au lot C1 : 21 sans frontmatter, 35 pour le fichier brut
    assert.strictEqual(countTokens(pPerm), 21, 'p-perm : 21 tokens o200k sans frontmatter');
    assert.strictEqual(countTokens(lireFixture('niveaux/projet/_claude/rules/p-perm.md.fixture')), 35, 'p-perm : 35 tokens o200k pour le fichier brut');
  });

  test('11. LocalScanner : règle et CLAUDE.md du projet comptés sur le texte injecté, lignes du fichier brut', async () => {
    const dir = path.join(tempBaseDir, 'projet');
    const regle = '---\ndescription: Règle de test\n---\n# Règle\n<!-- note interne -->\nCorps de la règle.\n';
    const ame = '---\nfixture: x\n---\n# Projet\n<!--\nCommentaire.\n-->\nConsignes du projet.\n';
    await writeFile(path.join(dir, '.claude', 'rules', 'regle.md'), regle);
    await writeFile(path.join(dir, 'CLAUDE.md'), ame);

    const result = await LocalScanner.scan(workspaceFor(dir));
    const rule = result.items.find((i) => i.type === 'rule' && i.id === 'regle')!;
    const soul = result.items.find((i) => i.type === 'soul' && i.id === 'CLAUDE.md')!;
    const regleInjectee = '# Règle\nCorps de la règle.\n';
    const ameInjectee = '# Projet\nConsignes du projet.\n';

    assert.strictEqual(rule.tokenCount, countTokens(regleInjectee));
    assert.strictEqual(rule.charCount, regleInjectee.length, 'Les caractères suivent le texte injecté');
    assert.strictEqual(rule.lineCount, regle.split('\n').length, 'Le nombre de lignes reste celui du fichier brut');
    assert.strictEqual((rule.metadata as Record<string, unknown> | undefined)?.description, 'Règle de test', 'Le frontmatter reste lu pour les métadonnées');
    assert.strictEqual(soul.tokenCount, countTokens(ameInjectee));
    assert.strictEqual(soul.charCount, ameInjectee.length);
    assert.strictEqual(soul.lineCount, ame.split('\n').length);
    assert.strictEqual(result.rulesStat.tokenCount, countTokens(regleInjectee));
    assert.strictEqual(result.rulesStat.charCount, regleInjectee.length);
    assert.strictEqual(result.soulStat.tokenCount, countTokens(ameInjectee));
    assert.strictEqual(result.soulStat.charCount, ameInjectee.length);
  });

  test('12. GlobalScanner : règle et CLAUDE.md globaux comptés sur le texte injecté', async () => {
    const globalDir = path.join(tempBaseDir, 'global');
    const regle = '---\ndescription: Règle globale\n---\n# Globale\nCorps global.\n';
    const ame = '<!-- en-tête -->\n# Global\nConsignes globales.\n';
    await writeFile(path.join(globalDir, 'rules', 'globale.md'), regle);
    await writeFile(path.join(globalDir, 'CLAUDE.md'), ame);
    claudeGlobalPath = globalDir;
    try {
      const result = await GlobalScanner.scan(undefined, 'claude-code');
      const rule = result.items.find((i) => i.type === 'rule' && i.id === 'globale')!;
      const soul = result.items.find((i) => i.type === 'soul')!;
      assert.strictEqual(rule.tokenCount, countTokens('# Globale\nCorps global.\n'));
      assert.strictEqual(rule.charCount, '# Globale\nCorps global.\n'.length);
      assert.strictEqual(rule.lineCount, regle.split('\n').length);
      assert.strictEqual(soul.tokenCount, countTokens('# Global\nConsignes globales.\n'));
      assert.strictEqual(soul.charCount, '# Global\nConsignes globales.\n'.length);
      assert.strictEqual(soul.lineCount, ame.split('\n').length);
      assert.strictEqual(result.soulStat.charCount, '# Global\nConsignes globales.\n'.length);
    } finally {
      claudeGlobalPath = '';
    }
  });
});
