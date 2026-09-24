# 014 配置文件改用 YAML（`~/.domi/config.yaml`）

- 日期：2026-09-15
- 状态：已采纳（取代 `DESIGN.md` §5「配置 · TOML」一行）

**Context**：用户拍板：「配置文件改成 yaml 吧。toml 我用不习惯。」
domi 是个人实践项目，配置文件的第一读者和唯一作者就是用户本人——写起来别扭的格式，没有别的理由可以留下来。
原来选 TOML 的理由只有一条：「Bun 内置 `Bun.TOML.parse`，不引库」。Bun 1.4 同样内置了 `Bun.YAML.parse` / `stringify`，这条理由对 YAML 一样成立。

**Decision**：
- 配置文件是 `~/.domi/config.yaml`（也认 `config.yml`）；用 `Bun.YAML`，**不引第三方库**。
- **键名不变**：`model.base_url`、`model.api_key`、`model.capabilities.toolCall`、`context.maxTokens`、`permissions.rules[]`……
  只换语法，不换含义——迁移时一个字段都不用想。
- **旧的 `config.toml` 仍然读，但只作为过渡**：
  - 只有 `config.toml` 时照常读取，`domi doctor` 标出来并给出迁移命令 `domi init --from-toml > ~/.domi/config.yaml`；
  - 两个都在时只读 YAML，doctor 提示 TOML 已被忽略、可以删掉；
  - `DOMI_CONFIG` 指定的文件按扩展名判断格式（`.toml` 走 TOML，其余走 YAML）。
  - 过渡期到 **M4 的再批准门**为止，届时删掉 TOML 分支。（实际拖到 2026-09-24 才删，见文末「过渡期结束」。）
- 迁移命令是 `domi init` 的一个选项，不是新子命令（ADR-008 的子命令数已踩线）。它读旧文件、原样换成 YAML 打印出来；**注释会丢**，打印时在开头说明这一点。
- `domi data export` 导出的配置同样改为 YAML（PRD-M1-010 AC-1 回写）。

**Consequences**：换来用户愿意手写的配置。代价：
- YAML 的缩进与隐式类型（`on` / `no` / `1e3`）比 TOML 容易写错。缓解：解析后仍经 zod 严格校验，类型不对直接报 `error.config_invalid` 并指出字段路径，不会悄悄当成别的值。
- 过渡期内有两条读取路径，要各自有测试。

**回写**：PRD v1.4（M0-008 AC-1、M1-005 AC-3、M1-010 AC-1、M5-002 AC-1 中的 TOML 改为 YAML）；`docs/spec/M0.md` SPEC-M0-009；`DESIGN.md` §5 / §6。

**过渡期结束（2026-09-24，PRD v1.18）**：用户拍板删除 TOML 支持。
- `configSource` 只认 `DOMI_CONFIG` / `config.yaml` / `config.yml`，一律按 YAML 解析；`DOMI_CONFIG` 指到 `.toml` 也按 YAML 解析，TOML 语法会报 `ConfigParseError`，不会静默当成空配置。
- `domi init --from-toml` 与 `error.config.legacyToml` 删除。
- `domi doctor` 保留一条提示：`~/.domi/config.toml` 还在时说明它已不再读取、请手动把设置搬到 `config.yaml` 后删掉。这是唯一还认得 TOML 文件名的地方。
