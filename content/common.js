// 共用工具（ISOLATED world）：訊息傳送、攔截事件接收、發文 API 回應解析
// 由 manifest 在各平台 content script 之前載入
var SP2O = (function () {
  'use strict';

  const LOG = '[Social Post to Obsidian]';

  // 發送訊息到 background（帶重試機制，處理 service worker 尚未喚醒的情況）
  function sendMessage(message, maxRetries = 3) {
    let retries = 0;

    function trySend() {
      chrome.runtime.sendMessage(message, () => {
        if (chrome.runtime.lastError) {
          retries++;
          if (retries < maxRetries) {
            setTimeout(trySend, 500);
          } else {
            console.error(LOG, '發送失敗，已達最大重試次數:', chrome.runtime.lastError.message);
          }
        }
      });
    }

    trySend();
  }

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

  return { sendMessage, onIntercept, parseCreateTweet, parseThreadsCreate };
})();
