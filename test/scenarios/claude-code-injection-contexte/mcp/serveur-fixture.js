/**
 * Serveur MCP de fixture de la suite d'injection Claude Code (stdio, aucune action).
 *
 * Usage : node serveur-fixture.js <définition>
 *   <définition> est un fichier serveur.json.fixture d'un jeu de fixtures/ (cible mcp), ou sa copie
 *   déployée. Le serveur ne lit aucun autre fichier, n'ouvre aucune connexion réseau et ne lance aucun
 *   processus. Il n'utilise que les modules intégrés de Node.
 *
 * Protocole : JSON-RPC 2.0, un message par ligne sur l'entrée et la sortie standard.
 *   - initialize : reprend la protocolVersion du client, renvoie serverInfo et les instructions ;
 *   - tools/list : la liste des outils de la définition ;
 *   - tools/call : un texte fixe, sans aucune action ;
 *   - ping : un résultat vide ;
 *   - toute autre méthode : l'erreur -32601. Les notifications (sans id) et les lignes illisibles sont ignorées.
 *
 * La clé « env » de la définition n'est pas lue par le serveur : le lanceur s'en sert pour la
 * configuration MCP qu'il génère (hypothèse H12, variable d'environnement non injectée).
 */
'use strict';

const fs = require('fs');

const VERSION_PROTOCOLE_DEFAUT = '2025-06-18';
const TEXTE_APPEL = 'Outil de fixture : aucune action.';
const NOM_SERVEUR = /^canari[a-z0-9-]*$/;
const NOM_OUTIL = /^canari_[a-z0-9_]*$/;
const CLES_DEFINITION = new Set(['nom', 'version', 'instructions', 'outils', 'env']);
const CLES_OUTIL = new Set(['nom', 'description', 'schema']);

const estObjet = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Vérifie une définition et renvoie la liste des problèmes (vide si elle est valide). */
function problemesDefinition(def) {
  const problemes = [];
  if (!estObjet(def)) return ['la définition doit être un objet JSON'];
  for (const cle of Object.keys(def)) {
    if (!CLES_DEFINITION.has(cle)) problemes.push(`clé inconnue : ${cle}`);
  }
  if (typeof def.nom !== 'string' || !NOM_SERVEUR.test(def.nom)) problemes.push('« nom » doit commencer par « canari »');
  if (typeof def.version !== 'string' || def.version === '') problemes.push('« version » doit être une chaîne non vide');
  if (def.instructions !== undefined && typeof def.instructions !== 'string') problemes.push('« instructions » doit être une chaîne');
  if (!Array.isArray(def.outils) || def.outils.length === 0) {
    problemes.push('« outils » doit être une liste non vide');
  } else {
    def.outils.forEach((outil, i) => {
      if (!estObjet(outil)) return problemes.push(`outil ${i} : un objet est attendu`);
      for (const cle of Object.keys(outil)) {
        if (!CLES_OUTIL.has(cle)) problemes.push(`outil ${i} : clé inconnue : ${cle}`);
      }
      if (typeof outil.nom !== 'string' || !NOM_OUTIL.test(outil.nom)) problemes.push(`outil ${i} : « nom » doit commencer par « canari_ »`);
      if (typeof outil.description !== 'string') problemes.push(`outil ${i} : « description » doit être une chaîne`);
      if (!estObjet(outil.schema) || outil.schema.type !== 'object') problemes.push(`outil ${i} : « schema » doit être un objet de type « object »`);
    });
  }
  if (def.env !== undefined && (!estObjet(def.env) || Object.values(def.env).some((v) => typeof v !== 'string'))) {
    problemes.push('« env » doit associer des noms à des chaînes');
  }
  return problemes;
}

/** Lit et vérifie une définition ; lève une erreur explicite si elle est invalide. */
function lireDefinition(chemin) {
  let def;
  try {
    def = JSON.parse(fs.readFileSync(chemin, 'utf8'));
  } catch (err) {
    throw new Error(`définition illisible (${err.message})`);
  }
  const problemes = problemesDefinition(def);
  if (problemes.length > 0) throw new Error(`définition invalide : ${problemes.join(' ; ')}`);
  return def;
}

const reponse = (id, result) => ({ jsonrpc: '2.0', id, result });
const erreur = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** Réponse à un message JSON-RPC déjà analysé, ou null s'il n'appelle aucune réponse. */
function traiter(message, def) {
  if (!estObjet(message) || message.id === undefined || message.id === null) return null;
  const { id, method, params } = message;
  switch (method) {
    case 'initialize': {
      const result = {
        protocolVersion: (estObjet(params) && typeof params.protocolVersion === 'string' && params.protocolVersion) || VERSION_PROTOCOLE_DEFAUT,
        capabilities: { tools: {} },
        serverInfo: { name: def.nom, version: def.version },
      };
      if (def.instructions !== undefined) result.instructions = def.instructions;
      return reponse(id, result);
    }
    case 'tools/list':
      return reponse(id, {
        tools: def.outils.map((o) => ({ name: o.nom, description: o.description, inputSchema: o.schema })),
      });
    case 'tools/call': {
      const nom = estObjet(params) ? params.name : undefined;
      if (!def.outils.some((o) => o.nom === nom)) return erreur(id, -32602, `Outil inconnu : ${String(nom)}`);
      return reponse(id, { content: [{ type: 'text', text: TEXTE_APPEL }] });
    }
    case 'ping':
      return reponse(id, {});
    default:
      return erreur(id, -32601, `Méthode inconnue : ${String(method)}`);
  }
}

module.exports = { VERSION_PROTOCOLE_DEFAUT, TEXTE_APPEL, problemesDefinition, lireDefinition, traiter };

if (require.main === module) {
  const chemin = process.argv[2];
  if (!chemin) {
    process.stderr.write('[serveur-fixture] Usage : node serveur-fixture.js <définition>\n');
    process.exit(2);
  }
  let def;
  try {
    def = lireDefinition(chemin);
  } catch (err) {
    process.stderr.write(`[serveur-fixture] ${err.message}\n`);
    process.exit(2);
  }
  const lignes = require('readline').createInterface({ input: process.stdin });
  lignes.on('line', (ligne) => {
    let message;
    try {
      message = JSON.parse(ligne);
    } catch {
      return;
    }
    const sortie = traiter(message, def);
    if (sortie) process.stdout.write(JSON.stringify(sortie) + '\n');
  });
  lignes.on('close', () => process.exit(0));
}
