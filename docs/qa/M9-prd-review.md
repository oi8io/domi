# M9 PRD 复核 + 进 M9 前的腐蚀盘点

> 2026-09-18 · 复核对象：`docs/prd/M9.md`（PROVISIONAL）· 基线：`master@a377afe`
> 基线状态（在干净副本里 `--frozen-lockfile` 重装后实跑）：typecheck ✅ · guard 27 道 ✅ · test 1134/1134 ✅
> 结论：**方向对，但 PRD 有 4 处设计缺陷会直接导致返工，3 处已被 M8 做掉 / 与既有 AC 冲突没走回写门；
> 另有 1 个潜伏缺陷和 3 处腐蚀正好压在 M9 要改的代码上，先理顺再开工。**

---

## A. 腐蚀盘点（进 M9 前要处理的）

### A1 代码层（全在 M9 要动的地方，不先理顺必错上加错）

| # | 问题 | 证据 | 处理 |
|---|---|---|---|
| A1-1 | **潜伏缺陷：会话里切过的模型，重开会话就丢了**，回到配置默认模型；`model.switch` 事件只有 `from/to` 模型名、没有 provider，想恢复也恢复不出来 | `runtime/src/session.ts:268-269` 构造时只读 `config.model.*`；全仓没有任何地方回放 `model.switch`；`protocol/src/event.ts:146` | 登记 BUG-M9-001，先写复现测试；`model.switch` 追加可选 `provider` 字段（加法，SCHEMA_VERSION 11→12），会话恢复时回放最后一次切换 |
| A1-2 | **「provider 知识只在 factory.ts」这条不变量已经漏了**，守卫看不见：`config/load.ts` 的环境变量名表、`config/write.ts` 的 `EDITABLE_PROVIDERS`、`factory.ts` 的 `MODEL_FAMILY/KNOWN_MODELS/COMPATIBLE_DEFAULT_BASE`、Web 设置页硬编码四家 | `scripts/check-provider-isolation.ts` 只扫 kernel/model/runtime/capability 四个目录 | M9 正好把「厂商」变成数据（模板表）。收成一份 `vendor presets`（model 包导出），config/web 只消费它；守卫扫描范围扩到 config/daemon/apps |
| A1-3 | **凭据两套来源**：默认 provider 读 `model.apiKey/baseUrl`，其它读 `providers.<p>`；`buildProvider` / `hasCredential` 各自分叉 | `session.ts:362-395`、`models.ts` | M9 以 `providers` 为唯一来源，`model` 只剩 `{provider, name}` 指针；旧 `model.apiKey/baseUrl` 加载时并入 `providers[model.provider]` |
| A1-4 | `model.capabilities` 覆盖只对「配置里的默认那家」生效，切走就静默失效 | `session.ts:371-372`、`models.ts:36-40` | 能力覆盖挪到 `providers.<id>.capabilities`（见 B3） |
| A1-5 | 过时注释：「跨 provider 时沿用同一套 key / base_url——配置里只有一套凭据」 | `session.ts:524` | 顺手改 |
| A1-6 | TUI 对话流**全量渲染在 Ink 动态区**（没有 Static、没有窗口化），每个 delta 重绘整段历史，超过一屏后 Ink 整屏清重画 → 闪烁、输入框「不固定」的根因 | `apps/tui/src/App.tsx:45`、`Transcript.tsx:109` | 这就是 M9-005 AC-4 要解决的事，但工作量不是 0.5 天（见 B7） |

### A2 文档 / 流程层

