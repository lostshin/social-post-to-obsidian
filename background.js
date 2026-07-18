// Service Worker - 處理貼文存檔

// 啟動時印出版本，方便在 SW console 確認載入的版本
try {
  console.log('[Social Post to Obsidian] background v' + chrome.runtime.getManifest().version + ' 已啟動');
} catch (e) { /* 測試環境略過 */ }

// 共用設定邏輯與預設路徑（popup 亦載入同一份，見 shared/settings.js）
importScripts('shared/settings.js');

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
    case 'GET_NATIVE_STATUS':
      sendNativeRequest({ action: 'ping' }).then(
        (response) => sendResponse(response),
        (error) => sendResponse(error.nativeResponse || { ok: false, error: error.message })
      );
      return true;
    case 'CHOOSE_NATIVE_VAULT':
      chooseNativeVault().then(
        (response) => sendResponse(response),
        (error) => sendResponse({ ok: false, error: error.message })
      );
      return true;
    case 'CLEAR_AUTO_DRAFTS':
      clearAutoDrafts().then(
        (response) => sendResponse(response),
        (error) => sendResponse({ ok: false, cleared: 0, error: error.message })
      );
      return true;
    case 'SYNC_VAULT_ACTIVITY':
      syncVaultActivity().then(
        (response) => sendResponse(response),
        (error) => sendResponse({ ok: false, error: error.message })
      );
      return true;
    case 'DELETE_VAULT_ACTIVITY':
      deleteVaultActivity(message).then(
        (response) => sendResponse(response),
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
const NATIVE_HOST_NAME = 'com.lostshin.social_post_to_obsidian';
const MAINTENANCE_ALARM = 'sp2o-vault-maintenance';

async function getStorageSettings() {
  return chrome.storage.local.get(STORAGE_SETTING_KEYS);
}

async function sendNativeRequest(message) {
  let response;
  try {
    response = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message);
  } catch (error) {
    // Host 無法啟動或中途斷線（未安裝、崩潰）：暫時性問題，正式貼文可進離線佇列
    error.isStorageUnavailableError = true;
    throw error;
  }
  if (!response?.ok) {
    // Host 有回應但拒絕（Vault 未設定、路徑不合法）：重試不會自己恢復，不進佇列
    const error = new Error(response?.error || '本機 Helper 沒有回應');
    error.isNativeHostError = true;
    error.nativeResponse = response;
    throw error;
  }
  return response;
}

function enqueue(platform, task) {
  const key = platform || 'default';
  taskChains[key] = (taskChains[key] || Promise.resolve()).then(task).catch(() => {});
}

async function startNativeMaintenance() {
  chrome.alarms.create(MAINTENANCE_ALARM, { periodInMinutes: 15 });
  const settings = await getStorageSettings();
  await cleanupEmptyMediaFolders(settings);
}

