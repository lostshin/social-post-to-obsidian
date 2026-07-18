// Service Worker - 處理貼文存檔

importScripts('vault-access.js');

// 啟動時印出版本，方便在 SW console 確認載入的版本
try {
  console.log('[Social Post to Obsidian] background v' + chrome.runtime.getManifest().version + ' 已啟動');
} catch (e) { /* 測試環境略過 */ }

// 監聽來自 content script 的訊息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;
  console.log('[Social Post to Obsidian] Received:', message.type, message.data?.platform);

  switch (message.type) {
    case 'SAVE_DRAFT':
      enqueue(message.data.platform, () => handleSaveDraft(message.data, tabId));
      break;
    case 'PUBLISH_DRAFT':
      enqueue(message.data.platform, () => handlePublishDraft(message.data, tabId));
      break;
    case 'SAVE_POST':
      enqueue(message.data.platform, () => handleSavePost(message.data, tabId));
      break;
    case 'RETRY_QUEUE':
      enqueue('offline-retry', retryOfflineQueue);
      break;
    case 'START_VAULT_SESSION':
      startVaultSession().then(
        () => sendResponse({ ok: true }),
        (error) => sendResponse({ ok: false, error: error.message })
      );
      return true;
  }

  // 同步回應，避免 content script 因 port closed 錯誤而重送訊息
  sendResponse({ ok: true });
});

// 每個平台一條序列，確保草稿存檔與發佈依收到的順序執行
const taskChains = {};
// 記錄每平台最後發佈的貼文時間，用來丟棄遲到的舊草稿
const lastPublishTimestamp = {};
const STORAGE_SETTING_KEYS = ['storageMode', 'apiKey', 'port', 'basePath', 'mediaPath'];
const VAULT_SESSION_DOCUMENT = 'offscreen/vault-session.html';
const MAINTENANCE_ALARM = 'sp2o-vault-maintenance';
let creatingVaultSession = null;

function resolveStorageMode(settings) {
  return settings.storageMode || (settings.apiKey ? 'rest' : 'direct');
}

async function getStorageSettings() {
  return chrome.storage.local.get(STORAGE_SETTING_KEYS);
}

async function ensureVaultSession() {
  if (creatingVaultSession) return creatingVaultSession;
  creatingVaultSession = (async () => {
    let exists;
    if ('getContexts' in chrome.runtime) {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      exists = contexts.length > 0;
    } else {
      const matchedClients = await clients.matchAll();
      exists = matchedClients.some((client) => client.url.includes(VAULT_SESSION_DOCUMENT));
    }
    if (exists) return;
    await chrome.offscreen.createDocument({
      url: VAULT_SESSION_DOCUMENT,
      reasons: ['WORKERS'],
      justification: 'Keep the user-authorized Vault file session available for background saves.'
    });
  })();
  try {
    await creatingVaultSession;
  } finally {
    creatingVaultSession = null;
  }
}

function enqueue(platform, task) {
  const key = platform || 'default';
  taskChains[key] = (taskChains[key] || Promise.resolve()).then(task).catch(() => {});
}

async function startVaultSession() {
  await ensureVaultSession();
  chrome.alarms.create(MAINTENANCE_ALARM, { periodInMinutes: 15 });
  const settings = await getStorageSettings();
  await cleanupEmptyMediaFolders(settings);
}

// 處理草稿存檔
async function handleSaveDraft(data, tabId) {
  try {
    // 發佈後才送達的舊草稿直接丟棄，避免已刪除的草稿檔又被寫回
    const publishedAt = lastPublishTimestamp[data.platform];
    if (publishedAt && data.timestamp <= publishedAt) {
      console.log('[Social Post to Obsidian] 忽略發佈前的舊草稿');
      return;
    }

    const settings = await getStorageSettings();

    if (resolveStorageMode(settings) === 'rest' && !settings.apiKey) {
      console.log('[Social Post to Obsidian] Draft skipped: no API key');
      sendDraftStatus(tabId, false, '尚未設定 API Key，草稿未暫存');
      return;
    }

    const platformName = data.platform === 'x' ? 'Twitter' : 'Threads';
    const filename = `_草稿_${platformName}.md`;
    const fullPath = `${settings.basePath || '個人創作/社群推文'}/${filename}`;

    const markdown = generateDraftMarkdown(data);
    await saveVaultFile(markdown, fullPath, settings, 'text/markdown');

    console.log('[Social Post to Obsidian] Draft saved:', filename);
    sendDraftStatus(tabId, true, `草稿已暫存 ${formatDateTime(data.timestamp).slice(-5)}`);

    // 記錄草稿狀態供 popup 顯示（每平台一個 key，避免共用物件的讀寫競態）
    await chrome.storage.local.set({
      ['draftStatus_' + data.platform]: { filename, path: fullPath, savedAt: data.timestamp }
    });
  } catch (error) {
    // 草稿失敗不跳系統通知（打字中會很吵）；正式貼文有離線佇列保底
    if (isConnectionError(error)) {
      // 用 log 而非 warn：warn 會被收進擴充功能錯誤頁，暫時無法寫入是預期情況
      console.log('[Social Post to Obsidian] Draft save skipped (Vault 無法寫入)');
      sendDraftStatus(tabId, false, error.isVaultWriteError
        ? 'Vault 尚未授權，草稿未暫存'
        : 'Obsidian 未連線，草稿未暫存');
    } else {
      console.error('[Social Post to Obsidian] Draft save failed:', error);
      sendDraftStatus(tabId, false, '草稿暫存失敗');
    }
  }
}

