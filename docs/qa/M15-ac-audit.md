# M15 AC 落点对账（TASK-M15-013 收口）

> 2026-10-09 · 依据：docs/prd/M15.md + docs/tasks/M15.md 勾选 + git 提交链。
> 判据：全仓 `pnpm check` exit=0（1856 测 / 205 文件，含前缀稳定性回放新门禁、legacy fixture v1…v17、L1 回放）。
> 提交链：001-006 = 2aab658/302cf7e/9b177f4/7bd123f 等；007=73291a7/42ae657/af33ca9；008=4e28c35；009=60828d1；010=c008580；011=46a1911；012=1be4e78。

## PRD-M15-001 · 上下文的尺子

| AC | 落点 | 状态 |
|---|---|---|
| AC-1 前缀指纹随 model.request | kernel `fingerprint.ts`（FNV-1a 32，只记哈希）；`model.request.fingerprint` | ✅ |
| AC-2 断裂定位 + ctx.prefix.break | kernel fingerprint 对比归因；非压缩/刷新点落事件 | ✅ |
| AC-3 session.metrics 扩展 | metrics 缓存命中率 / 可避免损失 / 压缩遮蔽次数 / 超窗事故；MetricsSnapshot.avoidableLoss（012 透传） | ✅ |
| AC-4 doctor --context 只读扫描 | cli doctor：RECON R0 表口径，不联网不改库 | ✅ |
| AC-5 L1「上下文」fixture 组 | L1 回放新增前缀稳定性 / 压缩保真 / 超窗降级组 | ✅ |

## PRD-M15-002 · 超窗不崩

| AC | 落点 | 状态 |
|---|---|---|
| AC-1 窗口表 + 保守默认 | config 内置窗口表；未知模型 128k/8k 保守默认可填 | ✅ |
| AC-2 预算器统一口径 | kernel `budget.ts`（真实 usage + 增量估算 ÷ 有效窗口） | ✅ |
| AC-3 预检降级链逐级落事件 | runtime degrade.ts：遮蔽→压缩（可轮中）→硬顶停轮落 error | ✅ |
| AC-4 拼装异常转事件不穿出 | runTurn 异常转事件；R1 复现改断言第二次 submit 能跑 | ✅ |
| AC-5 切小窗模型先压再切 | model.switch 旁说明 | ✅ |
| AC-6 压缩熔断 N=2 | error{scope:'compact', recoverable}；手动 /compact 仍可用 | ✅ |

## PRD-M15-003 · 前缀只增不改

| AC | 落点 | 状态 |
|---|---|---|
| AC-1 会话级定格快照 | session.ts `readFrozen`/freeze（工具表/层/规矩/Soul/记忆索引/技能） | ✅ |
| AC-2 动态内容 ctx.note 追加 | ctx.note（plan/env/verify/supplement/model_switch）；计划只变才发 | ✅ |
| AC-3 待生效更新 + 现在刷新 | ctx.refresh；上下文 tab 待生效列表 + 刷新按钮 | ✅ |
| AC-4 Soul/记忆后台写盘不进当前会话 | memory 写盘照常，frozen 不读新 | ✅ |
| AC-5 工具表会话内稳定 | 定义顺序/描述/schema 逐字节一致（键排序） | ✅ |
| AC-6 前缀稳定性回放（CI 门禁） | L1 fixture 覆盖六类变化场景 | ✅ |
| AC-7 缓存损失 ≤64 token 真机复测 | **DoD**：需 DeepSeek key（环境无，归用户真机复测） | ⏳ |

## PRD-M15-004 · 遮蔽与清理

