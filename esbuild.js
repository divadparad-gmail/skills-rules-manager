/**
 * Chaîne de construction esbuild (§2.E du PRD).
 *
 * Le paquet de l'hôte d'extension est transpilé, résolu et réduit en un seul
 * module CommonJS. Le module `vscode` reste externe : il est fourni par
 * l'éditeur au moment de l'exécution et ne doit jamais être embarqué.
 *
 * Usage :
 *   node esbuild.js            construction de développement avec sourcemaps
 *   node esbuild.js --production  construction minifiée destinée au paquet .vsix
 *   node esbuild.js --watch     reconstruction incrémentale continue
 */

const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Journalise le résultat de chaque reconstruction en mode surveillance. */
const buildReporterPlugin = {
  name: 'build-reporter',
  setup(build) {
    build.onStart(() => {
      console.log('[esbuild] construction en cours…');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [esbuild] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}`);
        }
      });
      if (result.errors.length === 0) {
        console.log('[esbuild] construction terminée.');
      }
    });
  },
};

async function main() {
  const context = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    treeShaking: true,
    logLevel: 'silent',
    plugins: [buildReporterPlugin],
  });

  if (watch) {
    await context.watch();
    return;
  }

  await context.rebuild();
  await context.dispose();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
