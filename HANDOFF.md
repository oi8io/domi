# domi 交接

> 2026-09-18 · 接手的人从这份开始读，读完再去 `CONTRIBUTING.md`。
> 这份只讲**现在在哪、下一步做什么、哪些地方会踩坑**；规矩与背景在别的文档里，本文只给指路。

---

## 1. 一句话现状

M0–M8 九个里程碑的**功能全部落地**：内核 / 守卫 / 三端（CLI、TUI、Web）/ 插件 / 编码能力 / 工作台都通了；
`pnpm typecheck`、`pnpm guard`（27 个门禁）、`pnpm test`（111 个文件 1024 条）当前全绿。
剩下的是**验证补齐**（M4 / M5 / M6 / M7 各有一条「最后做」的任务没做）与**用户侧走查**（各里程碑 DoD）。

代码在本地 `master`，**没有配置任何 git remote**——接手第一件事是推到你们的远端，
否则这 137 个提交只活在一台机器上。

---

## 2. 跑起来

```sh
pnpm install          # 注意：packages/config 新加了 yaml 依赖，老的 node_modules 跑不起来
pnpm check            # = typecheck + guard + test + eval(L1)；必须全绿才算环境对了
```

- 运行时是 **Bun**，包管理是 **pnpm workspace**；lint / format 是 **Biome**（不是 ESLint + Prettier）。
- 起后台：`pnpm domid`（`packages/daemon/src/main.ts`）。没有模型 key 也能起（OPT-M8-001），第一把 key 在 Web「设置 › 模型供应商」里填。
- Web：`apps/web`，Vite + React + Tailwind v4；TUI：`apps/tui`，Ink 7。
- 配置：`~/.domi/config.yaml`（YAML，ADR-014）；**凭据只在 `~/.domi/secrets.yaml`**，任何接口都不回吐给界面。

---

## 3. 仓库怎么读

文档是**四层**，上位约束下位，改下位不能偷偷改上位：

| 层 | 文件 | 作用 |
|---|---|---|
| 愿景与不变量 | `PRD-VISION.md` | 12 条活跃不变量（编号到 INV-13，02 与 04 已合并）。**这些不能改**，改要单独立项 |
| 需求 | `docs/PRD.md` + `docs/prd/M*.md` | 每条带可执行 AC；`docs/prd/` 是各里程碑的再批准门材料 |
| 设计 | `docs/spec/M*.md` | 架构取舍，实现与它不一致要在任务笔记里写清 |
| 任务 | `docs/tasks/M*.md` | 一条任务一个 status，带 `prd:` 反查；**实现进度与笔记都在这里** |

另外：`docs/adr/`（27 份技术选型，编号即决定）、`docs/PROCESS.md`（流程为什么长这样）、
`docs/ENGINEERING.md`（分层与依赖规则）、`docs/parity-checklist.md`（三端功能对齐表）。

**读一条任务的正确姿势**：`docs/tasks/M8.md` 里找到 `### TASK-M8-006`，看 `- status:`、`实现:` 的勾、
最后的 `笔记（日期）`——笔记里记着冒烟怎么做的、与 SPEC 的出入、已知限制。这是上下文密度最高的地方。

---

## 4. 各里程碑现状

| 里程碑 | 功能 | 验证 | 备注 |
|---|---|---|---|
| M0 内核骨架 | done | done | TASK-M0-021 停在 review；TASK-M0-022（DoD 走查）todo |
| M1 能用 | done | done | — |
| M2 可信 | done | 部分 | TASK-M2-003（cache 命中率实测）review |
| M3 三端 | done | 部分 | TASK-M3-008（parity e2e）、TASK-M3-009（推送延迟基准）todo |
| M4 有灵魂 | done | **todo** | TASK-M4-009 |
| M5 会干活 | done | **todo** | TASK-M5-008；BUG-M5-001（macOS 打包图标）review |
| M6 生态 | done | **todo** | TASK-M6-008；BUG-M6-001（`eval l2 --rounds`）review |
| M7 会写代码 | done | **todo** | TASK-M7-011 —— 量最大的一块 |
| M8 工作台 | done | done | 只剩用户侧 DoD 与逐屏截图走查 |

`check-ac-coverage` 目前只对 **M0 / M1 / M8** 强制（151 条 AC 全部有测试点名）。
中间几个里程碑的 AC 有测试但没在测试里写编号——**补完哪个里程碑的验证，就把它加进 `scripts/check-ac-coverage.ts` 的 `ACTIVE` 正则**，这是唯一防回退的机制。

---

## 5. 接手先做什么（按建议顺序）

### 5.1 ~~OPT-M8-001~~ —— 已做（2026-09-18）
domid 无 key 也能起；提交时报 `error.missing_credential`（`INVALID_PARAMS`，`data.reason = MISSING_CREDENTIAL`），
Web 首页与 Composer 引导去「设置 › 模型供应商」。细节在 `docs/tasks/M8.md` 末尾。

