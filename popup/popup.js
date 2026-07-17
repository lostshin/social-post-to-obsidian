// DOM 元素
const apiKeyInput = document.getElementById('apiKey');
const portInput = document.getElementById('port');
const basePathInput = document.getElementById('basePath');
const testBtn = document.getElementById('testBtn');
const saveBtn = document.getElementById('saveBtn');
const statusDiv = document.getElementById('status');

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

// 事件綁定
saveBtn.addEventListener('click', saveSettings);
testBtn.addEventListener('click', testConnection);

// 初始化
loadSettings();
