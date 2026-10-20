/**
 * Adaptateur VS Code du parcours d'installation (`deploy/deployReview`).
 *
 * Le manifeste est présenté par un fournisseur de contenu : le document ouvert
 * est en lecture seule par nature, ne demande pas d'enregistrement à la
 * fermeture, et ce que l'utilisateur lit est exactement ce qui sera écrit.
 */

import * as vscode from 'vscode';
import { ConflictPolicy } from '../common/discoveryTypes';
import { AgentRuntimeDetector } from '../environment/AgentRuntimeDetector';
import { DeployContext } from '../deploy/MultiTargetDeployService';
import {
  DeployReviewPort,
  ReviewableResource,
  detectAgentsDirName,
} from '../deploy/deployReview';

export const MANIFEST_PREVIEW_SCHEME = 'antigravity-manifest';

/** Contenus des aperçus ouverts, indexés par URI. */
class ManifestPreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private counter = 0;

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }

  public register(resource: ReviewableResource): vscode.Uri {
    this.counter += 1;
    const uri = vscode.Uri.from({
      scheme: MANIFEST_PREVIEW_SCHEME,
      path: `/${toFileName(resource.registryName)}/${toFileName(resource.name)}.md`,
      query: String(this.counter),
    });
    this.contents.set(uri.toString(), resource.manifest);
    return uri;
  }

  public forget(uri: vscode.Uri): void {
    this.contents.delete(uri.toString());
  }
}

const previewProvider = new ManifestPreviewProvider();

/** Enregistre le fournisseur d'aperçus ; à appeler une fois à l'activation. */
export function registerManifestPreview(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(MANIFEST_PREVIEW_SCHEME, previewProvider),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.scheme === MANIFEST_PREVIEW_SCHEME) {
        previewProvider.forget(document.uri);
      }
    })
  );
}

/** Construit le port d'interaction ; `report` route les comptes rendus. */
export function createVsCodeDeployReview(
  report: (level: 'info' | 'error', message: string) => void
): DeployReviewPort {
  return {
    async showManifest(resource: ReviewableResource): Promise<void> {
      const document = await vscode.workspace.openTextDocument(previewProvider.register(resource));
      await vscode.languages.setTextDocumentLanguage(document, 'markdown');
      await vscode.window.showTextDocument(document, { preview: true });
    },

    async confirmInstall(message: string, detail: string): Promise<boolean> {
      const choice = await vscode.window.showWarningMessage(
        message,
        { modal: true, detail },
        'Installer'
      );
      return choice === 'Installer';
    },

    async resolveConflict(message: string): Promise<'overwrite' | 'increment' | undefined> {
      const choice = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        'Écraser',
        'Créer une version'
      );
      if (choice === 'Écraser') return 'overwrite';
      if (choice === 'Créer une version') return 'increment';
      return undefined;
    },

    report,
  };
}

/** Contexte de déploiement de l'espace de travail ouvert. */
export function currentDeployEnvironment(): { context: DeployContext; conflictPolicy: ConflictPolicy } {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  return {
    context: {
      runtime: AgentRuntimeDetector.getContext(workspaceRoot).runtime,
      workspaceRoot,
      agentsDirName: detectAgentsDirName(workspaceRoot),
    },
    conflictPolicy: vscode.workspace
      .getConfiguration()
      .get<ConflictPolicy>('antigravity.skills.conflictPolicy', 'prompt'),
  };
}

function toFileName(value: string): string {
  const cleaned = value.replace(/[^\p{L}\p{N}._ -]+/gu, '-').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'manifeste';
}
