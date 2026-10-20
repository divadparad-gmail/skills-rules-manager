/*
 * Logique cliente de la vue Découverte & Intégration.
 *
 * Le script ne connaît ni le réseau ni le système de fichiers : il émet des
 * intentions vers l'hôte d'extension et affiche les modèles qu'il reçoit en
 * retour. Le contenu distant est inséré par `textContent` et jamais par
 * `innerHTML`, afin qu'une description de registre ne puisse pas injecter de
 * balisage dans le panneau.
 */

(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  /** État local de la vue, restauré après une mise en veille du panneau. */
  const state = {
    results: [],
    favorites: [],
    registries: [],
    history: [],
    selectedIndex: -1,
    historyIndex: -1,
  };

  const el = {
    tabs: Array.prototype.slice.call(document.querySelectorAll('.tab')),
    panels: Array.prototype.slice.call(document.querySelectorAll('.panel')),
    envHost: document.getElementById('envHost'),
    btnEnvDiagnostics: document.getElementById('btnEnvDiagnostics'),
    searchInput: document.getElementById('searchInput'),
    btnSearch: document.getElementById('btnSearch'),
    btnHistory: document.getElementById('btnHistory'),
    historyDropdown: document.getElementById('historyDropdown'),
    historyChips: document.getElementById('historyChips'),
    typePills: Array.prototype.slice.call(document.querySelectorAll('.type-pill')),
    minRating: document.getElementById('minRating'),
    verifiedOnly: document.getElementById('verifiedOnly'),
    refinements: document.getElementById('refinements'),
    searchStatus: document.getElementById('searchStatus'),
    results: document.getElementById('results'),
    favorites: document.getElementById('favorites'),
    favoriteFilter: document.getElementById('favoriteFilter'),
    favoriteSort: document.getElementById('favoriteSort'),
    btnExportFavorites: document.getElementById('btnExportFavorites'),
    btnImportFavorites: document.getElementById('btnImportFavorites'),
    registries: document.getElementById('registries'),
    btnAddRegistry: document.getElementById('btnAddRegistry'),
    newRegistryId: document.getElementById('newRegistryId'),
    newRegistryName: document.getElementById('newRegistryName'),
    newRegistryUrl: document.getElementById('newRegistryUrl'),
    newRegistryAuth: document.getElementById('newRegistryAuth'),
    nasPath: document.getElementById('nasPath'),
    nasStatus: document.getElementById('nasStatus'),
    btnBrowseNas: document.getElementById('btnBrowseNas'),
    btnValidateNas: document.getElementById('btnValidateNas'),
    geminiStatus: document.getElementById('geminiStatus'),
    btnGeminiKey: document.getElementById('btnGeminiKey'),
    notification: document.getElementById('notification'),
  };

  const DEPLOY_TARGETS = [
    { target: 'local', label: 'Intégrer au projet local', key: 'L' },
    { target: 'nas', label: 'Intégrer au NAS', key: 'N' },
    { target: 'global', label: 'Intégrer au projet global', key: 'G' },
  ];

  const TYPE_LABELS = {
    skills: 'Compétence',
    rules: 'Règle',
    workflows: 'Workflow',
    hooks: 'Hook',
  };

  // ------------------------------------------------------------------
  // Envoi d'intentions
  // ------------------------------------------------------------------

  function send(type, payload) {
    vscode.postMessage(payload === undefined ? { type: type } : { type: type, payload: payload });
  }

  function selectedTypes() {
    return el.typePills.filter(function (pill) { return pill.checked; })
      .map(function (pill) { return pill.value; });
  }

  function selectedSort() {
    const checked = document.querySelector('input[name="sortBy"]:checked');
    return checked ? checked.value : 'relevance';
  }

  function runSearch() {
    const minRating = Number(el.minRating.value);
    send('discovery:search', {
      query: el.searchInput.value,
      types: selectedTypes(),
      sortBy: selectedSort(),
      minRating: minRating > 0 ? minRating : undefined,
      verifiedOnly: el.verifiedOnly.checked,
    });
    hideHistoryDropdown();
  }

  // ------------------------------------------------------------------
  // Onglets
  // ------------------------------------------------------------------

  function activateTab(tab) {
    el.tabs.forEach(function (candidate) {
      const isActive = candidate === tab;
      candidate.classList.toggle('is-active', isActive);
      candidate.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    el.panels.forEach(function (panel) {
      const isActive = panel.id === tab.dataset.panel;
      panel.classList.toggle('is-active', isActive);
      panel.hidden = !isActive;
    });
  }

  el.tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () { activateTab(tab); });
    tab.addEventListener('keydown', function (event) {
      // Navigation horizontale entre onglets, conformément aux usages ARIA.
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const offset = event.key === 'ArrowRight' ? 1 : -1;
      const next = el.tabs[(index + offset + el.tabs.length) % el.tabs.length];
      next.focus();
      activateTab(next);
    });
  });

  // ------------------------------------------------------------------
  // Recherche et historique
  // ------------------------------------------------------------------

  el.btnSearch.addEventListener('click', runSearch);
  el.btnEnvDiagnostics.addEventListener('click', function () { send('discovery:env:diagnostics'); });

  el.searchInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      runSearch();
      return;
    }
    if (event.key === 'ArrowDown') {
      if (el.searchInput.value.trim().length === 0) {
        event.preventDefault();
        showHistoryDropdown(state.history);
        return;
      }
      if (!el.historyDropdown.hidden) {
        event.preventDefault();
        moveHistorySelection(1);
      }
      return;
    }
    if (event.key === 'ArrowUp' && !el.historyDropdown.hidden) {
      event.preventDefault();
      moveHistorySelection(-1);
      return;
    }
    if (event.key === 'Escape') {
      hideHistoryDropdown();
    }
  });

  el.searchInput.addEventListener('input', function () {
    const prefix = el.searchInput.value.trim();
    if (prefix.length === 0) {
      hideHistoryDropdown();
      return;
    }
    send('discovery:suggest', { prefix: prefix });
  });

  el.btnHistory.addEventListener('click', function () {
    if (el.historyDropdown.hidden) {
      showHistoryDropdown(state.history);
    } else {
      hideHistoryDropdown();
    }
  });

  function showHistoryDropdown(entries) {
    el.historyDropdown.textContent = '';
    state.historyIndex = -1;

    if (!entries || entries.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty-state';
      empty.textContent = 'Aucune recherche récente.';
      el.historyDropdown.appendChild(empty);
    } else {
      entries.forEach(function (entry) {
        el.historyDropdown.appendChild(buildHistoryItem(entry));
      });
      const clearItem = document.createElement('li');
      const clearButton = document.createElement('button');
      clearButton.type = 'button';
      clearButton.className = 'link-button';
      clearButton.textContent = "Vider l'historique de recherche";
      clearButton.addEventListener('click', function (event) {
        event.stopPropagation();
        send('discovery:history:clear');
        hideHistoryDropdown();
      });
      clearItem.appendChild(clearButton);
      el.historyDropdown.appendChild(clearItem);
    }

    el.historyDropdown.hidden = false;
    el.btnHistory.setAttribute('aria-expanded', 'true');
  }

  function buildHistoryItem(entry) {
    const item = document.createElement('li');
    item.setAttribute('role', 'option');

    const label = document.createElement('span');
    label.textContent = entry.query + ' · ' + formatRelativeTime(entry.timestamp);
    item.appendChild(label);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'link-button';
    remove.title = 'Retirer cette recherche de l\u2019historique';
    remove.textContent = '✕';
    remove.addEventListener('click', function (event) {
      event.stopPropagation();
      send('discovery:history:remove', { query: entry.query });
    });
    item.appendChild(remove);

    item.addEventListener('click', function () {
      applyHistoryEntry(entry);
    });
    return item;
  }

  function moveHistorySelection(offset) {
    const items = Array.prototype.slice.call(
      el.historyDropdown.querySelectorAll('li[role="option"]')
    );
    if (items.length === 0) return;

    state.historyIndex = (state.historyIndex + offset + items.length) % items.length;
    items.forEach(function (item, index) {
      item.classList.toggle('is-highlighted', index === state.historyIndex);
    });
    const selected = state.history[state.historyIndex];
    if (selected) {
      el.searchInput.value = selected.query;
    }
  }

  function applyHistoryEntry(entry) {
    el.searchInput.value = entry.query;
    el.typePills.forEach(function (pill) {
      pill.checked = entry.types.indexOf(pill.value) >= 0;
    });
    const sortInput = document.querySelector('input[name="sortBy"][value="' + entry.sortBy + '"]');
    if (sortInput) sortInput.checked = true;
    hideHistoryDropdown();
    runSearch();
  }

  function hideHistoryDropdown() {
    el.historyDropdown.hidden = true;
    state.historyIndex = -1;
    el.btnHistory.setAttribute('aria-expanded', 'false');
  }

  function renderHistoryChips(entries) {
    el.historyChips.textContent = '';
    entries.slice(0, 5).forEach(function (entry) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = entry.query;
      chip.title = 'Relancer : ' + entry.query;
      chip.addEventListener('click', function () { applyHistoryEntry(entry); });
      el.historyChips.appendChild(chip);
    });
  }

  // ------------------------------------------------------------------
  // Cartes de résultats et de favoris
  // ------------------------------------------------------------------

  function renderResults(payload) {
    state.results = payload.results;
    state.selectedIndex = -1;
    el.results.textContent = '';

    renderRefinements(payload.refinements);

    const parts = [
      payload.results.length + ' résultat(s) en ' + payload.durationMs + ' ms',
    ];
    if (payload.failures.length > 0) {
      parts.push(
        payload.failures.length + ' registre(s) en échec : ' +
        payload.failures.map(function (failure) { return failure.registryName; }).join(', ')
      );
    }
    el.searchStatus.textContent = parts.join(' — ');
    el.searchStatus.classList.toggle('is-error', payload.failures.length > 0);

    if (payload.results.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Aucune ressource ne correspond à cette description.';
      el.results.appendChild(empty);
      return;
    }

    payload.results.forEach(function (result, index) {
      el.results.appendChild(buildResultCard(result, index));
    });
  }

  function renderRefinements(refinements) {
    el.refinements.textContent = '';
    if (!refinements || refinements.length === 0) {
      el.refinements.hidden = true;
      return;
    }

    const title = document.createElement('strong');
    title.textContent = 'Votre demande peut être précisée :';
    el.refinements.appendChild(title);

    const list = document.createElement('ul');
    refinements.forEach(function (refinement) {
      const item = document.createElement('li');
      item.textContent = refinement;
      list.appendChild(item);
    });
    el.refinements.appendChild(list);
    el.refinements.hidden = false;
  }

  function buildResultCard(result, index) {
    const card = document.createElement('article');
    card.className = 'card';
    card.setAttribute('role', 'listitem');
    card.tabIndex = 0;
    card.dataset.index = String(index);

    const header = document.createElement('div');
    header.className = 'card-header';

    const title = document.createElement('span');
    title.className = 'card-title';
    title.textContent = result.name + (result.version ? ' · ' + result.version : '');
    header.appendChild(title);

    const favorite = document.createElement('button');
    favorite.type = 'button';
    favorite.className = 'favorite-toggle';
    const isFavorite = state.favorites.some(function (item) { return item.id === result.id; });
    favorite.setAttribute('aria-pressed', isFavorite ? 'true' : 'false');
    favorite.title = isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris';
    favorite.textContent = isFavorite ? '★' : '☆';
    favorite.addEventListener('click', function () {
      send('discovery:favorite:toggle', { result: result });
    });
    header.appendChild(favorite);
    card.appendChild(header);

    const description = document.createElement('p');
    description.className = 'card-description';
    description.textContent = result.description;
    card.appendChild(description);

    if (result.matchRationale) {
      const rationale = document.createElement('p');
      rationale.className = 'card-rationale';
      rationale.textContent = result.matchRationale;
      card.appendChild(rationale);
    }

    const badges = document.createElement('div');
    badges.className = 'badges';
    badges.appendChild(buildBadge(TYPE_LABELS[result.type] || result.type));
    badges.appendChild(buildBadge(result.registryName));
    if (result.metrics.verified) badges.appendChild(buildBadge('Vérifiée'));
    (result.alsoFoundIn || []).forEach(function (source) {
      badges.appendChild(buildBadge('aussi sur ' + source));
    });
    card.appendChild(badges);

    const metrics = document.createElement('div');
    metrics.className = 'metrics';
    metrics.appendChild(buildMetric('⬇ ' + formatNumber(result.metrics.downloads) + ' téléchargements'));
    metrics.appendChild(buildMetric('★ ' + result.metrics.rating.toFixed(1) + ' / 5'));
    metrics.appendChild(buildMetric('💬 ' + formatNumber(result.metrics.comments) + ' commentaires'));
    card.appendChild(metrics);

    card.appendChild(buildDeployRow(result.id));
    return card;
  }

  function buildFavoriteCard(favorite) {
    const card = document.createElement('article');
    card.className = 'card';
    card.setAttribute('role', 'listitem');
    card.tabIndex = 0;

    const header = document.createElement('div');
    header.className = 'card-header';

    const title = document.createElement('span');
    title.className = 'card-title';
    title.textContent = favorite.name;
    header.appendChild(title);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'favorite-toggle';
    remove.setAttribute('aria-pressed', 'true');
    remove.title = 'Retirer des favoris';
    remove.textContent = '★';
    remove.addEventListener('click', function () {
      send('discovery:favorite:remove', { id: favorite.id });
    });
    header.appendChild(remove);
    card.appendChild(header);

    const description = document.createElement('p');
    description.className = 'card-description';
    description.textContent = favorite.description;
    card.appendChild(description);

    const badges = document.createElement('div');
    badges.className = 'badges';
    badges.appendChild(buildBadge(TYPE_LABELS[favorite.type] || favorite.type));
    badges.appendChild(buildBadge(favorite.registryName));
    favorite.tags.forEach(function (tag) { badges.appendChild(buildBadge(tag)); });
    card.appendChild(badges);

    card.appendChild(buildDeployRow(favorite.id, true));
    return card;
  }

  function buildDeployRow(id, fromFavorites) {
    const row = document.createElement('div');
    row.className = 'button-row';
    DEPLOY_TARGETS.forEach(function (entry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary-button';
      button.textContent = entry.label;
      button.title = entry.label + ' (Alt+' + entry.key + ' sur la carte sélectionnée)';
      button.addEventListener('click', function () {
        send('discovery:deploy', { id: id, target: entry.target, fromFavorites: !!fromFavorites });
      });
      row.appendChild(button);
    });
    return row;
  }

  function buildBadge(text) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = text;
    return badge;
  }

  function buildMetric(text) {
    const metric = document.createElement('span');
    metric.textContent = text;
    return metric;
  }

  /**
   * Navigation au clavier dans la liste de résultats : flèches pour se
   * déplacer, Entrée pour ouvrir la source, Alt+L/N/G pour déployer.
   */
  el.results.addEventListener('keydown', function (event) {
    const cards = Array.prototype.slice.call(el.results.querySelectorAll('.card'));
    if (cards.length === 0) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      state.selectedIndex = (state.selectedIndex + offset + cards.length) % cards.length;
      cards.forEach(function (card, index) {
        card.classList.toggle('is-selected', index === state.selectedIndex);
      });
      cards[state.selectedIndex].focus();
      return;
    }

    if (event.altKey) {
      const match = DEPLOY_TARGETS.filter(function (entry) {
        return entry.key.toLowerCase() === event.key.toLowerCase();
      })[0];
      const result = state.results[state.selectedIndex];
      if (match && result) {
        event.preventDefault();
        send('discovery:deploy', { id: result.id, target: match.target });
      }
    }
  });

  // ------------------------------------------------------------------
  // Favoris
  // ------------------------------------------------------------------

  function renderFavorites(favorites) {
    state.favorites = favorites;
    el.favorites.textContent = '';

    const keyword = el.favoriteFilter.value.trim().toLowerCase();
    const sortMode = el.favoriteSort.value;

    let visible = favorites.filter(function (favorite) {
      if (keyword.length === 0) return true;
      return (
        favorite.name.toLowerCase().indexOf(keyword) >= 0 ||
        favorite.description.toLowerCase().indexOf(keyword) >= 0 ||
        favorite.tags.some(function (tag) { return tag.toLowerCase().indexOf(keyword) >= 0; })
      );
    });

    visible = visible.slice().sort(function (a, b) {
      if (sortMode === 'alphabetical') return a.name.localeCompare(b.name, 'fr');
      if (sortMode === 'category') {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.name.localeCompare(b.name, 'fr');
      }
      return (b.lastUsedAt || b.savedAt) - (a.lastUsedAt || a.savedAt);
    });

    if (visible.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Aucun favori enregistré pour le moment.';
      el.favorites.appendChild(empty);
      return;
    }

    visible.forEach(function (favorite) {
      el.favorites.appendChild(buildFavoriteCard(favorite));
    });
  }

  el.favoriteFilter.addEventListener('input', function () { renderFavorites(state.favorites); });
  el.favoriteSort.addEventListener('change', function () { renderFavorites(state.favorites); });
  el.btnExportFavorites.addEventListener('click', function () { send('discovery:favorites:export'); });
  el.btnImportFavorites.addEventListener('click', function () { send('discovery:favorites:import'); });

  // ------------------------------------------------------------------
  // Registres
  // ------------------------------------------------------------------

  function renderRegistries(registries) {
    state.registries = registries;
    el.registries.textContent = '';

    if (registries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Aucun registre personnalisé : seul le registre officiel est interrogé.';
      el.registries.appendChild(empty);
      return;
    }

    registries.forEach(function (registry, index) {
      el.registries.appendChild(buildRegistryRow(registry, index, registries.length));
    });
  }

  function buildRegistryRow(registry, index, total) {
    // Un registre déclaré par le dépôt ouvert ne se modifie que dans son
    // fichier .vscode/settings.json : seules la lecture et la sonde restent.
    const fromWorkspace = registry.origin === 'workspace';

    const row = document.createElement('div');
    row.className = 'registry';
    row.dataset.registryId = registry.id;

    const header = document.createElement('div');
    header.className = 'card-header';

    const toggleLabel = document.createElement('label');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = registry.enabled;
    toggle.disabled = fromWorkspace;
    toggle.addEventListener('change', function () {
      send('discovery:registry:toggle', { id: registry.id, enabled: toggle.checked });
    });
    toggleLabel.appendChild(toggle);
    const name = document.createElement('span');
    name.className = 'card-title';
    name.textContent = ' ' + registry.name + ' (priorité ' + registry.priority + ')';
    toggleLabel.appendChild(name);
    header.appendChild(toggleLabel);
    if (fromWorkspace) {
      const origin = buildBadge('défini par ce dépôt');
      origin.classList.add('badge-workspace');
      origin.title = "Registre déclaré dans le .vscode/settings.json du dépôt ouvert : il n'accède jamais à vos identifiants.";
      header.appendChild(origin);
    }
    row.appendChild(header);

    const url = document.createElement('div');
    url.className = 'registry-url';
    url.textContent = registry.url;
    row.appendChild(url);

    const actions = document.createElement('div');
    actions.className = 'button-row';

    actions.appendChild(buildRegistryAction('Tester', function () {
      send('discovery:registry:test', { id: registry.id });
    }));
    if (!fromWorkspace) {
      actions.appendChild(buildRegistryAction('Identifiants…', function () {
        send('discovery:registry:setSecret', { id: registry.id });
      }));
      if (index > 0) {
        actions.appendChild(buildRegistryAction('Monter', function () { moveRegistry(index, -1); }));
      }
      if (index < total - 1) {
        actions.appendChild(buildRegistryAction('Descendre', function () { moveRegistry(index, 1); }));
      }
      actions.appendChild(buildRegistryAction('Supprimer', function () {
        send('discovery:registry:remove', { id: registry.id });
      }));
    }
    row.appendChild(actions);

    const probe = document.createElement('div');
    probe.className = 'probe';
    probe.dataset.probeFor = registry.id;
    row.appendChild(probe);

    return row;
  }

  function buildRegistryAction(label, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button';
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  function moveRegistry(index, offset) {
    const ids = state.registries.map(function (registry) { return registry.id; });
    const target = index + offset;
    if (target < 0 || target >= ids.length) return;
    const moved = ids.splice(index, 1)[0];
    ids.splice(target, 0, moved);
    send('discovery:registry:reorder', { orderedIds: ids });
  }

  el.btnAddRegistry.addEventListener('click', function () {
    send('discovery:registry:add', {
      registry: {
        id: el.newRegistryId.value.trim(),
        name: el.newRegistryName.value.trim(),
        url: el.newRegistryUrl.value.trim(),
        authType: el.newRegistryAuth.value,
        enabled: true,
      },
    });
    el.newRegistryId.value = '';
    el.newRegistryName.value = '';
    el.newRegistryUrl.value = '';
  });

  el.btnBrowseNas.addEventListener('click', function () { send('discovery:nas:browse'); });
  el.btnValidateNas.addEventListener('click', function () { send('discovery:nas:validate'); });
  el.btnGeminiKey.addEventListener('click', function () { send('discovery:gemini:setKey'); });

  // ------------------------------------------------------------------
  // Réception des messages de l'hôte
  // ------------------------------------------------------------------

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message || typeof message.type !== 'string') return;

    switch (message.type) {
      case 'discovery:state':
        applyState(message.payload);
        break;

      case 'discovery:searching':
        el.searchStatus.classList.remove('is-error');
        el.searchStatus.textContent = 'Recherche en cours : ' + message.payload.query + '…';
        break;

      case 'discovery:results':
        renderResults(message.payload);
        break;

      case 'discovery:suggestions':
        if (message.payload.entries.length > 0) {
          showHistoryDropdown(message.payload.entries);
        } else {
          hideHistoryDropdown();
        }
        break;

      case 'discovery:favorites':
        renderFavorites(message.payload.favorites);
        break;

      case 'discovery:history':
        state.history = message.payload.entries;
        renderHistoryChips(state.history);
        break;

      case 'discovery:registries':
        renderRegistries(message.payload.registries);
        break;

      case 'discovery:registry:probe':
        renderProbe(message.payload);
        break;

      case 'discovery:nas:status':
        el.nasStatus.textContent = message.payload.message;
        el.nasStatus.classList.toggle('is-error', message.payload.status !== 'connected');
        break;

      case 'discovery:notification':
        showNotification(message.payload.level, message.payload.message);
        break;

      case 'discovery:focusSearch':
        activateTab(el.tabs[0]);
        el.searchInput.focus();
        el.searchInput.select();
        break;

      default:
        break;
    }
  });

  function applyState(payload) {
    el.envHost.textContent =
      hostLabel(payload.host) + ' · agent : ' + runtimeLabel(payload.runtime) +
      ' (score ' + payload.hostScore + '/120' + (payload.hostOverridden ? ', dérogation manuelle' : '') + ')';

    state.history = payload.recentSearches;
    renderHistoryChips(state.history);
    renderFavorites(payload.favorites);
    renderRegistries(payload.registries);

    el.nasPath.textContent = payload.nasConfigured
      ? payload.nasPath
      : "Aucun répertoire NAS n'est configuré.";
    el.geminiStatus.textContent = payload.geminiConfigured
      ? 'La recherche sémantique Gemini est active.'
      : "Aucune clé Gemini : la recherche s'appuie sur l'analyse lexicale locale.";
  }

  function renderProbe(probe) {
    const target = el.registries.querySelector('[data-probe-for="' + cssEscape(probe.registryId) + '"]');
    if (!target) return;
    target.textContent = probe.message;
    target.classList.toggle('is-connected', probe.status === 'connected');
    target.classList.toggle('is-failed', probe.status !== 'connected');
  }

  let notificationTimer = null;
  function showNotification(level, message) {
    el.notification.textContent = message;
    el.notification.hidden = false;
    el.notification.classList.toggle('is-error', level === 'error');
    el.notification.classList.toggle('is-warning', level === 'warning');

    if (notificationTimer) clearTimeout(notificationTimer);
    notificationTimer = setTimeout(function () {
      el.notification.hidden = true;
    }, 8000);
  }

  // ------------------------------------------------------------------
  // Utilitaires d'affichage
  // ------------------------------------------------------------------

  function hostLabel(host) {
    return host === 'antigravity-native' ? 'Anti-Gravity IDE : Natif' : 'VS Code : Autonome';
  }

  function runtimeLabel(runtime) {
    return runtime === 'claude-code' ? 'Claude Code' : 'Anti-Gravity';
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('fr-CA').format(value || 0);
  }

  function formatRelativeTime(timestamp) {
    const elapsed = Date.now() - (timestamp || 0);
    const minutes = Math.round(elapsed / 60000);
    if (minutes < 1) return "à l'instant";
    if (minutes < 60) return 'il y a ' + minutes + ' min';
    const hours = Math.round(minutes / 60);
    if (hours < 24) return 'il y a ' + hours + ' h';
    const days = Math.round(hours / 24);
    return 'il y a ' + days + ' j';
  }

  /** Échappement minimal pour un sélecteur d'attribut. */
  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  send('discovery:ready');
})();
