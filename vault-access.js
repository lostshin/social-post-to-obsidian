// Direct Vault access shared by the popup and extension service worker.
(function (global) {
  const DB_NAME = 'social-post-to-obsidian';
  const STORE_NAME = 'file-handles';
  const VAULT_KEY = 'vault-root';

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getVaultHandle() {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(VAULT_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }

  async function storeVaultHandle(handle) {
    const database = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(handle, VAULT_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  async function selectVault() {
    if (typeof global.showDirectoryPicker !== 'function') {
      throw new Error('此瀏覽器不支援直接存取 Vault');
    }
    const handle = await global.showDirectoryPicker({ id: 'sp2o-vault', mode: 'readwrite' });
    await storeVaultHandle(handle);
    return handle;
  }

  async function getPermissionStatus() {
    const handle = await getVaultHandle();
    if (!handle) return { status: 'missing', name: '' };
    const status = await handle.queryPermission({ mode: 'readwrite' });
    return { status, name: handle.name };
  }

  async function requestPermission() {
    const handle = await getVaultHandle();
    if (!handle) return { status: 'missing', name: '' };
    let status = await handle.queryPermission({ mode: 'readwrite' });
    if (status !== 'granted') {
      status = await handle.requestPermission({ mode: 'readwrite' });
    }
    return { status, name: handle.name };
  }

  function pathParts(path) {
    const parts = String(path || '').split('/').filter(Boolean);
    if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) {
      throw new Error('Vault 路徑無效');
    }
    return parts;
  }

  async function requireWritableHandle() {
    const handle = await getVaultHandle();
    if (!handle) throw new Error('尚未選擇 Vault');
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('Vault 需要重新授權');
    return handle;
  }

  async function writeFileWithHandle(root, path, content) {
    const parts = pathParts(path);
    const filename = parts.pop();
    let directory = root;
    for (const part of parts) {
      directory = await directory.getDirectoryHandle(part, { create: true });
    }
    const file = await directory.getFileHandle(filename, { create: true });
    const writable = await file.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async function writeFile(path, content) {
    const root = await requireWritableHandle();
    await writeFileWithHandle(root, path, content);
  }

  async function removeFileWithHandle(root, path) {
    const parts = pathParts(path);
    const filename = parts.pop();
    let directory = root;
    try {
      for (const part of parts) {
        directory = await directory.getDirectoryHandle(part);
      }
      await directory.removeEntry(filename);
    } catch (error) {
      if (error.name !== 'NotFoundError') throw error;
    }
  }

  async function removeFile(path) {
    const root = await requireWritableHandle();
    await removeFileWithHandle(root, path);
  }

  global.SP2OVaultAccess = {
    getPermissionStatus,
    removeFile,
    removeFileWithHandle,
    requestPermission,
    selectVault,
    writeFile,
    writeFileWithHandle
  };
})(globalThis);
