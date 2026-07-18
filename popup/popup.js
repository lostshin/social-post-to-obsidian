// DOM 元素
const apiKeyInput = document.getElementById('apiKey');
const portInput = document.getElementById('port');
const basePathInput = document.getElementById('basePath');
const mediaPathInput = document.getElementById('mediaPath');
const storageModeSelect = document.getElementById('storageMode');
const directSettings = document.getElementById('directSettings');
const restSettings = document.getElementById('restSettings');
const chooseVaultBtn = document.getElementById('chooseVaultBtn');
const vaultName = document.getElementById('vaultName');
const settingsPanel = document.getElementById('settingsPanel');
const settingsForm = document.getElementById('settingsForm');
const toggleApiKey = document.getElementById('toggleApiKey');
const testBtn = document.getElementById('testBtn');
const statusDiv = document.getElementById('status');
const connDot = document.getElementById('connDot');
const connText = document.getElementById('connText');
const queueInfo = document.getElementById('queueInfo');
const actionStatus = document.getElementById('actionStatus');
const draftSection = document.getElementById('draftSection');
const draftList = document.getElementById('draftList');
const clearDraftsBtn = document.getElementById('clearDraftsBtn');
const recentList = document.getElementById('recentList');
const previewPopover = document.getElementById('previewPopover');
const previewText = document.getElementById('previewText');
let actionStatusTimer;
let activePreviewAnchor;

function readPort() {
  const enteredPort = Number.parseInt(portInput.value, 10);
  return Number.isInteger(enteredPort) ? enteredPort : 27123;
}

// 依 port 決定協定（27124 是 Local REST API 的 HTTPS 埠）
function apiBase(port) {
  const protocol = Number(port) === 27124 ? 'https' : 'http';
  return `${protocol}://127.0.0.1:${port}`;
}

// REST 連線探測：「測試連線」按鈕與常駐燈號共用同一份，避免兩處判斷 drift
async function pingRestApi(port, apiKey) {
  return fetch(`${apiBase(port)}/`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
}

function updateModeUI() {
  const native = storageModeSelect.value === 'native';
  directSettings.hidden = !native;
  restSettings.hidden = native;
  testBtn.textContent = native ? '檢查 Helper' : '測試連線';
}

async function getNativeStatus() {
  return chrome.runtime.sendMessage({ type: 'GET_NATIVE_STATUS' });
}

// 載入已儲存的設定
async function loadSettings() {
  const settings = await chrome.storage.local.get(['storageMode', 'apiKey', 'port', 'basePath', 'mediaPath', 'vaultName']);
  storageModeSelect.value = resolveStorageMode(settings);
  updateModeUI();

  if (settings.apiKey) {
    apiKeyInput.value = settings.apiKey;
  }
  if (settings.port) {
    portInput.value = settings.port;
  }
  if (settings.basePath) {
    basePathInput.value = settings.basePath;
  }
  if (settings.mediaPath) {
    mediaPathInput.value = settings.mediaPath;
  }

  if (settings.vaultName) vaultName.textContent = settings.vaultName;

  if (storageModeSelect.value === 'native') {
    try {
      const status = await getNativeStatus();
      if (status?.vaultName) vaultName.textContent = status.vaultName;
      settingsPanel.open = !status?.ok || !status?.configured;
    } catch {
      settingsPanel.open = true;
    }
  } else {
    settingsPanel.open = !settings.apiKey;
  }
}

// 儲存設定
async function saveSettings() {
  const storageMode = storageModeSelect.value;
  const apiKey = apiKeyInput.value.trim();
  const port = readPort();
  const basePath = basePathInput.value.trim() || DEFAULT_BASE_PATH;
  const mediaPath = mediaPathInput.value.trim() || DEFAULT_MEDIA_PATH;

  if (storageMode === 'native') {
    let nativeStatus;
    try {
      nativeStatus = await getNativeStatus();
    } catch (error) {
      showStatus(`無法連線本機 Helper · ${error.message}`, 'error');
      return;
    }
    if (!nativeStatus?.ok || !nativeStatus?.configured) {
      showStatus(nativeStatus?.error ? `本機 Helper 無法使用 · ${nativeStatus.error}` : '請先安裝 Helper 並選擇 Vault', 'error');
      return;
    }
  } else {
    if (!apiKey) {
      showStatus('請輸入 API Key', 'error');
      return;
    }
    if (port < 1 || port > 65535) {
      showStatus('Port 必須介於 1 到 65535', 'error');
      portInput.focus();
      return;
    }
  }

  await chrome.storage.local.set({ storageMode, apiKey, port, basePath, mediaPath });
  showStatus('設定已儲存', 'success');
  await checkConnection();
}

async function chooseVault() {
  chooseVaultBtn.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CHOOSE_NATIVE_VAULT' });
    if (!response?.ok) throw new Error(response?.error || '本機 Helper 無法選擇 Vault');
    storageModeSelect.value = 'native';
    updateModeUI();
    vaultName.textContent = response.vaultName;
    showStatus(`已連接 Vault：${response.vaultName}`, 'success');
    await checkConnection();
    chrome.runtime.sendMessage({ type: 'RETRY_QUEUE' });
  } catch (error) {
    showStatus(`無法選擇 Vault · ${error.message}`, 'error');
  } finally {
    chooseVaultBtn.disabled = false;
  }
}

