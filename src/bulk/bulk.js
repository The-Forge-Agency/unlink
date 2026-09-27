// Page « Nettoyage en masse » : liste de toutes les relances (liste de travail), sélection (les décochées sont exclues
// définitivement), puis lancement d'un lot traité EN TÂCHE DE FOND par le service worker. La page peut être fermée :
// elle ne fait qu'afficher l'état du lot (chrome.storage.local « bulkJob ») et envoyer Pause / Reprendre / Arrêter.
(() => {
  const UL = globalThis.UnLink;
  const $ = (s) => document.querySelector(s);

  const PACE_LABELS = {
    safe: '10 à 20 s entre chaque personne',
    normal: '4 à 6 s entre chaque personne (≈ 5 s)',
    fast: '2 à 4 s entre chaque personne',
  };

  let rows = []; // { threadId, profileId, name, photo, headline, count, ageMs, lastText, checked, disabled }
  let job = null; // état du lot en tâche de fond
  let perRun = 7;
  let stats = { analyzed: 0, known: 0, excluded: 0, me: false };

  const jobActive = () => job && (job.state === 'running' || job.state === 'paused');
  const jobItem = (threadId) => job?.items?.find((i) => i.threadId === threadId) || null;

  // ---------- données ----------

  async function load() {
    const [settings, local] = await Promise.all([UL.settings.get(), chrome.storage.local.get(['threads', 'meId', 'excluded', 'bulkJob'])]);
    stats = { analyzed: Object.values(local.threads || {}).filter((t) => t.historyAt).length, known: Object.keys(local.threads || {}).length, excluded: Object.keys(local.excluded || {}).length, me: !!local.meId };
    perRun = Math.min(20, Math.max(1, Number(settings.bulkPerRun) || 7));
    job = local.bulkJob || null;
    const excluded = new Set(Object.keys(local.excluded || {}));
    const list = UL.stats.flaggedList(local.threads || {}, local.meId, { ...settings.highlight, enabled: true }, Date.now(), excluded);
    const previous = new Map(rows.map((r) => [r.threadId, r]));
    rows = list.map((f) => {
      const other = UL.stats.otherParticipant(f.thread, local.meId);
      const old = previous.get(f.thread.id);
      return {
        threadId: f.thread.id,
        profileId: other?.id || null,
        name: UL.stats.displayName(f.thread, local.meId),
        photo: other?.photo || '',
        headline: other?.headline || '',
        count: f.count,
        ageMs: f.ageMs,
        lastText: f.thread.lastText || '',
        disabled: !other,
        checked: other ? old?.checked ?? true : false,
      };
    });
    // Les personnes du lot (en cours ou déjà traitées) restent affichées, même si leur conversation a disparu du cache.
    const listed = new Set(rows.map((r) => r.threadId));
    for (const it of job?.items || []) {
      if (!listed.has(it.threadId)) rows.push({ ...it, disabled: false, checked: false });
    }
    if (!previous.size) {
      $('#opt-remove').checked = settings.removeConnection;
      $('#opt-delete').checked = settings.conversationAction === 'delete';
    }
    $('#per-run').textContent = `${perRun} par lancement`;
    $('#per-run-warn').textContent = `${perRun} au maximum par lancement`;
    render();
  }

  // ---------- affichage ----------

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }

  // Photo + nom (lien vers le profil) + titre professionnel + lien « Profil ↗ ».
  function personHtml(r) {
    const url = r.profileId ? `https://www.linkedin.com/in/${encodeURIComponent(r.profileId)}/` : '';
    const avatar = r.photo
      ? `<img class="avatar" src="${esc(r.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
      : `<span class="avatar ph" aria-hidden="true">${esc(initials(r.name))}</span>`;
    const name = url ? `<a class="name" href="${url}" target="_blank" rel="noopener">${esc(r.name)}</a>` : `<span class="name">${esc(r.name)}</span>`;
    const headline = r.headline ? `<div class="headline" title="${esc(r.headline)}">${esc(r.headline)}</div>` : '';
    const link = url ? `<a class="profile-link" href="${url}" target="_blank" rel="noopener">Profil ↗</a>` : '';
    return `<div class="person">${url ? `<a href="${url}" target="_blank" rel="noopener" tabindex="-1">${avatar}</a>` : avatar}<div class="who">${name}${headline}${link}</div></div>`;
  }

  function statusHtml(r) {
    if (r.disabled) return '<span class="skip">conversation de groupe — non traitée</span>';
    const it = jobItem(r.threadId);
    if (!it) return r.checked ? '<span class="skip">en attente</span>' : '<span class="skip">sera exclue au lancement</span>';
    if (it.state === 'idle') return '<span class="run">dans le lot, en attente…</span>';
    if (it.state === 'running') return '<span class="run">en cours…</span>';
    if (it.state === 'error') return `<span class="ko">✕ ${esc(it.result?.error || 'erreur')}</span>`;
    const part = (label, x) => {
      if (!x) return '';
      const cls = x.status === 'done' ? 'ok' : x.status === 'failed' ? 'ko' : 'skip';
      const icon = x.status === 'done' ? '✓' : x.status === 'failed' ? '✕' : '–';
      return `<div class="${cls}">${icon} ${label}${x.note ? ` — ${esc(x.note)}` : ''}</div>`;
    };
    return part('relation', it.result?.remove) + part('conversation', it.result?.conv);
  }

  const inJob = (r) => !!jobItem(r.threadId);
  const selectable = () => rows.filter((r) => !r.disabled && !inJob(r));

  function render() {
    const q = $('#search').value.trim().toLowerCase();
    const tbody = $('#rows');
    tbody.textContent = '';
    for (const r of rows) {
      if (q && !r.name.toLowerCase().includes(q)) continue;
      const tr = document.createElement('tr');
      tr.className = r.disabled ? 'disabled' : r.checked || inJob(r) ? '' : 'off';
      const age = r.ageMs ? ` <span class="age">· ${UL.stats.formatAge(r.ageMs)}</span>` : '';
      const lockedBox = r.disabled || inJob(r) || jobActive();
      tr.innerHTML = `
        <td class="c-check"><input type="checkbox" ${r.checked || inJob(r) ? 'checked' : ''} ${lockedBox ? 'disabled' : ''} aria-label="Sélectionner ${esc(r.name)}" /></td>
        <td>${personHtml(r)}</td>
        <td class="c-num">${r.count ?? ''} msg${age}</td>
        <td><div class="preview" title="${esc(r.lastText)}">${esc(r.lastText)}</div></td>
        <td class="c-status status">${statusHtml(r)}</td>
        <td class="c-open"><a class="open" href="https://www.linkedin.com/messaging/thread/${encodeURIComponent(r.threadId)}/" target="_blank" rel="noopener" title="Ouvrir la conversation dans LinkedIn">Ouvrir ↗</a></td>`;
      tr.querySelector('input').addEventListener('change', (e) => {
        r.checked = e.target.checked;
        render();
      });
      tbody.appendChild(tr);
    }
    const sel = selectable();
    const selected = sel.filter((r) => r.checked).length;
    $('#sel-count').textContent = `${selected} sélectionnée${selected > 1 ? 's' : ''} sur ${sel.length}`;
    $('#check-all').checked = selected > 0 && selected === sel.length;
    $('#check-all').indeterminate = selected > 0 && selected < sel.length;
    $('#check-all').disabled = jobActive();
    // État toujours visible, et page vide explicite (jamais un tableau vide sans explication).
    const nRel = rows.filter((r) => !r.disabled).length;
    $('#summary-line').textContent =
      `${stats.known} conversation${stats.known > 1 ? 's' : ''} connue${stats.known > 1 ? 's' : ''} · ${stats.analyzed} analysée${stats.analyzed > 1 ? 's' : ''} en détail · ` +
      `${nRel} relance${nRel > 1 ? 's' : ''} · ${stats.excluded} personne${stats.excluded > 1 ? 's' : ''} exclue${stats.excluded > 1 ? 's' : ''}`;
    $('#empty').hidden = rows.length > 0;
    if (!rows.length) {
      if (!stats.known) {
        $('#empty-title').textContent = 'UnLink n’a pas encore analysé ta messagerie';
        $('#empty-text').textContent =
          'Ouvre ta messagerie LinkedIn : UnLink repère les conversations où la personne insiste alors que tu n’as jamais répondu. Elles apparaîtront ici au fur et à mesure.';
        $('#empty-action').textContent = 'Ouvrir ma messagerie LinkedIn';
      } else {
        $('#empty-title').textContent = `Aucune relance parmi les ${stats.known} conversations connues`;
        $('#empty-text').textContent =
          stats.analyzed < stats.known
            ? 'L’analyse est peut-être encore en cours : garde ta messagerie ouverte quelques minutes, ou charge d’autres conversations.'
            : 'Charge d’autres conversations pour en trouver de plus anciennes, ou ajuste les règles dans les réglages.';
        $('#empty-action').textContent = 'Analyser plus de conversations';
      }
    }

    // Barre du bas : état du lot en tâche de fond
    const active = jobActive();
    $('#start').hidden = active;
    $('#pause').hidden = !active;
    $('#stop').hidden = !active;
    $('#pause').textContent = job?.state === 'paused' ? 'Reprendre' : 'Pause';
    $('#start').textContent = selected > perRun ? `Traiter les ${perRun} prochaines` : `Traiter (${selected})`;
    $('#start').disabled = selected === 0;
    const total = job?.items?.length || 0;
    $('#bar').style.width = total ? `${Math.round(((job.done || 0) / total) * 100)}%` : '0';
    let status = 'Prêt. Le traitement se fait en tâche de fond : tu peux fermer cette page une fois lancé.';
    if (job?.state === 'running') {
      const cur = job.items.find((i) => i.state === 'running');
      const wait = job.nextAt && job.nextAt > Date.now() ? ` — prochaine dans ${Math.ceil((job.nextAt - Date.now()) / 1000)} s` : '';
      status = `En cours (tâche de fond) : ${job.done}/${total}${cur ? ` — ${cur.name}` : wait}`;
    } else if (job?.state === 'paused') status = `En pause : ${job.done}/${total}. ${job.notice || ''}`;
    else if (job?.state === 'done') status = `Dernier lot terminé : ${total} traitée(s).`;
    else if (job?.state === 'stopped') status = `Dernier lot arrêté : ${job.done}/${total} traitée(s).`;
    $('#run-status').textContent = status;
  }

  // ---------- lancement / contrôle ----------

  async function start() {
    const opts = { remove: $('#opt-remove').checked, del: $('#opt-delete').checked };
    if (!opts.remove && !opts.del) return alert('Choisis au moins une action : retirer la relation et/ou supprimer la conversation.');
    const pace = document.querySelector('input[name="pace"]:checked').value;
    const selected = selectable().filter((r) => r.checked);
    const unchecked = selectable().filter((r) => !r.checked && r.profileId);
    if (!selected.length) return;
    const batch = selected.slice(0, perRun);
    const what = [opts.remove && 'retirer la relation', opts.del && 'supprimer la conversation'].filter(Boolean).join(' puis ');
    const msg =
      `${batch.length} personne(s) : ${what}.\n` +
      (selected.length > batch.length ? `Les ${selected.length - batch.length} autres restent dans la liste pour un prochain lot.\n` : '') +
      (unchecked.length ? `${unchecked.length} personne(s) décochée(s) seront exclues définitivement.\n` : '') +
      '\nChaque conversation est revérifiée juste avant d’agir. Le lot tourne en tâche de fond (garde un onglet LinkedIn ouvert). Continuer ?';
    if (!confirm(msg)) return;

    if (unchecked.length) {
      await UL.exclusions.add(unchecked.map((r) => ({ id: r.profileId, name: r.name })));
      rows = rows.filter((r) => !unchecked.includes(r));
    }
    const res = await chrome.runtime.sendMessage({
      type: 'UNLINK_BULK_START',
      opts,
      pace,
      items: batch.map((r) => ({ threadId: r.threadId, profileId: r.profileId, name: r.name, photo: r.photo, headline: r.headline, count: r.count, ageMs: r.ageMs, lastText: r.lastText })),
    });
    if (res?.error) alert(`Impossible de lancer : ${res.error}`);
  }

  const control = (action) => chrome.runtime.sendMessage({ type: 'UNLINK_BULK_CONTROL', action });

  // ---------- événements ----------

  $('#check-all').addEventListener('change', (e) => {
    for (const r of selectable()) r.checked = e.target.checked;
    render();
  });
  $('#search').addEventListener('input', render);
  $('#refresh').addEventListener('click', load);
  // Ouvre la messagerie sur la vue « Jamais répondu » (pour cette ouverture seulement) : l'analyse démarre toute seule.
  $('#empty-action').addEventListener('click', async () => {
    await chrome.storage.local.set({ filterOnce: Date.now() }); // active « Jamais répondu » pour cette ouverture seulement
    const [tab] = await chrome.tabs.query({ url: 'https://www.linkedin.com/messaging/*' });
    if (tab) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } else await chrome.tabs.create({ url: 'https://www.linkedin.com/messaging/' });
  });
  $('#start').addEventListener('click', start);
  $('#pause').addEventListener('click', () => control(job?.state === 'paused' ? 'resume' : 'pause'));
  $('#stop').addEventListener('click', () => control('stop'));
  for (const el of document.querySelectorAll('input[name="pace"]')) {
    el.addEventListener('change', () => ($('#pace-hint').textContent = PACE_LABELS[el.value]));
  }
  $('#pace-hint').textContent = PACE_LABELS.normal;
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.bulkJob) {
      job = c.bulkJob.newValue || null;
      render();
    }
    if (area === 'local' && c.threads && !jobActive()) load();
    if (area === 'sync' && c.settings) load();
  });
  setInterval(() => job?.state === 'running' && render(), 1000); // compte à rebours entre deux personnes

  load();
})();
