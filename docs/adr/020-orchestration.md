# 020 编排：子 agent 在 runtime，DAG 在 packages/orchestrator，状态全在事件流

- 日期：2026-09-15
- 状态：已采纳（PRD-M5-001 / 002 / 003 · INV-01 · INV-03）

**Context**：M5 要能跑 30 分钟、5+ 节点、中途被杀还能接着跑的任务。三块：子 agent、DAG、断点恢复。
`PRD-VISION.md` §6 把 ReAct / plan-execute 归为「只抄算法，做精简版」。

**Decision**：

**子 agent（M5-001）**
- 是一个普通 Tool：`task.spawn {goal, tools?}`，能力 id 同名，照常过权限（INV-05：执行原语只有 Tool）。
- 子会话 id = `<父会话>.sub-<n>`，`sessions.spawned_by` 记父会话（新增列，不复用分支用的 `parent_session_id`——
  那一列会让子会话的上下文拼上父会话的历史，恰好违反 AC-2）。子会话不出现在默认会话列表里。
- 父上下文只拿到子会话最后一段回答（工具结果），中间事件只在子会话里（AC-2）。
- 权限：子会话的 PermissionEngine 包一层「父范围」——能力不在 spawn 声明的清单里、或父规则缺失 / 为 deny，
  直接拒绝，`matchedRule: 'parent-scope'`；在范围内的按父规则走，「要问」的照样问人（AC-3）。
- 嵌套最多两层（子 agent 还能派一层）；再深直接拒绝，防止无限派生。
- 事件：`task.spawn {childSessionId, goal, tools}`，随工具结果一起落进父会话（AC-1）。

**DAG（M5-002）**
- 纯逻辑放 `packages/orchestrator`：YAML 解析 + zod 校验 + 环检测（Kahn），`runState(events)` 从事件投影出各节点状态，
  `nextNodes(state)` 决定下一步。执行器由调用方注入（runtime 提供四种节点的实现），orchestrator 不碰 IO。
- 一次运行 = 一个会话，id `run-<时间>-<随机>`。事件：
  `task.run {name, spec}`（spec 快照，之后改 YAML 文件不影响这次运行）·
  `task.node {nodeId, status: started|done|failed, attempt, output?, error?}` ·
  `task.resume {completed, pending}` · `task.retry {nodeId}` · `task.end {status}`。
- 节点**顺序执行**（按拓扑序，同层按声明顺序）。并行不在本轮：30 分钟任务的瓶颈是模型，不是调度；
  并行会让「从哪个点恢复」和权限询问的顺序都变复杂。
- 一个节点失败：依赖它的节点不跑，与它无关的照跑；全部走完后 `task.end {status:'failed'}`。
  `task.retry` 只重跑那个失败节点及其下游，已完成的不动（AC-4）。
- 节点的输出（agent-step 的最后回答、tool 的结果摘要、sub-agent 的结论）写进 `task.node.output`，
  下游 agent-step 的提示词里带上它依赖的节点的输出。
- agent-step 与 sub-agent 各用一个节点会话 `<runId>.<nodeId>`；human-approval 在运行会话上发一次询问。

**断点恢复（M5-003）**
- domid 启动时找出没有 `task.end` 的运行会话，追加 `task.resume`，从投影出的状态继续。
- 「started 但没有 done / failed」的节点**重跑**（至少一次语义）：已完成节点绝不重跑（AC-2），
  但中断时正在跑的那个节点可能有一半副作用——和 TASK-M3-010 同一个立场，恢复记录里写明是哪个节点被重跑。
- 节点会话本身的一致性由 TASK-M3-010 的 `recover()` 保证。

**Consequences**：状态没有第二份真相；代价是每次查询都要重放一次运行会话的事件（几十到几百条，可以忽略）。
顺序执行意味着 30 分钟的任务就是 30 分钟，不会因为并行变短——等真有需要再加，届时改的是 `nextNodes`。
