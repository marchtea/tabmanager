# Chrome TabDock PRD

## 1. 背景与目标

本产品是一个参考 Stackable 交互形态的 Chrome TabDock。第一版以 Chrome Extension 的新标签页为主入口，帮助用户把当前打开的 Chrome tabs 整理为本地保存的工作区结构。

MVP 目标：

- 替换 Chrome New Tab 页面，打开新标签页即进入 TabDock。
- 管理本地保存的 Spaces、Stacks 和 Tabs。
- 右侧展示当前 Chrome Profile 下所有打开的 tabs，按 Chrome window 分 block。
- 支持从当前打开 tabs 拖拽保存到 workspace/stack。
- 支持搜索 saved 数据、当前打开 tabs、近 90 天 Chrome history。
- 支持批量读取网页 `meta description`，用于搜索增强。

第一版暂不包含：

- 云同步、账号系统、多人协作。
- Share、自定义 Chrome、Smart Stack 自动分类。
- 与 Chrome bookmarks 双向同步。
- 跨 Chrome Profile

## 2. 产品结构

### 2.1 主入口

- 使用 Chrome Extension `chrome_url_overrides.newtab` 替换新标签页。
- 新标签页打开后展示完整三栏界面：
  - 左侧：搜索入口 + Spaces 列表。
  - 中间：当前打开 Space 的 Stacks 看板。
  - 右侧：当前打开 tabs 浮窗，按 window 分 block。

### 2.2 核心概念

- `Space`：workspace，用户的一级工作区。
- `Stack`：Space 内的分类列。
- `Saved Tab`：保存到 Stack 中的页面记录，是扩展自己的独立本地记录，不写入 Chrome bookmarks。
- `Open Tab Block`：当前 Chrome Profile 下一个 Chrome window 对应一个 block。
- `Open Tab`：当前浏览器实际打开的 tab，可被拖入 stack 保存。

## 3. 功能需求

### 3.1 左侧 Sidebar

- 顶部展示产品名和搜索入口。
- 点击搜索入口或使用快捷键打开搜索弹窗。
- 展示所有 saved spaces。
- 当前选中的 space 高亮。
- 当前 space 下方缩进展开该 space 的 stacks。
- 点击 space：切换主区域到对应 workspace。
- 点击 stack：主区域滚动定位到对应 stack。
- 提供新增 space 入口。
- Space 支持重命名、删除。
- 删除 space 前二次确认；删除只影响本地保存数据，不关闭真实 Chrome tabs。

### 3.2 搜索弹窗

搜索范围：

- Saved Spaces：按 space 名称搜索。
- Saved Stacks：按 stack 名称搜索。
- Saved Tabs：按 title、URL、meta description 搜索。
- Open Tabs：按 title、URL、meta description 搜索。
- Chrome History：搜索近 90 天 history，按 title、URL 匹配。

结果展示：

- 弹窗顶部是搜索输入框。
- 结果按类型分组：Spaces、Stacks、Saved Tabs、Open Tabs、History。
- 支持键盘上下选择和 Enter 打开。
- 支持鼠标点击结果。

点击行为：

- 点击 Space：切换到该 space。
- 点击 Stack：切换到其 space 并滚动到该 stack。
- 点击 Saved Tab：
  - 如果当前 profile 已有相同 URL 的 open tab，聚焦该 tab 所在 window 并切换到该 tab。
  - 否则新开 tab 打开该 URL。
- 点击 Open Tab：聚焦该 tab 所在 window 并切换到该 tab。
- 点击 History：新开 tab 打开该 URL。

### 3.3 主区域 Workspace

顶部：

- 展示当前 space 名称。
- 标题最右侧展示 `+` 按钮，用于新增 stack。

Stacks 展示：

- Stacks 横向并行展示。
- 每个 stack 固定宽度。
- Stack 内 tabs 垂直排列。
- 主区域支持横向滚动，stack 不需要铺满屏幕。

Stack 操作：

- Hover stack 标题时显示操作图标。
- 点击操作图标展示菜单：
  - 编辑 stack 名称。
  - 删除 stack。
- 删除 stack 前二次确认；删除只影响本地保存数据，不关闭真实 Chrome tabs。
- 按住并拖动 stack 标题：调整 stack 在当前 space 内的顺序。
- 拖动结束后立即持久化排序。

Saved Tab 操作：

- Saved tab card 展示 favicon、title、URL 或 description 摘要。
- 点击 saved tab 按“已开则切换，否则新开”规则打开。
- 支持从一个 stack 拖动 tab 到同 stack 内重新排序。
- 支持从一个 stack 拖动 tab 到另一个 stack，改变分类并插入目标位置。
- 同一个 URL 在同一 space 内只保存一份。
- 如果用户把已存在于当前 space 的 URL 拖入另一个 stack：
  - 移动现有 saved tab 到目标 stack。
  - 按拖入位置更新排序。
  - 不创建重复记录。

### 3.4 右侧 Open Tabs 浮窗

展示规则：

