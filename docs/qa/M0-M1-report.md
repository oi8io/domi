# M0–M5 对抗性验收报告

> 日期：2026-09-15 · 执行者：独立 QA 会话（与实现会话隔离）· 基线：`163c880628ee4b495aec915f0be24da6951329c8`（HEAD，M6 文档门）
>
> **范围说明**：`docs/qa/PROMPT.md` 原文只要求 M0+M1。接手时仓库 HEAD 已推进到 M6 文档门（当日 13:41–22:44 连续提交 M3→M6），按项目实际状态将范围扩为 **M0–M5 全量对抗验收 + M6 文档级核对**。所有验证在干净基线副本 `/tmp/domi-qa-163c880`（`git archive 163c880` 导出，`pnpm install --frozen-lockfile`）上离线完成，未触碰工作区。`docs/qa/M1-reconciliation.md` 已自我声明"不是 QA 报告"，本报告独立产出、不采信其结论。

## 结论

**M0/M1：通过。** 可进 M2 的结论在 HEAD 163c880 上依然成立——抽查 M0-001/002/003/005/006 共 12 条 AC，断言与判据逐字比对一致；3 道守卫弄红验证；L1 回放弄红且差异报告定位准确；删除 `packages/eval` 后 kernel/store 128 测试全绿。

**M2/M3：核心机制通过抽查，未全量核对。** 压缩重放等价（M2-003 AC-5）与 L1 回放（M2-008）有真断言；M2/M3 其余 AC 受时间所限未逐条证伪（见"没被测到的路径"）。

**M4/M5：不通过。** M4 的 20 条、M5 的 25 条 AC **全部零测试提及**；两个功能提交各含 **0 个测试文件**（M4 `c9332e6` 3891 行、M5 `a5b7f1e` 3836 行）；AC 覆盖守卫只守 M0/M1，73 条已实现 AC 无任何机器守卫。按项目"测试先行"硬规则衡量，M4/M5 的 DoD 不成立。

**M6：文档级核对。** 只有文档与守卫骨架，无功能代码，不构成验收对象。

一句话：**以"测试先行 + 每 AC 有机器覆盖"为判据，当前 HEAD 不能整体宣称全绿；M0/M1 是干净的，M4/M5 是欠账。**

## 契约偏差

| 项 | 声称 | 事实 | 严重度 |
|---|---|---|---|
| `scripts/check-ac-coverage.ts:115` `ACTIVE = /^PRD-M[01]-/` | 注释："M2 之后的 AC 还没开工" | M2–M5 已实现并提交；73 条 AC（M2 43 条中未覆盖部分 + M4 20 条 + M5 25 条）无机器覆盖守卫。守卫自述输出"远期里程碑还有 73 条待开工"，与事实相反 | **需修** |
| M4 提交 `c9332e6`（3891 行） | 项目硬规则"测试先行：先提交失败的测试，再提交实现"（AGENTS.md） | 8 个任务一次提交，**0 个测试文件**；M4 20 条 AC 全部零测试提及 | **阻断** |
| M5 提交 `a5b7f1e`（3836 行） | 同上 | 7 个任务一次提交，**0 个测试文件**；M5 25 条 AC 全部零测试提及 | **阻断** |
| `NEXT.md` | "695 个测试 + 18 守卫全绿" | 实际 **760 测试 / 0 失败 / 86 文件**（`pnpm check`）。自述少 65 个 | 记录即可 |
| M5 任务编号 | 编号连续 | `docs/PRD.md` 中 PRD-M5 从 005 直接跳到 007，**无 PRD-M5-006** | 记录即可 |
| PRD-M2-008 AC-4 后半段 | "差异报告可跳转到轨迹面板" | 只交付 seq 锚点，跳转拆给 M2-005（实现者已在 PROMPT.md 已知空白中自标） | 记录即可 |

**M0/M1 逐条核对未发现偏差的条目**（抽查，断言与判据一致）：

- M0-001 AC-1/2/4：`event-log.spec.ts` —— seq 连续无空洞无重复（`toEqual(1..n)` + Set 去重断言）；重开库 JSON 深比较相等（`JSON.parse(JSON.stringify())` 后 `toEqual`，与"JSON 深比较"等价）；事务中途抛异常整批回滚、head 不前进
- M0-002 AC-2/3/4：`loop.spec.ts` —— 第 20 次工具循环停止 + `error{recoverable:true}` + 三计数器；连续 invalid_args 第 4 次终止（`argParseRetries===4`、4 条 result）、中间成功一次清零；流截断后 seq 仍连续、同会话可继续
- M0-003 AC-2/3/4/5：`loop.spec.ts` + `permission.spec.ts` + `paths.spec.ts` + `denial-attribution.spec.ts` + `runtime/test/session.spec.ts:161` —— user_denied 语义化回灌；permission **事件**四字段（capabilityId/decision/source/matchedRule）在事件层有断言；fail-closed（默认拒绝、ask 无询问人拒绝、未声明能力不询问）；8 类路径穿越逐条被拒 + 合法路径放行 + 符号链接解析到真实路径
- M0-005 AC-1/2/4：`client-core/test/store.spec.ts` + `focus.spec.ts` + `apps/tui/test/golden.spec.tsx` —— 80 字符摘要截断；焦点语义；40/60/80/200 四宽度 golden 快照 diff=0（快照文件 4 个已提交）
- M2-003 AC-5：`memory/test/compactor.spec.ts:233` —— 压缩后从原始事件流重放与压缩前**深比较相等**（核心断言，有真实现）
- M0-006 AC-1：`kernel-purity` 守卫实测拦截 `Date.now()`（见"真实运行"）

