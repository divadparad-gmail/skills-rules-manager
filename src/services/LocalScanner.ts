import * as fs from 'fs';
import * as path from 'path';
import { AntigravityParentsInfo, ResourceItem, TokenCategoryStat, WorkspaceContext } from '../types';
import {
  extractFrontmatter,
  extractMarkdownTitleAndSummary,
  isRuleConditional,
} from '../utils/frontmatter';
import { countTokens, countTokensForFile } from '../utils/tokenizer';
import { measureAntigravitySoul } from '../utils/antigravityRules';
import { ScenarioManager } from './ScenarioManager';
import { appliesInAntigravity, buildAntigravityRuleItem, countsAtBoot, hasResourceWarning } from './antigravityRuleItem';
import { buildAntigravitySkillItem, listSkillFolders, pluginSectionHeadersTokens } from './antigravitySkillItem';
import { antigravityRulesBootStat, truncationSummary } from './antigravityBootCost';
import {
  ANTIGRAVITY_AGENT_DIRS,
  collectRulesJsonFiles,
  findNestedRuleSources,
  listFlatRuleFiles,
} from './antigravityRuleSources';
import { findParentRuleDirs, LEGACY_WORKSPACE_SKILLS_DIR, PARENT_RULES_DIR, PARENT_SOUL_FILES } from '../antigravity/behavior';

