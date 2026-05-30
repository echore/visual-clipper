# Screenshot Clipper — Project Contract

**Goal:** Browser extension that clips a design screenshot → saves it to Obsidian as a 五个问题 study note, with objective fields filled by Claude (on subscription, zero API cost) and subjective fields left blank for the user.

**Architecture:** Chrome Native Messaging. The extension calls `sendNativeMessage`, Chrome spawns `host/host.py` on-demand (no server to start, no port, no launchd). The host decodes the PNG, stages it in `~/.local/share/screenshot-clipper/staging/`, then calls `claude -p` which reads the SOP and writes the note + image into the Obsidian vault.

**Tech:** Python 3.12 / Pydantic v2 / pytest. No FastAPI (removed in D10). Port 27183 removed.

**Key files:**
- `server/config.py` — all paths and settings in one place
- `server/processor.py` — all the work: staging, prompts, claude invocation, obsidian URI
- `host/host.py` — Native Messaging stdio protocol (thin layer, no business logic)
- `sop/处理审美-SOP.md` — what claude -p actually does (edit this to change analysis behavior)
- `install.sh` — one-time setup for the host + Chrome manifest

**How to run tests:**
```bash
python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt
.venv/bin/pytest -m "not integration"     # fast unit tests (16)
.venv/bin/pytest -m integration -s        # real claude run (~60s, uses subscription)
```

**Collaboration rules:**
1. Read the source before editing — especially `sop/处理审美-SOP.md` and existing vault notes at `~/Documents/Obsidian Vault/AI协作/05 审美积累/单张分析/`.
2. Server must never write `~/Documents` directly — only `~/.local/share/screenshot-clipper/`. Vault writes go through `claude -p`.
3. All exceptions return `{"success": False, "error": str(e)}` — never raise out to Chrome.
4. Never print API keys or tokens.
5. `run_claude` in `processor.py` is the single subprocess seam — mock only that in tests.

**Definition of done (Plan 1):**
- `pytest -m "not integration"` — all green
- `pytest -m integration` — PASS (real note written with hex color in q1, q3 blank)
- No hardcoded secrets anywhere
