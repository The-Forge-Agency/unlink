// Test hors navigateur : parsing réseau (store.js) + règles de relance (stats.js).
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const mem = { local: {}, sync: {} };
const area = (a) => ({
  get: async (keys) => { const o = {}; for (const k of [].concat(keys)) if (k in mem[a]) o[k] = structuredClone(mem[a][k]); return o; },
  set: async (o) => Object.assign(mem[a], structuredClone(o)),
  remove: async (keys) => { for (const k of [].concat(keys)) delete mem[a][k]; },
});
const listeners = [];
const ctx = {
  console, setTimeout, clearTimeout, structuredClone, URL,
  chrome: { runtime: { id: 'test' }, storage: { local: area('local'), sync: area('sync'), onChanged: { addListener: (f) => listeners.push(f) } } },
  location: { origin: 'https://www.linkedin.com' },
  document: { cookie: '' },
};
ctx.globalThis = ctx;
let onMsg;
ctx.window = { addEventListener: (t, f) => t === 'message' && (onMsg = f), postMessage: () => {} };
vm.createContext(ctx);
for (const f of ['src/shared/settings.js', 'src/shared/stats.js', 'src/content/store.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
const UL = ctx.UnLink;

const ME = 'ACoAAAME123', JEAN = 'ACoAAJEAN456', T = '2-ZmFrZVRocmVhZA==';
const DAY = 864e5, now = Date.now();
const conv = `urn:li:msg_conversation:(urn:li:fsd_profile:${ME},${T})`;
const part = (id, fn, ln) => ({ hostIdentityUrn: `urn:li:fsd_profile:${id}`, participantType: { member: { firstName: { text: fn }, lastName: { text: ln }, profileUrl: `https://www.linkedin.com/in/${id}` } } });
const msg = (i, who, at) => ({ $type: 'com.linkedin.messenger.Message', entityUrn: `urn:li:msg_message:(urn:li:fsd_profile:${ME},2-m${i})`, deliveredAt: at, sender: who === ME ? part(ME, 'Moi', 'X') : part(JEAN, 'Jean', 'Dupont'), body: { text: 'x' } });

const hl = UL.settings.DEFAULTS.highlight;
const ingest = (url, body) => onMsg({ source: ctx.window, data: { source: 'unlink-net', url, text: JSON.stringify(body) } });
const msgsUrl = (c) => '/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.abc123&variables=(conversationUrn:' + encodeURIComponent(c) + ')';
const convOf = (t) => `urn:li:msg_conversation:(urn:li:fsd_profile:${ME},${t})`;
const convObj = (t, extra = {}) => ({ $type: 'com.linkedin.messenger.Conversation', entityUrn: convOf(t), groupChat: false, unreadCount: 0,
  lastActivityAt: now - DAY, conversationParticipants: [part(ME, 'Moi', 'X'), part(JEAN, 'Jean', 'Dupont')], creator: part(JEAN, 'Jean', 'Dupont'), ...extra });

// 1) Liste des conversations : seulement le dernier message → pas assez d'infos, jamais surligné
ingest('/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.abc&variables=(mailboxUrn:urn%3Ali%3Afsd_profile%3A' + ME + ')',
  { data: { messengerConversationsBySyncToken: { elements: [{ ...convObj(T), unreadCount: 3, messages: { elements: [msg(4, JEAN, now - 9 * DAY)] } }] } } });
assert.equal(UL.store.meId(), ME);
let t = UL.store.get(T);
assert.equal(t.group, false);
assert.equal(UL.stats.displayName(t, ME), 'Jean Dupont');
assert.equal(UL.stats.evaluate(t, ME, { ...hl, minMessages: 1 }, now).flagged, false, 'historique non chargé : jamais surligné');

// 2) Historique : j'ai répondu une fois, puis 3 relances → JAMAIS surligné
ingest(msgsUrl(convOf(T)), { data: { messengerMessagesBySyncToken: { elements: [
  msg(0, JEAN, now - 20 * DAY), msg(1, ME, now - 15 * DAY), msg(2, JEAN, now - 12 * DAY), msg(3, JEAN, now - 10 * DAY), msg(4, JEAN, now - 9 * DAY)] } } });
t = UL.store.get(T);
assert.ok(t.historyAt, 'historique marqué comme chargé');
let r = UL.stats.evaluate(t, ME, { ...hl, minMessages: 1 }, now);
assert.equal(r.replied, true);
assert.equal(r.flagged, false, 'déjà répondu : jamais surligné');

// 3) Jamais répondu, 3 messages → surligné, âge = premier message
const T2 = '2-bmV2ZXJSZXBsaWVk';
ingest('/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.abc&variables=(mailboxUrn:urn%3Ali%3Afsd_profile%3A' + ME + ')',
  { data: { messengerConversationsBySyncToken: { elements: [{ ...convObj(T2), lastActivityAt: now - 9 * DAY, messages: { elements: [msg(12, JEAN, now - 9 * DAY)] } }] } } });
ingest(msgsUrl(convOf(T2)), { data: { messengerMessagesBySyncToken: { elements: [
  msg(10, JEAN, now - 12 * DAY), msg(11, JEAN, now - 10 * DAY), msg(12, JEAN, now - 9 * DAY)] } } });
r = UL.stats.evaluate(UL.store.get(T2), ME, hl, now);
assert.equal(r.count, 3);
assert.ok(Math.abs(r.ageMs - 12 * DAY) < 1000);
assert.equal(r.flagged, true, 'jamais répondu : surligné');
console.log('flag:', r.count, UL.stats.formatAge(r.ageMs));

// 4) Règles
assert.equal(UL.stats.evaluate(UL.store.get(T2), ME, { ...hl, minMessages: 4, delayValue: 30 }, now).flagged, false);
assert.equal(UL.stats.evaluate(UL.store.get(T2), ME, { ...hl, minMessages: 4, delayValue: 10 }, now).flagged, true, 'délai seul');
assert.equal(UL.stats.evaluate(UL.store.get(T2), ME, { ...hl, combine: 'all', minMessages: 4 }, now).flagged, false, 'mode « les deux »');

// 5) Chaque indice de réponse exclut définitivement la conversation
for (const [label, p] of [['aperçu « Vous : »', { answeredHintAt: now }], ['message vu dans le fil', { domHasMine: true }]]) {
  assert.equal(UL.stats.evaluate({ ...UL.store.get(T2), ...p }, ME, hl, now).flagged, false, label);
}

// 5b) Activité plus récente que l'historique chargé (réponse possible depuis le téléphone) → pas surligné
assert.equal(UL.stats.evaluate({ ...UL.store.get(T2), lastActivityAt: UL.store.get(T2).historyAt + 1000 }, ME, hl, now).flagged, false, 'historique périmé');

// 6) Historique plein (≥ 20 messages) : réponses plus anciennes possibles → pas surligné
const full = { ...UL.store.get(T2), historySize: 20, msgs: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`m${i}`, [now - (30 - i) * DAY, JEAN]])) };
assert.equal(UL.stats.evaluate(full, ME, hl, now).flagged, false, 'historique tronqué');

