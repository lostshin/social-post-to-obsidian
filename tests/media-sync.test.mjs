import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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
        getManifest: () => ({ version: '1.6.0' }),
        onMessage: { addListener() {} }
      }
    }
  });
  vm.runInContext(readFileSync('content/common.js', 'utf8'), context);
  return context.SP2O;
}

const common = loadCommon();

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
  let localMode = 'ok';

  const chrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: '1.6.0' }),
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
      create() {},
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
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }

  const context = vm.createContext({
    console,
    chrome,
    fetch: fetchStub,
    Response,
    URL,
    ArrayBuffer,
    Date,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(readFileSync('background.js', 'utf8'), context);
  return {
    context,
    requests,
    stored,
    setLocalMode(mode) { localMode = mode; }
  };
}

const background = loadBackground();
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
const settings = { apiKey: 'test-key', port: 27123, basePath: '個人創作/社群推文' };

const result = await background.context.savePostBundle(postData, path, filename, settings);
assert.deepEqual(JSON.parse(JSON.stringify(result)), { savedMedia: 1, failedMedia: 1 });
assert.equal(background.requests.length, 2);
assert.equal(background.requests[0].init.headers['Content-Type'], 'image/jpeg');
assert.match(decodeURIComponent(background.requests[0].url), /_assets\/2026-07-18_1100_圖片同步測試\/image-01\.jpg$/);
const markdown = background.requests[1].init.body;
assert.match(markdown, /!\[成功圖片\]\(<_assets\/2026-07-18_1100_圖片同步測試\/image-01\.jpg>\)/);
assert.match(markdown, /!\[失敗圖片\]\(<https:\/\/pbs\.twimg\.com\/media\/missing\.jpg>\)/);

const imageOnlyFilename = background.context.generateFilename({
  content: '',
  timestamp: '2026-07-18T11:00:00+08:00'
});
assert.equal(imageOnlyFilename, '2026-07-18_1100_圖片貼文.md');

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
background.setLocalMode('ok');
await background.context.retryOfflineQueue();
assert.deepEqual(JSON.parse(JSON.stringify(background.stored.offlineQueue)), []);
assert.equal(background.stored.recentSaves[0].filename, filename);

console.log('Media parser and Vault bundle tests passed.');
