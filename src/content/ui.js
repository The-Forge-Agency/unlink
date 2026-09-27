// UI injectée dans LinkedIn : cartes de progression (shadow DOM isolé), styles de surbrillance, bouton flottant.
(() => {
  const UL = (globalThis.UnLink = globalThis.UnLink || {});
  if (UL.ui) return;

  const BOLT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.2 2 4.5 13.4h6.3L9.9 22l8.6-11.6h-6.2L13.2 2z"/></svg>';

  const CSS = `
    :host { all: initial; }
    .stack { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; display: flex; flex-direction: column; gap: 10px; align-items: flex-end;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #f4f4f5; }
    .card { width: 310px; box-sizing: border-box; background: #16161a; border: 1px solid #2c2c33; border-radius: 12px;
      box-shadow: 0 14px 36px rgba(0,0,0,.35); padding: 12px 14px; animation: in .18s ease-out; }
    .card.ok { border-color: #1f5f3a; }
    .card.fail { border-color: #7a2a2a; }
    @keyframes in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .head { display: flex; align-items: center; gap: 8px; }
    .bolt { width: 22px; height: 22px; border-radius: 6px; background: var(--c, #f59e0b); display: grid; place-items: center; flex: none; }
    .bolt svg { width: 14px; height: 14px; fill: #1b1204; }
    .title { flex: 1; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .x { all: unset; cursor: pointer; color: #8b8b95; font-size: 18px; line-height: 1; padding: 0 2px; }
    .x:hover { color: #fff; }
    ul { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 6px; }
    li { display: grid; grid-template-columns: 18px 1fr; column-gap: 8px; align-items: start; color: #c9c9d1; }
    li .ic { text-align: center; font-weight: 700; }
    li .nt { grid-column: 2; font-size: 11.5px; color: #8b8b95; }
    li[data-s="running"] { color: #fff; }
    li[data-s="done"] .ic { color: #4ade80; }
    li[data-s="skipped"] .ic { color: #8b8b95; }
    li[data-s="failed"] .ic, li[data-s="failed"] .nt { color: #f87171; }
    .spin { display: inline-block; width: 10px; height: 10px; border: 2px solid #52525b; border-top-color: var(--c, #f59e0b); border-radius: 50%; animation: sp .7s linear infinite; }
    @keyframes sp { to { transform: rotate(360deg); } }
    .foot:empty { display: none; }
    .foot { margin-top: 12px; }
    .bar { height: 3px; background: #2c2c33; border-radius: 3px; overflow: hidden; }
    .bar i { display: block; height: 100%; background: var(--c, #f59e0b); transform-origin: left; animation: shrink linear forwards; }
    @keyframes shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    .btns { display: flex; gap: 8px; margin-top: 10px; }
    button.b { all: unset; cursor: pointer; flex: 1; text-align: center; padding: 7px 10px; border-radius: 8px; font-weight: 600; font-size: 12.5px; }
    button.b.ghost { background: #26262c; color: #e4e4e7; }
    button.b.ghost:hover { background: #303038; }
    button.b.go { background: var(--c, #f59e0b); color: #1b1204; }
    button.b.go:hover { filter: brightness(1.08); }
    kbd { font: 600 10px/1 inherit; border: 1px solid #52525b; border-radius: 4px; padding: 1px 4px; margin-left: 4px; color: #a1a1aa; }
    a.lnk { color: var(--c, #f59e0b); text-decoration: none; font-weight: 600; font-size: 12.5px; }
    a.lnk:hover { text-decoration: underline; }
    .done-in { font-size: 12px; color: #8b8b95; }
    .note { padding: 10px 14px; width: auto; max-width: 340px; display: flex; gap: 8px; align-items: center; }
    .note.warn { border-color: #6b4a12; }
    .fab { all: unset; cursor: pointer; position: fixed; right: 20px; bottom: 20px; z-index: 2147482999; display: flex; align-items: center; gap: 6px;
      padding: 9px 14px; border-radius: 999px; background: #16161a; color: #f4f4f5; border: 1px solid #2c2c33; box-shadow: 0 8px 24px rgba(0,0,0,.3); font-weight: 600; }
    .fab svg { width: 14px; height: 14px; fill: var(--c, #f59e0b); }
    .fab:hover { border-color: var(--c, #f59e0b); }
    .stack:not(:empty) ~ .fab { display: none; }
  `;

  let host, root, stack, fabEl;
  let accent = '#f59e0b';

  function ensure() {
    if (host?.isConnected) return;
    host = document.createElement('unlink-root');
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="stack"></div>`;
    stack = root.querySelector('.stack');
    host.style.setProperty('--c', accent);
    document.documentElement.appendChild(host);
  }

  const ICON = {
    pending: '○',
    running: '<span class="spin"></span>',
    done: '✓',
    skipped: '–',
    failed: '✕',
  };

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function jobCard({ title, steps, profileUrl }) {
    ensure();
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="head"><span class="bolt">${BOLT}</span><div class="title"></div><button class="x" title="Fermer">×</button></div>
      <ul>${steps.map((s) => `<li data-k="${s.key}" data-s="pending"><span class="ic">${ICON.pending}</span><span>${escapeHtml(s.label)}</span><span class="nt"></span></li>`).join('')}</ul>
      <div class="foot"></div>`;
    el.querySelector('.title').textContent = title;
    stack.appendChild(el);
    const foot = el.querySelector('.foot');
    let closeTimer = null;
    const close = () => el.remove();
    el.querySelector('.x').onclick = close;

    const api = {
      setStep(key, state, note = '') {
        const li = el.querySelector(`li[data-k="${key}"]`);
        if (!li) return;
        li.dataset.s = state;
        li.querySelector('.ic').innerHTML = ICON[state] || '';
        li.querySelector('.nt').textContent = note;
      },
      stateOf(key) {
        return el.querySelector(`li[data-k="${key}"]`)?.dataset.s;
      },
      states() {
        return [...el.querySelectorAll('li')].map((li) => li.dataset.s);
      },
      countdown(seconds) {
        return new Promise((resolve) => {
          foot.innerHTML = `<div class="bar"><i style="animation-duration:${seconds}s"></i></div>
            <div class="btns"><button class="b ghost cancel">Annuler<kbd>Esc</kbd></button><button class="b go">Lancer</button></div>`;
          const timer = setTimeout(() => end(true), seconds * 1000);
          const onKey = (e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              end(false);
            }
          };
          window.addEventListener('keydown', onKey, true);
          function end(go) {
            clearTimeout(timer);
            window.removeEventListener('keydown', onKey, true);
            foot.innerHTML = '';
            resolve(go);
          }
          foot.querySelector('.cancel').onclick = () => end(false);
          foot.querySelector('.go').onclick = () => end(true);
        });
      },
      cancel() {
        el.querySelector('ul').innerHTML = '<li data-s="skipped"><span class="ic">–</span><span>Annulé</span></li>';
        closeTimer = setTimeout(close, 1500);
      },
      finish(ok, { keepOpen = false, elapsedMs } = {}) {
        el.classList.add(ok ? 'ok' : 'fail');
        if (ok && elapsedMs != null) {
          foot.innerHTML = `<span class="done-in">Terminé en ${(elapsedMs / 1000).toFixed(1).replace('.', ',')} s</span>`;
        }
        if (!ok && profileUrl) {
          foot.innerHTML = `<a class="lnk" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener">Ouvrir le profil ↗</a>`;
        }
        if (ok && !keepOpen) closeTimer = setTimeout(close, 3500);
      },
    };
    el.addEventListener('mouseenter', () => clearTimeout(closeTimer));
    return api;
  }

  function notify(text, kind = 'info', ms = 3500) {
    ensure();
    const el = document.createElement('div');
    el.className = `card note ${kind}`;
    el.innerHTML = `<span class="bolt">${BOLT}</span><span></span>`;
    el.lastChild.textContent = text;
    stack.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function setAccent(color) {
    accent = color || accent;
    host?.style.setProperty('--c', accent);
    document.documentElement.style.setProperty('--unlink-color', accent);
  }

  // Styles appliqués directement aux éléments de LinkedIn (liste de conversations, en-tête du fil).
  const PAGE_CSS = `
    [data-unlink-item] { position: relative !important; }
    [data-unlink-flag]::before { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 1;
      background: color-mix(in srgb, var(--unlink-color, #f59e0b) 14%, transparent);
      box-shadow: inset 4px 0 0 var(--unlink-color, #f59e0b); }
    .unlink-badge { position: absolute; right: 10px; bottom: 7px; z-index: 3; display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 4px 2px 7px; border-radius: 999px; background: var(--unlink-color, #f59e0b); color: #1b1204;
      font: 600 11px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; white-space: nowrap; cursor: default; }
    .unlink-badge button { all: unset; cursor: pointer; width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center;
      font-size: 13px; line-height: 1; color: #1b1204; opacity: .65; }
    .unlink-badge button:hover { opacity: 1; background: rgba(0,0,0,.12); }
    .unlink-quick { all: unset; position: absolute; left: 6px; bottom: 6px; z-index: 3; width: 24px; height: 24px; border-radius: 50%;
      display: grid; place-items: center; cursor: pointer; background: #16161a; box-shadow: 0 2px 8px rgba(0,0,0,.3);
      opacity: 0; transform: scale(.85); transition: opacity .12s, transform .12s; }
    .unlink-quick svg { width: 13px; height: 13px; fill: var(--unlink-color, #f59e0b); }
    [data-unlink-item]:hover > .unlink-quick, .unlink-quick:focus-visible { opacity: 1; transform: none; }
    /* Vue « Jamais répondu » : la liste de LinkedIn reste intacte (même hauteur, donc aucun chargement automatique),
       simplement cachée derrière le panneau de l'extension. */
    [data-unlink-filter] { visibility: hidden !important; }
    .unlink-panel { position: absolute; left: 0; right: 0; bottom: 0; z-index: 5; overflow-y: auto; background: var(--unlink-panel-bg, #fff);
      font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .unlink-prow { display: grid; grid-template-columns: 44px 1fr auto; gap: 10px; align-items: start; padding: 11px 12px;
      border-bottom: 1px solid rgba(128,128,128,.18); cursor: pointer; }
    .unlink-prow:hover { background: rgba(128,128,128,.08); }
    .unlink-prow[aria-current="true"] { box-shadow: inset 3px 0 0 var(--unlink-color, #f59e0b); background: rgba(128,128,128,.1); }
    .unlink-prow-av { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; display: grid; place-items: center;
      background: rgba(128,128,128,.2); font-weight: 700; font-size: 13px; }
    .unlink-prow-body { min-width: 0; }
    .unlink-prow-head { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .unlink-prow-head b { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .unlink-prow-meta { flex: none; font-size: 12px; font-weight: 600; color: #1b1204; background: var(--unlink-color, #f59e0b);
      padding: 1px 7px; border-radius: 999px; }
    .unlink-prow-text { margin: 3px 0 0; font-size: 13px; opacity: .75; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .unlink-prow-run { all: unset; cursor: pointer; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center;
      border: 1px solid var(--unlink-color, #f59e0b); align-self: center; }
    .unlink-prow-run svg { width: 13px; height: 13px; fill: var(--unlink-color, #f59e0b); }
    .unlink-prow-run:hover { background: var(--unlink-color, #f59e0b); }
    .unlink-prow-run:hover svg { fill: #1b1204; }
    .unlink-prow-run:focus-visible { outline: 2px solid var(--unlink-color, #f59e0b); outline-offset: 2px; }
    .unlink-panel-empty { margin: 0; padding: 20px 16px; font-size: 13px; line-height: 1.5; opacity: .75; }
    .unlink-filter-bar { display: grid; gap: 8px; padding: 8px 12px 10px; border-bottom: 1px solid rgba(128,128,128,.22);
      font: 13px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    /* Sélecteur : « Toutes » à sa taille, « Jamais répondu » prend le reste ; rien ne peut déborder. */
    .unlink-seg { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px; padding: 3px; border-radius: 10px; background: rgba(128,128,128,.14); }
    .unlink-seg button { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;
      min-width: 0; overflow: hidden; padding: 5px 12px; border-radius: 8px; font-weight: 600; white-space: nowrap; color: inherit; opacity: .72; }
    .unlink-seg button > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .unlink-seg button:hover { opacity: 1; }
    .unlink-seg button[aria-pressed="true"] { opacity: 1; background: var(--unlink-bar-bg, #fff); box-shadow: 0 1px 2px rgba(0,0,0,.16); }
    .unlink-seg .unlink-filter-chip[aria-pressed="true"] { background: var(--unlink-color, #f59e0b); color: #1b1204; }
    .unlink-seg svg { width: 12px; height: 12px; flex: none; fill: var(--unlink-color, #f59e0b); }
    .unlink-filter-chip[aria-pressed="true"] svg { fill: #1b1204; }
    .unlink-filter-chip b { flex: none; min-width: 18px; padding: 0 5px; border-radius: 999px; text-align: center; font-size: 11.5px; background: rgba(128,128,128,.2); }
    .unlink-filter-chip[aria-pressed="true"] b { background: rgba(0,0,0,.14); }
    .unlink-seg button:focus-visible, .unlink-filter-row button:focus-visible { outline: 2px solid var(--unlink-color, #f59e0b); outline-offset: 1px; }
    /* Actions : deux vrais boutons de même largeur */
    .unlink-filter-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .unlink-filter-row[hidden] { display: none; }
    .unlink-filter-row button { all: unset; box-sizing: border-box; cursor: pointer; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      padding: 6px 10px; border-radius: 8px; font-size: 12.5px; font-weight: 600; border: 1px solid rgba(128,128,128,.4); color: inherit; }
    .unlink-filter-row button:hover:not(:disabled) { border-color: var(--unlink-color, #f59e0b); }
    .unlink-filter-row button:disabled { opacity: .45; cursor: default; }
    .unlink-filter-row .unlink-filter-bulk { background: var(--unlink-color, #f59e0b); border-color: var(--unlink-color, #f59e0b); color: #1b1204; }
    .unlink-filter-row .unlink-filter-bulk:hover { filter: brightness(1.05); }
    .unlink-panel-status { margin: 0; padding: 8px 12px; font-size: 12px; opacity: .7; border-bottom: 1px solid rgba(128,128,128,.18); }
    .unlink-thread-btn { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; margin: 0 6px; padding: 5px 11px;
      border-radius: 999px; border: 1px solid var(--unlink-color, #f59e0b); color: inherit;
      font: 600 13px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; white-space: nowrap; }
    .unlink-thread-btn svg { width: 13px; height: 13px; fill: var(--unlink-color, #f59e0b); }
    .unlink-thread-btn:hover { background: color-mix(in srgb, var(--unlink-color, #f59e0b) 16%, transparent); }
  `;

  function pageStyle(color) {
    setAccent(color);
    if (document.getElementById('unlink-page-style')) return;
    const st = document.createElement('style');
    st.id = 'unlink-page-style';
    st.textContent = PAGE_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  // Bouton flottant, utilisé seulement si l'en-tête du fil n'a pas pu accueillir le bouton UnLink.
  function fab(show, onClick, title) {
    ensure();
    if (!show) {
      fabEl?.remove();
      fabEl = null;
      return;
    }
    if (fabEl?.isConnected) return;
    fabEl = document.createElement('button');
    fabEl.className = 'fab';
    fabEl.innerHTML = `${BOLT}<span>UnLink</span>`;
    fabEl.title = title || '';
    fabEl.onclick = onClick;
    root.appendChild(fabEl);
  }

  UL.ui = { BOLT, jobCard, notify, pageStyle, setAccent, fab };
})();