// 7) Ignorer → masqué jusqu'au prochain message
UL.store.patch(T2, { dismissedAt: now + 1000 });
assert.equal(UL.stats.evaluate(UL.store.get(T2), ME, hl, now + 2000).flagged, false);
UL.store.patch(T2, { msgs: { new1: [now + 3000, JEAN] } });
assert.equal(UL.stats.evaluate(UL.store.get(T2), ME, hl, now + 4000).flagged, true);
// « creator » = moi n'empêche pas le signalement (cas réel : LinkedIn me désigne sans que j'aie écrit)
assert.equal(UL.stats.evaluate({ ...UL.store.get(T2), creatorId: ME }, ME, hl, now + 4000).flagged, true, 'creator ignoré');

// 7b) « LinkedIn Member » (compte supprimé / bloqué) : jamais proposé
{
  const t = UL.store.get(T2);
  const ghost = { ...t, participants: t.participants.map((p) => (p.id === JEAN ? { ...p, name: 'LinkedIn Member', firstName: 'LinkedIn', lastName: 'Member' } : p)) };
  assert.equal(UL.stats.evaluate(ghost, ME, hl, now + 4000).flagged, false, 'LinkedIn Member ignoré');
}

// 8) Conversation connue seulement par le DOM : jamais surlignée
assert.equal(UL.stats.evaluateDomOnly({ unread: 9, mine: false }, hl).flagged, false);

// 8b) Failles relevées par l'audit : aucune ne doit rendre une conversation « certaine »
const T4 = '2-YXVkaXQ=';
const conv4 = convOf(T4);
ingest('/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.abc&variables=(mailboxUrn:urn%3Ali%3Afsd_profile%3A' + ME + ')',
  { data: { messengerConversationsBySyncToken: { elements: [{ ...convObj(T4), messages: { elements: [msg(40, JEAN, now - 20 * DAY)] } }] } } });