| # | 问题 | 处理 |
|---|---|---|
| A2-1 | `docs/PRD.md` 抬头还写 **v1.2**，实际回写到 v1.11.2；成熟度表里 M2 / M3 仍是 `PROVISIONAL`，而两者早已实现（`docs/prd/M2.md` 抬头还是「草稿，尚未过 PM 门禁」） | 一次性补一条回写：版本号对齐、M2/M3 成熟度改为「已实现（事后补批）」并留痕 |
| A2-2 | M9 没按 M7/M8 的惯例先以 `SKETCH` 追加进 `docs/PRD.md`；且 **M9 改动了既有 AC 却没列出来**（见 B8） | M9 拍板时一起走回写门 |
| A2-3 | M9 PRD 是夹在 `test: M7 验证补齐` 那个提交里进库的；工作区里的 `docs/prd/M9.md` 被富文本编辑器重存过（`&#x20;`、引用块被拆碎、`·`→`・`），**内容逐字未变、只是格式坏了** | 按复核结论重写后单独提交 |
| A2-4 | 本机残留：`.git/index.lock`（**会让你在 Mac 上所有 git 写操作失败**）、根目录两个 61MB 的 `.*.bun-build`、`_tmp_smoke1.ts`、`_tmp_git_locks/` | 都已被 .gitignore，不脏仓库；VM 这边删不了，需要你在 Mac 上清（命令见文末） |
| A2-5 | `HANDOFF.md` 写 137 个提交，实际 140；**仍没有 git remote** | 交接材料跟着 M9 收口一起改；remote 只有你能配 |

---

## B. M9 PRD 的问题

### B1【设计缺陷】`default` 开关与 `model.provider` 是两个真相源，而且缺字段
- AC-4 说「新会话默认使用 default provider **的默认模型**」，但 AC-1 的七个字段里**没有「默认模型」**。
- 现有 `model: {provider, name}` 本来就是「默认 provider + 默认模型」。再加一个 `providers[].default`，§7 自己都在问两者谁优先——这就是两个真相源。
- **建议**：去掉 provider 上的 `default` 布尔；「默认」是**一个模型**（`model.provider = <provider id>`, `model.name = <模型>`）。设置页在每个 provider 的模型列表里给「设为默认」。唯一性天然成立，不需要「设一个取消其它」的逻辑，旧配置零迁移。
- 需补一条 AC：默认模型所在的 provider 被停用 / 删除时怎么办（建议：拒绝停用并提示先换默认；删除同理）。

### B2【设计缺陷】`providers` 结构别改成数组，保持以 id 为键的 map
- AC-1 的 `id` 字段暗示改成数组。现在是 `providers: Record<id, {...}>`，`secrets.yaml` 也按同一个键存 key。改数组 = config 与 secrets 两处结构迁移 + AC-5 的迁移命令 + 兼容读两套。
- **建议**：键就是 id；每项加 `name`（显示名）、`protocol`、`enabled`、`models`、`capabilities`。旧条目缺 `protocol` 时按键名推断（`anthropic` → anthropic，其它 → openai），**不需要迁移命令**，`doctor` 只提示可选的规范化。AC-5 相应简化。
- AC-1 要写明：`apiKey` **只存 `secrets.yaml`**（PRD-M8-011 AC-4 不回退）；自定义 id 的环境变量名规则（建议 `DOMI_<ID>_API_KEY`，内置厂商保留 `ANTHROPIC_API_KEY` 等惯用名；`DOMI_API_KEY` 只作用于默认模型所在的 provider）。

### B3【设计缺陷】「能力矩阵按协议给默认值」会破坏 fail-closed
- `protocol: openai` 同时覆盖 OpenAI、DeepSeek、Gemini、Ollama、vLLM、llama.cpp。
  按协议给 OpenAI 的全 true → 本地小模型 `toolCall: true` 运行时才炸（违背 PRD-M1-001 与 INV-03 同一立场）；
  给全 false → DeepSeek / Gemini 默认用不了工具（**这其实是现状**：deepseek 落进 openai-compatible，toolCall 默认 false）。
