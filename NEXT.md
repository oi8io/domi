在做: **M12「体验修订」四条全部 done**（2026-09-23）：
      ① M12-001 模型纯下拉（commit c578176）：Web ModelSwitch 删手填分支 + TUI /model 只开选择器 + model.resolve RPC 全删
      ② M12-002 确认模式三档会话级（commit 103ab33）：permissions.mode 会话级 + 对话框下拉 + 全仓 review 清零 + config 删全局 review
      ③ M12-003 标题同步（已提交）：SessionTitle 删死分支，空标题口径 daemon firstInput
      ④ M12-004 取消 plan/act（commit 6516293）：删 mode/setMode/ModeToggle//plan /act + 权限 plan 分支 + mode.switch 事件；确认点由 permissionsMode ask 机制兜底
      Web 150/150 绿；daemon 118 pass（SQLite disk I/O 环境 flaky 与本改动无关）。

下一步: 1. 用户手测 M12 四项（模型下拉/确认模式/标题同步/无 plan 模式直接跑）
        2. plan.ts 文件保留但不再注册——确认弹框多 tab abcd 形态是后续工作（当前 askUser 兜底）
        3. TASK-M11-007 收口 / M10 DoD / M9 DoD 等历史欠账

卡在: 仓库还没有 git remote——150 多个提交只在这一台机器上。
      daemon 需要重启才能跑新的 runtime 代码（当前跑的是旧进程）。
