import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after } from 'node:test';

// Simulation de l'environnement VS Code pour l'exécution des tests unitaires hors VS Code
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'vscode') {
    return 'vscode';
  }
  return origResolve.call(this, request, ...args);
};
if (!require.cache['vscode']) {
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
        getConfiguration: () => ({ get: (_key: string, def: any) => def }),
      },
      env: { appName: 'Antigravity IDE' },
      Uri: { file: (f: string) => ({ fsPath: f, scheme: 'file' }) },
      commands: { executeCommand: () => Promise.resolve() },
    },
  } as any;
}

import {
  CONDITIONAL_RULES_HEADER,
  formatConditionalIndexEntry,
  formatMcpServer,
  formatPermanentRule,
  formatPluginSectionHeader,
  formatSkillIndexLine,
  SKILLS_INDEX_HEADER,
  splitRuleBody,
  toAntigravityUri,
  truncateRuleBody,
} from '../src/antigravity/behavior';
import { inspectAntigravityRule } from '../src/utils/antigravityRules';
import { countTokens, countTokensForFile, clearTokenCache } from '../src/utils/tokenizer';
import { LocalScanner } from '../src/services/LocalScanner';
import { GlobalScanner } from '../src/services/GlobalScanner';
import { McpScanner } from '../src/services/McpScanner';
import { DuplicateService } from '../src/services/DuplicateService';
import { applyAntigravityIndexHeaders } from '../src/services/antigravityBootCost';
import { TokenCategoryStat, WorkspaceContext } from '../src/types';

const ROOT = path.resolve(__dirname, '..', '..');

