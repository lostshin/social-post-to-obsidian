# AGENTS.md

本檔只補充 `CLAUDE.md` 未涵蓋的 Codex 捷徑、已驗證陷阱與發布快照。架構、MV3 重載、版本原則、通用修改紀律及基本驗證仍以 `CLAUDE.md` 為準；若文件衝突，以 `manifest.json`、目前程式與測試為準。`CLAUDE.md` 內的 `v2.2.1`、1.5 秒 debounce、Threads 只走 GraphQL 與舊 E2E 快照已過時。

## Codex 最短路徑

1. 先跑 `git status --short`；既有 dirty files 屬於使用者，只 stage 任務檔。再用 `rg -n` 讀相關區塊，不先掃完整 repository。
2. 回歸測試優先擴充 `tests/media-sync.test.mjs`，沿用 VM、Native Host、YAML 與隔離 Vault harness。
3. 程式驗證照 `CLAUDE.md`；發布才跑 `./scripts/package-extension.sh`，核對兩個 ZIP 與 `dist/SHA256SUMS`。
4. 修改 `native/host.rb` 才額外跑 `ruby -c`、安裝 Host 並比對安裝檔；Host 行為變更同步更新 `HOST_VERSION`。
5. 不碰日常 Chrome profile、真實貼文或真實筆記；用隔離資料。社群發文目前暫停，沒有使用者新的明確授權就不得代發。

## 目前快照（2026-07-23）

- Extension `v2.4.2`；Native Host `v1.1.3`。Tag `v2.4.2` 固定在 commit `8569607`；GitHub Release、兩個 ZIP 與 `SHA256SUMS` 已公開並驗證。
- `main` 在 tag 後另有文件 commit：繁中 `README.md` 是 GitHub 主頁，英文在 `README.en.md`；不要為了讓 tag 帶到新文件而移動或重打已公開 tag。
- `v2.4.2` 已由使用者完成 Threads 單圖發文 → Obsidian 真實 E2E。X 多圖、Threads 多圖仍未分別驗收，不得宣稱全通過。
- Web Store item ID：`jdfempgjnmdlokacfjmnipihhghcnomb`。Dashboard 顯示公開版 `v2.4.0`；`v2.4.2` 已於 2026-07-23 上傳並提交，狀態「待審查」，核准後自動發布。
- 送審後公開頁仍導向 `empty-title`，update service 仍回 `error-unknownApplication`；不得把 Dashboard 的「已發布－公開」或「待審查」當成匿名使用者已可安裝。
- 只有 update service 回 `status="ok"`、公開頁出現「加到 Chrome」且可從商店安裝，才能宣稱已公開上架；Dashboard 語系 `Approved` 不等於已發布。
- `v2.4.2` 已儲存繁中詳細說明與 482/500 字元 reviewer note；權限理由、Privacy practices 與圖片素材沿用 `publish-v2.4.0/`。英文與新摘要保留給含 `_locales` 的後續版本。
- 舊設定 `storageMode: 'direct'` 會遷移為 `native`；background／popup 的 `'direct'` 相容分支仍是活碼。

## 公開文件與文案同步

- 使用者說「整體文案」時，不可只改深層 `LISTING.md`：同步檢查 `README.md`、`README.en.md`、GitHub About description、Store listing；必要連動才改 `INSTALL.md`／`PRIVACY.md`。
- 對外語系固定：台灣繁中為主、英文為次；AuDHD 寫成「AuDHD 族群／AuDHD community」，不當產品形容詞或醫療效果宣稱。
- 行銷順序：先說痛點（發文後還要擷取、切換、整理）→ 解法（發布後自動轉 Markdown）→ 效益（降低寫作阻力、串文完整留在 Vault）→ 功能與隱私證據。
- 若要求去 AI 味，套用 `humanize`；繁中再用 `dewesternise`。Web Store 欄位限制與語系規則見下一節。
- `README.md` 是 GitHub 首頁；`README.en.md` 是英文版；`README.zh-TW.md` 只保留相容入口。改檔名後用 `rg` 更新所有相對連結。
- GitHub About 不是 repository 檔案；README 改完仍須用 `gh repo view/edit` 讀回 description。最後再抓公開 GitHub 頁，確認實際渲染而非只看 local／raw。

## Web Store 送審最短路徑