| AC | 落点 | 状态 |
|---|---|---|
| AC-1 热区不动只冷区可遮蔽 | memory mask.ts 热/冷判定（K=10 步 + T=32k token） | ✅ |
| AC-2 遮蔽 = 指针行 | ctx.mask 指针（工具名/参数摘要/原始大小/重读提示），错误保留 | ✅ |
| AC-3 决定落事件按批 | ctx.mask 带 seqs/原因/freedTokens；单批 ≥8k token | ✅ |
| AC-4 确定性规则只作用冷区 | cleanup 随遮蔽批次决定，不回溯热区 | ✅ |
| AC-5 钉住 /pin + 📌 | ctx.pin + /pin 命令 + 上下文 tab 📌（012 补全） | ✅ |
| AC-6 遮蔽内容 tab 可见可定位 | 上下文 tab 遮蔽记录行 + locate 定位（012） | ✅ |

## PRD-M15-005 · 压缩 v2

| AC | 落点 | 状态 |
|---|---|---|
| AC-1 按步切边界 K=8 + T=24k | memory compact v2；单轮长任务可压 | ✅ |
| AC-2 增量输入 | 上一份摘要 + 压缩点后事件；不再重摘 | ✅ |
| AC-3 输入白名单 | projectForCompact 白名单（user/note/delta/tool/plan/verify…） | ✅ |
| AC-4 摘要模板八字段 | SummarySchemaV2 固定字段 | ✅ |
| AC-5 补水 | refill（近 K 文件路径/技能正文/计划；stamps 失效） | ✅ |
| AC-6 边界块插入 guardrail 点名 | U+E002/E003 私有区；「摘要是数据」 | ✅ |
| AC-7 压缩请求复用主前缀 | compactNow 用 buildContext 主前缀 + 摘要指令 | ✅ |
| AC-8 手动带重点 /compact 重点 | focus 参数 | ✅ |
| AC-9 策略档位 balanced/economical | 策略注册；full 不出 schema；老配置映射 | ✅ |

## PRD-M15-006 · 厂商适配层

| AC | 落点 | 状态 |
|---|---|---|
| AC-1 Anthropic 缓存参数 + TTL 按 kind | vendor：cache_control + cacheTtlOverride（task 60/free 5/spawn 继承） | ✅ |
| AC-2 OpenAI prompt_cache_key / 自动缓存 | vendor：网关发 key；deepseek/gemini 自动缓存位 | ✅ |
| AC-3 工具结果纯文本 | markToolResult 文本通道；token 回到原文 +3% 内 | ✅ |
| AC-4 推理块按厂商 | includeReasoning 按厂商协议；model.reason 保留原文 | ✅ |
| AC-5 服务端能力默认关 | compaction/clear_tool_uses 默认关，按开关 | ✅ |
| AC-6 能力探测与降级 + doctor 列出 | 探测/降级不发不报错；doctor 列支持项 | ✅ |

## PRD-M15-007 · 工具输出预算（009）

| AC | 落点 | 状态 |
|---|---|---|
| AC-1 内联按 token 8k 可配 | shell-exec truncateOutput token 口径；context.inlineMaxTokens；fullOutput 落 outputDir | ✅ |
| AC-2 fs.read 默认 ≤2000 行 | FS_READ_DEFAULT_MAX_LINES；hint 用 fromLine/toLine；带范围不截断 | ✅ |
| AC-3 子 agent 结论 ≤2k token | SUBAGENT_CONCLUSION_MAX_TOKENS；截断写 subagent-<ts36>.md 给路径 | ✅ |
| AC-4 约定层工作方法 | conventionsLayer 先搜后读/按范围读/看头尾/大探索交子 agent（010） | ✅ |

## PRD-M15-008 · 记忆可靠（007）

