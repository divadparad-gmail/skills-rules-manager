/**
 * Textes des avertissements du banc d'essai : barre d'état, bandeaux de la barre latérale et du
 * Grand Dashboard, notification au démarrage. Sans `vscode` : testable hors de l'hôte.
 */
import { EtatBanc } from '../services/ScenarioManager';

export interface PresentationBanc {
  visible: boolean;
  niveau: EtatBanc['niveau'];
  titre: string;
  detail: string;
  infobulle: string;
}

const pluriel = (n: number, singulier: string, plurielForme: string) => `${n} ${n > 1 ? plurielForme : singulier}`;

export function presenterBanc(etat: EtatBanc): PresentationBanc {
  if (etat.niveau === 'aucun') {
    return { visible: false, niveau: 'aucun', titre: '', detail: '', infobulle: '' };
  }
  const originaux = pluriel(etat.nbOriginaux, 'vrai fichier sauvegardé', 'vrais fichiers sauvegardés');
  const interrompu = etat.niveau === 'interrompu';
  const titre = interrompu ? '⛔ Banc d\'essai interrompu' : '⚠️ Banc d\'essai actif';
  const detail = interrompu
    ? `Une opération du banc d'essai ne s'est pas terminée (${originaux}). Videz le banc pour restaurer les originaux.`
    : `Les fixtures${etat.cible ? ` « ${etat.cible} »` : ''} sont déployées (${originaux}). Videz le banc avant de commiter.`;
  const lignes = [
    titre,
    `État du journal : ${etat.etat ?? (etat.manifeste === 'illisible' ? 'manifeste illisible' : etat.manifeste === 'herite' ? 'manifeste antérieur' : 'absent')}`,
    ...(etat.cible ? [`Cible : ${etat.cible}`] : []),
    ...(etat.deployeLe ? [`Déployé le : ${etat.deployeLe}`] : []),
    `Fixtures : ${etat.nbFixtures} · originaux sauvegardés : ${etat.nbOriginaux}`,
    'Cliquez pour vider le banc et restaurer les originaux.',
  ];
  return { visible: true, niveau: etat.niveau, titre, detail, infobulle: lignes.join('\n') };
}

/** Avertissement affiché au démarrage de l'extension quand un banc est encore déployé ou inachevé. */
export function messageDemarrage(etat: EtatBanc): string | null {
  if (etat.niveau === 'aucun') return null;
  const originaux = pluriel(etat.nbOriginaux, 'vrai fichier', 'vrais fichiers');
  return etat.niveau === 'interrompu'
    ? `Une opération du banc d'essai a été interrompue (${originaux} en sauvegarde). Voulez-vous vider le banc et restaurer les originaux ?`
    : `Le banc d'essai est encore déployé dans cet espace de travail (${originaux} en sauvegarde). Voulez-vous le vider et restaurer les originaux ?`;
}
