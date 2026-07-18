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
const draftSection = document.getElementById('draftSection');
const draftList = document.getElementById('draftList');
const recentList = document.getElementById('recentList');

function readPort() {
  const enteredPort = Number.parseInt(portInput.value, 10);
  return Number.isInteger(enteredPort) ? enteredPort : 27123;
}

function resolveStorageMode(settings) {
  return settings.storageMode || (settings.apiKey ? 'rest' : 'direct');
}

function updateModeUI() {
  const direct = storageModeSelect.value === 'direct';
  directSettings.hidden = !direct;
  restSettings.hidden = direct;
  testBtn.textContent = direct ? '檢查權限' : '測試連線';
}

async function startVaultSession() {
  const response = await chrome.runtime.sendMessage({ type: 'START_VAULT_SESSION' });
  if (!response?.ok) throw new Error(response?.error || '無法啟動 Vault 背景工作階段');
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

  if (storageModeSelect.value === 'direct') {
    try {
      const permission = await SP2OVaultAccess.getPermissionStatus();
      if (permission.name) vaultName.textContent = permission.name;
      settingsPanel.open = permission.status !== 'granted';
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
  const basePath = basePathInput.value.trim() || '個人創作/社群推文';
  const mediaPath = mediaPathInput.value.trim() || '附件/Social Post to Obsidian';

  if (storageMode === 'direct') {
    let permission;
    try {
      permission = await SP2OVaultAccess.getPermissionStatus();
    } catch (error) {
      showStatus(`無法讀取 Vault 權限 · ${error.message}`, 'error');
      return;
    }
    if (permission.status !== 'granted') {
      showStatus(permission.status === 'missing' ? '請先選擇 Vault' : '請先重新授權 Vault', 'error');
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
    const handle = await SP2OVaultAccess.selectVault();
    storageModeSelect.value = 'direct';
    updateModeUI();
    vaultName.textContent = handle.name;
    await chrome.storage.local.set({ storageMode: 'direct', vaultName: handle.name });
    await startVaultSession();
    showStatus(`已授權 Vault：${handle.name}`, 'success');
    await checkConnection();
    chrome.runtime.sendMessage({ type: 'RETRY_QUEUE' });
  } catch (error) {
    if (error.name !== 'AbortError') showStatus(`無法選擇 Vault · ${error.message}`, 'error');
  } finally {
    chooseVaultBtn.disabled = false;
  }
}

// 測試連線
async function testConnection() {
  if (storageModeSelect.value === 'direct') {
    testBtn.disabled = true;
    testBtn.textContent = '檢查中…';
    try {
      const permission = await SP2OVaultAccess.requestPermission();
      if (permission.name) vaultName.textContent = permission.name;
      if (permission.status === 'granted') {
        await startVaultSession();
        showStatus(`Vault 權限正常 · ${permission.name}`, 'success');
        chrome.runtime.sendMessage({ type: 'RETRY_QUEUE' });
      } else {
        showStatus(permission.status === 'missing' ? '請先選擇 Vault' : 'Vault 尚未授權', 'error');
      }
      await checkConnection();
    } catch (error) {
      showStatus(`權限檢查失敗 · ${error.message}`, 'error');
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
    // 27124 是 Local REST API 的 HTTPS 埠
    const protocol = port === 27124 ? 'https' : 'http';
    const response = await fetch(`${protocol}://127.0.0.1:${port}/`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

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

// 開啟 popup 時自動檢查連線狀態
async function checkConnection() {
  const settings = await chrome.storage.local.get(['storageMode', 'apiKey', 'port', 'vaultName']);

  if (resolveStorageMode(settings) === 'direct') {
    try {
      const permission = await SP2OVaultAccess.getPermissionStatus();
      if (permission.name) vaultName.textContent = permission.name;
      if (permission.status === 'granted') {
        await startVaultSession();
        connDot.className = 'dot ok';
        connText.textContent = `Vault 背景連線中 · ${permission.name}`;
      } else {
        connDot.className = 'dot fail';
        connText.textContent = permission.status === 'missing' ? '尚未選擇 Vault' : 'Vault 需要重新授權';
      }
    } catch {
      connDot.className = 'dot fail';
      connText.textContent = '無法讀取 Vault 權限';
    }
    return;
  }

  if (!settings.apiKey) {
    connDot.className = 'dot fail';
    connText.textContent = '尚未設定 API Key';
    return;
  }

  const port = settings.port || 27123;
  const protocol = port === 27124 ? 'https' : 'http';

  try {
    const response = await fetch(`${protocol}://127.0.0.1:${port}/`, {
      headers: { 'Authorization': `Bearer ${settings.apiKey}` }
    });
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
    const direct = resolveStorageMode(stored) === 'direct';
    queueInfo.textContent = `待補存 ${offlineQueue.length} 則（${direct ? 'Vault 重新授權' : 'Obsidian 連線'}後自動補存）`;
  }
}

// 格式化時間 (MM/DD HH:mm)
function formatTime(iso) {
  const t = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(t.getMonth() + 1)}/${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

// 建立一列清單項目：可點開 Obsidian 的檔名 + 說明文字
function buildListItem(filename, path, metaText) {
  const li = document.createElement('li');

  const link = document.createElement('a');
  link.href = '#';
  link.textContent = filename;
  link.title = '在 Obsidian 中開啟';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'obsidian://open?file=' + encodeURIComponent(path) });
  });

  const meta = document.createElement('small');
  meta.textContent = metaText;

  li.appendChild(link);
  li.appendChild(meta);
  return li;
}

function buildEmptyState(message) {
  const li = document.createElement('li');
  li.className = 'empty-state';
  li.textContent = message;
  return li;
}

// 顯示未發佈草稿（打字中自動暫存的內容）
async function renderDrafts() {
  const stored = await chrome.storage.local.get(['draftStatus_x', 'draftStatus_threads']);
  const drafts = [
    ['Twitter/X', stored.draftStatus_x],
    ['Threads', stored.draftStatus_threads]
  ].filter(([, d]) => d);

  draftSection.hidden = drafts.length === 0;
  draftList.textContent = '';

  for (const [platformName, d] of drafts) {
    draftList.appendChild(buildListItem(d.filename, d.path, `${platformName} · 最後暫存 ${formatTime(d.savedAt)}`));
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
    const platformName = item.platform === 'x' ? 'Twitter/X' : 'Threads';
    recentList.appendChild(buildListItem(item.filename, item.path, `${platformName} · ${formatTime(item.savedAt)}`));
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

// popup 開著的時候，儲存狀態變動即時反映
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  renderDrafts();
  renderRecent();
  renderQueueInfo();
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
storageModeSelect.addEventListener('change', updateModeUI);

// 初始化
async function initialize() {
  document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;
  await loadSettings();
  await checkConnection();
  await Promise.all([renderQueueInfo(), renderDrafts(), renderRecent()]);
}

initialize();
