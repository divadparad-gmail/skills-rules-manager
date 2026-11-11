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
import {
  claudeRuleStatus,
  claudeUnmatchablePatterns,
  isClaudeFrontmatterYamlInvalid,
} from '../src/claude/ruleFrontmatter';
import { extractFrontmatter } from '../src/utils/frontmatter';
import { countTokens } from '../src/utils/tokenizer';
import { LocalScanner } from '../src/services/LocalScanner';
import { GlobalScanner } from '../src/services/GlobalScanner';
import { McpScanner } from '../src/services/McpScanner';
import { ResourceItem, WorkspaceContext } from '../src/types';

const ROOT = path.resolve(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const main = require(path.join(ROOT, 'src', 'webview', 'main.js'));

/** Faux DOM minimal, comme dans les tests du webview d'Antigravity. */
interface MockEl {
  tagName: string;
  className: string;
  innerHTML: string;
  textContent: string;
  title: string;
  children: MockEl[];
  style: Record<string, string>;
  appendChild: (child: MockEl) => MockEl;
  addEventListener: () => void;
  classList: { add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean };
}
const mockDoc = (byId: Record<string, MockEl> = {}) => {
  const createElement = (tag: string): MockEl => {
    const classes = new Set<string>();
    const el: MockEl = {
      tagName: tag.toUpperCase(),
      className: '',
      innerHTML: '',
      textContent: '',
      title: '',
      children: [],
      style: {},
      appendChild(c: MockEl) {
        this.children.push(c);
        return c;
      },
      addEventListener() {},
      classList: {
        add: (c: string) => { classes.add(c); el.className = [...classes].join(' '); },
        remove: (c: string) => { classes.delete(c); el.className = [...classes].join(' '); },
        contains: (c: string) => classes.has(c),
      },
    };
    return el;
  };
  return { createElement, getElementById: (id: string) => (byId[id] = byId[id] ?? createElement('div')) };
};
/** Pastilles et métrique d'une carte rendue : texte et infobulle. */
const pillsOf = (root: MockEl): Array<{ text: string; title: string; className: string }> => {
  const found: Array<{ text: string; title: string; className: string }> = [];
  const walk = (el: MockEl) => {
    if (el.className.includes('item-badge-pill') || el.className.includes('item-metrics-badge')) {
      found.push({ text: el.textContent || el.innerHTML.replace(/<[^>]+>/g, ''), title: el.title, className: el.className });
    }
    el.children.forEach(walk);
  };
  walk(root);
  return found;
};
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

  // Règles paths absentes au démarrage (CC17, testé) ; YAML invalide chargé sans condition (CC21, testé ;
  // critère de l'extension déduit de CC21 et de la fixture `paths: [src/**` de la phase 2)
  test('13. Critère de « YAML invalide » : tabulation dans l\'indentation ou ligne de premier niveau illisible', () => {
    assert.strictEqual(isClaudeFrontmatterYamlInvalid(null), false, 'Sans frontmatter');
    assert.strictEqual(isClaudeFrontmatterYamlInvalid('paths:\n\t- "src/**/*.ts"'), true, 'Tabulation dans l\'indentation');
    assert.strictEqual(isClaudeFrontmatterYamlInvalid('description: x\n: : :'), true, 'Ligne « : : : »');
    assert.strictEqual(isClaudeFrontmatterYamlInvalid('description: x\nune phrase sans deux-points'), true, 'Ligne de premier niveau illisible');
    assert.strictEqual(isClaudeFrontmatterYamlInvalid('paths: [src/**'), false, '`[` non fermé sans guillemets : accepté par Claude Code (phase 2)');
    assert.strictEqual(isClaudeFrontmatterYamlInvalid('paths:\n  - "src/**/*.ts"\n  - "*.md"'), false, 'Liste YAML indentée par des espaces');
    assert.strictEqual(isClaudeFrontmatterYamlInvalid('description: |\n  Ligne : libre\n  : : : dans le scalaire de bloc\nname: x'), false, 'Scalaire de bloc');
    assert.strictEqual(isClaudeFrontmatterYamlInvalid('# commentaire\n"clé citée": 1\n\'autre\': 2\nvide:\n- élément'), false, 'Commentaire, clés citées, clé sans valeur, élément de premier niveau');
    assert.strictEqual(isClaudeFrontmatterYamlInvalid('description: x\r\npaths:\r\n  - "a"'), false, 'Fins de ligne CRLF');
  });

  test('14. La fixture p-yaml-invalide est permanente : ses paths sont ignorés, son corps est compté', async () => {
    const brut = lireFixture('niveaux/projet/_claude/rules/p-yaml-invalide.md.fixture');
    assert.deepStrictEqual(claudeRuleStatus(brut, extractFrontmatter(brut).metadata), { isConditional: false, yamlInvalid: true, unmatchablePatterns: [] });

    const dir = path.join(tempBaseDir, 'yaml-invalide');
    await writeFile(path.join(dir, '.claude', 'rules', 'p-yaml-invalide.md'), brut);
    const result = await LocalScanner.scan(workspaceFor(dir));
    const rule = result.items.find((i) => i.id === 'p-yaml-invalide')!;
    assert.strictEqual(rule.metadata?.isConditional, false);
    assert.strictEqual(rule.metadata?.claudeYamlInvalid, true);
    assert.strictEqual(rule.tokenCount, countTokens(claudeInjectedText(brut)));
    assert.strictEqual(result.rulesStat.tokenCount, rule.tokenCount, 'Comptée au démarrage, comme une règle permanente');
    assert.strictEqual(result.rulesStat.permanentCount, 1);
    assert.strictEqual(result.rulesStat.conditionalCount, 0);
  });

  test('15. `paths: [src/**` sans guillemets : YAML valide, règle conditionnelle, motif qui ne correspond à rien', () => {
    const brut = '---\npaths: [src/**\n---\n# Règle\nCorps.\n';
    const statut = claudeRuleStatus(brut, extractFrontmatter(brut).metadata);
    assert.deepStrictEqual(statut, { isConditional: true, yamlInvalid: false, unmatchablePatterns: ['[src/**'] });
  });

  test('16. Chaîne citée "src/[a.ts" : conditionnelle, signalée « ne correspond à rien » ; un motif fermé ne l\'est pas', async () => {
    const cite = '---\npaths: "src/[a.ts"\n---\n# Règle\nCorps.\n';
    assert.deepStrictEqual(claudeRuleStatus(cite, extractFrontmatter(cite).metadata), { isConditional: true, yamlInvalid: false, unmatchablePatterns: ['src/[a.ts'] });
    const liste = '---\npaths:\n  - "src/**/*.ts"\n  - "src/[a.ts"\n---\n# Règle\n';
    assert.deepStrictEqual(claudeRuleStatus(liste, extractFrontmatter(liste).metadata).unmatchablePatterns, ['src/[a.ts']);
    assert.deepStrictEqual(claudeUnmatchablePatterns(['src/[ab].ts', 'src/**/*.ts', 'a]b']), [], 'Classes fermées et motifs ordinaires');
    assert.deepStrictEqual(claudeUnmatchablePatterns(['[ab]/[c']), ['[ab]/[c'], 'Un `[` ouvert après une classe fermée');

    const dir = path.join(tempBaseDir, 'motif');
    await writeFile(path.join(dir, '.claude', 'rules', 'motif.md'), cite);
    const rule = (await LocalScanner.scan(workspaceFor(dir))).items.find((i) => i.id === 'motif')!;
    assert.strictEqual(rule.metadata?.isConditional, true);
    assert.deepStrictEqual(rule.metadata?.claudeUnmatchablePatterns, ['src/[a.ts']);
    assert.strictEqual(rule.metadata?.claudeYamlInvalid, undefined);
  });

  test('17. Une règle paths ajoute 0 token et 0 caractère au total ; sa carte garde son coût de déclenchement', async () => {
    const perm = '# Permanente\nToujours chargée.\n';
    const cond = '---\npaths:\n  - "src/**/*.ts"\n---\n# Conditionnelle\nCorps chargé à la demande.\n';
    const projet = path.join(tempBaseDir, 'paths-projet');
    await writeFile(path.join(projet, '.claude', 'rules', 'perm.md'), perm);
    await writeFile(path.join(projet, '.claude', 'rules', 'cond.md'), cond);
    const local = await LocalScanner.scan(workspaceFor(projet));
    const carte = local.items.find((i) => i.id === 'cond')!;
    const corps = '# Conditionnelle\nCorps chargé à la demande.\n';
    assert.strictEqual(local.rulesStat.tokenCount, countTokens(perm), 'Seule la permanente compte au démarrage');
    assert.strictEqual(local.rulesStat.charCount, perm.length, 'Aucun caractère forfaitaire');
    assert.strictEqual(local.rulesStat.conditionalCount, 1);
    assert.strictEqual(carte.tokenCount, countTokens(corps), 'Carte : texte injecté, sans frontmatter');
    assert.strictEqual(local.rulesStat.conditionalTokenCount, countTokens(corps));

    const globalDir = path.join(tempBaseDir, 'paths-global');
    await writeFile(path.join(globalDir, 'rules', 'cond-g.md'), cond);
    claudeGlobalPath = globalDir;
    try {
      const global = await GlobalScanner.scan(undefined, 'claude-code');
      assert.strictEqual(global.rulesStat.tokenCount, 0, 'Globale : 0 au démarrage');
      assert.strictEqual(global.rulesStat.charCount, 0);
      assert.strictEqual(global.rulesStat.conditionalTokenCount, countTokens(corps));
    } finally {
      claudeGlobalPath = '';
    }
  });

  test('18. Reprise de la partie Claude Code d\'antigravity-token-count n° 11 : 0 au démarrage pour la conditionnelle, JSON brut des MCP', async () => {
    const dir = path.join(tempBaseDir, 'reprise-11');
    const permContent = '# Perm\nToujours.';
    const mcpJson = JSON.stringify({ mcpServers: { local: { command: 'x' } } }, null, 2);
    await writeFile(path.join(dir, '.claude', 'rules', 'perm.md'), permContent);
    await writeFile(path.join(dir, '.claude', 'rules', 'cond.md'), '---\npaths: "src/**/*.ts"\n---\n# Cond\nCorps.');
    await writeFile(path.join(dir, '.mcp.json'), mcpJson);

    const result = await LocalScanner.scan(workspaceFor(dir));
    assert.strictEqual(result.rulesStat.tokenCount, countTokens(permContent) + 0, 'Plus de forfait de 20 tokens par conditionnelle');
    // Le coût MCP reste celui du JSON brut jusqu'au lot qui le remplacera
    const mcp = await McpScanner.scanLocal(workspaceFor(dir));
    assert.strictEqual(mcp.tokenCount, countTokens(mcpJson));
  });

  test('19. Webview, Claude Code : « 0 tok au boot (N si déclenchée) », badges paths, YAML invalide et motif sans effet', () => {
    const base = (metadata: Record<string, unknown>): ResourceItem => ({
      id: 'r', name: 'r', description: 'Règle', type: 'rule', scope: 'local', enabled: true, path: 'r.md',
      targetTool: 'claude-code', isFolder: false, charCount: 40, tokenCount: 12, lineCount: 4, metadata,
    });
    const cond = pillsOf(main.createItemCard(base({ isConditional: true, claudeUnmatchablePatterns: ['src/[a.ts'] }), true, mockDoc()));
    const metrique = cond.find((p) => p.className.includes('item-metrics-badge'))!;
    assert.strictEqual(metrique.text, '40 car. 0 tok au boot (12 si déclenchée)');
    const badge = cond.find((p) => p.text === '⚡ Conditionnel')!;
    assert.ok(badge.title.includes('0 au démarrage') && badge.title.includes('Read, Write, Edit ou cat') && badge.title.includes('(testé)') && badge.title.includes('head selon la documentation'), badge.title);
    const rien = cond.find((p) => p.text === '⚠️ Ne correspond à rien')!;
    assert.ok(rien.title.includes('src/[a.ts') && rien.title.includes('matches nothing') && rien.title.includes('absente au démarrage'), rien.title);
    for (const p of cond) assert.ok(!/~20|estimation de l'extension/.test(p.text + p.title), `Texte périmé : ${p.text} ${p.title}`);

    const invalide = pillsOf(main.createItemCard(base({ isConditional: false, claudeYamlInvalid: true }), true, mockDoc()));
    const yaml = invalide.find((p) => p.text === '⚠️ YAML invalide')!;
    assert.ok(yaml.title.includes('Critère de l\'extension, déduit de deux mesures'), yaml.title);
    assert.ok(!invalide.some((p) => p.text === '⚡ Conditionnel'));

    // Une règle Antigravity ne reçoit aucun des badges propres à Claude Code
    const agy = pillsOf(main.createItemCard({ ...base({ isConditional: false, claudeYamlInvalid: true, claudeUnmatchablePatterns: ['[x'] }), targetTool: 'antigravity' }, true, mockDoc()));
    assert.ok(!agy.some((p) => p.text === '⚠️ YAML invalide' || p.text === '⚠️ Ne correspond à rien'));

    // Infobulle de la ligne des règles de la jauge
    const nodes: Record<string, MockEl> = {};
    const doc = mockDoc(nodes);
    const stat = { type: 'rule', scope: 'local', activeCount: 2, totalCount: 2, permanentCount: 1, conditionalCount: 1, conditionalTokenCount: 12, charCount: 30, tokenCount: 9, warningCount: 0, percentage: 0, directoryPath: '.claude/rules' };
    main.updateBreakdownRow('RuleLocal', stat, 'Rules (local)', doc, { workspace: { tool: 'claude-code' }, stats: {} });
    const tooltip = nodes['tooltipRuleLocal'].textContent;
    assert.ok(tooltip.includes('1 (0 tok au boot, +12 tok à l\'activation)'), tooltip);
    assert.ok(!tooltip.includes('~20'), tooltip);
  });
});