export class LocalScanner {
  /**
   * Scanne les compétences et règles définies dans le projet actif local avec comptage réel des caractères.
   */
  public static async scan(workspace: WorkspaceContext): Promise<{
    items: ResourceItem[];
    soulStat: TokenCategoryStat;
    rulesStat: TokenCategoryStat;
    skillsStat: TokenCategoryStat;
    /** Remontée vers les dossiers parents (mode Antigravity seulement). */
    antigravityParents?: AntigravityParentsInfo;
  }> {
    if (!workspace.hasWorkspace || !workspace.workspacePath) {
      return {
        items: [],
        soulStat: this.emptyStat('soul', 'local', ''),
        rulesStat: this.emptyStat('rule', 'local', ''),
        skillsStat: this.emptyStat('skill', 'local', ''),
      };
    }

    const rootPath = workspace.workspacePath;
    const items: ResourceItem[] = [];

    let skillsCharTotal = 0;
    let rulesCharTotal = 0;
    let rulesConditionalCharTotal = 0;
    let rulesPermanentCount = 0;
    let rulesConditionalCount = 0;
    let soulCharTotal = 0;
    let soulPathFound = '';

    let skillsDirFound = '';
    let rulesDirFound = '';
    const targetTool = workspace.tool;
    let antigravityParents: AntigravityParentsInfo | undefined;
    const parentSoulCandidates: Array<{ file: string; tool: 'antigravity'; absolutePath: string; inheritedFrom: string }> = [];
    /** Dossier de chaque plugin local, pour l'en-tête de sa section (F6). */
    const pluginRoots = new Map<string, string>();

    // Cumul des caractères injectés au démarrage par les règles Antigravity (F1, F3 ; 0 pour glob
    // et manual) ; règles ignorées et règles de dossier exclues
    const accountRule = (item: ResourceItem) => {
      if (!countsAtBoot(item) || !item.charCount) return;
      rulesCharTotal += item.metadata?.bootCharCount ?? 0;
      if (item.metadata?.isConditional) {
        rulesConditionalCharTotal += item.charCount;
        rulesConditionalCount++;
      } else {
        rulesPermanentCount++;
      }
    };

    // 1. Scan Antigravity (.agents ou .agent) uniquement si targetTool === 'antigravity'
    if (targetTool === 'antigravity') {
      const agentsDirName = workspace.agentsDir || '.agents';
      const agentsDir = path.isAbsolute(agentsDirName) ? agentsDirName : path.join(rootPath, agentsDirName);

      if (fs.existsSync(agentsDir)) {
        // Skills locaux, et l'ancien emplacement .agent/skills (documenté, chargement non vérifié)
        const skillsDir = path.join(agentsDir, 'skills');
        skillsDirFound = skillsDir;
        const legacySkillsDir = path.join(rootPath, LEGACY_WORKSPACE_SKILLS_DIR);
        const skillDirs = path.resolve(skillsDir) === path.resolve(legacySkillsDir) ? [legacySkillsDir] : [skillsDir, legacySkillsDir];

        for (const dir of skillDirs) {
          const legacy = path.resolve(dir) === path.resolve(legacySkillsDir);
          for (const folder of await listSkillFolders(dir)) {
            const skillItem = await buildAntigravitySkillItem(folder, {
              scope: 'local',
              fallbackDescription: (isWorkflow) => (isWorkflow ? 'Workflow local projet' : 'Compétence locale projet'),
              ...(legacy ? { idPrefix: '.agent/', legacyLocation: true } : {}),
            });
            if (skillItem.enabled) skillsCharTotal += skillItem.charCount || 0;
            items.push(skillItem);
          }
        }

        // Rules locales : .agents/rules/*.md, l'ancien .agent/rules/*.md (tous deux chargés
        // par Antigravity) et les règles déclarées par .agents/rules.json
        const rulesDir = path.join(agentsDir, 'rules');
        rulesDirFound = rulesDir;
        const ruleDirs = [rulesDir];
        for (const dirName of ANTIGRAVITY_AGENT_DIRS) {
          const candidate = path.join(rootPath, dirName, 'rules');
          if (!ruleDirs.some((dir) => path.resolve(dir) === path.resolve(candidate))) {
            ruleDirs.push(candidate);
          }
        }

        // Clé = chemin sans « .disabled » : un .md et son .md.disabled désignent la même règle,
        // le fichier actif est prioritaire
        const rulesMap = new Map<string, ResourceItem>();
        const addRule = (item: ResourceItem) => {
          const key = path.resolve(item.path).replace(/\.disabled$/, '');
          const existing = rulesMap.get(key);
          if (!existing || (!existing.enabled && item.enabled)) {
            rulesMap.set(key, item);
          }
        };

        for (const dir of ruleDirs) {
          const isPrimary = dir === rulesDir;
          for (const filePath of await listFlatRuleFiles(dir)) {
            const cleanId = path.basename(filePath).replace(/\.disabled$/, '').replace(/\.md$/, '');
            addRule(await buildAntigravityRuleItem(filePath, {
              id: isPrimary ? cleanId : `${path.basename(path.dirname(dir))}/${cleanId}`,
              scope: 'local',
              fallbackDescription: 'Règle locale du projet',
            }));
          }
        }

        const rulesJsonPath = path.join(agentsDir, 'rules.json');
        if (fs.existsSync(rulesJsonPath)) {
          for (const entry of await collectRulesJsonFiles(rulesJsonPath)) {
            if (rulesMap.has(path.resolve(entry.path).replace(/\.disabled$/, ''))) continue;
            addRule(await buildAntigravityRuleItem(entry.path, {
              id: entry.relativePath.replace(/\.disabled$/, '').replace(/\.md$/, ''),
              scope: 'local',
              fallbackDescription: 'Règle déclarée par .agents/rules.json',
              fromRulesJson: true,
            }));
          }
        }

        for (const ruleItem of rulesMap.values()) {
          accountRule(ruleItem);
          items.push(ruleItem);
        }

        // Plugins locaux Antigravity (.agents/plugins)
        const pluginsDir = path.join(agentsDir, 'plugins');
        if (fs.existsSync(pluginsDir)) {
          try {
            const pluginFolders = await fs.promises.readdir(pluginsDir, { withFileTypes: true });
            for (const pFolder of pluginFolders) {
              if (!pFolder.isDirectory()) continue;
              const pPath = path.join(pluginsDir, pFolder.name);
              pluginRoots.set(pFolder.name, pPath);

              // 1. Skills du plugin (F5 + F6 : listés deux fois)
              for (const sFolder of await listSkillFolders(path.join(pPath, 'skills'))) {
                const skillItem = await buildAntigravitySkillItem(sFolder, {
                  scope: 'local',
                  fallbackDescription: () => `Compétence du plugin ${pFolder.name}`,
                  pluginName: pFolder.name,
                });
                if (skillItem.enabled) skillsCharTotal += skillItem.charCount || 0;
                items.push(skillItem);
              }

              // 2. Rules du plugin
              const pRulesDir = path.join(pPath, 'rules');
              if (fs.existsSync(pRulesDir)) {
                for (const rPath of await listFlatRuleFiles(pRulesDir)) {
                  const cId = path.basename(rPath).replace(/\.disabled$/, '').replace(/\.md$/, '');
                  const ruleItem = await buildAntigravityRuleItem(rPath, {
                    id: `${pFolder.name}:${cId}`,
                    scope: 'local',
                    fallbackDescription: `Règle du plugin ${pFolder.name}`,
                    nameSuffix: `[Plugin: ${pFolder.name}]`,
                    pluginName: pFolder.name,
                  });
                  accountRule(ruleItem);
                  items.push(ruleItem);
                }
              }
            }
          } catch {
            // Ignorer
          }
        }
      }

      // Règles des sous-dossiers : affichées, mais jamais chargées par Antigravity (R1)
      const nestedRules = new Map<string, ResourceItem>();
      for (const source of await findNestedRuleSources(rootPath)) {
        const relativeFile = path.relative(path.join(rootPath, source.directoryScope), source.path).split(path.sep).join('/');
        const nestedItem = await buildAntigravityRuleItem(source.path, {
          id: `${source.directoryScope}/${relativeFile.replace(/\.disabled$/, '').replace(/\.md$/, '')}`,
          scope: 'local',
          fallbackDescription: `Règle limitée au dossier ${source.directoryScope}`,
          nameSuffix: `[${source.directoryScope}/]`,
          directoryScope: source.directoryScope,
          standalone: source.kind === 'standalone',
        });
        // Un .md et son .md.disabled désignent la même règle : le fichier actif est prioritaire
        const existing = nestedRules.get(nestedItem.id);
        if (!existing || (!existing.enabled && nestedItem.enabled)) {
          nestedRules.set(nestedItem.id, nestedItem);
        }
      }
      items.push(...nestedRules.values());

      // Règles des dossiers parents, jusqu'à la racine du dépôt Git : chargées avec leur
      // trigger habituel (R2), donc comptées. Sans dépôt Git, aucun parent n'est retenu.
      const parentScan = findParentRuleDirs(rootPath);
      antigravityParents = { gitRootFound: parentScan.gitRoot !== null, parentDirs: parentScan.parentDirs };
      const parentRules = new Map<string, ResourceItem>();
      for (const parentDir of parentScan.parentDirs) {
        const inheritedFrom = path.relative(rootPath, parentDir).split(path.sep).join('/');
        for (const file of PARENT_SOUL_FILES) {
          parentSoulCandidates.push({ file, tool: 'antigravity', absolutePath: path.join(parentDir, file), inheritedFrom });
        }
        for (const rulePath of await listFlatRuleFiles(path.join(parentDir, PARENT_RULES_DIR))) {
          const cleanId = path.basename(rulePath).replace(/\.disabled$/, '').replace(/\.md$/, '');
          const parentItem = await buildAntigravityRuleItem(rulePath, {
            id: `${inheritedFrom}/.agents/rules/${cleanId}`,
            scope: 'local',
            fallbackDescription: `Règle héritée du dossier parent ${inheritedFrom}`,
            nameSuffix: `[${inheritedFrom}/]`,
            inheritedFrom,
          });
          // Un .md et son .md.disabled désignent la même règle : le fichier actif est prioritaire
          const existing = parentRules.get(parentItem.id);
          if (!existing || (!existing.enabled && parentItem.enabled)) {
            parentRules.set(parentItem.id, parentItem);
          }
        }
      }
      for (const parentItem of parentRules.values()) {
        accountRule(parentItem);
        items.push(parentItem);
      }
    }

    // 2. Scan Claude Code (.claude/rules et .claude/skills) uniquement si targetTool === 'claude-code'
    if (targetTool === 'claude-code') {
      const claudeDir = path.join(rootPath, '.claude');
      if (fs.existsSync(claudeDir)) {
        const claudeSkillsDir = path.join(claudeDir, 'skills');
        if (!skillsDirFound) skillsDirFound = claudeSkillsDir;

        if (fs.existsSync(claudeSkillsDir)) {
          try {
            const entries = await fs.promises.readdir(claudeSkillsDir, { withFileTypes: true });
            for (const entry of entries) {
              if (!entry.isDirectory()) continue;
              const itemFolder = path.join(claudeSkillsDir, entry.name);
              const skillMd = path.join(itemFolder, 'SKILL.md');
              const skillMdDisabled = path.join(itemFolder, 'SKILL.md.disabled');

              const isEnabled = fs.existsSync(skillMd);
              const isDisabled = fs.existsSync(skillMdDisabled);
              if (!isEnabled && !isDisabled) continue;

              const activeFile = isEnabled ? skillMd : skillMdDisabled;
              let description = '';
              let name = entry.name;
              let rawSkillContent = '';
              let sStat: fs.Stats | null = null;
              try {
                sStat = await fs.promises.stat(activeFile);
                rawSkillContent = await fs.promises.readFile(activeFile, 'utf8');
                const { metadata } = extractFrontmatter(rawSkillContent);
                if (metadata.name && typeof metadata.name === 'string') name = metadata.name;
                if (metadata.description && typeof metadata.description === 'string') description = metadata.description;
              } catch {
                // Ignorer
              }

              const lineCount = rawSkillContent ? rawSkillContent.split(/\r\n|\r|\n/).length : 0;
              const isWarningLines = lineCount > 500;
              const isWarningNoDesc = !description || description.trim().length === 0;

              const discoverySignature = `name: ${name}\ndescription: ${description}\npath: ${activeFile}\n`;
              const charCount = discoverySignature.length;
              const tokenCount = countTokensForFile(activeFile, sStat?.size, sStat?.mtimeMs, discoverySignature);

              if (isEnabled) {
                skillsCharTotal += charCount;
              }

              items.push({
                id: entry.name,
                name,
                description: description || 'Compétence locale Claude Code',
                type: 'skill',
                scope: 'local',
                enabled: isEnabled,
                path: itemFolder,
                targetTool: 'claude-code',
                isFolder: true,
                charCount,
                tokenCount,
                lineCount,
                metadata: {
                  hasDisabledSuffix: isDisabled,
                  warningLinesExceeded: isWarningLines,
                  warningNoDescription: isWarningNoDesc,
                },
              });
            }
          } catch {
            // Ignorer
          }
        }

        const claudeRulesDir = path.join(claudeDir, 'rules');
        if (!rulesDirFound) rulesDirFound = claudeRulesDir;

        if (fs.existsSync(claudeRulesDir)) {
          try {
            const entries = await fs.promises.readdir(claudeRulesDir, { withFileTypes: true });
            const claudeRulesMap = new Map<string, ResourceItem>();

            for (const entry of entries) {
              if (!entry.isFile()) continue;

              const fileName = entry.name;
              const isMd = fileName.endsWith('.md');
              const isDisabled = fileName.endsWith('.md.disabled');

              if (!isMd && !isDisabled) continue;

              const filePath = path.join(claudeRulesDir, fileName);
              const cleanId = fileName.replace(/\.disabled$/, '').replace(/\.md$/, '');
              let title = cleanId;
              let summary = '';
              let fileCharCount = 0;
              let ruleMetadata: Record<string, any> = {};
              let rawRuleContent = '';
              let rStat: fs.Stats | null = null;

              try {
                rStat = await fs.promises.stat(filePath);
                rawRuleContent = await fs.promises.readFile(filePath, 'utf8');
                fileCharCount = rawRuleContent.length;
                const { metadata } = extractFrontmatter(rawRuleContent);
                ruleMetadata = metadata;
                const parsed = extractMarkdownTitleAndSummary(rawRuleContent);
                if (parsed.title) title = parsed.title;
                if (parsed.summary) summary = parsed.summary;
              } catch {
                // Lecture fallback
              }

              const isRuleEnabled = isMd;
              const lineCount = rawRuleContent ? rawRuleContent.split(/\r\n|\r|\n/).length : 0;
              const isCond = isRuleConditional(ruleMetadata, 'claude-code');
              const isWarningLines = lineCount > 200;
              const isWarningNoDesc = !summary || summary.trim().length === 0;
              const ruleTokenCount = countTokensForFile(filePath, rStat?.size, rStat?.mtimeMs, rawRuleContent);

              const newItem: ResourceItem = {
                id: cleanId,
                name: title,
                description: summary || 'Règle locale Claude Code',
                type: 'rule',
                scope: 'local',
                enabled: isRuleEnabled,
                path: filePath,
                targetTool: 'claude-code',
                isFolder: false,
                charCount: fileCharCount,
                tokenCount: ruleTokenCount,
                lineCount,
                metadata: {
                  ...ruleMetadata,
                  isConditional: isCond,
                  hasDisabledSuffix: isDisabled,
                  warningLinesExceeded: isWarningLines,
                  warningNoDescription: isWarningNoDesc,
                },
              };

              if (claudeRulesMap.has(cleanId)) {
                const existing = claudeRulesMap.get(cleanId)!;
                if (!existing.enabled && isRuleEnabled) {
                  claudeRulesMap.set(cleanId, newItem);
                }
              } else {
                claudeRulesMap.set(cleanId, newItem);
              }
            }

            for (const ruleItem of claudeRulesMap.values()) {
              if (ruleItem.enabled && ruleItem.charCount) {
                if (ruleItem.metadata?.isConditional) {
                  rulesCharTotal += 80;
                  rulesConditionalCharTotal += ruleItem.charCount;
                  rulesConditionalCount++;
                } else {
                  rulesCharTotal += ruleItem.charCount;
                  rulesPermanentCount++;
                }
              }
              items.push(ruleItem);
            }
          } catch {
            // Ignorer
          }
        }
      }
    }

    // 3. Scan des fichiers maîtres d'Âme locale selon targetTool
    const soulCandidates: Array<{
      file: string;
      tool: 'antigravity' | 'claude-code';
      absolutePath?: string;
      inheritedFrom?: string;
    }> =
      targetTool === 'claude-code'
        ? [{ file: 'CLAUDE.md', tool: 'claude-code' }]
        : [
            { file: 'GEMINI.md', tool: 'antigravity' },
            { file: 'AGENTS.md', tool: 'antigravity' },
            { file: '.agents/AGENTS.md', tool: 'antigravity' },
            { file: '.agents/GEMINI.md', tool: 'antigravity' },
            ...parentSoulCandidates,
          ];

    for (const candidate of soulCandidates) {
      const candidatePath = candidate.absolutePath ?? path.join(rootPath, candidate.file);
      const soulId = candidate.inheritedFrom !== undefined ? `${candidate.inheritedFrom}/${candidate.file}` : candidate.file;
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
        try {
          const stat = await fs.promises.stat(candidatePath);
          const rawContent = await fs.promises.readFile(candidatePath, 'utf8');
          const fileCharCount = rawContent.length;
          const lineCount = rawContent.split(/\r\n|\r|\n/).length;
          const { metadata: soulMetadata } = extractFrontmatter(rawContent);
          const parsed = extractMarkdownTitleAndSummary(rawContent);
          const isAntigravity = candidate.tool === 'antigravity';
          // Antigravity : enveloppe F1, corps tronqué à 24 000 octets après inclusions ; la
          // documentation ne fixe pas de limite de lignes
          const measured = isAntigravity ? await measureAntigravitySoul(rawContent, candidatePath, stat) : null;
          const tokenCount = measured
            ? measured.bootTokenCount
            : countTokensForFile(candidatePath, stat.size, stat.mtimeMs, rawContent);
          const isWarningLines = !isAntigravity && lineCount > 200;
          const isWarningSize = measured?.warningSizeExceeded ?? false;

          soulCharTotal += measured ? measured.bootCharCount : fileCharCount;
          if (!soulPathFound) soulPathFound = candidatePath;

          items.push({
            id: soulId,
            name: soulId,
            description: parsed.summary || (candidate.inheritedFrom !== undefined
              ? `Instructions héritées du dossier parent ${candidate.inheritedFrom}`
              : `Instructions fondamentales locales de l'agent (${candidate.file} racine)`),
            type: 'soul',
            scope: 'local',
            enabled: true,
            path: candidatePath,
            targetTool: candidate.tool,
            isFolder: false,
            charCount: fileCharCount,
            tokenCount,
            lineCount,
            metadata: {
              ...soulMetadata,
              isSoul: true,
              locked: true,
              ...(candidate.inheritedFrom !== undefined ? { inheritedFrom: candidate.inheritedFrom } : {}),
              ...(measured ? { byteSize: measured.byteSize, bootTokenCount: measured.bootTokenCount, bootCharCount: measured.bootCharCount } : {}),
              ...(measured && measured.truncatedBytes > 0 ? { truncatedBytes: measured.truncatedBytes, lostTokens: measured.lostTokens } : {}),
              warningLinesExceeded: isWarningLines,
              warningSizeExceeded: isWarningSize,
            },
          });
        } catch {
          // Ignorer
        }
      }
    }

