import * as fs from 'fs';
import * as path from 'path';
import { ResourceItem, ResourceScope, ResourceType } from '../types';
import { getEffectiveGlobalAntigravityPath } from '../utils/paths';

let vscodeModule: any = null;
try {
  vscodeModule = require('vscode');
} catch {
  // Hors hôte VS Code (environnement de test unitaire)
}

export class ToggleManager {
  /**
   * Bascule l'état ON/OFF d'une ressource (renommage physique + sync JSON).
   */
  public static async toggle(
    itemPath: string,
    targetState: boolean,
    type: ResourceType,
    scope: ResourceScope,
    id: string
  ): Promise<{ success: boolean; newState: boolean; error?: string }> {
    try {
      if (type === 'skill' || type === 'workflow') {
        return await this.toggleSkill(itemPath, targetState, scope, id);
      } else {
        return await this.toggleRule(itemPath, targetState);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        newState: !targetState,
        error: errorMsg,
      };
    }
  }

  /**
   * Bascule d'un skill ou workflow (SKILL.md <-> SKILL.md.disabled + skills.json)
   */
  private static async toggleSkill(
    folderOrFilePath: string,
    targetState: boolean,
    scope: ResourceScope,
    id: string
  ): Promise<{ success: boolean; newState: boolean }> {
    const stat = await fs.promises.stat(folderOrFilePath);
    const folderPath = stat.isDirectory() ? folderOrFilePath : path.dirname(folderOrFilePath);

    const activeFile = path.join(folderPath, 'SKILL.md');
    const disabledFile = path.join(folderPath, 'SKILL.md.disabled');

    // 1. Renommage physique
    if (targetState) {
      // Activer
      if (fs.existsSync(disabledFile)) {
        await fs.promises.rename(disabledFile, activeFile);
      }
    } else {
      // Désactiver
      if (fs.existsSync(activeFile)) {
        await fs.promises.rename(activeFile, disabledFile);
      }
    }

    // 2. Synchronisation skills.json si Global (ou local si config existe)
    if (scope === 'global' && vscodeModule) {
      const globalPath = getEffectiveGlobalAntigravityPath();
      await this.updateSkillsJson(globalPath, id, targetState);
    }

    return {
      success: true,
      newState: targetState,
    };
  }

  /**
   * Bascule d'une règle (*.md <-> *.md.disabled)
   */
  private static async toggleRule(
    filePath: string,
    targetState: boolean
  ): Promise<{ success: boolean; newState: boolean }> {
    const isCurrentlyDisabledFile = filePath.endsWith('.disabled');
    const activePath = isCurrentlyDisabledFile ? filePath.slice(0, -9) : filePath;
    const disabledPath = `${activePath}.disabled`;

    if (targetState) {
      // Activer : on veut activePath
      if (fs.existsSync(disabledPath)) {
        await fs.promises.rename(disabledPath, activePath);
      }
    } else {
      // Désactiver : on veut disabledPath
      if (fs.existsSync(activePath)) {
        await fs.promises.rename(activePath, disabledPath);
      }
    }

    return {
      success: true,
      newState: targetState,
    };
  }

  /**
   * Met à jour le fichier skills.json avec la liste d'exclusion
   */
  private static async updateSkillsJson(configDir: string, skillId: string, isEnabled: boolean): Promise<void> {
    const skillsJsonPath = path.join(configDir, 'skills.json');
    interface SkillsConfig {
      exclude?: string[];
      [key: string]: unknown;
    }

    let configData: SkillsConfig = {};

    if (fs.existsSync(skillsJsonPath)) {
      try {
        const raw = await fs.promises.readFile(skillsJsonPath, 'utf8');
        configData = JSON.parse(raw);
      } catch {
        configData = {};
      }
    }

    const currentExclude = Array.isArray(configData.exclude) ? [...configData.exclude] : [];

    if (isEnabled) {
      // Retirer de la liste exclude
      configData.exclude = currentExclude.filter((id) => id !== skillId);
    } else {
      // Ajouter dans la liste exclude si absent
      if (!currentExclude.includes(skillId)) {
        currentExclude.push(skillId);
      }
      configData.exclude = currentExclude;
    }

    // Sauvegarde atomique avec indentation soignée
    await fs.promises.writeFile(skillsJsonPath, JSON.stringify(configData, null, 2), 'utf8');
  }

