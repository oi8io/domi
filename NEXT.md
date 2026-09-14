在做: M0 内核骨架。**读→改→测的闭环已经真跑通了**（e2e-loop.spec.ts，真 SQLite / 真权限 / 真文件 / 真子进程，只有模型是替身）。
下一步: TASK-M0-019（配置与凭据）→ TASK-M0-020/021（Ink TUI）→ TASK-M0-011（AI SDK 适配）→ TASK-M0-022（DoD 走查）
卡在: 没卡住。M0 剩 5 个任务，其中 TUI 两个是大头。
      注意 TASK-M0-021 同时是 ADR-001 退路第 1 条的判定点（Ink 的 useInput 在真终端里能不能收到按键）。
