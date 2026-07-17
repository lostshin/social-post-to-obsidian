// Twitter/X 平台擷取器
(function () {
  'use strict';

  const PLATFORM = 'x';
  const LOG = '[Social Post to Obsidian]';
  const DEBOUNCE_DELAY = 1500;   // 草稿 debounce（毫秒）
  const API_WAIT_TIMEOUT = 8000; // 等待發文 API 回應的時限（毫秒）
  const THREAD_WINDOW = 15000;   // 串文後續 API 回應的忽略時窗（毫秒）

  // Debounce timer
  let debounceTimer = null;

  // 檢查是否是最終的發文按鈕
  function isPostButton(element) {
    if (!element) return false;

    // 優先檢查 data-testid（最可靠）
    const testId = element.getAttribute('data-testid') || '';
    if (testId === 'tweetButton' || testId === 'tweetButtonInline') {
      console.log(LOG, 'Twitter: 偵測到發佈按鈕 (via testid)', testId);
      return true;
    }

    const text = element.textContent?.trim().toLowerCase() || '';
    const ariaLabel = element.getAttribute('aria-label')?.trim().toLowerCase() || '';

    // 精確匹配發文按鈕文字（data-testid 才是主要偵測，這裡只是備援）
    // 不放 'reply'、'貼文' 等泛用詞，避免點別處按鈕時誤存
    const exactKeywords = [
      'post', 'post all',
      '發佈', '全部發佈', '發布', '全部發布'
    ];

    const isMatch = exactKeywords.some(keyword =>
      text === keyword || ariaLabel === keyword
    );

    if (isMatch) {
      console.log(LOG, 'Twitter: 偵測到發佈按鈕', text);
    }

    return isMatch;
  }

  // 取得輸入框的文字內容（支援串文多則）
  function getTextContent() {
    // 選擇所有推文編輯器（串文會有多個：_0, _1, _2...）
    const inputs = document.querySelectorAll('[data-testid^="tweetTextarea_"]');

    if (!inputs || inputs.length === 0) {
      console.log(LOG, 'Twitter: 找不到輸入框');
      return null;
    }

    const texts = [];
    const seen = new Set(); // 用來去重複

    inputs.forEach((input) => {
      let text = '';
      if (input.innerText) {
        text = input.innerText.trim();
      } else if (input.textContent) {
        text = input.textContent.trim();
      }

      // 過濾 placeholder：直接比對編輯器內 placeholder 元素的文字（不分語言）
      const placeholderEl = input.querySelector('.public-DraftEditorPlaceholder-root');
      if (placeholderEl && text === placeholderEl.innerText?.trim()) {
        text = '';
      }
      const isPlaceholder = text === '有什麼新鮮事？' || text === "What's happening?" || text === '';

      if (text && !isPlaceholder && text !== '\n' && !seen.has(text)) {
        seen.add(text);
        texts.push(text);
      }
    });

    if (texts.length === 0) {
      console.log(LOG, 'Twitter: 所有輸入框都是空的');
      return null;
    }

    // 多則串文用分隔線連接
    const result = texts.length > 1
      ? texts.join('\n\n---\n\n')
      : texts[0];

    console.log(LOG, `Twitter: 擷取到 ${texts.length} 則內容`);
    return result;
  }

  // 擷取引用推文資訊（DOM 備援；正式資料以攔截到的發文 API 回應為準）
  function getQuotedTweet() {
    const dialog = document.querySelector('[role="dialog"]');
    const composer = dialog
      || document.querySelector('[data-testid="tweetTextarea_0"]')?.closest('[data-testid="cellInnerDiv"]');
    if (!composer) return null;

    const quoteContainer = composer.querySelector('[data-testid="quoteTweet"]')
      || composer.querySelector('[data-testid="quotedTweet"]')
      || composer.querySelector('[data-testid="card.wrapper"]');
    if (!quoteContainer) return null;

    // 作者
    const nameText = quoteContainer.querySelector('[data-testid="User-Name"]')?.textContent || '';
    const authorHandle = nameText.match(/@([a-zA-Z0-9_]+)/)?.[1] || 'unknown';
    const authorName = nameText.split('@')[0]?.trim() || authorHandle;

    // 內容
    const content = quoteContainer.querySelector('[data-testid="tweetText"]')?.innerText?.trim() || '';

    // 連結
    let url = '';
    const statusLink = quoteContainer.querySelector('a[href*="/status/"]');
    if (statusLink) {
      const href = statusLink.getAttribute('href') || '';
      url = href.startsWith('http') ? href : `https://x.com${href}`;
    }

    if (!content && authorHandle === 'unknown') return null;

    console.log(LOG, 'Twitter: 偵測到引用推文 (DOM)', authorHandle);
    return { author: authorHandle, authorName: authorName, content: content, url: url };
  }

  // ===== 發佈流程：點擊時擷取內容 → 等發文 API 回應補上正確資料 → 送 background =====

  // 待送出的貼文
  let pendingPost = null;
  let pendingTimer = null;
  let lastFlushAt = 0;

  // 發送貼文內容到 background（發佈時）
  function sendPost(content) {
    if (!content || content.trim() === '') {
      console.log(LOG, 'Twitter: 貼文內容為空，跳過');
      return;
    }

    // 清除待執行的草稿 debounce
    clearTimeout(debounceTimer);

    pendingPost = {
      content: content.trim(),
      quoted: getQuotedTweet(),
      timestamp: new Date().toISOString()
    };
    console.log(LOG, 'Twitter: 已擷取貼文內容，等待發文 API 回應...');

    // 備援：時限內沒攔截到發文 API 回應，就用 DOM 資料直接送出
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      console.log(LOG, 'Twitter: 未攔截到 API 回應，使用備援資料送出');
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
      platform: PLATFORM,
      url: api ? api.url : window.location.href,
      timestamp: base.timestamp
    };

    const quoted = (api && api.quoted) || base.quoted;
    if (quoted) data.quoted = quoted;
    if (api && api.replyTo) data.replyTo = api.replyTo;

    pendingPost = null;
    clearTimeout(pendingTimer);

    if (!data.content) return;
    lastFlushAt = Date.now();

    SP2O.sendMessage({ type: 'PUBLISH_DRAFT', data: data });
    console.log(LOG, 'Twitter: 已發送貼文內容', data.url);
  }

  // 攔截發文 API 回應：發佈成功當下即取得正確 URL、引用與回覆資訊
  SP2O.onIntercept(PLATFORM, (msg) => {
    const api = SP2O.parseCreateTweet(msg.responseText);
    if (!api) return;

    // 串文會連續回傳多則（第 2 則起是接續回覆），只用第一則建檔
    if (!pendingPost && Date.now() - lastFlushAt < THREAD_WINDOW) {
      console.log(LOG, 'Twitter: 忽略串文後續回應', api.url);
      return;
    }

    console.log(LOG, 'Twitter: 攔截到發文 API 回應', api.url);
    flushPending(api);
  });

  // ===== 草稿 =====

  // 發送草稿到 background
  function sendDraft(content) {
    if (!content || content.trim() === '') return;

    SP2O.sendMessage({
      type: 'SAVE_DRAFT',
      data: {
        content: content.trim(),
        platform: PLATFORM,
        timestamp: new Date().toISOString()
      }
    });

    console.log(LOG, 'Twitter: 已發送草稿');
  }

  // 設定草稿自動存檔監聽
  function setupDraftListener() {
    // 記錄已附加監聽器的輸入框
    const attachedInputs = new WeakSet();

    // 使用 MutationObserver 監聽 DOM 變化（輸入框是動態產生的）
    const observer = new MutationObserver(() => {
      const inputs = document.querySelectorAll('[data-testid^="tweetTextarea_"]');

      inputs.forEach(input => {
        if (!attachedInputs.has(input)) {
          attachedInputs.add(input);

          input.addEventListener('input', () => {
            // 清除舊的 timer
            clearTimeout(debounceTimer);

            // 設定新的 debounce timer
            debounceTimer = setTimeout(() => {
              const content = getTextContent();
              if (content) {
                sendDraft(content);
              }
            }, DEBOUNCE_DELAY);
          });

          // 離開輸入框時立即存一次草稿
          input.addEventListener('blur', () => {
            clearTimeout(debounceTimer);
            const content = getTextContent();
            if (content) {
              sendDraft(content);
            }
          });

          console.log(LOG, 'Twitter: 已附加草稿監聽到輸入框');
        }
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.log(LOG, 'Twitter: 草稿監聽已啟動');
  }

  // 設定事件監聽
  function setupListener() {
    document.addEventListener('click', (e) => {
      // 方法 1：直接用 data-testid 找發文按鈕（最可靠）
      const tweetButton = e.target.closest('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');

      if (tweetButton) {
        // 確認按鈕沒有被禁用
        if (tweetButton.getAttribute('aria-disabled') === 'true') {
          console.log(LOG, 'Twitter: 按鈕已禁用，跳過');
          return;
        }

        console.log(LOG, 'Twitter: 偵測到發佈按鈕點擊 (via testid)');

        // 擷取並發送內容
        const content = getTextContent();
        if (content) {
          sendPost(content);
        }
        return;
      }

      // 方法 2：用文字內容匹配（備用）
      const genericButton = e.target.closest('[role="button"]');
      if (genericButton && isPostButton(genericButton)) {
        if (genericButton.getAttribute('aria-disabled') === 'true') {
          return;
        }

        const content = getTextContent();
        if (content) {
          sendPost(content);
        }
      }
    }, true);

    // 鍵盤發文（Cmd/Ctrl+Enter）：舊版只偵測點擊，鍵盤發文會漏存
    document.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return;
      if (!e.target.closest('[data-testid^="tweetTextarea_"]')) return;

      console.log(LOG, 'Twitter: 偵測到鍵盤發文 (Cmd/Ctrl+Enter)');
      const content = getTextContent();
      if (content) {
        sendPost(content);
      }
    }, true);

    console.log(LOG, 'Twitter: 監聽已啟動');
  }

  // 初始化
  function init() {
    console.log(LOG, 'Twitter: 初始化中...', window.location.href);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setupListener();
        setupDraftListener();
      });
    } else {
      setupListener();
      setupDraftListener();
    }
  }

  init();
})();