// 測試連線
async function testConnection() {
  if (storageModeSelect.value === 'native') {
    testBtn.disabled = true;
    testBtn.textContent = '檢查中…';
    try {
      const nativeStatus = await getNativeStatus();
      if (nativeStatus?.vaultName) vaultName.textContent = nativeStatus.vaultName;
      if (nativeStatus?.ok && nativeStatus?.configured) {
        showStatus(`本機 Helper 已連線 · ${nativeStatus.vaultName}`, 'success');
        chrome.runtime.sendMessage({ type: 'RETRY_QUEUE' });
      } else {
        showStatus(nativeStatus?.error ? `本機 Helper 無法使用 · ${nativeStatus.error}` : '請先安裝 Helper 並選擇 Vault', 'error');
      }
      await checkConnection();
    } catch (error) {
      showStatus(`Helper 檢查失敗 · ${error.message}`, 'error');
    } finally {
      testBtn.disabled = false;
      updateModeUI();
    }
    return;
  }

  const apiKey = apiKeyInput.value.trim();
  const port = readPort();

  if (port < 1 || port > 65535) {
    showStatus('Port 必須介於 1 到 65535', 'error');
    portInput.focus();
    return;
  }

  if (!apiKey) {
    showStatus('請先輸入 API Key', 'error');
    return;
  }

  testBtn.disabled = true;
  testBtn.textContent = '測試中…';
  showStatus('正在連線…', 'info');

  try {
    const response = await pingRestApi(port, apiKey);

    if (response.ok) {
      const data = await response.json();
      showStatus(`連線成功 · ${data.service || 'Obsidian'}`, 'success');
    } else if (response.status === 401) {
      showStatus('API Key 無效', 'error');
    } else {
      showStatus(`連線失敗 · HTTP ${response.status}`, 'error');
    }
  } catch (error) {
    if (error.message.includes('Failed to fetch')) {
      showStatus('無法連線，請確認 Obsidian 已開啟且 Local REST API 插件已啟用', 'error');
    } else {
      showStatus(`連線錯誤 · ${error.message}`, 'error');
    }
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = '測試連線';
  }
}

// 顯示狀態訊息
function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
}

function showActionStatus(message, type) {
  clearTimeout(actionStatusTimer);
  actionStatus.textContent = message;
  actionStatus.className = `status global-status ${type}`;
  actionStatusTimer = setTimeout(() => {
    actionStatus.className = 'status global-status';
  }, 3500);
}

// 開啟 popup 時自動檢查連線狀態
async function checkConnection() {
  const settings = await chrome.storage.local.get(['storageMode', 'apiKey', 'port', 'vaultName']);

  if (resolveStorageMode(settings) === 'native') {
    try {
      const nativeStatus = await getNativeStatus();
      if (nativeStatus?.vaultName) vaultName.textContent = nativeStatus.vaultName;
      if (nativeStatus?.ok && nativeStatus?.configured) {
        connDot.className = 'dot ok';
        connText.textContent = `本機 Helper 已連線 · ${nativeStatus.vaultName}`;
      } else {
        connDot.className = 'dot fail';
        connText.textContent = nativeStatus?.error ? '本機 Helper 無法使用' : '尚未選擇 Vault';
      }
    } catch {
      connDot.className = 'dot fail';
      connText.textContent = '本機 Helper 尚未安裝';
    }
    return;
  }

  if (!settings.apiKey) {
    connDot.className = 'dot fail';
    connText.textContent = '尚未設定 API Key';
    return;
  }

  try {
    const response = await pingRestApi(settings.port || 27123, settings.apiKey);
    if (response.ok) {
      connDot.className = 'dot ok';
      connText.textContent = 'Obsidian 已連線';
    } else {
      connDot.className = 'dot fail';
      connText.textContent = response.status === 401 ? 'API Key 無效' : `連線異常 (HTTP ${response.status})`;
    }
  } catch {
    connDot.className = 'dot fail';
    connText.textContent = 'Obsidian 未連線';
  }
}

