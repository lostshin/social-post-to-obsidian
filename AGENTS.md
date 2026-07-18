# AGENTS.md

本檔只補充 `CLAUDE.md` 未涵蓋的 Codex 現況、已驗證解法與發布規則。開始工作前仍須完整讀取 `CLAUDE.md`；其中的 MV3 重載、版本原則、一般修改紀律與既有訊息流不在此重述。若兩檔現況不一致，以 `manifest.json`、目前程式與測試為準。

## 最短工作路徑

1. `git status --short` 後用 `rg -n` 定位，不先通讀整個 repository。
2. 優先擴充 `tests/media-sync.test.mjs`，不要另建重複測試工具。
3. 程式變更至少執行：
   - `node scripts/validate-extension.mjs`
   - `node tests/media-sync.test.mjs`
   - `git diff --check`
4. 發布／封裝變更再執行 `./scripts/package-extension.sh`，並驗證兩個 ZIP 與 `dist/SHA256SUMS`。
5. 修改 `native/host.rb` 時，另跑 `ruby -c native/host.rb`、安裝 Host 並比對安裝檔；Host 行為變更須同步更新 `HOST_VERSION`。
6. 不操作使用者日常 Chrome profile、真實貼文或真實筆記；使用隔離資料，最後交由使用者人工驗收，除非另有授權。

## 現況與進度（2026-07-19）

- Extension `v2.2.0`；Native Host `v1.1.2`。預設為 Native Helper，不需要 Local REST API Key；REST 只保留為跨平台相容模式。
- `CLAUDE.md` 的 REST-only 架構與 `v1.4.0` 是過時現況，不得據此改回舊資料流。
- 已完成：X／Threads 圖片同步與獨立附件路徑（v1.6–1.7）、Native Helper 預設模式（v2.0）、Popup 清草稿／預覽／開啟／刪除／同步（v2.1）、iCloud 刪除修復（v2.1.2）、公開安裝與 Chrome Web Store 發布資料（v2.2）。
- `CLAUDE.md` 未記載的預設圖片路徑為 `附件/Social Post to Obsidian`。
- 舊設定值 `storageMode: 'direct'` 仍會在啟動時遷移成 `native`；background 與 popup 的 `'direct'` 相容分支是活的，不得當死碼移除。
- v2.2 發布前只剩人工項目：正式 Store item／extension ID、乾淨測試資料的實際 Popup screenshot、真實流程驗收、push／tag／Release／送審。
- 截至此日期 v2.x 只存在 local `main`，`origin/main` 尚未同步；未經使用者明確指示不得 push。

## Native Helper 不可破壞的規則

```text
background.js → chrome.runtime.sendNativeMessage
              → native/host.rb → Vault
```

- Host：`com.lostshin.social_post_to_obsidian`；設定：`~/Library/Application Support/Social Post to Obsidian/config.json`。
- Native stdout 只能是「4-byte little-endian 長度 + JSON」；所有子程序輸出必須捕捉，否則 Chrome 只會顯示 `Native host has exited.`。
- `sendNativeMessage()` 每次啟動新程序，不得依賴跨 request 記憶體。
- 保留 Vault 相對路徑、Vault 邊界與 symlink 防護，不得接受任意絕對路徑。
- 商店版 Host manifest 的 `allowed_origins` 必須使用正式 32 字元 extension ID；Chrome Web Store 不會代為安裝 Helper。

## iCloud 刪除：唯一已驗證路徑

Chrome 啟動的 Ruby 對 `~/Library/Mobile Documents` 直接 `File.delete` 可能得到 `Operation not permitted @ apply2files`。不要再嘗試 `chmod`、ACL、file flags、`com.apple.provenance`，也不要只看 Chrome 的 `Native host has exited.`。

診斷順序：直接送 framed request 給 Host → 讀 response／exit status／stderr → 必要時才查 unified log。

Finder AppleScript 必須先在 Finder 外轉成 `alias`：

```applescript
set targetFile to POSIX file (item 1 of argv) as alias
tell application "Finder" to delete targetFile
```

