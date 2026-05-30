# Screenshot Clipper

See a design you like → click the extension → it lands in your Obsidian vault as a study note. Claude (running on your subscription, no API cost) fills in the objective fields — background color, palette, whitespace — and leaves the subjective ones blank for you.

## Status

- [x] Backend pipeline — processor, Native Messaging host, 处理审美 SOP (Plan 1)
- [ ] Browser extension — region capture, popup (Plan 2)
- [ ] One-command install + Chrome Web Store (Plan 3)

## How it works

1. You click the extension and select a region (Plan 2)
2. Chrome calls the local host script via Native Messaging (no server to start)
3. The host stages the PNG, calls `claude -p` with the processing SOP
4. Claude reads the image, writes the Obsidian note with objective fields filled
5. The note opens in Obsidian

## Setup (Plan 1 backend only)

```bash
# Install Python dependencies
python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt

# Register the Native Messaging host with Chrome
bash install.sh   # will prompt for your extension ID
```

## Dev

```bash
.venv/bin/pytest -m "not integration"   # unit tests
.venv/bin/pytest -m integration -s     # real end-to-end (~60s)
```

## License

MIT
