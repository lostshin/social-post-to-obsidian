import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

// Keep local-time filename assertions deterministic across developer machines and CI.
process.env.TZ = 'Asia/Taipei';
const manifestVersion = JSON.parse(readFileSync('manifest.json', 'utf8')).version;

function loadCommon() {
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    window: {
      addEventListener() {},
      postMessage() {}
    },
    document: {},
    chrome: {
      runtime: {
        id: 'test',
        getManifest: () => ({ version: manifestVersion }),
        onMessage: { addListener() {} }
      }
    }
  });
  vm.runInContext(readFileSync('content/common.js', 'utf8'), context);
  return context.SP2O;
}

const common = loadCommon();

function loadTwitterExtractor(nodes) {
  let pipelineConfig = null;
  const dialog = {
    querySelectorAll(selector) {
      return nodes.filter(node => (
        !selector.includes('[contenteditable="true"]')
        || node.getAttribute('contenteditable') === 'true'
      ));
    }
  };
  const context = vm.createContext({
    console,
    window: { location: { href: 'https://x.com/compose/post' } },
    document: {
      querySelector: selector => selector === '[role="dialog"]' ? dialog : null,
      querySelectorAll: () => [],
      addEventListener() {}
    },
    SP2O: {
      parseCreateTweet() {},
      createPublishPipeline(config) {
        pipelineConfig = config;
        return { capturePost() {}, init() {} };
      }
    }
  });
  vm.runInContext(readFileSync('content/twitter.js', 'utf8'), context);
  return pipelineConfig;
}

function createTwitterTextarea(testId, text, contenteditable = null) {
  return {
    innerText: text,
    textContent: text,
    getAttribute(name) {
      if (name === 'data-testid') return testId;
      if (name === 'contenteditable') return contenteditable;
      return null;
    },
    querySelector() { return null; }
  };
}

// X 的 label、RichTextInputContainer 與真正編輯器會共用 tweetTextarea_ 前綴，
// 只有 contenteditable 節點是使用者輸入，否則單則草稿會被擷取三次。
const twitterSingleDraft = loadTwitterExtractor([
  createTwitterTextarea('tweetTextarea_0_label', '同一段草稿'),
  createTwitterTextarea('tweetTextarea_0RichTextInputContainer', '同一段草稿'),
  createTwitterTextarea('tweetTextarea_0', '同一段草稿', 'true')
]);
assert.deepEqual(
  JSON.parse(JSON.stringify(twitterSingleDraft.getTextContent())),
  ['同一段草稿']
);

// 真正的兩個串文編輯器即使文字相同，仍須保留為兩則，不能按文字去重。
const twitterIdenticalThread = loadTwitterExtractor([
  createTwitterTextarea('tweetTextarea_0', '相同內容', 'true'),
  createTwitterTextarea('tweetTextarea_1', '相同內容', 'true')
]);
assert.deepEqual(
  JSON.parse(JSON.stringify(twitterIdenticalThread.getTextContent())),
  ['相同內容', '相同內容']
);

function loadThreadsExtractor(nodes) {
  let pipelineConfig = null;
  const dialog = { querySelectorAll: () => nodes };
  const context = vm.createContext({
    console,
    document: {
      querySelector: selector => selector === '[role="dialog"]' ? dialog : null,
      querySelectorAll: () => [],
      addEventListener() {}
    },
    SP2O: {
      parseThreadsCreate() {},
      createPublishPipeline(config) {
        pipelineConfig = config;
        return { capturePost() {}, init() {} };
      }
    }
  });
  vm.runInContext(readFileSync('content/threads.js', 'utf8'), context);
  return pipelineConfig;
}

const threadsThread = loadThreadsExtractor([
  createTwitterTextarea('threads_0', 'Threads 第一則', 'true'),
  createTwitterTextarea('threads_1', 'Threads 第二則', 'true')
]);
assert.deepEqual(
  JSON.parse(JSON.stringify(threadsThread.getTextContent())),
  ['Threads 第一則', 'Threads 第二則']
);

function loadDraftPipelineHarness(contentItems) {
  const messages = [];
  const timers = [];
  const inputListeners = {};
  const input = {
    addEventListener(type, listener) { inputListeners[type] = listener; }
  };
  const context = vm.createContext({
    console,
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout() {},
    MutationObserver: class { observe() {} },
    window: {
      location: { href: 'https://x.com/compose/post' },
      addEventListener() {},
      postMessage() {}
    },
    document: { readyState: 'complete', body: {} },
    chrome: {
      runtime: {
        id: 'test',
        lastError: null,
        getManifest: () => ({ version: manifestVersion }),
        sendMessage(message, callback) {
          messages.push(message);
          callback?.();
        },
        onMessage: { addListener() {} }
      }
    }
  });
  vm.runInContext(readFileSync('content/common.js', 'utf8'), context);
  const pipeline = context.SP2O.createPublishPipeline({
    platform: 'x',
    label: 'Twitter',
    parseResponse: () => null,
    getTextContent: () => contentItems,
    getDraftInputs: () => [input]
  });
  pipeline.init(() => {});
  inputListeners.input();
  return { messages, pipeline, timers };
}

