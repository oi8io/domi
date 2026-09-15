# 023 插件隔离：系统级沙箱（bwrap / sandbox-exec）+ 宿主代理 I/O，没有沙箱就不跑

- 日期：2026-09-15
- 状态：已采纳（PRD-M6-003 · INV-03 · INV-06；兑现 `docs/adr/010` 表里「插件沙箱机制」一行）

**Context**：Bun 没有 Deno 那样的权限模型。PRD-M6-003 要求插件访问未声明路径 / 主机的各 5 种逃逸方式全部被拦。

**Decision**：
- **Linux：bubblewrap**。`--unshare-all`（含网络）、`--die-with-parent`、`--clearenv`，只读绑定 bun 可执行文件、
  运行时库目录、插件目录、runner 脚本；`/tmp` 是 tmpfs。
- **macOS：sandbox-exec**（系统自带，虽然标了弃用但仍是唯一不用装东西的选择）。profile 默认 deny，
  放行进程执行、bun 与系统库的只读访问、插件目录只读，`(deny network*)`。**本轮没有在 macOS 真机上验证**。
- **单二进制**：沙箱里执行的是 `domi` 自己，`BUN_BE_BUN=1` 让它当 bun 用；runner 脚本在启动时写进 `~/.domi/plugins/.runtime/`。
- 插件的 I/O 全部经 stdio 上的 JSON 行请求宿主代做，宿主按安装时的权限快照核对；越权拒绝并落事件。
- 找不到 bwrap / sandbox-exec：带代码的插件不加载（`plugins.allowUnsandboxed: true` 才加载，doctor 标红）。
- 超时杀进程组；进程回收后才返回结果。

**不选的**：
- JS 层封锁（删 `process` / `Bun` 全局、拦 import）——有已知绕法（`Function` 构造器拿全局、动态 import 内建模块），是假隔离。
- Worker——与宿主同进程、同文件系统视图，隔离不了 I/O。
- 容器（Docker）——要用户装东西、冷启动秒级。

**Consequences**：隔离强度由操作系统保证，可以写成「逃逸用例全部被拦」的测试；代价是 Windows（非 WSL）上插件代码不能跑，
以及每次调用多 ~50ms 的进程启动。
