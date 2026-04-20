# TabDock

TabDock 是一个 Chrome 新标签页扩展，用来把当前浏览器里打开的 tabs 整理成本地保存的工作区。它会替换 Chrome New Tab 页面，并提供 Spaces、Stacks、Saved Tabs 三层结构，适合按项目、主题或上下文保存和恢复浏览状态。

项目目前是 MVP 阶段，重点是本地优先的 tab 管理体验：不依赖账号系统，不做云同步，也不会把保存的内容写入 Chrome bookmarks。

## 主要功能

- 替换 Chrome 新标签页入口，打开新标签页时进入 TabDock。
- 管理本地保存的 `Space`、`Stack` 和 `Saved Tab`。
- 读取当前 Chrome Profile 下已打开的 tabs，并按 Chrome window 分组展示。
- 将右侧当前打开的 tab 拖入 stack 保存。
- 将整个 window block 保存为新的 stack。
- 在 stack 内或 stack 之间拖动 saved tab 调整顺序和分类。
- 同一 space 内按标准化 URL 去重，避免重复保存同一页面。
- 点击 saved tab 时，如果页面已打开则切换到对应 tab，否则新建 tab 打开。
- 搜索 saved spaces、stacks、saved tabs、open tabs 和近 90 天 Chrome history。
- 支持关闭重复打开的 tabs。

## 技术栈

- React 19
- TypeScript
- Vite
- Chrome Extension Manifest V3
- `chrome.storage.local` 本地持久化
- Vitest + Testing Library
- Playwright
- ESLint

## 项目结构

```text
src/
  App.tsx                  # 主界面和交互入口
  chrome/
    chromeApi.ts           # Chrome extension API 适配层
    chromeTypes.ts         # Chrome API 类型定义
  domain/
    workspaceStore.ts      # Space/Stack/Tab 状态变更逻辑
    search.ts              # 搜索分组和排序逻辑
    types.ts               # 领域模型类型
  styles.css               # 应用样式
public/
  manifest.json            # Chrome Extension manifest
scripts/
  package-extension.mjs    # 构建并压缩扩展产物
tests/
  e2e/                     # 普通浏览器 E2E 测试
  extension/               # Chrome 扩展模式 E2E 测试
docs/
  PRD.md                   # 产品需求说明
DESIGN.md                  # 视觉和交互设计说明
```

## 本地开发

安装依赖：

```bash
npm ci
```

启动 Vite 开发服务器：

```bash
npm run dev
```

执行类型检查：

```bash
npm run typecheck
```

执行 lint：

```bash
npm run lint
```

执行单元测试和覆盖率：

```bash
npm test
```

执行普通浏览器 E2E 测试：

```bash
npm run e2e
```

执行扩展模式验证：

```bash
npm run verify:extension
```

## 构建和加载扩展

生成生产构建：

```bash
npm run build
```

构建结果会输出到 `dist/`。在 Chrome 中加载扩展：

1. 打开 `chrome://extensions/`
2. 开启 Developer mode
3. 点击 Load unpacked
4. 选择本仓库的 `dist/` 目录

加载后，新建 Chrome tab 会进入 TabDock 页面。

## 打包 zip

生成可发布的扩展 zip：

```bash
npm run package:zip
```

脚本会先执行生产构建，然后把 `dist/` 内容压缩为：

```text
release/tabdock-extension.zip
```

## 发布流程

仓库包含 GitHub Actions workflow：`.github/workflows/tag-artifact.yml`。

当推送 `v*` 格式的 tag 时，workflow 会：

1. 安装依赖
2. 执行 `npm run package:zip`
3. 将 zip 重命名为 `tabdock-extension-<tag>.zip`
4. 上传 GitHub Actions artifact
5. 创建或更新同名 GitHub Release，并上传 zip 产物

示例：

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 当前开发重点

- 完善 Chrome extension 模式下的真实 tabs/windows/history 集成。
- 打磨拖拽保存、排序、跨 stack 移动等核心交互。
- 增强搜索体验，包括键盘选择、分组展示和历史记录结果。
- 保持本地数据模型稳定，确保刷新后顺序和保存内容可恢复。
- 扩展 E2E 覆盖，验证新标签页入口和扩展权限相关流程。

## 参考文档

- 产品需求：[docs/PRD.md](docs/PRD.md)
- 设计说明：[DESIGN.md](DESIGN.md)
