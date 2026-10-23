/**
 * Hook PreToolUse de Claude Code (déclaré dans .claude/settings.json, outils Bash et PowerShell).
 *
 * Refuse dans ce dépôt, avant leur exécution :
 *   - git clean avec -x ou -X : il effacerait les fichiers ignorés par Git, dont
 *     .banc-essai-sauvegarde/, seule copie des originaux pendant un déploiement du banc d'essai ;
 *   - git commit avec --no-verify ou -n : il contournerait le hook pre-commit (garde-fou des fixtures).
 *
 * La commande est découpée comme le ferait le shell : guillemets, enchaînements (&&, ||, ;, |, &,
 * retours à la ligne), groupes et sous-shells, substitutions $(…) et `…`, arguments de bash -c,
 * sh -c, eval, pwsh -Command et cmd /c. Le corps des heredocs (<<EOF) et des here-strings de
 * PowerShell (@'…'@) n'est pas analysé : c'est du texte, par exemple un message de commit. Les
 * options suivent l'analyse de Git (options groupées, valeur collée ou séparée, abréviations).
 * Tout mot non cité nommé git (ou git.exe, quel que soit son chemin) est analysé, y compris après
 * un préfixe comme sudo, env ou xargs : « echo git clean -x » est donc refusé, par prudence.
 *
 * Refus : sortie JSON documentée (permissionDecision: "deny"), qui tient dans tous les modes de
 * permission, y compris bypassPermissions. Erreur interne (entrée illisible, exception) : la
 * commande passe (code 1, erreur non bloquante pour Claude Code) avec un avertissement sur stderr.
 * Un hook défectueux ne doit pas bloquer toutes les commandes ; la consigne écrite reste en vigueur.
 *
 * Usage : node scripts/garde-git-claude.js < entrée JSON de PreToolUse
 */
'use strict';

const PROFONDEUR_MAX = 8;

const REGLES = {
  'git-clean-x':
    '« git clean » avec -x ou -X est interdit dans ce dépôt : il supprimerait les fichiers ignorés par Git, ' +
    'dont .banc-essai-sauvegarde/, seule copie des originaux du banc d\'essai. Pour vider le banc d\'essai, ' +
    'utilisez npm run test:clean ; sinon, git clean sans -x ni -X.',
  'git-commit-no-verify':
    '« git commit » avec --no-verify ou -n est interdit dans ce dépôt : il contournerait le hook pre-commit ' +
    '(garde-fou des fixtures). Corrigez la cause signalée par le hook, puis commitez sans contournement.',
};

// Options globales de git suivies d'une valeur dans le mot suivant
const GIT_GLOBALES_AVEC_VALEUR = ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env'];
// Options longues de git commit suivies d'une valeur dans le mot suivant (sans « = »)
const COMMIT_LONGUES_AVEC_VALEUR = [
  'message', 'file', 'reuse-message', 'reedit-message', 'template', 'author', 'date',
  'cleanup', 'fixup', 'squash', 'trailer', 'pathspec-from-file',
];
// Options courtes de git commit : valeur collée ou mot suivant, ou valeur collée seulement
const COMMIT_COURTES_AVEC_VALEUR = 'mFcCt';
const COMMIT_COURTES_VALEUR_COLLEE = 'Su';

const SHELLS_POSIX = ['bash', 'sh', 'zsh', 'dash', 'ksh'];
const SHELLS_POWERSHELL = ['pwsh', 'powershell'];

/** Nom de base d'un programme, en minuscules et sans l'extension .exe. */
function nomProgramme(valeur) {
  const base = valeur.split(/[\\/]/).pop().toLowerCase();
  return base.endsWith('.exe') ? base.slice(0, -4) : base;
}

// ---------------------------------------------------------------------------------------------
// Découpage en commandes simples
// ---------------------------------------------------------------------------------------------

/**
 * Découpe une source en commandes simples (tableaux de mots), dans l'ordre. Les commandes des
 * substitutions et des sous-shells s'ajoutent à la même liste : chacune est analysée à part.
 */
function decouper(source, dialecte, profondeur) {
  if (profondeur > PROFONDEUR_MAX) throw new Error('imbrication trop profonde');
  const etat = { s: source, i: 0, dialecte, profondeur, commandes: [] };
  lireListe(etat, false);
  return etat.commandes;
}

