import * as fs from 'fs';
import * as path from 'path';
import { DuplicateInfo, DuplicateStats, ResourceItem } from '../types';
import { areContentsIdentical } from './IntegrityService';

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
    }> = [];

    for (const lItem of localResources) {
      const key = this.getDuplicateKey(lItem);
      const gItem = globalMap.get(key);

      if (gItem) {
        totalDuplicates++;
        const bothEnabled = lItem.enabled && gItem.enabled;
        const isIdentical = this.checkIfIdentical(lItem, gItem);
        const wastedTokens = bothEnabled ? Math.max(lItem.tokenCount || 0, gItem.tokenCount || 0) : 0;

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
        });
      }
    }

    // 2. Enrichissement des ressources locales
    const enrichedLocal = localResources.map((item) => {
      const pair = duplicatePairs.find((p) => p.localItem.id === item.id);
      if (pair) {
        const info: DuplicateInfo = {
          hasDuplicate: true,
          duplicateScope: 'global',
          duplicatePath: pair.globalItem.path,
          isTwinEnabled: pair.globalItem.enabled,
          bothEnabled: pair.bothEnabled,
          isIdentical: pair.isIdentical,
          wastedTokens: pair.wastedTokens,
        };
        return {
          ...item,
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
      const pair = duplicatePairs.find((p) => p.globalItem.id === item.id);
      if (pair) {
        const info: DuplicateInfo = {
          hasDuplicate: true,
          duplicateScope: 'local',
          duplicatePath: pair.localItem.path,
          isTwinEnabled: pair.localItem.enabled,
          bothEnabled: pair.bothEnabled,
          isIdentical: pair.isIdentical,
          wastedTokens: pair.wastedTokens,
        };
        return {
          ...item,
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
        const getSkillFile = (dir: string) => {
          const active = path.join(dir, 'SKILL.md');
          if (fs.existsSync(active)) return active;
          const disabled = path.join(dir, 'SKILL.md.disabled');
          if (fs.existsSync(disabled)) return disabled;
          return null;
        };

        const localFile = getSkillFile(localItem.path);
        const globalFile = getSkillFile(globalItem.path);

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
