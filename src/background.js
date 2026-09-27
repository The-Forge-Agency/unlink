// Service worker : raccourcis clavier, onglet profil en arrière-plan, badge de l'icône.
importScripts('shared/settings.js', 'shared/stats.js', 'shared/exclusions.js');
const UL = globalThis.UnLink;

// ---------- raccourcis ----------

chrome.commands.onCommand.addListener(async (command, tab) => {
  tab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id || !tab.url?.startsWith('https://www.linkedin.com/')) return;
  const type = command === 'run-cleanup' ? 'UNLINK_RUN' : command === 'next-flagged' ? 'UNLINK_NEXT' : null;
  if (type) chrome.tabs.sendMessage(tab.id, { type }).catch(() => {});
});

async function shortcutFor(name) {
  const cmds = await chrome.commands.getAll();
  return cmds.find((c) => c.name === name)?.shortcut || '';
}

// ---------- actions sur le profil (onglet d'arrière-plan) ----------

function waitTabComplete(tabId, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('le profil met trop de temps à charger'));
    }, timeout);
    function onUpdated(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === 'complete') onUpdated(tabId, { status: 'complete' });
    }, reject);
  });
}

async function runProfileJob({ profileUrl, unfollow, removeConnection, mode, keepTabOnFailure }, senderTab) {
  if (!/^https:\/\/www\.linkedin\.com\/in\//.test(profileUrl || '')) return { error: 'URL de profil invalide' };

  let tabId;
  let windowId = null;
  if (mode === 'popup') {
    const win = await chrome.windows.create({ url: profileUrl, type: 'popup', focused: false, width: 560, height: 820 });
    windowId = win.id;
    tabId = win.tabs[0].id;
  } else {
    const tab = await chrome.tabs.create({
      url: profileUrl,
      active: false,
      windowId: senderTab?.windowId,
      index: senderTab ? senderTab.index + 1 : undefined,
    });
    tabId = tab.id;
  }

  let result;
  try {
    await waitTabComplete(tabId, 30000);
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [{ unfollow, removeConnection }],
      func: async (opts) => {
        // Les content scripts d'UnLink sont injectés automatiquement sur linkedin.com : on attend qu'ils soient prêts.
        for (let i = 0; i < 50 && !globalThis.UnLink?.profile; i++) await new Promise((r) => setTimeout(r, 200));
        if (!globalThis.UnLink?.profile) return { error: 'script UnLink non chargé sur le profil' };
        return globalThis.UnLink.profile.run(opts);
      },
    });
    result = injection?.result || { error: 'aucun résultat' };
  } catch (e) {
    result = { error: e?.message || String(e) };
  }

  const failed = !!result.error || [result.unfollow, result.removeConnection].some((r) => r?.status === 'failed');
  if (failed && keepTabOnFailure) {
    result.keptTab = true;
  } else {
    if (windowId != null) chrome.windows.remove(windowId).catch(() => {});
    else chrome.tabs.remove(tabId).catch(() => {});
  }
  return result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'UNLINK_PROFILE_JOB') {
    runProfileJob(msg, sender.tab).then(sendResponse, (e) => sendResponse({ error: e?.message || String(e) }));
    return true;
  }
  if (msg?.type === 'UNLINK_OPEN_BULK') {
    openBulkPage().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'UNLINK_BULK_START') {
    startBulk(msg).then(sendResponse, (e) => sendResponse({ error: e?.message || String(e) }));
    return true;
  }
  if (msg?.type === 'UNLINK_BULK_CONTROL') {
    controlBulk(msg.action).then(sendResponse, (e) => sendResponse({ error: e?.message || String(e) }));
    return true;
  }
  if (msg?.type === 'UNLINK_GET_SHORTCUT') {
    shortcutFor('run-cleanup').then((shortcut) => sendResponse({ shortcut }));
    return true;
  }
});

// ---------- page « Nettoyage en masse » ----------

