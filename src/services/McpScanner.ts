import * as fs from 'fs';
import * as path from 'path';
import { TokenCategoryStat, WorkspaceContext } from '../types';
import { getEffectiveGlobalAntigravityPath, getUserHome } from '../utils/paths';
import { countTokens, countTokensForFile } from '../utils/tokenizer';

let vscodeModule: any = null;
try {
  vscodeModule = require('vscode');
} catch {
  // Hors hôte VS Code (tests unitaires)
}

export class McpScanner {
  /**
   * Scanne les serveurs MCP globaux selon l'outil actif.
   * - Antigravity : ~/.gemini/config/mcp_config.json
   * - Claude Code : ~/.claude.json (clé mcpServers)
   */
  public static async scanGlobal(
    customGlobalPath?: string,
    targetTool: 'antigravity' | 'claude-code' = 'antigravity'
  ): Promise<TokenCategoryStat> {
    if (targetTool === 'claude-code') {
      const userHome = getUserHome();
      const claudeJsonPath = path.join(userHome, '.claude.json');
      return this.parseClaudeMcpGlobal(claudeJsonPath);
    }

    const globalPath = getEffectiveGlobalAntigravityPath(customGlobalPath);
    const mcpConfigPath = path.join(globalPath, 'mcp_config.json');

    return this.parseMcpConfigFile(mcpConfigPath, 'global', globalPath);
  }

  /**
   * Scanne les serveurs MCP locaux selon l'outil actif.
   * - Antigravity : <workspace>/.agents/mcp_config.json
   * - Claude Code : <workspace>/.mcp.json ou ~/.claude.json (projects[path].mcpServers)
   */
  public static async scanLocal(workspace: WorkspaceContext): Promise<TokenCategoryStat> {
    if (!workspace.hasWorkspace || !workspace.workspacePath) {
      return this.emptyStat('local', '');
    }

    if (workspace.tool === 'claude-code') {
      return this.parseClaudeMcpLocal(workspace.workspacePath);
    }

    const agentsDir = workspace.agentsDir || '.agents';
    const localDir = path.join(workspace.workspacePath, agentsDir);
    const mcpConfigPath = path.join(localDir, 'mcp_config.json');

    return this.parseMcpConfigFile(mcpConfigPath, 'local', localDir);
  }

  private static async parseClaudeMcpGlobal(claudeJsonPath: string): Promise<TokenCategoryStat> {
    if (!fs.existsSync(claudeJsonPath)) {
      return this.emptyStat('global', '~/.claude.json');
    }

    try {
      const stat = await fs.promises.stat(claudeJsonPath);
      const rawContent = await fs.promises.readFile(claudeJsonPath, 'utf8');
      const data = JSON.parse(rawContent) as { mcpServers?: Record<string, unknown> };
      const servers = data.mcpServers || {};
      const serverKeys = Object.keys(servers);
      const activeCount = serverKeys.length;

      const serversJson = JSON.stringify(servers, null, 2);
      const charCount = serversJson.length;
      const tokenCount = countTokensForFile(claudeJsonPath, stat.size, stat.mtimeMs, serversJson);

      let warningCount = 0;
      for (const srvVal of Object.values(servers)) {
        if (JSON.stringify(srvVal).length > 2048) {
          warningCount++;
        }
      }

      return {
        type: 'mcp',
        scope: 'global',
        activeCount,
        totalCount: activeCount,
        charCount,
        tokenCount,
        warningCount,
        percentage: Number(((tokenCount / 20000) * 100).toFixed(1)),
        directoryPath: claudeJsonPath,
      };
    } catch {
      return this.emptyStat('global', claudeJsonPath);
    }
  }

  private static async parseClaudeMcpLocal(workspacePath: string): Promise<TokenCategoryStat> {
    // 1. Priorité au fichier projet standard .mcp.json
    const mcpJsonPath = path.join(workspacePath, '.mcp.json');
    if (fs.existsSync(mcpJsonPath)) {
      return this.parseMcpConfigFile(mcpJsonPath, 'local', workspacePath, true);
    }

    // 2. Alternative : serveurs locaux du projet enregistrés dans ~/.claude.json
    const userHome = getUserHome();
    const claudeJsonPath = path.join(userHome, '.claude.json');
    if (fs.existsSync(claudeJsonPath)) {
      try {
        const stat = await fs.promises.stat(claudeJsonPath);
        const rawContent = await fs.promises.readFile(claudeJsonPath, 'utf8');
        const data = JSON.parse(rawContent) as {
          projects?: Record<string, { mcpServers?: Record<string, unknown> }>;
        };
        const projects = data.projects || {};

        // Recherche du projet (comparaison insensible à la casse et séparateurs)
        const normalizedWs = workspacePath.replace(/\\/g, '/').toLowerCase();
        let projectMcp: Record<string, unknown> | undefined;

        for (const [projPath, projData] of Object.entries(projects)) {
          if (projPath.replace(/\\/g, '/').toLowerCase() === normalizedWs) {
            projectMcp = projData.mcpServers;
            break;
          }
        }

        if (projectMcp && Object.keys(projectMcp).length > 0) {
          const serverKeys = Object.keys(projectMcp);
          const activeCount = serverKeys.length;
          const serversJson = JSON.stringify(projectMcp, null, 2);
          const charCount = serversJson.length;
          const tokenCount = countTokensForFile(`${claudeJsonPath}:${normalizedWs}`, stat.size, stat.mtimeMs, serversJson);

          let warningCount = 0;
          for (const srvVal of Object.values(projectMcp)) {
            if (JSON.stringify(srvVal).length > 2048) {
              warningCount++;
            }
          }

          return {
            type: 'mcp',
            scope: 'local',
            activeCount,
            totalCount: activeCount,
            charCount,
            tokenCount,
            warningCount,
            percentage: Number(((tokenCount / 20000) * 100).toFixed(1)),
            directoryPath: `${claudeJsonPath} (projet)`,
          };
        }
      } catch {
        // Ignorer
      }
    }

    return this.emptyStat('local', workspacePath);
  }

  private static async parseMcpConfigFile(
    filePath: string,
    scope: 'global' | 'local',
    directoryPath: string,
    isClaude = false
  ): Promise<TokenCategoryStat> {
    if (!fs.existsSync(filePath)) {
      return this.emptyStat(scope, directoryPath);
    }

    try {
      const stat = await fs.promises.stat(filePath);
      const rawContent = await fs.promises.readFile(filePath, 'utf8');
      const data = JSON.parse(rawContent) as { mcpServers?: Record<string, unknown> };
      const servers = data.mcpServers || {};
      const serverKeys = Object.keys(servers);
      const activeCount = serverKeys.length;

      // Décompte réel des caractères de configuration
      const charCount = rawContent.length;
      // Tokenisation réelle du fichier de configuration MCP
      const tokenCount = countTokensForFile(filePath, stat.size, stat.mtimeMs, rawContent);

      let warningCount = 0;
      if (isClaude) {
        for (const srvVal of Object.values(servers)) {
          if (JSON.stringify(srvVal).length > 2048) {
            warningCount++;
          }
        }
      }

      return {
        type: 'mcp',
        scope,
        activeCount,
        totalCount: activeCount,
        charCount,
        tokenCount,
        warningCount,
        percentage: Number(((tokenCount / 20000) * 100).toFixed(1)),
        directoryPath,
      };
    } catch {
      return this.emptyStat(scope, directoryPath);
    }
  }

  private static emptyStat(scope: 'global' | 'local', directoryPath: string): TokenCategoryStat {
    return {
      type: 'mcp',
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
