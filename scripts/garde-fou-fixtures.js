/**
 * Garde-fou du banc d'essai : empêche de commiter une fixture déployée à la racine.
 *
 * La règle n'existe qu'ici. Elle sert au test common-garde-fou-fixtures (npm test) et au hook
 * .githooks/pre-commit. Ce module s'exécute avec node seul, sans compilation ni dépendance :
 * le hook ne peut dépendre ni de out/ ni de out-test/.
 *
 * Les contrôles portent sur l'index et sur les fichiers d'exclusion, jamais sur les fixtures
 * présentes dans l'arbre de travail : un banc déployé mais non indexé est accepté.
 *   a. l'index ne contient ni fixture non canonique (ni sa variante .disabled), ni le manifeste,
 *      ni un fichier de .banc-essai-sauvegarde/ ;
 *   b. un chemin canonique indexé n'est pas identique à sa fixture (fins de ligne normalisées) ;
 *   c. le .gitignore couvre chaque fixture non canonique et sa variante, le manifeste et la
 *      sauvegarde (vérifié par git check-ignore --no-index) ;
 *   d. le .vscodeignore exclut la sauvegarde (contrôle textuel ; vsce ls fait foi avant publication) ;
 *   e. le .gitignore n'ignore aucun chemin canonique, où de vrais fichiers doivent rester commitables.
 *
 * Usage : node scripts/garde-fou-fixtures.js [racine du dépôt]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/** Sources des fixtures, comme dans ScenarioManager.getScenarioFiles() (un test vérifie l'équivalence). */
const FIXTURE_SOURCE_DIRS = ['test/scenarios/antigravity', 'test/scenarios/claude-code'];
/** Chemins non ignorés par Git : de vrais fichiers peuvent y vivre (« identique vaut fixture »). */
const CANONICAL_PATHS = ['CLAUDE.md', 'GEMINI.md', '.mcp.json', '.agents/hooks.json', '.agents/mcp_config.json'];
const MANIFEST_FILE = '.scenario-manifest.json';
const BACKUP_DIR = '.banc-essai-sauvegarde';
const VSCODEIGNORE_LINE = `${BACKUP_DIR}/**`;

function git(root, args, input) {
  const result = spawnSync('git', args, { cwd: root, input, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`git est introuvable : ${result.error.message}`);
  return result;
}

function realPath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/** Vrai si root est la racine d'un dépôt Git (et non un sous-dossier d'un dépôt parent). */
function isRepoRoot(root) {
  let result;
  try {
    result = git(root, ['rev-parse', '--show-toplevel']);
  } catch {
    return false;
  }
  if (result.status !== 0) return false;
  const top = realPath(result.stdout.toString('utf8').trim());
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  return same(top, realPath(root));
}

/** Chemins relatifs des fichiers de fixture (sans les dossiers ni le manifeste), triés. */
function listFixtureFiles(root) {
  return [...fixtureSources(root).keys()].sort();
}

/** Associe chaque chemin de fixture aux fichiers sources qui le déploient. */
function fixtureSources(root) {
  const sources = new Map();
  for (const dir of FIXTURE_SOURCE_DIRS) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    const walk = (current, rel) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, relPath);
        } else {
          sources.set(relPath, [...(sources.get(relPath) || []), fullPath]);
        }
      }
    };
    walk(base, '');
  }
  return sources;
}

/**
 * Fixtures non canoniques et leurs variantes de désactivation : l'extension renomme X.md en
 * X.md.disabled (règles, SKILL.md), et inversement pour réactiver.
 */
function coveredPaths(root) {
  const covered = new Set();
  for (const rel of listFixtureFiles(root)) {
    if (CANONICAL_PATHS.includes(rel)) continue;
    covered.add(rel);
    if (rel.endsWith('.md')) covered.add(`${rel}.disabled`);
    if (rel.endsWith('.md.disabled')) covered.add(rel.slice(0, -'.disabled'.length));
  }
  return [...covered].sort();
}

function normalizeEol(buffer) {
  return buffer.toString('utf8').replace(/\r\n?/g, '\n');
}

/** Contrôles a et b, sur la version indexée. */
function checkIndex(root) {
  const violations = [];
  const covered = new Set(coveredPaths(root));
  const sources = fixtureSources(root);
  const listing = git(root, ['ls-files', '-s', '-z']);
  if (listing.status !== 0) throw new Error(`git ls-files a échoué : ${listing.stderr.toString('utf8').trim()}`);

  for (const record of listing.stdout.toString('utf8').split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    const [, sha] = record.slice(0, tab).split(' ');
    const rel = record.slice(tab + 1);

    if (covered.has(rel)) {
      violations.push({ rule: 'a', path: rel, message: 'fixture du banc d\'essai indexée' });
    } else if (rel === MANIFEST_FILE) {
      violations.push({ rule: 'a', path: rel, message: 'manifeste du banc d\'essai indexé' });
    } else if (rel.startsWith(`${BACKUP_DIR}/`)) {
      violations.push({ rule: 'a', path: rel, message: 'fichier de la sauvegarde du banc d\'essai indexé' });
    } else if (CANONICAL_PATHS.includes(rel) && sources.has(rel)) {
      const blob = git(root, ['cat-file', 'blob', sha]);
      if (blob.status !== 0) throw new Error(`git cat-file a échoué pour ${rel}`);
      const indexed = normalizeEol(blob.stdout);
      if (sources.get(rel).some((source) => normalizeEol(fs.readFileSync(source)) === indexed)) {
        violations.push({ rule: 'b', path: rel, message: 'version indexée identique à la fixture du banc d\'essai' });
      }
    }
  }
  return violations;
}

