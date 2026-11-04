import * as assert from 'node:assert';
import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe } from 'node:test';

// Suite d'injection Claude Code, lot I1 : fixtures inertes, serveur MCP de fixture et garde de confidentialité.
// Aucun appel à claude. Le lanceur (I2) déploie un jeu dans l'espace isolé en convertissant les noms (voir convertir()).
const ROOT = path.resolve(__dirname, '..', '..');
const SUITE_REL = 'test/scenarios/claude-code-injection-contexte';
const SUITE = path.join(ROOT, SUITE_REL);
const FIXTURES = path.join(SUITE, 'fixtures');
const SERVEUR = path.join(SUITE, 'mcp', 'serveur-fixture.js');

/**
 * Inventaire figé : chemin sous fixtures/ (<jeu>/<cible>/<miroir>), empreinte SHA-256 du contenu en LF,
 * canaris attendus (chacun exactement une fois). Une fixture modifiée rend la baseline caduque : toute
 * modification volontaire passe par la mise à jour de cette table.
 */
const INVENTAIRE: [string, string, string[]][] = [
  ['agents-avec-claude/projet/AGENTS.md.fixture', 'edffa7ef3c30ca4511e30659b2de8c135faee8045b487d1dec96d18482955717', ['CANARI-CC-AGAVEC-MJPA']],
  ['agents-avec-claude/projet/CLAUDE.md.fixture', 'b8917ebc0a9ffeab4a5dcade4c14838e64bfc6e2099b8311a51539b10a84b30c', ['CANARI-CC-AGCLAUDE-KGA8']],
  ['agents-seul/projet/AGENTS.md.fixture', 'fb068ce8048671a27bc6ddb44f1ee4f29656a2e001278e83499dd2cb1a6c2b26', ['CANARI-CC-AGSEUL-3QUN']],
  ['cout-f-global/global/CLAUDE.md.fixture', '399e76edebcd4426fcd8af976ab2cdeda5c279bb608d1693a33cc2904d4074e1', []],
  ['cout-f-parent/parent/CLAUDE.md.fixture', '399e76edebcd4426fcd8af976ab2cdeda5c279bb608d1693a33cc2904d4074e1', []],
  ['cout-f-projet-claude/projet/_claude/CLAUDE.md.fixture', '399e76edebcd4426fcd8af976ab2cdeda5c279bb608d1693a33cc2904d4074e1', []],
  ['cout-f-projet/projet/CLAUDE.md.fixture', '399e76edebcd4426fcd8af976ab2cdeda5c279bb608d1693a33cc2904d4074e1', []],
  ['cout-f2-projet/projet/CLAUDE.md.fixture', '3884c3cd6f90ced88f6ea96dde1c64341f1361d4aa7213c8dd48534fbb8fe4cc', []],
  ['cout-h15-anglais/projet/CLAUDE.md.fixture', '6f8bc9316725f65bd328c05fc4ee5223b561142e63b24e6afd357ddcef717bab', []],
  ['cout-h15-code/projet/CLAUDE.md.fixture', 'e79672a0bb31d4bd9df76b226bb557127e5859b423c69eb913d7ca81a675773a', []],
  ['cout-mcp-a1/mcp/serveur.json.fixture', '17b08b9b45eb94cb715506cb34e38640fb0b658f22852822b8962b2b4ff3fabc', []],
  ['cout-mcp-a2/mcp/serveur.json.fixture', 'c5023d33cd244d488621cf3b85d0b82d11da13a71a9c2e6b7ba2d1cca17e3b5e', []],
  ['cout-mcp-b1/mcp/serveur.json.fixture', 'bf34b38cedb90cdcce35f5d1399e61df3c56f47390a2c1ccd96fc4ecafdb72c1', []],
  ['cout-regle-court/projet/_claude/rules/r.md.fixture', '1f13c607496b09f600b91215267dde0216ceb9186c24322909701f1c8a083096', []],
  ['cout-regle-long/projet/_claude/rules/regle-au-nom-volontairement-tres-long-pour-mesurer-le-cout-du-chemin.md.fixture', '1f13c607496b09f600b91215267dde0216ceb9186c24322909701f1c8a083096', []],
  ['cout-regle-paths/projet/_claude/rules/r-paths.md.fixture', 'a53da43e35870ad48a920523639fdf3ae3a2b1289b24bf9244ab1fe759b90c98', []],
  ['cout-skill-global/global/skills/canari-s2/SKILL.md.fixture', '3207078c6a1775024511a99dc63dc580d6fed2ff68b0a6b3eda2bd6782d11fae', []],
  ['cout-skill-projet/projet/_claude/skills/canari-s1/SKILL.md.fixture', 'd8b6e91bcd3c55014aefae01096c9974b6db46f61e3bce1f5b6d6c943406620c', []],
  ['cout-skill-x2/projet/_claude/skills/canari-s1/SKILL.md.fixture', '89bb469d6eccdcfe5a503a1351798b7d00acdafcfbc4176d21f30e345c144cc6', []],
  ['declencheurs/projet/_claude/rules/d-paths.md.fixture', 'be0b38434504bbc6a36d51bec0fa9df94ad8f2863d88cdae13074af13432f4ed', ['CANARI-CC-DPATHS-9C2L']],
  ['declencheurs/projet/_claude/skills/canari-paths/SKILL.md.fixture', '3e483f1ea89a182d12829e2f7fa8c7268fdb30cdc5bdae7afd73327efd83bd0a', ['CANARI-CC-DSKPATHS-Q9PG', 'CANARI-CC-DSKCORPS-ZLKX']],
  ['declencheurs/projet/b.txt.fixture', 'c18665044cf4d00aeaee9d06f608eceee0307e5cbb341e46f2989cc8c9e6b84e', []],
  ['declencheurs/projet/sous/CLAUDE.md.fixture', 'fe798830ee8c2ed077b3c810a23b69832717181b2ac83bb5026922aabfe886ea', ['CANARI-CC-DSOUS-7VJB']],
  ['declencheurs/projet/sous/note.txt.fixture', '38266c6895b1e262a06ab0ad07676e4000bea382dcbfdc13e911e208bfcf99bf', []],
  ['declencheurs/projet/src/a.ts.fixture', '037ecd1db38c230c248787e60fd7bfc0cb0101b187b59535b6e7483be762d350', []],
  ['hook-muet/projet/_claude/settings.json.fixture', '622162b72cf622d722dc8e259becf19c208304bffc58a31a52475a48c778b0e5', []],
  ['hook-sortie/projet/_claude/settings.json.fixture', 'befd4edd52c43fc71bbcd7f5edcb5fb27146b99f36460264c08b13416f0f25d8', ['CANARI-CC-HOOK-C2QM']],
  ['mcp-canari/mcp/serveur.json.fixture', '36ffd76c82a30d7c9070a661cbcb60d496f36fd9a143dfbee665e7d16f801e01', ['CANARI-CC-MCPINSTR-76MH', 'CANARI-CC-MCPOUTIL-S65X', 'CANARI-CC-MCPENV-KGUZ']],
  ['mcp-long/mcp/serveur.json.fixture', 'f4e520ebd1464b5911dd8e75e1cb0f2ab6812c973bc1e78eebd970b78602609b', ['CANARI-CC-MCPLONGDEBUT-9MAD', 'CANARI-CC-MCPLONGFIN-8J26', 'CANARI-CC-MCPOUTLONGDEBUT-FGAX', 'CANARI-CC-MCPOUTLONGFIN-HK5X']],
  ['niveaux/global/CLAUDE.md.fixture', 'e41a2799736e5acc2ee42032884c90b03c74ad87042705d70f13ea2a9169cdbe', ['CANARI-CC-GLOB-XJ6U']],
  ['niveaux/global/projects/__projet__/memory/MEMORY.md.fixture', '6e39fd8a5dafb8819194303d81e3a778c2912d6e28b30e8c2238479f33c17d49', ['CANARI-CC-MEMORY-93KS']],
  ['niveaux/global/rules/g-paths.md.fixture', 'e53826163a652f40a006662c9738660dd1bd621d76f580ff8bfafcd4f24edf46', ['CANARI-CC-GPATHS-DE25']],
  ['niveaux/global/rules/g-perm.md.fixture', '064d5383df008ad8eae3bdd6045fafe13fd7642929e37fd1f3727697e98fc634', ['CANARI-CC-GRULE-BFJK']],
  ['niveaux/parent/CLAUDE.md.fixture', '9462d77340564d8f2f88af282ae335c7584457971c3b267999833da8b2651003', ['CANARI-CC-PAR-7A67']],
  ['niveaux/parent/_claude/CLAUDE.md.fixture', 'fe665eb6f5dad5891bf40919389c15073f7a33f4703705a5ffc9861eaa4b27e5', ['CANARI-CC-PARDOT-3AQ4']],
  ['niveaux/parent/_claude/rules/par-regle.md.fixture', '1abd37c6016f7557ce8e8ac92934d6c05b97d33502086fea0d6d101c31f76bd7', ['CANARI-CC-PARRULE-8WLE']],
  ['niveaux/projet/CLAUDE.local.md.fixture', 'cdaf35e875c5692a3ad7e308ebbbe365f414eb7ea3f01c2d80ad7e4383f4bad7', ['CANARI-CC-LOCAL-T44S']],
  ['niveaux/projet/CLAUDE.md.fixture', '5707292c466a6e39dadc7c5507b47552cf9e4ad1a7c9506a9c1f5c16f019d1f6', ['CANARI-CC-PROJFM-XHPP', 'CANARI-CC-PROJ-QQV9', 'CANARI-CC-COMM-5ZDP']],
  ['niveaux/projet/_claude/CLAUDE.md.fixture', 'be21a5da39ae9ea5272ae5924b84b348b4966e1e3dec6ab2ff2781ec70ac77ad', ['CANARI-CC-PROJDOT-CKZL']],
  ['niveaux/projet/_claude/rules/p-paths.md.fixture', '0a883db0d16457b8012c36bc8d991895c7a471f386edc62efb4f2ce5dde21112', ['CANARI-CC-RPATHS-2PL9']],
  ['niveaux/projet/_claude/rules/p-perm.md.fixture', '2c58636b99e6f0538571365f328823f2acb5f1df847403da39725a4c976e9b32', ['CANARI-CC-RFM-MCUC', 'CANARI-CC-RULE-PNK5']],
  ['niveaux/projet/_claude/rules/p-yaml-invalide.md.fixture', '361caff67503fe313e6ddef84baf9aafddfbb682e74d5d0bfeef02e356c668c3', ['CANARI-CC-RYAML-4GQU']],
  ['niveaux/projet/_claude/rules/sous/p-sous.md.fixture', '41df139798404d7fc7aeeb4c6feb8ff00c2c2ebb266dd149a524fbabc6e78077', ['CANARI-CC-RSOUS-UDFQ']],
  ['niveaux/projet/import-1.md.fixture', '0200975c1705d76eb3e5e99eacd733b32ff55b17c9d2ff7aa8e66d26aa483256', ['CANARI-CC-IMP1-JK6J']],
  ['niveaux/projet/import-2.md.fixture', '79ae1840afe829d7c23396abb7d94e684178504422536456ef3b46c3252856c5', ['CANARI-CC-IMP2-PZWT']],
  ['niveaux/projet/import-3.md.fixture', 'e49d572d18c28df1c292bfc95f30415e5c92b8f82d9452bf6aab757f77cc4e55', ['CANARI-CC-IMP3-WJ9W']],
  ['niveaux/projet/import-4.md.fixture', '7406cf01f1739bb42cefc2357a9f07afe132fba413530db4826571fc5a890782', ['CANARI-CC-IMP4-BKHE']],
  ['niveaux/projet/import-5.md.fixture', 'c41d25ddbde1aeed8ae45615440f3a0269703ced0e8c900ad84a320238b39921', ['CANARI-CC-IMP5-569U']],
  ['skill-long-1500/projet/_claude/skills/canari-long/SKILL.md.fixture', '050e19448006afb863dc1e6095cad0f47871e4c5100818e4a0c5c75f494c2943', ['CANARI-CC-SKL15DEBUT-J5GB', 'CANARI-CC-SKL15FIN-PNK8']],
  ['skills/global/skills/canari-g1/SKILL.md.fixture', 'ba28a744ade4f49d288e078a8b40ce7d3210146817c4afa1a724f0f669f98413', ['CANARI-CC-SKG1-FJS4', 'CANARI-CC-SKCORPSG1-A7AT']],
  ['skills/global/skills/canari-homo/SKILL.md.fixture', 'e7c4f8ddcaeeedbc148653d47321f3fce93ccd161c604c174ef863db9e51a275', ['CANARI-CC-HOMOGL-LMBV']],
  ['skills/parent/_claude/skills/canari-parent/SKILL.md.fixture', '764c37644f740857fa40c139f3b514185bbb56052abb93f2449f80a15f4d4599', ['CANARI-CC-SKPAR-C34N']],
  ['skills/plugin/canari-plugin/_claude-plugin/plugin.json.fixture', '4ba1b97d78a1b7857892c9ced322a55b3a359b710c46641c3f06b99f046e5bc0', ['CANARI-CC-PLUGDESC-FTXJ']],
  ['skills/plugin/canari-plugin/skills/canari-plug/SKILL.md.fixture', '824d91ee7a1a390ccdecae0eee8410d320c0fc123878354f7159e30cc7522021', ['CANARI-CC-SKPLUG-5KME', 'CANARI-CC-SKCORPSPLUG-EG37']],
  ['skills/projet/_claude/skills/canari-cache/SKILL.md.fixture', '92143cc11f06eaa344786d708f258943c5680b65eafb479e2d1f9a2539cb59ac', ['CANARI-CC-SKCACHE-9Q9U']],
  ['skills/projet/_claude/skills/canari-homo/SKILL.md.fixture', '61fdf3f07f0dd634572cb7b7ecfc25098bc84f02a9cffd1436102646ef3a8026', ['CANARI-CC-HOMOPR-6VX3']],
  ['skills/projet/_claude/skills/canari-long/SKILL.md.fixture', 'ce1f49f4eed1f0d8020f6ec9562c3c4564525c01a7ba82c991ba46d6a28b9d48', ['CANARI-CC-SKLONGDEBUT-EG4Q', 'CANARI-CC-SKLONGFIN-ACDU']],
  ['skills/projet/_claude/skills/canari-p1/SKILL.md.fixture', 'fde55fda81b753e5e2905b59b2e79fc206a5ffba381170b92f06380ed9c2cdda', ['CANARI-CC-SKP1-PDW6', 'CANARI-CC-SKCORPSP1-KUQQ']],
];

