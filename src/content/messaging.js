// Contrôleur de la messagerie LinkedIn : surbrillance des relances, filtre, boutons UnLink, exécution des nettoyages.
// Règles de sûreté : la cible (personne + conversation) vient des données de LinkedIn, jamais de l'écran seul ;
// elle est recoupée avec l'en-tête affiché ; toute ouverture de conversation est vérifiée ; rien n'est « ✓ » sans preuve.
(() => {
  const UL = globalThis.UnLink;
  if (!UL || UL.messaging) return;
  UL.messaging = true;
  const { dom, L, SEL, store, stats, ui } = UL;

  let settings = UL.settings.DEFAULTS;
  let shortcut = '';
  let observer = null;
  let scheduled = false;
  let lastHref = null;
  let queue = Promise.resolve();
  const inFlight = new Set();
  // Filtre « Relances » : n'affiche que les conversations éligibles (état mémorisé)
  let filterOn = false;
  // Chargement par lots : LinkedIn ne peut plus charger tout seul pendant le filtre (son repère « bas de liste » est
  // masqué) ; l'extension charge un lot à l'activation, puis un autre uniquement à la demande.
  const PAGES_PER_BATCH = 5; // ≈ 100 conversations
  let batchPagesLeft = 0;
  let lastAutoLoad = 0;

  const alive = () => !UL.settings.orphaned();
  function storageGet(keys) {
    try {
      return alive() ? chrome.storage.local.get(keys) : Promise.resolve({});
    } catch {
      return Promise.resolve({});
    }
  }
  function storageSet(obj) {
    try {
      if (alive()) chrome.storage.local.set(obj).catch(() => {});
    } catch {
      /* extension rechargée */
    }
  }

  storageGet('filterOn').then((d) => {
    filterOn = !!d.filterOn;
    schedule();
  });

  const isMessaging = () => location.pathname.startsWith('/messaging');

  function currentThreadId() {
    const m = location.pathname.match(/\/messaging\/thread\/([^/?#]+)/);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }

  const firstLine = (el) => (el ? (el.innerText || el.textContent || '').split('\n')[0].trim() : '');

  // ---------- fil de discussion ouvert ----------

  function threadPane() {
    return [...document.querySelectorAll(SEL.threadPane)].find(dom.visible) || null;
  }

  function findThreadOptionsButton(pane) {
    if (!pane) return null;
    const header = [...pane.querySelectorAll(SEL.threadHeader)].find(dom.visible);
    const inHeader = header && [...header.querySelectorAll(SEL.threadOptions)].find(dom.visible);
    if (inHeader) return inHeader;
    const direct = [...pane.querySelectorAll(SEL.threadOptions)].find((b) => dom.visible(b) && !b.closest(SEL.listItem));
    if (direct) return direct;
    return (
      dom
        .findAll(pane, L.threadOptions, { by: 'label', selector: 'button' })
        .find((b) => !b.closest(SEL.messageList) && !b.closest(SEL.listItem) && !b.classList.contains('unlink-thread-btn')) || null
    );
  }

  function headerName(pane) {
    if (!pane) return '';
    const el = [...pane.querySelectorAll(SEL.threadTitle)].find((e) => dom.visible(e) && !e.closest(SEL.messageList) && !e.closest(SEL.listItem));
    return firstLine(el);
  }

  // La conversation affichée est-elle bien celle-ci ? (URL + nom de l'en-tête = participant connu de LinkedIn)
  function screenShows(threadId, expectedName) {
    if (currentThreadId() !== threadId) return false;
    const hn = dom.norm(headerName(threadPane()));
    return !!hn && hn === dom.norm(expectedName);
  }

  // Qui viser pour la conversation ouverte. Uniquement à partir des données de LinkedIn (participants officiels),
  // recoupées avec le nom affiché dans l'en-tête. En cas de doute : { error } et aucune action.
  function gatherTarget() {
    const threadId = currentThreadId();
    if (!threadId) return null;
    const t = store.get(threadId);
    const me = store.meId();
    const shown = headerName(threadPane());
    const base = { threadId, name: shown || 'Conversation' };
    if (!t || !me || typeof t.group !== 'boolean') return { ...base, error: 'données de la conversation pas encore chargées, réessaie dans une seconde' };
    if (t.ownerId && t.ownerId !== me) return { ...base, error: 'conversation d’un autre compte LinkedIn' };
    const others = (t.participants || []).filter((p) => p.src === 'conv' && p.id && p.id !== me);
    const group = t.group || others.length > 1;
    if (!group && others.length === 0) {
      if (t.hasOrg) return { ...base, group: false, isCompany: true, name: shown || stats.displayName(t, me) };
      return { ...base, error: 'participant de la conversation inconnu' };
    }
    const name = group ? stats.displayName(t, me) : others[0].name;
    // L'en-tête doit afficher la même personne : sinon l'écran est en train de changer de conversation.
    if (!group && (!shown || dom.norm(shown) !== dom.norm(name || ''))) {
      return { ...base, error: 'l’écran affiche une autre personne que la conversation ouverte, réessaie' };
    }
    if (group) return { ...base, group: true, name };
    const p = others[0];
    return {
      threadId,
      group: false,
      isCompany: false,
      profileId: p.id,
      profileUrl: `https://www.linkedin.com/in/${p.id}/`,
      name,
      firstName: p.firstName,
      lastName: p.lastName,
    };
  }

  // Secours : menu « … » de l'en-tête → Supprimer / Archiver, en revérifiant à chaque étape que c'est la bonne conversation.
  async function conversationAction(action, target) {
    if (!screenShows(target.threadId, target.name)) throw new Error('la conversation affichée a changé, action annulée');
    const pane = threadPane();
    const btn = findThreadOptionsButton(pane);
    if (!btn) throw new Error('menu de la conversation introuvable');
    const before = new Set(dom.visibleDialogs());
    dom.click(btn);
    const re = action === 'archive' ? L.archiveConversation : L.deleteConversation;
    const item = await dom.waitFor(() => {
      const menus = dom.openMenus();
      return dom.findAll(menus.length ? menus : [pane], re).find((el) => el !== btn && !el.closest(SEL.listItem));
    }, { timeout: 4000 });
    if (!item) {
      dom.pressEscape();
      throw new Error(`option « ${action === 'archive' ? 'Archiver' : 'Supprimer la discussion'} » introuvable`);
    }
    if (!screenShows(target.threadId, target.name)) {
      dom.pressEscape();
      throw new Error('la conversation affichée a changé, action annulée');
    }
    dom.click(item);
    if (action === 'delete') {
      const confirmed = await dom.confirmIfAsked({ ignore: before, timeout: 4000, expect: L.deleteDialog });
      if (!confirmed) throw new Error('confirmation de suppression non détectée');
      // Preuve : la conversation doit être vide côté LinkedIn.
      for (const wait of [300, 600, 1200]) {
        await dom.sleep(wait);
        if ((await UL.api.conversationGone(target.threadId).catch(() => null)) === true) return;
      }
      throw new Error('suppression non confirmée par LinkedIn');
    }
    if (!(await dom.waitFor(() => currentThreadId() !== target.threadId, { timeout: 3000 }))) {
      throw new Error('archivage non confirmé');
    }
  }

  // ---------- liste des conversations ----------

  function listItems() {
    const all = [...document.querySelectorAll(SEL.listItem)];
    return all.filter((li) => !all.some((o) => o !== li && li.contains(o)));
  }

  const itemName = (li) => firstLine(li.querySelector(SEL.itemName));
  const itemSnippet = (li) => dom.norm(li.querySelector(SEL.itemSnippet)?.innerText || '');
  const hiddenByUs = (li) => li.dataset.unlinkGone === '1';

  function itemUnread(li) {
    const el = li.querySelector(SEL.itemUnread);
    if (!el || !dom.visible(el)) return 0;
    const n = parseInt((el.innerText || el.textContent || '').replace(/\D+/g, ' ').trim(), 10);
    return Number.isFinite(n) ? n : 0;
  }

  function hrefThreadId(li) {
    const m = li.querySelector('a[href*="/messaging/thread/"]')?.getAttribute('href')?.match(/\/messaging\/thread\/([^/?#]+)/);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }

  // Conversation associée à une ligne (calculée par assignThreadIds, valable tant que la ligne affiche le même nom).
  function itemThreadId(li) {
    const direct = hrefThreadId(li);
    if (direct) return direct;
    const name = dom.norm(itemName(li));
    if (name && li.dataset.unlinkThread && li.dataset.unlinkName === name) return li.dataset.unlinkThread;
    return null;
  }

  // Texte de l'aperçu sans le préfixe « Nom : ».
  function snippetBody(li) {
    return itemSnippet(li).replace(/^[^:]{1,80}:\s*/, '').replace(/[….]+$/, '').trim();
  }

  // Associe chaque ligne à sa conversation. La liste n'expose aucun identifiant : on associe par le nom, et s'il y a
  // des homonymes, par l'aperçu du dernier message. Au moindre doute, la ligne reste non associée (jamais surlignée).
  function assignThreadIds(items) {
    for (const li of items) {
      const name = dom.norm(itemName(li));
      let id = null;
      if (name && !hiddenByUs(li)) {
        id = hrefThreadId(li);
        if (!id) {
          const cands = store.findAllByName(name);
          if (cands.length === 1) id = cands[0];
          else if (cands.length > 1) {
            const snip = snippetBody(li).slice(0, 30);
            const match = snip.length >= 6 ? cands.filter((cid) => dom.norm(store.get(cid)?.lastText || '').startsWith(snip)) : [];
            id = match.length === 1 ? match[0] : null;
          }
        }
      }
      if (id) {
        if (li.dataset.unlinkThread !== id) li.dataset.unlinkThread = id;
        if (li.dataset.unlinkName !== name) li.dataset.unlinkName = name;
      } else if (li.dataset.unlinkThread) {
        delete li.dataset.unlinkThread;
        delete li.dataset.unlinkName;
      }
    }
  }

  // Ouvre une ligne et vérifie que c'est bien la conversation attendue qui s'affiche. Lève une erreur sinon.
  async function openListItem(li, expectedName, expectedId = null) {
    if (!li.isConnected || dom.norm(itemName(li)) !== dom.norm(expectedName)) throw new Error('la liste a changé, réessaie');
    const before = currentThreadId();
    const target = SEL.itemLink.map((s) => li.querySelector(s)).find(Boolean) || li;
    dom.click(target);
    const ok = await dom.waitFor(() => {
      const cur = currentThreadId();
      if (!cur || (expectedId ? cur !== expectedId : cur === before)) return false;
      return dom.norm(headerName(threadPane())) === dom.norm(expectedName) && !!findThreadOptionsButton(threadPane());
    }, { timeout: 8000 });
    if (!ok) throw new Error('la conversation ne s’est pas ouverte correctement, réessaie');
    await dom.sleep(200);
  }

  async function ensureThreadOpen(target) {
    if (screenShows(target.threadId, target.name)) return;
    const li = listItems().find((x) => itemThreadId(x) === target.threadId);
    if (!li) throw new Error('conversation plus affichée — rouvre-la et relance');
    await openListItem(li, target.name, target.threadId);
  }

  // Masque la ligne d'une conversation supprimée (uniquement par identifiant, jamais par nom).
  function hideItem(threadId) {
    for (const li of listItems()) {
      if (itemThreadId(li) === threadId) {
        li.dataset.unlinkGone = '1';
        li.style.setProperty('display', 'none', 'important');
      }
    }
  }

  // Après une suppression par requête directe, l'interface de LinkedIn n'est pas prévenue :
  // on ouvre la conversation suivante (vérifiée) et on masque celle qui a été supprimée.
  async function leaveDeletedThread(threadId) {
    const items = listItems();
    const idx = items.findIndex((li) => itemThreadId(li) === threadId);
    hideItem(threadId);
    if (currentThreadId() !== threadId) return;
    const next = items
      .slice(idx + 1)
      .concat(items.slice(0, Math.max(idx, 0)))
      .find((li) => itemThreadId(li) !== threadId && !hiddenByUs(li) && itemName(li));
    if (next) await openListItem(next, itemName(next)).catch(() => {});
    else location.assign('/messaging/');
  }

  function stopAll(el) {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'click') e.preventDefault();
      });
    }
  }

  function clearItem(li) {
    li.removeAttribute('data-unlink-flag');
    li.removeAttribute('data-unlink-known');
    li.querySelector(':scope > .unlink-badge')?.remove();
  }

  function renderItem(li, r, id) {
    if (!li.hasAttribute('data-unlink-item')) li.setAttribute('data-unlink-item', '');
    if (!li.hasAttribute('data-unlink-known')) li.setAttribute('data-unlink-known', '');
    if (r.flagged !== li.hasAttribute('data-unlink-flag')) li.toggleAttribute('data-unlink-flag', r.flagged);

    let badge = li.querySelector(':scope > .unlink-badge');
    if (r.flagged) {
      const age = r.ageMs ? ` · ${stats.formatAge(r.ageMs)}` : '';
      const label = `${r.count} sans réponse${age}`;
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'unlink-badge';
        badge.innerHTML = '<span></span><button type="button" title="Ignorer cette relance (jusqu’au prochain message)">×</button>';
        stopAll(badge);
        badge.querySelector('button').addEventListener('click', () => {
          const tid = badge.dataset.thread;
          if (tid) store.patch(tid, { dismissedAt: Date.now() });
        });
        li.appendChild(badge);
      }
      if (badge.firstChild.textContent !== label) badge.firstChild.textContent = label;
      if (badge.dataset.thread !== (id || '')) badge.dataset.thread = id || '';
      badge.lastChild.hidden = !id;
    } else if (badge) {
      badge.remove();
    }

    let quick = li.querySelector(':scope > .unlink-quick');
    if (settings.showListButtons) {
      if (!quick) {
        quick = document.createElement('button');
        quick.type = 'button';
        quick.className = 'unlink-quick';
        quick.title = 'UnLink : nettoyer cette conversation';
        quick.innerHTML = ui.BOLT;
        stopAll(quick);
        quick.addEventListener('click', () => runFromItem(li));
        li.appendChild(quick);
      }
    } else if (quick) {
      quick.remove();
    }
  }

  function scanList() {
    const items = listItems();
    const me = store.meId();
    const hl = settings.highlight;
    const now = Date.now();
    assignThreadIds(items);
    for (const li of items) {
      // LinkedIn vide les conversations hors écran : sans nom, on ne peut rien affirmer → aucune surbrillance.
      if (!itemName(li) || hiddenByUs(li)) {
        clearItem(li);
        continue;
      }
      const id = itemThreadId(li);
      const unread = itemUnread(li);
      let r;
      if (id) {
        const t = store.get(id);
        const p = {};
        if ((t?.unreadCount || 0) !== unread) p.unreadCount = unread;
        if (L.mePrefix.test(itemSnippet(li)) && !t?.answeredHintAt) p.answeredHintAt = now;
        if (Object.keys(p).length) store.patch(id, p);
        r = stats.evaluate(store.get(id), me, hl, now, UL.exclusions.set());
      } else {
        r = stats.evaluateDomOnly();
      }
      renderItem(li, r, id);
    }
  }

  // Lit le fil ouvert : un de nos messages visible = preuve de réponse. Uniquement si l'en-tête correspond
  // à la conversation de l'URL (pendant un changement de conversation, l'ancien fil peut encore être affiché).
  function scanOpenThread(tid) {
    const t = store.get(tid);
    const pane = threadPane();
    if (!t || !pane || !pane.getElementsByClassName(SEL.otherMessage).length) return;
    const expected = store.threadName(t);
    if (!expected || dom.norm(headerName(pane)) !== expected) return;
    const events = pane.querySelectorAll(SEL.messageEvent);
    let count = 0;
    let mine = false;
    for (let i = events.length - 1; i >= 0; i--) {
      const m = events[i].querySelector(SEL.anyMessage);
      if (!m) continue;
      if (m.classList.contains(SEL.otherMessage)) count++;
      else {
        mine = true;
        break;
      }
    }
    if (mine && !t.domHasMine) store.patch(tid, { domHasMine: true });
    else if (!mine && t.domCount !== count) store.patch(tid, { domCount: count, domCountAt: Date.now() });
  }

  function buttonTitle() {
    return `UnLink : nettoyer cette conversation${shortcut ? ` (${shortcut})` : ''}`;
  }

  function injectThreadButton(tid) {
    const existing = document.querySelector('.unlink-thread-btn');
    if (!tid || !settings.showThreadButton) {
      existing?.remove();
      ui.fab(false);
      return;
    }
    const pane = threadPane();
    const opt = findThreadOptionsButton(pane);
    if (!opt) {
      existing?.remove();
      ui.fab(true, runCurrent, buttonTitle());
      return;
    }
    ui.fab(false);
    if (existing && pane.contains(existing)) return;
    existing?.remove();
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'unlink-thread-btn';
    b.title = buttonTitle();
    b.innerHTML = `${ui.BOLT}<span>UnLink</span>`;
    stopAll(b);
    b.addEventListener('click', runCurrent);
    const anchor = opt.closest('.artdeco-dropdown') || opt;
    anchor.parentElement.insertBefore(b, anchor);
  }

  // Bouton « Charger plus » en bas de la liste : trouvé par sa structure (dernière ligne qui n'est pas une conversation
  // et contient un bouton), le texte ne sert que de confirmation — fonctionne quelle que soit la langue.
  function findLoadMore(ul) {
    const extra = [...ul.children].filter((li) => li.tagName === 'LI' && !li.matches(SEL.listItem));
    const last = extra[extra.length - 1];
    const btn = last && last.querySelector('button, [role="button"]');
    if (!btn) return null;
    const isLast = ![...ul.children].slice([...ul.children].indexOf(last) + 1).some((c) => c.matches?.(SEL.listItem));
    return isLast || L.loadMore.test(dom.textOf(btn)) ? btn : null;
  }

  // Barre « ⚡ Relances » au-dessus de la liste. Filtre actif : les conversations identifiées comme non éligibles
  // sont masquées (celles que LinkedIn n'a pas encore affichées restent visibles le temps d'être analysées),
  // et la suite de la liste est chargée automatiquement pour trouver les relances plus anciennes.
  function injectFilterBar() {
    const ul = document.querySelector(SEL.list);
    if (!ul) return;
    let bar = ul.parentElement.querySelector(':scope > .unlink-filter-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'unlink-filter-bar';
      bar.innerHTML = `<button type="button" class="unlink-filter-chip" aria-pressed="false">${ui.BOLT}<span>Relances</span><b></b></button><span class="unlink-filter-hint"></span><button type="button" class="unlink-filter-more" hidden>+ 100 conversations</button><button type="button" class="unlink-filter-bulk" title="Nettoyer plusieurs relances d’un coup">Tout nettoyer…</button>`;
      stopAll(bar);
      bar.querySelector('.unlink-filter-bulk').addEventListener('click', () => {
        try {
          chrome.runtime.sendMessage({ type: 'UNLINK_OPEN_BULK' }).catch(() => {});
        } catch {
          ui.notify('Extension rechargée : actualise la page LinkedIn.', 'warn');
        }
      });
      bar.querySelector('.unlink-filter-more').addEventListener('click', () => {
        batchPagesLeft = PAGES_PER_BATCH;
        schedule();
      });
      bar.querySelector('button').addEventListener('click', () => {
        filterOn = !filterOn;
        batchPagesLeft = filterOn ? PAGES_PER_BATCH : 0;
        storageSet({ filterOn });
        if (!filterOn) ul.scrollTop = 0;
        schedule();
      });
      ul.parentElement.insertBefore(bar, ul);
    }
    // Compteur : toutes les relances confirmées (y compris les lignes que LinkedIn a vidées hors écran).
    const flaggedRows = listItems().filter((li) => li.hasAttribute('data-unlink-flag')).length;
    const flagged = Math.max(flaggedRows, stats.flaggedList(store.all(), store.meId(), settings.highlight, Date.now(), UL.exclusions.set()).length);
    const chip = bar.querySelector('button');
    if (chip.getAttribute('aria-pressed') !== String(filterOn)) chip.setAttribute('aria-pressed', String(filterOn));
    const count = String(flagged);
    if (chip.querySelector('b').textContent !== count) chip.querySelector('b').textContent = count;
    if (filterOn !== ul.hasAttribute('data-unlink-filter')) ul.toggleAttribute('data-unlink-filter', filterOn);

    const loadMore = findLoadMore(ul);
    let hint = '';
    if (filterOn) {
      if (loadMore && batchPagesLeft > 0 && Date.now() - lastAutoLoad > 1500) {
        batchPagesLeft--;
        lastAutoLoad = Date.now();
        loadMore.click(); // fonctionne même si le bouton est masqué par le filtre
      }
      if (loadMore && batchPagesLeft > 0) hint = 'Chargement d’un lot de conversations…';
      else if (!flagged) hint = 'Aucune relance';
    }
    const h = bar.querySelector('.unlink-filter-hint');
    if (h.textContent !== hint) h.textContent = hint;
    const more = bar.querySelector('.unlink-filter-more');
    const showMore = filterOn && !!loadMore && batchPagesLeft === 0;
    if (more.hidden === showMore) more.hidden = !showMore;
  }

  function refresh() {
    if (!isMessaging() || !alive() || document.hidden) return;
    const tid = currentThreadId();
    try {
      if (tid) scanOpenThread(tid);
      scanList();
      injectFilterBar();
      injectThreadButton(tid);
    } catch (e) {
      console.warn('[UnLink] refresh', e);
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      refresh();
    }, 250);
  }

  const OWN = '.unlink-badge, .unlink-quick, .unlink-thread-btn, .unlink-filter-bar, unlink-root';
  function isOwnMutation(m) {
    const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    if (t?.closest?.(OWN)) return true;
    if (m.type !== 'childList') return false;
    const nodes = [...m.addedNodes, ...m.removedNodes];
    return nodes.length > 0 && nodes.every((n) => n.nodeType === 1 && n.matches(OWN));
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((muts) => {
      if (!muts.every(isOwnMutation)) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function stopObserver() {
    observer?.disconnect();
    observer = null;
    document.querySelector('.unlink-thread-btn')?.remove();
    ui.fab(false);
  }

  function onRoute() {
    if (isMessaging()) {
      startObserver();
      schedule();
    } else {
      stopObserver();
    }
  }

  // ---------- exécution ----------

  function enqueue(fn, key) {
    if (key) inFlight.add(key);
    queue = queue
      .then(fn)
      .catch((e) => {
        console.warn('[UnLink]', e);
        ui.notify(e?.message || String(e), 'warn', 5000);
      })
      .finally(() => key && inFlight.delete(key));
  }

  function extensionError(e) {
    const msg = e?.message || String(e);
    return /context invalidated|receiving end|message port closed/i.test(msg) ? 'extension rechargée : actualise la page LinkedIn' : msg;
  }

  // Retrait de la relation, par requête directe puis (en secours) par l'onglet profil. Le résultat final est toujours
  // relu auprès de LinkedIn : « fait » uniquement si la personne n'est plus une relation.
  async function removeRelation(target, s, card) {
    let apiResult = null;
    if (s.method !== 'ui') {
      apiResult = await UL.api.removeConnection({ profileId: target.profileId, firstName: target.firstName, lastName: target.lastName });
      if (apiResult.status !== 'failed') return apiResult;
      card.setStep('remove', 'running', `${apiResult.note} — essai via le profil`);
    }
    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: 'UNLINK_PROFILE_JOB',
        profileUrl: target.profileUrl,
        unfollow: false,
        removeConnection: true,
        mode: s.profileTabMode,
        keepTabOnFailure: s.keepTabOnFailure,
      });
    } catch (e) {
      res = { error: extensionError(e) };
    }
    const relation = await UL.api.relationOf(target.profileId).catch(() => null);
    if (relation === 'not_connected') {
      const wasConnected = apiResult?.wasConnected || res?.removeConnection?.status === 'done';
      return wasConnected ? { status: 'done', note: '' } : { status: 'skipped', note: 'pas en relation' };
    }
    if (res?.keptTab) ui.notify('Onglet du profil laissé ouvert pour finir à la main.', 'warn', 5000);
    const why = res?.error || res?.removeConnection?.note || '';
    return { status: 'failed', note: relation === 'connected' ? `toujours en relation${why ? ` (${why})` : ''}` : 'relation non vérifiable' };
  }

  async function runJob(target) {
    const s = settings;
    const steps = [];
    if (s.unfollow) steps.push({ key: 'unfollow', label: 'Ne plus suivre' });
    if (s.removeConnection) steps.push({ key: 'remove', label: 'Retirer la relation' });
    if (s.conversationAction !== 'none') {
      steps.push({ key: 'conv', label: s.conversationAction === 'archive' ? 'Archiver la conversation' : 'Supprimer la conversation' });
    }
    if (!steps.length) {
      ui.notify('Aucune action activée — ouvre les réglages UnLink.', 'warn');
      return;
    }

    // Préparation (relation + identifiant public) pendant le délai d'annulation.
    if (s.removeConnection && s.method !== 'ui' && target.profileId) UL.api.prepare(target.profileId);
    const card = ui.jobCard({ title: target.name, steps, profileUrl: target.profileUrl });
    if (s.countdownSeconds > 0 && !(await card.countdown(s.countdownSeconds))) {
      card.cancel();
      return;
    }

    const startedAt = performance.now();
    let profileOk = true;
    const profileKeys = steps.map((x) => x.key).filter((k) => k !== 'conv');
    const setAll = (state, note) => profileKeys.forEach((k) => card.setStep(k, state, note));
    if (profileKeys.length) {
      if (target.group) setAll('skipped', 'conversation de groupe');
      else if (target.isCompany) setAll('skipped', 'message d’une page entreprise');
      else {
        setAll('running');
        if (s.removeConnection) {
          const r = await removeRelation(target, s, card);
          card.setStep('remove', r.status, r.note || '');
          if (r.status === 'failed') profileOk = false;
        }
        if (s.unfollow) {
          let res;
          try {
            res = await chrome.runtime.sendMessage({
              type: 'UNLINK_PROFILE_JOB',
              profileUrl: target.profileUrl,
              unfollow: true,
              removeConnection: false,
              mode: s.profileTabMode,
              keepTabOnFailure: s.keepTabOnFailure,
            });
          } catch (e) {
            res = { error: extensionError(e) };
          }
          const r = res?.error ? { status: 'failed', note: res.error } : res?.unfollow || { status: 'failed', note: 'aucun résultat' };
          card.setStep('unfollow', r.status, r.note || '');
          if (r.status === 'failed') profileOk = false;
        }
      }
    }

    if (s.conversationAction !== 'none') {
      if (!profileOk && !s.conversationEvenIfProfileFails) {
        card.setStep('conv', 'skipped', 'conservée car une étape a échoué');
      } else {
        card.setStep('conv', 'running');
        try {
          // Suppression : requête directe d'abord (vérifiée), menu « … » en secours (revérifié à chaque étape).
          const direct = s.conversationAction === 'delete' && s.method !== 'ui' ? await UL.api.deleteConversation(target.threadId) : null;
          if (direct?.status === 'done') {
            await leaveDeletedThread(target.threadId);
          } else {
            if (direct) card.setStep('conv', 'running', `${direct.note} — essai via le menu`);
            await ensureThreadOpen(target);
            await conversationAction(s.conversationAction, target);
            if (s.conversationAction === 'delete') hideItem(target.threadId);
          }
          card.setStep('conv', 'done');
          if (s.conversationAction === 'delete') store.remove(target.threadId);
          else store.patch(target.threadId, { dismissedAt: Date.now() });
        } catch (e) {
          card.setStep('conv', 'failed', e?.message || String(e));
        }
      }
    }

    const ok = !card.states().includes('failed');
    card.finish(ok, { elapsedMs: performance.now() - startedAt });
    if (ok) storageGet('cleanedCount').then((d) => storageSet({ cleanedCount: (d.cleanedCount || 0) + 1 }));
  }

  function runCurrent() {
    if (!isMessaging()) {
      ui.notify('Ouvre la messagerie LinkedIn pour utiliser UnLink.', 'warn');
      return;
    }
    const target = gatherTarget();
    if (!target) {
      ui.notify('Ouvre d’abord une conversation.', 'warn');
      return;
    }
    if (target.error) {
      ui.notify(`Rien n’a été fait : ${target.error}.`, 'warn', 5000);
      return;
    }
    if (inFlight.has(target.threadId)) return;
    enqueue(() => runJob(target), target.threadId);
  }

  function runFromItem(li) {
    const name = itemName(li);
    const id = itemThreadId(li);
    if (!name) return;
    if (id && inFlight.has(id)) return;
    enqueue(async () => {
      // Toujours vérifier que la conversation ouverte est bien celle de la ligne cliquée.
      if (!(id && screenShows(id, name))) await openListItem(li, name, id);
      const target = gatherTarget();
      if (!target) throw new Error('impossible d’ouvrir la conversation');
      if (target.error) throw new Error(`Rien n’a été fait : ${target.error}`);
      if (id && target.threadId !== id) throw new Error('Rien n’a été fait : une autre conversation s’est ouverte');
      await runJob(target);
    }, id);
  }

  function nextFlagged() {
    if (!isMessaging()) {
      ui.notify('Ouvre la messagerie LinkedIn pour naviguer entre les relances.', 'warn');
      return;
    }
    const items = listItems().filter((li) => li.hasAttribute('data-unlink-flag'));
    if (!items.length) {
      ui.notify('Aucune relance dans la liste affichée.');
      return;
    }
    const cur = currentThreadId();
    const idx = items.findIndex((li) => itemThreadId(li) === cur);
    const next = items[(idx + 1) % items.length];
    if (idx >= 0 && next === items[idx]) {
      ui.notify('C’est la seule relance de la liste.');
      return;
    }
    next.scrollIntoView({ block: 'center' });
    openListItem(next, itemName(next), itemThreadId(next)).catch(() => {});
  }

  // ---------- action de masse (pilotée par la page « Nettoyage en masse ») ----------

  // Traite UNE conversation, uniquement par requêtes directes, avec toutes les vérifications :
  // conversation à deux avec un participant officiel, historique complet relu à l'instant sans aucun message de nous,
  // relation vérifiée avant/après, suppression relue. Renvoie { remove, conv } (statut + note pour chacun).
  async function bulkItem({ threadId, profileId, removeConnection, deleteConversation }) {
    await store.ready;
    const me = store.meId();
    const t = store.get(threadId);
    const other = stats.otherParticipant(t, me);
    const skip = (note) => ({ remove: { status: 'skipped', note }, conv: { status: 'skipped', note } });
    if (!me || !t) return skip('conversation inconnue (recharge la messagerie)');
    if (!other || other.id !== profileId) return skip('interlocuteur non vérifiable');
    if (UL.exclusions.has(other.id)) return skip('personne exclue');

    const h = await UL.api.historyCheck(threadId).catch(() => ({ ok: false }));
    if (!h.ok) return skip('historique illisible');
    if (h.mine > 0) {
      store.patch(threadId, { domHasMine: true }); // on a répondu entre-temps : plus jamais proposée
      return skip('tu as écrit dans cette conversation');
    }
    if (!h.complete || h.unknown > 0) return skip('historique incomplet, par prudence');

    const out = { remove: { status: 'skipped', note: 'non demandé' }, conv: { status: 'skipped', note: 'non demandé' } };
    if (removeConnection) {
      out.remove = await UL.api.removeConnection({ profileId: other.id, firstName: other.firstName, lastName: other.lastName });
    }
    if (deleteConversation) {
      if (out.remove.status === 'failed') out.conv = { status: 'skipped', note: 'conservée car le retrait a échoué' };
      else {
        out.conv = await UL.api.deleteConversation(threadId);
        if (out.conv.status === 'done') {
          store.remove(threadId);
          if (isMessaging()) hideItem(threadId);
        }
      }
    }
    return out;
  }

  // ---------- démarrage ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'UNLINK_BULK_ITEM') {
      bulkItem(msg).then(sendResponse, (e) => sendResponse({ error: e?.message || String(e) }));
      return true;
    }
    if (msg?.type === 'UNLINK_RUN') runCurrent();
    else if (msg?.type === 'UNLINK_NEXT') nextFlagged();
    else return;
    sendResponse({ ok: true });
  });

  UL.settings.onChange((s) => {
    settings = s;
    ui.setAccent(s.highlight.color);
    schedule();
  });
  store.onUpdate(schedule);
  UL.exclusions.onChange(schedule);
  document.addEventListener('visibilitychange', () => !document.hidden && schedule());

  let routeTimer = null;
  function teardown() {
    clearInterval(routeTimer);
    stopObserver();
    document.querySelectorAll('.unlink-badge, .unlink-quick, .unlink-thread-btn, .unlink-filter-bar').forEach((el) => el.remove());
    document.querySelectorAll('[data-unlink-flag]').forEach((el) => el.removeAttribute('data-unlink-flag'));
    document.querySelector('[data-unlink-filter]')?.removeAttribute('data-unlink-filter');
  }

  Promise.all([UL.settings.get(), store.ready])
    .then(([s]) => {
      settings = s;
      ui.pageStyle(s.highlight.color);
      routeTimer = setInterval(() => {
        if (!alive()) return teardown(); // extension rechargée : cet onglet doit être actualisé
        if (location.href !== lastHref) {
          lastHref = location.href;
          onRoute();
        }
      }, 400);
      if (!store.meId() && isMessaging()) store.fetchMe();
    })
    .catch(() => {});

  try {
    chrome.runtime
      .sendMessage({ type: 'UNLINK_GET_SHORTCUT' })
      .then((r) => (shortcut = r?.shortcut || ''))
      .catch(() => {});
  } catch {
    /* extension rechargée */
  }
})();
