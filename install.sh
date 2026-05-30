#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/Applications/screenshot-clipper"
MANIFEST_NAME="com.screenshot_clipper.host"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
HOST_BINARY="$INSTALL_DIR/screenshot-clipper-host"

echo "=== Screenshot Clipper install ==="

# 1. Clean previous install and recreate (ensures no stale/nested files)
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# 2. Copy host code + venv into install dir
cp -r "$REPO_DIR/host" "$INSTALL_DIR/host"
cp -r "$REPO_DIR/server" "$INSTALL_DIR/server"
cp -r "$REPO_DIR/sop" "$INSTALL_DIR/sop"
if [ -d "$REPO_DIR/.venv" ]; then
    cp -r "$REPO_DIR/.venv" "$INSTALL_DIR/.venv"
fi

# 3. Write the actual wrapper script — embed current PATH so Chrome's minimal env can find claude
cat > "$HOST_BINARY" << EOF
#!/bin/bash
export PATH="$PATH"
exec "$INSTALL_DIR/.venv/bin/python" -c "
import sys
sys.path.insert(0, '$INSTALL_DIR')
from host.host import main
main()
"
EOF
chmod +x "$HOST_BINARY"

# 4. Strip Gatekeeper quarantine from our wrapper and the claude CLI it invokes.
#    Without this, macOS pops a security dialog on EVERY clip because claude's
#    native .node addons carry quarantine attributes from download.
xattr -d com.apple.quarantine "$HOST_BINARY" 2>/dev/null || true
CLAUDE_BIN="$(command -v claude 2>/dev/null)"
if [ -n "$CLAUDE_BIN" ]; then
    CLAUDE_REAL="$(python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$CLAUDE_BIN")"
    CLAUDE_PKG="$(dirname "$(dirname "$CLAUDE_REAL")")"
    xattr -dr com.apple.quarantine "$CLAUDE_PKG" 2>/dev/null || true
    echo "Stripped quarantine from Claude CLI at $CLAUDE_PKG"
fi

echo ""
echo "Paste your Chrome extension ID (find it at chrome://extensions with Developer Mode on):"
read -r EXTENSION_ID

if [ -z "$EXTENSION_ID" ]; then
    echo "ERROR: extension ID required"
    exit 1
fi

# 6. Write the manifest into Chrome's NativeMessagingHosts dir
mkdir -p "$MANIFEST_DIR"
cat > "$MANIFEST_DIR/$MANIFEST_NAME.json" << EOF
{
  "name": "$MANIFEST_NAME",
  "description": "Screenshot Clipper Native Messaging Host",
  "path": "$HOST_BINARY",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF

echo ""
echo "=== Install complete ==="
echo "Host:     $HOST_BINARY"
echo "Manifest: $MANIFEST_DIR/$MANIFEST_NAME.json"
echo ""
echo "To verify: open Chrome → load the extension → try clipping something."
echo "If it fails, check: chrome://extensions → Details → Errors"
