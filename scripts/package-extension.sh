#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VERSION="$(node -e "const fs = require('node:fs'); console.log(JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).version)" "${PROJECT_ROOT}/manifest.json")"
OUTPUT_DIR="${PROJECT_ROOT}/dist"
ARCHIVE="${OUTPUT_DIR}/social-post-to-obsidian-v${VERSION}.zip"
STAGE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/sp2o-package.XXXXXX")"
STAGE_DIR="${STAGE_ROOT}/extension"

cleanup() {
  rm -rf "${STAGE_ROOT}"
}
trap cleanup EXIT

node "${PROJECT_ROOT}/scripts/validate-extension.mjs"

mkdir -p "${OUTPUT_DIR}" "${STAGE_DIR}/content" "${STAGE_DIR}/icons" "${STAGE_DIR}/popup"
cp "${PROJECT_ROOT}/manifest.json" "${PROJECT_ROOT}/background.js" "${PROJECT_ROOT}/LICENSE" "${STAGE_DIR}/"
cp "${PROJECT_ROOT}"/content/*.js "${STAGE_DIR}/content/"
cp "${PROJECT_ROOT}"/icons/* "${STAGE_DIR}/icons/"
cp "${PROJECT_ROOT}"/popup/* "${STAGE_DIR}/popup/"

rm -f "${ARCHIVE}"
pushd "${STAGE_DIR}" >/dev/null
zip -q -r "${ARCHIVE}" . -x '*.DS_Store'
popd >/dev/null

unzip -tq "${ARCHIVE}"
PACKAGE_FILES="$(unzip -Z1 "${ARCHIVE}")"
if ! grep -q '^manifest\.json$' <<<"${PACKAGE_FILES}"; then
  echo "Packaging failed: manifest.json is not at the ZIP root" >&2
  exit 1
fi

echo "Created ${ARCHIVE}"