## 不变量

| INV | 谁守 | 被证伪过吗 | 我试出的绕过方式 |
|---|---|---|---|
| INV-01 事件流 append-only | `scripts/check-append-only.ts`（AST 扫描字符串字面量） | 守卫自带红 fixture 证明"作者想到的违规"会红；**但可绕过** | **字符串拼接绕过（实测）**：在 `packages/store/src` 放 `'UPDATE ' + 'events SET payload = ?'` 与 `['DELETE',' FROM events …'].join('')`，守卫报 "OK —— 120 个文件，无违规" exit 0。扫描只查单个字面量，拼接片段各自不命中正则 |
| INV-02 kernel 纯函数 | `scripts/check-kernel-purity.ts` | 是（`kernel/test/purity-guard.spec.ts`） | 实测 `Date.now()` 探针被正确拦截（**有效**，无绕过） |
| INV-03 权限 fail-closed | `PermissionEngine` + `permission.spec.ts` | 是（AC-4 三条） | 未试出绕过：默认 deny、ask 无询问人仍 deny、未声明能力直接拒不询问 |
| INV-08 不花钱不联网 | `ci-no-live-calls-guard` + L1 `assertNoNetwork` | 有 | 未逐一证伪（L1 回放本身离线跑通，未见出网路径） |
| INV-12 压缩逐条哈希不变 | `compactor.spec.ts:187` | 是（`hashAfter === hashBefore`） | 通过 |
| INV-13 eval 与 kernel/store 隔离 | `eval-isolation-guard.spec.ts` + M2-008 AC-5 | 是 | **实测通过**：删掉 `packages/eval` 整个目录后 `bun test packages/kernel packages/store` = 128 pass / 0 fail |
| INV-04/05/06/07/09/10/11 | 各类守卫/测试 | 部分有 | 未逐条证伪（时间所限，见"没被测到的路径"第 7 条） |

## 没被测到的路径

按"一旦出错代价多大"排序：

1. **M4/M5 全部功能零测试**（代价最高）：`soul.ts`、`semantic.ts`、`skills/`、`orchestrator/`、`notify/`、`bridge-telegram/`、`desktop/` 的 src 均存在但**无一个 spec 文件**。这些是记忆、技能编排、通知、远程桥接、桌面壳——M6 及以后全部建在它们上面。一旦其中任一处出错，无任何测试能拦。
2. **AC 覆盖守卫的判据过松**：`check-ac-coverage.ts:86` 判定"某测试文件同时出现需求 ID 与该 AC 编号"即为覆盖，不要求"该测试真的测了该 AC"。注释自己也承认"查不了 AC 有没有被读错"——这一半完全靠人肉，而 M2–M5 无人肉核对过。
3. **catch 块异常路径**（16 处）：`store/src/search.ts:126`、`store/src/semantic.ts:101`（语义搜索降级）、`capability/src/skills/registry.ts`（技能加载失败）、`store/src/migrate.ts`（迁移失败）、`capability/src/tools/shell-exec.ts`（子进程异常）——语义与技能相关 catch 全部落在零测试的 M4/M5 代码里。
4. **默认值断言缺失**（34 处 `??`）：`kernel/src/metrics.ts:73`（`pricing ?? {}`）、`store/src/sessions.ts:84-85`（title/model 空串兜底）等，未见断言"未提供时默认值是什么"。
5. **边界数字两侧**：M0-002 的 20/3/4 两侧有测试（20 停/21 呢？未测；连续 4 次终止/第 5 次？未测）；80 字符摘要两侧有（80/81 边界未精确断言）；7 天/50MB/1MB/100KB 类数字未系统核对。
6. **`as` 断言**（7 处）：`kernel/src/loop.ts:162` `(ev.raw ?? {}) as Record<string, unknown>` 等，类型断言处可能掩盖真实不匹配，无对应测试。
7. **其余 15 道守卫未逐一弄红**：本轮只对 append-only（绕过）、kernel-purity（有效）、ac-coverage（有效但范围过时）三道做了"合法但违规"实验。deps/tasks/api/protocol/mcp/automation/adr/secrets/providers/writes/eval/live/migrations/bridge/desktop 守卫留待下轮。

## 真实运行发现的问题

