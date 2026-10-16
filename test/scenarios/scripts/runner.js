const fs = require('fs');
const path = require('path');

const target = process.argv[2] || 'all'; // 'antigravity' | 'claude-code' | 'all' | 'clean'
const rootPath = path.resolve(__dirname, '../../..');
const scenariosDir = path.resolve(__dirname, '..');

async function copyRecursive(src, dst) {
  let count = 0;
  if (!fs.existsSync(src)) return count;
  await fs.promises.mkdir(dst, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      count += await copyRecursive(s, d);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(s, d);
      count++;
    }
  }
  return count;
}

async function clean(tgt) {
  if (tgt === 'antigravity' || tgt === 'all' || tgt === 'clean') {
    const p1 = path.join(rootPath, '.agents');
    if (fs.existsSync(p1)) await fs.promises.rm(p1, { recursive: true, force: true });
    const p2 = path.join(rootPath, 'GEMINI.md');
    if (fs.existsSync(p2)) await fs.promises.rm(p2, { force: true });
    const p3 = path.join(rootPath, 'AGENTS.md');
    if (fs.existsSync(p3)) await fs.promises.rm(p3, { force: true });
    const os = require('os');
    const testGlobalRule = path.join(os.homedir(), '.gemini', 'config', 'rules', 'rule-test-doublon.md');
    if (fs.existsSync(testGlobalRule)) {
      try { await fs.promises.unlink(testGlobalRule); } catch {}
    }
  }
  if (tgt === 'claude-code' || tgt === 'all' || tgt === 'clean') {
    const p1 = path.join(rootPath, '.claude');
    if (fs.existsSync(p1)) await fs.promises.rm(p1, { recursive: true, force: true });
    const p2 = path.join(rootPath, 'CLAUDE.md');
    if (fs.existsSync(p2)) await fs.promises.rm(p2, { force: true });
  }
}

async function run() {
  console.log(`[Scenarios Runner] Action: ${target} sur ${rootPath}`);
  await clean(target);

  if (target === 'clean') {
    console.log('[Scenarios Runner] Nettoyage terminé avec succès.');
    return;
  }

  let total = 0;
  if (target === 'antigravity' || target === 'all') {
    const srcAgy = path.join(scenariosDir, 'antigravity');
    const c = await copyRecursive(srcAgy, rootPath);
    console.log(`[Scenarios Runner] Antigravity déployé (${c} fichiers).`);
    total += c;
  }
  if (target === 'claude-code' || target === 'all') {
    const srcClaude = path.join(scenariosDir, 'claude-code');
    const c = await copyRecursive(srcClaude, rootPath);
    console.log(`[Scenarios Runner] Claude Code déployé (${c} fichiers).`);
    total += c;
  }
  if (target === 'all') {
    try {
      const os = require('os');
      const globalRulesDir = path.join(os.homedir(), '.gemini', 'config', 'rules');
      const testRuleSrc = path.join(scenariosDir, 'antigravity', '.agents', 'rules', 'rule-test-doublon.md');
      if (fs.existsSync(testRuleSrc)) {
        if (!fs.existsSync(globalRulesDir)) {
          await fs.promises.mkdir(globalRulesDir, { recursive: true });
        }
        await fs.promises.copyFile(testRuleSrc, path.join(globalRulesDir, 'rule-test-doublon.md'));
        console.log('[Scenarios Runner] Règle doublon test injectée dans ~/.gemini/config/rules/');
      }
    } catch (e) {
      console.warn('[Scenarios Runner] Note : doublon global non copié', e.message);
    }
  }

  console.log(`[Scenarios Runner] Total fichiers déployés : ${total}`);
}

run().catch((err) => {
  console.error('[Scenarios Runner] Erreur :', err);
  process.exit(1);
});
