# Permissions Justification — Visual Clipper

This document explains, permission by permission, why Visual Clipper requests each entry in `extension/manifest.json`. It is intended for the Chrome Web Store review form.

## `storage`

Used to persist small pieces of local UI state on the user's own machine: the last error/notice message to show in the popup, the user's chosen local port number (`sc_port`, in case the default `17183` conflicts with another app), keyframe Mark-In state, and screenshot batch-mode queue. None of this data is transmitted anywhere; it is read back only to render the popup and welcome page correctly across browser restarts.

## `activeTab`

Used to act on the tab the user is currently interacting with — for example, to know which tab to query for video detection or to send a capture command to. See the `host_permissions` section below for why `activeTab` alone is not sufficient for this extension's actual capture flows.

## `notifications`

Used to show a native Chrome notification when a clip fails to save (e.g. vault-autopilot is unreachable) so the user finds out even if the popup isn't open at the time. No notification is ever used for marketing, engagement prompts, or anything unrelated to the direct result of a user-initiated capture action.

## `tabs`

Used to query the currently active tab (`chrome.tabs.query`) and to send messages to its content script (`chrome.tabs.sendMessage`) so the popup and background service worker can coordinate a capture with the page the user is looking at. Also used to open the welcome/onboarding page in a new tab on install and from the popup's help link.

## `scripting`

Used to inject `content.js` programmatically (`chrome.scripting.executeScript`) when the content script isn't already present or responsive on the current page — for example, right after the extension is installed or reloaded, or after a single-page-app (SPA) navigation on sites like YouTube and Bilibili that don't trigger a full page reload. Without this permission, users would have to manually refresh every tab after installing or updating the extension before any capture mode would work.

## `sidePanel`

Used to host the Keyframe mode's two-step UI (Mark In / Mark Out, then a frame picker grid) in Chrome's side panel rather than the small popup window, since that flow needs more screen space and needs to stay open while the user scrubs the video. `chrome.sidePanel.open()` is called directly from a user click on the "关键帧" button in the popup.

## `host_permissions: ["<all_urls>"]`

This is the permission most likely to draw review scrutiny, so it's explained in full here.

**Why it's needed:** the extension's core feature is capturing content from *any* webpage the user chooses — not a fixed list of sites. Two of the four modes need this broad access for reasons specific to their mechanics:

1. **Arbitrary-page screenshotting.** The Screenshot mode must let a user drag-select a region on literally any page they're viewing (news articles, design references, documentation, internal tools, etc.) and inject a selection overlay there. There is no way to know in advance which domains a user will want to screenshot from — restricting to a fixed host list would defeat the feature's purpose.

2. **Video-platform frame capture across many hosts.** The Video cover, Hook, and Keyframe modes work generically via Open Graph metadata and `<video>` element access, not through a hardcoded list of "supported" video sites — the extension already supports YouTube, Bilibili, and Xiaohongshu, and is designed to work on any site that embeds a standard HTML5 video player or exposes Open Graph video metadata. A host allowlist would need constant maintenance and would break on any new site a user tries.

**Why `activeTab` alone is not sufficient:** `activeTab` only grants access to the current tab, only after a direct user gesture (e.g. clicking the extension's toolbar icon), and only until the tab navigates away. Three parts of this extension's design don't fit that model:

- **The content script must persist across time for video tracking.** Keyframe mode requires marking an In point, then continuing to interact with the video (playing, scrubbing) before marking an Out point — this can happen well after the initiating click, by which point an `activeTab`-scoped grant may no longer be valid.
- **The side panel keyframe flow is a separate UI surface**, not a direct response to a toolbar-icon click on that exact tab in the way `activeTab` expects; frame sampling and messaging happen from the side panel back to the original tab over an extended interaction, not a single synchronous gesture.
- **Re-injection after SPA navigations.** YouTube, Bilibili, and similar sites are single-page apps: navigating to a new video does not reload the page or fire a fresh user gesture, so an `activeTab` grant tied to the original navigation would not extend to the new video the user lands on. The extension needs to detect this and re-inject `content.js` (via the `scripting` permission) on the same tab without requiring the user to click the toolbar icon again — which is only possible with a standing host permission.

**What the extension does *not* do with this access:** it does not read, log, or transmit anything from a page unless the user actively triggers a capture (screenshot selection, cover grab, hook/keyframe sampling). There is no background scraping, no passive data collection across tabs, and no data sent anywhere except the user's own `localhost:17183` vault-autopilot instance (see `store/privacy-policy.md`).