// 草稿狀態只回報到頁面內的狀態列，不用系統通知（分頁不在就靜默略過）
function sendDraftStatus(tabId, ok, text) {
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, { type: 'DRAFT_RESULT', ok, text }, () => {
    void chrome.runtime.lastError;
  });
}

// 處理發佈（刪除草稿 + 存正式檔案）
async function handlePublishDraft(data, tabId) {
  try {
    lastPublishTimestamp[data.platform] = data.timestamp;

    const settings = await getStorageSettings();

    if (resolveStorageMode(settings) === 'rest' && !settings.apiKey) {
      notifyResult(tabId, false, '請先在擴充功能設定中輸入 Obsidian API Key');
      return;
    }

    const basePath = settings.basePath || '個人創作/社群推文';
    const platformName = data.platform === 'x' ? 'Twitter' : 'Threads';

    // 1. 刪除草稿
    const draftPath = `${basePath}/_草稿_${platformName}.md`;
    await deleteVaultFile(draftPath, settings);
    await chrome.storage.local.remove('draftStatus_' + data.platform);

    // 2. 存正式檔案
    const filename = generateFilename(data);
    const fullPath = `${basePath}/${filename}`;
    await saveWithQueueFallback(fullPath, filename, data, settings, tabId);
  } catch (error) {
    console.error('[Social Post to Obsidian] Publish failed:', error);
    notifyResult(tabId, false, error.message);
  }
}

// 存檔；目前寫入方式不可用時加入離線佇列，稍後自動補存
async function saveWithQueueFallback(fullPath, filename, data, settings, tabId) {
  let result;
  try {
    result = await savePostBundle(data, fullPath, filename, settings);
  } catch (error) {
    if (isConnectionError(error)) {
      await enqueueOffline({
        data, path: fullPath, filename,
        platform: data.platform, url: data.url
      });
      const direct = resolveStorageMode(settings) === 'direct';
      notifyResult(tabId, false, direct
        ? 'Vault 無法寫入，已加入待存佇列，重新授權後自動補存'
        : 'Obsidian 未連線，已加入待存佇列，連線後自動補存');
      return;
    }
    throw error;
  }

  await recordRecentSave({ filename, path: fullPath, platform: data.platform, url: data.url });
  const mediaText = result.failedMedia > 0
    ? `（${result.failedMedia} 張圖片未同步）`
    : result.savedMedia > 0 ? `（${result.savedMedia} 張圖片）` : '';
  notifyResult(tabId, true, `已儲存${mediaText}: ${filename}`);
  console.log('[Social Post to Obsidian] Published:', fullPath);
}

const IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif'
};
const DEFAULT_MEDIA_PATH = '附件/Social Post to Obsidian';

