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
/** Les documents de la suite (lot I3), soumis à la garde de confidentialité du test 11. */
const DOCUMENTS = ['README.md', 'SONDE.md', 'SCENARIOS-CLAUDE-CODE.md'];
/** Les rapports normalisés (context ou payant) et les baselines permis dans resultats/ et attendu/. */
const RAPPORT_PERMIS = /^resultats\/(context|payant|e4)-\d{4}-\d{2}-\d{2}-\d{4}\.json$/;
const BASELINE_PERMISE = /^attendu\/baseline-\d{4}-\d{2}-\d{2}\.json$/;

/**
 * Inventaire figé : chemin sous fixtures/ (<jeu>/<cible>/<miroir>), empreinte SHA-256 du contenu en LF,
 * canaris attendus (chacun exactement une fois). Source unique : inventaire.json de la suite, lu aussi par
 * le lanceur, qui refuse de déployer une fixture dont l'empreinte diffère. Une fixture modifiée rend la
 * baseline caduque : toute modification volontaire passe par la mise à jour de ce fichier.
 */
const INVENTAIRE_JSON = path.join(SUITE, 'inventaire.json');
const INVENTAIRE: [string, string, string[]][] = (JSON.parse(fs.readFileSync(INVENTAIRE_JSON, 'utf8')).fixtures as { chemin: string; sha256: string; canaris: string[] }[])
  .map((e) => [e.chemin, e.sha256, e.canaris]);

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
  // Lot E4 (2026-11-11) : calibrage du tokenizer par différence (T, puis T suivi de T), et doublons de D-6
  'cout-calibrage': { cibles: ['projet'], scenarios: ['CC09', 'CC37'] },
  'doublons-d6': { cibles: ['global', 'parent', 'projet'], scenarios: ['CC38', 'CC39', 'CC40'] },
  // Second calibrage du lot E4 (décision D-1.2b du 2026-11-11), sous claude-opus-5 seulement
  'cout-calibrage-2': { cibles: ['projet'], scenarios: ['CC37'] },
  // Lot E5 (2026-11-12) : vérifications gratuites avant la lecture des sources oubliées, mesurées par /context
  // seulement, sans canari. Combinaison A : coupe de MEMORY.md par les lignes, imports (code, cycle, règle,
  // frontmatter et commentaire, extérieurs, parent), homonymes de skills ; B : coupe par la taille, copie
  // personnelle paths, skillOverrides ; C : AGENTS.md sans CLAUDE.md, autoMemoryEnabled du projet.
  'e5-imports': { cibles: ['global', 'parent', 'projet'], scenarios: ['CC41', 'CC42', 'CC43', 'CC44', 'CC45', 'CC46', 'CC48', 'CC49', 'CC54'] },
  'e5-coupe-octets': { cibles: ['global', 'projet'], scenarios: ['CC50', 'CC51', 'CC52'] },
  'e5-agents': { cibles: ['global', 'parent', 'projet'], scenarios: ['CC47', 'CC53'] },
};
/** Les textes de chaque jeu de calibrage (lot E4), chacun importé seul puis doublé (suffixe -x2), et le titre de son CLAUDE.md. */
const CALIBRAGES: Record<string, { titre: string; textes: string[] }> = {
  'cout-calibrage': { titre: 'Calibrage', textes: ['cal-fr-original', 'cal-fr-securite', 'cal-en-mit', 'cal-code-js', 'cal-mixte-regle', 'cal-mixte-readme'] },
  'cout-calibrage-2': { titre: 'Calibrage 2', textes: ['cal2-en-prose', 'cal2-en-consignes', 'cal2-fr-consignes', 'cal2-code-ts', 'cal2-json', 'cal2-yaml'] },
};
/** Le minimum de tokens o200k de chaque texte de calibrage (décision du 2026-11-11). */
const O200K_MIN_CALIBRAGE = 150;
const CIBLES = ['global', 'parent', 'projet', 'plugin', 'mcp'];
/** Jeu complet des scénarios CC35 (enveloppes) et CC36 (panneau, sans le MCP). */
const JEU_COMPLET = ['niveaux', 'skills', 'hook-sortie', 'mcp-canari'];
const NOMBRE_CANARIS = 52;

/**
 * Contrat de conversion et garde de confidentialité : module partagé avec le lanceur (lot I2), qui
 * l'applique dans l'espace isolé seulement.
 */
