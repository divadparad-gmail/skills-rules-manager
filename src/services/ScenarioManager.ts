import * as fs from 'fs';
import * as path from 'path';
import { ResourceItem } from '../types';
import { getEffectiveGlobalAntigravityPath } from '../utils/paths';

export type ScenarioTarget = 'antigravity' | 'claude-code' | 'all';

export interface CleanResult {
  deletedCount: number;
  preservedCount: number;
  preservedNames: string[];
}

export class ScenarioManager {
  public static readonly MANIFEST_FILE = '.scenario-manifest.json';

  /**
   * Retourne l'ensemble de tous les chemins relatifs des fichiers appartenant aux scénarios de test.
   * Combine :
   * 1. Les fichiers listés dans .scenario-manifest.json (s'il existe).
   * 2. Les fichiers sources connus dans test/scenarios/antigravity et test/scenarios/claude-code.
   */
  public static getScenarioFiles(rootPath: string): Set<string> {
    const filesSet = new Set<string>();
    if (!rootPath || !fs.existsSync(rootPath)) return filesSet;

    // 1. Lecture du manifeste de déploiement
    const manifestPath = path.join(rootPath, this.MANIFEST_FILE);
    if (fs.existsSync(manifestPath)) {
      try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.files)) {
          for (const f of parsed.files) {
            if (typeof f === 'string') {
              filesSet.add(f.replace(/\\/g, '/'));
            }
          }
        }
      } catch {
        // Ignorer si corrompu
      }
    }

    // 2. Scan direct des fixtures disponibles dans test/scenarios
    const scenariosBaseDir = path.join(rootPath, 'test', 'scenarios');
    const scanDir = (srcDir: string) => {
      if (!fs.existsSync(srcDir)) return;
      const walk = (currentDir: string, relBase: string) => {
        try {
          const entries = fs.readdirSync(currentDir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            const relPath = path.join(relBase, entry.name).replace(/\\/g, '/');
            filesSet.add(relPath);
            if (entry.isDirectory()) {
              walk(fullPath, relPath);
            }
          }
        } catch {
          // Ignorer
        }
      };
      walk(srcDir, '');
    };

    scanDir(path.join(scenariosBaseDir, 'antigravity'));
    scanDir(path.join(scenariosBaseDir, 'claude-code'));

    return filesSet;
  }

  /**
   * Vérifie si un élément ou un chemin fait partie des fixtures du Banc d'Essai (scénarios).
   */
  public static isScenarioFixture(
    rootPath: string,
    item: ResourceItem,
    cachedScenarioFiles?: Set<string>
  ): boolean {
    const meta = item.metadata as Record<string, any> | undefined;
    if (
      meta?.isScenarioFixture === true ||
      meta?.isScenarioFixture === 'true' ||
      meta?.scenario_fixture === true ||
      meta?.scenario_fixture === 'true'
    ) {
      return true;
    }

    // Fichier de test spécifique doublon
    if (item.id === 'rule-test-doublon' || item.name === 'rule-test-doublon' || item.name === 'rule-test-doublon.md') {
      return true;
    }

    const filesSet = cachedScenarioFiles || this.getScenarioFiles(rootPath);
    const itemRelPath = path.relative(rootPath, item.path).replace(/\\/g, '/');
    const cleanRelPath = itemRelPath.replace(/\.disabled$/, '');

    return filesSet.has(itemRelPath) || filesSet.has(cleanRelPath);
  }

  /**
   * Copie récursivement un dossier source vers un dossier de destination.
   */
  public static async copyRecursive(
    sourceDir: string,
    destDir: string,
    recordedFiles?: string[],
    rootPathForRel?: string
  ): Promise<number> {
    let count = 0;
    if (!fs.existsSync(sourceDir)) return count;

    await fs.promises.mkdir(destDir, { recursive: true });
    const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(sourceDir, entry.name);
      const dstPath = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        count += await this.copyRecursive(srcPath, dstPath, recordedFiles, rootPathForRel);
      } else if (entry.isFile()) {
        await fs.promises.copyFile(srcPath, dstPath);
        count++;
        if (recordedFiles && rootPathForRel) {
          recordedFiles.push(path.relative(rootPathForRel, dstPath).replace(/\\/g, '/'));
        }
      }
    }

    return count;
  }

  /**
   * Nettoie les fichiers et dossiers de configuration dans la racine du projet.
   * Si localItems est fourni, protège rigoureusement toutes les ressources non synchronisées (modifiées ou locales),
   * sauf si elles sont explicitement identifiées comme des fixtures du Banc d'Essai.
   */
  public static async clean(
    rootPath: string,
    target: ScenarioTarget = 'all',
    localItems?: ResourceItem[]
  ): Promise<CleanResult> {
    const result: CleanResult = {
      deletedCount: 0,
      preservedCount: 0,
      preservedNames: [],
    };

    if (!rootPath || !fs.existsSync(rootPath)) return result;

    const scenarioFiles = this.getScenarioFiles(rootPath);

    if (localItems && localItems.length > 0) {
      const relevantItems = localItems.filter((item) => {
        if (target === 'all') return true;
        return item.targetTool === target;
      });

      for (const item of relevantItems) {
        const isFixture = this.isScenarioFixture(rootPath, item, scenarioFiles);

        if (item.syncStatus === 'synced' || isFixture) {
          // 100% identique au Catalogue NAS ou fichier de test de scénario : supprimable en toute sécurité
          try {
            if (fs.existsSync(item.path)) {
              if (item.isFolder) {
                await fs.promises.rm(item.path, { recursive: true, force: true });
              } else {
                await fs.promises.unlink(item.path);
              }
              result.deletedCount++;
            }
          } catch {
            // Ignorer si déjà supprimé
          }
        } else {
          // Protégé ! (vrai fichier utilisateur modifié, local_only ou nas_offline)
          result.preservedCount++;
          result.preservedNames.push(item.name || item.id);
        }
      }

      // Si aucun élément n'a été préservé, on nettoie tous les résidus de scénarios
      if (result.preservedCount === 0) {
        if (target === 'antigravity' || target === 'all') {
          const agentsDir = path.join(rootPath, '.agents');
          if (fs.existsSync(agentsDir)) {
            await fs.promises.rm(agentsDir, { recursive: true, force: true });
          }
          const geminiMd = path.join(rootPath, 'GEMINI.md');
          if (fs.existsSync(geminiMd)) {
            await fs.promises.rm(geminiMd, { force: true });
          }
          const agentsMd = path.join(rootPath, 'AGENTS.md');
          if (fs.existsSync(agentsMd)) {
            await fs.promises.rm(agentsMd, { force: true });
          }
        }
        if (target === 'claude-code' || target === 'all') {
          const claudeDir = path.join(rootPath, '.claude');
          if (fs.existsSync(claudeDir)) {
            await fs.promises.rm(claudeDir, { recursive: true, force: true });
          }
          const claudeMd = path.join(rootPath, 'CLAUDE.md');
          if (fs.existsSync(claudeMd)) {
            await fs.promises.rm(claudeMd, { force: true });
          }
          const mcpJson = path.join(rootPath, '.mcp.json');
          if (fs.existsSync(mcpJson)) {
            await fs.promises.rm(mcpJson, { force: true });
          }
        }
      } else {
        // Nettoyer uniquement les sous-dossiers qui sont devenus vides
        this.cleanEmptyDirectories(path.join(rootPath, '.agents'));
        this.cleanEmptyDirectories(path.join(rootPath, '.claude'));
      }

      // Nettoyage sécurisé du fichier de test doublon dans le profil global
      if (target === 'all' || target === 'antigravity') {
        await this.cleanGlobalTestDuplicateRule();
      }

      // Nettoyer le manifeste de scénario s'il existe
      const manifestPath = path.join(rootPath, this.MANIFEST_FILE);
      if (fs.existsSync(manifestPath)) {
        try {
          await fs.promises.unlink(manifestPath);
        } catch {
          // Ignorer
        }
      }

      return result;
    }

    // Repli de nettoyage intégral (quand aucun état de synchronisation n'est fourni)
    if (target === 'antigravity' || target === 'all') {
      const agentsDir = path.join(rootPath, '.agents');
      if (fs.existsSync(agentsDir)) {
        await fs.promises.rm(agentsDir, { recursive: true, force: true });
        result.deletedCount++;
      }
      const geminiMd = path.join(rootPath, 'GEMINI.md');
      if (fs.existsSync(geminiMd)) {
        await fs.promises.rm(geminiMd, { force: true });
        result.deletedCount++;
      }
      const agentsMd = path.join(rootPath, 'AGENTS.md');
      if (fs.existsSync(agentsMd)) {
        await fs.promises.rm(agentsMd, { force: true });
        result.deletedCount++;
      }
    }

    if (target === 'claude-code' || target === 'all') {
      const claudeDir = path.join(rootPath, '.claude');
      if (fs.existsSync(claudeDir)) {
        await fs.promises.rm(claudeDir, { recursive: true, force: true });
        result.deletedCount++;
      }
      const claudeMd = path.join(rootPath, 'CLAUDE.md');
      if (fs.existsSync(claudeMd)) {
        await fs.promises.rm(claudeMd, { force: true });
        result.deletedCount++;
      }
      const mcpJson = path.join(rootPath, '.mcp.json');
      if (fs.existsSync(mcpJson)) {
        await fs.promises.rm(mcpJson, { force: true });
        result.deletedCount++;
      }
    }

    // Nettoyage sécurisé du fichier de test doublon dans le profil global
    if (target === 'all' || target === 'antigravity') {
      await this.cleanGlobalTestDuplicateRule();
    }

    // Nettoyer le manifeste de scénario s'il existe
    const manifestPath = path.join(rootPath, this.MANIFEST_FILE);
    if (fs.existsSync(manifestPath)) {
      try {
        await fs.promises.unlink(manifestPath);
      } catch {
        // Ignorer
      }
    }

    return result;
  }

  /**
   * Supprime de façon sécurisée le fichier de test doublon dans le profil global Antigravity.
   */
  private static async cleanGlobalTestDuplicateRule(): Promise<boolean> {
    try {
      const globalAgyPath = getEffectiveGlobalAntigravityPath();
      const testGlobalRule = path.join(globalAgyPath, 'rules', 'rule-test-doublon.md');
      if (fs.existsSync(testGlobalRule)) {
        await fs.promises.unlink(testGlobalRule);
        return true;
      }
    } catch {
      // Ignorer si inaccessible ou déjà supprimé
    }
    return false;
  }

  /**
   * Supprime récursivement les dossiers vides.
   */
  private static cleanEmptyDirectories(dirPath: string): void {
    if (!fs.existsSync(dirPath)) return;
    try {
      const entries = fs.readdirSync(dirPath);
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        if (fs.statSync(fullPath).isDirectory()) {
          this.cleanEmptyDirectories(fullPath);
        }
      }
      const remaining = fs.readdirSync(dirPath);
      if (remaining.length === 0) {
        fs.rmdirSync(dirPath);
      }
    } catch {
      // Ignorer si inaccessible ou verrouillé
    }
  }

  /**
   * Déploie un scénario d'essai depuis test/scenarios vers la racine de l'espace de travail.
   */
  public static async deploy(rootPath: string, target: ScenarioTarget): Promise<number> {
    if (!rootPath || !fs.existsSync(rootPath)) {
      throw new Error("L'espace de travail local n'est pas accessible.");
    }

    const scenariosBaseDir = path.join(rootPath, 'test', 'scenarios');
    if (!fs.existsSync(scenariosBaseDir)) {
      throw new Error(`Le dossier de scénarios est introuvable : ${scenariosBaseDir}`);
    }

    // 1. Nettoyage préalable de la cible demandée
    await this.clean(rootPath, target);

    let copiedTotal = 0;
    const deployedFiles: string[] = [];

    // 2. Déploiement Antigravity
    if (target === 'antigravity' || target === 'all') {
      const srcAgy = path.join(scenariosBaseDir, 'antigravity');
      if (fs.existsSync(srcAgy)) {
        copiedTotal += await this.copyRecursive(srcAgy, rootPath, deployedFiles, rootPath);
      }
    }

    // 3. Déploiement Claude Code
    if (target === 'claude-code' || target === 'all') {
      const srcClaude = path.join(scenariosBaseDir, 'claude-code');
      if (fs.existsSync(srcClaude)) {
        copiedTotal += await this.copyRecursive(srcClaude, rootPath, deployedFiles, rootPath);
      }
    }

    // 4. Scénario Doublon Global vs Local (injecté lors du clic "⚡ Tous")
    if (target === 'all') {
      try {
        const globalAgyPath = getEffectiveGlobalAntigravityPath();
        const globalRulesDir = path.join(globalAgyPath, 'rules');
        const testRuleSrc = path.join(scenariosBaseDir, 'antigravity', '.agents', 'rules', 'rule-test-doublon.md');
        if (fs.existsSync(testRuleSrc)) {
          if (!fs.existsSync(globalRulesDir)) {
            await fs.promises.mkdir(globalRulesDir, { recursive: true });
          }
          await fs.promises.copyFile(testRuleSrc, path.join(globalRulesDir, 'rule-test-doublon.md'));
          copiedTotal++;
        }
      } catch {
        // En cas d'erreur de permission ou chemin introuvable, ne pas bloquer le déploiement
      }
    }

    // 5. Écriture du manifeste de scénario pour identification formelle lors du nettoyage
    try {
      const manifestPath = path.join(rootPath, this.MANIFEST_FILE);
      const manifestData = {
        target,
        deployedAt: new Date().toISOString(),
        files: deployedFiles,
      };
      await fs.promises.writeFile(manifestPath, JSON.stringify(manifestData, null, 2), 'utf8');
    } catch {
      // Ignorer si non inscriptible
    }

    return copiedTotal;
  }
}
