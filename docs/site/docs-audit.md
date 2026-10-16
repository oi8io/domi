# docs/site 文档站全站差距检查报告

> 检查日期：2026-10-15。检查人：Doubao（MainAgent）。
> 依据样板：`docs/site/docs/orchestration.md`（正文）+ `docs/site/docs/img/orch-*.svg`（5 张图）+ `orchestration-explainer.html`（交互演示）+ `build-docs.cjs`（构建）。
> 范围：`docs/site/docs/` 全部 28 篇 md。**以代码为准**核对关键数字；未改任何文件、未提交 git。

## 1. 总览

| 维度 | 结果 |
|---|---|
| 符合样板结构的章节 | 1 / 28（只有 `orchestration.md`） |
| 其余 27 篇的共同差距 | 缺「先说结论 / 用到的词 / 出错了怎么办 / 可靠性靠什么 / 已知限制 / 代码在哪里」全部六段；零配图；零交互演示 |
| 已确认的事实不一致 | 3 处（迁移条数、CLI 命令列表、4 个坏链） |
| 待核实条目 | 2 处（动态数字，建议改为动态表述） |
| 构建与验证 | `build-docs.cjs` 重跑成功（28 页）；`guard:docs` 4 个 run 块全跑通；坏链 4 处已定位 |

**结论**：内容质量普遍不低（信息密度高、多数有出处），但 27 篇都是「内幕笔记」式写法——正文堆 INV/PRD/ADR 编号、默认值埋在段落里、没有「出错怎么办」和「已知限制」。读者无法从任何一篇（除编排外）快速得到「它怎么工作 / 靠什么保证可靠 / 出错了会怎样」。改造不是重写内容，是把已有的正确内容**按样板重构 + 配图 + 补缺口**。

## 2. 逐章差距表

图例：结构 = 是否含样板六段；图 = 配图数；风格 = 正文是否滥用内部编号；事实 = 抽查结果；优先级见 §7。

| 章节 | 字数 | 结构 | 图 | 正文内部编号 | 事实核对 | 优先级 |
|---|---|---|---|---|---|---|
| orchestration | 8.1K | ✅ 样板 | 5 | 少 | ✅ 全部对上 | — |
| agent-loop | 4.8K | ❌ 缺全部 | 0 | 多 | ✅（前轮已核） | P1 |
| context-compression | 3.3K | ❌ 缺全部 | 0 | 多 | ✅（前轮已核） | P1 |
| prompt-assembly | 3.3K | ❌ 缺全部 | 0 | 多 | ✅（前轮已核） | P1 |
| protocol | 5.6K | ❌ 缺全部 | 0 | 中 | ✅（前轮已核） | P2 |
| architecture | 7.0K | ❌ 缺全部 | 0 | 多 | ✅ | P2 |
| session-storage | 2.3K | ❌ 缺全部 | 0 | 多 | ⚠️ MIGRATIONS 条数错 | P2 |
| memory-and-soul | 2.0K | ❌ 缺全部 | 0 | 多 | ✅ | P2 |
| daemon-internals | 2.9K | ❌ 缺全部 | 0 | 多 | ✅ | P2 |
| tools-runtime | 3.0K | ❌ 缺全部 | 0 | 多 | ✅ | P3 |
| model-runtime | 2.2K | ❌ 缺全部 | 0 | 多 | ✅ | P3 |
| mcp-internals | 1.8K | ❌ 缺全部 | 0 | 多 | ✅ | P3 |
| plugins | 2.0K | ❌ 缺全部 | 0 | 多 | ✅ | P3 |
| scheduling | 1.2K | ❌ 缺全部 | 0 | 多 | ✅ | P3 |
| config | 2.5K | ❌ 缺全部 | 0 | 多 | ✅ | P3 |
| cli | 2.1K | ❌ 缺全部 | 0 | 中 | ⚠️ 命令列表缺 migrate-m15 | P3 |
| clients | 2.3K | ❌ 缺全部 | 0 | 中 | ⚠️ 体积数字会漂 | P3 |
| eval | 1.4K | ❌ 缺全部 | 0 | 多 | ⚠️ AC 数是动态值 | P3 |
| trajectory-and-replay | 1.7K | ❌ 缺全部 | 0 | 多 | ✅ | P3 |
| plugin-dev | 2.4K | ❌ 缺全部 | 0 | 少 | ✅ | P4 |
| skill-writing | 1.6K | ❌ 缺全部 | 0 | 少 | ✅ | P4 |
| adding-tools | 2.1K | ❌ 缺全部 | 0 | 中 | ✅ | P4 |
| adding-providers | 2.3K | ❌ 缺全部 | 0 | 中 | ✅ | P4 |
| programmatic-integration | 2.1K | ❌ 缺全部 | 0 | 中 | ✅ | P4 |
| contributing | 1.5K | ❌ 缺全部 | 0 | 多 | ✅ | P4 |
| quickstart | 3.0K | ❌ 缺全部 | 0 | 少 | ✅ | P4 |
| intro | 1.3K | ❌ 缺全部 | 0 | 少 | ✅ | P4 |
| index | 2.3K | 导航页（不适用） | 0 | 少 | ⚠️ 2 个坏链 | P0 |