const draftPipeline = loadDraftPipelineHarness(['串文第一則', '串文第二則']);
assert.equal(draftPipeline.timers.at(-1).delay, 500);
draftPipeline.timers.at(-1).callback();
assert.equal(draftPipeline.messages.at(-1).data.content, '串文第一則\n\n---\n\n串文第二則');
assert.deepEqual(
  JSON.parse(JSON.stringify(draftPipeline.messages.at(-1).data.thread)),
  ['串文第一則', '串文第二則']
);
draftPipeline.pipeline.capturePost();
assert.equal(draftPipeline.timers.at(-1).delay, 8000);
draftPipeline.timers.at(-1).callback();
assert.equal(draftPipeline.messages.at(-1).type, 'PUBLISH_DRAFT');
assert.deepEqual(
  JSON.parse(JSON.stringify(draftPipeline.messages.at(-1).data.thread)),
  ['串文第一則', '串文第二則']
);

function parseYamlFrontmatter(markdown) {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(markdown);
  assert.ok(match, 'Markdown must start with YAML frontmatter');
  const result = spawnSync('/usr/bin/ruby', [
    '-ryaml', '-rjson', '-e',
    'puts JSON.generate(YAML.safe_load(STDIN.read, permitted_classes: [], permitted_symbols: [], aliases: false))'
  ], { input: match[1] });
  assert.equal(result.status, 0, result.stderr.toString());
  return JSON.parse(result.stdout.toString());
}

function sendNativeHostMessage(message, configDirectory) {
  const payload = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  const result = spawnSync('/usr/bin/ruby', ['native/host.rb'], {
    input: Buffer.concat([header, payload]),
    env: { ...process.env, SP2O_CONFIG_DIR: configDirectory }
  });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.ok(result.stdout.length >= 4, 'Native host did not return a framed response');
  const responseLength = result.stdout.readUInt32LE(0);
  return JSON.parse(result.stdout.subarray(4, 4 + responseLength).toString());
}

const nativeTestRoot = mkdtempSync(join(tmpdir(), 'sp2o-native-test-'));
try {
  const vaultPath = join(nativeTestRoot, 'Test Vault');
  const configDirectory = join(nativeTestRoot, 'config');
  const mediaRoot = join(vaultPath, '附件', 'Social Post to Obsidian');
  mkdirSync(join(vaultPath, '.obsidian'), { recursive: true });

  assert.deepEqual(sendNativeHostMessage({ action: 'ping' }, configDirectory), {
    ok: true,
    configured: false,
    version: '1.1.3'
  });

  // framing 錯誤：host 需回傳 framed 錯誤訊息後結束，而不是直接崩潰
  {
    const result = spawnSync('/usr/bin/ruby', ['native/host.rb'], {
      input: Buffer.from([0x01, 0x02]),
      env: { ...process.env, SP2O_CONFIG_DIR: configDirectory }
    });
    assert.equal(result.status, 0, result.stderr.toString());
    assert.ok(result.stdout.length >= 4, 'Native host did not return a framed error response');
    const framedLength = result.stdout.readUInt32LE(0);
    const framedError = JSON.parse(result.stdout.subarray(4, 4 + framedLength).toString());
    assert.equal(framedError.ok, false);
    assert.match(framedError.error, /Invalid native message header/);
  }
  assert.equal(sendNativeHostMessage({ action: 'configure', vaultPath }, configDirectory).ok, true);
  assert.equal(sendNativeHostMessage({ action: 'ping' }, configDirectory).vaultName, 'Test Vault');

  assert.equal(sendNativeHostMessage({
    action: 'write',
    path: '個人創作/社群推文/test.md',
    encoding: 'utf8',
    data: '# native'
  }, configDirectory).ok, true);
  assert.equal(readFileSync(join(vaultPath, '個人創作', '社群推文', 'test.md'), 'utf8'), '# native');
  assert.equal(sendNativeHostMessage({
    action: 'exists',
    path: '個人創作/社群推文/test.md'
  }, configDirectory).exists, true);

  assert.equal(sendNativeHostMessage({
    action: 'write',
    path: '附件/Social Post to Obsidian/2026-07-18_1100_has-image/image-01.jpg',
    encoding: 'base64',
    data: Buffer.from([0xff, 0xd8, 0xff]).toString('base64')
  }, configDirectory).ok, true);
  assert.deepEqual(
    readFileSync(join(mediaRoot, '2026-07-18_1100_has-image', 'image-01.jpg')),
    Buffer.from([0xff, 0xd8, 0xff])
  );

  mkdirSync(join(mediaRoot, '2026-07-01_0900_old-empty'), { recursive: true });
  // 摘要為空字串的資料夾（檔名以底線結尾）也必須能被清理
  mkdirSync(join(mediaRoot, '2026-07-02_0900_'), { recursive: true });
  mkdirSync(join(mediaRoot, 'unrelated-empty'), { recursive: true });
  const cleanup = sendNativeHostMessage({
    action: 'cleanEmptyMediaFolders',
    path: '附件/Social Post to Obsidian'
  }, configDirectory);
  assert.equal(cleanup.removed, 2);
  assert.equal(existsSync(join(mediaRoot, '2026-07-01_0900_old-empty')), false);
  assert.equal(existsSync(join(mediaRoot, '2026-07-02_0900_')), false);
  assert.equal(existsSync(join(mediaRoot, 'unrelated-empty')), true);
  assert.equal(existsSync(join(mediaRoot, '2026-07-18_1100_has-image')), true);

  assert.equal(sendNativeHostMessage({
    action: 'write',
    path: '../outside.md',
    encoding: 'utf8',
    data: 'blocked'
  }, configDirectory).ok, false);
  assert.equal(sendNativeHostMessage({
    action: 'remove',
    path: '個人創作/社群推文/test.md'
  }, configDirectory).ok, true);
  assert.equal(existsSync(join(vaultPath, '個人創作', '社群推文', 'test.md')), false);
  assert.equal(sendNativeHostMessage({
    action: 'exists',
    path: '個人創作/社群推文/test.md'
  }, configDirectory).exists, false);
} finally {
  rmSync(nativeTestRoot, { recursive: true, force: true });
}

