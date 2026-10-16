import * as fs from 'fs';
import * as path from 'path';
import { ResourceItem, SyncStatus } from '../types';

/**
 * Normalise le contenu texte pour neutraliser les différences CRLF vs LF et espaces de fin.
 */
export function normalizeTextContent(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

/**
 * Compare deux chaînes de texte au caractère près (retours à la ligne normalisés).
 */
export function areContentsIdentical(contentA: string, contentB: string): boolean {
  return normalizeTextContent(contentA) === normalizeTextContent(contentB);
}

export class IntegrityService {
  /**
   * Enrichit une liste de ressources (Global ou Local) avec leur statut de synchronisation vis-à-vis du NAS.
   */
  public static async enrichResourcesWithSyncStatus(
    items: ResourceItem[],
    nasResources: ResourceItem[],
    isNasOnline: boolean
  ): Promise<ResourceItem[]> {
    if (!isNasOnline) {
      return items.map((item) => ({
        ...item,
        syncStatus: 'nas_offline',
      }));
    }

    const nasMap = new Map<string, ResourceItem>();
    for (const nasItem of nasResources) {
      // Clé normalisée : cleanId
      nasMap.set(nasItem.id, nasItem);
    }

    const enriched: ResourceItem[] = [];

    for (const item of items) {
      const nasItem = nasMap.get(item.id);
      const syncStatus = await this.evaluateSyncStatus(item, nasItem);
      enriched.push({
        ...item,
        syncStatus,
      });
    }

    return enriched;
  }

  /**
   * Évalue le statut de synchronisation d'un élément par rapport à sa contrepartie NAS.
   */
  public static async evaluateSyncStatus(
    item: ResourceItem,
    nasItem: ResourceItem | undefined
  ): Promise<SyncStatus> {
    if (!nasItem) {
      return 'local_only';
    }

    try {
      if (!item.isFolder) {
        // Comparaison de fichier unique (Règle)
        return await this.compareRuleFiles(item.path, nasItem.path);
      } else {
        // Comparaison de dossier (Skill ou Workflow)
        return await this.compareSkillFolders(item.path, nasItem.path);
      }
    } catch {
      return 'modified';
    }
  }

  /**
   * Compare deux fichiers de règle (Local/Global vs NAS).
   */
  public static async compareRuleFiles(localFilePath: string, nasFilePath: string): Promise<SyncStatus> {
    if (!fs.existsSync(localFilePath) || !fs.existsSync(nasFilePath)) {
      return 'modified';
    }

    const localContent = await fs.promises.readFile(localFilePath, 'utf8');
    const nasContent = await fs.promises.readFile(nasFilePath, 'utf8');

    return areContentsIdentical(localContent, nasContent) ? 'synced' : 'modified';
  }

  /**
   * Compare récursivement deux dossiers de compétence (Local/Global vs NAS).
   */
  public static async compareSkillFolders(localDirPath: string, nasDirPath: string): Promise<SyncStatus> {
    if (!fs.existsSync(localDirPath) || !fs.existsSync(nasDirPath)) {
      return 'modified';
    }

    // 1. Comparer le fichier de compétence principal (SKILL.md ou SKILL.md.disabled)
    const localSkillFile = this.resolveSkillFile(localDirPath);
    const nasSkillFile = this.resolveSkillFile(nasDirPath);

    if (!localSkillFile || !nasSkillFile) {
      return 'modified';
    }

    const localSkillContent = await fs.promises.readFile(localSkillFile, 'utf8');
    const nasSkillContent = await fs.promises.readFile(nasSkillFile, 'utf8');

    if (!areContentsIdentical(localSkillContent, nasSkillContent)) {
      return 'modified';
    }

    // 2. Vérification récursive de tous les fichiers annexes
    const isTreeIdentical = await this.compareDirectoriesRecursively(localDirPath, nasDirPath);
    return isTreeIdentical ? 'synced' : 'modified';
  }

  /**
   * Trouve le fichier SKILL.md (actif ou .disabled) dans un dossier.
   */
  private static resolveSkillFile(folderPath: string): string | null {
    const active = path.join(folderPath, 'SKILL.md');
    if (fs.existsSync(active)) return active;
    const disabled = path.join(folderPath, 'SKILL.md.disabled');
    if (fs.existsSync(disabled)) return disabled;
    return null;
  }

  /**
   * Vérifie si deux répertoires ont exactement les mêmes fichiers et contenus.
   */
  private static async compareDirectoriesRecursively(dirA: string, dirB: string): Promise<boolean> {
    try {
      const filesA = await this.getAllRelativeFiles(dirA);
      const filesB = await this.getAllRelativeFiles(dirB);

      // Normaliser les chemins sans extension .disabled pour SKILL.md
      const normalizedA = new Set(filesA.map((f) => f.replace(/\.disabled$/, '')));
      const normalizedB = new Set(filesB.map((f) => f.replace(/\.disabled$/, '')));

      if (normalizedA.size !== normalizedB.size) {
        return false;
      }

      for (const rel of normalizedA) {
        if (!normalizedB.has(rel)) {
          return false;
        }
      }

      // Comparer les contenus fichier par fichier
      for (const relFile of filesA) {
        const fullA = path.join(dirA, relFile);
        // Trouver le fichier correspondant dans B (actif ou .disabled)
        let fullB = path.join(dirB, relFile);
        if (!fs.existsSync(fullB)) {
          if (relFile.endsWith('.disabled')) {
            fullB = path.join(dirB, relFile.replace(/\.disabled$/, ''));
          } else {
            fullB = path.join(dirB, `${relFile}.disabled`);
          }
        }

        if (!fs.existsSync(fullB)) {
          return false;
        }

        const contentA = await fs.promises.readFile(fullA, 'utf8');
        const contentB = await fs.promises.readFile(fullB, 'utf8');

        if (!areContentsIdentical(contentA, contentB)) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Liste tous les fichiers relatifs d'un répertoire.
   */
  private static async getAllRelativeFiles(dir: string, baseDir: string = dir): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await this.getAllRelativeFiles(fullPath, baseDir);
        results.push(...subFiles);
      } else if (entry.isFile()) {
        results.push(path.relative(baseDir, fullPath));
      }
    }

    return results;
  }
}
