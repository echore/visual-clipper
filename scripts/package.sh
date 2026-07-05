#!/usr/bin/env bash
# Packages extension/ into dist/obsidian-visual-clipper-<version>.zip for
# Chrome Web Store upload. Version is read from extension/manifest.json.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$REPO_ROOT/extension"
DIST_DIR="$REPO_ROOT/dist"
MANIFEST="$EXT_DIR/manifest.json"

if [[ ! -f "$MANIFEST" ]]; then
  echo "error: manifest not found at $MANIFEST" >&2
  exit 1
fi

VERSION="$(node -e "console.log(require('$MANIFEST').version)")"
if [[ -z "$VERSION" ]]; then
  echo "error: could not read version from $MANIFEST" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"
ZIP_PATH="$DIST_DIR/obsidian-visual-clipper-$VERSION.zip"
rm -f "$ZIP_PATH"

cd "$EXT_DIR"
zip -r -X "$ZIP_PATH" . \
  -x "node_modules/*" \
  -x "*.test.js" \
  -x "jest.config.js" \
  -x "package.json" \
  -x "package-lock.json" \
  > /dev/null

echo "Packaged $ZIP_PATH"
unzip -l "$ZIP_PATH"
