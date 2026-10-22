import * as fs from 'fs';
import * as path from 'path';
import { McpServerStat, TokenCategoryStat, WorkspaceContext } from '../types';
import { getEffectiveGlobalAntigravityPath, getUserHome } from '../utils/paths';
import { countTokens, countTokensForFile } from '../utils/tokenizer';
import {
  formatMcpServer,
  isUnsupportedRemoteMcpServer,
  MCP_DISABLED_SERVERS_COUNTED,
  MCP_TOOL_CACHE_DIR,
} from '../antigravity/behavior';

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

    return this.parseAntigravityMcpConfig(mcpConfigPath, 'global', globalPath, this.toolCacheDir(globalPath));
  }

  /** Cache des schémas d'outils d'Antigravity (🧪 observé, non documenté), sous `~/.gemini`. */
  private static toolCacheDir(globalPath: string): string {
    return path.join(path.dirname(globalPath), MCP_TOOL_CACHE_DIR);
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

    return this.parseAntigravityMcpConfig(mcpConfigPath, 'local', localDir, this.toolCacheDir(getEffectiveGlobalAntigravityPath()));
  }

  /**
   * Coût au démarrage des serveurs MCP sous Antigravity (F8) : un titre par serveur actif, puis
   * les noms de ses outils, lus dans le cache d'Antigravity moins `disabledTools`. Sans cache, la
   * liste est inconnue : seul le titre est compté. Les serveurs `disabled: true` et les serveurs
   * distants sans `serverUrl` sont exclus de la jauge.
   */
  private static async parseAntigravityMcpConfig(
    filePath: string,
    scope: 'global' | 'local',
    directoryPath: string,
    toolCacheDir: string
  ): Promise<TokenCategoryStat> {
    if (!fs.existsSync(filePath)) {
      return this.emptyStat(scope, directoryPath);
    }

    try {
      const data = JSON.parse(await fs.promises.readFile(filePath, 'utf8')) as { mcpServers?: unknown };
      const servers = data.mcpServers && typeof data.mcpServers === 'object' ? (data.mcpServers as Record<string, unknown>) : {};
      const mcpServers: McpServerStat[] = [];
      let charCount = 0;

      for (const [name, rawConfig] of Object.entries(servers)) {
        const config = rawConfig && typeof rawConfig === 'object' ? (rawConfig as Record<string, unknown>) : {};
        if (isUnsupportedRemoteMcpServer(config)) {
          mcpServers.push({ name, status: 'unsupported', toolCount: null, tokenCount: 0 });
          continue;
        }
        if (config.disabled === true && !MCP_DISABLED_SERVERS_COUNTED) {
          mcpServers.push({ name, status: 'disabled', toolCount: null, tokenCount: 0 });
          continue;
        }
        const disabledTools = Array.isArray(config.disabledTools) ? config.disabledTools.map(String) : [];
        const cachedTools = await this.readCachedToolNames(toolCacheDir, name);
        const tools = cachedTools ? cachedTools.filter((tool) => !disabledTools.includes(tool)) : null;
        const block = formatMcpServer(name, tools);
        charCount += block.length;
        mcpServers.push({ name, status: 'active', toolCount: tools ? tools.length : null, tokenCount: countTokens(block) });
      }

      const active = mcpServers.filter((server) => server.status === 'active');
      const tokenCount = active.reduce((sum, server) => sum + server.tokenCount, 0);
      return {
        type: 'mcp',
        scope,
        activeCount: active.length,
        totalCount: mcpServers.length,
        charCount,
        tokenCount,
        warningCount: mcpServers.filter((server) => server.status === 'unsupported').length,
        percentage: Number(((tokenCount / 20000) * 100).toFixed(1)),
        directoryPath,
        mcpServers,
      };
    } catch {
      return this.emptyStat(scope, directoryPath);
    }
  }

  /**
   * Noms des outils d'un serveur dans le cache d'Antigravity (`<serveur>/<outil>.json`), ou null
   * si le cache n'a pas ce serveur. Le nom vient d'un fichier de configuration, éventuellement
   * celui du dépôt ouvert : un nom qui sortirait du dossier du cache est refusé.
   */
  private static async readCachedToolNames(toolCacheDir: string, serverName: string): Promise<string[] | null> {
    if (!serverName || serverName === '.' || serverName === '..' || /[\\/]/.test(serverName)) return null;
    try {
      const entries = await fs.promises.readdir(path.join(toolCacheDir, serverName), { withFileTypes: true });
      return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name.slice(0, -'.json'.length));
    } catch {
      return null;
    }
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
