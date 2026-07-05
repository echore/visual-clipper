# Screenshot Clipper — Project Contract

## Coding Principles

### Think Before Coding
Before writing any code on a non-trivial task:
- State assumptions explicitly. If uncertain, ask — don't guess.
- If multiple interpretations exist, list them; don't silently pick one.
- If a simpler approach exists, say so and push back.

### Simplicity First (YAGNI)
- Add only what was explicitly requested — nothing more.
- No abstractions, flexibility, or configurability that wasn't asked for.
- No error handling for scenarios that can't happen.
- Self-check before submitting: "Would a senior engineer call this over-engineered?" → simplify if yes.

### Surgical Changes
- Only touch code directly required by the task.
- Do not improve, reformat, or clean up adjacent code that wasn't asked about.
- Match the style of existing code even if you'd do it differently.
- Spot unrelated dead code? Mention it — don't delete it.
- Clean up only the orphans YOUR changes created (unused imports, vars, functions).

### Verifiable Done
- Every task needs a concrete, checkable success criterion before starting.
- After completing: report test command + output, not just "done".
- After a bug fix: verify the bug is gone AND nothing else broke.
- When stuck: ask "why is this happening?" before asking "how do I fix it?"

### Bug Fix Protocol
Never guess-and-patch. Always in order:
1. **Reproduce first** — confirm you can trigger the bug reliably before touching any code.
2. **Find the root cause** — fix the cause, not the symptom.
3. **Verify no regression** — confirm the bug is gone AND existing behaviour still works.

Skipping step 1 is how one fix spawns two new bugs.

### Long-term Lens
Every non-trivial decision: privacy/security risk? Still maintainable in a year? Safe for other users?

---

**Goal:** Chrome extension (this repo) + Obsidian plugin vault-autopilot (companion repo at `../vault-autopilot`) — a two-piece suite that clips screenshots, video covers, hooks and keyframes into Obsidian notes. One video = one note; sections upsert.

**Architecture:** The extension (Manifest V3, plain JS ES modules, no build step) captures content and POSTs it to `http://localhost:17183/clip`, served by vault-autopilot inside Obsidian. `GET /ping` is the health check the popup status light and welcome self-check page rely on. No native messaging, no Python, no external servers — everything stays on-machine.

**Tech:** Plain JavaScript ES modules / Manifest V3 / Jest. The old Python pipeline (host/, server/, pytest) was removed 2026-07-05; see git history if you need it.

**Key files:**
- `extension/modes/utils.js` — the single egress: `httpPost`, `pingAutopilot`, `getPort` (port `DEFAULT_PORT = 17183` must match vault-autopilot's default)
- `extension/modes/{screenshot,thumbnail,hook,keyframe}.js` — the four capture modes
- `extension/background.js` — thin service-worker router
- `extension/content.js` — page overlay (region picker, frame grids)
- `extension/welcome.html` + `welcome.js` — live self-check onboarding page (connection card, test clip, port escape hatch)
- `docs/examples/处理审美-SOP.md` — example SOP; real SOPs live in the user's vault and are configured in vault-autopilot settings

**How to run tests:**
```bash
cd extension && npm test   # Jest (ESM via --experimental-vm-modules)
```

**Collaboration rules:**
1. Vault writes only ever happen through vault-autopilot's HTTP endpoint — the extension never touches the filesystem.
2. User-facing errors go through `notifyError` / `notifyNotice` in utils.js; error copy is Chinese and actionable (tell the user what to do, not what failed internally).
3. Any change to the port, `/ping` shape, or `/clip` payload is a cross-repo contract change — update vault-autopilot in the same session and keep both defaults identical.
4. Never print API keys or tokens.

**Definition of done:**
- `cd extension && npm test` — all green
- Cross-repo contract unchanged, or changed on both ends together
- No hardcoded secrets anywhere
