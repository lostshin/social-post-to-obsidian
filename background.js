// Service Worker - 處理貼文存檔

// 監聽來自 content script 的訊息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;
  console.log('[Social Post to Obsidian] Received:', message.type, message.data?.platform);

  switch (message.type) {
    case 'SAVE_DRAFT':
      enqueue(message.data.platform, () => handleSaveDraft(message.data));
      break;
    case 'PUBLISH_DRAFT':
      enqueue(message.data.platform, () => handlePublishDraft(message.data, tabId));
      break;
    case 'SAVE_POST':
      enqueue(message.data.platform, () => handleSavePost(message.data, tabId));
      break;
  }

  // 同步回應，避免 content script 因 port closed 錯誤而重送訊息
  sendResponse({ ok: true });
});

// 每個平台一條序列，確保草稿存檔與發佈依收到的順序執行
const taskChains = {};
// 記錄每平台最後發佈的貼文時間，用來丟棄遲到的舊草稿
const lastPublishTimestamp = {};

function enqueue(platform, task) {
  const key = platform || 'default';
  taskChains[key] = (taskChains[key] || Promise.resolve()).then(task).catch(() => {});
}

// 處理草稿存檔
async function handleSaveDraft(data) {
  try {
    // 發佈後才送達的舊草稿直接丟棄，避免已刪除的草稿檔又被寫回
    const publishedAt = lastPublishTimestamp[data.platform];
    if (publishedAt && data.timestamp <= publishedAt) {
      console.log('[Social Post to Obsidian] 忽略發佈前的舊草稿');
      return;
    }

    const settings = await chrome.storage.local.get(['apiKey', 'port', 'basePath']);

    if (!settings.apiKey) {
      console.log('[Social Post to Obsidian] Draft skipped: no API key');
      return;
    }

    const platformName = data.platform === 'x' ? 'Twitter' : 'Threads';
    const filename = `_草稿_${platformName}.md`;
    const fullPath = `${settings.basePath || '個人創作/社群推文'}/${filename}`;

    const markdown = generateDraftMarkdown(data);
    await saveToObsidian(markdown, fullPath, settings.apiKey, settings.port || 27123);

    console.log('[Social Post to Obsidian] Draft saved:', filename);
  } catch (error) {
    // 草稿失敗不跳通知（打字中會很吵）；正式貼文有離線佇列保底
    // 連線失敗屬預期情況（Obsidian 沒開），用 warn 避免在擴充功能頁堆紅色錯誤
    if (isConnectionError(error)) {
      console.warn('[Social Post to Obsidian] Draft save skipped (Obsidian 未連線)');
    } else {
      console.error('[Social Post to Obsidian] Draft save failed:', error);
    }
  }
}

// 處理發佈（刪除草稿 + 存正式檔案）
async function handlePublishDraft(data, tabId) {
  try {
    lastPublishTimestamp[data.platform] = data.timestamp;

    const settings = await chrome.storage.local.get(['apiKey', 'port', 'basePath']);

    if (!settings.apiKey) {
      notifyResult(tabId, false, '請先在擴充功能設定中輸入 Obsidian API Key');
      return;
    }

    const basePath = settings.basePath || '個人創作/社群推文';
    const platformName = data.platform === 'x' ? 'Twitter' : 'Threads';

    // 1. 刪除草稿
    const draftPath = `${basePath}/_草稿_${platformName}.md`;
    await deleteDraft(draftPath, settings.apiKey, settings.port || 27123);

    // 2. 存正式檔案
    const markdown = generateMarkdown(data);
    const filename = generateFilename(data);
    const fullPath = `${basePath}/${filename}`;
    await saveWithQueueFallback(markdown, fullPath, filename, data, settings, tabId);
  } catch (error) {
    console.error('[Social Post to Obsidian] Publish failed:', error);
    notifyResult(tabId, false, error.message);
  }
}

// 存檔；Obsidian 未連線時加入離線佇列，稍後自動補存
async function saveWithQueueFallback(markdown, fullPath, filename, data, settings, tabId) {
  try {
    await saveToObsidian(markdown, fullPath, settings.apiKey, settings.port || 27123);
  } catch (error) {
    if (isConnectionError(error)) {
      await enqueueOffline({
        markdown, path: fullPath, filename,
        platform: data.platform, url: data.url
      });
      notifyResult(tabId, false, 'Obsidian 未連線，已加入待存佇列，連線後自動補存');
      return;
    }
    throw error;
  }

  await recordRecentSave({ filename, path: fullPath, platform: data.platform, url: data.url });
  notifyResult(tabId, true, `已儲存: ${filename}`);
  console.log('[Social Post to Obsidian] Published:', fullPath);
}

