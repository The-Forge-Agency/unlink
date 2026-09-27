(() => {
  const LINKS = globalThis.UnLink?.LINKS || {};

  // Liens de la configuration ; un lien non renseigné est masqué (jamais de lien cassé).
  for (const a of document.querySelectorAll('[data-link]')) {
    const url = LINKS[a.dataset.link];
    if (url) a.href = url;
    else a.hidden = true;
  }

  // Raccourci réellement configuré dans Chrome
  chrome.commands?.getAll?.().then((cmds) => {
    const s = cmds.find((c) => c.name === 'run-cleanup')?.shortcut;
    const kbd = document.getElementById('shortcut');
    if (s) kbd.textContent = s;
    else kbd.replaceWith(document.createTextNode('le raccourci (à définir dans chrome://extensions/shortcuts)'));
  });

  // Ouvre la messagerie sur la vue « Jamais répondu » (pour cette ouverture seulement) : l'analyse démarre toute seule.
  document.getElementById('open-inbox').addEventListener('click', async () => {
    await chrome.storage.local.set({ filterOnce: Date.now() }); // active « Jamais répondu » pour cette ouverture seulement
    const [tab] = await chrome.tabs.query({ url: 'https://www.linkedin.com/messaging/*' });
    if (tab) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: 'https://www.linkedin.com/messaging/' });
    }
  });

  document.getElementById('open-options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
})();
