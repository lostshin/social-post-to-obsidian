<p align="center">
  <img src="icons/logo.svg" width="88" height="88" alt="Social Post to Obsidian logo">
</p>

<h1 align="center">Social Post to Obsidian</h1>

<p align="center">
  <strong>English</strong> · <a href="README.zh-TW.md">繁體中文</a>
</p>

<p align="center">
  Automatically archive your X and Threads posts—including threads and images—to your local Obsidian Vault.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/social-post-to-obsidian/jdfempgjnmdlokacfjmnipihhghcnomb"><img alt="Chrome Web Store" src="https://img.shields.io/badge/Chrome_Web_Store-Install-4285F4?logo=googlechrome&logoColor=white"></a>
  <a href="https://github.com/lostshin/social-post-to-obsidian/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/lostshin/social-post-to-obsidian?style=flat"></a>
  <a href="https://github.com/lostshin/social-post-to-obsidian/actions/workflows/validate.yml"><img alt="Validate Extension" src="https://github.com/lostshin/social-post-to-obsidian/actions/workflows/validate.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-6E56B3.svg"></a>
</p>

![Social Post to Obsidian workflow demo](assets/demo.gif)

The 20-second demo uses the actual extension popup with isolated sample data; it does not contain private account content. A high-resolution version is available as [MP4](assets/demo.mp4).

## Why this exists

Your writing should not live only on someone else's platform. Social Post to Obsidian quietly keeps a local Markdown copy whenever you publish on X or Threads—without sending your posts to a developer-operated server.

- Saves published posts as Markdown notes automatically.
- Preserves multi-post threads as structured, copyable sections.
- Downloads static images into a configurable Vault attachment folder.
- Keeps source URLs, timestamps, reply context, and quoted-post details.
- Auto-saves drafts, clears them after publishing, and retries queued saves after connection failures.
- Lets you preview, open, and delete recent notes from the extension popup.
- Uses no third-party JavaScript, developer backend, telemetry, or ads.

## Supported setups

| Write method | Supported environment | Requirements |
| --- | --- | --- |
| Native Helper (recommended) | macOS + Google Chrome | Included open-source Native Helper; no Obsidian plugin or API key |
| Local REST API | macOS, Windows, Linux + Google Chrome | Obsidian community plugin [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) and an API key |

