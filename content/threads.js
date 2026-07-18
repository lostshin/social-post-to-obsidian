// Threads 平台擷取器：DOM 擷取與按鈕偵測；發佈/草稿流程共用 SP2O.createPublishPipeline
(function () {
  'use strict';

  const LOG = '[Social Post to Obsidian]';

  // 檢查按鈕是否是最終的「發佈」按鈕。
  // Threads 沒有可靠的 data-testid 可用，只能精確比對文字；
  // 呼叫端已限定按鈕必須位於發文 dialog 內，避免誤抓頁面上其他含「Post」字樣的按鈕
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
    // 限定在發文 dialog 內找輸入框；沒有 dialog 就不擷取，避免抓到搜尋框等其他欄位
    const root = document.querySelector('[role="dialog"]');
    if (!root) {
      console.log(LOG, 'Threads: 找不到發文 dialog');
      return null;
    }
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

    console.log(LOG, `Threads: 擷取到 ${texts.length} 則內容`);
    return texts;
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

  const pipeline = SP2O.createPublishPipeline({
    platform: 'threads',
    label: 'Threads',
    parseResponse: SP2O.parseThreadsCreate,
    getTextContent: getTextContent,
    getQuoted: getQuotedPost,
    // 只監聽發文 dialog 內的輸入框，避免搜尋框的文字被存成草稿
    getDraftInputs: () => Array.from(
      document.querySelectorAll('[contenteditable="true"], [role="textbox"], textarea')
    ).filter((input) => input.closest('[role="dialog"]'))
  });

  // 設定事件監聽
  function setupListener() {
    // 使用事件委派，在 capture phase 捕捉點擊
    document.addEventListener('click', (e) => {
      const button = e.target.closest('[role="button"], button[type="submit"]');
      if (!button) return;

      // 發佈按鈕必定位於發文 dialog 內；文字比對只作精確備援
      if (!button.closest('[role="dialog"]')) return;
      if (!isPostButton(button)) return;

      pipeline.capturePost();
    }, true);

    // 鍵盤發文（Cmd/Ctrl+Enter）：舊版只偵測點擊，鍵盤發文會漏存
    document.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return;
      if (!e.target.closest('[role="dialog"]')) return;

      console.log(LOG, 'Threads: 偵測到鍵盤發文 (Cmd/Ctrl+Enter)');
      pipeline.capturePost();
    }, true);

    console.log(LOG, 'Threads: 監聽已啟動');
  }

  pipeline.init(setupListener);
})();
