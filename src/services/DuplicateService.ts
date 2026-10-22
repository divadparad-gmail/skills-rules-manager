import * as fs from 'fs';
import * as path from 'path';
import { DuplicateInfo, DuplicateStats, ResourceItem } from '../types';
import { areContentsIdentical } from './IntegrityService';
import { appliesInAntigravity } from './antigravityRuleItem';

export class DuplicateService {
  /**
   * Analyse et enrichit les listes de ressources globales et locales avec la détection des doublons.
   * Calcule les tokens gaspillés lorsque deux copies sont actives simultanément au boot.
   */
  public static detectDuplicates(
    globalResources: ResourceItem[],
    localResources: ResourceItem[]
  ): {
    enrichedGlobal: ResourceItem[];
    enrichedLocal: ResourceItem[];
    stats: DuplicateStats;
  } {
    // 1. Indexation des ressources globales par ID et compatibilité de type
    const globalMap = new Map<string, ResourceItem>();
    for (const gItem of globalResources) {
      globalMap.set(this.getDuplicateKey(gItem), gItem);
    }

    const localMap = new Map<string, ResourceItem>();
    for (const lItem of localResources) {
      localMap.set(this.getDuplicateKey(lItem), lItem);
    }

    let totalDuplicates = 0;
    let activeDuplicates = 0;
    let totalWastedTokens = 0;

    // Table de mémorisation des paires détectées pour enrichir les deux côtés
    const duplicatePairs: Array<{
      globalItem: ResourceItem;
      localItem: ResourceItem;
      isIdentical: boolean;
      bothEnabled: boolean;
      wastedTokens: number;
      localMtime: number;
      globalMtime: number;
    }> = [];

    for (const lItem of localResources) {
      const key = this.getDuplicateKey(lItem);
      const gItem = globalMap.get(key);

      if (gItem) {
        totalDuplicates++;
        // Une règle ⛔ (jamais chargée, ignorée, ne se déclenchant jamais) ne fait pas un doublon actif
        const bothEnabled = lItem.enabled && gItem.enabled && appliesInAntigravity(lItem) && appliesInAntigravity(gItem);
        const isIdentical = this.checkIfIdentical(lItem, gItem);
        const wastedTokens = bothEnabled ? (gItem.tokenCount || 0) : 0;
        const localMtime = this.getMtimeMs(lItem);
        const globalMtime = this.getMtimeMs(gItem);

        if (bothEnabled) {
          activeDuplicates++;
          totalWastedTokens += wastedTokens;
        }

        duplicatePairs.push({
          globalItem: gItem,
          localItem: lItem,
          isIdentical,
          bothEnabled,
          wastedTokens,
          localMtime,
          globalMtime,
        });
      }
    }

    // 2. Enrichissement des ressources locales
    const enrichedLocal = localResources.map((item) => {
      const pair = duplicatePairs.find((p) => p.localItem === item || (p.localItem.id === item.id && p.localItem.type === item.type));
      if (pair) {
        const info: DuplicateInfo = {
          hasDuplicate: true,
          duplicateScope: 'global',
          duplicatePath: pair.globalItem.path,
          isTwinEnabled: pair.globalItem.enabled,
          bothEnabled: pair.bothEnabled,
          isIdentical: pair.isIdentical,
          wastedTokens: pair.wastedTokens,
          twinCharCount: pair.globalItem.charCount,
          twinTokenCount: pair.globalItem.tokenCount,
          twinLineCount: pair.globalItem.lineCount,
          twinMtimeMs: pair.globalMtime,
          twinSyncStatus: pair.globalItem.syncStatus,
        };
        return {
          ...item,
          mtimeMs: item.mtimeMs ?? pair.localMtime,
          metadata: {
            ...item.metadata,
            duplicateInfo: info,
          },
        };
      }
      return item;
    });

    // 3. Enrichissement des ressources globales
    const enrichedGlobal = globalResources.map((item) => {
      const pair = duplicatePairs.find((p) => p.globalItem === item || (p.globalItem.id === item.id && p.globalItem.type === item.type));
      if (pair) {
        const info: DuplicateInfo = {
          hasDuplicate: true,
          duplicateScope: 'local',
          duplicatePath: pair.localItem.path,
          isTwinEnabled: pair.localItem.enabled,
          bothEnabled: pair.bothEnabled,
          isIdentical: pair.isIdentical,
          wastedTokens: pair.wastedTokens,
          twinCharCount: pair.localItem.charCount,
          twinTokenCount: pair.localItem.tokenCount,
          twinLineCount: pair.localItem.lineCount,
          twinMtimeMs: pair.localMtime,
          twinSyncStatus: pair.localItem.syncStatus,
        };
        return {
          ...item,
          mtimeMs: item.mtimeMs ?? pair.globalMtime,
          metadata: {
            ...item.metadata,
            duplicateInfo: info,
          },
        };
      }
      return item;
    });

    const stats: DuplicateStats = {
      totalDuplicates,
      activeDuplicates,
      totalWastedTokens,
    };

    return {
      enrichedGlobal,
      enrichedLocal,
      stats,
    };
  }

