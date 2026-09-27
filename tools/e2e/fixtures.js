// Données de test partagées entre le serveur et la page de messagerie factice.
(function () {
  const ME = 'ACoAAAME123';
  const DAY = 864e5;
  const now = Date.now();
  const threads = [
    { id: '2-QUFBMQ==', first: 'Jean', last: 'Dupont', pid: 'ACoAAJEAN', slug: 'jean-dupont', unread: 0, snippet: 'Jean : Vous avez vu mon offre ?',
      msgs: [['Jean', 12], ['Jean', 10], ['Jean', 9]] },
    { id: '2-QUFBMg==', first: 'Marie', last: 'Curie', pid: 'ACoAAMARIE', slug: 'marie-curie', unread: 0, snippet: 'Marie : Je me permets de vous relancer',
      msgs: [['Marie', 9], ['me', 8], ['Marie', 5], ['Marie', 4], ['Marie', 3]] },
    { id: '2-QUFBMw==', first: 'Paul', last: 'Martin', pid: 'ACoAAPAUL', slug: 'paul-martin', unread: 2, snippet: 'Paul : Petite relance',
      msgs: [['Paul', 3], ['Paul', 1]] },
    // Homonymes : deux « Dip Patel » ; seul le plus ancien est une relance (j'ai répondu au plus récent)
    { id: '2-RElQMQ==', first: 'Dip', last: 'Patel', pid: 'ACoAADIP1', slug: 'dip-patel-1', unread: 0, snippet: 'Dip : Merci pour votre réponse',
      msgs: [['Dip', 14], ['me', 13], ['Dip', 12]] },
    { id: '2-RElQMg==', first: 'Dip', last: 'Patel', pid: 'ACoAADIP2', slug: 'dip-patel-2', unread: 0, snippet: 'Dip : Hello, any update?',
      msgs: [['Dip', 22], ['Dip', 20], ['Dip', 18]] },
    // Plus ancienne : n'apparaît qu'après « Charger plus de conversations »
    { id: '2-QUFBNA==', first: 'Sophie', last: 'Leroy', pid: 'ACoAASOPHIE', slug: 'sophie-leroy', unread: 0, snippet: 'Sophie : Vous avez eu mon message ?',
      msgs: [['Sophie', 40], ['Sophie', 35], ['Sophie', 30], ['Sophie', 25]], page: 2 },
  ];
  const conv = (t) => `urn:li:msg_conversation:(urn:li:fsd_profile:${ME},${t.id})`;
  const part = (t, who) => who === 'me'
    ? { hostIdentityUrn: `urn:li:fsd_profile:${ME}`, participantType: { member: { firstName: { text: 'Moi' }, lastName: { text: 'Même' } } } }
    : { hostIdentityUrn: `urn:li:fsd_profile:${t.pid}`, participantType: { member: { firstName: { text: t.first }, lastName: { text: t.last }, profileUrl: `https://www.linkedin.com/in/${t.slug}`,
        headline: { text: `Business Developer chez ${t.last} Consulting` } } } };
  // Le dernier message a le texte affiché dans l'aperçu de la liste (sans le préfixe « Nom : »), comme sur LinkedIn.
  const msg = (t, [who, d], i) => ({ $type: 'com.linkedin.messenger.Message', entityUrn: `urn:li:msg_message:(urn:li:fsd_profile:${ME},${t.id}-${i})`,
    deliveredAt: now - d * DAY, sender: part(t, who),
    body: { text: i === t.msgs.length - 1 ? t.snippet.replace(/^[^:]+:\s*/, '') : `Message ${i} de ${who}` } });

  // La liste ne contient que le dernier message de chaque conversation, comme sur LinkedIn.
  const conversationsResponse = () => ({ data: { messengerConversationsBySyncToken: { elements: threads.map((t) => ({
    $type: 'com.linkedin.messenger.Conversation', entityUrn: conv(t), groupChat: false, unreadCount: t.unread,
    lastActivityAt: now - t.msgs[t.msgs.length - 1][1] * DAY,
    conversationParticipants: [part(t, 'me'), part(t, t.first)],
    creator: part(t, t.first),
    messages: { elements: [msg(t, t.msgs[t.msgs.length - 1], t.msgs.length - 1)] },
  })) } } });
  const messagesResponse = (id) => {
    const t = threads.find((x) => x.id === id);
    return { data: { messengerMessagesBySyncToken: { elements: t ? t.msgs.map((m, i) => msg(t, m, i)) : [] } } };
  };

  const FIX = { ME, threads, conv, conversationsResponse, messagesResponse };
  if (typeof module !== 'undefined') module.exports = FIX;
  else globalThis.FIX = FIX;
})();