// 顯示待補存佇列數量
async function renderQueueInfo() {
  const stored = await chrome.storage.local.get(['offlineQueue', 'storageMode', 'apiKey']);
  const offlineQueue = stored.offlineQueue || [];
  queueInfo.hidden = offlineQueue.length === 0;
  if (offlineQueue.length > 0) {
    const native = resolveStorageMode(stored) === 'native';
    queueInfo.textContent = `待補存 ${offlineQueue.length} 則（${native ? '本機 Helper 恢復' : 'Obsidian 連線'}後自動補存）`;
  }
}

// 格式化時間 (MM/DD HH:mm)
function formatTime(iso) {
  const t = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(t.getMonth() + 1)}/${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

function fallbackPreview(filename) {
  return filename
    .replace(/^\d{4}-\d{2}-\d{2}_\d{4}_/, '')
    .replace(/^_草稿_/, '')
    .replace(/\.md$/i, '')
    .replace(/_/g, ' ')
    .trim() || '目前沒有可顯示的文字內容';
}

function showPreview(anchor, text) {
  activePreviewAnchor?.removeAttribute('aria-describedby');
  activePreviewAnchor = anchor;
  previewText.textContent = text;
  previewPopover.hidden = false;
  anchor.setAttribute('aria-describedby', 'previewPopover');

  const itemRect = anchor.closest('li').getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 24);
  previewPopover.style.width = `${width}px`;
  const left = Math.max(12, Math.min(itemRect.left, window.innerWidth - width - 12));
  const popoverHeight = previewPopover.offsetHeight;
  const below = itemRect.bottom + 7;
  const top = below + popoverHeight <= window.innerHeight - 12
    ? below
    : Math.max(12, itemRect.top - popoverHeight - 7);
  previewPopover.style.left = `${left}px`;
  previewPopover.style.top = `${top}px`;
}

function hidePreview(anchor) {
  previewPopover.hidden = true;
  const target = anchor || activePreviewAnchor;
  target?.removeAttribute('aria-describedby');
  if (!anchor || anchor === activePreviewAnchor) activePreviewAnchor = null;
}

// 建立一列清單項目：箭頭開啟 Obsidian，hover/focus 顯示內容摘要
function buildListItem(filename, path, metaText, preview, kind) {
  const li = document.createElement('li');

  const link = document.createElement('a');
  link.className = 'activity-open-link';
  link.href = '#';
  link.setAttribute('aria-label', `在 Obsidian 中開啟 ${filename}`);

  const copy = document.createElement('span');
  copy.className = 'activity-copy';

  const name = document.createElement('span');
  name.className = 'activity-filename';
  name.textContent = filename;

  const meta = document.createElement('small');
  meta.textContent = metaText;

  const openIcon = document.createElement('span');
  openIcon.className = 'activity-open-icon';
  openIcon.setAttribute('aria-hidden', 'true');
  openIcon.textContent = '↗';

  copy.append(name, meta);
  link.append(copy, openIcon);
  link.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'obsidian://open?file=' + encodeURIComponent(path) });
  });
  const previewContent = preview || fallbackPreview(filename);
  li.addEventListener('mouseenter', () => showPreview(link, previewContent));
  li.addEventListener('mouseleave', () => hidePreview(link));
  link.addEventListener('focus', () => showPreview(link, previewContent));
  link.addEventListener('blur', () => hidePreview(link));
  li.appendChild(link);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'activity-delete-btn';
  deleteButton.textContent = '刪';
  deleteButton.setAttribute('aria-label', `刪除 ${filename}`);
  deleteButton.addEventListener('click', () => deleteActivityItem(deleteButton, kind, filename, path));
  li.appendChild(deleteButton);
  return li;
}

function buildEmptyState(message) {
  const li = document.createElement('li');
  li.className = 'empty-state';
  li.textContent = message;
  return li;
}

async function deleteActivityItem(button, kind, filename, path) {
  if (kind === 'recent' && !window.confirm(
    `確定要從 Obsidian 刪除「${filename}」？\n\n社群平台上的原貼文不會被刪除。`
  )) return;

  button.disabled = true;
  hidePreview();
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'DELETE_VAULT_ACTIVITY',
      kind,
      path
    });
    if (!response?.ok) {
      showActionStatus(response?.error || 'Vault 貼文刪除失敗', 'error');
      return;
    }
    showActionStatus(`已從 Obsidian 刪除 · ${filename}`, 'success');
    await Promise.all([renderDrafts(), renderRecent()]);
  } catch (error) {
    showActionStatus(`Vault 貼文刪除失敗 · ${error.message}`, 'error');
  } finally {
    button.disabled = false;
  }
}

