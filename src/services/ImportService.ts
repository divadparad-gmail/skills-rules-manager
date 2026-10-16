import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ResourceItem, WorkspaceContext } from '../types';
import { getEffectiveGlobalAntigravityPath, getEffectiveGlobalClaudePath } from '../utils/paths';

export class ImportService {
  /**
   * Importe une ressource (depuis le NAS ou Global) vers Global ou Local.
   */
  public static async importResource(
    item: ResourceItem,
    destinationScope: 'global' | 'local',
    workspace: WorkspaceContext
  ): Promise<{ success: boolean; targetPath?: string; error?: string }> {
    try {
      if (destinationScope === 'global') {
        return await this.importToGlobal(item);
      } else {
        return await this.importToLocal(item, workspace);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Import vers la configuration globale PC
   */
  private static async importToGlobal(
    item: ResourceItem
  ): Promise<{ success: boolean; targetPath: string }> {
    const globalPath = getEffectiveGlobalAntigravityPath();

    if (item.type === 'soul') {
      const targetFile =
        item.targetTool === 'claude-code'
          ? path.join(getEffectiveGlobalClaudePath(), 'CLAUDE.md')
          : path.join(path.dirname(globalPath), 'GEMINI.md');

      await fs.promises.mkdir(path.dirname(targetFile), { recursive: true });
      await fs.promises.copyFile(item.path, targetFile);
      return { success: true, targetPath: targetFile };
    }

    if (item.type === 'skill' || item.type === 'workflow') {
      const targetDir = path.join(globalPath, 'skills', item.id);
      if (fs.existsSync(targetDir)) {
        const activeSkill = path.join(targetDir, 'SKILL.md');
        const disabledSkill = path.join(targetDir, 'SKILL.md.disabled');
        if (fs.existsSync(activeSkill) || fs.existsSync(disabledSkill)) {
          const status = fs.existsSync(activeSkill) ? 'active' : 'désactivée';
          throw new Error(`La compétence "${item.name || item.id}" existe déjà dans la configuration globale (${status}).`);
        }
      }

      await fs.promises.mkdir(targetDir, { recursive: true });
      await fs.promises.cp(item.path, targetDir, { recursive: true });

      // S'assurer que le skill importé est activé par défaut
      const disabledSkillFile = path.join(targetDir, 'SKILL.md.disabled');
      const activeSkillFile = path.join(targetDir, 'SKILL.md');
      if (fs.existsSync(disabledSkillFile) && !fs.existsSync(activeSkillFile)) {
        await fs.promises.rename(disabledSkillFile, activeSkillFile);
      }

      return { success: true, targetPath: targetDir };
    } else {
      // Règle
      const rulesDir = path.join(globalPath, 'rules');
      await fs.promises.mkdir(rulesDir, { recursive: true });
      const cleanId = item.id.replace(/\.disabled$/, '').replace(/\.md$/, '');
      const activeFile = path.join(rulesDir, `${cleanId}.md`);
      const disabledFile = path.join(rulesDir, `${cleanId}.md.disabled`);

      if (fs.existsSync(activeFile) || fs.existsSync(disabledFile)) {
        const status = fs.existsSync(activeFile) ? 'active' : 'désactivée';
        throw new Error(`La règle "${item.name || cleanId}" existe déjà dans la configuration globale (${status}).`);
      }

      const targetFile = activeFile;
      await fs.promises.copyFile(item.path, targetFile);

      return { success: true, targetPath: targetFile };
    }
  }

  /**
   * Import vers le projet local actif
   */
  private static async importToLocal(
    item: ResourceItem,
    workspace: WorkspaceContext
  ): Promise<{ success: boolean; targetPath: string }> {
    if (!workspace.hasWorkspace || !workspace.workspacePath) {
      throw new Error('Aucun espace de travail ouvert pour importer en local.');
    }

    const rootPath = workspace.workspacePath;

    if (workspace.tool === 'claude-code') {
      return await this.importToClaudeLocal(item, rootPath);
    } else {
      return await this.importToAntigravityLocal(item, rootPath, workspace.agentsDir || '.agents');
    }
  }

  /**
   * Import vers le projet Antigravity (.agents/)
   */
  private static async importToAntigravityLocal(
    item: ResourceItem,
    workspaceRoot: string,
    agentsDirName: string
  ): Promise<{ success: boolean; targetPath: string }> {
    if (item.type === 'soul') {
      const targetFile = path.join(workspaceRoot, 'GEMINI.md');
      if (fs.existsSync(targetFile)) {
        throw new Error('L\'Âme locale GEMINI.md existe déjà dans le projet.');
      }
      await fs.promises.copyFile(item.path, targetFile);
      return { success: true, targetPath: targetFile };
    }

    const agentsDir = path.join(workspaceRoot, agentsDirName);

    if (item.type === 'skill' || item.type === 'workflow') {
      const targetDir = path.join(agentsDir, 'skills', item.id);
      if (fs.existsSync(targetDir)) {
        const activeSkill = path.join(targetDir, 'SKILL.md');
        const disabledSkill = path.join(targetDir, 'SKILL.md.disabled');
        if (fs.existsSync(activeSkill) || fs.existsSync(disabledSkill)) {
          const status = fs.existsSync(activeSkill) ? 'active' : 'désactivée';
          throw new Error(`La compétence "${item.name || item.id}" existe déjà dans le projet local (${status}).`);
        }
      }

      await fs.promises.mkdir(targetDir, { recursive: true });
      await fs.promises.cp(item.path, targetDir, { recursive: true });

      // Normalisation SKILL.md actif
      const disabledSkillFile = path.join(targetDir, 'SKILL.md.disabled');
      const activeSkillFile = path.join(targetDir, 'SKILL.md');
      if (fs.existsSync(disabledSkillFile) && !fs.existsSync(activeSkillFile)) {
        await fs.promises.rename(disabledSkillFile, activeSkillFile);
      }

      return { success: true, targetPath: targetDir };
    } else {
      // Règle
      const rulesDir = path.join(agentsDir, 'rules');
      await fs.promises.mkdir(rulesDir, { recursive: true });
      const cleanId = item.id.replace(/\.disabled$/, '').replace(/\.md$/, '');
      const activeFile = path.join(rulesDir, `${cleanId}.md`);
      const disabledFile = path.join(rulesDir, `${cleanId}.md.disabled`);

      if (fs.existsSync(activeFile) || fs.existsSync(disabledFile)) {
        const status = fs.existsSync(activeFile) ? 'active' : 'désactivée';
        throw new Error(`La règle "${item.name || cleanId}" existe déjà dans le projet local (${status}).`);
      }

      const targetFile = activeFile;
      await fs.promises.copyFile(item.path, targetFile);

      return { success: true, targetPath: targetFile };
    }
  }

  /**
   * Import vers Claude Code (.claude/rules/ + CLAUDE.md)
   */
  private static async importToClaudeLocal(
    item: ResourceItem,
    workspaceRoot: string
  ): Promise<{ success: boolean; targetPath: string }> {
    if (item.type === 'soul') {
      const targetFile = path.join(workspaceRoot, 'CLAUDE.md');
      if (fs.existsSync(targetFile)) {
        throw new Error('L\'Âme locale CLAUDE.md existe déjà dans le projet.');
      }
      await fs.promises.copyFile(item.path, targetFile);
      return { success: true, targetPath: targetFile };
    }

    const claudeDir = path.join(workspaceRoot, '.claude');

    if (item.type === 'skill' || item.type === 'workflow') {
      const targetDir = path.join(claudeDir, 'skills', item.id);
      if (fs.existsSync(targetDir)) {
        const activeSkill = path.join(targetDir, 'SKILL.md');
        const disabledSkill = path.join(targetDir, 'SKILL.md.disabled');
        if (fs.existsSync(activeSkill) || fs.existsSync(disabledSkill)) {
          const status = fs.existsSync(activeSkill) ? 'active' : 'désactivée';
          throw new Error(`La compétence "${item.name || item.id}" existe déjà dans le projet local (${status}).`);
        }
      }

      await fs.promises.mkdir(targetDir, { recursive: true });
      await fs.promises.cp(item.path, targetDir, { recursive: true });
      return { success: true, targetPath: targetDir };
    } else {
      // Règle
      const rulesDir = path.join(claudeDir, 'rules');
      await fs.promises.mkdir(rulesDir, { recursive: true });
      const cleanId = item.id.replace(/\.disabled$/, '').replace(/\.md$/, '');
      const activeFile = path.join(rulesDir, `${cleanId}.md`);
      const disabledFile = path.join(rulesDir, `${cleanId}.md.disabled`);

      if (fs.existsSync(activeFile) || fs.existsSync(disabledFile)) {
        const status = fs.existsSync(activeFile) ? 'active' : 'désactivée';
        throw new Error(`La règle "${item.name || cleanId}" existe déjà dans le projet local (${status}).`);
      }

      const targetFile = activeFile;
      await fs.promises.copyFile(item.path, targetFile);

      // Mise à jour de CLAUDE.md
      await this.updateClaudeMdWithRule(workspaceRoot, `.claude/rules/${cleanId}.md`);

      return { success: true, targetPath: targetFile };
    }
  }

  /**
   * Ajoute la directive de règle dans le bloc managé de CLAUDE.md
   */
  private static async updateClaudeMdWithRule(workspaceRoot: string, relativeRulePath: string): Promise<void> {
    const claudeMdPath = path.join(workspaceRoot, 'CLAUDE.md');
    const markerHeader = '<!-- MANAGED BY SKILLS & RULES MANAGER -->';
    const ruleLine = `- Rule: ${relativeRulePath}`;

    let content = '';
    if (fs.existsSync(claudeMdPath)) {
      content = await fs.promises.readFile(claudeMdPath, 'utf8');
    }

    if (content.includes(markerHeader)) {
      if (!content.includes(ruleLine)) {
        content = content.replace(markerHeader, `${markerHeader}\n${ruleLine}`);
      }
    } else {
      const managedSection = `\n\n${markerHeader}\n${ruleLine}\n`;
      content += managedSection;
    }

    await fs.promises.writeFile(claudeMdPath, content.trim() + '\n', 'utf8');
  }
}