- 展示当前 Chrome Profile 下所有 Chrome windows。
- 每个 window 是一个 block。
- Block 标题展示 tab 数量和 window 标识，例如 `Window 1 · 12 tabs`。
- 每个 block 内展示该 window 的 tabs。
- 排除当前 TabDock 新标签页自身，避免管理器页面污染列表。
- 对无法访问的页面，例如 `chrome://`、Chrome Web Store、扩展页面，仍展示 title/URL；meta description 可为空。

拖拽行为：

- 拖动单个 open tab 到某个 stack：
  - 读取并保存 title、URL、favicon、meta description。
  - 原始浏览器 tab 保留，不关闭。
  - 如果同 URL 已存在于当前 space，则移动已有 saved tab 到目标 stack。
- 拖动 block 标题到当前 workspace：
  - 弹窗要求用户输入新 stack 名称。
  - 默认名称为当前时间，例如 `2026-04-18 15:30`。
  - 确认后创建新 stack，并将该 block/window 下所有可保存 tabs 加入新 stack。
  - 同 URL 在当前 space 已存在时，不重复创建，改为移动到新 stack。
- 取消弹窗则不创建 stack，不保存 tabs。

## 4. 数据、权限与接口

### 4.1 本地数据模型

本地使用 `chrome.storage.local` 保存：

```ts
type Space = {
  id: string;
  name: string;
  stackIds: string[];
  createdAt: number;
  updatedAt: number;
};

type Stack = {
  id: string;
  spaceId: string;
  name: string;
  tabIds: string[];
  createdAt: number;
  updatedAt: number;
};

type SavedTab = {
  id: string;
  spaceId: string;
  stackId: string;
  title: string;
  url: string;
  faviconUrl?: string;
  description?: string;
  source: "open-tab" | "history" | "manual";
  createdAt: number;
  updatedAt: number;
};
```

### 4.2 Chrome Extension 权限

MVP 需要：

- `storage`：保存 spaces/stacks/tabs。
- `tabs`：读取和切换当前 profile 的 tabs。
- `windows`：按 window 分组展示 open tabs。
- `history`：搜索近 90 天 Chrome history。
- `scripting` + host permissions：批量读取打开页面的 `meta description`。
- `chrome_url_overrides.newtab`：替换新标签页。

权限策略：

- 批量读取当前打开 tabs 的 meta description。
- 对 Chrome 禁止注入的页面优雅降级，只使用 title/URL。
- 读取失败不阻塞保存和搜索。

### 4.3 持久化规则

- 所有用户操作立即保存到 `chrome.storage.local`。
- Space 内 URL 全局去重。
- 删除 space/stack/saved tab 不影响真实打开的 Chrome tabs。
- 拖拽排序是权威顺序，刷新页面后保持不变。

## 5. 交互与视觉要求

- 整体参考 Stackable：浅色、克制、信息密度高。
- 中文 UI 优先。
- 三栏布局：
  - 左侧 sidebar 固定宽度。
  - 中间 workspace 占主要空间。
  - 右侧 open tabs 浮窗固定宽度，可滚动。
- Stack 和 tab card 尺寸稳定，拖拽、hover、菜单出现时不造成布局跳动。
- 搜索弹窗居中覆盖页面，背景遮罩。
- 搜索弹窗支持键盘操作。
- 拖拽时必须有明确 hover/drop 反馈。
- 空状态要可操作：
  - 无 space：提示创建第一个 space。
  - Space 无 stack：展示新增 stack 按钮。
  - Stack 无 tab：提示可从右侧拖入 tab。

## 6. 验收标准与测试计划

### 6.1 核心验收标准

- 打开新标签页时进入 TabDock。
- 能创建、切换、重命名、删除 space。
- 能创建、重命名、删除、拖拽排序 stack。
- 能从右侧 open tab 拖入 stack 并保存。
- 能拖动 block 标题创建包含整个 window tabs 的 stack。
- 能在 stack 内和 stack 间拖动 saved tab。
- 同一 space 内同 URL 不重复保存。
- 点击 saved tab 时，已打开则切换，未打开则新开。
- 搜索能找到 saved spaces、stacks、tabs、open tabs 和近 90 天 history。
- Chrome 禁止访问的页面不会导致页面崩溃。

### 6.2 测试场景

Unit tests：

- Space/stack/tab reducer 或 store 操作。
- URL 去重和移动策略。
- 搜索结果分组和排序。
- History 时间范围过滤。

Integration tests：

- Mock Chrome APIs 验证 tabs/windows/history/storage 调用。
- Meta description 读取失败时降级。
- Storage 写入后刷新恢复顺序。

E2E tests：

- 新标签页加载主界面。
- 创建 space/stack，拖入 open tab。
- 拖动 stack 改变顺序。
- 拖动 tab 跨 stack。
- 搜索并打开 saved tab/open tab/history。
- 删除 stack/space 的确认流程。

## 7. 假设与默认决策

- 当前目录为空仓库，后续实现会从 Chrome Extension 项目脚手架开始。
- MVP 只支持当前 Chrome Profile；普通扩展无法稳定跨 Profile 或跨浏览器实例读取 tabs。
- Saved tab 是扩展自己的本地数据，不写入 Chrome bookmarks。
- 用户接受为了批量读取 meta description 而申请较宽的页面访问权限。
- 第一版不实现 Smart Stack 自动分类，但 UI 可以预留未来入口。
