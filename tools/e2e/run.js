// Test de bout en bout sur un faux LinkedIn local.
// Chrome résout www.linkedin.com vers ce serveur : aucune requête ne part vers le vrai site.
// Usage : node tools/e2e/run.js   (nécessite puppeteer : npm i -g puppeteer)
const https = require('https');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch {
  puppeteer = require(path.join(execSync('npm root -g').toString().trim(), 'puppeteer'));
}

const DIR = __dirname;
const EXT = path.resolve(DIR, '../..');
const PORT = 8443;
const FIX = require('./fixtures.js');
const log = [];
const connected = new Set(['ACoAAJEAN']); // Jean est en relation, Paul non
const deleted = new Set(); // conversations supprimées (historique vide ensuite, comme sur LinkedIn)

// Certificat auto-signé pour servir le faux www.linkedin.com en HTTPS (généré au premier lancement).
// Hors du dossier de l'extension, sinon Chrome signale une clé privée embarquée.
const CERT_DIR = path.join(require('os').tmpdir(), 'unlink-e2e');
if (!fs.existsSync(path.join(CERT_DIR, 'cert.pem'))) {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  execSync('openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 3650 -subj "/CN=www.linkedin.com"', { cwd: CERT_DIR, stdio: 'ignore' });
}
const SHOTS = process.env.SHOTS; // dossier où enregistrer des captures d'écran (optionnel)
const shot = (p, name) => SHOTS && p.screenshot({ path: path.join(SHOTS, `${name}.png`) });

