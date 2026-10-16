(function () {
  const vscode = acquireVsCodeApi();

  const tabClaude = document.getElementById('modalTabClaude');
  const tabAntigravity = document.getElementById('modalTabAntigravity');
  const contentClaude = document.getElementById('contentClaude');
  const contentAntigravity = document.getElementById('contentAntigravity');

  function switchTab(tab) {
    if (!tabClaude || !tabAntigravity || !contentClaude || !contentAntigravity) return;
    if (tab === 'claude' || tab === 'claude-code') {
      tabClaude.classList.add('active');
      tabAntigravity.classList.remove('active');
      contentClaude.style.display = 'flex';
      contentAntigravity.style.display = 'none';
    } else {
      tabAntigravity.classList.add('active');
      tabClaude.classList.remove('active');
      contentAntigravity.style.display = 'flex';
      contentClaude.style.display = 'none';
    }
  }

  if (tabClaude) {
    tabClaude.addEventListener('click', () => switchTab('claude'));
  }
  if (tabAntigravity) {
    tabAntigravity.addEventListener('click', () => switchTab('antigravity'));
  }

  // Écoute des messages depuis l'extension
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'setTool') {
      const tool = message.payload && message.payload.tool;
      switchTab(tool === 'claude-code' ? 'claude' : 'antigravity');
    }
  });

  // Gestion des boutons de copie de code
  document.querySelectorAll('.btn-copy-code').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const code = btn.getAttribute('data-code');
      if (code) {
        try {
          await navigator.clipboard.writeText(code);
          const origText = btn.textContent;
          btn.textContent = 'Copié !';
          btn.style.background = '#22c55e';
          btn.style.color = '#ffffff';
          setTimeout(() => {
            btn.textContent = origText;
            btn.style.background = '';
            btn.style.color = '';
          }, 1800);
        } catch (err) {
          console.error('Erreur de copie dans le presse-papier :', err);
        }
      }
    });
  });

  // Notifier l'extension que le panneau est prêt
  vscode.postMessage({ type: 'ready' });
})();
