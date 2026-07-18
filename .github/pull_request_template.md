## 變更內容

<!-- 說明問題、解法與受影響平台。 -->

## 驗證

- [ ] `node scripts/validate-extension.mjs`
- [ ] `node tests/media-sync.test.mjs`
- [ ] `./scripts/package-extension.sh`
- [ ] `git diff --check`
- [ ] 已完成與變更相稱的 Chrome／Obsidian 手動驗證

## 發布檢查

- [ ] 若程式行為改變，已依規則更新 `manifest.json.version`
- [ ] 沒有新增不必要的權限
- [ ] 若資料處理方式改變，已同步說明需要更新的隱私權政策與 Chrome Web Store 揭露
- [ ] 沒有包含 API Key、cookies、私人貼文或完整平台回應
