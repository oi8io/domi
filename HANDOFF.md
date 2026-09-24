# domi 交接

> 2026-09-24 · 接手的人从这份开始读，读完再去 `CONTRIBUTING.md`。
> 这份只讲**现在在哪、下一步做什么、哪些地方会踩坑**；规矩与背景在别的文档里，本文只给指路。

---

## 1. 一句话现状

M0–M13 的功能全部落地（只剩 M11 的 desktop 自启在等拍板；TUI 中断已由 PRD-M13-002 接手做掉）。
M12 第二轮（2026-09-23）加了问题框 `ask.user`、「计划必须」（`plan.update` + 闸门 + 审批跟确认模式走）与中断续跑，见 `docs/spec/M12.md` 的 SPEC-M12-004 第二轮；
M13（2026-09-24）加了运行中「补充」（排队、下一步送达）与「中断当前轮」（Web 停止 / TUI `Esc`），见 `docs/spec/M13.md`。
`pnpm check`（typecheck + lint + 22 道守卫 + 165 个文件 1511 条测试 + L1 评估）当前全绿——2026-09-23 体检前它曾红了 3 天（M11 起），见 `docs/tasks/M12.md` 的 TASK-M12-005。
2026-09-24 删掉了 TOML 配置支持（ADR-014 过渡期结束，PRD v1.18），配置只认 `~/.domi/config.yaml`。
剩下的是**验证补齐**（M4 / M5 / M6 / M10 / M11 / M12 / M13）与**用户侧走查**（各里程碑 DoD）。

远端：`origin = git@github.com:oi8io/domi.git`（2026-09-23 起）。`.github/workflows/ci.yml` 就是 `pnpm check`，**以 CI 绿为准**，不要只跑某一个包的测试就说「全绿」。

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
| M7 会写代码 | done | done | TASK-M7-011 已补齐（修了 BUG-M7-001…003）；只剩用户侧 DoD |
| M8 工作台 | done | done | 只剩用户侧 DoD 与逐屏截图走查 |
| M9 模型配置与体验 | done | done | TASK-M9-012 已补齐（修了 BUG-M9-003）；TUI 双渲染器要真终端手测（见 §7） |
| M10 会话体验与运行控制 | done | 部分 | TASK-M10-007（验证补齐）todo；AC 覆盖已强制 |
| M11 会话体验深化 | done（desktop 自启 blocked；TUI 中断由 M13-002 接手） | todo | TASK-M11-007 收口 todo；BUG-M11-001（shell 指纹绕过）、BUG-M11-002 已修 |
| M12 体验修订 | done（000–011） | 部分 | 「全部放行」= 跳过所有确认；任务里动手前必须有计划（用户 2026-09-23 拍板） |
| M13 运行中对话 | done（000–008） | 部分 | 补充 + 中断当前轮；**daemon 要重启**才有 session.note / session.interrupt；用户侧 DoD 待手测 |

`check-ac-coverage` 目前对 **M0 / M1 / M7 / M8 / M9 / M10** 强制（236 条 AC 全部有测试点名）。
中间几个里程碑的 AC 有测试但没在测试里写编号——**补完哪个里程碑的验证，就把它加进 `scripts/check-ac-coverage.ts` 的 `ACTIVE` 正则**，这是唯一防回退的机制。

---

## 5. 接手先做什么（按建议顺序）

### 5.1 ~~OPT-M8-001~~ —— 已做（2026-09-18）
domid 无 key 也能起；提交时报 `error.missing_credential`（`INVALID_PARAMS`，`data.reason = MISSING_CREDENTIAL`），
Web 首页与 Composer 引导去「设置 › 模型供应商」。细节在 `docs/tasks/M8.md` 末尾。

### 5.2 ~~TASK-M7-011~~ —— 已做（2026-09-18）
十条 spec 都补了，M7 已进 `ACTIVE`；每条落在哪个文件写在 `docs/tasks/M7.md` 的任务笔记里。
补的时候找到三处与 AC 不符（dump 看不到规矩层、commit-msg 钩子漏掉单独一段 `-m` 的署名、超长失败输出把失败测试名截掉），
按缺陷修了，登记为 BUG-M7-001…003。

