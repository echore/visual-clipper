# Privacy Policy — Obsidian Visual Clipper

**Last updated:** 2026-07-05

Obsidian Visual Clipper ("the extension") is built on one simple rule: **your data never leaves your computer.** This policy explains exactly what the extension does, in plain language.

## What the extension captures

Depending on the mode you use, the extension captures:

- **Screenshot mode:** a cropped image of a region you select on the current webpage.
- **Video cover mode:** a video's cover/thumbnail image and basic metadata (title, source URL) read from the page you're viewing.
- **Hook mode:** a handful of sampled frames from the first seconds of a video on the page, plus the video's caption/transcript text if available.
- **Keyframe mode:** sampled frames from a time range you mark on a video on the page.

All of this is read directly from the webpage that is already open in your browser tab — the extension does not visit any page or fetch any URL you haven't already navigated to.

## Where that data goes

Everything the extension captures is sent to **one destination only**: `http://localhost:17183` on your own computer. This is a local server started by the companion Obsidian plugin, **vault-autopilot**, running inside your own installation of Obsidian. vault-autopilot writes the captured content into a note in your own Obsidian vault, on your own disk.

Nothing is uploaded to any server operated by the developer of this extension or any third party. There is no cloud backend. If Obsidian (and vault-autopilot) is not running, the extension simply cannot save anything — it has nowhere else to send data.

## Page-context API calls

For YouTube and Bilibili video pages, the extension may call those platforms' own caption/metadata APIs (for example, to fetch a video's transcript) directly from the page you are already viewing, using your existing browser session on that site. These calls happen as part of your normal browsing on that platform — the same way the video page itself already talks to YouTube or Bilibili to play the video — and are not initiated by, sent through, or visible to the developer of this extension.

## What we do not do

- **No data collection.** The developer does not receive, store, or have access to any content you capture.
- **No sale of data.** There is no data to sell — none is collected in the first place.
- **No telemetry or analytics.** The extension does not phone home, does not report usage statistics, and does not track how or whether you use it.
- **No accounts.** There is no sign-up, login, or user identity of any kind associated with the extension.
- **No third-party trackers, ad networks, or embedded analytics SDKs.**

## Permissions

The extension requests a handful of Chrome permissions (storage, activeTab, notifications, tabs, scripting, sidePanel, and host access) strictly to let it read the page you're on, show you capture UI, and send your capture to your own local vault-autopilot server. See `store/permissions-justification.md` in this repository for a full, per-permission explanation.

## Data retention

The extension itself does not retain your captured content after it hands it off to vault-autopilot — it does not maintain a history, cache, or database of past clips beyond small local UI state (like your last error message or your chosen local port number), which is stored using Chrome's local extension storage and never transmitted anywhere.

## Changes to this policy

If this policy changes, the updated version will be posted at this same URL with a new "Last updated" date.

## Contact

Questions about this policy or the extension's data handling can be raised via the project's GitHub repository issue tracker.
