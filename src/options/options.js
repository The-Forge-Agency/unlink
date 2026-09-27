(() => {
  const UL = globalThis.UnLink;
  const $ = (s) => document.querySelector(s);

  let savedTimer;
  function flashSaved() {
    const el = $('#saved');
    el.textContent = 'Enregistré ✓';
    el.classList.add('show');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }

  function renderPreview(s) {
    const hl = s.highlight;
    $('#preview').style.setProperty('--hl', hl.color);
    const unit = hl.delayUnit === 'hours' ? 'h' : 'j';
    const count = Math.max(hl.byCount ? hl.minMessages : 0, hl.byDelay ? hl.delayMinMessages : 0, 1);
    $('#pv-badge').textContent = `${count} sans réponse · ${hl.byDelay ? hl.delayValue + 1 : 4} ${unit}`;
    const out = $('#countdown-out');
    out.textContent = s.countdownSeconds ? `${s.countdownSeconds} s` : 'aucun';
  }

  document.body.addEventListener('unlink:filled', (e) => renderPreview(e.detail));
  $('#countdown').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('#countdown-out').textContent = v ? `${v} s` : 'aucun';
  });

  UL.bind(document.body, { onSaved: flashSaved });

  async function renderShortcuts() {
    const labels = {
      'run-cleanup': 'Nettoyer la conversation ouverte',
      'next-flagged': 'Aller à la relance suivante',
    };
    const cmds = await chrome.commands.getAll();
    const ul = $('#shortcuts');
    ul.textContent = '';
    for (const key of Object.keys(labels)) {
      const c = cmds.find((x) => x.name === key);
      if (!c) continue;
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = labels[c.name];
      li.appendChild(name);
      if (c.shortcut) {
        const k = document.createElement('kbd');
        k.textContent = c.shortcut;
        li.appendChild(k);
      } else {
        const n = document.createElement('span');
        n.className = 'none';
        n.textContent = 'non défini';
        li.appendChild(n);
      }
      ul.appendChild(li);
    }
  }
  $('#open-bulk').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'UNLINK_OPEN_BULK' }).catch(() => {}));
  $('#edit-shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

  async function renderData() {
    const d = await chrome.storage.local.get(['threads', 'cleanedCount', 'meId']);
    const n = Object.keys(d.threads || {}).length;
    const c = d.cleanedCount || 0;
    $('#data-summary').textContent =
      `${n} conversation${n > 1 ? 's' : ''} en cache · ${c} nettoyée${c > 1 ? 's' : ''} au total` +
      (d.meId ? '' : ' · profil LinkedIn pas encore identifié (ouvre la messagerie)');
  }
  $('#clear-cache').addEventListener('click', async () => {
    await chrome.storage.local.remove(['threads', 'meId', 'msgQueryId', 'identityQueryId', 'vanities']);
    renderData();
  });
  $('#reset').addEventListener('click', async () => {
    if (!confirm('Revenir aux réglages par défaut ?')) return;
    await UL.settings.reset();
    flashSaved();
  });
  chrome.storage.onChanged.addListener((_c, area) => area === 'local' && renderData());

  function renderExcluded() {
    const all = Object.entries(UL.exclusions.all()).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    const ul = $('#excluded');
    ul.textContent = '';
    for (const [id, info] of all) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `https://www.linkedin.com/in/${encodeURIComponent(id)}/`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = info.name || id;
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = info.at ? `exclu le ${new Date(info.at).toLocaleDateString('fr-FR')}` : '';
      a.appendChild(when);
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'Ne plus exclure';
      btn.addEventListener('click', () => UL.exclusions.remove(id));
      li.append(a, btn);
      ul.appendChild(li);
    }
    $('#excluded-empty').hidden = all.length > 0;
  }
  UL.exclusions.ready.then(renderExcluded);
  UL.exclusions.onChange(renderExcluded);

  renderShortcuts();
  renderData();
  window.addEventListener('focus', renderShortcuts);
})();