Both methods require [Obsidian](https://obsidian.md/). The Native Helper currently supports macOS only; use Local REST API on other operating systems.

## Install

### Install from the Chrome Web Store

1. Install [Social Post to Obsidian from the Chrome Web Store](https://chromewebstore.google.com/detail/social-post-to-obsidian/jdfempgjnmdlokacfjmnipihhghcnomb).
2. To use the recommended Native Helper on macOS, download `social-post-to-obsidian-helper-v*-macos.zip` from the matching [GitHub Release](https://github.com/lostshin/social-post-to-obsidian/releases).
3. Extract the archive and run:

   ```bash
   ./native/install-host.sh jdfempgjnmdlokacfjmnipihhghcnomb
   ```

Chrome Web Store extensions cannot install local programs automatically. If you prefer not to install the Helper, choose Local REST API in the popup instead.

### Install manually from a GitHub Release

1. Download and extract `social-post-to-obsidian-v*.zip` from [Releases](https://github.com/lostshin/social-post-to-obsidian/releases) into a permanent folder.
2. Open `chrome://extensions/`, enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.
3. On macOS, install the Native Helper from that folder:

   ```bash
   ./native/install-host.sh
   ```

4. Reload the extension, open its popup, and choose your Vault.

Chrome cannot load a ZIP directly. Keep the extracted folder in the same location when updating a manual installation, or the extension ID, settings, and Native Helper authorization may change.

Detailed update and removal instructions are currently available in [Traditional Chinese](INSTALL.md).

## Configure and use

1. Pin the extension to the Chrome toolbar and open its popup.
2. Native Helper mode: choose the root folder of a Vault containing `.obsidian`.
3. Local REST API mode: enter the API key and HTTP port `27123` or HTTPS port `27124`, then test the connection.
4. Adjust the note and media paths if needed, and save the settings.
5. Refresh any open X or Threads tabs, then write and publish as usual.

The popup separates unpublished drafts from recently saved posts. Opening a recent item jumps to the note in Obsidian; deleting it removes the Vault note, not the original social post.

## What gets saved

The default note folder is `個人創作/社群推文`, and the default media folder is `附件/Social Post to Obsidian`:

```text
個人創作/社群推文/
└── 2026-07-18_1100_圖片同步測試.md

附件/Social Post to Obsidian/
└── 2026-07-18_1100_圖片同步測試/
    ├── image-01.jpg
    └── image-02.webp
```

Notes use standard relative Markdown links that resolve from the note location. If an individual image download fails, the text note is still saved and keeps the remote image URL.

## Privacy and permissions

All post data stays between services and software chosen by the user:

```text
X / Threads tab
  → Chrome extension
  → macOS Native Helper or 127.0.0.1 Local REST API
  → your Obsidian Vault
```

- `storage`: stores the write method, paths, optional REST API settings, offline queue, and recent-save metadata.
- `nativeMessaging`: communicates with the user-installed macOS Helper.
- `notifications`: reports a completed published-post save when the originating tab no longer exists.
- `alarms`: retries the offline queue and maintains Vault activity state.
- X and Threads access: handles only posts the user is drafting or has just published and their related source context.
- X and Meta media CDN access: downloads static images from those posts.
- `127.0.0.1`: connects to the local Obsidian REST API plugin only when that mode is selected.

There is no developer-operated server, remote code, data sale, or data sharing. See the [Privacy Policy](PRIVACY.md) for details.

## Known limitations

- The Native Helper currently supports macOS and Google Chrome only. Windows, Linux, and other Chromium browsers can use Local REST API or contribute platform support.
- Only static images are downloaded; videos and animated GIFs are not synchronized.
- Internal X and Threads APIs can change. Remove API keys, cookies, private post content, and full platform responses before reporting parser issues.
- Threads image URLs use expiring signatures, so long offline periods may leave only remote URLs.
- On an iCloud Vault, macOS may ask for permission to let Ruby or Chrome control Finder the first time a note is deleted.

## Roadmap

Project direction is tracked openly with the [`roadmap` label](https://github.com/lostshin/social-post-to-obsidian/issues?q=state%3Aopen%20label%3Aroadmap). Current explorations include:

- [Native Helper support for Windows and Linux](https://github.com/lostshin/social-post-to-obsidian/issues/2)
- [Chromium-based browser compatibility](https://github.com/lostshin/social-post-to-obsidian/issues/3)
- [Local preservation of videos and animated GIFs](https://github.com/lostshin/social-post-to-obsidian/issues/4)
- [Browser-level smoke tests for release packages](https://github.com/lostshin/social-post-to-obsidian/issues/5)

Roadmap issues describe desired outcomes, not promised release dates. Evidence from real workflows takes priority over feature count.

## Development, testing, and releases

The project uses native JavaScript, HTML, CSS, and macOS system Ruby. It has no build step or npm dependencies.

```bash
node scripts/validate-extension.mjs
node tests/media-sync.test.mjs
./scripts/package-extension.sh
git diff --check
```

The packaging script creates:

- `social-post-to-obsidian-v<version>.zip`: manual GitHub installation and Chrome Web Store package.
- `social-post-to-obsidian-helper-v<version>-macos.zip`: macOS Helper for Store users.
- `SHA256SUMS`: SHA-256 checksums for both archives.

See [CONTRIBUTING.md](CONTRIBUTING.md) before contributing. Chrome Web Store fields, permission justifications, and review instructions are documented in [docs/CHROME_WEB_STORE.md](docs/CHROME_WEB_STORE.md).

## Support and license

- Bugs and feature requests: [GitHub Issues](https://github.com/lostshin/social-post-to-obsidian/issues)
- Security reports: [SECURITY.md](SECURITY.md)
- License: [MIT](LICENSE)

This is an independent open-source project and is not sponsored, endorsed, or maintained by X, Meta, Threads, Obsidian, or their affiliates.

If this tool improves your writing workflow, consider starring the repository so more creators who care about content ownership can discover it.