/** Interroge git check-ignore sans tenir compte de l'index : renvoie l'ensemble des chemins ignorés. */
function ignoredPaths(root, paths) {
  const result = git(root, ['check-ignore', '--no-index', '--non-matching', '-v', '-z', '--stdin'], paths.join('\0') + '\0');
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore a échoué : ${result.stderr.toString('utf8').trim()}`);
  }
  // Format -z -v : source, ligne, motif, chemin. Un motif en « ! » (négation) n'ignore pas.
  const fields = result.stdout.toString('utf8').split('\0');
  const ignored = new Set();
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const [source, , pattern, rel] = fields.slice(i, i + 4);
    if (source && !pattern.startsWith('!')) ignored.add(rel);
  }
  return ignored;
}

/** Contrôles c et e. */
function checkGitignore(root) {
  const violations = [];
  const backupWitness = `${BACKUP_DIR}/index.json`;
  const required = [...coveredPaths(root), MANIFEST_FILE, backupWitness];
  const ignored = ignoredPaths(root, [...required, ...CANONICAL_PATHS]);

  for (const rel of required) {
    if (ignored.has(rel)) continue;
    const line = rel === backupWitness ? `/${BACKUP_DIR}/` : `/${rel}`;
    violations.push({ rule: 'c', path: rel, message: `non ignoré par .gitignore (ajoutez la ligne « ${line} »)` });
  }
  for (const rel of CANONICAL_PATHS) {
    if (ignored.has(rel)) {
      violations.push({ rule: 'e', path: rel, message: 'chemin canonique ignoré par .gitignore : un vrai fichier ne pourrait plus y être commité' });
    }
  }
  return violations;
}

/** Contrôle d : une ligne exacte, et aucune négation qui réintroduirait la sauvegarde. */
function checkVscodeignore(root) {
  const file = path.join(root, '.vscodeignore');
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()) : [];
  const violations = [];
  if (!lines.includes(VSCODEIGNORE_LINE)) {
    violations.push({ rule: 'd', path: '.vscodeignore', message: `la ligne « ${VSCODEIGNORE_LINE} » est absente` });
  }
  for (const line of lines.filter((l) => l.startsWith(`!${BACKUP_DIR}`))) {
    violations.push({ rule: 'd', path: '.vscodeignore', message: `la négation « ${line} » réintroduit la sauvegarde dans le paquet` });
  }
  return violations;
}

/** Tous les contrôles. Hors de la racine d'un dépôt Git, il n'y a rien à vérifier. */
function checkAll(root) {
  if (!isRepoRoot(root)) return { inGitRepo: false, violations: [] };
  return {
    inGitRepo: true,
    violations: [...checkIndex(root), ...checkGitignore(root), ...checkVscodeignore(root)],
  };
}

function formatViolations(violations) {
  return violations.map((v) => `  [${v.rule}] ${v.path} : ${v.message}`).join('\n');
}

module.exports = {
  FIXTURE_SOURCE_DIRS,
  CANONICAL_PATHS,
  MANIFEST_FILE,
  BACKUP_DIR,
  VSCODEIGNORE_LINE,
  isRepoRoot,
  listFixtureFiles,
  coveredPaths,
  checkIndex,
  checkGitignore,
  checkVscodeignore,
  checkAll,
  formatViolations,
};

if (require.main === module) {
  const root = path.resolve(process.argv[2] || process.cwd());
  try {
    const { inGitRepo, violations } = checkAll(root);
    if (!inGitRepo) {
      console.log(`[garde-fou] ${root} n'est pas la racine d'un dépôt Git : rien à vérifier.`);
      process.exit(0);
    }
    if (violations.length > 0) {
      console.error(
        `[garde-fou] Commit refusé : ${violations.length} problème(s) avec les fixtures du banc d'essai.\n` +
          `${formatViolations(violations)}\n` +
          'Retirez les fixtures de l\'index (git restore --staged <chemin>), puis videz le banc avec ' +
          'npm run test:clean avant de commiter.'
      );
      process.exit(1);
    }
  } catch (err) {
    console.error(`[garde-fou] Vérification impossible, commit refusé : ${err.message}`);
    process.exit(1);
  }
}
