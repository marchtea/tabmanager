# Chrome TabDock PRD

## 1. 背景与目标

本产品是一个参考 Stackable 交互形态的 Chrome TabDock。第一版以 Chrome Extension 的新标签页为主入口，帮助用户把当前打开的 Chrome tabs 整理为本地保存的工作区结构。

MVP 已实现目标：

- 替换 Chrome New Tab 页面，打开新标签页即进入 TabDock。
- 管理本地保存的 Spaces、Stacks 和 Tabs。
- 右侧展示当前 Chrome Profile 下所有打开的 tabs，按 Chrome window 分 block。
- 支持从当前打开 tabs 拖拽保存到 workspace/stack。
- 支持搜索 saved 数据、当前打开 tabs、近 90 天 Chrome history。
- 支持应用内搜索快捷键和 Chrome 全局搜索命令。
- 支持关闭重复打开的 tabs、关闭单个 open tab、关闭整个 Chrome window。
- 支持在不同 Chrome window block 之间拖动 open tab。
- 支持 JSON 导入/导出、本地目录自动备份和从最新备份恢复。

规划中但尚未完整落地：

- 批量读取真实网页 `meta description`，用于搜索增强。
- 更细粒度的 saved tab 插入位置反馈。

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
- Chrome action/commands 可触发全局搜索：
  - 在 TabDock 页面内直接打开并聚焦搜索弹窗。
  - 在普通网页上注入轻量搜索 overlay。
  - 如果当前页面无法注入，则回退打开或聚焦 TabDock 页面。

### 2.2 核心概念

- `Space`：workspace，用户的一级工作区。
- `Stack`：Space 内的分类列。
- `Saved Tab`：保存到 Stack 中的页面记录，是扩展自己的独立本地记录，不写入 Chrome bookmarks。
- `Open Tab Block`：当前 Chrome Profile 下一个 Chrome window 对应一个 block。
- `Open Tab`：当前浏览器实际打开的 tab，可被拖入 stack 保存。

### 2.3 当前实现状态

- `Space`、`Stack`、`Saved Tab` 的 CRUD、排序、拖拽保存和本地持久化已实现。
- 新标签页三栏工作台、右侧 Open Tabs 浮窗、搜索弹窗、设置弹窗已实现。
- Open Tabs 面板支持总数展示、折叠、刷新、窗口 block 折叠、关闭 tab/window、重复 tab 清理、清除已保存 tab、跨 window 移动 tab。
- 数据管理支持 JSON 导出、JSON 导入替换、授权本地目录、自动写入 `latest.json`、从 `latest.json` 恢复。
- 全局搜索支持 Chrome command、普通网页 overlay、TabDock 页面内搜索弹窗复用。
- 多个 TabDock 新标签页同时打开时，页面会监听本地存储变化并刷新 workspace/settings；并发保存会合并较新的持久化状态，避免新增 Space、Stack、Saved Tab 相互覆盖。

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
- Space 支持拖拽排序。
- 侧边栏提供设置入口。

### 3.2 搜索弹窗

搜索范围：

- Saved Spaces：按 space 名称搜索。
- Saved Stacks：按 stack 名称搜索。
- Saved Tabs：按 title、URL、description 搜索。
- Open Tabs：按 title、URL 搜索；如果已有 description，则纳入搜索。
- Chrome History：搜索近 90 天 history，按 title、URL 匹配。
- 搜索词按空格拆分为多个关键词；所有关键词都需要在可搜索字段中模糊命中。
- History 结果会清理常见追踪参数后展示和去重，减少同一页面因 `utm_*`、`vd_source`、`si` 等追踪参数产生的重复结果。
- History 搜索会合并 Chrome 当前关键词搜索结果和近 30 天历史补充池，再由 TabDock 本地模糊匹配过滤，以补足 URL 中间/后缀关键词匹配。

入口：

- 点击左侧搜索入口打开应用内搜索弹窗。
- 使用应用内快捷键打开搜索弹窗。
- 使用 Chrome 全局命令快捷键打开搜索：
  - 默认 `Ctrl+Shift+K`，macOS 默认 `Command+Shift+K`。
  - 在 TabDock 页面内打开原生搜索弹窗并自动聚焦输入框。
  - 在普通网页上打开注入式 overlay，输入、方向键和 Enter 不透传到原页面。
  - 在无法注入的页面回退到打开 TabDock 并带 `search=1` 参数。

结果展示：