## 3. 已确认的事实不一致（不改代码，先报告）

| # | 文档 | 文档写的 | 代码实际 | 出处 |
|---|---|---|---|---|
| 1 | `session-storage.md` | 「`MIGRATIONS`（现有 14 条）」 | 实际 **3 条**：`toVersion: 3 / 8 / 11`；另有独立脚本 `migrate-m15.ts`（PRD-M15-008，`domi migrate-m15`，迁移 `_` 前缀会话泄漏事件，自动备份到 `backups/`） | `packages/store/src/schema.ts:96-117` · `migrate-m15.ts` |
| 2 | `cli.md` | 命令列表 15 个，无 `migrate-m15` | 实际 **18 个**：`chat doctor init session data prompt report-bug eval trace migrate migrate-m15 memory soul task plugin trust hook review` | `packages/cli/src/args.ts:13-32` |
| 3a | `index.md` · `protocol.md` | 链接 `../protocol.md` | `docs/site/protocol.md` 不存在；生成文件在 `docs/protocol.md`，应写 `../../protocol.md`（站点从 `docs/site/*.md` 迁移到 `docs/site/docs/*.md` 时少加一级） | 坏链实测 404 |
| 3b | `index.md` · `contributing.md` | 链接 `../../CONTRIBUTING.md` | 从 `docs/site/docs/` 出发解析到 `docs/CONTRIBUTING.md`，不存在；仓库根在 `../../../CONTRIBUTING.md` | 坏链实测 404 |

注：`build-docs.cjs` 的 `rewriteLinks` 只改写同目录 `.md` 链接，深层相对链接原样进 HTML——所以这 4 处坏链在生成的 HTML 里也是坏的。

## 4. 待核实清单（动态值，建议改为动态表述或标注日期）

| # | 文档 | 内容 | 建议 |
|---|---|---|---|
| 1 | `eval.md` | 「236 条 AC」「M0/M1/M7/M8/M9/M10 已强制」 | 条数是 `check-ac-coverage` 的运行输出，会随任务推进变化；里程碑清单本身已核（`ACTIVE = /^PRD-M(?:[01]|[789]|10)-/`，`scripts/check-ac-coverage.ts:115`）。建议改「当前 X 条（跑 `pnpm check` 看实时数）」或直接删数字 |
| 2 | `clients.md` | 「Web 产物 JS gzip 132KB / CSS gzip 6.3KB」 | 构建产物大小会漂；建议标注测量日期或改为区间表述 |

## 5. 结构差距详述（样板 11 段 vs 27 篇旧文）

| 样板段落 | 27 篇现状 | 读者损失 |
|---|---|---|
| 开头引语（回答哪几个问题 + 交互演示链接） | 只有代码块风格的包路径引用 | 读者不知道这篇回答什么 |
| 先说结论（3–6 条） | 无 | 不能 30 秒内判断「该不该读」 |
| 用到的词（术语表） | 无，术语直接使用 | 同一概念各章叫法不一（如「确认模式」在 orchestration 定义，其它章直接写 `permissionsMode`） |
| 总体流程（配图） | 无图，流程埋在段落 | 无法一眼看懂机制 |
| 出错了怎么办（具体例子 + 总表） | **完全没有** | 最大缺口：读者不知道出错时系统做什么、自己要做什么 |
| 可靠性靠什么（3–7 条） | 有类似内容但以「为什么不」的散点形式出现 | 不能快速建立信任模型 |
| 已知限制 | 只有 scheduling / orchestration 有零星提及 | 读者无法判断是否可用 |
| 代码在哪里（主题→文件表） | 没有；包路径散在开头引用里 | 改代码的人要自己翻 |
| 相关 | 有 | — |
| 配图（2–5 张 SVG，统一画法） | 0 | 机制无法直观呈现 |
| 交互演示（有状态+分支时） | 只有 orchestration | 降级链 / 权限判定等分支场景无法亲手演练 |

