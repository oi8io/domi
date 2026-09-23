在做: 2026-09-23 体检止血完成（TASK-M12-005）：
      - `pnpm check` 全绿（1358 pass / 0 fail，lint + 22 道守卫、typecheck、L1 评估）；M11 起它红了 3 天
      - 修 BUG-M11-001（shell「始终允许」指纹可被 && / ; / sh -c 等绕过，安全）、BUG-M11-002（按需档 allow 规则不算数，M7 写代码每写一个文件都问）
      - 用户拍板：「全部放行」= 跳过所有确认（同 Claude skip all approvals，只剩显式 deny 与父范围）；「按需」下用户写的 allow 规则算数
      - 协议：SCHEMA_VERSION 13，mode.switch 类型恢复（读旧会话），协议文档与 API 快照重新生成
      - 总 PRD v1.14：补记 M11、追加 M12、划掉 M7-005 / M8-005 AC-2·3 / M8-010 AC-5 / M9-003 AC-3·4
      - origin 已配置并推送（git@github.com:oi8io/domi.git）

下一步: 1. TASK-M12-004 新流程：出计划 → 多 tab 确认（abcd + 自定义）→ 执行；阻止提示判定；转长任务。现在长目标任务直接开干
        2. TASK-M12-002 收尾：capability 的 reviewMode / ReviewMode 改名；计划模式的死 i18n key 清掉
        3. 状态栏显示当前确认模式（「全部放行」时要看得见）
        4. TASK-M11-007 收口（总 PRD 的 M11 条目补逐条 AC 后进覆盖强制）、M10-007 / M4–M6 验证补齐
        5. 用户侧：M8–M12 的 DoD 手测

规矩: 做完 = `pnpm check` 全绿（CI 为准）；改协议必须升 SCHEMA_VERSION + legacy fixture + 重新生成文档；
      改已交付功能走回写门，在总 PRD 顶部记一条；任务状态以 docs/tasks 为准，提交里引用的 TASK 编号必须在任务文件里存在。

卡在: 无。daemon 需要重启才能跑新的 runtime 代码。