1. 先核對發布者 `lô-kun-lîm` 與 item ID `jdfempgjnmdlokacfjmnipihhghcnomb`。若落在 `/devconsole/register`、要求同意協議或支付 $5，代表登入錯帳戶；不可代勾或付款。
2. 只上傳 GitHub Release 的 `social-post-to-obsidian-vX.Y.Z.zip`；Helper ZIP 不上傳。先驗證 checksum 與 ZIP 根目錄的 `manifest.json`，上傳後以套件頁的 Draft version 讀回成功。
3. 優先用 Chrome connector；失效時只有在使用者明確授權後才用 `control-chrome-with-applescript`。CWS 原生檔案選擇器不接受 DOM `.click()` 的非可信事件：用 DOM 聚焦「選取檔案」後送 trusted Return，再以 `Cmd+Shift+G` 選完整路徑；每步都重新用 item ID 解析分頁。
4. Name／Summary 來自 manifest，Dashboard 唯讀；英文副語系需新套件加入 `_locales`。詳細說明上限 16,000、測試操作說明 500 字元；既有類別「工具」的其他選項在已發布項目中 disabled。
5. 權限與資料用途未變就不重寫 Privacy practices。逐頁儲存並讀回欄位；送審對話框選「核准後自動發布」，最後以狀態頁「待審查」作為提交證據。
6. Dashboard「已發布－公開」或語系 `Approved` 都不等於可交付。只有 update service `status="ok"`、匿名公開頁出現「加到 Chrome」且實際可安裝，才能宣稱已上架。
7. AppleScript 工作完成後停止瀏覽器命令，提醒使用者手動關閉 Chrome「允許 Apple 事件的 JavaScript」。

## X／Threads 擷取契約

- X editor 固定為 `[data-testid^="tweetTextarea_"][contenteditable="true"]`。只用前綴會抓到 `_label`、`RichTextInputContainer` 與 editor，造成同文三份。
- 去重用 editor `data-testid`，不可按文字；合法串文可能有兩則完全相同內容。
- 兩平台 `getTextContent()` 按畫面順序回傳字串陣列。`content/common.js` 保留相容用 `content`（以 `\n\n---\n\n` 串接）與結構化 `thread`；只有兩則以上才傳 `thread`。
- 草稿、發布、8 秒 DOM fallback、遲到 API 修正都必須保留同一份 `thread`；舊 queue 沒有 `thread` 仍須可讀。
- 500ms debounce 只定義在 `content/common.js`；平台檔不得另設 timer。
- 最小回歸：X wrapper 三重複、X 相同文字雙則、Threads 雙則、500ms `SAVE_DRAFT`、fallback `PUBLISH_DRAFT` 的 `thread`。

## Threads 圖片發文契約

- 現行 threads.com 正式發文走 REST：`configure_text_only_post`、`configure_text_post_app_feed`（單圖）、`configure_text_post_app_sidecar`（多圖）；`content/interceptor.js` 必須同時保留這三個精確 endpoint 與舊 GraphQL 相容攔截，fetch／XHR 共用判斷。
- configure response 的主貼文可能只有 `pk`、`code`／`permalink` 與媒體欄位，沒有 `user.username`。`parseThreadsCreate()` 優先用 `permalink`，不可把 `findThreadsPost()` 收窄回舊 GraphQL shape。
- 圖片來源依序涵蓋主貼文 `image_versions2`、`carousel_media` 與相容用 `text_post_app_info.linked_inline_media`；選最大 candidate，有非空 `video_versions` 就跳過。
- 8 秒 DOM fallback 只有文字，沒有正式 CDN URL。若「文字有存、圖片沒存」，第一步查 REST endpoint 是否被 interceptor 命中；不可只增加 parser 欄位或猜 `linked_inline_media`。
- 平台改版時先從目前 Threads bundle 的 `BarcelonaComposerAPI`／實際 Network 確認 endpoint 與 response，再改 fixture；不要靠舊私有 API 範例猜 JSON。
- 自動回歸必須覆蓋：三個 endpoint 會 forward、upload endpoint 不誤判、configure response 取最大圖片、background 下載並寫入圖片與 Markdown。自動測試或文字 fallback 成功都不能取代真實多圖 E2E。

## Obsidian Markdown／YAML 契約

- 草稿與正式貼文共用 `getThreadItems()`／`renderContentSection()`；單則一個 code block，串文每則各有 `### N / total` 與獨立 block。
- `renderCopyableContent()` 的 fence 至少 3 個 backticks，且必須比原文最長 backtick run 多 1。
- 圖片與引用放在 code block 外；引用用 callout，只有自己的貼文內容包成可複製區塊。
- YAML 字串全走 `escapeYaml()`；正式貼文保留 `title`、`created`、`platform`、`source`、`source_url`、`status`、`tags`、`summary`，草稿改用 `updated`。串文加數字 `thread_count` 與 `串文` tag。
- 格式測試同時覆蓋 `YAML.safe_load`、單則、逐則 fence、原文 backtick run、Native Host 寫入後逐字讀回。
- 不遷移舊筆記；只有新建或再次覆寫的檔案採新格式。