    const allSkillsList = items.filter((i) => i.type === 'skill' || i.type === 'workflow');
    const allRulesList = items.filter((i) => i.type === 'rule');
    const allSoulList = items.filter((i) => i.type === 'soul');

    const activeSkillsList = allSkillsList.filter((i) => i.enabled);
    const activeSkillsCount = activeSkillsList.length;
    const skillsWarningCount = activeSkillsList.filter((i) => (
      i.metadata?.warningSizeExceeded ||
      i.metadata?.warningLinesExceeded ||
      i.metadata?.warningMcpExceeded ||
      i.metadata?.warningNoDescription
    )).length;
    // Somme directe des tokens réels de chaque élément actif (concordance absolue avec les cartes)
    const skillsTokenTotal = activeSkillsList.reduce((sum, i) => sum + (i.tokenCount || 0), 0);

    // Les règles ⛔ (jamais chargées, ignorées, ne se déclenchant jamais) ne sont pas actives,
    // mais restent comptées dans les avertissements
    const activeRulesList = allRulesList.filter((i) => i.enabled && appliesInAntigravity(i));
    const activeRulesCount = activeRulesList.length;
    const rulesWarningCount = allRulesList.filter((i) => i.enabled).filter(hasResourceWarning).length;

    // Décompte cohérent des règles :
    // - Antigravity : ce que l'agent injecte au démarrage (F1 pour les permanentes, F3 pour
    //   model_decision, 0 pour glob et manual) ; l'en-tête F2 est ajouté une fois pour toute la jauge
    // - Claude Code : tokenCount BPE réel des permanentes, ~20 tokens par conditionnelle
    //   (estimation de l'extension, non documentée)
    // - Règles ⛔ : aucun coût au boot ; règles héritées des dossiers parents : comptées
    // - rulesConditionalTokenTotal : somme des tokens BPE réels des cartes conditionnelles
    const isAntigravity = targetTool === 'antigravity';
    const bootRules = activeRulesList.filter(countsAtBoot);
    const activePermanentRules = bootRules.filter((i) => !i.metadata?.isConditional);
    const activeConditionalRules = bootRules.filter((i) => i.metadata?.isConditional);
    const permanentRulesTokens = activePermanentRules.reduce((sum, i) => sum + (i.tokenCount || 0), 0);
    const conditionalRulesBootTokens = activeConditionalRules.length * 20;
    const agyRulesBoot = isAntigravity ? antigravityRulesBootStat(bootRules) : null;
    const rulesTokenTotal = agyRulesBoot ? agyRulesBoot.tokenCount : permanentRulesTokens + conditionalRulesBootTokens;
    const rulesConditionalTokenTotal = activeConditionalRules.reduce((sum, i) => sum + (i.tokenCount || 0), 0);
    const isInherited = (i: ResourceItem) => i.metadata?.inheritedFrom !== undefined;
    const rulesInheritedCount = bootRules.filter(isInherited).length;

