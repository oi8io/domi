# CLI 与命令

> `packages/cli` —— 非交互命令（PRD-M1-008/009/010 · SPEC-M1-008 · docs/adr-008 的部分）
> 对应 hermes 的 extending-the-cli。**命令实现住在 packages 里而不是 apps 里**——读事件流、读配置、问影子仓库都是业务（INV-02）；`apps/tui` 只负责把 argv 递进来、把字符串打出去。

## 命令面

用 Node/Bun 内置的 `util.parseArgs`，不引 commander/citty（ADR-008；重新评估线是「子命令超过 8 个」——已踩线，下次加命令前先回去看那份 ADR）：

```
chat · doctor · init · session · data · prompt · report-bug · eval · trace · migrate
memory · soul · task · bridge · plugin · trust · hook · review
```

常用全局旗标：`--help` / `--version` / `--json` / `--yes` / `--ping` / `--follow`（`task run`）/ `--all`（`memory list`）/ `--connect ws://host:port`（连远程 domid，PRD-M3-006）/ `--isolate`（隔离工作区）/ `--chat` / `-p <项目>` / `--project`（`init`）/ `--revoke`（`trust`）/ `--html <路径>`（`trace`）。带值的选项必须在 `flags` 里声明，否则 `strict:false` 会把它当布尔、值掉进 positionals 里（踩过的坑）。

## 各命令要点

| 命令 | 干什么 | 实现 |
|---|---|---|
| `domi`（chat） | 进 TUI；第一次在后台拉起 domid | `apps/tui` 入口 + `launcher.ts` |
| `domi init` | 生成 `~/.domi/config.yaml` 模板；`--project` 在仓库里建 `.domi/` 与 AGENT.md 模板（PRD-M7-002） | `onboarding.ts` |
| `domi doctor` | 体检：每条问题带一条能直接粘贴的修复命令 | `doctor.ts`（`diagnose` / `formatFindings`） |
| `domi session …` | 列表 / 恢复 / 删除 / 分支等 | `data.ts` + 协议 |
| `domi trace <id>` | 轨迹（纯文本；`--html` 输出交互 HTML） | `@domi/trace` |
| `domi eval …` | 录制 / 回放 / L2 | `@domi/eval`（动态 import，见[评估体系](eval.md)） |
| `domi memory …` / `domi soul …` | 记忆与 Soul 的命令面 | `data.ts` / `soul.ts` |
| `domi task run <yaml> --follow` | 跑 DAG 任务 | 协议 `task.start` |
| `domi plugin …` | install / scaffold / list | `plugin.ts` |
| `domi prompt dump` | 输出提示词分层拼装结果与 cache 前缀边界 | `@domi/prompt` |
| `domi migrate` | 数据库迁移 | `@domi/store` |
| `domi data` | 导出 / 清理（`planPurge` 需要确认词） | `data.ts` |
| `domi hook …` / `domi trust …` / `domi review …` | 钩子 / 信任 / 评审 | 各自包 |

## 加命令的规矩

1. 加进 `COMMANDS`（args.ts）；带值的选项必须在 `flags` 里声明类型。
2. 逻辑住 packages，apps 只接线（INV-02）。
3. 有 PRD 依据（INV-10，任务 lint 会查）；改动登记在任务文件里。
4. ADR-008 的重新评估条件满足时先回去看那份 ADR（引不引 commander）。

## 相关

- 命令大多走协议：方法清单见 [Domi Protocol](protocol.md)。
- `packages/cli/src/{index,run,args}.ts` 是接线处；`io.ts` 抽象输出（测试注入）。