- iCloud 檔案用 Finder 移到垃圾桶；一般本機 Vault 保留 `File.delete`，其他路徑只有 `Errno::EPERM` 才 fallback Finder。
- `move_to_trash` 只有在 Finder 成功且原路徑消失後才回報成功；首次 Automation 提示允許後須重試。
- 隔離實測用 `.sp2o-delete-test` 與唯一檔名；清掉原檔、測試目錄及可能落在 `~/Library/Mobile Documents/.Trash` 或 `~/.Trash` 的測試檔，不拿真實筆記測刪除。

## Popup／Vault 一致性

- `DELETE_VAULT_ACTIVITY` 只准刪除 `draftStatus_*` 或 `recentSaves` 已追蹤路徑。
- 順序固定：嚴格刪除實體檔 → 更新 storage → 重繪 Popup；失敗時列表不可先消失。
- `SYNC_VAULT_ACTIVITY` 只在 `exists` 明確回報不存在時清 storage；Host 不可用時保留資料。
- `CLEAR_AUTO_DRAFTS` 逐筆嚴格刪除，失敗項目保留供重試。
- 正式貼文刪除不影響社群平台原文；筆記與 Popup 項目必須分別驗證。

## 圖片、離線與清理

- X 只取 `type: photo`；Threads 取最大 `image_versions2.candidates`，有 `video_versions` 就跳過。現在不下載影片或動態 GIF，也不拿影片封面冒充原圖。
- 每則最多 20 張；順序固定為圖片先、Markdown 後；重試覆寫相同路徑，保持 idempotent。
- 圖片路徑：`<mediaPath>/<note-stem>/image-NN.ext`；Markdown 用 `relativeVaultPath()`，不得硬編碼 `../../`。
- 新貼文不得建立 `_assets`；舊 `_assets` 不搬、不刪，避免斷圖。
- 單張 CDN 下載失敗仍存筆記並保留遠端 URL；只有 `isObsidianConnectionError` 才能讓整篇進 queue。
- Queue 存原始 `data` 與 media URLs，不存 binary；保留舊 `item.markdown` 相容分支。
- `cleanEmptyMediaFolders` 是 best-effort；iCloud `Dir.each_child` 仍可能 `EPERM`。筆記刪除成功不等於舊圖片空資料夾已清除，必須另驗證。
- 修改 `mediaPath` 時同步檢查 Popup HTML／JS、background storage 讀取與 `tests/media-sync.test.mjs`。

## GitHub／Chrome Web Store 發布規則

- 公開行為或資料處理變更時，同步檢查 `README.md`、`INSTALL.md`、`PRIVACY.md`、`docs/CHROME_WEB_STORE.md` 與 Popup 入口。
- `./scripts/package-extension.sh` 產出 extension ZIP、macOS Helper ZIP、`SHA256SUMS`；只把 extension ZIP 上傳商店，且 `manifest.json` 必須在 ZIP 根目錄。
- Helper ZIP 檔名跟隨產品 release version；Host 實際版本以 `native/host.rb` 的 `HOST_VERSION` 為準，兩者用途不同。
- 不得加入 remote JavaScript、`eval()` 或 `new Function()`；本機處理仍須在 Privacy practices 揭露 API Key、貼文／圖片與可能的作者識別資訊。
- 現有 `assets/store/screenshot-overview.png` 是流程示意圖，不是 Actual UI screenshot；不得宣稱素材已全數完成或用假介面替代。
- 未取得 Store item 前不得宣稱已上架；未驗證自有網域前不得宣稱 Official URL／verified publisher。
- Workflows 目前使用官方存在的 `actions/checkout@v6`、`actions/setup-node@v6`；升版前先查官方 release，不得猜不存在的 major。

## 最短專項診斷

- 圖片：parser `media` → CDN permission → binary PUT path／Content-Type → Markdown 相對連結 → queue marker。
- Popup 刪除：storage path → `DELETE_VAULT_ACTIVITY` → framed Host response → 實體檔 → storage／UI。
- Native Host：`ping` → 原始碼與安裝檔版本 → framed request → stderr → Chrome 錯誤頁／unified log。
- 發布：manifest version → validator／tests → package → ZIP 根目錄與排除檔 → checksum → 隔離 Load unpacked。
