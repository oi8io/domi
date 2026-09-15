在做: **M3 DoD 的自动化版本已绿**（`apps/tui/test/dod.spec.ts`）：TUI 发起长任务后退出，浏览器端之后连上来看到它跑完。
      `pnpm check`：typecheck（含 apps/tui、apps/web）+ 16 道守卫 + **628 个测试** + L1 回放，全绿。
      任务与缺陷的账在 `docs/tasks/M3.md`（前七条 done；末尾是缺陷与待优化登记）。

      现在能用的：
      - `domi`（TUI）是 daemon 的客户端，没有 domid 会自动在后台拉起；退出只断开自己
      - `pnpm web` 起 Web 端：会话列表 / 回收站、事件流与轨迹、工具确认框、状态栏、切换模型、删除会话
      - 对话里 `/compact`、`/model <名字> [provider]`
      - 配置文件改成了 **YAML**：`~/.domi/config.yaml`（`domi init` 打印模板）。
        旧的 config.toml 还能读；迁移：`domi init --from-toml > ~/.domi/config.yaml`，然后删掉 toml（`domi doctor` 会提示）
      - anthropic 协议网关的 base_url 带不带 /v1 都行；openai-compatible 网关要用工具的话在
        config.yaml 里写 `model.capabilities.toolCall: true`

      ⚠️ 更新代码后：`pnpm install`，并停掉已在跑的 domid（`domi` 会复用它，旧进程跑的是旧代码，见 OPT-M3-002）

下一步: 1. TASK-M3-014 会话分支（先修 BUG-M3-010：runtime 拼上下文不读父链）
        2. TUI 里补会话列表 / 恢复 / 删除入口（parity 第 5、6、8 项的 TUI 列）
        3. TASK-M3-008 parity e2e（Playwright）；TASK-M3-009 推送延迟基准
        4. TASK-M3-010 kill -9 恢复、TASK-M3-011 远程认证、TASK-M3-012 跨会话引用、TASK-M3-013 MCP
        5. 缺陷登记里 open 的：BUG-M3-003（状态栏缺本轮耗时）、BUG-M3-008（陈锁并发接管）、
           BUG-M3-012（配置里的提示词层从未被读取）

        仍然只有你能做的：真终端走 M3 DoD（`domi` 发长任务 → 关终端 → 浏览器看完成）、
        M0 真终端走查（TASK-M0-021）、`pnpm bench:cache --yes`、独立 QA、M1 dogfooding

卡在: 没有卡住的决定。
      体验类的问题按你定的规矩只记录不排期（OPT-M3-001…006），其中 OPT-M3-001（每个 token 一条事件）
      牵涉回放与压缩，动之前要单独讨论。