- AC-6 说「用户可在 `model.capabilities` 覆盖」——多 provider 下这个全局覆盖不知道该作用在谁身上（A1-4）。
- **建议**：能力挂在 provider 上（`providers.<id>.capabilities`）。新增 provider 时选**厂商模板**（OpenAI / Anthropic / DeepSeek / Gemini / 自定义），模板带默认 baseUrl 与能力；「自定义」全 false。模板表就是 A1-2 收拢的那一份。`model.capabilities` 作为旧写法只读兼容。

### B4【需补 AC】`protocol: openai` 到底用哪个适配器
- `createOpenAI`（新版 AI SDK 默认走 Responses API）只有 OpenAI 官方支持；DeepSeek / Gemini 兼容端点 / Ollama 只认 Chat Completions。AC-6 写成「createOpenAI / createOpenAICompatible」二选一没说判据。
- **建议**：厂商模板 = OpenAI 时用 `createOpenAI`，其余一律 `createOpenAICompatible`。判据是模板，不是猜 baseUrl。
- 去掉 `@ai-sdk/google` 时别漏了 `createEmbedder`（它也用 google 适配器）；旧配置 `provider: google` 自动映射到 openai 协议 + Gemini 兼容端点。

### B5【设计缺陷】扁平模型列表缺三条硬约束
1. **同名模型撞车**：两个 provider 都有 `gpt-4o`（OpenAI 官方 + OpenRouter / 公司网关）很常见。「选模型自动带出 provider」在这里不成立。
   模型身份必须是 `(providerId, modelId)`；Web 下拉用分组消歧；TUI `/model <名>` 唯一命中直接切，**多处命中列出候选让用户选**（选的仍是模型，不是「切 provider」，不违背拍板 #2）。
2. **探测结果要过滤**：OpenAI `/v1/models` 会返回 embedding、tts、whisper、dall-e、moderation；OpenRouter 三百多个。需要：按名字排除非对话模型 + 下拉可搜索。
3. **Anthropic 分页不是 SPEC 细节**：`/v1/models` 默认一页 20 条，「只取第一页」会静默丢模型。AC-1 直接写 `limit=1000`（上限）并跟随 `has_more`。另外 Anthropic 的 baseUrl 要先走现有的 `normalizeAnthropicBaseUrl` 再拼 `/models`。
- AC-2 的降级清单去掉「价目表前缀认出的模型」与内置 known models——它们依赖厂商名 → id 的映射，provider id 变成用户自定义后就失效了。降级 = `providers.<id>.models`（手填） + 当前默认模型。

### B6【设计缺陷】i18n：翻译发生在哪一端没说，预算差 3 倍
- 一个 domid 可以同时连多个不同语言的端（Web 英文 + TUI 中文）。所以**错误必须在端上按 key 渲染**：协议错误的 `data` 带 `messageKey + params`，daemon 不感知语言。这是协议改动（要重新生成 protocol 文档，guard:api / guard:protocol）。PRD 应写进 AC-3。
- 现在的错误是把中文拼进 `Error.message`（例如 `InvalidApiKeyError`），不是 key + 参数。
- 体量：含中文字面量的行数粗估 Web ~290、TUI ~180、CLI ~140、runtime ~150、daemon ~100、client-core ~40——**合计九百行上下**，外加 TUI 金样快照全部要按固定 locale 重录。1 天做不完，实际 3–4 天。
- AC-4「key 缺失在 `domi doctor` 标注」没意义：缺 key 是构建期问题，CI lint 已经拦住；删掉这半句。
- **漏了一件事**：内置提示词层是中文（`builtin.identity`：「你是 domi…」），英文界面下模型会被中文系统提示带着回中文。建议 identity 层加一句「用用户的语言回复」（不算翻译 prompt，仍符合拍板 #5）。
- 语言设置存 `ui.locale: auto | zh | en`（和 `ui.accent` 一样两端共用）；`auto` 各端自己解析（浏览器语言 / `LANG`）。

