// Threads 平台擷取器
(function () {
  'use strict';

  const PLATFORM = 'threads';
  const LOG = '[Social Post to Obsidian]';
  const DEBOUNCE_DELAY = 1500;   // 草稿 debounce（毫秒）
  const API_WAIT_TIMEOUT = 8000; // 等待發文 API 回應的時限（毫秒）
  const THREAD_WINDOW = 15000;   // 串文後續 API 回應的忽略時窗（毫秒）

  // Debounce timer
  let debounceTimer = null;

  // Threads 的 DOM 結構較不穩定，準備多個備選選擇器
  const SELECTORS = {
    postButton: [
      // Threads 發文按鈕通常是 "Post" 或 "發佈" 文字的按鈕
      '[role="button"][tabindex="0"]',
      'div[role="button"]',
      'button[type="submit"]'
    ]
  };

  // 檢查按鈕是否是最終的「發佈」按鈕
  function isPostButton(element) {
    if (!element) return false;

    // 取得按鈕的直接文字（去除空白）
    const text = element.textContent?.trim().toLowerCase() || '';
    const ariaLabel = element.getAttribute('aria-label')?.trim().toLowerCase() || '';

    // 只匹配精確的「發佈」或「Post」按鈕
    // 避免匹配「新增到串文」、「回覆選項」等其他按鈕
    const exactPostKeywords = ['post', '發佈', '發布'];

    const isExactMatch = exactPostKeywords.some(keyword =>
      text === keyword || ariaLabel === keyword
    );

    if (isExactMatch) {
      console.log(LOG, 'Threads: 偵測到發佈按鈕', text);
    }

    return isExactMatch;
  }

  // 取得輸入框的文字內容（支援串文多則）
  function getTextContent() {
    // 限定在發文 dialog 內找輸入框，避免抓到搜尋框等其他欄位
    const root = document.querySelector('[role="dialog"]') || document;
    const inputs = root.querySelectorAll('[contenteditable="true"], [role="textbox"], textarea');

    if (!inputs || inputs.length === 0) {
      console.log(LOG, 'Threads: 找不到輸入框');
      return null;
    }

    const texts = [];

    inputs.forEach((input) => {
      let text = '';
      if (input.innerText) {
        text = input.innerText.trim();
      } else if (input.textContent) {
        text = input.textContent.trim();
      } else if (input.value) {
        text = input.value.trim();
      }

      // 只加入有內容的
      if (text && text !== '' && text !== '\n') {
        texts.push(text);
      }
    });

    if (texts.length === 0) {
      console.log(LOG, 'Threads: 所有輸入框都是空的');
      return null;
    }

    // 多則串文用分隔線連接
    const result = texts.length > 1
      ? texts.join('\n\n---\n\n')  // 多則用分隔線
      : texts[0];                   // 單則直接用

    console.log(LOG, `Threads: 擷取到 ${texts.length} 則內容`);
    return result;
  }

  // 擷取引用貼文資訊（DOM 備援；正式資料以攔截到的發文 API 回應為準）
  function getQuotedPost() {
    const composer = document.querySelector('[role="dialog"]');
    if (!composer) return null;

    // Threads 引用貼文容器有 data-pressable-container="true" 屬性
    const quoteContainer = composer.querySelector('[data-pressable-container="true"]');
    if (!quoteContainer) return null;

    // 擷取原作者（從 href="/@username" 連結）
    const authorLink = quoteContainer.querySelector('a[href^="/@"]');
    const authorHandle = authorLink?.getAttribute('href')?.replace('/@', '');

    // 擷取作者顯示名稱
    const authorNameEl = quoteContainer.querySelector('a[href^="/@"] span span');
    const authorName = authorNameEl?.textContent?.trim();

    // 擷取貼文連結
    const postLink = quoteContainer.querySelector('a[href*="/post/"]');
    const url = postLink ? `https://www.threads.com${postLink.getAttribute('href')}` : '';

    // 擷取貼文內容（在 x1gslohp class 的 div 裡）
    const contentContainer = quoteContainer.querySelector('.x1gslohp');
    let content = '';
    if (contentContainer) {
      // 取得所有 span[dir="auto"] 的文字
      const textSpans = contentContainer.querySelectorAll('span[dir="auto"] > span');
      const texts = [];
      textSpans.forEach(span => {
        const text = span.textContent?.trim();
        if (text) texts.push(text);
      });
      content = texts.join('\n');
    }

    if (!content && !authorHandle) return null;

    console.log(LOG, 'Threads: 偵測到引用貼文 (DOM)', authorHandle);

    return {
      author: authorHandle || 'unknown',
      authorName: authorName || authorHandle || 'unknown',
      content: content || '',
      url: url || ''
    };
  }

  // ===== 發佈流程：點擊時擷取內容 → 等發文 API 回應補上正確資料 → 送 background =====

  // 待送出的貼文
  let pendingPost = null;
  let pendingTimer = null;
  let lastFlushAt = 0;

  // 發送貼文內容到 background（發佈時）
  function sendPost(content) {
    if (!content || content.trim() === '') {
      console.log(LOG, 'Threads: 貼文內容為空，跳過');
      return;
    }

    // 清除待執行的草稿 debounce
    clearTimeout(debounceTimer);

    pendingPost = {
      content: content.trim(),
      quoted: getQuotedPost(),
      timestamp: new Date().toISOString()
    };

    // 備援：時限內沒攔截到發文 API 回應，就用 DOM 資料直接送出
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      console.log(LOG, 'Threads: 未攔截到 API 回應，使用備援資料送出');
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

    pendingPost = null;
    clearTimeout(pendingTimer);

    if (!data.content) return;
    lastFlushAt = Date.now();

    SP2O.sendMessage({ type: 'PUBLISH_DRAFT', data: data });
    console.log(LOG, 'Threads: 已發送貼文內容', data.url);
  }

  // 攔截發文 API 回應：發佈成功當下即取得正確 URL 與引用資訊
  SP2O.onIntercept(PLATFORM, (msg) => {
    const api = SP2O.parseThreadsCreate(msg.responseText);
    if (!api) return;

    // 串文會連續回傳多則，只用第一則建檔
    if (!pendingPost && Date.now() - lastFlushAt < THREAD_WINDOW) {
      console.log(LOG, 'Threads: 忽略串文後續回應', api.url);
      return;
    }

    console.log(LOG, 'Threads: 攔截到發文 API 回應', api.url);
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

    console.log(LOG, 'Threads: 已發送草稿');
  }

  // 設定草稿自動存檔監聽
  function setupDraftListener() {
    // 記錄已附加監聽器的輸入框
    const attachedInputs = new WeakSet();

    // 使用 MutationObserver 監聽 DOM 變化（輸入框是動態產生的）
    const observer = new MutationObserver(() => {
      const inputs = document.querySelectorAll('[contenteditable="true"], [role="textbox"], textarea');

      inputs.forEach(input => {
        // 只監聽發文 dialog 內的輸入框，避免搜尋框的文字被存成草稿
        if (!input.closest('[role="dialog"]')) return;

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

          console.log(LOG, 'Threads: 已附加草稿監聽到輸入框');
        }
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.log(LOG, 'Threads: 草稿監聽已啟動');
  }

  // 設定事件監聽
  function setupListener() {
    // 使用事件委派，在 capture phase 捕捉點擊
    document.addEventListener('click', (e) => {
      const target = e.target;

      // 檢查是否點擊了可能是發文按鈕的元素
      const buttonSelectors = SELECTORS.postButton.join(', ');
      const button = target.closest(buttonSelectors);

      if (!button) return;

      // 進一步確認是發文按鈕
      if (!isPostButton(button)) {
        return;
      }

      // 擷取並發送內容
      const content = getTextContent();
      if (content) {
        sendPost(content);
      }
    }, true);

    // 鍵盤發文（Cmd/Ctrl+Enter）：舊版只偵測點擊，鍵盤發文會漏存
    document.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return;
      if (!e.target.closest('[role="dialog"]')) return;

      console.log(LOG, 'Threads: 偵測到鍵盤發文 (Cmd/Ctrl+Enter)');
      const content = getTextContent();
      if (content) {
        sendPost(content);
      }
    }, true);

    console.log(LOG, 'Threads: 監聽已啟動');
  }

  // 初始化
  function init() {
    console.log(LOG, 'Threads: 初始化中...', window.location.href);

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
