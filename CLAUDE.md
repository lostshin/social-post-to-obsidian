# CLAUDE.md

本檔供 Claude Code 維護此專案：架構、已決策行為、MV3 陷阱、版本與驗證紀律。全檔保持 200 行內。

`AGENTS.md` 補充另一組主題，不在此重述：發布／封裝規則、Native Host 邊界規則、iCloud 刪除已驗證解法、Popup／Vault 刪除同步、圖片與離線細則、各功能的專項診斷。動到那些主題先讀 `AGENTS.md`。現況以 `manifest.json`、程式與測試為準。

## 專案定位

Chrome Manifest V3 擴充功能，將使用者在 Twitter/X、Threads 撰寫與發佈的貼文（含圖片）存進 Obsidian Vault。

- 無 build step、無第三方依賴，直接 Load unpacked
- 目前版本：Extension `2.2.1`、Native Host `1.1.3`（`native/host.rb` 的 `HOST_VERSION`）
- 寫入方式：預設 Native Helper；Local REST API 為相容選項（27123 HTTP、27124 HTTPS）
- 預設路徑：筆記 `個人創作/社群推文`、圖片 `附件/Social Post to Obsidian`

## 架構與資料流

```text
頁面 MAIN world
  content/interceptor.js      hook fetch + XHR，攔截平台發文 API 回應
           │ window.postMessage
           ▼
ISOLATED world
  content/common.js           訊息、解析器、toast、草稿狀態列
                              + SP2O.createPublishPipeline（發佈/草稿狀態機）
  content/twitter.js          X 的 DOM 擷取、按鈕偵測
  content/threads.js          Threads 的 DOM 擷取、按鈕偵測
           │ chrome.runtime.sendMessage
           ▼
background.js (MV3 service worker)
  ├─ importScripts('shared/settings.js')
  ├─ Native Helper 或 REST 寫入、草稿生命週期、每平台序列化
  ├─ 離線佇列與 alarm 補存
  └─ recentSaves / draftStatus 寫入 chrome.storage.local
           │
           ▼
popup/*                       設定、連線狀態、草稿、最近儲存、待補存
                              （popup.html 也載入 shared/settings.js）
```

`shared/settings.js` 是 background 與 popup 的唯一共用來源：`resolveStorageMode()`、`platformDisplayName()`、`DEFAULT_BASE_PATH`、`DEFAULT_MEDIA_PATH`。**新增共用檔或改檔名時，必須同步改 `scripts/validate-extension.mjs` 的掃描清單與 `scripts/package-extension.sh` 的複製與必含清單**，否則打包會少檔。

平台專屬邏輯只留在 `content/twitter.js`／`threads.js`（selector、按鈕偵測、引用擷取）。發佈時序、草稿 debounce、MutationObserver 都在 pipeline 裡，不要在平台檔重寫。

### 訊息類型

- `SAVE_DRAFT`：1.5 秒 debounce 或 input blur 時暫存
- `PUBLISH_DRAFT`：發佈成功後存正式檔、再刪草稿
- `SAVE_POST`：舊版相容
- `DRAFT_RESULT` / `SAVE_RESULT`：background → 分頁狀態列 / toast
- popup 專用：`GET_NATIVE_STATUS`、`CHOOSE_NATIVE_VAULT`、`CLEAR_AUTO_DRAFTS`、`SYNC_VAULT_ACTIVITY`、`DELETE_VAULT_ACTIVITY`、`RETRY_QUEUE`

## 已決策行為（不要擅自改回）

