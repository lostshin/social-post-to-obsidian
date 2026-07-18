<p align="center">
  <img src="icons/logo.svg" width="88" height="88" alt="Social Post to Obsidian logo">
</p>

<h1 align="center">Social Post to Obsidian</h1>

<p align="center">
  發佈 X 與 Threads 貼文後，自動將文字與圖片備份到自己的 Obsidian Vault。
</p>

![Social Post to Obsidian 預覽](assets/social-preview.png)

## 功能

- 發佈 X 或 Threads 貼文後自動建立 Markdown 筆記
- 將貼文圖片下載到 Vault，並用相對路徑嵌入筆記
- 支援 X 多圖與 Threads 單圖、輪播圖及純圖片貼文
- 保留來源網址、發佈時間、回覆關係與引用貼文
- 打字時暫存草稿，發佈後自動清除草稿檔
- Obsidian 未開啟時加入離線佇列，恢復連線後自動補存
- Popup 顯示連線狀態、未發佈草稿與最近儲存紀錄
- 無第三方 JavaScript 依賴、無雲端服務、無分析追蹤

## 儲存結果

預設路徑為 `個人創作/社群推文`。每則貼文會產生一個 Markdown 檔，圖片則存放在同一層的專屬附件資料夾：

```text
個人創作/社群推文/
├── 2026-07-18_1100_圖片同步測試.md
└── _assets/
    └── 2026-07-18_1100_圖片同步測試/
        ├── image-01.jpg
        └── image-02.webp
```

Markdown 使用標準相對連結：

```markdown
![圖片說明](<_assets/2026-07-18_1100_圖片同步測試/image-01.jpg>)
```

若個別圖片下載失敗，文字筆記仍會正常儲存，並暫時保留該圖片的遠端網址。

## 使用需求

- Google Chrome 或其他支援 Manifest V3 的 Chromium 瀏覽器
- [Obsidian](https://obsidian.md/)
- Obsidian 社群外掛 [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)

## 安裝

目前採用開發者模式安裝：

1. 下載或 clone 此 repository。
2. 在 Chrome 開啟 `chrome://extensions/`。
3. 開啟右上角的「開發人員模式」。
4. 選擇「載入未封裝項目」，指定本專案資料夾。
5. 更新版本後，請在擴充功能頁重新載入，並重新整理已開啟的 X／Threads 分頁。

## 設定

1. 在 Obsidian 安裝並啟用 Local REST API。
2. 從該外掛設定複製 API Key。
3. 開啟擴充功能 Popup，貼上 API Key。
4. 設定連接埠：HTTP 預設為 `27123`，HTTPS 為 `27124`。
5. 視需要調整 Vault 內的存檔路徑，按下「儲存設定」並測試連線。

## 權限與隱私

所有貼文資料都由瀏覽器直接寫入本機 Obsidian Local REST API，不會傳送到本專案的伺服器，也沒有遙測或分析服務。

擴充功能使用的主要權限如下：

- `storage`：儲存 Local REST API 設定、離線佇列與最近存檔紀錄
- `notifications`：在原始分頁不存在時回報存檔結果
- `alarms`：定期重試離線佇列
- `127.0.0.1`：連接本機 Obsidian Local REST API
- X 與 Meta 圖片 CDN：下載使用者剛發佈貼文中的圖片

API Key 儲存在 Chrome 的 extension local storage。請勿分享包含個人設定的瀏覽器設定檔。

## 已知限制

- 目前同步靜態圖片；影片與動態 GIF 不會下載到 Vault。
- X 與 Threads 的內部 API 結構可能改變；若平台更新造成解析失效，請提交 issue 並附上平台、操作步驟與擴充功能版本，避免貼出 API Key 或私人貼文內容。
- 離線時間過長時，Threads 的簽章圖片網址可能失效；此時筆記仍會保存，但圖片可能只能留下原始遠端連結。

## 開發與驗證

本專案使用原生 JavaScript、HTML 與 CSS，不需要安裝 package。提交前請執行：

```bash
node scripts/validate-extension.mjs
node tests/media-sync.test.mjs
```

驗證內容包含 Manifest 與資產完整性、所有 JavaScript 語法，以及 X／Threads 圖片解析、Vault 二進位寫入、失敗降級與離線重試。

## 授權

本專案採用 [MIT License](LICENSE)。