## 6. 值得产品上拍板的问题

1. **全站统一贯穿例子**：样板用「给登录接口加限流」贯穿全章。全站是否统一用一个例子（比如「给登录接口加限流」扩到所有章节）？统一能串起章节，但有的章节（记忆 / 调度 / 配置）硬套会别扭。建议：内幕类章节统一用限流例子，扩展类章节（插件 / Skill）用自己的短例子。
2. **正文内部编号去留**：样板要求正文少用 INV/PRD/ADR 编号（只放「代码在哪里」表）。27 篇旧文正文大量使用（如「PRD-M2-003 AC-6」「INV-12(b)」）。严格执行会损失可追溯性（改代码的人靠编号找依据），但读者友好度大幅提升。建议：正文保留极少数关键引用（如「为什么」段），编号集中到「代码在哪里」表。
3. **哪些章节值得做交互演示**：样板只做了编排（故障演练）。候选：`context-compression`（降级链：选档位看遮蔽/压缩/硬顶怎么走）、`tools-runtime`（权限判定：选规则看 allow/ask/deny 怎么落事件）、`scheduling`（错过补触发：选 cron 看补跑）。建议至少做 context-compression（状态+分支最典型）。
4. **文档站守卫要不要建**：现在 4 个坏链就是没有守卫的结果。`guard:docs` 只查代码示例（run 块），不查链接/结构。建议加 `guard:docs-site`：坏链检查 + 结构检查（每篇必须有「出错了怎么办」「已知限制」「代码在哪里」）+ 图片存在性。这是防止文档站再次漂移的唯一机制。
5. **迁移计数口径**：`session-storage.md` 的「14 条」与实际的「3 条 + 独立 migrate-m15 脚本」对不上。值得在文档里写明：**表结构迁移（MIGRATIONS，3 条）≠ 事件 schema 版本（SCHEMA_VERSION，当前 17）≠ 数据修复脚本（migrate-m15）**，三者演进各自独立——这个口径写清楚，以后不会再有人把三者混着数。

## 7. 分优先级改造路线

**P0 · 事实修复（约半天，无图）**
- 修 4 处坏链（index / protocol / contributing 的链接补一级 `../`）。
- `session-storage.md`：MIGRATIONS 改为「3 条」并补 migrate-m15 说明与三种版本口径。
- `cli.md`：命令列表补 `migrate-m15`（共 18 个）。

**P1 · 样板化重写第一批（内容已核对、读者最关心，各 2–4 图）**
- `agent-loop.md`（turn 生命周期：定格→降级链→两轨汇合→收场；流程/时序图）。
- `context-compression.md`（预算器三档→遮蔽→压缩→硬顶；**配交互演示**，正合样板「状态+分支」条件）。
- `prompt-assembly.md`（层排序、Soul 动态注入、notes 追加、前缀指纹；分层结构图 + 数据流图）。

**P2 · 第二批（协议与核心内幕）**
- `protocol.md`（方法/事件全景：表格化 + 版本演进时间线图）。
- `architecture.md`（顶层导图已有文字版，补进程模型/数据流图）。
- `session-storage.md`、`memory-and-soul.md`、`daemon-internals.md`。

**P3 · 第三批（其余内幕）**
- `tools-runtime.md`（权限判定分支可配图）、`model-runtime.md`、`mcp-internals.md`、`plugins.md`、`scheduling.md`（错过补触发时序图）、`config.md`、`cli.md`、`clients.md`、`eval.md`、`trajectory-and-replay.md`。

**P4 · 扩展与参与类 + 概览**
- `plugin-dev.md` / `skill-writing.md` / `adding-tools.md` / `adding-providers.md` / `programmatic-integration.md` / `contributing.md` / `quickstart.md` / `intro.md`（这些是外部读者入口，样板化收益最高但也可只补「出错了怎么办 + 已知限制」两段）；`index.md` 只修链。

每批验收：`node docs/site/docs/build-docs.cjs` 重跑 + `bun run scripts/test-docs-snippets.ts` + 坏链检查 + 每张 SVG 浏览器过一遍（不重叠、不溢出）。

## 8. 验证记录

- `node docs/site/docs/build-docs.cjs` → `rendered 28 pages` ✅
- `bun run scripts/test-docs-snippets.ts` → `OK —— 4 个例子全部跑通（28 篇文档）` ✅（run 块在 architecture / plugin-dev / quickstart / skill-writing）
- 坏链/图片检查 → 4 处坏链（见 §3），图片引用全部有效 ✅
- 本报告未修改任何文件、未提交 git（按任务要求）。
