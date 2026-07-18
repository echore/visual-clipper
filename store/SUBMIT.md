# Chrome Web Store 提交清单 — 0.3.0

## 上传的包

用 `dist/obsidian-visual-clipper-0.3.0-webstore.zip`（manifest 已去除 `key` 字段——商店拒收含 key 的包）。
不要用 `dist/obsidian-visual-clipper-0.3.0.zip`，那个是 GitHub release 用的（保留 key 以固定扩展 ID）。

重新生成方式：解压 release zip → 删除 manifest.json 里的 `key` 字段 → 重新打包。

## 提交步骤

1. 注册开发者账号：https://chrome.google.com/webstore/devconsole （一次性 $5）
2. 「新建项目」→ 上传 `obsidian-visual-clipper-0.3.0-webstore.zip`
3. 商店listing：文案直接从 `store/listing.md` 复制（名称、短描述、详细描述、类别）
4. 隐私标签页：
   - 隐私政策 URL：`https://github.com/echore/visual-clipper/blob/master/store/privacy-policy.md`
   - 数据使用声明：不收集任何用户数据（参照 privacy-policy.md 逐项勾选）
   - 各权限用途说明：从 `store/permissions-justification.md` 逐条复制
5. 截图素材（需自行截取，1280×800 或 640×400，至少 1 张）：
   - 建议：四模式面板、区域截图选取、Obsidian 里生成的视频笔记、welcome 引导页
6. 提交审核（通常 1–3 个工作日；含 host 权限可能更久）

## 审核通过后

- README「装本扩展」一节补上商店链接（当前写的是"上架后可搜索安装"）
- welcome 页 zip 安装引导保留——离线/企业用户仍需要
