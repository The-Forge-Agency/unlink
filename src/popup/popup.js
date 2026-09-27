(() => {
  const UL = globalThis.UnLink;
  const $ = (s) => document.querySelector(s);

  async function render() {
    const { cleanedCount: n = 0 } = await chrome.storage.local.get('cleanedCount');
    $('#cleaned').textContent = n ? `${n} nettoyée${n > 1 ? 's' : ''}` : '';
  }

  async function renderShortcuts() {
    const cmds = await chrome.commands.getAll();
    const run = cmds.find((c) => c.name === 'run-cleanup')?.shortcut;
    const next = cmds.find((c) => c.name === 'next-flagged')?.shortcut;
    const el = $('#shortcuts');
    el.textContent = '';
    const add = (key, label) => {
      if (!key) return;
      const k = document.createElement('kbd');
      k.textContent = key;
      el.append(k, ` ${label}  `);
    };
    add(run, 'nettoyer');
    add(next, 'relance suivante');
    if (!run && !next) el.textContent = 'Aucun raccourci défini';
  }

  $('#open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#open-bulk').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'UNLINK_OPEN_BULK' }).catch(() => {});
    window.close();
  });
  UL.bind(document.body, { onSaved: render });
  chrome.storage.onChanged.addListener(() => render());
  render();
  renderShortcuts();
})();