// - mise à jour partielle (jeton de synchro) : pas un historique complet
ingest('/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.abc123&variables=(conversationUrn:' + encodeURIComponent(conv4) + ',syncToken:XYZ)',
  { data: { messengerMessagesBySyncToken: { elements: [msg(41, JEAN, now - 19 * DAY), msg(42, JEAN, now - 18 * DAY)] } } });
assert.equal(UL.store.get(T4).historyAt, undefined, 'delta ≠ historique');
assert.equal(UL.stats.evaluate(UL.store.get(T4), ME, { ...hl, minMessages: 1 }, now).flagged, false);
// - réponse d'erreur (200 + errors) : pas un historique
ingest(msgsUrl(conv4), { data: { messengerMessagesBySyncToken: null }, errors: [{ message: 'boom' }] });
assert.equal(UL.store.get(T4).historyAt, undefined, 'erreur ≠ historique');
// - un message incompris dans la page : pas certain
ingest(msgsUrl(conv4), { data: { messengerMessagesBySyncToken: { elements: [msg(41, JEAN, now - 19 * DAY), { deliveredAt: now - 17 * DAY, sender: { participantType: { organization: {} } } }] } } });
assert.equal(UL.store.get(T4).historyUnparsed, 1);
assert.equal(UL.stats.evaluate(UL.store.get(T4), ME, { ...hl, minMessages: 1 }, now).flagged, false, 'message incompris');
// - page pleine (20 éléments) : historique possiblement tronqué
ingest(msgsUrl(conv4), { data: { messengerMessagesBySyncToken: { elements: Array.from({ length: 20 }, (_, i) => msg(100 + i, JEAN, now - (40 - i) * DAY)) } } });
assert.equal(UL.store.get(T4).historySize, 20);
assert.equal(UL.stats.evaluate(UL.store.get(T4), ME, { ...hl, minMessages: 1 }, now).flagged, false, 'page pleine');
// - l'expéditeur d'un message cité n'est jamais un participant « officiel »
const T5 = '2-Y2l0ZQ==';
ingest(msgsUrl(convOf(T5)), { data: { messengerMessagesBySyncToken: { elements: [msg(200, 'ACoAAQUOTED', now - DAY)] } } });
assert.ok(UL.store.get(T5).participants.every((p) => p.src !== 'conv'), 'expéditeur ≠ participant officiel');
// - un même message vu sous deux URN n'est compté qu'une fois
ingest(msgsUrl(convOf(T5)), { data: { messengerMessagesBySyncToken: { elements: [{ ...msg(200, 'ACoAAQUOTED', now - DAY), entityUrn: 'autre-urn', backendUrn: 'autre' }] } } });
assert.equal(Object.keys(UL.store.get(T5).msgs).length, 1, 'dédoublonnage');

// 9) Réponse normalisée (included + références *sender / *conversation)
const T3 = '2-bm9ybWFsaXplZA==';
const conv3 = convOf(T3);
const pUrn = `urn:li:msg_messagingParticipant:urn:li:fsd_profile:${JEAN}`;
ingest('/voyager/api/voyagerMessagingDashMessengerMessages', { included: [
  { entityUrn: pUrn, hostIdentityUrn: `urn:li:fsd_profile:${JEAN}`, participantType: { member: { firstName: { text: 'Jean' }, lastName: { text: 'Dupont' } } } },
  { $type: 'com.linkedin.messenger.Message', entityUrn: 'urn:li:msg_message:a', deliveredAt: now - DAY, '*sender': pUrn, '*conversation': conv3 },
  { $type: 'com.linkedin.messenger.Message', entityUrn: 'urn:li:msg_message:b', deliveredAt: now - 2 * DAY, '*sender': pUrn, '*conversation': conv3 },
] });
assert.equal(UL.stats.compute(UL.store.get(T3), ME).count, 2, 'réponse normalisée');
const T2b = T2;

// 7) Persistance
setTimeout(async () => {
  assert.equal(mem.local.meId, ME);
  assert.ok(mem.local.threads[T] && mem.local.threads[T2b] && mem.local.threads[T3]);
  // Changement de compte : le cache de l'autre compte est effacé
  ingest('/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.abc&variables=(mailboxUrn:urn%3Ali%3Afsd_profile%3AACoAAOTHERACCOUNT)', { data: {} });
  assert.equal(UL.store.meId(), 'ACoAAOTHERACCOUNT');
  assert.equal(Object.keys(UL.store.all()).length, 0, 'changement de compte → cache vidé');
  console.log('Tous les tests passent ✓');
}, 800);
