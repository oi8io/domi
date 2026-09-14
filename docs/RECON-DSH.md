# 侦察报告：DeepSeek Harness 与 domi 的重新定位

> 2026-08-24 · 三个独立调研 agent 的汇总
> 触发：发现 DSH 与 domi 架构高度重合
> **⚠️ 2026-09-14：本报告已被 `docs/adr/003-revert-to-self-built-runtime.md` 降级为情报文档。**
> 其"fork vs 插件"裁决与"收缩为发行版"结论**不再有效**（项目目标已确认为个人实践+简历，而非社区影响力）。
> 但 §2 标定的六个**生态真空**仍然成立，改作 domi 自建版本的差异化功能点。

---

## 0. 一句话结论

**fork 没有正当理由；发行版形态可行且有活范本；但 domi 原来的 45 条 PRD 里，大约六成要么被平台白送、要么被现有插件占了、要么是伪需求。**

剩下的四成里，有三块是**验证过的真空**，且恰好都指向同一个主题。domi 应该收缩到那个主题上。

---

## 1. fork vs 插件：裁决

### fork 没有正当理由

DSH 的 Cordis 内核是「everything is a plugin，**no privileged core to patch**」。经确认为**真实**扩展点的服务有：`ctx.llm` / `ctx.tools` / `ctx.fs` / `ctx.shell` / `ctx.sandbox` / `ctx.sessions` / `ctx.sessionQuery` / `ctx.compaction` / `ctx.skills` / `ctx.agents` / `ctx.systemPrompt` / `ctx.tokenMeter` 等。存储层可换 backend（官方已有 JSONL 与 SQLite 两个互换实现），压缩引擎可 subclass，UI 可外挂。

fork 的唯一正当场景是**要换 agent loop 范式**——见下。

### 发行版形态：官方设计的路径，且有活范本