- 弹窗顶部是搜索输入框。
- 结果按类型分组：Spaces、Stacks、Saved Tabs、Open Tabs、History。
- 支持键盘上下选择和 Enter 打开。
- 支持鼠标悬停选择和点击结果，悬停后输入框仍保持键盘输入焦点。
- 打开后输入框必须立即聚焦，用户可直接输入。
- 当没有 TabDock 本地结果时，展示 Google 搜索操作项；点击或按 Enter 会用当前关键词打开 Google 搜索。

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
- 展示当前 space 的 stack 数量和 saved tab 数量。
- 标题最右侧展示 `+` 按钮，用于新增 stack。

Stacks 展示：

- Stacks 横向并行展示。
- 每个 stack 固定宽度。
- Stack 内 tabs 垂直排列。
- 主区域支持横向滚动，stack 不需要铺满屏幕。
- 短 stack 内容自适应高度；长 stack 内部滚动。
- 横向/纵向滚动时短暂显示滚动条反馈。

Stack 操作：

- Hover stack 标题时显示操作图标。
- 点击操作图标展示菜单：
  - 编辑 stack 名称。
  - 删除 stack。
- Stack 标题区提供批量选择 saved tabs 入口。
- 删除 stack 前二次确认；删除只影响本地保存数据，不关闭真实 Chrome tabs。
- 按住并拖动 stack 标题：调整 stack 在当前 space 内的顺序。
- 拖动结束后立即持久化排序。

Saved Tab 操作：

- Saved tab card 展示 favicon、title、URL 或 description 摘要。
- 点击 saved tab 按“已开则切换，否则新开”规则打开。
- 支持从一个 stack 拖动 tab 到同 stack 内重新排序。
- 支持从一个 stack 拖动 tab 到另一个 stack，改变分类并插入目标位置。
- 支持进入单个 stack 的选择模式，选择多个 saved tabs 后一次性删除。
- 在单个 stack 的选择模式中，hover saved tab 时显示编辑入口；点击后弹窗编辑标题和 URL，保存后更新本地记录。
- 同一个 URL 在同一 space 内只保存一份。
- 编辑 saved tab URL 时，同一 space 内仍不能产生重复 URL。
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
- Block 标题支持折叠/展开；滚动时标题保持 sticky。
- 面板标题展示当前 open tab 总数，例如 `Open 10 tabs`。
- 面板支持整体折叠成窄 rail，并展示 open tab 总数。
- 排除当前 TabDock 新标签页自身，避免管理器页面污染列表。
- 对无法访问的页面，例如 `chrome://`、Chrome Web Store、扩展页面，仍展示 title/URL；meta description 可为空。
- Chrome tabs 创建、更新、删除时自动刷新 open tabs 列表。

拖拽行为：

- 拖动单个 open tab 到某个 stack：
  - 读取并保存 title、URL、favicon；如果已有 description，则一并保存。
  - 原始浏览器 tab 保留，不关闭。
  - 如果同 URL 已存在于当前 space，则移动已有 saved tab 到目标 stack。
- 拖动 block 标题到当前 workspace：
  - 弹窗要求用户输入新 stack 名称。
  - 默认名称为当前时间，例如 `2026-04-18 15:30`。
  - 确认后创建新 stack，并将该 block/window 下所有可保存 tabs 加入新 stack。
  - 同 URL 在当前 space 已存在时，不重复创建，改为移动到新 stack。
- 取消弹窗则不创建 stack，不保存 tabs。
- 拖动一个 open tab 到另一个 window block：
  - 调用 Chrome tabs move，将该 tab 移入目标 window 末尾。
  - 移动后刷新 block 数量和列表。

Open Tabs 操作：

- 点击 open tab：按“已开则切换，否则新开”规则聚焦对应 tab。
- Hover open tab 显示关闭按钮；点击后关闭真实 Chrome tab，并刷新列表。
- Hover window block 标题显示关闭按钮；点击后关闭真实 Chrome window，并刷新列表。
- 点击刷新按钮手动重新读取当前 tabs/windows。
- 点击去重按钮关闭重复 open tabs：
  - URL 去重使用标准化 URL，忽略 hash、尾部斜杠和常见追踪参数。
  - 如果重复项包含当前活跃 TabDock tab，保留当前活跃 TabDock tab。
  - 操作完成后显示关闭数量或“没有重复 Tab”。
- 点击清除已保存按钮关闭已经保存到任意 workspace space/stack 的 open tabs：
  - URL 匹配使用标准化 URL，忽略 hash、尾部斜杠和常见追踪参数。
  - 操作只关闭真实 Chrome open tabs，不删除 workspace 中的 saved tabs。
  - 操作完成后显示清除数量；没有可清除项时按钮不可用。

### 3.5 设置与数据管理

