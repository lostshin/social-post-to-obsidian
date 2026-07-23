#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, '..');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const gifPath = resolve(projectDirectory, 'assets/demo.gif');
const videoPath = resolve(projectDirectory, 'assets/demo.mp4');
const frameRate = 6;
const durationSeconds = 20;
const frameCount = frameRate * durationSeconds;
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'sp2o-demo-'));
const profileDirectory = join(temporaryDirectory, 'profile');
const framesDirectory = join(temporaryDirectory, 'frames');

await mkdir(profileDirectory);
await mkdir(framesDirectory);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const requestedPath = resolve(projectDirectory, pathname.replace(/^\/+/, ''));
    if (!requestedPath.startsWith(`${projectDirectory}${sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const content = await readFile(requestedPath);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(requestedPath)] || 'application/octet-stream',
    });
    response.end(content);
  } catch {
    response.writeHead(404).end('Not found');
  }
});
await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
const serverAddress = server.address();
const sourceUrl = `http://127.0.0.1:${serverAddress.port}/assets/demo.html`;

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=0',
  `--user-data-dir=${profileDirectory}`,
  'about:blank',
], {
  stdio: ['ignore', 'ignore', 'pipe'],
});

let socket;
let nextCommandId = 1;
const pendingCommands = new Map();

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForFile(path, timeoutMilliseconds = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMilliseconds) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      await wait(50);
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForValue(check, timeoutMilliseconds = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMilliseconds) {
    const value = await check();
    if (value) return value;
    await wait(50);
  }
  throw new Error('Timed out waiting for the demo page');
}

function send(method, params = {}) {
  const id = nextCommandId++;
  return new Promise((resolvePromise, rejectPromise) => {
    pendingCommands.set(id, { resolvePromise, rejectPromise });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function run(command, argumentsList) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, argumentsList, { stdio: 'inherit' });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

try {
  const activePort = await waitForFile(join(profileDirectory, 'DevToolsActivePort'));
  const [port] = activePort.trim().split('\n');
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const pageTarget = targets.find((target) => target.type === 'page');
  if (!pageTarget) throw new Error('Chrome did not expose a page target');

  socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolvePromise, rejectPromise) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', rejectPromise, { once: true });
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const pending = pendingCommands.get(message.id);
    if (!pending) return;
    pendingCommands.delete(message.id);
    if (message.error) {
      pending.rejectPromise(new Error(message.error.message));
    } else {
      pending.resolvePromise(message.result);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: sourceUrl });

  await waitForValue(async () => {
    const result = await send('Runtime.evaluate', {
      expression: 'window.demoReady === true',
      returnByValue: true,
    });
    return result.result.value === true;
  });

  for (let index = 0; index < frameCount; index += 1) {
    const progress = index / frameCount;
    const activeStage = Math.min(3, Math.floor(progress * 4));
    await send('Runtime.evaluate', {
      expression: `window.setDemoProgress(${progress})`,
    });
    await wait(20);
    if (index % (frameRate * 5) === 0) {
      const popupState = await send('Runtime.evaluate', {
        expression: `(() => {
          const doc = document.getElementById('popup').contentDocument;
          return {
            settingsOpen: doc.getElementById('settingsPanel').open,
            connection: doc.getElementById('connText').textContent,
            draftHidden: doc.getElementById('draftSection').hidden,
            recentCount: doc.getElementById('recentList').children.length,
          };
        })()`,
        returnByValue: true,
      });
      const state = popupState.result.value;
      if (!state || state.settingsOpen || state.connection !== '已連接：創作筆記') {
        throw new Error(`Unexpected popup state at frame ${index}: ${JSON.stringify(state)}`);
      }
      const expectedDraftHidden = activeStage !== 1;
      if (state.draftHidden !== expectedDraftHidden) {
        throw new Error(`Unexpected draft visibility at frame ${index}: ${JSON.stringify(state)}`);
      }
      console.log(`Frame ${index}: ${JSON.stringify(state)}`);
    }
    const screenshot = await send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const frameName = `frame-${String(index).padStart(3, '0')}.png`;
    await writeFile(join(framesDirectory, frameName), Buffer.from(screenshot.data, 'base64'));
  }

  await run('/opt/homebrew/bin/ffmpeg', [
    '-loglevel', 'error',
    '-y',
    '-framerate', String(frameRate),
    '-i', join(framesDirectory, 'frame-%03d.png'),
    '-vf', 'scale=1280:720:flags=lanczos',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    videoPath,
  ]);

  await run('/opt/homebrew/bin/ffmpeg', [
    '-loglevel', 'error',
    '-y',
    '-framerate', String(frameRate),
    '-i', join(framesDirectory, 'frame-%03d.png'),
    '-filter_complex',
    '[0:v]fps=6,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4',
    '-loop', '0',
    gifPath,
  ]);

  console.log(`Created ${gifPath}`);
  console.log(`Created ${videoPath}`);
} finally {
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  if (chrome.exitCode === null) {
    const chromeExited = new Promise((resolvePromise) => {
      chrome.once('exit', resolvePromise);
    });
    chrome.kill('SIGTERM');
    await chromeExited;
  }
  await rm(temporaryDirectory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
  await new Promise((resolvePromise) => server.close(resolvePromise));
}
