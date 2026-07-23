// 共用工具（ISOLATED world）：訊息傳送、攔截事件接收、發文 API 回應解析
// 由 manifest 在各平台 content script 之前載入
var SP2O = (function () {
  'use strict';

  const LOG = '[Social Post to Obsidian]';

  // 啟動時印出版本，方便確認此分頁載入的是哪一版（重載擴充功能後需重新整理分頁）
  try {
    console.log(LOG, 'content script v' + chrome.runtime.getManifest().version + ' 已載入');
  } catch (e) { /* 測試環境或 context 失效時略過 */ }

  // 發送訊息到 background（帶重試機制，處理 service worker 尚未喚醒的情況）
  function sendMessage(message, maxRetries = 3) {
    let retries = 0;

    function trySend() {
      // 整段包 try/catch：context 失效時，連讀取 chrome.runtime.id
      // 都可能同步丟出 "Extension context invalidated"
      try {
        // 擴充功能重載後，舊分頁裡的 content script 會失效，重試無用
        if (!chrome.runtime?.id) {
          handleInvalidated();
          return;
        }

        chrome.runtime.sendMessage(message, () => {
          try {
            const err = chrome.runtime.lastError;
            if (!err) return;

            if (/context invalidated/i.test(err.message || '')) {
              handleInvalidated();
              return;
            }

            retries++;
            if (retries < maxRetries) {
              setTimeout(trySend, 500);
            } else {
              console.error(LOG, '發送失敗，已達最大重試次數:', err.message);
            }
          } catch (e) {
            handleInvalidated();
          }
        });
      } catch (e) {
        handleInvalidated();
      }
    }

    trySend();
  }

  // context 失效只提醒一次：toast 是純 DOM，失效後仍可顯示
  let invalidatedNotified = false;
  function handleInvalidated() {
    if (invalidatedNotified) return;
    invalidatedNotified = true;
    // 用 log 而非 warn：warn 會被收進擴充功能錯誤頁，這是預期情況不該佔版面
    console.log(LOG, '擴充功能已重新載入，此分頁的舊指令碼已失效，請重新整理頁面');
    showToast('擴充功能已更新，請重新整理此頁面以繼續存檔', false);
  }

  // ===== 頁面內 toast（存檔結果即時回饋）=====
  let toastTimer = null;

  function showToast(text, ok) {
    let el = document.getElementById('sp2o-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sp2o-toast';
      el.style.cssText = [
        // 比草稿狀態列高一階，兩者可同時顯示不重疊
        'position:fixed', 'bottom:64px', 'right:24px', 'z-index:2147483647',
        'padding:10px 16px', 'border-radius:8px', 'font-size:14px', 'color:#fff',
        'font-family:system-ui,-apple-system,sans-serif', 'max-width:320px',
        'box-shadow:0 4px 12px rgba(0,0,0,.35)', 'opacity:0',
        'transition:opacity .25s ease', 'pointer-events:none'
      ].join(';');
      document.documentElement.appendChild(el);
    }
    el.style.background = ok ? '#1e7e34' : '#b02a37';
    el.textContent = (ok ? '✓ ' : '✕ ') + text;
    // 強制 reflow 讓 transition 生效；不用 rAF（背景分頁會延後執行，
    // 導致淡出比淡入先跑、toast 卡住不消失）
    void el.offsetWidth;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 3500);
  }

  // ===== 草稿暫存狀態列（低調常駐小膠囊，每次暫存更新時間）=====
  let draftStatusTimer = null;

  function showDraftStatus(text, ok) {
    let el = document.getElementById('sp2o-draft-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sp2o-draft-status';
      el.style.cssText = [
        'position:fixed', 'bottom:24px', 'right:24px', 'z-index:2147483646',
        'padding:5px 12px', 'border-radius:999px', 'font-size:12px', 'color:#fff',
        'font-family:system-ui,-apple-system,sans-serif', 'max-width:280px',
        'box-shadow:0 2px 8px rgba(0,0,0,.3)', 'opacity:0',
        'transition:opacity .25s ease', 'pointer-events:none'
      ].join(';');
      document.documentElement.appendChild(el);
    }
    el.style.background = ok ? 'rgba(45,55,72,.88)' : 'rgba(146,64,14,.92)';
    el.textContent = (ok ? '✓ ' : '⚠ ') + text;
    void el.offsetWidth;
    el.style.opacity = '1';
    clearTimeout(draftStatusTimer);
    // 兩秒後淡到半透明常駐（不完全消失，隨時可瞄一眼暫存時間）
    draftStatusTimer = setTimeout(() => { el.style.opacity = '0.55'; }, 2000);
  }

  function hideDraftStatus() {
    const el = document.getElementById('sp2o-draft-status');
    if (el) el.remove();
  }

  // 接收 background 的存檔結果，在頁面內顯示
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'SAVE_RESULT') {
      // 發佈後草稿已刪除，狀態列一併收掉
      hideDraftStatus();
      showToast(message.text, message.ok);
    }
    if (message && message.type === 'DRAFT_RESULT') {
      showDraftStatus(message.text, message.ok);
    }
    // 同步回應，避免 background 誤判送達失敗而重複跳系統通知
    sendResponse({ ok: true });
  });

  // 訂閱 MAIN world interceptor 轉發的發文 API 回應
  function onIntercept(platform, callback) {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || d.source !== 'sp2o-interceptor' || d.platform !== platform) return;
      callback(d);
    });
  }

  // 解析 X 的 CreateTweet / CreateNoteTweet 回應
  function parseCreateTweet(responseText) {
    try {
      const json = JSON.parse(responseText);
      const data = json && json.data;
      if (!data) return null;

      const result = data.create_tweet?.tweet_results?.result
        || data.notetweet_create?.tweet_results?.result;
      if (!result) return null;

      const tweet = result.tweet || result;
      const legacy = tweet.legacy || {};
      const user = tweet.core?.user_results?.result;
      const screenName = user?.legacy?.screen_name || user?.core?.screen_name || '';
      if (!tweet.rest_id || !screenName) return null;

      // 長推文的完整內容在 note_tweet
      const text = tweet.note_tweet?.note_tweet_results?.result?.text || legacy.full_text || '';
      const media = extractXMedia(tweet);

      let quoted = null;
      const quotedResult = tweet.quoted_status_result?.result;
      if (quotedResult) {
        const qt = quotedResult.tweet || quotedResult;
        const qUser = qt.core?.user_results?.result;
        const qScreen = qUser?.legacy?.screen_name || qUser?.core?.screen_name || 'unknown';
        quoted = {
          author: qScreen,
          authorName: qUser?.legacy?.name || qUser?.core?.name || qScreen,
          content: qt.note_tweet?.note_tweet_results?.result?.text || qt.legacy?.full_text || '',
          url: qt.rest_id ? `https://x.com/${qScreen}/status/${qt.rest_id}` : ''
        };
      }

      return {
        url: `https://x.com/${screenName}/status/${tweet.rest_id}`,
        text: text,
        replyTo: legacy.in_reply_to_status_id_str
          ? `https://x.com/${legacy.in_reply_to_screen_name || 'i'}/status/${legacy.in_reply_to_status_id_str}`
          : null,
        quoted: quoted,
        media: media
      };
    } catch (e) {
      return null;
    }
  }

  // Sync only directly attached photos; videos and animated GIFs are intentionally skipped.
  function extractXMedia(tweet) {
    const legacy = tweet.legacy || {};
    const items = legacy.extended_entities?.media || legacy.entities?.media || [];
    const seen = new Set();

    return items.flatMap((item, index) => {
      const url = item.type === 'photo' && (item.media_url_https || item.media_url);
      if (!url || seen.has(url)) return [];
      seen.add(url);
      return [{
        url: url.replace(/^http:/, 'https:'),
        alt: item.ext_alt_text || `圖片 ${index + 1}`
      }];
    });
  }

  // 解析 Threads 發文 mutation 回應
  function parseThreadsCreate(responseText) {
    try {
      // Meta 的部分回應會加上 for(;;); 前綴
      const clean = responseText.replace(/^for\s*\(;;\);/, '');
      const json = JSON.parse(clean);
      const post = findThreadsPost(json, 0);
      if (!post) return null;

      const username = post.user?.username || '';
      const url = typeof post.permalink === 'string' && post.permalink
        ? post.permalink
        : (username && post.code)
          ? `https://www.threads.com/@${username}/post/${post.code}`
          : '';

      let text = post.caption?.text || '';
      if (!text) {
        const fragments = post.text_post_app_info?.text_fragments?.fragments;
        if (Array.isArray(fragments)) {
          text = fragments.map(f => f.plaintext || '').join('');
        }
      }

      const media = extractThreadsMedia(post);

      let quoted = null;
      const q = post.text_post_app_info?.share_info?.quoted_post;
      if (q) {
        const qUser = q.user?.username || 'unknown';
        quoted = {
          author: qUser,
          authorName: qUser,
          content: q.caption?.text || '',
          url: q.code ? `https://www.threads.com/@${qUser}/post/${q.code}` : ''
        };
      }

      if (!url && !text && media.length === 0) return null;
      return { url: url, text: text, replyTo: null, quoted: quoted, media: media };
    } catch (e) {
      return null;
    }
  }

  // Use image_versions2 for single images, carousels, and inline media;
  // do not treat video covers as photos.
  function extractThreadsMedia(post) {
    const linkedInlineMedia = post.text_post_app_info?.linked_inline_media;
    const items = [post, linkedInlineMedia].flatMap((container) => {
      if (!container) return [];
      if (Array.isArray(container.carousel_media) && container.carousel_media.length > 0) {
        return container.carousel_media;
      }

      const hasImage = Array.isArray(container.image_versions2?.candidates)
        && container.image_versions2.candidates.length > 0;
      const hasVideo = Array.isArray(container.video_versions)
        && container.video_versions.length > 0;
      return hasImage || hasVideo ? [container] : [];
    });
    const seen = new Set();

    return items.flatMap((item, index) => {
      if (Array.isArray(item.video_versions) && item.video_versions.length > 0) return [];

      const candidates = item.image_versions2?.candidates || [];
      const best = candidates
        .filter(candidate => candidate.url)
        .sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)))[0];
      if (!best?.url || seen.has(best.url)) return [];
      seen.add(best.url);
      return [{
        url: best.url,
        alt: item.accessibility_caption || `圖片 ${index + 1}`
      }];
    });
  }

  // 深度搜尋回應 JSON 中的貼文物件。舊 GraphQL response 有 user.username；
  // 現行 media configure response 可能只保證 pk + code/permalink 與媒體欄位。
  // 主貼文一定比其內嵌的引用貼文先被走訪到
  function findThreadsPost(node, depth) {
    if (!node || typeof node !== 'object' || depth > 12) return null;
    const hasIdentity = node.pk
      && (typeof node.code === 'string' || typeof node.permalink === 'string');
    const hasPostData = (node.user && typeof node.user.username === 'string')
      || node.caption
      || node.image_versions2
      || node.carousel_media
      || node.media_type;
    if (hasIdentity && hasPostData) {
      return node;
    }
    for (const key of Object.keys(node)) {
      const found = findThreadsPost(node[key], depth + 1);
      if (found) return found;
    }
    return null;
  }

  // ===== 發佈與草稿共用流程 =====
  // twitter.js 與 threads.js 共用同一套狀態機；平台檔只提供 DOM 擷取與按鈕偵測
  const DEBOUNCE_DELAY = 500;      // 草稿 debounce（毫秒）
  const API_WAIT_TIMEOUT = 8000;   // 等待發文 API 回應的時限（毫秒）
  const THREAD_WINDOW = 15000;     // 串文後續 API 回應的忽略時窗（毫秒）
  const OBSERVER_SCAN_DELAY = 150; // 合併同批 DOM mutation 再掃描輸入框（毫秒）

  // config：platform、label、parseResponse(text)、getTextContent()（回傳單則字串或串文陣列）、
  //         getQuoted()（可省略）、getDraftInputs()（回傳已過濾至 composer 的輸入框）
  function createPublishPipeline(config) {
    const { platform, label, parseResponse, getTextContent, getQuoted, getDraftInputs } = config;

    let debounceTimer = null;
    let pendingPost = null;
    let pendingTimer = null;
    let lastFlushAt = 0;
    // 8 秒備援先送出後保留原始資料；遲到的 API 回應用它重送同一筆以修正 url/media
    let fallbackBase = null;

    function readComposerContent() {
      const captured = getTextContent();
      if (Array.isArray(captured)) {
        const items = captured
          .map(item => String(item || '').trim())
          .filter(Boolean);
        return {
          content: items.join('\n\n---\n\n'),
          thread: items.length > 1 ? items : null
        };
      }
      return { content: String(captured || '').trim(), thread: null };
    }

    // 發佈觸發（點擊/鍵盤）：擷取內容後等發文 API 回應補上正確資料
    function capturePost() {
      const captured = readComposerContent();
      if (!captured.content) {
        console.log(LOG, label + ': 貼文內容為空，跳過');
        return;
      }

      clearTimeout(debounceTimer);
      pendingPost = {
        content: captured.content,
        thread: captured.thread,
        quoted: getQuoted ? getQuoted() : null,
        timestamp: new Date().toISOString()
      };
      fallbackBase = null;
      console.log(LOG, label + ': 已擷取貼文內容，等待發文 API 回應...');

      // 備援：時限內沒攔截到發文 API 回應，就用 DOM 資料直接送出
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        console.log(LOG, label + ': 未攔截到 API 回應，使用備援資料送出');
        flushPending(null);
      }, API_WAIT_TIMEOUT);
    }

    // 組合 DOM 擷取內容與 API 回應，送出到 background
    function flushPending(api) {
      if (!pendingPost && !api) return;

      const base = pendingPost || { content: '', quoted: null, timestamp: new Date().toISOString() };
      const data = {
        // DOM 擷取的內容保留使用者輸入原文；沒有時用 API 回傳的正式文字
        content: base.content || (api ? api.text : ''),
        platform: platform,
        url: api ? api.url : window.location.href,
        timestamp: base.timestamp
      };

      const quoted = (api && api.quoted) || base.quoted;
      if (quoted) data.quoted = quoted;
      if (api && api.replyTo) data.replyTo = api.replyTo;
      if (api && api.media?.length) data.media = api.media;
      if (base.thread?.length > 1) data.thread = base.thread;

      pendingPost = null;
      clearTimeout(pendingTimer);

      if (!data.content && !data.media?.length) return;
      lastFlushAt = Date.now();
      fallbackBase = api ? null : base;

      sendMessage({ type: 'PUBLISH_DRAFT', data: data });
      console.log(LOG, label + ': 已發送貼文內容', data.url);
    }

    // 攔截發文 API 回應：發佈成功當下即取得正確 URL、引用與圖片資訊
    onIntercept(platform, (msg) => {
      const api = parseResponse(msg.responseText);
      if (!api) return;

      if (!pendingPost && Date.now() - lastFlushAt < THREAD_WINDOW) {
        if (fallbackBase) {
          // 備援已先送出（例如網路慢、API 回應晚於 8 秒時限）：
          // 沿用原 timestamp 重送，background 會產生同一檔名覆寫，修正備援存檔的 url/media
          console.log(LOG, label + ': 收到遲到的 API 回應，修正備援存檔', api.url);
          pendingPost = fallbackBase;
          fallbackBase = null;
          flushPending(api);
          return;
        }
        // 串文會連續回傳多則（第 2 則起是接續回覆），只用第一則建檔
        console.log(LOG, label + ': 忽略串文後續回應', api.url);
        return;
      }

      console.log(LOG, label + ': 攔截到發文 API 回應', api.url);
      flushPending(api);
    });

    // 草稿觸發（debounce 到期或 blur）：擷取內容送 background 暫存
    function captureDraft() {
      const captured = readComposerContent();
      if (!captured.content) return;

      sendMessage({
        type: 'SAVE_DRAFT',
        data: {
          content: captured.content,
          thread: captured.thread,
          platform: platform,
          timestamp: new Date().toISOString()
        }
      });
      console.log(LOG, label + ': 已發送草稿');
    }

    // 草稿自動存檔監聽：輸入框是動態產生的，用 MutationObserver 掛監聽
    function setupDraftListener() {
      const attachedInputs = new WeakSet();
      let scanTimer = null;

      function attachAll() {
        (getDraftInputs() || []).forEach((input) => {
          if (attachedInputs.has(input)) return;
          attachedInputs.add(input);

          input.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(captureDraft, DEBOUNCE_DELAY);
          });
          // 離開輸入框時立即存一次草稿
          input.addEventListener('blur', () => {
            clearTimeout(debounceTimer);
            captureDraft();
          });

          console.log(LOG, label + ': 已附加草稿監聽到輸入框');
        });
      }

      // SPA 高頻更新下合併同批 mutation 再掃描，避免每次 mutation 都做全頁查詢
      const observer = new MutationObserver(() => {
        if (scanTimer) return;
        scanTimer = setTimeout(() => {
          scanTimer = null;
          attachAll();
        }, OBSERVER_SCAN_DELAY);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      attachAll();
      console.log(LOG, label + ': 草稿監聽已啟動');
    }

    // 初始化：DOM 就緒後啟動平台事件監聽與草稿監聽
    function init(setupListener) {
      console.log(LOG, label + ': 初始化中...', window.location.href);
      const start = () => {
        setupListener();
        setupDraftListener();
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
      } else {
        start();
      }
    }

    return { capturePost, captureDraft, init };
  }

  return { sendMessage, showToast, onIntercept, parseCreateTweet, parseThreadsCreate, createPublishPipeline };
})();
