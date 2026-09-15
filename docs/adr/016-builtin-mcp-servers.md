# 016 内置 MCP server 清单：Playwright MCP 与 zavora computer-use-mcp

- 日期：2026-09-15
- 状态：已采纳（兑现 `docs/adr/010` 表里「computer-use MCP server 选哪个」；PRD-M2-009）

**Context**：`PRD-VISION.md` §6 把 browser use / computer use 归为第一类——**全部收敛为 MCP server，domi 零实现**。
PRD-M2-009 要的是「配置模板里一键启用」，外加同一条权限路径、二进制不进事件流、失败降级、出站受约束。
后三条已由 `packages/mcp` 兑现（ADR-015），这里只剩选哪两个 server。

**Decision**：
- **浏览器：`@playwright/mcp`**（微软官方，stdio，npm 上 2026-09-14 仍在发版）。钉 `0.0.81`。
  模板里带 `--headless --isolated`：不弹窗、不往磁盘留浏览器配置。
- **桌面：`@zavora-ai/computer-use-mcp`**（MIT，stdio，macOS / Windows / Linux(X11) 三平台，
  本身就是基于 MCP SDK v2 写的，和我们对齐同一版规范）。钉 `7.4.0`。
  候选里其余几个要么只支持 macOS、要么没发 npm、要么半年没更新。
  **它的采用度不高**（GitHub 十来个星）——所以这是「当前最合适」，不是「可以放心」：换一个只是改配置，domi 这边零代码。
- 两个都在 `domi init` 模板里，**默认 `enabled: false`**，改成 true 就是「一键启用」；
  权限规则默认 `mcp.browser.*` / `mcp.computer.*` 为 **ask**——看网页、点界面每一步都要人点头。
- 新守卫 `guard:automation`（`scripts/check-no-selfimpl-automation.ts`）：`packages/` 下不许依赖或 import
  playwright / puppeteer / nut-js / robotjs / selenium（M2-009 AC-1）。`apps/web` 将来为 e2e 引 Playwright 不受影响。

**Consequences**：
- 换来开箱就能看网页、点界面，而 domi 不背这两块的维护。
- **AC-4（出站受白名单约束）对这两个 server 只能做到尽力而为**：它们是 stdio 子进程，网络是它们自己发的。
  Playwright MCP 有 `--allowed-origins`，但它自己的文档写明「不是安全边界、不管重定向」；computer-use 能开任何应用。
  真正的约束要进程级沙箱，归 M6 插件隔离（PRD-M6-003），与 ADR-015 记的缺口是同一件事。
- computer-use 的工具里有 `run_script` / `filesystem` / `process_kill` 这类重型操作——默认 ask 的规则就是为它们准备的；
  用户若想放宽，应该按工具名精确放行（`mcp.computer.screenshot: allow`），而不是整组 allow。