/** Les jeux : l'unité que le lanceur déploie et que la baseline cite. Les jeux cout-* ne portent aucun canari. */
const JEUX: Record<string, { cibles: string[]; scenarios: string[] }> = {
  niveaux: { cibles: ['global', 'parent', 'projet'], scenarios: ['CC02', 'CC03', 'CC04', 'CC05', 'CC06', 'CC09', 'CC10', 'CC11', 'CC12', 'CC15', 'CC16', 'CC17', 'CC19', 'CC20', 'CC21', 'CC23'] },
  'agents-seul': { cibles: ['projet'], scenarios: ['CC22'] },
  'agents-avec-claude': { cibles: ['projet'], scenarios: ['CC22'] },
  skills: { cibles: ['global', 'parent', 'plugin', 'projet'], scenarios: ['CC24', 'CC25', 'CC26', 'CC27', 'CC29'] },
  'skill-long-1500': { cibles: ['projet'], scenarios: ['CC27'] },
  declencheurs: { cibles: ['projet'], scenarios: ['CC08', 'CC18', 'CC28'] },
  'hook-sortie': { cibles: ['projet'], scenarios: ['CC33'] },
  'hook-muet': { cibles: ['projet'], scenarios: ['CC34'] },
  'mcp-canari': { cibles: ['mcp'], scenarios: ['CC30', 'CC31'] },
  'mcp-long': { cibles: ['mcp'], scenarios: ['CC32'] },
  'cout-f-projet': { cibles: ['projet'], scenarios: ['CC14'] },
  'cout-f-parent': { cibles: ['parent'], scenarios: ['CC13', 'CC14'] },
  'cout-f-projet-claude': { cibles: ['projet'], scenarios: ['CC14'] },
  'cout-f-global': { cibles: ['global'], scenarios: ['CC13'] },
  'cout-f2-projet': { cibles: ['projet'], scenarios: ['CC37'] },
  'cout-regle-court': { cibles: ['projet'], scenarios: ['CC15'] },
  'cout-regle-long': { cibles: ['projet'], scenarios: ['CC15'] },
  'cout-regle-paths': { cibles: ['projet'], scenarios: ['CC17'] },
  'cout-h15-anglais': { cibles: ['projet'], scenarios: ['CC37'] },
  'cout-h15-code': { cibles: ['projet'], scenarios: ['CC37'] },
  'cout-skill-projet': { cibles: ['projet'], scenarios: ['CC24'] },
  'cout-skill-global': { cibles: ['global'], scenarios: ['CC24'] },
  'cout-skill-x2': { cibles: ['projet'], scenarios: ['CC24', 'CC37'] },
  'cout-mcp-a1': { cibles: ['mcp'], scenarios: ['CC30', 'CC31'] },
  'cout-mcp-a2': { cibles: ['mcp'], scenarios: ['CC30'] },
  'cout-mcp-b1': { cibles: ['mcp'], scenarios: ['CC30'] },
};
const CIBLES = ['global', 'parent', 'projet', 'plugin', 'mcp'];
/** Jeu complet des scénarios CC35 (enveloppes) et CC36 (panneau, sans le MCP). */
const JEU_COMPLET = ['niveaux', 'skills', 'hook-sortie', 'mcp-canari'];
const NOMBRE_CANARIS = 52;

