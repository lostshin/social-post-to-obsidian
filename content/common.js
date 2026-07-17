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
        quoted: quoted
      };
    } catch (e) {
      return null;
    }
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
      const url = (username && post.code)
        ? `https://www.threads.com/@${username}/post/${post.code}`
        : '';

      let text = post.caption?.text || '';
      if (!text) {
        const fragments = post.text_post_app_info?.text_fragments?.fragments;
        if (Array.isArray(fragments)) {
          text = fragments.map(f => f.plaintext || '').join('');
        }
      }

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

      if (!url && !text) return null;
      return { url: url, text: text, replyTo: null, quoted: quoted };
    } catch (e) {
      return null;
    }
  }

  // 深度搜尋回應 JSON 中的貼文物件（有 pk + code + user.username 即視為貼文）
  // 主貼文一定比其內嵌的引用貼文先被走訪到
  function findThreadsPost(node, depth) {
    if (!node || typeof node !== 'object' || depth > 12) return null;
    if (node.pk && typeof node.code === 'string'
      && node.user && typeof node.user.username === 'string') {
      return node;
    }
    for (const key of Object.keys(node)) {
      const found = findThreadsPost(node[key], depth + 1);
      if (found) return found;
    }
    return null;
  }

  return { sendMessage, showToast, onIntercept, parseCreateTweet, parseThreadsCreate };
})();
