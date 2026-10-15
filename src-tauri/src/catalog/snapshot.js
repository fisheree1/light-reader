// Executed only in the isolated source window. No Tauri IPC or local paths are
// exposed to the page. The navigation receiver treats every byte as untrusted.
(() => {
  const requestId = __REQUEST_ID__;
  const snapshotKey = `__lightReaderSnapshot_${requestId}`;
  if (window[snapshotKey]) return;
  window[snapshotKey] = true;
  const emit = async (value) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (bytes.length > 3 * 1024 * 1024) {
      location.href = `https://lightreader.invalid/result?id=${requestId}&error=SOURCE_TOO_LARGE`;
      return;
    }
    let binary = '';
    for (let index = 0; index < bytes.length; index += 8192) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    }
    const data = btoa(binary);
    for (
      let offset = 0, sequence = 0;
      offset < data.length;
      offset += 24000, sequence++
    ) {
      if (window.__lightReaderCancelled?.[requestId]) return;
      location.href = `https://lightreader.invalid/result?id=${requestId}&seq=${sequence}&last=${offset + 24000 >= data.length ? 1 : 0}&data=${encodeURIComponent(data.slice(offset, offset + 24000))}`;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  let attempts = 0;
  const snapshot = () => {
    if (window.__lightReaderCancelled?.[requestId]) return;
    try {
      // The source can finish a blank bootstrap document before its visible
      // document is ready. Never report that as a completed page.
      if (
        document.readyState === 'loading' ||
        !document.body ||
        (!document.title && !document.body.innerText.trim())
      ) {
        if (++attempts < 40) {
          setTimeout(snapshot, 250);
          return;
        }
        throw new Error('EmptyDocument');
      }
      const live = [document.body, ...document.body.querySelectorAll('*')];
      const body = document.body.cloneNode(true);
      const copy = [body, ...body.querySelectorAll('*')];
      // This is page metadata, not executable code. Some source navigation
      // links are bound by listeners and have no href. Preserve the next path
      // before removing scripts, without evaluating their contents.
      const parameters = [...document.querySelectorAll('script:not([src])')]
        .map((node) => node.textContent ?? '')
        .find((value) =>
          /\b(?:var|let|const)\s+ReadParams\s*=\s*\{/.test(value),
        );
      const nextPath = parameters?.match(
        /\burl_next\s*:\s*(['"])(\/novel\/\d{1,10}\/\d{1,10}(?:_\d{1,2})?\.html)\1/,
      )?.[2];
      const next = document.createElement('meta');
      next.name = 'lightreader-next';
      next.content = nextPath ?? '';
      if (live.length > 60000) throw new Error('size');
      live.forEach((node, index) => {
        const clone = copy[index];
        const style = getComputedStyle(node);
        const matrix = /^matrix\(([^)]+)\)$/
          .exec(style.transform)?.[1]
          .split(',')
          .map(Number);
        const collapsed =
          (matrix?.length === 6 &&
            matrix[0] * matrix[3] - matrix[1] * matrix[2] === 0) ||
          /^scale\(0(?:,\s*0)?\)$/.test(style.transform);
        if (
          [
            'SCRIPT',
            'STYLE',
            'IFRAME',
            'NOSCRIPT',
            'INS',
            'SVG',
            'INPUT',
            'BUTTON',
          ].includes(node.tagName) ||
          node.hidden ||
          node.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0' ||
          collapsed ||
          /(?:^|\s)(?:google-auto-placed|adsbygoogle)(?:\s|$)/.test(
            node.className,
          )
        ) {
          clone.remove();
          return;
        }
        for (const attribute of [...clone.attributes]) {
          if (attribute.name.startsWith('on') || attribute.name === 'style')
            clone.removeAttribute(attribute.name);
        }
      });
      const title = document.createElement('title');
      title.textContent = document.title;
      void emit({
        url: location.href,
        html: `<html><head>${title.outerHTML}${next.outerHTML}</head>${body.outerHTML}</html>`,
      });
    } catch (error) {
      // Error kind only; never export page text, session values or stack data.
      const kind = error instanceof Error ? error.name : 'Unknown';
      location.href = `https://lightreader.invalid/result?id=${requestId}&error=SOURCE_INVALID&kind=${encodeURIComponent(kind)}`;
    }
  };
  setTimeout(snapshot, 700);
})();