/** Contrat de conversion, appliqué par le lanceur dans l'espace isolé seulement. */
const SUFFIXE = '.fixture';
const SEGMENTS_CONVERTIS: Record<string, string> = { _claude: '.claude', '_claude-plugin': '.claude-plugin' };
const ESPACE_RESERVE_PROJET = '__projet__';
/** Noms que Claude Code, Antigravity ou l'extension chargeraient : interdits dans fixtures/. */
const NOMS_ACTIFS = new Set([
  'CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'GEMINI.md', 'SKILL.md', 'MEMORY.md', 'settings.json',
  'settings.local.json', '.mcp.json', 'mcp_config.json', 'hooks.json', 'plugin.json',
  '.claude', '.claude-plugin', '.agents', '.agent', '.gemini',
]);

const CANARY_PATTERN = /CANARI-[A-Z0-9][A-Z0-9-]*/g;
const CANARI_FORMAT = /^CANARI-CC-[A-Z0-9]+-[A-Z0-9]{4}$/;

const listFiles = (dir: string, base = ''): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
};
const lire = (rel: string) => fs.readFileSync(path.join(FIXTURES, rel), 'utf8').replace(/\r\n?/g, '\n');
const sha256 = (texte: string) => crypto.createHash('sha256').update(texte, 'utf8').digest('hex');
const jsonDe = (rel: string) => JSON.parse(lire(rel));

const convertir = (rel: string, nomProjet = '<projet>') => {
  const [jeu, cible, ...miroir] = rel.split('/');
  const segments = miroir.map((s, i) => {
    if (i === miroir.length - 1) return s.endsWith(SUFFIXE) ? s.slice(0, -SUFFIXE.length) : s;
    if (s === ESPACE_RESERVE_PROJET) return nomProjet;
    return SEGMENTS_CONVERTIS[s] ?? s;
  });
  return { jeu, cible, chemin: segments.join('/') };
};

/** Collisions de chemins déployés quand plusieurs jeux sont réunis. */
const collisions = (jeux: string[]): string[] => {
  const vus = new Map<string, string>();
  const out: string[] = [];
  for (const [rel] of INVENTAIRE) {
    const { jeu, cible, chemin } = convertir(rel);
    if (!jeux.includes(jeu)) continue;
    const cle = `${cible}:${chemin}`;
    if (vus.has(cle)) out.push(`${cle} (${vus.get(cle)} et ${jeu})`);
    else vus.set(cle, jeu);
  }
  return out;
};

/** Découpe un frontmatter `---` : lignes du frontmatter (ou null) et corps. */
const decouper = (texte: string): { fm: string[] | null; corps: string } => {
  if (!texte.startsWith('---\n')) return { fm: null, corps: texte };
  const fin = texte.indexOf('\n---\n', 3);
  assert.ok(fin > 0, 'frontmatter non fermé');
  return { fm: texte.slice(4, fin).split('\n'), corps: texte.slice(fin + 5) };
};
const champ = (fm: string[] | null, cle: string): string | undefined =>
  fm?.find((l) => l.startsWith(`${cle}: `))?.slice(cle.length + 2);
/**
 * Frontmatter YAML simple et sans ambiguïté : `clé: valeur` sans « : » ni tabulation dans la valeur et sans
 * indicateur de flux en tête, `clé:` seul, ou un élément de liste `  - "…"`. Seule la fixture du YAML
 * invalide doit échouer.
 */
