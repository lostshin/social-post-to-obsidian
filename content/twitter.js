// Twitter/X 平台擷取器
(function () {
  'use strict';

  const PLATFORM = 'x';
  const DEBOUNCE_DELAY = 3000; // 3 秒

  // Debounce timer
  let debounceTimer = null;

  // 多個備選選擇器，增加容錯
  const SELECTORS = {
    postButton: [
      '[data-testid="tweetButton"]',           // 主頁發文按鈕
      '[data-testid="tweetButtonInline"]',     // 回覆時的發文按鈕
      '[role="button"][tabindex="0"]'          // 通用按鈕
    ],
    textInput: [
      '[data-testid="tweetTextarea_0"]',
      '[data-testid="tweetTextarea_1"]',
      '[data-testid="tweetTextarea_2"]',
      '[data-testid="tweetTextarea_3"]',
      '[role="textbox"][data-testid*="tweetTextarea"]',
      '.public-DraftEditor-content',
      '[contenteditable="true"][role="textbox"]'
    ]
  };

  // 檢查是否是最終的發文按鈕
  function isPostButton(element) {
    if (!element) return false;

    const text = element.textContent?.trim().toLowerCase() || '';
    const ariaLabel = element.getAttribute('aria-label')?.trim().toLowerCase() || '';

    // 精確匹配發文按鈕文字
    const exactKeywords = [
      'post', 'post all', '發佈', '全部發佈', '發布', '全部發布'
    ];

    const isMatch = exactKeywords.some(keyword =>
      text === keyword || ariaLabel === keyword
    );

    if (isMatch) {
      console.log('[Social Post to Obsidian] Twitter: 偵測到發佈按鈕', text);
    }

    return isMatch;
  }

  // 取得輸入框的文字內容（支援串文多則）
  function getTextContent() {
    // 選擇所有推文編輯器（串文會有多個：_0, _1, _2...）
    const inputs = document.querySelectorAll('[data-testid^="tweetTextarea_"]');

    if (!inputs || inputs.length === 0) {
      console.log('[Social Post to Obsidian] Twitter: 找不到輸入框');
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

      // 過濾：有內容、不是 placeholder、不重複
      const isPlaceholder = text === '有什麼新鮮事？' || text === "What's happening?" || text === '';

      if (text && !isPlaceholder && text !== '\n' && !seen.has(text)) {
        seen.add(text);
        texts.push(text);
      }
    });

    if (texts.length === 0) {
      console.log('[Social Post to Obsidian] Twitter: 所有輸入框都是空的');
      return null;
    }

    // 多則串文用分隔線連接
    const result = texts.length > 1
      ? texts.join('\n\n---\n\n')
      : texts[0];

    console.log(`[Social Post to Obsidian] Twitter: 擷取到 ${texts.length} 則內容`);
    return result;
  }

  // 擷取引用推文資訊
  function getQuotedTweet() {
    // 找發文對話框中的引用推文區塊
    const composer = document.querySelector('[data-testid="toolBar"]')?.closest('[role="dialog"]')
      || document.querySelector('[data-testid="primaryColumn"]');

    if (!composer) return null;

    // 尋找引用推文容器
    const quoteContainer = composer.querySelector('[data-testid="quoteTweet"]')
      || composer.querySelector('article[tabindex="0"]');

    if (!quoteContainer) return null;

    // 擷取原作者
    const authorLink = quoteContainer.querySelector('a[href*="/status/"]');
    const authorHandle = authorLink?.href?.match(/(?:twitter|x)\.com\/([^\/]+)/)?.[1];

    const authorNameEl = quoteContainer.querySelector('[data-testid="User-Name"]');
    const authorName = authorNameEl?.textContent?.split('@')[0]?.trim();

    // 擷取原文內容
    const contentEl = quoteContainer.querySelector('[data-testid="tweetText"]');
    const content = contentEl?.innerText?.trim();

    // 擷取原文連結
    const statusLink = quoteContainer.querySelector('a[href*="/status/"]');
    const url = statusLink?.href;

    if (!content && !authorHandle) return null;

    console.log('[Social Post to Obsidian] Twitter: 偵測到引用推文', authorHandle);

    return {
      author: authorHandle || 'unknown',
      authorName: authorName || authorHandle || 'unknown',
      content: content || '',
      url: url || ''
    };
  }

  // 發送草稿到 background
  function sendDraft(content) {
    if (!content || content.trim() === '') return;

    chrome.runtime.sendMessage({
      type: 'SAVE_DRAFT',
      data: {
        content: content.trim(),
        platform: PLATFORM,
        timestamp: new Date().toISOString()
      }
    });

    console.log('[Social Post to Obsidian] Twitter: 已發送草稿');
  }

  // 發送貼文內容到 background（發佈時）
  function sendPost(content) {
    if (!content || content.trim() === '') {
      console.log('[Social Post to Obsidian] Twitter: 貼文內容為空，跳過');
      return;
    }

    // 清除待執行的 debounce
    clearTimeout(debounceTimer);

    const postData = {
      content: content.trim(),
      platform: PLATFORM,
      url: window.location.href,
      timestamp: new Date().toISOString()
    };

    // 檢查是否有引用推文
    const quoted = getQuotedTweet();
    if (quoted) {
      postData.quoted = quoted;
    }

    try {
      chrome.runtime.sendMessage({
        type: 'PUBLISH_DRAFT',
        data: postData
      });
      console.log('[Social Post to Obsidian] Twitter: 已發送貼文內容');
    } catch (error) {
      console.error('[Social Post to Obsidian] Twitter: 發送失敗，請刷新頁面', error);
      alert('Social Post to Obsidian: 請刷新頁面後再試一次（擴充功能已更新）');
    }
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

          console.log('[Social Post to Obsidian] Twitter: 已附加草稿監聽到輸入框');
        }
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.log('[Social Post to Obsidian] Twitter: 草稿監聽已啟動');
  }

  // 設定事件監聯
  function setupListener() {
    document.addEventListener('click', (e) => {
      const buttonSelectors = SELECTORS.postButton.join(', ');
      const button = e.target.closest(buttonSelectors);

      if (!button) return;

      // 確認按鈕沒有被禁用
      if (button.getAttribute('aria-disabled') === 'true') {
        console.log('[Social Post to Obsidian] Twitter: 按鈕已禁用，跳過');
        return;
      }

      // 確認是發文按鈕
      if (!isPostButton(button)) {
        return;
      }

      // 擷取並發送內容
      const content = getTextContent();
      if (content) {
        sendPost(content);
      }
    }, true);

    console.log('[Social Post to Obsidian] Twitter: 監聽已啟動');
  }

  // 初始化
  function init() {
    console.log('[Social Post to Obsidian] Twitter: 初始化中...', window.location.href);

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
