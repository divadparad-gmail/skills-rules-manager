/**
 * Banc d'essai dans l'hôte VS Code : commande « Vider et restaurer », barre d'état, observateur
 * du manifeste et de la sauvegarde, avertissement au démarrage. Les parcours eux-mêmes sont dans
 * bancEssaiParcours.ts, et les textes dans bancEssaiPresentation.ts.
 */
import * as vscode from 'vscode';
import { ScenarioManager } from '../services/ScenarioManager';
import { StateManager } from '../services/StateManager';
import { viderBancEssai } from './bancEssaiParcours';
import { messageDemarrage, presenterBanc } from './bancEssaiPresentation';
import { COMMANDE_VIDER_BANC, interfaceVsCode } from './bancEssaiVsCode';

const racineEspace = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

/** « ⚠️ Banc d'essai actif » ou « ⛔ Banc d'essai interrompu », tant que le banc n'est pas vidé. */
export class BancEssaiStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = COMMANDE_VIDER_BANC;
  }

  public refresh(): void {
    const racine = racineEspace();
    const presentation = racine ? presenterBanc(ScenarioManager.lireEtat(racine)) : null;
    if (!presentation || !presentation.visible) {
      this.item.hide();
      return;
    }
    this.item.text = presentation.titre;
    this.item.tooltip = presentation.infobulle;
    this.item.backgroundColor = new vscode.ThemeColor(
      presentation.niveau === 'interrompu' ? 'statusBarItem.errorBackground' : 'statusBarItem.warningBackground'
    );
    this.item.show();
  }

  public dispose(): void {
    this.item.dispose();
  }
}

export function registerBancEssai(context: vscode.ExtensionContext): BancEssaiStatusBar {
  const barre = new BancEssaiStatusBar();

  // Point d'entrée unique du vidage : boutons « Vider » de la barre latérale et du Dashboard,
  // bandeaux, barre d'état et avertissement au démarrage
  context.subscriptions.push(
    barre,
    vscode.commands.registerCommand(COMMANDE_VIDER_BANC, async (parametres?: { confirmer?: boolean }) => {
      const racine = racineEspace();
      if (!racine) {
        vscode.window.showWarningMessage('Veuillez ouvrir un dossier d\'espace de travail.');
        return;
      }
      await viderBancEssai(racine, interfaceVsCode, { confirmer: parametres?.confirmer ?? true });
      barre.refresh();
      await StateManager.loadFullState(true);
    }),
    StateManager.subscribe(() => barre.refresh())
  );

  // Les scripts npm lancés dans le terminal modifient aussi le manifeste et la sauvegarde
  const dossier = vscode.workspace.workspaceFolders?.[0];
  if (dossier) {
    const observateur = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(dossier, `{${ScenarioManager.MANIFEST_FILE},${ScenarioManager.BACKUP_DIR}/index.json}`)
    );
    const surChangement = () => {
      barre.refresh();
      StateManager.requestDebouncedReload(350);
    };
    observateur.onDidCreate(surChangement);
    observateur.onDidChange(surChangement);
    observateur.onDidDelete(surChangement);
    context.subscriptions.push(observateur);
  }

  barre.refresh();
  const racine = racineEspace();
  const message = racine ? messageDemarrage(ScenarioManager.lireEtat(racine)) : null;
  if (message) {
    void vscode.window.showWarningMessage(message, 'Vider et restaurer', 'Plus tard').then((choix) => {
      if (choix === 'Vider et restaurer') {
        // Le bouton de la notification vaut confirmation ; une fixture modifiée reste soumise à son accord
        void vscode.commands.executeCommand(COMMANDE_VIDER_BANC, { confirmer: false });
      }
    });
  }
  return barre;
}