// 刪除草稿檔案
async function deleteDraft(filepath, apiKey, port) {
  const url = `${apiBase(port)}/vault/${encodeURIComponent(filepath)}`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    // 404（草稿不存在）也沒關係，其他錯誤記下來
    if (!response.ok && response.status !== 404) {
      console.warn('[Social Post to Obsidian] Draft delete failed:', response.status);
    } else {
      console.log('[Social Post to Obsidian] Draft deleted:', filepath);
    }
  } catch (error) {
    console.log('[Social Post to Obsidian] Draft delete skipped:', error.message);
  }
}

// 處理貼文存檔（舊版相容）
async function handleSavePost(data, tabId) {
  try {
    const settings = await chrome.storage.local.get(['apiKey', 'port', 'basePath']);

    if (!settings.apiKey) {
      notifyResult(tabId, false, '請先在擴充功能設定中輸入 Obsidian API Key');
      return;
    }

    const markdown = generateMarkdown(data);
    const filename = generateFilename(data);
    const fullPath = `${settings.basePath || '個人創作/社群推文'}/${filename}`;

    await saveWithQueueFallback(markdown, fullPath, filename, data, settings, tabId);
  } catch (error) {
    console.error('[Social Post to Obsidian] Save failed:', error);
    notifyResult(tabId, false, error.message);
  }
}

// ===== 離線佇列：Obsidian 沒開時先排隊，恢復連線後自動補存 =====

const QUEUE_KEY = 'offlineQueue';
const RETRY_ALARM = 'sp2o-retry-queue';

function isConnectionError(error) {
  return error instanceof TypeError || /Failed to fetch|NetworkError/i.test(error.message || '');
}

async function enqueueOffline(item) {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const queue = stored[QUEUE_KEY] || [];
  queue.push({ ...item, queuedAt: new Date().toISOString() });
  // 上限 50 筆，避免無限成長
  await chrome.storage.local.set({ [QUEUE_KEY]: queue.slice(-50) });
  chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
  console.log('[Social Post to Obsidian] Queued for retry:', item.filename);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) {
    enqueue('offline-retry', retryOfflineQueue);
  }
});

async function retryOfflineQueue() {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const queue = stored[QUEUE_KEY] || [];
  if (queue.length === 0) {
    chrome.alarms.clear(RETRY_ALARM);
    return;
  }

  const settings = await chrome.storage.local.get(['apiKey', 'port']);
  if (!settings.apiKey) return;

  const remaining = [];
  let saved = 0;
  for (const item of queue) {
    try {
      await saveToObsidian(item.markdown, item.path, settings.apiKey, settings.port || 27123);
      await recordRecentSave({ filename: item.filename, path: item.path, platform: item.platform, url: item.url });
      saved++;
    } catch (error) {
      remaining.push(item);
    }
  }

  await chrome.storage.local.set({ [QUEUE_KEY]: remaining });
  if (saved > 0) {
    showNotification('已補存', `Obsidian 恢復連線，補存 ${saved} 則貼文`);
  }
  if (remaining.length === 0) {
    chrome.alarms.clear(RETRY_ALARM);
  }
}

// service worker 啟動時，若佇列有東西就確保重試 alarm 存在
chrome.storage.local.get(QUEUE_KEY).then((stored) => {
  if ((stored[QUEUE_KEY] || []).length > 0) {
    chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
  }
});

// 記錄最近儲存（popup 顯示用，保留 5 筆）
async function recordRecentSave(entry) {
  const stored = await chrome.storage.local.get('recentSaves');
  const recentSaves = stored.recentSaves || [];
  recentSaves.unshift({ ...entry, savedAt: new Date().toISOString() });
  await chrome.storage.local.set({ recentSaves: recentSaves.slice(0, 5) });
}

