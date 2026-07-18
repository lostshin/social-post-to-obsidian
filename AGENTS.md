# AGENTS.md

本檔供 Codex 維護此專案，只補充 `CLAUDE.md` 尚未涵蓋的現況與圖片同步規則。開始工作前仍須完整讀取 `CLAUDE.md`；架構、MV3 重載、版本、一般除錯與驗證流程以該檔為準，不在此重述。

## Codex 最短工作路徑

1. 先執行 `git status --short`，保留使用者既有變更。
2. 用 `rg -n` 定位相關設定、message、storage 與測試；不要先通讀所有檔案。
3. 優先擴充既有 `tests/media-sync.test.mjs`，不要另做重複測試工具。
4. 最少執行：
   - `node scripts/validate-extension.mjs`
   - `node tests/media-sync.test.mjs`
   - `git diff --check`

## 目前狀態（2026-07-18）

- Manifest：`v1.7.0`；`CLAUDE.md` 括號中的 `v1.4.0` 是過時狀態，不是規則衝突。
- `v1.6.0`：X／Threads 圖片同步完成，使用者已確認 Obsidian 能顯示圖片。
- `v1.7.0`：圖片改存 Vault 根目錄的獨立附件路徑，Popup 可自訂。
- 預設圖片路徑：`附件/Social Post to Obsidian`。
- 目前功能 HEAD：`f35a8a5`；remote 尚未更新。
- README 與 repository preview 仍描述舊 `_assets` 路徑／`v1.6.0` 畫面；除非使用者要求，不要順手修改。

## 圖片資料流與不可退回的決策

```text
platform response
  → content/common.js 解析 media: [{ url, alt }]
  → content/twitter.js 或 content/threads.js 併入 publish data
  → background.js 下載圖片
  → PUT binary 至 Vault 圖片路徑
  → 最後 PUT Markdown
```

- X 只取 `extended_entities.media`／`entities.media` 中的 `type: photo`。
- Threads 單圖與輪播取 `image_versions2.candidates` 最大尺寸；有 `video_versions` 的項目跳過。
- 目前不下載影片或動態 GIF；不要把影片封面偽裝成原圖。
- 每則貼文最多同步 20 張；binary writer 接受 JPEG、PNG、GIF、WebP、AVIF，但 parser 仍跳過動態 GIF。
- 圖片必須先寫入、Markdown 最後寫入；重試覆寫相同路徑，保持 idempotent。
- 圖片實體路徑：`<mediaPath>/<note-stem>/image-NN.ext`。
- Markdown 使用 `relativeVaultPath(noteDirectory, vaultPath)` 產生跨資料夾相對連結；不得硬編碼 `../../`。
- 新貼文不得再建立 `_assets`。既有 `_assets` 不搬移、不刪除，否則舊筆記會斷圖。

## 失敗與離線規則

- 單張遠端圖片下載失敗：仍儲存筆記，該張改用遠端 URL，成功訊息顯示未同步數量。
- Obsidian PUT 失敗：必須向上拋出，不可誤當成可忽略的圖片下載錯誤。
- 只有標記為 `isObsidianConnectionError` 的錯誤才進離線佇列；遠端 CDN `TypeError` 不得觸發整篇排隊。
- 新佇列項目存原始 `data` 與 media URLs，不存 `ArrayBuffer`／Blob；重試時重新下載圖片。
- 保留 v1.5 舊佇列中 `item.markdown` 的向後相容分支。
- Threads 簽章圖片 URL 離線太久可能失效；此時接受遠端 fallback，不阻止文字筆記落盤。

## 設定同步檢查表

圖片路徑 storage key 為 `mediaPath`。修改名稱、預設值或行為時，必須同步檢查：

- `popup/popup.html`：欄位預設值。
- `popup/popup.js`：DOM reference、`loadSettings()`、`saveSettings()`。
- `background.js`：`DEFAULT_MEDIA_PATH`、`handlePublishDraft()`、`handleSavePost()`、`retryOfflineQueue()`。
- `tests/media-sync.test.mjs`：binary PUT 目標、Markdown 相對連結、離線補存目標。

不要只更新 Popup；若 background 的 `chrome.storage.local.get()` 漏讀 `mediaPath`，畫面看似已儲存，實際仍會使用預設路徑。

## 圖片問題最短診斷

1. API parser 結果是否含 `media`，且純圖片貼文沒有被空文字 guard 丟棄。
2. Manifest 是否仍有 `pbs.twimg.com`、`*.cdninstagram.com`、`*.fbcdn.net` host permissions。
3. 第一個 Vault PUT 是否為正確 `image/*` Content-Type 與 `<mediaPath>/<note-stem>/image-NN.ext`。
4. Markdown 是否在圖片 PUT 後寫入，並包含可從筆記位置解析的相對連結。
5. 若只剩遠端 URL，先判斷 CDN 下載錯誤；若整篇進 queue，再判斷 Obsidian connection error marker。

## 驗收重點

- 自動測試必須同時涵蓋 X 多圖、Threads 輪播／純圖片、影片跳過、binary PUT、遠端 fallback 與離線補存。
- Popup 變更用隔離 Chrome profile 實跑，確認預設值、自訂值能寫入 storage、console 無新 error；不要碰使用者日常 Chrome profile。
- 真實驗收時確認兩個實體：筆記仍在 `basePath`，圖片位於 `mediaPath`，且 Obsidian 預覽正常顯示。