快捷键：

- 设置弹窗展示当前搜索快捷键。
- 快捷键来源于 Chrome commands 配置；应用内搜索和全局搜索使用同一个快捷键。
- 提供跳转 `chrome://extensions/shortcuts` 的入口，由 Chrome 管理快捷键修改。

导入导出：

- 支持导出完整本地状态为 `tabdock-backup.json`。
- 支持从 JSON 文件导入完整状态；导入前二次确认。
- 导入是全量替换当前 TabDock 数据。
- 导入文件大小上限为 2 MB。
- JSON 解析失败或格式不符合 TabDock 备份 schema 时，不覆盖当前数据，并显示错误。

本地目录备份：

- 支持通过 File System Access API 授权本地备份目录。
- 授权后立即写入 `latest.json`。
- 授权有效期间，workspace/settings 变化后自动写入最新备份。
- 支持从授权目录中的 `latest.json` 恢复；恢复前二次确认。
- 浏览器不支持目录授权、权限失效、读写失败时显示对应状态。

## 4. 数据、权限与接口

### 4.1 本地数据模型

本地使用 `chrome.storage.local` 保存 `TabDockLocalStateV1`。旧版 `tabManagerWorkspace` 和 `tabManagerSettings` 读取时会被归一化为新版状态。

TabDock 页面订阅 `chrome.storage.onChanged`；其他页面写入新版本地状态后，当前页面必须同步 workspace/settings，且由远端同步触发的本地 state 更新不得再次回写形成循环。

保存 workspace/settings 时，如果当前页面基于旧快照修改，而 `chrome.storage.local` 中已有更新快照，必须以页面加载或上次同步的快照为 base 做三方合并，再写入新版本地状态。JSON 导入和从本地备份恢复仍是全量替换。

```ts
type TabDockLocalStateV1 = {
  format: "tabdock.local-state";
  schemaVersion: 1;
  updatedAt: number;
  workspace: WorkspaceState;
  settings: TabManagerSettings;
};
```

Workspace 数据模型：

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

type WorkspaceState = {
  spaceIds: string[];
  spaces: Record<string, Space>;
  stacks: Record<string, Stack>;
  tabs: Record<string, SavedTab>;
  activeSpaceId?: string;
};

