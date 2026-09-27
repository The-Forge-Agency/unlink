// Génère les visuels du Chrome Web Store dans store/ : captures 1280×800, tuile 440×280, bannière 1400×560.
// Les scènes de messagerie sont des reconstitutions génériques (personnes fictives, sans marque LinkedIn) qui utilisent
// le vrai CSS de l'extension ; la page d'accueil et le nettoyage en masse sont de vraies captures.
// Usage : node tools/store-assets.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
let puppeteer;
try { puppeteer = require('puppeteer'); } catch { puppeteer = require(path.join(execSync('npm root -g').toString().trim(), 'puppeteer')); }

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'store');
fs.mkdirSync(OUT, { recursive: true });

const uiSrc = fs.readFileSync(path.join(ROOT, 'src/content/ui.js'), 'utf8');
const PAGE_CSS = /const PAGE_CSS = `([\s\S]*?)`;/.exec(uiSrc)[1];
const CARD_CSS = /const CSS = `([\s\S]*?)`;/.exec(uiSrc)[1].replace(':host { all: initial; }', '').replace('.stack { position: fixed; right: 20px; bottom: 20px;', '.stack { position: absolute; right: 28px; bottom: 28px;');
const BOLT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.2 2 4.5 13.4h6.3L9.9 22l8.6-11.6h-6.2L13.2 2z"/></svg>';
const LOGO = `data:image/svg+xml;base64,${fs.readFileSync(path.join(ROOT, 'assets/logo.svg')).toString('base64')}`;
const FONT = `data:font/woff2;base64,${fs.readFileSync(path.join(ROOT, 'src/ui/fonts/bricolage-grotesque-latin-wght-normal.woff2')).toString('base64')}`;

const PEOPLE = [
  ['Clara Moreau', 'Head of Growth · SaaS B2B', '3 msg · 12 j', 'Je me permets de revenir vers vous concernant ma proposition de la semaine dernière…', '#c7d2fe'],
  ['James Porter', 'Business Developer', '5 msg · 34 j', 'Quick follow-up on my last message — would you have 15 minutes this week?', '#fde68a'],
  ['Nadia Lefèvre', 'Consultante recrutement IT', '2 msg · 9 j', 'Petite relance 🙂 Avez-vous eu le temps de regarder les profils que je vous ai envoyés ?', '#bbf7d0'],
  ['Tomás Kovač', 'Offshore development partner', '4 msg · 61 j', 'Did you get a chance to look at it? We have a bench of senior developers ready…', '#fecaca'],
  ['Inès Garnier', 'Account Executive', '2 msg · 18 j', 'Bonjour, je reviens vers vous au sujet de notre solution de prospection automatisée.', '#e9d5ff'],
  ['Marco Bellini', 'Lead generation expert', '6 msg · 73 j', 'Just circling back! Quick question about your pipeline for Q4…', '#bae6fd'],
];

const initials = (n) => n.split(' ').map((w) => w[0]).join('').slice(0, 2);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const BASE_CSS = `
  @font-face { font-family: "Bricolage Grotesque"; src: url(${FONT}) format("woff2"); font-weight: 200 800; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #18202e; background: #eef1f5; }
  :root { --unlink-color: #f5a30b; }
  .caption { height: 150px; padding: 34px 56px 0; display: flex; align-items: center; gap: 22px; }
  .caption img { width: 58px; height: 58px; }
  .caption h1 { font: 760 40px/1.05 "Bricolage Grotesque", sans-serif; letter-spacing: -.025em; margin: 0; }
  .caption p { margin: 6px 0 0; font-size: 18px; color: #5b6475; }
  .window { position: absolute; left: 56px; right: 56px; top: 170px; bottom: 0; background: #fff; border-radius: 16px 16px 0 0;
    box-shadow: 0 20px 60px rgba(24,32,46,.14); overflow: hidden; display: grid; grid-template-columns: 400px 1fr; }
  .side { border-right: 1px solid #e3e6ec; position: relative; overflow: hidden; }
  .side-title { padding: 16px 16px 10px; font-weight: 700; font-size: 18px; }
  .main { position: relative; background: #fbfcfd; }
  .thread-head { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid #e3e6ec; background: #fff; }
  .thread-head .who { flex: 1; }
  .thread-head b { font-size: 17px; }
  .thread-head .who span { display: block; color: #5b6475; font-size: 13px; }
  .dots { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: #5b6475; font-weight: 700; }
  .msgs { padding: 22px 24px; display: grid; gap: 14px; }
  .bubble { max-width: 70%; background: #fff; border: 1px solid #e3e6ec; border-radius: 14px; padding: 12px 14px; }
  .bubble small { display: block; color: #8a93a4; font-size: 12px; margin-bottom: 4px; }
  .av { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 14px; color: #18202e; }
  ${PAGE_CSS}
  .unlink-panel { position: static; }
  .unlink-filter-bar { background: #fff; }
`;

