# 调研：会话页右侧栏（Inspector）设计

> 2026-10-06 · 状态：已拍板（同日），需求见 `docs/prd/M14.md`；本文保留为调研依据
> 触发：想在会话页加右侧栏，放「任务及进度 / 对话产物 / 文件修改（diff 高亮）」，问还该放什么、怎么设计

---

## 0. 一句话结论

**右侧栏不是「再加几个面板」，而是「事件流的第二种投影」**：Transcript 按时间讲故事，右侧栏按「东西」盘点——计划、改动、产物、上下文。
domi 是 append-only 事件流 + 「客户端只渲染」（INV-02/INV-04），这件事别家要专门造数据，domi 大部分只要在 client-core 里多写几个投影函数。
建议做 **4 个固定 tab：进度 / 改动 / 产物 / 上下文**，外加两条横切能力：**「范围」切换（本轮 / 全部 / 某一步）** 和 **双向联动（点面板跳对话、点对话开面板）**。
差异化点放在别人没做好的两处：**上下文透视**（Cowork 用户在 GitHub 上公开要、目前没有）和 **基于事件流的时间旅行**（回看任意一步时的计划 / 改动 / 上下文）。

---

## 1. 竞品怎么做的

| 产品 | 右侧 / 辅助区放了什么 | 值得抄的点 | 坑 |
|---|---|---|---|
| **Claude Code Desktop（Code tab）** | 可拖拽分栏：chat、diff、browser、terminal、file、plan、tasks、subagent；可弹出成独立窗口 | diff 点任意行写评论、攒一批 Cmd+Enter 一次性交给模型；`/code-review` 结果「在 diff 里逐条走查 · Fix this one」；`+12 -1` 小指示器点开 diff；文件路径右键「作为上下文附上 / 用编辑器打开」 | 面板种类多、布局自由度高，对一个非 IDE 产品偏重 |
| **Claude Cowork** | 任务面板三段：**Progress**（编号步骤：已完成划线、当前高亮、未开始）/ **Project**（工作目录文件 + 本次读过 / 写过 / 新建的标记）/ **Context**（上传件 + 本次启用的连接器） | 「Claude 能看到什么」单独成区；文件按「看过 / 改过 / 新建」打标 | 发第一条消息就自动弹开、不能关（GitHub #81972 被吐槽）；**没有上下文用量**（#79398 用户要 `/context` 式拆分、压缩前预警） |
| **OpenAI Codex app** | Review 面板 + 任务侧栏 + 产物查看器 | diff **范围切换**：未暂存 / 已暂存 / 某次提交 / 对比基线分支 / **上一轮**；整份 / 单文件 / 单 hunk 三级暂存或回退；行内评论作为「review 指引」；任务侧栏列出计划进度、**参考过的文件和 URL**、生成的产物、回来时看的任务摘要；PDF / 表格 / 幻灯片内嵌预览 | — |
| **Cursor 2.x** | agent 与计划的侧栏；跨文件看全部改动；内嵌浏览器可选中元素把 DOM 发给 agent | 多 agent 并行时侧栏按 agent 分组 | — |
| **Zed** | 「Review Changes」多文件合一的 multibuffer；逐 hunk 保留 / 拒绝；**Follow agent**（准星图标，编辑器跟着 agent 跳到它在读写的文件）；每条消息顶上有 Restore Checkpoint | 「跟随」开关；改动摘要做成可展开的条 | — |
| **Cline** | 每次工具调用后一个 Checkpoint 标记，带 Compare / Restore | Restore 三选一：**只回文件 / 只回对话 / 都回** | 标记插在对话里，长任务很吵 |
| **Devin** | Progress（命令、编辑、浏览统一时间线）、Shell、IDE、Browser、Side chat | **点时间线某一步 = 跳到那个时刻**（回放）；随时接管 IDE / 终端 / 浏览器后再继续 | — |
| **Manus** | 「Manus 的电脑」实时画面（终端 / 浏览器 / 编辑器跟当前工具切换）+ 底部步骤进度 + 「本任务所有文件」 | 回放滑杆 + 「回到实时」；产物集中在一个入口 | — |

行业模式总结（HatchWorks 的 12 种 agent UX 模式里，跟侧栏直接相关的）：Taskboard、Activity Timeline、Action Receipts（每次动作的回执 + 可回滚）、**Evidence Panel**（用了哪些来源，可质疑）、**Memory Controls**（记住了什么、为什么、可删）、**Budget + Time Boxes**。

---

## 2. domi 现状（这次能复用什么）

