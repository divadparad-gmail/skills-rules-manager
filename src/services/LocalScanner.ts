import * as fs from 'fs';
import * as path from 'path';
import { ResourceItem, ResourceType, TokenCategoryStat, WorkspaceContext } from '../types';
import {
  extractFrontmatter,
  extractMarkdownTitleAndSummary,
  isRuleConditional,
} from '../utils/frontmatter';
import { ScenarioManager } from './ScenarioManager';

export class LocalScanner {
  /**
   * Scanne les compétences et règles définies dans le projet actif local avec comptage réel des caractères.
   */
  public static async scan(workspace: WorkspaceContext): Promise<{
    items: ResourceItem[];
    soulStat: TokenCategoryStat;
    rulesStat: TokenCategoryStat;
    skillsStat: TokenCategoryStat;
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

    // 1. Scan Antigravity (.agents ou .agent) uniquement si targetTool === 'antigravity'
    if (targetTool === 'antigravity') {
      const agentsDirName = workspace.agentsDir || '.agents';
      const agentsDir = path.isAbsolute(agentsDirName) ? agentsDirName : path.join(rootPath, agentsDirName);

      if (fs.existsSync(agentsDir)) {
        // Skills locaux
        const skillsDir = path.join(agentsDir, 'skills');
        skillsDirFound = skillsDir;

        if (fs.existsSync(skillsDir)) {
          try {
            const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true });
            for (const entry of entries) {
              if (!entry.isDirectory()) continue;

              const itemFolder = path.join(skillsDir, entry.name);
              const skillMd = path.join(itemFolder, 'SKILL.md');
              const skillMdDisabled = path.join(itemFolder, 'SKILL.md.disabled');

              const isEnabled = fs.existsSync(skillMd);
              const isDisabled = fs.existsSync(skillMdDisabled);

              if (!isEnabled && !isDisabled) continue;

              const activeFile = isEnabled ? skillMd : skillMdDisabled;
              let description = '';
              let name = entry.name;
              let tags: string[] = [];
              let rawSkillContent = '';

              try {
                rawSkillContent = await fs.promises.readFile(activeFile, 'utf8');
                const { metadata } = extractFrontmatter(rawSkillContent);
                if (metadata.name && typeof metadata.name === 'string') {
                  name = metadata.name;
                }
                if (metadata.description && typeof metadata.description === 'string') {
                  description = metadata.description;
                }
                if (Array.isArray(metadata.tags)) {
                  tags = metadata.tags;
                }
              } catch {
                // Lecture fallback
              }

              const lineCount = rawSkillContent ? rawSkillContent.split(/\r\n|\r|\n/).length : 0;
              const isWarningLines = lineCount > 500;
              const isWarningSize = rawSkillContent.length > 24000;
              const isWarningNoDesc = !description || description.trim().length === 0;

              const isWorkflow = entry.name.startsWith('wf-') || name.startsWith('wf-');
              const type: ResourceType = isWorkflow ? 'workflow' : 'skill';

              const discoverySignature = `name: ${name}\ndescription: ${description}\npath: ${activeFile}\n`;
              const charCount = discoverySignature.length;
              const tokenCount = Math.ceil(charCount / 4);

              if (isEnabled) {
                skillsCharTotal += charCount;
              }

              items.push({
                id: entry.name,
                name,
                description: description || (isWorkflow ? 'Workflow local projet' : 'Compétence locale projet'),
                type,
                scope: 'local',
                enabled: isEnabled,
                path: itemFolder,
                targetTool: 'antigravity',
                isFolder: true,
                charCount,
                tokenCount,
                lineCount,
                metadata: {
                  tags,
                  hasDisabledSuffix: isDisabled,
                  warningLinesExceeded: isWarningLines,
                  warningSizeExceeded: isWarningSize,
                  warningNoDescription: isWarningNoDesc,
                },
              });
            }
          } catch {
            // Ignorer
          }
        }

        // Rules locales (.agents/rules)
        const rulesDir = path.join(agentsDir, 'rules');
        rulesDirFound = rulesDir;

        if (fs.existsSync(rulesDir)) {
          try {
            const entries = await fs.promises.readdir(rulesDir, { withFileTypes: true });
            const rulesMap = new Map<string, ResourceItem>();

            for (const entry of entries) {
              if (!entry.isFile()) continue;

              const fileName = entry.name;
              const isMd = fileName.endsWith('.md');
              const isDisabled = fileName.endsWith('.md.disabled');

              if (!isMd && !isDisabled) continue;

              const filePath = path.join(rulesDir, fileName);
              const cleanId = fileName.replace(/\.disabled$/, '').replace(/\.md$/, '');
              let title = cleanId;
              let summary = '';
              let fileCharCount = 0;
              let parsedMetadata: Record<string, unknown> = {};

              let rawContent = '';
              try {
                rawContent = await fs.promises.readFile(filePath, 'utf8');
                fileCharCount = rawContent.length;
                const parsed = extractMarkdownTitleAndSummary(rawContent);
                if (parsed.title) title = parsed.title;
                if (parsed.summary) summary = parsed.summary;
                parsedMetadata = extractFrontmatter(rawContent).metadata;
              } catch {
                // Lecture fallback
              }

              const lineCount = rawContent ? rawContent.split(/\r\n|\r|\n/).length : 0;
              const isConditional = isRuleConditional(parsedMetadata, 'antigravity');
              const isWarningSize = fileCharCount > 24000;
              const isWarningLines = lineCount > 200;
              const isWarningNoDesc = !summary || summary.trim().length === 0;
              const isRuleEnabled = isMd;
              const ruleTokenCount = Math.ceil(fileCharCount / 4);

              const newItem: ResourceItem = {
                id: cleanId,
                name: title,
                description: summary || 'Règle locale du projet',
                type: 'rule',
                scope: 'local',
                enabled: isRuleEnabled,
                path: filePath,
                targetTool: 'antigravity',
                isFolder: false,
                charCount: fileCharCount,
                tokenCount: ruleTokenCount,
                lineCount,
                metadata: {
                  hasDisabledSuffix: isDisabled,
                  isConditional,
                  warningSizeExceeded: isWarningSize,
                  warningLinesExceeded: isWarningLines,
                  warningNoDescription: isWarningNoDesc,
                },
              };

              if (rulesMap.has(cleanId)) {
                // Doublon sur le disque ! Priorité au fichier actif (.md)
                const existing = rulesMap.get(cleanId)!;
                if (!existing.enabled && isRuleEnabled) {
                  rulesMap.set(cleanId, newItem);
                }
              } else {
                rulesMap.set(cleanId, newItem);
              }
            }

            for (const ruleItem of rulesMap.values()) {
              if (ruleItem.enabled && ruleItem.charCount) {
                if (ruleItem.metadata?.isConditional) {
                  rulesCharTotal += 80; // Métadonnées au boot
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

        // Plugins locaux Antigravity (.agents/plugins)
        const pluginsDir = path.join(agentsDir, 'plugins');
        if (fs.existsSync(pluginsDir)) {
          try {
            const pluginFolders = await fs.promises.readdir(pluginsDir, { withFileTypes: true });
            for (const pFolder of pluginFolders) {
              if (!pFolder.isDirectory()) continue;
              const pPath = path.join(pluginsDir, pFolder.name);

              // 1. Skills du plugin
              const pSkillsDir = path.join(pPath, 'skills');
              if (fs.existsSync(pSkillsDir)) {
                try {
                  const pSkillEntries = await fs.promises.readdir(pSkillsDir, { withFileTypes: true });
                  for (const sEntry of pSkillEntries) {
                    if (!sEntry.isDirectory()) continue;
                    const sFolder = path.join(pSkillsDir, sEntry.name);
                    const sMd = path.join(sFolder, 'SKILL.md');
                    const sMdDis = path.join(sFolder, 'SKILL.md.disabled');
                    const isEn = fs.existsSync(sMd);
                    const isDis = fs.existsSync(sMdDis);
                    if (!isEn && !isDis) continue;

                    const actFile = isEn ? sMd : sMdDis;
                    let desc = '';
                    let sName = sEntry.name;
                    let rawContent = '';
                    try {
                      rawContent = await fs.promises.readFile(actFile, 'utf8');
                      const { metadata } = extractFrontmatter(rawContent);
                      if (metadata.name && typeof metadata.name === 'string') sName = metadata.name;
                      if (metadata.description && typeof metadata.description === 'string') desc = metadata.description;
                    } catch {
                      // Ignorer
                    }

                    const lineCount = rawContent ? rawContent.split(/\r\n|\r|\n/).length : 0;
                    const isWarnLines = lineCount > 500;
                    const isWarnSize = rawContent.length > 24000;
                    const isWarnNoDesc = !desc || desc.trim().length === 0;

                    const discoverySig = `name: ${sName}\ndescription: ${desc}\npath: ${actFile}\n`;
                    const cCount = discoverySig.length;
                    const tCount = Math.ceil(cCount / 4);
                    if (isEn) skillsCharTotal += cCount;

                    items.push({
                      id: `${pFolder.name}:${sEntry.name}`,
                      name: `${sName} [Plugin: ${pFolder.name}]`,
                      description: desc || `Compétence du plugin ${pFolder.name}`,
                      type: sEntry.name.startsWith('wf-') ? 'workflow' : 'skill',
                      scope: 'local',
                      enabled: isEn,
                      path: sFolder,
                      targetTool: 'antigravity',
                      isFolder: true,
                      charCount: cCount,
                      tokenCount: tCount,
                      lineCount,
                      metadata: {
                        pluginName: pFolder.name,
                        hasDisabledSuffix: isDis,
                        warningLinesExceeded: isWarnLines,
                        warningSizeExceeded: isWarnSize,
                        warningNoDescription: isWarnNoDesc,
                      },
                    });
                  }
                } catch {
                  // Ignorer
                }
              }

              // 2. Rules du plugin
              const pRulesDir = path.join(pPath, 'rules');
              if (fs.existsSync(pRulesDir)) {
                try {
                  const pRuleEntries = await fs.promises.readdir(pRulesDir, { withFileTypes: true });
                  for (const rEntry of pRuleEntries) {
                    if (!rEntry.isFile()) continue;
                    const fName = rEntry.name;
                    const isM = fName.endsWith('.md');
                    const isD = fName.endsWith('.md.disabled');
                    if (!isM && !isD) continue;

                    const rPath = path.join(pRulesDir, fName);
                    const cId = fName.replace(/\.disabled$/, '').replace(/\.md$/, '');
                    let rTitle = cId;
                    let rSummary = '';
                    let fCount = 0;
                    let pFm: Record<string, unknown> = {};
                    let rawRuleContent = '';
                    try {
                      rawRuleContent = await fs.promises.readFile(rPath, 'utf8');
                      fCount = rawRuleContent.length;
                      const parsed = extractMarkdownTitleAndSummary(rawRuleContent);
                      if (parsed.title) rTitle = parsed.title;
                      if (parsed.summary) rSummary = parsed.summary;
                      pFm = extractFrontmatter(rawRuleContent).metadata;
                    } catch {
                      // Ignorer
                    }

                    const ruleLineCount = rawRuleContent ? rawRuleContent.split(/\r\n|\r|\n/).length : 0;
                    const isCond = isRuleConditional(pFm, 'antigravity');
                    const isWarn = fCount > 24000;
                    const isWarnRuleLines = ruleLineCount > 200;
                    const isWarnRuleNoDesc = !rSummary || rSummary.trim().length === 0;
                    const isEn = isM;
                    const tCount = Math.ceil(fCount / 4);

                    if (isEn) {
                      if (isCond) {
                        rulesCharTotal += 80;
                        rulesConditionalCharTotal += fCount;
                        rulesConditionalCount++;
                      } else {
                        rulesCharTotal += fCount;
                        rulesPermanentCount++;
                      }
                    }

                    items.push({
                      id: `${pFolder.name}:${cId}`,
                      name: `${rTitle} [Plugin: ${pFolder.name}]`,
                      description: rSummary || `Règle du plugin ${pFolder.name}`,
                      type: 'rule',
                      scope: 'local',
                      enabled: isEn,
                      path: rPath,
                      targetTool: 'antigravity',
                      isFolder: false,
                      charCount: fCount,
                      tokenCount: tCount,
                      lineCount: ruleLineCount,
                      metadata: {
                        pluginName: pFolder.name,
                        isConditional: isCond,
                        warningSizeExceeded: isWarn,
                        warningLinesExceeded: isWarnRuleLines,
                        warningNoDescription: isWarnRuleNoDesc,
                        hasDisabledSuffix: isD,
                      },
                    });
                  }
                } catch {
                  // Ignorer
                }
              }
            }
          } catch {
            // Ignorer
          }
        }
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
              try {
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
              const tokenCount = Math.ceil(charCount / 4);

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

              try {
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
              const ruleTokenCount = Math.ceil(fileCharCount / 4);

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
    const soulCandidates: Array<{ file: string; tool: 'antigravity' | 'claude-code' }> =
      targetTool === 'claude-code'
        ? [{ file: 'CLAUDE.md', tool: 'claude-code' }]
        : [
            { file: 'GEMINI.md', tool: 'antigravity' },
            { file: 'AGENTS.md', tool: 'antigravity' },
          ];

    for (const candidate of soulCandidates) {
      const candidatePath = path.join(rootPath, candidate.file);
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
        try {
          const rawContent = await fs.promises.readFile(candidatePath, 'utf8');
          const fileCharCount = rawContent.length;
          const lineCount = rawContent.split(/\r\n|\r|\n/).length;
          const { metadata: soulMetadata } = extractFrontmatter(rawContent);
          const parsed = extractMarkdownTitleAndSummary(rawContent);
          const tokenCount = Math.ceil(fileCharCount / 4);
          const isWarningLines = lineCount > 200;
          const isWarningSize = candidate.tool === 'antigravity' && fileCharCount > 24000;

          soulCharTotal += fileCharCount;
          if (!soulPathFound) soulPathFound = candidatePath;

          items.push({
            id: candidate.file,
            name: candidate.file,
            description: parsed.summary || `Instructions fondamentales locales de l'agent (${candidate.file} racine)`,
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

    const activeSkillsCount = allSkillsList.filter((i) => i.enabled).length;
    const skillsWarningCount = allSkillsList.filter((i) => i.enabled && (
      i.metadata?.warningSizeExceeded ||
      i.metadata?.warningLinesExceeded ||
      i.metadata?.warningMcpExceeded ||
      i.metadata?.warningNoDescription
    )).length;
    const skillsTokenTotal = Math.ceil(skillsCharTotal / 4);

    const activeRulesCount = allRulesList.filter((i) => i.enabled).length;
    const rulesWarningCount = allRulesList.filter((i) => i.enabled && (
      i.metadata?.warningSizeExceeded ||
      i.metadata?.warningLinesExceeded ||
      i.metadata?.warningMcpExceeded ||
      i.metadata?.warningNoDescription
    )).length;
    const rulesTokenTotal = Math.ceil(rulesCharTotal / 4);

    const activeSoulCount = allSoulList.filter((i) => i.enabled).length;
    const soulWarningCount = allSoulList.filter((i) => i.enabled && (
      i.metadata?.warningSizeExceeded ||
      i.metadata?.warningLinesExceeded ||
      i.metadata?.warningMcpExceeded ||
      i.metadata?.warningNoDescription
    )).length;
    const soulTokenTotal = Math.ceil(soulCharTotal / 4);

    const skillsStat: TokenCategoryStat = {
      type: 'skill',
      scope: 'local',
      activeCount: activeSkillsCount,
      totalCount: allSkillsList.length,
      charCount: skillsCharTotal,
      tokenCount: skillsTokenTotal,
      warningCount: skillsWarningCount,
      percentage: Number(((skillsTokenTotal / 20000) * 100).toFixed(1)),
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
      conditionalTokenCount: Math.ceil(rulesConditionalCharTotal / 4),
      charCount: rulesCharTotal,
      tokenCount: rulesTokenTotal,
      warningCount: rulesWarningCount,
      percentage: Number(((rulesTokenTotal / 20000) * 100).toFixed(1)),
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
      percentage: Number(((soulTokenTotal / 20000) * 100).toFixed(1)),
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
