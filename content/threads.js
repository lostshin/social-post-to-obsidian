// Threads 平台擷取器
(function () {
  'use strict';

  const PLATFORM = 'threads';
  const DEBOUNCE_DELAY = 3000; // 3 秒

  // Debounce timer
  let debounceTimer = null;

  // Threads 的 DOM 結構較不穩定，準備多個備選選擇器
  const SELECTORS = {
    postButton: [
      // Threads 發文按鈕通常是 "Post" 或 "發佈" 文字的按鈕
      '[role="button"][tabindex="0"]',
      'div[role="button"]',
      'button[type="submit"]'
    ],
    textInput: [
      '[contenteditable="true"]',
      '[role="textbox"]',
      'textarea'
    ],
    // 發文對話框/表單的容器
    composer: [
      '[role="dialog"]',
      'form',
      '[data-pressable-container="true"]'
    ]
  };

  // 嘗試用多個選擇器找到元素
  function findElement(selectors, context = document) {
    for (const selector of selectors) {
      const el = context.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

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
      console.log('[Social Post to Obsidian] Threads: 偵測到發佈按鈕', text);
    }

    return isExactMatch;
  }

  // 取得輸入框的文字內容（支援串文多則）
  function getTextContent() {
    // 找所有輸入框（串文會有多個）
    const inputs = document.querySelectorAll('[contenteditable="true"], [role="textbox"], textarea');

    if (!inputs || inputs.length === 0) {
      console.log('[Social Post to Obsidian] Threads: 找不到輸入框');
      return null;
    }

    const texts = [];

    inputs.forEach((input, index) => {
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
      console.log('[Social Post to Obsidian] Threads: 所有輸入框都是空的');
      return null;
    }

    // 多則串文用分隔線連接
    const result = texts.length > 1
      ? texts.join('\n\n---\n\n')  // 多則用分隔線
      : texts[0];                   // 單則直接用

    console.log(`[Social Post to Obsidian] Threads: 擷取到 ${texts.length} 則內容`);
    return result;
  }

  // 擷取引用貼文資訊
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

    console.log('[Social Post to Obsidian] Threads: 偵測到引用貼文', authorHandle);

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

    console.log('[Social Post to Obsidian] Threads: 已發送草稿');
  }

  // 發送貼文內容到 background（發佈時）
  function sendPost(content) {
    if (!content || content.trim() === '') {
      console.log('[Social Post to Obsidian] Threads: 貼文內容為空，跳過');
      return;
    }

    // 清除待執行的 debounce
    clearTimeout(debounceTimer);

    const postData = {
      content: content.trim(),
      platform: PLATFORM,
      url: '', // 先留空，等發佈成功後再填入
      timestamp: new Date().toISOString()
    };

    // 檢查是否有引用貼文
    const quoted = getQuotedPost();
    if (quoted) {
      postData.quoted = quoted;
    }

    // 等待 dialog 關閉後再取得新貼文連結
    waitForPostUrl(postData);
  }

  // 等待發佈成功後取得新貼文連結
  function waitForPostUrl(postData) {
    const dialog = document.querySelector('[role="dialog"]');

    if (!dialog) {
      // 沒有 dialog，直接發送
      sendToBackground(postData);
      return;
    }

    console.log('[Social Post to Obsidian] Threads: 等待發佈完成...');

    // 監聽 dialog 關閉
    const observer = new MutationObserver((mutations, obs) => {
      const dialogStillExists = document.querySelector('[role="dialog"]');

      if (!dialogStillExists) {
        obs.disconnect();
        console.log('[Social Post to Obsidian] Threads: 發佈完成，尋找新貼文連結...');

        // 多次嘗試尋找新貼文連結（每秒一次，最多 5 次）
        let attempts = 0;
        const maxAttempts = 5;

        const tryFindUrl = () => {
          attempts++;
          console.log(`[Social Post to Obsidian] Threads: 嘗試第 ${attempts} 次...`);

          const newPostUrl = findNewPostUrl();
          if (newPostUrl) {
            postData.url = newPostUrl;
            sendToBackground(postData);
          } else if (attempts < maxAttempts) {
            setTimeout(tryFindUrl, 1000);
          } else {
            console.log('[Social Post to Obsidian] Threads: 找不到新貼文連結，使用個人頁面連結');
            postData.url = `https://www.threads.com/@${getMyUsername() || 'unknown'}`;
            sendToBackground(postData);
          }
        };

        // 先等 2 秒讓 feed 更新
        setTimeout(tryFindUrl, 2000);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // 設定超時，避免無限等待
    setTimeout(() => {
      observer.disconnect();
      if (!postData.url) {
        console.log('[Social Post to Obsidian] Threads: 超時，使用預設連結');
        postData.url = window.location.href;
        sendToBackground(postData);
      }
    }, 10000);
  }

  // 取得目前登入用戶的 username
  function getMyUsername() {
    // 方法 1：從導航列的「個人檔案」連結找
    // 導航列的連結通常有 aria-label 包含「個人檔案」或「Profile」
    const profileLinks = document.querySelectorAll('a[href^="/@"]');

    for (const link of profileLinks) {
      const ariaLabel = link.getAttribute('aria-label')?.toLowerCase() || '';
      const href = link.getAttribute('href');

      // 找「個人檔案」或「Profile」連結
      if ((ariaLabel.includes('個人檔案') || ariaLabel.includes('profile')) && href) {
        const username = href.replace('/@', '').split('/')[0];
        if (username) {
          console.log('[Social Post to Obsidian] Threads: 從導航列找到 username', username);
          return username;
        }
      }
    }

    // 方法 2：從左側導航列找（通常是第 5 個連結是個人檔案）
    const navLinks = document.querySelectorAll('nav a[href^="/@"]');
    for (const link of navLinks) {
      const href = link.getAttribute('href');
      if (href && !href.includes('/post/')) {
        const username = href.replace('/@', '').split('/')[0];
        if (username) {
          console.log('[Social Post to Obsidian] Threads: 從 nav 找到 username', username);
          return username;
        }
      }
    }

    // 方法 3：從頁面底部或其他地方找
    const allProfileLinks = document.querySelectorAll('a[href^="/@"]:not([href*="/post/"])');
    const usernameCounts = {};

    for (const link of allProfileLinks) {
      const href = link.getAttribute('href');
      const username = href?.replace('/@', '').split('/')[0];
      if (username) {
        usernameCounts[username] = (usernameCounts[username] || 0) + 1;
      }
    }

    // 找出現最多次的 username（排除當前頁面的作者）
    const currentPageAuthor = window.location.pathname.match(/@([^\/]+)/)?.[1];
    let mostFrequent = null;
    let maxCount = 0;

    for (const [username, count] of Object.entries(usernameCounts)) {
      if (username !== currentPageAuthor && count > maxCount) {
        maxCount = count;
        mostFrequent = username;
      }
    }

    if (mostFrequent) {
      console.log('[Social Post to Obsidian] Threads: 從頻率推測 username', mostFrequent);
      return mostFrequent;
    }

    console.log('[Social Post to Obsidian] Threads: 找不到用戶名稱');
    return null;
  }

  // 從 feed 找到新貼文連結
  function findNewPostUrl() {
    const username = getMyUsername();

    if (!username) {
      return null;
    }

    // 找 feed 中最新的自己的貼文
    const postLinks = document.querySelectorAll(`a[href*="/@${username}/post/"]`);

    for (const link of postLinks) {
      const href = link.getAttribute('href');
      if (href && href.includes('/post/')) {
        const fullUrl = `https://www.threads.com${href}`;
        console.log('[Social Post to Obsidian] Threads: 找到新貼文連結', fullUrl);
        return fullUrl;
      }
    }

    console.log('[Social Post to Obsidian] Threads: 找不到新貼文連結');
    return null;
  }

  // 發送到 background
  function sendToBackground(postData) {
    try {
      chrome.runtime.sendMessage({
        type: 'PUBLISH_DRAFT',
        data: postData
      });
      console.log('[Social Post to Obsidian] Threads: 已發送貼文內容', postData.url);
    } catch (error) {
      console.error('[Social Post to Obsidian] Threads: 發送失敗，請刷新頁面', error);
      alert('Social Post to Obsidian: 請刷新頁面後再試一次（擴充功能已更新）');
    }
  }

  // 設定草稿自動存檔監聽
  function setupDraftListener() {
    // 記錄已附加監聽器的輸入框
    const attachedInputs = new WeakSet();

    // 使用 MutationObserver 監聽 DOM 變化（輸入框是動態產生的）
    const observer = new MutationObserver(() => {
      const inputs = document.querySelectorAll('[contenteditable="true"], [role="textbox"], textarea');

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

          console.log('[Social Post to Obsidian] Threads: 已附加草稿監聽到輸入框');
        }
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.log('[Social Post to Obsidian] Threads: 草稿監聽已啟動');
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

    console.log('[Social Post to Obsidian] Threads: 監聽已啟動');
  }

  // 初始化
  function init() {
    console.log('[Social Post to Obsidian] Threads: 初始化中...', window.location.href);

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
