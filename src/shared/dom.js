// Utilitaires DOM : recherche par texte / aria-label, attente, clics « réalistes », boîtes de dialogue.
(() => {
  const UL = (globalThis.UnLink = globalThis.UnLink || {});
  if (UL.dom) return;
  const SEL = UL.SEL;

  const norm = (s) =>
    (s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[’‘`´]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function visible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  // Libellé accessible ; LinkedIn le pose parfois sur un enfant de l'élément cliquable (menus du profil).
  function labelOf(el) {
    const own = [el.getAttribute('aria-label'), el.getAttribute('title')].filter(Boolean);
    if (!own.length) {
      const inner = el.querySelector('[aria-label]');
      if (inner && !inner.matches(SEL.clickable)) own.push(inner.getAttribute('aria-label'));
    }
    return norm(own.join(' '));
  }
  const textOf = (el) => norm(el.innerText ?? el.textContent);

  function byDocOrder(a, b) {
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }

  // Éléments cliquables dont le libellé ou le texte correspond ; ne garde que les plus profonds.
  function findAll(roots, re, { by = 'both', selector = SEL.clickable, visibleOnly = true } = {}) {
    const list = [];
    for (const root of [].concat(roots || document)) {
      if (!root?.querySelectorAll) continue;
      for (const el of root.querySelectorAll(selector)) {
        if (visibleOnly && !visible(el)) continue;
        const l = by !== 'text' ? labelOf(el) : '';
        const t = by !== 'label' ? textOf(el) : '';
        if ((l && re.test(l)) || (t && re.test(t))) list.push(el);
      }
    }
    const uniq = [...new Set(list)];
    return uniq.filter((el) => !uniq.some((o) => o !== el && el.contains(o))).sort(byDocOrder);
  }

  function waitFor(fn, { timeout = 8000, interval = 200 } = {}) {
    return new Promise((resolve) => {
      let done = false;
      let queued = false;
      let obs, iv, to;
      const finish = (v) => {
        if (done) return;
        done = true;
        obs?.disconnect();
        clearInterval(iv);
        clearTimeout(to);
        resolve(v);
      };
      const check = () => {
        queued = false;
        if (done) return;
        try {
          const v = fn();
          if (v) finish(v);
        } catch {
          /* on réessaie au prochain tick */
        }
      };
      check();
      if (done) return;
      obs = new MutationObserver(() => {
        if (!queued) {
          queued = true;
          queueMicrotask(check);
        }
      });
      obs.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-expanded', 'open'],
      });
      iv = setInterval(check, interval);
      to = setTimeout(() => finish(null), timeout);
    });
  }

  // Séquence pointer/mouse complète : marche avec les menus Ember (click) comme React/Radix (pointerdown).
  function click(el) {
    const r0 = el.getBoundingClientRect();
    if (r0.bottom < 0 || r0.top > innerHeight) {
      try {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch {
        /* ignore */
      }
    }
    const r = el.getBoundingClientRect();
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    };
    const ptr = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...ptr, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...ptr, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    el.click();
  }

  function pressEscape() {
    const opts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  function openMenus() {
    return [...document.querySelectorAll(SEL.menus)].filter(visible);
  }

  function visibleDialogs() {
    return [...document.querySelectorAll(SEL.dialogs)].filter((d) => visible(d) && !d.closest(SEL.overlay));
  }

  // Attend une boîte de dialogue apparue après notre clic et valide avec le bouton principal.
  // Renvoie true si une confirmation a eu lieu, false s'il n'y avait pas de boîte de dialogue.
  async function confirmIfAsked({ ignore = new Set(), timeout = 3000, expect = null } = {}) {
    const dlg = await waitFor(() => visibleDialogs().find((d) => !ignore.has(d)), { timeout });
    if (!dlg) return false;
    const L = UL.L;
    if (expect && !expect.test(textOf(dlg))) throw new Error('fenêtre inattendue : confirmation annulée');
    let btn = findAll(dlg, L.confirm, { selector: 'button' }).find((b) => !L.cancel.test(textOf(b)) && !L.cancel.test(labelOf(b)));
    if (!btn) {
      btn = [...dlg.querySelectorAll('button.artdeco-button--primary, button[data-test-dialog-primary-btn]')].find(
        (b) => visible(b) && !L.cancel.test(textOf(b))
      );
    }
    if (!btn) throw new Error('Bouton de confirmation introuvable');
    click(btn);
    await waitFor(() => !dlg.isConnected || !visible(dlg), { timeout: 5000 });
    return true;
  }

  UL.dom = {
    norm,
    sleep,
    visible,
    labelOf,
    textOf,
    findAll,
    waitFor,
    click,
    pressEscape,
    openMenus,
    visibleDialogs,
    confirmIfAsked,
  };
})();
