import * as fs from 'fs';
import * as path from 'path';
import { HooksFileReading } from '../types';
import { getEffectiveGlobalAntigravityPath } from '../utils/paths';
import { GLOBAL_HOOKS_FILE, parseHooksConfig, WORKSPACE_HOOKS_FILE } from '../antigravity/behavior';

/** Au-delà de cette taille, le fichier n'est pas lu : un hooks.json reste petit. */
const MAX_HOOKS_FILE_BYTES = 1024 * 1024;

/**
 * Lit un fichier de hooks d'Antigravity. Le JSON est seulement analysé : aucune commande n'est
 * lancée, et les commandes ne sont pas transmises au webview.
 */
export async function readHooksFile(filePath: string, scope: HooksFileReading['scope']): Promise<HooksFileReading> {
  let raw: string;
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return { scope, path: filePath, status: 'absent', hooks: [] };
    if (stat.size > MAX_HOOKS_FILE_BYTES) return { scope, path: filePath, status: 'unrecognized-format', hooks: [] };
    raw = await fs.promises.readFile(filePath, 'utf8');
  } catch {
    return { scope, path: filePath, status: 'absent', hooks: [] };
  }

  let config: unknown;
  try {
    config = JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    return { scope, path: filePath, status: 'invalid-json', hooks: [] };
  }
  const parsed = parseHooksConfig(config);
  return parsed.status === 'ok'
    ? { scope, path: filePath, status: 'ok', hooks: parsed.hooks }
    : { scope, path: filePath, status: 'unrecognized-format', hooks: [] };
}

/** Hooks du projet (`.agents/hooks.json`) puis hooks globaux (`~/.gemini/config/hooks.json`). */
export async function readAntigravityHooks(workspaceRoot: string | null, customGlobalPath?: string): Promise<HooksFileReading[]> {
  const readings: HooksFileReading[] = [];
  if (workspaceRoot) readings.push(await readHooksFile(path.join(workspaceRoot, WORKSPACE_HOOKS_FILE), 'local'));
  readings.push(await readHooksFile(path.join(getEffectiveGlobalAntigravityPath(customGlobalPath), GLOBAL_HOOKS_FILE), 'global'));
  return readings;
}
