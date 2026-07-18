import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const fromRoot = (path) => new URL(path, root);

function fail(message) {
  console.error(`Validation failed: ${message}`);
  process.exit(1);
}

function requireFile(path) {
  if (!existsSync(fromRoot(path))) {
    fail(`missing referenced file: ${path}`);
  }
}

function readPngSize(path) {
  const bytes = readFileSync(fromRoot(path));
  const pngSignature = '89504e470d0a1a0a';

  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== pngSignature) {
    fail(`${path} is not a valid PNG file`);
  }

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(fromRoot('manifest.json'), 'utf8'));
} catch (error) {
  fail(`manifest.json is invalid JSON: ${error.message}`);
}

if (manifest.manifest_version !== 3) {
  fail('manifest_version must be 3');
}

if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  fail(`unexpected version format: ${manifest.version}`);
}

const referencedFiles = new Set([
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  ...(manifest.content_scripts || []).flatMap((script) => script.js || [])
].filter(Boolean));

for (const path of referencedFiles) {
  requireFile(path);
}

for (const size of ['16', '32', '48', '128']) {
  const path = manifest.icons?.[size];
  if (!path) fail(`manifest icon ${size}px is not configured`);

  const dimensions = readPngSize(path);
  if (dimensions.width !== Number(size) || dimensions.height !== Number(size)) {
    fail(`${path} must be ${size}x${size}, received ${dimensions.width}x${dimensions.height}`);
  }
}

const javascriptFiles = [
  'background.js',
  ...readdirSync(fromRoot('content')).filter((file) => file.endsWith('.js')).map((file) => join('content', file)),
  ...readdirSync(fromRoot('popup')).filter((file) => file.endsWith('.js')).map((file) => join('popup', file))
];

for (const path of javascriptFiles) {
  execFileSync(process.execPath, ['--check', fromRoot(path).pathname], { stdio: 'inherit' });
}

console.log(`Validated Manifest V3 extension v${manifest.version}: ${javascriptFiles.length} scripts, ${referencedFiles.size} referenced assets.`);