| 已有 | 位置 | 跟右侧栏的关系 |
|---|---|---|
| `plan.update` 事件（整份替换，pending / in_progress / done / skipped + dependsOn） | protocol/event.ts | 进度 tab 的直接数据源；现在只在 Transcript 里内联 |
| `task.spawn` / `task.node` / `task.run`（子 agent、DAG） | event.ts | 进度 tab 里的「子任务」 |
| `verify.required`、`review.findings`（file + line + severity） | event.ts | 进度 tab 的「验收」、改动 tab 的行内批注 |
| `fs.snapshot`（每次工具改文件前后的 path + sha256 + bytes） | event.ts | **「本轮改了什么」「新建了什么」全靠它**；before 为 null = 新建 = 产物候选 |
| `worktree.diff / apply / discard / restore` + `ChangesBar` | daemon + web/session/ChangesBar.tsx | 改动 tab 的「对比基线」范围；ChangesBar 并入右侧栏 |
| checkpoint 包（shadow + revert：追加 revert 事件、不删事件） | packages/checkpoint | 「回到这一步」 |
| `ctx.compact` / `ctx.cleanup` / `ctx.ref` / `model.usage` / `budget.*` / `session.metrics` | event.ts / RPC | 上下文 tab |
| `memory.write`（L3 add/delete、L4 Soul 改动） | event.ts | 上下文 tab 的「这次记住了什么」 |
| `attachment.put`、`skill.list`、MCP、AGENT.md | RPC / runtime | 上下文 tab 的「能看到什么」 |
| `plugin.ui`（插件面板 HTML，沙箱 iframe） | protocol | 右侧栏可以给插件留 tab 槽 |
| Trajectory tab（三行时间线 + 轮次过滤） | web/session/Trajectory.tsx | 继续做「全量轨迹」；右侧栏不重复它 |
| 轻量语法高亮（M12-010） | web + tui | diff 高亮直接复用 |

缺口（需要动协议 / daemon）：
1. **非 worktree 会话拿不到 diff 内容**：`fs.snapshot` 只有哈希。需要一个按 seq 范围取 diff 的 RPC（建议 `checkpoint.diff {sessionId, fromSeq?, toSeq?, path?}`，从 shadow 取内容）。会话（不挂项目、沙盒目录）也会写文件，同样适用。
2. **上下文没有拆分**：`session.metrics` 只有总量。需要每次 `model.request` 时记一份分段（system / soul / AGENT.md / skills / tools 定义 / 历史 / 附件 / 记忆召回）。
3. **「产物」没有显式声明**：只能从 fs.snapshot 推断。建议推断为主、再加一个可选的 `artifact.mark`（agent 或用户把某个文件标为交付物）——对应 Codex 的产物列表、Claude 的 present_to_user。
4. **引用只能引对话片段**：`PendingRef` 现在是 `{sessionId, fromSeq, toSeq}`。diff 行评论要扩成 `{path, lineStart, lineEnd, side, text}`。

以上都是加字段 / 加事件，按规矩升 SCHEMA_VERSION + legacy fixture。

---

## 3. 推荐方案

### 3.1 布局

```
┌────────┬──────────────────────────────┬─────────────────────────────┐
│ 左侧栏  │ Chat | Trajectory   标题  ⋯  │ 进度² 改动⁷ 产物³ 上下文  [⇤]│
│        │ 状态栏（一行）                 │ 范围：[本轮 ▾]   ◉ 跟随       │
│        │                              ├─────────────────────────────┤
│        │   Transcript                 │  列表 → 点进去看详情（带返回） │
│        │                              │                             │
│        │                              │                             │
│        │ Composer                     │  底部：该 tab 的批量动作       │
└────────┴──────────────────────────────┴─────────────────────────────┘
```

- 第三列 `grid-cols-[var(--sidebar-w)_1fr_var(--inspector-w)]`，宽度 320–720 可拖，默认 400；折叠后留一条 28px 竖条显示徽标数。
- **diff / 预览需要宽度**：详情页右上角「⤢ 展开」→ 右侧栏临时占满主区（Transcript 收成窄条，Composer 仍在），Esc 收回。Desktop（Tauri）再加「弹出成独立窗口」。
- 窗口 < 1200px：右侧栏改成覆盖式抽屉；移动端（以后的手机同步）改成底部 sheet。
- **不自动弹开**（吸取 Cowork #81972）：默认按会话类型记住开 / 关；有新东西只亮徽标。唯一例外：任务第一次出现计划时，若用户从没关过右侧栏，可以展开一次。
- 每个 tab 统一「列表 → 详情」两级，不做手风琴堆叠（四类内容高度差异太大）。

### 3.2 四个 tab

