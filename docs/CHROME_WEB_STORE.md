# Chrome Web Store 發布指南

本文件整理 `v2.4.0` 的上架文案、權限理由、隱私揭露、Native Helper 測試方式與送審清單。Chrome 政策與 Dashboard 欄位會改變，實際送審前仍須重新核對官方的 [Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)、[Prepare your extension](https://developer.chrome.com/docs/webstore/prepare) 與 [Privacy practices](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/)。本次可直接上傳的最終文案與素材清單見 [`assets/store/publish-v2.4.0/LISTING.md`](../assets/store/publish-v2.4.0/LISTING.md)。

## 1. 目前發布狀態

Repository 已具備：

- Manifest V3 extension ZIP 與 macOS Helper ZIP 自動封裝。
- GitHub Actions 驗證、tag release 與 SHA-256 checksum。
- MIT License、安裝指南、隱私權政策、安全政策與 issue／PR templates。
- 128×128 icon、1280×800 圖片與 440×280 small promo。
- 可直接貼入 Dashboard 的 listing、權限理由、Privacy practices 與 reviewer instructions。

發布者仍須在 Dashboard 完成：

1. 已建立 Chrome Web Store item；固定 extension ID 為 `jdfempgjnmdlokacfjmnipihhghcnomb`。
2. 以正式商店 ID 實跑 `./native/install-host.sh jdfempgjnmdlokacfjmnipihhghcnomb`。
3. 建立公開 GitHub `v2.4.0` Release，讓 reviewer 可取得同版本 Helper。
4. 上傳 `assets/store/publish-v2.4.0/` 的三張 1280×800 screenshot、small promo 與 marquee promo。
5. 提供可公開存取的隱私權政策 URL，並確認開發者聯絡信箱與兩步驟驗證有效。

## 2. 建立與辨識發布檔案

```bash
node scripts/validate-extension.mjs
node tests/media-sync.test.mjs
./scripts/package-extension.sh
```

輸出：

| 檔案 | 用途 |
| --- | --- |
| `dist/social-post-to-obsidian-v2.4.0.zip` | 上傳 Chrome Web Store，也供 GitHub 手動安裝 |
| `dist/social-post-to-obsidian-helper-v2.4.0-macos.zip` | 商店版 macOS 使用者另行安裝 Native Helper |
| `dist/SHA256SUMS` | GitHub Release 下載驗證 |

只把 extension ZIP 上傳 Chrome Web Store。ZIP 根目錄已直接包含 `manifest.json`；Helper ZIP 與 checksum 只放 GitHub Release。

送審前解壓縮 extension ZIP，以該資料夾完成 Load unpacked 驗收，避免測到 repository 中未封裝的檔案。Chrome 官方要求 manifest 位於 ZIP 根目錄，且每次上傳新版都必須提高 manifest version。

## 3. Store listing 文案

### Name

`Social Post to Obsidian`

### Summary

`發佈 X 與 Threads 貼文後，自動將文字與靜態圖片備份至自己的 Obsidian Vault。`

### Category 與語言

- Category：`Productivity`
- Primary language：`中文（繁體）`
- Mature content：否

### Single purpose

`將使用者自己在 X 或 Threads 撰寫與發佈的貼文文字、來源資訊與靜態圖片，備份至使用者指定的本機 Obsidian Vault。`

### Detailed description

```text
Social Post to Obsidian 會在你發佈 X 或 Threads 貼文後，自動將內容備份成 Obsidian Markdown 筆記。

macOS 使用者可安裝本專案隨附的開源 Native Helper，直接寫入自己的 Vault，不需要 Obsidian 外掛或 API Key。Chrome Web Store 基於安全限制不會自動執行本機安裝程式；Helper 需依安裝說明從同版本 GitHub Release 另行下載。Windows、Linux 或不想安裝 Helper 的使用者，可以改用 Obsidian Local REST API 模式。

主要功能：
• 備份貼文文字、來源網址、發佈時間、回覆與引用資訊
• 將 X 多圖與 Threads 單圖、輪播圖下載至自訂附件路徑
• 撰寫時自動暫存草稿，發佈後清除草稿檔
• 寫入暫時失敗時保留待補存佇列，恢復後自動重試
• Popup 預覽與開啟草稿／最近五筆存檔
• 從 Popup 刪除 Vault 筆記，或同步已在 Obsidian 外部完成的刪除

所有文字與設定只在使用者自己的裝置上處理。專案沒有開發者後端、遙測、分析、廣告或遠端執行程式碼。圖片只會由原平台 CDN 下載，再寫入使用者自己的 Vault。

目前同步靜態圖片；影片與動態 GIF 不會下載。

本專案是獨立開源工具，未受 X、Meta、Threads、Obsidian 或其關係企業贊助、認可或維護。
```

### URL 欄位

- Homepage URL：`https://github.com/lostshin/social-post-to-obsidian`
- Support URL：`https://github.com/lostshin/social-post-to-obsidian/issues`
- Privacy policy URL：`https://github.com/lostshin/social-post-to-obsidian/blob/main/PRIVACY.md`
- Official URL：只有在 Search Console 驗證自己擁有的網域後才填；GitHub repository URL 不一定會出現在可選清單，不要宣稱未取得的 verified publisher 狀態。

## 4. 權限與網站存取理由

Dashboard 若要求逐項說明，可使用下列文案：

| 權限或網站 | 用途 |
| --- | --- |
| `storage` | 在目前 Chrome profile 保存寫入模式、Vault 顯示名稱、相對路徑、選用的 REST API 設定、最多 50 則離線佇列、草稿狀態與最近五筆存檔資訊。 |
| `nativeMessaging` | 在 macOS 與使用者自行安裝的開源 Native Helper 通訊，將 Markdown 與圖片直接寫入使用者選定的 Vault。Host 只允許特定 extension ID。 |
| `notifications` | 原始 X／Threads 分頁已不存在時，才以系統通知回報正式貼文存檔或補存結果。 |
| `alarms` | 每分鐘重試離線佇列，並定期執行 best-effort Vault 維護。 |
| `x.com`、`twitter.com`、`threads.com` | 偵測使用者自己的撰寫與發佈動作，從對應發佈回應取得剛發佈貼文的文字、網址與媒體資訊。 |
| `127.0.0.1:27123`、`127.0.0.1:27124` | 只在使用者選擇 Local REST API 模式時，連接同一台裝置上的 Obsidian 外掛。 |
| `pbs.twimg.com`、`*.cdninstagram.com`、`*.fbcdn.net` | 下載使用者剛發佈貼文中的靜態圖片。 |

專案未要求 `tabs`、`cookies`、`history`、`webRequest`、`scripting` 或 `<all_urls>`。若新增權限，必須先更新程式、隱私政策、listing 與 Dashboard 揭露後才能送審。

## 5. Privacy practices

### Single purpose

使用第 3 節的 Single purpose 原文，保持 manifest、listing、Popup 與 [`PRIVACY.md`](../PRIVACY.md) 一致。

### Remote code

選擇：`No, I am not using remote code.`

理由：所有 JavaScript 都包含在 extension ZIP；專案不使用 `eval()`、`new Function()` 或外部 script。X／Meta API 回應與圖片 CDN 內容只當資料處理，不當程式碼執行。Native Helper 是使用者明確下載安裝的本機 companion，透過 Chrome 官方 Native Messaging API 通訊，其完整原始碼也包含在公開 repository 與提交 ZIP。

### Data usage

依 Dashboard 當下提供的名稱，保守揭露：

- Authentication information：只有選擇 REST 模式的使用者輸入之 API Key。
- Personally identifiable information：貼文來源或引用資訊中可能包含使用者名稱與顯示名稱。
- Website content／User-generated content：草稿、貼文、引用文字、來源網址、圖片與圖片替代文字。

不要勾選未處理的金融、健康、位置、cookies 或完整 browsing history。來源網址只用於使用者明確要求的貼文備份，不建立一般瀏覽紀錄。

認證聲明：

- 資料只用於提供或改善單一備份功能。
- 不販售資料，不用於個人化廣告或信用評估。
- 不轉移給與單一用途無關的第三方。
- 不允許人員讀取；法律、安全或使用者明確授權的個案除外。
- 遵守 Chrome Web Store User Data Policy，包括 Limited Use requirements。

本機處理也必須揭露；不能因為沒有開發者後端就選擇「不收集任何資料」。Dashboard 揭露須與公開隱私權政策一致。

## 6. 圖片素材

依官方 [Supplying Images](https://developer.chrome.com/docs/webstore/images) 檢查：

| 素材 | 檔案 | 狀態 |
| --- | --- | --- |
| Store icon 128×128 | `icons/icon128.png` | 已備妥 |
| Actual UI screenshot 1280×800 | `assets/store/publish-v2.4.0/01-popup.png` | 已用隔離的乾淨展示資料產生 |
| Markdown output 1280×800 | `assets/store/publish-v2.4.0/02-markdown.png` | 已備妥 |
| Workflow infographic 1280×800 | `assets/store/publish-v2.4.0/03-workflow.png` | 已備妥 |
| Small promo 440×280 | `assets/store/publish-v2.4.0/small-promo.png` | 已備妥 |
| Marquee promo 1400×560 | `assets/store/publish-v2.4.0/marquee-promo.png` | 已備妥，選填 |

實際 UI screenshot 必須使用乾淨的隔離 Chrome profile，不含真實 Vault 名稱、API Key、私人貼文或個人資料。截圖需 full bleed、方角，並在縮成 640×400 後仍可讀。

## 7. Reviewer instructions

即使 Dashboard 標示選填，也建議提供，因為完整功能需要 Obsidian 與本機 Helper：

```text
This extension has one purpose: back up the reviewer's own X or Threads posts to a user-selected local Obsidian Vault.

Recommended macOS test path:
1. Download the matching macOS helper ZIP from the GitHub Release linked on the listing.
2. Use this item's 32-character extension ID: jdfempgjnmdlokacfjmnipihhghcnomb.
3. Run: ./native/install-host.sh jdfempgjnmdlokacfjmnipihhghcnomb
4. Reload the extension, open the popup, choose a folder containing .obsidian, and save settings.
5. Open X or Threads, compose a test post, and verify the generated Markdown in the selected Vault.

Alternative test path on any OS:
1. Install the Obsidian Local REST API community plugin.
2. Select Local REST API in the popup and enter the local API key and port.

No developer-operated server, paid account, analytics service, or remote code is used. The extension does not provide or collect X/Threads credentials; reviewers may use their own test account. Native Helper source is included in the submitted package under native/ and in the public repository.
```

若尚未建立公開 GitHub Release，不要先送審，否則 reviewer 無法取得商店版所需的 Helper。

## 8. 最終送審清單

1. `main` CI 全綠；tag、manifest 與 ZIP version 完全一致。
2. GitHub Release 已公開，兩個 ZIP 與 `SHA256SUMS` 可下載。
3. 以正式商店 extension ID 安裝 Helper並完成 Popup、X、Threads、刪除與離線補存驗收。
4. Extension ZIP 根目錄含 `manifest.json`，沒有測試、`.github`、`AGENTS.md`、`CLAUDE.md` 或秘密資料。
5. Listing 明確說明 macOS Helper 是額外安裝，且 REST 是跨平台替代方案。
6. Actual UI screenshot、icon、small promo 均已上傳且不含私人資料。
7. Permission justification、Remote code、Data usage 與 `PRIVACY.md` 完全一致。
8. Developer account 的隱私政策、聯絡信箱、distribution 與兩步驟驗證已完成。
9. 先用 Trusted testers 或 Unlisted 驗證安裝流程，再提交 Public review。
10. 發布後把 Chrome Web Store 正式連結補回 README 與 repository About。

上傳與送審步驟可參考官方 [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)、[Complete your listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/) 與 [Review process](https://developer.chrome.com/docs/webstore/review-process)。