1. 發佈資料以平台 API 回應為準；DOM 只作內容擷取與 8 秒備援。
2. 備援送出後仍保留原始資料（`fallbackBase`）；遲到的 API 回應用**原 timestamp 重送**，覆寫同一檔案以修正 `source_url` 與圖片。副作用是 toast 可能出現兩次，屬預期。
3. 串文的後續 API 回應在 15 秒窗內忽略（只用第一則建檔）；此判斷必須排在遲到修正之後。
4. X／Threads 同時 hook `fetch` 與 `XMLHttpRequest`；X 已確認 CreateTweet 走 XHR。
5. 滑鼠點擊與 `Cmd/Ctrl+Enter` 都必須觸發發佈流程。
6. **發佈順序：先存正式檔 → 成功才刪草稿（strict）→ 才清 `draftStatus_*`。** 存檔失敗要保留草稿，草稿刪除失敗要保留 storage 項目。順序顛倒會造成貼文遺失。
7. `lastPublishTimestamp` 只在發佈被受理（含進離線佇列）後才設定；發佈失敗不得丟棄後續草稿。
8. 每平台 background 任務序列化（`taskChains`），避免草稿／發佈競態。
9. 錯誤分類決定是否進離線佇列，不可混為一談：

   | 情境 | 標記 | 進佇列？ |
   |---|---|---|
   | Host 無法啟動／斷線 | `isStorageUnavailableError` | 是，每分鐘重試 |
   | Host 有回應但拒絕（Vault 未設定、路徑不合法） | `isNativeHostError` | 否，重試不會恢復 |
   | REST 網路層失敗 | `isObsidianConnectionError` | 是 |
   | REST 回 4xx/5xx | `isObsidianApiError` | 否，向上報錯並保留草稿 |

10. 草稿成功：右下角低調常駐「草稿已暫存 HH:MM」；發佈後收掉。草稿失敗永不跳系統通知。
11. 正式存檔成功：頁面 toast；只有原分頁不存在時才退回系統通知。
12. popup 的「未發佈草稿」（`draftStatus_*`，發佈後清除）與「最近儲存」（`recentSaves`，保留 5 筆）是不同資料，不可互相推導。
13. `recentSaves` 依 `path` 去重：同路徑代表同一份檔案，重送與補存只保留一筆。
14. 檔名 `YYYY-MM-DD_HHmm_摘要.md`；摘要被非法字元濾成空字串時退回 `貼文`，不可產生 `_.md` 結尾。
15. 標題／檔名用 code point 切割（`Array.from`），不可用 `substring` 切斷 emoji。
16. 平台顯示名稱一律走 `platformDisplayName()`：**檔名用 short（`Twitter`），frontmatter 用長名（`Twitter/X`）**——長名含 `/`，用進檔名會被當路徑分隔。
17. port 27124 用 HTTPS；其他 port 預設 HTTP。

## Chrome MV3 重載陷阱（最重要）

重載 unpacked extension 會讓已開分頁的舊 content script 失效。正確流程固定是：

1. 修改完成
2. `chrome://extensions/` 按「重新載入」
3. 重新整理所有 x.com / Threads 分頁
4. 再測試

注意：

- `Extension context invalidated` 通常是舊分頁殘留，不代表新版壞掉。
- `content/common.js` 必須捕捉失效 context、停止重試，只顯示一次重新整理 toast。
- 預期情況用 `console.log`，不要用 `console.warn/error`；warn 也會被 Chrome 收進擴充功能錯誤頁。
- Chrome 錯誤頁會用「目前磁碟檔案」套用「舊錯誤行號」。先比版本與時間戳，不要盲修行號。
- 不要「移除再重加」擴充功能：會清除 `chrome.storage.local`（API Key、設定、recentSaves）。只按重新載入。
- unpacked extension ID 由**資料夾路徑**推導（`native/install-host.sh` 用同一演算法）。路徑不變則 ID 不變，Host manifest 不必重寫。

## 版本規則（硬規則）

每次改動擴充功能的程式行為，都必須在同一個 commit 內更新 `manifest.json.version`：

- bug fix：patch；新功能／可見行為：minor；純文件、測試、註解：不 bump
- `native/host.rb` 行為改變時，另外 bump `HOST_VERSION`（與 extension 版本各自獨立）

版本必須能在三處確認：`chrome://extensions/` 卡片、popup 標題旁、content script / background 啟動 console。

## 最短除錯路徑

