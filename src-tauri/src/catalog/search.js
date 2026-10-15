(() => {
  const requestId = __REQUEST_ID__;
  const key = `__lightReaderSearch_${requestId}`;
  if (window[key]) return;
  window[key] = true;
  let attempts = 0;
  const submit = () => {
    if (window.__lightReaderCancelled?.[requestId]) return;
    const input = document.querySelector('input[name=searchkey]');
    if (input && input.form && document.readyState !== 'loading') {
      input.value = __QUERY__;
      location.href = `https://lightreader.invalid/submitted?id=${requestId}`;
      setTimeout(() => {
        if (!window.__lightReaderCancelled?.[requestId])
          input.form.requestSubmit();
      }, 100);
    } else if (++attempts < 40) {
      setTimeout(submit, 250);
    } else {
      __SNAPSHOT__;
    }
  };
  submit();
})();
