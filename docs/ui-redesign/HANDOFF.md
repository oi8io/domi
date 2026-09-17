# domi Web UI Redesign — 主程交接文档

> 原型文件：`docs/ui-redesign/index.html`（单文件自包含，浏览器直接打开）
> 目标栈：React + Tailwind + shadcn/ui（按 ADR-013，Tailwind/shadcn 推到 parity 轮落地）
> 设计方向：Modern Dev Tool（GitHub Dark 风格），用户已确认

---

## 1. 设计 Token

直接从原型 CSS 变量提取，落地时对应 Tailwind theme 扩展或 shadcn CSS 变量。

### 色板（Dark / Light）

| Token | Dark | Light | 用途 |
|---|---|---|---|
| `--bg` | `#0d1117` | `#fff` | 最外层背景 |
| `--bg2` | `#161b22` | `#f6f8fa` | 侧边栏背景 |
| `--panel` | `#1c2128` | `#f6f8fa` | 卡片/输入框背景 |
| `--panel-h` | `#22272e` | `#eaeef2` | hover 态 |
| `--border` | `#30363d` | `#d0d7de` | 主边框 |
| `--border2` | `#21262d` | `#e5e9ee` | 次级分隔线 |
| `--ink` | `#e6edf3` | `#1f2328` | 主文字 |
| `--ink2` | `#c9d1d9` | `#424a53` | 次要文字 |
| `--mut` | `#8b949e` | `#656d76` | 弱化文字 |
| `--mut2` | `#6e7681` | `#8b949e` | 更弱（栏目大写） |
| `--accent` | `#58a6ff` | `#0969da` | 主强调色 |
| `--accent-d` | `rgba(88,166,255,.12)` | `rgba(9,105,218,.08)` | 选中背景 |
| `--accent-b` | `rgba(88,166,255,.35)` | `rgba(9,105,218,.3)` | 边框强调 |
| `--ok` | `#3fb950` | `#1a7f37` | 成功/已连接 |
| `--bad` | `#f85149` | `#d1242f` | 错误/拒绝 |
| `--warn` | `#d29922` | `#9a6700` | 未读黄点 |
| `--info` | `#a371f7` | `#8250df` | 紫色标签 |
| `--tool` | `#f0883e` | `#bc4c00` | 工具调用橙色 |

### 其他 Token

```
--font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, "SF Mono", Menlo, Consolas, monospace;
--r: 8px;  --r-sm: 6px;  --r-lg: 12px;
--sidebar-w: 260px;
--dur: 150ms;  --ease: cubic-bezier(.4,0,.2,1);
```

### 换肤

用户要求自定义 accent 色板（设置页→通用→主题色）。落地方式：CSS 变量驱动，设置面板里 5 个预设色板，点击改 `--accent` 及派生色。原型已预留 `pickTheme()` 函数。

---

## 2. 视图路由表

| 视图 ID | 说明 | 入口 |
|---|---|---|
| `session` | 对话主视图（Chat / Trajectory 双 tab） | 侧栏点会话项、发送消息后 |
| `project` | 项目详情：项目名 + 路径 + 新对话框 + 历史会话列表 | 侧栏点项目名、项目 hover 笔图标 |
| `all-projects` | 全部项目页（筛选 + 路径 + 会话数） | 项目栏目标题 hover → 列表图标 |
| `all-sessions` | 全部会话页（按项目分组 + 筛选） | 会话栏目标题 hover → 列表图标 |
| `tasks` | 计划任务（定时/循环任务列表） | 顶部"新任务"按钮 |
| `settings` | 设置页（7 个 tab，见下） | 侧栏左下角齿轮 |

---

## 3. 组件清单

### 布局

