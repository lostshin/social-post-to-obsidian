# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome extension (Manifest V3) that automatically archives social media posts from Twitter/X and Threads to Obsidian via the Local REST API plugin.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Content Script │────▶│  Background.js   │────▶│  Obsidian API   │
│  (per platform) │     │  (Service Worker)│     │  (Local REST)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │
        │                        │
        ▼                        ▼
  - twitter.js              Message Types:
  - threads.js              - SAVE_DRAFT
                            - PUBLISH_DRAFT
                            - SAVE_POST
```

### Message Flow

1. **Content scripts** (`content/*.js`) detect post button clicks and input changes on social platforms
2. Scripts extract post content (including thread posts and quoted posts) and send messages to background
3. **Background service worker** (`background.js`) receives messages and calls Obsidian Local REST API
4. Posts are saved as Markdown files with YAML frontmatter

### Key Components

- **Content Scripts**: Platform-specific extractors using MutationObserver for dynamic DOM, debounced draft saving (3s)
- **Background**: Handles API calls, generates Markdown with frontmatter, manages draft lifecycle (save → publish → delete draft)
- **Popup**: Settings UI for API key, port, and save path configuration (stored in `chrome.storage.local`)

## Development

No build step required. Load unpacked extension directly in Chrome:
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select project directory

### Testing Changes

- Reload extension in `chrome://extensions/` after modifying `manifest.json` or `background.js`
- Content scripts update on page refresh
- Check DevTools console for `[Social Post to Obsidian]` prefixed logs

### Dependencies

- Requires Obsidian with [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin enabled
- Default API port: 27123 (HTTP) or 27124 (HTTPS)
