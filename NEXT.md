在做: M0 内核骨架。**只剩 TUI 两个任务 + DoD 走查**。
下一步: TASK-M0-020（Ink TUI 骨架与流式渲染）→ TASK-M0-021（确认框 / 退出 flush / 四宽度 golden 快照）→ TASK-M0-022（DoD 走查与对账）
卡在: TASK-M0-021 需要**真终端**才能验证 Ink 的 useInput（ADR-001 退路清单第 1 条的判定点），
      沙箱里测不了。其余部分（渲染、golden 快照）可以在沙箱完成。
