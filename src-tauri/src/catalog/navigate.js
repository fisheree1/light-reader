(() => {
  const target = new URL(__TARGET_URL__);
  const requestId = __REQUEST_ID__;
  const key = `__lightReaderNavigation_${requestId}_${target.pathname}`;
  if (window[key]) return;
  window[key] = true;
  let attempts = 0;
  const retry = () => {
    if (++attempts < 40) setTimeout(navigate, 250);
    else
      location.href = `https://lightreader.invalid/result?id=${requestId}&error=SOURCE_INVALID`;
  };
  const navigate = () => {
    if (window.__lightReaderCancelled?.[requestId]) return;
    if (
      document.readyState === 'loading' ||
      !document.body ||
      !document.title
    ) {
      retry();
      return;
    }
    const links = [...document.querySelectorAll('a[href]')];
    const find = (path) =>
      links.find((link) => {
        try {
          const url = new URL(link.getAttribute('href'), location.href);
          return url.hostname === location.hostname && url.pathname === path;
        } catch {
          return false;
        }
      });
    let link = find(target.pathname);
    // A result list links to details; enter its catalogue through that page.
    const catalogue = /^\/novel\/(\d+)\/catalog$/.exec(target.pathname);
    if (!link && catalogue) link = find(`/novel/${catalogue[1]}.html`);
    if (link) {
      link.click();
      return;
    }
    // A blank bootstrap document must not replace normal home-page entry.
    if (target.pathname === '/search.html') {
      retry();
      return;
    }
    const parameters = [...document.querySelectorAll('script:not([src])')]
      .map((node) => node.textContent ?? '')
      .find((value) => /\b(?:var|let|const)\s+ReadParams\s*=\s*\{/.test(value));
    const nextPath = parameters?.match(
      /\burl_next\s*:\s*(['"])(\/novel\/\d{1,10}\/\d{1,10}(?:_\d{1,2})?\.html)\1/,
    )?.[2];
    if (nextPath === target.pathname) {
      const next = document.querySelector(
        '#footlink .nextlink, .footlink .nextlink',
      );
      if (next) {
        next.click();
        return;
      }
    }
    location.assign(target.href);
  };
  setTimeout(navigate, 700);
})();
