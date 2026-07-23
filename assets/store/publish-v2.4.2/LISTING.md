# Chrome Web Store 上架文案（v2.4.2）

本版沿用 `Social Post to Obsidian` 名稱、Productivity 類別、既有圖片素材、權限理由與 Privacy practices。只更新繁中／英文商店文案與 extension package；`v2.4.2` 沒有新增 Chrome 權限，也沒有修改 Native Helper。

## 商品識別

- Extension ID：`jdfempgjnmdlokacfjmnipihhghcnomb`
- Name：`Social Post to Obsidian`
- Version：`2.4.2`
- Category：`Productivity`
- Visibility：`Public`
- Regions：`All regions`

## 中文（繁體）

### 摘要

```text
把 X、Threads 直接當筆記軟體。貼文、串文與靜態圖片會自動存進 Obsidian，不必多按擷取按鈕；少一次切換，也少一點寫作阻力，對 AuDHD 更友善。
```

### 詳細說明

```text
把社群媒體直接當筆記軟體。

很多想法，本來就寫在 X 或 Threads。可能是一句話，也可能一路寫成串文。Social Post to Obsidian 不叫你搬家，也不多塞一個收件匣。照常發文，文字、串文與靜態圖片就會整理成 Markdown，存進你自己的 Obsidian Vault。

發文後不用再回頭整理。沒有擷取按鈕，也不用切到 Obsidian 複製貼上。這一步消失了。

發出去，就存下來

一則短文會存，連續串文也會照順序存。每則內容放在獨立、可直接複製的 Markdown code block，來源網址、發佈時間、平台、回覆、引用與串文數量也會一併保存。

少一個打斷思路的地方

如果你有 AuDHD，可能很熟悉這種中斷：文章寫到一半，卻卡在切換工具、整理格式或記得存檔。多一個按鈕，就多一個斷掉思路的地方。

這個流程把「記得整理」拿掉了。打開 X 或 Threads，寫完就發。歸檔交給擴充功能。

不用多記一件事

• 發佈 X 或 Threads 貼文後自動建立 Markdown
• 保存單則貼文、連續串文與靜態圖片
• 撰寫時自動暫存草稿，正式貼文成功存檔後才清除
• Obsidian 暫時無法使用時排入佇列，連線恢復後自動補存
• 可自訂筆記與附件路徑
• 從 Popup 預覽、開啟或刪除草稿與最近存檔

資料留在自己的 Vault

macOS 使用者可安裝開源 Native Helper，直接寫入自己的 Vault，不需要 Obsidian 外掛或 API Key。Windows、Linux，或不想安裝 Helper 的使用者，可以改用 Obsidian Local REST API。

本專案沒有開發者後端、遙測、分析或廣告，也不會載入遠端程式碼。你的文字、圖片與設定只會在自己的裝置上處理。

目前支援靜態圖片；影片與動態 GIF 不會下載。

本專案是獨立開源工具，未受 X、Meta、Threads、Obsidian 或其關係企業贊助、認可或維護。
```

## English

### Summary

```text
Use X and Threads as your notes. Posts and threads save to Obsidian automatically—no capture button, AuDHD-friendly.
```

### Detailed description

```text
Use social media as your note-taking app.

A lot of writing starts on X or Threads: one sentence at first, then maybe a whole thread. Social Post to Obsidian lets you keep writing there. Publish as usual, and the text, thread order, and static images are saved as Markdown in your own Obsidian Vault.

Once the post is out, there is nothing else to remember. No capture button. No copy-and-paste trip back to Obsidian.

Post it. Keep it.

A short post is saved. A long thread is saved in order. Each post stays in its own copyable Markdown code block, together with the source URL, publish time, platform, replies, quotes, and thread count.

One less place to lose your train of thought

If you have AuDHD, you may know the point where a good thought disappears between tabs, formatting, and little maintenance tasks. One extra button is one more place to stop.

This workflow removes the “remember to file it” step. Open X or Threads, write, and publish. The extension does the filing.

Nothing extra to remember

• Create Markdown automatically after publishing on X or Threads
• Preserve individual posts, multi-post threads, and static images
• Autosave drafts and remove them only after the published post is safely stored
• Queue interrupted saves and retry when Obsidian becomes available again
• Choose your own note and attachment paths
• Preview, open, or delete drafts and recent saves from the popup

Your writing stays in your Vault

On macOS, the open-source Native Helper writes directly to your Vault without an Obsidian plugin or API key. Windows and Linux users—or anyone who prefers not to install the Helper—can use the Obsidian Local REST API instead.

There is no developer-operated backend, telemetry, analytics, advertising, or remote code. Your writing, images, and settings are processed only on your own device.

Static images are supported. Videos and animated GIFs are not downloaded.

This is an independent open-source project and is not sponsored, endorsed, or maintained by X, Meta, Threads, Obsidian, or their affiliates.
```

## v2.4.2 審查補充

### Reviewer note

```text
Version 2.4.2 updates Threads media capture to support the current official web publishing endpoints:

- configure_text_only_post
- configure_text_post_app_feed
- configure_text_post_app_sidecar

It also accepts the current permalink-based response shape and preserves the largest available static-image candidate. No Chrome permissions, host permissions, data-use practices, or remote-code behavior have changed. The Native Helper remains version 1.1.3.

Recommended macOS test path:
1. Download the matching macOS helper ZIP from the GitHub Release.
2. Run: ./native/install-host.sh jdfempgjnmdlokacfjmnipihhghcnomb
3. Reload the extension, open the popup, choose a folder containing .obsidian, and save settings.
4. Publish a test post on X or Threads and verify the generated Markdown in the selected Vault.

Alternative test path on any OS:
1. Install the Obsidian Local REST API community plugin.
2. Select Local REST API in the popup and enter the local API key and port.

No developer-operated server, paid account, analytics service, or remote code is used. Reviewers may use their own X or Threads test account.
```

## 上傳資料

- Extension ZIP：GitHub Release `v2.4.2` 的 `social-post-to-obsidian-v2.4.2.zip`
- Helper ZIP：只放 GitHub Release，不上傳 Chrome Web Store
- 圖片素材：沿用 `assets/store/publish-v2.4.0/`
- Permission justifications：沿用 `assets/store/publish-v2.4.0/LISTING.md`
- Privacy practices：沿用 `assets/store/publish-v2.4.0/LISTING.md`
