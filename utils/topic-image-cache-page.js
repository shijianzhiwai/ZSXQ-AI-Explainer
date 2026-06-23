(function installZsxqPageHooks() {
  if (window.__zsxqExplainerPageHooks) return;
  window.__zsxqExplainerPageHooks = true;

  function shouldCaptureUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (/\/share_url/i.test(url)) return false;
    return /groups\/\d+\/topics|\/topics\/\d+|search\/groups\/\d+\/topics|users\/self\/topics|topics\/sticky/.test(url);
  }

  function postIngest(payload) {
    window.postMessage({
      source: 'zsxq-ai-explainer',
      type: 'TOPIC_CACHE_INGEST',
      payload
    }, window.location.origin);
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function patchedFetch(...args) {
    const response = await originalFetch(...args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input?.url;
      if (shouldCaptureUrl(url)) {
        response.clone().json().then(postIngest).catch(() => {});
      }
    } catch {
      // ignore
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    this.__zsxqUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function patchedSend(...args) {
    this.addEventListener('load', function onLoad() {
      try {
        if (shouldCaptureUrl(this.__zsxqUrl) && this.responseText) {
          postIngest(JSON.parse(this.responseText));
        }
      } catch {
        // ignore
      }
    });
    return originalSend.apply(this, args);
  };

  console.log('[ZSXQ Explainer] page hooks installed');
})();