// 回報存檔結果：優先在原分頁顯示 toast，分頁不在了才用系統通知
function notifyResult(tabId, ok, text) {
  if (tabId != null) {
    chrome.tabs.sendMessage(tabId, { type: 'SAVE_RESULT', ok, text }, () => {
      if (chrome.runtime.lastError) {
        showNotification(ok ? '存檔成功' : '存檔失敗', text);
      }
    });
  } else {
    showNotification(ok ? '存檔成功' : '存檔失敗', text);
  }
}

// 產生草稿 Markdown 內容
function generateDraftMarkdown(data) {
  const platformName = data.platform === 'x' ? 'Twitter/X' : 'Threads';
  const updated = formatDateTime(data.timestamp);

  return `---
title: 草稿
platform: ${platformName}
updated: ${updated}
status: draft
---

${data.content}
`;
}

// 產生 Markdown 內容（支援引用貼文）
function generateMarkdown(data) {
  const title = extractTitle(data.content);
  const created = formatDateTime(data.timestamp);
  const platformName = data.platform === 'x' ? 'Twitter/X' : 'Threads';

  // 基本 frontmatter
  let frontmatter = `---
title: ${escapeYaml(title)}
created: ${created}
source: ${data.platform}
source_url: ${data.url}
tags:
  - 社群貼文
  - ${platformName}`;

  // 如果是回覆，記下被回覆的貼文連結
  if (data.replyTo) {
    frontmatter += `
reply_to: ${data.replyTo}`;
  }

  // 如果有引用，加入引用資訊
  if (data.quoted) {
    frontmatter += `
quoted_from: ${escapeYaml('@' + data.quoted.author)}
quoted_author_name: ${escapeYaml(data.quoted.authorName)}
quoted_url: ${data.quoted.url}`;
  }

  frontmatter += `
summary:
---`;

  // 正文
  let body = `\n\n${data.content}\n`;

  // 如果有引用，加入引用區塊
  if (data.quoted && data.quoted.content) {
    const quotedLines = data.quoted.content.split('\n').map(line => '> ' + line).join('\n');
    body += `
---

## 引用貼文

> **[@${data.quoted.author}](${data.quoted.url})** 的貼文：
>
${quotedLines}
`;
  }

  body += `
---

## 相關筆記

- [[]]
`;

  return frontmatter + body;
}

// 擷取標題（首句，最多 30 字）
function extractTitle(content) {
  // 移除換行，取前 30 字
  const firstLine = content.replace(/\n/g, ' ').trim();
  const title = firstLine.substring(0, 30);

  // 如果有截斷，加上 ...
  return firstLine.length > 30 ? title + '...' : title;
}

// 產生檔案名稱
function generateFilename(data) {
  const date = new Date(data.timestamp);
  const dateStr = formatDate(date);
  // 加上時分，避免同一天發相似開頭的貼文時檔名互相覆蓋
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  // 取首 25 字作為摘要，移除不合法的檔名字元
  const summary = data.content
    .replace(/\n/g, ' ')
    .substring(0, 25)
    .replace(/[\\/:*?"<>|]/g, '')
    .trim();

  return `${dateStr}_${hours}${minutes}_${summary}.md`;
}

// 格式化日期時間 (YYYY-MM-DD HH:mm)
function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

// 格式化日期 (YYYY-MM-DD)
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

// 跳脫 YAML 特殊字元
function escapeYaml(str) {
  // 如果包含冒號、引號等特殊字元，用雙引號包起來
  if (/[:\[\]{}#&*!|>'"%@`\\]/.test(str) || str.includes('\n')) {
    return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return str;
}

// 依 port 決定協定（27124 是 Local REST API 的 HTTPS 埠）
function apiBase(port) {
  const protocol = Number(port) === 27124 ? 'https' : 'http';
  return `${protocol}://127.0.0.1:${port}`;
}

// 儲存到 Obsidian
async function saveToObsidian(content, filename, apiKey, port) {
  const url = `${apiBase(port)}/vault/${encodeURIComponent(filename)}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'text/markdown'
    },
    body: content
  });

  // 204 No Content 也算成功
  if (!response.ok && response.status !== 204) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const error = await response.json();
      errorMessage = error.message || errorMessage;
    } catch {
      // 忽略 JSON 解析錯誤
    }
    throw new Error(errorMessage);
  }
}

// 顯示通知
function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: title,
    message: message
  });
}
