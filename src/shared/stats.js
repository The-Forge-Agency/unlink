// Calcul des « relances sans réponse » à partir du cache de conversations.
(() => {
  const UL = (globalThis.UnLink = globalThis.UnLink || {});
  if (UL.stats) return;

  const HOUR = 3600e3;
  const DAY = 24 * HOUR;

  // Au-delà, l'historique chargé peut être tronqué : d'éventuelles réponses plus anciennes seraient invisibles.
  const HISTORY_PAGE = 20;

  // Règle stricte : une conversation n'est une « relance » que si l'on est SÛR de n'y avoir jamais écrit.
  // thread.msgs = { [messageId]: [deliveredAt, senderProfileId] }
  function compute(thread, meId) {
    const raw = Object.values(thread?.msgs || {});
    const msgs = raw.map(([at, sender]) => ({ at, fromMe: !!meId && sender === meId })).sort((a, b) => a.at - b.at);

    // Une réponse de notre part, sous n'importe quelle forme, exclut définitivement la conversation.
    const replied = !!(
      msgs.some((m) => m.fromMe) ||
      thread?.answeredHintAt || // aperçu « Vous : … » dans la liste
      thread?.domHasMine // un de nos messages vu dans le fil ouvert
    );
    // NB : le champ « creator » de LinkedIn n'est pas fiable (il nous désigne parfois alors qu'on n'a jamais écrit).
    // Assez d'informations pour l'affirmer :
    // - historique complet chargé depuis LinkedIn (réponse d'une seule page, < 20 messages, tous compris) ;
    // - plus récent que la dernière activité (sinon on a peut-être répondu depuis, par exemple depuis le téléphone) ;
    // - conversation de notre boîte (pas d'un autre compte LinkedIn).
    const fresh = !!thread?.historyAt && thread.historyAt >= (thread.lastActivityAt || 0);
    const complete = typeof thread?.historySize === 'number' && thread.historySize < HISTORY_PAGE && !thread.historyUnparsed;
    const ownMailbox = !thread?.ownerId || thread.ownerId === meId;
    const certain = !!meId && fresh && complete && ownMailbox;

    const count = replied ? 0 : Math.max(msgs.length, thread?.unreadCount || 0, thread?.domCount || 0);
    const firstAt = count ? msgs[0]?.at ?? thread?.lastActivityAt ?? null : null;
    const lastAt = msgs.length ? msgs[msgs.length - 1].at : thread?.lastActivityAt || null;
    return { count, firstAt, lastAt, replied, certain };
  }

  function delayMs(hl) {
    return Math.max(0, Number(hl.delayValue) || 0) * (hl.delayUnit === 'hours' ? HOUR : DAY);
  }

  // Compte supprimé, bloqué ou masqué (« LinkedIn Member ») : aucune action possible, jamais proposé.
  const UNAVAILABLE = /^(linkedin member|linkedin user|membre linkedin|utilisateur linkedin|utilisateur de linkedin|mitglied von linkedin|linkedin-mitglied|miembro de linkedin|usuario de linkedin|membro do linkedin|membro di linkedin|linkedin-lid)$/i;
  function unavailable(p) {
    return !p?.name || UNAVAILABLE.test(p.name.replace(/\s+/g, ' ').trim());
  }

  // Interlocuteur unique d'une conversation à deux (participants officiels), sinon null.
  function otherParticipant(thread, meId) {
    if (!thread || thread.group !== false || !meId) return null;
    const others = (thread.participants || []).filter((p) => p.src === 'conv' && p.id && p.id !== meId);
    return others.length === 1 ? others[0] : null;
  }

  function evaluate(thread, meId, hl, now = Date.now(), excluded = null) {
    const s = compute(thread, meId);
    const ageMs = s.firstAt ? now - s.firstAt : null;
    const res = { ...s, ageMs, flagged: false, dismissed: false, excluded: false };
    if (!hl?.enabled || s.replied || !s.certain || s.count === 0) return res;
    const other = otherParticipant(thread, meId);
    if (other && unavailable(other)) return res;
    if (excluded && other && excluded.has(other.id)) {
      res.excluded = true;
      return res;
    }

    const ref = s.lastAt || 0;
    if (thread?.dismissedAt && thread.dismissedAt >= ref) {
      res.dismissed = true;
      return res;
    }

    const rules = [];
    if (hl.byCount) rules.push(s.count >= Math.max(1, Number(hl.minMessages) || 1));
    if (hl.byDelay) {
      rules.push(s.count >= Math.max(1, Number(hl.delayMinMessages) || 1) && ageMs != null && ageMs >= delayMs(hl));
    }
    res.flagged = rules.length > 0 && (hl.combine === 'all' ? rules.every(Boolean) : rules.some(Boolean));
    return res;
  }

  // Conversation connue seulement par le DOM : impossible de savoir si l'on y a déjà répondu, donc jamais surlignée.
  function evaluateDomOnly() {
    return { count: 0, firstAt: null, lastAt: null, ageMs: null, flagged: false, dismissed: false };
  }

  function formatAge(ms) {
    if (ms == null || ms < 0) return '';
    if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60e3))} min`;
    if (ms < 2 * DAY) return `${Math.round(ms / HOUR)} h`;
    return `${Math.round(ms / DAY)} j`;
  }

  function flaggedList(threads, meId, hl, now = Date.now(), excluded = null) {
    const out = [];
    for (const t of Object.values(threads || {})) {
      const r = evaluate(t, meId, hl, now, excluded);
      if (r.flagged) out.push({ thread: t, ...r });
    }
    return out.sort((a, b) => b.count - a.count || (b.ageMs || 0) - (a.ageMs || 0));
  }

  function displayName(thread, meId) {
    const others = (thread?.participants || []).filter((p) => p.id !== meId && p.name);
    if (others.length) return others.map((p) => p.name).join(', ');
    return thread?.domName || 'Conversation';
  }

  UL.stats = { compute, evaluate, otherParticipant, evaluateDomOnly, formatAge, flaggedList, displayName, delayMs };
})();