const server = https.createServer({ key: fs.readFileSync(path.join(CERT_DIR, 'key.pem')), cert: fs.readFileSync(path.join(CERT_DIR, 'cert.pem')) }, (req, res) => {
  const url = new URL(req.url, 'https://www.linkedin.com');
  const send = (type, body) => {
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  };
  if (url.pathname === '/__fixtures.js') return send('text/javascript', fs.readFileSync(path.join(DIR, 'fixtures.js')));
  if (url.pathname.startsWith('/messaging')) return send('text/html', fs.readFileSync(path.join(DIR, 'mock-messaging.html')));
  // Requêtes observées sur le vrai LinkedIn (sept. 2026) : niveau de relation, identifiant public, retrait
  const person = (id) => FIX.threads.find((t) => t.pid === id);
  if (url.pathname === '/voyager/api/graphql' && /voyagerIdentityDashProfiles/.test(url.search)) {
    const id = /fsd_profile:(ACoA[\w-]+)/.exec(decodeURIComponent(url.search))?.[1];
    // Structure réelle : entité memberRelationship de la personne (+ entités d'autres profils pour piéger une lecture naïve)
    const rel = connected.has(id) ? { '*connection': `urn:li:fsd_connection:${id}`, noConnection: null } : { '*connection': null, noConnection: { $type: 'x' } };
    return send('application/json', JSON.stringify({ data: {}, included: [
      { entityUrn: 'urn:li:fsd_memberRelationship:ACoAAOTHER', memberRelationship: { '*connection': 'urn:li:fsd_connection:ACoAAOTHER' } },
      { entityUrn: `urn:li:fsd_profile:${id}`, '*memberRelationship': `urn:li:fsd_memberRelationship:${id}` },
      { entityUrn: `urn:li:fsd_memberRelationship:${id}`, memberRelationship: rel },
    ] }));
  }
  if (/^\/in\/ACoA/.test(url.pathname) && !req.headers['sec-fetch-dest']?.includes('document')) {
    const t = person(url.pathname.split('/')[2]);
    // Lien qui relie identifiant public et identifiant interne (présent seulement pour une relation) + un piège
    const bind = t && connected.has(t.pid) ? `<a href="/in/${t.slug}/edit/forms/recommendation/request/?profileUrn=urn%3Ali%3Afsd_profile%3A${t.pid}">Recommandation</a>` : '';
    return send('text/html', `<html><body><a href="https://www.linkedin.com/in/suggestion-x/overlay/contact-info/">x</a>${bind}<a href="https://www.linkedin.com/in/${t?.slug}/overlay/contact-info/">Coordonnées</a></body></html>`);
  }
  if (url.pathname === '/flagship-web/rsc-action/actions/server-request' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const pl = JSON.parse(body).serverRequest?.requestedArguments?.payload || {};
      const t = person(pl.nonIterableProfileId);
      if (!req.headers['csrf-token'] || url.searchParams.get('sduiid') !== 'com.linkedin.sdui.mynetwork.RemoveConnectionVanityName' || !t || pl.disconnectVanityName !== t.slug) {
        res.writeHead(400);
        return res.end('{}');
      }
      log.push({ action: 'remove', via: 'sdui', vanity: pl.disconnectVanityName, first: pl.disconnectFirstName, last: pl.disconnectLastName });
      setTimeout(() => connected.delete(t.pid), 300); // LinkedIn met un instant à refléter le retrait
      send('application/json', '{}');
    });
    return;
  }
  if (url.pathname.startsWith('/in/')) return send('text/html', fs.readFileSync(path.join(DIR, 'mock-profile.html')));
  // Suppression de discussion (requête observée) ; refusée pour Paul afin de tester le secours par le menu
  if (req.method === 'DELETE' && url.pathname.startsWith('/voyager/api/voyagerMessagingDashMessengerConversations/')) {
    const urn = decodeURIComponent(url.pathname.split('/').pop());
    const thread = /,(2-[^)]+)\)$/.exec(urn)?.[1];
    if (!req.headers['csrf-token'] || !/^urn:li:msg_conversation:\(urn:li:fsd_profile:ACoAAAME123,2-/.test(urn) || thread === '2-QUFBMw==') {
      res.writeHead(500);
      return res.end();
    }
    log.push({ action: 'delete', via: 'api', thread });
    deleted.add(thread);
    res.writeHead(204);
    return res.end();
  }
  if (url.pathname === '/mock-log') {
    log.push(Object.fromEntries(url.searchParams));
    if (url.searchParams.get('action') === 'delete') deleted.add(url.searchParams.get('thread'));
    return send('application/json', '{}');
  }
  if (url.pathname.includes('voyagerMessagingGraphQL')) {
    const vars = decodeURIComponent(url.search);
    if (vars.includes('messengerMessages')) {
      const id = /,(2-[^)]+)\)/.exec(vars)?.[1];
      return send('application/json', JSON.stringify(deleted.has(id) ? { data: { messengerMessagesBySyncToken: { elements: [] } } } : FIX.messagesResponse(id)));
    }
    return send('application/json', JSON.stringify(FIX.conversationsResponse()));
  }
  res.writeHead(404);
  res.end();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 15000, label = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  throw new Error(`Timeout : ${label}`);
}

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    headless: process.env.HEADFUL ? false : true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      `--host-resolver-rules=MAP www.linkedin.com 127.0.0.1:${PORT}`,
      '--ignore-certificate-errors',
      '--no-first-run',
    ],
  });
  let failed = false;
  try {
    // Attendre le service worker de l'extension et fermer la page d'options ouverte à l'installation.
    const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'), { timeout: 10000 });
    console.log('✓ extension chargée', sw.url().split('/')[2]);
    await sleep(800);
    for (const p of await browser.pages()) if (p.url().includes('options.html')) await p.close();

    // Page de masse ouverte avant toute analyse : état vide explicite, jamais un tableau vide
    {
      const extId0 = sw.url().split('/')[2];
      const b0 = await browser.newPage();
      await b0.setViewport({ width: 1100, height: 700 });
      await b0.goto(`chrome-extension://${extId0}/src/bulk/bulk.html`);
      await sleep(600);
      const empty = await b0.evaluate(() => ({ visible: !document.querySelector('#empty').hidden, title: document.querySelector('#empty-title').textContent, btn: document.querySelector('#empty-action').textContent, line: document.querySelector('#summary-line').textContent }));
      assert.ok(empty.visible && /pas encore analysé/.test(empty.title), JSON.stringify(empty));
      await shot(b0, '7-bulk-vide');
      await b0.close();
      console.log('✓ page de masse vide : explication + bouton « ' + empty.btn + ' »');
    }

    const page = await browser.newPage();
    page.on('console', (m) => /UnLink/.test(m.text()) && console.log('  [page]', m.text()));
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
    await page.setCookie({ name: 'JSESSIONID', value: '"ajax:123"', domain: 'www.linkedin.com', path: '/' });
    await page.goto(`https://www.linkedin.com/messaging/thread/${encodeURIComponent(FIX.threads[0].id)}/`);

    // 1) Surbrillance
    const flags = await until(async () => {
      const r = await page.$$eval('li.msg-conversation-listitem', (lis) =>
        lis.map((li) => ({
          name: li.querySelector('h3').textContent,
          flag: li.hasAttribute('data-unlink-flag'),
          badge: li.querySelector('.unlink-badge span')?.textContent || '',
        }))
      );
      // l'historique des autres conversations se charge en arrière-plan, une à une
      return r.find((x) => x.name.startsWith('Jean'))?.flag && r.filter((x) => x.name === 'Dip Patel')[1]?.flag ? r : null;
    }, 20000, 'surbrillance de Jean et du 2e Dip Patel');
    console.table(flags);
    assert.match(flags[0].badge, /^3 sans réponse · 12 j$/);
    assert.equal(flags[1].flag, false, 'Marie : j’ai déjà répondu une fois → jamais proposée, malgré 3 relances');
    assert.equal(flags[2].flag, false, 'Paul : 2 non lus < 3 et délai insuffisant');
    assert.deepEqual([flags[3].name, flags[3].flag, flags[4].name, flags[4].flag], ['Dip Patel', false, 'Dip Patel', true], 'homonymes départagés par l’ordre de la liste');
    console.log('✓ surbrillance correcte');

    // Vue « Jamais répondu » : panneau de l'extension, liste de LinkedIn intacte, aucun chargement sans clic
    const rowsBefore = await page.$$eval('li.msg-conversation-listitem', (l) => l.length);
    await page.click('.unlink-filter-chip');
    const filtered = await until(async () => {
      const r = await page.$$eval('.unlink-prow b', (els) => els.map((e) => e.textContent));
      return r.includes('Sophie Leroy') ? r : null;
    }, 20000, 'panneau « Jamais répondu » complet');
    assert.deepEqual(filtered, ['Jean Dupont', 'Dip Patel', 'Sophie Leroy']);
    assert.equal(await page.$eval('.unlink-filter-chip b', (b) => b.textContent), '3');
    await sleep(3000);
    assert.equal(await page.$$eval('li.msg-conversation-listitem', (l) => l.length), rowsBefore, 'aucun chargement automatique');
    console.log('✓ vue « Jamais répondu » : Jean, Dip Patel et Sophie (conversation non chargée) ; aucun chargement sans clic');
    await page.click('.unlink-filter-more');
    await until(() => page.$$eval('li.msg-conversation-listitem', (l) => l.length).then((n) => n > rowsBefore), 10000, 'chargement après clic');
    console.log('✓ « Charger 100 de plus » charge la suite, uniquement sur clic');
    await shot(page, '8-filtre-actif');
    // Colonne étroite (300 px) + couleur verte : rien ne doit déborder
    await page.evaluate(() => { document.querySelector('.msg-conversations-container').style.width = '300px'; document.documentElement.style.setProperty('--unlink-color', '#10b981'); });
    await sleep(300);
    const overflow = await page.evaluate(() => [...document.querySelectorAll('.unlink-filter-bar button')].filter((b) => b.scrollWidth > b.clientWidth + 1 && !b.hidden).map((b) => b.className));
    await shot(page, '9-filtre-etroit');
    console.log('débordements :', JSON.stringify(overflow));
    assert.deepEqual(overflow, [], 'aucun bouton ne déborde');
    await page.evaluate(() => { document.querySelector('.msg-conversations-container').style.width = '360px'; document.documentElement.style.removeProperty('--unlink-color'); });
    console.log('✓ barre lisible en colonne étroite (300 px)');
    await page.click('.unlink-filter-chip');
    await sleep(400);
    await shot(page, '1-surbrillance');

    // 2) Bouton dans l'en-tête → nettoyage complet
    await page.waitForSelector('.unlink-thread-btn', { timeout: 5000 });
    console.log('✓ bouton ⚡ UnLink injecté dans l’en-tête');
    const pagesBefore = (await browser.pages()).length;
    await page.click('.unlink-thread-btn');
    await sleep(600);
    await shot(page, '2-compte-a-rebours');
    await sleep(2200);
    await shot(page, '3-en-cours');
    await until(() => log.some((l) => l.action === 'delete'), 30000, 'suppression de la conversation de Jean');
    const cardDone = () => page.evaluate(() => /\b(ok|fail)\b/.test([...(document.querySelector('unlink-root')?.shadowRoot?.querySelectorAll('.card') || [])].pop()?.className || ''));
    await until(cardDone, 15000, 'fin du nettoyage de Jean');
    console.log('journal :', log);
    assert.deepEqual(log.map((l) => l.action), ['remove', 'delete']);
    assert.equal(log[0].via, 'sdui', 'retrait via la requête directe');
    assert.deepEqual([log[0].vanity, log[0].first, log[0].last], ['jean-dupont', 'Jean', 'Dupont']);
    assert.equal(log[1].thread, '2-QUFBMQ==');
    assert.equal(log[1].via, 'api', 'suppression via la requête directe');
    const snapshot = () => page.evaluate(() => ({
      jeanVisible: [...document.querySelectorAll('li.msg-conversation-listitem')].some((li) => li.textContent.includes('Jean') && li.style.display !== 'none'),
      path: location.pathname,
    }));
    // L'ouverture de la conversation suivante se fait en arrière-plan, juste après le ✓
    const after = await until(async () => { const x = await snapshot(); return x.jeanVisible ? null : x; }, 5000, 'Jean masqué').catch(snapshot);
    assert.equal(after.jeanVisible, false, 'Jean masqué de la liste');
    assert.notEqual(decodeURIComponent(after.path), '/messaging/thread/2-QUFBMQ==/', 'conversation suivante ouverte');
    await sleep(500);
    const cardText = await page.evaluate(() => document.querySelector('unlink-root')?.shadowRoot.querySelector('.card')?.innerText || '');
    console.log('carte :', JSON.stringify(cardText));
    assert.equal((await browser.pages()).length, pagesBefore, 'onglet profil refermé');
    console.log('✓ retrait de relation + suppression par requêtes directes, liste mise à jour, aucun onglet ouvert');

    // 3) Bouton rapide de la liste sur Paul (ni suivi ni relation) → étapes profil ignorées, conversation supprimée
    log.length = 0;
    await sleep(3800); // laisser la carte précédente se fermer
    await page.evaluate(() => {
      const li = [...document.querySelectorAll('li.msg-conversation-listitem')].find((x) => x.textContent.includes('Paul'));
      li.querySelector('.unlink-quick').click();
    });
    await until(() => log.some((l) => l.action === 'delete'), 30000, 'suppression de la conversation de Paul');
    await sleep(300);
    const card2 = await page.evaluate(() => [...document.querySelector('unlink-root').shadowRoot.querySelectorAll('.card')].pop()?.innerText || '');
    console.log('carte :', JSON.stringify(card2));
    assert.deepEqual(log.map((l) => l.action), ['delete']);
    assert.equal(log[0].thread, '2-QUFBMw==');
    assert.equal(log[0].via, undefined, 'secours par le menu « … »');
    assert.match(card2, /pas en relation/);
    console.log('✓ bouton de liste : « pas en relation » détecté, requête refusée → suppression via le menu (secours)');

    // 4) Nettoyage en masse : Dip Patel décoché (→ exclu), Sophie traitée (pas en relation → suppression seule)
    log.length = 0;
    const extIdB = sw.url().split('/')[2];
    let bulk = await browser.newPage();
    bulk.on('dialog', (d) => d.accept());
    await bulk.goto(`chrome-extension://${extIdB}/src/bulk/bulk.html`);
    await until(() => bulk.$$eval('#rows tr', (trs) => trs.length >= 2), 10000, 'liste de masse');
    const bulkNames = await bulk.$$eval('#rows tr .name', (els) => els.map((e) => e.textContent));
    console.log('liste de masse :', bulkNames);
    assert.ok(bulkNames.includes('Sophie Leroy') && bulkNames.includes('Dip Patel'));
    await bulk.evaluate(() => [...document.querySelectorAll('#rows tr')].find((tr) => tr.textContent.includes('Dip Patel')).querySelector('input').click());
    await bulk.click('input[name="pace"][value="fast"] + span');
    await bulk.click('#start');
    // La page est fermée aussitôt : le lot doit continuer en tâche de fond (service worker).
    await sleep(500);
    await bulk.close();
    await until(() => log.some((l) => l.action === 'delete' && l.thread === '2-QUFBNA=='), 60000, 'suppression de Sophie page fermée');
    console.log('✓ lot poursuivi en tâche de fond, page fermée');
    const bulk2 = await browser.newPage();
    await bulk2.goto(`chrome-extension://${extIdB}/src/bulk/bulk.html`);
    await until(() => bulk2.$eval('#run-status', (e) => /terminé|arrêté/i.test(e.textContent)), 30000, 'état retrouvé à la réouverture');
    bulk = bulk2;
    const sophie = await bulk.$$eval('#rows tr', (trs) => trs.find((tr) => tr.textContent.includes('Sophie'))?.querySelector('.status')?.innerText);
    console.log('Sophie :', JSON.stringify(sophie));
    assert.match(sophie, /– relation — pas en relation/);
    assert.match(sophie, /✓ conversation/);
    assert.ok(log.some((l) => l.action === 'delete' && l.thread === '2-QUFBNA=='), 'Sophie supprimée');
    const excluded = await bulk.evaluate(async () => (await chrome.storage.local.get('excluded')).excluded || {});
    assert.ok(excluded.ACoAADIP2, 'Dip Patel décoché → exclu');
    assert.ok(!log.some((l) => l.thread === '2-RElQMg=='), 'rien fait sur Dip Patel exclu');
    await bulk.setViewport({ width: 1100, height: 640 });
    await shot(bulk, '6-bulk');
    console.log('✓ nettoyage en masse : décoché → exclu, Sophie revérifiée puis supprimée');
    await bulk.close();

    // 5) Popup : relances et cache
    const extId = sw.url().split('/')[2];
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
    await sleep(500);
    await popup.setViewport({ width: 360, height: 600 });
    await shot(popup, '4-popup');
    await popup.click('input[name="countdown"][value="1"] + span');
    await sleep(300);
    const popupInfo = await popup.evaluate(async () => ({ cleaned: document.querySelector('#cleaned').textContent, countdown: (await chrome.storage.sync.get('settings')).settings.countdownSeconds }));
    assert.equal(popupInfo.countdown, 1, 'délai enregistré comme nombre');
    console.log('popup :', popupInfo);
    assert.ok(/nettoyée/.test(popupInfo.cleaned));
    console.log('✓ popup OK');

    const opts = await browser.newPage();
    const errs = [];
    opts.on('pageerror', (e) => errs.push(e.message));
    await opts.setViewport({ width: 900, height: 1500 });
    await opts.goto(`chrome-extension://${extId}/src/options/options.html`);
    await sleep(400);
    await shot(opts, '5-options');
    await opts.click('input[data-key="highlight.byDelay"]');
    await sleep(300);
    const stored = await opts.evaluate(() => chrome.storage.sync.get('settings'));
    assert.equal(stored.settings.highlight.byDelay, false);
    assert.equal(errs.length, 0, errs.join('\n'));
    console.log('✓ page d’options : enregistrement OK');

    console.log('\nE2E : tout passe ✓');
  } catch (e) {
    failed = true;
    console.error('\n✗ ÉCHEC :', e.message);
    console.error('journal :', log);
    try {
      const sw = browser.targets().find((t) => t.type() === 'service_worker' && t.url().includes('background.js'));
      const extId = sw?.url().split('/')[2];
      const dbg = await browser.newPage();
      await dbg.goto(`chrome-extension://${extId}/src/popup/popup.html`);
      const dump = await dbg.evaluate(async () => {
        const l = await chrome.storage.local.get(null); const s = await UnLink.settings.get();
        return { meId: l.meId, msgQueryId: l.msgQueryId, threads: Object.values(l.threads || {}).map((t) => ({ id: t.id, name: UnLink.stats.displayName(t, l.meId), hist: t.historyAt ? 'oui' : 'non', size: t.historySize, unparsed: t.historyUnparsed, owner: t.ownerId, lastAct: t.lastActivityAt, histAt: t.historyAt, parts: (t.participants || []).map((p) => `${p.name}:${p.src}`).join(','), ...UnLink.stats.evaluate(t, l.meId, s.highlight) })) };
      });
      console.error('cache :', JSON.stringify(dump, null, 1));
    } catch (e) { console.error('diag', e.message); }
    for (const p of await browser.pages()) {
      const card = await p.evaluate(() => [...(document.querySelector('unlink-root')?.shadowRoot?.querySelectorAll('.card') || [])].map((c) => c.innerText).join(' | ')).catch(() => '');
      console.error('onglet :', p.url(), card ? `carte : ${JSON.stringify(card)}` : '');
    }
  } finally {
    await browser.close();
    server.close();
    process.exit(failed ? 1 : 0);
  }
})();
