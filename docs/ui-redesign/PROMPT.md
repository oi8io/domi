# domi Web 端 UI Redesign — 实现提示词

> 把以下内容直接贴给主程（或开一个新 AI 编程会话）即可开工。

---

## 任务

按已确认的高保真原型，重构 domi Web 端 UI。

**原型**：`docs/ui-redesign/index.html`（浏览器直接打开，所有视觉和交互以此为准）
**交接文档**：`docs/ui-redesign/HANDOFF.md`（设计 token、组件清单、路由表、落地顺序）

## 设计方向

Modern Dev Tool / GitHub Dark 风格。深色为主，支持浅色。CSS 变量驱动，用户可换 accent 色。

## 技术栈

React + Tailwind CSS + shadcn/ui（按 ADR-013）。现有代码在 `apps/web/src/`。

## 要做的事

1. **建 token 层**：把 HANDOFF.md 里的色板转成 Tailwind theme 扩展 + `globals.css` CSS 变量（dark/light 两套）
2. **搭布局骨架**：260px 固定侧边栏 + 主区 grid。侧边栏从上到下：brand → 新对话主按钮 → 新任务/定时任务次按钮 → 项目折叠列表 → 会话折叠列表 → 设置齿轮
3. **逐视图实现**：
   - **会话视图**：Chat/Trajectory 双 tab + 紧凑状态栏 pill + 消息流（user→thought→tool call→权限确认卡→assistant）+ Composer（文件/技能/模型/模式在底部工具栏）
   - **项目详情**：项目名+路径+新对话框+该项目历史会话列表
   - **全部项目/全部会话**：独立全页面，带筛选框
   - **计划任务**：从现有 TaskPanel 迁移为全页面
   - **设置**：7 个 tab（通用/模型供应商/通讯工具/记忆管理/Soul与人格/插件/用量统计）
4. **交互细节**（都在原型里，逐条对照）：
   - 项目 hover 出笔图标，点击进入项目详情
   - 栏目标题 hover 出操作按钮（项目是 ⊕/＋，会话是列表图标）
   - 会话状态点统一在左侧（蓝脉冲=运行/黄=未读/灰=普通）
   - 栏目可折叠，chevron 旋转
5. **主题系统**：支持 dark/light/跟随系统，设置页可选 5 个 accent 色板

## 硬约束

- 所有视觉以原型为准，不要自己发挥
- 现有 `App.tsx`、`Transcript.tsx`、`StatusBar.tsx`、`ConfirmDialog.tsx`、`TaskPanel.tsx`、`SoulPanel.tsx`、`PluginPanel.tsx` 逐步替换，不要平行新建
- 先让 main 可跑，再逐个视图替换
- 不引入新依赖（除了 shadcn 组件按需加）

## 开工顺序

读 HANDOFF.md → 开原型对着看 → 先 token 层 → 布局骨架 → 会话视图 → 其余视图。
