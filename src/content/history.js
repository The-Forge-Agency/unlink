// Charge l'historique des conversations dont le dernier message vient de l'autre personne, pour compter les relances
// sans avoir à ouvrir chaque fil. Réutilise la requête exacte de LinkedIn (même identifiant de requête, mêmes en-têtes).
// Discrétion : un seul onglet à la fois, pauses variables, budget quotidien, arrêt global dès que LinkedIn freine.
(() => {
  const UL = globalThis.UnLink;
  if (!UL || UL.history) return;
  const { store } = UL;

  const GAP_MIN_MS = 500;
  const GAP_MAX_MS = 1100;
  const MAX_PER_RUN = 80;
  const DAILY_BUDGET = 1000; // un premier passage sur une grosse boîte peut demander plusieurs centaines de relectures
  const BACKOFF_MS = 30 * 60e3;
  const MAX_AGE = 365 * 24 * 3600e3;

  let running = false;
  const failed = new Set();

  const alive = () => !!globalThis.chrome?.runtime?.id;
  const enc = (s) => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29'); // LinkedIn encode aussi ( )
  const csrf = () => document.cookie.match(/JSESSIONID="?([^";]+)"?/)?.[1];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const today = () => new Date().toISOString().slice(0, 10);

  function lastMessage(t) {
    let last = null;
    for (const m of Object.values(t.msgs || {})) if (!last || m[0] > last[0]) last = m;
    return last;
  }

  function needsHistory(t, me) {
    if (!t?.id || failed.has(t.id) || t.group) return false;
    if (t.answeredHintAt || t.domHasMine) return false; // déjà répondu : jamais une relance
    if (t.historyAt && t.historyAt >= (t.lastActivityAt || 0)) return false;
    if (t.lastActivityAt && Date.now() - t.lastActivityAt > MAX_AGE) return false;
    const last = lastMessage(t);
    return !last || last[1] !== me; // si c'est nous qui avons écrit en dernier, rien à compter
  }

  // Budget et pause partagés entre tous les onglets (chrome.storage.local).
  async function guard() {
    const d = await chrome.storage.local.get(['historyBackoffUntil', 'historyBudget']);
    if ((d.historyBackoffUntil || 0) > Date.now()) return false;
    const b = d.historyBudget?.day === today() ? d.historyBudget : { day: today(), n: 0 };
    return b.n < DAILY_BUDGET;
  }
  async function spend() {
    const d = await chrome.storage.local.get('historyBudget');
    const b = d.historyBudget?.day === today() ? d.historyBudget : { day: today(), n: 0 };
    await chrome.storage.local.set({ historyBudget: { day: b.day, n: b.n + 1 } });
  }
  async function backoff(reason) {
    console.debug(`[UnLink] historique en pause (${reason})`);
    await chrome.storage.local.set({ historyBackoffUntil: Date.now() + BACKOFF_MS });
  }

  async function loop() {
    for (let i = 0; i < MAX_PER_RUN; i++) {
      if (!alive() || document.visibilityState !== 'visible' || !location.pathname.startsWith('/messaging')) return;
      const settings = await UL.settings.get();
      if (!settings.highlight.enabled || !(await guard())) return;
      const me = store.meId();
      const qid = store.msgQueryId();
      const token = csrf();
      if (!me || !qid || !token) return;
      const next = Object.values(store.all())
        .filter((t) => needsHistory(t, me))
        .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))[0];
      if (!next) return;

      const conv = `urn:li:msg_conversation:(urn:li:fsd_profile:${me},${next.id})`;
      const url = `/voyager/api/voyagerMessagingGraphQL/graphql?queryId=${qid}&variables=(conversationUrn:${enc(conv)})`;
      await spend();
      let res;
      try {
        res = await fetch(url, {
          credentials: 'include',
          headers: { accept: 'application/graphql', 'csrf-token': token, 'x-restli-protocol-version': '2.0.0' },
        });
      } catch {
        failed.add(next.id);
        continue;
      }
      // LinkedIn freine, redemande la connexion ou renvoie autre chose que des données : on s'arrête partout.
      if ([401, 403, 429, 999].includes(res.status) || res.redirected) return backoff(`HTTP ${res.status}`);
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !/json|graphql/.test(type)) {
        failed.add(next.id);
        continue;
      }
      const { history } = store.ingest(url, await res.text());
      if (!history) failed.add(next.id); // réponse invalide : cette conversation ne sera pas proposée
      await sleep(GAP_MIN_MS + Math.random() * (GAP_MAX_MS - GAP_MIN_MS));
    }
  }

  async function run() {
    if (running || !alive()) return;
    running = true;
    try {
      // Un seul onglet charge l'historique à la fois.
      if (navigator.locks) await navigator.locks.request('unlink-history', { ifAvailable: true }, (lock) => (lock ? loop() : null));
      else await loop();
    } catch (e) {
      console.debug('[UnLink] historique', e);
    } finally {
      running = false;
    }
  }

  store.onUpdate(() => {
    if (location.pathname.startsWith('/messaging')) run();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && location.pathname.startsWith('/messaging')) run();
  });

  UL.history = { run };
})();
