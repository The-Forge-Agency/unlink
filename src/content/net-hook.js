// Monde MAIN : observe (sans les modifier) les réponses de l'API messagerie que LinkedIn charge lui-même,
// et les transmet au content script via window.postMessage. Ce fichier n'émet aucune requête.
(() => {
  if (window.__unlinkHooked) return;
  window.__unlinkHooked = true;

  const WATCH = /voyagerMessaging|messengerConversations|messengerMessages|\/messaging\/|voyagerIdentityDashProfiles/i;
  const SKIP = /\/realtime\//i;
  const buffer = [];
  let ready = false;

  function emit(url, text) {
    if (!text || text.length > 5e6) return;
    const payload = { source: 'unlink-net', url: String(url), text };
    if (ready) window.postMessage(payload, location.origin);
    else if (buffer.push(payload) > 50) buffer.shift();
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'unlink-ready') return;
    ready = true;
    while (buffer.length) window.postMessage(buffer.shift(), location.origin);
  });

  const watched = (url) => !!url && WATCH.test(url) && !SKIP.test(url);

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input?.url || String(input);
      if (watched(url)) {
        // LinkedIn sert la messagerie en « application/graphql » : on ne filtre pas sur le type, le parseur ignore le non-JSON.
        p.then((res) => {
          if (res.ok && res.status !== 204) res.clone().text().then((t) => emit(url, t), () => {});
        }, () => {});
      }
    } catch {
      /* ne jamais casser la page */
    }
    return p;
  };

  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSend = XHR.send;
  XHR.open = function (method, url) {
    this.__unlinkUrl = url;
    return origOpen.apply(this, arguments);
  };
  XHR.send = function () {
    const url = this.__unlinkUrl;
    if (watched(String(url))) {
      this.addEventListener('load', () => {
        try {
          if (this.status < 200 || this.status >= 300) return;
          if (this.responseType === '' || this.responseType === 'text') emit(url, this.responseText);
          else if (this.responseType === 'json') emit(url, JSON.stringify(this.response));
        } catch {
          /* ignore */
        }
      });
    }
    return origSend.apply(this, arguments);
  };
})();
