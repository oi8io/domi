# CLI 与命令

> 本页回答四个问题：有哪些命令？命令逻辑住在哪？怎么加新命令？出错了会怎样？
> `packages/cli` —— 非交互命令。**命令实现住在 packages 里而不是 apps 里**——读事件流、读配置、问影子仓库都是业务；`apps/tui` 只负责把 argv 递进来、把字符串打出去。
> 贯穿例子：给登录接口加限流——你跑 `domi doctor` 看环境，跑 `domi task run` 提交改动。

## 先说结论

- 命令共 **18 个**（含 `migrate-m15`）。
- 用 Node/Bun 内置的 `util.parseArgs`，不引 commander/citty。
- 逻辑住 packages，apps 只接线（INV-02）。
- **带值的选项必须在 `flags` 里声明**——否则 `strict:false` 会把它当布尔、值掉进 positionals 里（踩过的坑）。
- 大多数命令走协议：`domi task run` → `task.start`。
- `domi doctor` 的每一条问题带一条能直接粘贴的修复命令。

## 用到的词

| 词 | 意思 |
|---|---|
| 命令面 | `domi` 后第一个词（chat / doctor / init 等）。 |
| flags | 选项的声明（带值 or 布尔）。 |
| 接线处 | apps 里把 argv 递进来、把输出打出去的地方。 |
| positionals | 命令后的裸参数。 |

## 1. 命令面

用 Node/Bun 内置的 `util.parseArgs`，不引 commander/citty（重新评估线是「子命令超过 8 个」——已踩线，下次加命令前先回去看那份 ADR）：

```
chat · doctor · init · session · data · prompt · report-bug · eval · trace
migrate · migrate-m15 · memory · soul · task · plugin · trust · hook · review
```

按用途分组：

| 组 | 命令 |
|---|---|
| 环境与体检 | chat / doctor / init / report-bug |
| 会话与数据 | session / data / trace / prompt / migrate / migrate-m15 |
| 模型能力 | eval / memory / soul / task |
| 插件与信任 | plugin / trust / hook / review |

常用全局旗标：`--help` / `--version` / `--json` / `--yes` / `--ping` / `--follow`（`task run`）/ `--all`（`memory list`）/ `--connect ws://host:port`（连远程 domid）/ `--isolate`（隔离工作区）/ `--chat` / `-p <项目>` / `--project`（`init`）/ `--revoke`（`trust`）/ `--html <路径>`（`trace`）。

## 2. 各命令要点

| 命令 | 干什么 | 实现 |
|---|---|---|
| `domi`（chat） | 进 TUI；第一次在后台拉起 domid | `apps/tui` 入口 + `launcher.ts` |
| `domi init` | 生成 `~/.domi/config.yaml` 模板；`--project` 在仓库里建 `.domi/` 与 AGENT.md 模板 | `onboarding.ts` |
| `domi doctor` | 体检：每条问题带一条能直接粘贴的修复命令 | `doctor.ts`（`diagnose` / `formatFindings`） |
| `domi session …` | 列表 / 恢复 / 删除 / 分支等 | `data.ts` + 协议 |
| `domi trace <id>` | 轨迹（纯文本；`--html` 输出交互 HTML） | `@domi/trace` |
| `domi eval …` | 录制 / 回放 / L2 | `@domi/eval`（动态 import，见[评估体系](eval.md)） |
| `domi memory …` / `domi soul …` | 记忆与 Soul 的命令面 | `data.ts` / `soul.ts` |
| `domi task run <yaml> --follow` | 跑 DAG 任务 | 协议 `task.start` |
| `domi plugin …` | install / scaffold / list | `plugin.ts` |
| `domi prompt dump` | 输出提示词分层拼装结果与 cache 前缀边界 | `@domi/prompt` |
| `domi migrate` | 数据库迁移 | `@domi/store` |
| `domi migrate-m15` | 把泄漏的内部会话迁出成普通会话（备份 + 幂等） | `@domi/store` |
| `domi data` | 导出 / 清理（`planPurge` 需要确认词） | `data.ts` |
| `domi hook …` / `domi trust …` / `domi review …` | 钩子 / 信任 / 评审 | 各自包 |

## 3. 加命令的规矩

1. 加进 `COMMANDS`（`args.ts`）；带值的选项必须在 `flags` 里声明类型。
2. 逻辑住 packages，apps 只接线（INV-02）。
3. 有 PRD 依据（任务 lint 会查）；改动登记在任务文件里。
4. ADR-008 的重新评估条件满足时先回去看那份 ADR（引不引 commander）。

## 4. 出错了怎么办：`domi task run` 起不来

1. **命令名打错**。`UnknownCommandError`，报错列出全部合法命令。查上面的列表。
2. **带值选项没声明**。值掉进 positionals，行为错乱——`flags` 里声明类型（踩过的坑）。
3. **daemon 没起来 / 连不上**。`domi` 第一次在后台拉起 domid；`--connect` 连远程。看 daemon 日志。
4. **缺凭据**。`error.missing_credential`。补 secrets / 环境变量（见[配置与厂商](config.md)）。
5. **数据库坏了**。`domi migrate` 跑迁移；`domi migrate-m15` 修内部会话泄漏（先备份到 `backups/pre-m15-migration-<ts>/`，幂等）。

### 一张表看全部情况

| 情况 | domi 做什么 | 你要做什么 |
|---|---|---|
| 命令名打错 | UnknownCommandError 列出全部 | 查命令列表 |
| 带值选项没声明 | 值掉进 positionals | flags 里声明 |
| daemon 起不来 | 拉起 / --connect | 看 daemon 日志 |
| 缺凭据 | error.missing_credential | 补 secrets / 环境变量 |
| 数据库问题 | migrate / migrate-m15 | 跑迁移命令 |

## 5. 可靠性靠什么

1. **逻辑单点**：命令逻辑住 packages，apps 只接线，可测。
2. **明确的错误**：UnknownCommandError 列全合法命令。
3. **体检可执行**：doctor 每条问题带修复命令。
4. **迁移安全**：migrate-m15 先备份、幂等、保 seq。
5. **协议复用**：大多数命令走同一套协议，行为一致。

## 已知限制

- 子命令已超 8 个——加命令前先重评 ADR-008（引不引 commander）。
- `parseArgs` 的 `strict:false` 有坑：带值选项不声明会把值吞进 positionals。
- `--connect` 连远程 domid 依赖网络与鉴权。

## 代码在哪里

| 主题 | 位置 |
|---|---|
| 命令清单 / 解析 | `packages/cli/src/args.ts` |
| 接线 / 分发 | `packages/cli/src/{index,run}.ts` |
| 输出抽象（测试注入） | `packages/cli/src/io.ts` |
| doctor / init / plugin | `packages/cli/src/{doctor,onboarding,plugin}.ts` |
| migrate-m15 | `packages/store/src/migrate-m15.ts` |

## 相关

- 命令大多走协议：方法清单见 [Domi Protocol](protocol.md)。
- `domi eval` 的录制 / 回放：[评估体系](eval.md)。
- 配置命令的依赖：[配置与厂商](config.md)。