/** Lit des commandes jusqu'à la fin de la source, ou jusqu'à la « ) » fermante d'un $( … ). */
function lireListe(etat, dansSubstitution) {
  const { s, dialecte } = etat;
  const powershell = dialecte === 'powershell';
  let mots = [];
  let mot = null;
  let parentheses = 0;
  const heredocs = [];

  const ajouter = (texte) => {
    if (mot === null) mot = '';
    mot += texte;
  };
  const finirMot = () => {
    if (mot !== null) mots.push(mot);
    mot = null;
  };
  const finirCommande = () => {
    finirMot();
    if (mots.length > 0) etat.commandes.push(mots);
    mots = [];
  };

  while (etat.i < s.length) {
    const c = s[etat.i];
    const suivant = s[etat.i + 1];

    // Échappement : \ hors de PowerShell, ` dans PowerShell. Devant un retour à la ligne : continuation.
    if ((c === '\\' && !powershell) || (c === '`' && powershell)) {
      if (suivant === '\n') etat.i += 2;
      else if (suivant === '\r' && s[etat.i + 2] === '\n') etat.i += 3;
      else {
        ajouter(suivant === undefined ? '' : suivant);
        etat.i += 2;
      }
      continue;
    }

    // Here-strings de PowerShell : @'…'@ (littéral) et @"…"@ (substitutions $(…) analysées)
    if (powershell && mot === null && c === '@' && (suivant === '\'' || suivant === '"') && /^[ \t]*\r?\n/.test(s.slice(etat.i + 2))) {
      const fermeture = suivant + '@';
      const debutCorps = s.indexOf('\n', etat.i) + 1;
      const fin = chercherFermetureHereString(s, debutCorps, fermeture);
      const corps = s.slice(debutCorps, fin === -1 ? s.length : fin);
      if (suivant === '"') analyserSubstitutionsPowerShell(etat, corps);
      ajouter(corps);
      etat.i = fin === -1 ? s.length : fin + 1 + fermeture.length;
      continue;
    }

    if (c === '\'') {
      etat.i++;
      let texte = '';
      while (etat.i < s.length) {
        if (s[etat.i] === '\'') {
          // PowerShell : '' vaut une apostrophe
          if (powershell && s[etat.i + 1] === '\'') {
            texte += '\'';
            etat.i += 2;
            continue;
          }
          break;
        }
        texte += s[etat.i++];
      }
      etat.i++;
      ajouter(texte);
      continue;
    }

    if (c === '"') {
      etat.i++;
      ajouter(lireGuillemetsDoubles(etat));
      continue;
    }

    if (c === '$' && suivant === '(') {
      etat.i += 2;
      lireSubstitution(etat);
      ajouter('$(…)');
      continue;
    }

    if (c === '`' && !powershell) {
      const fin = chercherAccentGraveFermant(s, etat.i + 1);
      const contenu = s.slice(etat.i + 1, fin === -1 ? s.length : fin);
      etat.commandes.push(...decouper(contenu, dialecte, etat.profondeur + 1));
      etat.i = fin === -1 ? s.length : fin + 1;
      ajouter('`…`');
      continue;
    }

    // Commentaire en début de mot ; <# … #> dans PowerShell
    if (c === '#' && mot === null) {
      while (etat.i < s.length && s[etat.i] !== '\n') etat.i++;
      continue;
    }
    if (powershell && c === '<' && suivant === '#' && mot === null) {
      const fin = s.indexOf('#>', etat.i + 2);
      etat.i = fin === -1 ? s.length : fin + 2;
      continue;
    }

    // Heredoc : << ou <<- suivi du délimiteur (le corps commence à la ligne suivante)
    if (!powershell && c === '<' && suivant === '<' && s[etat.i + 2] !== '<') {
      finirMot();
      etat.i += 2;
      let tabulations = false;
      if (s[etat.i] === '-') {
        tabulations = true;
        etat.i++;
      }
      while (s[etat.i] === ' ' || s[etat.i] === '\t') etat.i++;
      heredocs.push({ delimiteur: lireDelimiteur(etat), tabulations });
      continue;
    }

    if (c === '(') {
      finirCommande();
      parentheses++;
      etat.i++;
      continue;
    }
    if (c === ')') {
      finirCommande();
      etat.i++;
      if (parentheses > 0) {
        parentheses--;
        continue;
      }
      if (dansSubstitution) return;
      continue;
    }
    if ((c === '{' || c === '}') && mot === null) {
      finirCommande();
      etat.i++;
      continue;
    }

    if (c === '\n') {
      finirCommande();
      etat.i++;
      if (heredocs.length > 0) {
        sauterCorpsHeredocs(etat, heredocs);
        heredocs.length = 0;
      }
      continue;
    }
    if (c === ';' || c === '&' || c === '|') {
      finirCommande();
      etat.i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      finirMot();
      etat.i++;
      continue;
    }

    ajouter(c);
    etat.i++;
  }
  finirCommande();
}

