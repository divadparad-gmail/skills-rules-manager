#!/usr/bin/env node

/**
 * scripts/capture-webviews.js
 * 
 * Script utilitaire officiel pour wf-github-publish :
 * 1. Génère les vues HTML fidèles aux composants VS Code de l'extension.
 * 2. Pilote le moteur Chromium de Microsoft Edge en mode headless via puppeteer-core.
 * 3. Enregistre les captures d'écran authentiques du programme dans `media/screenshots/`.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../../..');
const MEDIA_DIR = path.join(ROOT_DIR, 'media');
const SCREENSHOTS_DIR = path.join(MEDIA_DIR, 'screenshots');
const PREVIEWS_OUT_DIR = path.join(ROOT_DIR, 'out', 'previews');

console.log('🚀 [wf-github-publish] Démarrage du générateur de captures réelles...');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}
if (!fs.existsSync(PREVIEWS_OUT_DIR)) {
  fs.mkdirSync(PREVIEWS_OUT_DIR, { recursive: true });
}

// 1. Lecture des sources Webview
const stylesCssPath = path.join(ROOT_DIR, 'src', 'webview', 'styles.css');
const stylesCss = fs.existsSync(stylesCssPath) ? fs.readFileSync(stylesCssPath, 'utf8') : '';
const mainJsPath = path.join(ROOT_DIR, 'src', 'webview', 'main.js');
const mainJs = fs.existsSync(mainJsPath) ? fs.readFileSync(mainJsPath, 'utf8') : '';
const cheatJsPath = path.join(ROOT_DIR, 'src', 'webview', 'cheatsheet.js');
const cheatJs = fs.existsSync(cheatJsPath) ? fs.readFileSync(cheatJsPath, 'utf8') : '';

// 2. Thème sombre VS Code Dark Modern pour un rendu authentique
const vsCodeThemeVars = `
:root {
  --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --vscode-editor-background: #181825;
  --vscode-editor-foreground: #cdd6f4;
  --vscode-sideBar-background: #1e1e2e;
  --vscode-widget-border: rgba(255, 255, 255, 0.08);
  --vscode-list-hoverBackground: rgba(255, 255, 255, 0.06);
  --vscode-input-background: #313244;
  --vscode-input-foreground: #cdd6f4;
  --vscode-input-border: rgba(255, 255, 255, 0.12);
  --vscode-focusBorder: #89b4fa;
  --vscode-badge-background: #45475a;
  --vscode-badge-foreground: #cdd6f4;
  --vscode-descriptionForeground: #a6adc8;
  --vscode-button-background: #7c3aed;
  --vscode-button-foreground: #ffffff;
  --vscode-button-hoverBackground: #6d28d9;
}
`;

// 3. État réel et représentatif de l'extension
const realisticState = {
  nasStatus: {
    online: true,
    path: "\\\\Nas1\\DD2\\IA\\Antigravity-Templates",
    checkedAt: Date.now()
  },
  workspace: {
    hasWorkspace: true,
    workspacePath: "C:\\Users\\David\\Documents\\Sites Web\\creer-extension-vscode-rules-skills-manager",
    tool: "antigravity",
    agentsDir: ".agents",
    claudeDir: null,
    hasClaudeMd: false,
    isAntigravityHost: true
  },
  stats: {
    budgetTotal: 20000,
    usedTokensTotal: 4850,
    availablePercentage: 75.8,
    soulGlobal: { type: 'soul', scope: 'global', activeCount: 0, totalCount: 0, charCount: 0, tokenCount: 0, percentage: 0, directoryPath: '' },
    soulLocal: { type: 'soul', scope: 'local', activeCount: 1, totalCount: 1, charCount: 442, tokenCount: 111, percentage: 0.6, directoryPath: 'GEMINI.md' },
    rulesGlobal: { type: 'rule', scope: 'global', activeCount: 2, totalCount: 2, charCount: 2400, tokenCount: 600, percentage: 3.0, directoryPath: '~/.gemini/config/rules' },
    rulesLocal: { type: 'rule', scope: 'local', activeCount: 5, totalCount: 7, charCount: 8800, tokenCount: 2200, percentage: 11.0, directoryPath: '.agents/rules', permanentCount: 2, conditionalCount: 3, conditionalTokenCount: 60, warningCount: 1 },
    skillsGlobal: { type: 'skill', scope: 'global', activeCount: 4, totalCount: 6, charCount: 5600, tokenCount: 1400, percentage: 7.0, directoryPath: '~/.gemini/config/skills' },
    skillsLocal: { type: 'skill', scope: 'local', activeCount: 3, totalCount: 4, charCount: 2150, tokenCount: 539, percentage: 2.7, directoryPath: '.agents/skills' },
    mcpGlobal: { type: 'mcp', scope: 'global', activeCount: 0, totalCount: 0, charCount: 0, tokenCount: 0, percentage: 0, directoryPath: '' },
    mcpLocal: { type: 'mcp', scope: 'local', activeCount: 1, totalCount: 1, charCount: 173, tokenCount: 43, percentage: 0.2, directoryPath: '.agents/mcp_config.json' }
  },
  nasResources: [
    {
      id: "GEMINI.md",
      name: "GEMINI.md",
      description: "Instructions Maîtresses Réseau Antigravity (Niveau 0)",
      type: "soul",
      scope: "nas",
      enabled: true,
      lineCount: 45,
      path: "\\\\Nas1\\DD2\\IA\\Antigravity-Templates\\GEMINI.md",
      syncStatus: "synced",
      metadata: { isSoul: true, locked: true }
    },
    {
      id: "01-rule-perm-standard-always-on.md",
      name: "01-rule-perm-standard-always-on.md",
      description: "Standards de développement et règles inviolables",
      type: "rule",
      scope: "nas",
      enabled: true,
      lineCount: 35,
      path: "\\\\Nas1\\DD2\\IA\\Antigravity-Templates\\rules\\01-rule-perm-standard-always-on.md",
      syncStatus: "synced",
      metadata: { isPermanent: true }
    },
    {
      id: "skill-brainstorming",
      name: "skill-brainstorming",
      description: "Exploration des intentions utilisateur et architecture avant tout dev",
      type: "skill",
      scope: "nas",
      enabled: true,
      lineCount: 68,
      path: "\\\\Nas1\\DD2\\IA\\Antigravity-Templates\\skills\\skill-brainstorming\\SKILL.md",
      syncStatus: "synced"
    },
    {
      id: "wf-commit",
      name: "wf-commit",
      description: "Action : Création d'un commit Git sécurisé et conventionnel",
      type: "skill",
      scope: "nas",
      enabled: true,
      lineCount: 91,
      path: "\\\\Nas1\\DD2\\IA\\Antigravity-Templates\\skills\\wf-commit\\SKILL.md",
      syncStatus: "synced",
      metadata: { isWorkflow: true }
    },
    {
      id: "wf-deploy",
      name: "wf-deploy",
      description: "Action : Déploiement sécurisé GitHub avec webhook Coolify",
      type: "skill",
      scope: "nas",
      enabled: true,
      lineCount: 53,
      path: "\\\\Nas1\\DD2\\IA\\Antigravity-Templates\\skills\\wf-deploy\\SKILL.md",
      syncStatus: "synced",
      metadata: { isWorkflow: true }
    }
  ],
  globalResources: [
    {
      id: "skill-brainstorming",
      name: "skill-brainstorming",
      description: "Exploration des intentions utilisateur et architecture avant tout dev",
      type: "skill",
      scope: "global",
      enabled: true,
      lineCount: 68,
      path: "~/.gemini/config/skills/skill-brainstorming/SKILL.md",
      syncStatus: "synced"
    },
    {
      id: "skill-dev",
      name: "skill-dev",
      description: "Normes d'architecture logicielle et qualité de code",
      type: "skill",
      scope: "global",
      enabled: true,
      lineCount: 42,
      path: "~/.gemini/config/skills/skill-dev/SKILL.md",
      syncStatus: "synced"
    },
    {
      id: "wf-commit",
      name: "wf-commit",
      description: "Action : Création d'un commit Git sécurisé et conventionnel",
      type: "skill",
      scope: "global",
      enabled: true,
      lineCount: 91,
      path: "~/.gemini/config/skills/wf-commit/SKILL.md",
      syncStatus: "synced",
      metadata: { isWorkflow: true }
    },
    {
      id: "wf-github-publish",
      name: "wf-github-publish",
      description: "Action : Publication complète et officielle sur GitHub (Showroom, Release, VSIX)",
      type: "skill",
      scope: "global",
      enabled: true,
      lineCount: 154,
      path: "~/.gemini/config/skills/wf-github-publish/SKILL.md",
      syncStatus: "synced",
      metadata: { isWorkflow: true }
    }
  ],
  localResources: [
    {
      id: "GEMINI.md",
      name: "GEMINI.md",
      description: "Instructions Maîtresses Locales Antigravity (Niveau 1 Projet)",
      type: "soul",
      scope: "local",
      enabled: true,
      lineCount: 14,
      path: "GEMINI.md",
      syncStatus: "local_only",
      metadata: { isSoul: true, locked: true }
    },
    {
      id: "01-rule-perm-no-frontmatter.md",
      name: "01-rule-perm-no-frontmatter.md",
      description: "Règle permanente locale sans frontmatter YAML",
      type: "rule",
      scope: "local",
      enabled: true,
      lineCount: 18,
      path: ".agents/rules/01-rule-perm-no-frontmatter.md",
      syncStatus: "local_only",
      metadata: { isPermanent: true }
    },
    {
      id: "03-rule-cond-trigger-glob.md",
      name: "03-rule-cond-trigger-glob.md",
      description: "Règle conditionnelle TypeScript activée sur *.ts, *.tsx",
      type: "rule",
      scope: "local",
      enabled: true,
      lineCount: 22,
      path: ".agents/rules/03-rule-cond-trigger-glob.md",
      syncStatus: "local_only",
      metadata: { isConditional: true, triggerGlob: "*.ts, *.tsx" }
    },
    {
      id: "06-rule-warn-size-exceeded-24kb.md",
      name: "06-rule-warn-size-exceeded-24kb.md",
      description: "Règle de test volumineuse démontrant l'alerte du coach IA",
      type: "rule",
      scope: "local",
      enabled: true,
      lineCount: 354,
      path: ".agents/rules/06-rule-warn-size-exceeded-24kb.md",
      syncStatus: "local_only",
      metadata: { isPermanent: true, warningLinesExceeded: true, warningSizeExceeded: true }
    },
    {
      id: "07-rule-disabled-suffix.md",
      name: "07-rule-disabled-suffix.md",
      description: "Règle désactivée par suffixe physique .disabled",
      type: "rule",
      scope: "local",
      enabled: false,
      lineCount: 7,
      path: ".agents/rules/07-rule-disabled-suffix.md.disabled",
      syncStatus: "local_only"
    },
    {
      id: "skill-standard",
      name: "skill-standard",
      description: "Compétence standard locale avec métadonnées complètes",
      type: "skill",
      scope: "local",
      enabled: true,
      lineCount: 14,
      path: ".agents/skills/skill-standard/SKILL.md",
      syncStatus: "local_only"
    },
    {
      id: "skill-with-annexes",
      name: "skill-with-annexes",
      description: "Compétence complète disposant de sous-dossiers conventionnels (scripts/, references/)",
      type: "skill",
      scope: "local",
      enabled: true,
      lineCount: 15,
      path: ".agents/skills/skill-with-annexes/SKILL.md",
      syncStatus: "local_only"
    },
    {
      id: "wf-action-deploy",
      name: "wf-action-deploy",
      description: "Action : Automatisation et déploiement en production",
      type: "skill",
      scope: "local",
      enabled: true,
      lineCount: 12,
      path: ".agents/skills/wf-action-deploy/SKILL.md",
      syncStatus: "local_only",
      metadata: { isWorkflow: true }
    },
    {
      id: "wf-github-publish",
      name: "wf-github-publish",
      description: "Action : Publication complète et officielle sur GitHub (Showroom, Release, VSIX)",
      type: "skill",
      scope: "local",
      enabled: true,
      lineCount: 154,
      path: ".agents/skills/wf-github-publish/SKILL.md",
      syncStatus: "local_only",
      metadata: { isWorkflow: true }
    }
  ],
  isDashboardOpen: true,
  isCheatSheetOpen: false
};

// 4. Génération du HTML autonome pour le Dashboard
function buildDashboardHtml() {
  const tpl = fs.readFileSync(path.join(ROOT_DIR, 'src', 'webview', 'dashboard.html'), 'utf8');
  let html = tpl
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, '')
    .replace(/<link rel="stylesheet" href="\{\{styleUri\}\}">/i, `<style>${stylesCss}\n${vsCodeThemeVars}</style>`)
    .replace('{{version}}', 'v0.3.0');

  const injectScript = `
  <script>
    window.acquireVsCodeApi = function() {
      return {
        postMessage: function(msg) { console.log('VSCode Message:', msg); },
        getState: function() { return {}; },
        setState: function() {}
      };
    };
  </script>
  <script>
    ${mainJs}
  </script>
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() {
        window.postMessage({ type: 'stateUpdate', payload: ${JSON.stringify(realisticState)} }, '*');
      }, 50);
    });
  </script>
  `;

  html = html.replace(/<script nonce="\{\{nonce\}\}" src="\{\{scriptUri\}\}"><\/script>/i, injectScript);
  return html;
}

// 5. Génération du HTML autonome pour la Sidebar
function buildSidebarHtml() {
  const tpl = fs.readFileSync(path.join(ROOT_DIR, 'src', 'webview', 'sidebar.html'), 'utf8');
  let html = tpl
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, '')
    .replace(/<link rel="stylesheet" href="\{\{styleUri\}\}">/i, `<style>${stylesCss}\n${vsCodeThemeVars}</style>`)
    .replace('{{version}}', 'v0.3.0');

  const injectScript = `
  <script>
    window.acquireVsCodeApi = function() {
      return {
        postMessage: function(msg) { console.log('VSCode Message:', msg); },
        getState: function() { return {}; },
        setState: function() {}
      };
    };
  </script>
  <script>
    ${mainJs}
  </script>
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() {
        window.postMessage({ type: 'stateUpdate', payload: ${JSON.stringify(realisticState)} }, '*');
      }, 50);
    });
  </script>
  `;

  html = html.replace(/<script nonce="\{\{nonce\}\}" src="\{\{scriptUri\}\}"><\/script>/i, injectScript);
  return html;
}

// 6. Génération du HTML autonome pour la Cheat Sheet
function buildCheatSheetHtml() {
  const tpl = fs.readFileSync(path.join(ROOT_DIR, 'src', 'webview', 'cheatsheet.html'), 'utf8');
  let html = tpl
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, '')
    .replace(/<link rel="stylesheet" href="\{\{styleUri\}\}">/i, `<style>${stylesCss}\n${vsCodeThemeVars}</style>`)
    .replace('{{version}}', 'v0.3.0');

  const injectScript = `
  <script>
    window.acquireVsCodeApi = function() {
      return {
        postMessage: function(msg) { console.log('VSCode Message:', msg); },
        getState: function() { return {}; },
        setState: function() {}
      };
    };
  </script>
  <script>
    ${cheatJs}
  </script>
  `;

  html = html.replace(/<script nonce="\{\{nonce\}\}" src="\{\{scriptUri\}\}"><\/script>/i, injectScript);
  return html;
}

async function captureAll() {
  let puppeteer;
  try {
    puppeteer = require('puppeteer-core');
  } catch {
    puppeteer = require(path.join(ROOT_DIR, 'node_modules', 'puppeteer-core'));
  }

  const edgePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ];

  let executablePath = edgePaths.find((p) => fs.existsSync(p));
  if (!executablePath) {
    throw new Error('Aucun navigateur Chromium (Edge ou Chrome) trouvé sur le système pour la capture headless.');
  }

  console.log(`🌐 Navigateur Chromium détecté : ${executablePath}`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
  });

  try {
    // A. Capture du Dashboard
    console.log('📸 1/3 Capture du Grand Dashboard...');
    const dashPage = await browser.newPage();
    await dashPage.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    const dashHtml = buildDashboardHtml();
    fs.writeFileSync(path.join(PREVIEWS_OUT_DIR, 'preview-dashboard.html'), dashHtml, 'utf8');
    await dashPage.setContent(dashHtml, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 600)); // Laisser le temps à l'état de s'animer
    const dashOut = path.join(SCREENSHOTS_DIR, 'dashboard.png');
    await dashPage.screenshot({ path: dashOut });
    console.log(`   ✅ Enregistré : ${dashOut}`);
    await dashPage.close();

    // B. Capture de la Sidebar
    console.log('📸 2/3 Capture du panneau latéral (Sidebar)...');
    const sidePage = await browser.newPage();
    await sidePage.setViewport({ width: 440, height: 950, deviceScaleFactor: 1 });
    const sideHtml = buildSidebarHtml();
    fs.writeFileSync(path.join(PREVIEWS_OUT_DIR, 'preview-sidebar.html'), sideHtml, 'utf8');
    await sidePage.setContent(sideHtml, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 600));
    const sideOut = path.join(SCREENSHOTS_DIR, 'sidebar.png');
    await sidePage.screenshot({ path: sideOut });
    console.log(`   ✅ Enregistré : ${sideOut}`);
    await sidePage.close();

    // C. Capture de la Cheat Sheet
    console.log('📸 3/3 Capture du Guide interactif (Cheat Sheet)...');
    const cheatPage = await browser.newPage();
    await cheatPage.setViewport({ width: 1300, height: 980, deviceScaleFactor: 1 });
    const cheatHtml = buildCheatSheetHtml();
    fs.writeFileSync(path.join(PREVIEWS_OUT_DIR, 'preview-cheatsheet.html'), cheatHtml, 'utf8');
    await cheatPage.setContent(cheatHtml, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 600));
    const cheatOut = path.join(SCREENSHOTS_DIR, 'cheatsheet.png');
    await cheatPage.screenshot({ path: cheatOut });
    console.log(`   ✅ Enregistré : ${cheatOut}`);
    await cheatPage.close();

    console.log('✨ Toutes les captures réelles ont été générées avec succès !');
  } finally {
    await browser.close();
  }
}

captureAll().catch((err) => {
  console.error('❌ Erreur lors de la capture :', err);
  process.exit(1);
});
