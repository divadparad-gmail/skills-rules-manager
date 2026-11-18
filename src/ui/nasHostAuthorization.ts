import * as vscode from 'vscode';
import { NasScanner } from '../services/NasScanner';
import { getUserNasPath } from '../services/nasPathSetting';

const AUTORISER = 'Autoriser';

/**
 * Parcours unique du bouton « Débloquer l'hôte » et de la commande
 * `skillsRulesManager.allowNasUncHost` : autorise l'hôte du catalogue NAS dans le réglage
 * utilisateur `security.allowedUNCHosts`, après une confirmation modale qui nomme l'hôte.
 *
 * - L'hôte vient de la valeur utilisateur de `skillsManager.nasPath` seulement, jamais d'un chemin
 *   envoyé par la vue ni d'une valeur posée par l'espace de travail.
 * - La confirmation est demandée à chaque fois, y compris pour une valeur posée par l'utilisateur.
 * - Rien n'est écrit sans le bouton « Autoriser ».
 *
 * Rend vrai si l'hôte a été ajouté à la liste.
 */
export async function confirmAndAllowNasHost(): Promise<boolean> {
  const nasPath = getUserNasPath();
  const host = NasScanner.getUncHost(nasPath);
  if (!host) {
    vscode.window.showInformationMessage(
      'Le catalogue de vos réglages utilisateur (skillsManager.nasPath) n\'est pas sur un partage réseau nommé : aucun hôte à autoriser.'
    );
    return false;
  }

  const editeur = vscode.env.appName || 'l\'éditeur';
  const choix = await vscode.window.showWarningMessage(
    `Autoriser l'hôte « ${host} » dans ${editeur} ?`,
    {
      modal: true,
      detail:
        `Votre catalogue NAS (réglage utilisateur skillsManager.nasPath) se trouve sur l'hôte « ${host} ». ` +
        `« ${host} » sera ajouté à votre réglage utilisateur security.allowedUNCHosts : ${editeur} et ses extensions ` +
        'pourront alors accéder à cet hôte. Vous pourrez le retirer de ce réglage à tout moment.',
    },
    AUTORISER
  );
  if (choix !== AUTORISER) return false;

  const added = await NasScanner.ensureAllowedUNCHost(nasPath);
  vscode.window.showInformationMessage(
    added ? `Hôte « ${host} » autorisé dans ${editeur}.` : `L'hôte « ${host} » n'a pas été ajouté : il est déjà autorisé, ou le réglage n'a pas pu être modifié.`
  );
  return added;
}
