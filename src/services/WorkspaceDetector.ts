import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TargetTool, WorkspaceContext } from '../types';

export class WorkspaceDetector {
  private static overriddenTool: TargetTool | null = null;

  public static getOverriddenTool(): TargetTool | null {
    return this.overriddenTool;
  }

  public static setOverriddenTool(tool: TargetTool | null): void {
    this.overriddenTool = tool;
  }

  /**
   * Détecte si l'environnement d'exécution est Antigravity IDE (ou VS Code standard)
   */
  public static isAntigravityHost(): boolean {
    const appName = (vscode.env.appName || '').toLowerCase();
    const execPath = (process.execPath || '').toLowerCase();
    const hasAntigravityEnv =
      !!process.env.ANTIGRAVITY_APP_DIR ||
      !!process.env.ANTIGRAVITY_IDE ||
      !!process.env.GEMINI_CLI ||
      appName.includes('antigravity') ||
      execPath.includes('antigravity');

    return hasAntigravityEnv;
  }

  /**
   * Analyse l'espace de travail VS Code actif pour détecter l'outil d'IA configuré.
   */
  public static detectWorkspace(): WorkspaceContext {
    const isAntigravity = this.isAntigravityHost();
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders || workspaceFolders.length === 0) {
      return {
        hasWorkspace: false,
        workspacePath: null,
        tool: this.overriddenTool || (isAntigravity ? 'antigravity' : 'claude-code'),
        agentsDir: null,
        claudeDir: null,
        hasClaudeMd: false,
        isAntigravityHost: isAntigravity,
      };
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = vscode.workspace.getConfiguration('skillsManager');
    const configuredTool = config.get<string>('defaultProjectTool', 'auto-detect');

    // Détection des dossiers et marqueurs
    let agentsDir: string | null = null;
    const potentialAgentsDirs = ['.agents', '.agent'];
    for (const dir of potentialAgentsDirs) {
      const fullPath = path.join(rootPath, dir);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        agentsDir = dir;
        break;
      }
    }

    let claudeDir: string | null = null;
    const fullClaudePath = path.join(rootPath, '.claude');
    if (fs.existsSync(fullClaudePath) && fs.statSync(fullClaudePath).isDirectory()) {
      claudeDir = '.claude';
    }

    const fullClaudeMd = path.join(rootPath, 'CLAUDE.md');
    const hasClaudeMd = fs.existsSync(fullClaudeMd);

    const hasGeminiMd = fs.existsSync(path.join(rootPath, 'GEMINI.md'));
    const hasAgentsMd = fs.existsSync(path.join(rootPath, 'AGENTS.md'));

    let tool: TargetTool = 'antigravity';

    if (this.overriddenTool) {
      tool = this.overriddenTool;
    } else if (configuredTool === 'antigravity') {
      tool = 'antigravity';
    } else if (configuredTool === 'claude-code') {
      tool = 'claude-code';
    } else {
      // auto-detect basé sur l'IDE hôte
      if (isAntigravity) {
        tool = 'antigravity';
      } else {
        // Dans VS Code standard
        if (hasClaudeMd || claudeDir) {
          tool = 'claude-code';
        } else if (agentsDir || hasGeminiMd || hasAgentsMd) {
          tool = 'antigravity';
        } else {
          tool = 'claude-code';
        }
      }
    }

    return {
      hasWorkspace: true,
      workspacePath: rootPath,
      tool,
      agentsDir,
      claudeDir,
      hasClaudeMd,
      isAntigravityHost: isAntigravity,
    };
  }
}
