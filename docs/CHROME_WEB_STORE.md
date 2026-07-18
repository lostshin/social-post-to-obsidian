# Chrome Web Store 發布指南

本文件整理 v1.7.0 可直接使用的上架文案、權限理由、隱私揭露與發行步驟。實際送審前仍應重新核對 [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)，因政策與 Dashboard 欄位可能調整。

## 1. 發布前準備

1. 註冊 [Chrome Web Store Developer account](https://developer.chrome.com/docs/webstore/register)，完成一次性註冊費並啟用 Google Account 兩步驟驗證。
2. 確認 GitHub repository、[`PRIVACY.md`](../PRIVACY.md)、[`SECURITY.md`](../SECURITY.md) 均可公開存取。
3. 在 repository 的 About 設定：
   - Website：`https://github.com/lostshin/social-post-to-obsidian`
   - Topics：`chrome-extension`、`obsidian`、`twitter`、`threads`、`manifest-v3`、`local-first`
4. 確認 `main` 的 CI 全數通過。

## 2. 建立上傳 ZIP

```bash
./scripts/package-extension.sh
```

產出位於 `dist/social-post-to-obsidian-v<version>.zip`。ZIP 根目錄會直接包含 `manifest.json`，且只收入擴充功能執行所需檔案與 `LICENSE`，不包含測試、開發設定或文件。

送審前先解壓縮這份 ZIP，以 Load unpacked 完成 X、Threads、Popup 與 Obsidian 實際驗收。上傳方式可參考 Chrome 官方的 [Prepare your extension](https://developer.chrome.com/docs/webstore/prepare)。

## 3. Store listing 建議文案

### 名稱

`Social Post to Obsidian`

### Summary

`發佈 X 與 Threads 貼文後，自動將文字與圖片備份至自己的 Obsidian Vault。`

### Category 與語言

- Category：`Productivity`
- Primary language：`中文（繁體）`

### Single purpose

`將使用者自己在 X 或 Threads 撰寫與發佈的貼文文字、來源資訊與靜態圖片，直接備份至使用者指定的本機 Obsidian Vault。`

### Detailed description

```text
Social Post to Obsidian 會在你發佈 X 或 Threads 貼文後，自動將內容備份成 Obsidian Markdown 筆記。

主要功能：
• 備份貼文文字、來源網址、發佈時間、回覆與引用資訊
• 將 X 多圖與 Threads 單圖、輪播圖下載至自訂的 Vault 附件路徑
• 撰寫時自動暫存草稿，發佈後清除草稿檔
• Obsidian 未連線時保留待補存佇列，恢復連線後自動重試
• Popup 顯示連線狀態、未發佈草稿與最近五筆存檔

使用前需要：
1. 安裝 Obsidian
2. 安裝並啟用 Obsidian 社群外掛 Local REST API
3. 在擴充功能 Popup 輸入 Local REST API Key 與 Vault 路徑

隱私設計：
所有文字與設定只在瀏覽器及使用者自己的裝置上處理。本擴充功能沒有開發者後端、遙測、分析或廣告服務。圖片只會由原平台 CDN 下載，再寫入使用者的 Obsidian Vault。

目前支援靜態圖片；影片與動態 GIF 不會下載。
```

### URL 欄位

- Official URL：`https://github.com/lostshin/social-post-to-obsidian`
- Homepage URL：`https://github.com/lostshin/social-post-to-obsidian`
- Support URL：`https://github.com/lostshin/social-post-to-obsidian/issues`
- Privacy policy URL：`https://github.com/lostshin/social-post-to-obsidian/blob/main/PRIVACY.md`

## 4. 權限理由

Dashboard 若要求逐項說明，可使用下列文案：

| 權限或網站 | 用途 |
| --- | --- |
| `storage` | 在使用者的 Chrome 設定檔本機保存 Local REST API 設定、最多 50 則離線佇列、草稿狀態與最近五筆存檔資訊。 |
| `notifications` | 只有原始 X／Threads 分頁已不存在時，才以系統通知回報正式貼文存檔或補存結果。 |
| `alarms` | Obsidian 未連線時，每分鐘喚醒 service worker 重試離線佇列。 |
| `x.com`、`twitter.com`、`threads.com` | 偵測使用者自己的撰寫與發佈動作，取得剛發佈貼文的文字、網址與媒體資訊。 |
| `127.0.0.1:27123`、`127.0.0.1:27124` | 連接同一台裝置上的 Obsidian Local REST API，寫入 Markdown 與圖片。 |
| `pbs.twimg.com`、`*.cdninstagram.com`、`*.fbcdn.net` | 下載使用者剛發佈貼文中的靜態圖片。 |

這些都是目前功能實際使用的最小權限。專案未要求 `tabs`、`cookies`、`history`、`webRequest` 或 `<all_urls>`。

## 5. Privacy practices

實際 Dashboard 選項可能改版；送審時應採保守且與 [`PRIVACY.md`](../PRIVACY.md) 一致的揭露。此版本至少會處理：

- Authentication information：使用者輸入的 Obsidian Local REST API Key。
- Website content／user-generated content：使用者自己的 X／Threads 草稿與已發佈貼文文字、來源網址、回覆／引用資訊及圖片。

資料使用聲明：

- 不販售資料。
- 不將資料用於或轉移給與單一用途無關的服務。
- 不將資料用於信用評估、貸款或個人化廣告。
- 不允許人員讀取資料。
- 不使用開發者營運的伺服器；資料只會在瀏覽器、原平台圖片 CDN 與使用者同一台裝置上的 Obsidian Local REST API 之間流動。
- 接受 Chrome Web Store User Data Policy 的 Limited Use 要求。

## 6. 圖片素材

依 Chrome 官方的 [Supplying Images](https://developer.chrome.com/docs/webstore/images) 與 [Creating a great listing page](https://developer.chrome.com/docs/webstore/best-listing) 檢查：

- Store icon：`icons/icon128.png`（128×128，必填）。
- Screenshot：`assets/store/screenshot-overview.png`（1280×800，必填）。
- Small promo tile：`assets/store/small-promo.png`（440×280，必填）。
- Marquee promo：1400×560，選填；目前未提供。

送審前確認圖片仍符合最新 UI 與功能，且不包含真實 API Key、私人貼文或其他個人資料。

## 7. 送審與發布

1. 在 Developer Dashboard 建立新 item，上傳 ZIP。
2. 填完 Store listing 與 Privacy practices，加入公開隱私權政策 URL。
3. 選擇初次發布範圍；若要先驗收，可先採 Trusted testers。
4. 送審前再次比對 listing、Privacy practices、`PRIVACY.md` 與擴充功能實際行為。
5. 通過後發布。後續每次更新都使用較新的 `manifest.json.version` 與對應 GitHub Release ZIP。

Chrome 官方要求 listing 資訊準確、圖片完整、權限限於必要範圍，且所有新提交與更新都會進入審查流程。送審與審查方式請見 [Complete your listing information](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/) 與 [Review process](https://developer.chrome.com/docs/webstore/review-process)。
