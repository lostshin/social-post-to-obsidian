# AGENTS.md

本檔只記錄 `CLAUDE.md` 未涵蓋的 Codex 最短路徑、已驗證陷阱與發布現況。架構、訊息流、MV3 重載、版本原則、一般 selector／修改紀律及基本驗證清單只讀 `CLAUDE.md`，不在此重述。快照與現況衝突時，以 `manifest.json`、目前程式及測試為準。

## Codex 最短路徑

1. 先執行 `git status --short`，再用 `rg -n` 只讀相關區塊；不要先通讀 repository。
2. 回歸測試一律優先擴充 `tests/media-sync.test.mjs`，沿用其 VM、Native Host、YAML 與隔離 Vault harness。
3. 程式驗證照 `CLAUDE.md`，不要另建平行清單；封裝才加跑 `./scripts/package-extension.sh` 並核對兩個 ZIP 與 `dist/SHA256SUMS`。
4. 修改 `native/host.rb` 才加跑 `ruby -c native/host.rb`、安裝 Host 並比對安裝檔；Host 行為變更同步更新 `HOST_VERSION`。
5. 不操作日常 Chrome profile、真實貼文或真實筆記。自動驗證用隔離資料；runtime surface 最後交使用者人工驗收，除非另有授權。

## 現況與進度（2026-07-19）

- Extension `v2.4.0`；Native Host `v1.1.3`。GitHub `main` 已到 `8018a2a`（含 `v2.2.2`～`v2.4.0`），尚未 tag／Release；本輪 CI zsh 修正仍在 local `main`。
- 使用者已確認 `v2.2.2` 的 X 草稿三重複 bug 修復成功。
- `v2.3.0` 已完成 500ms 草稿同步、X／Threads 串文結構、YAML frontmatter 與新版 Markdown；`v2.4.0` 已完成逐則 code block。兩版已通過自動測試與隔離 Vault 實寫，仍待真實 X／Threads 人工驗收。
- 舊設定 `storageMode: 'direct'` 會遷移成 `native`；background／popup 的 `'direct'` 相容分支仍是活碼。
- 商店仍待正式 item／extension ID、乾淨資料的 Actual UI screenshot、正式流程驗收與送審；現有 `assets/store/screenshot-overview.png` 只是流程圖。

## X／Threads 擷取：已驗證規則

- X 真正編輯器 selector 是 `[data-testid^="tweetTextarea_"][contenteditable="true"]`。只用前綴會同時抓到 `_label`、`RichTextInputContainer` 與 editor，造成同文三份；不得放寬。
- X 去重以真正 editor 的 `data-testid` 為準，不得按文字去重；合法串文可能有兩則完全相同內容。
- X／Threads 的 `getTextContent()` 回傳按畫面順序排列的字串陣列。`content/common.js` 同時保留相容用 `content`（以 `\n\n---\n\n` 串接）及結構化 `thread`；只有兩則以上才傳 `thread`。
- 草稿與發布必須保留同一份 `thread`；8 秒 DOM fallback 與遲到 API 修正也不得遺失它。舊 queue 沒有 `thread` 時仍須可讀。
- 500ms debounce 只定義在 `content/common.js`；平台檔不得各自另設 timer。
- 最小回歸組合：X wrapper 三重複、X 相同文字雙則、Threads 雙則、500ms `SAVE_DRAFT`、fallback `PUBLISH_DRAFT` 的 `thread`。

## Obsidian Markdown／YAML 契約

- 草稿與正式貼文共用 `getThreadItems()`／`renderContentSection()`；單則用一個 code block，串文每則各有 `### N / total` 與獨立 code block。
- `renderCopyableContent()` 的 fence 必須比原文最長 backtick run 多 1，且至少 3；不得固定長度，否則含 code fence 的貼文會截斷。
- 圖片與引用貼文留在 code block 外；引用用 callout，自己的貼文內容才包成可複製區塊。
- YAML 字串一律經 `escapeYaml()`（`JSON.stringify` 產生合法 YAML 雙引號字串），避免日期、`yes/no`、冒號或引號被錯誤推型。
- 正式貼文保留 `title`、`created`、`platform`、`source`、`source_url`、`status`、`tags`、`summary`；草稿用 `updated`。串文另加數字 `thread_count` 與 `串文` tag；回覆／引用欄位只在有值時加入。
- 格式測試必須同時做：Ruby `YAML.safe_load`、單則、串文逐則 fence、原文內含 backtick run 的動態 fence、Native Host 寫入隔離 Vault 後逐字讀回。
- 不遷移舊筆記；只有新建或再次覆寫的草稿／正式貼文採用新格式。

## Native Helper 邊界