type TabManagerSettings = {
  appSearchShortcut: string;
};
```

### 4.2 Chrome Extension 权限

当前实现需要：

- `storage`：保存 spaces/stacks/tabs。
- `tabs`：读取和切换当前 profile 的 tabs。
- `windows`：按 window 分组展示 open tabs，聚焦 window，关闭 window。
- `history`：搜索近 90 天 Chrome history。
- `scripting` + host permissions：在普通网页注入全局搜索 overlay；后续用于读取 `meta description`。
- `chrome_url_overrides.newtab`：替换新标签页。
- `commands.open_global_search`：注册 Chrome 全局搜索快捷键。
- `background.service_worker`：处理全局搜索命令、搜索消息和结果跳转。
- `action`：提供扩展入口和图标。
- File System Access API：授权本地目录并读写 `latest.json`，非 manifest 权限。

权限策略：

- 普通网页全局搜索优先注入 overlay。
- 对 Chrome 禁止注入的页面优雅降级，打开或聚焦 TabDock 页面。
- 读取真实 open tabs 时仅依赖 title/URL/favicon；`meta description` 读取规划中。
- 对 Chrome 禁止注入的页面优雅降级，只使用 title/URL。
- 读取失败不阻塞保存和搜索。

### 4.3 持久化规则

- 所有用户操作立即保存到 `chrome.storage.local`。
- Space 内 URL 全局去重。
- 删除 space/stack/saved tab 不影响真实打开的 Chrome tabs。
- 拖拽排序是权威顺序，刷新页面后保持不变。
- Space 排序通过 `spaceIds` 持久化。
- Stack 排序通过 Space 的 `stackIds` 持久化。
- Saved tab 排序通过 Stack 的 `tabIds` 持久化。
- 导入、恢复和自动备份使用同一 `TabDockLocalStateV1` schema。
- URL 标准化会移除 hash、尾部斜杠和常见追踪参数，用于 saved tab 去重和 open tab 去重。

## 5. 交互与视觉要求

- 整体参考 Stackable：浅色、克制、信息密度高。
- 中文 UI 优先。
- 三栏布局：
  - 左侧 sidebar 固定宽度。
  - 中间 workspace 占主要空间。
  - 右侧 open tabs 浮窗固定宽度，可滚动。
  - 右侧 open tabs 浮窗可折叠，折叠态不遮挡 workspace。
- Stack 和 tab card 尺寸稳定，拖拽、hover、菜单出现时不造成布局跳动。
- 搜索弹窗居中覆盖页面，背景遮罩。
- 搜索弹窗支持键盘操作。
- 搜索弹窗和全局 overlay 打开后必须抢占焦点，支持直接输入。
- 拖拽时必须有明确 hover/drop 反馈。
- 空状态要可操作：
  - 无 space：提示创建第一个 space。
  - Space 无 stack：展示新增 stack 按钮。
  - Stack 无 tab：提示可从右侧拖入 tab。

## 6. 验收标准与测试计划

### 6.1 核心验收标准

- 打开新标签页时进入 TabDock。
- 能创建、切换、重命名、删除 space。
- 能拖拽调整 space 顺序并刷新后保持。
- 能创建、重命名、删除、拖拽排序 stack。
- 能从右侧 open tab 拖入 stack 并保存。
- 能拖动 block 标题创建包含整个 window tabs 的 stack。
- 能在 stack 内和 stack 间拖动 saved tab。
- 能选择并批量删除单个 stack 内的 saved tabs。
- 能在单个 stack 的选择模式中编辑 saved tab 的标题和 URL。
- 同一 space 内同 URL 不重复保存。
- 点击 saved tab 时，已打开则切换，未打开则新开。
- 搜索能找到 saved spaces、stacks、tabs、open tabs 和近 90 天 history。
- 应用内快捷键和 Chrome 全局快捷键能打开搜索，搜索输入框立即聚焦。
- 普通网页全局搜索 overlay 能搜索、悬停选择、点击打开结果，键盘事件不透传到原页面。
- 右侧 open tabs 面板能折叠/展开，window block 能折叠/展开。
- 右侧 open tabs 标题展示当前 open tab 总数。
- 能关闭单个 open tab、关闭整个 window、移动 open tab 到另一个 window。
- 能关闭重复 open tabs，并保留当前活跃 TabDock tab。
- 能一键关闭已经保存到 workspace 的 open tabs，且保留 saved tabs。
- 能导出 JSON、导入 JSON、拒绝无效 JSON、授权本地备份目录、写入和恢复 `latest.json`。
- Chrome 禁止访问的页面不会导致页面崩溃。

### 6.2 测试场景

Unit tests：

- Space/stack/tab reducer 或 store 操作。
- URL 去重和移动策略。
- Space 拖拽排序。
- 批量删除 saved tabs。
- 编辑 saved tab 标题和 URL，并拒绝同一 space 内重复 URL。
- 搜索结果分组和排序。
- History 时间范围过滤。
- 本地状态 schema 序列化、导入校验、旧数据归一化。
- 快捷键标准化和匹配。
- 本地备份目录授权状态、读写、恢复失败路径。

Integration tests：

- Mock Chrome APIs 验证 tabs/windows/history/storage 调用。
- Meta description 读取失败时降级。
- Storage 写入后刷新恢复顺序。
- Chrome commands 全局搜索、runtime message、搜索结果跳转。
- Open tabs 列表订阅 tabs create/update/remove 后刷新。
- 关闭 tab/window、移动 tab 到 window、重复 tab 清理。
- JSON 导入导出和 File System Access API 备份。

E2E tests：

- 新标签页加载主界面。
- 创建 space/stack，拖入 open tab。
- 拖动 stack 改变顺序。
- 拖动 tab 跨 stack。
- 搜索并打开 saved tab/open tab/history。
- 删除 stack/space 的确认流程。
- Space 拖拽排序。
- Stack 内 saved tabs 批量删除。
- Stack 选择模式中编辑 saved tab 标题和 URL。
- Open tabs 面板折叠、window block 折叠、sticky 标题和滚动行为。
- 全局快捷键打开搜索并立即输入。
- 全局搜索 overlay 阻止键盘事件透传，并保持鼠标悬停后的点击和输入焦点。
- 导出、导入、无效导入、本地目录自动备份。
- Open tabs 关闭、移动和去重流程。

## 7. 假设与默认决策

- 当前实现基于 React、TypeScript、Vite 和 Chrome Extension Manifest V3。
- MVP 只支持当前 Chrome Profile；普通扩展无法稳定跨 Profile 或跨浏览器实例读取 tabs。
- Saved tab 是扩展自己的本地数据，不写入 Chrome bookmarks。
- 当前较宽的 host permissions 已用于全局搜索 overlay 注入；后续批量读取 `meta description` 也会复用该权限。
- 第一版不实现 Smart Stack 自动分类，但 UI 可以预留未来入口。