interface Poste { home: string; compte: string; hote: string }
interface Commun {
  SUFFIXE: string;
  SEGMENTS_CONVERTIS: Record<string, string>;
  ESPACE_RESERVE_PROJET: string;
  convertir: (rel: string, nomProjet?: string) => { jeu: string; cible: string; chemin: string };
  collisions: (rels: string[], jeux: string[]) => string[];
  lirePoste: () => Poste;
  problemesTexte: (texte: string, poste: Poste, interdits?: string[]) => string[];
  garder: (rel: string, texte: string, poste: Poste, interdits?: string[]) => string[];
}
const commun = require(path.join(ROOT, 'test', 'scenarios', 'scripts', 'sonde-claude-code-commun.js')) as Commun;
const { SUFFIXE, SEGMENTS_CONVERTIS, ESPACE_RESERVE_PROJET, convertir, lirePoste, problemesTexte, garder } = commun;
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

/** Collisions de chemins déployés quand plusieurs jeux sont réunis (contrat partagé). */
const collisions = (jeux: string[]): string[] => commun.collisions(INVENTAIRE.map(([rel]) => rel), jeux);

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

// La garde de confidentialité (problemesTexte, problemesJson, garder) vient du module partagé.

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
    assert.strictEqual(attendus.length, 132);
    const ecarts = INVENTAIRE.filter(([rel, sha]) => sha256(lire(rel)) !== sha).map(([rel]) => `${rel} : empreinte observée ${sha256(lire(rel))}`);
    assert.deepStrictEqual(ecarts, [], 'Une fixture a changé : la baseline devient caduque. Mettre à jour INVENTAIRE seulement si le changement est voulu.');
  });

  test('2. Aucun fichier parasite dans la suite (hors brut/, ignoré par Git)', () => {
    const permis = new Set([
      ...INVENTAIRE.map(([rel]) => `fixtures/${rel}`),
      'mcp/serveur-fixture.js',
      'inventaire.json',
      'attendu/.gitkeep',
      'resultats/.gitkeep',
      ...DOCUMENTS,
    ]);
    // Les rapports normalisés (locaux, ignorés par Git depuis le 2026-11-09) et les baselines (commitées)
    // passent par la garde du test 11 : un rapport local doit toujours la passer.
    const rapportOuBaseline = (rel: string) => RAPPORT_PERMIS.test(rel) || BASELINE_PERMISE.test(rel);
    const parasites = listFiles(SUITE).filter((rel) => !rel.startsWith('brut/') && !permis.has(rel) && !rapportOuBaseline(rel));
    assert.deepStrictEqual(parasites, []);
    for (const [motif, exemples, refuses] of [
      [RAPPORT_PERMIS, ['resultats/context-2026-11-05-0930.json', 'resultats/payant-2026-11-05-1012.json', 'resultats/e4-2026-11-11-1000.json'], ['resultats/brouillon.json', 'resultats/context-2026-11-05.json', 'resultats/payant-2026-11-05-1012.jsonl', 'resultats/e5-2026-11-11-1000.json']],
      [BASELINE_PERMISE, ['attendu/baseline-2026-11-05.json'], ['attendu/baseline.json', 'attendu/baseline-2026-11-05-v2.json']],
    ] as [RegExp, string[], string[]][]) {
      for (const e of exemples) assert.ok(motif.test(e), e);
      for (const e of refuses) assert.ok(!motif.test(e), e);
    }
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
      assert.ok(scenarios.length > 0 && scenarios.every((s) => /^CC(0[1-9]|[1-4]\d|5[0-4])$/.test(s)), jeu);
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

  test('4. Canaris : chacun est unique dans fixtures/ et mcp/, et les jeux cout-* et e5-* n\'en portent aucun', () => {
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
      // Lot E5 : mesuré par /context seulement, sans aucun canari
      if (rel.startsWith('e5-') && (canaris.length > 0 || /CANARI-/.test(lire(rel)))) ecarts.push(`${rel} : un jeu du lot E5 ne porte aucun canari`);
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

    // Lot E4, calibrages : dans chaque jeu, un seul CLAUDE.md importe six textes, seuls puis doublés, au même niveau
    const { o200k } = require(path.join(ROOT, 'test', 'scenarios', 'scripts', 'sonde-claude-code-payant.js')) as { o200k: (t: string) => number };
    const tousLesTextes = Object.values(CALIBRAGES).flatMap((c) => c.textes);
    assert.strictEqual(new Set(tousLesTextes).size, 12, 'aucun nom de texte partagé entre les deux calibrages');
    for (const [jeu, { titre, textes }] of Object.entries(CALIBRAGES)) {
      const imports = textes.flatMap((nom) => [`@${nom}.md`, `@${nom}-x2.md`]);
      assert.strictEqual(lire(`${jeu}/projet/CLAUDE.md.fixture`), `# ${titre}\n\n${imports.join('\n')}\n`, jeu);
      const calibrage = INVENTAIRE.map(([rel]) => rel).filter((rel) => rel.startsWith(`${jeu}/`));
      assert.deepStrictEqual(calibrage.sort(), ['CLAUDE.md', ...imports.map((i) => i.slice(1))].map((n) => `${jeu}/projet/${n}.fixture`).sort(), jeu);
      for (const nom of textes) {
        const t = lire(`${jeu}/projet/${nom}.md.fixture`);
        assert.strictEqual(lire(`${jeu}/projet/${nom}-x2.md.fixture`), t + t, `${nom} : le texte doublé est T suivi de T`);
        assert.ok(t.endsWith('\n') && !t.endsWith('\n\n'), `${nom} : une seule fin de ligne finale`);
        // Aucun import, aucun canari, aucun commentaire ni frontmatter retiré par Claude Code, aucun chemin local
        assert.ok(!t.includes('@') && !/CANARI-/i.test(t) && !t.includes('<!--') && !t.startsWith('---'), nom);
        assert.ok(!/[A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\//.test(t), `${nom} : chemin local`);
        assert.ok(o200k(t) >= O200K_MIN_CALIBRAGE, `${nom} : ${o200k(t)} tokens o200k, ${O200K_MIN_CALIBRAGE} au moins`);
      }
    }
    // Second calibrage : 800 à 1 400 caractères par texte, aucune lettre accentuée hors du texte français
    for (const nom of CALIBRAGES['cout-calibrage-2'].textes) {
      const t = lire(`cout-calibrage-2/projet/${nom}.md.fixture`);
      assert.ok([...t].length >= 800 && [...t].length <= 1400, `${nom} : ${[...t].length} caractères`);
      if (nom !== 'cal2-fr-consignes') assert.ok(!/[^\x00-\x7f]/.test(t), `${nom} : ASCII seulement`);
    }
    assert.doesNotThrow(() => JSON.parse(lire('cout-calibrage-2/projet/cal2-json.md.fixture')), 'le JSON est valide');

    // Lot E4, D-6 : deux règles de même nom (globale et du projet) aux contenus différents ; un fichier importé par deux fichiers
    const regleG = lire('doublons-d6/global/rules/d6-meme-nom.md.fixture');
    const regleP = lire('doublons-d6/projet/_claude/rules/d6-meme-nom.md.fixture');
    assert.ok(regleG !== regleP && o200k(regleP) > o200k(regleG) + 10, 'contenus différents, de longueurs distinctes');
    for (const rel of ['doublons-d6/projet/CLAUDE.md.fixture', 'doublons-d6/projet/CLAUDE.local.md.fixture']) {
      assert.deepStrictEqual(lire(rel).split('\n').filter((l) => l.includes('@')), ['@d6-commun.md'], rel);
    }
    assert.ok(!lire('doublons-d6/projet/d6-commun.md.fixture').includes('@'));

    // Lot E5 : chaque coupe se lit par un nombre de lignes, n = N_ref × c(MEMORY.md) ÷ c(référence), avec des lignes
    // identiques dans le fichier mesuré et dans sa règle de référence (tailles en octets UTF-8 et en caractères, en LF)
    const octets = (t: string) => Buffer.byteLength(t, 'utf8');
    const caracteres = (t: string) => [...t].length;
    const lignesIdentiques = (rel: string, n: number): string => {
      const lignes = lire(rel).split('\n');
      assert.strictEqual(lignes.pop(), '', `${rel} : une fin de ligne finale`);
      assert.strictEqual(lignes.length, n, `${rel} : ${lignes.length} lignes`);
      assert.strictEqual(new Set(lignes).size, 1, `${rel} : lignes identiques`);
      return `${lignes[0]}\n`;
    };
    // CC41 (V1) : 250 lignes ASCII de 90 octets (22 500 octets, sous 25 000) ; référence de 100 lignes
    const v1 = lignesIdentiques('e5-imports/global/projects/__projet__/memory/MEMORY.md.fixture', 250);
    assert.strictEqual(lignesIdentiques('e5-imports/projet/_claude/rules/e5-ref-lignes.md.fixture', 100), v1);
    assert.ok(/^[\x00-\x7f]*$/.test(v1) && octets(v1) === 90);
    assert.strictEqual(octets(lire('e5-imports/global/projects/__projet__/memory/MEMORY.md.fixture')), 22500);
    // CC50 (V10) : 180 lignes de 200 octets et 160 caractères (36 000 octets, 28 800 caractères) ; référence de 40 lignes
    const v10 = lignesIdentiques('e5-coupe-octets/global/projects/__projet__/memory/MEMORY.md.fixture', 180);
    assert.strictEqual(lignesIdentiques('e5-coupe-octets/projet/_claude/rules/e5-ref-octets.md.fixture', 40), v10);
    assert.deepStrictEqual([octets(v10), caracteres(v10), v10.length], [200, 160, 160]);
    const m10 = lire('e5-coupe-octets/global/projects/__projet__/memory/MEMORY.md.fixture');
    assert.deepStrictEqual([octets(m10), caracteres(m10)], [36000, 28800]);
    // Les cinq fenêtres de V10 (de la partie entière de la coupe moins 0,8 ligne à la coupe plus 1 ligne) sont disjointes
    const coupes = [25000 / 200, 25600 / 200, 25000 / 160, 25600 / 160, 180];
    const fenetres = coupes.map((v) => [Math.floor(v) - 0.8, v + 1]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < fenetres.length; i++) assert.ok(fenetres[i][0] > fenetres[i - 1][1], `fenêtres ${i - 1} et ${i}`);

    // CC42 à CC46 et CC54 : les imports du CLAUDE.md du projet, de la règle et du CLAUDE.md du parent
    const importsDe = (rel: string) => lire(rel).split('\n').filter((l) => l.includes('@'));
    assert.deepStrictEqual(importsDe('e5-imports/projet/CLAUDE.md.fixture'), [
      '@e5-code-bloc.md', 'Le chemin `@e5-code-segment.md` est cité dans un segment de code.', '"@e5-guillemets.md"',
      '@e5-code-temoin.md', '@e5-cycle-1.md', '@e5-fm-sans.md', '@e5-fm-avec.md', '@e5-comm-avec.md', '@../e5-exterieur.md',
    ]);
    assert.ok(lire('e5-imports/projet/CLAUDE.md.fixture').includes('```text\n@e5-code-bloc.md\n```\n'), 'import dans un bloc clôturé');
    assert.deepStrictEqual(importsDe('e5-imports/projet/e5-cycle-1.md.fixture'), ['@e5-cycle-2.md']);
    assert.deepStrictEqual(importsDe('e5-imports/projet/e5-cycle-2.md.fixture'), ['@e5-cycle-1.md']);
    assert.deepStrictEqual(importsDe('e5-imports/projet/_claude/rules/e5-regle-import.md.fixture'), ['@../../e5-regle-cible.md', '@e5-regle-cible-cwd.md']);
    assert.deepStrictEqual(importsDe('e5-imports/parent/CLAUDE.md.fixture'), ['@e5-parent-cible.md', '@projet/e5-parent-vers-projet.md']);
    // CC45 (V5) : trois imports de même corps, l'un sans rien, l'un avec un frontmatter, l'un avec un commentaire de bloc
    const corps5 = lire('e5-imports/projet/e5-fm-sans.md.fixture');
    const avecFm = decouper(lire('e5-imports/projet/e5-fm-avec.md.fixture'));
    assert.ok(avecFm.fm !== null && avecFm.fm.length === 8 && avecFm.corps === corps5, 'frontmatter de 8 lignes, puis le même corps');
    const avecComm = lire('e5-imports/projet/e5-comm-avec.md.fixture');
    assert.ok(avecComm.startsWith('<!--\n') && avecComm.endsWith(`\n-->\n${corps5}`), 'commentaire de bloc, puis le même corps');
    assert.strictEqual(avecComm.split('\n').indexOf('-->'), 9, 'commentaire de 8 lignes');
    for (const t of [corps5, ...(avecFm.fm ?? []), avecComm]) assert.ok(!t.includes('@'), 'aucun import dans les fichiers de V5');
    for (const rel of ['e5-code-bloc', 'e5-code-segment', 'e5-guillemets', 'e5-code-temoin', 'e5-regle-cible', 'e5-regle-cible-cwd', 'e5-parent-vers-projet']) {
      assert.ok(!lire(`e5-imports/projet/${rel}.md.fixture`).includes('@'), rel);
    }
    // CC47 (V7) : aucun fichier de mémoire du projet ni du parent dans le jeu d'AGENTS.md
    const agents = INVENTAIRE.map(([rel]) => rel).filter((rel) => rel.startsWith('e5-agents/'));
    assert.ok(!agents.some((rel) => /\/(CLAUDE\.md|CLAUDE\.local\.md)\.fixture$/.test(rel)), 'aucun CLAUDE.md dans e5-agents');
  });

  test('6. Skills et plugin : noms, disable-model-invocation, longueurs de description, contenus de mesure', () => {
    const canari = (code: string) => INVENTAIRE.flatMap(([, , c]) => c).find((c) => c.startsWith(`CANARI-CC-${code}-`))!;
    const skills = INVENTAIRE.map(([rel]) => rel).filter((rel) => rel.endsWith('/SKILL.md.fixture'));
    assert.strictEqual(skills.length, 29);
    // Lot E5, CC48 : seuls ces six skills ont un name différent de leur dossier (clé d'homonymie : name ou dossier, casse)
    const NAME_HORS_DOSSIER: Record<string, string> = {
      'canari-e5-meme-a': 'canari-e5-meme', 'canari-e5-meme-b': 'canari-e5-meme',
      'canari-e5-cle-perso': 'canari-e5-cle', 'canari-e5-cle-projet': 'canari-e5-cle',
      'canari-e5-casse-perso': 'Canari-E5-Casse', 'canari-e5-casse-projet': 'canari-e5-casse',
    };
    for (const rel of skills) {
      const { fm } = decouper(lire(rel));
      const dossier = rel.split('/').slice(-2)[0];
      assert.strictEqual(champ(fm, 'name'), NAME_HORS_DOSSIER[dossier] ?? dossier, `${rel} : name = dossier, sauf exception déclarée`);
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

    // Lot E4, D-6 : deux skills homonymes au niveau projet (parent et projet), descriptions de longueurs très différentes
    const homoParent = description('doublons-d6/parent/_claude/skills/canari-d6-homo/SKILL.md.fixture');
    const homoProjet = description('doublons-d6/projet/_claude/skills/canari-d6-homo/SKILL.md.fixture');
    assert.ok(homoProjet.length > 2 * homoParent.length, 'la description du projet est nettement plus longue');

    // Lot E5 : chaque paire distingue ses deux copies par la longueur de leur description (au moins trois fois)
    const e5 = (jeu: string, cible: string, dossier: string) =>
      `${jeu}/${cible === 'global' ? 'global/skills' : 'projet/_claude/skills'}/${dossier}/SKILL.md.fixture`;
    for (const [jeu, courte, longue] of [
      ['e5-imports', e5('e5-imports', 'global', 'canari-e5-meme-a'), e5('e5-imports', 'global', 'canari-e5-meme-b')],
      ['e5-imports', e5('e5-imports', 'global', 'canari-e5-cle-perso'), e5('e5-imports', 'projet', 'canari-e5-cle-projet')],
      ['e5-imports', e5('e5-imports', 'global', 'canari-e5-casse-perso'), e5('e5-imports', 'projet', 'canari-e5-casse-projet')],
      ['e5-imports', e5('e5-imports', 'global', 'canari-e5-manuel'), e5('e5-imports', 'projet', 'canari-e5-manuel')],
      ['e5-coupe-octets', e5('e5-coupe-octets', 'global', 'canari-e5-paths'), e5('e5-coupe-octets', 'projet', 'canari-e5-paths')],
    ]) {
      assert.ok(description(longue).length >= 3 * description(courte).length, `${jeu} : ${courte} et ${longue}`);
    }
    // CC49 (V9) et CC51 (V11) : la copie personnelle est manuelle, ou limitée par un motif qui ne correspond à rien
    assert.strictEqual(champ(decouper(lire(e5('e5-imports', 'global', 'canari-e5-manuel'))).fm, 'disable-model-invocation'), 'true');
    assert.deepStrictEqual(decouper(lire(e5('e5-coupe-octets', 'global', 'canari-e5-paths'))).fm!.slice(-2), ['paths:', '  - "**/*.e5-aucun"']);
    for (const rel of skills.filter((r) => r.startsWith('e5-') && !r.includes('canari-e5-manuel') && !r.includes('/global/skills/canari-e5-paths/'))) {
      const fm = decouper(lire(rel)).fm!;
      assert.ok(!fm.some((l) => l.startsWith('disable-model-invocation') || l.startsWith('paths')), `${rel} : skill listé normalement`);
    }
    // CC52 (V12) : quatre skills du projet de même description et de noms de même longueur
    const v12 = ['canari-e5-tem', 'canari-e5-off', 'canari-e5-nom', 'canari-e5-inv'];
    assert.strictEqual(new Set(v12.map((n) => description(e5('e5-coupe-octets', 'projet', n)))).size, 1, 'même description');
    assert.strictEqual(new Set(v12.map((n) => n.length)).size, 1, 'noms de même longueur');

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

    // Lot E5 : les deux fichiers de réglages du projet portent exactement ces clés (CC52 et CC53), et aucun autre
    // fichier de réglages n'est déployé par le lot (le profil isolé refuse un settings.json à sa racine)
    assert.deepStrictEqual(jsonDe('e5-coupe-octets/projet/_claude/settings.local.json.fixture'), {
      skillOverrides: { 'canari-e5-off': 'off', 'canari-e5-nom': 'name-only', 'canari-e5-inv': 'user-invocable-only' },
    });
    assert.deepStrictEqual(jsonDe('e5-agents/projet/_claude/settings.json.fixture'), { autoMemoryEnabled: false });
    assert.deepStrictEqual(INVENTAIRE.map(([rel]) => rel).filter((rel) => rel.startsWith('e5-') && /settings(\.local)?\.json\.fixture$/.test(rel)).sort(), [
      'e5-agents/projet/_claude/settings.json.fixture', 'e5-coupe-octets/projet/_claude/settings.local.json.fixture',
    ]);
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

  test('11. Confidentialité : attendu/, resultats/, fixtures/, mcp/, inventaire.json et les documents ne contiennent aucune donnée locale', () => {
    const poste = lirePoste();
    const fuites: string[] = [];
    for (const dossier of ['attendu', 'resultats', 'fixtures', 'mcp']) {
      const abs = path.join(SUITE, dossier);
      if (!fs.existsSync(abs)) continue;
      for (const rel of listFiles(abs, dossier)) fuites.push(...garder(rel, fs.readFileSync(path.join(SUITE, rel), 'utf8'), poste));
    }
    fuites.push(...garder('inventaire.json', fs.readFileSync(INVENTAIRE_JSON, 'utf8'), poste));
    for (const doc of DOCUMENTS) {
      if (fs.existsSync(path.join(SUITE, doc))) fuites.push(...garder(doc, fs.readFileSync(path.join(SUITE, doc), 'utf8'), poste));
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

  test('13. .gitignore : brut/ et les rapports de resultats/ sont ignorés (sauf .gitkeep), le reste de la suite est suivi', (t) => {
    const depot = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: ROOT });
    if (depot.error || depot.status !== 0) {
      t.skip('Hors d\'un dépôt Git, ou git introuvable.');
      return;
    }
    // Décision du 2026-11-09 : les rapports restent locaux, seule la baseline est commitée.
    const local = (rel: string) => rel.startsWith('brut/') || (rel.startsWith('resultats/') && rel !== 'resultats/.gitkeep');
    const temoins = [`${SUITE_REL}/brut/exemple.jsonl`, `${SUITE_REL}/resultats/context-2026-11-05-0930.json`, `${SUITE_REL}/resultats/payant-2026-11-05-1012.json`];
    const suivis = [...new Set([...listFiles(SUITE).filter((rel) => !local(rel)), 'resultats/.gitkeep', 'attendu/baseline-2026-11-05.json'])].map((rel) => `${SUITE_REL}/${rel}`);
    const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: ROOT, input: [...temoins, ...suivis].join('\n') + '\n' });
    assert.ok(result.status === 0 || result.status === 1, result.stderr.toString('utf8'));
    const ignores = result.stdout.toString('utf8').split(/\r?\n/).filter(Boolean);
    assert.deepStrictEqual(ignores, temoins, 'Seuls brut/ et les rapports de resultats/ doivent être ignorés (resultats/.gitkeep et attendu/ restent suivis)');
  });
});
