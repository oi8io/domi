# 022 插件 API：manifest + 四类扩展点 + 安装时权限快照

- 日期：2026-09-15
- 状态：已采纳（PRD-M6-001 / 002 / 004 · INV-03 · INV-05）

**Context**：M6 要回答「别人能否给 domi 写插件」。PRD-VISION §6 要求 API 从已跑通的内置能力归纳，归纳过程见 `docs/spec/M6.md` §2。

**Decision**：
- 插件 = 一个目录 + `domi-plugin.yaml`。四类扩展点：tool、skill、mcp、ui（形状见 SPEC-M6-001）。
- 工具名与能力 id 统一加前缀 `plugin.<插件名>.`，用户的权限规则可以写 `plugin.<插件名>.*`。
- `api` 字段只写主版本（现在是 1）。小版本只加可选字段；弃用字段进 `DEPRECATIONS` 表，
  命中时 warn 并写明从哪个版本移除；主版本变化 = 不兼容，旧插件安装失败并说明原因。
- **权限必须声明**（`permissions` 字段缺失 → 安装失败）。三种：`read` / `write`（相对工作目录的 glob）、`hosts`。
- 安装时逐条确认，确认结果与 manifest 的 sha256 一起存进 `~/.domi/plugins/installed.json`。
  运行时只认这份快照；manifest 被改过就停用，直到重新安装确认。
- 官方内置能力用同一套形状在进程内注册（`definePlugin`），不走沙箱。
- UI 扩展是静态 HTML，Web 用 `<iframe sandbox="allow-scripts" srcdoc>` 渲染：没有同源、拿不到协议。

**Consequences**：插件作者只需要写一个 YAML 和一个 `execute(args, ctx)`；
代价是插件不能 import 任何碰 I/O 的模块（它们在沙箱里本来就不能用），一切经 `ctx`。
