// Liste d'exclusion : personnes que l'utilisateur ne veut jamais voir proposées (chrome.storage.local « excluded »).
// Clé = identifiant de profil LinkedIn (ACoA…), valeur = { name, at }.
(() => {
  const UL = (globalThis.UnLink = globalThis.UnLink || {});
  if (UL.exclusions) return;

  const alive = () => !!globalThis.chrome?.runtime?.id;
  let cache = {};
  const listeners = new Set();

  const ready = (alive() ? chrome.storage.local.get('excluded') : Promise.resolve({}))
    .then((d) => {
      cache = d.excluded || {};
    })
    .catch(() => {});

  if (alive()) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.excluded) return;
      cache = changes.excluded.newValue || {};
      for (const cb of listeners) cb(cache);
    });
  }

  async function write(next) {
    cache = next;
    if (alive()) await chrome.storage.local.set({ excluded: next });
  }

  UL.exclusions = {
    ready,
    has: (profileId) => !!profileId && !!cache[profileId],
    all: () => cache,
    set: () => new Set(Object.keys(cache)),
    async add(people) {
      const d = alive() ? await chrome.storage.local.get('excluded') : {};
      const next = { ...(d.excluded || {}) };
      for (const p of people) if (p?.id) next[p.id] = { name: p.name || '', at: Date.now() };
      await write(next);
    },
    async remove(profileId) {
      const d = alive() ? await chrome.storage.local.get('excluded') : {};
      const next = { ...(d.excluded || {}) };
      delete next[profileId];
      await write(next);
    },
    onChange: (cb) => listeners.add(cb),
  };
})();