async function chooseNativeVault() {
  const response = await sendNativeRequest({ action: 'chooseVault' });
  await chrome.storage.local.set({ storageMode: 'native', vaultName: response.vaultName });
  await startNativeMaintenance();
  return response;
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

    const platformName = platformDisplayName(data.platform, true);
    const filename = `_草稿_${platformName}.md`;
    const fullPath = `${settings.basePath || DEFAULT_BASE_PATH}/${filename}`;

    const markdown = generateDraftMarkdown(data);
    await saveVaultFile(markdown, fullPath, settings, 'text/markdown');

    console.log('[Social Post to Obsidian] Draft saved:', filename);
    sendDraftStatus(tabId, true, `草稿已暫存 ${formatDateTime(data.timestamp).slice(-5)}`);

    // 記錄草稿狀態供 popup 顯示（每平台一個 key，避免共用物件的讀寫競態）
    await chrome.storage.local.set({
      ['draftStatus_' + data.platform]: {
        filename,
        path: fullPath,
        savedAt: data.timestamp,
        preview: createPostPreview(data)
      }
    });
  } catch (error) {
    // 草稿失敗不跳系統通知（打字中會很吵）；正式貼文有離線佇列保底
    if (isConnectionError(error) || error.isNativeHostError) {
      // 用 log 而非 warn：warn 會被收進擴充功能錯誤頁，暫時無法寫入是預期情況
      console.log('[Social Post to Obsidian] Draft save skipped (Vault 無法寫入)');
      sendDraftStatus(tabId, false, (error.isNativeHostError || error.isVaultWriteError)
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

// 處理發佈（存正式檔案 + 刪除草稿）
async function handlePublishDraft(data, tabId) {
  try {
    const settings = await getStorageSettings();

    if (resolveStorageMode(settings) === 'rest' && !settings.apiKey) {
      notifyResult(tabId, false, '請先在擴充功能設定中輸入 Obsidian API Key');
      return;
    }

    const basePath = settings.basePath || DEFAULT_BASE_PATH;

    // 1. 先存正式檔案；失敗（且未進離線佇列）時保留草稿檔與 draftStatus，內容不遺失
    const filename = generateFilename(data);
    const fullPath = `${basePath}/${filename}`;
    await saveWithQueueFallback(fullPath, filename, data, settings, tabId);

    // 發佈已受理（含進入離線佇列）後，遲到的舊草稿才可丟棄
    lastPublishTimestamp[data.platform] = data.timestamp;

    // 2. 刪除草稿；刪除失敗時保留 draftStatus，讓 popup 清單與 Vault 檔案維持一致
    const draftPath = `${basePath}/_草稿_${platformDisplayName(data.platform, true)}.md`;
    try {
      await deleteVaultFile(draftPath, settings, true);
      await chrome.storage.local.remove('draftStatus_' + data.platform);
    } catch (error) {
      console.log('[Social Post to Obsidian] Draft cleanup failed:', error.message);
    }
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
      const native = resolveStorageMode(settings) === 'native';
      notifyResult(tabId, false, native
        ? '本機 Helper 無法寫入，已加入待存佇列，恢復後自動補存'
        : 'Obsidian 未連線，已加入待存佇列，連線後自動補存');
      return;
    }
    throw error;
  }

  await recordRecentSave({
    filename,
    path: fullPath,
    platform: data.platform,
    url: data.url,
    preview: createPostPreview(data)
  });
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

// Write images before Markdown. Retries overwrite the same paths, so the operation is idempotent.
async function savePostBundle(data, fullPath, filename, settings) {
  const media = Array.isArray(data.media) ? data.media.slice(0, 20) : [];
  const noteDirectory = fullPath.includes('/') ? fullPath.slice(0, fullPath.lastIndexOf('/')) : '';
  const mediaDirectory = normalizeVaultPath(settings.mediaPath || DEFAULT_MEDIA_PATH);
  const assetFolder = filename.replace(/\.md$/i, '');

  // 各張圖片互相獨立（檔名用固定 index），平行下載與寫入以縮短發文延遲
  const mediaResults = await Promise.all(media.map(async (item, index) => {
    try {
      const image = await downloadImage(item.url);
      const imageName = `image-${String(index + 1).padStart(2, '0')}.${image.extension}`;
      const vaultPath = `${mediaDirectory}/${assetFolder}/${imageName}`;

      await saveVaultFile(
        image.bytes,
        vaultPath,
        settings,
        image.contentType
      );
      return { path: relativeVaultPath(noteDirectory, vaultPath), alt: item.alt || `圖片 ${index + 1}` };
    } catch (error) {
      // Propagate Vault errors for queue handling, but keep the note when a remote image fails.
      if (error.isObsidianApiError || error.isVaultWriteError) throw error;
      console.log('[Social Post to Obsidian] Media download skipped:', index + 1, error.message);
      return { url: item.url, alt: item.alt || `圖片 ${index + 1}`, failed: true };
    }
  }));

  const markdown = generateMarkdown(data, mediaResults);
  await saveVaultFile(markdown, fullPath, settings, 'text/markdown');

  return {
    savedMedia: mediaResults.filter(item => !item.failed).length,
    failedMedia: mediaResults.filter(item => item.failed).length
  };
}

function normalizeVaultPath(path) {
  return String(path || '').split('/').filter(Boolean).join('/');
}

async function cleanupEmptyMediaFolders(settings) {
  if (resolveStorageMode(settings) !== 'native') return 0;
  try {
    const response = await sendNativeRequest({
      action: 'cleanEmptyMediaFolders',
      path: normalizeVaultPath(settings.mediaPath || DEFAULT_MEDIA_PATH)
    });
    const removed = response.removed || 0;
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

async function deleteRestVaultFile(filepath, apiKey, port, strict = false) {
  const url = `${apiBase(port)}/vault/${encodeURIComponent(filepath)}`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    // 404（草稿不存在）也沒關係，其他錯誤記下來
    if (!response.ok && response.status !== 404) {
      if (strict) throw new Error(`刪除 Vault 檔案失敗：HTTP ${response.status}`);
      console.warn('[Social Post to Obsidian] Vault file delete failed:', response.status);
    } else {
      console.log('[Social Post to Obsidian] Vault file deleted:', filepath);
    }
  } catch (error) {
    if (strict) throw error;
    console.log('[Social Post to Obsidian] Vault file delete skipped:', error.message);
  }
}

async function deleteVaultFile(filepath, settings, strict = false) {
  if (resolveStorageMode(settings) === 'native') {
    try {
      await sendNativeRequest({ action: 'remove', path: filepath });
      console.log('[Social Post to Obsidian] Vault file deleted:', filepath);
    } catch (error) {
      if (strict) throw error;
      console.log('[Social Post to Obsidian] Vault file delete skipped:', error.message);
    }
    return;
  }
  await deleteRestVaultFile(filepath, settings.apiKey, settings.port || 27123, strict);
}

async function clearAutoDrafts() {
  const settings = await getStorageSettings();
  const basePath = settings.basePath || DEFAULT_BASE_PATH;
  const stored = await chrome.storage.local.get(['draftStatus_x', 'draftStatus_threads']);
  const drafts = [
    { key: 'draftStatus_x', filename: '_草稿_Twitter.md' },
    { key: 'draftStatus_threads', filename: '_草稿_Threads.md' }
  ].filter(({ key }) => stored[key]);
  const errors = [];
  let cleared = 0;

  for (const draft of drafts) {
    try {
      await deleteVaultFile(stored[draft.key].path || `${basePath}/${draft.filename}`, settings, true);
      await chrome.storage.local.remove(draft.key);
      cleared++;
    } catch (error) {
      errors.push(error.message);
    }
  }

  return {
    ok: errors.length === 0,
    cleared,
    error: errors.length > 0 ? errors.join('；') : undefined
  };
}

async function vaultFileExists(filepath, settings) {
  if (resolveStorageMode(settings) === 'native') {
    const response = await sendNativeRequest({ action: 'exists', path: filepath });
    return response.exists === true;
  }

  let response;
  try {
    response = await fetch(`${apiBase(settings.port || 27123)}/vault/${encodeURIComponent(filepath)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${settings.apiKey}` }
    });
  } catch (error) {
    error.isObsidianConnectionError = true;
    throw error;
  }
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`同步 Vault 狀態失敗：HTTP ${response.status}`);
  return true;
}

async function syncVaultActivity() {
  const settings = await getStorageSettings();
  if (resolveStorageMode(settings) === 'rest' && !settings.apiKey) {
    return { ok: false, error: '尚未設定 API Key' };
  }

  const stored = await chrome.storage.local.get([
    'draftStatus_x',
    'draftStatus_threads',
    'recentSaves'
  ]);
  const draftEntries = [
    ['draftStatus_x', stored.draftStatus_x],
    ['draftStatus_threads', stored.draftStatus_threads]
  ];
  const existence = new Map();

  async function exists(filepath) {
    if (!filepath) return true;
    if (!existence.has(filepath)) {
      existence.set(filepath, vaultFileExists(filepath, settings));
    }
    return existence.get(filepath);
  }

  let removedDrafts = 0;
  for (const [key, draft] of draftEntries) {
    if (!draft || await exists(draft.path)) continue;
    await chrome.storage.local.remove(key);
    removedDrafts++;
  }

  const recentSaves = stored.recentSaves || [];
  const existingRecentSaves = [];
  for (const item of recentSaves) {
    if (await exists(item.path)) existingRecentSaves.push(item);
  }
  const removedRecent = recentSaves.length - existingRecentSaves.length;
  if (removedRecent > 0) {
    await chrome.storage.local.set({ recentSaves: existingRecentSaves });
    await cleanupEmptyMediaFolders(settings);
  }

  return { ok: true, removedDrafts, removedRecent };
}

async function deleteVaultActivity(message) {
  const settings = await getStorageSettings();
  const stored = await chrome.storage.local.get([
    'draftStatus_x',
    'draftStatus_threads',
    'recentSaves'
  ]);
  let target;

  if (message.kind === 'draft') {
    const draftEntries = [
      ['draftStatus_x', stored.draftStatus_x],
      ['draftStatus_threads', stored.draftStatus_threads]
    ];
    const matched = draftEntries.find(([, draft]) => draft?.path === message.path);
    if (matched) target = { key: matched[0], path: matched[1].path };
  } else if (message.kind === 'recent') {
    const recentSaves = stored.recentSaves || [];
    if (recentSaves.some(item => item.path === message.path)) {
      target = { path: message.path, recentSaves };
    }
  }

  if (!target) throw new Error('找不到要刪除的 Vault 貼文');
  await deleteVaultFile(target.path, settings, true);

  if (target.key) {
    await chrome.storage.local.remove(target.key);
  } else {
    await chrome.storage.local.set({
      recentSaves: target.recentSaves.filter(item => item.path !== target.path)
    });
    await cleanupEmptyMediaFolders(settings);
  }

  return { ok: true };
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
    const fullPath = `${settings.basePath || DEFAULT_BASE_PATH}/${filename}`;

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
      if (resolveStorageMode(settings) === 'native') {
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
      const status = await sendNativeRequest({ action: 'ping' });
      if (!status.configured) return;
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
      await recordRecentSave({
        filename: item.filename,
        path: item.path,
        platform: item.platform,
        url: item.url,
        preview: item.data ? createPostPreview(item.data) : createContentPreview(item.markdown)
      });
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

// service worker 啟動：一次讀完設定與佇列（SW 常被 kill/重啟，減少每次冷啟動的 storage 往返）
chrome.storage.local.get([...STORAGE_SETTING_KEYS, QUEUE_KEY]).then(async (stored) => {
  // 佇列有東西就確保重試 alarm 存在
  if ((stored[QUEUE_KEY] || []).length > 0) {
    chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
  }

  if (stored.storageMode !== 'native' && stored.storageMode !== 'direct') return;
  if (stored.storageMode === 'direct') {
    await chrome.storage.local.set({ storageMode: 'native' });
  }
  const status = await sendNativeRequest({ action: 'ping' });
  if (!status.configured) return;
  await chrome.storage.local.set({ vaultName: status.vaultName });
  await startNativeMaintenance();
}).catch((error) => {
  console.log('[Social Post to Obsidian] Native Helper not ready:', error.message);
});

// 記錄最近儲存（popup 顯示用，保留 5 筆）
async function recordRecentSave(entry) {
  const stored = await chrome.storage.local.get('recentSaves');
  // 同路徑代表同一份檔案（補存/修正會覆寫），移除舊項目避免清單重複與刪除時誤刪多筆
  const recentSaves = (stored.recentSaves || []).filter(item => item.path !== entry.path);
  recentSaves.unshift({ ...entry, savedAt: new Date().toISOString() });
  await chrome.storage.local.set({ recentSaves: recentSaves.slice(0, 5) });
}

function createContentPreview(content, maxLength = 160) {
  const normalized = String(content || '').replace(/\s+/g, ' ').trim();
  const characters = Array.from(normalized);
  if (characters.length <= maxLength) return normalized;
  return characters.slice(0, maxLength).join('') + '…';
}

function createPostPreview(data) {
  const threadItems = getThreadItems(data);
  const text = createContentPreview(threadItems[0] || data?.content);
  if (text) return threadItems.length > 1 ? `${text} · 共 ${threadItems.length} 則` : text;
  const mediaCount = Array.isArray(data?.media) ? data.media.length : 0;
  return mediaCount > 0 ? `圖片貼文 · ${mediaCount} 張圖片` : '沒有文字內容';
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

function getThreadItems(data) {
  if (!Array.isArray(data?.thread)) return [];
  return data.thread
    .map(item => String(item || '').trim())
    .filter(Boolean);
}

function renderCopyableContent(content) {
  const text = String(content || '');
  const fenceLength = (text.match(/`+/g) || [])
    .reduce((length, run) => Math.max(length, run.length + 1), 3);
  const fence = '`'.repeat(fenceLength);
  return `${fence}\n${text}\n${fence}`;
}

function renderContentSection(data, singleHeading, threadHeading) {
  const threadItems = getThreadItems(data);
  if (threadItems.length > 1) {
    const posts = threadItems.map((item, index) => (
      `### ${index + 1} / ${threadItems.length}\n\n${renderCopyableContent(item)}`
    ));
    return `## ${threadHeading}\n\n${posts.join('\n\n---\n\n')}`;
  }
  return `## ${singleHeading}\n\n${renderCopyableContent(data.content)}`;
}

function markdownLinkTarget(target) {
  return String(target || '').replace(/>/g, '%3E');
}

// 產生草稿 Markdown 內容
function generateDraftMarkdown(data) {
  const platformName = platformDisplayName(data.platform);
  const updated = formatDateTime(data.timestamp);
  const threadItems = getThreadItems(data);
  const frontmatter = [
    '---',
    `title: ${escapeYaml(`${platformName} 草稿`)}`,
    `updated: ${escapeYaml(updated)}`,
    `platform: ${escapeYaml(platformName)}`,
    `source: ${escapeYaml(data.platform)}`,
    `status: ${escapeYaml('draft')}`,
    ...(threadItems.length > 1 ? [`thread_count: ${threadItems.length}`] : []),
    'tags:',
    `  - ${escapeYaml('社群草稿')}`,
    `  - ${escapeYaml(platformName)}`,
    ...(threadItems.length > 1 ? [`  - ${escapeYaml('串文')}`] : []),
    '---'
  ].join('\n');
  const notice = [
    '> [!warning] 未發佈草稿',
    `> **平台**：${platformName}  `,
    `> **最後更新**：${updated}  `,
    '> 發佈成功後，這份草稿檔會自動移除。'
  ].join('\n');

  return `${frontmatter}\n\n${notice}\n\n${renderContentSection(
    data,
    '草稿內容',
    '串文草稿'
  )}\n`;
}

// Generate Markdown with media, reply, and quote metadata.
function generateMarkdown(data, mediaResults = []) {
  const threadItems = getThreadItems(data);
  const title = extractTitle(threadItems[0] || data.content || '圖片貼文');
  const created = formatDateTime(data.timestamp);
  const platformName = platformDisplayName(data.platform);
  const frontmatter = [
    '---',
    `title: ${escapeYaml(title)}`,
    `created: ${escapeYaml(created)}`,
    `platform: ${escapeYaml(platformName)}`,
    `source: ${escapeYaml(data.platform)}`,
    `source_url: ${escapeYaml(data.url)}`,
    `status: ${escapeYaml('published')}`,
    ...(threadItems.length > 1 ? [`thread_count: ${threadItems.length}`] : [])
  ];

  // 如果是回覆，記下被回覆的貼文連結
  if (data.replyTo) {
    frontmatter.push(`reply_to: ${escapeYaml(data.replyTo)}`);
  }

  // 如果有引用，加入引用資訊
  if (data.quoted) {
    frontmatter.push(
      `quoted_from: ${escapeYaml('@' + data.quoted.author)}`,
      `quoted_author_name: ${escapeYaml(data.quoted.authorName)}`,
      `quoted_url: ${escapeYaml(data.quoted.url)}`
    );
  }

  frontmatter.push(
    'tags:',
    `  - ${escapeYaml('社群貼文')}`,
    `  - ${escapeYaml(platformName)}`,
    ...(threadItems.length > 1 ? [`  - ${escapeYaml('串文')}`] : []),
    `summary: ${escapeYaml('')}`,
    '---'
  );

  const info = [
    '> [!info] 貼文資訊',
    `> **平台**：${platformName}  `,
    `> **發佈時間**：${created}${data.url || data.replyTo ? '  ' : ''}`,
    ...(data.url ? [
      `> **原始貼文**：[在 ${platformName} 查看](<${markdownLinkTarget(data.url)}>)${data.replyTo ? '  ' : ''}`
    ] : []),
    ...(data.replyTo ? [
      `> **回覆對象**：[查看原始貼文](<${markdownLinkTarget(data.replyTo)}>)`
    ] : [])
  ].join('\n');
  const sections = [info];

  if (data.content || threadItems.length > 0) {
    sections.push(renderContentSection(data, '貼文內容', '串文內容'));
  }

  if (mediaResults.length > 0) {
    sections.push(`## 圖片\n\n${mediaResults.map((item) => {
      const alt = escapeMarkdownAlt(item.alt);
      const target = item.failed ? item.url : item.path;
      return `![${alt}](<${markdownLinkTarget(target)}>)`;
    }).join('\n\n')}`);
  }

  // 如果有引用，加入引用區塊
  if (data.quoted && data.quoted.content) {
    const quotedLines = data.quoted.content.split('\n').map(line => '> ' + line).join('\n');
    const quotedAuthor = data.quoted.url
      ? `[@${data.quoted.author}](<${markdownLinkTarget(data.quoted.url)}>)`
      : `@${data.quoted.author}`;
    sections.push(`> [!quote] 引用貼文\n> ${quotedAuthor}\n>\n${quotedLines}`);
  }

  return `${frontmatter.join('\n')}\n\n${sections.join('\n\n---\n\n')}\n`;
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

  // 內容全是不合法檔名字元時摘要會變空字串，補上 fallback 避免產生「_.md」結尾的檔名
  return `${dateStr}_${hours}${minutes}_${summary || '貼文'}.md`;
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
  // JSON 字串也是合法的 YAML 雙引號字串，可避免日期、yes/no 等值被推斷成其他型別。
  return JSON.stringify(String(str ?? ''));
}

// 依 port 決定協定（27124 是 Local REST API 的 HTTPS 埠）
function apiBase(port) {
  const protocol = Number(port) === 27124 ? 'https' : 'http';
  return `${protocol}://127.0.0.1:${port}`;
}

async function saveVaultFile(content, filename, settings, contentType) {
  if (resolveStorageMode(settings) === 'native') {
    try {
      const binary = typeof content !== 'string';
      await sendNativeRequest({
        action: 'write',
        path: filename,
        encoding: binary ? 'base64' : 'utf8',
        data: binary ? arrayBufferToBase64(content) : content
      });
      return;
    } catch (error) {
      // 可否進離線佇列由 sendNativeRequest 的分類決定（Host 不可用才標 isStorageUnavailableError）
      error.isVaultWriteError = true;
      throw error;
    }
  }
  return saveFileToObsidian(content, filename, settings.apiKey, settings.port || 27123, contentType);
}

function arrayBufferToBase64(content) {
  const bytes = new Uint8Array(content);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(''));
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