  /**
   * Bascule en masse un type de ressource (workflow, skill, rule) pour un scope donné.
   * - targetState === true  -> Active tous les éléments
   * - targetState === false -> Désactive tous les éléments
   * - targetState === undefined -> Si au moins un est actif, désactive tout; sinon active tout.
   */
  public static async bulkToggle(
    items: ResourceItem[],
    scope: ResourceScope,
    type: 'workflow' | 'skill' | 'rule',
    targetState?: boolean
  ): Promise<{ modifiedCount: number; targetState: boolean; totalItems: number }> {
    // Les ressources verrouillées (héritées d'un dossier parent, hors du dossier ouvert) ne basculent jamais
    const matchingItems = items.filter((i) => i.scope === scope && i.type === type && !i.metadata?.locked);
    if (matchingItems.length === 0) {
      return { modifiedCount: 0, targetState: targetState ?? false, totalItems: 0 };
    }

    const anyEnabled = matchingItems.some((i) => i.enabled);
    const finalState = targetState !== undefined ? targetState : !anyEnabled;

    const itemsToModify = matchingItems.filter((i) => i.enabled !== finalState);
    let count = 0;

    for (const item of itemsToModify) {
      const res = await this.toggle(item.path, finalState, type, scope, item.id);
      if (res.success) {
        count++;
      }
    }

    return { modifiedCount: count, targetState: finalState, totalItems: matchingItems.length };
  }

  /**
   * Désactive tous les workflows d'un scope donné
   */
  public static async disableAllWorkflows(
    items: ResourceItem[],
    scope: ResourceScope
  ): Promise<{ modifiedCount: number }> {
    const res = await this.bulkToggle(items, scope, 'workflow', false);
    return { modifiedCount: res.modifiedCount };
  }

  /**
   * Active tous les workflows d'un scope donné
   */
  public static async enableAllWorkflows(
    items: ResourceItem[],
    scope: ResourceScope
  ): Promise<{ modifiedCount: number }> {
    const res = await this.bulkToggle(items, scope, 'workflow', true);
    return { modifiedCount: res.modifiedCount };
  }

  /**
   * Bascule l'état de tous les workflows d'un scope donné (ON <-> OFF)
   */
  public static async toggleAllWorkflows(
    items: ResourceItem[],
    scope: ResourceScope
  ): Promise<{ modifiedCount: number; targetState: boolean; totalItems: number }> {
    return await this.bulkToggle(items, scope, 'workflow');
  }

  /**
   * Active tous les skills d'un scope donné
   */
  public static async enableAllSkills(
    items: ResourceItem[],
    scope: ResourceScope
  ): Promise<{ modifiedCount: number }> {
    const res = await this.bulkToggle(items, scope, 'skill', true);
    return { modifiedCount: res.modifiedCount };
  }

  /**
   * Désactive tous les skills d'un scope donné
   */
  public static async disableAllSkills(
    items: ResourceItem[],
    scope: ResourceScope
  ): Promise<{ modifiedCount: number }> {
    const res = await this.bulkToggle(items, scope, 'skill', false);
    return { modifiedCount: res.modifiedCount };
  }

  /**
   * Bascule l'état de tous les skills d'un scope donné (ON <-> OFF)
   */
  public static async toggleAllSkills(
    items: ResourceItem[],
    scope: ResourceScope
  ): Promise<{ modifiedCount: number; targetState: boolean; totalItems: number }> {
    return await this.bulkToggle(items, scope, 'skill');
  }

  /**
   * Active toutes les règles d'un scope donné
   */
  public static async enableAllRules(
    items: ResourceItem[],
    scope: ResourceScope
  ): Promise<{ modifiedCount: number }> {
    const res = await this.bulkToggle(items, scope, 'rule', true);
    return { modifiedCount: res.modifiedCount };
  }

  /**
   * Désactive toutes les règles d'un scope donné
   */
  public static async disableAllRules(
    items: ResourceItem[],
    scope: ResourceScope
  ): Promise<{ modifiedCount: number }> {
    const res = await this.bulkToggle(items, scope, 'rule', false);
    return { modifiedCount: res.modifiedCount };
  }

  /**
   * Bascule l'état de toutes les règles d'un scope donné (ON <-> OFF)
   */
  public static async toggleAllRules(
    items: ResourceItem[],
    scope: ResourceScope
  ): Promise<{ modifiedCount: number; targetState: boolean; totalItems: number }> {
    return await this.bulkToggle(items, scope, 'rule');
  }
}
