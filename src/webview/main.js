// Contrôleur client Webview pour Skills & Rules Manager
(function () {
  const vscode = {
    postMessage: (msg) => {
      if (typeof acquireVsCodeApi === 'function' && !vscode._api) {
        vscode._api = acquireVsCodeApi();
      }
      if (vscode._api) {
        vscode._api.postMessage(msg);
      } else if (typeof global !== 'undefined' && global.vscode && typeof global.vscode.postMessage === 'function') {
        global.vscode.postMessage(msg);
      }
    },
    _api: typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null,
  };

  let currentState = null;
  let currentFilter = 'all';
  let searchQuery = '';
  let showDuplicatesOnly = false;
  let selectedMiniCheatSheetTool = null; // 'claude-code' | 'antigravity' | null (null = suit l'IDE)

  // Éléments DOM (initialisés si dans un environnement de navigateur)
  let searchInput = null;
  let filterChips = [];
  let btnRefresh = null;
  let btnToggleDashboard = null;
  let searchClearBtn = null;

  function updateSearchInputState() {
    if (searchInput) {
      if (showDuplicatesOnly) {
        searchInput.placeholder = '🔥 Filtre doublons actif (cliquez ✕ pour tout afficher)';
        searchInput.classList.add('filter-duplicates-active');
        if (searchClearBtn) searchClearBtn.style.display = 'flex';
      } else {
        searchInput.placeholder = 'Rechercher par nom, tag, description...';
        searchInput.classList.remove('filter-duplicates-active');
        if (searchInput.value && searchInput.value.trim().length > 0) {
          searchInput.classList.add('has-query');
          if (searchClearBtn) searchClearBtn.style.display = 'flex';
        } else {
          searchInput.classList.remove('has-query');
          if (searchClearBtn) searchClearBtn.style.display = 'none';
        }
      }
    }
  }

  function toggleDuplicateFilter(forceState) {
    showDuplicatesOnly = typeof forceState === 'boolean' ? forceState : !showDuplicatesOnly;
    if (showDuplicatesOnly) {
      if (searchInput) {
        searchInput.value = '';
      }
      searchQuery = '';
      currentFilter = 'all';
      (filterChips || []).forEach((c) => {
        if (c.getAttribute && c.getAttribute('data-filter') === 'all') {
          c.classList.add('active');
        } else if (c.classList) {
          c.classList.remove('active');
        }
      });
    }
    updateSearchInputState();
    if (typeof document !== 'undefined') {
      renderCurrentView();
    }
  }

  // Initialisation des écouteurs et liaison DOM (exécuté en environnement Webview)
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    searchInput = document.getElementById('searchInput');
    filterChips = document.querySelectorAll('.chip-btn');
    btnRefresh = document.getElementById('btnRefresh');
    btnToggleDashboard = document.getElementById('btnToggleDashboard') || document.getElementById('btnOpenDashboard');
    searchClearBtn = document.getElementById('searchClearBtn');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      updateSearchInputState();
      renderCurrentView();
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        searchQuery = '';
        showDuplicatesOnly = false;
        updateSearchInputState();
        renderCurrentView();
      }
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      searchQuery = '';
      showDuplicatesOnly = false;
      updateSearchInputState();
      renderCurrentView();
    });
  }

  filterChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      filterChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.getAttribute('data-filter') || 'all';
      showDuplicatesOnly = false;
      updateSearchInputState();
      renderCurrentView();
    });
  });

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });
  }

  if (btnToggleDashboard) {
    btnToggleDashboard.addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleDashboard' });
    });
  }

  // Écouteurs pour les boutons bulk ON / OFF
  document.querySelectorAll('.bulk-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      const targetType = btn.getAttribute('data-type');
      const scope = btn.getAttribute('data-scope');
      const targetState = action === 'on';
      vscode.postMessage({
        type: 'bulkToggle',
        payload: { targetType, scope, targetState },
      });
    });
  });

  // Écouteurs pour l'entête de catégorie bulk (Bascule intelligente ON <-> OFF)
  document.querySelectorAll('.bulk-info').forEach((info) => {
    info.addEventListener('click', () => {
      const targetType = info.getAttribute('data-type');
      const scope = info.getAttribute('data-scope');
      vscode.postMessage({
        type: 'bulkToggle',
        payload: { targetType, scope },
      });
    });
  });

  // Écouteurs pour les pilules de sélection d'espace (CLAUDE / ANTIGRAVITY)
  document.querySelectorAll('.tool-pill').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetTool = btn.getAttribute('data-tool');
      if (targetTool) {
        vscode.postMessage({
          type: 'switchTool',
          payload: { tool: targetTool },
        });
      }
    });
  });

  const workspaceToolBadge = document.getElementById('workspaceToolBadge');
  if (workspaceToolBadge) {
    workspaceToolBadge.addEventListener('click', () => {
      vscode.postMessage({ type: 'switchTool' });
    });
  }

  const btnBrowseNas = document.getElementById('btnBrowseNasPath');
  if (btnBrowseNas) {
    btnBrowseNas.addEventListener('click', () => {
      vscode.postMessage({ type: 'browseNasPath' });
    });
  }

  const btnEditNas = document.getElementById('btnEditNasPath');
  if (btnEditNas) {
    btnEditNas.addEventListener('click', () => {
      vscode.postMessage({ type: 'editNasPath' });
    });
  }

  const sidebarNasPathText = document.getElementById('sidebarNasPathText');
  if (sidebarNasPathText) {
    sidebarNasPathText.addEventListener('click', () => {
      if (currentState && currentState.nasStatus && currentState.nasStatus.path) {
        vscode.postMessage({
          type: 'openInExplorer',
          payload: { path: currentState.nasStatus.path },
        });
      }
    });
  }

  // =========================================================================
  // Ouverture / Fermeture du Guide & Bonnes Pratiques IA (Cheat Sheet : openCheatSheet / toggleCheatSheet)
  // =========================================================================
  document.querySelectorAll('.btn-open-cheatsheet, #btnOpenCheatSheet').forEach((btn) => {
    btn.addEventListener('click', () => {
      const isWorkspaceClaude = currentState && currentState.workspace && currentState.workspace.tool === 'claude-code';
      const activeTool = selectedMiniCheatSheetTool || (isWorkspaceClaude ? 'claude-code' : 'antigravity');
      vscode.postMessage({
        type: 'toggleCheatSheet', // openCheatSheet / toggleCheatSheet
        payload: { defaultTab: activeTool },
      });
    });
  });

  // Écouteurs pour les pilules du mini-guide (Claude Code vs Antigravity)
  const pillClaude = document.getElementById('pillClaude');
  if (pillClaude) {
    pillClaude.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedMiniCheatSheetTool = 'claude-code';
      const isWorkspaceClaude = currentState && currentState.workspace && currentState.workspace.tool === 'claude-code';
      renderCheatSheetCard(isWorkspaceClaude);
    });
  }

  const pillAnti = document.getElementById('pillAntigravity');
  if (pillAnti) {
    pillAnti.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedMiniCheatSheetTool = 'antigravity';
      const isWorkspaceClaude = currentState && currentState.workspace && currentState.workspace.tool === 'claude-code';
      renderCheatSheetCard(isWorkspaceClaude);
    });
  }

  // =========================================================================
  // Banc d'Essai & Scénarios de Test (Fixtures)
  // =========================================================================
  const btnDeployAgy = document.getElementById('btnDeployAntigravity');
  if (btnDeployAgy) {
    btnDeployAgy.addEventListener('click', () => {
      vscode.postMessage({
        type: 'deployScenario',
        payload: { target: 'antigravity' },
      });
    });
  }

  const btnDeployClaude = document.getElementById('btnDeployClaude');
  if (btnDeployClaude) {
    btnDeployClaude.addEventListener('click', () => {
      vscode.postMessage({
        type: 'deployScenario',
        payload: { target: 'claude-code' },
      });
    });
  }

  const btnDeployAll = document.getElementById('btnDeployAll');
  if (btnDeployAll) {
    btnDeployAll.addEventListener('click', () => {
      vscode.postMessage({
        type: 'deployScenario',
        payload: { target: 'all' },
      });
    });
  }

  const btnCleanScenarios = document.getElementById('btnCleanScenarios');
  if (btnCleanScenarios) {
    btnCleanScenarios.addEventListener('click', () => {
      vscode.postMessage({
        type: 'cleanScenarios',
      });
    });
  }

  // =========================================================================
  // Contrôle Chronomètre & Diagnostic Anti-Lag (Banc d'Essai)
  // =========================================================================
  const btnToggleDebugTiming = document.getElementById('btnToggleDebugTiming');
  if (btnToggleDebugTiming) {
    btnToggleDebugTiming.addEventListener('click', () => {
      const isCurrentlyOn = btnToggleDebugTiming.classList.contains('status-on');
      vscode.postMessage({
        type: 'toggleDebugTiming',
        payload: { enabled: !isCurrentlyOn },
      });
    });
  }

  const btnClearTimingLogs = document.getElementById('btnClearTimingLogs');
  if (btnClearTimingLogs) {
    btnClearTimingLogs.addEventListener('click', () => {
      vscode.postMessage({
        type: 'clearTimingLogs',
      });
    });
  }

  // Écoute des messages de l'extension
  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'stateUpdate':
        currentState = message.payload;
        renderCurrentView();
        break;
      case 'toggleResult':
        if (!message.payload.success) {
          vscode.postMessage({ type: 'refresh' });
        }
        break;
      case 'importResult':
        vscode.postMessage({ type: 'refresh' });
        break;
    }
  });

  // Notifier l'extension que la Webview est prête
  vscode.postMessage({ type: 'ready' });
  }

  // Rendu de la vue (sidebar ou dashboard)
  function renderCurrentView() {
    if (!currentState) return;

    renderHeaderStats(currentState);
    renderTimingConsole(currentState);

    const isDashboard = document.getElementById('columnNas') !== null;
    if (isDashboard) {
      renderDashboard(currentState);
    } else {
      renderSidebar(currentState);
    }
  }

  function renderTimingConsole(state) {
    const btnToggle = document.getElementById('btnToggleDebugTiming');
    const toggleText = document.getElementById('timingToggleText');
    const wrapper = document.getElementById('timingConsoleWrapper');
    const output = document.getElementById('timingConsoleOutput');

    if (!btnToggle || !wrapper || !output) return;

    const isEnabled = !!state?.isDebugTiming;

    if (isEnabled) {
      btnToggle.className = 'timing-toggle-pill status-on';
      if (toggleText) toggleText.textContent = 'ON';
      wrapper.style.display = 'flex';

      const history = state.timingHistory || (state.lastTimingLog ? [state.lastTimingLog] : []);
      if (history.length === 0) {
        output.innerHTML = '<span class="timing-empty">En attente d\'un scan...</span>';
      } else {
        output.innerHTML = history
          .map((line) => {
            const formatted = escapeHtml(line)
              .replace(/(\d+\s*ms)/g, '<span class="timing-highlight-ms">$1</span>')
              .replace(/(\d+\s*servis du cache)/g, '<span class="timing-highlight-cache">$1</span>')
              .replace(/(\d+\s*encodés)/g, '<span class="timing-highlight-enc">$1</span>');
            return `<span class="timing-line">&gt; ${formatted}</span>`;
          })
          .join('');

        const body = document.getElementById('timingConsoleBody');
        if (body) {
          body.scrollTop = body.scrollHeight;
        }
      }
    } else {
      btnToggle.className = 'timing-toggle-pill status-off';
      if (toggleText) toggleText.textContent = 'OFF';
      wrapper.style.display = 'none';
    }
  }

  function renderCheatSheetCard(isWorkspaceClaude) {
    const activeTool = selectedMiniCheatSheetTool || (isWorkspaceClaude ? 'claude-code' : 'antigravity');
    const isClaude = activeTool === 'claude-code';

    const claudeSummaryHtml = `
      <ul class="cheat-sheet-list">
        <li><span class="cs-icon">📏</span><span><strong>Tailles max :</strong> Âme &amp; Règles &lt; 200 li. • Skills &lt; 500 li. • MCP &le; 2 048 car./outil</span></li>
        <li><span class="cs-icon">⚡</span><span><strong>Âme (CLAUDE.md) :</strong> Injecté au boot (relu si /compact) • Sous-dossiers supportés</span></li>
        <li><span class="cs-icon">🎯</span><span><strong>Règles :</strong> Sans <code>paths</code> = permanent • Avec <code>paths</code> = ciblé à la demande</span></li>
        <li><span class="cs-icon">🧠</span><span><strong>Skills :</strong> Sans paths = à la demande / slash • Avec paths = auto-chargé sur fichiers</span></li>
        <li><span class="cs-icon">🔌</span><span><strong>MCP :</strong> Troncature stricte à 2 048 car. par outil et par instruction</span></li>
      </ul>
    `;

    const antigravitySummaryHtml = `
      <ul class="cheat-sheet-list">
        <li><span class="cs-icon">📏</span><span><strong>Tailles :</strong> Âme &amp; règles permanentes &lt; 200 li. • Règles <code>glob</code> &lt; 30 li. • Skills &lt; 500 li. • Plafond 24 Ko par fichier</span></li>
        <li><span class="cs-icon">⚡</span><span><strong>Âme (GEMINI.md / AGENTS.md) :</strong> 100 % à chaque tour • Dossiers parents chargés, sous-dossiers jamais</span></li>
        <li><span class="cs-icon">🎯</span><span><strong>Règles :</strong> <code>trigger</code> obligatoire • Budget de 20 000 tokens partagé avec l'Âme • <code>glob</code> : nom de fichier seul, réinjectée à chaque lecture ou modification</span></li>
        <li><span class="cs-icon">🧠</span><span><strong>Skills :</strong> Une ligne par skill au démarrage (nom, chemin, description) • Corps lu à la demande</span></li>
        <li><span class="cs-icon">🔌</span><span><strong>MCP &amp; Plugins :</strong> Noms des outils MCP seuls au démarrage • Skills de plugin listés deux fois, sans préfixe</span></li>
        <li><span class="cs-icon">⏹️</span><span><strong>Workflows :</strong> Hors service depuis le 19 octobre 2026 • Migrer vers des skills</span></li>
        <li><span class="cs-icon">🏛️</span><span><strong>Hiérarchie :</strong> N0 (Global) → N1 (Projet) → N2 (PC) → N3 (NAS)</span></li>
      </ul>
    `;

    // Mise à jour visuelle des pilules actives
    const pClaude = document.getElementById('pillClaude');
    const pAnti = document.getElementById('pillAntigravity');
    if (pClaude) {
      if (isClaude) {
        pClaude.classList.add('active');
      } else {
        pClaude.classList.remove('active');
      }
    }
    if (pAnti) {
      if (!isClaude) {
        pAnti.classList.add('active');
      } else {
        pAnti.classList.remove('active');
      }
    }

    const summaryEl = document.getElementById('cheatSheetSummary');
    const badgeEl = document.getElementById('cheatSheetBadge');
    if (summaryEl) {
      summaryEl.innerHTML = isClaude ? claudeSummaryHtml : antigravitySummaryHtml;
    }
    if (badgeEl) {
      badgeEl.textContent = isClaude ? 'Claude Code' : 'Antigravity';
      badgeEl.className = isClaude ? 'badge badge-claude' : 'badge badge-antigravity';
    }
  }

  function renderHeaderStats(state) {
    const isClaude = state.workspace && state.workspace.tool === 'claude-code';

    // Mise à jour visuelle des pilules actives CLAUDE / ANTIGRAVITY
    document.querySelectorAll('.tool-pill-claude').forEach((el) => {
      if (isClaude) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    document.querySelectorAll('.tool-pill-antigravity').forEach((el) => {
      if (!isClaude) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    const toolBadge = document.getElementById('workspaceToolBadge');
    if (toolBadge) {
      toolBadge.textContent = isClaude ? 'Claude Code Workspace' : 'Antigravity Workspace';
      toolBadge.className = isClaude ? 'badge badge-claude' : 'badge badge-antigravity';
      toolBadge.title = isClaude
        ? 'Mode actif : Claude Code (VS Code). Cliquez pour basculer vers Antigravity.'
        : 'Mode actif : Antigravity (Gemini). Cliquez pour basculer vers Claude Code.';
    }

    renderCheatSheetCard(isClaude);

    // Gestion du statut et chemin Catalogue (NAS) dans la sidebar
    const sidebarNasPathEl = document.getElementById('sidebarNasPathText');
    const sidebarNasBadgeEl = document.getElementById('sidebarNasStatusBadge');
    if (sidebarNasPathEl && state.nasStatus) {
      sidebarNasPathEl.textContent = state.nasStatus.path;
      sidebarNasPathEl.title = `Chemin actuel du catalogue source :\n${state.nasStatus.path}`;
    }
    if (sidebarNasBadgeEl && state.nasStatus) {
      if (state.nasStatus.online) {
        sidebarNasBadgeEl.className = 'badge-nas-indicator status-online';
        sidebarNasBadgeEl.textContent = '● En ligne';
        sidebarNasBadgeEl.title = 'Catalogue NAS connecté et accessible';
      } else {
        sidebarNasBadgeEl.className = 'badge-nas-indicator status-offline';
        sidebarNasBadgeEl.textContent = '● Hors ligne';
        sidebarNasBadgeEl.title = `NAS inaccessible : ${state.nasStatus.error || 'Délai d\'attente dépassé'}`;
      }
    }

    // Gestion de l'état du Bouton Toggle Dashboard (Ouvrir / Fermer)
    const btnToggle = document.getElementById('btnToggleDashboard') || document.getElementById('btnOpenDashboard');
    if (btnToggle) {
      if (state.isDashboardOpen) {
        btnToggle.className = 'btn btn-dashboard-toggle btn-open';
        btnToggle.innerHTML = '<span>✕ Fermer le Grand Dashboard</span>';
      } else {
        btnToggle.className = 'btn btn-cta';
        btnToggle.innerHTML = '<span>🗂️ Ouvrir le Grand Dashboard</span>';
      }
    }

    // Gestion de l'état du Bouton Toggle Guide Complet (Ouvrir / Fermer)
    ['btnOpenCheatSheet', 'btnOpenCheatSheetDash'].forEach((btnId) => {
      const btn = document.getElementById(btnId);
      if (btn) {
        if (state.isCheatSheetOpen) {
          btn.className = 'btn btn-secondary btn-cheat-sheet btn-open-cheatsheet btn-cheatsheet-toggle btn-open';
          btn.innerHTML = '<span>✕ Fermer le Guide Complet</span>';
          btn.title = 'Fermer l\'onglet du Guide Complet';
        } else {
          btn.className = 'btn btn-secondary btn-cheat-sheet btn-open-cheatsheet';
          btn.innerHTML = '<span>📖 Ouvrir le Guide Complet</span>';
          btn.title = 'Ouvrir le guide complet dans un onglet à droite';
        }
      }
    });

    if (state.stats) {
      const stats = state.stats;

      const budget = stats.budgetTotal || 20000;
      const usedTokens = stats.usedTokensTotal || 0;
      const usedPct = Number(((usedTokens / budget) * 100).toFixed(1));
      const availPct = stats.availablePercentage !== undefined
        ? stats.availablePercentage
        : Number(Math.max(0, 100 - usedPct).toFixed(1));

      // Échelle globale : fenêtre de session 1M
      const windowTokens = 1000000;
      const windowPct = Number(((usedTokens / windowTokens) * 100).toFixed(1));

      // 1. Pilule d'échelle globale (Dashboard & Sidebar)
      const pillDash = document.getElementById('tokenPillContext');
      if (pillDash) {
        pillDash.textContent = `🌐 ${windowPct}% de la fenêtre 1M`;
        pillDash.title = `Empreinte fixe de démarrage : ${usedTokens.toLocaleString()} tokens sur 1 000 000 tokens de capacité totale (${windowPct}% utilisé). Le budget de 20 000 tokens est le seuil d'hygiène conseillé pour préserver la vitesse et l'attention de l'IA.`;
      }
      const pillSide = document.getElementById('tokenPillContextSide');
      if (pillSide) {
        pillSide.textContent = `🌐 ${windowPct}% de 1M`;
        pillSide.title = `Empreinte de démarrage : ${usedTokens.toLocaleString()} tokens sur 1 000 000 tokens (${windowPct}% de la fenêtre).`;
      }

      // 1.B. Pilules d'alerte des doublons actifs (Dashboard & Sidebar)
      const dupStats = stats.duplicateStats;
      const hasActiveDuplicates = dupStats && dupStats.activeDuplicates > 0;
      const dupPillDash = document.getElementById('duplicateWarningPill');
      const dupPillSide = document.getElementById('duplicateWarningPillSide');

      if (!hasActiveDuplicates && showDuplicatesOnly) {
        showDuplicatesOnly = false;
        updateSearchInputState();
      }

      const dupText = hasActiveDuplicates
        ? `🔥 ${dupStats.activeDuplicates} doublon${dupStats.activeDuplicates > 1 ? 's' : ''} actif${dupStats.activeDuplicates > 1 ? 's' : ''} (+${dupStats.totalWastedTokens.toLocaleString('fr-FR')} tok gaspillés)`
        : '';
      const dupTitle = hasActiveDuplicates
        ? `⚠️ Alerte Redondance :\n${dupStats.activeDuplicates} ressource(s) activée(s) à la fois en Global et en Local.\nElles consomment ${dupStats.totalWastedTokens.toLocaleString('fr-FR')} tokens en double au démarrage.\n${showDuplicatesOnly ? 'Cliquez pour désactiver le filtre et afficher toutes les ressources.' : 'Cliquez pour afficher uniquement les doublons actifs (toutes les paires).'}`
        : '';

      [dupPillDash, dupPillSide].forEach((pill) => {
        if (pill) {
          if (hasActiveDuplicates) {
            pill.style.display = 'inline-flex';
            pill.textContent = dupText;
            pill.title = dupTitle;
            pill.classList.toggle('is-active', showDuplicatesOnly);
            pill.onclick = (e) => {
              e.stopPropagation();
              toggleDuplicateFilter();
            };
          } else {
            pill.style.display = 'none';
            pill.classList.remove('is-active');
            pill.onclick = null;
          }
        }
      });

      // 2. Helper d'application des classes couleur (vert > 25%, ambré 10-25%, rouge < 10%)
      const applyThresholdClass = (el, pct) => {
        if (!el) return;
        el.classList.remove('pct-normal', 'pct-warning', 'pct-critical');
        if (pct > 25) {
          el.classList.add('pct-normal');
        } else if (pct >= 10) {
          el.classList.add('pct-warning');
        } else {
          el.classList.add('pct-critical');
        }
      };

      // 3. Mise à jour Dashboard (utilisé 74.4% | disponible 25.6%)
      const usedElDash = document.getElementById('tokenUsedPercent');
      const availElDash = document.getElementById('tokenAvailablePercent');
      if (usedElDash) {
        usedElDash.textContent = `${usedPct}%`;
        applyThresholdClass(usedElDash, availPct);
      }
      if (availElDash) {
        if (availPct < 10) {
          availElDash.textContent = `🚨 ${availPct}%`;
        } else if (availPct <= 25) {
          availElDash.textContent = `⚠️ ${availPct}%`;
        } else {
          availElDash.textContent = `${availPct}%`;
        }
        applyThresholdClass(availElDash, availPct);
      }

      // 4. Mise à jour Sidebar (74% | 26% dispo)
      const usedElSide = document.getElementById('tokenUsedPercentSide');
      const availElSide = document.getElementById('tokenAvailablePercentSide');
      if (usedElSide) {
        usedElSide.textContent = `${Math.round(usedPct)}%`;
        applyThresholdClass(usedElSide, availPct);
      }
      if (availElSide) {
        availElSide.textContent = `${Math.round(availPct)}%`;
        applyThresholdClass(availElSide, availPct);
      }

      // Mise à jour de la lueur / bordure d'alerte de la jauge (Stacked Bar)
      document.querySelectorAll('.stacked-progress-track').forEach((track) => {
        track.classList.remove('gauge-warning', 'gauge-critical');
        const pct = stats.availablePercentage;
        if (pct < 10) {
          track.classList.add('gauge-critical');
        } else if (pct <= 25) {
          track.classList.add('gauge-warning');
        }
      });

      // Mise à jour de la barre segmentée (Stacked Bar)
      setSegmentWidth('barSoulGlobal', stats.soulGlobal ? stats.soulGlobal.percentage : 0);
      setSegmentWidth('barSoulLocal', stats.soulLocal ? stats.soulLocal.percentage : 0);
      setSegmentWidth('barRuleGlobal', stats.rulesGlobal ? stats.rulesGlobal.percentage : 0);
      setSegmentWidth('barRuleLocal', stats.rulesLocal ? stats.rulesLocal.percentage : 0);
      // Antigravity : skills et MCP relèvent d'un budget de personnalisation distinct du budget des règles
      const excludesPersonalization = stats.budgetExcludesPersonalization === true;
      setSegmentWidth('barSkillGlobal', !excludesPersonalization && stats.skillsGlobal ? stats.skillsGlobal.percentage : 0);
      setSegmentWidth('barSkillLocal', !excludesPersonalization && stats.skillsLocal ? stats.skillsLocal.percentage : 0);
      setSegmentWidth('barMcpGlobal', !excludesPersonalization && stats.mcpGlobal ? stats.mcpGlobal.percentage : 0);
      setSegmentWidth('barMcpLocal', !excludesPersonalization && stats.mcpLocal ? stats.mcpLocal.percentage : 0);

      // Mise à jour des lignes de détail de la légende (titre avec nombre actif entre parenthèses)
      updateBreakdownRow('SoulGlobal', stats.soulGlobal, 'Âme (global)');
      updateBreakdownRow('SoulLocal', stats.soulLocal, 'Âme (local)');
      updateBreakdownRow('RuleGlobal', stats.rulesGlobal, 'Rules (global)');
      updateBreakdownRow('RuleLocal', stats.rulesLocal, 'Rules (local)');
      updateBreakdownRow('SkillGlobal', stats.skillsGlobal, 'Skills (global)');
      updateBreakdownRow('SkillLocal', stats.skillsLocal, 'Skills (local)');
      updateBreakdownRow('McpGlobal', stats.mcpGlobal, 'MCP (global)');
      updateBreakdownRow('McpLocal', stats.mcpLocal, 'MCP (local)');

      // Colonne 3 : Total Contexte (Global + Local)
      const soulTotalCount = (stats.soulGlobal ? stats.soulGlobal.activeCount : 0) + (stats.soulLocal ? stats.soulLocal.activeCount : 0);
      const soulTotalTokens = (stats.soulGlobal ? stats.soulGlobal.tokenCount : 0) + (stats.soulLocal ? stats.soulLocal.tokenCount : 0);
      const soulTotalChars = (stats.soulGlobal ? stats.soulGlobal.charCount : 0) + (stats.soulLocal ? stats.soulLocal.charCount : 0);
      const soulTotalWarn = (stats.soulGlobal?.warningCount || 0) + (stats.soulLocal?.warningCount || 0);
      const soulTotalPct = Number(((soulTotalTokens / budget) * 100).toFixed(1));
      updateBreakdownRow('SoulTotal', {
        type: 'soul',
        scope: 'global',
        activeCount: soulTotalCount,
        totalCount: soulTotalCount,
        charCount: soulTotalChars,
        tokenCount: soulTotalTokens,
        warningCount: soulTotalWarn,
        percentage: soulTotalPct,
        directoryPath: 'Cumul Global + Local',
      }, 'Âme (total)');

      const ruleTotalCount = (stats.rulesGlobal ? stats.rulesGlobal.activeCount : 0) + (stats.rulesLocal ? stats.rulesLocal.activeCount : 0);
      const ruleTotalTokens = (stats.rulesGlobal ? stats.rulesGlobal.tokenCount : 0) + (stats.rulesLocal ? stats.rulesLocal.tokenCount : 0);
      const ruleTotalChars = (stats.rulesGlobal ? stats.rulesGlobal.charCount : 0) + (stats.rulesLocal ? stats.rulesLocal.charCount : 0);
      const ruleTotalPct = Number(((ruleTotalTokens / budget) * 100).toFixed(1));
      const ruleTotalPerm = (stats.rulesGlobal?.permanentCount || 0) + (stats.rulesLocal?.permanentCount || 0);
      const ruleTotalCond = (stats.rulesGlobal?.conditionalCount || 0) + (stats.rulesLocal?.conditionalCount || 0);
      const ruleTotalCondTokens = (stats.rulesGlobal?.conditionalTokenCount || 0) + (stats.rulesLocal?.conditionalTokenCount || 0);
      const ruleTotalWarn = (stats.rulesGlobal?.warningCount || 0) + (stats.rulesLocal?.warningCount || 0);

      updateBreakdownRow('RuleTotal', {
        type: 'rule',
        scope: 'global',
        activeCount: ruleTotalCount,
        totalCount: ruleTotalCount,
        permanentCount: ruleTotalPerm,
        conditionalCount: ruleTotalCond,
        conditionalTokenCount: ruleTotalCondTokens,
        charCount: ruleTotalChars,
        tokenCount: ruleTotalTokens,
        warningCount: ruleTotalWarn,
        percentage: ruleTotalPct,
        directoryPath: 'Cumul Global + Local',
      }, 'Rules (total)');

      const skillTotalCount = (stats.skillsGlobal ? stats.skillsGlobal.activeCount : 0) + (stats.skillsLocal ? stats.skillsLocal.activeCount : 0);
      const skillTotalTokens = (stats.skillsGlobal ? stats.skillsGlobal.tokenCount : 0) + (stats.skillsLocal ? stats.skillsLocal.tokenCount : 0);
      const skillTotalChars = (stats.skillsGlobal ? stats.skillsGlobal.charCount : 0) + (stats.skillsLocal ? stats.skillsLocal.charCount : 0);
      const skillTotalWarn = (stats.skillsGlobal?.warningCount || 0) + (stats.skillsLocal?.warningCount || 0);
      const skillTotalPct = Number(((skillTotalTokens / budget) * 100).toFixed(1));
      updateBreakdownRow('SkillTotal', {
        type: 'skill',
        scope: 'global',
        activeCount: skillTotalCount,
        totalCount: skillTotalCount,
        charCount: skillTotalChars,
        tokenCount: skillTotalTokens,
        warningCount: skillTotalWarn,
        percentage: skillTotalPct,
        directoryPath: 'Cumul Global + Local',
      }, 'Skills (total)');

      const mcpTotalCount = (stats.mcpGlobal ? stats.mcpGlobal.activeCount : 0) + (stats.mcpLocal ? stats.mcpLocal.activeCount : 0);
      const mcpTotalTokens = (stats.mcpGlobal ? stats.mcpGlobal.tokenCount : 0) + (stats.mcpLocal ? stats.mcpLocal.tokenCount : 0);
      const mcpTotalChars = (stats.mcpGlobal ? stats.mcpGlobal.charCount : 0) + (stats.mcpLocal ? stats.mcpLocal.charCount : 0);
      const mcpTotalWarn = (stats.mcpGlobal?.warningCount || 0) + (stats.mcpLocal?.warningCount || 0);
      const mcpTotalPct = Number(((mcpTotalTokens / budget) * 100).toFixed(1));
      updateBreakdownRow('McpTotal', {
        type: 'mcp',
        scope: 'global',
        activeCount: mcpTotalCount,
        totalCount: mcpTotalCount,
        charCount: mcpTotalChars,
        tokenCount: mcpTotalTokens,
        warningCount: mcpTotalWarn,
        percentage: mcpTotalPct,
        directoryPath: 'Cumul Global + Local',
      }, 'MCP (total)');

      // Résumé total
      const totalSummaryEl = document.getElementById('tokenTotalSummary');
      if (totalSummaryEl) {
        const usedTokens = stats.usedTokensTotal;
        const usedPct = ((usedTokens / budget) * 100).toFixed(1);
        const dupNotice = (dupStats && dupStats.activeDuplicates > 0)
          ? ` • <span style="color: #fca5a5; font-weight: 700;">⚠️ ${dupStats.totalWastedTokens.toLocaleString('fr-FR')} tokens gaspillés en doublons</span>`
          : '';
        const personalizationNotice = excludesPersonalization
          ? ` • Skills et MCP : ${(skillTotalTokens + mcpTotalTokens).toLocaleString()} tokens, hors budget des règles (budget de personnalisation distinct)`
          : '';
        const totalLabel = excludesPersonalization ? 'Budget des règles (âme comprise)' : 'Total utilisé';
        totalSummaryEl.innerHTML = `${totalLabel} : ${usedTokens.toLocaleString()} / ${budget.toLocaleString()} tokens (${usedPct}%)${personalizationNotice}${dupNotice}`;
      }
    }
  }

  function setSegmentWidth(elementId, percentage) {
    const el = document.getElementById(elementId);
    if (el) {
      el.style.width = `${Math.max(0, percentage)}%`;
    }
  }

  function updateBreakdownRow(prefix, stat, defaultTitle) {
    if (!stat) return;

    const rowEl = document.getElementById(`row${prefix}`);
    const titleEl = document.getElementById(`title${prefix}`);
    const valEl = document.getElementById(`val${prefix}`);
    const tooltipEl = document.getElementById(`tooltip${prefix}`);

    if (titleEl) {
      const warnSuffix = (stat.warningCount && stat.warningCount > 0) ? ' ⚠️' : '';
      if (stat.type === 'rule' && stat.conditionalCount && stat.conditionalCount > 0) {
        titleEl.textContent = `${defaultTitle} (${stat.permanentCount || 0} perm. + ${stat.conditionalCount} cond.)${warnSuffix}`;
      } else {
        titleEl.textContent = `${defaultTitle} (${stat.activeCount})${warnSuffix}`;
      }
    }

    const outsideRulesBudget = (stat.type === 'skill' || stat.type === 'mcp') &&
      currentState?.stats?.budgetExcludesPersonalization === true;

    if (valEl) {
      valEl.textContent = outsideRulesBudget
        ? `${stat.tokenCount.toLocaleString()} tok (hors budget des règles)`
        : `${stat.tokenCount.toLocaleString()} tok (${stat.percentage}%)`;
    }

    if (tooltipEl) {
      const isClaude = currentState?.workspace?.tool === 'claude-code';
      const warningNote = (stat.warningCount && stat.warningCount > 0)
        ? `\n\n⚠️ ${stat.warningCount} ressource(s) dépassent les recommandations techniques dans cette catégorie (voir badges sur les cartes).`
        : '';

      if (prefix.endsWith('Total')) {
        let extraInfo = '';
        if (stat.type === 'rule' && stat.conditionalCount && stat.conditionalCount > 0) {
          extraInfo = `\n• Répartition : ${stat.permanentCount || 0} permanente(s) (${stat.tokenCount.toLocaleString()} tok au boot) + ${stat.conditionalCount} conditionnelle(s) (~20 tok au boot, +${stat.conditionalTokenCount?.toLocaleString()} tok si déclenchée(s))`;
        }
        tooltipEl.textContent =
          `📊 ${defaultTitle} (Cumul Global + Local) :\n` +
          (outsideRulesBudget
            ? `• Tokens : ${stat.tokenCount.toLocaleString()} tok, hors budget de 20 000 tokens des règles (budget de personnalisation distinct, non chiffré par la documentation d'Antigravity)\n`
            : `• Tokens au Boot : ${stat.tokenCount.toLocaleString()} tok (${stat.percentage}% du budget)\n`) +
          `• Caractères : ${stat.charCount.toLocaleString()} caractères` +
          extraInfo +
          `\nℹ️ Estimation des tokens (BPE o200k / repli 1 tok ≈ 4 car.)` +
          warningNote;
      } else if (prefix === 'SoulGlobal') {
        tooltipEl.textContent = (isClaude
          ? `🛡️ Âme Globale (Claude Code) :\n${stat.directoryPath || '~/.claude/CLAUDE.md'}\n\n📊 Taille réelle : ${stat.charCount.toLocaleString()} caractères (${stat.tokenCount.toLocaleString()} tokens)\nℹ️ Instructions globales injectées systématiquement à chaque invite`
          : `🛡️ Âme Globale (Gemini - Niveau 0) :\n${stat.directoryPath || '~/.gemini/GEMINI.md'}\n\n📊 Taille réelle : ${stat.charCount.toLocaleString()} caractères (${stat.tokenCount.toLocaleString()} tokens)\nℹ️ Cadre général inviolable et lois fondamentales du système`) + warningNote;
      } else if (prefix === 'SoulLocal') {
        tooltipEl.textContent = (isClaude
          ? `🛡️ Âme Locale (Claude Code - Projet) :\n${stat.directoryPath || './CLAUDE.md'}\n\n📊 Taille réelle : ${stat.charCount.toLocaleString()} caractères (${stat.tokenCount.toLocaleString()} tokens)\nℹ️ Instructions spécifiques au projet actif`
          : `🛡️ Âme Locale (Gemini - Projet Actuel) :\n${stat.directoryPath || './GEMINI.md'}\n\n📊 Taille réelle : ${stat.charCount.toLocaleString()} caractères (${stat.tokenCount.toLocaleString()} tokens)\nℹ️ Instructions et contexte prioritaires du projet`) + warningNote;
      } else if (stat.type === 'rule' && stat.conditionalCount && stat.conditionalCount > 0) {
        tooltipEl.textContent =
          `📁 Emplacement :\n${stat.directoryPath || 'Non défini'}\n\n` +
          `📊 Tokens au Boot : ${stat.tokenCount.toLocaleString()} tok (${stat.percentage}% du budget)\n` +
          `• Règles permanentes : ${stat.permanentCount || 0}\n` +
          `• Règles conditionnelles : ${stat.conditionalCount} (~20 tok au boot, +${stat.conditionalTokenCount?.toLocaleString()} tok à l'activation)\n` +
          `ℹ️ Estimation des tokens (BPE o200k / repli 1 tok ≈ 4 car.)` +
          warningNote;
      } else {
        tooltipEl.textContent =
          `📁 Emplacement :\n${stat.directoryPath || 'Non défini'}\n\n` +
          `📊 Taille réelle : ${stat.charCount.toLocaleString()} caractères (${stat.tokenCount.toLocaleString()} tokens)\n` +
          `ℹ️ Estimation des tokens (BPE o200k / repli 1 tok ≈ 4 car.)` +
          warningNote;
      }
    }

    if (rowEl) {
      rowEl.style.opacity = '1';
      if (stat.activeCount === 0) {
        rowEl.classList.add('is-inactive');
      } else {
        rowEl.classList.remove('is-inactive');
      }
    }
  }

  function renderSidebar(state) {
    const listContainer = document.getElementById('sidebarItemsList');
    if (!listContainer) return;

    // Concaténer local et global pour un aperçu rapide
    const allItems = [...state.localResources, ...state.globalResources];
    const filtered = filterItems(allItems);
    const sorted = sortItemsWithPinnedSoul(filtered);

    if (sorted.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <div>Aucune ressource trouvée</div>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = '';
    sorted.forEach((item) => {
      const card = createItemCard(item, false);
      listContainer.appendChild(card);
    });
  }

  function renderDashboard(state) {
    const isClaude = state.workspace && state.workspace.tool === 'claude-code';

    // 1. Colonne NAS
    const nasContainer = document.getElementById('nasItemsList');
    const nasStatusBanner = document.getElementById('nasStatusBanner');
    const nasPathEl = document.getElementById('nasPathLabel');
    const nasCountBadge = document.getElementById('nasCountBadge');

    const nasRulesCount = (state.nasResources || []).filter((i) => i.type === 'rule').length;
    const nasSkillsCount = (state.nasResources || []).filter((i) => i.type === 'skill' || i.type === 'workflow').length;
    const nasSoulCount = (state.nasResources || []).filter((i) => i.type === 'soul' || (i.metadata && i.metadata.isSoul)).length;

    const baseNas = state.nasStatus ? state.nasStatus.path : '\\\\Nas1\\DD2\\IA\\Antigravity-Templates';
    const nasSoulItem = (state.nasResources || []).find((i) => i.type === 'soul' || (i.metadata && i.metadata.isSoul));
    const nasSoulPath = nasSoulItem ? nasSoulItem.path : `${baseNas}\\${isClaude ? 'CLAUDE.md' : 'GEMINI.md'}`;
    const nasSoulLabel = nasSoulItem ? nasSoulItem.name : (isClaude ? 'CLAUDE.md' : 'GEMINI.md');

    const nasPathItems = [];
    if (currentFilter === 'all') {
      if (nasSoulCount > 0) {
        nasPathItems.push({ label: `${nasSoulLabel} (Source Maître)`, fullPath: nasSoulPath, icon: '🏛️', count: nasSoulCount });
      }
      nasPathItems.push({ label: `${baseNas}\\rules\\`, fullPath: `${baseNas}\\rules`, icon: '📁', count: nasRulesCount });
      nasPathItems.push({ label: `${baseNas}\\skills\\`, fullPath: `${baseNas}\\skills`, icon: '📁', count: nasSkillsCount });
    } else if (currentFilter === 'rule') {
      nasPathItems.push({ label: `${baseNas}\\rules\\`, fullPath: `${baseNas}\\rules`, icon: '📁', count: nasRulesCount });
    } else if (currentFilter === 'skill' || currentFilter === 'workflow') {
      nasPathItems.push({ label: `${baseNas}\\skills\\`, fullPath: `${baseNas}\\skills`, icon: '📁', count: nasSkillsCount });
    } else if (currentFilter === 'soul') {
      nasPathItems.push({ label: `${nasSoulLabel} (Source Maître)`, fullPath: nasSoulPath, icon: '🏛️', count: nasSoulCount || undefined });
    }
    renderColumnPath(nasPathEl, nasPathItems);

    if (nasStatusBanner) {
      if (state.nasStatus && !state.nasStatus.online) {
        nasStatusBanner.style.display = 'flex';
        const errMsg = state.nasStatus.error || 'Inaccessible';
        const isUncBlocked = errMsg.includes('UNC host') || errMsg.includes('not allowed');

        if (isUncBlocked) {
          nasStatusBanner.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 6px; flex-wrap: wrap;">
              <span>⚠️ Hôte NAS bloqué par la sécurité VS Code</span>
              <button id="btnAllowUncHost" class="btn btn-primary btn-xs" style="background: #2563eb; color: #fff; padding: 2px 8px; font-weight: 600; cursor: pointer; border-radius: 4px; border: none;" title="Autoriser l'hôte UNC dans la sécurité VS Code">
                🔓 Débloquer dans VS Code
              </button>
            </div>
          `;
          const btnAllow = document.getElementById('btnAllowUncHost');
          if (btnAllow) {
            btnAllow.addEventListener('click', (e) => {
              e.stopPropagation();
              vscode.postMessage({
                type: 'allowUncHost',
                payload: { path: state.nasStatus.path },
              });
            });
          }
        } else {
          nasStatusBanner.innerHTML = `⚠️ NAS Hors Ligne (${escapeHtml(errMsg)})`;
        }
      } else {
        nasStatusBanner.style.display = 'none';
      }
    }

    if (nasContainer) {
      nasContainer.innerHTML = '';
      if (!state.nasStatus || !state.nasStatus.online) {
        if (nasCountBadge) nasCountBadge.textContent = '0 items';
        nasContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">🔌</div>
            <div>NAS inaccessible pour le moment</div>
          </div>
        `;
      } else {
        const totalNas = (state.nasResources || []).length;
        const filteredNas = filterItems(state.nasResources);
        const sortedNas = sortItemsWithPinnedSoul(filteredNas);
        const isFiltered = !!searchQuery || currentFilter !== 'all' || showDuplicatesOnly;

        if (nasCountBadge) {
          nasCountBadge.textContent = isFiltered ? `${sortedNas.length} / ${totalNas} filtré` : `${totalNas} items`;
          nasCountBadge.classList.toggle('is-filtered', isFiltered && sortedNas.length < totalNas);
        }
        if (sortedNas.length === 0) {
          nasContainer.innerHTML = `<div class="empty-state">Aucun élément correspondant</div>`;
        } else {
          sortedNas.forEach((item) => {
            const card = createItemCard(item, true);
            nasContainer.appendChild(card);
          });
        }
      }
    }

    // 2. Colonne Global (Machine)
    const globalContainer = document.getElementById('globalItemsList');
    const globalCountEl = document.getElementById('globalCountBadge');
    const globalPathEl = document.getElementById('globalPathLabel');

    const globalRulesCount = (state.globalResources || []).filter((i) => i.type === 'rule').length;
    const globalSkillsCount = (state.globalResources || []).filter((i) => i.type === 'skill' || i.type === 'workflow').length;
    const globalSoulCount = (state.globalResources || []).filter((i) => i.type === 'soul' || (i.metadata && i.metadata.isSoul)).length;

    const userHome = (state.userHome || '~').replace(/\\/g, '/');
    const globalSoulPath = (state.stats && state.stats.soulGlobal && state.stats.soulGlobal.directoryPath)
      ? state.stats.soulGlobal.directoryPath
      : (isClaude ? `${userHome}/.claude/CLAUDE.md` : `${userHome}/.gemini/GEMINI.md`);

    const globalRulesPath = (state.stats && state.stats.rulesGlobal && state.stats.rulesGlobal.directoryPath)
      ? state.stats.rulesGlobal.directoryPath
      : (isClaude ? `${userHome}/.claude/rules` : `${userHome}/.gemini/config/rules`);

    const globalSkillsPath = (state.stats && state.stats.skillsGlobal && state.stats.skillsGlobal.directoryPath)
      ? state.stats.skillsGlobal.directoryPath
      : (isClaude ? `${userHome}/.claude/skills` : `${userHome}/.gemini/config/skills`);

    const globalPathItems = [];
    if (isClaude) {
      if (currentFilter === 'all') {
        globalPathItems.push({ label: '~/.claude/CLAUDE.md', fullPath: globalSoulPath, icon: '🧬', count: globalSoulCount });
        globalPathItems.push({ label: '~/.claude/rules/', fullPath: globalRulesPath, icon: '📁', count: globalRulesCount });
        globalPathItems.push({ label: '~/.claude/skills/', fullPath: globalSkillsPath, icon: '📁', count: globalSkillsCount });
      } else if (currentFilter === 'soul') {
        globalPathItems.push({ label: '~/.claude/CLAUDE.md', fullPath: globalSoulPath, icon: '🧬', count: globalSoulCount });
      } else if (currentFilter === 'rule') {
        globalPathItems.push({ label: '~/.claude/rules/', fullPath: globalRulesPath, icon: '📁', count: globalRulesCount });
      } else if (currentFilter === 'skill' || currentFilter === 'workflow') {
        globalPathItems.push({ label: '~/.claude/skills/', fullPath: globalSkillsPath, icon: '📁', count: globalSkillsCount });
      }
    } else {
      if (currentFilter === 'all') {
        globalPathItems.push({ label: '~/.gemini/GEMINI.md', fullPath: globalSoulPath, icon: '🧬', count: globalSoulCount });
        globalPathItems.push({ label: '~/.gemini/config/rules/', fullPath: globalRulesPath, icon: '📁', count: globalRulesCount });
        globalPathItems.push({ label: '~/.gemini/config/skills/', fullPath: globalSkillsPath, icon: '📁', count: globalSkillsCount });
      } else if (currentFilter === 'soul') {
        globalPathItems.push({ label: '~/.gemini/GEMINI.md', fullPath: globalSoulPath, icon: '🧬', count: globalSoulCount });
      } else if (currentFilter === 'rule') {
        globalPathItems.push({ label: '~/.gemini/config/rules/', fullPath: globalRulesPath, icon: '📁', count: globalRulesCount });
      } else if (currentFilter === 'skill' || currentFilter === 'workflow') {
        globalPathItems.push({ label: '~/.gemini/config/skills/', fullPath: globalSkillsPath, icon: '📁', count: globalSkillsCount });
      }
    }
    renderColumnPath(globalPathEl, globalPathItems);

    if (globalContainer) {
      globalContainer.innerHTML = '';
      const totalGlobal = (state.globalResources || []).length;
      const filteredGlobal = filterItems(state.globalResources);
      const sortedGlobal = sortItemsWithPinnedSoul(filteredGlobal);
      const isFiltered = !!searchQuery || currentFilter !== 'all' || showDuplicatesOnly;

      if (globalCountEl) {
        globalCountEl.textContent = isFiltered ? `${sortedGlobal.length} / ${totalGlobal} filtré` : `${totalGlobal} items`;
        globalCountEl.className = isClaude ? 'badge badge-claude' : 'badge badge-antigravity';
        if (isFiltered && sortedGlobal.length < totalGlobal) {
          globalCountEl.classList.add('is-filtered');
        }
      }

      if (sortedGlobal.length === 0) {
        globalContainer.innerHTML = `<div class="empty-state">Aucun élément global</div>`;
      } else {
        sortedGlobal.forEach((item) => {
          const card = createItemCard(item, true);
          globalContainer.appendChild(card);
        });
      }
    }

    // 3. Colonne Local (Projet Actuel)
    const localContainer = document.getElementById('localItemsList');
    const localCountEl = document.getElementById('localCountBadge');
    const localPathEl = document.getElementById('localPathLabel');
    const wsPath = state.workspace && state.workspace.workspacePath ? state.workspace.workspacePath : '';

    const localRulesCount = (state.localResources || []).filter((i) => i.type === 'rule').length;
    const localSkillsCount = (state.localResources || []).filter((i) => i.type === 'skill' || i.type === 'workflow').length;
    const localSoulCount = (state.localResources || []).filter((i) => i.type === 'soul' || (i.metadata && i.metadata.isSoul)).length;

    const localSoulPath = (state.stats && state.stats.soulLocal && state.stats.soulLocal.directoryPath)
      ? state.stats.soulLocal.directoryPath
      : (wsPath ? `${wsPath}\\${isClaude ? 'CLAUDE.md' : 'GEMINI.md'}` : '');

    const localRulesPath = (state.stats && state.stats.rulesLocal && state.stats.rulesLocal.directoryPath)
      ? state.stats.rulesLocal.directoryPath
      : (wsPath ? `${wsPath}\\${isClaude ? '.claude\\rules' : '.agents\\rules'}` : '');

    const localSkillsPath = (state.stats && state.stats.skillsLocal && state.stats.skillsLocal.directoryPath)
      ? state.stats.skillsLocal.directoryPath
      : (wsPath ? `${wsPath}\\${isClaude ? '.claude\\skills' : '.agents\\skills'}` : '');

    const localPathItems = [];
    if (!state.workspace || !state.workspace.hasWorkspace) {
      localPathItems.push({ label: 'Aucun projet ouvert', fullPath: '', icon: '📁' });
    } else if (isClaude) {
      if (currentFilter === 'all') {
        localPathItems.push({ label: 'projet-local\\CLAUDE.md', fullPath: localSoulPath, icon: '🧬', count: localSoulCount });
        localPathItems.push({ label: 'projet-local\\.claude\\rules\\', fullPath: localRulesPath, icon: '📁', count: localRulesCount });
        localPathItems.push({ label: 'projet-local\\.claude\\skills\\', fullPath: localSkillsPath, icon: '📁', count: localSkillsCount });
      } else if (currentFilter === 'soul') {
        localPathItems.push({ label: 'projet-local\\CLAUDE.md', fullPath: localSoulPath, icon: '🧬', count: localSoulCount });
      } else if (currentFilter === 'rule') {
        localPathItems.push({ label: 'projet-local\\.claude\\rules\\', fullPath: localRulesPath, icon: '📁', count: localRulesCount });
      } else if (currentFilter === 'skill' || currentFilter === 'workflow') {
        localPathItems.push({ label: 'projet-local\\.claude\\skills\\', fullPath: localSkillsPath, icon: '📁', count: localSkillsCount });
      }
    } else {
      if (currentFilter === 'all') {
        localPathItems.push({ label: 'projet-local\\GEMINI.md', fullPath: localSoulPath, icon: '🧬', count: localSoulCount });
        localPathItems.push({ label: 'projet-local\\.agents\\rules\\', fullPath: localRulesPath, icon: '📁', count: localRulesCount });
        localPathItems.push({ label: 'projet-local\\.agents\\skills\\', fullPath: localSkillsPath, icon: '📁', count: localSkillsCount });
      } else if (currentFilter === 'soul') {
        localPathItems.push({ label: 'projet-local\\GEMINI.md', fullPath: localSoulPath, icon: '🧬', count: localSoulCount });
      } else if (currentFilter === 'rule') {
        localPathItems.push({ label: 'projet-local\\.agents\\rules\\', fullPath: localRulesPath, icon: '📁', count: localRulesCount });
      } else if (currentFilter === 'skill' || currentFilter === 'workflow') {
        localPathItems.push({ label: 'projet-local\\.agents\\skills\\', fullPath: localSkillsPath, icon: '📁', count: localSkillsCount });
      }
    }
    renderColumnPath(localPathEl, localPathItems);

    if (localContainer) {
      localContainer.innerHTML = '';
      if (!state.workspace || !state.workspace.hasWorkspace) {
        localContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📁</div>
            <div>Ouvrez un dossier de projet pour voir les ressources locales</div>
          </div>
        `;
      } else {
        const totalLocal = (state.localResources || []).length;
        const filteredLocal = filterItems(state.localResources);
        const sortedLocal = sortItemsWithPinnedSoul(filteredLocal);
        const isFiltered = !!searchQuery || currentFilter !== 'all' || showDuplicatesOnly;

        if (localCountEl) {
          localCountEl.textContent = isFiltered ? `${sortedLocal.length} / ${totalLocal} filtré` : `${totalLocal} items`;
          localCountEl.classList.toggle('is-filtered', isFiltered && sortedLocal.length < totalLocal);
        }

        if (sortedLocal.length === 0) {
          localContainer.innerHTML = `
            <div class="empty-state">
              <div class="empty-state-icon">✨</div>
              <div>Aucune règle ou compétence locale.<br>Importez-en depuis le NAS ou le Global !</div>
            </div>
          `;
        } else {
          sortedLocal.forEach((item) => {
            const card = createItemCard(item, true);
            localContainer.appendChild(card);
          });
        }
      }
    }

    // 4. Mise à jour des contrôles bulk (Global & Local)
    updateBulkControl('global', 'workflow', state.globalResources);
    updateBulkControl('global', 'skill', state.globalResources);
    updateBulkControl('global', 'rule', state.globalResources);

    updateBulkControl('local', 'workflow', state.localResources);
    updateBulkControl('local', 'skill', state.localResources);
    updateBulkControl('local', 'rule', state.localResources);
  }

  function updateBulkControl(scope, type, items) {
    const matching = (items || []).filter((i) => i.type === type);
    const total = matching.length;
    const active = matching.filter((i) => i.enabled).length;

    const prefix = type === 'workflow' ? 'Wf' : type === 'skill' ? 'Skill' : 'Rule';
    const scopeSuffix = scope === 'global' ? 'Global' : 'Local';

    const countEl = document.getElementById(`count${prefix}${scopeSuffix}`);
    const controlEl = document.getElementById(`bulk${prefix}${scopeSuffix}`);

    if (countEl) {
      countEl.textContent = `${active}/${total}`;
    }

    if (controlEl) {
      const btnOn = controlEl.querySelector('.btn-on');
      const btnOff = controlEl.querySelector('.btn-off');

      if (total === 0) {
        controlEl.classList.add('is-empty');
        controlEl.classList.remove('is-mixed');
        if (btnOn) btnOn.classList.remove('is-active');
        if (btnOff) btnOff.classList.remove('is-active');
      } else {
        controlEl.classList.remove('is-empty');

        if (active === total) {
          // Tout est activé
          controlEl.classList.remove('is-mixed');
          if (btnOn) btnOn.classList.add('is-active');
          if (btnOff) btnOff.classList.remove('is-active');
        } else if (active === 0) {
          // Tout est désactivé
          controlEl.classList.remove('is-mixed');
          if (btnOn) btnOn.classList.remove('is-active');
          if (btnOff) btnOff.classList.add('is-active');
        } else {
          // État partiel (mixte)
          controlEl.classList.add('is-mixed');
          if (btnOn) btnOn.classList.remove('is-active');
          if (btnOff) btnOff.classList.remove('is-active');
        }
      }
    }
  }

  function renderColumnPath(containerEl, pathItems) {
    if (!containerEl) return;
    if (!pathItems || pathItems.length === 0) {
      containerEl.innerHTML = '';
      return;
    }

    const formatCountHtml = (count) => {
      if (count === undefined || count === null) return '';
      return `<span class="path-count">(${count})</span>`;
    };

    if (pathItems.length === 1) {
      const item = pathItems[0];
      const fullPath = item.fullPath || item.label;
      containerEl.innerHTML = `
        <div class="column-path-single" data-path="${escapeHtml(fullPath)}" title="Ouvrir dans l'Explorateur Windows :&#10;${escapeHtml(fullPath)}">
          <span class="path-icon">${item.icon || '📁'}</span>
          ${formatCountHtml(item.count)}
          <span class="path-text">${escapeHtml(item.label)}</span>
          <span class="path-open-hint" title="Ouvrir l'Explorateur Windows">↗</span>
        </div>
      `;
    } else {
      containerEl.innerHTML = `
        <div class="column-path-list">
          ${pathItems
            .map((p) => {
              const fullPath = p.fullPath || p.label;
              return `
            <div class="column-path-item" data-path="${escapeHtml(fullPath)}" title="Ouvrir dans l'Explorateur Windows :&#10;${escapeHtml(fullPath)}">
              <span class="path-icon">${p.icon || '📁'}</span>
              ${formatCountHtml(p.count)}
              <span class="path-text">${escapeHtml(p.label)}</span>
              <span class="path-open-hint" title="Ouvrir l'Explorateur Windows">↗</span>
            </div>
          `;
            })
            .join('')}
        </div>
      `;
    }

    // Écouteur pour ouvrir l'Explorateur Windows au clic sur un dossier ou fichier
    containerEl.querySelectorAll('.column-path-item, .column-path-single').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetPath = el.getAttribute('data-path');
        if (targetPath) {
          vscode.postMessage({
            type: 'openInExplorer',
            payload: { path: targetPath },
          });
        }
      });
    });
  }

  function sortItemsWithPinnedSoul(items) {
    if (!items) return [];
    return [...items].sort((a, b) => {
      const aIsSoul = (a.type === 'soul' || (a.metadata && a.metadata.isSoul)) ? 1 : 0;
      const bIsSoul = (b.type === 'soul' || (b.metadata && b.metadata.isSoul)) ? 1 : 0;
      if (aIsSoul !== bIsSoul) {
        return bIsSoul - aIsSoul; // Cartes âme épinglées en haut de colonne
      }
      return (a.name || a.id).localeCompare(b.name || b.id);
    });
  }

  function filterItems(items) {
    if (!items) return [];
    return items.filter((item) => {
      // Filtre exclusif des doublons actifs (toutes les paires actives, âme comprise)
      if (showDuplicatesOnly) {
        if (!item.metadata || !item.metadata.duplicateInfo || !item.metadata.duplicateInfo.bothEnabled) {
          return false;
        }
      }
      // Filtre de type
      if (currentFilter !== 'all') {
        if (currentFilter === 'soul') {
          if (item.type !== 'soul' && (!item.metadata || !item.metadata.isSoul)) {
            return false;
          }
        } else if (item.type !== currentFilter) {
          return false;
        }
      }
      // Filtre de recherche
      if (searchQuery) {
        const matchId = (item.id || '').toLowerCase().includes(searchQuery);
        const matchName = (item.name || '').toLowerCase().includes(searchQuery);
        const matchDesc = (item.description || '').toLowerCase().includes(searchQuery);
        return matchId || matchName || matchDesc;
      }
      return true;
    });
  }

  /**
   * Modèle de configuration du badge de doublon (Incrément 1 SPEC-DOUBLONS-UI-ET-COMPARAISON)
   * Détermine la classe de couleur, le libellé sans (+tok), le popover (title) et le bouton d'extinction rapide.
   */
  function getDuplicateBadgeConfig(item) {
    if (!item || !item.metadata || !item.metadata.duplicateInfo || !item.metadata.duplicateInfo.hasDuplicate) {
      return null;
    }
    const dup = item.metadata.duplicateInfo;
    const isSoul = item.type === 'soul' || !!(item.metadata && item.metadata.isSoul);

    if (dup.bothEnabled) {
      if (isSoul) {
        if (dup.isIdentical) {
          return {
            active: true,
            isSoul: true,
            isIdentical: true,
            colorClass: 'pill-duplicate-active',
            label: '⚠️ Doublon actif',
            title: 'Redondance inutile : la même Âme est injectée en double au démarrage. À corriger.',
            hasQuickOff: false,
          };
        } else {
          return {
            active: true,
            isSoul: true,
            isIdentical: false,
            colorClass: 'pill-override-active',
            label: '⚡ Surchargé divergent',
            title: 'Vérifiez que les règles locales ne répètent pas les règles globales et qu\'elles sont bien propres au projet.',
            hasQuickOff: false,
          };
        }
      } else {
        if (dup.isIdentical) {
          return {
            active: true,
            isSoul: false,
            isIdentical: true,
            colorClass: 'pill-duplicate-active',
            label: '⚠️ Doublon actif',
            title: 'Redondance inutile : les copies globale et locale sont identiques. Éteignez la globale pour récupérer les tokens.',
            hasQuickOff: true,
            quickOffLabel: 'Éteindre Global',
          };
        } else {
          return {
            active: true,
            isSoul: false,
            isIdentical: false,
            colorClass: 'pill-duplicate-active',
            label: '⚠️ Doublon divergent',
            title: 'Les copies globale et locale diffèrent. Vérifiez laquelle garder.',
            hasQuickOff: true,
            quickOffLabel: 'Éteindre Global',
          };
        }
      }
    } else {
      if (dup.isIdentical) {
        return {
          active: false,
          isSoul,
          isIdentical: true,
          colorClass: 'pill-duplicate-inactive',
          label: '♊ Doublon (inactif)',
          title: `Cette ressource existe également en ${dup.duplicateScope} (contenu 100% identique, seul le chemin d'accès diffère), mais l'une des deux copies est désactivée (aucun token gaspillé au démarrage).`,
          hasQuickOff: false,
        };
      } else {
        return {
          active: false,
          isSoul,
          isIdentical: false,
          colorClass: 'pill-duplicate-inactive',
          label: item.scope === 'local' ? '⚡ Surcharge locale (optimisée)' : '⚡ Surchargé en local (optimisé)',
          title: 'Surcharge personnalisée pour ce projet. Le doublon est optimisé (pas de conflit de démarrage).',
          hasQuickOff: false,
        };
      }
    }
  }

  function createDuplicateBadge(item, doc) {
    const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!targetDoc) return null;
    const config = getDuplicateBadgeConfig(item);
    if (!config) return null;

    const dup = item.metadata && item.metadata.duplicateInfo;
    const dupBadge = targetDoc.createElement('span');
    dupBadge.className = `item-badge-pill ${config.colorClass}`;
    dupBadge.title = config.title;

    if (config.active) {
      dupBadge.innerHTML = `<span>${config.label}</span>`;
      if (config.hasQuickOff) {
        const btnQuickOff = targetDoc.createElement('button');
        btnQuickOff.className = 'btn-quick-off';
        btnQuickOff.textContent = config.quickOffLabel || 'Éteindre Global';
        const wastedTokStr = dup && dup.wastedTokens ? ` et économiser ${dup.wastedTokens.toLocaleString('fr-FR')} tokens` : '';
        btnQuickOff.title = `Désactiver la copie globale pour ce doublon${wastedTokStr}`;
        btnQuickOff.addEventListener('click', (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          vscode.postMessage({
            type: 'toggle',
            payload: {
              id: item.id,
              scope: item.scope === 'global' ? item.scope : ((dup && dup.duplicateScope) || 'global'),
              targetState: false,
              type: item.type,
              path: item.scope === 'global' ? item.path : ((dup && dup.duplicatePath) || item.path),
            },
          });
        });
        dupBadge.appendChild(btnQuickOff);
      }
    } else {
      dupBadge.textContent = config.label;
    }

    return dupBadge;
  }

  function createItemCard(item, isDetailed, doc) {
    const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!targetDoc) return null;

    const isSoul = item.type === 'soul' || (item.metadata && item.metadata.isSoul);

    const card = targetDoc.createElement('div');
    card.className = `resource-item ${item.enabled ? 'enabled' : 'disabled'} ${isSoul ? 'item-soul' : ''}`;

    const typeClass = isSoul
      ? 'type-soul'
      : item.type === 'workflow'
      ? 'type-workflow'
      : item.type === 'rule'
      ? 'type-rule'
      : 'type-skill';
    const typeLabel = isSoul
      ? '🛡️ Âme Système'
      : item.type === 'workflow'
      ? 'Workflow'
      : item.type === 'rule'
      ? 'Règle'
      : 'Skill';

    // Top Row
    const topRow = targetDoc.createElement('div');
    topRow.className = 'item-top';

    const titleWrap = targetDoc.createElement('div');
    titleWrap.className = 'item-title-wrap';

    const idEl = targetDoc.createElement('div');
    idEl.className = 'item-id';
    idEl.title = item.name || item.id;
    idEl.textContent = item.name || item.id;

    const badgesLine = targetDoc.createElement('div');
    badgesLine.className = 'item-badges-line';

    const badgeEl = targetDoc.createElement('span');
    badgeEl.className = `item-type-badge ${typeClass}`;
    badgeEl.textContent = typeLabel;
    badgesLine.appendChild(badgeEl);

    // Badges enrichis
    const isScenarioFixture = !!(
      item.metadata && (
        item.metadata.isScenarioFixture === true ||
        item.metadata.isScenarioFixture === 'true' ||
        item.metadata.scenario_fixture === true ||
        item.metadata.scenario_fixture === 'true'
      )
    );
    if (isScenarioFixture) {
      const fixtureBadge = targetDoc.createElement('span');
      fixtureBadge.className = 'item-badge-pill pill-fixture';
      fixtureBadge.textContent = '🧪 Test Scénario';
      fixtureBadge.title = 'Élément de test du Banc d\'Essai. Supprimable à tout moment sans risque.';
      badgesLine.appendChild(fixtureBadge);
    }

    // Règle Antigravity écartée par l'agent : frontmatter absent ou trigger non reconnu
    if (item.metadata && item.metadata.ignoredByAgent) {
      const ignoredBadge = targetDoc.createElement('span');
      ignoredBadge.className = 'item-badge-pill pill-warn';
      ignoredBadge.textContent = '⛔ Ignorée par Antigravity';
      const issue = (item.metadata.ruleIssues || [])[0];
      const reason = issue === 'missing-frontmatter'
        ? 'le fichier ne commence pas par un frontmatter YAML'
        : issue === 'invalid-trigger'
          ? 'la valeur de trigger n\'est pas reconnue (casse exacte requise)'
          : 'le frontmatter ne déclare pas de trigger';
      ignoredBadge.title = `Antigravity ignore cette règle en silence : ${reason}.\nAjoutez « trigger: » avec always_on, model_decision, glob ou manual.`;
      badgesLine.appendChild(ignoredBadge);
    }

    // Champs de frontmatter manquants ou mal formés (règle tout de même chargée)
    const frontmatterIssues = (item.metadata && !item.metadata.ignoredByAgent && item.metadata.ruleIssues) || [];
    if (frontmatterIssues.length > 0) {
      const issueLabels = {
        'missing-description': '« description » est obligatoire avec trigger: model_decision',
        'missing-globs': '« globs » est obligatoire avec trigger: glob',
        'globs-not-string': '« globs » doit être une chaîne de motifs séparés par des virgules (ex. "*.ts, *.tsx")',
      };
      const issueBadge = targetDoc.createElement('span');
      issueBadge.className = 'item-badge-pill pill-warn-amber';
      issueBadge.textContent = '⚠️ Frontmatter';
      issueBadge.title = 'Frontmatter à corriger :\n' + frontmatterIssues.map((code) => `• ${issueLabels[code] || code}`).join('\n');
      badgesLine.appendChild(issueBadge);
    }

    if (item.metadata && item.metadata.directoryScope !== undefined) {
      const scopeBadge = targetDoc.createElement('span');
      scopeBadge.className = 'item-badge-pill pill-cond';
      scopeBadge.textContent = `📂 ${item.metadata.directoryScope}/`;
      scopeBadge.title = `Règle limitée au dossier ${item.metadata.directoryScope}/ : Antigravity la charge seulement quand l'agent lit ou modifie un fichier de ce dossier. Aucun coût au démarrage.`;
      badgesLine.appendChild(scopeBadge);
    } else if (item.metadata && item.metadata.isConditional) {
      const condBadge = targetDoc.createElement('span');
      condBadge.className = 'item-badge-pill pill-cond';
      condBadge.textContent = '⚡ Conditionnel';
      condBadge.title = `Règle conditionnelle (trigger: ${item.metadata.trigger || 'glob'}) : contenu complet chargé seulement à l'activation (~20 tokens au boot, estimation de l'extension)`;
      badgesLine.appendChild(condBadge);
    }

    if (item.metadata && item.metadata.fromRulesJson) {
      const jsonBadge = targetDoc.createElement('span');
      jsonBadge.className = 'item-badge-pill pill-plugin';
      jsonBadge.textContent = '🔗 rules.json';
      jsonBadge.title = 'Règle déclarée par .agents/rules.json (entrée partagée ou sous-dossier de règles).';
      badgesLine.appendChild(jsonBadge);
    }

    // Avertissement dépassement taille physique (> 24 000 octets sous Antigravity, inclusions développées)
    if (item.metadata && item.metadata.warningSizeExceeded) {
      const warnBadge = targetDoc.createElement('span');
      warnBadge.className = 'item-badge-pill pill-warn';
      warnBadge.textContent = '⚠️ > 24 Ko';
      const bytes = typeof item.metadata.byteSize === 'number' ? ` (${item.metadata.byteSize.toLocaleString('fr-FR')} octets)` : '';
      warnBadge.title = `Attention : ce fichier dépasse la limite de 24 000 octets d'Antigravity${bytes}, inclusions @[label](path) comprises. Antigravity le tronque.`;
      badgesLine.appendChild(warnBadge);
    }

    // Avertissement dépassement du nombre de lignes (> 200 pour Rules/Soul, > 500 pour Skills)
    if (item.metadata && item.metadata.warningLinesExceeded) {
      const warnLinesBadge = targetDoc.createElement('span');
      warnLinesBadge.className = 'item-badge-pill pill-warn-amber';
      if (item.type === 'skill' || item.type === 'workflow') {
        const lines = item.lineCount ? ` (${item.lineCount} li.)` : '';
        warnLinesBadge.textContent = '⚠️ > 500 li.';
        warnLinesBadge.title = `Attention : compétence volumineuse${lines} dans SKILL.md.\nRisque de surconsommation contextuelle lors de son invocation (recommandé < 500 lignes).`;
      } else {
        const lines = item.lineCount ? ` (${item.lineCount} li.)` : '';
        warnLinesBadge.textContent = '⚠️ > 200 li.';
        warnLinesBadge.title = `Attention : règle ou âme volumineuse${lines}.\nRisque de "Lost in the Middle" et dilution de l'attention de l'IA (recommandé < 200 lignes).`;
      }
      badgesLine.appendChild(warnLinesBadge);
    }

    // Avertissement dépassement MCP (> 2 Ko sous Claude Code)
    if (item.metadata && item.metadata.warningMcpExceeded) {
      const warnMcpBadge = targetDoc.createElement('span');
      warnMcpBadge.className = 'item-badge-pill pill-warn';
      warnMcpBadge.textContent = '⚠️ MCP > 2 Ko';
      warnMcpBadge.title = 'Attention : dépasse le plafond de 2 048 caractères par outil sous Claude Code (risque de troncature silencieuse).';
      badgesLine.appendChild(warnMcpBadge);
    }

    // Avertissement absence de description
    if (item.metadata && item.metadata.warningNoDescription) {
      const warnNoDescBadge = targetDoc.createElement('span');
      warnNoDescBadge.className = 'item-badge-pill pill-warn-amber';
      warnNoDescBadge.textContent = '⚠️ Sans description';
      warnNoDescBadge.title = 'Attention : aucune description fournie. L\'IA aura des difficultés à identifier quand déclencher ou utiliser cette ressource.';
      badgesLine.appendChild(warnNoDescBadge);
    }

    if (item.metadata && item.metadata.pluginName) {
      const pluginBadge = targetDoc.createElement('span');
      pluginBadge.className = 'item-badge-pill pill-plugin';
      pluginBadge.textContent = `🧩 ${item.metadata.pluginName}`;
      pluginBadge.title = `Ressource issue du plugin : ${item.metadata.pluginName}`;
      badgesLine.appendChild(pluginBadge);
    }

    // Badge de Doublon (Global vs Local) avec bouton d'extinction rapide en 1 clic
    if (item.metadata && item.metadata.duplicateInfo && item.metadata.duplicateInfo.hasDuplicate) {
      const dupBadge = createDuplicateBadge(item, targetDoc);
      if (dupBadge) {
        badgesLine.appendChild(dupBadge);
      }
    }

    // Métrique Caractères + Tokens (déjà calculés en amont par le tokenizer officiel)
    const charCount = typeof item.charCount === 'number' ? item.charCount : 0;
    const tokenCount = typeof item.tokenCount === 'number' ? item.tokenCount : 0;

    const metricsEl = targetDoc.createElement('span');
    metricsEl.className = 'item-metrics-badge';
    const charStr = charCount.toLocaleString('fr-FR');
    const tokStr = tokenCount.toLocaleString('fr-FR');

    if (item.metadata && (item.metadata.ignoredByAgent || item.metadata.directoryScope !== undefined)) {
      metricsEl.innerHTML = `<span>${charStr} car.</span> <span class="tok-highlight">0 tok au boot (${tokStr} plein)</span>`;
      metricsEl.title = item.metadata.ignoredByAgent
        ? `Règle ignorée par Antigravity : aucun coût, car elle n'est jamais chargée.\n• Poids si corrigée : ${charStr} car. (${tokStr} tokens)`
        : `Règle de dossier : aucun coût au démarrage.\n• Poids à l'activation : ${charStr} car. (${tokStr} tokens)`;
    } else if (item.metadata && item.metadata.isConditional) {
      metricsEl.innerHTML = `<span>${charStr} car.</span> <span class="tok-highlight" title="Coût au boot : ~20 tokens (estimation de l'extension). Fichier complet si activé : ${tokStr} tokens">~20 tok (${tokStr} plein)</span>`;
      metricsEl.title = `Règle conditionnelle :\n• Coût au boot : ~20 tokens (estimation de l'extension, non chiffrée par la documentation)\n• Poids complet si activé : ${charStr} car. (${tokStr} tokens)`;
    } else {
      metricsEl.innerHTML = `<span>${charStr} car.</span> <span class="tok-highlight">(${tokStr} tokens)</span>`;
      let metricsTitle = `Taille réelle : ${charStr} caractères (${tokStr} tokens)\nEstimation : BPE o200k (repli 1 token ≈ 4 car.)`;
      if (item.metadata && item.metadata.duplicateInfo && item.metadata.duplicateInfo.isIdentical) {
        metricsTitle += `\nContenu identique au doublon ${item.metadata.duplicateInfo.duplicateScope} (la légère différence de taille affichée provient du chemin de fichier).`;
      }
      metricsEl.title = metricsTitle;
    }
    badgesLine.appendChild(metricsEl);

    titleWrap.appendChild(idEl);
    titleWrap.appendChild(badgesLine);
    topRow.appendChild(titleWrap);

    // Contrôles droits (Switch ON / OFF + Poubelle sécurisée OU Badge Always-On)
    if (item.scope !== 'nas') {
      const rightControls = targetDoc.createElement('div');
      rightControls.className = 'item-right-controls';

      if (isSoul) {
        // 3.A. Fichier marqué comme Verrouillé / Permanent (Always-On)
        const lockedBadge = targetDoc.createElement('div');
        lockedBadge.className = 'soul-locked-badge';
        lockedBadge.title = 'Fichier maître permanent et actif en continu (Always-On)';
        lockedBadge.innerHTML = '<span class="soul-locked-icon">🔒</span><span>Always-On</span>';
        rightControls.appendChild(lockedBadge);
      } else {
        const switchLabel = targetDoc.createElement('label');
        switchLabel.className = 'switch-label';

        const switchBox = targetDoc.createElement('div');
        switchBox.className = 'switch';

        const checkbox = targetDoc.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.enabled;

        const slider = targetDoc.createElement('span');
        slider.className = 'slider';

        checkbox.addEventListener('change', (e) => {
          const targetState = e.target.checked;
          // Optimistic UI update
          if (targetState) {
            card.classList.remove('disabled');
          } else {
            card.classList.add('disabled');
          }
          vscode.postMessage({
            type: 'toggle',
            payload: {
              id: item.id,
              scope: item.scope,
              targetState,
              type: item.type,
              path: item.path,
            },
          });
        });

        switchBox.appendChild(checkbox);
        switchBox.appendChild(slider);
        switchLabel.appendChild(switchBox);
        rightControls.appendChild(switchLabel);
      }

      // Bouton Poubelle sécurisé 🗑️ (applicable à tout élément Local et Global, y compris l'Âme)
      const btnTrash = targetDoc.createElement('button');
      btnTrash.className = 'btn-trash';
      btnTrash.innerHTML = '🗑️';

      const syncStatus = item.syncStatus || 'local_only';

      if (syncStatus === 'synced' || isScenarioFixture) {
        btnTrash.classList.add('is-deletable');
        btnTrash.title = isScenarioFixture
          ? (isSoul ? 'Supprimer l\'Âme (Élément de test du Banc d\'Essai)' : 'Supprimer (Élément de test du Banc d\'Essai)')
          : (isSoul
              ? 'Supprimer l\'Âme (100% identique au Catalogue NAS, réimportable à tout moment)'
              : 'Supprimer (100% identique au Catalogue NAS, réimportable à tout moment)');
        btnTrash.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({
            type: 'delete',
            payload: { item },
          });
        });
      } else if (syncStatus === 'modified') {
        btnTrash.disabled = true;
        btnTrash.classList.add('is-blocked');
        btnTrash.title = 'Suppression bloquée : ce fichier a été modifié manuellement et diffère du Catalogue NAS';
      } else if (syncStatus === 'nas_offline') {
        btnTrash.disabled = true;
        btnTrash.classList.add('is-blocked');
        btnTrash.title = 'Suppression bloquée : Catalogue NAS inaccessible pour vérifier l\'intégrité';
      } else {
        // local_only
        btnTrash.disabled = true;
        btnTrash.classList.add('is-blocked');
        btnTrash.title = 'Suppression bloquée : fichier absent du Catalogue NAS (risque de perte définitive)';
      }

      rightControls.appendChild(btnTrash);

      topRow.appendChild(rightControls);
    }

    card.appendChild(topRow);

    // Description
    if (item.description) {
      const descEl = targetDoc.createElement('div');
      descEl.className = 'item-description';
      descEl.textContent = item.description;
      descEl.title = item.description;
      card.appendChild(descEl);
    }

    // Footer actions
    const footer = targetDoc.createElement('div');
    footer.className = 'item-footer';

    const leftMeta = targetDoc.createElement('span');
    leftMeta.className = 'badge-tag';
    leftMeta.textContent = item.scope.toUpperCase();
    footer.appendChild(leftMeta);

    const rightActions = targetDoc.createElement('div');
    rightActions.style.display = 'flex';
    rightActions.style.gap = '4px';

    // Actions pour le NAS : Boutons d'import
    if (item.scope === 'nas') {
      const localList = (currentState && currentState.localResources) ? currentState.localResources : [];
      const globalList = (currentState && currentState.globalResources) ? currentState.globalResources : [];
      const isAlreadyInLocal = localList.some((r) => r.id === item.id);
      const isAlreadyInGlobal = globalList.some((r) => r.id === item.id);

      const btnImportLocal = targetDoc.createElement('button');
      btnImportLocal.className = isAlreadyInLocal ? 'btn btn-secondary btn-sm btn-disabled' : 'btn btn-secondary btn-sm';
      btnImportLocal.disabled = isAlreadyInLocal;
      btnImportLocal.innerHTML = isAlreadyInLocal ? '✓ Local' : '+ Local';
      btnImportLocal.title = isAlreadyInLocal
        ? 'Déjà présent dans le projet local (actif ou désactivé)'
        : 'Importer vers le projet actif local';
      if (!isAlreadyInLocal) {
        btnImportLocal.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({
            type: 'import',
            payload: {
              item,
              destinationScope: 'local',
            },
          });
        });
      }
      rightActions.appendChild(btnImportLocal);

      const btnImportGlobal = targetDoc.createElement('button');
      btnImportGlobal.className = isAlreadyInGlobal ? 'btn btn-secondary btn-sm btn-disabled' : 'btn btn-secondary btn-sm';
      btnImportGlobal.disabled = isAlreadyInGlobal;
      btnImportGlobal.innerHTML = isAlreadyInGlobal ? '✓ Global' : '+ Global';
      btnImportGlobal.title = isAlreadyInGlobal
        ? 'Déjà présent dans la configuration globale PC (actif ou désactivé)'
        : 'Importer vers la configuration globale PC';
      if (!isAlreadyInGlobal) {
        btnImportGlobal.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({
            type: 'import',
            payload: {
              item,
              destinationScope: 'global',
            },
          });
        });
      }
      rightActions.appendChild(btnImportGlobal);
    } else if (item.scope === 'global' && isDetailed) {
      // Option pour promouvoir/injecter vers Local depuis Global
      const localList = (currentState && currentState.localResources) ? currentState.localResources : [];
      const isAlreadyInLocal = localList.some((r) => r.id === item.id);

      const btnToLocal = targetDoc.createElement('button');
      btnToLocal.className = isAlreadyInLocal ? 'btn btn-secondary btn-sm btn-disabled' : 'btn btn-secondary btn-sm';
      btnToLocal.disabled = isAlreadyInLocal;
      btnToLocal.innerHTML = isAlreadyInLocal ? '✓ Local' : '+ Local';
      btnToLocal.title = isAlreadyInLocal
        ? 'Déjà présent dans le projet local (actif ou désactivé)'
        : 'Copier vers le projet actif local';
      if (!isAlreadyInLocal) {
        btnToLocal.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({
            type: 'import',
            payload: {
              item,
              destinationScope: 'local',
            },
          });
        });
      }
      rightActions.appendChild(btnToLocal);
    }

    // Bouton Comparer (Incrément 2 : doublons divergents uniquement)
    if (item.metadata && item.metadata.duplicateInfo && item.metadata.duplicateInfo.hasDuplicate && item.metadata.duplicateInfo.isIdentical === false) {
      const btnCompare = targetDoc.createElement('button');
      btnCompare.className = 'btn btn-secondary btn-sm btn-compare';
      btnCompare.innerHTML = '⚖️ Comparer';
      btnCompare.title = 'Comparer les copies globale et locale (résumé et diff côte à côte)';
      btnCompare.addEventListener('click', (e) => {
        e.stopPropagation();
        openCompareModal(item);
      });
      rightActions.appendChild(btnCompare);
    }

    // Bouton ouvrir fichier
    const btnOpenFile = targetDoc.createElement('button');
    btnOpenFile.className = 'btn btn-secondary btn-sm';
    btnOpenFile.innerHTML = '📄';
    btnOpenFile.title = 'Ouvrir le fichier dans l\'éditeur';
    btnOpenFile.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({
        type: 'openFile',
        payload: { path: item.path },
      });
    });
    rightActions.appendChild(btnOpenFile);

    footer.appendChild(rightActions);
    card.appendChild(footer);

    return card;
  }

  /**
   * Calcule une recommandation heuristique pour un doublon divergent entre la copie locale et la copie globale.
   * Analyse la correspondance au Catalogue maître NAS et intègre des signaux faibles (dates mtime, tailles).
   * Formule une recommandation prudente (« probablement... »).
   */
  function computeDuplicateRecommendation(params) {
    const p = params || {};
    const localSync = p.localSyncStatus || 'local_only';
    const globalSync = p.globalSyncStatus || 'local_only';

    const localIsSynced = localSync === 'synced';
    const globalIsSynced = globalSync === 'synced';
    const nasOffline = localSync === 'nas_offline' || globalSync === 'nas_offline';

    let type = 'both_diverged';
    let recommendation = '';

    if (localIsSynced && !globalIsSynced) {
      type = 'local_maintained';
      recommendation = 'Probablement la version locale à conserver (version maintenue) : la copie locale correspond au Catalogue maître NAS, tandis que la copie globale a divergé.';
    } else if (globalIsSynced && !localIsSynced) {
      type = 'local_override';
      recommendation = 'Probablement une surcharge propre au projet (à garder ici) : la copie globale correspond au Catalogue maître NAS, tandis que la copie locale a été adaptée spécifiquement à ce projet.';
    } else if (nasOffline) {
      type = 'nas_offline';
      recommendation = 'Catalogue NAS hors-ligne : impossible de vérifier la correspondance avec le Catalogue maître. Comparez le diff côte à côte et vérifiez les dates et tailles ci-dessous.';
    } else {
      type = 'both_diverged';
      recommendation = 'Attention, divergence double : ni la copie locale ni la copie globale ne correspondent au Catalogue maître NAS. Les deux ont divergé du Catalogue, à vérifier manuellement.';
    }

    // Signaux faibles (date de modification et richesse/taille)
    const signals = [];
    let moreRecent = 'unknown';
    const lMtime = typeof p.localMtimeMs === 'number' ? p.localMtimeMs : 0;
    const gMtime = typeof p.globalMtimeMs === 'number' ? p.globalMtimeMs : 0;

    if (lMtime > 0 && gMtime > 0) {
      if (lMtime > gMtime) {
        moreRecent = 'local';
        const diffSec = Math.round((lMtime - gMtime) / 1000);
        const diffStr = diffSec >= 3600
          ? `${Math.round(diffSec / 3600)} h`
          : diffSec >= 60
          ? `${Math.round(diffSec / 60)} min`
          : `${diffSec} s`;
        signals.push(`Signal date : la copie locale est plus récente que la copie globale (+${diffStr}).`);
      } else if (gMtime > lMtime) {
        moreRecent = 'global';
        const diffSec = Math.round((gMtime - lMtime) / 1000);
        const diffStr = diffSec >= 3600
          ? `${Math.round(diffSec / 3600)} h`
          : diffSec >= 60
          ? `${Math.round(diffSec / 60)} min`
          : `${diffSec} s`;
        signals.push(`Signal date : la copie globale est plus récente que la copie locale (+${diffStr}).`);
      } else {
        moreRecent = 'same';
        signals.push('Signal date : les deux copies ont la même date de modification.');
      }
    }

    let moreDetailed = 'unknown';
    const lChar = typeof p.localCharCount === 'number' ? p.localCharCount : 0;
    const gChar = typeof p.globalCharCount === 'number' ? p.globalCharCount : 0;
    const lTok = typeof p.localTokenCount === 'number' ? p.localTokenCount : 0;
    const gTok = typeof p.globalTokenCount === 'number' ? p.globalTokenCount : 0;

    if (lChar > 0 && gChar > 0) {
      if (lChar > gChar) {
        moreDetailed = 'local';
        const deltaChar = lChar - gChar;
        const deltaTok = Math.max(0, lTok - gTok);
        signals.push(`Signal taille : la copie locale est plus volumineuse / détaillée (+${deltaChar.toLocaleString('fr-FR')} car., +${deltaTok.toLocaleString('fr-FR')} tokens).`);
      } else if (gChar > lChar) {
        moreDetailed = 'global';
        const deltaChar = gChar - lChar;
        const deltaTok = Math.max(0, gTok - lTok);
        signals.push(`Signal taille : la copie globale est plus volumineuse / détaillée (+${deltaChar.toLocaleString('fr-FR')} car., +${deltaTok.toLocaleString('fr-FR')} tokens).`);
      } else {
        moreDetailed = 'same';
        signals.push('Signal taille : les deux copies ont exactement le même nombre de caractères.');
      }
    }

    return {
      type,
      recommendation,
      signals,
      moreRecent,
      moreDetailed,
    };
  }

  function formatMtime(mtimeMs) {
    if (!mtimeMs || mtimeMs <= 0) return 'Date inconnue';
    try {
      const d = new Date(mtimeMs);
      return d.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return 'Date inconnue';
    }
  }

  function formatSyncStatus(syncStatus) {
    switch (syncStatus) {
      case 'synced':
        return '<span class="sync-status-badge sync-synced">✅ Conforme au NAS (Maître)</span>';
      case 'modified':
        return '<span class="sync-status-badge sync-modified">⚠️ Modifié par rapport au NAS</span>';
      case 'local_only':
        return '<span class="sync-status-badge sync-local">ℹ️ Absent du Catalogue NAS</span>';
      case 'nas_offline':
        return '<span class="sync-status-badge sync-offline">⚪ Catalogue NAS hors-ligne</span>';
      default:
        return '<span class="sync-status-badge">Inconnu</span>';
    }
  }

  /**
   * Ouvre la modale de résumé comparatif pour un doublon divergent (Incrément 2)
   */
  function openCompareModal(item, doc) {
    const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!targetDoc) return;
    if (!item || !item.metadata || !item.metadata.duplicateInfo) return;

    const dup = item.metadata.duplicateInfo;

    // Retrouver la copie globale et locale
    let localItem = null;
    let globalItem = null;

    if (item.scope === 'local') {
      localItem = item;
      const gList = (currentState && currentState.globalResources) ? currentState.globalResources : [];
      globalItem = gList.find((g) => g.path === dup.duplicatePath || g.id === item.id) || null;
    } else {
      globalItem = item;
      const lList = (currentState && currentState.localResources) ? currentState.localResources : [];
      localItem = lList.find((l) => l.path === dup.duplicatePath || l.id === item.id) || null;
    }

    const localPath = localItem ? localItem.path : (item.scope === 'local' ? item.path : dup.duplicatePath);
    const globalPath = globalItem ? globalItem.path : (item.scope === 'global' ? item.path : dup.duplicatePath);

    const localChar = (localItem && typeof localItem.charCount === 'number')
      ? localItem.charCount
      : (item.scope === 'local' ? (item.charCount || 0) : (dup.twinCharCount || 0));
    const localTok = (localItem && typeof localItem.tokenCount === 'number')
      ? localItem.tokenCount
      : (item.scope === 'local' ? (item.tokenCount || 0) : (dup.twinTokenCount || 0));
    const localMtime = (localItem && typeof localItem.mtimeMs === 'number')
      ? localItem.mtimeMs
      : (item.scope === 'local' ? (item.mtimeMs || 0) : (dup.twinMtimeMs || 0));
    const localSync = (localItem && localItem.syncStatus)
      ? localItem.syncStatus
      : (item.scope === 'local' ? (item.syncStatus || 'local_only') : (dup.twinSyncStatus || 'local_only'));

    const globalChar = (globalItem && typeof globalItem.charCount === 'number')
      ? globalItem.charCount
      : (item.scope === 'global' ? (item.charCount || 0) : (dup.twinCharCount || 0));
    const globalTok = (globalItem && typeof globalItem.tokenCount === 'number')
      ? globalItem.tokenCount
      : (item.scope === 'global' ? (item.tokenCount || 0) : (dup.twinTokenCount || 0));
    const globalMtime = (globalItem && typeof globalItem.mtimeMs === 'number')
      ? globalItem.mtimeMs
      : (item.scope === 'global' ? (item.mtimeMs || 0) : (dup.twinMtimeMs || 0));
    const globalSync = (globalItem && globalItem.syncStatus)
      ? globalItem.syncStatus
      : (item.scope === 'global' ? (item.syncStatus || 'local_only') : (dup.twinSyncStatus || 'local_only'));

    const deltaChar = Math.abs(localChar - globalChar);
    const deltaTok = Math.abs(localTok - globalTok);

    let charDiffLabel = '';
    if (localChar > globalChar) {
      charDiffLabel = `Local plus détaillé : +${deltaChar.toLocaleString('fr-FR')} car. (+${deltaTok.toLocaleString('fr-FR')} tokens)`;
    } else if (globalChar > localChar) {
      charDiffLabel = `Global plus détaillé : +${deltaChar.toLocaleString('fr-FR')} car. (+${deltaTok.toLocaleString('fr-FR')} tokens)`;
    } else {
      charDiffLabel = `Tailles identiques (${localChar.toLocaleString('fr-FR')} car.)`;
    }

    const reco = computeDuplicateRecommendation({
      localSyncStatus: localSync,
      globalSyncStatus: globalSync,
      localMtimeMs: localMtime,
      globalMtimeMs: globalMtime,
      localCharCount: localChar,
      globalCharCount: globalChar,
      localTokenCount: localTok,
      globalTokenCount: globalTok,
    });

    // Supprimer une modale existante si présente
    const existing = targetDoc.getElementById('compareModalOverlay');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    const overlay = targetDoc.createElement('div');
    overlay.id = 'compareModalOverlay';
    overlay.className = 'compare-modal-overlay';

    const modal = targetDoc.createElement('div');
    modal.className = 'compare-modal';

    // Header
    const header = targetDoc.createElement('div');
    header.className = 'compare-modal-header';

    const titleEl = targetDoc.createElement('div');
    titleEl.className = 'compare-modal-title';
    titleEl.innerHTML = `<span>⚖️ Comparaison Doublon :</span> <strong>${escapeHtml(item.name || item.id)}</strong>`;

    const closeBtn = targetDoc.createElement('button');
    closeBtn.className = 'compare-modal-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Fermer (Échap)';
    closeBtn.addEventListener('click', () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    });

    header.appendChild(titleEl);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Body
    const body = targetDoc.createElement('div');
    body.className = 'compare-modal-body';

    // Grille 2 colonnes : Global vs Local
    const grid = targetDoc.createElement('div');
    grid.className = 'compare-grid';

    const localIsRecent = reco.moreRecent === 'local';
    const globalIsRecent = reco.moreRecent === 'global';

    grid.innerHTML = `
      <div class="compare-col compare-col-global">
        <div class="compare-col-header">
          <span class="compare-scope-tag tag-global">🌐 Configuration Globale</span>
          ${globalIsRecent ? '<span class="badge-recent">🕒 Plus récent</span>' : ''}
        </div>
        <div class="compare-metric-row">
          <span class="compare-metric-label">Taille :</span>
          <span class="compare-metric-value">${globalChar.toLocaleString('fr-FR')} car. <span class="tok-highlight">(${globalTok.toLocaleString('fr-FR')} tokens)</span></span>
        </div>
        <div class="compare-metric-row">
          <span class="compare-metric-label">Modification :</span>
          <span class="compare-metric-value">${formatMtime(globalMtime)}</span>
        </div>
        <div class="compare-metric-row">
          <span class="compare-metric-label">Statut NAS :</span>
          <span class="compare-metric-value">${formatSyncStatus(globalSync)}</span>
        </div>
        <div class="compare-path-box" title="${escapeHtml(globalPath)}">${escapeHtml(globalPath)}</div>
      </div>

      <div class="compare-col compare-col-local">
        <div class="compare-col-header">
          <span class="compare-scope-tag tag-local">💻 Projet Local</span>
          ${localIsRecent ? '<span class="badge-recent">🕒 Plus récent</span>' : ''}
        </div>
        <div class="compare-metric-row">
          <span class="compare-metric-label">Taille :</span>
          <span class="compare-metric-value">${localChar.toLocaleString('fr-FR')} car. <span class="tok-highlight">(${localTok.toLocaleString('fr-FR')} tokens)</span></span>
        </div>
        <div class="compare-metric-row">
          <span class="compare-metric-label">Modification :</span>
          <span class="compare-metric-value">${formatMtime(localMtime)}</span>
        </div>
        <div class="compare-metric-row">
          <span class="compare-metric-label">Statut NAS :</span>
          <span class="compare-metric-value">${formatSyncStatus(localSync)}</span>
        </div>
        <div class="compare-path-box" title="${escapeHtml(localPath)}">${escapeHtml(localPath)}</div>
      </div>
    `;

    // Écart de taille
    const diffBar = targetDoc.createElement('div');
    diffBar.className = 'compare-diff-summary';
    diffBar.innerHTML = `<strong>Écart :</strong> <span>${escapeHtml(charDiffLabel)}</span>`;

    // Boîte de Recommandation Heuristique
    const recoBox = targetDoc.createElement('div');
    recoBox.className = `compare-reco-box reco-${reco.type}`;
    let signalsHtml = '';
    if (reco.signals && reco.signals.length > 0) {
      signalsHtml = `<ul class="compare-signals-list">${reco.signals.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`;
    }
    recoBox.innerHTML = `
      <div class="compare-reco-header">
        <span class="reco-icon">💡</span>
        <strong>Recommandation heuristique (hors-ligne) :</strong>
      </div>
      <div class="compare-reco-text">${escapeHtml(reco.recommendation)}</div>
      ${signalsHtml}
    `;

    body.appendChild(grid);
    body.appendChild(diffBar);
    body.appendChild(recoBox);
    modal.appendChild(body);

    // Footer
    const footer = targetDoc.createElement('div');
    footer.className = 'compare-modal-footer';

    const btnDiff = targetDoc.createElement('button');
    btnDiff.className = 'btn btn-primary btn-diff-native';
    btnDiff.innerHTML = '↔️ Diff natif VS Code';
    btnDiff.title = 'Ouvrir les deux versions côte à côte dans l\'éditeur diff de VS Code';
    btnDiff.addEventListener('click', () => {
      vscode.postMessage({
        type: 'compareDuplicate',
        payload: {
          globalPath,
          localPath,
          title: `${item.name || item.id} (Global ↔ Local)`,
        },
      });
    });

    const btnClose = targetDoc.createElement('button');
    btnClose.className = 'btn btn-secondary';
    btnClose.textContent = 'Fermer';
    btnClose.addEventListener('click', () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    });

    footer.appendChild(btnClose);
    footer.appendChild(btnDiff);
    modal.appendChild(footer);

    overlay.appendChild(modal);

    // Clic sur l'overlay pour fermer
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
    });

    // Touche Échap
    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        targetDoc.removeEventListener('keydown', keyHandler);
      }
    };
    targetDoc.addEventListener('keydown', keyHandler);

    if (targetDoc.body) {
      targetDoc.body.appendChild(overlay);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      filterItems,
      sortItemsWithPinnedSoul,
      toggleDuplicateFilter,
      getDuplicateBadgeConfig,
      createDuplicateBadge,
      computeDuplicateRecommendation,
      openCompareModal,
      createItemCard,
      setFilterState: (state) => {
        if ('showDuplicatesOnly' in state) showDuplicatesOnly = state.showDuplicatesOnly;
        if ('currentFilter' in state) currentFilter = state.currentFilter;
        if ('searchQuery' in state) searchQuery = state.searchQuery;
      },
      getFilterState: () => ({ showDuplicatesOnly, currentFilter, searchQuery }),
    };
  }
})();
