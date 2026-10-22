import * as fs from 'fs';
import * as path from 'path';
import { ResourceItem, ResourceType, TargetTool, TokenCategoryStat } from '../types';
import {
  extractFrontmatter,
  extractMarkdownTitleAndSummary,
  isRuleConditional,
} from '../utils/frontmatter';
import {
  getEffectiveGlobalAntigravityPath,
  getEffectiveGlobalClaudePath,
} from '../utils/paths';
import { countTokens, countTokensForFile } from '../utils/tokenizer';
import { measureAntigravitySoul } from '../utils/antigravityRules';
import { appliesInAntigravity, buildAntigravityRuleItem, countsAtBoot, hasResourceWarning } from './antigravityRuleItem';
import { listFlatRuleFiles } from './antigravityRuleSources';

let vscodeModule: any = null;
try {
  vscodeModule = require('vscode');
} catch {
  // Hors hôte VS Code (tests unitaires)
}

export class GlobalScanner {
  /**
   * Lit la liste des exclusions déclarées dans skills.json
   */
  public static async getExcludedSkillIds(configDir: string): Promise<string[]> {
    const skillsJsonPath = path.join(configDir, 'skills.json');
    if (!fs.existsSync(skillsJsonPath)) {
      return [];
    }
    try {
      const raw = await fs.promises.readFile(skillsJsonPath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.exclude)) {
        return data.exclude.map((id: unknown) => String(id));
      }
    } catch {
      // Ignorer si JSON invalide ou inaccessible
    }
    return [];
  }

  /**
   * Scanne le dossier global selon l'outil actif (Antigravity ou Claude Code).
   */
  public static async scan(
    customGlobalPath?: string,
    targetTool: TargetTool = 'antigravity'
  ): Promise<{
    items: ResourceItem[];
    soulStat: TokenCategoryStat;
    rulesStat: TokenCategoryStat;
    skillsStat: TokenCategoryStat;
    excludedIds: string[];
  }> {
    const globalPath = getEffectiveGlobalAntigravityPath(customGlobalPath);

    const items: ResourceItem[] = [];
    const excludedIds = await this.getExcludedSkillIds(globalPath);
    const excludedSet = new Set(excludedIds);

    let skillsCharTotal = 0;
    let rulesCharTotal = 0;
    let rulesConditionalCharTotal = 0;
    let rulesPermanentCount = 0;
    let rulesConditionalCount = 0;
    let soulCharTotal = 0;
    let soulPathFound = '';

    // Cumul des caractères des règles chargées au démarrage (règles ignorées par l'agent exclues)
    const accountRule = (item: ResourceItem) => {
      if (!countsAtBoot(item) || !item.charCount) return;
      if (item.metadata?.isConditional) {
        rulesCharTotal += 80;
        rulesConditionalCharTotal += item.charCount;
        rulesConditionalCount++;
      } else {
        rulesCharTotal += item.charCount;
        rulesPermanentCount++;
      }
    };

    const skillsDir = path.join(globalPath, 'skills');
    const claudeGlobalPath = getEffectiveGlobalClaudePath();

    // 1.A. Si Antigravity : scan des skills globaux (~/.gemini/config/skills)
    if (targetTool === 'antigravity' && fs.existsSync(skillsDir)) {
      try {
        const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const itemFolder = path.join(skillsDir, entry.name);
          const skillMd = path.join(itemFolder, 'SKILL.md');
          const skillMdDisabled = path.join(itemFolder, 'SKILL.md.disabled');

          const hasEnabledFile = fs.existsSync(skillMd);
          const hasDisabledFile = fs.existsSync(skillMdDisabled);

          if (!hasEnabledFile && !hasDisabledFile) continue;

          // Si le fichier physique est .disabled OU s'il est exclu dans skills.json
          const isPhysicallyEnabled = hasEnabledFile;
          const isExcluded = excludedSet.has(entry.name);
          const isEnabled = isPhysicallyEnabled && !isExcluded;

          const activeFile = hasEnabledFile ? skillMd : skillMdDisabled;
          let description = '';
          let name = entry.name;
          let tags: string[] = [];
          let rawContent = '';
          let fileStat: fs.Stats | null = null;

          try {
            fileStat = await fs.promises.stat(activeFile);
            rawContent = await fs.promises.readFile(activeFile, 'utf8');
            const { metadata } = extractFrontmatter(rawContent);
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

          const lineCount = rawContent ? rawContent.split(/\r\n|\r|\n/).length : 0;
          const isWarningLines = lineCount > 500;
          const isWarningSize = rawContent.length > 24000;
          const isWarningNoDesc = !description || description.trim().length === 0;

          const isWorkflow = entry.name.startsWith('wf-') || name.startsWith('wf-');
          const type: ResourceType = isWorkflow ? 'workflow' : 'skill';

          // Décompte réel de caractères pour la signature de découverte Tier-1
          const discoverySignature = `name: ${name}\ndescription: ${description}\npath: ${activeFile}\n`;
          const charCount = discoverySignature.length;
          const tokenCount = countTokensForFile(activeFile, fileStat?.size, fileStat?.mtimeMs, discoverySignature);

          if (isEnabled) {
            skillsCharTotal += charCount;
          }

          items.push({
            id: entry.name,
            name,
            description: description || (isWorkflow ? 'Workflow Antigravity' : 'Compétence Antigravity'),
            type,
            scope: 'global',
            enabled: isEnabled,
            path: itemFolder,
            targetTool: 'antigravity',
            isFolder: true,
            charCount,
            tokenCount,
            lineCount,
            metadata: {
              tags,
              hasDisabledSuffix: hasDisabledFile,
              excludedInJson: isExcluded,
              warningLinesExceeded: isWarningLines,
              warningSizeExceeded: isWarningSize,
              warningNoDescription: isWarningNoDesc,
            },
          });
        }
      } catch {
        // En cas d'erreur de lecture du répertoire
      }
    }

    // 1.B. Si Claude Code : scan des skills globaux (~/.claude/skills)
    const claudeSkillsDir = path.join(claudeGlobalPath, 'skills');
    if (targetTool === 'claude-code' && fs.existsSync(claudeSkillsDir)) {
      try {
        const entries = await fs.promises.readdir(claudeSkillsDir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const itemFolder = path.join(claudeSkillsDir, entry.name);
          const skillMd = path.join(itemFolder, 'SKILL.md');
          const skillMdDisabled = path.join(itemFolder, 'SKILL.md.disabled');

          const hasEnabledFile = fs.existsSync(skillMd);
          const hasDisabledFile = fs.existsSync(skillMdDisabled);

          if (!hasEnabledFile && !hasDisabledFile) continue;

          const isEnabled = hasEnabledFile;
          const activeFile = hasEnabledFile ? skillMd : skillMdDisabled;
          let description = '';
          let name = entry.name;
          let tags: string[] = [];
          let rawContent = '';
          let fileStat: fs.Stats | null = null;

          try {
            fileStat = await fs.promises.stat(activeFile);
            rawContent = await fs.promises.readFile(activeFile, 'utf8');
            const { metadata } = extractFrontmatter(rawContent);
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

          const lineCount = rawContent ? rawContent.split(/\r\n|\r|\n/).length : 0;
          const isWarningLines = lineCount > 500;
          const isWarningNoDesc = !description || description.trim().length === 0;

          const discoverySignature = `name: ${name}\ndescription: ${description}\npath: ${activeFile}\n`;
          const charCount = discoverySignature.length;
          const tokenCount = countTokensForFile(activeFile, fileStat?.size, fileStat?.mtimeMs, discoverySignature);

          if (isEnabled) {
            skillsCharTotal += charCount;
          }

          items.push({
            id: entry.name,
            name,
            description: description || 'Compétence globale Claude Code',
            type: 'skill',
            scope: 'global',
            enabled: isEnabled,
            path: itemFolder,
            targetTool: 'claude-code',
            isFolder: true,
            charCount,
            tokenCount,
            lineCount,
            metadata: {
              tags,
              hasDisabledSuffix: hasDisabledFile,
              warningLinesExceeded: isWarningLines,
              warningNoDescription: isWarningNoDesc,
            },
          });
        }
      } catch {
        // Ignorer
      }
    }

    // 2. Scan du fichier maître d'Âme selon l'outil actif
    if (targetTool === 'antigravity') {
      // Âmes globales Antigravity : fichiers autonomes toujours actifs, tous chargés et cumulés
      // (~/.gemini/AGENTS.md, ~/.gemini/GEMINI.md, ~/.gemini/config/AGENTS.md, ~/.gemini/config/GEMINI.md)
      const geminiRoot = path.dirname(globalPath);
      const soulCandidates = [
        { id: 'AGENTS.md', path: path.join(geminiRoot, 'AGENTS.md') },
        { id: 'GEMINI.md', path: path.join(geminiRoot, 'GEMINI.md') },
        { id: 'config/AGENTS.md', path: path.join(globalPath, 'AGENTS.md') },
        { id: 'config/GEMINI.md', path: path.join(globalPath, 'GEMINI.md') },
      ];

      for (const candidate of soulCandidates) {
        if (fs.existsSync(candidate.path) && fs.statSync(candidate.path).isFile()) {
          try {
            const stat = await fs.promises.stat(candidate.path);
            const rawContent = await fs.promises.readFile(candidate.path, 'utf8');
            const fileCharCount = rawContent.length;
            const lineCount = rawContent.split(/\r\n|\r|\n/).length;
            const parsed = extractMarkdownTitleAndSummary(rawContent);
            const measured = await measureAntigravitySoul(rawContent, candidate.path);
            const ruleTokenCount = measured.expandedTokenCount
              ?? countTokensForFile(candidate.path, stat.size, stat.mtimeMs, rawContent);

            soulCharTotal += fileCharCount;
            if (!soulPathFound) soulPathFound = candidate.path;

            items.push({
              id: candidate.id,
              name: candidate.id,
              description: parsed.summary || 'Instructions fondamentales globales d\'Antigravity (Niveau 0)',
              type: 'soul',
              scope: 'global',
              enabled: true,
              path: candidate.path,
              targetTool: 'antigravity',
              isFolder: false,
              charCount: fileCharCount,
              tokenCount: ruleTokenCount,
              lineCount,
              metadata: {
                isSoul: true,
                locked: true,
                byteSize: measured.byteSize,
                warningSizeExceeded: measured.warningSizeExceeded,
              },
            });
          } catch {
            // Ignorer
          }
        }
      }
    } else {
      // Âme globale Claude Code (CLAUDE.md)
      const claudeGlobalCandidates = [
        path.join(claudeGlobalPath, 'CLAUDE.md'),
      ];
      for (const claudePath of claudeGlobalCandidates) {
        if (fs.existsSync(claudePath) && fs.statSync(claudePath).isFile()) {
          try {
            const stat = await fs.promises.stat(claudePath);
            const rawContent = await fs.promises.readFile(claudePath, 'utf8');
            const fileCharCount = rawContent.length;
            const lineCount = rawContent.split(/\r\n|\r|\n/).length;
            const parsed = extractMarkdownTitleAndSummary(rawContent);
            const tokenCount = countTokensForFile(claudePath, stat.size, stat.mtimeMs, rawContent);
            const isWarningLines = lineCount > 200;

            soulCharTotal += fileCharCount;
            soulPathFound = claudePath;

            items.push({
              id: 'CLAUDE.md',
              name: 'CLAUDE.md',
              description: parsed.summary || 'Instructions fondamentales globales de Claude Code',
              type: 'soul',
              scope: 'global',
              enabled: true,
              path: claudePath,
              targetTool: 'claude-code',
              isFolder: false,
              charCount: fileCharCount,
              tokenCount,
              lineCount,
              metadata: {
                isSoul: true,
                locked: true,
                warningLinesExceeded: isWarningLines,
              },
            });
            break;
          } catch {
            // Ignorer
          }
        }
      }
    }

    // 3. Scan des règles globales et plugins
    if (targetTool === 'antigravity') {
      // Règles globales modulaires : ~/.gemini/config/rules/*.md uniquement (seul emplacement documenté)
      const rulesMap = new Map<string, ResourceItem>();

      for (const filePath of await listFlatRuleFiles(path.join(globalPath, 'rules'))) {
        const cleanId = path.basename(filePath).replace(/\.disabled$/, '').replace(/\.md$/, '');
        const newItem = await buildAntigravityRuleItem(filePath, {
          id: cleanId,
          scope: 'global',
          fallbackDescription: 'Règle globale Antigravity',
          spreadFrontmatter: true,
        });

        // Un .md et son .md.disabled désignent la même règle : le fichier actif est prioritaire
        const existing = rulesMap.get(cleanId);
        if (!existing || (!existing.enabled && newItem.enabled)) {
          rulesMap.set(cleanId, newItem);
        }
      }

      // Consolidation unique des règles globales trouvées
      for (const ruleItem of rulesMap.values()) {
        accountRule(ruleItem);
        items.push(ruleItem);
      }

      // Scan des plugins globaux sous ~/.gemini/config/plugins/
      const pluginsDir = path.join(globalPath, 'plugins');
      if (fs.existsSync(pluginsDir)) {
        try {
          const pluginFolders = await fs.promises.readdir(pluginsDir, { withFileTypes: true });
          for (const pFolder of pluginFolders) {
            if (!pFolder.isDirectory()) continue;

            const pluginRoot = path.join(pluginsDir, pFolder.name);

            // Skills internes du plugin global
            const pSkillsDir = path.join(pluginRoot, 'skills');
            if (fs.existsSync(pSkillsDir)) {
              try {
                const pSkillEntries = await fs.promises.readdir(pSkillsDir, { withFileTypes: true });
                for (const pEntry of pSkillEntries) {
                  if (!pEntry.isDirectory()) continue;
                  const itemFolder = path.join(pSkillsDir, pEntry.name);
                  const skillMd = path.join(itemFolder, 'SKILL.md');
                  const skillMdDisabled = path.join(itemFolder, 'SKILL.md.disabled');

                  const isEnabled = fs.existsSync(skillMd);
                  const isDisabled = fs.existsSync(skillMdDisabled);
                  if (!isEnabled && !isDisabled) continue;

                  const activeFile = isEnabled ? skillMd : skillMdDisabled;
                  let description = '';
                  let name = pEntry.name;
                  let tags: string[] = [];
                  let rawContent = '';
                  let fileStat: fs.Stats | null = null;

                  try {
                    fileStat = await fs.promises.stat(activeFile);
                    rawContent = await fs.promises.readFile(activeFile, 'utf8');
                    const { metadata } = extractFrontmatter(rawContent);
                    if (metadata.name && typeof metadata.name === 'string') name = metadata.name;
                    if (metadata.description && typeof metadata.description === 'string') description = metadata.description;
                    if (Array.isArray(metadata.tags)) tags = metadata.tags;
                  } catch {
                    // Ignorer
                  }

                  const lineCount = rawContent ? rawContent.split(/\r\n|\r|\n/).length : 0;
                  const isWarnLines = lineCount > 500;
                  const isWarnSize = rawContent.length > 24000;
                  const isWarnNoDesc = !description || description.trim().length === 0;

                  const isWorkflow = pEntry.name.startsWith('wf-') || name.startsWith('wf-');
                  const discoverySignature = `name: ${name}\ndescription: ${description}\npath: ${activeFile}\n`;
                  const charCount = discoverySignature.length;
                  const tokenCount = countTokensForFile(activeFile, fileStat?.size, fileStat?.mtimeMs, discoverySignature);

                  if (isEnabled) {
                    skillsCharTotal += charCount;
                  }

                  items.push({
                    id: `${pFolder.name}:${pEntry.name}`,
                    name: `${name} [Plugin: ${pFolder.name}]`,
                    description: description || `Skill du plugin global ${pFolder.name}`,
                    type: isWorkflow ? 'workflow' : 'skill',
                    scope: 'global',
                    enabled: isEnabled,
                    path: itemFolder,
                    targetTool: 'antigravity',
                    isFolder: true,
                    charCount,
                    tokenCount,
                    lineCount,
                    metadata: {
                      tags,
                      pluginName: pFolder.name,
                      hasDisabledSuffix: isDisabled,
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

            // Rules internes du plugin global
            const pRulesDir = path.join(pluginRoot, 'rules');
            if (fs.existsSync(pRulesDir)) {
              for (const rPath of await listFlatRuleFiles(pRulesDir)) {
                const cId = path.basename(rPath).replace(/\.disabled$/, '').replace(/\.md$/, '');
                const ruleItem = await buildAntigravityRuleItem(rPath, {
                  id: `${pFolder.name}:${cId}`,
                  scope: 'global',
                  fallbackDescription: `Règle du plugin global ${pFolder.name}`,
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
    } else {
      // 3.B. Règles globales Claude Code (~/.claude/rules)
      const claudeRulesDir = path.join(claudeGlobalPath, 'rules');
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
            let fileStat: fs.Stats | null = null;

            try {
              fileStat = await fs.promises.stat(filePath);
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
            const ruleTokenCount = countTokensForFile(filePath, fileStat?.size, fileStat?.mtimeMs, rawRuleContent);

            const newItem: ResourceItem = {
              id: cleanId,
              name: title,
              description: summary || 'Règle globale Claude Code',
              type: 'rule',
              scope: 'global',
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
                warningLinesExceeded: isWarningLines,
                warningNoDescription: isWarningNoDesc,
                hasDisabledSuffix: isDisabled,
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

    // Les règles ⛔ (ignorées, ne se déclenchant jamais) ne sont pas actives,
    // mais restent comptées dans les avertissements
    const activeRulesList = allRulesList.filter((i) => i.enabled && appliesInAntigravity(i));
    const activeRulesCount = activeRulesList.length;
    const rulesWarningCount = allRulesList.filter((i) => i.enabled).filter(hasResourceWarning).length;

    // Décompte cohérent des règles :
    // - Règles permanentes : accumulation de leur tokenCount BPE réel
    // - Règles conditionnelles : ~20 tokens au boot (estimation de l'extension, non documentée)
    // - Règles ⛔ : aucun coût au boot
    // - rulesConditionalTokenTotal : somme des tokens BPE réels des cartes conditionnelles
    const bootRules = activeRulesList.filter(countsAtBoot);
    const activePermanentRules = bootRules.filter((i) => !i.metadata?.isConditional);
    const activeConditionalRules = bootRules.filter((i) => i.metadata?.isConditional);
    const permanentRulesTokens = activePermanentRules.reduce((sum, i) => sum + (i.tokenCount || 0), 0);
    const conditionalRulesBootTokens = activeConditionalRules.length * 20;
    const rulesTokenTotal = permanentRulesTokens + conditionalRulesBootTokens;
    const rulesConditionalTokenTotal = activeConditionalRules.reduce((sum, i) => sum + (i.tokenCount || 0), 0);

    const activeSoulList = allSoulList.filter((i) => i.enabled);
    const activeSoulCount = activeSoulList.length;
    const soulWarningCount = activeSoulList.filter((i) => (
      i.metadata?.warningSizeExceeded ||
      i.metadata?.warningLinesExceeded ||
      i.metadata?.warningMcpExceeded ||
      i.metadata?.warningNoDescription
    )).length;
    // Somme directe des tokens BPE de l'Âme active
    const soulTokenTotal = activeSoulList.reduce((sum, i) => sum + (i.tokenCount || 0), 0);

    const defaultSkillsDir = targetTool === 'claude-code' ? path.join(claudeGlobalPath, 'skills') : skillsDir;
    const defaultRulesDir = targetTool === 'claude-code' ? path.join(claudeGlobalPath, 'rules') : path.join(globalPath, 'rules');

    const skillsStat: TokenCategoryStat = {
      type: 'skill',
      scope: 'global',
      activeCount: activeSkillsCount,
      totalCount: allSkillsList.length,
      charCount: skillsCharTotal,
      tokenCount: skillsTokenTotal,
      warningCount: skillsWarningCount,
      percentage: Number(((skillsTokenTotal / 20000) * 100).toFixed(1)),
      directoryPath: defaultSkillsDir,
    };

    const rulesStat: TokenCategoryStat = {
      type: 'rule',
      scope: 'global',
      activeCount: activeRulesCount,
      totalCount: allRulesList.length,
      permanentCount: rulesPermanentCount,
      conditionalCount: rulesConditionalCount,
      conditionalTokenCount: rulesConditionalTokenTotal,
      charCount: rulesCharTotal,
      tokenCount: rulesTokenTotal,
      warningCount: rulesWarningCount,
      percentage: Number(((rulesTokenTotal / 20000) * 100).toFixed(1)),
      directoryPath: defaultRulesDir,
    };

    const defaultSoulPath =
      targetTool === 'claude-code'
        ? path.join(claudeGlobalPath, 'CLAUDE.md')
        : path.join(path.dirname(globalPath), 'GEMINI.md');

    const soulStat: TokenCategoryStat = {
      type: 'soul',
      scope: 'global',
      activeCount: activeSoulCount,
      totalCount: allSoulList.length,
      charCount: soulCharTotal,
      tokenCount: soulTokenTotal,
      warningCount: soulWarningCount,
      percentage: Number(((soulTokenTotal / 20000) * 100).toFixed(1)),
      directoryPath: soulPathFound || defaultSoulPath,
    };

    // Marquage des fixtures de test de scénario (ex: règle doublon de test)
    for (const item of items) {
      if (item.id === 'rule-test-doublon' || item.name === 'rule-test-doublon' || item.name === 'rule-test-doublon.md') {
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
      excludedIds,
    };
  }
}
