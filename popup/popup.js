// DOM 元素
const apiKeyInput = document.getElementById('apiKey');
const portInput = document.getElementById('port');
const basePathInput = document.getElementById('basePath');
const testBtn = document.getElementById('testBtn');
const saveBtn = document.getElementById('saveBtn');
const statusDiv = document.getElementById('status');
const connDot = document.getElementById('connDot');
const connText = document.getElementById('connText');
const queueInfo = document.getElementById('queueInfo');
const recentSection = document.getElementById('recentSection');
const recentList = document.getElementById('recentList');

// 載入已儲存的設定
async function loadSettings() {
  const settings = await chrome.storage.local.get(['apiKey', 'port', 'basePath']);

  if (settings.apiKey) {
    apiKeyInput.value = settings.apiKey;
  }
  if (settings.port) {
    portInput.value = settings.port;
  }
  if (settings.basePath) {
    basePathInput.value = settings.basePath;
  }
}

// 儲存設定
async function saveSettings() {
  const apiKey = apiKeyInput.value.trim();
  const port = parseInt(portInput.value) || 27123;
  const basePath = basePathInput.value.trim() || '個人創作/社群推文';

  if (!apiKey) {
    showStatus('請輸入 API Key', 'error');
    return;
  }

  await chrome.storage.local.set({ apiKey, port, basePath });
  showStatus('設定已儲存', 'success');
}

// 測試連線
async function testConnection() {
  const apiKey = apiKeyInput.value.trim();
  const port = parseInt(portInput.value) || 27123;

  if (!apiKey) {
    showStatus('請先輸入 API Key', 'error');
    return;
  }

  testBtn.disabled = true;
  testBtn.textContent = '測試中...';
  showStatus('正在連線...', 'info');

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
      showStatus(`連線成功！Vault: ${data.service || 'Obsidian'}`, 'success');
    } else if (response.status === 401) {
      showStatus('API Key 無效', 'error');
    } else {
      showStatus(`連線失敗: HTTP ${response.status}`, 'error');
    }
  } catch (error) {
    if (error.message.includes('Failed to fetch')) {
      showStatus('無法連線，請確認 Obsidian 已開啟且 Local REST API 插件已啟用', 'error');
    } else {
      showStatus(`錯誤: ${error.message}`, 'error');
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
  const settings = await chrome.storage.local.get(['apiKey', 'port']);

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
  const { offlineQueue = [] } = await chrome.storage.local.get('offlineQueue');
  if (offlineQueue.length > 0) {
    queueInfo.hidden = false;
    queueInfo.textContent = `待補存 ${offlineQueue.length} 則（Obsidian 連線後自動補存）`;
  }
}

// 顯示最近儲存清單，點擊可在 Obsidian 開啟
async function renderRecent() {
  const { recentSaves = [] } = await chrome.storage.local.get('recentSaves');
  if (recentSaves.length === 0) return;

  recentSection.hidden = false;
  recentList.textContent = '';

  for (const item of recentSaves) {
    const li = document.createElement('li');

    const link = document.createElement('a');
    link.href = '#';
    link.textContent = item.filename;
    link.title = '在 Obsidian 中開啟';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'obsidian://open?file=' + encodeURIComponent(item.path) });
    });

    const meta = document.createElement('small');
    const platformName = item.platform === 'x' ? 'Twitter/X' : 'Threads';
    const time = new Date(item.savedAt);
    const timeStr = `${String(time.getMonth() + 1).padStart(2, '0')}/${String(time.getDate()).padStart(2, '0')} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
    meta.textContent = `${platformName} · ${timeStr}`;

    li.appendChild(link);
    li.appendChild(meta);
    recentList.appendChild(li);
  }
}

// 事件綁定
saveBtn.addEventListener('click', saveSettings);
testBtn.addEventListener('click', testConnection);

// 初始化
loadSettings();
checkConnection();
renderQueueInfo();
renderRecent();
