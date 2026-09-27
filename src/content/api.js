// Actions directes, calquées sur les requêtes qu'envoie l'interface web de LinkedIn (septembre 2026),
// exécutées depuis la page LinkedIn avec la session de l'utilisateur.
// Règle absolue : aucune action n'est déclarée réussie sans une vérification relue auprès de LinkedIn.
(() => {
  const UL = globalThis.UnLink;
  if (!UL || UL.api) return;

  // Identifiant de la requête « identité d'un profil » ; remplacé par celui que LinkedIn utilise s'il change.
  const DEFAULT_IDENTITY_QUERY = 'voyagerIdentityDashProfiles.4be600f2992df8cd036dba7aef973bab';
  const REMOVE_REQUEST_ID = 'com.linkedin.sdui.mynetwork.RemoveConnectionVanityName';
  const PROFILE_ID = /^ACoA[A-Za-z0-9_-]+$/;

  const csrf = () => document.cookie.match(/JSESSIONID="?([^";]+)"?/)?.[1];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function profileIdFrom(s) {
    return /(ACoA[A-Za-z0-9_-]+)/.exec(s || '')?.[1] || null;
  }

  function voyagerHeaders(accept = 'application/vnd.linkedin.normalized+json+2.1') {
    const token = csrf();
    if (!token) throw new Error('session LinkedIn introuvable');
    return { 'csrf-token': token, 'x-restli-protocol-version': '2.0.0', accept };
  }

  // Relation avec une personne, lue sur SON entité « memberRelationship » (et non sur la première valeur venue) :
  // 'connected' | 'not_connected' | null (illisible).
  async function relationOf(profileId) {
    if (!PROFILE_ID.test(profileId || '')) return null;
    const qid = UL.store?.identityQueryId?.() || DEFAULT_IDENTITY_QUERY;
    const res = await fetch(`/voyager/api/graphql?variables=(profileId:urn%3Ali%3Afsd_profile%3A${profileId})&queryId=${qid}`, {
      credentials: 'include',
      headers: voyagerHeaders(),
    });
    if (!res.ok || res.redirected) return null;
    let j;
    try {
      j = await res.json();
    } catch {
      return null;
    }
    const rel = (j?.included || []).find((x) => x?.entityUrn === `urn:li:fsd_memberRelationship:${profileId}`);
    const mr = rel?.memberRelationship;
    if (!mr || typeof mr !== 'object') return null;
    const conn = mr['*connection'] ?? mr.connection;
    if (conn) {
      const urn = typeof conn === 'string' ? conn : conn.entityUrn;
      return urn === `urn:li:fsd_connection:${profileId}` ? 'connected' : null;
    }
    if (mr.noConnection || mr['*noConnection']) return 'not_connected';
    return null;
  }

  // Identifiant public (/in/<vanity>/), accepté uniquement s'il est relié par LinkedIn à l'identifiant interne :
  // lien « …/in/<vanity>/edit/forms/recommendation/…?profileUrn=urn:li:fsd_profile:<id> » (présent pour les relations).
  // La page est lue en flux et le téléchargement s'arrête dès que le lien est trouvé.
  async function vanityOf(profileId) {
    if (!PROFILE_ID.test(profileId || '')) return null;
    const bound = new RegExp(
      `/in/([^/"?#\\s\\\\<>]+)/edit/forms/recommendation/(?:request|write)/\\?[^"\\s<>]{0,300}?profileUrn=urn%3Ali%3Afsd_profile%3A${profileId}(?![A-Za-z0-9_-])`
    );
    const res = await fetch(`/in/${profileId}/`, { credentials: 'include' });
    if (!res.ok || res.redirected || !res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let vanity = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      vanity = bound.exec(buf)?.[1] || null;
      if (vanity) {
        reader.cancel().catch(() => {});
        break;
      }
      if (buf.length > 8192) buf = buf.slice(-2048); // un lien coupé entre deux morceaux reste dans la fin du tampon
    }
    try {
      return vanity ? decodeURIComponent(vanity) : null;
    } catch {
      return null;
    }
  }

  // Préparation (relation + identifiant public) en parallèle, mémorisée 30 s : lancée au début du délai d'annulation,
  // elle est prête au moment d'agir.
  const prepared = new Map();
  function prepare(profileId) {
    if (!profileId) return Promise.resolve({ relation: null, vanity: null });
    const hit = prepared.get(profileId);
    if (hit && Date.now() - hit.at < 30e3) return hit.promise;
    const promise = Promise.all([relationOf(profileId).catch(() => null), vanityOf(profileId).catch(() => null)]).then(
      ([relation, vanity]) => ({ relation, vanity })
    );
    prepared.set(profileId, { at: Date.now(), promise });
    return promise;
  }

  function removeBody({ profileId, vanity, firstName, lastName }) {
    const payload = {
      disconnectVanityName: vanity,
      disconnectFirstName: firstName || '',
      disconnectLastName: lastName || '',
      closeCurrentMenuOnCompletion: true,
      removeConnectionButtonStateBinding: { key: `remove_connection_button_${profileId}`, namespace: 'MemoryNamespace' },
      postActionSentConfigs: [],
      nonIterableProfileId: profileId,
    };
    const requestedArguments = {
      $type: 'proto.sdui.actions.requests.RequestedArguments',
      requestedStateKeys: [],
      payload,
      requestMetadata: { $type: 'proto.sdui.common.RequestMetadata' },
    };
    return {
      requestId: REMOVE_REQUEST_ID,
      serverRequest: { requestId: REMOVE_REQUEST_ID, requestedArguments, isApfcEnabled: false, isStreaming: false, rumPageKey: '' },
      states: [],
      requestedArguments: { ...requestedArguments, states: [], screenId: '', knownTemplateIds: [] },
    };
  }

  // Attend que LinkedIn confirme que la personne n'est plus une relation.
  async function confirmNotConnected(profileId) {
    for (const wait of [250, 400, 700, 1000, 1500]) {
      await sleep(wait);
      if ((await relationOf(profileId).catch(() => null)) === 'not_connected') return true;
    }
    return false;
  }

  // Retire la personne de tes relations, puis vérifie.
  // Renvoie { status: 'done' | 'skipped' | 'failed', note, wasConnected }.
  async function removeConnection({ profileId, firstName, lastName }) {
    if (!PROFILE_ID.test(profileId || '')) return { status: 'failed', note: 'identifiant de profil inconnu' };
    try {
      const { relation, vanity } = await prepare(profileId);
      prepared.delete(profileId); // l'état va changer
      if (relation === 'not_connected') return { status: 'skipped', note: 'pas en relation', wasConnected: false };
      if (relation !== 'connected') return { status: 'failed', note: 'relation illisible' };
      if (!vanity) return { status: 'failed', note: 'identifiant public non vérifiable', wasConnected: true };

      const res = await fetch(`/flagship-web/rsc-action/actions/server-request?sduiid=${REMOVE_REQUEST_ID}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'csrf-token': csrf(), 'content-type': 'application/json' },
        body: JSON.stringify(removeBody({ profileId, vanity, firstName, lastName })),
      });
      if (!res.ok) return { status: 'failed', note: `refusé par LinkedIn (HTTP ${res.status})`, wasConnected: true };
      if (await confirmNotConnected(profileId)) return { status: 'done', note: '', wasConnected: true };
      return { status: 'failed', note: 'LinkedIn n’a pas confirmé le retrait', wasConnected: true };
    } catch (e) {
      return { status: 'failed', note: e?.message || String(e) };
    }
  }

  function conversationUrn(threadId) {
    const me = UL.store?.meId();
    if (!me || !threadId) return null;
    return `urn:li:msg_conversation:(urn:li:fsd_profile:${me},${threadId})`;
  }

  // La conversation existe-t-elle encore ? true = supprimée (historique vide), false = encore là, null = illisible.
  async function conversationGone(threadId) {
    const urn = conversationUrn(threadId);
    const qid = UL.store?.msgQueryId();
    if (!urn || !qid) return null;
    const enc = encodeURIComponent(urn).replace(/\(/g, '%28').replace(/\)/g, '%29');
    const res = await fetch(`/voyager/api/voyagerMessagingGraphQL/graphql?queryId=${qid}&variables=(conversationUrn:${enc})`, {
      credentials: 'include',
      headers: voyagerHeaders('application/graphql'),
    });
    if (!res.ok || res.redirected) return null;
    try {
      const j = await res.json();
      const els = j?.data?.messengerMessagesBySyncToken?.elements;
      if (!Array.isArray(els) || j?.errors?.length) return null;
      return els.length === 0;
    } catch {
      return null;
    }
  }

  // Supprime la discussion (même requête que « … » → Supprimer la discussion), puis vérifie qu'elle est vide.
  async function deleteConversation(threadId) {
    const urn = conversationUrn(threadId);
    if (!urn) return { status: 'failed', note: 'identifiant de conversation inconnu' };
    try {
      const res = await fetch(`/voyager/api/voyagerMessagingDashMessengerConversations/${encodeURIComponent(urn)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: voyagerHeaders(),
      });
      if (!res.ok) return { status: 'failed', note: `refusé par LinkedIn (HTTP ${res.status})` };
      for (const wait of [150, 400, 800]) {
        await sleep(wait);
        if ((await conversationGone(threadId).catch(() => null)) === true) return { status: 'done', note: '' };
      }
      return { status: 'failed', note: 'suppression non confirmée par LinkedIn' };
    } catch (e) {
      return { status: 'failed', note: e?.message || String(e) };
    }
  }

  // Relit l'historique complet d'une conversation : { ok, n, mine, complete }. Sert à revérifier juste avant d'agir
  // qu'on n'y a jamais écrit (y compris entre-temps, depuis un autre appareil).
  async function historyCheck(threadId) {
    const urn = conversationUrn(threadId);
    const qid = UL.store?.msgQueryId();
    const me = UL.store?.meId();
    if (!urn || !qid || !me) return { ok: false };
    const enc = encodeURIComponent(urn).replace(/\(/g, '%28').replace(/\)/g, '%29');
    const res = await fetch(`/voyager/api/voyagerMessagingGraphQL/graphql?queryId=${qid}&variables=(conversationUrn:${enc})`, {
      credentials: 'include',
      headers: voyagerHeaders('application/graphql'),
    });
    if (!res.ok || res.redirected) return { ok: false, status: res.status };
    let j;
    try {
      j = await res.json();
    } catch {
      return { ok: false };
    }
    const els = j?.data?.messengerMessagesBySyncToken?.elements;
    if (!Array.isArray(els) || j?.errors?.length) return { ok: false };
    const senders = els.map((e) => /fsd_profile:([A-Za-z0-9_-]+)/.exec(e?.sender?.hostIdentityUrn || '')?.[1] || null);
    return { ok: true, n: els.length, mine: senders.filter((s) => s === me).length, unknown: senders.filter((s) => !s).length, complete: els.length < 20 };
  }

  UL.api = { profileIdFrom, relationOf, vanityOf, prepare, removeConnection, deleteConversation, conversationGone, historyCheck };
})();