| AC | 落点 | 状态 |
|---|---|---|
| AC-1 内部会话拒绝 | daemon 层 _ 前缀拒绝（列表/submit/挂项目/改类型/改标题） | ✅ |
| AC-2 迁移幂等可重跑 + 备份回滚 | domi migrate-m15；pre-m15-migration 备份；doctor 提示 | ✅ |
| AC-3 结构化输出降级 | submit_items 工具当结构化输出；偏差兼容 | ✅ |
| AC-4 抽取去重先抽再比近邻 | extractItems known=近邻（≤20） | ✅ |
| AC-5 记忆/Soul 会话内冻结 | 003 AC-1/AC-4 覆盖 | ✅ |
| AC-6 记忆成功率 ≥90% 真机复测 | **DoD**：需 DeepSeek key（环境无 MINIMAX/ZAI/OPEN_ROUTER 可试，归用户） | ⏳ |

## PRD-M15-009 · 项目级记忆（011）

| AC | 落点 | 状态 |
|---|---|---|
| AC-1 位置/id/文件头/可否决 | ~/.domi/projects/<id>/memory/；remote slug 优先 + cwd hash；`# project id` 头；.rejected 否决 | ✅ |
| AC-2 类型分流 | extractNow：preference→全局 Soul；fact/entity→项目（四类映射 fact） | ✅ |
| AC-3 索引 4k token + recall + 冻结 | projectIndexText 每条一行；recall 按 key/query；随 readFrozen 冻结 | ✅ |
| AC-4 压缩前冲刷 | memory.flush + compactNow 开头接线 | ✅ |
| AC-5 自由会话只用全局 | chat 会话 frozenProjectKey=''；afterTurn 不传 cwd | ✅ |

## PRD-M15-010 · 身份与环境（010）

| AC | 落点 | 状态 |
|---|---|---|
| AC-1 身份按模式分段 | PromptCtx.mode（chat/task/subagent）identityLayer 三段 | ✅ |
| AC-2 环境两半 | collectEnv 定格前缀；collectEnvDynamic 变化 ctx.note（日期/分支/改动数） | ✅ |
| AC-3 工作方法段 | conventionsLayer | ✅ |
| AC-4 prompt dump 显示边界 | cli prompt dump 传 env 显示层与冻结边界 | ✅ |

## PRD-M15-011 · 上下文 tab 补全（012）

| AC | 落点 | 状态 |
|---|---|---|
| AC-1 已遮蔽/压缩摘要两段 + 定位 | contextView maskedTokens/breaks；遮蔽记录行 locate | ✅ |
| AC-2 缓存命中率 + 可避免损失 + break 归因 | MetricsSnapshot.avoidableLoss；breaks 带 cause/layer/msgIndex | ✅ |
| AC-3 待生效更新 + 现在刷新 | pendingContextChanges + ctx.refresh 按钮 | ✅ |
| AC-4 策略与阈值距离 | thresholdGap（阈值%−占用%）；厂商托管标明 | ✅ |
| AC-5 Web 与 TUI 同一 client-core | contextTab.tsx + TUI Inspector 同投影 | ✅ |

## PRD-M15-012 · 事件量与增量投影

| AC | 落点 | 状态 |
|---|---|---|
| AC-1 推理/正文按段合并落盘 | SEGMENT_MAX_CHARS=2048 段边界合并；bench 43.3×（130 chunk→3 事件）；旧事件照常解析 | ✅ |
| AC-2 轮内增量投影 | **P2 不做**（决策记录 docs/qa/M15-prd-review.md §7；超预算砍第一顺位） | ⏸️ |
| AC-3 定格时读盘不再每步读 | 003 冻结覆盖（readFrozen 一次/会话） | ✅ |

## 遗留（DoD 前）

- 003 AC-7 缓存损失 ≤64 token 真机复测：环境无 DeepSeek key → 归用户授权真机（写回 RECON）。
- 008 AC-6 记忆成功率 ≥90% 真机复测：同上。
- doctor 前后数字对比归档 `docs/qa/M15-dod-<date>.md`：待真机复测后补。
- DoD 用例（good-first-issues 最小编号一条 ≥40 步）：归用户。
- apps/web/src/session/.ChangesBar.removed-m14.tsx 备份文件待用户确认删除。
