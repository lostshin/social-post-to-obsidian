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

    // 優先檢查 data-testid（最可靠）
    const testId = element.getAttribute('data-testid') || '';
    if (testId === 'tweetButton' || testId === 'tweetButtonInline') {
      console.log('[Social Post to Obsidian] Twitter: 偵測到發佈按鈕 (via testid)', testId);
      return true;
    }

    const text = element.textContent?.trim().toLowerCase() || '';
    const ariaLabel = element.getAttribute('aria-label')?.trim().toLowerCase() || '';

    // 精確匹配發文按鈕文字（多語言支援）
    const exactKeywords = [
      'post', 'post all',
      '發佈', '全部發佈', '發布', '全部發布',
      '貼文', '發文', 'tweet', 'reply'
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
    // 方法 0：從 URL 參數獲取引用推文 ID（最可靠！）
    const currentUrl = new URL(window.location.href);
    const quoteTweetId = currentUrl.searchParams.get('quote_tweet_id');

    console.log('[Social Post to Obsidian] Twitter: URL =', window.location.href);
    console.log('[Social Post to Obsidian] Twitter: quote_tweet_id =', quoteTweetId);

    // 只在對話框或發文區域內找引用推文
    const dialog = document.querySelector('[role="dialog"]');
    const composer = dialog || document.querySelector('[data-testid="tweetTextarea_0"]')?.closest('[data-testid="cellInnerDiv"]');

    console.log('[Social Post to Obsidian] Twitter: 檢查引用推文... dialog =', !!dialog, 'composer =', !!composer);

    if (!composer) return null;

    // 找引用推文容器（嘗試多種選擇器）
    let quoteContainer = composer.querySelector('[data-testid="quoteTweet"]');

    if (!quoteContainer) {
      quoteContainer = composer.querySelector('[data-testid="card.wrapper"]');
    }

    // 如果還是找不到 quoteTweet，嘗試找 quotedTweet（不同的 data-testid）
    if (!quoteContainer) {
      quoteContainer = composer.querySelector('[data-testid="quotedTweet"]');
      if (quoteContainer) {
        console.log('[Social Post to Obsidian] Twitter: 找到 quotedTweet 容器');
      }
    }

    // 偵錯：列出對話框的 data-testid 元素
    if (!quoteContainer) {
      console.log('[Social Post to Obsidian] Twitter: 對話框內 data-testid 元素:');
      const testIdEls = composer.querySelectorAll('[data-testid]');
      const testIds = new Set();
      testIdEls.forEach(el => testIds.add(el.getAttribute('data-testid')));
      console.log('  ', Array.from(testIds).join(', '));

      // 在對話框內找 tweetText（不在輸入框內的），這可能是引用推文
      const tweetTexts = composer.querySelectorAll('[data-testid="tweetText"]');
      console.log('[Social Post to Obsidian] Twitter: 對話框內找到', tweetTexts.length, '個 tweetText');

      for (const textEl of tweetTexts) {
        // 排除輸入框內的
        if (textEl.closest('[data-testid*="tweetTextarea"]')) continue;

        // 找到引用貼文的文字了！
        const content = textEl.innerText?.trim() || '';
        console.log('[Social Post to Obsidian] Twitter: 找到引用貼文內容:', content.substring(0, 50));

        // 從 tweetText 往上找包含 /status/ 連結的父元素
        let quotedUrl = '';
        let parentBlock = textEl.parentElement;
        for (let i = 0; i < 10 && parentBlock; i++) {
          // 找這個父元素內的所有 /status/ 連結
          const statusLinks = parentBlock.querySelectorAll('a[href*="/status/"]');
          for (const statusLink of statusLinks) {
            const href = statusLink.getAttribute('href');
            if (href && !href.includes('/analytics')) {
              quotedUrl = href.startsWith('http') ? href : `https://x.com${href}`;
              console.log('[Social Post to Obsidian] Twitter: 在第', i, '層找到引用連結', quotedUrl);
              break;
            }
          }
          if (quotedUrl) break;
          parentBlock = parentBlock.parentElement;
        }

        // 如果還是沒找到，嘗試在整個對話框內找（排除輸入框區域）
        if (!quotedUrl) {
          console.log('[Social Post to Obsidian] Twitter: 嘗試在對話框內找引用連結...');
          const allLinks = composer.querySelectorAll('a[href*="/status/"]');
          for (const link of allLinks) {
            // 排除輸入框內的連結
            if (link.closest('[data-testid*="tweetTextarea"]')) continue;
            const href = link.getAttribute('href');
            if (href && !href.includes('/analytics')) {
              quotedUrl = href.startsWith('http') ? href : `https://x.com${href}`;
              console.log('[Social Post to Obsidian] Twitter: 在對話框內找到引用連結', quotedUrl);
              break;
            }
          }
        }

        // 方法 4：從 React fiber 獲取引用 URL
        if (!quotedUrl) {
          let cardContainer = textEl;
          for (let i = 0; i < 10 && cardContainer; i++) {
            const fiberKey = Object.keys(cardContainer).find(key => key.startsWith('__reactFiber$'));
            if (fiberKey) {
              try {
                const fiber = cardContainer[fiberKey];
                let current = fiber;
                for (let j = 0; j < 5 && current; j++) {
                  const pendingProps = current.memoizedProps || current.pendingProps;
                  if (pendingProps) {
                    if (pendingProps.href && pendingProps.href.includes('/status/')) {
                      quotedUrl = pendingProps.href.startsWith('http') ? pendingProps.href : `https://x.com${pendingProps.href}`;
                      break;
                    }
                    if (pendingProps.to && pendingProps.to.includes('/status/')) {
                      quotedUrl = `https://x.com${pendingProps.to}`;
                      break;
                    }
                  }
                  current = current.return;
                }
              } catch (e) {
                // 讀取 fiber 失敗，繼續嘗試下一層
              }
            }
            if (quotedUrl) break;
            cardContainer = cardContainer.parentElement;
          }
        }

        // 找作者資訊
        let authorHandle = 'unknown';
        let authorName = '';

        // 從 tweetText 往上找 User-Name
        parentBlock = textEl.parentElement;
        for (let i = 0; i < 8 && parentBlock; i++) {
          const nameEl = parentBlock.querySelector('[data-testid="User-Name"]');
          if (nameEl) {
            const nameText = nameEl.textContent || '';
            const atMatch = nameText.match(/@([a-zA-Z0-9_]+)/);
            if (atMatch) {
              authorHandle = atMatch[1];
              authorName = nameText.split('@')[0]?.trim() || authorHandle;
              console.log('[Social Post to Obsidian] Twitter: 找到引用作者', authorHandle);
              break;
            }
          }
          parentBlock = parentBlock.parentElement;
        }

        if (content || quotedUrl) {
          return {
            author: authorHandle,
            authorName: authorName,
            content: content,
            url: quotedUrl
          };
        }
      }

      console.log('[Social Post to Obsidian] Twitter: 對話框內沒有找到有效的引用');
      return null;
    }

    console.log('[Social Post to Obsidian] Twitter: quoteContainer =', !!quoteContainer);

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
    let url = '';
    if (statusLink) {
      url = statusLink.href;
      if (url && !url.startsWith('http')) {
        url = `https://x.com${url.startsWith('/') ? '' : '/'}${url}`;
      }
      console.log('[Social Post to Obsidian] Twitter: 引用連結 =', url);
    }

    if (!content && !authorHandle) return null;

    console.log('[Social Post to Obsidian] Twitter: 偵測到引用推文', authorHandle, url);

    return {
      author: authorHandle || 'unknown',
      authorName: authorName || authorHandle || 'unknown',
      content: content || '',
      url: url
    };
  }

  // 發送訊息到 background（帶重試機制）
  function sendMessageWithRetry(message, maxRetries = 3) {
    let retries = 0;

    function trySend() {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[Social Post to Obsidian] Twitter: 發送失敗，嘗試重試...', chrome.runtime.lastError.message);
          retries++;
          if (retries < maxRetries) {
            // 等待一下再重試，讓 service worker 有時間啟動
            setTimeout(trySend, 500);
          } else {
            console.error('[Social Post to Obsidian] Twitter: 發送失敗，已達最大重試次數');
          }
        }
      });
    }

    trySend();
  }

  // 發送草稿到 background
  function sendDraft(content) {
    if (!content || content.trim() === '') return;

    sendMessageWithRetry({
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
      url: '',  // 等發佈完成後填入
      timestamp: new Date().toISOString()
    };

    // 檢查是否有引用推文
    const quoted = getQuotedTweet();
    if (quoted) {
      postData.quoted = quoted;
    }

    // 等待發佈完成後取得新推文連結
    waitForPostUrl(postData);
  }

  // 取得目前登入用戶的 username
  function getMyUsername() {
    // 方法 1：從導航列的帳戶切換按鈕找（找 @ 開頭的文字）
    const accountSwitcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (accountSwitcher) {
      // 找所有 span，尋找以 @ 開頭的文字
      const spans = accountSwitcher.querySelectorAll('span');
      for (const span of spans) {
        const text = span.textContent?.trim();
        if (text && text.startsWith('@')) {
          const username = text.replace('@', '');
          console.log('[Social Post to Obsidian] Twitter: 從導航列找到 username', username);
          return username;
        }
      }
    }

    // 方法 2：從個人檔案連結找
    const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    if (profileLink) {
      const href = profileLink.getAttribute('href');
      if (href) {
        const username = href.replace('/', '');
        console.log('[Social Post to Obsidian] Twitter: 從 Profile Link 找到 username', username);
        return username;
      }
    }

    // 方法 3：從 URL 路徑找（如果在個人頁面）
    const pathMatch = window.location.pathname.match(/^\/([^\/]+)$/);
    if (pathMatch && !['home', 'explore', 'notifications', 'messages', 'search', 'compose', 'i'].includes(pathMatch[1])) {
      console.log('[Social Post to Obsidian] Twitter: 從 URL 找到 username', pathMatch[1]);
      return pathMatch[1];
    }

    console.log('[Social Post to Obsidian] Twitter: 找不到用戶名稱');
    return null;
  }

  // 根據引用內容在整個頁面中搜索匹配的推文 URL
  function findQuotedUrlByContent(quotedContent, quotedAuthor) {
    if (!quotedContent || quotedContent.length < 10) return null;

    // 取引用內容的前 30 個字作為搜索關鍵字
    const searchText = quotedContent.substring(0, 30);
    console.log('[Social Post to Obsidian] Twitter: 用內容匹配找引用 URL，關鍵字:', searchText);

    // 在所有 article 中搜索
    const articles = document.querySelectorAll('article');

    for (const article of articles) {
      const tweetTexts = article.querySelectorAll('[data-testid="tweetText"]');

      // 只有 1 個 tweetText 的 article 才是原始推文（不是引用推文的容器）
      if (tweetTexts.length !== 1) continue;

      const text = tweetTexts[0].innerText || '';

      // 檢查內容是否匹配
      if (text.includes(searchText)) {
        // 找這個 article 的 status 連結
        const statusLink = article.querySelector('a[href*="/status/"]');
        if (statusLink) {
          const href = statusLink.getAttribute('href');
          if (href && !href.includes('/analytics')) {
            const url = href.startsWith('http') ? href : `https://x.com${href}`;
            console.log('[Social Post to Obsidian] Twitter: 用內容匹配找到引用 URL', url);
            return url;
          }
        }
      }
    }

    console.log('[Social Post to Obsidian] Twitter: 內容匹配未找到引用 URL');
    return null;
  }

  // 從 feed 中的新推文找到引用貼文的 URL
  function findQuotedUrlFromFeed(newPostUrl, quotedContent, quotedAuthor) {
    // 從 URL 提取 status ID
    const statusMatch = newPostUrl.match(/status\/(\d+)/);
    if (!statusMatch) return null;

    const statusId = statusMatch[1];

    // 在 feed 中找到這則新推文
    const newTweetLink = document.querySelector(`a[href*="/status/${statusId}"]`);
    if (!newTweetLink) {
      console.log('[Social Post to Obsidian] Twitter: 在 feed 中找不到新推文');
      return null;
    }

    // 找到新推文的容器（需要包含完整的推文，包括引用區塊）
    let tweetContainer = newTweetLink.closest('article');
    if (!tweetContainer) {
      tweetContainer = newTweetLink.closest('[data-testid="tweet"]');
    }
    if (!tweetContainer) {
      tweetContainer = newTweetLink.closest('[data-testid="cellInnerDiv"]');
    }
    if (!tweetContainer) {
      // 備用：往上找，尋找包含引用區塊或多個 status 連結的容器
      let el = newTweetLink;
      for (let i = 0; i < 10; i++) {
        el = el.parentElement;
        if (!el) break;

        // 方法 1：找有 quotedTweet 的容器（最可靠）
        const hasQuote = el.querySelector('[data-testid="quotedTweet"]');
        if (hasQuote) {
          tweetContainer = el;
          console.log('[Social Post to Obsidian] Twitter: 在第', i, '層找到有 quotedTweet 的容器');
          break;
        }

        // 方法 2：找包含多個不同 status 連結的容器（表示有引用）
        const statusLinks = el.querySelectorAll('a[href*="/status/"]');
        const uniqueStatuses = new Set();
        statusLinks.forEach(link => {
          const match = link.getAttribute('href')?.match(/\/status\/(\d+)/);
          if (match) uniqueStatuses.add(match[1]);
        });

        // 如果找到 2 個不同的 status（主推文 + 引用），這可能是好的容器
        if (uniqueStatuses.size === 2) {
          tweetContainer = el;
          console.log('[Social Post to Obsidian] Twitter: 在第', i, '層找到包含 2 個 status 的容器');
          break;
        }

        // 如果找到太多（>4），表示容器太大了，停止搜索
        if (uniqueStatuses.size > 4) {
          console.log('[Social Post to Obsidian] Twitter: 在第', i, '層找到太多 status，停止搜索');
          break;
        }
      }
    }
    // 如果還是沒找到，使用較大範圍（7 層）
    if (!tweetContainer) {
      let el = newTweetLink;
      for (let i = 0; i < 7; i++) {
        el = el?.parentElement;
      }
      tweetContainer = el;
      console.log('[Social Post to Obsidian] Twitter: 使用 7 層父元素作為容器');
    }

    console.log('[Social Post to Obsidian] Twitter: 推文容器 =', tweetContainer?.tagName, tweetContainer?.getAttribute('data-testid'));

    if (!tweetContainer) {
      console.log('[Social Post to Obsidian] Twitter: 找不到推文容器');
      return null;
    }

    // 優先在 quotedTweet 區塊內找引用連結（最精確）
    const quotedBlock = tweetContainer.querySelector('[data-testid="quotedTweet"]');
    if (quotedBlock) {
      const quotedLinks = quotedBlock.querySelectorAll('a[href*="/status/"]');
      for (const link of quotedLinks) {
        const href = link.getAttribute('href');
        if (href && !href.includes('/analytics')) {
          const fullUrl = `https://x.com${href}`;
          console.log('[Social Post to Obsidian] Twitter: 從 quotedTweet 找到引用連結', fullUrl);
          return fullUrl;
        }
      }
    }

    // 備用：在推文容器內找所有 /status/ 連結
    const allStatusLinks = tweetContainer.querySelectorAll('a[href*="/status/"]');
    console.log('[Social Post to Obsidian] Twitter: 推文容器內找到', allStatusLinks.length, '個 /status/ 連結');

    // 列出所有找到的連結（偵錯用）
    allStatusLinks.forEach(link => {
      console.log('  -', link.getAttribute('href'));
    });

    // 如果連結太多（>6），表示容器可能包含多個推文，不可靠
    if (allStatusLinks.length > 6) {
      console.log('[Social Post to Obsidian] Twitter: 連結太多，容器可能包含多個推文，跳過');
      return null;
    }

    for (const link of allStatusLinks) {
      const href = link.getAttribute('href');
      // 排除主推文自己的連結和 analytics 連結
      if (href && !href.includes(statusId) && !href.includes('/analytics')) {
        const fullUrl = `https://x.com${href}`;
        console.log('[Social Post to Obsidian] Twitter: 找到引用連結', fullUrl);
        return fullUrl;
      }
    }

    // 備用 2：找推文容器內的 tweetText，排除主推文的文字
    const tweetTexts = tweetContainer.querySelectorAll('[data-testid="tweetText"]');
    console.log('[Social Post to Obsidian] Twitter: 推文容器內找到', tweetTexts.length, '個 tweetText');

    if (tweetTexts.length > 1) {
      // 有多個 tweetText，第二個可能是引用區塊
      const quotedTextEl = tweetTexts[1];
      // 從引用文字往上找連結
      let el = quotedTextEl;
      for (let i = 0; i < 5 && el; i++) {
        const link = el.querySelector('a[href*="/status/"]');
        if (link) {
          const href = link.getAttribute('href');
          if (href && !href.includes(statusId)) {
            const fullUrl = `https://x.com${href}`;
            console.log('[Social Post to Obsidian] Twitter: 從第二個 tweetText 找到引用連結', fullUrl);
            return fullUrl;
          }
        }
        el = el.parentElement;
      }
    }

    // 備用 3：使用內容匹配在整個頁面搜索
    if (quotedContent) {
      const matchedUrl = findQuotedUrlByContent(quotedContent, quotedAuthor);
      if (matchedUrl) {
        return matchedUrl;
      }
    }

    console.log('[Social Post to Obsidian] Twitter: 新推文中找不到引用連結');
    return null;
  }

  // 從 feed 找到新推文連結
  function findNewPostUrl() {
    const username = getMyUsername();
    if (!username) return null;

    // 找 feed 中最新的自己的推文
    const tweetLinks = document.querySelectorAll(`a[href*="/${username}/status/"]`);

    for (const link of tweetLinks) {
      const href = link.getAttribute('href');
      if (href && href.includes('/status/')) {
        const fullUrl = `https://x.com${href}`;
        console.log('[Social Post to Obsidian] Twitter: 找到新推文連結', fullUrl);
        return fullUrl;
      }
    }

    console.log('[Social Post to Obsidian] Twitter: 找不到新推文連結');
    return null;
  }

  // 等待發佈成功後取得新推文連結
  function waitForPostUrl(postData) {
    // 找發文對話框
    const dialog = document.querySelector('[role="dialog"]');
    const composer = document.querySelector('[data-testid="tweetButtonInline"]')?.closest('[data-testid="primaryColumn"]');

    console.log('[Social Post to Obsidian] Twitter: 等待發佈完成...');

    // 監聽 DOM 變化，等待發文完成
    let attempts = 0;
    const maxAttempts = 10;

    const tryFindUrl = () => {
      attempts++;
      console.log(`[Social Post to Obsidian] Twitter: 嘗試第 ${attempts} 次...`);

      const newPostUrl = findNewPostUrl();
      if (newPostUrl) {
        postData.url = newPostUrl;

        // 嘗試從 feed 找引用（傳入引用內容用於內容匹配）
        const quotedContent = postData.quoted?.content || '';
        const quotedAuthor = postData.quoted?.author || '';
        const quotedUrl = findQuotedUrlFromFeed(newPostUrl, quotedContent, quotedAuthor);
        if (quotedUrl) {
          // 如果已有 quoted 資料，更新 URL；否則建立新的 quoted 物件
          if (postData.quoted) {
            postData.quoted.url = quotedUrl;
          } else {
            postData.quoted = {
              author: 'unknown',
              authorName: '',
              content: '',
              url: quotedUrl
            };
          }
          console.log('[Social Post to Obsidian] Twitter: 從 feed 找到引用 URL', quotedUrl);
        } else if (postData.quoted && (!postData.quoted.url || !postData.quoted.url.includes('/status/'))) {
          // 有引用但還沒找到 URL，等待後重試
          if (attempts < maxAttempts) {
            console.log('[Social Post to Obsidian] Twitter: 引用 URL 未找到，等待後重試...');
            setTimeout(tryFindUrl, 1000);
            return;
          }
        }

        sendToBackground(postData);
      } else if (attempts < maxAttempts) {
        setTimeout(tryFindUrl, 1000);
      } else {
        // 找不到就用個人頁面連結
        const username = getMyUsername();
        postData.url = username ? `https://x.com/${username}` : window.location.href;
        console.log('[Social Post to Obsidian] Twitter: 找不到新推文連結，使用備用連結', postData.url);
        sendToBackground(postData);
      }
    };

    // 先等 2 秒讓發文完成
    setTimeout(tryFindUrl, 2000);
  }

  // 發送到 background
  function sendToBackground(postData) {
    sendMessageWithRetry({
      type: 'PUBLISH_DRAFT',
      data: postData
    });
    console.log('[Social Post to Obsidian] Twitter: 已發送貼文內容', postData.url);
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
      // 方法 1：直接用 data-testid 找發文按鈕（最可靠）
      const tweetButton = e.target.closest('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');

      if (tweetButton) {
        // 確認按鈕沒有被禁用
        if (tweetButton.getAttribute('aria-disabled') === 'true') {
          console.log('[Social Post to Obsidian] Twitter: 按鈕已禁用，跳過');
          return;
        }

        console.log('[Social Post to Obsidian] Twitter: 偵測到發佈按鈕點擊 (via testid)');

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

    console.log('[Social Post to Obsidian] Twitter: 監聯已啟動');
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
