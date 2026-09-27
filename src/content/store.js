// Cache local des conversations (chrome.storage.local), alimenté par les réponses réseau de la messagerie
// et par quelques indices lus dans le DOM. Sert au calcul des relances sans réponse et à identifier la cible des actions.
(() => {
  const UL = (globalThis.UnLink = globalThis.UnLink || {});
  if (UL.store) return;

  const RE_CONV = /msg_conversation:\(urn:li:fsd_profile:([A-Za-z0-9_-]+),(2-[A-Za-z0-9+=_-]+)\)/;
  const RE_THREAD = /messagingThread:(2-[A-Za-z0-9+=_-]+)/;
  const RE_PROFILE = /fsd_profile:([A-Za-z0-9_-]+)/;
  const RE_MAILBOX = /mailboxUrn:urn:li:fsd_profile:([A-Za-z0-9_-]+)/;
  const MAX_MSGS = 40;
  const MAX_AGE = 120 * 24 * 3600e3;

  let meId = null;
  let msgQueryId = null; // identifiant de la requête « historique d'un fil » utilisée par LinkedIn
  let identityQueryId = null; // identifiant de la requête « identité d'un profil »
  let threads = {};
  let nameIndex = null; // nom normalisé → identifiants de conversations (reconstruit à la demande)
  const dirty = new Set();
  const removed = new Set();
  let meDirty = false;
  let flushTimer = null;
  let notifyTimer = null;
  const listeners = new Set();
  const alive = () => !!globalThis.chrome?.runtime?.id; // faux si l'extension a été rechargée (script orphelin)

  // ---------- fusion / persistance ----------

  function stripUndef(o) {
    const out = {};
    for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
    return out;
  }

  // La provenance « conv » (liste officielle des participants) l'emporte toujours sur « msg » (simple expéditeur vu).
  function mergeParticipants(a = [], b = []) {
    const map = new Map(a.map((p) => [p.id, p]));
    for (const p of b) {
      const old = map.get(p.id);
      const src = old?.src === 'conv' || p.src === 'conv' ? 'conv' : p.src || old?.src;
      map.set(p.id, { ...old, ...stripUndef(p), src });
    }
    return [...map.values()];
  }

  function trimMsgs(msgs) {
    const entries = Object.entries(msgs || {});
    if (entries.length <= MAX_MSGS) return msgs || {};
    entries.sort((x, y) => y[1][0] - x[1][0]);
    return Object.fromEntries(entries.slice(0, MAX_MSGS));
  }

  const maxDefined = (x, y) => (x == null ? y : y == null ? x : Math.max(x, y));

  function mergeThread(a, b) {
    if (!a) return b;
    if (!b) return a;
    const out = {
      ...a,
      ...stripUndef(b),
      msgs: trimMsgs({ ...a.msgs, ...b.msgs }),
      participants: mergeParticipants(a.participants, b.participants),
    };
    // Preuves de réponse « collantes » : une fois vues, jamais perdues (même si deux onglets écrivent en même temps).
    out.answeredHintAt = maxDefined(a.answeredHintAt, b.answeredHintAt);
    out.domHasMine = !!(a.domHasMine || b.domHasMine) || undefined;
    out.dismissedAt = maxDefined(a.dismissedAt, b.dismissedAt);
    // Dernier message connu : on garde le plus récent.
    if ((a.lastMsgAt || 0) > (b.lastMsgAt || 0)) {
      out.lastMsgAt = a.lastMsgAt;
      out.lastText = a.lastText;
    }
    return stripUndef(out);
  }

  function prune(all) {
    const now = Date.now();
    for (const [id, t] of Object.entries(all)) {
      const last = Math.max(t.lastActivityAt || 0, t.updatedAt || 0);
      if (last && now - last > MAX_AGE) delete all[id];
    }
    return all;
  }

  function scheduleFlush() {
    nameIndex = null;
    if (!alive()) return;
    if (!flushTimer) flushTimer = setTimeout(flush, 500);
    notify();
  }

  async function flush() {
    flushTimer = null;
    if (!alive() || (!dirty.size && !removed.size && !meDirty)) return;
    const ids = [...dirty];
    const gone = [...removed];
    dirty.clear();
    removed.clear();
    try {
      const d = await chrome.storage.local.get('threads');
      const all = d.threads || {};
      for (const id of ids) if (threads[id]) all[id] = mergeThread(all[id], threads[id]);
      for (const id of gone) delete all[id];
      const payload = { threads: prune(all) };
      if (meDirty && meId) payload.meId = meId;
      meDirty = false;
      await chrome.storage.local.set(payload);
    } catch (e) {
      console.debug('[UnLink] flush', e);
    }
  }

  function notify() {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      for (const cb of listeners) {
        try {
          cb();
        } catch (e) {
          console.warn('[UnLink]', e);
        }
      }
    }, 120);
  }

  const ready = (alive() ? chrome.storage.local.get(['meId', 'threads', 'msgQueryId', 'identityQueryId']) : Promise.resolve({}))
    .then((d) => {
      if (!meId && d.meId) meId = d.meId;
      if (!msgQueryId && d.msgQueryId) msgQueryId = d.msgQueryId;
      if (!identityQueryId && d.identityQueryId) identityQueryId = d.identityQueryId;
      const loaded = d.threads || {};
      for (const [id, t] of Object.entries(threads)) loaded[id] = mergeThread(loaded[id], t);
      threads = loaded;
      nameIndex = null;
      notify();
    })
    .catch(() => {});

  if (alive()) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.meId?.newValue && !meId) meId = changes.meId.newValue;
      if (changes.meId && !changes.meId.newValue) meId = null;
      if (changes.msgQueryId && !changes.msgQueryId.newValue) msgQueryId = null;
      if (changes.identityQueryId && !changes.identityQueryId.newValue) identityQueryId = null;
      if (changes.threads && !changes.threads.newValue) {
        // Cache vidé (installation / mise à jour de l'extension, bouton « Vider ») : on repart de zéro.
        threads = {};
        dirty.clear();
        nameIndex = null;
        notify();
        return;
      }
      if (changes.threads) {
        const next = changes.threads.newValue || {};
        for (const id of dirty) if (threads[id]) next[id] = mergeThread(next[id], threads[id]);
        threads = next;
        nameIndex = null;
        notify();
      }
    });
  }

  // ---------- écriture ----------

  function setMe(id) {
    if (!id || id === meId) return;
    if (meId) {
      // Changement de compte LinkedIn : les conversations en cache appartiennent à l'autre compte.
      threads = {};
      dirty.clear();
      removed.clear();
      nameIndex = null;
      try {
        if (alive()) chrome.storage.local.remove(['threads']).catch(() => {});
      } catch {
        /* extension rechargée */
      }
    }
    meId = id;
    meDirty = true;
    scheduleFlush();
  }

  function sameValue(a, b) {
    return a === b || JSON.stringify(a) === JSON.stringify(b);
  }

  function patch(id, obj) {
    if (!id) return;
    const cur = threads[id];
    const next = mergeThread(cur || { id, msgs: {}, participants: [] }, { ...stripUndef(obj), id });
    if (cur && sameValue({ ...cur, updatedAt: 0 }, { ...next, updatedAt: 0 })) return;
    next.updatedAt = Date.now();
    threads[id] = next;
    removed.delete(id);
    dirty.add(id);
    scheduleFlush();
  }

  function remove(id) {
    if (!threads[id]) return;
    delete threads[id];
    dirty.delete(id);
    removed.add(id);
    scheduleFlush();
  }

  // ---------- lecture des réponses réseau ----------

  const txt = (v) => (typeof v === 'string' ? v : v?.text || '');

  function threadFromString(s) {
    if (typeof s !== 'string') return null;
    const m = RE_CONV.exec(s);
    if (m) {
      setMe(m[1]);
      return m[2];
    }
    return RE_THREAD.exec(s)?.[1] || null;
  }

  // Requête d'historique COMPLET d'un fil : seule variable = conversationUrn (pas de jeton de synchro, de curseur…).
  function isFullHistoryUrl(decoded) {
    if (!/queryId=messengerMessages\.[0-9a-f]+/.test(decoded)) return false;
    const vars = /[?&]variables=\((.*)\)$/.exec(decoded)?.[1];
    if (!vars) return false;
    const rest = vars.replace(/conversationUrn:urn:li:msg_conversation:\([^)]*\)/, '').replace(/[\s(),]/g, '');
    return rest === '';
  }

  // Renvoie { history: true } si la réponse est un historique complet et valide d'un fil.
  function ingest(url, text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { history: false };
    }
    let decoded = url;
    try {
      decoded = decodeURIComponent(url);
    } catch {
      /* ignore */
    }
    const idq = /variables=\(profileId:urn:li:fsd_profile:[^)]*\)&queryId=(voyagerIdentityDashProfiles\.[0-9a-f]+)/.exec(decoded)?.[1];
    if (idq && idq !== identityQueryId) {
      identityQueryId = idq;
      if (alive()) chrome.storage.local.set({ identityQueryId: idq }).catch(() => {});
    }
    if (/voyagerIdentityDashProfiles/.test(decoded)) return { history: false };

    setMe(RE_MAILBOX.exec(decoded)?.[1]);
    const urlThread = threadFromString(decoded);
    const fullHistory = !!urlThread && isFullHistoryUrl(decoded);
    if (fullHistory) {
      const qid = /queryId=(messengerMessages\.[0-9a-f]+)/.exec(decoded)[1];
      if (qid !== msgQueryId) {
        msgQueryId = qid;
        if (alive()) chrome.storage.local.set({ msgQueryId: qid }).catch(() => {});
      }
    }

    // Index des entités par URN pour résoudre les références des réponses « normalisées » (*champ).
    const index = new Map();
    const seenIdx = new WeakSet();
    (function collect(n, depth) {
      if (!n || typeof n !== 'object' || depth > 40 || seenIdx.has(n)) return;
      seenIdx.add(n);
      if (!Array.isArray(n) && typeof n.entityUrn === 'string') index.set(n.entityUrn, n);
      for (const k in n) if (n[k] && typeof n[k] === 'object') collect(n[k], depth + 1);
    })(data, 0);

    const resolve = (v) => (typeof v === 'string' && index.has(v) ? index.get(v) : v);
    const field = (o, k) => o[k] ?? resolve(o['*' + k]);

    function parseParticipant(p, src) {
      p = resolve(p);
      if (typeof p === 'string') {
        const id = RE_PROFILE.exec(p)?.[1];
        return id ? { id, src } : null;
      }
      if (!p || typeof p !== 'object') return null;
      const id = RE_PROFILE.exec(p.hostIdentityUrn || p.entityUrn || '')?.[1];
      if (!id) return null;
      const member = p.participantType?.member || p.member;
      // Photo : image LinkedIn (media.licdn.com) de 100 px environ ; titre professionnel.
      const pic = member?.profilePicture;
      const art = (pic?.artifacts || []).filter((a) => a?.fileIdentifyingUrlPathSegment).sort((x, y) => Math.abs((x.width || 0) - 100) - Math.abs((y.width || 0) - 100))[0];
      const photo = typeof pic?.rootUrl === 'string' && pic.rootUrl.startsWith('https://media.licdn.com/') && art ? pic.rootUrl + art.fileIdentifyingUrlPathSegment : undefined;
      const headline = member ? txt(member.headline).trim().slice(0, 160) : '';
      const firstName = member ? txt(member.firstName).trim() : '';
      const lastName = member ? txt(member.lastName).trim() : '';
      const name = `${firstName} ${lastName}`.trim();
      return {
        id,
        src,
        name: name || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        profileUrl: member?.profileUrl || undefined,
        distance: member?.distance || undefined,
        photo,
        headline: headline || undefined,
      };
    }

    function parseConversation(o) {
      const m = RE_CONV.exec(typeof o.entityUrn === 'string' ? o.entityUrn : '');
      const thread = threadFromString(o.entityUrn) || threadFromString(o.backendUrn);
      if (!thread) return null;
      const rawParts = field(o, 'conversationParticipants');
      const list = Array.isArray(rawParts) ? rawParts.map(resolve) : null;
      const participants = list ? list.map((p) => parseParticipant(p, 'conv')).filter(Boolean) : undefined;
      // Participants qui ne sont pas des membres (pages entreprise, agents…)
      const hasOrg = list ? list.some((p) => p && typeof p === 'object' && (p.participantType?.organization || p.participantType?.agent)) : undefined;
      patch(thread, {
        participants,
        hasOrg: hasOrg || undefined,
        ownerId: m?.[1],
        group: typeof o.groupChat === 'boolean' ? o.groupChat : undefined,
        unreadCount: typeof o.unreadCount === 'number' ? o.unreadCount : undefined,
        lastActivityAt: typeof o.lastActivityAt === 'number' ? o.lastActivityAt : undefined,
        title: typeof o.title === 'string' && o.title ? o.title : undefined,
      });
      return thread;
    }

    // Renvoie l'identifiant du fil si le message a été compris, sinon null.
    function parseMessage(o, ctxThread) {
      if (typeof o.deliveredAt !== 'number') return null;
      const senderRaw = resolve(o.sender ?? o['*sender']);
      if (!senderRaw) return null;
      const sender = parseParticipant(senderRaw, 'msg');
      if (!sender) return null;
      const convRef = o.backendConversationUrn || o.conversationUrn || o['*conversation'] || o.conversation?.entityUrn || o.conversation;
      const thread = threadFromString(convRef) || ctxThread;
      if (!thread) return null;
      const t = threads[thread];
      const text = txt(o.body).slice(0, 200);
      const newer = !t?.lastMsgAt || o.deliveredAt >= t.lastMsgAt;
      patch(thread, {
        // Clé stable (date + expéditeur) : un même message vu sous deux URN différents n'est compté qu'une fois.
        msgs: { [`${o.deliveredAt}:${sender.id}`]: [o.deliveredAt, sender.id] },
        participants: sender.name ? [sender] : undefined,
        lastMsgAt: newer ? o.deliveredAt : undefined,
        lastText: newer ? text : undefined,
      });
      return thread;
    }

    const seen = new WeakSet();
    (function walk(n, ctx, depth) {
      if (!n || typeof n !== 'object' || depth > 40 || seen.has(n)) return;
      seen.add(n);
      if (Array.isArray(n)) {
        for (const x of n) walk(x, ctx, depth + 1);
        return;
      }
      const type = n.$type || n._type || '';
      if ((typeof n.entityUrn === 'string' && n.entityUrn.startsWith('urn:li:msg_conversation:')) || /\.Conversation$/.test(type)) {
        ctx = parseConversation(n) || ctx;
      } else {
        parseMessage(n, ctx);
      }
      for (const k in n) if (n[k] && typeof n[k] === 'object') walk(n[k], ctx, depth + 1);
    })(data, urlThread, 0);

    // Historique complet et valide ? (pas d'erreur, au moins un message, tous du bon fil) → on le note, avec sa taille :
    // c'est elle qui dit si l'historique peut être tronqué.
    if (!fullHistory) return { history: false };
    const els = data?.data?.messengerMessagesBySyncToken?.elements;
    const hasErrors = (Array.isArray(data?.errors) && data.errors.length > 0) || (Array.isArray(data?.data?.errors) && data.data.errors.length > 0);
    if (!Array.isArray(els) || els.length === 0 || hasErrors) return { history: false };
    const unparsed = els.filter((e) => parseMessage(e, urlThread) !== urlThread).length;
    const t = threads[urlThread];
    patch(urlThread, {
      historyAt: Math.max(Date.now(), t?.lastActivityAt || 0), // insensible à une horloge locale en retard
      historySize: els.length,
      historyUnparsed: unparsed,
    });
    return { history: true };
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'unlink-net') return;
    try {
      ingest(e.data.url, e.data.text);
    } catch (err) {
      console.debug('[UnLink] ingest', err);
    }
  });
  window.postMessage({ source: 'unlink-ready' }, location.origin);

  // Dernier recours pour connaître notre propre identifiant de profil.
  async function fetchMe() {
    if (meId) return meId;
    const csrf = document.cookie.match(/JSESSIONID="?([^";]+)"?/)?.[1];
    if (!csrf) return null;
    try {
      const res = await fetch('/voyager/api/me', {
        credentials: 'include',
        headers: { 'csrf-token': csrf, accept: 'application/vnd.linkedin.normalized+json+2.1', 'x-restli-protocol-version': '2.0.0' },
      });
      const body = await res.text();
      const id = /(?:fs_miniProfile|fsd_profile):(ACoA[A-Za-z0-9_-]+)/.exec(body)?.[1];
      if (id) setMe(id);
    } catch {
      /* ignore */
    }
    return meId;
  }

  // ---------- API ----------

  // Nom affiché d'une conversation (participants officiels, sinon expéditeurs vus, sinon nom lu dans l'en-tête).
  function threadName(t) {
    const norm = UL.dom?.norm || ((s) => s.toLowerCase());
    const conv = (t.participants || []).filter((p) => p.id !== meId && p.name && p.src === 'conv');
    const others = conv.length ? conv : (t.participants || []).filter((p) => p.id !== meId && p.name);
    return others.length ? norm(others.map((p) => p.name).join(', ')) : t.domName || '';
  }

  // Conversations portant ce nom, de la plus récente à la plus ancienne.
  function findAllByName(normName) {
    if (!normName) return [];
    if (!nameIndex) {
      nameIndex = new Map();
      const sorted = Object.values(threads).sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
      for (const t of sorted) {
        const n = threadName(t);
        if (!n) continue;
        if (!nameIndex.has(n)) nameIndex.set(n, []);
        nameIndex.get(n).push(t.id);
      }
    }
    return nameIndex.get(normName) || [];
  }

  function findByName(normName) {
    const all = findAllByName(normName);
    return all.length === 1 ? all[0] : null; // homonymes : ambigu
  }

  UL.store = {
    ready,
    ingest,
    fetchMe,
    get: (id) => threads[id],
    all: () => threads,
    meId: () => meId,
    msgQueryId: () => msgQueryId,
    identityQueryId: () => identityQueryId,
    patch,
    remove,
    threadName,
    findByName,
    findAllByName,
    onUpdate: (cb) => listeners.add(cb),
  };
})();