async function openBulkPage() {
  const url = chrome.runtime.getURL('src/bulk/bulk.html');
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

// ---------- nettoyage en masse, en tâche de fond ----------
// L'état complet du lot est dans chrome.storage.local « bulkJob » : la page peut être fermée, et si Chrome endort
// le service worker, l'alarme « bulk-watchdog » le relance là où il en était. Les actions elles-mêmes sont exécutées
// par un onglet LinkedIn (session de l'utilisateur), qui fait toutes les vérifications avant d'agir.

const PACES = {
  safe: { min: 10e3, max: 20e3 },
  normal: { min: 4e3, max: 6e3 },
  fast: { min: 2e3, max: 4e3 },
};
const DAILY_CAP = 50;
const MAX_CONSECUTIVE_FAILURES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
let bulkLoop = null;

const getJob = async () => (await chrome.storage.local.get('bulkJob')).bulkJob || null;
const saveJob = (job) => chrome.storage.local.set({ bulkJob: job });

async function linkedinTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  const tab = tabs.find((t) => t.url.includes('/messaging')) || tabs[0];
  if (tab) return tab.id;
  const created = await chrome.tabs.create({ url: 'https://www.linkedin.com/messaging/', active: false });
  await waitTabComplete(created.id, 30000);
  await sleep(3000); // laisser les scripts de l'extension se charger
  return created.id;
}

async function startBulk({ items, opts, pace }) {
  const current = await getJob();
  if (current && (current.state === 'running' || current.state === 'paused')) throw new Error('un lot est déjà en cours');
  await saveJob({
    state: 'running',
    opts,
    pace: PACES[pace] ? pace : 'normal',
    items: items.map((i) => ({ ...i, state: 'idle', result: null })),
    done: 0,
    failures: 0,
    nextAt: 0,
    startedAt: Date.now(),
  });
  await chrome.alarms.create('bulk-watchdog', { periodInMinutes: 0.5 });
  runBulk();
  return { ok: true };
}

async function controlBulk(action) {
  const job = await getJob();
  if (!job) return { ok: false };
  if (action === 'pause' && job.state === 'running') job.state = 'paused';
  else if (action === 'resume' && job.state === 'paused') job.state = 'running';
  else if (action === 'stop' && (job.state === 'running' || job.state === 'paused')) {
    job.state = 'stopped';
    job.finishedAt = Date.now();
  } else if (action === 'clear' && !['running', 'paused'].includes(job.state)) {
    await chrome.storage.local.remove('bulkJob');
    return { ok: true };
  }
  await saveJob(job);
  if (job.state === 'running') runBulk();
  return { ok: true };
}

function runBulk() {
  if (bulkLoop) return bulkLoop;
  bulkLoop = (async () => {
    // Garde le service worker éveillé pendant les pauses entre deux personnes (un appel d'API toutes les 20 s).
    const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20e3);
    try {
      for (;;) {
        let job = await getJob();
        if (!job || job.state !== 'running') break;
        const item = job.items.find((i) => i.state === 'idle');
        if (!item) {
          job.state = 'done';
          job.finishedAt = Date.now();
          await saveJob(job);
          break;
        }
        if (Date.now() < (job.nextAt || 0)) {
          await sleep(Math.min(1000, job.nextAt - Date.now()));
          continue;
        }
        const daily = (await chrome.storage.local.get('bulkDaily')).bulkDaily;
        if (daily?.day === today() && daily.n >= DAILY_CAP) {
          job.state = 'paused';
          job.notice = `Maximum du jour atteint (${DAILY_CAP}) : reprends demain.`;
          await saveJob(job);
          break;
        }

        item.state = 'running';
        await saveJob(job);
        await setProgressBadge(job);
        let res;
        try {
          const tabId = await linkedinTab();
          res = await chrome.tabs.sendMessage(tabId, {
            type: 'UNLINK_BULK_ITEM',
            threadId: item.threadId,
            profileId: item.profileId,
            removeConnection: job.opts.remove,
            deleteConversation: job.opts.del,
          });
          if (!res) res = { error: 'pas de réponse de l’onglet LinkedIn' };
        } catch (e) {
          res = { error: /receiving end|context invalidated/i.test(e?.message) ? 'onglet LinkedIn indisponible (recharge-le)' : e?.message || String(e) };
        }

        job = (await getJob()) || job; // l'utilisateur a pu mettre en pause / arrêter entre-temps
        const it = job.items.find((i) => i.threadId === item.threadId);
        it.state = res.error ? 'error' : 'done';
        it.result = res;
        job.done = job.items.filter((i) => i.state === 'done' || i.state === 'error').length;
        const failed = res.error || res.remove?.status === 'failed' || res.conv?.status === 'failed';
        const acted = res.remove?.status === 'done' || res.conv?.status === 'done';
        if (acted) {
          const d = (await chrome.storage.local.get('bulkDaily')).bulkDaily;
          const n = d?.day === today() ? d.n : 0;
          await chrome.storage.local.set({ bulkDaily: { day: today(), n: n + 1 } });
        }
        job.failures = failed ? (job.failures || 0) + 1 : 0;
        if (job.failures >= MAX_CONSECUTIVE_FAILURES && job.state === 'running') {
          job.state = 'paused';
          job.failures = 0;
          job.notice = `${MAX_CONSECUTIVE_FAILURES} échecs d’affilée : pause par sécurité (LinkedIn limite peut-être les actions).`;
        }
        const p = PACES[job.pace] || PACES.normal;
        job.nextAt = Date.now() + p.min + Math.random() * (p.max - p.min);
        await saveJob(job);
        await setProgressBadge(job);
      }
    } finally {
      clearInterval(keepAlive);
      bulkLoop = null;
      const job = await getJob();
      if (!job || !['running', 'paused'].includes(job.state)) {
        await chrome.alarms.clear('bulk-watchdog');
        updateBadge().catch(() => {});
      }
    }
  })();
  return bulkLoop;
}

