在做: M0 内核骨架。事件流这块（TASK-M0-005/006/007/008/009）已完成，28 个测试全绿。
下一步: TASK-M0-010（ModelProvider 接口 + StubProvider）→ TASK-M0-011（AI SDK 适配）→ TASK-M0-012（buildContext 纯函数）
卡在: 没卡住。**但两个 spike 仍未跑**（TASK-M0-001/002，PRD-M0-007 要求第 1-2 天做）——
      TUI 框架选型与 buildContext 性能两个留白还悬着。TASK-M0-012 之前必须先补 TASK-M0-002，
      否则 SPEC-M0-002「先全量拼装」这个取舍就没有数据支撑，会变成教条。
