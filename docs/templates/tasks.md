# M{n} 任务

> status 取值：todo | doing | blocked | review | done

## TASK-M{n}-00X · {标题}
- status: todo
- prd: PRD-M{n}-00X          # 必填，INV-10，CI 强制
- spec: SPEC-M{n}-00X
- 前置: TASK-M{n}-00X | 无
- 预估: 0.5d
- 测试先行:
  - [ ] {测试文件}: {断言}
- 实现:
  - [ ] {步骤}
- DoD:
  - [ ] 测试全绿
  - [ ] main 可运行（INV-07）
  - [ ] NEXT.md 已更新
- 笔记: （中断时写在这里，恢复时先读）