// Formats F1 à F8 : src/antigravity/behavior.ts ; rapports bruts :
// test/scenarios/antigravity-injection-contexte/historique/2026-10-21/
describe('Suite de Tests : comptage des tokens au démarrage d\'Antigravity (lot A2)', () => {
  let tempBaseDir: string;

  before(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agy-tokens-'));
    clearTokenCache();
  });

  after(async () => {
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  const writeFile = async (file: string, content: string) => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, content, 'utf8');
  };

  const workspaceFor = (dir: string, tool: 'antigravity' | 'claude-code' = 'antigravity'): WorkspaceContext => ({
    hasWorkspace: true,
    workspacePath: dir,
    tool,
    agentsDir: tool === 'antigravity' ? '.agents' : null,
    claudeDir: tool === 'claude-code' ? '.claude' : null,
    hasClaudeMd: tool === 'claude-code',
  });

  const emptyStat = (type: TokenCategoryStat['type'], scope: 'global' | 'local'): TokenCategoryStat => ({
    type, scope, activeCount: 0, totalCount: 0, charCount: 0, tokenCount: 0, percentage: 0, directoryPath: '',
  });

  test('1. F1 : règle permanente dans <RULE[chemin]>, chemin deux fois, corps sans frontmatter', async () => {
    const dir = path.join(tempBaseDir, 'f1');
    const rulePath = path.join(dir, '.agents', 'rules', 'perm.md');
    await writeFile(rulePath, '---\ntrigger: always_on\ndescription: Une description longue qui ne doit pas compter\n---\n\n# Perm\nContenu.');

    const result = await LocalScanner.scan(workspaceFor(dir));
    const perm = result.items.find((i) => i.id === 'perm')!;
    const expected = `<RULE[${rulePath}]>\n# Perm\nContenu.\n</RULE[${rulePath}]>\n`;
    assert.strictEqual(formatPermanentRule(rulePath, '\n\n# Perm\nContenu.').text, expected);
    assert.strictEqual(perm.tokenCount, countTokens(expected));
    assert.strictEqual(perm.metadata?.bootTokenCount, countTokens(expected));
    assert.ok(!expected.includes('description'), 'Le frontmatter n\'est pas injecté');
    assert.strictEqual(result.rulesStat.tokenCount, countTokens(expected));
  });

  test('2. Frontmatter exclu : corps et taille mesurés après le `---` fermant', () => {
    const { frontmatter, body } = splitRuleBody('---\r\ntrigger: always_on\r\n---\r\n\r\n# R');
    assert.strictEqual(frontmatter, '---\r\ntrigger: always_on\r\n---');
    assert.strictEqual(body, '\r\n\r\n# R', 'La fin de ligne du `---` fermant appartient au corps');
    assert.deepStrictEqual(splitRuleBody('# Sans frontmatter'), { frontmatter: '', body: '# Sans frontmatter' });
  });

  test('3. Troncature : exactement les octets coupés mesurés par Antigravity (5 957 et 14 978)', async () => {
    const cases = [
      { file: path.join(ROOT, 'test', 'scenarios', 'antigravity-injection-contexte', '.agents', 'rules', 'r-tronque.md'), cut: 5957 },
      { file: path.join(ROOT, 'test', 'scenarios', 'antigravity', '.agents', 'rules', '06-rule-warn-size-exceeded-24kb.md'), cut: 14978 },
    ];
    for (const { file, cut } of cases) {
      const content = await fs.promises.readFile(file, 'utf8');
      const inspection = await inspectAntigravityRule(content, file);
      assert.strictEqual(inspection.truncatedBytes, cut, path.basename(file));
      assert.ok(inspection.lostTokens > 0);
      const kept = truncateRuleBody(splitRuleBody(content).body).kept;
      const text = `<RULE[${file}]>\n${kept.replace(/^(?:\r?\n)+/, '')}<truncated ${cut} bytes>\n</RULE[${file}]>\n`;
      assert.strictEqual(inspection.bootTokenCount, countTokens(text), 'Seule la partie gardée et le marqueur sont comptés');
    }
  });

  test('4. Troncature : un caractère UTF-8 n\'est jamais coupé', () => {
    const even = truncateRuleBody('é'.repeat(13000));
    assert.strictEqual(Buffer.byteLength(even.kept, 'utf8'), 24000);
    assert.strictEqual(even.truncatedBytes, 2000);
    const odd = truncateRuleBody('a' + 'é'.repeat(13000));
    assert.strictEqual(Buffer.byteLength(odd.kept, 'utf8'), 23999, 'La coupe recule au caractère précédent');
    assert.strictEqual(odd.truncatedBytes, 2002);
    assert.strictEqual(odd.kept + odd.lost, 'a' + 'é'.repeat(13000));
  });

  test('5. F3 : entrée d\'index en URI (file:///, lettre minuscule, %20) ; F4 : glob et manual à 0', async () => {
    if (process.platform === 'win32') {
      assert.strictEqual(toAntigravityUri('C:\\Mes Projets\\.agents\\rules\\r.md'), 'file:///c:/Mes%20Projets/.agents/rules/r.md');
    } else {
      assert.strictEqual(toAntigravityUri('/mes projets/.agents/rules/r.md'), 'file:///mes%20projets/.agents/rules/r.md');
    }

    const dir = path.join(tempBaseDir, 'f3 f4');
    const modelPath = path.join(dir, '.agents', 'rules', 'model.md');
    await writeFile(modelPath, '---\ntrigger: model_decision\ndescription: Quand on parle de licornes.\n---\n# Model\nCorps jamais injecté au démarrage.');
    await writeFile(path.join(dir, '.agents', 'rules', 'glob.md'), '---\ntrigger: glob\nglobs: "*.ts"\n---\n# Glob\nCorps.');
    await writeFile(path.join(dir, '.agents', 'rules', 'manual.md'), '---\ntrigger: manual\n---\n# Manual\nCorps.');

    const result = await LocalScanner.scan(workspaceFor(dir));
    const model = result.items.find((i) => i.id === 'model')!;
    const entry = formatConditionalIndexEntry(modelPath, 'Quand on parle de licornes.');
    assert.ok(entry.startsWith('- file:///') && entry.includes('f3%20f4'), entry);
    assert.strictEqual(model.metadata?.bootTokenCount, countTokens(entry));
    for (const id of ['glob', 'manual']) {
      assert.strictEqual(result.items.find((i) => i.id === id)!.metadata?.bootTokenCount, 0, id);
    }
    assert.strictEqual(result.rulesStat.tokenCount, countTokens(entry), 'Seule l\'entrée de model_decision compte');
    assert.strictEqual(result.rulesStat.conditionalIndexCount, 1);
    assert.ok(model.tokenCount! > 0, 'La carte garde le poids du corps, lu quand la règle s\'applique');
  });

  test('6. F2 : l\'en-tête de l\'index compte une seule fois en tout, dans les règles locales en priorité', () => {
    const header = countTokens(CONDITIONAL_RULES_HEADER);
    const both = {
      rulesGlobal: { ...emptyStat('rule', 'global'), conditionalIndexCount: 2 },
      rulesLocal: { ...emptyStat('rule', 'local'), conditionalIndexCount: 1 },
      skillsGlobal: emptyStat('skill', 'global'),
      skillsLocal: emptyStat('skill', 'local'),
    };
    applyAntigravityIndexHeaders(both, 20000);
    assert.strictEqual(both.rulesLocal.tokenCount, header);
    assert.strictEqual(both.rulesLocal.overheadTokens, header);
    assert.strictEqual(both.rulesGlobal.tokenCount, 0, 'Pas de second en-tête pour la portée globale');

    const globalOnly = {
      rulesGlobal: { ...emptyStat('rule', 'global'), conditionalIndexCount: 1 },
      rulesLocal: { ...emptyStat('rule', 'local'), conditionalIndexCount: 0 },
      skillsGlobal: { ...emptyStat('skill', 'global'), activeCount: 1 },
      skillsLocal: emptyStat('skill', 'local'),
    };
    applyAntigravityIndexHeaders(globalOnly, 20000);
    assert.strictEqual(globalOnly.rulesGlobal.tokenCount, header);
    assert.strictEqual(globalOnly.skillsGlobal.overheadTokens, countTokens(SKILLS_INDEX_HEADER), 'F5 : « Available skills: » une fois');

    const none = {
      rulesGlobal: emptyStat('rule', 'global'),
      rulesLocal: emptyStat('rule', 'local'),
      skillsGlobal: emptyStat('skill', 'global'),
      skillsLocal: emptyStat('skill', 'local'),
    };
    applyAntigravityIndexHeaders(none, 20000);
    assert.strictEqual(none.rulesLocal.tokenCount + none.rulesGlobal.tokenCount + none.skillsGlobal.tokenCount, 0);
  });

  test('7. F5 et F6 : ligne d\'index du skill ; un skill de plugin compte deux fois, plus l\'en-tête du plugin', async () => {
    const dir = path.join(tempBaseDir, 'f5f6');
    const skillMd = path.join(dir, '.agents', 'skills', 'mon-skill', 'SKILL.md');
    await writeFile(skillMd, '---\nname: mon-skill\ndescription: Fait une chose précise.\n---\n# Corps non injecté');
    const pluginRoot = path.join(dir, '.agents', 'plugins', 'plugin-fictif');
    const pluginSkillMd = path.join(pluginRoot, 'skills', 'skill-de-plugin', 'SKILL.md');
    await writeFile(path.join(pluginRoot, 'plugin.json'), '{}');
    await writeFile(pluginSkillMd, '---\nname: skill-de-plugin\ndescription: Skill fourni par le plugin.\n---\n# Corps');

    const result = await LocalScanner.scan(workspaceFor(dir));
    const skill = result.items.find((i) => i.id === 'mon-skill')!;
    const line = formatSkillIndexLine('mon-skill', skillMd, 'Fait une chose précise.');
    assert.strictEqual(line, `- mon-skill (${skillMd}): Fait une chose précise.\n`);
    assert.strictEqual(skill.tokenCount, countTokens(line));

    const pluginSkill = result.items.find((i) => i.id === 'plugin-fictif:skill-de-plugin')!;
    const pluginLine = formatSkillIndexLine('skill-de-plugin', pluginSkillMd, 'Skill fourni par le plugin.');
    assert.ok(!pluginLine.includes('plugin-fictif:'), 'Aucun préfixe de plugin dans le nom');
    assert.strictEqual(pluginSkill.tokenCount, 2 * countTokens(pluginLine));
    assert.strictEqual(pluginSkill.metadata?.rawId, 'skill-de-plugin');

    const header = countTokens(formatPluginSectionHeader('plugin-fictif', pluginRoot));
    assert.strictEqual(result.skillsStat.overheadTokens, header);
    assert.strictEqual(result.skillsStat.tokenCount, skill.tokenCount! + pluginSkill.tokenCount! + header);
  });

  test('8. Doublons : un skill de plugin est comparé sur son nom brut, sans préfixe', async () => {
    const dir = path.join(tempBaseDir, 'doublon-plugin');
    await writeFile(path.join(dir, '.agents', 'plugins', 'plugin-fictif', 'skills', 'partage', 'SKILL.md'), '---\nname: partage\ndescription: Copie locale.\n---\n# C');
    const local = await LocalScanner.scan(workspaceFor(dir));
    const globalDir = path.join(tempBaseDir, 'doublon-global', '.gemini', 'config');
    await writeFile(path.join(globalDir, 'skills', 'partage', 'SKILL.md'), '---\nname: partage\ndescription: Copie globale.\n---\n# C');
    const global = await GlobalScanner.scan(globalDir, 'antigravity');

    const { stats } = DuplicateService.detectDuplicates(global.items, local.items);
    assert.strictEqual(stats.totalDuplicates, 1);
    assert.strictEqual(stats.activeDuplicates, 1);
  });

  test('9. F7 : skills intégrés verrouillés et comptés ; anciens emplacements comptés avec un badge', async () => {
    const geminiRoot = path.join(tempBaseDir, 'f7', '.gemini');
    const globalDir = path.join(geminiRoot, 'config');
    const builtinMd = path.join(geminiRoot, 'antigravity-ide', 'builtin', 'skills', 'guide-integre', 'SKILL.md');
    await writeFile(builtinMd, '---\nname: guide-integre\ndescription: Skill intégré fictif.\n---\n# G');
    await writeFile(path.join(geminiRoot, 'antigravity', 'skills', 'ancien-global', 'SKILL.md'), '---\nname: ancien-global\ndescription: Ancien emplacement.\n---\n# A');

    const global = await GlobalScanner.scan(globalDir, 'antigravity');
    const builtin = global.items.find((i) => i.id === 'guide-integre')!;
    assert.strictEqual(builtin.enabled, true);
    assert.strictEqual(builtin.metadata?.builtin, true);
    assert.strictEqual(builtin.metadata?.locked, true);
    assert.strictEqual(builtin.tokenCount, countTokens(formatSkillIndexLine('guide-integre', builtinMd, 'Skill intégré fictif.')));
    const legacyGlobal = global.items.find((i) => i.metadata?.rawId === 'ancien-global')!;
    assert.strictEqual(legacyGlobal.metadata?.legacyLocation, true);
    assert.strictEqual(global.skillsStat.tokenCount, builtin.tokenCount! + legacyGlobal.tokenCount!);

    const dir = path.join(tempBaseDir, 'legacy-local');
    await writeFile(path.join(dir, '.agents', 'skills', 'nouveau', 'SKILL.md'), '---\nname: nouveau\ndescription: N.\n---\n# N');
    await writeFile(path.join(dir, '.agent', 'skills', 'ancien', 'SKILL.md'), '---\nname: ancien\ndescription: A.\n---\n# A');
    const local = await LocalScanner.scan(workspaceFor(dir));
    const legacyLocal = local.items.find((i) => i.metadata?.rawId === 'ancien')!;
    assert.strictEqual(legacyLocal.metadata?.legacyLocation, true, '.agent/skills est lu même si .agents existe');
    assert.strictEqual(local.items.find((i) => i.id === 'nouveau')!.metadata?.legacyLocation, undefined);
    assert.strictEqual(local.skillsStat.activeCount, 2);
  });

  test('10. F8 : MCP, titres et noms d\'outils du cache ; disabled, disabledTools et url sans serverUrl exclus', async () => {
    const geminiRoot = path.join(tempBaseDir, 'f8', '.gemini');
    const globalDir = path.join(geminiRoot, 'config');
    const cache = path.join(geminiRoot, 'antigravity-ide', 'mcp');
    for (const tool of ['lire', 'ecrire', 'supprimer']) await writeFile(path.join(cache, 'serveur-alpha', `${tool}.json`), '{}');
    await writeFile(path.join(cache, 'serveur-alpha', 'instructions.md'), 'Pas un outil.');
    await writeFile(path.join(cache, 'serveur-beta', 'outil.json'), '{}');
    await writeFile(path.join(tempBaseDir, 'f8', 'hors-cache', 'secret.json'), '{}');
    await writeFile(path.join(globalDir, 'mcp_config.json'), JSON.stringify({
      mcpServers: {
        'serveur-alpha': { command: 'x', disabledTools: ['supprimer'] },
        'serveur-beta': { command: 'x', disabled: true },
        'serveur-gamma': { url: 'https://exemple.invalid/mcp' },
        'serveur-delta': { command: 'x' },
        '../../hors-cache': { command: 'x' },
      },
    }));

    const stat = await McpScanner.scanGlobal(globalDir, 'antigravity');
    const alpha = formatMcpServer('serveur-alpha', ['ecrire', 'lire']);
    assert.strictEqual(alpha, '# serveur-alpha\nLazy:\necrire\nlire\n');
    const expected = countTokens(alpha) + countTokens('# serveur-delta\n') + countTokens('# ../../hors-cache\n');
    assert.strictEqual(stat.tokenCount, expected);
    assert.strictEqual(stat.activeCount, 3);
    assert.strictEqual(stat.totalCount, 5);
    assert.strictEqual(stat.warningCount, 1, 'url sans serverUrl : non supporté');
    const byName = new Map(stat.mcpServers!.map((s) => [s.name, s]));
    assert.strictEqual(byName.get('serveur-alpha')!.toolCount, 2);
    assert.strictEqual(byName.get('serveur-beta')!.status, 'disabled');
    assert.strictEqual(byName.get('serveur-gamma')!.status, 'unsupported');
    assert.strictEqual(byName.get('serveur-delta')!.toolCount, null, 'Sans cache : liste inconnue');
    assert.strictEqual(byName.get('../../hors-cache')!.toolCount, null, 'Un nom ne sort jamais du dossier du cache');
  });

  test('11. Claude Code inchangé : 20 tokens par règle conditionnelle, JSON brut des MCP, aucun champ Antigravity', async () => {
    const dir = path.join(tempBaseDir, 'claude');
    const permContent = '# Perm\nToujours.';
    const mcpJson = JSON.stringify({ mcpServers: { local: { command: 'x' } } }, null, 2);
    await writeFile(path.join(dir, '.claude', 'rules', 'perm.md'), permContent);
    await writeFile(path.join(dir, '.claude', 'rules', 'cond.md'), '---\npaths: "src/**/*.ts"\n---\n# Cond\nCorps.');
    await writeFile(path.join(dir, '.mcp.json'), mcpJson);

    const result = await LocalScanner.scan(workspaceFor(dir, 'claude-code'));
    assert.strictEqual(result.rulesStat.tokenCount, countTokens(permContent) + 20);
    for (const stat of [result.rulesStat, result.skillsStat, result.soulStat]) {
      for (const key of ['overheadTokens', 'conditionalIndexCount', 'truncatedCount', 'lostTokens']) {
        assert.ok(!(key in stat), `${stat.type} : ${key} absent en mode Claude Code`);
      }
    }
    const mcp = await McpScanner.scanLocal(workspaceFor(dir, 'claude-code'));
    assert.strictEqual(mcp.tokenCount, countTokens(mcpJson));
    assert.ok(!('mcpServers' in mcp));
  });

  test('12. Cache de tokens : un même fichier compté sous deux formes donne deux résultats', async () => {
    const file = path.join(tempBaseDir, 'cache', 'r.md');
    await writeFile(file, 'x');
    const stat = await fs.promises.stat(file);
    const short = countTokensForFile(file, stat.size, stat.mtimeMs, 'court', 'f3');
    const long = countTokensForFile(file, stat.size, stat.mtimeMs, 'un texte nettement plus long que le premier', 'f1');
    assert.notStrictEqual(short, long);
    assert.strictEqual(countTokensForFile(file, stat.size, stat.mtimeMs, 'court', 'f3'), short);
    const changed = countTokensForFile(file, stat.size, stat.mtimeMs, 'court mais modifié par une inclusion', 'f3');
    assert.notStrictEqual(changed, short, 'Le texte compté fait partie de la clé');
  });
});