// 顯示未發佈草稿（打字中自動暫存的內容）
async function renderDrafts() {
  const stored = await chrome.storage.local.get(['draftStatus_x', 'draftStatus_threads']);
  const drafts = [
    [platformDisplayName('x'), stored.draftStatus_x],
    [platformDisplayName('threads'), stored.draftStatus_threads]
  ].filter(([, d]) => d);

  draftSection.hidden = drafts.length === 0;
  draftList.textContent = '';

  for (const [platformName, d] of drafts) {
    draftList.appendChild(buildListItem(
      d.filename,
      d.path,
      `${platformName} · 最後暫存 ${formatTime(d.savedAt)}`,
      d.preview,
      'draft'
    ));
  }
}

async function clearAutoDrafts() {
  clearDraftsBtn.disabled = true;
  clearDraftsBtn.textContent = '清除中…';
  hidePreview();
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CLEAR_AUTO_DRAFTS' });
    if (!response?.ok) {
      const partial = response?.cleared > 0 ? `已清除 ${response.cleared} 則；` : '';
      showActionStatus(`${partial}${response?.error || '草稿清除失敗'}`, 'error');
      return;
    }
    showActionStatus(response.cleared > 0 ? `已清除 ${response.cleared} 則自動暫存` : '目前沒有自動暫存', 'success');
    await renderDrafts();
  } catch (error) {
    showActionStatus(`草稿清除失敗 · ${error.message}`, 'error');
  } finally {
    clearDraftsBtn.disabled = false;
    clearDraftsBtn.textContent = '清除全部';
  }
}

async function syncVaultActivity() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'SYNC_VAULT_ACTIVITY' });
    if (!response?.ok) {
      showActionStatus(`Vault 狀態同步失敗 · ${response?.error || '背景程序沒有回應'}`, 'error');
      return;
    }
    const removed = (response.removedDrafts || 0) + (response.removedRecent || 0);
    if (removed > 0) {
      showActionStatus(`已同步 Obsidian 的刪除狀態 · ${removed} 則`, 'success');
    }
  } catch (error) {
    showActionStatus(`Vault 狀態同步失敗 · ${error.message}`, 'error');
  }
}

// 顯示最近儲存清單（已發佈的貼文），點擊可在 Obsidian 開啟
async function renderRecent() {
  const { recentSaves = [] } = await chrome.storage.local.get('recentSaves');
  recentList.textContent = '';

  if (recentSaves.length === 0) {
    recentList.appendChild(buildEmptyState('發佈貼文後，最近的存檔會顯示在這裡'));
    return;
  }

  for (const item of recentSaves) {
    const platformName = platformDisplayName(item.platform);
    recentList.appendChild(buildListItem(
      item.filename,
      item.path,
      `${platformName} · ${formatTime(item.savedAt)}`,
      item.preview,
      'recent'
    ));
  }
}

function toggleApiKeyVisibility() {
  const isVisible = apiKeyInput.type === 'text';
  apiKeyInput.type = isVisible ? 'password' : 'text';
  toggleApiKey.textContent = isVisible ? '顯示' : '隱藏';
  toggleApiKey.setAttribute('aria-label', isVisible ? '顯示 API Key' : '隱藏 API Key');
  toggleApiKey.setAttribute('aria-pressed', String(!isVisible));
  apiKeyInput.focus();
}

// popup 開著的時候，儲存狀態變動即時反映；只重繪實際變動的區塊
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const draftsChanged = changes.draftStatus_x || changes.draftStatus_threads;
  if (draftsChanged || changes.recentSaves) {
    // 重繪會移除 hover 中的清單項目，先收掉預覽避免留下過期的孤兒 popover
    hidePreview();
  }
  if (draftsChanged) renderDrafts();
  if (changes.recentSaves) renderRecent();
  if (changes.offlineQueue) renderQueueInfo();
  if (changes.storageMode || changes.vaultName) checkConnection();
});

// 事件綁定
settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  saveSettings();
});
testBtn.addEventListener('click', testConnection);
toggleApiKey.addEventListener('click', toggleApiKeyVisibility);
chooseVaultBtn.addEventListener('click', chooseVault);
clearDraftsBtn.addEventListener('click', clearAutoDrafts);
storageModeSelect.addEventListener('change', updateModeUI);
document.addEventListener('scroll', () => hidePreview(), true);
window.addEventListener('focus', async () => {
  await syncVaultActivity();
  await Promise.all([renderDrafts(), renderRecent()]);
});

// 初始化
async function initialize() {
  document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;
  await loadSettings();
  await checkConnection();
  await syncVaultActivity();
  await Promise.all([renderQueueInfo(), renderDrafts(), renderRecent()]);
}

initialize();