function panelRows(people, current = 0) {
  return people
    .map(([name, , meta, text, color], i) => `
      <div class="unlink-prow" ${i === current ? 'aria-current="true"' : ''}>
        <span class="unlink-prow-av" style="background:${color}">${initials(name)}</span>
        <div class="unlink-prow-body"><div class="unlink-prow-head"><b>${esc(name)}</b><span class="unlink-prow-meta">${meta}</span></div>
          <p class="unlink-prow-text">${esc(text)}</p></div>
        <button class="unlink-prow-run">${BOLT}</button>
      </div>`)
    .join('');
}

function filterBar(n) {
  return `<div class="unlink-filter-bar">
    <div class="unlink-seg"><button class="unlink-seg-all" aria-pressed="false">Toutes</button>
      <button class="unlink-filter-chip" aria-pressed="true">${BOLT}<span>Jamais répondu</span><b>${n}</b></button></div>
    <div class="unlink-filter-row"><button class="unlink-filter-more">Charger plus</button><button class="unlink-filter-bulk">Tout nettoyer</button></div>
  </div>`;
}

function thread([name, headline, , text, color]) {
  return `<div class="thread-head"><span class="av" style="background:${color}">${initials(name)}</span>
      <div class="who"><b>${esc(name)}</b><span>${esc(headline)}</span></div>
      <button class="unlink-thread-btn">${BOLT}<span>UnLink</span></button><span class="dots">•••</span></div>
    <div class="msgs">
      <div class="bubble"><small>${esc(name)} · il y a 3 semaines</small>Bonjour, j’ai une proposition qui pourrait vous intéresser…</div>
      <div class="bubble"><small>${esc(name)} · il y a 2 semaines</small>Je me permets de vous relancer au sujet de mon précédent message.</div>
      <div class="bubble"><small>${esc(name)} · il y a 12 jours</small>${esc(text)}</div>
    </div>`;
}

