import * as fs from 'fs';
import * as path from 'path';
import { NasStatus, ResourceItem, ResourceType } from '../types';
import { extractFrontmatter, extractMarkdownTitleAndSummary } from '../utils/frontmatter';
import { countTokens, countTokensForFile } from '../utils/tokenizer';
import { buildAntigravityRuleItem } from './antigravityRuleItem';

let vscodeModule: any = null;
try {
  vscodeModule = require('vscode');
} catch {
  // Hors hôte VS Code (tests unitaires)
}

export class NasScanner {
  /**
   * Extrait le nom d'hôte d'un chemin UNC (ex: "\\Nas1\share" -> "nas1")
   */
  public static getUncHost(targetPath: string): string | null {
    if (!targetPath) return null;
    const normalized = targetPath.replace(/\//g, '\\');
    const match = normalized.match(/^\\\\([^\\]+)/);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Vérifie et autorise automatiquement l'hôte UNC dans la configuration
   * de sécurité VS Code `security.allowedUNCHosts` pour éviter le blocage.
   */
  public static async ensureAllowedUNCHost(targetPath: string): Promise<boolean> {
    const host = this.getUncHost(targetPath);
    if (!host) return false;

    try {
      if (!vscodeModule || !vscodeModule.workspace) return false;
      const securityConfig = vscodeModule.workspace.getConfiguration('security');
      const allowedHosts = securityConfig.get('allowedUNCHosts') || [];
      const isAlreadyAllowed = Array.isArray(allowedHosts) && allowedHosts.some((h: string) => h.toLowerCase() === host.toLowerCase());

      if (!isAlreadyAllowed) {
        const updated = [...(Array.isArray(allowedHosts) ? allowedHosts : []), host];
        await securityConfig.update('allowedUNCHosts', updated, vscodeModule.ConfigurationTarget.Global);
        return true;
      }
    } catch {
      // Ignorer si les droits de configuration échouent
    }
    return false;
  }

  /**
   * Vérifie la disponibilité du NAS de façon asynchrone et non-bloquante avec timeout.
   */
  public static async checkNasAccess(nasPath: string, timeoutMs = 5000): Promise<{ available: boolean; error?: string }> {
    if (!nasPath || typeof nasPath !== 'string') {
      return { available: false, error: 'Chemin du catalogue non spécifié' };
    }

    const cleanPath = nasPath.trim().replace(/[\/\\]+$/, '');

    // 1. Autoriser proactivement l'hôte UNC dans la sécurité VS Code
    await this.ensureAllowedUNCHost(cleanPath);

    const checkPromise = (async () => {
      try {
        const stat = await fs.promises.stat(cleanPath);
        if (!stat.isDirectory()) {
          return { available: false, error: 'Le chemin existe mais n\'est pas un dossier valide.' };
        }
        // Test rapide de permission de lecture
        await fs.promises.readdir(cleanPath);
        return { available: true };
      } catch (err: any) {
        const msg = err && err.message ? err.message : 'Inaccessible';

        // Si l'erreur est spécifiquement le blocage UNC de VS Code, tenter une réautorisation immédiate
        if (msg.includes('UNC host') || msg.includes('not allowed')) {
          const added = await this.ensureAllowedUNCHost(cleanPath);
          if (added) {
            try {
              const stat2 = await fs.promises.stat(cleanPath);
              if (stat2.isDirectory()) {
                await fs.promises.readdir(cleanPath);
                return { available: true };
              }
            } catch {
              // Continuer vers l'erreur
            }
          }
        }

        return { available: false, error: msg };
      }
    })();

    let timerId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<{ available: boolean; error?: string }>((resolve) => {
      timerId = setTimeout(() => resolve({ available: false, error: 'Délai d\'attente réseau dépassé (5s).' }), timeoutMs);
    });

    try {
      const res = await Promise.race([checkPromise, timeoutPromise]);
      if (timerId) clearTimeout(timerId);
      return res;
    } catch {
      if (timerId) clearTimeout(timerId);
      return { available: false, error: 'Erreur inattendue lors de la vérification.' };
    }
  }

  /**
   * Scanne le catalogue NAS (âme, skills, workflows et rules).
   */
  public static async scan(
    customNasPath?: string,
    targetTool: 'antigravity' | 'claude-code' = 'antigravity'
  ): Promise<{ status: NasStatus; items: ResourceItem[] }> {
    const config = vscodeModule && vscodeModule.workspace ? vscodeModule.workspace.getConfiguration('skillsManager') : null;
    const rawNasPath = customNasPath || (config ? config.get('nasPath', '\\\\Nas1\\DD2\\IA\\Antigravity-Templates') : '\\\\Nas1\\DD2\\IA\\Antigravity-Templates');
    const nasPath = (rawNasPath || '').trim().replace(/[\/\\]+$/, '');

    const checkResult = await this.checkNasAccess(nasPath);

    if (!checkResult.available) {
      return {
        status: {
          online: false,
          path: nasPath,
          checkedAt: Date.now(),
          error: checkResult.error || 'Le chemin réseau du NAS est inaccessible ou le délai d\'attente a expiré.',
        },
        items: [],
      };
    }

    const items: ResourceItem[] = [];

    try {
      // 0. Scan de l'Âme Maître Réseau (GEMINI.md ou CLAUDE.md)
      // Stockée exclusivement dans backup_cerveau_ia\.gemini (ou .claude)
      const targetSoulFile = targetTool === 'claude-code' ? 'CLAUDE.md' : 'GEMINI.md';
      const soulSubDir = targetTool === 'claude-code' ? '.claude' : '.gemini';
      const soulCandidate = path.join(path.dirname(nasPath), 'backup_cerveau_ia', soulSubDir, targetSoulFile);

      if (fs.existsSync(soulCandidate) && fs.statSync(soulCandidate).isFile()) {
          try {
            const stat = await fs.promises.stat(soulCandidate);
            const rawContent = await fs.promises.readFile(soulCandidate, 'utf8');
            const fileCharCount = rawContent.length;
            const lineCount = rawContent.split(/\r\n|\r|\n/).length;
            const parsed = extractMarkdownTitleAndSummary(rawContent);
            const isWarningLines = lineCount > 200;
            const isWarningSize = fileCharCount > 24000;
            const soulTokenCount = countTokensForFile(soulCandidate, stat.size, stat.mtimeMs, rawContent);

            items.push({
              id: targetSoulFile,
              name: targetSoulFile,
              description: parsed.summary || (targetTool === 'claude-code' ? 'Âme Maître Claude Code (Sauvegarde NAS)' : 'Âme Maître Antigravity (Sauvegarde NAS - Niveau 0)'),
              type: 'soul',
              scope: 'nas',
              enabled: true,
              path: soulCandidate,
              targetTool,
              isFolder: false,
              charCount: fileCharCount,
              tokenCount: soulTokenCount,
              lineCount,
              metadata: {
                isSoul: true,
                locked: true,
                warningLinesExceeded: isWarningLines,
                warningSizeExceeded: isWarningSize,
              },
            });
          } catch {
            // Lecture fallback
          }
        }

      // 1. Scan des Skills et Workflows
      const skillsDir = path.join(nasPath, 'skills');
      if (fs.existsSync(skillsDir)) {
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

          const discoverySignature = `name: ${name}\ndescription: ${description}\npath: ${activeFile}\n`;
          const charCount = discoverySignature.length;
          const tokenCount = countTokensForFile(activeFile, fileStat?.size, fileStat?.mtimeMs, discoverySignature);

          items.push({
            id: entry.name,
            name,
            description: description || (isWorkflow ? 'Workflow Antigravity' : 'Compétence Antigravity'),
            type,
            scope: 'nas',
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
      }

      // 2. Scan des Règles
      const rulesDir = path.join(nasPath, 'rules');
      if (fs.existsSync(rulesDir)) {
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
          const newItem = await buildAntigravityRuleItem(filePath, {
            id: cleanId,
            scope: 'nas',
            fallbackDescription: 'Règle de gouvernance Antigravity',
          });

          if (rulesMap.has(cleanId)) {
            const existing = rulesMap.get(cleanId)!;
            if (!existing.enabled && isMd) {
              rulesMap.set(cleanId, newItem);
            }
          } else {
            rulesMap.set(cleanId, newItem);
          }
        }

        for (const ruleItem of rulesMap.values()) {
          items.push(ruleItem);
        }
      }

      return {
        status: {
          online: true,
          path: nasPath,
          checkedAt: Date.now(),
        },
        items,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        status: {
          online: false,
          path: nasPath,
          checkedAt: Date.now(),
          error: errorMsg,
        },
        items: [],
      };
    }
  }
}
