# CLAUDE.md

本檔供 Claude Code 維護此專案。目標：先驗證、窄改動、避免重走已踩過的 Chrome MV3 陷阱。全檔保持 200 行內。

## 專案定位

Chrome Manifest V3 擴充功能，將使用者在 Twitter/X、Threads 撰寫與發佈的貼文存進 Obsidian，透過 Local REST API 寫成 Markdown。

- 無 build step、無第三方依賴，直接 Load unpacked
- Manifest 版本：以 `manifest.json` 為準（目前 `1.4.0`）
- 預設路徑：`個人創作/社群推文`
- Local REST API：27123 HTTP、27124 HTTPS

## 架構與資料流

```text
頁面 MAIN world
  content/interceptor.js
  └─ hook fetch + XHR，攔截平台發文 API 回應
           │ window.postMessage
           ▼
ISOLATED world
  content/common.js       共用訊息、解析器、toast、草稿狀態列
  content/twitter.js      X 的 DOM 擷取與發佈/草稿事件
  content/threads.js      Threads 的 DOM 擷取與發佈/草稿事件
           │ chrome.runtime.sendMessage
           ▼
background.js (MV3 service worker)
  ├─ 寫 Obsidian Local REST API
  ├─ 草稿生命週期、每平台序列化
  ├─ 離線佇列與 alarm 補存
  └─ recentSaves / draftStatus 寫入 chrome.storage.local
           │
           ▼
popup/*
  設定、連線狀態、未發佈草稿、最近儲存、待補存數量
```

### 訊息類型

- `SAVE_DRAFT`：1.5 秒 debounce 或 input blur 時暫存
- `PUBLISH_DRAFT`：發佈成功後刪草稿、存正式檔
- `SAVE_POST`：舊版相容
- `DRAFT_RESULT`：background → 分頁草稿狀態列
- `SAVE_RESULT`：background → 分頁正式存檔 toast

## 已決策行為（不要擅自改回）

1. 發佈資料以平台 API 回應為準；DOM 只作內容擷取與 8 秒備援。
2. X/Threads 同時 hook `fetch` 與 `XMLHttpRequest`；X 已確認 CreateTweet 實際走 XHR。
3. 滑鼠點擊與 `Cmd/Ctrl+Enter` 都必須觸發發佈流程。
4. 每平台 background 任務必須序列化，避免草稿/發佈競態；發佈前的遲到草稿要丟棄。
5. 草稿成功：右下角低調常駐「草稿已暫存 HH:MM」；發佈後收掉。
6. 正式存檔成功：頁面 toast；只有原分頁不存在時才退回系統通知。
7. Obsidian 未連線：正式貼文進離線佇列，每分鐘重試；草稿只顯示未暫存狀態，不進佇列。
8. popup 的「未發佈草稿」與「最近儲存」是不同資料：
   - `draftStatus_x` / `draftStatus_threads`：草稿，發佈後清除
   - `recentSaves`：已發佈或補存成功的正式貼文，保留 5 筆
9. 檔名含 `YYYY-MM-DD_HHmm_摘要.md`，避免同日相似貼文互相覆蓋。
10. 標題/檔名須用 code point 切割（`Array.from`），不可用 `substring` 切斷 emoji。
11. port 27124 用 HTTPS；其他 port 預設 HTTP。

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
- Chrome 錯誤頁會用「目前磁碟檔案」套用「舊錯誤行號」，畫面中的原始碼可能不是當時執行版本。先比版本與時間戳，不要盲修行號。
- 不要「移除再重加」擴充功能：會清除 `chrome.storage.local`（API Key、設定、recentSaves）。只按重新載入。

## 版本規則（硬規則）

每次改動擴充功能的程式行為，都必須在同一個 commit 內更新 `manifest.json.version`：

- bug fix：patch（例 `1.4.0` → `1.4.1`）
- 新功能/可見行為：minor（例 `1.4.x` → `1.5.0`）
- 純文件、測試、註解：不 bump

版本必須能在三處確認：

- `chrome://extensions/` 卡片
- popup 標題旁
- content script / background 啟動 console

## 最短除錯路徑

先判斷問題在哪一層，不要直接改 DOM selector：

1. **草稿有無寫入**：看 vault 的 `_草稿_Twitter.md` / `_草稿_Threads.md` 修改時間與內容。
2. **正式貼文有無寫入**：看 vault 是否新增含時分的正式檔；草稿檔不等於已發佈成功。
3. **content script 有無載入**：分頁 console 找 `content script vX.Y.Z 已載入`。
4. **API 攔截有無命中**：console 找「攔截到發文 API 回應」與正確 status/post URL。
5. **background 有無收到**：service worker console 找 `Received: <TYPE> <platform>`。
6. **storage 有無更新**：檢查 `recentSaves`、`draftStatus_*`、`offlineQueue`。
7. **Local REST API**：分別測 `http://127.0.0.1:27123/`、`https://127.0.0.1:27124/`；HTTP 200 只能證明服務存活，認證仍需正確 API Key。
8. **錯誤頁**：先清除舊紀錄、記下當前版本與時間，再重現；只處理清除後的新紀錄。

若「有草稿、無正式檔」，優先查發佈事件/API 回應，不要誤判 popup。若「有正式檔、popup 沒新項目」，查 `recordRecentSave` 與 storage，不要重做寫檔流程。

## 驗證要求

每次程式改動至少依序做：

1. `node --check` 所有改過的 `.js`
2. `JSON.parse` 驗證 `manifest.json`
3. 用 stub 測受影響的 message/storage/fetch 流程（測試暫存檔放 session scratchpad，不進 repo）
4. 實際重載 extension + 重新整理分頁
5. 有 runtime surface 的改動，必須在 X/Threads 真實操作；發文是對外行為，除非使用者明確授權，不可代發
6. 檢查 Chrome 擴充功能錯誤頁為空、分頁 console 無新 error
7. 驗證 vault 實際檔案與 frontmatter，不以 toast 當成功證據

已驗證基線：

- X：真實 CreateTweet XHR → parser → background → Obsidian → exact `source_url` → toast 全管線通過
- X 與 Threads：使用者已確認草稿暫存狀態成功
- popup v1.4.0：新增未發佈草稿、最近儲存與 storage 即時更新；尚待使用者最終目視驗收

## 修改紀律

- 保持零依賴；可用原生 Chrome/Web API 就不加套件。
- 不為單次用途新增抽象；共用邏輯放 `content/common.js`。
- DOM selector 限定 composer/dialog，避免誤抓搜尋框或其他 textbox。
- 不能只靠文字匹配發佈按鈕；優先平台穩定屬性/API，文字只作精確備援。
- 不把草稿成功做成系統通知；高頻打字不可轟炸使用者。
- 不在 console 印 API Key、完整私人貼文或平台 response body。
- 大改 content script 前先確認 git 可回復；完成後 commit，不 push。
- 每個修改都要能對應使用者需求；不相干問題只記錄、不順手改。

## 開發與設定

Load unpacked：`chrome://extensions/` → Developer mode → Load unpacked → 選 repo 根目錄。

Obsidian 需求：啟用 `obsidian-local-rest-api`，popup 設定 API Key、port、vault 內相對路徑。設定存於 `chrome.storage.local`，不是 repo 檔案。