**① 进度（任务默认 tab）**
- 计划步骤：完成划线 ✓、进行中高亮带耗时、未开始灰；`dependsOn` 用缩进 / 连线表示，不画 DAG 图。
- 每一步可展开看「这一步干了什么」：工具调用数、改了哪些文件、耗时、token——数据就是该步 in_progress → done 之间的事件区间。
- 子 agent / DAG 节点挂在对应步骤下，点进去打开子会话（只读）。
- 底部固定：验收状态（`verify.required` 第几次、是否 final）、「计划还剩 N 步 · 继续」（与 ResumeBar 同一个动作）、补充队列数。
- 会话（chat）没有计划时，这个 tab 显示「本轮动作摘要」而不是空白。

**② 改动（你说的 diff 高亮）**
- **范围切换**（抄 Codex）：`本轮`（默认，按 fs.snapshot）/ `整个会话` / `对比基线`（worktree 任务才有，等于现在的 ChangesBar）/ `某一步`（从进度 tab 点过来）。
- 文件列表：状态标记（新增 / 修改 / 删除 / 重命名）+ `+12 −3`，按目录折叠。
- diff：统一视图默认，展开模式下可切左右对照；**行内词级高亮**；复用 M12-010 的语法高亮；大文件 / 生成文件默认折叠；图片做前后对照；二进制只给大小变化。
- 动作分三级：整份 / 单文件 / 单 hunk 丢弃（丢弃走回收站、可撤销，沿用现有逻辑）；worktree 任务保留「带回」（squash / merge / 只留分支）。
- **行评论 → 引用进输入框**：点行号写评论，攒多条后一次「交给 domi」，变成 Composer 里的一组 PendingRef（不自动发送，跟 M13「不自动跑」一致）。
- `review.findings` 直接锚在对应行上，带「修这一条」。
- 「回到这一步」：在某一步的改动上提供 Cline 式三选一——只回文件 / 只回对话（branch）/ 都回。

**③ 产物**
- 来源：新建文件（fs.snapshot before 为空）、显式 `artifact.mark` 的文件、导出物、上传附件（单列一组「你给的」）。
- 卡片：图标 + 名称 + 大小 + 哪一步产生的；点开内嵌预览——Markdown 复用 MarkdownView、图片、HTML（沙箱 iframe，同 plugin.ui 的规矩）、PDF、CSV 表格、代码（高亮）。
- 动作：打开所在目录 / 用默认程序打开（Desktop）/ 复制路径 / **引用到输入框** / 标记或取消标记为交付物。
- 「会话 → 转任务」时，产物列表是转过去的天然清单。

**④ 上下文（你没列、但最该加的）**
回答「domi 这会儿看得见什么、花了多少」：
- **用量拆分**：窗口占比一条堆叠条，分段 system / Soul / AGENT.md / skills / 工具定义 / 历史 / 附件 / 记忆召回；缓存命中率；离自动压缩还有多少（状态栏只留一个数，细节都在这里——也承接 10-05「统计必须真实」）。
- **压缩记录**：每次 `ctx.compact` 前后 token、摘要了哪一段，可点开看摘要原文——这是 RECON-DSH 里「压缩可见性」那块真空的落地。
- **加载了什么**：规矩文件、生效的 skills、可用的 MCP server / 工具、引用的其他会话片段（ctx.ref）、附件。
- **读过的文件和网页**：从 tool.call 里抽 read / fetch 类的路径和 URL（Codex 任务侧栏、Evidence Panel 模式）。
- **这次记住了什么**：本会话产生的 `memory.write`，每条可「撤销 / 否决」——否决即永久是 RECON-DSH 标的另一块真空。
- 预算：`budget.warn / decided`、本会话花费。

### 3.3 横切能力

1. **双向联动**：面板里任何条目（步骤、文件、产物、压缩点）都带 seq，点击 → Transcript 滚到那里并闪一下；反过来 Transcript 里的文件路径、工具卡片、计划更新点击 → 右侧栏打开对应详情。这是右侧栏「有用」和「只是另一份列表」的分界。
2. **跟随（◉）**：开着时右侧栏跟当前动作走——改文件就停在改动 tab 的该文件，写计划就切到进度（Zed 的 Follow agent）。用户一手动操作就自动关掉跟随。
3. **时间旅行**（P2，domi 独有的底子）：范围选「某一步」或拖头部的小滑杆，四个 tab 一起显示「截至 seq N」的状态——那时的计划、那时的改动、那时的上下文占用。别家要专门存快照，domi 是事件流，投影函数加一个 `untilSeq` 参数就行。
4. **插件 tab 槽**：插件通过 `plugin.ui` 声明一个 inspector tab（沙箱 iframe），比如 git-workflow 插件放 PR / CI 状态。核心不做 PR 监控，交给插件。