## Native／iCloud／Popup 邊界

- Host ID：`com.lostshin.social_post_to_obsidian`；設定：`~/Library/Application Support/Social Post to Obsidian/config.json`。
- Native stdout 只能是 4-byte little-endian 長度加 JSON；捕捉所有子程序輸出。`sendNativeMessage()` 每次開新程序，不依賴跨 request 記憶體。
- 只接受 Vault 相對路徑，保留 Vault 邊界與 symlink 防護。商店 Host manifest 的 `allowed_origins` 必須用正式 ID `jdfempgjnmdlokacfjmnipihhghcnomb`；Web Store 不會代裝 Helper。
- Chrome 啟動的 Ruby 在 iCloud 直接 `File.delete` 可能 `EPERM`；不要重試 `chmod`、ACL、flags 或 provenance。先送 framed request 看 response／stderr，再查 unified log。
- iCloud 用 Finder alias 移到垃圾桶；本機 Vault 用 `File.delete`，其他路徑只在 `Errno::EPERM` fallback Finder。成功後必須確認原路徑消失。
- `DELETE_VAULT_ACTIVITY` 只能刪 `draftStatus_*`／`recentSaves` 追蹤路徑；順序固定為實體檔 → storage → UI。
- `SYNC_VAULT_ACTIVITY` 只在 `exists: false` 時清 storage；Host 不可用就保留。`CLEAR_AUTO_DRAFTS` 失敗項保留重試。

## 圖片、queue 與清理

- X 只取 `type: photo`；Threads 詳見上節。影片、動態 GIF、影片封面不同步。
- 每則最多 20 張；圖片先、Markdown 後；重試覆寫相同路徑。圖片路徑為 `<mediaPath>/<note-stem>/image-NN.ext`，Markdown 只用 `relativeVaultPath()`。
- 新貼文不建 `_assets`；舊 `_assets` 不搬不刪。單張 CDN 失敗仍存筆記並保留遠端 URL。
- Queue 存原始 `data` 與 media URLs，不存 binary；保留舊 `item.markdown`。`cleanEmptyMediaFolders` 是 best-effort，筆記刪除與空目錄清理分開驗證。

## GitHub／Release 已驗證規則

- Workflows 使用 `actions/checkout@v7`、`actions/setup-node@v7`。Dependabot PR 落後 `main` 時先 `@dependabot rebase`；`push` 與 `pull_request` 會產生兩個同名 check，不代表兩種 bug。
- Ubuntu runner 不保證有 `/bin/zsh`：validator 從 `PATH` 呼叫 `zsh`，validate／release workflow 必須先安裝 zsh。不要把 `/bin/zsh` 寫回 Node validator。
- `release.yml` 在 `v*` tag push 後驗證 tag＝manifest version、自動測試／封裝／建立 Release；不要手動重複建 Release。
- Tag 只能在對應 Release commit 建立一次；發布後的文件改在 `main`，不得移動、刪除或重建 tag 來改 Release 快照。
- Release ZIP 會因封裝 timestamp 與本機預製 ZIP 有不同 hash；下載 Release 三個 assets，使用該 Release 的 `SHA256SUMS` 驗證，不拿本機舊 hash 硬比。
- 商店套件禁止 remote JavaScript、`eval()`、`new Function()`；Web Store 操作規則見上節。
- 商店名稱維持 `Social Post to Obsidian`，避免為雙語標題無必要 bump／重傳。Official URL 只有驗證自有網域後才填。
- 若審查拒絕，保存完整通知與 policy ID，先對照程式、`PRIVACY.md` 與 `LISTING.md`，不要猜測修改後反覆送審。

## 最短專項診斷

- 草稿重複：composer scope → 真 editor selector → editor ID → `thread` → Markdown。
- 串文缺則：inputs 順序 → `readComposerContent()` → draft／publish data → `thread_count`／逐則 fence。
- 格式損壞：frontmatter 邊界 → `YAML.safe_load` → dynamic fence → Host 寫入後讀回。
- Threads 圖片：REST endpoint 命中 → forwarded response → `parseThreadsCreate()` → CDN download → Vault binary → Markdown；文字 fallback 成功不代表 API 攔截成功。
- 其他圖片：parser media → CDN permission → binary PUT／Content-Type → 相對連結 → queue marker。
- Popup 刪除：tracked path → message → framed Host response → 實體檔 → storage／UI。
- Native Host：ping → 原始碼／安裝檔版本 → framed request → stderr → Chrome／unified log。
- 發布：manifest version → tag → CI → Release assets／checksum → Web Store Draft version → 待審查 → update service／匿名頁／隔離安裝。