const scene = (caption, sub, inner, extraCss = '') => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${BASE_CSS}${extraCss}</style></head><body style="width:1280px;height:800px;position:relative;overflow:hidden">
  <div class="caption"><img src="${LOGO}" alt=""><div><h1>${caption}</h1><p>${sub}</p></div></div>
  <div class="window">${inner}</div></body></html>`;

(async () => {
  const b = await puppeteer.launch({
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, ...(process.env.CI ? ['--no-sandbox'] : [])],
  });
  const sw = await b.waitForTarget((t) => t.type() === 'service_worker', { timeout: 15000 });
  const extId = sw.url().split('/')[2];
  await new Promise((r) => setTimeout(r, 1500));
  const p = await b.newPage();
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  const shoot = async (html, file, w = 1280, h = 800) => {
    await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await p.setContent(html, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 300));
    await p.screenshot({ path: path.join(OUT, file) });
    console.log('✓', file);
  };

  // 1. Vue « Jamais répondu »
  await shoot(
    scene('Ne vois que ceux qui insistent', 'La vue « Jamais répondu » garde les conversations où l’on t’écrit alors que tu n’as jamais répondu.',
      `<div class="side"><div class="side-title">Messagerie</div>${filterBar(17)}<div class="unlink-panel"><p class="unlink-panel-status">17 conversations sans réponse de ta part · 582 analysées</p>${panelRows(PEOPLE)}</div></div>
       <div class="main">${thread(PEOPLE[0])}</div>`),
    'screenshot-1-jamais-repondu.png');

  // 2. Nettoyage en un geste
  const card = `<div class="stack"><div class="card ok" style="--c:#f5a30b">
      <div class="head"><span class="bolt">${BOLT}</span><div class="title">James Porter</div><button class="x">×</button></div>
      <ul><li data-s="done"><span class="ic">✓</span><span>Retirer la relation</span><span class="nt"></span></li>
          <li data-s="done"><span class="ic">✓</span><span>Supprimer la conversation</span><span class="nt"></span></li></ul>
      <div class="foot"><span class="done-in">Terminé en 1,4 s</span></div></div></div>`;
  await shoot(
    scene('Un geste, et c’est réglé', 'Bouton ⚡ UnLink ou ⌥⇧U : la relation est retirée, la conversation supprimée. Chaque action est vérifiée.',
      `<div class="side"><div class="side-title">Messagerie</div>${filterBar(16)}<div class="unlink-panel"><p class="unlink-panel-status">16 conversations sans réponse de ta part · 582 analysées</p>${panelRows(PEOPLE.slice(0, 1).concat(PEOPLE.slice(2)), -1)}</div></div>
       <div class="main">${thread(PEOPLE[1])}${card}</div>`, CARD_CSS),
    'screenshot-2-un-geste.png');

  // 3. Nettoyage en masse (vraie page, données fictives)
  const me = 'ACoAAMOI';
  const threads = {};
  PEOPLE.forEach(([name, headline, meta, text], i) => {
    const id = `2-FAKE${i}`;
    const pid = `ACoAAFAKE${i}`;
    const [first, ...rest] = name.split(' ');
    const n = parseInt(meta, 10);
    const days = parseInt(meta.split('·')[1], 10);
    const now = Date.now();
    threads[id] = {
      id, group: false, ownerId: me, lastActivityAt: now - days * 864e5, historyAt: now, historySize: n, historyUnparsed: 0, lastText: text, lastMsgAt: now - days * 864e5,
      participants: [{ id: me, src: 'conv', name: 'Moi' }, { id: pid, src: 'conv', name, firstName: first, lastName: rest.join(' '), headline }],
      msgs: Object.fromEntries(Array.from({ length: n }, (_, k) => [`m${k}`, [now - (days + k) * 864e5, pid]])),
    };
  });
  const setup = await b.newPage();
  await setup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  await setup.evaluate(async (threads, me) => chrome.storage.local.set({ threads, meId: me }), threads, me);
  await setup.close();
  await p.setViewport({ width: 1280, height: 800 });
  await p.goto(`chrome-extension://${extId}/src/bulk/bulk.html`);
  await new Promise((r) => setTimeout(r, 1200));
  await p.evaluate(() => { const r = document.querySelectorAll('#rows input[type="checkbox"]'); if (r[3]) r[3].click(); });
  await new Promise((r) => setTimeout(r, 200));
  await p.screenshot({ path: path.join(OUT, 'screenshot-3-nettoyage-en-masse.png') });
  console.log('✓ screenshot-3-nettoyage-en-masse.png');

  // 4. Page d'accueil (vraie page, fin de l'animation)
  await p.goto(`chrome-extension://${extId}/src/welcome/welcome.html`);
  await new Promise((r) => setTimeout(r, 3400));
  await p.screenshot({ path: path.join(OUT, 'screenshot-4-accueil.png') });
  console.log('✓ screenshot-4-accueil.png');

  // Tuile 440×280 et bannière 1400×560
  const promoCss = `body { background: #18202e; color: #f6f7f9; font-family: "Bricolage Grotesque", sans-serif; display: grid; place-items: center; }`;
  await shoot(`<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${promoCss}
      .t { display: grid; justify-items: center; gap: 12px; text-align: center; }
      .t img { width: 86px; height: 86px; } .t h1 { margin: 0; font: 760 38px/1 "Bricolage Grotesque"; letter-spacing: -.02em; }
      .t p { margin: 0; font: 500 16px/1.3 -apple-system, sans-serif; color: #c9cfda; max-width: 330px; }</style></head>
      <body style="width:440px;height:280px"><div class="t"><img src="${LOGO}"><h1>UnLink</h1><p>Nettoie les relances LinkedIn restées sans réponse, en un geste.</p></div></body></html>`,
    'promo-440x280.png', 440, 280);
  await shoot(`<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${promoCss}
      .m { width: 1400px; height: 560px; display: grid; grid-template-columns: 1fr 520px; align-items: center; gap: 60px; padding: 0 90px; }
      .m img { width: 84px; height: 84px; } .m h1 { margin: 22px 0 14px; font: 780 62px/1.02 "Bricolage Grotesque"; letter-spacing: -.035em; }
      .m .pitch { margin: 0; font: 400 21px/1.45 -apple-system, sans-serif; color: #c9cfda; max-width: 30em; }
      .m .ui { background: #fff; color: #18202e; border-radius: 16px; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,.35); }</style></head>
      <body style="width:1400px;height:560px"><div class="m"><div><img src="${LOGO}"><h1>Ta messagerie LinkedIn va respirer.</h1>
      <p class="pitch">UnLink repère les relances restées sans réponse, retire la relation et supprime la conversation en un geste. Tout reste dans ton navigateur.</p></div>
      <div class="ui">${filterBar(17)}<div class="unlink-panel">${panelRows(PEOPLE.slice(0, 4), -1)}</div></div></div></body></html>`,
    'marquee-1400x560.png', 1400, 560);

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
