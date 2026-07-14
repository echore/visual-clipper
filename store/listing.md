# Chrome Web Store Listing — Obsidian Visual Clipper

## Name

Obsidian Visual Clipper

## Category

Productivity

## Short description (≤132 characters)

> Screenshot regions, video covers, hook frames & keyframes from any page — straight into your local Obsidian vault. No cloud.

(120 characters)

## Detailed description

### English

**Obsidian Visual Clipper turns anything on your screen into a structured note — with one click, and with your data going only where you choose.**

By default it works together with its companion Obsidian plugin, **vault-autopilot**: the extension captures, vault-autopilot writes the note into your vault, and nothing is uploaded anywhere — the extension talks only to `localhost:17183`, a server that vault-autopilot runs *inside your own Obsidian install*. If you'd rather use Notion, you can switch destinations and clip straight into a database in your own Notion workspace using your own personal access token — no server operated by this extension's developer is ever involved, in either mode.

**Four capture modes:**

- 📷 **Screenshot** — drag to select any region of any webpage and save it as its own note.
- 🖼️ **Video cover** — on a YouTube, Bilibili, or other video page, grab the cover image and metadata in one click.
- 🎬 **Hook** — sample a video's opening frames plus its transcript/captions, and pick the best "hook" frame for a note.
- 🎞️ **Keyframe** — mark an In and Out point on a video and sample frames across that range, for capturing a whole motion or sequence.

Capture the same video more than once — cover today, a hook frame tomorrow — and everything lands in the *same* note. One video, one note, built up over time.

**Why it's different:**

- **Local-first.** Every clip is a direct HTTP request from your browser to a server that only exists on your own machine, running inside your own Obsidian.
- **No accounts, no telemetry, no developer-operated servers.** Data is sent only to localhost (Obsidian mode), or your own authorized Notion workspace (Notion mode) — there is nothing to sign up for with us, and nothing being tracked.
- **Zero-config onboarding.** Install both pieces and a live welcome page checks the connection for you, then points you at a sample video to make your first real clip.
- **Actionable errors.** If something's not connected, you get a plain-language explanation of what to check — not a stack trace.

**Requirements:** the companion Obsidian plugin **vault-autopilot** must be installed and enabled for clips to save. The extension will tell you clearly if it can't reach it.

---

### 中文

**Obsidian Visual Clipper 能把网页上的任何内容一键存成结构化笔记——数据仅发送到 localhost（Obsidian 模式），或你自己授权的 Notion 工作区（Notion 模式）；无开发者服务器。**

默认配合 Obsidian 插件 **vault-autopilot** 使用：扩展负责抓取，vault-autopilot 负责把内容写进你的 vault，所有数据只在本机流转——扩展只会请求 `localhost:17183`，这是 vault-autopilot 在你自己的 Obsidian 里启动的本地服务。也可以改选 Notion 目的地，用你自己生成的个人访问令牌，直接把内容存进你自己 Notion 工作区里的一个 database——两种模式都不会经过本扩展开发者运营的任何服务器。

**四种模式：**

- 📷 **截图** — 在任意网页框选任意区域，存成独立笔记。
- 🖼️ **收藏封面** — 在 YouTube、Bilibili 等视频页面一键抓取封面图和元数据。
- 🎬 **Hook 分析** — 抓取视频开头的候选帧和字幕，挑出最佳"钩子"画面。
- 🎞️ **关键帧** — 在视频上标记起止点，按区间自动采样帧，适合记录一整段动作或过程。

同一个视频可以先后收藏封面、抓 Hook、标关键帧——所有内容都会追加进*同一条*笔记。一个视频一条笔记，随时间慢慢补全。

**它的不同之处：**

- **本地优先。** 每一次剪藏都是浏览器到你自己电脑上服务的直接请求，这个服务运行在你自己的 Obsidian 里。
- **无账号、无遥测、无开发者服务器。** 数据仅发送到 localhost（Obsidian 模式），或你自己授权的 Notion 工作区（Notion 模式）；不需要注册任何东西，也不会被追踪任何东西。
- **零配置上手。** 装好两件套后，一个实时自检的引导页会帮你确认连接，并给你一个示例视频完成第一条真实剪藏。
- **人话报错。** 连不上的时候，提示会告诉你该检查什么，而不是一段技术性异常信息。

**使用前提：** 需要同时安装并启用配套的 Obsidian 插件 **vault-autopilot**，剪藏内容才能落地保存。没连上时扩展会明确告诉你。

## Screenshot shot-list (3–5 images for the store listing)

1. **Popup, connected state** — toolbar popup open on a normal webpage, green connection status light visible, all four mode buttons shown. Establishes the core UI and "it's working" state at a glance.
2. **Screenshot mode in action** — drag-select overlay mid-selection on a real webpage (e.g. an article or design reference page), showing the crosshair/selection box. Demonstrates the flagship screenshot flow.
3. **Video cover capture on YouTube or Bilibili** — a video page with the popup open showing the 收藏封面 button, ideally with a toast/notification confirming the save. Demonstrates video-platform support.
4. **Keyframe side panel** — the Chrome side panel open on a video with Mark In / Mark Out controls and the sampled-frame picker grid visible. Demonstrates the more advanced capture flow.
5. **Welcome / self-check page** — the welcome page showing the live green connection check and the "Try it now" sample-video block, optionally with a resulting Obsidian note preview. Demonstrates zero-config onboarding and builds trust that setup is easy to verify.