### 3.4 其他候选（记下，不进第一版）

| 候选 | 为什么不急 |
|---|---|
| 实时画面（浏览器 / computer use） | 等 computer use / browser use 能力落地后作为第五个 tab，带「回到实时」 |
| 终端 | domi 不是 IDE；命令输出已经在工具卡片里。真要做就是只读的「命令记录」，放进上下文 tab 的「读过 / 跑过」 |
| 侧问（/btw） | Claude Code、Devin 都有。domi 可以用 session.branch + 只读工具实现，但属于 Composer 的事，不是右侧栏 |
| 需要你处理（待确认 / 待回答 / 待审批汇总） | 现在只会有一个挂起的询问，内联已够；等多 agent 并行时再做成徽标 / 收件箱 |
| 文件编辑器 | 不做。点文件「用编辑器打开」就够 |

---

## 4. 实现落点（按 domi 的分层）

- **client-core**：四个纯函数投影 `planView / changesView / artifactsView / contextView(items, {fromSeq, untilSeq})`，加一个 `$inspector` atom（tab、范围、跟随、宽度、展开态）。Web 和 TUI 共用——这是 parity 的关键。
- **web**：`layout/Inspector.tsx` + `session/inspector/*`；`ChangesBar` 退化成状态栏旁的 `+12 −3` 小指示器（点了打开改动 tab）。
- **tui**：终端 ≥ 140 列时右侧分栏，不够就全屏覆盖层；一个快捷键开关，数字键切 tab。diff 用现有高亮 + `+/-` 着色。
- **daemon / protocol**：§2 的四个缺口。
- **引用库 vs 自己写**：diff 计算用 `diff`（jsdiff）类现成库；渲染、范围投影、时间旅行、上下文拆分自己写（这几块是简历含金量所在）。

---

## 5. 分期建议

| 期 | 内容 | 依赖 |
|---|---|---|
| **P0** | 右侧栏骨架（宽度 / 折叠 / 展开 / 抽屉）+ 进度 tab + 改动 tab（本轮 / 整个会话 / 对比基线、高亮、丢弃、带回）+ 双向联动；ChangesBar 并入 | `checkpoint.diff` RPC |
| **P1** | 产物 tab（推断 + 预览）+ diff 行评论进输入框 + findings 锚行 + 上下文 tab（用量拆分、压缩记录、加载项） | 上下文分段、PendingRef 扩展 |
| **P2** | 跟随、时间旅行、「回到这一步」三选一、记忆撤销、`artifact.mark`、插件 tab 槽、Desktop 弹出窗口 | — |

---

## 6. 待拍板

1. 四个 tab 的划分和命名（进度 / 改动 / 产物 / 上下文）是否认可？
2. 默认开关：会话默认关、任务默认开，还是都记住上次？
3. Trajectory tab 保留在主区，还是收进右侧栏？（建议保留：它要宽度，跟右侧栏定位不同）
4. diff 行评论：攒进输入框等用户发（建议），还是像 Claude Code 一样 Cmd+Enter 直接发？
5. 会话（不挂项目）里的文件改动也进改动 tab？（建议进：沙盒目录同样会写文件）
6. 上下文 tab 放进 P1 还是提到 P0？（它是差异化点，但依赖 daemon 记分段）

---

## 来源

- [Claude Code Desktop 文档](https://code.claude.com/docs/en/desktop)（分栏、diff 评论、code review 走查、PR / CI）
- [Claude Code /diff 面板](https://www.explainx.ai/blog/claude-code-desktop-flexible-panes-diff-pane-2026)
- [Cowork 任务面板：Progress / Project / Context](https://camp-claude.github.io/learn/cowork-task-anatomy/)
- [Cowork 任务面板自动弹开 #81972](https://github.com/anthropics/claude-code/issues/81972)、[Cowork 上下文用量 #79398](https://github.com/anthropics/claude-code/issues/79398)
- [Codex app 代码审阅](https://learn.chatgpt.com/docs/code-review.md?surface=app)、[Codex 任务侧栏与产物查看器](https://codex.danielvaughan.com/2026/04/17/codex-app-workspace-pr-review-task-sidebar-artifact-viewer/)
- [Cursor 2.0 changelog](https://cursor.com/changelog/2-0)
- [Zed Agent Panel](https://zed.dev/docs/ai/agent-panel.md)
- [Cline Checkpoints](https://docs.cline.bot/core-workflows/checkpoints)
- [Devin 会话工具](https://docs.devin.ai/work-with-devin/devin-session-tools.md)
- [HatchWorks：Agent UX Patterns](https://hatchworks.com/blog/ai-agents/agent-ux-patterns/)
