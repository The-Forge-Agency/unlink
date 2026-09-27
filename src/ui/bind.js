// Liaison des champs [data-key="chemin.du.reglage"] avec chrome.storage.sync (enregistrement immédiat).
(() => {
  const UL = globalThis.UnLink;
  const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
  const toPatch = (path, value) => path.split('.').reduceRight((acc, k) => ({ [k]: acc }), value);

  UL.bind = async function bind(root, { onSaved } = {}) {
    let s = await UL.settings.get();
    const inputs = [...root.querySelectorAll('[data-key]')];

    function fill() {
      for (const el of inputs) {
        const v = get(s, el.dataset.key);
        if (el.type === 'checkbox') el.checked = !!v;
        else if (el.type === 'radio') el.checked = el.value === String(v);
        else if (document.activeElement !== el) el.value = v;
      }
      for (const el of root.querySelectorAll('[data-enabled-by]')) {
        const on = el.dataset.enabledBy.split(',').every((k) => !!get(s, k.trim()));
        el.toggleAttribute('data-disabled', !on);
        el.querySelectorAll('input, select').forEach((i) => (i.disabled = !on));
      }
      for (const el of root.querySelectorAll('[data-show]')) {
        const [key, value] = el.dataset.show.split('=');
        el.hidden = String(get(s, key)) !== value;
      }
      root.dispatchEvent(new CustomEvent('unlink:filled', { detail: s }));
    }

    for (const el of inputs) {
      el.addEventListener('change', async () => {
        if (el.type === 'radio' && !el.checked) return;
        let v = el.dataset.type === 'number' ? Number(el.value) : el.value;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'number' || el.type === 'range') {
          v = Number(el.value);
          if (el.min !== '') v = Math.max(Number(el.min), v);
          if (el.max !== '') v = Math.min(Number(el.max), v);
          if (!Number.isFinite(v)) return fill();
        }
        s = await UL.settings.set(toPatch(el.dataset.key, v));
        fill();
        onSaved?.(s);
      });
    }
    UL.settings.onChange((next) => {
      s = next;
      fill();
    });
    fill();
    return () => s;
  };
})();