    const activeSoulList = allSoulList.filter((i) => i.enabled);
    const soulInheritedCount = activeSoulList.filter(isInherited).length;
    const activeSoulCount = activeSoulList.length;
    const soulWarningCount = activeSoulList.filter((i) => (
      i.metadata?.warningSizeExceeded ||
      i.metadata?.warningLinesExceeded ||
      i.metadata?.warningMcpExceeded ||
      i.metadata?.warningNoDescription
    )).length;
    // Somme directe des tokens BPE de l'Âme active
    const soulTokenTotal = activeSoulList.reduce((sum, i) => sum + (i.tokenCount || 0), 0);

    // Antigravity : en-têtes des sections de plugin (F6), qui n'appartiennent à aucune carte
    const skillsOverhead = isAntigravity ? pluginSectionHeadersTokens(allSkillsList, pluginRoots) : 0;
    const skillsTokenWithOverhead = skillsTokenTotal + skillsOverhead;

    const skillsStat: TokenCategoryStat = {
      type: 'skill',
      scope: 'local',
      activeCount: activeSkillsCount,
      totalCount: allSkillsList.length,
      charCount: skillsCharTotal,
      tokenCount: skillsTokenWithOverhead,
      warningCount: skillsWarningCount,
      percentage: Number(((skillsTokenWithOverhead / 20000) * 100).toFixed(1)),
      ...(isAntigravity ? { overheadTokens: skillsOverhead } : {}),
      directoryPath:
        skillsDirFound ||
        (targetTool === 'claude-code'
          ? path.join(rootPath, '.claude', 'skills')
          : path.join(rootPath, '.agents', 'skills')),
    };