### B7【与现状不符 / 预算】TUI 输入区
- **AC-2 已经做完了**：PRD-M8-014 AC-5 在 M8 就实现了 Enter 发送、Shift+Enter（kitty）、Ctrl+J、Alt+Enter，`editAction` 纯函数也有测试（`apps/tui/src/components/Prompt.tsx`，`kittyKeyboard: { mode: 'auto' }`）。上边框也已有。M9 这条应改为「不回退」。
- **AC-1 与 PRD-M8-014 AC-5「提示文案与实际按键一致」冲突**：去掉占位文字后，按键提示要挪到底部快捷键行（已有 `KeyHints`）。需走回写门。
- **AC-4 是真活，而且有取舍**：Ink 没有原生滚动。要「对话流独立滚动 + 输入框固定」只能进备用屏（alternate screen）自己做窗口化渲染（按终端宽度算折行，CJK 双宽），代价是**失去终端原生回滚、鼠标选中复制、终端内搜索**。这个取舍要你拍板（见文末问题 3）。工作量 1.5–2 天，不是 0.5。

### B8 改动了既有 AC 却没登记
需要在回写门里显式列出：PRD-M8-014 AC-5（TUI 提示文案）、PRD-M8-010 AC-5（模型下拉来源）、PRD-M8-011 AC-4（凭据来源——provider 自定义后的环境变量规则）、PRD-M8-012 中「模型供应商」tab 的描述、PRD-M1-002 的跨 provider 切换语义（能力保留，入口收掉）。

### B9 预算
| 条目 | PRD 估 | 复核估 |
|---|---|---|
| 腐蚀先行（A1-1…A1-5 + A2-1） | — | 1 |
| 001 探测 | 1 | 1 |
| 002 Provider 配置 | 1 | 1.5（含模板表、凭据收口、设置页增删改） |
| 003 选择入口 | 0.5 | 1（含同名消歧、会话恢复） |
| 004 国际化 | 1 | 3–4 |
| 005 TUI 输入区 | 0.5 | 1.5–2 |
| 验证补齐（最后做） | — | 1 |
| **合计** | **4** | **10–11.5** |

建议拆两段：**M9a = 腐蚀先行 + 001/002/003**（模型配置链路，约 4.5 天）；**M9b = 004/005**（国际化与 TUI，约 5–6 天）。两段互不依赖，M9a 做完就能用。

---

## C. 需要拍板的问题
1. 「默认」是一个模型（去掉 provider 上的 `default` 开关）——同意？
2. 能力挂在 provider 上、由厂商模板给默认值——同意？
3. TUI 滚动：进备用屏自己滚（输入框固定，失去终端原生回滚 / 选中复制），还是保留原生回滚、只做窗口化防闪烁？
4. 是否拆成 M9a / M9b？

## D. 需要你在 Mac 上跑一次
```sh
cd ~/Develop/learn/ai/domi
rm -f .git/index.lock .git/HEAD.lock .*.bun-build _tmp_smoke1.ts && rm -rf _tmp_git_locks
git checkout docs/prd/M9.md   # 工作区里只是格式被编辑器改坏，内容没变；复核结论会重写这份
```

---

## E. 拍板结果（2026-09-18）

1. 默认是一个模型 —— **同意**（PRD-M9-003 AC-1）
2. 能力挂 provider、厂商模板给默认值 —— **同意**（PRD-M9-002 AC-2）
3. TUI 滚动 —— **照 Claude Code 做**：双渲染器，fullscreen 默认、classic 可切、失败回退（PRD-M9-005）
4. 拆分 —— **一次做完**（预算 11.5 天）

据此：`docs/prd/M9.md` 重写为 `COMMITTED`，`docs/PRD.md` 回写 v1.12（追加 §M9，并理顺 A2-1），`docs/spec/M9.md`，`docs/tasks/M9.md`。
复核时读代码又找到一处：**BUG-M9-002** 切到没配 key 的 provider 时会带着默认 provider 的 key 发往别家地址（`session.ts` `buildProvider`），已登记，TASK-M9-000 先修。