const frontmatterSimple = (fm: string[]) =>
  fm.every(
    (l) => /^[a-z][a-z-]*:$/.test(l) || /^ {2}- "[^"\t]*"$/.test(l) || (/^[a-z][a-z-]*: (?![[{"'&*!|>%@`])[^\t]*$/.test(l) && !/: .*: /.test(l))
  );

interface ServeurFixture {
  TEXTE_APPEL: string;
  problemesDefinition: (def: unknown) => string[];
  traiter: (message: unknown, def: any) => any;
}
const serveur = () => require(SERVEUR) as ServeurFixture;

// --- Garde de confidentialité ----------------------------------------------------------------

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Mêmes motifs que la garde de la suite Antigravity (test 8) : lecteur, réseau, /home ou /Users, ~ hors liste. */
const CHEMINS_UTILISATEUR = [
  /(?:^|[^A-Za-z0-9])[A-Za-z]:(?:\\|\/)/,
  /(?:^|[\s"'`(])(?:\\\\){1,2}[A-Za-z0-9][\w.-]*\\{1,2}\S/,
  /\/(home|Users)\/[^\/<\s]+/,
  /(?:~|<HOME>|%USERPROFILE%|\$HOME|\$\{HOME\}|\$env:USERPROFILE)(?:\\{1,2}|\/)(?!\.(?:gemini|claude)(?:[\\/"'\s`]|$))[^\s"'`]/i,
];
/** Clés interdites dans un JSON de attendu/ ou resultats/, quelle que soit leur valeur. */
const CLES_INTERDITES = new Set(['session_id', 'sessionid', 'uuid', 'orgid', 'organizationid', 'organizationuuid', 'accountuuid', 'email', 'emailaddress', 'useremail', 'orgname', 'organizationname']);
/** Clés qui désignent des skills, plugins, serveurs ou outils : leurs noms doivent être des noms de fixture. */
const CLES_DE_NOMS = new Set(['skill', 'skills', 'plugin', 'plugins', 'serveur', 'serveurs', 'server', 'servers', 'mcp_server', 'mcp_servers', 'mcp_tools', 'outil_mcp', 'outils_mcp', 'tool', 'tools']);
const CHAMPS_DE_NOM = new Set(['name', 'nom', 'plugin', 'server', 'serveur']);
const NOM_PERMIS = /^(?:mcp__)?canari/i;

interface Poste { home: string; compte: string; hote: string }
const lirePoste = (): Poste => {
  let compte = '';
  try {
    compte = os.userInfo().username;
  } catch {
    compte = process.env.USERNAME ?? process.env.USER ?? '';
  }
  return { home: os.homedir(), compte, hote: os.hostname() };
};
const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Mot entier ou segment de chemin, sans tenir compte de la casse ; ignoré sous 3 caractères (faux positifs). */
const motEntier = (mot: string) =>
  mot.length >= 3 ? new RegExp(`(?<![A-Za-z0-9_])${echapper(mot)}(?![A-Za-z0-9_])`, 'i') : null;
/** Le dossier personnel avec les deux séparateurs, et avec les antislashs doublés d'un JSON. */
const variantesHome = (home: string) => {
  const parties = home.split(/[\\/]+/).filter(Boolean);
  const prefixe = /^[\\/]/.test(home) ? '/' : '';
  return [...new Set(['\\', '/', '\\\\'].map((sep) => (sep === '/' ? prefixe : prefixe.replace('/', sep)) + parties.join(sep)))]
    .filter((v) => v.length >= 3)
    .map((v) => v.toLowerCase());
};

/** Problèmes de texte : adresse, chemins, identifiants et données du poste lues à l'exécution. */
const problemesTexte = (texte: string, poste: Poste): string[] => {
  const out: string[] = [];
  const homes = variantesHome(poste.home);
  const compte = motEntier(poste.compte);
  const hote = motEntier(poste.hote);
  texte.split(/\r?\n/).forEach((ligne, i) => {
    const n = i + 1;
    if (EMAIL.test(ligne)) out.push(`${n}: adresse électronique`);
    if (UUID.test(ligne)) out.push(`${n}: identifiant (uuid)`);
    if (CHEMINS_UTILISATEUR.some((motif) => motif.test(ligne))) out.push(`${n}: chemin personnel, de lecteur ou réseau`);
    if (homes.some((h) => ligne.toLowerCase().includes(h))) out.push(`${n}: dossier personnel du poste`);
    if (compte?.test(ligne)) out.push(`${n}: nom du compte du poste`);
    if (hote?.test(ligne)) out.push(`${n}: nom d'hôte du poste`);
  });
  return out;
};

/** Problèmes d'un JSON de rapport : clés interdites et noms hors de la liste blanche « canari* ». */
const problemesJson = (texte: string): string[] => {
  let racine: unknown;
  try {
    racine = JSON.parse(texte);
  } catch {
    return ['JSON invalide'];
  }
  const out: string[] = [];
  const parcourir = (valeur: unknown, chemin: string, cle: string, dansNoms: boolean) => {
    if (Array.isArray(valeur)) {
      valeur.forEach((v, i) => parcourir(v, `${chemin}[${i}]`, cle, dansNoms));
    } else if (valeur !== null && typeof valeur === 'object') {
      for (const [k, v] of Object.entries(valeur)) {
        const kb = k.toLowerCase();
        if (CLES_INTERDITES.has(kb)) out.push(`${chemin}.${k}: clé interdite`);
        parcourir(v, `${chemin}.${k}`, kb, dansNoms || CLES_DE_NOMS.has(kb));
      }
    } else if (typeof valeur === 'string' && dansNoms && (CLES_DE_NOMS.has(cle) || CHAMPS_DE_NOM.has(cle)) && !NOM_PERMIS.test(valeur)) {
      out.push(`${chemin}: nom hors de la liste blanche (${valeur.length} caractères, non recopié)`);
    }
  };
  parcourir(racine, '$', '', false);
  return out;
};

/** Garde complète d'un fichier : texte pour tous, et JSON pour les rapports de attendu/ et resultats/. */
const garder = (rel: string, texte: string, poste: Poste): string[] => {
  const rapport = /^(attendu|resultats)\//.test(rel) && rel.endsWith('.json');
  return [...problemesTexte(texte, poste), ...(rapport ? problemesJson(texte) : [])].map((p) => `${rel}:${p}`);
};

// --- Serveur MCP en processus ------------------------------------------------------------------

interface Dialogue { reponses: any[]; code: number | null; arrete: boolean }

const attendreArret = (enfant: ChildProcess, delaiMs: number) =>
  new Promise<boolean>((resolve) => {
    if (enfant.exitCode !== null || enfant.signalCode !== null) return resolve(true);
    const minuteur = setTimeout(() => resolve(false), delaiMs);
    enfant.once('exit', () => {
      clearTimeout(minuteur);
      resolve(true);
    });
  });

/**
 * Lance le serveur, envoie les messages, attend une réponse par message muni d'un id, dans un délai
 * maximal. Le processus est toujours arrêté, même en cas d'échec : fin de l'entrée standard, puis
 * arrêt forcé s'il ne s'est pas terminé.
 */
const dialoguer = async (args: string[], messages: object[], delaiMs = 5000): Promise<Dialogue> => {
  const enfant = spawn(process.execPath, [SERVEUR, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  enfant.stdin!.on('error', () => undefined);
  const attendues = messages.filter((m) => (m as { id?: unknown }).id !== undefined).length;
  let erreurDialogue: Error | null = null;
  const reponses: any[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      // Sans message à attendre (échec au démarrage), le dialogue se termine à l'arrêt du processus.
      let tampon = '';
      let stderr = '';
      const minuteur = setTimeout(() => reject(new Error(`délai de ${delaiMs} ms dépassé (${args.join(' ')}) ${stderr}`)), delaiMs);
      const finir = (err?: Error) => {
        clearTimeout(minuteur);
        if (err) reject(err);
        else resolve();
      };
      enfant.on('error', (err) => finir(err));
      enfant.stderr!.on('data', (d) => (stderr += d));
      enfant.stdout!.on('data', (d) => {
        tampon += d;
        let i: number;
        while ((i = tampon.indexOf('\n')) >= 0) {
          const ligne = tampon.slice(0, i);
          tampon = tampon.slice(i + 1);
          if (!ligne.trim()) continue;
          try {
            reponses.push(JSON.parse(ligne));
          } catch {
            return finir(new Error(`sortie illisible : ${ligne.slice(0, 80)}`));
          }
        }
        if (reponses.length >= attendues) finir();
      });
      enfant.on('exit', () => {
        if (reponses.length >= attendues) finir();
        else finir(new Error(`arrêt avant la fin du dialogue : ${stderr.trim()}`));
      });
      for (const m of messages) enfant.stdin!.write(JSON.stringify(m) + '\n');
    });
  } catch (err) {
    erreurDialogue = err as Error;
  }
  // Arrêt garanti, que le dialogue ait réussi ou non : fin de l'entrée, puis arrêt forcé au besoin.
  enfant.stdin!.end();
  let arrete = await attendreArret(enfant, 2000);
  if (!arrete) {
    enfant.kill('SIGKILL');
    arrete = await attendreArret(enfant, 2000);
  }
  if (erreurDialogue) throw new Error(`${erreurDialogue.message} (processus arrêté : ${arrete})`);
  return { reponses, code: enfant.exitCode, arrete };
};

describe('Suite de Tests : Injection de contexte Claude Code (fixtures inertes, lot I1)', () => {
  test('1. Inventaire exact : la liste des fixtures est figée, et chaque empreinte correspond', () => {
    const presents = listFiles(FIXTURES).sort();
    const attendus = INVENTAIRE.map(([rel]) => rel).sort();
    assert.deepStrictEqual(presents, attendus, 'fixtures/ doit contenir exactement les fichiers de INVENTAIRE');
    assert.strictEqual(attendus.length, 58);
    const ecarts = INVENTAIRE.filter(([rel, sha]) => sha256(lire(rel)) !== sha).map(([rel]) => `${rel} : empreinte observée ${sha256(lire(rel))}`);
    assert.deepStrictEqual(ecarts, [], 'Une fixture a changé : la baseline devient caduque. Mettre à jour INVENTAIRE seulement si le changement est voulu.');
  });

  test('2. Aucun fichier parasite dans la suite (hors brut/, ignoré par Git)', () => {
    const permis = new Set([
      ...INVENTAIRE.map(([rel]) => `fixtures/${rel}`),
      'mcp/serveur-fixture.js',
      'attendu/.gitkeep',
      'resultats/.gitkeep',
    ]);
    const parasites = listFiles(SUITE).filter((rel) => !rel.startsWith('brut/') && !permis.has(rel));
    assert.deepStrictEqual(parasites, []);
  });

  test('3. Noms inertes : suffixe .fixture, aucun nom actif, jeux et cibles connus, conversion des noms', () => {
    const problemes: string[] = [];
    for (const [rel] of INVENTAIRE) {
      const segments = rel.split('/');
      const [jeu, cible] = segments;
      const nom = segments[segments.length - 1];
      if (!JEUX[jeu]) problemes.push(`${rel} : jeu inconnu`);
      if (!CIBLES.includes(cible)) problemes.push(`${rel} : cible inconnue`);
      if (!nom.endsWith(SUFFIXE) || nom.slice(0, -SUFFIXE.length).endsWith(SUFFIXE)) problemes.push(`${rel} : suffixe .fixture attendu une fois`);
      for (const s of segments) {
        if (NOMS_ACTIFS.has(s)) problemes.push(`${rel} : nom actif « ${s} »`);
        if (s.startsWith('.')) problemes.push(`${rel} : segment commençant par un point « ${s} »`);
        if (s.endsWith('.disabled')) problemes.push(`${rel} : suffixe .disabled`);
        if (s.startsWith('_') && !(s in SEGMENTS_CONVERTIS) && s !== ESPACE_RESERVE_PROJET) problemes.push(`${rel} : segment réservé inconnu « ${s} »`);
      }
      if (rel.includes(ESPACE_RESERVE_PROJET) && !/^[^/]+\/global\/projects\/__projet__\/memory\//.test(rel)) problemes.push(`${rel} : __projet__ hors du dossier de mémoire`);
      if (cible === 'mcp' && segments.slice(2).join('/') !== 'serveur.json.fixture') problemes.push(`${rel} : une cible mcp ne contient que serveur.json.fixture`);
      if (cible === 'plugin' && segments[2] !== 'canari-plugin') problemes.push(`${rel} : un plugin de fixture est rangé sous canari-plugin/`);
    }
    assert.deepStrictEqual(problemes, []);

    // Chaque jeu a exactement les cibles annoncées, et des scénarios valides
    const ciblesObservees = new Map<string, Set<string>>();
    for (const [rel] of INVENTAIRE) {
      const { jeu, cible } = convertir(rel);
      ciblesObservees.set(jeu, (ciblesObservees.get(jeu) ?? new Set()).add(cible));
    }
    assert.deepStrictEqual([...ciblesObservees.keys()].sort(), Object.keys(JEUX).sort());
    for (const [jeu, { cibles, scenarios }] of Object.entries(JEUX)) {
      assert.deepStrictEqual([...ciblesObservees.get(jeu)!].sort(), [...cibles].sort(), jeu);
      assert.ok(scenarios.length > 0 && scenarios.every((s) => /^CC(0[1-9]|[12]\d|3[0-7])$/.test(s)), jeu);
    }

    // Conversion : les noms actifs n'apparaissent qu'après conversion, dans l'espace isolé
    const exemples: [string, string, string][] = [
      ['niveaux/projet/CLAUDE.md.fixture', 'projet', 'CLAUDE.md'],
      ['niveaux/projet/_claude/rules/p-perm.md.fixture', 'projet', '.claude/rules/p-perm.md'],
      ['niveaux/parent/_claude/CLAUDE.md.fixture', 'parent', '.claude/CLAUDE.md'],
      ['niveaux/global/projects/__projet__/memory/MEMORY.md.fixture', 'global', 'projects/C--exemple-projet/memory/MEMORY.md'],
      ['skills/plugin/canari-plugin/_claude-plugin/plugin.json.fixture', 'plugin', 'canari-plugin/.claude-plugin/plugin.json'],
      ['skills/projet/_claude/skills/canari-p1/SKILL.md.fixture', 'projet', '.claude/skills/canari-p1/SKILL.md'],
      ['hook-sortie/projet/_claude/settings.json.fixture', 'projet', '.claude/settings.json'],
      ['agents-seul/projet/AGENTS.md.fixture', 'projet', 'AGENTS.md'],
      ['mcp-canari/mcp/serveur.json.fixture', 'mcp', 'serveur.json'],
    ];
    for (const [rel, cible, chemin] of exemples) {
      assert.deepStrictEqual(convertir(rel, 'C--exemple-projet'), { jeu: rel.split('/')[0], cible, chemin }, rel);
    }
    for (const [rel] of INVENTAIRE) {
      const { chemin } = convertir(rel);
      assert.ok(!/(^|\/)_claude|__projet__|\.fixture$/.test(chemin), `${rel} → ${chemin}`);
    }
  });

  test('4. Canaris : chacun est unique dans fixtures/ et mcp/, et les jeux cout-* n\'en portent aucun', () => {
    const tous = INVENTAIRE.flatMap(([, , canaris]) => canaris);
    assert.strictEqual(tous.length, NOMBRE_CANARIS);
    assert.strictEqual(new Set(tous).size, NOMBRE_CANARIS, 'Un canari est déclaré deux fois');
    assert.deepStrictEqual(tous.filter((c) => !CANARI_FORMAT.test(c)), [], 'Format CANARI-CC-<CODE>-<4 caractères>');
    const inclus = tous.flatMap((a) => tous.filter((b) => a !== b && b.includes(a)).map((b) => `${a} ⊂ ${b}`));
    assert.deepStrictEqual(inclus, [], 'Un canari ne doit pas être contenu dans un autre');

    // Chaque fixture contient exactement ses canaris, chacun une seule fois
    const ecarts: string[] = [];
    for (const [rel, , canaris] of INVENTAIRE) {
      const trouves = (lire(rel).match(CANARY_PATTERN) ?? []).sort();
      if (JSON.stringify(trouves) !== JSON.stringify([...canaris].sort())) ecarts.push(`${rel} : ${trouves.join(', ') || 'aucun'}`);
      if (rel.startsWith('cout-') && canaris.length > 0) ecarts.push(`${rel} : un jeu de mesure ne porte aucun canari`);
    }
    // Le serveur, seul autre fichier de mcp/, n'en contient aucun
    const dansServeur = fs.readFileSync(SERVEUR, 'utf8').match(CANARY_PATTERN) ?? [];
    if (dansServeur.length > 0) ecarts.push(`mcp/serveur-fixture.js : ${dansServeur.join(', ')}`);
    assert.deepStrictEqual(ecarts, []);
  });

  test('5. Mémoire et règles : frontmatter, commentaire, imports sur 5 sauts, YAML invalide, contenus de mesure', () => {
    const canari = (code: string) => INVENTAIRE.flatMap(([, , c]) => c).find((c) => c.startsWith(`CANARI-CC-${code}-`))!;

    // H3 et H8 : canaris placés dans le frontmatter et dans un commentaire HTML de bloc
    const projet = decouper(lire('niveaux/projet/CLAUDE.md.fixture'));
    assert.strictEqual(champ(projet.fm, 'fixture'), canari('PROJFM'));
    assert.match(projet.corps, new RegExp(`\\n<!--\\nCommentaire de bloc\\. Canari : ${canari('COMM')}\\.\\n-->\\n`));
    assert.ok(projet.corps.split('\n').includes('@import-1.md'), "L'import doit être seul sur sa ligne");
    const regle = decouper(lire('niveaux/projet/_claude/rules/p-perm.md.fixture'));
    assert.strictEqual(champ(regle.fm, 'description'), canari('RFM'));
    assert.ok(regle.corps.includes(canari('RULE')) && !regle.corps.includes(canari('RFM')));

    // CC09 : chaîne de 5 sauts, le dernier fichier n'importe rien
    for (let n = 1; n <= 5; n++) {
      const texte = lire(`niveaux/projet/import-${n}.md.fixture`);
      const imports = texte.split('\n').filter((l) => l.startsWith('@'));
      assert.deepStrictEqual(imports, n < 5 ? [`@import-${n + 1}.md`] : [], `import-${n}`);
    }

    // CC21 : YAML franchement invalide (tabulation d'indentation, crochet non fermé, « : : : »)
    const invalide = decouper(lire('niveaux/projet/_claude/rules/p-yaml-invalide.md.fixture')).fm!;
    assert.ok(invalide.includes('paths:'));
    assert.ok(invalide.some((l) => l.startsWith('\t')), 'indentation par tabulation');
    assert.ok(invalide.join('\n').split('[').length > invalide.join('\n').split(']').length, 'crochet non fermé');
    assert.ok(invalide.includes(': : :'));
    assert.strictEqual(frontmatterSimple(invalide), false);
    // Tous les autres frontmatters sont simples et valides
    for (const [rel] of INVENTAIRE.filter(([r]) => r.endsWith('.md.fixture') && !r.endsWith('p-yaml-invalide.md.fixture'))) {
      const { fm } = decouper(lire(rel));
      if (fm) assert.ok(frontmatterSimple(fm), `Frontmatter ambigu : ${rel}`);
    }
    // Règles conditionnelles
    for (const rel of ['niveaux/global/rules/g-paths.md.fixture', 'niveaux/projet/_claude/rules/p-paths.md.fixture', 'declencheurs/projet/_claude/rules/d-paths.md.fixture', 'cout-regle-paths/projet/_claude/rules/r-paths.md.fixture']) {
      const { fm } = decouper(lire(rel));
      assert.ok(fm && fm[0] === 'paths:' && /^ {2}- "/.test(fm[1]), rel);
    }

    // Mesure : F identique sous quatre chemins, F′ = F deux fois, la même règle sous deux noms
    const f = lire('cout-f-projet/projet/CLAUDE.md.fixture');
    for (const rel of ['cout-f-parent/parent/CLAUDE.md.fixture', 'cout-f-projet-claude/projet/_claude/CLAUDE.md.fixture', 'cout-f-global/global/CLAUDE.md.fixture']) {
      assert.strictEqual(lire(rel), f, rel);
    }
    assert.strictEqual(lire('cout-f2-projet/projet/CLAUDE.md.fixture'), f + f);
    const r = lire('cout-regle-court/projet/_claude/rules/r.md.fixture');
    assert.strictEqual(lire('cout-regle-long/projet/_claude/rules/regle-au-nom-volontairement-tres-long-pour-mesurer-le-cout-du-chemin.md.fixture'), r);
    assert.strictEqual(decouper(lire('cout-regle-paths/projet/_claude/rules/r-paths.md.fixture')).corps, r);
  });

  test('6. Skills et plugin : noms, disable-model-invocation, longueurs de description, contenus de mesure', () => {
    const canari = (code: string) => INVENTAIRE.flatMap(([, , c]) => c).find((c) => c.startsWith(`CANARI-CC-${code}-`))!;
    const skills = INVENTAIRE.map(([rel]) => rel).filter((rel) => rel.endsWith('/SKILL.md.fixture'));
    assert.strictEqual(skills.length, 13);
    for (const rel of skills) {
      const { fm } = decouper(lire(rel));
      const dossier = rel.split('/').slice(-2)[0];
      assert.strictEqual(champ(fm, 'name'), dossier, `${rel} : name = dossier`);
      assert.match(dossier, /^canari-/, rel);
      assert.ok((champ(fm, 'description') ?? '').length > 0, rel);
    }
    const description = (rel: string) => champ(decouper(lire(rel)).fm, 'description')!;

    assert.strictEqual(champ(decouper(lire('skills/projet/_claude/skills/canari-cache/SKILL.md.fixture')).fm, 'disable-model-invocation'), 'true');
    const avecPaths = decouper(lire('declencheurs/projet/_claude/skills/canari-paths/SKILL.md.fixture')).fm!;
    assert.ok(avecPaths.includes('paths:') && avecPaths.includes('  - "src/**/*.ts"'));

    // CC27 : description de plus de 1 536 caractères, canari de fin au-delà ; variante de 1 500 caractères exactement
    const longue = description('skills/projet/_claude/skills/canari-long/SKILL.md.fixture');
    assert.ok(longue.length > 1536 && longue.startsWith(canari('SKLONGDEBUT')) && longue.indexOf(canari('SKLONGFIN')) > 1536, `${longue.length} caractères`);
    const l1500 = description('skill-long-1500/projet/_claude/skills/canari-long/SKILL.md.fixture');
    assert.strictEqual(l1500.length, 1500);
    assert.ok(l1500.startsWith(canari('SKL15DEBUT')) && l1500.endsWith(canari('SKL15FIN')));

    // Mesure : même description D dans canari-s1 et canari-s2 (noms de même longueur), D deux fois dans cout-skill-x2
    const d = description('cout-skill-projet/projet/_claude/skills/canari-s1/SKILL.md.fixture');
    assert.strictEqual(description('cout-skill-global/global/skills/canari-s2/SKILL.md.fixture'), d);
    assert.strictEqual(description('cout-skill-x2/projet/_claude/skills/canari-s1/SKILL.md.fixture'), `${d} ${d}`);

    // Plugin : manifeste JSON valide, nommé canari-plugin
    const plugin = jsonDe('skills/plugin/canari-plugin/_claude-plugin/plugin.json.fixture');
    assert.strictEqual(plugin.name, 'canari-plugin');
    assert.ok(plugin.description.includes(canari('PLUGDESC')));
  });

  test('7. MCP et hooks : définitions valides, textes longs au-delà de 4 096 caractères, serveurs de mesure, settings.json', () => {
    const canari = (code: string) => INVENTAIRE.flatMap(([, , c]) => c).find((c) => c.startsWith(`CANARI-CC-${code}-`))!;
    const { problemesDefinition } = serveur();
    const definitions = INVENTAIRE.map(([rel]) => rel).filter((rel) => rel.split('/')[1] === 'mcp');
    assert.strictEqual(definitions.length, 5);
    for (const rel of definitions) assert.deepStrictEqual(problemesDefinition(jsonDe(rel)), [], rel);

    const presence = jsonDe('mcp-canari/mcp/serveur.json.fixture');
    assert.strictEqual(presence.env.CANARI_ENV, canari('MCPENV'));

    const long = jsonDe('mcp-long/mcp/serveur.json.fixture');
    for (const [texte, debut, fin] of [
      [long.instructions, 'MCPLONGDEBUT', 'MCPLONGFIN'],
      [long.outils[0].description, 'MCPOUTLONGDEBUT', 'MCPOUTLONGFIN'],
    ] as [string, string, string][]) {
      assert.ok(texte.length > 4096 && texte.startsWith(canari(debut)) && texte.indexOf(canari(fin)) > 4096, `${debut} : ${texte.length} caractères`);
    }

    const [a1, a2, b1] = ['cout-mcp-a1', 'cout-mcp-a2', 'cout-mcp-b1'].map((jeu) => jsonDe(`${jeu}/mcp/serveur.json.fixture`));
    assert.deepStrictEqual(a2.outils, a1.outils);
    assert.deepStrictEqual(b1.outils, a1.outils);
    assert.strictEqual(a2.instructions, `${a1.instructions} ${a1.instructions}`);
    assert.strictEqual(b1.instructions, undefined);
    assert.ok(a1.nom.length === a2.nom.length && a1.nom.length === b1.nom.length, 'Noms de serveur de même longueur');
    assert.ok([a1, a2, b1].every((s) => s.env === undefined));

    const commande = (jeu: string) => {
      const settings = jsonDe(`${jeu}/projet/_claude/settings.json.fixture`);
      assert.deepStrictEqual(Object.keys(settings), ['hooks']);
      assert.deepStrictEqual(Object.keys(settings.hooks), ['SessionStart']);
      return settings.hooks.SessionStart[0].hooks[0];
    };
    assert.deepStrictEqual(commande('hook-sortie'), { type: 'command', command: `echo ${canari('HOOK')}` });
    assert.deepStrictEqual(commande('hook-muet'), { type: 'command', command: 'exit 0' });
  });

  test('8. Le jeu complet (CC35, CC36) se combine sans collision de chemins', () => {
    assert.deepStrictEqual(collisions(JEU_COMPLET), []);
    // Le contrôle détecte une vraie collision : deux CLAUDE.md du projet
    assert.deepStrictEqual(collisions(['niveaux', 'agents-avec-claude']), ['projet:CLAUDE.md (agents-avec-claude et niveaux)']);
  });

  test('9. Serveur MCP de fixture : réponses du protocole, sans aucune action', () => {
    const { traiter, problemesDefinition, TEXTE_APPEL } = serveur();
    const def = jsonDe('mcp-canari/mcp/serveur.json.fixture');

    const init = traiter({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01' } }, def);
    assert.deepStrictEqual(init, {
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2099-01-01', capabilities: { tools: {} }, serverInfo: { name: 'canari-mcp', version: '0.0.1' }, instructions: def.instructions },
    });
    assert.strictEqual(traiter({ jsonrpc: '2.0', id: 2, method: 'initialize' }, def).result.protocolVersion, '2025-06-18');
    const sansInstructions = jsonDe('cout-mcp-b1/mcp/serveur.json.fixture');
    assert.ok(!('instructions' in traiter({ jsonrpc: '2.0', id: 3, method: 'initialize' }, sansInstructions).result));

    assert.deepStrictEqual(traiter({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, def).result, {
      tools: [{ name: 'canari_outil', description: def.outils[0].description, inputSchema: def.outils[0].schema }],
    });
    assert.deepStrictEqual(traiter({ jsonrpc: '2.0', id: 5, method: 'ping' }, def), { jsonrpc: '2.0', id: 5, result: {} });
    assert.strictEqual(traiter({ jsonrpc: '2.0', method: 'notifications/initialized' }, def), null);
    assert.deepStrictEqual(traiter({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'canari_outil', arguments: { texte: 'x' } } }, def).result, {
      content: [{ type: 'text', text: TEXTE_APPEL }],
    });
    assert.strictEqual(traiter({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'autre' } }, def).error.code, -32602);
    for (const method of ['resources/list', 'prompts/list', 'inconnue']) {
      assert.strictEqual(traiter({ jsonrpc: '2.0', id: 8, method }, def).error.code, -32601, method);
    }

    // Définitions refusées : nom hors liste blanche, clé inconnue, outil mal nommé, liste d'outils vide
    assert.ok(problemesDefinition({ ...def, nom: 'vrai-serveur' }).length > 0);
    assert.ok(problemesDefinition({ ...def, commande: 'x' }).length > 0);
    assert.ok(problemesDefinition({ ...def, outils: [{ ...def.outils[0], nom: 'outil' }] }).length > 0);
    assert.ok(problemesDefinition({ ...def, outils: [] }).length > 0);
  });

  test('10. Serveur MCP en processus stdio : chaque définition répond, délai maximal et arrêt garanti', async () => {
    const definitions = INVENTAIRE.map(([rel]) => rel).filter((rel) => rel.split('/')[1] === 'mcp');
    for (const rel of definitions) {
      const def = jsonDe(rel);
      const { reponses, arrete, code } = await dialoguer([path.join(FIXTURES, rel)], [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ]);
      assert.ok(arrete, `${rel} : le processus doit être arrêté`);
      assert.strictEqual(code, 0, `${rel} : fin normale à la fermeture de l'entrée`);
      assert.deepStrictEqual(reponses.map((r) => r.id), [1, 2], rel);
      assert.strictEqual(reponses[0].result.serverInfo.name, def.nom, rel);
      assert.deepStrictEqual(reponses[1].result.tools.map((t: { name: string }) => t.name), def.outils.map((o: { nom: string }) => o.nom), rel);
    }
    // Échec au démarrage : sans définition, le serveur s'arrête avec le code 2
    const sansArgument = await dialoguer([], []);
    assert.ok(sansArgument.arrete);
    assert.strictEqual(sansArgument.code, 2);
  });

  test('11. Confidentialité : attendu/, resultats/, fixtures/ et mcp/ ne contiennent aucune donnée locale', () => {
    const poste = lirePoste();
    const fuites: string[] = [];
    for (const dossier of ['attendu', 'resultats', 'fixtures', 'mcp']) {
      const abs = path.join(SUITE, dossier);
      if (!fs.existsSync(abs)) continue;
      for (const rel of listFiles(abs, dossier)) fuites.push(...garder(rel, fs.readFileSync(path.join(SUITE, rel), 'utf8'), poste));
    }
    assert.deepStrictEqual(fuites, [], 'Donnée locale ou nom hors liste blanche : caviarder avant de commiter.');
  });

  test('12. Confidentialité : la garde refuse les exemples interdits et accepte un exemple permis', () => {
    const poste: Poste = { home: 'C:\\Users\\exemple-compte', compte: 'exemple-compte', hote: 'POSTE-EXEMPLE' };
    const interdits: [string, string][] = [
      ['resultats/a.md', 'contact : quelqu-un@exemple.org'],
      ['resultats/a.md', 'Contents of C:\\Users\\autre\\CLAUDE.md'],
      ['resultats/a.md', 'partage \\\\serveur\\partage\\x'],
      ['resultats/a.md', 'chemin /Users/autre/x'],
      ['resultats/a.md', 'chemin ~/Documents/x'],
      ['resultats/a.md', 'session 123e4567-e89b-12d3-a456-426614174000'],
      ['resultats/a.md', 'profil c:/users/EXEMPLE-COMPTE/AppData'],
      ['resultats/a.md', 'dossier <home>/../exemple-compte/notes'],
      ['resultats/a.md', 'Exemple-Compte a lancé la sonde'],
      ['resultats/a.md', 'hôte poste-exemple'],
      ['resultats/a.json', '{ "skills": [{ "name": "vrai-skill", "tokens": 3 }] }'],
      ['resultats/a.json', '{ "mcp_servers": ["serveur-reel"] }'],
      ['attendu/a.json', '{ "plugins": [{ "name": "canari-x", "plugin": "vrai-plugin" }] }'],
      ['attendu/a.json', '{ "session_id": "abc" }'],
      ['attendu/a.json', '{ "meta": { "orgId": "x" } }'],
      ['attendu/a.json', '{ invalide'],
    ];
    for (const [rel, texte] of interdits) {
      assert.ok(garder(rel, texte, poste).length > 0, `La garde doit refuser : ${texte}`);
    }
    // Le dossier personnel est reconnu avec les deux séparateurs et avec les antislashs doublés d'un JSON
    for (const forme of ['C:\\Users\\exemple-compte\\x', 'C:/Users/exemple-compte/x', '"C:\\\\Users\\\\exemple-compte\\\\x"']) {
      assert.ok(problemesTexte(forme, poste).some((p) => p.includes('dossier personnel')), forme);
    }

    const permis: [string, string][] = [
      ['resultats/a.json', JSON.stringify({
        element: '<projet>/CLAUDE.md',
        environnement: { outil: 'Claude Code' },
        skills: [{ name: 'canari-p1', source: 'projectSettings', tokens: 29 }, { name: 'canari-plugin:canari-plug', plugin: 'canari-plugin' }],
        mcp_tools: [{ name: 'mcp__canari-mcp__canari_outil', server: 'canari-mcp', tokens: 0 }],
        canaris: ['CANARI-CC-EXEMPLE-ABCD'],
      })],
      ['resultats/a.md', 'Fichiers sous <global>/rules/ et ~/.claude/rules/, rapport de exemple-comptes et de sous-exemple-compteur.'],
      ['attendu/a.md', 'Le préfixe exemple-compte2 et xexemple-compte ne sont pas le compte.'],
    ];
    for (const [rel, texte] of permis) {
      assert.deepStrictEqual(garder(rel, texte, poste), [], `La garde doit accepter : ${texte.slice(0, 60)}`);
    }
  });

  test('13. .gitignore : brut/ est ignoré, le reste de la suite est suivi', (t) => {
    const depot = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: ROOT });
    if (depot.error || depot.status !== 0) {
      t.skip('Hors d\'un dépôt Git, ou git introuvable.');
      return;
    }
    const temoin = `${SUITE_REL}/brut/exemple.jsonl`;
    const suivis = listFiles(SUITE).filter((rel) => !rel.startsWith('brut/')).map((rel) => `${SUITE_REL}/${rel}`);
    const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: ROOT, input: [temoin, ...suivis].join('\n') + '\n' });
    assert.ok(result.status === 0 || result.status === 1, result.stderr.toString('utf8'));
    const ignores = result.stdout.toString('utf8').split(/\r?\n/).filter(Boolean);
    assert.deepStrictEqual(ignores, [temoin], 'Seul brut/ doit être ignoré : ajouter la ligne « /test/scenarios/claude-code-injection-contexte/brut/ »');
  });
});
