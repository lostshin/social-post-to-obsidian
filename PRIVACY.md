# 隱私權政策

最後更新：2026-07-19

Social Post to Obsidian（以下稱「本擴充功能」）的單一用途，是將使用者自己在 X 或 Threads 撰寫與發佈的貼文備份至使用者指定的 Obsidian Vault。

## 處理的資料

為提供上述功能，本擴充功能會在使用者的裝置上處理：

- 使用者正在輸入的 X／Threads 草稿與剛發佈的貼文文字。
- 貼文來源網址、發佈時間、回覆目標，以及使用者主動引用之貼文的作者名稱、網址與文字。
- 使用者貼文中的靜態圖片、圖片網址與替代文字。
- 寫入模式、Vault 名稱、筆記路徑與圖片路徑。
- 選擇 Local REST API 模式時輸入的 API Key 與 port。
- 待補存貼文、最近五筆存檔資訊與草稿存檔狀態。

本擴充功能不會讀取一般動態消息、私訊、cookies、密碼、完整瀏覽紀錄、金融資料或健康資料。它只處理完成備份功能所需的 X／Threads 撰寫與發佈事件，以及與該貼文直接相關的內容。

## 資料如何使用與傳送

- 貼文資料只用於產生 Markdown、下載該貼文的圖片、顯示 Popup 存檔狀態，以及在寫入失敗時重試。
- **本機 Helper 模式（預設）**：Chrome extension 透過 Native Messaging，將資料傳給使用者自行安裝、同一台 Mac 上的開源 Helper，再直接寫入使用者選定的 Vault。資料不會送往開發者伺服器。
- **Local REST API 模式（選用）**：Chrome extension 將資料傳至同一台裝置的 `127.0.0.1` Obsidian Local REST API；API Key 只用於這個本機連線。
- 圖片由 Chrome 直接向 X 或 Meta 使用的圖片 CDN 下載，再寫入 Vault；個別圖片失敗時，Markdown 可能保留該 CDN 網址。
- 本專案沒有開發者營運的後端、分析、遙測或廣告服務。開發者不會收到或讀取貼文、API Key、Vault 路徑、使用紀錄或 Helper 設定。
- 本擴充功能不販售、出租、分享或轉移使用者資料，不用於廣告、信用評估或任何與核心功能無關的用途。

## 本機儲存與保存期間

`chrome.storage.local` 可能保存：

- 寫入模式、可選的 API Key 與 port、Vault 顯示名稱、筆記路徑與圖片路徑：保存至使用者修改設定、清除擴充功能資料或移除擴充功能。
- 離線佇列：最多 50 則；補存成功後移除，否則保留至使用者清除資料或移除擴充功能。
- 最近存檔資訊：只保留最近五筆。
- 草稿狀態：發佈或刪除後移除；實際草稿 Markdown 由使用者的 Vault 管理。

本機 Helper 會把使用者選定的 Vault 絕對路徑保存在：

```text
~/Library/Application Support/Social Post to Obsidian/config.json
```

移除 Chrome extension 不會自動刪除此檔案；可執行 `./native/uninstall-host.sh --purge` 一併清除。寫入 Vault 的 Markdown 與圖片則由使用者自行保管。

## 安全

- Native Messaging 僅允許安裝程式寫入之特定 Chrome extension ID 存取，且 Host 會拒絕 Vault 外路徑與 symbolic link 路徑。
- Native Messaging 是同一台裝置內的程序間通訊；不會經過網際網路。
- REST API Key 只保存在 Chrome extension local storage，並只傳送到使用者選擇的本機 `127.0.0.1` port。請勿分享 Chrome profile 或包含 API Key 的偵錯輸出。
- 本擴充功能不載入或執行遠端程式碼。

## 使用者控制與刪除

使用者可以：

- 在 Popup 切換寫入模式、修改路徑、API Key 與 port。
- 清除自動草稿、刪除最近儲存的 Vault 筆記，或同步已在 Obsidian 外部刪除的筆記狀態。這些操作不會刪除社群平台原文。
- 在 Obsidian 或檔案系統查看、修改與刪除已建立的 Markdown 與圖片。iCloud Vault 的 Popup 刪除會透過 Finder 移到垃圾桶；其他本機 Vault 可能直接刪除檔案。
- 在 `chrome://extensions/` 移除本擴充功能，以清除該 Chrome profile 的 extension local storage。
- 使用 `./native/uninstall-host.sh` 移除 Helper，或加上 `--purge` 同時刪除 Helper 的 Vault 設定。

## Chrome Web Store Limited Use

本擴充功能使用從 Chrome API 與網站頁面取得的資訊時，遵守 [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data)，包括 Limited Use requirements。資料只用於提供或改善上述單一、明確且使用者可見的備份功能；不會用於個人化廣告、轉售、信用評估，也不會允許人員讀取，法律或安全義務另有要求者除外。

## 變更與聯絡

政策有重大變更時，會更新本頁日期與內容。一般問題可使用 [GitHub Issues](https://github.com/lostshin/social-post-to-obsidian/issues)；若涉及 API Key、私人貼文或安全漏洞，請依 [SECURITY.md](SECURITY.md) 使用 GitHub Private vulnerability reporting。
