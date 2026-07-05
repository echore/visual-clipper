# Obsidian Visual Clipper

> Capture screenshots, video covers, hooks and keyframes from any webpage — one click, straight into your Obsidian vault.

Chrome 扩展，配合 Obsidian 插件 **[vault-autopilot](../vault-autopilot/)** 使用：在网页上截图、收藏视频封面、抓取视频开头（Hook）或标记关键帧，一键存成 Obsidian 笔记。全程本地运行，不经过任何外部服务器。

## 工作原理

```
Chrome 扩展 ──POST localhost:17183──▶ vault-autopilot（Obsidian 插件）──▶ 写入你的 vault
```

两件套缺一不可：扩展负责抓取，插件负责落库。**一个视频 = 一条笔记**——对同一个视频先后收藏封面、抓 Hook、标关键帧，内容都追加进同一条笔记，顺序随意。

## 安装

1. **装本扩展**：Chrome Web Store 搜索 "Obsidian Visual Clipper"（上架前：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选本仓库的 `extension/` 目录）
2. **装 vault-autopilot**：Obsidian → 设置 → 第三方插件 → 社区插件市场搜索 vault-autopilot（上架前：用 BRAT 安装）
3. 装完扩展会自动打开引导页，上面有**实时连接检测**和**发送测试 clip** 按钮——变绿就能用了，全程零配置

## 四种模式

| 模式 | 用途 | 产出 |
|---|---|---|
| 📷 截图 | 框选网页任意区域 | 独立截图笔记（`Clips/Screenshots/`） |
| 🖼️ 收藏封面 | YouTube / Bilibili / 小红书视频页 | 视频笔记 + 封面图（`Clips/Videos/`） |
| 🎬 Hook 分析 | 抓取视频开头候选帧 + 字幕 | 追加进该视频的笔记 |
| 🎞 关键帧 | 标记 In/Out 后采样区间帧 | 追加进该视频的笔记 |

默认所有内容落在 vault 的 `Clips/` 文件夹下，位置可在 vault-autopilot 设置中修改。

## 数据与隐私

你的 clip 数据只在本机流转（扩展 → 本机端口 17183 → 本地 Obsidian vault），不发送到任何开发者服务器。无账号、无云端、无遥测。唯一的外部请求：Hook/封面模式会用你自己的浏览器会话，直接向 YouTube/Bilibili 官方接口读取公开的视频元数据和字幕——等同于你自己浏览该页面，数据不经第三方中转。

## 常见问题

- **弹窗显示红灯 / 提示"没连上 Obsidian"**：确认 Obsidian 开着、vault-autopilot 已启用。点扩展弹窗底部「安装说明 / 帮助」打开引导页，有逐项排查
- **端口 17183 被占用**：Obsidian 会弹提示。关掉占用程序，或在插件设置和扩展引导页（高级 → 端口）两处改成同一个新端口
- **`chrome://` 等页面无法框选**：浏览器限制，截图模式会自动改存整页

## 开发

```bash
cd extension && npm install && npm test   # Jest 单元测试
```

无构建步骤——`extension/` 目录即成品，改完代码在 `chrome://extensions` 点刷新即可。

## License

[MIT](LICENSE)
