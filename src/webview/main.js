// Contrôleur client Webview pour Skills & Rules Manager
(function () {
  const vscode = acquireVsCodeApi();

  let currentState = null;
  let currentFilter = 'all';
  let searchQuery = '';
  let selectedMiniCheatSheetTool = null; // 'claude-code' | 'antigravity' | null (null = suit l'IDE)

  // Éléments DOM
  const searchInput = document.getElementById('searchInput');
  const filterChips = document.querySelectorAll('.chip-btn');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnToggleDashboard = document.getElementById('btnToggleDashboard') || document.getElementById('btnOpenDashboard');

  const searchClearBtn = document.getElementById('searchClearBtn');

  function updateSearchInputState() {
    if (searchInput) {
      if (searchInput.value && searchInput.value.trim().length > 0) {
        searchInput.classList.add('has-query');
        if (searchClearBtn) searchClearBtn.style.display = 'flex';
      } else {
        searchInput.classList.remove('has-query');
        if (searchClearBtn) searchClearBtn.style.display = 'none';
      }
    }
  }

  // Initialisation des écouteurs
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
      updateSearchInputState();
      renderCurrentView();
    });
  }

  filterChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      filterChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.getAttribute('data-filter') || 'all';
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

  // Rendu de la vue (sidebar ou dashboard)
  function renderCurrentView() {
    if (!currentState) return;

    renderHeaderStats(currentState);

    const isDashboard = document.getElementById('columnNas') !== null;
    if (isDashboard) {
      renderDashboard(currentState);
    } else {
      renderSidebar(currentState);
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
        <li><span class="cs-icon">📏</span><span><strong>Tailles max :</strong> Âme &amp; Règles &lt; 200 li. • Skills &lt; 500 li. • MCP illimité</span></li>
        <li><span class="cs-icon">⚡</span><span><strong>Âme (GEMINI.md / AGENTS.md) :</strong> Injecté en continu • Imbrication en sous-dossier</span></li>
        <li><span class="cs-icon">🎯</span><span><strong>Règles :</strong> Permanentes au démarrage • Imbriquées à la demande</span></li>
        <li><span class="cs-icon">🧠</span><span><strong>Skills :</strong> Seuls nom + description au boot • Corps lu sur disque si utile</span></li>
        <li><span class="cs-icon">🔌</span><span><strong>MCP &amp; Plugins :</strong> Aucun cap à 2 048 car. • Packs isolés &amp; Hooks de contrôle</span></li>
        <li><span class="cs-icon">🏛️</span><span><strong>Hiérarchie :</strong> N0 (Global) → N1 (Projet) → N2 (PC) → N3 (NAS) • Auto-promotion</span></li>
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

      const dupText = hasActiveDuplicates
        ? `🔥 ${dupStats.activeDuplicates} doublon${dupStats.activeDuplicates > 1 ? 's' : ''} actif${dupStats.activeDuplicates > 1 ? 's' : ''} (+${dupStats.totalWastedTokens.toLocaleString('fr-FR')} tok gaspillés)`
        : '';
      const dupTitle = hasActiveDuplicates
        ? `⚠️ Alerte Redondance :\n${dupStats.activeDuplicates} ressource(s) activée(s) à la fois en Global et en Local.\nElles consomment ${dupStats.totalWastedTokens.toLocaleString('fr-FR')} tokens en double au démarrage.\nCliquez pour afficher le premier doublon concerné.`
        : '';

      [dupPillDash, dupPillSide].forEach((pill) => {
        if (pill) {
          if (hasActiveDuplicates) {
            pill.style.display = 'inline-flex';
            pill.textContent = dupText;
            pill.title = dupTitle;
            pill.onclick = (e) => {
              e.stopPropagation();
              const searchInput = document.getElementById('searchInput');
              if (searchInput) {
                const firstDup = (state.localResources || []).find((r) => r.metadata?.duplicateInfo?.bothEnabled);
                if (firstDup) {
                  searchInput.value = firstDup.name || firstDup.id;
                  searchInput.dispatchEvent(new Event('input'));
                }
              }
            };
          } else {
            pill.style.display = 'none';
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
      setSegmentWidth('barSkillGlobal', stats.skillsGlobal ? stats.skillsGlobal.percentage : 0);
      setSegmentWidth('barSkillLocal', stats.skillsLocal ? stats.skillsLocal.percentage : 0);
      setSegmentWidth('barMcpGlobal', stats.mcpGlobal ? stats.mcpGlobal.percentage : 0);
      setSegmentWidth('barMcpLocal', stats.mcpLocal ? stats.mcpLocal.percentage : 0);

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
        totalSummaryEl.innerHTML = `Total utilisé : ${usedTokens.toLocaleString()} / ${budget.toLocaleString()} tokens (${usedPct}%)${dupNotice}`;
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

    if (valEl) {
      valEl.textContent = `${stat.tokenCount.toLocaleString()} tok (${stat.percentage}%)`;
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
          `• Tokens au Boot : ${stat.tokenCount.toLocaleString()} tok (${stat.percentage}% du budget)\n` +
          `• Caractères : ${stat.charCount.toLocaleString()} caractères` +
          extraInfo +
          `\nℹ️ 1 token ≈ 4 caractères Markdown` +
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
          `ℹ️ 1 token ≈ 4 caractères Markdown` +
          warningNote;
      } else {
        tooltipEl.textContent =
          `📁 Emplacement :\n${stat.directoryPath || 'Non défini'}\n\n` +
          `📊 Taille réelle : ${stat.charCount.toLocaleString()} caractères (${stat.tokenCount.toLocaleString()} tokens)\n` +
          `ℹ️ 1 token ≈ 4 caractères Markdown` +
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
        const isFiltered = !!searchQuery || currentFilter !== 'all';

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
      const isFiltered = !!searchQuery || currentFilter !== 'all';

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
        const isFiltered = !!searchQuery || currentFilter !== 'all';

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
        const matchId = item.id.toLowerCase().includes(searchQuery);
        const matchName = item.name.toLowerCase().includes(searchQuery);
        const matchDesc = (item.description || '').toLowerCase().includes(searchQuery);
        return matchId || matchName || matchDesc;
      }
      return true;
    });
  }

  function createItemCard(item, isDetailed) {
    const isSoul = item.type === 'soul' || (item.metadata && item.metadata.isSoul);

    const card = document.createElement('div');
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
    const topRow = document.createElement('div');
    topRow.className = 'item-top';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'item-title-wrap';

    const idEl = document.createElement('div');
    idEl.className = 'item-id';
    idEl.title = item.name || item.id;
    idEl.textContent = item.name || item.id;

    const badgesLine = document.createElement('div');
    badgesLine.className = 'item-badges-line';

    const badgeEl = document.createElement('span');
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
      const fixtureBadge = document.createElement('span');
      fixtureBadge.className = 'item-badge-pill pill-fixture';
      fixtureBadge.textContent = '🧪 Test Scénario';
      fixtureBadge.title = 'Élément de test du Banc d\'Essai. Supprimable à tout moment sans risque.';
      badgesLine.appendChild(fixtureBadge);
    }

    if (item.metadata && item.metadata.isConditional) {
      const condBadge = document.createElement('span');
      condBadge.className = 'item-badge-pill pill-cond';
      condBadge.textContent = '⚡ Conditionnel';
      condBadge.title = 'Règle conditionnelle : chargée uniquement sur trigger/glob (~20 tokens au boot pour le routeur)';
      badgesLine.appendChild(condBadge);
    }

    // Avertissement dépassement taille physique (> 24 Ko sous Antigravity)
    if (item.metadata && item.metadata.warningSizeExceeded) {
      const warnBadge = document.createElement('span');
      warnBadge.className = 'item-badge-pill pill-warn';
      warnBadge.textContent = '⚠️ > 24 Ko';
      warnBadge.title = 'Attention : ce fichier dépasse la limite physique de 24 000 octets d\'Antigravity ! Risque de troncature.';
      badgesLine.appendChild(warnBadge);
    }

    // Avertissement dépassement du nombre de lignes (> 200 pour Rules/Soul, > 500 pour Skills)
    if (item.metadata && item.metadata.warningLinesExceeded) {
      const warnLinesBadge = document.createElement('span');
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
      const warnMcpBadge = document.createElement('span');
      warnMcpBadge.className = 'item-badge-pill pill-warn';
      warnMcpBadge.textContent = '⚠️ MCP > 2 Ko';
      warnMcpBadge.title = 'Attention : dépasse le plafond de 2 048 caractères par outil sous Claude Code (risque de troncature silencieuse).';
      badgesLine.appendChild(warnMcpBadge);
    }

    // Avertissement absence de description
    if (item.metadata && item.metadata.warningNoDescription) {
      const warnNoDescBadge = document.createElement('span');
      warnNoDescBadge.className = 'item-badge-pill pill-warn-amber';
      warnNoDescBadge.textContent = '⚠️ Sans description';
      warnNoDescBadge.title = 'Attention : aucune description fournie. L\'IA aura des difficultés à identifier quand déclencher ou utiliser cette ressource.';
      badgesLine.appendChild(warnNoDescBadge);
    }

    if (item.metadata && item.metadata.pluginName) {
      const pluginBadge = document.createElement('span');
      pluginBadge.className = 'item-badge-pill pill-plugin';
      pluginBadge.textContent = `🧩 ${item.metadata.pluginName}`;
      pluginBadge.title = `Ressource issue du plugin : ${item.metadata.pluginName}`;
      badgesLine.appendChild(pluginBadge);
    }

    // Badge de Doublon (Global vs Local) avec bouton d'extinction rapide en 1 clic
    if (item.metadata && item.metadata.duplicateInfo && item.metadata.duplicateInfo.hasDuplicate) {
      const dup = item.metadata.duplicateInfo;
      const dupBadge = document.createElement('span');

      if (dup.bothEnabled) {
        if (dup.isIdentical) {
          dupBadge.className = 'item-badge-pill pill-duplicate-active';
          dupBadge.innerHTML = `<span>⚠️ Doublon actif (+${dup.wastedTokens.toLocaleString('fr-FR')} tok)</span>`;
          dupBadge.title = `Attention : cette ressource est active à la fois en Global et en Local (${dup.wastedTokens.toLocaleString('fr-FR')} tokens injectés en double au démarrage).\nDésactivez ce switch pour économiser des tokens.`;

          if (item.type !== 'soul') {
            const btnQuickOff = document.createElement('button');
            btnQuickOff.className = 'btn-quick-off';
            btnQuickOff.textContent = 'Éteindre';
            btnQuickOff.title = `Désactiver immédiatement ce doublon pour économiser ${dup.wastedTokens.toLocaleString('fr-FR')} tokens`;
            btnQuickOff.addEventListener('click', (e) => {
              e.stopPropagation();
              vscode.postMessage({
                type: 'toggle',
                payload: {
                  id: item.id,
                  scope: item.scope,
                  targetState: false,
                  type: item.type,
                  path: item.path,
                },
              });
            });
            dupBadge.appendChild(btnQuickOff);
          }
        } else {
          dupBadge.className = 'item-badge-pill pill-override-active';
          const label = item.scope === 'local' ? `⚡ Surcharge locale (+${dup.wastedTokens.toLocaleString('fr-FR')} tok)` : `⚡ Surchargé en local (+${dup.wastedTokens.toLocaleString('fr-FR')} tok)`;
          dupBadge.innerHTML = `<span>${label}</span>`;
          dupBadge.title = `Attention : le fichier local diffère du global mais les deux sont activés (+${dup.wastedTokens.toLocaleString('fr-FR')} tokens).\nDésactivez la version globale pour ce projet afin d'éviter les consignes contradictoires.`;

          if (item.scope === 'global' && item.type !== 'soul') {
            const btnQuickOff = document.createElement('button');
            btnQuickOff.className = 'btn-quick-off';
            btnQuickOff.textContent = 'Éteindre Global';
            btnQuickOff.title = `Désactiver la version globale pour laisser la surcharge locale prioritaire et économiser ${dup.wastedTokens.toLocaleString('fr-FR')} tokens`;
            btnQuickOff.addEventListener('click', (e) => {
              e.stopPropagation();
              vscode.postMessage({
                type: 'toggle',
                payload: {
                  id: item.id,
                  scope: item.scope,
                  targetState: false,
                  type: item.type,
                  path: item.path,
                },
              });
            });
            dupBadge.appendChild(btnQuickOff);
          }
        }
      } else {
        dupBadge.className = 'item-badge-pill pill-duplicate-inactive';
        if (dup.isIdentical) {
          dupBadge.textContent = '♊ Doublon (inactif)';
          dupBadge.title = `Cette ressource existe également en ${dup.duplicateScope}, mais l'une des deux copies est désactivée (aucun token gaspillé au démarrage).`;
        } else {
          dupBadge.textContent = item.scope === 'local' ? '⚡ Surcharge locale (optimisée)' : '⚡ Surchargé en local (optimisé)';
          dupBadge.title = `Surcharge personnalisée pour ce projet. Le doublon est optimisé (pas de conflit de démarrage).`;
        }
      }

      badgesLine.appendChild(dupBadge);
    }

    // Métrique Caractères + Tokens
    const charCount = typeof item.charCount === 'number' ? item.charCount : 0;
    const tokenCount = typeof item.tokenCount === 'number' ? item.tokenCount : Math.ceil(charCount / 4);

    const metricsEl = document.createElement('span');
    metricsEl.className = 'item-metrics-badge';
    const charStr = charCount.toLocaleString('fr-FR');
    const tokStr = tokenCount.toLocaleString('fr-FR');

    if (item.metadata && item.metadata.isConditional) {
      metricsEl.innerHTML = `<span>${charStr} car.</span> <span class="tok-highlight" title="Coût au boot : ~20 tokens (routeur). Fichier complet si activé : ${tokStr} tokens">~20 tok (${tokStr} plein)</span>`;
      metricsEl.title = `Règle conditionnelle :\n• Coût au boot : ~20 tokens (routeur de déclenchement)\n• Poids complet si activé : ${charStr} car. (${tokStr} tokens)`;
    } else {
      metricsEl.innerHTML = `<span>${charStr} car.</span> <span class="tok-highlight">(${tokStr} tokens)</span>`;
      metricsEl.title = `Taille réelle : ${charStr} caractères (${tokStr} tokens)\nFormule : 1 token ≈ 4 caractères Markdown`;
    }
    badgesLine.appendChild(metricsEl);

    titleWrap.appendChild(idEl);
    titleWrap.appendChild(badgesLine);
    topRow.appendChild(titleWrap);

    // Contrôles droits (Switch ON / OFF + Poubelle sécurisée OU Badge Always-On)
    if (item.scope !== 'nas') {
      const rightControls = document.createElement('div');
      rightControls.className = 'item-right-controls';

      if (isSoul) {
        // 3.A. Fichier marqué comme Verrouillé / Permanent (Always-On)
        const lockedBadge = document.createElement('div');
        lockedBadge.className = 'soul-locked-badge';
        lockedBadge.title = 'Fichier maître permanent et actif en continu (Always-On)';
        lockedBadge.innerHTML = '<span class="soul-locked-icon">🔒</span><span>Always-On</span>';
        rightControls.appendChild(lockedBadge);
      } else {
        const switchLabel = document.createElement('label');
        switchLabel.className = 'switch-label';

        const switchBox = document.createElement('div');
        switchBox.className = 'switch';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.enabled;

        const slider = document.createElement('span');
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
      const btnTrash = document.createElement('button');
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
      const descEl = document.createElement('div');
      descEl.className = 'item-description';
      descEl.textContent = item.description;
      descEl.title = item.description;
      card.appendChild(descEl);
    }

    // Footer actions
    const footer = document.createElement('div');
    footer.className = 'item-footer';

    const leftMeta = document.createElement('span');
    leftMeta.className = 'badge-tag';
    leftMeta.textContent = item.scope.toUpperCase();
    footer.appendChild(leftMeta);

    const rightActions = document.createElement('div');
    rightActions.style.display = 'flex';
    rightActions.style.gap = '4px';

    // Actions pour le NAS : Boutons d'import
    if (item.scope === 'nas') {
      const localList = (currentState && currentState.localResources) ? currentState.localResources : [];
      const globalList = (currentState && currentState.globalResources) ? currentState.globalResources : [];
      const isAlreadyInLocal = localList.some((r) => r.id === item.id);
      const isAlreadyInGlobal = globalList.some((r) => r.id === item.id);

      const btnImportLocal = document.createElement('button');
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

      const btnImportGlobal = document.createElement('button');
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

      const btnToLocal = document.createElement('button');
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

    // Bouton ouvrir fichier
    const btnOpenFile = document.createElement('button');
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

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