先判斷問題在哪一層，不要直接改 DOM selector：

1. **草稿有無寫入**：看 vault 的 `_草稿_Twitter.md` / `_草稿_Threads.md` 修改時間。
2. **正式貼文有無寫入**：看 vault 是否新增含時分的正式檔；草稿檔不等於已發佈成功。
3. **content script 有無載入**：分頁 console 找 `content script vX.Y.Z 已載入`。
4. **API 攔截有無命中**：console 找「攔截到發文 API 回應」或「收到遲到的 API 回應」。
5. **background 有無收到**：service worker console 找 `Received: <TYPE> <platform>`。
6. **storage 有無更新**：檢查 `recentSaves`、`draftStatus_*`、`offlineQueue`。
7. **錯誤頁**：先清除舊紀錄、記下當前版本與時間，再重現；只處理清除後的新紀錄。

若「有草稿、無正式檔」，優先查發佈事件／API 回應與錯誤分類，不要誤判 popup。若「有正式檔、popup 沒新項目」，查 `recordRecentSave` 與 storage，不要重做寫檔流程。若「存檔了但 `source_url` 是頁面網址」，是 8 秒備援生效且遲到修正沒進來，查攔截與 parser。

## 驗證要求

每次程式改動至少依序做（發布與 Native Host 的額外步驟見 `AGENTS.md`）：

1. `node --check` 所有改過的 `.js`；改 `host.rb` 加 `ruby -c`
2. `node scripts/validate-extension.mjs`（含 manifest JSON、popup element id、eval 檢查）
3. `node tests/media-sync.test.mjs`
4. `git diff --check`
5. 實際重載 extension + 重新整理分頁
6. 有 runtime surface 的改動，必須在 X／Threads 真實操作；**發文是對外行為，除非使用者明確授權，不可代發**
7. 檢查 Chrome 擴充功能錯誤頁為空、分頁 console 無新 error
8. 驗證 vault 實際檔案與 frontmatter，不以 toast 當成功證據

測試須知：`tests/media-sync.test.mjs` 用 `vm` 載入 `background.js`，sandbox 需提供 `importScripts` shim 才能載入 `shared/*.js`。新增共用檔時記得同步更新該 shim 與 stub。

**v2.2.1 實測狀態：**語法、validator、stub 與打包已通過；因發佈 pipeline 剛重構，X 與 Threads 都必須重新做真實發文驗收（X 單則／串文／慢回應修正；Threads dialog composer、點擊與 Cmd/Ctrl+Enter）。未完成前不可宣稱此版本已通過真實 E2E。

## 修改紀律

- 保持零依賴；可用原生 Chrome/Web API 就不加套件。
- 共用邏輯放 `content/common.js`（頁面層）或 `shared/settings.js`（background+popup）；不要在 twitter.js 與 threads.js 之間複製貼上。
- DOM selector 限定 composer/dialog，**不得 fallback 到整份 `document`**（會誤抓搜尋框）。找不到 composer 就不擷取。
- 不能只靠文字匹配發佈按鈕；優先平台穩定屬性（如 `data-testid`），文字只作精確備援，且必須先限定在 dialog 內。
- 去重要用穩定識別（如 `data-testid`），**不可用文字內容去重**：串文中兩則相同文字會被誤刪。
- 不把草稿成功做成系統通知；高頻打字不可轟炸使用者。
- 不在 console 印 API Key、完整私人貼文或平台 response body。
- 大改 content script 前先確認 git 可回復；完成後 commit，不 push。
- 每個修改都要能對應使用者需求；不相干問題只記錄、不順手改。

## 開發與設定

Load unpacked：`chrome://extensions/` → Developer mode → Load unpacked → 選 repo 根目錄。

Obsidian 需求：Native Helper 模式執行 `./native/install-host.sh` 後在 popup 選 Vault；REST 模式需啟用 `obsidian-local-rest-api` 並填 API Key 與 port。設定存於 `chrome.storage.local`，不是 repo 檔案。
