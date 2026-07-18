# AGENTS.md

本檔只記錄 Codex 維護時需要、但 `CLAUDE.md` 尚未涵蓋的現況與專用規則。開始工作前仍須完整讀取 `CLAUDE.md`；其中的 MV3、版本、一般除錯與修改紀律不在此重述。若現況文字與程式不一致，以 `manifest.json`、目前程式與測試為準。

## Codex 最短工作路徑

1. 先執行 `git status --short`，保留使用者既有變更。
2. 用 `rg -n` 定位相關設定、message、storage 與測試，不先通讀整個專案。
3. 優先擴充 `tests/media-sync.test.mjs`，不要另建重複測試工具。
4. 程式變更至少執行：
   - `node scripts/validate-extension.mjs`
   - `node tests/media-sync.test.mjs`
   - `git diff --check`
5. 修改 `native/host.rb` 時再執行 `ruby -c native/host.rb`、`./native/install-host.sh`，並比對安裝檔與原始碼；只重載 extension，不移除重裝。
6. 不操作使用者日常 Chrome profile 或真實貼文做測試；用隔離資料驗證後交由使用者人工驗收，除非使用者另行授權。

## 現況基線（2026-07-19）

- Manifest `v2.2.0`；Native Helper `v1.1.2`。
- 預設為 Native Helper 模式，不需要 Obsidian Local REST API Key；REST 模式只保留為相容選項。舊 `storageMode: direct` 會遷移成 `native`。
- `CLAUDE.md` 中「Local REST API 為唯一資料流」與 `v1.4.0` 是過時現況，不代表要把程式改回去。
- `v1.6.0–v1.7.0`：X／Threads 圖片同步、Vault 根目錄獨立附件路徑與 Popup 自訂路徑已完成。
- `v2.0.0`：Native Helper 成為預設寫入方式；Vault 連線不再綁定社群分頁／視窗生命週期，關閉後不必重新授權。
- `v2.1.0`：Popup 可清除自動草稿、預覽／開啟筆記、刪除貼文及同步 Vault 刪除狀態。
- `v2.1.2`：iCloud Vault 刪除修復；使用者已確認從「最近儲存」刪除後，Obsidian 筆記與 Popup 項目都會消失。
- `v2.2.0`：補齊公開安裝／隱私入口、GitHub Release 雙 ZIP 與 Chrome Web Store 上架資料；未改動貼文同步核心。
- 預設筆記路徑：`個人創作/社群推文`；預設圖片路徑：`附件/Social Post to Obsidian`。
- `origin/main` 尚未包含上述 Native／Popup 功能；除非獲得明確指示，否則不要 push。

## Native Helper 資料流與限制

```text
background.js
  → chrome.runtime.sendNativeMessage
  → native/host.rb
  → Vault 實體檔案
```

- Host name：`com.lostshin.social_post_to_obsidian`。
- 設定：`~/Library/Application Support/Social Post to Obsidian/config.json`。
- 安裝檔：`~/Library/Application Support/Social Post to Obsidian/host.rb`。
- Native Messaging stdout 只能輸出「4-byte little-endian 長度 + JSON」；所有子程序輸出必須捕捉，診斷資訊不得污染 stdout，否則 Chrome 只會顯示 `Native host has exited.`。
- `sendNativeMessage()` 每次啟動一個 Host 程序；不要依賴跨 request 的記憶體狀態。
- Vault 路徑必須保持相對路徑檢查與 symlink 防護，不得為了繞過權限而接受任意絕對路徑。

## iCloud 刪除：已驗證解法

Chrome 啟動的 Ruby Host 對 `~/Library/Mobile Documents` 直接 `File.delete`，即使 POSIX 權限正常，也可能得到：

```text
Operation not permitted @ apply2files
```

不可再走的彎路：

- 不要先改 `chmod`、ACL、file flags 或移除 `com.apple.provenance`；本案根因是 macOS 隱私權／iCloud 存取情境。
- 不要直接寫 `tell application "Finder" to delete (POSIX file path)`；iCloud 路徑會回 Finder `-1728`。
- 不要只看 Chrome 的 `Native host has exited.`；先用 framed request 直接執行 Host，讀取真正的 response、exit status 與 stderr，再查 unified log。