    const rulesStat: TokenCategoryStat = {
      type: 'rule',
      scope: 'local',
      activeCount: activeRulesCount,
      totalCount: allRulesList.length,
      permanentCount: rulesPermanentCount,
      conditionalCount: rulesConditionalCount,
      conditionalTokenCount: rulesConditionalTokenTotal,
      charCount: rulesCharTotal,
      tokenCount: rulesTokenTotal,
      warningCount: rulesWarningCount,
      inheritedCount: rulesInheritedCount,
      percentage: Number(((rulesTokenTotal / 20000) * 100).toFixed(1)),
      ...(agyRulesBoot ? { conditionalIndexCount: agyRulesBoot.conditionalIndexCount, ...truncationSummary(bootRules) } : {}),
      directoryPath:
        rulesDirFound ||
        (targetTool === 'claude-code'
          ? path.join(rootPath, '.claude', 'rules')
          : path.join(rootPath, '.agents', 'rules')),
    };

    const soulStat: TokenCategoryStat = {
      type: 'soul',
      scope: 'local',
      activeCount: activeSoulCount,
      totalCount: allSoulList.length,
      charCount: soulCharTotal,
      tokenCount: soulTokenTotal,
      warningCount: soulWarningCount,
      inheritedCount: soulInheritedCount,
      percentage: Number(((soulTokenTotal / 20000) * 100).toFixed(1)),
      ...(isAntigravity ? truncationSummary(activeSoulList) : {}),
      directoryPath:
        soulPathFound ||
        (targetTool === 'claude-code'
          ? path.join(rootPath, 'CLAUDE.md')
          : path.join(rootPath, 'GEMINI.md')),
    };

    // Marquage des fixtures issues du Banc d'Essai pour permettre leur manipulation et nettoyage
    const scenarioFiles = ScenarioManager.getScenarioFiles(rootPath);
    for (const item of items) {
      if (ScenarioManager.isScenarioFixture(rootPath, item, scenarioFiles)) {
        item.metadata = {
          ...item.metadata,
          isScenarioFixture: true,
        };
      }
    }

    return {
      items,
      soulStat,
      rulesStat,
      skillsStat,
      ...(antigravityParents ? { antigravityParents } : {}),
    };
  }

  private static emptyStat(
    type: 'soul' | 'rule' | 'skill' | 'mcp',
    scope: 'global' | 'local',
    directoryPath: string
  ): TokenCategoryStat {
    return {
      type,
      scope,
      activeCount: 0,
      totalCount: 0,
      charCount: 0,
      tokenCount: 0,
      percentage: 0,
      directoryPath,
    };
  }
}
