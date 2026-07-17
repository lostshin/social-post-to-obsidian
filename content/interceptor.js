// MAIN world 攔截器：掛勾頁面的 fetch / XHR，攔截「發文」API 的回應，
// 轉發給 content script（ISOLATED world）。存檔因此能拿到平台官方回傳的
// 貼文 ID / URL / 內容，不需再從 DOM 猜測。
(function () {
  'use strict';

  // 判斷是否為發文請求：回傳平台代號或 null
  function matchCreateRequest(url, friendlyName) {
    if (/\/graphql\/[^/?]+\/Create(Note)?Tweet/i.test(url)) return 'x';
    if (url.includes('/graphql') && /create.*post|post.*create/i.test(friendlyName || '')) {
      return 'threads';
    }
    return null;
  }

  function headerValue(headers, name) {
    try {
      if (!headers) return '';
      if (typeof headers.get === 'function') return headers.get(name) || '';
      if (Array.isArray(headers)) {
        const hit = headers.find(h => String(h[0]).toLowerCase() === name);
        return hit ? hit[1] : '';
      }
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === name) return headers[key];
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  // Threads 的 friendly name 也會放在表單 body 的 fb_api_req_friendly_name
  function friendlyFromBody(body) {
    try {
      if (typeof body === 'string' && body.includes('fb_api_req_friendly_name=')) {
        return decodeURIComponent(body.split('fb_api_req_friendly_name=')[1].split('&')[0]);
      }
      if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
        return body.get('fb_api_req_friendly_name') || '';
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  function forward(platform, requestUrl, responseText) {
    try {
      window.postMessage({
        source: 'sp2o-interceptor',
        platform: platform,
        requestUrl: requestUrl,
        responseText: responseText
      }, window.location.origin);
    } catch (e) { /* ignore */ }
  }

  // --- fetch hook ---
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    let url = '';
    let method = 'GET';
    let friendly = '';
    try {
      url = typeof input === 'string' ? input : (input && input.url) || '';
      method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      friendly = headerValue((init && init.headers) || (input && input.headers), 'x-fb-friendly-name')
        || friendlyFromBody(init && init.body);
    } catch (e) { /* ignore */ }

    const promise = origFetch.apply(this, arguments);

    if (method === 'POST') {
      const platform = matchCreateRequest(url, friendly);
      if (platform) {
        promise.then((response) => {
          response.clone().text()
            .then((text) => forward(platform, url, text))
            .catch(() => {});
        }).catch(() => {});
      }
    }
    return promise;
  };

  // --- XHR hook（Meta 網站部分請求走 XHR）---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._sp2o = { method: String(method || '').toUpperCase(), url: String(url || ''), friendly: '' };
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._sp2o && String(name).toLowerCase() === 'x-fb-friendly-name') {
      this._sp2o.friendly = value;
    }
    return origSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const info = this._sp2o;
    if (info && info.method === 'POST') {
      const friendly = info.friendly || friendlyFromBody(body);
      const platform = matchCreateRequest(info.url, friendly);
      if (platform) {
        this.addEventListener('load', () => {
          try {
            // responseType 非 text 時讀取 responseText 會丟例外
            if (typeof this.responseText === 'string' && this.responseText) {
              forward(platform, info.url, this.responseText);
            }
          } catch (e) { /* ignore */ }
        });
      }
    }
    return origSend.apply(this, arguments);
  };
})();
