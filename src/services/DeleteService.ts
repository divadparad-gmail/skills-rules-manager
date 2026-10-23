import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ResourceItem } from '../types';
import { StateManager } from './StateManager';
import { WorkspaceDetector } from './WorkspaceDetector';
import { ScenarioManager } from './ScenarioManager';
import { isNeverLoaded, NEVER_LOADED_REFUSAL } from './ToggleManager';

export class DeleteService {
  /**
   * Supprime une ressource en local ou global après vérification stricte de sécurité.
   */
  public static async deleteResource(
    item: ResourceItem
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Antigravity (R1) : une règle de sous-dossier est sans effet, sa suppression n'apporte rien
      if (isNeverLoaded(item)) {
        vscode.window.showErrorMessage(`Suppression impossible : ${NEVER_LOADED_REFUSAL}`);
        return { success: false, error: NEVER_LOADED_REFUSAL };
      }

      const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      // Fixture reconnue à son contenu sur le disque, jamais aux métadonnées : un marqueur que le
      // fichier porterait lui-même ne doit pas lever la protection d'un vrai fichier
      const isScenarioFixture = ScenarioManager.isScenarioFixture(rootPath, item);

      // 1. Double sécurité : re-vérification du statut de synchronisation (sauf fixtures de test)
      if (item.syncStatus !== 'synced' && !isScenarioFixture) {
        let reason = 'La ressource n\'est pas synchronisée avec le Catalogue NAS.';
        if (item.syncStatus === 'modified') {
          reason = 'Ce fichier a été modifié manuellement et diffère du Catalogue NAS. Suppression bloquée pour éviter la perte de données.';
        } else if (item.syncStatus === 'local_only') {
          reason = 'Ce fichier n\'existe pas dans le Catalogue NAS. Suppression bloquée car il n\'y a aucune copie de secours.';
        } else if (item.syncStatus === 'nas_offline') {
          const nasPath = vscode.workspace.getConfiguration('skillsManager').get<string>('nasPath', '');
          reason = nasPath.trim()
            ? 'Le Catalogue NAS est hors ligne. Impossible de vérifier l\'intégrité de la ressource.'
            : 'Aucun catalogue NAS n\'est configuré (réglage skillsManager.nasPath) : la suppression exige une copie de secours dans le catalogue.';
        }
        vscode.window.showErrorMessage(`Suppression impossible : ${reason}`);
        return { success: false, error: reason };
      }

      // 2. Boîte de dialogue modale native VS Code
      const typeLabel =
        item.type === 'rule'
          ? 'la règle'
          : item.type === 'workflow'
          ? 'le workflow'
          : item.type === 'soul'
          ? "l'Âme"
          : 'la compétence';
      const scopeLabel = item.scope === 'local' ? 'du projet local' : 'de la configuration globale PC';

      const confirmMessage = isScenarioFixture
        ? `Voulez-vous supprimer ${typeLabel} "${item.name || item.id}" ${scopeLabel} ?\n\n(Élément de test du Banc d'Essai)`
        : `Voulez-vous vraiment supprimer ${typeLabel} "${item.name || item.id}" ${scopeLabel} ?\n\n` +
          `Son contenu est 100% identique au Catalogue NAS et pourra être réimporté à tout moment.`;

      const confirm = await vscode.window.showWarningMessage(
        confirmMessage,
        { modal: true },
        '🗑️ Supprimer définitivement',
        'Annuler'
      );

      if (confirm !== '🗑️ Supprimer définitivement') {
        return { success: false, error: 'Annulé par l\'utilisateur' };
      }

      // 3. Suppression physique sécurisée
      if (!fs.existsSync(item.path)) {
        // Déjà supprimé ou introuvable
        await StateManager.loadFullState(true);
        return { success: true };
      }

      if (item.isFolder) {
        await fs.promises.rm(item.path, { recursive: true, force: true });
      } else {
        await fs.promises.unlink(item.path);

        // Si Claude Code et règle locale, nettoyer CLAUDE.md
        if (item.scope === 'local' && item.targetTool === 'claude-code') {
          await this.cleanClaudeMdReference(item.id);
        }
      }

      vscode.window.showInformationMessage(
        isScenarioFixture
          ? `"${item.name || item.id}" a été supprimé ${scopeLabel} (élément de test du Banc d'Essai).`
          : `"${item.name || item.id}" a été supprimé ${scopeLabel}. Réimportable depuis le NAS à tout moment.`
      );

      // 4. Rechargement immédiat de l'état
      await StateManager.loadFullState(true);

      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Erreur lors de la suppression de "${item.name || item.id}" : ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Retire la ligne de règle dans CLAUDE.md si présent
   */
  private static async cleanClaudeMdReference(ruleId: string): Promise<void> {
    const workspace = WorkspaceDetector.detectWorkspace();
    if (!workspace.workspacePath) return;

    const claudeMdPath = path.join(workspace.workspacePath, 'CLAUDE.md');
    if (!fs.existsSync(claudeMdPath)) return;

    try {
      const content = await fs.promises.readFile(claudeMdPath, 'utf8');
      const lines = content.split('\n');
      const filtered = lines.filter((line) => !line.includes(`.claude/rules/${ruleId}.md`));
      await fs.promises.writeFile(claudeMdPath, filtered.join('\n'), 'utf8');
    } catch {
      // Ignorer
    }
  }
}