- **Sidebar**（260px 固定宽）
  - Brand：`d` logo + "domi"
  - 顶部操作区：主按钮"新对话"（蓝底白字）+ 次按钮"新任务""定时任务"（描边）
  - 项目栏：可折叠标题（项目 ▾），hover 出 ⊕/＋ 按钮；每项 hover 出笔图标
  - 会话栏：可折叠标题（会话 ▾），hover 出列表图标；每项左侧状态点（蓝脉冲=运行/黄=未读/灰=普通）
  - 底部：设置齿轮按钮

- **Main Area**
  - Tab Bar：`Chat` / `Trajectory` 切换；右侧连接状态 pill
  - Status Bar（紧凑 pill）：连接状态 · turns/steps/tok/s · tokens + cache hit · 主题切换
  - Chat 流：user message → thought（可折叠 details）→ tool call（带 done/pill + 耗时）→ 权限确认卡（黄底，拒绝/允许按钮）→ assistant message
  - Composer：多行输入框 + 底部工具栏（文件/技能/模型选择/模式切换/发送）

### 设置页（7 个 tab）

1. **通用**：语言、主题（跟随系统/深/浅）、accent 色板（5 色 swatch）
2. **模型供应商**：provider 列表（Anthropic / OpenAI / DeepSeek），每个含 API key 输入框
3. **通讯工具**：WeChat / Telegram webhook 配置
4. **记忆管理**：保留条数滑块、context 压缩阈值百分比
5. **Soul 与人格**：人格快照展示 + 记忆条目投票（保留/删除）+ 导出导入 soul.md
6. **插件**：插件列表 + 启用/禁用开关
7. **用量统计**：按模型的 token 消耗柱状图

---

## 4. 关键交互约定

- **折叠栏目**：点击标题文字折叠/展开列表，chevron 旋转
- **Hover 按钮**：栏目的操作按钮和项目项的笔图标默认透明，hover 时淡入（150ms）
- **会话状态点**：统一在左侧，颜色 = 状态。不再有右侧指示点
- **权限确认**：黄底卡片，工具名 + 调用参数 + 影响描述 + 拒绝/允许按钮
- **Trajectory tab**：按 Turn 分组，彩色标签（think=紫 / tool=橙 / result=绿 / permission=黄）
- **主题切换**：CSS `data-theme` 属性切换 dark/light，所有颜色走变量

---

## 5. 原型里是假的、落地时要接真数据

| 原型行为 | 实际需要 |
|---|---|
| toast() 提示 | 替换为真实 action |
| 会话列表硬编码 | 接 session store |
| 项目列表硬编码 | 接 workspace/project store |
| 筛选输入框 | 前端 filter 即可，无需后端 |
| 主题切换按钮 | 接 settings store，持久化到 localStorage |
| accent 色板选择 | 写 CSS 变量 + 持久化 |
| 设置页各表单 | 接 settings API |

---

## 6. 现有代码对照

| 原型组件 | 现有文件 |
|---|---|
| Chat 流 + Composer | `App.tsx` + `Transcript.tsx` |
| Trajectory tab | 新建（或从 `Transcript.tsx` 拆分） |
| StatusBar pill | `StatusBar.tsx`（需重构为紧凑 pill） |
| 权限确认卡 | `ConfirmDialog.tsx`（需改为内嵌卡片样式） |
| 侧边栏会话/项目列表 | 新建 Sidebar 组件 |
| 设置页 | 新建 SettingsView（替换 `SoulPanel`/`PluginPanel` 的独立面板形态） |
| 计划任务页 | `TaskPanel.tsx` 迁移为全页面 |

---

## 7. 落地建议

1. **先建 token 层**：把上面 CSS 变量转成 Tailwind theme 配置 + shadcn `globals.css` 的 CSS 变量
2. **再搭布局骨架**：Sidebar + Main Area grid，路由切换用 hash state（原型就是这么做的）
3. **逐视图迁移**：session → project → all-projects/all-sessions → tasks → settings
4. **最后接数据**：把硬编码列表换成真实 store
5. **主题系统**：用 `next-themes` 或自家 store，`data-theme` 属性切换
