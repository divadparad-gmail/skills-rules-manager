/**
 * Parcours du banc d'essai dans l'extension : vider et restaurer, déployer. Les fenêtres passent
 * par un port injectable : les mêmes parcours servent l'hôte VS Code et les tests.
 *
 * Une fixture modifiée pendant le test n'est jamais écrasée sans la fenêtre « Écraser et
 * restaurer », qui en donne la liste, y compris quand le vidage précède un redéploiement.
 */
import { BancEssaiRefus, OptionsBanc, ScenarioManager, ScenarioTarget } from '../services/ScenarioManager';

export const BOUTON_VIDER = 'Vider et restaurer';
export const BOUTON_ECRASER = 'Écraser et restaurer';
export const BOUTON_REDEPLOYER = 'Vider et redéployer';
export const BOUTON_DEPLOYER = 'Déployer';

export interface InterfaceBanc {
  /** Fenêtre modale : renvoie le bouton choisi, ou undefined si l'utilisateur annule. */
  demander(message: string, ...boutons: string[]): Promise<string | undefined>;
  informer(message: string): void;
  avertir(message: string): void;
  signalerErreur(message: string): void;
}

const liste = (chemins: string[]) => chemins.map((c) => `• ${c}`).join('\n');

/**
 * Vide le banc et restaure les originaux. Renvoie true si le vidage a eu lieu.
 * `confirmer` : demande d'abord confirmation (bouton, bandeau, barre d'état).
 */
export async function viderBancEssai(
  racine: string,
  ui: InterfaceBanc,
  parametres: { confirmer?: boolean; options?: OptionsBanc } = {}
): Promise<boolean> {
  const options = parametres.options ?? {};
  try {
    if (parametres.confirmer) {
      const choix = await ui.demander(
        'Vider le banc d\'essai ? Les fixtures intactes seront supprimées et les vrais fichiers sauvegardés seront restaurés.',
        BOUTON_VIDER
      );
      if (choix !== BOUTON_VIDER) return false;
    }

    const plan = ScenarioManager.planifierVidage(racine, options);
    let acceptees: string[] = [];
    if (plan.modifiees.length > 0) {
      const choix = await ui.demander(
        `${plan.modifiees.length} fixture(s) ont été modifiées pendant le test. Le vidage écrasera ces modifications :\n` +
          `${liste(plan.modifiees)}\n\nCopiez ailleurs ce que vous voulez garder avant de continuer.`,
        BOUTON_ECRASER
      );
      if (choix !== BOUTON_ECRASER) {
        ui.informer('Vidage annulé : rien n\'a été modifié.');
        return false;
      }
      acceptees = plan.modifiees;
    }

    // Une fixture modifiée entre la fenêtre et le vidage n'est pas couverte par l'accord donné
    const nouvelles = ScenarioManager.planifierVidage(racine, options).modifiees.filter((c) => !acceptees.includes(c));
    if (nouvelles.length > 0) {
      ui.avertir(`Vidage annulé : d'autres fixtures ont été modifiées entre-temps (${nouvelles.join(', ')}). Rien n'a été modifié.`);
      return false;
    }

    const rapport = await ScenarioManager.clean(racine, { ...options, ecraser: acceptees.length > 0 });
    const resume = ScenarioManager.resumerVidage(rapport);
    if (rapport.signales.length > 0) ui.avertir(resume);
    else ui.informer(resume);
    return true;
  } catch (err) {
    ui.signalerErreur(`Erreur de vidage : ${ScenarioManager.decrireErreur(err)}`);
    return false;
  }
}

/** Déploie les fixtures d'une cible. Renvoie true si le déploiement a eu lieu. */
export async function deployerBancEssai(
  racine: string,
  cible: ScenarioTarget,
  ui: InterfaceBanc,
  options: OptionsBanc = {}
): Promise<boolean> {
  try {
    const etat = ScenarioManager.lireEtat(racine, options);
    if (etat.niveau !== 'aucun') {
      const choix = await ui.demander(
        `Un banc d'essai est déjà déployé (${etat.nbOriginaux} vrai(s) fichier(s) en sauvegarde). ` +
          'Le vider et restaurer les originaux, puis redéployer ?',
        BOUTON_REDEPLOYER
      );
      if (choix !== BOUTON_REDEPLOYER) return false;
      // Le vidage demande lui-même l'accord pour toute fixture modifiée
      if (!(await viderBancEssai(racine, ui, { confirmer: false, options }))) return false;
    }

    const plan = ScenarioManager.planifierDeploiement(racine, cible, options);
    if (plan.aSauvegarder.length > 0 || plan.identiques.length > 0) {
      const parties = [`Déployer les fixtures « ${cible} » ?`];
      if (plan.aSauvegarder.length > 0) {
        parties.push(
          `${plan.aSauvegarder.length} vrai(s) fichier(s) seront remplacés, après avoir été sauvegardés dans .banc-essai-sauvegarde/, ` +
            `puis restaurés au vidage :\n${liste(plan.aSauvegarder)}`
        );
      }
      if (plan.identiques.length > 0) {
        parties.push(
          `${plan.identiques.length} fichier(s) déjà identique(s) à leur fixture ne seront pas sauvegardés et seront supprimés au vidage :\n` +
            liste(plan.identiques)
        );
      }
      const choix = await ui.demander(parties.join('\n\n'), BOUTON_DEPLOYER);
      if (choix !== BOUTON_DEPLOYER) return false;
    }

    const rapport = await ScenarioManager.deploy(racine, cible, options);
    ui.informer(ScenarioManager.resumerDeploiement(rapport));
    return true;
  } catch (err) {
    const prefixe = err instanceof BancEssaiRefus ? 'Déploiement refusé' : 'Erreur de déploiement';
    ui.signalerErreur(`${prefixe} : ${ScenarioManager.decrireErreur(err)}`);
    return false;
  }
}
