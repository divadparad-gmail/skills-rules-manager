---
trigger: always_on
description: Interdits et obligations de sécurité non négociables pour tout code qui touche aux secrets, au réseau, à la configuration ou aux fichiers lus par un agent.
---

# Sécurité du code : noyau

- Avant de toucher aux secrets, au réseau, à la configuration ou aux fichiers lus par un agent, identifie qui contrôle chaque valeur.
- Ne fais confiance qu'à l'utilisateur. Le dépôt ouvert, même approuvé, et tout registre ou serveur distant ne sont pas fiables.
- N'envoie un secret du coffre que vers une destination définie par l'utilisateur ; l'espace de travail ne choisit jamais la clé lue ni le serveur.
- Conserve l'origine de chaque valeur jusqu'au point d'usage ; calcule-la à la lecture, jamais depuis la configuration.
- Mets les secrets dans un en-tête, jamais dans l'URL.
- Ne cite jamais une URL complète, un en-tête ou un corps de requête dans un message d'erreur.
- Empêche une entrée d'espace de travail d'usurper une entrée utilisateur.
- Insère le texte par `textContent`, jamais par `innerHTML`.
- Pour une URL non fiable, refuse le bouclage, les réseaux privés et le lien local, sur l'adresse résolue à la connexion.
- Réserve la tolérance HTTP ou locale à la configuration utilisateur.
- Garde TLS vérifié, un délai et une taille de réponse bornés ; avec un secret joint, ne suis aucune redirection automatique.
- N'écris aucun contenu externe dans un dossier lu par un agent sans l'afficher en entier, puis obtenir une confirmation explicite (nom et source).
- N'ajoute aucune URL, aucun domaine, registre ou service par défaut absent de la spécification ou de la demande.
- Si une valeur manque, demande-la ; ne transmets aucune donnée sans action explicite de l'utilisateur.
- Signale toute valeur déduite plutôt que reçue.
- Pour chaque faille corrigée, ajoute un test qui rejoue l'attaque.
- Si un point dépend d'une décision hors du code, pose la question au lieu de trancher.

Détails, raisons et exemples : `.agents/rules/09b-rule-securite-code-detail.md`.
