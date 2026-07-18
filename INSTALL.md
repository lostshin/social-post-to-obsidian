# 安裝、更新與移除

Social Post to Obsidian 支援兩種 Vault 寫入方式：

| 模式 | 適用環境 | 額外需求 |
| --- | --- | --- |
| 本機 Helper（推薦） | macOS + Google Chrome | 安裝隨附的開源 Native Helper；不需要 Obsidian 外掛或 API Key |
| Local REST API | macOS、Windows、Linux + Google Chrome | Obsidian 社群外掛 [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 與 API Key |

兩種模式都需要先安裝 [Obsidian](https://obsidian.md/)。本機 Helper 目前只提供 macOS 版本，並使用系統內建的 `/bin/zsh` 與 `/usr/bin/ruby`。

## 從 GitHub Release 手動安裝

1. 從 [GitHub Releases](https://github.com/lostshin/social-post-to-obsidian/releases) 下載 `social-post-to-obsidian-v*.zip`。
2. 解壓縮到不會隨意移動的固定資料夾。Chrome 會以資料夾位置識別未封裝擴充功能。
3. 開啟 `chrome://extensions/`，啟用「開發人員模式」，按「載入未封裝項目」，選擇含有 `manifest.json` 的資料夾。
4. macOS 使用者若採本機 Helper，在終端機進入該資料夾後執行：

   ```bash
   ./native/install-host.sh
   ```

5. 回到 `chrome://extensions/` 按此外掛的「重新載入」。
6. 開啟 Popup，保持「本機 Helper（推薦）」，按「選擇 Vault」，選取含 `.obsidian` 的 Vault 根目錄。
7. macOS 首次要求資料夾或 Finder Automation 權限時按「允許」。

## 從 Chrome Web Store 安裝

Chrome Web Store 只能安裝擴充功能，不能代替使用者安裝 Native Helper。商店版使用者若採本機 Helper，需要再完成以下步驟：

1. 從同版本的 [GitHub Release](https://github.com/lostshin/social-post-to-obsidian/releases) 下載 `social-post-to-obsidian-helper-v*-macos.zip` 並解壓縮。
2. 開啟 `chrome://extensions/`，啟用「開發人員模式」，複製 Social Post to Obsidian 顯示的 32 字元 extension ID。
3. 在終端機進入 Helper 解壓縮資料夾，執行：

   ```bash
   ./native/install-host.sh <extension-id>
   ```

4. 回到 `chrome://extensions/` 按「重新載入」，再依上一節第 6–7 步選擇 Vault。

若不想安裝 Helper，可在 Popup 將「寫入方式」改成「Local REST API」，填入 API Key 與 port（HTTP `27123` 或 HTTPS `27124`），再測試並儲存設定。

## 開始使用

1. 重新整理已開啟的 `x.com` 或 `threads.com` 分頁。
2. 照平常方式撰寫並發佈貼文。
3. Popup 會顯示未發佈草稿、最近五筆存檔與待補存數量；箭頭可開啟 Obsidian 筆記，垃圾桶可刪除 Vault 筆記。
4. 筆記預設寫入 `個人創作/社群推文`，圖片預設寫入 `附件/Social Post to Obsidian`，兩者都能在 Popup 修改。

## 更新

- Chrome Web Store 版會自動更新擴充功能；若 Release notes 指出 Helper 有更新，請下載新版 Helper ZIP 並用相同 extension ID 重新執行安裝程式。
- GitHub 手動安裝版請保留原資料夾位置、用新版內容覆蓋後按「重新載入」。若改用不同資料夾，Chrome 可能產生不同 extension ID，原設定與 Helper 授權也不會自動轉移。
- 重新載入擴充功能後，務必重新整理已開啟的 X／Threads 分頁。

## 移除

1. 在 `chrome://extensions/` 移除擴充功能；這會清除該 Chrome profile 的外掛設定與離線佇列，不會刪除 Vault 中既有筆記。
2. macOS 使用者可在 Helper 解壓縮資料夾執行：

   ```bash
   ./native/uninstall-host.sh
   ```

   此指令會移除 Helper 與 Native Messaging manifest，但保留 Vault 選擇設定。若也要清除 Helper 設定，使用 `./native/uninstall-host.sh --purge`。

遇到問題時請先查看 [README 的已知限制](https://github.com/lostshin/social-post-to-obsidian#已知限制)，再到 [GitHub Issues](https://github.com/lostshin/social-post-to-obsidian/issues) 回報；不要貼出 API Key、私人貼文或完整平台回應。
