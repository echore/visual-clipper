#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/Applications/screenshot-clipper"
MANIFEST_NAME="com.screenshot_clipper.host"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
HOST_BINARY="$INSTALL_DIR/screenshot-clipper-host"

echo "=== Screenshot Clipper install ==="

# 1. Create install dir (non-TCC path — NOT ~/Documents)
mkdir -p "$INSTALL_DIR"

# 2. Copy host code + venv into install dir
cp -r "$REPO_DIR/host/"* "$INSTALL_DIR/"
cp -r "$REPO_DIR/server" "$INSTALL_DIR/server"
cp -r "$REPO_DIR/sop" "$INSTALL_DIR/sop"
if [ -d "$REPO_DIR/.venv" ]; then
    cp -r "$REPO_DIR/.venv" "$INSTALL_DIR/.venv"
fi

# 3. Write the actual wrapper script with absolute paths
cat > "$HOST_BINARY" << EOF
#!/bin/bash
exec "$INSTALL_DIR/.venv/bin/python" -c "
import sys
sys.path.insert(0, '$INSTALL_DIR')
from host.host import main
main()
"
EOF
chmod +x "$HOST_BINARY"

# 4. Strip Gatekeeper quarantine (Ventura+ silently blocks unsigned binaries)
xattr -d com.apple.quarantine "$HOST_BINARY" 2>/dev/null || true

# 5. Get extension ID from user
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