  /**
   * Récupère le timestamp de dernière modification (mtimeMs) d'une ressource ou de son fichier principal.
   */
  public static getMtimeMs(item: ResourceItem): number {
    if (typeof item.mtimeMs === 'number' && item.mtimeMs > 0) {
      return item.mtimeMs;
    }
    try {
      if (item.isFolder) {
        const skillFile = this.getSkillFile(item.path);
        if (skillFile && fs.existsSync(skillFile)) {
          return fs.statSync(skillFile).mtimeMs;
        }
      }
      if (fs.existsSync(item.path)) {
        return fs.statSync(item.path).mtimeMs;
      }
    } catch {
      // Ignorer
    }
    return 0;
  }

  /**
   * Résout le fichier principal d'un dossier de skill ou workflow (SKILL.md ou SKILL.md.disabled).
   */
  public static getSkillFile(dir: string): string | null {
    const active = path.join(dir, 'SKILL.md');
    if (fs.existsSync(active)) return active;
    const disabled = path.join(dir, 'SKILL.md.disabled');
    if (fs.existsSync(disabled)) return disabled;
    return null;
  }

  /**
   * Génère une clé canonique d'identification pour détecter les correspondances doublons.
   */
  private static getDuplicateKey(item: ResourceItem): string {
    const cleanId = item.id.replace(/\.disabled$/, '').replace(/\.md$/, '').toLowerCase();
    // Normaliser types compatibles : skills et workflows partagent le même espace de noms
    const typeGroup = item.type === 'workflow' ? 'skill' : item.type;
    return `${typeGroup}:${cleanId}`;
  }

  /**
   * Vérifie si le contenu d'un élément local et global est rigoureusement identique.
   */
  private static checkIfIdentical(localItem: ResourceItem, globalItem: ResourceItem): boolean {
    try {
      if (!localItem.isFolder && !globalItem.isFolder) {
        if (!fs.existsSync(localItem.path) || !fs.existsSync(globalItem.path)) return false;
        const localContent = fs.readFileSync(localItem.path, 'utf8');
        const globalContent = fs.readFileSync(globalItem.path, 'utf8');
        return areContentsIdentical(localContent, globalContent);
      }

      if (localItem.isFolder && globalItem.isFolder) {
        // Pour les dossiers (skills), comparer le SKILL.md principal
        const localFile = this.getSkillFile(localItem.path);
        const globalFile = this.getSkillFile(globalItem.path);

        if (!localFile || !globalFile) return false;
        const localContent = fs.readFileSync(localFile, 'utf8');
        const globalContent = fs.readFileSync(globalFile, 'utf8');
        return areContentsIdentical(localContent, globalContent);
      }
    } catch {
      return false;
    }
    return false;
  }
}
