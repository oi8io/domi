# 定时任务

> `packages/daemon/src/{cron,scheduler}.ts` —— PRD-M8-007 · SPEC-M8-007 取舍-7
> 对应 hermes 的 cron-internals。domi 的调度器住在 domid 进程里，时钟与定时器全部注入（测试用假时钟）。

## cron 表达式

5 段：分 时 日 月 周（`cron.ts`）。支持 `*` `,` `-` `/`、月份与星期的英文缩写，周日写 0 或 7。**不支持 `L` `W` `#` 与秒**；日与周都限定时按 Vixie cron 的规矩取「或」。

时区用 `Intl` 换算（不引依赖）：在 UTC 分钟上走，每一步看它在目标时区里是几月几日几点，按不匹配的那一级往前跳。`nextRun` / `prevRun` 是纯函数，可单测。

## 调度器：错过只补一次

`scheduler.ts` 在 domid 进程里跑：

- 每次醒来对每个计划看「不晚于现在的最近一个应触发时刻」是否晚于 `last_due` → 是就触发一次（**错过多个周期也只补这一次**）。
- 醒来的间隔 = 到最近一次运行的时间，**最长 60 秒**（系统休眠之后定时器会漂，靠这个兜底）。
- 应触发时刻之后 60 秒内算准点，超过就是 `late`（domid 没开、机器睡着了）——`fire(schedule, due, late)` 的 `late` 标志进 `schedule.fire` 事件。

已知限制（HANDOFF §7）：**夏令时被跳过的那一刻**（例如美东 3 月第二个周日 02:30）当天不触发。

## 触发 → 任务

`fire` 真的去建任务并提交目标，返回会话 id（`task.start` 的 runId 就是会话 id）；`isBusy` 防止同一会话叠跑。调度器用的内部连接（`SYSTEM_CONN`）：不订阅、不收推送。daemon 重启后 `resumeRuns` 把没跑完的接着跑。

RPC 面：`schedule.list / create / update / delete / runs / preview`（`previewCron` 给下一次触发时间）；`schedule.fire` 是事件。

## 相关

- 任务的执行循环：[编排：任务 · 子 agent · 计划](orchestration.md)。
- 存储：`store/schedules.ts`（`schedules` / `schedule_runs` 表）。
- 测试：`packages/daemon/test/scheduler.spec.ts`（假时钟 + 假定时器，含夏令时跳变、错过补触发、late 判定）。