- Host ID：`com.lostshin.social_post_to_obsidian`；設定：`~/Library/Application Support/Social Post to Obsidian/config.json`。
- Native stdout 只能是 4-byte little-endian 長度加 JSON；所有子程序輸出必須捕捉，否則 Chrome 只顯示 `Native host has exited.`。
- `sendNativeMessage()` 每次啟動新程序，不得依賴跨 request 記憶體。
- 只接受 Vault 相對路徑，保留 Vault 邊界與 symlink 防護；不得接受任意絕對路徑。
- 商店 Host manifest 的 `allowed_origins` 必須用正式 32 字元 extension ID；Chrome Web Store 不會代裝 Helper。

## iCloud 刪除：不要重試死路

Chrome 啟動的 Ruby 對 `~/Library/Mobile Documents` 直接 `File.delete` 可能回 `Operation not permitted @ apply2files`。不要再試 `chmod`、ACL、file flags 或 `com.apple.provenance`；先直接送 framed request，讀 response／exit status／stderr，最後才查 unified log。

```applescript
set targetFile to POSIX file (item 1 of argv) as alias
tell application "Finder" to delete targetFile
```

- iCloud 用 Finder 移到垃圾桶；本機 Vault 用 `File.delete`，其他路徑只在 `Errno::EPERM` fallback Finder。
- `move_to_trash` 只有 Finder 成功且原路徑消失才回成功；首次允許 Automation 後必須重試。
- 隔離實測用 `.sp2o-delete-test` 與唯一檔名，並清除原檔、測試目錄及 `~/Library/Mobile Documents/.Trash`／`~/.Trash` 殘留。

## Popup／Vault 一致性

- `DELETE_VAULT_ACTIVITY` 只能刪 `draftStatus_*` 或 `recentSaves` 已追蹤路徑；順序是實體檔 → storage → UI，失敗不可先移除列表。
- `SYNC_VAULT_ACTIVITY` 只在 `exists` 明確為 false 時清 storage；Host 不可用就保留。
- `CLEAR_AUTO_DRAFTS` 逐筆嚴格刪除，失敗項保留重試。正式貼文刪除不影響社群平台原文。

## 圖片、queue 與清理

- X 只取 `type: photo`；Threads 取最大 `image_versions2.candidates`，有 `video_versions` 就跳過。影片、動態 GIF 與影片封面都不同步。
- 每則最多 20 張；圖片先、Markdown 後；相同路徑重試覆寫。路徑是 `<mediaPath>/<note-stem>/image-NN.ext`，Markdown 必須用 `relativeVaultPath()`。
- 新貼文不建 `_assets`；舊 `_assets` 不搬不刪。單張 CDN 失敗仍存筆記並保留遠端 URL。
- Queue 存原始 `data` 與 media URLs，不存 binary；保留舊 `item.markdown` 相容。只有已分類為連線不可用的錯誤才進 queue。
- `cleanEmptyMediaFolders` 是 best-effort；筆記刪除成功不代表舊圖片空目錄已清除，須分開驗證。

## GitHub／Chrome Web Store

- 公開行為或資料處理變更要檢查 `README.md`、`INSTALL.md`、`PRIVACY.md`、`docs/CHROME_WEB_STORE.md` 與 Popup 入口是否過時；文件修改仍需使用者授權。
- package script 產出 extension ZIP、macOS Helper ZIP、`SHA256SUMS`；商店只上傳 extension ZIP，且 `manifest.json` 必須位於 ZIP 根目錄。
- Helper ZIP 檔名跟 release version；Host 真實版本只看 `HOST_VERSION`。不得宣稱未建立的 Store item、Official URL 或 verified publisher。
- 禁止 remote JavaScript、`eval()`、`new Function()`。Workflows 目前用已存在的 `actions/checkout@v6`、`actions/setup-node@v6`；升版前查官方 release。
- macOS Helper 腳本使用 zsh；Ubuntu runner 不保證有 `/bin/zsh`。Validator 只從 `PATH` 呼叫 `zsh`，validate／release workflow 必須先明確安裝它。

## 最短專項診斷

- 草稿重複：composer scope → 真 editor selector → editor ID → `thread` array → generated Markdown。
- 串文缺則：兩平台 inputs 順序 → `readComposerContent()` → `SAVE_DRAFT`／`PUBLISH_DRAFT` data → `thread_count`／逐則 fence。
- 格式壞掉：frontmatter 邊界 → `YAML.safe_load` → dynamic fence 長度 → Native Host 寫入後讀回。
- 圖片：parser media → CDN permission → binary PUT／Content-Type → 相對連結 → queue marker。
- Popup 刪除：tracked storage path → message → framed Host response → 實體檔 → storage／UI。
- Native Host：ping → 原始碼／安裝檔版本 → framed request → stderr → Chrome 錯誤頁／unified log。
- 發布：manifest version → package → ZIP 根目錄／排除檔 → checksum → 隔離 Load unpacked。
