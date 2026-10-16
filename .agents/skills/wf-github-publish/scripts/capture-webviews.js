#!/usr/bin/env node

/**
 * scripts/capture-webviews.js
 * 
 * Script utilitaire pour wf-github-publish :
 * 1. Génère des fichiers HTML prévisualisables en toute autonomie dans un navigateur.
 * 2. Vérifie la présence des captures d'écran requises pour la vitrine README dans `media/screenshots/`.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../../..');
const MEDIA_DIR = path.join(ROOT_DIR, 'media');
const SCREENSHOTS_DIR = path.join(MEDIA_DIR, 'screenshots');
const PREVIEWS_OUT_DIR = path.join(ROOT_DIR, 'out', 'previews');

const EXPECTED_SCREENSHOTS = [
  'dashboard.png',
  'sidebar.png',
  'cheatsheet.png'
];

console.log('🔍 [wf-github-publish] Contrôle des aperçus visuels et webviews...');

// 1. Contrôle des captures d'écran existantes
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const existing = fs.readdirSync(SCREENSHOTS_DIR);
const missing = EXPECTED_SCREENSHOTS.filter(s => !existing.includes(s));

console.log(`📁 Dossier screenshots : ${SCREENSHOTS_DIR}`);
console.log(`   - Fichiers détectés : ${existing.length > 0 ? existing.join(', ') : 'Aucun'}`);

if (missing.length === 0) {
  console.log('✅ Toutes les captures requises pour la vitrine GitHub sont présentes.');
} else {
  console.log(`⚠️ Captures manquantes pour la vitrine : ${missing.join(', ')}`);
}

// 2. Génération des fichiers HTML autonomes pour prévisualisation navigateur
if (!fs.existsSync(PREVIEWS_OUT_DIR)) {
  fs.mkdirSync(PREVIEWS_OUT_DIR, { recursive: true });
}

const stylesCssPath = path.join(ROOT_DIR, 'src', 'webview', 'styles.css');
const stylesCss = fs.existsSync(stylesCssPath) ? fs.readFileSync(stylesCssPath, 'utf8') : '';

// Générer l'aperçu du Dashboard
const dashboardHtmlPath = path.join(ROOT_DIR, 'src', 'webview', 'dashboard.html');
if (fs.existsSync(dashboardHtmlPath)) {
  let content = fs.readFileSync(dashboardHtmlPath, 'utf8');
  // Injecter le CSS en ligne pour un rendu autonome dans Chrome/Edge
  content = content.replace(
    /<link\s+rel=["']stylesheet["']\s+href=["']styles\.css["']\s*\/?>/i,
    `<style>\n${stylesCss}\n</style>`
  );
  const outDash = path.join(PREVIEWS_OUT_DIR, 'preview-dashboard.html');
  fs.writeFileSync(outDash, content, 'utf8');
  console.log(`📄 Aperçu autonome généré : ${outDash}`);
}

// Générer l'aperçu de la Cheat Sheet
const cheatHtmlPath = path.join(ROOT_DIR, 'src', 'webview', 'cheatsheet.html');
if (fs.existsSync(cheatHtmlPath)) {
  let content = fs.readFileSync(cheatHtmlPath, 'utf8');
  content = content.replace(
    /<link\s+rel=["']stylesheet["']\s+href=["']styles\.css["']\s*\/?>/i,
    `<style>\n${stylesCss}\n</style>`
  );
  const outCheat = path.join(PREVIEWS_OUT_DIR, 'preview-cheatsheet.html');
  fs.writeFileSync(outCheat, content, 'utf8');
  console.log(`📄 Aperçu autonome généré : ${outCheat}`);
}

// Générer l'aperçu de la Sidebar
const sidebarHtmlPath = path.join(ROOT_DIR, 'src', 'webview', 'sidebar.html');
if (fs.existsSync(sidebarHtmlPath)) {
  let content = fs.readFileSync(sidebarHtmlPath, 'utf8');
  content = content.replace(
    /<link\s+rel=["']stylesheet["']\s+href=["']styles\.css["']\s*\/?>/i,
    `<style>\n${stylesCss}\n</style>`
  );
  const outSide = path.join(PREVIEWS_OUT_DIR, 'preview-sidebar.html');
  fs.writeFileSync(outSide, content, 'utf8');
  console.log(`📄 Aperçu autonome généré : ${outSide}`);
}

console.log('✨ [wf-github-publish] Diagnostic visuel terminé.');
