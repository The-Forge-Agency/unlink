// Automatisation de la page profil, exécutée dans l'onglet ouvert par le service worker :
// « Ne plus suivre » puis « Retirer la relation » via le menu « Plus » de l'en-tête, chaque action étant vérifiée.
(() => {
  const UL = (globalThis.UnLink = globalThis.UnLink || {});
  if (UL.profile) return;
  const { dom, L } = UL;

  // Les boutons de l'en-tête du profil sont en haut de page : on ignore ceux des sections plus bas.
  const TOP_LIMIT = 1400;
  const inTopArea = (el) => el.getBoundingClientRect().top + scrollY < TOP_LIMIT;
  const scope = () => document.querySelector('main') || document.body;

  const done = (note = '') => ({ status: 'done', note });
  const skipped = (note) => ({ status: 'skipped', note });
  const failed = (note) => ({ status: 'failed', note });

  function findMoreButton() {
    return dom.findAll(scope(), L.moreActions, { selector: 'button, [role="button"]' }).find(inTopArea) || null;
  }

  // Bouton « Suivi » affiché directement dans l'en-tête (profils de créateurs)
  function findFollowingButton() {
    return (
      dom
        .findAll(scope(), L.followingText, { by: 'text', selector: 'button' })
        .concat(dom.findAll(scope(), L.unfollow, { by: 'label', selector: 'button' }))
        .find((b) => inTopArea(b) && b !== findMoreButton()) || null
    );
  }

  // Entrée de menu « Suivi, cliquez pour ne plus suivre … » (libellé porté par un enfant) ou « Ne plus suivre »
  function findUnfollowItem(menus) {
    return dom.findAll(menus, L.unfollow)[0] || dom.findAll(menus, L.followingText, { by: 'text' })[0] || null;
  }

  async function openMenu() {
    const btn = await dom.waitFor(findMoreButton, { timeout: 6000 });
    if (!btn) return false;
    // Ne pas recliquer si le menu est déjà ouvert : ça le refermerait.
    if (btn.getAttribute('aria-expanded') !== 'true' || !dom.openMenus().length) dom.click(btn);
    return !!(await dom.waitFor(() => dom.openMenus().length > 0, { timeout: 3000 }));
  }

  async function closeMenu() {
    if (!dom.openMenus().length) return;
    const btn = findMoreButton();
    if (btn?.getAttribute('aria-expanded') === 'true') dom.click(btn);
    else dom.pressEscape();
    if (!(await dom.waitFor(() => !dom.openMenus().length, { timeout: 1500 }))) dom.pressEscape();
    await dom.sleep(200);
  }

  // Ouvre le menu, cherche une entrée, referme. Renvoie null si le menu ne s'ouvre pas.
  async function peekMenu(find) {
    if (!(await openMenu())) return null;
    const item = await dom.waitFor(() => find(dom.openMenus()), { timeout: 1200 });
    const result = { item: !!item };
    await closeMenu();
    return result;
  }

  // Revérifie plusieurs fois : LinkedIn met parfois à jour l'interface avec un léger délai.
  async function verify(isStillThere) {
    for (let i = 0; i < 3; i++) {
      await dom.sleep(600 + i * 600);
      const still = await isStillThere();
      if (still === false) return true;
    }
    return false;
  }

  async function clickAndConfirm(el, expect) {
    const before = new Set(dom.visibleDialogs());
    dom.click(el);
    await dom.confirmIfAsked({ ignore: before, timeout: 3000, expect });
    await dom.sleep(400);
    await closeMenu();
  }

  async function doUnfollow() {
    let target = findFollowingButton();
    if (!target) {
      if (!(await openMenu())) return failed('menu « Plus » introuvable');
      target = await dom.waitFor(() => findUnfollowItem(dom.openMenus()), { timeout: 1200 });
      if (!target) {
        const canFollow = dom.findAll(dom.openMenus(), L.follow, { by: 'text' }).length > 0;
        await closeMenu();
        return skipped(canFollow ? 'déjà non suivi' : 'option de suivi absente');
      }
    }
    await clickAndConfirm(target, L.unfollow);
    const ok = await verify(async () => {
      if (findFollowingButton()) return true;
      const r = await peekMenu(findUnfollowItem);
      return r ? r.item : null;
    });
    return ok ? done() : failed('toujours suivi après le clic');
  }

  async function doRemoveConnection() {
    if (!(await openMenu())) return failed('menu « Plus » introuvable');
    const item = await dom.waitFor(() => dom.findAll(dom.openMenus(), L.removeConnection)[0], { timeout: 1200 });
    if (!item) {
      await closeMenu();
      return skipped('pas en relation');
    }
    await clickAndConfirm(item, L.removeDialog);
    const ok = await verify(async () => {
      const r = await peekMenu((menus) => dom.findAll(menus, L.removeConnection)[0]);
      return r ? r.item : null;
    });
    return ok ? done() : failed('relation toujours présente après le clic');
  }

  async function safe(fn) {
    try {
      return await fn();
    } catch (e) {
      return failed(e?.message || String(e));
    }
  }

  async function run({ unfollow, removeConnection }) {
    const ready = await dom.waitFor(findMoreButton, { timeout: 15000 });
    if (!ready) {
      if (/authwall|login|checkpoint|uas\//.test(location.href)) return { error: 'Session LinkedIn non connectée' };
      return { error: `Profil non chargé (bouton « Plus » introuvable sur ${location.pathname})` };
    }
    await dom.sleep(300);
    const out = {};
    if (unfollow) out.unfollow = await safe(doUnfollow);
    if (removeConnection) out.removeConnection = await safe(doRemoveConnection);
    return out;
  }

  UL.profile = { run, _debug: { findMoreButton, findFollowingButton, findUnfollowItem, openMenu, closeMenu } };
})();