### 5.3 M4 / M5 / M6 的验证补齐（下一步；M9 已在 2026-09-19 补齐）
各自一条「验证补齐（最后做）」任务。照 M7 / M8 那两轮的做法：先用 `bun scripts/check-ac-coverage.ts --report` 看缺口，
逐条读 AC 写能证伪它的测试（不是给旧测试贴编号），发现与 AC 不符的按 BUG 先写复现再修，最后把里程碑加进 `ACTIVE`。

### 5.4 用户侧（只有用户能做，别替他做）
各里程碑 DoD；M8 还差**对照原型逐屏截图走查**（Web 深浅 × 5 色板抽查、TUI 深浅终端）。
原型是 `docs/ui-redesign/index.html`（Web）与 `tui.html`（TUI），**视觉以原型为准**。

---

## 6. 硬规矩（违反会被门禁拦，或者被用户退回）

1. **commit message 里不要出现任何 AI 作者 / 协作信息**（不要 `Co-Authored-By:`、session 链接之类的行）。
2. **凭据不进仓库**。`guard:secrets` 扫 `fixtures` 与 `docs`；`demos/m0-loop.md` 历史上出现过真 key，
   改它之前先 `git diff` 看一眼再决定提不提交（当前工作区里有一处无害的本机模型名改动，没提交）。
3. **事件只增不改**（INV-01）。新事件类型或事件加字段要升 `SCHEMA_VERSION`（现在 14），**删类型也不行**——不再产生的类型留在联合里读旧会话，旧事件流 fixture 放 `fixtures/events/legacy-v*.jsonl`，迁移只能加列 / 加表 / 加索引，
   `guard:migrations` 会查（现有 14 条迁移）。
4. **端上没有业务逻辑**（INV-02）。`apps/*` 只经 `client-core` + Domi Protocol 跟 daemon 说话；
   投影逻辑放 `packages/client-core`，不要放在组件里。
5. **权限 fail-closed**（INV-03）。Web 的 `config.set` 白名单**必须**排除 permissions / hooks / MCP / 插件安装——
   界面永远不能给自己提权。
6. **分层**：`@domi/daemon` 不能直接 import `@domi/kernel`，要走 `@domi/runtime` 再导出；
   SDK 包名只允许出现在 `packages/model/src/factory.ts`，厂商 / 协议知识只在 `packages/config/src/vendors.ts`（`guard:providers` 扫全仓）；
   kernel 必须纯（`guard:purity`）。
11. **界面文案走 `@domi/i18n`**（PRD-M9-004）：中英两份 `packages/i18n/src/{zh,en}.ts` 的 key 必须一致，
    `apps/*` 里不许出现写死的中文（`guard:i18n`）。UI 里用 `tr()`（TUI 里 `t` 是主题对象）；
    daemon 的错误带 `data.messageKey / params`，端上翻译。**模块顶层不要调 `tr()`**——那时语言还没定，写成函数或 getter。
7. **改 PRD 的 AC 要走回写门**：在 `docs/PRD.md` 顶部记一条回写，写清触发与理由，原文划掉留痕。
8. **CI 里不调真实模型**（INV-08）。要模型的测试用 `StubProvider` 或假网关。
9. **工作节奏**（用户定的）：先推进功能，测试验证类统一归到里程碑最后一条「验证补齐」任务。
10. **改协议**要重新生成 `docs/protocol.md` / `docs/protocol.schema.json` / `packages/protocol/.api.md`，
    否则 `guard:api` 与 `guard:protocol` 会红。

---

## 7. 已知限制与坑

- **TUI 的 fullscreen 渲染器在无 TTY 环境里只验得了一半**：切片、滚动状态机、滚轮解析、整屏布局都有测试（`apps/tui/test/viewport.spec.tsx`），
  但备用屏进出、真滚轮、Ctrl+O 往返只能在真终端里看。坏了就 `DOMI_TUI_RENDERER=classic` 或 `tui.renderer: classic`；
  首帧前挂过会写 `~/.domi/state/tui-fallback`，之后自动用 classic，改一下配置文件（或设环境变量）即视为再试。
- **不要在 React 组件里调 Ink 的 `renderToString`**：reconciler 是单例，嵌套调用在渲染里返回空串、在 effect 里把 yoga 弄崩。
  TUI 拿显示行一律走 `useTranscriptLines`（在 setImmediate 里算）。
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
- 挂载盘上 `git checkout -- <file>` 也会因为删不了文件而失败，恢复单个文件用 `git show HEAD:<path> > <path>`。
- 临时脚本**不要**放进仓库树，`biome` 与 `guard` 会把它算成源码直接红。