// Write images before Markdown. Retries overwrite the same paths, so the operation is idempotent.
async function savePostBundle(data, fullPath, filename, settings) {
  const media = Array.isArray(data.media) ? data.media.slice(0, 20) : [];
  const noteDirectory = fullPath.includes('/') ? fullPath.slice(0, fullPath.lastIndexOf('/')) : '';
  const mediaDirectory = normalizeVaultPath(settings.mediaPath || DEFAULT_MEDIA_PATH);
  const assetFolder = filename.replace(/\.md$/i, '');
  const mediaResults = [];

  for (let index = 0; index < media.length; index++) {
    const item = media[index];
    try {
      const image = await downloadImage(item.url);
      const imageName = `image-${String(index + 1).padStart(2, '0')}.${image.extension}`;
      const vaultPath = `${mediaDirectory}/${assetFolder}/${imageName}`;
      const relativePath = relativeVaultPath(noteDirectory, vaultPath);

      await saveVaultFile(
        image.bytes,
        vaultPath,
        settings,
        image.contentType
      );
      mediaResults.push({ path: relativePath, alt: item.alt || `圖片 ${index + 1}` });
    } catch (error) {
      // Propagate Vault errors for queue handling, but keep the note when a remote image fails.
      if (error.isObsidianApiError || error.isVaultWriteError) throw error;
      console.log('[Social Post to Obsidian] Media download skipped:', index + 1, error.message);
      mediaResults.push({ url: item.url, alt: item.alt || `圖片 ${index + 1}`, failed: true });
    }
  }

  const markdown = generateMarkdown(data, mediaResults);
  await saveVaultFile(markdown, fullPath, settings, 'text/markdown');
  await cleanupEmptyMediaFolders(settings);

  return {
    savedMedia: mediaResults.filter(item => !item.failed).length,
    failedMedia: mediaResults.filter(item => item.failed).length
  };
}

function normalizeVaultPath(path) {
  return String(path || '').split('/').filter(Boolean).join('/');
}

async function cleanupEmptyMediaFolders(settings) {
  if (resolveStorageMode(settings) !== 'direct') return 0;
  try {
    await ensureVaultSession();
    const removed = await SP2OVaultAccess.removeEmptyDirectories(
      normalizeVaultPath(settings.mediaPath || DEFAULT_MEDIA_PATH)
    );
    if (removed > 0) {
      console.log('[Social Post to Obsidian] Removed empty media folders:', removed);
    }
    return removed;
  } catch (error) {
    console.log('[Social Post to Obsidian] Media folder cleanup skipped:', error.message);
    return 0;
  }
}

function relativeVaultPath(fromDirectory, targetPath) {
  const fromParts = normalizeVaultPath(fromDirectory).split('/').filter(Boolean);
  const targetParts = normalizeVaultPath(targetPath).split('/').filter(Boolean);
  let commonParts = 0;

  while (commonParts < fromParts.length
    && commonParts < targetParts.length
    && fromParts[commonParts] === targetParts[commonParts]) {
    commonParts++;
  }

  return [
    ...Array(fromParts.length - commonParts).fill('..'),
    ...targetParts.slice(commonParts)
  ].join('/');
}

async function downloadImage(url) {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:') throw new Error('圖片網址不是 HTTPS');

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`圖片下載失敗: HTTP ${response.status}`);

  const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  const pathExtension = parsedUrl.pathname.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  const extension = IMAGE_EXTENSIONS[contentType]
    || (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(pathExtension) ? pathExtension.replace('jpeg', 'jpg') : '');
  if (!extension) throw new Error(`不支援的圖片格式: ${contentType || 'unknown'}`);

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error('圖片內容為空');

  return {
    bytes: bytes,
    contentType: IMAGE_EXTENSIONS[contentType] ? contentType : `image/${extension === 'jpg' ? 'jpeg' : extension}`,
    extension: extension
  };
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

async function deleteVaultFile(filepath, settings) {
  if (resolveStorageMode(settings) === 'direct') {
    try {
      await ensureVaultSession();
      await SP2OVaultAccess.removeFile(filepath);
      console.log('[Social Post to Obsidian] Draft deleted:', filepath);
    } catch (error) {
      console.log('[Social Post to Obsidian] Draft delete skipped:', error.message);
    }
    return;
  }
  await deleteDraft(filepath, settings.apiKey, settings.port || 27123);
}

// 處理貼文存檔（舊版相容）
async function handleSavePost(data, tabId) {
  try {
    const settings = await getStorageSettings();

    if (resolveStorageMode(settings) === 'rest' && !settings.apiKey) {
      notifyResult(tabId, false, '請先在擴充功能設定中輸入 Obsidian API Key');
      return;
    }

    const filename = generateFilename(data);
    const fullPath = `${settings.basePath || '個人創作/社群推文'}/${filename}`;

    await saveWithQueueFallback(fullPath, filename, data, settings, tabId);
  } catch (error) {
    console.error('[Social Post to Obsidian] Save failed:', error);
    notifyResult(tabId, false, error.message);
  }
}

// ===== 離線佇列：寫入方式不可用時先排隊，恢復後自動補存 =====

const QUEUE_KEY = 'offlineQueue';
const RETRY_ALARM = 'sp2o-retry-queue';

