# NEXT.md

现状: TASK-M14-006 上下文 tab（= PRD-M14-006）已完成：model.request.ctx?（kernel loop 纯计算 tools/history，prompt() 返回 layers）+ runtime Session.context() RPC + daemon session.context 分支 + client.context 封装；client-core contextView 8 测（九段映射/未归类差额/同源 AC-8/压缩记录/加载清单/读过的）+ kernel ctx 2 测 + Web contextTab（堆叠条+图例+同区数字+加载清单+压缩记录+读过的，4 测）；i18n web.context.* 对称。

下一步: TASK-M14-007 产物 tab（= PRD-M14-007，checkpoint.diff 已就绪：非隔离会话 fs.snapshot 产物清单 + 打开文件/定位）。
        其后：008 diff 行评论 → 009 TUI 右侧栏 → 010 回到这一步 → 011 收口。
        M14 DoD 最终手测需用户验收（10 个任务完成后）。

待清: apps/web/src/session/.ChangesBar.removed-m14.tsx（备份文件，用户确认后删）。