正確 Finder AppleScript 必須先在 Finder 外把路徑轉成 `alias`：

```applescript
set targetFile to POSIX file (item 1 of argv) as alias
tell application "Finder" to delete targetFile
```

- iCloud 檔案使用 Finder 移到垃圾桶；一般本機 Vault 保留 `File.delete`，其他路徑遇到 `Errno::EPERM` 才 fallback Finder。
- 首次可能出現 Ruby／Chrome 控制 Finder 的 Automation 提示；允許後再重試。
- `move_to_trash` 只有在 Finder 成功且原路徑消失後才能回報成功。
- 隔離實測使用唯一名稱與 Vault 隱藏目錄 `.sp2o-delete-test`；結束時清除原檔、隱藏目錄，以及可能位於 `~/Library/Mobile Documents/.Trash` 或 `~/.Trash` 的測試檔。不得拿真實筆記試刪。

## Popup／Vault 一致性

- `DELETE_VAULT_ACTIVITY` 只能刪除目前 `draftStatus_*` 或 `recentSaves` 已追蹤的路徑，避免任意 Vault 檔案刪除。
- 順序固定為「嚴格刪除 Vault 檔案 → 更新 Chrome storage → 重繪 Popup」；刪除失敗時不得先移除列表。
- `SYNC_VAULT_ACTIVITY` 用 `exists` 清除已在 Obsidian 外部刪除的 storage 項目；Host 不可用時保留原資料。
- `CLEAR_AUTO_DRAFTS` 逐一嚴格刪除草稿；失敗項目保留在 storage，供再次嘗試。
- 正式貼文刪除不會刪除社群平台原文；Finder 路徑是可復原的垃圾桶操作。

## 圖片同步不可退回的決策

- X 只取 `extended_entities.media`／`entities.media` 的 `type: photo`。
- Threads 取 `image_versions2.candidates` 最大尺寸；有 `video_versions` 的項目跳過。現在不下載影片或動態 GIF，也不以影片封面冒充原圖。
- 每則最多 20 張；binary writer 接受 JPEG、PNG、GIF、WebP、AVIF。
- 寫入順序固定為圖片先、Markdown 後；重試覆寫相同路徑以保持 idempotent。
- 實體路徑：`<mediaPath>/<note-stem>/image-NN.ext`；Markdown 必須用 `relativeVaultPath()` 算相對連結，不得硬編碼 `../../`。
- 新貼文不得建立 `_assets`；既有 `_assets` 不搬移、不刪除，避免舊筆記斷圖。
- `cleanEmptyMediaFolders` 是 best-effort。Chrome 啟動的 Ruby 在 iCloud 圖片根目錄仍可能於 `Dir.each_child` 得到 `EPERM`；不要因筆記刪除成功就宣稱空附件資料夾也已清除，必須另外驗證。

## 失敗、離線與設定同步

- 單張 CDN 圖片下載失敗：仍存筆記，該張使用遠端 URL；不得讓 CDN `TypeError` 觸發整篇離線佇列。
- Obsidian 寫入失敗必須向上拋出；只有 `isObsidianConnectionError` 才能讓正式貼文進 queue。
- Queue 存原始 `data` 與 media URLs，不存 `ArrayBuffer`／Blob；保留舊 `item.markdown` 相容分支。
- Threads 簽章 URL 過期時接受遠端 fallback，不阻止文字筆記落盤。
- 修改 `mediaPath` 的 key、預設值或行為時，同步檢查 `popup/popup.html`、`popup/popup.js`、`background.js` 與 `tests/media-sync.test.mjs`；不能只改 Popup。

## 最短專項診斷

- 圖片：parser 是否有 `media` → CDN host permissions → binary PUT 目標／Content-Type → Markdown 相對連結 → queue marker 是否正確。
- Popup 刪除：storage 是否含目標 path → `DELETE_VAULT_ACTIVITY` → Host framed response → 實體檔是否消失 → storage 是否更新。
- Native Host：先 `ping` → 核對安裝檔版本 → 直接送 framed request → 看真實 error／stderr → 最後才查 Chrome 錯誤頁與 unified log。
- 真實驗收要分別確認筆記在 `basePath`、圖片在 `mediaPath`、Obsidian 預覽可見；刪除則確認實體筆記與 Popup 項目同時消失。