function isConnectionError(error) {
  return error.isStorageUnavailableError
    || error.isObsidianConnectionError
    || (error instanceof TypeError && /Failed to fetch|NetworkError/i.test(error.message || ''));
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
  } else if (alarm.name === MAINTENANCE_ALARM) {
    enqueue('vault-maintenance', async () => {
      const settings = await getStorageSettings();
      if (resolveStorageMode(settings) === 'direct') {
        await cleanupEmptyMediaFolders(settings);
      } else {
        chrome.alarms.clear(MAINTENANCE_ALARM);
      }
    });
  }
});

async function retryOfflineQueue() {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const queue = stored[QUEUE_KEY] || [];
  if (queue.length === 0) {
    chrome.alarms.clear(RETRY_ALARM);
    return;
  }

  const settings = await getStorageSettings();
  if (resolveStorageMode(settings) === 'rest') {
    if (!settings.apiKey) return;
  } else {
    try {
      const permission = await SP2OVaultAccess.getPermissionStatus();
      if (permission.status !== 'granted') return;
    } catch {
      return;
    }
  }

  const remaining = [];
  let saved = 0;
  for (const item of queue) {
    try {
      if (item.data) {
        await savePostBundle(item.data, item.path, item.filename, settings);
      } else {
        // Queue entries created before v1.6 only contain rendered Markdown.
        await saveVaultFile(item.markdown, item.path, settings, 'text/markdown');
      }
      await recordRecentSave({ filename: item.filename, path: item.path, platform: item.platform, url: item.url });
      saved++;
    } catch (error) {
      remaining.push(item);
    }
  }

  await chrome.storage.local.set({ [QUEUE_KEY]: remaining });
  if (saved > 0) {
    showNotification('已補存', `Vault 恢復可用，補存 ${saved} 則貼文`);
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

getStorageSettings().then(async (settings) => {
  if (settings.storageMode !== 'direct') return;
  const permission = await SP2OVaultAccess.getPermissionStatus();
  if (permission.name) await startVaultSession();
}).catch((error) => {
  console.log('[Social Post to Obsidian] Vault session not restored:', error.message);
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

// Generate Markdown with media, reply, and quote metadata.
function generateMarkdown(data, mediaResults = []) {
  const title = extractTitle(data.content || '圖片貼文');
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
  let body = `\n\n${data.content || ''}\n`;

  if (mediaResults.length > 0) {
    body += `
---

## 圖片

${mediaResults.map((item) => {
    const alt = escapeMarkdownAlt(item.alt);
    const target = item.failed ? item.url : item.path;
    return `![${alt}](<${String(target).replace(/>/g, '%3E')}>)`;
  }).join('\n\n')}
`;
  }

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
  // 移除換行後以 code point 切割，避免把 emoji 的 surrogate pair 切成半個字
  const chars = Array.from(content.replace(/\n/g, ' ').trim());
  const title = chars.slice(0, 30).join('');

  // 如果有截斷，加上 ...
  return chars.length > 30 ? title + '...' : title;
}

// 產生檔案名稱
function generateFilename(data) {
  const date = new Date(data.timestamp);
  const dateStr = formatDate(date);
  // 加上時分，避免同一天發相似開頭的貼文時檔名互相覆蓋
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  // 取首 25 字作為摘要（以 code point 切割避免切斷 emoji），移除不合法的檔名字元
  const summary = Array.from((data.content || '圖片貼文').replace(/\n/g, ' '))
    .slice(0, 25)
    .join('')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim();

  return `${dateStr}_${hours}${minutes}_${summary}.md`;
}

function escapeMarkdownAlt(text) {
  return String(text || '圖片').replace(/[\[\]\\]/g, '\\$&');
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

async function saveVaultFile(content, filename, settings, contentType) {
  if (resolveStorageMode(settings) === 'direct') {
    try {
      await ensureVaultSession();
      await SP2OVaultAccess.writeFile(filename, content);
      return;
    } catch (error) {
      error.isVaultWriteError = true;
      error.isStorageUnavailableError = true;
      throw error;
    }
  }
  return saveFileToObsidian(content, filename, settings.apiKey, settings.port || 27123, contentType);
}

async function saveFileToObsidian(content, filename, apiKey, port, contentType) {
  const url = `${apiBase(port)}/vault/${encodeURIComponent(filename)}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': contentType
      },
      body: content
    });
  } catch (error) {
    error.isObsidianApiError = true;
    error.isObsidianConnectionError = true;
    throw error;
  }

  // 204 No Content 也算成功
  if (!response.ok && response.status !== 204) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const error = await response.json();
      errorMessage = error.message || errorMessage;
    } catch {
      // 忽略 JSON 解析錯誤
    }
    const error = new Error(errorMessage);
    error.isObsidianApiError = true;
    throw error;
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
