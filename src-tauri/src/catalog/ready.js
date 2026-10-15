(() => {
  if (window.top !== window) return;
  // Source book links often use _blank. Keep same-origin links in this
  // isolated window; the native layer continues to deny actual popups.
  document.addEventListener(
    'click',
    (event) => {
      const link = event.target?.closest?.('a[href]');
      if (!link || link.target !== '_blank') return;
      try {
        const target = new URL(link.href, location.href);
        if (
          target.protocol === 'https:' &&
          target.origin === new URL(location.href).origin
        )
          link.target = '_self';
      } catch {
        // Invalid and external links remain subject to native navigation rules.
      }
    },
    true,
  );
  const ready = () => {
    location.href = `https://lightreader.invalid/ready?url=${encodeURIComponent(location.href)}`;
  };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
