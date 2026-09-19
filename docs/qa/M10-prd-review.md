# M10 PRD 复核 + 进 M10 前的腐蚀盘点

> 2026-09-19 · 复核对象：`docs/prd/M10.md`（PROVISIONAL → 本复核后 COMMITTED）· 基线：master@d0ccef2 + 工作区未提交改动
> 基线状态（本机实跑）：typecheck ✅ · guard ✅（修复 1 处腐蚀后）· test ✅ · L1 回放 ✅（见 A1）
> 结论：**方向对，五个需求都能在既有架构上低成本落地，无设计返工；有一处与既有 AC 的冲突必须先走回写门（B6），一处构建产物腐蚀已顺手修掉（A1）。**

---

## A. 腐蚀盘点（进 M10 前要处理的）

| # | 问题 | 证据 | 处理 |
|---|---|---|---|
| A1 | **guard:deps 红**：`apps/web/dist` 的 Vite 构建产物被 dependency-cruiser 扫进架构分析，chunk 互相引用触发 `no-circular`。dist 已 gitignore，但 `.dependency-cruiser.cjs` 的 `doNotFollow` 只排除 node_modules | 首次 `pnpm check`：`index-C2EB0Qbx.js → start-nKiDjzVf.js → index-C2EB0Qbx.js` | **已修**：`options.exclude` 加 `(^|/)dist($|/)`；`guard:deps` 复跑 ✔（403 modules） |
| A2 | **工作区 `packages/kernel/src/loop.ts` 有未提交改动**：`maxToolCalls` 20 → 100。HANDOFF 记为「会让 PRD-M0-002 AC-2 的测试红」，且与 M10-003 AC-1 的默认值（100）一致 | `git status`、`loop.ts:30`（工作区=100，HEAD=20） | 与 B6 一并处理：作为 M10 的一部分提交，M0-002 AC-2 走回写门 |
| A3 | lint 有 2 个 `useTemplate` info（unsafe-fix），如 `hook-examples.spec.ts:27` 的 `FAKE_KEY` 拼接 | `pnpm lint`：Found 2 infos（不阻塞，biome info 级） | 不动：`FAKE_KEY` 的注释明确「源码里不出现完整样子」，保持原样最稳 |
| A4 | 本机残留：`_tmp_git_locks/`（一批 `HEAD.lock.*`）、6 个 `.*.bun-build`（各 61MB）、`_tmp_smoke1.ts` | `ls` 根目录 | 用户清理（挂载盘删不了，本机可删） |
| A5 | 仓库仍无 git remote，150+ 提交只在本机 | `git remote -v` 空 | 用户配置远端 |

## B. M10 PRD 的问题（读代码逐条验证）

### B1【确认属实】M10-001 的现状描述准确
- `generateTitle()` 定义在 `runtime/src/session.ts:562`，全仓引用只有定义 + 测试 `title-gen.spec.ts`——**生产代码确实从未调用**。
- `titleOf` 在 `apps/web/src/layout/data.ts:51`：`title.trim() === '' ? id : title`——**空标题确实显示会话 id**。
- 好消息：`generateTitle` 失败路径已自行 `sessions.upsert`（LLM 标题或首条输入前 40 字 fallback 都会写库），所以「接入运行时」只需**触发一次**，写库逻辑不用改。

### B2【触发点取舍】标题生成的调用时机
- 候选：runtime `submit()` 结束处 fire-and-forget（与 `memory.afterTurn` 同模式，`session.ts:1117`）。
- 要防的：连续多轮重复触发（每轮都调 LLM 生成标题 = 浪费）。判据建议：`sessions.title` 为空 **且** 事件流里已有 `assistant` 事件（第一轮已产出）**且** 会话内未标记过「标题生成中」。
- 失败不重试（PRD §7 已写「建议：不重试」），下一轮结束时自然再次尝试。

### B3【确认】M10-003 成本极低，kernel 不用动
- `kernel/src/loop.ts:113` 已经是 `const limits = { ...DEFAULT_LIMITS, ...deps.limits }`——**kernel 只收 `LoopLimits`、不读配置**（AC-3）的现状成立，只需 runtime 在 `runTurn` deps 里传 `limits`。
- config 侧：schema 加 `loop` 节、`write.ts` 白名单加 3 键、`readSettings` values 加 3 项；Web 设置页加「运行时」tab（`apps/web/src/views/settings/` 现有 4 个 tab，自然扩展）；`doctor` 在 `diagnose()` 里加一条。

### B4【TUI 语言】建议选「下次启动生效」
- `apps/tui/src/main.tsx:533-552`：locale 在启动时 `setLocale(resolveLocale(...))` 定死。热切换 = 重建整棵 Ink 树（reconciler 单例，HANDOFF 已知坑），成本高、易碎。
- 建议走 PRD AC-2 的选项一：写 `ui.locale` 后提示「下次启动生效」。Web 侧本来就是即时生效，不冲突。

### B5【确认】M10-005 的截断口径有现成引用
- `packages/client-core/src/store.ts:117` `summarizeArgs` + `ARG_SUMMARY_LIMIT`——AC-4 的「统一截断口径」直接引它即可，不新造。
- Web `Transcript.tsx:113`、TUI `components/Transcript.tsx:15/37` 已有 `reason` case，折叠是展示层改造，事件流零改动（INV-01 天然满足）。

### B6【冲突，必须走回写门】M10-003 默认值 100 vs PRD-M0-002 AC-2「20 次」
- `docs/PRD.md:148` PRD-M0-002 AC-2：**「单轮达到 20 次工具循环时强制停止」**；M0 验收 fixture 名 `20-tool-loop`。
- M10-003 AC-1 写 `maxToolCalls` 默认 **100**，与工作区 `loop.ts` 的未提交改动一致。
- **建议**：默认 100（工作区已改、M10 PRD 已写死、100 才是真实可用的护栏）。回写门：M0-002 AC-2 原文划掉，改为「达到 `loop.maxToolCalls`（默认 100）时强制停止」；`20-tool-loop` fixture 若按注入 limits 验证行为则不受影响（SPEC 阶段核实，若 fixture 依赖默认值则一并更新）。

---

## C. 拍板问题

1. **loop 默认值**：按 100 走（改 M0-002 AC-2，回写门）还是按 20 走（M10 PRD 改回 20）？—— 建议 100。
2. TUI 语言切换：下次启动生效（B4 建议）还是热切换？—— 建议前者。

## D. 拍板结果（2026-09-19）

1. **默认 100，M0-002 AC-2 走回写门** —— 用户「直接开始 M10」即认可 M10 PRD 原文的默认值；回写在 `docs/PRD.md` v1.13。
2. TUI 语言 —— **下次启动生效 + 提示**（SPEC-M10-004 取舍-2）。

据此：`docs/prd/M10.md` 转 `COMMITTED`，`docs/PRD.md` 回写 v1.13（追加 §M10 + M0-002 AC-2 回写 + 成熟度表/总览表），`docs/spec/M10.md`，`docs/tasks/M10.md`。
