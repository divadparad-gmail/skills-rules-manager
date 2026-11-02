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
  ANTIGRAVITY_PROFILES,
  AntigravityBehaviorProfile,
  CONDITIONAL_RULES_HEADER,
  formatConditionalIndexEntry,
  formatMcpServer,
  formatPermanentRule,
  formatPluginSectionHeader,
  formatSkillIndexLine,
  GLOBAL_SOUL_RULE_LABEL,
  PERSONALIZATION_BUDGET_TOKENS,
  RULE_BODY_MAX_BYTES,
  SKILLS_INDEX_HEADER,
  splitRuleBody,
  toAntigravityUri,
  truncateRuleBody,
} from '../src/antigravity/behavior';
import { resolveAntigravityProfile } from '../src/antigravity/behaviorProfile';
import { inspectAntigravityRule } from '../src/utils/antigravityRules';
import { countTokens, countTokensForFile, clearTokenCache } from '../src/utils/tokenizer';
import { LocalScanner } from '../src/services/LocalScanner';
import { defaultAntigravityGlobalSoulPath, GlobalScanner, globalSoulCandidates } from '../src/services/GlobalScanner';
import { McpScanner } from '../src/services/McpScanner';
import { NasScanner } from '../src/services/NasScanner';
import { DuplicateService } from '../src/services/DuplicateService';
import { applyAntigravityIndexHeaders } from '../src/services/antigravityBootCost';
import { StateManager } from '../src/services/StateManager';
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

  // Observation datée : le 2026-10-21, Antigravity a affiché <truncated 14978 bytes> pour la règle 06,
  // sur une copie de 39 106 octets en CRLF (3 CR dans le corps). Les CR ont été perdus le 2026-10-22,
  // lors d'une réécriture de l'arbre de travail. La fixture actuelle, en LF, ne reproduit pas cet état :
  // le test vérifie donc la règle pour la règle 06, et non cette valeur.
  test('3. Troncature : corps moins 24 000 octets (5 957 observés pour r-tronque.md, règle vérifiée sur la règle 06)', async () => {
    const cases = [
      { file: path.join(ROOT, 'test', 'scenarios', 'antigravity-injection-contexte', '.agents', 'rules', 'r-tronque.md'), cut: 5957 },
      { file: path.join(ROOT, 'test', 'scenarios', 'antigravity', '.agents', 'rules', '06-rule-warn-size-exceeded-24kb.md'), cut: null },
    ];
    for (const { file, cut } of cases) {
      const content = await fs.promises.readFile(file, 'utf8');
      const inspection = await inspectAntigravityRule(content, file);
      const body = splitRuleBody(content).body;
      const bodyBytes = Buffer.from(body, 'utf8');
      assert.ok(bodyBytes.length > RULE_BODY_MAX_BYTES, path.basename(file));
      if (cut !== null) {
        assert.strictEqual(inspection.truncatedBytes, cut, path.basename(file));
      } else {
        // Recul UTF-8 de l'extension (test 4) : 0 à 3 octets au-delà de corps − 24 000
        const backoff = inspection.truncatedBytes - (bodyBytes.length - RULE_BODY_MAX_BYTES);
        assert.ok(backoff >= 0 && backoff <= 3, `${path.basename(file)} : recul de ${backoff} octets`);
      }
      const keptBytes = bodyBytes.subarray(0, bodyBytes.length - inspection.truncatedBytes);
      assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(keptBytes), 'La partie gardée est de l\'UTF-8 valide');
      assert.ok(inspection.lostTokens > 0);
      const { kept, lost } = truncateRuleBody(body);
      assert.strictEqual(kept + lost, body);
      const text = `<RULE[${file}]>\n${kept.replace(/^(?:\r?\n)+/, '')}<truncated ${inspection.truncatedBytes} bytes>\n</RULE[${file}]>\n`;
      assert.strictEqual(inspection.bootTokenCount, countTokens(text), 'Seule la partie gardée et le marqueur sont comptés');
    }
  });

  // Choix de l'extension, non observé dans Antigravity : une coupe qui tombe au milieu d'un caractère
  // UTF-8 recule au caractère précédent (1 à 3 octets).
  test('4. Troncature : recul au caractère UTF-8 précédent (choix de l\'extension, non observé dans Antigravity)', () => {
    const even = truncateRuleBody('é'.repeat(13000));
    assert.strictEqual(Buffer.byteLength(even.kept, 'utf8'), 24000);
    assert.strictEqual(even.truncatedBytes, 2000);
    const odd = truncateRuleBody('a' + 'é'.repeat(13000));
    assert.strictEqual(Buffer.byteLength(odd.kept, 'utf8'), 23999, 'La coupe recule au caractère précédent');
    assert.strictEqual(odd.truncatedBytes, 2002);
    assert.strictEqual(odd.kept + odd.lost, 'a' + 'é'.repeat(13000));
    const fourBytes = truncateRuleBody('a' + '😀'.repeat(6001));
    assert.strictEqual(Buffer.byteLength(fourBytes.kept, 'utf8'), 23997, 'Recul maximal : 3 octets');
    assert.strictEqual(fourBytes.truncatedBytes, 8);
    assert.strictEqual(fourBytes.kept + fourBytes.lost, 'a' + '😀'.repeat(6001));
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

  // Chantier 2.6.0, lot L4 : les deux racines coexistent après la migration (antigravity-ide/ et
  // antigravity/), comme sur le poste de test ; seul le dossier du profil doit être lu.
  const deuxRacines = async (nom: string) => {
    const geminiRoot = path.join(tempBaseDir, nom, '.gemini');
    const skill = (n: string) => `---\nname: ${n}\ndescription: Skill ${n}.\n---\n# ${n}\n`;
    for (const n of ['ancien-un', 'ancien-deux', 'ancien-trois']) {
      await writeFile(path.join(geminiRoot, 'antigravity-ide', 'builtin', 'skills', n, 'SKILL.md'), skill(n));
    }
    for (const n of ['nouveau-un', 'nouveau-deux']) {
      await writeFile(path.join(geminiRoot, 'antigravity', 'builtin', 'skills', n, 'SKILL.md'), skill(n));
    }
    await writeFile(path.join(geminiRoot, 'antigravity', 'skills', 'ancien-global', 'SKILL.md'), skill('ancien-global'));
    await writeFile(path.join(geminiRoot, 'config', 'skills', 'courant', 'SKILL.md'), skill('courant'));
    return { geminiRoot, globalDir: path.join(geminiRoot, 'config') };
  };

  test('13. F7 par profil : un seul dossier de skills intégrés ; ancien emplacement global compté en 2.5.5, ⛔ non lu en 2.6.0', async () => {
    const { geminiRoot, globalDir } = await deuxRacines('f7-profils');
    const integres = (items: { metadata?: { builtin?: boolean }; id: string }[]) => items.filter((i) => i.metadata?.builtin).map((i) => i.id).sort();

    // Profil 2.5.5 (défaut) : antigravity-ide/builtin/skills, ancien emplacement compté avec « ❔ »
    const v255 = await GlobalScanner.scan(globalDir, 'antigravity');
    assert.deepStrictEqual(await GlobalScanner.scan(globalDir, 'antigravity', ANTIGRAVITY_PROFILES['2.5.5']), v255, 'Le profil par défaut est 2.5.5');
    assert.deepStrictEqual(integres(v255.items), ['ancien-deux', 'ancien-trois', 'ancien-un']);
    const ancien255 = v255.items.find((i) => i.metadata?.rawId === 'ancien-global')!;
    assert.strictEqual(ancien255.metadata?.legacyLocation, true);
    assert.strictEqual(ancien255.metadata?.antigravityStatus, undefined, 'En 2.5.5, son traitement ne change pas');
    assert.strictEqual(v255.skillsStat.activeCount, 5, 'courant + 3 intégrés + ancien emplacement');

    // Profil 2.6.0 : antigravity/builtin/skills, ancien emplacement affiché, ni actif ni compté
    const v260 = await GlobalScanner.scan(globalDir, 'antigravity', ANTIGRAVITY_PROFILES['2.6.0']);
    assert.deepStrictEqual(integres(v260.items), ['nouveau-deux', 'nouveau-un']);
    const ancien260 = v260.items.find((i) => i.metadata?.rawId === 'ancien-global')!;
    assert.ok(ancien260, 'Le skill de l\'ancien emplacement reste affiché');
    assert.strictEqual(ancien260.metadata?.antigravityStatus, 'not-read');
    assert.strictEqual(ancien260.metadata?.notReadBy, '2.6.0');
    assert.strictEqual(ancien260.metadata?.locked, true, 'Ni bascule ni bascule en masse');
    assert.strictEqual(v260.skillsStat.activeCount, 3, 'courant + 2 intégrés ; l\'ancien emplacement ne compte pas');
    assert.strictEqual(v260.skillsStat.totalCount, 4);
    const ligne = (n: string, dossier: string) => countTokens(formatSkillIndexLine(n, path.join(geminiRoot, dossier, n, 'SKILL.md'), `Skill ${n}.`));
    assert.strictEqual(
      v260.skillsStat.tokenCount,
      ligne('courant', path.join('config', 'skills')) + ligne('nouveau-un', path.join('antigravity', 'builtin', 'skills')) + ligne('nouveau-deux', path.join('antigravity', 'builtin', 'skills')),
      'Seules les lignes des skills lus sont comptées'
    );
  });

  test('14. F8 par profil : le cache MCP de la racine du profil, jamais l\'autre', async () => {
    const { geminiRoot, globalDir } = await deuxRacines('f8-profils');
    for (const tool of ['perime-un', 'perime-deux']) await writeFile(path.join(geminiRoot, 'antigravity-ide', 'mcp', 'serveur', `${tool}.json`), '{}');
    await writeFile(path.join(geminiRoot, 'antigravity-ide', 'mcp', 'serveur-disparu', 'outil.json'), '{}');
    await writeFile(path.join(geminiRoot, 'antigravity', 'mcp', 'serveur', 'actuel.json'), '{}');
    await writeFile(path.join(globalDir, 'mcp_config.json'), JSON.stringify({
      mcpServers: { serveur: { command: 'x' }, 'serveur-disparu': { command: 'x' } },
    }));

    const outils = (stat: Awaited<ReturnType<typeof McpScanner.scanGlobal>>) =>
      new Map(stat.mcpServers!.map((s) => [s.name, s.toolCount]));
    const v255 = await McpScanner.scanGlobal(globalDir, 'antigravity');
    assert.deepStrictEqual(await McpScanner.scanGlobal(globalDir, 'antigravity', ANTIGRAVITY_PROFILES['2.5.5']), v255);
    assert.deepStrictEqual([...outils(v255)], [['serveur', 2], ['serveur-disparu', 1]]);
    assert.strictEqual(v255.tokenCount, countTokens(formatMcpServer('serveur', ['perime-deux', 'perime-un'])) + countTokens(formatMcpServer('serveur-disparu', ['outil'])));

    const v260 = await McpScanner.scanGlobal(globalDir, 'antigravity', ANTIGRAVITY_PROFILES['2.6.0']);
    assert.deepStrictEqual([...outils(v260)], [['serveur', 1], ['serveur-disparu', null]], 'Le serveur absent du nouveau cache a une liste inconnue');
    assert.strictEqual(v260.tokenCount, countTokens(formatMcpServer('serveur', ['actuel'])) + countTokens(formatMcpServer('serveur-disparu', null)));
  });

  // Chantier 2.6.0, lot L5 : <RULE[user_global]> observé pour les quatre âmes globales en 2.6.0
  // (phase 2c), et pour ~/.gemini/GEMINI.md dans la base de l'étalonnage 2.5.5 du 2026-10-21.
  test('15. Âmes globales par profil : <RULE[user_global]> sans chemin, ordre observé, « ❔ » pour les trois âmes non vérifiées en 2.5.5', async () => {
    const userGlobal = (corps: string) => `<RULE[user_global]>\n${corps}\n</RULE[user_global]>\n`;
    const ames = [
      { id: 'AGENTS.md', relatif: 'AGENTS.md', corps: '# Âme AGENTS racine\nConsigne A.' },
      { id: 'GEMINI.md', relatif: 'GEMINI.md', corps: '# Âme GEMINI racine\nConsigne B.' },
      { id: 'config/AGENTS.md', relatif: path.join('config', 'AGENTS.md'), corps: '# Âme AGENTS config\nConsigne C.' },
      { id: 'config/GEMINI.md', relatif: path.join('config', 'GEMINI.md'), corps: '# Âme GEMINI config\nConsigne D.' },
    ];
    const scanner = async (nom: string, presentes: string[], profile: AntigravityBehaviorProfile) => {
      const geminiRoot = path.join(tempBaseDir, 'ames-globales', nom, '.gemini');
      await fs.promises.mkdir(path.join(geminiRoot, 'config'), { recursive: true });
      for (const ame of ames.filter((a) => presentes.includes(a.id))) await writeFile(path.join(geminiRoot, ame.relatif), ame.corps);
      return GlobalScanner.scan(path.join(geminiRoot, 'config'), 'antigravity', profile);
    };

    for (const profile of [ANTIGRAVITY_PROFILES['2.5.5'], ANTIGRAVITY_PROFILES['2.6.0']]) {
      // Aucune âme globale
      const aucune = await scanner(`zero-${profile.id}`, [], profile);
      assert.strictEqual(aucune.items.filter((i) => i.type === 'soul').length, 0, profile.id);
      assert.deepStrictEqual([aucune.soulStat.activeCount, aucune.soulStat.totalCount, aucune.soulStat.tokenCount], [0, 0, 0], profile.id);

      // Une seule âme, ~/.gemini/GEMINI.md, vérifiée dans les deux versions
      const une = await scanner(`une-${profile.id}`, ['GEMINI.md'], profile);
      const gemini = une.items.find((i) => i.type === 'soul')!;
      assert.strictEqual(gemini.id, 'GEMINI.md');
      assert.strictEqual(gemini.metadata?.bootTokenCount, countTokens(userGlobal(ames[1].corps)), `${profile.id} : enveloppe user_global`);
      assert.notStrictEqual(gemini.metadata?.bootTokenCount, countTokens(formatPermanentRule(gemini.path, ames[1].corps).text), `${profile.id} : le chemin n'est plus compté`);
      assert.strictEqual(gemini.metadata?.unverifiedIn, undefined, `${profile.id} : GEMINI.md est vérifié`);
      assert.strictEqual(une.soulStat.tokenCount, gemini.tokenCount);

      // Les quatre âmes, cumulées dans l'ordre observé
      const quatre = await scanner(`quatre-${profile.id}`, ames.map((a) => a.id), profile);
      const soulItems = quatre.items.filter((i) => i.type === 'soul');
      assert.deepStrictEqual(soulItems.map((i) => i.id), ames.map((a) => a.id), `${profile.id} : ordre observé`);
      for (const [n, item] of soulItems.entries()) {
        assert.strictEqual(item.enabled, true, `${profile.id} : ${item.id} actif`);
        assert.strictEqual(item.tokenCount, countTokens(userGlobal(ames[n].corps)), `${profile.id} : ${item.id}`);
      }
      const nonVerifiees = soulItems.filter((i) => i.metadata?.unverifiedIn).map((i) => i.id);
      assert.deepStrictEqual(
        nonVerifiees,
        profile.id === '2.5.5' ? ['AGENTS.md', 'config/AGENTS.md', 'config/GEMINI.md'] : [],
        `${profile.id} : âmes non vérifiées`
      );
      assert.ok(soulItems.every((i) => !i.metadata?.unverifiedIn || i.metadata.unverifiedIn === profile.id));
      // Comptage prudent : une âme non vérifiée compte comme une âme vérifiée
      assert.strictEqual(quatre.soulStat.activeCount, 4, profile.id);
      assert.strictEqual(quatre.soulStat.tokenCount, ames.reduce((somme, a) => somme + countTokens(userGlobal(a.corps)), 0), profile.id);
    }

    // Une âme du projet garde son chemin dans les balises
    const dir = path.join(tempBaseDir, 'ame-projet');
    const ameProjet = path.join(dir, 'GEMINI.md');
    await writeFile(ameProjet, '# Âme du projet\nConsigne P.');
    const local = await LocalScanner.scan(workspaceFor(dir));
    const projet = local.items.find((i) => i.type === 'soul')!;
    assert.strictEqual(projet.metadata?.bootTokenCount, countTokens(`<RULE[${ameProjet}]>\n# Âme du projet\nConsigne P.\n</RULE[${ameProjet}]>\n`));
  });

  // Chantier 2.6.0, lot L6 : en 2.6.0, un skill de plugin figure une seule fois dans <skills>, sans
  // section <plugins> (phase 2c pour un plugin global, S3 = false pour un plugin du projet).
  test('16. F5 et F6 par profil : un plugin à un skill, deux copies et un en-tête en 2.5.5, une copie sans en-tête en 2.6.0', async () => {
    const skill = '---\nname: skill-de-plugin\ndescription: Skill fourni par le plugin.\n---\n# Corps';
    const projet = path.join(tempBaseDir, 'plugin-profils', 'projet');
    const pluginLocal = path.join(projet, '.agents', 'plugins', 'plugin-fictif');
    await writeFile(path.join(pluginLocal, 'plugin.json'), '{ "description": "Jamais injectée en 2.6.0." }');
    await writeFile(path.join(pluginLocal, 'skills', 'skill-de-plugin', 'SKILL.md'), skill);
    const globalDir = path.join(tempBaseDir, 'plugin-profils', '.gemini', 'config');
    const pluginGlobal = path.join(globalDir, 'plugins', 'plugin-fictif');
    await writeFile(path.join(pluginGlobal, 'plugin.json'), '{}');
    await writeFile(path.join(pluginGlobal, 'skills', 'skill-de-plugin', 'SKILL.md'), skill);

    const cas = [
      { portee: 'local', racine: pluginLocal, scan: (p: AntigravityBehaviorProfile) => LocalScanner.scan(workspaceFor(projet), p) },
      { portee: 'global', racine: pluginGlobal, scan: (p: AntigravityBehaviorProfile) => GlobalScanner.scan(globalDir, 'antigravity', p) },
    ];
    for (const { portee, racine, scan } of cas) {
      const ligne = countTokens(formatSkillIndexLine('skill-de-plugin', path.join(racine, 'skills', 'skill-de-plugin', 'SKILL.md'), 'Skill fourni par le plugin.'));
      const entete = countTokens(formatPluginSectionHeader('plugin-fictif', racine));

      const v255 = await scan(ANTIGRAVITY_PROFILES['2.5.5']);
      const s255 = v255.items.find((i) => i.id === 'plugin-fictif:skill-de-plugin')!;
      assert.strictEqual(s255.tokenCount, 2 * ligne, `${portee} 2.5.5 : deux copies`);
      assert.strictEqual(s255.metadata?.pluginListedOnce, undefined, `${portee} 2.5.5 : aucune marque`);
      assert.strictEqual(v255.skillsStat.overheadTokens, entete, `${portee} 2.5.5 : un en-tête de section`);
      assert.strictEqual(v255.skillsStat.tokenCount, 2 * ligne + entete);

      const v260 = await scan(ANTIGRAVITY_PROFILES['2.6.0']);
      const s260 = v260.items.find((i) => i.id === 'plugin-fictif:skill-de-plugin')!;
      assert.strictEqual(s260.tokenCount, ligne, `${portee} 2.6.0 : une copie`);
      assert.strictEqual(s260.metadata?.pluginListedOnce, true);
      assert.strictEqual(v260.skillsStat.overheadTokens, 0, `${portee} 2.6.0 : aucune section de plugin`);
      assert.strictEqual(v260.skillsStat.tokenCount, ligne);
    }
  });

  // D-18 : la coupe à la dernière fin de ligne reproduit les 5 960 octets de r-tronque.md et les
  // 15 090 octets de la règle 06 (sonde du 2026-11-02, Antigravity IDE 2.6.0) : observée sur deux
  // fichiers. La 2.5.5 garde la coupe à l'octet (5 957).
  test('17. Troncature par profil : r-tronque.md coupé de 5 957 octets en 2.5.5, de 5 960 en 2.6.0 ; règle 06 coupée de 15 090 en 2.6.0', async () => {
    const source = path.join(ROOT, 'test', 'scenarios', 'antigravity-injection-contexte', '.agents', 'rules', 'r-tronque.md');
    const projet = path.join(tempBaseDir, 'troncature-profils');
    const regle = path.join(projet, '.agents', 'rules', 'r-tronque.md');
    await writeFile(regle, await fs.promises.readFile(source, 'utf8'));
    const corps = splitRuleBody(await fs.promises.readFile(regle, 'utf8')).body;

    const attendu = [
      { profile: ANTIGRAVITY_PROFILES['2.5.5'], coupe: 5957, regleCoupe: undefined },
      { profile: ANTIGRAVITY_PROFILES['2.6.0'], coupe: 5960, regleCoupe: 'line-end' },
    ];
    for (const { profile, coupe, regleCoupe } of attendu) {
      const scan = await LocalScanner.scan(workspaceFor(projet), profile);
      const item = scan.items.find((i) => i.id === 'r-tronque')!;
      assert.strictEqual(item.metadata?.truncatedBytes, coupe, profile.id);
      assert.strictEqual(item.metadata?.truncationRule, regleCoupe, profile.id);
      const { kept } = truncateRuleBody(corps, profile.truncation);
      const texte = `<RULE[${regle}]>\n${kept.replace(/^(?:\r?\n)+/, '')}<truncated ${coupe} bytes>\n</RULE[${regle}]>\n`;
      assert.strictEqual(item.metadata?.bootTokenCount, countTokens(texte), `${profile.id} : seule la partie gardée est comptée`);
    }
    const ligne = truncateRuleBody(corps, 'line-end');
    assert.ok(ligne.lost.startsWith('\n'), 'La coupe tombe juste avant une fin de ligne');
    assert.strictEqual(ligne.kept + ligne.lost, corps);
    assert.ok(!('rule' in truncateRuleBody(corps)), 'La coupe à l\'octet ne change pas de forme');

    // Règle 06 du banc d'essai (39 100 octets, LF) : « truncated by 15090 bytes (original 38974 bytes) »,
    // partie gardée terminée par « ### Directive Technique 35 » (sonde du 2026-11-02, Antigravity IDE 2.6.0)
    const regle06 = path.join(ROOT, 'test', 'scenarios', 'antigravity', '.agents', 'rules', '06-rule-warn-size-exceeded-24kb.md');
    const corps06 = splitRuleBody(await fs.promises.readFile(regle06, 'utf8')).body;
    const coupe06 = truncateRuleBody(corps06, 'line-end');
    assert.strictEqual(coupe06.truncatedBytes, 15090, 'Règle 06 : 15 090 octets coupés en 2.6.0');
    assert.strictEqual(coupe06.rule, 'line-end');
    assert.ok(coupe06.kept.endsWith('### Directive Technique 35'), 'Règle 06 : la partie gardée finit sur la dernière ligne entière');
    assert.strictEqual(Buffer.byteLength(coupe06.kept.replace(/^\n/, ''), 'utf8'), 23884, 'Règle 06 : 23 884 octets gardés, sans la fin de ligne du --- fermant');
  });

  // ❔ Non vérifié : sans fin de ligne avant la limite, la coupe 2.6.0 se replie sur une coupe à l'octet.
  test('18. Troncature line-end : repli à l\'octet sans fin de ligne avant la limite (non vérifié)', async () => {
    // Corps d'une règle à frontmatter : la fin de ligne du `---` fermant ne compte ni dans la limite ni comme coupe
    const sansFinDeLigne = '\n' + 'a'.repeat(30000);
    const repli = truncateRuleBody(sansFinDeLigne, 'line-end');
    assert.strictEqual(repli.rule, 'byte-fallback');
    assert.strictEqual(Buffer.byteLength(repli.kept, 'utf8'), 24001, 'Fin de ligne de tête + 24 000 octets');
    assert.strictEqual(repli.truncatedBytes, 6000);
    assert.strictEqual(truncateRuleBody(sansFinDeLigne, 'byte').truncatedBytes, 6001, 'Coupe 2.5.5 inchangée');

    // Une fin de ligne au-delà de la limite ne sert pas ; le recul UTF-8 reste appliqué
    const apresLimite = truncateRuleBody('é'.repeat(13000) + '\nfin', 'line-end');
    assert.strictEqual(apresLimite.rule, 'byte-fallback');
    assert.strictEqual(Buffer.byteLength(apresLimite.kept, 'utf8'), 24000);
    assert.strictEqual(apresLimite.kept + apresLimite.lost, 'é'.repeat(13000) + '\nfin');

    // Fichier sans frontmatter (âme) : aucune fin de ligne de tête
    assert.strictEqual(truncateRuleBody('b'.repeat(30000), 'line-end').truncatedBytes, 6000);

    // Une seule fin de ligne avant la limite suffit ; le \r d'un CRLF reste gardé (non vérifié)
    const crlf = truncateRuleBody('x'.repeat(100) + '\r\n' + 'y'.repeat(30000), 'line-end');
    assert.strictEqual(crlf.rule, 'line-end');
    assert.strictEqual(crlf.kept, 'x'.repeat(100) + '\r');
    // Sous la limite, rien n'est coupé
    assert.deepStrictEqual(truncateRuleBody('\n' + 'c'.repeat(24000), 'line-end'), { kept: '\n' + 'c'.repeat(24000), lost: '', truncatedBytes: 0 });

    // Par le scanner : la carte porte le repli, que l'infobulle signale comme non vérifié
    const projet = path.join(tempBaseDir, 'troncature-repli');
    await writeFile(path.join(projet, '.agents', 'rules', 'une-ligne.md'), `---\ntrigger: always_on\n---\n${'z'.repeat(30000)}`);
    const v260 = await LocalScanner.scan(workspaceFor(projet), ANTIGRAVITY_PROFILES['2.6.0']);
    const item = v260.items.find((i) => i.id === 'une-ligne')!;
    assert.deepStrictEqual([item.metadata?.truncatedBytes, item.metadata?.truncationRule], [6000, 'byte-fallback']);
    const v255 = await LocalScanner.scan(workspaceFor(projet), ANTIGRAVITY_PROFILES['2.5.5']);
    const item255 = v255.items.find((i) => i.id === 'une-ligne')!;
    assert.deepStrictEqual([item255.metadata?.truncatedBytes, item255.metadata?.truncationRule], [6001, undefined]);
  });

  // Chantier 2.6.0, lot LR (Garde 1) : sans dossier personnel connu, aucun chemin relatif au dossier
  // courant ('.') n'est proposé ni consulté sur le disque pour les âmes globales.
  test('19. Âmes globales sans dossier personnel : aucun chemin relatif consulté sur le disque, coût 0', async () => {
    for (const profile of [ANTIGRAVITY_PROFILES['2.5.5'], ANTIGRAVITY_PROFILES['2.6.0']]) {
      for (const invalide of ['', '   ', 'relatif/config', '.gemini/config']) {
        assert.deepStrictEqual(globalSoulCandidates(invalide, profile), [], `${profile.id} : globalSoulCandidates(${JSON.stringify(invalide)})`);
        assert.strictEqual(defaultAntigravityGlobalSoulPath(invalide), '', `${profile.id} : defaultAntigravityGlobalSoulPath(${JSON.stringify(invalide)})`);
      }

      for (const videOuBlanc of ['', '   ']) {
        const cheminsConsultes: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const rawFs = require('fs') as Record<string, any>;
        const rawFsPromises = rawFs.promises as Record<string, any>;
        const origExistsSync = rawFs.existsSync;
        const origStatSync = rawFs.statSync;
        const origReadFileSync = rawFs.readFileSync;
        const origReaddirSync = rawFs.readdirSync;
        const origPromisesStat = rawFsPromises.stat;
        const origPromisesReadFile = rawFsPromises.readFile;
        const origPromisesReaddir = rawFsPromises.readdir;

        try {
          rawFs.existsSync = (p: fs.PathLike) => {
            cheminsConsultes.push(String(p));
            return origExistsSync(p);
          };
          rawFs.statSync = (p: fs.PathLike, ...args: any[]) => {
            cheminsConsultes.push(String(p));
            return origStatSync(p, ...args);
          };
          rawFs.readFileSync = (p: fs.PathOrFileDescriptor, ...args: any[]) => {
            cheminsConsultes.push(String(p));
            return origReadFileSync(p, ...args);
          };
          rawFs.readdirSync = (p: fs.PathLike, ...args: any[]) => {
            cheminsConsultes.push(String(p));
            return origReaddirSync(p, ...args);
          };
          rawFsPromises.stat = async (p: fs.PathLike, ...args: any[]) => {
            cheminsConsultes.push(String(p));
            return origPromisesStat(p, ...args);
          };
          rawFsPromises.readFile = async (p: any, ...args: any[]) => {
            cheminsConsultes.push(String(p));
            return origPromisesReadFile(p, ...args);
          };
          rawFsPromises.readdir = async (p: fs.PathLike, ...args: any[]) => {
            cheminsConsultes.push(String(p));
            return origPromisesReaddir(p, ...args);
          };

          const scan = await GlobalScanner.scan(videOuBlanc, 'antigravity', profile);
          const relatifs = cheminsConsultes.filter((c) => !path.isAbsolute(c));
          assert.deepStrictEqual(relatifs, [], `${profile.id} (${JSON.stringify(videOuBlanc)}) : aucun chemin relatif consulté sur le disque`);
          assert.strictEqual(scan.items.filter((i) => i.type === 'soul').length, 0, `${profile.id} : aucune âme lue`);
          assert.strictEqual(scan.soulStat.tokenCount, 0, `${profile.id} : coût 0`);
          assert.strictEqual(scan.soulStat.directoryPath, '', `${profile.id} : aucun chemin par défaut relatif`);
        } finally {
          rawFs.existsSync = origExistsSync;
          rawFs.statSync = origStatSync;
          rawFs.readFileSync = origReadFileSync;
          rawFs.readdirSync = origReaddirSync;
          rawFsPromises.stat = origPromisesStat;
          rawFsPromises.readFile = origPromisesReadFile;
          rawFsPromises.readdir = origPromisesReaddir;
        }
      }
    }
  });

  // Chantier 2.6.0, lot LR (D-19) : les règles d'un plugin (global ou du projet) restent comptées
  // dans les deux profils et portent la marque unverifiedPluginRule, sans incrémenter warningCount.
  test('20. D-19 : règles de plugin comptées dans les deux profils et marquées non vérifiées', async () => {
    const corpsPlugin = '---\ntrigger: always_on\ndescription: Règle fournie par le plugin.\n---\n# Règle plugin\nContenu P.';
    const corpsHorsPlugin = '---\ntrigger: always_on\ndescription: Règle normale hors plugin.\n---\n# Règle normale\nContenu N.';

    const projet = path.join(tempBaseDir, 'd19-plugins', 'projet');
    const reglePluginLocale = path.join(projet, '.agents', 'plugins', 'greffon', 'rules', 'r-plugin.md');
    const regleLocale = path.join(projet, '.agents', 'rules', 'r-normale.md');
    await writeFile(reglePluginLocale, corpsPlugin);
    await writeFile(regleLocale, corpsHorsPlugin);

    const globalDir = path.join(tempBaseDir, 'd19-plugins', '.gemini', 'config');
    const reglePluginGlobale = path.join(globalDir, 'plugins', 'greffon', 'rules', 'r-plugin.md');
    const regleGlobale = path.join(globalDir, 'rules', 'r-normale.md');
    await writeFile(reglePluginGlobale, corpsPlugin);
    await writeFile(regleGlobale, corpsHorsPlugin);

    const cas = [
      {
        portee: 'local',
        cheminPlugin: reglePluginLocale,
        cheminNormal: regleLocale,
        scan: (p: AntigravityBehaviorProfile) => LocalScanner.scan(workspaceFor(projet), p),
      },
      {
        portee: 'global',
        cheminPlugin: reglePluginGlobale,
        cheminNormal: regleGlobale,
        scan: (p: AntigravityBehaviorProfile) => GlobalScanner.scan(globalDir, 'antigravity', p),
      },
    ];

    for (const { portee, cheminPlugin, cheminNormal, scan } of cas) {
      const attenduPlugin = countTokens(formatPermanentRule(cheminPlugin, '\n# Règle plugin\nContenu P.').text);
      const attenduNormal = countTokens(formatPermanentRule(cheminNormal, '\n# Règle normale\nContenu N.').text);

      for (const profile of [ANTIGRAVITY_PROFILES['2.5.5'], ANTIGRAVITY_PROFILES['2.6.0']]) {
        const res = await scan(profile);
        const rPlugin = res.items.find((i) => i.id === 'greffon:r-plugin')!;
        const rNormale = res.items.find((i) => i.id === 'r-normale')!;

        assert.ok(rPlugin, `${portee} ${profile.id} : règle de plugin présente`);
        assert.strictEqual(rPlugin.metadata?.unverifiedPluginRule, true, `${portee} ${profile.id} : marque posée`);
        assert.strictEqual(rPlugin.tokenCount, attenduPlugin, `${portee} ${profile.id} : règle de plugin comptée`);
        assert.strictEqual(rNormale.metadata?.unverifiedPluginRule, undefined, `${portee} ${profile.id} : hors plugin sans marque`);
        assert.strictEqual(res.rulesStat.activeCount, 2, `${portee} ${profile.id} : deux règles actives`);
        assert.strictEqual(res.rulesStat.tokenCount, attenduPlugin + attenduNormal, `${portee} ${profile.id} : cumul dans la jauge`);
        assert.strictEqual(res.rulesStat.warningCount, 0, `${portee} ${profile.id} : unverifiedPluginRule n'est pas un warning`);
      }
    }
  });

  // Chantier 2.6.0, lot L9 (D-10) : en 2.6.0, un second budget de 20 000 tokens « Other Customizations »
  // (observé dans le panneau Settings le 2026-10-28) couvre skillsGlobal + skillsLocal + mcpGlobal + mcpLocal
  // (skills intégrés et doublons compris). En 2.5.5 et en Claude Code, aucune clé n'est ajoutée à ManagerStats.
  test('21. D-10 (lot L9) : second budget « Other Customizations » de 20 000 tokens en 2.6.0 ; absent de ManagerStats en 2.5.5 et en Claude Code', async () => {
    const gemini = path.join(tempBaseDir, 'd10-budget', '.gemini');
    const globalDir = path.join(gemini, 'config');
    const claudeGlobalDir = path.join(tempBaseDir, 'd10-budget', '.claude');
    const projet = path.join(tempBaseDir, 'd10-budget', 'projet');
    const skillTexte = (nom: string, desc: string) => `---\nname: ${nom}\ndescription: ${desc}\n---\n# ${nom}\nCorps.\n`;

    await writeFile(path.join(gemini, 'GEMINI.md'), '# Âme globale fictive\nConsigne G.\n');
    await writeFile(path.join(globalDir, 'rules', 'r-globale.md'), '---\ntrigger: always_on\ndescription: Règle G.\n---\n# Règle globale\n');
    await writeFile(path.join(globalDir, 'skills', 'skill-partage', 'SKILL.md'), skillTexte('skill-partage', 'Skill présent en global et en local.'));
    await writeFile(path.join(gemini, 'antigravity', 'builtin', 'skills', 'skill-integre', 'SKILL.md'), skillTexte('skill-integre', 'Skill intégré fictif.'));
    await writeFile(path.join(globalDir, 'mcp_config.json'), JSON.stringify({ mcpServers: { 'srv-global': { command: 'node' } } }));
    await writeFile(path.join(gemini, 'antigravity', 'mcp', 'srv-global', 'outil-a.json'), '{}');

    await writeFile(path.join(projet, '.agents', 'rules', 'r-locale.md'), '---\ntrigger: always_on\ndescription: Règle L.\n---\n# Règle locale\n');
    await writeFile(path.join(projet, '.agents', 'skills', 'skill-partage', 'SKILL.md'), skillTexte('skill-partage', 'Copie locale du skill partagé.'));
    await writeFile(path.join(projet, '.agents', 'skills', 'skill-local', 'SKILL.md'), skillTexte('skill-local', 'Skill uniquement local.'));
    await writeFile(path.join(projet, '.agents', 'mcp_config.json'), JSON.stringify({ mcpServers: { 'srv-local': { command: 'node' } } }));
    await fs.promises.mkdir(claudeGlobalDir, { recursive: true });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscodeMock = require('vscode');
    const origFolders = vscodeMock.workspace.workspaceFolders;
    const origGetConfig = vscodeMock.workspace.getConfiguration;
    const origAppName = vscodeMock.env.appName;
    const indicesVides = { newStructure: false, migrationMarker: false, oldStructure: false };

    try {
      vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: projet } }];
      vscodeMock.workspace.getConfiguration = () => ({
        get: (key: string, def: any) => {
          if (key === 'globalPath') return globalDir;
          if (key === 'claudeGlobalPath') return claudeGlobalDir;
          if (key === 'nasPath') return '';
          return def;
        },
      });
      vscodeMock.env.appName = 'Antigravity IDE';

      // 1. Profil 2.5.5 : aucune des trois clés n'existe dans stats (neutralité stricte)
      StateManager.setAntigravityProfileForTesting(resolveAntigravityProfile('2.5.5', indicesVides));
      const state255 = await StateManager.loadFullState(true);
      assert.strictEqual('personalizationBudgetTotal' in state255.stats, false, '2.5.5 : pas de personalizationBudgetTotal');
      assert.strictEqual('personalizationUsedTokensTotal' in state255.stats, false, '2.5.5 : pas de personalizationUsedTokensTotal');
      assert.strictEqual('personalizationAvailablePercentage' in state255.stats, false, '2.5.5 : pas de personalizationAvailablePercentage');
      assert.strictEqual(
        state255.stats.usedTokensTotal,
        state255.stats.soulGlobal.tokenCount +
          state255.stats.soulLocal.tokenCount +
          state255.stats.rulesGlobal.tokenCount +
          state255.stats.rulesLocal.tokenCount,
        '2.5.5 : la jauge des règles ne compte que les âmes et les règles'
      );

      // 2. Profil 2.6.0 : second budget de 20 000 tokens = skillsGlobal + skillsLocal + mcpGlobal + mcpLocal
      StateManager.setAntigravityProfileForTesting(resolveAntigravityProfile('2.6.0', indicesVides));
      const state260 = await StateManager.loadFullState(true);
      const tb = state260.stats;
      const attenduUsed = tb.skillsGlobal.tokenCount + tb.skillsLocal.tokenCount + tb.mcpGlobal.tokenCount + tb.mcpLocal.tokenCount;
      const attenduAvail = Number(Math.max(0, 100 - (attenduUsed / PERSONALIZATION_BUDGET_TOKENS) * 100).toFixed(1));

      assert.ok(state260.globalResources.some((i) => i.metadata?.builtin), '2.6.0 : le skill intégré fait partie de skillsGlobal');
      assert.strictEqual(tb.skillsGlobal.activeCount, 2, '2.6.0 : skill intégré + skill global partagé comptés');
      assert.strictEqual(tb.skillsLocal.activeCount, 2, '2.6.0 : doublon local + skill local comptés');
      assert.strictEqual(state260.stats.personalizationBudgetTotal, PERSONALIZATION_BUDGET_TOKENS);
      assert.strictEqual(state260.stats.personalizationBudgetTotal, 20000);
      assert.strictEqual(state260.stats.personalizationUsedTokensTotal, attenduUsed);
      assert.strictEqual(state260.stats.personalizationAvailablePercentage, attenduAvail);
      assert.strictEqual(
        state260.stats.usedTokensTotal,
        tb.soulGlobal.tokenCount + tb.soulLocal.tokenCount + tb.rulesGlobal.tokenCount + tb.rulesLocal.tokenCount,
        '2.6.0 : la jauge des règles existante ne change pas de périmètre'
      );

      // 3. Claude Code : pas de budget Other Customizations même si l'override 2.6.0 est actif
      const projetClaude = path.join(tempBaseDir, 'd10-budget', 'projet-claude');
      await fs.promises.mkdir(path.join(projetClaude, '.claude', 'rules'), { recursive: true });
      vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: projetClaude } }];
      vscodeMock.env.appName = 'Visual Studio Code';
      const stateClaude = await StateManager.loadFullState(true);
      assert.strictEqual(stateClaude.workspace.tool, 'claude-code');
      assert.strictEqual('personalizationBudgetTotal' in stateClaude.stats, false, 'Claude Code : pas de personalizationBudgetTotal');
      assert.strictEqual('personalizationUsedTokensTotal' in stateClaude.stats, false, 'Claude Code : pas de personalizationUsedTokensTotal');
      assert.strictEqual('personalizationAvailablePercentage' in stateClaude.stats, false, 'Claude Code : pas de personalizationAvailablePercentage');
    } finally {
      StateManager.setAntigravityProfileForTesting(null);
      vscodeMock.workspace.workspaceFolders = origFolders;
      vscodeMock.workspace.getConfiguration = origGetConfig;
      vscodeMock.env.appName = origAppName;
    }
  });

  // Chantier 2.6.0, lot L10a : le profil de comportement actif est transmis à NasScanner.scan.
  // En 2.5.5, l'état du catalogue est strictement identique au scan sans profil (âme en texte brut,
  // coupe à l'octet, statuts glob inchangés). En 2.6.0, l'âme GEMINI.md du catalogue est mesurée dans
  // l'enveloppe <RULE[user_global]> comme l'âme globale, les règles sont coupées sur fin de ligne
  // (line-end) et les règles glob reçoivent glob-no-effect. En Claude Code, rien ne change.
  // Dans les deux profils, l'infobulle de la carte d'âme du catalogue n'affiche plus « 0 tokens ».
  test('22. Lot L10a : catalogue NAS par profil (2.5.5, 2.6.0 et Claude Code), StateManager.loadFullState et infobulle de l\'âme', async () => {
    const base = path.join(tempBaseDir, 'l10a-nas');
    const nasDir = path.join(base, 'catalogue');
    const soulAntigravityFile = path.join(base, 'backup_cerveau_ia', '.gemini', 'GEMINI.md');
    const soulClaudeFile = path.join(base, 'backup_cerveau_ia', '.claude', 'CLAUDE.md');
    const soulContent = '# Âme Maître Fictive\nConsigne du catalogue pour les tests unitaires.\n';
    const soulClaudeContent = '# Âme Claude Fictive\nConsigne Claude du catalogue.\n';

    await writeFile(soulAntigravityFile, soulContent);
    await writeFile(soulClaudeFile, soulClaudeContent);

    // Skills et workflows du catalogue
    await writeFile(
      path.join(nasDir, 'skills', 'skill-alpha', 'SKILL.md'),
      '---\nname: skill-alpha\ndescription: Compétence alpha du catalogue.\n---\n# Alpha\nCorps.\n'
    );
    await writeFile(
      path.join(nasDir, 'skills', 'wf-beta', 'SKILL.md'),
      '---\nname: wf-beta\ndescription: Workflow bêta du catalogue.\n---\n# Beta\nCorps.\n'
    );

    // Règles du catalogue : r-tronque.md (> 24 Ko), globs variés, model_decision, sans frontmatter
    const sourceTronque = path.join(ROOT, 'test', 'scenarios', 'antigravity-injection-contexte', '.agents', 'rules', 'r-tronque.md');
    await writeFile(path.join(nasDir, 'rules', 'r-tronque.md'), await fs.promises.readFile(sourceTronque, 'utf8'));
    await writeFile(
      path.join(nasDir, 'rules', 'r-glob-actif.md'),
      '---\ntrigger: glob\nglobs: "**/*.ts"\ndescription: Glob simple.\n---\n# Glob actif\nCorps.\n'
    );
    await writeFile(
      path.join(nasDir, 'rules', 'r-glob-partiel.md'),
      '---\ntrigger: glob\nglobs: "*.ts, src/**/*.ts"\ndescription: Glob partiellement mort.\n---\n# Glob partiel\nCorps.\n'
    );
    await writeFile(
      path.join(nasDir, 'rules', 'r-glob-mort.md'),
      '---\ntrigger: glob\nglobs: "src/**/*.ts"\ndescription: Glob avec dossier.\n---\n# Glob mort\nCorps.\n'
    );
    await writeFile(
      path.join(nasDir, 'rules', 'r-glob-liste-yaml.md'),
      '---\ntrigger: glob\nglobs:\n  - "**/*.ts"\ndescription: Glob en liste YAML.\n---\n# Glob YAML\nCorps.\n'
    );
    await writeFile(
      path.join(nasDir, 'rules', 'r-conditionnelle.md'),
      '---\ntrigger: model_decision\ndescription: Règle conditionnelle du catalogue.\n---\n# Conditionnelle\nCorps.\n'
    );
    await writeFile(path.join(nasDir, 'rules', 'r-sans-fm.md'), '# Sans frontmatter\nToujours active.\n');

    // 1. Profil 2.5.5 : scan sans profil deepStrictEqual au scan avec profil 2.5.5
    const scanDefaut = await NasScanner.scan(nasDir, 'antigravity');
    const scan255 = await NasScanner.scan(nasDir, 'antigravity', ANTIGRAVITY_PROFILES['2.5.5']);
    assert.strictEqual(scanDefaut.status.online, true);
    assert.deepStrictEqual(scan255.items, scanDefaut.items, '2.5.5 : scan explicite identique au scan par défaut');

    const soul255 = scan255.items.find((i) => i.type === 'soul' && i.id === 'GEMINI.md')!;
    assert.ok(soul255, '2.5.5 : carte GEMINI.md présente');
    assert.strictEqual(soul255.tokenCount, countTokens(soulContent), '2.5.5 : âme comptée en texte brut');
    assert.strictEqual(soul255.metadata?.bootTokenCount, undefined, '2.5.5 : pas de bootTokenCount sur l\'âme du catalogue');
    assert.deepStrictEqual(soul255.metadata, {
      isSoul: true,
      locked: true,
      warningLinesExceeded: false,
      warningSizeExceeded: false,
    });

    const tronque255 = scan255.items.find((i) => i.id === 'r-tronque')!;
    assert.strictEqual(tronque255.metadata?.truncatedBytes, 5957, '2.5.5 : r-tronque coupé à l\'octet (5 957)');
    assert.strictEqual(tronque255.metadata?.truncationRule, undefined, '2.5.5 : truncationRule undefined');

    assert.strictEqual(scan255.items.find((i) => i.id === 'r-glob-actif')?.metadata?.antigravityStatus, 'active');
    assert.strictEqual(scan255.items.find((i) => i.id === 'r-glob-partiel')?.metadata?.antigravityStatus, 'partial');
    assert.strictEqual(scan255.items.find((i) => i.id === 'r-glob-mort')?.metadata?.antigravityStatus, 'never-triggers');
    assert.strictEqual(scan255.items.find((i) => i.id === 'r-glob-liste-yaml')?.metadata?.antigravityStatus, 'ignored-yaml-list');
    assert.ok(
      scan255.items.every((i) => i.metadata?.antigravityStatus !== 'glob-no-effect'),
      '2.5.5 : aucune règle en glob-no-effect'
    );

    // 2. Profil 2.6.0 : coupe line-end, glob-no-effect, et âme mesurée avec <RULE[user_global]>
    const scan260 = await NasScanner.scan(nasDir, 'antigravity', ANTIGRAVITY_PROFILES['2.6.0']);

    const tronque260 = scan260.items.find((i) => i.id === 'r-tronque')!;
    assert.strictEqual(tronque260.metadata?.truncatedBytes, 5960, '2.6.0 : r-tronque coupé sur fin de ligne (5 960)');
    assert.strictEqual(tronque260.metadata?.truncationRule, 'line-end', '2.6.0 : truncationRule line-end');

    for (const id of ['r-glob-actif', 'r-glob-partiel', 'r-glob-mort']) {
      const rGlob = scan260.items.find((i) => i.id === id)!;
      assert.strictEqual(rGlob.metadata?.antigravityStatus, 'glob-no-effect', `2.6.0 : ${id} en glob-no-effect`);
      assert.strictEqual(rGlob.metadata?.noEffectIn, '2.6.0', `2.6.0 : ${id} porte noEffectIn 2.6.0`);
      assert.strictEqual(rGlob.metadata?.bootTokenCount, 0);
    }
    assert.strictEqual(
      scan260.items.find((i) => i.id === 'r-glob-liste-yaml')?.metadata?.antigravityStatus,
      'ignored-yaml-list',
      '2.6.0 : une liste YAML reste ignored-yaml-list'
    );

    // Âme du catalogue en 2.6.0 : bootTokenCount égal à celui de l'âme globale pour un contenu identique
    const globalGeminiDir = path.join(base, 'global-home', '.gemini');
    const globalConfigDir = path.join(globalGeminiDir, 'config');
    await writeFile(path.join(globalGeminiDir, 'GEMINI.md'), soulContent);
    const globalScan260 = await GlobalScanner.scan(globalConfigDir, 'antigravity', ANTIGRAVITY_PROFILES['2.6.0']);
    const globalSoul260 = globalScan260.items.find((i) => i.type === 'soul' && i.id === 'GEMINI.md')!;
    const soul260 = scan260.items.find((i) => i.type === 'soul' && i.id === 'GEMINI.md')!;

    const enveloppeAttendue = formatPermanentRule(GLOBAL_SOUL_RULE_LABEL, soulContent).text;
    assert.strictEqual(soul260.metadata?.bootTokenCount, countTokens(enveloppeAttendue), '2.6.0 : âme dans <RULE[user_global]>');
    assert.strictEqual(soul260.tokenCount, soul260.metadata?.bootTokenCount);
    assert.strictEqual(soul260.metadata?.bootTokenCount, globalSoul260.metadata?.bootTokenCount, '2.6.0 : coût identique à l\'âme globale');
    assert.strictEqual(soul260.tokenCount, globalSoul260.tokenCount);

    // Skills, workflows, model_decision et sans frontmatter sous 24 Ko : identiques entre 2.5.5 et 2.6.0
    for (const id of ['skill-alpha', 'wf-beta', 'r-conditionnelle', 'r-sans-fm']) {
      assert.deepStrictEqual(
        scan260.items.find((i) => i.id === id),
        scan255.items.find((i) => i.id === id),
        `Catalogue : ${id} inchangé entre 2.5.5 et 2.6.0`
      );
    }

    // 3. Claude Code : carte CLAUDE.md identique sans profil, en 2.5.5 et en 2.6.0
    const claudeDefaut = await NasScanner.scan(nasDir, 'claude-code');
    const claude255 = await NasScanner.scan(nasDir, 'claude-code', ANTIGRAVITY_PROFILES['2.5.5']);
    const claude260 = await NasScanner.scan(nasDir, 'claude-code', ANTIGRAVITY_PROFILES['2.6.0']);
    const soulClaudeDefaut = claudeDefaut.items.find((i) => i.type === 'soul' && i.id === 'CLAUDE.md')!;
    const soulClaude255 = claude255.items.find((i) => i.type === 'soul' && i.id === 'CLAUDE.md')!;
    const soulClaude260 = claude260.items.find((i) => i.type === 'soul' && i.id === 'CLAUDE.md')!;
    assert.ok(soulClaudeDefaut, 'Claude Code : carte CLAUDE.md présente');
    assert.deepStrictEqual(soulClaude255, soulClaudeDefaut, 'Claude Code : CLAUDE.md identique en 2.5.5');
    assert.deepStrictEqual(soulClaude260, soulClaudeDefaut, 'Claude Code : CLAUDE.md identique en 2.6.0');

    // 4. StateManager.loadFullState avec nasPath configuré : nasResources égal au scan direct en profil par défaut (et en 2.6.0)
    const projet = path.join(base, 'projet');
    const claudeGlobalDir = path.join(base, 'claude-home');
    await fs.promises.mkdir(path.join(projet, '.agents', 'rules'), { recursive: true });
    await fs.promises.mkdir(claudeGlobalDir, { recursive: true });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscodeMock = require('vscode');
    const origFolders = vscodeMock.workspace.workspaceFolders;
    const origGetConfig = vscodeMock.workspace.getConfiguration;
    const origAppName = vscodeMock.env.appName;
    const indicesVides = { newStructure: false, migrationMarker: false, oldStructure: false };

    try {
      vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: projet } }];
      vscodeMock.workspace.getConfiguration = () => ({
        get: (key: string, def: any) => {
          if (key === 'globalPath') return globalConfigDir;
          if (key === 'claudeGlobalPath') return claudeGlobalDir;
          if (key === 'nasPath') return nasDir;
          return def;
        },
      });
      vscodeMock.env.appName = 'Antigravity IDE';

      StateManager.setAntigravityProfileForTesting(null);
      const stateDefaut = await StateManager.loadFullState(true);
      assert.strictEqual(stateDefaut.antigravityBehavior?.version, 'Antigravity IDE 2.5.5');
      assert.deepStrictEqual(stateDefaut.nasResources, scanDefaut.items, 'StateManager (défaut 2.5.5) : nasResources égal au scan direct');

      StateManager.setAntigravityProfileForTesting(resolveAntigravityProfile('2.6.0', indicesVides));
      const state260 = await StateManager.loadFullState(true);
      assert.strictEqual(state260.antigravityBehavior?.version, 'Antigravity IDE 2.6.0');
      assert.deepStrictEqual(state260.nasResources, scan260.items, 'StateManager (2.6.0) : nasResources égal au scan 2.6.0');
    } finally {
      StateManager.setAntigravityProfileForTesting(null);
      vscodeMock.workspace.workspaceFolders = origFolders;
      vscodeMock.workspace.getConfiguration = origGetConfig;
      vscodeMock.env.appName = origAppName;
    }

    // 5. Infobulle de la carte d'âme du catalogue : une estimation, jamais un « Coût au démarrage »
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const main = require(path.resolve(__dirname, '../../src/webview/main.js'));
    const fmt = (n?: number) => (n || 0).toLocaleString('fr-FR');
    const info255: string = main.describeAntigravityBootCost(soul255);
    const info260: string = main.describeAntigravityBootCost(soul260);

    assert.strictEqual(
      info255,
      `Catalogue : ${fmt(soul255.tokenCount)} tokens (texte brut, sans enveloppe ni coupe à 24 000 octets). Une fois déployée, l'extension la compte entre deux balises <RULE[user_global]> en global, ou entre deux balises qui portent le chemin complet du GEMINI.md du projet en local.`
    );
    assert.strictEqual(
      info260,
      `Estimation une fois déployée en global : ${fmt(soul260.metadata?.bootTokenCount)} tokens (entre deux balises <RULE[user_global]>, sans chemin). En local, les deux balises portent le chemin complet du GEMINI.md du projet.`
    );
    for (const info of [info255, info260]) {
      assert.ok(!info.startsWith('Coût au démarrage'), `Catalogue : jamais de « Coût au démarrage » (${info})`);
    }
    // L'infobulle de l'âme globale garde son texte d'origine
    assert.strictEqual(
      main.describeAntigravityBootCost(globalSoul260),
      `Coût au démarrage : ${fmt(globalSoul260.metadata?.bootTokenCount)} tokens (fichier entier, entre deux balises <RULE[user_global]>, sans chemin)`
    );
  });

  // Lot L10a : une âme du catalogue de plus de 24 Ko, en Antigravity IDE 2.6.0, est coupée sur fin de ligne
  // comme l'âme globale de même contenu ; coupée, elle ne reçoit pas de conseil de taille (soulSizeAdvice).
  test('23. Lot L10a : âme du catalogue de plus de 24 Ko en 2.6.0, coupée en line-end comme l\'âme globale', async () => {
    const base = path.join(tempBaseDir, 'l10a-nas-longue');
    const nasDir = path.join(base, 'catalogue');
    await fs.promises.mkdir(nasDir, { recursive: true });
    // 300 lignes de 99 octets : 29 700 octets, au-delà du plafond de 24 000 octets
    const soulContent = Array.from({ length: 300 }, (_, i) => `Consigne ${String(i).padStart(3, '0')} `.padEnd(98, 'x')).join('\n') + '\n';
    assert.ok(Buffer.byteLength(soulContent, 'utf8') > RULE_BODY_MAX_BYTES);
    await writeFile(path.join(base, 'backup_cerveau_ia', '.gemini', 'GEMINI.md'), soulContent);

    const globalGeminiDir = path.join(base, 'global-home', '.gemini');
    const globalConfigDir = path.join(globalGeminiDir, 'config');
    await writeFile(path.join(globalGeminiDir, 'GEMINI.md'), soulContent);

    const scan260 = await NasScanner.scan(nasDir, 'antigravity', ANTIGRAVITY_PROFILES['2.6.0']);
    const globalScan260 = await GlobalScanner.scan(globalConfigDir, 'antigravity', ANTIGRAVITY_PROFILES['2.6.0']);
    const soul260 = scan260.items.find((i) => i.type === 'soul' && i.id === 'GEMINI.md')!;
    const globalSoul260 = globalScan260.items.find((i) => i.type === 'soul' && i.id === 'GEMINI.md')!;
    assert.ok(soul260, 'Catalogue : carte GEMINI.md présente');
    assert.ok(globalSoul260, 'Global : carte GEMINI.md présente');

    const attendu = formatPermanentRule(GLOBAL_SOUL_RULE_LABEL, soulContent, 'line-end');
    assert.ok(attendu.truncation.truncatedBytes > 0);
    assert.strictEqual(soul260.metadata?.truncationRule, 'line-end', '2.6.0 : coupe sur fin de ligne');
    assert.strictEqual(soul260.metadata?.truncatedBytes, attendu.truncation.truncatedBytes, '2.6.0 : octets coupés');
    assert.strictEqual(soul260.metadata?.bootTokenCount, countTokens(attendu.text), '2.6.0 : partie gardée dans <RULE[user_global]>');
    assert.strictEqual(soul260.metadata?.warningSizeExceeded, true);
    assert.strictEqual(soul260.metadata?.sizeAdvice, undefined, '2.6.0 : âme coupée, pas de conseil de taille');
    assert.strictEqual(soul260.metadata?.warningLinesExceeded, undefined);

    assert.strictEqual(soul260.metadata?.bootTokenCount, globalSoul260.metadata?.bootTokenCount, '2.6.0 : même coût que l\'âme globale');
    assert.strictEqual(soul260.tokenCount, globalSoul260.tokenCount);
    assert.deepStrictEqual(soul260.metadata, globalSoul260.metadata, '2.6.0 : mêmes métadonnées que l\'âme globale');
  });
});
