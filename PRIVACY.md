# 隱私權政策

最後更新：2026-07-18

Social Post to Obsidian（以下稱「本擴充功能」）的單一用途，是將使用者自己在 X 或 Threads 撰寫與發佈的貼文備份至使用者指定的 Obsidian Vault。

## 本擴充功能處理的資料

為提供上述功能，本擴充功能會在使用者的裝置上處理：

- 使用者輸入的 X／Threads 草稿與已發佈貼文文字。
- 貼文來源網址、發佈時間、回覆與引用貼文資訊。
- 使用者貼文中的靜態圖片、圖片網址與替代文字。
- Obsidian Local REST API Key、port、筆記路徑與圖片路徑設定。
- 待補存貼文、最近五筆存檔資訊與草稿存檔狀態。

本擴充功能不會讀取使用者未撰寫或未發佈的其他動態消息內容，也不會存取瀏覽紀錄、cookies、密碼、金融或健康資料。

## 資料如何使用與傳送

- 貼文資料只用於產生 Markdown 筆記、下載該貼文的圖片，以及在 Obsidian 未連線時重試存檔。
- 文字與設定由擴充功能直接在瀏覽器內處理，並透過 `127.0.0.1` 傳送至同一台裝置上的 Obsidian Local REST API。
- 圖片由瀏覽器直接向 X 或 Meta 使用的圖片 CDN 下載，再寫入 Obsidian Vault。
- 本專案沒有開發者營運的後端伺服器，不會接收貼文、API Key、使用紀錄或分析資料。
- 本擴充功能不販售、出租、轉讓或分享使用者資料，不用於廣告、信用評估或任何與核心功能無關的用途，也不允許開發者或其他人員讀取使用者資料。

## 本機儲存與保存期間

下列資料保存在 `chrome.storage.local`，只供本擴充功能在目前的 Chrome 設定檔中使用：

- API Key、port 與 Vault 路徑：保存至使用者修改設定、清除擴充功能資料或移除擴充功能為止。
- 離線佇列：最多 50 則，成功補存後即移除；若持續無法連線，會保留至使用者清除資料或移除擴充功能為止。
- 最近存檔資訊：只保留最近五筆。
- 草稿狀態：在貼文發佈後移除；實際草稿 Markdown 由使用者的 Obsidian Vault 管理。

寫入 Vault 的 Markdown 與圖片由使用者自行管理與刪除。個別遠端圖片下載失敗時，Markdown 可能保留該圖片的原始 CDN 網址。

## 安全

API Key 儲存在 Chrome extension local storage，請勿分享 Chrome 設定檔或偵錯輸出。使用者可選擇 Local REST API 的 HTTPS port `27124`；HTTP port `27123` 只連接同一台裝置的 `127.0.0.1`。

## 使用者控制與刪除

使用者可以：

- 在 Popup 修改 API Key、port 與 Vault 路徑。
- 在 Chrome 的擴充功能管理頁移除本擴充功能，以清除其 local storage。
- 在 Obsidian 中自行查看、修改或刪除已建立的 Markdown 與圖片。

## Chrome Web Store Limited Use

本擴充功能對使用者資料的使用，僅限於提供或改善其單一、明確的使用者可見功能。資料不會轉移給第三方，不會用於個人化廣告，也不會由人員讀取；若法律另有要求，則依適用法律辦理。

## 變更與聯絡

政策有重大變更時，將在本頁更新日期與內容。一般問題可使用 [GitHub Issues](https://github.com/lostshin/social-post-to-obsidian/issues)；若內容涉及 API Key、私人貼文或安全漏洞，請依[安全政策](SECURITY.md)使用 GitHub 私人漏洞回報。
