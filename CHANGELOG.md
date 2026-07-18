# Changelog

All notable changes to the Visual Clipper Chrome extension are documented in this file.

## [0.3.0] — 2026-07-17

Onboarding overhaul — the extension now walks a stranger from "just installed" to "first clip saved" without any manual configuration:

- Live welcome page: a real-time connection self-check (green/red status)
- Popup status light: the toolbar popup shows at a glance whether vault-autopilot is reachable, no need to open the welcome page to check
- Dynamic port with an escape hatch: default port `17183`, but if it's taken by another app you can change it in one place (welcome page → 高级) instead of editing files
- Human-readable, actionable errors: connection failures now say what to check ("确认 Obsidian 开着、vault-autopilot 插件已启用...") instead of a raw exception
- Content-script reliability: fixed a first-click failure mode and a duplicate-capture bug so every mode works on the first try, including after SPA navigation
- Removed the legacy native-messaging host and local Python server — the extension now talks only to vault-autopilot over `localhost:17183`, simplifying install to "two extensions, no CLI setup"
- Welcome page: guided 8-step journey with real screenshots at every step — pin the extension, download the vault-autopilot zip from GitHub Releases, install it via Obsidian's plugins-folder icon, enable it, try a sample video, and find your notes in the gallery; the Notion path mirrors the same structure
- "Try it now" sample video replaces the synthetic test clip; a collapsible customize panel explains the three SOP choices (built-in analysis, your own rules, or clean captures with analysis off)
- Full bilingual UI (English + 简体中文), follows the browser language
- New "how the two pieces work together" explainer
- Notion destination (personal access token) with per-section upsert and bilingual setup UI; paste a duplicated template (gallery view included) or any page — existing schema-valid databases are adopted by schema, plain pages get an auto-created "Video Clips" database; capture pipeline refactored behind a destinations adapter layer (Obsidian behaviour unchanged)

## [0.2.0] — 2026-05-30 to 2026-06-30

Renamed from "Screenshot Clipper" to **Obsidian Visual Clipper** and expanded from a single screenshot tool into a four-mode video+screenshot capture suite.

### Added
- **收藏封面 (video cover)** mode: capture a video's cover image and metadata from YouTube, Bilibili, and Xiaohongshu via Open Graph tags, works on any video-hosting page
- **Hook 分析 (hook)** mode: sample candidate opening frames (0–15s, later densified to 1fps) plus transcript, for picking a video's "hook" frame
- **关键帧 (keyframe)** mode: Mark In / Mark Out on a video, then adaptively sample frames across that range; moved to a dedicated Chrome side panel with a two-step UI
- Pick-before-save frame picker for Hook and keyframe modes, with a 定格/全程 (freeze-frame vs. full-arc) toggle to keep an animation's whole motion instead of one still
- Smart frame de-duplication so near-identical frames from the same shot don't clutter the picker
- Transcript fetching unified across platforms: YouTube (iOS Innertube client) and Bilibili (player API, MAIN world), normalized into one clean text format
- One-video-one-note model: repeated captures (cover, then hook, then keyframe) on the same video append to the same Obsidian note instead of creating duplicates
- Plugin notice surfaced in the UI when vault-autopilot reports something like "section already exists"
- New extension logo (play + viewfinder mark on YouTube red)
- ES module support and Jest test setup for `extension/`

### Changed
- Migrated the extension's backend contract from native messaging to a local HTTP POST (`localhost:17183` → vault-autopilot), replacing the earlier Python/`claude -p` pipeline
- Reordered popup modes (封面 moved to second position) with uniform-size mode badges matching the vault's color palette
- Frame picker now stays visible in fullscreen video playback

### Fixed
- Screenshot reliability and auto-jump to the saved note in Obsidian after a successful clip
- Accurate error message when a page genuinely can't be captured (e.g. restricted `chrome://` pages)
- Thumbnail/cover metadata no longer goes stale on YouTube's single-page-app navigation
- Never POST a blank title; prefer `og:image` over guessed thumbnail URLs
- Full-resolution Bilibili covers (stripped the low-res CDN suffix) and cleaned-up titles (dropped the `_哔哩哔哩_bilibili` suffix)
- Intermittent duplicate-capture bug traced to a stale content-script guard flag and fixed at the root cause
- First-click reliability: content script injection now polls until ready instead of requiring a second click
- Keyframe capture guard that was accidentally always false

## [0.1.0] — 2026-05-29

Initial release as **Screenshot Clipper**: a Chrome extension + local Python backend for turning a region screenshot into a structured Obsidian study note.

### Added
- Region screenshot capture via a drag-to-select overlay on any webpage (ESC to cancel)
- Native-messaging bridge from the extension to a local Python host, which invoked `claude -p` to analyze the screenshot and write a note into the user's Obsidian vault
- "处理审美" SOP defining how captured screenshots should be turned into notes
- Popup UI: Clip button, vault name setting, clip history
- Auto-open the created note in Obsidian on success; Chrome notification and toolbar badge on failure
- Settings validation (vault/folder resolution by name) before starting a clip
- Install script handling Gatekeeper quarantine removal and `claude` binary path detection for the native host