### 5.2 TASK-M7-011 —— M7 验证补齐（最大一块）
`docs/tasks/M7.md` 里列了十条 spec：
`capability/coding-tools` · `runtime/project-rules` · `runtime/hooks` · `runtime/verify-gate` ·
`runtime/plan-mode` · `runtime/worktree`（+ Web 渲染快照）· `capability/code-intel`（含第二次更快的基准）·
`eval/mine`（fixture 仓库）· `runtime/budget` · `orchestrator/review`。
做完把 M7 加进 `ACTIVE`。**照 M8 那一轮的做法**（`docs/tasks/M8.md` 的 TASK-M8-014 笔记）——
不必一条 spec 一个文件，合并到就近的文件里更省事，但**要在任务文件里写清落到了哪**。

### 5.3 M4 / M5 / M6 的验证补齐
同上，各自一条「验证补齐（最后做）」任务。

### 5.4 用户侧（只有用户能做，别替他做）
各里程碑 DoD；M8 还差**对照原型逐屏截图走查**（Web 深浅 × 5 色板抽查、TUI 深浅终端）。
原型是 `docs/ui-redesign/index.html`（Web）与 `tui.html`（TUI），**视觉以原型为准**。

---

## 6. 硬规矩（违反会被门禁拦，或者被用户退回）

1. **commit message 里不要出现任何 AI 作者 / 协作信息**（不要 `Co-Authored-By:`、session 链接之类的行）。
2. **凭据不进仓库**。`guard:secrets` 扫 `fixtures` 与 `docs`；`demos/m0-loop.md` 历史上出现过真 key，
   改它之前先 `git diff` 看一眼再决定提不提交（当前工作区里有一处无害的本机模型名改动，没提交）。
3. **事件只增不改**（INV-01）。新事件类型要升 `SCHEMA_VERSION`（现在 11），迁移只能加列 / 加表 / 加索引，
   `guard:migrations` 会查（现有 14 条迁移）。
4. **端上没有业务逻辑**（INV-02）。`apps/*` 只经 `client-core` + Domi Protocol 跟 daemon 说话；
   投影逻辑放 `packages/client-core`，不要放在组件里。
5. **权限 fail-closed**（INV-03）。Web 的 `config.set` 白名单**必须**排除 permissions / hooks / MCP / 插件安装——
   界面永远不能给自己提权。
6. **分层**：`@domi/daemon` 不能直接 import `@domi/kernel`，要走 `@domi/runtime` 再导出；
   provider 名只允许出现在 `packages/model/src/factory.ts`（`guard:providers`）；kernel 必须纯（`guard:purity`）。
7. **改 PRD 的 AC 要走回写门**：在 `docs/PRD.md` 顶部记一条回写，写清触发与理由，原文划掉留痕。
8. **CI 里不调真实模型**（INV-08）。要模型的测试用 `StubProvider` 或假网关。
9. **工作节奏**（用户定的）：先推进功能，测试验证类统一归到里程碑最后一条「验证补齐」任务。
10. **改协议**要重新生成 `docs/protocol.md` / `docs/protocol.schema.json` / `packages/protocol/.api.md`，
    否则 `guard:api` 与 `guard:protocol` 会红。

---

## 7. 已知限制与坑

- **Playwright 一直没引入**（ADR-001 的回退项）。`docs/parity-checklist.md` 的两列 e2e 保持 ⬜，
  TUI 侧靠 golden 快照（四个宽度）+ 假 stdin（`apps/tui/test/render.tsx` 的 `press()` / `KEYS`）。
- **定时任务**：夏令时被跳过的那一刻（例如美东 3 月第二个周日 02:30）当天不触发。`packages/daemon/src/cron.ts`。
- **记忆条目的「保留」**只是浏览器本地的已看过标记（L3 条目没有「已确认」状态）；「否决」= 删除。
- **插件启停**是热的；只有「启动时就停用、且带 MCP server 的插件被重新启用」才会回 `restartRequired`。
- **用量成本**只统计有定价表的模型，其余算进 token 不算进钱（INV-13：数据只来自事件）。
- Web 产物现在 JS gzip 132KB / CSS gzip 6.3KB，ADR-027 的阈值是 gzip 250KB，还有余量。
  大头仍是 zod（OPT-M3-004）。
- 未做优化共 12 条，都登记在各 `docs/tasks/M*.md` 末尾的「缺陷与待优化登记」里，编号 `OPT-Mx-yyy`。

---

## 8. 如果在容器 / 远程环境里干活

这个仓库最近一段是在一台挂载式的远程 VM 里开发的，攒下几条经验（本机开发可以跳过）：

- 挂载目录里默认**不能删文件**，`git` 的 `.git/index.lock` 残留会让所有 git 命令失败——先 `rm -f .git/index.lock`。
- 工具链（biome / guard）在挂载盘上跑容易被权限和符号链接绊住，做法是 `rsync` 一份到本地盘再跑，回写只回写源码。
- 临时脚本**不要**放进仓库树，`biome` 与 `guard` 会把它算成源码直接红。
