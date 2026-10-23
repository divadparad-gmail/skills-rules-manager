/**
 * Port VS Code des parcours du banc d'essai, et identifiant de la commande de vidage. Ce module
 * n'importe pas StateManager : les vues peuvent l'utiliser sans cycle d'imports.
 */
import * as vscode from 'vscode';
import { InterfaceBanc } from './bancEssaiParcours';

export const COMMANDE_VIDER_BANC = 'skillsRulesManager.viderBancEssai';

export const interfaceVsCode: InterfaceBanc = {
  demander: (message, ...boutons) => Promise.resolve(vscode.window.showWarningMessage(message, { modal: true }, ...boutons)),
  informer: (message) => void vscode.window.showInformationMessage(message),
  avertir: (message) => void vscode.window.showWarningMessage(message),
  signalerErreur: (message) => void vscode.window.showErrorMessage(message),
};
