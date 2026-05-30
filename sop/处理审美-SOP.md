# 处理审美 SOP

You process ONE screenshot of a design into the user's aesthetic-study vault. You are invoked headless via `claude -p`. The prompt gives you: job JSON path, staged image path, vault root, aesthetic-notes folder, assets folder, source URL, title hint.

## Mode B (critical): you fill OBJECTIVE fields only; leave SUBJECTIVE fields BLANK.
- Fill: 背景色 (q1), 字的颜色有几种 (q2), 留白多还是少 (q4), and frontmatter palette/style.
- Leave BLANK (the user fills these): 眼睛第一秒落在哪里 (q3), 整体一个词 (q5), 我喜欢这里, 我不喜欢这里, 我能偷学什么.

## Steps

1. Read the job JSON to confirm fields.
2. Read the staged image with your vision.
3. Compute a safe name from the title hint (or the job id if title is empty):
   replace any of `/ \ : * ? " < > |` with a space, collapse repeated spaces, trim, max 100 chars.
4. Move the staged PNG into: `<vault root>/<assets folder>/<name>.png`
   (create the assets folder if missing).
5. Create the note at: `<vault root>/<aesthetic folder>/<name>.md` with EXACTLY this structure
   (fill the <FILL...> spots, leave the blank lines blank):

```
---
title: <name>
type: note
permalink: obsidian-sop/05-审美积累/单张分析/<name-slugified: replace spaces with dashes, lowercase ASCII, keep Chinese chars as-is>
status: 已分析
date: <today's date YYYY-MM-DD>
source: <source URL>
palette: [<2-5 dominant hex colors>]
style: [<2-4 short style tags, e.g. 浅底, 高留白, 编辑风>]
---

## Source:
<source URL>

![[<name>.png]]

## 五个问题
### 1. 背景色
<FILL: describe the background color, include hex>
### 2. 字的颜色有几种
<FILL: count + hex of the main text/foreground colors>
### 3. 眼睛第一秒落在哪里

### 4. 留白多还是少
<FILL: assess whitespace — 多 / 适中 / 少 + one phrase why>
### 5. 整体一个词


---
### 我喜欢这里

### 我不喜欢这里

### 我能偷学什么

```

6. Delete the staged PNG and the job JSON from the staging dir.
7. Print EXACTLY one final line and nothing after it:
   `NOTE_PATH: <vault-relative path to the .md, e.g. AI协作/05 审美积累/单张分析/<name>.md>`

## Rules
- Do not invent content for the blank (subjective) sections — leaving them empty is correct.
- Match the existing notes in the aesthetic folder: filename uses spaces not dashes, first char capitalized if Latin. If unsure, read one existing note in that folder first.
- The frontmatter `permalink` field must follow the same pattern as existing notes: `obsidian-sop/05-审美积累/单张分析/<slug>` where slug = name with spaces replaced by dashes, lowercase for ASCII letters, Chinese chars kept as-is.
- The frontmatter fields `title`, `type`, `permalink` are required by Basic Memory and must always be present. The additional fields `status`, `date`, `source`, `palette`, `style` are additive and will not break existing notes.
- Do not add any fields not listed in the template above.