基线：`/tmp/domi-qa-163c880`（HEAD 163c880 干净导出）。

1. **`pnpm check` 全绿但数字与自述不符**：760 测试 / 0 失败 / 86 测试文件 + 18 道守卫 + L1 回放 1/1。`NEXT.md` 自述"695 个测试"，差 65。
2. **`pnpm smoke` 全绿**：10/10（env -i 干净环境、四步引导清单、doctor 每条问题给可粘贴命令、未知命令退出码 2、二进制内 L1 回放通过）。
3. **守卫弄红实验**（复现步骤见各条目）：
   - **append-only 可绕过（需修）**：复现：在任一 `packages/*/src` 建文件写入 `export const x = 'UPDATE ' + 'events SET payload = ?'`，跑 `bun run scripts/check-append-only.ts` → "OK，无违规" exit 0。探针已删。
   - **kernel-purity 有效**：`Date.now()` 探针 → 守卫报 `[INV-02] … 调用了 Date.now`（拦截）。探针已删。
   - **ac-coverage 有效但范围过时（需修）**：将 `event-log.spec.ts` 中 `PRD-M0-001 AC-2` 改为 `AC-99` → 守卫红 `[AC 未覆盖] PRD-M0-001 AC-2`；改回 → OK，"M0/M1 的 79 条 AC 全部有测试提到；远期里程碑还有 73 条待开工"。
4. **L1 回放弄红 + 差异报告定位准确（通过）**：只改 `fixtures/sessions/demo-edit-and-test.json` 的 `expectedCalls` 中 fs.write content（`a + b`→`a * b`），跑 `domi eval run` → 红：`第 2 次工具调用开始分叉（事件 seq 9）`，期望/实际参数齐全，锚点 seq 9 正确。注：最初用全局 sed 同时改了 turns/expectedCalls/toolResult 三处导致不红——expected 与 actual 同源是设计使然，不是缺陷；已恢复 fixture。
5. **INV-13 实测通过**：`rm -rf packages/eval` 后 `bun test packages/kernel packages/store` = 128 pass / 0 fail（18 文件）。
6. **lint 与配置告警**：`apps/tui/src/connect.ts:48` 存在 useTemplate 可修复告警（lint 有 1 条，未达失败阈值）；`biome.json:33` `recommended` 字段弃用（应改 `preset`）。
7. **需 key / 真环境部分全部未跑（缺口）**：环境已有 `DOMI_API_KEY` 与 `DOMI_BASE_URL=https://api.deepseek.com/anthropic`（Anthropic 兼容网关），理论上可跑 `doctor --ping`、坏配置诊断、快照回滚 git 检查、`pnpm bench:cache --yes`，但**会发真实请求产生费用，需用户确认后再跑**。容器冒烟（无 node 容器跑二进制）因 docker daemon 未启动（orbstack 未开）后置。

## 我认为实现者最可能在哪里骗了自己

1. **check-ac-coverage 的 `ACTIVE = /^PRD-M[01]-/` + "M2 之后的 AC 还没开工"注释**。这是最隐蔽的一处：一条过时注释让守卫对 M2–M5 全部失明，而功能早已提交。守卫每次输出"远期里程碑还有 73 条待开工"，读起来像"还有远期工作要做"，实际是"73 条已实现 AC 没有任何机器守卫"。M4/M5 两次零测试提交正是钻的这个空子——如果守卫覆盖 M2–M5，这两个提交当场变红。
2. **"695 个测试全绿"的自述**。实际 760。少 65 个测试的数字不是笔误的规模——它让"全绿"看起来更容易达成，也让 M4/M5 的欠账显得不那么刺眼。
3. **M4/M5 "功能先行、测试为零"的一次性提交**。3891 行 + 3836 行、各 8/7 个任务一次提交、0 个测试文件，直接违反自己写的 AGENTS.md 硬规则。这不是疏忽：有守卫盲区在，它不会红。
4. **M2/M3 的测试质量是真实的**（这是好消息，也是坏消息）：M0/M1/M2 的测试写得很扎实（深比较、20 次计数器、事件四字段、golden 快照都在），说明实现者有能力写好测试——**M4/M5 没写，是选择，不是能力问题**。

## 已验证 / 未验证清单

**已验证（离线，全部有复现）**：pnpm check 全绿、pnpm smoke 10/10、M0/M1 契约抽查 12 条、append-only 绕过、purity 拦截、ac-coverage 弄红与范围盲区、L1 回放弄红与定位、INV-13 删 eval 全绿、M4/M5 零测试提交、73 条 AC 无守卫、NEXT.md 数字不符。

**未验证（留待后续，均需真环境）**：doctor --ping 四类失败区分、坏配置报错定位、快照回滚不动用户 git、`bench:cache --yes`（预期 0%，需核对其解释是否自圆其说）、无 node 容器冒烟（需 docker daemon）、M2/M3 其余 AC 逐条核对、其余 15 道守卫逐一弄红。