/** Lit une substitution $( … ) (le « $( » est déjà lu), un niveau plus bas. */
function lireSubstitution(etat) {
  etat.profondeur++;
  if (etat.profondeur > PROFONDEUR_MAX) throw new Error('imbrication trop profonde');
  lireListe(etat, true);
  etat.profondeur--;
}

/** Lit une chaîne entre guillemets doubles (le guillemet ouvrant est déjà lu). */
function lireGuillemetsDoubles(etat) {
  const { s } = etat;
  const powershell = etat.dialecte === 'powershell';
  let texte = '';
  while (etat.i < s.length) {
    const c = s[etat.i];
    if (c === '"') {
      // PowerShell : "" vaut un guillemet
      if (powershell && s[etat.i + 1] === '"') {
        texte += '"';
        etat.i += 2;
        continue;
      }
      etat.i++;
      return texte;
    }
    // Bash : \ n'échappe que $ ` " \ et le retour à la ligne ; ailleurs, il reste (C:\Program Files)
    if (c === '\\' && !powershell && s[etat.i + 1] !== undefined) {
      const echappe = s[etat.i + 1];
      if (echappe !== '\n') texte += '$`"\\'.includes(echappe) ? echappe : c + echappe;
      etat.i += 2;
      continue;
    }
    if (c === '`' && powershell && s[etat.i + 1] !== undefined) {
      texte += s[etat.i + 1];
      etat.i += 2;
      continue;
    }
    if (c === '$' && s[etat.i + 1] === '(') {
      etat.i += 2;
      lireSubstitution(etat);
      texte += '$(…)';
      continue;
    }
    if (c === '`' && !powershell) {
      const fin = chercherAccentGraveFermant(s, etat.i + 1);
      const contenu = s.slice(etat.i + 1, fin === -1 ? s.length : fin);
      etat.commandes.push(...decouper(contenu, etat.dialecte, etat.profondeur + 1));
      etat.i = fin === -1 ? s.length : fin + 1;
      texte += '`…`';
      continue;
    }
    texte += c;
    etat.i++;
  }
  return texte;
}

/** Analyse les $(…) d'un here-string expansible de PowerShell (le reste est du texte). */
function analyserSubstitutionsPowerShell(etat, corps) {
  for (let k = 0; k < corps.length; k++) {
    if (corps[k] === '`') {
      k++;
      continue;
    }
    if (corps[k] === '$' && corps[k + 1] === '(') {
      const sous = { s: corps, i: k + 2, dialecte: 'powershell', profondeur: etat.profondeur + 1, commandes: etat.commandes };
      if (sous.profondeur > PROFONDEUR_MAX) throw new Error('imbrication trop profonde');
      lireListe(sous, true);
      k = sous.i - 1;
    }
  }
}

function chercherAccentGraveFermant(s, debut) {
  for (let k = debut; k < s.length; k++) {
    if (s[k] === '\\') k++;
    else if (s[k] === '`') return k;
  }
  return -1;
}

/** Position du retour à la ligne qui précède la ligne de fermeture '@ ou "@, ou -1. */
function chercherFermetureHereString(s, debutCorps, fermeture) {
  if (s.startsWith(fermeture, debutCorps)) return debutCorps - 1;
  let k = debutCorps;
  while (k < s.length) {
    const fin = s.indexOf('\n', k);
    if (fin === -1) return -1;
    if (s.startsWith(fermeture, fin + 1)) return fin;
    k = fin + 1;
  }
  return -1;
}

/** Lit le délimiteur d'un heredoc, sans ses guillemets ni ses barres obliques inverses. */
function lireDelimiteur(etat) {
  const { s } = etat;
  let delimiteur = '';
  while (etat.i < s.length && !/[\s;&|<>()]/.test(s[etat.i])) {
    const c = s[etat.i];
    if (c === '\'' || c === '"') {
      const fin = s.indexOf(c, etat.i + 1);
      delimiteur += s.slice(etat.i + 1, fin === -1 ? s.length : fin);
      etat.i = fin === -1 ? s.length : fin + 1;
    } else if (c === '\\') {
      delimiteur += s[etat.i + 1] || '';
      etat.i += 2;
    } else {
      delimiteur += c;
      etat.i++;
    }
  }
  return delimiteur;
}