const xResponse = JSON.stringify({
  data: {
    create_tweet: {
      tweet_results: {
        result: {
          rest_id: '123456',
          core: { user_results: { result: { legacy: { screen_name: 'author' } } } },
          legacy: {
            full_text: '有兩張圖片',
            extended_entities: {
              media: [
                { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/first.jpg', ext_alt_text: '第一張' },
                { type: 'video', media_url_https: 'https://pbs.twimg.com/media/video-cover.jpg' },
                { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/second.png' }
              ]
            }
          }
        }
      }
    }
  }
});

const parsedX = common.parseCreateTweet(xResponse);
assert.equal(parsedX.url, 'https://x.com/author/status/123456');
assert.deepEqual(JSON.parse(JSON.stringify(parsedX.media)), [
  { url: 'https://pbs.twimg.com/media/first.jpg', alt: '第一張' },
  { url: 'https://pbs.twimg.com/media/second.png', alt: '圖片 3' }
]);

const threadsResponse = JSON.stringify({
  payload: {
    post: {
      pk: '987',
      code: 'ABC123',
      user: { username: 'author' },
      caption: { text: '' },
      carousel_media: [
        {
          accessibility_caption: '輪播第一張',
          image_versions2: { candidates: [
            { url: 'https://scontent.cdninstagram.com/small.jpg', width: 320, height: 320 },
            { url: 'https://scontent.cdninstagram.com/large.jpg', width: 1080, height: 1080 }
          ] }
        },
        {
          video_versions: [{ url: 'https://video.cdninstagram.com/video.mp4' }],
          image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/video-cover.jpg' }] }
        },
        {
          image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/second.webp', width: 800, height: 1000 }] }
        }
      ]
    }
  }
});

const parsedThreads = common.parseThreadsCreate(threadsResponse);
assert.equal(parsedThreads.url, 'https://www.threads.com/@author/post/ABC123');
assert.equal(parsedThreads.text, '');
assert.deepEqual(JSON.parse(JSON.stringify(parsedThreads.media)), [
  { url: 'https://scontent.cdninstagram.com/large.jpg', alt: '輪播第一張' },
  { url: 'https://scontent.cdninstagram.com/second.webp', alt: '圖片 3' }
]);

function loadBackground() {
  const stored = {};
  const requests = [];
  const nativeMessages = [];
  let localMode = 'ok';
  let nativeMode = 'ok';
  const alarmCreates = [];

  const chrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: manifestVersion }),
      async sendNativeMessage(host, message) {
        assert.equal(host, 'com.lostshin.social_post_to_obsidian');
        nativeMessages.push(message);
        // rejected：host 有回應但拒絕（永久性錯誤，不可進離線佇列）
        if (nativeMode === 'rejected') {
          return { ok: false, error: 'Vault is not configured' };
        }
        if (nativeMode !== 'ok' && !(nativeMode === 'missing' && message.action === 'exists')) {
          throw new Error('Specified native messaging host not found');
        }
        if (message.action === 'ping') {
          return { ok: true, configured: true, version: '1.1.2', vaultName: 'Test Vault' };
        }
        if (message.action === 'chooseVault') {
          return { ok: true, configured: true, version: '1.1.2', vaultName: 'Chosen Vault' };
        }
        if (message.action === 'exists') {
          return { ok: true, exists: nativeMode !== 'missing' };
        }
        if (message.action === 'cleanEmptyMediaFolders') return { ok: true, removed: 1 };
        return { ok: true };
      },
      onMessage: { addListener() {} }
    },
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === 'string') return { [keys]: stored[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, stored[key]]));
          return { ...stored };
        },
        async set(values) { Object.assign(stored, values); },
        async remove(key) { delete stored[key]; }
      }
    },
    alarms: {
      create(name, options) { alarmCreates.push({ name, options }); },
      clear() {},
      onAlarm: { addListener() {} }
    },
    tabs: { sendMessage(_tabId, _message, callback) { callback?.(); } },
    notifications: { create() {} }
  };

  async function fetchStub(url, init = {}) {
    if (String(url).startsWith('https://pbs.twimg.com/media/good')) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' }
      });
    }
    if (String(url).startsWith('https://pbs.twimg.com/media/missing')) {
      return new Response('', { status: 404 });
    }
    if (String(url).startsWith('http://127.0.0.1:27123/vault/')) {
      requests.push({ url: String(url), init });
      if (localMode === 'offline') throw new TypeError('Failed to fetch');
      if (localMode === 'unauthorized') return new Response(null, { status: 401 });
      if (localMode === 'missing' && init.method === 'GET') return new Response(null, { status: 404 });
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }

  const sandbox = {
    console,
    chrome,
    fetch: fetchStub,
    Response,
    URL,
    ArrayBuffer,
    Uint8Array,
    Date,
    btoa,
    setTimeout,
    clearTimeout
  };
  const context = vm.createContext(sandbox);
  // service worker 的 importScripts：在同一 context 內載入共用檔
  sandbox.importScripts = (...files) => {
    for (const file of files) vm.runInContext(readFileSync(file, 'utf8'), context);
  };
  vm.runInContext(readFileSync('background.js', 'utf8'), context);
  return {
    alarmCreates,
    context,
    nativeMessages,
    requests,
    stored,
    setNativeMode(mode) { nativeMode = mode; },
    setLocalMode(mode) { localMode = mode; }
  };
}

