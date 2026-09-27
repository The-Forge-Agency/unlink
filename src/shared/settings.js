// Réglages UnLink (chrome.storage.sync). Chargé par les content scripts, le service worker, la popup et la page d'options.
(() => {
  const UL = (globalThis.UnLink = globalThis.UnLink || {});
  if (UL.settings) return;

  const DEFAULTS = {
    // Actions sur le profil
    unfollow: false, // retirer la relation suffit dans la plupart des cas
    removeConnection: true,
    // 'api' = requêtes directes à LinkedIn d'abord (rapide), clics dans les menus en secours ; 'ui' = menus uniquement
    method: 'api',
    // Action sur la conversation, exécutée à la fin : 'delete' | 'archive' | 'none'
    conversationAction: 'delete',
    conversationEvenIfProfileFails: false,
    // Délai d'annulation avant exécution (0 = immédiat)
    countdownSeconds: 2,
    // 'background' = onglet en arrière-plan, 'popup' = petite fenêtre non focalisée
    profileTabMode: 'background',
    keepTabOnFailure: true,
    showThreadButton: true,
    // Nettoyage en masse : nombre de personnes traitées par lancement (au-delà, risque de restriction par LinkedIn)
    bulkPerRun: 7,
    showListButtons: true,
    highlight: {
      enabled: true,
      byCount: true,
      minMessages: 3,
      byDelay: true,
      delayValue: 7,
      delayUnit: 'days', // 'hours' | 'days'
      delayMinMessages: 2,
      combine: 'any', // 'any' = une des règles suffit, 'all' = toutes les règles actives
      color: '#f59e0b',
    },
  };

  function merge(base, patch) {
    const out = { ...base };
    for (const [k, v] of Object.entries(patch || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
        out[k] = merge(base[k], v);
      } else if (v !== undefined) {
        out[k] = v;
      }
    }
    return out;
  }

  // Extension rechargée pendant qu'un onglet était ouvert : ce script n'a plus accès à chrome.*.
  const orphaned = () => !globalThis.chrome?.runtime?.id;

  UL.settings = {
    DEFAULTS,
    merge,
    orphaned,
    async get() {
      if (orphaned()) return merge(DEFAULTS, {});
      try {
        const { settings } = await chrome.storage.sync.get('settings');
        return merge(DEFAULTS, settings);
      } catch (e) {
        if (orphaned()) return merge(DEFAULTS, {});
        throw e;
      }
    },
    async set(patch) {
      const next = merge(await this.get(), patch);
      await chrome.storage.sync.set({ settings: next });
      return next;
    },
    async reset() {
      await chrome.storage.sync.set({ settings: DEFAULTS });
      return DEFAULTS;
    },
    onChange(cb) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.settings) cb(merge(DEFAULTS, changes.settings.newValue));
      });
    },
  };
})();