三层结构：**Profile**（入口，`~/.dsh/profiles/<name>/`）→ **Bundle**（一组插件 + 配置叠加层，`package.json` 里声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`）→ **preset**（`agent.cordis.yml`）。分发就是普通 npm 包或 git repo，无中心 registry，用 `dsh plugin --profile domi add domi` 安装。

`dsh-tui` 已经证明这条路走得通：out-of-tree bundle、叠在 `@deepseek-ai/dsh-base` 之上、自己的名字、自己的 profile。

> 顺带纠正：媒体写的 Standard/Minimal/Code/**Creator** 四个 preset，磁盘上实际是 `{standard, code, minimal, cordis}`——"Creator" 是 UI 展示名，对应内部 `cordis` preset，用途是「写 preset 的 preset」，带运行时 inspector。

### 真正的障碍不是架构，是版本

按严重度：

1. **无稳定 API 契约 + 不收外部 PR，两件事叠加才是杀手。** 2026-08-17 到 08-21 五天发了四个 rc；README 全大写写着 THERE WILL BE COMPATIBILITY-BREAKING CHANGES；AGENTS.md 明说 pre-release 阶段 "correctness over compatibility"，**不加 shim**；已经发生过存储层数据结构不兼容变更。而 CONTRIBUTING.md 是 "we cannot accept external pull requests at the moment"——**上游破了你只能等，连提交修复的权利都没有**。`dsh-tui` 的应对是把 peer dep 钉死在测过的那个 rc，代价是用户卡在旧 rc 拿不到上游新功能。这是**持续的人力税，不是一次性成本**。
2. **agent loop 实际换不掉。** 默认 `ReactLoopAgent` 不是接口化服务，只暴露三个 waterfall 钩子（`agent/pre-step` / `agent/request` / `agent/request-error`）——这是「接管决策」不是「换掉循环」。**如果 domi 的卖点是不一样的 agent 范式，这是天花板，只能 fork，而 fork 后要永久背着分支跟上游 rebase。**
3. **session log 没有版本与迁移机制。** 唯一的前向兼容旋钮是事件上的 `ignorable?: true`。而 domi 原本的 INV-01 承诺「任意历史事件永远可解析」——**地基恰好不提供这个**。发行版要给用户这个承诺，就得自建 schema 版本层。
4. **Cordis 是 vendored 进仓库的**（`vendor/cordis/src` + tsconfig 别名），不能独立升级，插件内核版本完全由 DeepSeek 发版节奏决定。
5. 生态质量差：第三方实测 219 个集成里抽测 5 个工具全部失败；token 消耗约为同类 3x。

---

## 2. domi 原 PRD 的重新裁决

### 平台白送的（做了等于白做）

| 原需求 | 现状 |
|---|---|
| INV-01 事件流 append-only | **平台核心不变量**，原话 "model-visible ⟺ logged" |
| INV-12 压缩不销毁原始事件 | **平台保证**。压缩走 `surfaceOp: replace` 遮蔽，事件保留可搜。任何合规插件白拿——**在这上面做文章是伪需求** |
| 会话 fork / replay / 分支 | `ctx.sessions.fork()` + `traceSession()` 血缘树 |
| 多模型 / MCP / 沙箱 | 全部内置；沙箱有 Landlock / Seatbelt / Windows ACL 三套实现，比原计划更硬 |

### 已被现有插件占住的（重做没有边际价值）

| 原需求 | 谁占了 | 成熟度 |
|---|---|---|
| Soul 存 Markdown 可 diff 可手改 | **mneme**（SQLite ⇄ Markdown 双向镜像，手改可合并回库）、**memory-evolve**（纯 Markdown + git 分支同步 + `[id:xxxx]` 锚点三方合并） | 产品级。mneme 的「双写镜像」是这条线的正确解 |
| 状态栏 | **dsh-TUI**（五段式上下文条 + TPS 仪表 + sparkline + **缓存命中率** + in/out token） | 满分，唯一缺金额花费 |
| 记忆检索与分层 | BM25 / FTS5 / 向量 / PageRank 图游走 / 社区摘要；七层 / 五轨 / 三层 / 图谱四种切法都有人做完 | 反复走过且有测试 |
| 后台巩固 | dream / autoDream / 社区摘要 | 方案密度很高 |

### 验证过的真空（这是 domi 剩下的机会）

| # | 空白 | 证据 |
|---|---|---|
| **A** | **终端里的可导航轨迹面板** | **没有任何一个 TUI 做出来**。头部 dsh-TUI 只有线性 transcript + 折叠卡片；tianshu 有 delegation tree 算半个。web 端 `dsh-context` 做了带 ✂ 压缩标记的时间线并证明有价值，**但没人搬进终端** |
| **B** | **确定性压缩层** | 全生态只有官方 `tool-result-pruner` 的头尾字符截断（4096/1024）。**结构化去重（重复读同一文件、重复失败的同一命令）、错误事件清理、固定字段摘要模板——三项全空**，全靠 LLM 自由发挥 |
| **C** | **压缩 × prompt cache 的交叉** | **零覆盖**。压缩必然从替换点起打断前缀缓存，但没有任何插件把「压缩点选在哪能少毁缓存」纳入策略。**压缩派和缓存派是两拨互不通气的人**——有专做缓存优化的插件，但它们不碰压缩 |
| **D** | **记忆的「否决即永久」** | memory-evolve 有待确认队列、memento 把 approval 做在 service 层（绕不过去），但**没有任何一个回答「我拒绝了这条，你下次还会不会学回来」**。meow-memory 的 archived 明显会被 dream 重新抽出 |
| **E** | **「记错了但你不知道」** | 最多做到能溯源（Jesse-njx、graph-memory），**没有一个做主动矛盾检测 / 置信度衰减 / 定期复核**。整个生态也没有一个插件跑过 LoCoMo / LongMemEval，召回质量声明全是自说自话 |
| **F** | **单文件可移植 soul 导出** | 三个主流记忆插件全部没有。只有 memento（57★，`/memory export` + 多格式适配器）与 LittleBlackTong（1★，`pack/unpack`）沾边——**事实上是空的** |
| G | 审批 / 沙箱 UI | 集体空白，连 dsh-TUI 都写着 `/permission` **未适配** |

---

## 3. 建议的新定位

**A、B、C 三块可以合成一件事，主题是「上下文的可观测与可控」。**

这比「又一个记忆插件」锋利得多，而且直接继承了 domi 最初三支点里最扎实的那个（轨迹），以及 `DESIGN.md` 第 4 节那段压缩分析——那段分析里说的「先做零成本的结构化清理（15–30% 且无损）」「自由文本摘要在产物追踪上只有 2.19–2.45/5.0 所以必须固定字段模板」「压缩会打断 prompt cache 前缀」，**恰好就是 B 和 C 两个真空**。当时是纸上分析，现在被生态证实了是真空。

### domi = DSH 的上下文可观测发行版

| 包 | 做什么 | 填哪个空白 |
|---|---|---|
| `domi-trace` | 终端里的可导航轨迹面板：step/tool-call 时间线，能跳转、能定位、带压缩遮蔽标记、显示每步 token 与**金额** | A（+ dsh-TUI 缺的花费） |
| `domi-compact` | 确定性清理层（结构化去重 / 错误事件清理 / 重复文件读折叠）+ 固定字段摘要模板 + **cache 感知的压缩点选择** | B、C |
| `domi-soul` | **只做别人没做的那半**：否决即永久黑名单、矛盾检测与置信度衰减、单文件自描述导出。Markdown 存储直接兼容 mneme / memento 的格式，**不重造** | D、E、F |
| `domi` preset | 把上面三个 + dsh-TUI 组合成一个有身份的发行版 | — |

### 优先级：按「官方最不可能自己做」排序

这是插件作者的头号风险——**上游把你的功能内置了**。

1. **`domi-soul` 最安全**。官方把 security 列为 non-goal，记忆也不是 DSH 的战场。
2. **`domi-trace` 次之，但有风险**：官方已有 `packages/client/ui-trajectory`（web 端），把它搬进终端对官方是很自然的下一步。
3. **`domi-compact` 风险最高**：官方已有 `compaction-basic` 与 `tool-result-pruner`，加确定性去重是自然演进。

所以建议**先做 `domi-soul` 的 D/E/F 三项**，它们同时是记忆生态最大的真空、且官方最不会碰。

---

## 4. 诚实的代价

- **叙事变小了。** 从「我做了一个 agent 运行时」变成「我做了三个插件」。这是真实损失。
- **换来的是**：110 天 → 约 3–4 周；站在 95k star 的流量上；每一块填的都是**验证过的**空白，不是猜的。
- **持续成本**：钉死上游 rc，每次上游发版人工回归全部 seam。这要当成产品的一部分，不是技术债。

---

## 5. 需要回写的部分

按 `PROCESS.md` 的回写门，本报告触发以下改动：

| 文档 | 改什么 |
|---|---|
| `PRD-VISION.md` §1 定位 | 「通用 agent 运行时」→「DSH 的上下文可观测发行版」 |
| `PRD-VISION.md` §3 成功标准 | 重写。「有人分享 soul」仍然成立且更聚焦（F 是真空） |
| `PRD-VISION.md` §5 不变量 | **INV-01 / INV-12 改为「由平台保证，domi 负责不破坏」**；**INV-02（kernel 零 IO）、INV-04（三端不含业务逻辑）作废**——没有自己的 kernel 和三端了；新增一条「钉死上游 rc，升级需过全 seam 回归」 |
| `docs/PRD.md` | M0–M6 全部重写。原 45 条里约 27 条作废或降级 |
| `docs/DESIGN.md` | 三个不可逆决策里，决策一（daemon）与决策二（事件流）由平台提供；决策三（Tool/MCP/Skill/Plugin 四层关系）仍然适用于插件内部设计 |
| `docs/ENGINEERING.md` / `PROCESS.md` | **不受影响**，与技术栈无关 |

**建议**：不要现在就重写。先花两小时真机验证——装 DSH + dsh-TUI + memento/mneme，实际用一次，确认本报告基于文档的判断在真机上成立。**这份报告读的是 README 和源码结构，不是跑起来的东西。**
