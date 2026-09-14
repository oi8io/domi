在做: M0 内核骨架。TASK-M0-010（ModelProvider 接口 + StubProvider）。
下一步: TASK-M0-010 → TASK-M0-011（AI SDK 适配）→ TASK-M0-013（loop 骨架，buildContext 已就绪）
卡在: 没卡住。42 个测试全绿，五道守卫（depcruise / 纯度 / append-only / 契约快照 / 任务 lint）都验证过会红。
      **唯一悬着的是 TASK-M0-001 的 TUI spike**（OpenTUI vs Ink），它挡着 TASK-M0-020/021。
      压测那条已由 ADR-005 降级，不再是门禁——但 ADR-005 里写了三个重新激活条件，别当它消失了。
