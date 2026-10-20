/**
 * Adaptateurs reliant les ports du domaine aux API réelles de VS Code.
 *
 * Les services métier ne connaissent que des interfaces ; ces adaptateurs sont
 * le seul endroit où l'API de l'éditeur est touchée, ce qui garde les modules
 * de recherche, de réglages et de déploiement entièrement testables hors hôte.
 */

import * as vscode from 'vscode';
import { ConfigurationPort, ScopedSettingValue, SecretStoragePort } from './RegistryConfigService';
import { MementoPort } from '../search/RecentSearchesStore';

/** Accès typé aux réglages contribués par l'extension. */
export class VsCodeConfigurationAdapter implements ConfigurationPort {
  public inspect<T>(section: string): ScopedSettingValue<T> | undefined {
    const inspected = vscode.workspace.getConfiguration().inspect<T>(section);
    if (!inspected) return undefined;
    return {
      userValue: inspected.globalValue,
      workspaceValue: inspected.workspaceValue ?? inspected.workspaceFolderValue,
    };
  }

  public get<T>(section: string, defaultValue: T): T {
    return vscode.workspace.getConfiguration().get<T>(section, defaultValue);
  }

  public async update(section: string, value: unknown, scope: 'user' | 'workspace'): Promise<void> {
    const target =
      scope === 'user'
        ? vscode.ConfigurationTarget.Global
        : vscode.ConfigurationTarget.Workspace;
    await vscode.workspace.getConfiguration().update(section, value, target);
  }
}

/** Coffre chiffré du système, seul dépositaire des identifiants de registre. */
export class VsCodeSecretStorageAdapter implements SecretStoragePort {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  public get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.secrets.get(key));
  }

  public async store(key: string, value: string): Promise<void> {
    await this.secrets.store(key, value);
  }

  public async delete(key: string): Promise<void> {
    await this.secrets.delete(key);
  }
}

/** Enveloppe un Memento VS Code derrière le port de persistance du domaine. */
export class MementoAdapter implements MementoPort {
  constructor(private readonly memento: vscode.Memento) {}

  public get<T>(key: string, defaultValue: T): T {
    return this.memento.get<T>(key, defaultValue);
  }

  public async update(key: string, value: unknown): Promise<void> {
    await this.memento.update(key, value);
  }
}