const background = loadBackground();
background.stored.storageMode = 'native';
background.stored.mediaPath = '附件/Social Post to Obsidian';
await background.context.startNativeMaintenance();
assert.equal(background.alarmCreates.at(-1).name, 'sp2o-vault-maintenance');
assert.deepEqual(JSON.parse(JSON.stringify(background.nativeMessages.at(-1))), {
  action: 'cleanEmptyMediaFolders',
  path: '附件/Social Post to Obsidian'
});
const postData = {
  content: '圖片同步測試',
  platform: 'x',
  url: 'https://x.com/author/status/123456',
  timestamp: '2026-07-18T11:00:00+08:00',
  media: [
    { url: 'https://pbs.twimg.com/media/good.jpg', alt: '成功圖片' },
    { url: 'https://pbs.twimg.com/media/missing.jpg', alt: '失敗圖片' }
  ]
};
const filename = '2026-07-18_1100_圖片同步測試.md';
const path = `個人創作/社群推文/${filename}`;
const settings = {
  storageMode: 'rest',
  apiKey: 'test-key',
  port: 27123,
  basePath: '個人創作/社群推文',
  mediaPath: '附件/Social Post to Obsidian'
};

const draftMarkdown = background.context.generateDraftMarkdown({
  content: 'Threads 第一則\n\n---\n\nThreads 第二則',
  thread: ['Threads 第一則', 'Threads 第二則'],
  platform: 'threads',
  timestamp: '2026-07-18T11:00:00+08:00'
});
assert.deepEqual(parseYamlFrontmatter(draftMarkdown), {
  title: 'Threads 草稿',
  updated: '2026-07-18 11:00',
  platform: 'Threads',
  source: 'threads',
  status: 'draft',
  thread_count: 2,
  tags: ['社群草稿', 'Threads', '串文']
});
assert.match(draftMarkdown, /> \[!warning\] 未發佈草稿/);
assert.match(draftMarkdown, /## 串文草稿\n\n### 1 \/ 2\n\nThreads 第一則/);
assert.match(draftMarkdown, /### 2 \/ 2\n\nThreads 第二則/);

const formattedThreadMarkdown = background.context.generateMarkdown({
  content: '串文第一則\n\n---\n\n串文第二則',
  thread: ['串文第一則', '串文第二則'],
  platform: 'x',
  url: 'https://x.com/author/status/123456?source=test',
  timestamp: '2026-07-18T11:00:00+08:00',
  replyTo: 'https://x.com/replied/status/10',
  quoted: {
    author: 'quoted',
    authorName: 'Quoted "Name"',
    content: '引用第一行\n引用第二行',
    url: 'https://x.com/quoted/status/20'
  }
});
assert.deepEqual(parseYamlFrontmatter(formattedThreadMarkdown), {
  title: '串文第一則',
  created: '2026-07-18 11:00',
  platform: 'Twitter/X',
  source: 'x',
  source_url: 'https://x.com/author/status/123456?source=test',
  status: 'published',
  thread_count: 2,
  reply_to: 'https://x.com/replied/status/10',
  quoted_from: '@quoted',
  quoted_author_name: 'Quoted "Name"',
  quoted_url: 'https://x.com/quoted/status/20',
  tags: ['社群貼文', 'Twitter/X', '串文'],
  summary: ''
});
assert.match(formattedThreadMarkdown, /> \[!info\] 貼文資訊/);
assert.match(formattedThreadMarkdown, /## 串文內容\n\n### 1 \/ 2\n\n串文第一則/);
assert.match(formattedThreadMarkdown, /### 2 \/ 2\n\n串文第二則/);
assert.match(formattedThreadMarkdown, /> \[!quote\] 引用貼文/);

// 用實際 Native Host 寫入隔離 Vault，再從磁碟讀回並解析 YAML。
const markdownVaultRoot = mkdtempSync(join(tmpdir(), 'sp2o-markdown-test-'));
try {
  const vaultPath = join(markdownVaultRoot, 'Markdown Vault');
  const configDirectory = join(markdownVaultRoot, 'config');
  mkdirSync(join(vaultPath, '.obsidian'), { recursive: true });
  assert.equal(sendNativeHostMessage({ action: 'configure', vaultPath }, configDirectory).ok, true);
  assert.equal(sendNativeHostMessage({
    action: 'write',
    path: '個人創作/社群推文/_草稿_Threads.md',
    encoding: 'utf8',
    data: draftMarkdown
  }, configDirectory).ok, true);
  assert.equal(sendNativeHostMessage({
    action: 'write',
    path: '個人創作/社群推文/串文測試.md',
    encoding: 'utf8',
    data: formattedThreadMarkdown
  }, configDirectory).ok, true);
  const writtenDraft = readFileSync(
    join(vaultPath, '個人創作', '社群推文', '_草稿_Threads.md'),
    'utf8'
  );
  const writtenPost = readFileSync(
    join(vaultPath, '個人創作', '社群推文', '串文測試.md'),
    'utf8'
  );
  assert.equal(writtenDraft, draftMarkdown);
  assert.equal(writtenPost, formattedThreadMarkdown);
  assert.equal(parseYamlFrontmatter(writtenDraft).status, 'draft');
  assert.equal(parseYamlFrontmatter(writtenPost).thread_count, 2);
} finally {
  rmSync(markdownVaultRoot, { recursive: true, force: true });
}

const result = await background.context.savePostBundle(postData, path, filename, settings);
assert.deepEqual(JSON.parse(JSON.stringify(result)), { savedMedia: 1, failedMedia: 1 });
assert.equal(background.requests.length, 2);
assert.equal(background.requests[0].init.headers['Content-Type'], 'image/jpeg');
assert.match(
  decodeURIComponent(background.requests[0].url),
  /附件\/Social Post to Obsidian\/2026-07-18_1100_圖片同步測試\/image-01\.jpg$/
);
const markdown = background.requests[1].init.body;
assert.match(
  markdown,
  /!\[成功圖片\]\(<\.\.\/\.\.\/附件\/Social Post to Obsidian\/2026-07-18_1100_圖片同步測試\/image-01\.jpg>\)/
);
assert.match(markdown, /!\[失敗圖片\]\(<https:\/\/pbs\.twimg\.com\/media\/missing\.jpg>\)/);

const imageOnlyFilename = background.context.generateFilename({
  content: '',
  timestamp: '2026-07-18T11:00:00+08:00'
});
assert.equal(imageOnlyFilename, '2026-07-18_1100_圖片貼文.md');
// 內容全是不合法檔名字元時，摘要退回 fallback 而非空字串
assert.equal(
  background.context.generateFilename({ content: '???', timestamp: '2026-07-18T11:00:00+08:00' }),
  '2026-07-18_1100_貼文.md'
);
assert.equal(background.context.platformDisplayName('x', true), 'Twitter');
assert.equal(background.context.platformDisplayName('x'), 'Twitter/X');
assert.equal(background.context.platformDisplayName('threads'), 'Threads');
assert.equal(background.context.resolveStorageMode({}), 'native');
assert.equal(background.context.resolveStorageMode({ apiKey: 'legacy-key' }), 'rest');
assert.equal(background.context.resolveStorageMode({ storageMode: 'direct', apiKey: 'legacy-key' }), 'native');
assert.equal(background.context.createContentPreview('  第一行\n  第二行  '), '第一行 第二行');
const emojiPreview = background.context.createContentPreview('😀'.repeat(161));
assert.equal(Array.from(emojiPreview).length, 161);
assert.equal(emojiPreview.endsWith('…'), true);

const nativeBackground = loadBackground();
const nativeSettings = {
  storageMode: 'native',
  basePath: '個人創作/社群推文',
  mediaPath: '附件/Social Post to Obsidian'
};
const nativeResult = await nativeBackground.context.savePostBundle(
  { ...postData, media: [{ url: 'https://pbs.twimg.com/media/good.jpg', alt: 'Helper 寫入圖片' }] },
  path,
  filename,
  nativeSettings
);
assert.deepEqual(JSON.parse(JSON.stringify(nativeResult)), { savedMedia: 1, failedMedia: 0 });
const nativeWrites = nativeBackground.nativeMessages.filter(message => message.action === 'write');
assert.equal(nativeWrites.length, 2);
assert.match(
  nativeWrites[0].path,
  /附件\/Social Post to Obsidian\/2026-07-18_1100_圖片同步測試\/image-01\.jpg$/
);
assert.equal(nativeWrites[0].encoding, 'base64');
assert.equal(nativeWrites[0].data, '/9j/');
assert.equal(nativeWrites[1].path, path);
assert.equal(nativeWrites[1].encoding, 'utf8');
assert.match(nativeWrites[1].data, /!\[Helper 寫入圖片\]/);
// 發文流程不再觸發空資料夾清理（剛寫完必非空；清理交給刪除流程與定期 alarm）
assert.equal(
  nativeBackground.nativeMessages.some(message => message.action === 'cleanEmptyMediaFolders'),
  false
);

nativeBackground.stored.storageMode = 'native';
nativeBackground.stored.basePath = '個人創作/社群推文';
await nativeBackground.context.handleSaveDraft({
  content: 'Helper 暫存草稿',
  platform: 'x',
  timestamp: '2026-07-18T11:01:00+08:00'
}, null);
assert.equal(nativeBackground.nativeMessages.at(-1).path, '個人創作/社群推文/_草稿_Twitter.md');
assert.match(nativeBackground.nativeMessages.at(-1).data, /Helper 暫存草稿/);
assert.equal(nativeBackground.stored.draftStatus_x.preview, 'Helper 暫存草稿');

await nativeBackground.context.deleteVaultFile('個人創作/社群推文/_草稿_Twitter.md', nativeSettings);
assert.deepEqual(JSON.parse(JSON.stringify(nativeBackground.nativeMessages.at(-1))), {
  action: 'remove',
  path: '個人創作/社群推文/_草稿_Twitter.md'
});

const clearBackground = loadBackground();
clearBackground.stored.storageMode = 'native';
clearBackground.stored.basePath = '個人創作/社群推文';
clearBackground.stored.draftStatus_x = {
  path: '個人創作/社群推文/_草稿_Twitter.md'
};
clearBackground.stored.draftStatus_threads = {
  path: '個人創作/社群推文/_草稿_Threads.md'
};
const clearResult = await clearBackground.context.clearAutoDrafts();
assert.deepEqual(JSON.parse(JSON.stringify(clearResult)), { ok: true, cleared: 2 });
assert.equal('draftStatus_x' in clearBackground.stored, false);
assert.equal('draftStatus_threads' in clearBackground.stored, false);
assert.deepEqual(
  clearBackground.nativeMessages.filter(message => message.action === 'remove').map(message => message.path),
  ['個人創作/社群推文/_草稿_Twitter.md', '個人創作/社群推文/_草稿_Threads.md']
);

clearBackground.stored.draftStatus_x = {
  path: '個人創作/社群推文/_草稿_Twitter.md'
};
clearBackground.setNativeMode('unavailable');
const failedClear = await clearBackground.context.clearAutoDrafts();
assert.equal(failedClear.ok, false);
assert.equal(failedClear.cleared, 0);
assert.equal('draftStatus_x' in clearBackground.stored, true);

const restClearBackground = loadBackground();
restClearBackground.stored.storageMode = 'rest';
restClearBackground.stored.apiKey = 'test-key';
restClearBackground.stored.port = 27123;
restClearBackground.stored.draftStatus_threads = {
  path: '個人創作/社群推文/_草稿_Threads.md'
};
const restClearResult = await restClearBackground.context.clearAutoDrafts();
assert.deepEqual(JSON.parse(JSON.stringify(restClearResult)), { ok: true, cleared: 1 });
assert.equal(restClearBackground.requests.at(-1).init.method, 'DELETE');
assert.match(
  decodeURIComponent(restClearBackground.requests.at(-1).url),
  /個人創作\/社群推文\/_草稿_Threads\.md$/
);

const nativeSyncBackground = loadBackground();
nativeSyncBackground.stored.storageMode = 'native';
nativeSyncBackground.stored.mediaPath = '附件/Social Post to Obsidian';
nativeSyncBackground.stored.draftStatus_x = {
  path: '個人創作/社群推文/_草稿_Twitter.md'
};
nativeSyncBackground.stored.recentSaves = [{
  filename,
  path,
  platform: 'x'
}];
nativeSyncBackground.setNativeMode('missing');
const nativeSyncResult = await nativeSyncBackground.context.syncVaultActivity();
assert.deepEqual(JSON.parse(JSON.stringify(nativeSyncResult)), {
  ok: true,
  removedDrafts: 1,
  removedRecent: 1
});
assert.equal('draftStatus_x' in nativeSyncBackground.stored, false);
assert.deepEqual(JSON.parse(JSON.stringify(nativeSyncBackground.stored.recentSaves)), []);
assert.equal(
  nativeSyncBackground.nativeMessages.some(message => message.action === 'cleanEmptyMediaFolders'),
  true
);

const offlineSyncBackground = loadBackground();
offlineSyncBackground.stored.storageMode = 'native';
offlineSyncBackground.stored.draftStatus_threads = {
  path: '個人創作/社群推文/_草稿_Threads.md'
};
offlineSyncBackground.setNativeMode('unavailable');
await assert.rejects(() => offlineSyncBackground.context.syncVaultActivity());
assert.equal('draftStatus_threads' in offlineSyncBackground.stored, true);

const restSyncBackground = loadBackground();
restSyncBackground.stored.storageMode = 'rest';
restSyncBackground.stored.apiKey = 'test-key';
restSyncBackground.stored.port = 27123;
restSyncBackground.stored.recentSaves = [{ filename, path, platform: 'x' }];
restSyncBackground.setLocalMode('missing');
const restSyncResult = await restSyncBackground.context.syncVaultActivity();
assert.deepEqual(JSON.parse(JSON.stringify(restSyncResult)), {
  ok: true,
  removedDrafts: 0,
  removedRecent: 1
});
assert.deepEqual(JSON.parse(JSON.stringify(restSyncBackground.stored.recentSaves)), []);
assert.equal(restSyncBackground.requests.at(-1).init.method, 'GET');

const deleteActivityBackground = loadBackground();
deleteActivityBackground.stored.storageMode = 'native';
deleteActivityBackground.stored.mediaPath = '附件/Social Post to Obsidian';
deleteActivityBackground.stored.recentSaves = [{ filename, path, platform: 'x' }];
const deleteActivityResult = await deleteActivityBackground.context.deleteVaultActivity({
  kind: 'recent',
  path
});
assert.deepEqual(JSON.parse(JSON.stringify(deleteActivityResult)), { ok: true });
assert.deepEqual(JSON.parse(JSON.stringify(deleteActivityBackground.stored.recentSaves)), []);
assert.deepEqual(JSON.parse(JSON.stringify(
  deleteActivityBackground.nativeMessages.find(message => message.action === 'remove')
)), { action: 'remove', path });

await assert.rejects(
  () => deleteActivityBackground.context.deleteVaultActivity({
    kind: 'recent',
    path: '個人創作/社群推文/未受追蹤.md'
  }),
  /找不到要刪除的 Vault 貼文/
);

const restDeleteActivityBackground = loadBackground();
restDeleteActivityBackground.stored.storageMode = 'rest';
restDeleteActivityBackground.stored.apiKey = 'test-key';
restDeleteActivityBackground.stored.port = 27123;
restDeleteActivityBackground.stored.recentSaves = [{ filename, path, platform: 'x' }];
await restDeleteActivityBackground.context.deleteVaultActivity({ kind: 'recent', path });
assert.deepEqual(JSON.parse(JSON.stringify(restDeleteActivityBackground.stored.recentSaves)), []);
assert.equal(restDeleteActivityBackground.requests.at(-1).init.method, 'DELETE');

nativeBackground.setNativeMode('unavailable');
await nativeBackground.context.saveWithQueueFallback(
  path,
  filename,
  { ...postData, media: [] },
  nativeSettings,
  null
);
assert.equal(nativeBackground.stored.offlineQueue.length, 1);
assert.equal(nativeBackground.stored.offlineQueue[0].data.content, postData.content);

nativeBackground.stored.storageMode = 'native';
nativeBackground.stored.mediaPath = '附件/Social Post to Obsidian';
nativeBackground.setNativeMode('ok');
await nativeBackground.context.retryOfflineQueue();
assert.deepEqual(JSON.parse(JSON.stringify(nativeBackground.stored.offlineQueue)), []);
assert.equal(nativeBackground.stored.recentSaves[0].filename, filename);
assert.equal(nativeBackground.stored.recentSaves[0].preview, '圖片同步測試');

background.stored.storageMode = 'rest';
background.setLocalMode('offline');
await background.context.saveWithQueueFallback(
  path,
  filename,
  { ...postData, media: [{ url: 'https://pbs.twimg.com/media/good.jpg', alt: '離線圖片' }] },
  settings,
  null
);
assert.equal(background.stored.offlineQueue.length, 1);
assert.equal(background.stored.offlineQueue[0].data.media[0].url, 'https://pbs.twimg.com/media/good.jpg');
assert.equal('markdown' in background.stored.offlineQueue[0], false);

background.stored.apiKey = 'test-key';
background.stored.port = 27123;
background.stored.mediaPath = '附件/Social Post to Obsidian';
background.setLocalMode('ok');
await background.context.retryOfflineQueue();
assert.deepEqual(JSON.parse(JSON.stringify(background.stored.offlineQueue)), []);
assert.equal(background.stored.recentSaves[0].filename, filename);
assert.equal(background.stored.recentSaves[0].preview, '圖片同步測試');
assert.match(
  decodeURIComponent(background.requests.at(-2).url),
  /附件\/Social Post to Obsidian\/2026-07-18_1100_圖片同步測試\/image-01\.jpg$/
);

// 發佈失敗（REST 回 401，非連線錯誤）：不進離線佇列，且草稿檔與 draftStatus 都保留
const failedPublishBackground = loadBackground();
failedPublishBackground.stored.storageMode = 'rest';
failedPublishBackground.stored.apiKey = 'test-key';
failedPublishBackground.stored.port = 27123;
failedPublishBackground.stored.draftStatus_x = {
  path: '個人創作/社群推文/_草稿_Twitter.md'
};
failedPublishBackground.setLocalMode('unauthorized');
await failedPublishBackground.context.handlePublishDraft({
  content: '發佈失敗測試',
  platform: 'x',
  url: 'https://x.com/author/status/9',
  timestamp: '2026-07-18T11:05:00+08:00'
}, null);
assert.equal('draftStatus_x' in failedPublishBackground.stored, true);
assert.equal((failedPublishBackground.stored.offlineQueue || []).length, 0);
assert.equal(
  failedPublishBackground.requests.some(request => request.init.method === 'DELETE'),
  false
);

// Native Host 回報永久性錯誤（如 Vault 未設定）：向上拋出、不得進離線佇列
const rejectedNativeBackground = loadBackground();
rejectedNativeBackground.setNativeMode('rejected');
await assert.rejects(
  () => rejectedNativeBackground.context.saveWithQueueFallback(
    path,
    filename,
    { ...postData, media: [] },
    nativeSettings,
    null
  ),
  /Vault is not configured/
);
assert.equal((rejectedNativeBackground.stored.offlineQueue || []).length, 0);

// recentSaves 依 path 去重：同一份檔案重送/修正只保留一筆，刪除時不會誤刪多筆
const dedupBackground = loadBackground();
await dedupBackground.context.recordRecentSave({ filename, path, platform: 'x' });
await dedupBackground.context.recordRecentSave({ filename, path, platform: 'x' });
assert.equal(dedupBackground.stored.recentSaves.length, 1);
assert.equal(dedupBackground.stored.recentSaves[0].path, path);

console.log('Media parser and Vault bundle tests passed.');