async function setProgressBadge(job) {
  const total = job.items.length;
  await chrome.action.setBadgeText({ text: `${job.done}/${total}` });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'bulk-watchdog') return;
  const job = await getJob();
  if (job?.state === 'running') runBulk();
  else if (!job || !['running', 'paused'].includes(job.state)) chrome.alarms.clear('bulk-watchdog');
});

// ---------- badge : nombre de relances ----------

async function updateBadge() {
  const job = await getJob();
  if (job && ['running', 'paused'].includes(job.state)) return setProgressBadge(job); // progression du lot en cours
  const [settings, local] = await Promise.all([UL.settings.get(), chrome.storage.local.get(['threads', 'meId', 'excluded'])]);
  const excluded = new Set(Object.keys(local.excluded || {}));
  const n = settings.highlight.enabled ? UL.stats.flaggedList(local.threads, local.meId, settings.highlight, Date.now(), excluded).length : 0;
  await chrome.action.setBadgeBackgroundColor({ color: settings.highlight.color || '#f59e0b' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#1b1204' });
  await chrome.action.setBadgeText({ text: n ? String(n > 99 ? '99+' : n) : '' });
}

// Données en cache (conversations, historiques, identifiants). Les réglages et exclusions ne sont jamais effacés.
// - Développement (extension non empaquetée) : cache vidé à chaque rechargement, pour tester sur des données fraîches.
// - Mise à jour via le Chrome Web Store : cache CONSERVÉ, sauf si CACHE_SCHEMA change (format des données modifié).
const CACHE_KEYS = ['threads', 'meId', 'msgQueryId', 'identityQueryId', 'vanities'];
const CACHE_SCHEMA = 1; // à incrémenter uniquement si une version change le format des données en cache
async function clearCache() {
  await chrome.storage.local.remove(CACHE_KEYS);
}
async function refreshCacheOnInstall(reason) {
  const self = await chrome.management.getSelf().catch(() => null);
  const dev = self?.installType === 'development';
  const { cacheSchema } = await chrome.storage.local.get('cacheSchema');
  if (reason === 'install' || dev || cacheSchema !== CACHE_SCHEMA) await clearCache();
  await chrome.storage.local.set({ cacheSchema: CACHE_SCHEMA });
}

let badgeTimer = null;
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.threads && !changes.settings && !changes.meId && !changes.excluded) return;
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => updateBadge().catch(() => {}), 500);
});
chrome.runtime.onStartup.addListener(async () => {
  const job = await getJob();
  if (job?.state === 'running') runBulk(); // reprise d'un lot interrompu par la fermeture de Chrome
  updateBadge().catch(() => {});
});
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await refreshCacheOnInstall(reason).catch(() => {});
  if (reason === 'install') {
    const { settings } = await chrome.storage.sync.get('settings');
    if (!settings) await chrome.storage.sync.set({ settings: UL.settings.DEFAULTS });
    chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/welcome.html') }); // page d'accueil
  }
  const job = await getJob();
  if (job?.state === 'running') runBulk(); // reprise après mise à jour de l'extension
  updateBadge().catch(() => {});
});