/** Saute le corps de chaque heredoc en attente, jusqu'à sa ligne de fin (ou la fin de la source). */
function sauterCorpsHeredocs(etat, heredocs) {
  const { s } = etat;
  for (const { delimiteur, tabulations } of heredocs) {
    while (etat.i < s.length) {
      const finLigne = s.indexOf('\n', etat.i);
      const ligne = s.slice(etat.i, finLigne === -1 ? s.length : finLigne).replace(/\r$/, '');
      etat.i = finLigne === -1 ? s.length : finLigne + 1;
      if ((tabulations ? ligne.replace(/^\t+/, '') : ligne) === delimiteur) break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Analyse des commandes simples
// ---------------------------------------------------------------------------------------------

/**
 * Analyse une commande telle que l'outil Bash ou PowerShell la reçoit.
 * @param {string} commande
 * @param {'bash'|'powershell'} [dialecte]
 * @returns {Array<{ regle: string, commande: string }>} les refus (vide : commande permise)
 */
function analyserCommande(commande, dialecte = 'bash', profondeur = 0) {
  const refus = [];
  for (const mots of decouper(commande, dialecte, profondeur)) {
    analyserMots(mots, dialecte, profondeur, refus);
  }
  return refus;
}

function analyserMots(mots, dialecte, profondeur, refus) {
  const ajouterRefus = (regle) => {
    if (!refus.some((r) => r.regle === regle)) refus.push({ regle, commande: mots.join(' ') });
  };
  const analyserTexte = (texte, sousDialecte) => {
    for (const r of analyserCommande(texte, sousDialecte, profondeur + 1)) ajouterRefus(r.regle);
  };

  for (let k = 0; k < mots.length; k++) {
    const nom = nomProgramme(mots[k]);
    if (nom === 'git') {
      analyserGit(mots, k + 1, ajouterRefus);
    } else if (nom === 'git-clean') {
      analyserClean(mots, k + 1, ajouterRefus);
    } else if (nom === 'git-commit') {
      analyserCommit(mots, k + 1, ajouterRefus);
    } else if (SHELLS_POSIX.includes(nom)) {
      // bash -c '…', sh -lc '…', bash -o pipefail -c '…' : le script est le mot qui suit l'option
      const j = mots.findIndex((m, index) => index > k && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(m));
      if (j !== -1 && j + 1 < mots.length) analyserTexte(mots[j + 1], 'bash');
    } else if (nom === 'eval') {
      analyserTexte(mots.slice(k + 1).join(' '), dialecte);
    } else if (SHELLS_POWERSHELL.includes(nom)) {
      // -Command (ou une abréviation) prend le reste ; -EncodedCommand (-e, -ec…) prend du base64 UTF-16LE
      for (let j = k + 1; j < mots.length; j++) {
        const option = mots[j].toLowerCase();
        if (!/^[-/][a-z]+$/.test(option)) continue;
        const nomOption = option.slice(1);
        if ('encodedcommand'.startsWith(nomOption) || nomOption === 'ec') {
          if (j + 1 < mots.length) analyserTexte(Buffer.from(mots[j + 1], 'base64').toString('utf16le'), 'powershell');
          break;
        }
        if ('command'.startsWith(nomOption)) {
          analyserTexte(mots.slice(j + 1).join(' '), 'powershell');
          break;
        }
      }
    } else if (nom === 'cmd') {
      const j = mots.findIndex((m, index) => index > k && /^\/[ck]$/i.test(m));
      if (j !== -1) analyserTexte(mots.slice(j + 1).join(' '), 'bash');
    }
  }
}

/** Saute les options globales de git, puis analyse la sous-commande. */
function analyserGit(mots, debut, ajouterRefus) {
  let j = debut;
  while (j < mots.length) {
    const mot = mots[j];
    if (GIT_GLOBALES_AVEC_VALEUR.includes(mot)) j += 2;
    else if (mot.startsWith('-')) j++;
    else break;
  }
  if (j >= mots.length) return;
  if (mots[j] === 'clean') analyserClean(mots, j + 1, ajouterRefus);
  else if (mots[j] === 'commit') analyserCommit(mots, j + 1, ajouterRefus);
}

function analyserClean(mots, debut, ajouterRefus) {
  for (let j = debut; j < mots.length; j++) {
    const mot = mots[j];
    if (mot === '--') return;
    if (mot.startsWith('--')) {
      // --exclude (ou son abréviation) sans « = » prend le mot suivant
      const nom = mot.slice(2);
      if (nom.length > 0 && 'exclude'.startsWith(nom)) j++;
      continue;
    }
    if (!mot.startsWith('-') || mot.length < 2) continue;
    for (let k = 1; k < mot.length; k++) {
      if (mot[k] === 'x' || mot[k] === 'X') {
        ajouterRefus('git-clean-x');
        return;
      }
      if (mot[k] === 'e') {
        // -e prend le reste du groupe, ou le mot suivant
        if (k === mot.length - 1) j++;
        break;
      }
    }
  }
}

function analyserCommit(mots, debut, ajouterRefus) {
  for (let j = debut; j < mots.length; j++) {
    const mot = mots[j];
    if (mot === '--') return;
    if (mot.startsWith('--')) {
      if (mot.includes('=')) continue;
      const nom = mot.slice(2);
      // Git accepte une abréviation sans ambiguïté : --no-veri, --no-verif, --no-verify
      if (nom.length >= 'no-veri'.length && 'no-verify'.startsWith(nom)) {
        ajouterRefus('git-commit-no-verify');
        return;
      }
      if (nom.length >= 2 && COMMIT_LONGUES_AVEC_VALEUR.some((option) => option.startsWith(nom))) j++;
      continue;
    }
    if (!mot.startsWith('-') || mot.length < 2) continue;
    for (let k = 1; k < mot.length; k++) {
      const option = mot[k];
      if (option === 'n') {
        ajouterRefus('git-commit-no-verify');
        return;
      }
      if (COMMIT_COURTES_AVEC_VALEUR.includes(option)) {
        // -m prend le reste du groupe (-mn : message « n »), ou le mot suivant (-m -n : message « -n »)
        if (k === mot.length - 1) j++;
        break;
      }
      if (COMMIT_COURTES_VALEUR_COLLEE.includes(option)) break;
    }
  }
}

/** Raison du refus, en français, renvoyée à l'agent. */
function raisonRefus(refus) {
  const regles = [...new Set(refus.map((r) => r.regle))];
  return ['[garde-git] Commande refusée par le hook PreToolUse du projet.', ...regles.map((regle) => REGLES[regle])].join('\n');
}

/** Sortie JSON de refus ; les caractères non ASCII sont échappés pour ne dépendre d'aucun encodage. */
function sortieRefus(refus) {
  const sortie = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: raisonRefus(refus),
    },
  };
  return JSON.stringify(sortie).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Décision pour une entrée brute de PreToolUse : refus (JSON sur stdout) ou erreur (avertissement). */
function decider(brut) {
  let entree;
  try {
    entree = JSON.parse(brut);
  } catch (err) {
    return { erreur: `entrée JSON illisible (${err.message})` };
  }
  const commande = entree && entree.tool_input && entree.tool_input.command;
  if (typeof commande !== 'string') return { erreur: 'tool_input.command absent ou invalide' };
  const refus = analyserCommande(commande, entree.tool_name === 'PowerShell' ? 'powershell' : 'bash');
  return refus.length > 0 ? { sortie: sortieRefus(refus) } : {};
}

module.exports = {
  REGLES,
  analyserCommande,
  raisonRefus,
  sortieRefus,
  decider,
};

if (require.main === module) {
  let termine = false;
  const avertir = (raison) => {
    if (termine) return;
    termine = true;
    process.stderr.write(
      `[garde-git] Avertissement : analyse impossible, ${raison}. La commande est laissée passer ; ` +
        'la consigne de projet-consignes.md reste en vigueur.\n'
    );
    process.exitCode = 1;
  };
  process.on('uncaughtException', (err) => avertir(`erreur interne (${err && err.message})`));

  let brut = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (morceau) => {
    brut += morceau;
  });
  process.stdin.on('error', (err) => avertir(`lecture de l'entrée impossible (${err.message})`));
  process.stdin.on('end', () => {
    try {
      const { erreur, sortie } = decider(brut);
      if (erreur) avertir(erreur);
      else if (sortie) process.stdout.write(`${sortie}\n`);
      termine = true;
    } catch (err) {
      avertir(`erreur interne (${err.message})`);
    }
  });
}
